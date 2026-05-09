#!/usr/bin/env bash
# audit-remote.sh — audit a single remote Strapi server.
#
# Auto-detects the remote Node version and chooses the right strategy:
#   - Node >= 20 on remote: run filecap natively over SSH (CPU on remote)
#   - Node < 20 or missing: rsync uploads down, scan locally on the Mac
#
# Paths in the output NDJSON / CSV are always rewritten to the source server's
# paths so the auditor-facing artefacts don't leak local Mac paths.
#
# Usage:
#   ./audit-remote.sh                                         # interactive
#   ./audit-remote.sh USER HOST REMOTE_PATH [SERVER_NAME]
#   ./audit-remote.sh forge 192.241.146.85 ~/uploads dvfr-prod

set -euo pipefail

# ── colour codes ──────────────────────────────────────────────────────────────
G='\033[0;32m'   # green
R='\033[0;31m'   # red
B='\033[0;34m'   # blue
Y='\033[0;33m'   # yellow
N='\033[0m'      # reset

# ── helpers ───────────────────────────────────────────────────────────────────
die() { printf "${R}ERROR:${N} %s\n" "$*" >&2; exit 1; }
step() { printf "${G}==>${N} %s\n" "$*"; }
info() { printf "${B}  ->${N} %s\n" "$*"; }
warn() { printf "${Y}WARN:${N} %s\n" "$*" >&2; }

# ── preflight: local tooling ──────────────────────────────────────────────────
if ! command -v npx &>/dev/null; then
  die "npx is not in PATH. Install Node.js 20+ on this Mac (https://nodejs.org/) and re-run."
fi
if ! command -v python3 &>/dev/null; then
  die "python3 is not in PATH — it is required for JSON path rewriting."
fi
if ! command -v rsync &>/dev/null; then
  die "rsync is not in PATH."
fi

# ── parse / prompt for arguments ─────────────────────────────────────────────
USER_ARG="${1:-}"
HOST_ARG="${2:-}"
REMOTE_PATH_ARG="${3:-}"
SERVER_NAME_ARG="${4:-}"

if [[ -z "$USER_ARG" ]]; then
  read -r -p "SSH user (e.g. forge): " USER_ARG
fi
if [[ -z "$HOST_ARG" ]]; then
  read -r -p "Remote host / IP (e.g. 192.241.146.85): " HOST_ARG
fi
if [[ -z "$REMOTE_PATH_ARG" ]]; then
  read -r -p "Remote uploads path (e.g. ~/uploads or /var/strapi/uploads): " REMOTE_PATH_ARG
fi
if [[ -z "$SERVER_NAME_ARG" ]]; then
  # Default: strapi-<ip-with-dashes>
  DEFAULT_NAME="strapi-${HOST_ARG//./-}"
  read -r -p "Server name [${DEFAULT_NAME}]: " SERVER_NAME_ARG
  SERVER_NAME_ARG="${SERVER_NAME_ARG:-$DEFAULT_NAME}"
fi

SSH_USER="$USER_ARG"
HOST="$HOST_ARG"
REMOTE_PATH="$REMOTE_PATH_ARG"
SERVER_NAME="$SERVER_NAME_ARG"

# ── work directory ────────────────────────────────────────────────────────────
WORK_DIR="${HOME}/filecap-audits/${HOST}"
MIRROR_DIR="${WORK_DIR}/mirror"
REPORT_DIR="${WORK_DIR}/report"

step "Setting up work directory: ${WORK_DIR}"
mkdir -p "${MIRROR_DIR}" "${REPORT_DIR}"

# ── write SOURCE_INFO.txt ─────────────────────────────────────────────────────
AUDIT_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat > "${WORK_DIR}/SOURCE_INFO.txt" <<SOURCE_INFO
filecap audit — source server info
===================================

Server name  : ${SERVER_NAME}
Server IP    : ${HOST}
SSH user     : ${SSH_USER}
Remote path  : ${REMOTE_PATH}
Audit started: ${AUDIT_TS}

