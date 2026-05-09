#!/usr/bin/env bash
# ============================================================================
#  filecap audit — single-server accessibility-inventory script
# ============================================================================
#
#  WHAT THIS DOES
#    Inventories the document files on a remote server relevant to an
#    accessibility audit: PDFs, Word/Excel/PowerPoint, images, and more.
#    Produces a vendor-ready CSV with one row per file plus per-file metadata
#    (page counts, has-text-layer, alt-text presence, etc.) so remediation
#    vendors know exactly what they are working with.
#
#    Optionally also writes a self-contained HTML report (files.html) — a
#    sortable, filterable, print-friendly version of the same data that opens
#    in any browser with no external dependencies.
#
#  HOW TO GET THIS SCRIPT
#    curl -O https://raw.githubusercontent.com/ICJIA/filecap-cli/main/examples/audit-remote.sh
#    chmod +x audit-remote.sh
#    ./audit-remote.sh
#
#    (For fleet audits across multiple servers, use audit-fleet.sh instead.)
#
#  REQUIREMENTS
#    - bash 3.2+  (ships with macOS; standard on Linux)
#    - python3    (ships with macOS 12+; install via package manager on Linux)
#    - ssh        (with keys configured for the target server)
#    - rsync      (ships with macOS; install via package manager on Linux)
#    - npx        (comes with Node.js 18+; install Node from https://nodejs.org)
#
#  WHAT YOU WILL BE ASKED
#    - SSH username on the target server (defaults to "forge"; override with
#      env var FILECAP_DEFAULT_SSH_USER or by typing a different name at the prompt)
#    - Server IP or hostname
#    - Full path to the uploads directory on the remote
#    - A friendly name for the server (used in the report header)
#    - Whether to also generate a self-contained HTML report (optional)
#
#  WHERE OUTPUT GOES
#    ~/filecap-audits/<server-ip>/
#      ├── SOURCE_INFO.txt    (provenance: who, what, when)
#      ├── inventory.ndjson   (raw scan output)
#      └── report/
#          ├── files.csv      (32-column vendor work-order)
#          ├── files.html     (only if --html or "yes" answered at the prompt)
#          ├── SUMMARY.txt    (counts by category)
#          └── ...
#
#  USAGE
#    ./audit-remote.sh                                         # interactive
#    ./audit-remote.sh USER HOST REMOTE_PATH [SERVER_NAME]
#    ./audit-remote.sh forge 192.241.146.85 ~/uploads dvfr-prod
#
# ============================================================================

set -euo pipefail

# ── portable open helper ──────────────────────────────────────────────────────
xopen() {
  if command -v open >/dev/null 2>&1; then
    open "$1"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$1"
  else
    echo "  (your OS does not have 'open' or 'xdg-open'; navigate manually to the file above)"
  fi
}

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

# ── preflight: verify all required tools are present ─────────────────────────
check_required_tools() {
  local missing=()
  for tool in bash python3 ssh rsync npx; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      missing+=("$tool")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo
    echo "ERROR: missing required tools: ${missing[*]}" >&2
    echo
    echo "Install instructions:" >&2
    for tool in "${missing[@]}"; do
      case "$tool" in
        bash|python3|ssh|rsync)
          echo "  - $tool: install via your OS package manager (apt, brew, dnf, etc.)" >&2
          ;;
        npx)
          echo "  - npx: install Node.js 18+ from https://nodejs.org (npx ships with Node)" >&2
          ;;
      esac
    done
    echo
    exit 1
  fi
}

check_required_tools

# ── parse / prompt for arguments ─────────────────────────────────────────────
USER_ARG="${1:-}"
HOST_ARG="${2:-}"
REMOTE_PATH_ARG="${3:-}"
SERVER_NAME_ARG="${4:-}"

DEFAULT_SSH_USER="${FILECAP_DEFAULT_SSH_USER:-forge}"
if [[ -z "$USER_ARG" ]]; then
  read -r -p "SSH username on the target server [${DEFAULT_SSH_USER}]: " USER_ARG
  USER_ARG="${USER_ARG:-$DEFAULT_SSH_USER}"
fi
if [[ -z "$HOST_ARG" ]]; then
  read -r -p "Server IP or hostname (e.g. 192.241.146.85): " HOST_ARG
fi
if [[ -z "$REMOTE_PATH_ARG" ]]; then
  read -r -p "Full path to uploads directory on the remote (e.g. ~/uploads): " REMOTE_PATH_ARG
fi
if [[ -z "$SERVER_NAME_ARG" ]]; then
  # Default: strapi-<ip-with-dashes>
  DEFAULT_NAME="strapi-${HOST_ARG//./-}"
  read -r -p "Friendly server name [${DEFAULT_NAME}]: " SERVER_NAME_ARG
  SERVER_NAME_ARG="${SERVER_NAME_ARG:-$DEFAULT_NAME}"
fi

SSH_USER="$USER_ARG"
HOST="$HOST_ARG"
REMOTE_PATH="$REMOTE_PATH_ARG"
SERVER_NAME="$SERVER_NAME_ARG"

# ── HTML report flag ──────────────────────────────────────────────────────────
# The env var AUDIT_HTML=1 lets audit-fleet.sh propagate the choice without
# re-prompting. When running standalone, ask interactively.
HTML_FLAG=""
if [[ "${AUDIT_HTML:-0}" == "1" ]]; then
  HTML_FLAG="--html"
else
  read -r -p "Also generate self-contained HTML report? [y/N]: " HTML_ANS
  if [[ "${HTML_ANS}" == "y" || "${HTML_ANS}" == "Y" ]]; then
    HTML_FLAG="--html"
  fi
fi

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
  # ─ local mode: rsync mirror, then scan locally ───────────────────────────────
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
# that the output always reflects the *source server's* paths, not any local
# mirror paths.
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
if ! npx --yes @icjia/filecap@latest report "${INVENTORY}" -o "${REPORT_DIR}" ${HTML_FLAG} \
    2> >(grep -v 'Warning:' >&2); then
  die "filecap report generation failed."
fi

# ── summary ───────────────────────────────────────────────────────────────────
printf "\n${G}Audit complete${N} — ${SERVER_NAME} (${HOST})\n\n"

if [[ -f "${REPORT_DIR}/SUMMARY.txt" ]]; then
  cat "${REPORT_DIR}/SUMMARY.txt"
fi

printf "\n${G}Files generated:${N}\n"
printf "  Source info : %s\n" "${WORK_DIR}/SOURCE_INFO.txt"
printf "  Inventory   : %s\n" "${INVENTORY}"
printf "  CSV report  : %s\n" "${REPORT_DIR}/files.csv"
if [[ -n "$HTML_FLAG" ]]; then
  printf "  HTML report : %s\n" "${REPORT_DIR}/files.html"
fi
printf "  Full report : %s\n" "${REPORT_DIR}/"

printf "\n${Y}Hint:${N} open the CSV report at:\n"
printf "  %s\n" "${REPORT_DIR}/files.csv"
xopen "${REPORT_DIR}/files.csv"
if [[ -n "$HTML_FLAG" ]]; then
  printf "\n${Y}Hint:${N} open the HTML report at:\n"
  printf "  %s\n" "${REPORT_DIR}/files.html"
  xopen "${REPORT_DIR}/files.html"
fi