To locate a file on the remote:
  ssh ${SSH_USER}@${HOST}
  cd ${REMOTE_PATH}
SOURCE_INFO
info "Wrote ${WORK_DIR}/SOURCE_INFO.txt"

# ── SSH sanity check ──────────────────────────────────────────────────────────
step "Verifying SSH connectivity to ${SSH_USER}@${HOST} ..."
if ! ssh -o ConnectTimeout=10 -o BatchMode=yes "${SSH_USER}@${HOST}" true 2>/dev/null; then
  die "Cannot SSH to ${SSH_USER}@${HOST}. Check your SSH config / keys and retry."
fi
info "SSH OK"

# ── verify remote path ────────────────────────────────────────────────────────
step "Verifying remote path exists: ${REMOTE_PATH}"
if ! ssh -o ConnectTimeout=10 "${SSH_USER}@${HOST}" "test -d '${REMOTE_PATH}'" 2>/dev/null; then
  die "Remote path '${REMOTE_PATH}' does not exist or is not a directory on ${HOST}."
fi
info "Remote path confirmed"

# ── remote size / file count ──────────────────────────────────────────────────
step "Checking remote upload size ..."
REMOTE_SIZE=$(ssh -o ConnectTimeout=10 "${SSH_USER}@${HOST}" \
  "LC_ALL=C du -sh '${REMOTE_PATH}' 2>/dev/null | tr -s ' \t' ' ' | cut -d' ' -f1" 2>/dev/null || echo "unknown")
REMOTE_COUNT=$(ssh -o ConnectTimeout=10 "${SSH_USER}@${HOST}" \
  "LC_ALL=C find '${REMOTE_PATH}' -type f 2>/dev/null | wc -l | tr -d ' \t'" 2>/dev/null || echo "?")
info "Remote: ${REMOTE_COUNT} files, ${REMOTE_SIZE} total on disk"

# ── detect remote Node version ────────────────────────────────────────────────
step "Detecting Node.js version on remote ..."
REMOTE_NODE=$(ssh -o ConnectTimeout=10 "${SSH_USER}@${HOST}" \
  'LC_ALL=C node --version 2>/dev/null || echo "v0"' 2>/dev/null | tr -d '[:space:]')
# Parse major version (e.g. "v16.20.0" → 16, "v0" → 0)
REMOTE_NODE_MAJOR=$(echo "${REMOTE_NODE}" | sed 's/[^0-9]/ /g' | awk '{print $1+0}')
info "Remote Node: ${REMOTE_NODE} (major=${REMOTE_NODE_MAJOR})"

# ── scan ──────────────────────────────────────────────────────────────────────
INVENTORY="${WORK_DIR}/inventory.ndjson"

if [[ "$REMOTE_NODE_MAJOR" -ge 20 ]]; then
  # ─ native mode: filecap runs on the remote, NDJSON streams back ─────────────
  step "Mode: NATIVE (remote Node ${REMOTE_NODE} >= 20 — scan runs on the server)"
  info "Running: ssh ${SSH_USER}@${HOST} npx @icjia/filecap@latest scan '${REMOTE_PATH}' ..."

  if ! ssh -o ConnectTimeout=30 "${SSH_USER}@${HOST}" \
      "npx --yes @icjia/filecap@latest scan '${REMOTE_PATH}' \
        --server-name '${SERVER_NAME}' \
        --server-ip '${HOST}' \
        -o -" \
      > "${INVENTORY}" 2> >(grep -v 'Warning:' >&2); then
    die "Remote filecap scan failed. Check stderr above for details."
  fi

else
  # ─ local mode: rsync mirror, then scan on the Mac ───────────────────────────
  step "Mode: LOCAL (remote Node ${REMOTE_NODE} < 20 or absent — will rsync and scan locally)"
  info "This is expected for Ubuntu 18.04 / Node 16 servers."
  info "Step 1/2: rsyncing ${SSH_USER}@${HOST}:${REMOTE_PATH}/ → ${MIRROR_DIR}/"

  if ! rsync -av --delete \
      "${SSH_USER}@${HOST}:${REMOTE_PATH}/" \
      "${MIRROR_DIR}/" 2>&1; then
    die "rsync failed. Check SSH connectivity / permissions and retry."
  fi

  info "Step 2/2: scanning local mirror with filecap ..."
  if ! npx --yes @icjia/filecap@latest scan "${MIRROR_DIR}" \
      --server-name "${SERVER_NAME}" \
      --server-ip "${HOST}" \
      -o "${INVENTORY}" \
      2> >(grep -v 'Warning:' >&2); then
    die "Local filecap scan failed. Check stderr above for details."
  fi
fi

# ── path rewrite (CRITICAL) ───────────────────────────────────────────────────
# Rewrite scannedPath / hostname in the header and absolutePath in entries so
# that the output always reflects the *source server's* paths, not the local
# Mac mirror paths.
step "Rewriting inventory paths to remote source paths ..."

python3 - "${INVENTORY}" "${REMOTE_PATH}" "${HOST}" <<'PYREWRITE'
import sys, json, os, tempfile, shutil

inventory_path = sys.argv[1]
remote_path    = sys.argv[2].rstrip('/')   # strip trailing slash
remote_host    = sys.argv[3]

tmp_fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(inventory_path), suffix='.tmp')
try:
    with os.fdopen(tmp_fd, 'w', encoding='utf-8') as out_f, \
         open(inventory_path, 'r', encoding='utf-8') as in_f:
        for raw in in_f:
            raw = raw.rstrip('\n')
            if not raw:
                continue
            try:
                obj = json.loads(raw)
            except json.JSONDecodeError:
                out_f.write(raw + '\n')
                continue

            kind = obj.get('kind', '')

            # ── header: fix scannedPath + hostname ────────────────────────
            if kind in ('filecap-inventory-header', 'filecap-consolidated-header'):
                meta = obj.get('metadata', {})
                meta['scannedPath'] = remote_path
                meta['hostname']    = remote_host
                obj['metadata'] = meta

            # ── data entries: fix absolutePath ────────────────────────────
            elif kind not in ('filecap-inventory-footer', 'filecap-consolidated-footer'):
                rel = obj.get('path', '')
                obj['absolutePath'] = remote_path + '/' + rel.lstrip('/')

            out_f.write(json.dumps(obj, separators=(',', ':')) + '\n')

    shutil.move(tmp_path, inventory_path)
    print(f"  -> path rewrite complete: scannedPath={remote_path}, hostname={remote_host}")
except Exception as e:
    if os.path.exists(tmp_path):
        os.unlink(tmp_path)
    print(f"ERROR during path rewrite: {e}", file=sys.stderr)
    sys.exit(1)
PYREWRITE

# ── generate report ───────────────────────────────────────────────────────────
step "Generating filecap report ..."
if ! npx --yes @icjia/filecap@latest report "${INVENTORY}" -o "${REPORT_DIR}" \
    2> >(grep -v 'Warning:' >&2); then
  die "filecap report generation failed."
fi

# ── summary ───────────────────────────────────────────────────────────────────
printf "\n${G}✓ Audit complete${N} — ${SERVER_NAME} (${HOST})\n\n"

if [[ -f "${REPORT_DIR}/SUMMARY.txt" ]]; then
  cat "${REPORT_DIR}/SUMMARY.txt"
fi

printf "\n${G}Files generated:${N}\n"
printf "  Source info : %s\n" "${WORK_DIR}/SOURCE_INFO.txt"
printf "  Inventory   : %s\n" "${INVENTORY}"
printf "  CSV report  : %s\n" "${REPORT_DIR}/files.csv"
printf "  Full report : %s\n" "${REPORT_DIR}/"

printf "\n${Y}Hint:${N} open '%s'\n" "${REPORT_DIR}/files.csv"
