#!/usr/bin/env bash
# ============================================================================
#  filecap audit — fleet accessibility-inventory script
# ============================================================================
#
#  WHAT THIS DOES
#    Runs audit-remote.sh across a fleet of servers and then consolidates
#    all per-server inventories into a single vendor-ready CSV plus a
#    manager-friendly MANAGER_SUMMARY.txt that rolls up counts by server
#    and by file category. Useful when your organization hosts content on
#    multiple servers and you need one combined work-order for remediation.
#
#    Optionally also writes a self-contained HTML report (files.html) for
#    both per-server and consolidated reports — a sortable, filterable,
#    print-friendly version of the same data that opens in any browser.
#
#  HOW TO GET BOTH SCRIPTS
#    curl -O https://raw.githubusercontent.com/ICJIA/filecap-cli/main/examples/audit-fleet.sh
#    curl -O https://raw.githubusercontent.com/ICJIA/filecap-cli/main/examples/audit-remote.sh
#    chmod +x audit-fleet.sh audit-remote.sh
#    ./audit-fleet.sh                  # interactive
#    ./audit-fleet.sh servers.csv      # batch mode from CSV file
#    ./audit-fleet.sh --no-version-check           # skip update check
#    SKIP_VERSION_CHECK=1 ./audit-fleet.sh         # same, via env var
#
#  REQUIREMENTS
#    - bash 3.2+  (ships with macOS; standard on Linux)
#    - python3    (ships with macOS 12+; install via package manager on Linux)
#    - ssh        (with keys configured for each target server)
#    - rsync      (ships with macOS; install via package manager on Linux)
#    - curl       (ships with macOS; install via package manager on Linux)
#    - npx        (comes with Node.js 18+; install Node from https://nodejs.org)
#    - audit-remote.sh must be in the same directory as this script
#
#  WHAT YOU WILL BE ASKED (interactive mode)
#    - How many servers to audit
#    - For each server: friendly name, SSH user, host/IP, remote uploads path
#
#  CSV INPUT FORMAT (batch mode)
#    No header row; lines starting with # are comments:
#      server_name,user,host,remote_path
#      dvfr-strapi-prod,forge,192.241.146.85,~/dvfr.icjia-api.cloud/strapi_v4/public/uploads
#      another-server,deploy,10.0.0.5,/var/strapi/uploads
#
#  WHERE OUTPUT GOES
#    Per-server results land in timestamped run dirs (preserved across re-runs):
#      ~/filecap-audits/<server-ip>/runs/<utc-timestamp>/
#        ├── SOURCE_INFO.txt
#        ├── inventory.ndjson
#        └── report/
#    A 'latest' symlink at ~/filecap-audits/<server-ip>/latest points to the
#    most recent successful run for each server.
#
#    Fleet-consolidated output goes to a timestamped fleet dir:
#      ~/filecap-audits/_fleet/<timestamp>/
#        ├── servers.txt              (manifest of servers audited)
#        ├── MANAGER_SUMMARY.txt      (full audit numbers, per-server breakdown)
#        ├── consolidated.ndjson      (merged raw scan output)
#        ├── consolidated-report/
#        │   ├── audit-file-list.csv  (vendor work-order, all servers)
#        │   ├── audit-file-list.html (only if HTML was requested)
#        │   ├── audit-summary.txt    (plain-text summary)
#        │   └── README.txt           (explains all artifacts)
#        └── inventories/
#            └── <server-name>.ndjson (per-server scan output)
#    A '~/filecap-audits/_fleet/latest' symlink points to the most recent
#    fleet run.
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
G='\033[0;32m'
R='\033[0;31m'
B='\033[0;34m'
Y='\033[0;33m'
N='\033[0m'

# ── helpers ───────────────────────────────────────────────────────────────────
die()  { printf "${R}ERROR:${N} %s\n" "$*" >&2; exit 1; }
step() { printf "${G}==>${N} %s\n" "$*"; }
info() { printf "${B}  ->${N} %s\n" "$*"; }
warn() { printf "${Y}WARN:${N} %s\n" "$*" >&2; }

# ── size_to_bytes: convert du -sh output (e.g., "39M", "2.1G") to bytes ──────
size_to_bytes() {
  local s="$1"
  local num="${s%[KMGT]}"
  local unit="${s#$num}"
  case "$unit" in
    K) awk -v n="$num" 'BEGIN { printf "%.0f", n*1024 }' ;;
    M) awk -v n="$num" 'BEGIN { printf "%.0f", n*1024*1024 }' ;;
    G) awk -v n="$num" 'BEGIN { printf "%.0f", n*1024*1024*1024 }' ;;
    T) awk -v n="$num" 'BEGIN { printf "%.0f", n*1024*1024*1024*1024 }' ;;
    *) awk -v n="$num" 'BEGIN { printf "%.0f", n }' ;;
  esac
}

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

  NODE_VER_RAW=$(node --version 2>/dev/null | sed 's/^v//')
  NODE_MAJOR=$(echo "$NODE_VER_RAW" | cut -d. -f1)
  if [[ -z "$NODE_MAJOR" ]] || ! [[ "$NODE_MAJOR" =~ ^[0-9]+$ ]]; then
    echo "ERROR: cannot determine Node version. Install Node 18+ from https://nodejs.org" >&2
    exit 1
  fi
  if [[ "$NODE_MAJOR" -lt 18 ]]; then
    echo "ERROR: Node $NODE_VER_RAW detected; this script requires Node 18+." >&2
    echo "       Install a current LTS from https://nodejs.org or via nvm." >&2
    exit 1
  fi
  if [[ "$NODE_MAJOR" -lt 20 ]]; then
    warn "Node $NODE_VER_RAW detected. Filecap works best on Node 20+; consider upgrading."
  fi
}

# ── self-version-check ────────────────────────────────────────────────────────
# Compares the SHA-256 of this running script against the version on GitHub's
# main branch. If they differ, warn the auditor that their copy is stale and
# print the re-download command. Non-blocking: skipped silently if offline,
# skipped explicitly if --no-version-check was passed or SKIP_VERSION_CHECK=1.

# Portable SHA-256 wrapper
sha256_of() {
  local input="$1"
  if [[ "$input" == "-" ]]; then
    if command -v shasum >/dev/null 2>&1; then
      shasum -a 256 | cut -d' ' -f1
    elif command -v sha256sum >/dev/null 2>&1; then
      sha256sum | cut -d' ' -f1
    fi
  else
    if command -v shasum >/dev/null 2>&1; then
      shasum -a 256 "$input" | cut -d' ' -f1
    elif command -v sha256sum >/dev/null 2>&1; then
      sha256sum "$input" | cut -d' ' -f1
    fi
  fi
}

check_script_version() {
  # Skip if explicitly disabled
  if [[ "${SKIP_VERSION_CHECK:-0}" == "1" ]]; then
    return 0
  fi

  # Determine script name for the GitHub URL.
  # Use the BASH_SOURCE basename, not the user's invocation path, so a renamed
  # local copy still checks against the canonical filename.
  local script_basename
  script_basename="$(basename "${BASH_SOURCE[0]}")"
  local upstream_url="https://raw.githubusercontent.com/ICJIA/filecap-cli/main/examples/${script_basename}"

  # Compute local hash
  local local_path
  local_path="${BASH_SOURCE[0]}"
  # If BASH_SOURCE is a relative path, normalize against the current dir
  if [[ ! -f "$local_path" ]]; then
    return 0  # cannot self-check; skip silently
  fi
  local local_hash
  local_hash="$(sha256_of "$local_path")"
  if [[ -z "$local_hash" ]]; then
    return 0  # no SHA-256 tool available; skip silently
  fi

  # Fetch upstream hash with a short timeout. Suppress all curl output.
  local upstream_hash
  upstream_hash="$(curl -fsSL --connect-timeout 5 --max-time 10 "$upstream_url" 2>/dev/null | sha256_of -)"
  if [[ -z "$upstream_hash" ]]; then
    info "Skipped script version check (could not reach GitHub)."
    return 0
  fi

  if [[ "$local_hash" != "$upstream_hash" ]]; then
    echo
    warn "This script is older than the version on GitHub."
    echo "  Your copy:   ${local_hash:0:12}..." >&2
    echo "  On GitHub:   ${upstream_hash:0:12}..." >&2
    echo
    echo "  To get the latest version:" >&2
    echo "    curl -O ${upstream_url}" >&2
    echo "    chmod +x ${script_basename}" >&2
    echo
    echo "  (Or pass --no-version-check / SKIP_VERSION_CHECK=1 to skip this check.)" >&2
    echo
    # Continue anyway — non-blocking
  fi
}

# ── strip --no-version-check from args before positional parsing ──────────────
NEW_ARGS=()
for a in "$@"; do
  if [[ "$a" == "--no-version-check" ]]; then
    SKIP_VERSION_CHECK=1
    export SKIP_VERSION_CHECK
  else
    NEW_ARGS+=("$a")
  fi
done
set -- "${NEW_ARGS[@]+"${NEW_ARGS[@]}"}"

check_required_tools
check_script_version

# ── locate sibling audit-remote.sh ───────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_REMOTE="${SCRIPT_DIR}/audit-remote.sh"

if [[ ! -x "$AUDIT_REMOTE" ]]; then
  die "audit-remote.sh not found or not executable at: ${AUDIT_REMOTE}
  Download it alongside this script:
    curl -O https://raw.githubusercontent.com/ICJIA/filecap-cli/main/examples/audit-remote.sh
    chmod +x audit-remote.sh"
fi

# ── fleet / timestamp setup ───────────────────────────────────────────────────
FLEET_TS=$(date -u +"%Y%m%d-%H%M%S")
FLEET_DIR="${HOME}/filecap-audits/_fleet/${FLEET_TS}"
INVENTORIES_DIR="${FLEET_DIR}/inventories"
CONSOLIDATED_REPORT_DIR="${FLEET_DIR}/consolidated-report"

step "Fleet audit run: ${FLEET_TS}"
step "Fleet output dir: ${FLEET_DIR}"
mkdir -p "${INVENTORIES_DIR}" "${CONSOLIDATED_REPORT_DIR}"

# ── parse server list ─────────────────────────────────────────────────────────
# Arrays: names, users, hosts, paths (parallel indexed)
declare -a SRV_NAMES=()
declare -a SRV_USERS=()
declare -a SRV_HOSTS=()
declare -a SRV_PATHS=()

CSV_FILE="${1:-}"

if [[ -n "$CSV_FILE" ]]; then
  if [[ ! -f "$CSV_FILE" ]]; then
    die "CSV file not found: ${CSV_FILE}"
  fi
  step "Loading server list from: ${CSV_FILE}"
  while IFS= read -r line || [[ -n "$line" ]]; do
    # skip blank lines and comment lines
    [[ -z "$line" ]]       && continue
    [[ "$line" == \#* ]]   && continue

    IFS=',' read -r _name _user _host _path <<< "$line"
    # trim whitespace
    _name="${_name// /}"
    _user="${_user// /}"
    _host="${_host// /}"
    # path may contain spaces but typically does not; trim leading/trailing only
    _path="$(echo "${_path}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

    if [[ -z "$_name" || -z "$_user" || -z "$_host" || -z "$_path" ]]; then
      warn "Skipping malformed CSV line: ${line}"
      continue
    fi

    SRV_NAMES+=("$_name")
    SRV_USERS+=("$_user")
    SRV_HOSTS+=("$_host")
    SRV_PATHS+=("$_path")
  done < "$CSV_FILE"

  if [[ "${#SRV_NAMES[@]}" -eq 0 ]]; then
    die "No valid server entries found in ${CSV_FILE}."
  fi
  info "Loaded ${#SRV_NAMES[@]} server(s) from CSV"

else
  # ── interactive mode ─────────────────────────────────────────────────────
  step "Interactive mode — enter server details"
  read -r -p "How many servers to audit? " NUM_SERVERS
  if ! [[ "$NUM_SERVERS" =~ ^[0-9]+$ ]] || [[ "$NUM_SERVERS" -lt 1 ]]; then
    die "Expected a positive integer, got: ${NUM_SERVERS}"
  fi

  DEFAULT_SSH_USER="${FILECAP_DEFAULT_SSH_USER:-forge}"
  for (( i=1; i<=NUM_SERVERS; i++ )); do
    printf "\n${B}Server %d of %d:${N}\n" "$i" "$NUM_SERVERS"
    read -r -p "  Server name (e.g. dvfr-prod): " _name
    read -r -p "  SSH username [${DEFAULT_SSH_USER}]: " _user
    _user="${_user:-$DEFAULT_SSH_USER}"
    read -r -p "  Server IP or hostname (e.g. 192.168.1.1): " _host
    read -r -p "  Full path to uploads directory on the remote (e.g. ~/uploads): " _path

    SRV_NAMES+=("$_name")
    SRV_USERS+=("$_user")
    SRV_HOSTS+=("$_host")
    SRV_PATHS+=("$_path")
  done
fi

# ── write servers.txt manifest ────────────────────────────────────────────────
SERVERS_TXT="${FLEET_DIR}/servers.txt"
{
  printf "filecap fleet audit — server manifest\n"
  printf "======================================\n"
  printf "Run timestamp: %s\n\n" "$FLEET_TS"
  printf "%-28s %-12s %-20s %s\n" "Name" "User" "Host" "Remote path"
  printf "%-28s %-12s %-20s %s\n" "----------------------------" "------------" "--------------------" "-----------"
  for (( i=0; i<${#SRV_NAMES[@]}; i++ )); do
    printf "%-28s %-12s %-20s %s\n" \
      "${SRV_NAMES[$i]}" "${SRV_USERS[$i]}" "${SRV_HOSTS[$i]}" "${SRV_PATHS[$i]}"
  done
} > "$SERVERS_TXT"
info "Wrote ${SERVERS_TXT}"

# ── HTML report flag ──────────────────────────────────────────────────────────
# When set, audit-remote.sh will also generate files.html for each server,
# and the final consolidated report will include files.html as well.
# audit-remote.sh reads AUDIT_HTML=1 so we don't need to pass --html on its CLI.
read -r -p "Also generate self-contained HTML reports? [y/N]: " HTML_ANS
if [[ "${HTML_ANS}" == "y" || "${HTML_ANS}" == "Y" ]]; then
  export AUDIT_HTML=1
  HTML_FLAG="--html"
else
  export AUDIT_HTML=0
  HTML_FLAG=""
fi

# ── fleet pre-validation ──────────────────────────────────────────────────────
step "Pre-validating ${#SRV_NAMES[@]} server(s) before starting audit work ..."

declare -a VALID_INDEXES=()
declare -a SKIPPED_REASONS=()
TOTAL_REMOTE_BYTES=0

printf "\n  %-22s %-18s %-12s %-10s %-22s\n" "Name" "IP" "Status" "Node" "Source"
printf "  %-22s %-18s %-12s %-10s %-22s\n" "----" "--" "------" "----" "------"

for i in "${!SRV_NAMES[@]}"; do
  name="${SRV_NAMES[$i]}"
  user="${SRV_USERS[$i]}"
  host="${SRV_HOSTS[$i]}"
  path_="${SRV_PATHS[$i]}"

  if ! ssh -o ConnectTimeout=10 -o BatchMode=yes "${user}@${host}" true 2>/dev/null; then
    printf "  %-22s %-18s ${R}%-12s${N} %-10s %-22s\n" "$name" "$host" "UNREACHABLE" "-" "-"
    SKIPPED_REASONS+=("$name: SSH failed")
    continue
  fi

  if ! ssh -o ConnectTimeout=10 "${user}@${host}" "test -d '${path_}' && test -r '${path_}'" 2>/dev/null; then
    printf "  %-22s %-18s ${R}%-12s${N} %-10s %-22s\n" "$name" "$host" "PATH ERROR" "-" "$path_"
    SKIPPED_REASONS+=("$name: path missing or unreadable")
    continue
  fi

  node_ver=$(ssh -o ConnectTimeout=10 "${user}@${host}" 'node --version 2>/dev/null || echo none' 2>/dev/null | tr -d '[:space:]')
  if [[ -z "$node_ver" || "$node_ver" == "none" ]]; then
    node_label="none"
  else
    node_label="$node_ver"
  fi

  remote_size=$(ssh -o ConnectTimeout=10 "${user}@${host}" "du -sh '${path_}' 2>/dev/null | cut -f1" 2>/dev/null || echo "?")
  if [[ "$remote_size" != "?" ]]; then
    remote_bytes=$(size_to_bytes "$remote_size")
    TOTAL_REMOTE_BYTES=$((TOTAL_REMOTE_BYTES + remote_bytes))
  fi

  printf "  %-22s %-18s ${G}%-12s${N} %-10s %-22s\n" "$name" "$host" "OK" "$node_label" "$remote_size"
  VALID_INDEXES+=("$i")
done

echo

N_VALID=${#VALID_INDEXES[@]}
N_TOTAL=${#SRV_NAMES[@]}
if [[ "$N_VALID" -eq 0 ]]; then
  die "0 of $N_TOTAL servers are reachable. Cannot continue."
fi

FREE_BYTES=$(df -Pk "${HOME}" | awk 'NR==2 { print $4 * 1024 }')
if [[ "$TOTAL_REMOTE_BYTES" -gt "$FREE_BYTES" ]]; then
  die "Total remote bytes ($(awk -v b="$TOTAL_REMOTE_BYTES" 'BEGIN { printf "%.1f GB", b/1024/1024/1024 }')) exceeds local free disk."
fi

echo
if [[ "$N_VALID" -lt "$N_TOTAL" ]]; then
  warn "$N_VALID of $N_TOTAL servers reachable. Skipping:"
  for r in "${SKIPPED_REASONS[@]}"; do
    echo "  - $r" >&2
  done
fi
echo
read -r -p "Proceed with audit of $N_VALID server(s)? [y/N]: " ans
[[ "$ans" =~ ^[Yy]$ ]] || die "Aborted by user."

# ── per-server audits ─────────────────────────────────────────────────────────
FAILED_SERVERS_TXT="${FLEET_DIR}/failed_servers.txt"
SUCCESS_COUNT=0
FAIL_COUNT=0

for i in "${VALID_INDEXES[@]}"; do
  SRV_NAME="${SRV_NAMES[$i]}"
  SRV_USER="${SRV_USERS[$i]}"
  SRV_HOST="${SRV_HOSTS[$i]}"
  SRV_PATH="${SRV_PATHS[$i]}"

  printf "\n${B}==> Auditing %s (%s)${N}\n" "$SRV_NAME" "$SRV_HOST"

  if SKIP_VERSION_CHECK=1 "$AUDIT_REMOTE" "$SRV_USER" "$SRV_HOST" "$SRV_PATH" "$SRV_NAME"; then
    # Prefer the inventory via the 'latest' symlink (confirmed-successful run).
    # Fall back to scanning runs/ directly in case the symlink is missing.
    SRC_INVENTORY="${HOME}/filecap-audits/${SRV_HOST}/latest/inventory.ndjson"
    if [[ ! -f "$SRC_INVENTORY" ]]; then
      LATEST_RUN=$(ls -1t "${HOME}/filecap-audits/${SRV_HOST}/runs" 2>/dev/null | head -1)
      if [[ -n "$LATEST_RUN" ]]; then
        SRC_INVENTORY="${HOME}/filecap-audits/${SRV_HOST}/runs/${LATEST_RUN}/inventory.ndjson"
      fi
    fi
    DEST_INVENTORY="${INVENTORIES_DIR}/${SRV_NAME}.ndjson"
    if [[ -f "$SRC_INVENTORY" ]]; then
      cp "$SRC_INVENTORY" "$DEST_INVENTORY"
      info "Copied inventory → ${DEST_INVENTORY}"
      (( SUCCESS_COUNT++ )) || true
    else
      warn "audit-remote succeeded but inventory not found for: ${SRV_HOST}"
      printf "  %s — inventory file missing after audit\n" "$SRV_NAME" >> "$FAILED_SERVERS_TXT"
      (( FAIL_COUNT++ )) || true
    fi
  else
    warn "Audit FAILED for ${SRV_NAME} (${SRV_HOST})"
    printf "  %s (host: %s, user: %s, path: %s) — audit-remote.sh exited non-zero\n" \
      "$SRV_NAME" "$SRV_HOST" "$SRV_USER" "$SRV_PATH" >> "$FAILED_SERVERS_TXT"
    (( FAIL_COUNT++ )) || true
  fi
done

printf "\n"
step "Per-server audits complete: ${SUCCESS_COUNT} succeeded, ${FAIL_COUNT} failed"

# ── check we have something to consolidate ────────────────────────────────────
INVENTORY_FILES=()
while IFS= read -r -d '' f; do
  INVENTORY_FILES+=("$f")
done < <(find "${INVENTORIES_DIR}" -maxdepth 1 -name '*.ndjson' -print0 2>/dev/null)

if [[ "${#INVENTORY_FILES[@]}" -eq 0 ]]; then
  die "No successful inventories — nothing to consolidate. Check per-server errors above."
fi
info "${#INVENTORY_FILES[@]} inventory file(s) available for rollup"

# ── rollup ────────────────────────────────────────────────────────────────────
CONSOLIDATED="${FLEET_DIR}/consolidated.ndjson"
step "Rolling up ${#INVENTORY_FILES[@]} inventories → ${CONSOLIDATED}"
if ! npx --yes @icjia/filecap@latest rollup "${INVENTORIES_DIR}"/*.ndjson \
    -o "${CONSOLIDATED}" \
    2> >(grep -v 'Warning:' >&2); then
  die "filecap rollup failed. Check stderr above."
fi
info "Rollup complete"

# ── consolidated report ───────────────────────────────────────────────────────
step "Generating consolidated report → ${CONSOLIDATED_REPORT_DIR}/"
if ! npx --yes @icjia/filecap@latest report "${CONSOLIDATED}" \
    -o "${CONSOLIDATED_REPORT_DIR}" ${HTML_FLAG} \
    2> >(grep -v 'Warning:' >&2); then
  die "filecap report generation failed."
fi
info "Report generated"

# ── MANAGER_SUMMARY.txt (python3) ─────────────────────────────────────────────
MANAGER_SUMMARY="${FLEET_DIR}/MANAGER_SUMMARY.txt"
step "Generating manager summary → ${MANAGER_SUMMARY}"

python3 - \
  "${CONSOLIDATED}" \
  "${MANAGER_SUMMARY}" \
  "${SUCCESS_COUNT}" \
  "${#SRV_NAMES[@]}" \
  "${FLEET_TS}" \
  "${CONSOLIDATED_REPORT_DIR}" \
  "${FAILED_SERVERS_TXT}" \
  "${INVENTORIES_DIR}" \
  <<'PYMANAGER'
import sys, json, os

consolidated_path   = sys.argv[1]
summary_out         = sys.argv[2]
success_count       = int(sys.argv[3])
total_count         = int(sys.argv[4])
fleet_ts            = sys.argv[5]
consolidated_report = sys.argv[6]
failed_txt          = sys.argv[7]
inventories_dir     = sys.argv[8]

# ── parse consolidated NDJSON ────────────────────────────────────────────────
header  = None
entries = []

with open(consolidated_path, 'r', encoding='utf-8') as fh:
    for raw in fh:
        raw = raw.strip()
        if not raw:
            continue
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            continue
        kind = obj.get('kind', '')
        if kind in ('filecap-inventory-header', 'filecap-consolidated-header'):
            header = obj
        elif kind not in ('filecap-inventory-footer', 'filecap-consolidated-footer'):
            entries.append(obj)

if not header:
    print("ERROR: consolidated NDJSON has no header", file=sys.stderr)
    sys.exit(1)

# ── helpers ───────────────────────────────────────────────────────────────────
def humanize_bytes(n):
    for unit in ('B', 'KB', 'MB', 'GB', 'TB'):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"

def pad_r(s, w):
    return str(s).ljust(w)

def pad_l(s, w):
    return str(s).rjust(w)

def pct(n, total):
    if not total:
        return "0%"
    return f"{round(n / total * 100)}%"

# ── extract sources from header ───────────────────────────────────────────────
is_consolidated = (header.get('kind') == 'filecap-consolidated-header')
sources_list = []
if is_consolidated:
    sources_list = header.get('metadata', {}).get('sources', [])

# ── aggregate totals ──────────────────────────────────────────────────────────
total_files      = len(entries)
total_bytes      = sum(e.get('sizeBytes', 0) for e in entries)
total_remediable = sum(1 for e in entries if e.get('remediable', False))
not_remediable   = total_files - total_remediable

# Deduplicate by SHA-256
seen_hashes = {}
dup_count = 0
dup_bytes  = 0
for e in entries:
    h = e.get('sha256', '')
    if not h:
        continue
    if h in seen_hashes:
        dup_count += 1
        dup_bytes  += e.get('sizeBytes', 0)
    else:
        seen_hashes[h] = True
unique_count = total_files - dup_count

# By category
cat_counts = {}
cat_bytes  = {}
for e in entries:
    cat = e.get('category', 'other')
    cat_counts[cat] = cat_counts.get(cat, 0) + 1
    cat_bytes[cat]  = cat_bytes.get(cat, 0) + e.get('sizeBytes', 0)

# ── per-server counts ─────────────────────────────────────────────────────────
srv_counts = {}
for s in sources_list:
    sname = s.get('serverName', 'unknown')
    srv_counts[sname] = {
        'ip': s.get('serverIp', ''),
        'files': 0, 'remediable': 0, 'pdfs': 0,
        'image_only': 0, 'bytes': 0,
    }

for e in entries:
    sname = e.get('serverName', 'unknown')
    if sname not in srv_counts:
        srv_counts[sname] = {'ip': '', 'files': 0, 'remediable': 0, 'pdfs': 0, 'image_only': 0, 'bytes': 0}
    sc = srv_counts[sname]
    sc['files'] += 1
    sc['bytes'] += e.get('sizeBytes', 0)
    if e.get('remediable', False):
        sc['remediable'] += 1
    if e.get('category') == 'pdf':
        sc['pdfs'] += 1
    intro = e.get('introspection') or {}
    if intro.get('kind') == 'pdf' and intro.get('isImageOnly') is True:
        sc['image_only'] += 1

# ── PDF stats ─────────────────────────────────────────────────────────────────
pdf_entries    = [e for e in entries if e.get('category') == 'pdf']
pdf_intro      = [e for e in pdf_entries if (e.get('introspection') or {}).get('kind') == 'pdf']
pdf_count      = len(pdf_entries)
image_only_cnt = sum(1 for e in pdf_intro if e['introspection'].get('isImageOnly') is True)
tagged_cnt     = sum(1 for e in pdf_intro if e['introspection'].get('hasTags') is True)
encrypted_cnt  = sum(1 for e in pdf_intro if e['introspection'].get('encrypted') is True)
signed_cnt     = sum(1 for e in pdf_intro if e['introspection'].get('hasSignatures') is True)
form_cnt       = sum(1 for e in pdf_intro if e['introspection'].get('hasFormFields') is True)
linear_cnt     = sum(1 for e in pdf_intro if e['introspection'].get('isLinearized') is True)
total_pages    = sum(e['introspection'].get('pageCount', 0) for e in pdf_intro)
avg_pages      = f"{total_pages / pdf_count:.1f}" if pdf_count > 0 else "0"

# ── DOCX stats ────────────────────────────────────────────────────────────────
docx_entries     = [e for e in entries if (e.get('introspection') or {}).get('kind') == 'docx']
docx_count       = len(docx_entries)
docx_headings    = sum(1 for e in docx_entries if e['introspection'].get('hasHeadings') is True)
docx_no_headings = docx_count - docx_headings
docx_with_imgs   = sum(1 for e in docx_entries if (e['introspection'].get('imageCount') or 0) > 0)
alt_covs         = [e['introspection']['altTextCoverage'] for e in docx_entries if isinstance(e['introspection'].get('altTextCoverage'), (int, float))]
avg_alt          = f"{round(sum(alt_covs) / len(alt_covs) * 100)}%" if alt_covs else "n/a"
docx_with_tables = sum(1 for e in docx_entries if (e['introspection'].get('tableCount') or 0) > 0)
tbl_no_hdr       = sum(1 for e in docx_entries if (e['introspection'].get('tableCount') or 0) > 0 and e['introspection'].get('tablesHaveHeaders') is False)
vague_total      = sum(e['introspection'].get('vagueLinkCount', 0) for e in docx_entries)
docx_words       = sum(e['introspection'].get('wordCount', 0) or 0 for e in docx_entries)

# ── XLSX stats ────────────────────────────────────────────────────────────────
xlsx_entries    = [e for e in entries if (e.get('introspection') or {}).get('kind') == 'xlsx']
xlsx_count      = len(xlsx_entries)
xlsx_multi      = sum(1 for e in xlsx_entries if (e['introspection'].get('sheetCount') or 1) > 1)
xlsx_merged     = sum(1 for e in xlsx_entries if (e['introspection'].get('mergedCellCount') or 0) > 0)
xlsx_charts     = sum(1 for e in xlsx_entries if e['introspection'].get('hasCharts') is True)
xlsx_images     = sum(1 for e in xlsx_entries if e['introspection'].get('hasImages') is True)
xlsx_def_names  = sum(1 for e in xlsx_entries if (e['introspection'].get('defaultSheetNameCount') or 0) > 0)

# ── Legacy Office stats ───────────────────────────────────────────────────────
legacy_entries = [e for e in entries if (e.get('introspection') or {}).get('kind') == 'office-legacy']
legacy_counts  = {'doc': 0, 'xls': 0, 'ppt': 0}
for e in legacy_entries:
    fmt = e['introspection'].get('format', '')
    if fmt in legacy_counts:
        legacy_counts[fmt] += 1
legacy_total = len(legacy_entries)

# ── Filename quality ──────────────────────────────────────────────────────────
flagged_files     = sum(1 for e in entries if (e.get('flags') or []))
with_spaces       = sum(1 for e in entries if 'filename-has-spaces' in (e.get('flags') or []))
with_non_ascii    = sum(1 for e in entries if 'filename-non-ascii' in (e.get('flags') or []))
with_long_name    = sum(1 for e in entries if 'filename-long' in (e.get('flags') or []))
with_scanned      = sum(1 for e in entries if 'scanned-name-pattern' in (e.get('flags') or []))

# ── Top 5 largest ─────────────────────────────────────────────────────────────
top5 = sorted(entries, key=lambda e: e.get('sizeBytes', 0), reverse=True)[:5]

# ── Failed servers ────────────────────────────────────────────────────────────
failed_lines = []
if os.path.exists(failed_txt):
    with open(failed_txt, 'r', encoding='utf-8') as fh:
        failed_lines = [l.strip() for l in fh if l.strip()]

# ── Build summary ─────────────────────────────────────────────────────────────
lines = []
lines.append("filecap fleet audit — manager summary")
lines.append("=====================================")
lines.append("")
audit_run = header.get('metadata', {}).get('consolidatedAt', fleet_ts + 'Z')
lines.append(f"Audit date:       {audit_run[:10]}")
lines.append(f"Servers audited:  {success_count} of {total_count}")
lines.append("")

# The numbers
lines.append("The numbers")
lines.append("-----------")
lines.append(f"  Total files:                {total_files}")
lines.append(f"  Total size:                 {humanize_bytes(total_bytes)}")
lines.append(f"  Files needing remediation:  {total_remediable} ({pct(total_remediable, total_files)} of total)")
lines.append(f"  Files not requiring work:   {not_remediable}")
lines.append(f"  Unique files:               {unique_count}")
lines.append(f"  Duplicate copies:           {dup_count}")
lines.append(f"  Bytes saved if deduped:     {humanize_bytes(dup_bytes)}")
lines.append("")

# Per-server breakdown
C = [22, 18, 8, 12, 12, 8, 16]
hr = "─" * (sum(C) + 2 * len(C) + 2)
lines.append("Per-server breakdown")
lines.append("--------------------")
lines.append(
    "  " + pad_r("Server", C[0]) + "  " +
    pad_r("IP", C[1]) + "  " +
    pad_l("Files", C[2]) + "  " +
    pad_l("Size", C[3]) + "  " +
    pad_l("Needs remed.", C[4]) + "  " +
    pad_l("PDFs", C[5]) + "  " +
    pad_l("Image-only PDFs", C[6])
)
lines.append("  " + hr)
t_files = t_bytes = t_rem = t_pdfs = t_img = 0
for sname, sc in sorted(srv_counts.items()):
    lines.append(
        "  " + pad_r(sname, C[0]) + "  " +
        pad_r(sc['ip'], C[1]) + "  " +
        pad_l(sc['files'], C[2]) + "  " +
        pad_l(humanize_bytes(sc['bytes']), C[3]) + "  " +
        pad_l(sc['remediable'], C[4]) + "  " +
        pad_l(sc['pdfs'], C[5]) + "  " +
        pad_l(sc['image_only'], C[6])
    )
    t_files += sc['files']; t_bytes += sc['bytes']; t_rem += sc['remediable']
    t_pdfs  += sc['pdfs'];  t_img   += sc['image_only']
lines.append("  " + hr)
lines.append(
    "  " + pad_r("Fleet totals", C[0]) + "  " +
    pad_r("", C[1]) + "  " +
    pad_l(t_files, C[2]) + "  " +
    pad_l(humanize_bytes(t_bytes), C[3]) + "  " +
    pad_l(t_rem, C[4]) + "  " +
    pad_l(t_pdfs, C[5]) + "  " +
    pad_l(t_img, C[6])
)
lines.append("")

# PDFs
def s_label(n, singular, plural=None):
    return singular if n == 1 else (plural or singular + "s")

lines.append(f"PDFs ({pdf_count} {s_label(pdf_count, 'file')})")
lines.append("-" * len(f"PDFs ({pdf_count} {s_label(pdf_count, 'file')})"))
if pdf_count == 0:
    lines.append("  None in this audit.")
else:
    lines.append(f"  Born-digital (text-based):    {pdf_count - image_only_cnt}")
    lines.append(f"  Image-only (needs OCR):       {image_only_cnt}")
    lines.append(f"  Already structurally tagged:  {tagged_cnt}")
    lines.append(f"  Encrypted:                    {encrypted_cnt}")
    lines.append(f"  Digitally signed:             {signed_cnt}")
    lines.append(f"  Has form fields:              {form_cnt}")
    lines.append(f"  Web-optimized (linearized):   {linear_cnt}")
    lines.append(f"  Total pages across all PDFs:  {total_pages}")
    lines.append(f"  Average pages per PDF:        {avg_pages}")
lines.append("")

# Word documents
lines.append(f"Word documents ({docx_count} {s_label(docx_count, 'file')})")
lines.append("-" * len(f"Word documents ({docx_count} {s_label(docx_count, 'file')})"))
if docx_count == 0:
    lines.append("  None in this audit.")
else:
    lines.append(f"  With proper heading styles:   {docx_headings}")
    lines.append(f"  Without heading styles:       {docx_no_headings}")
    lines.append(f"  Documents with images:        {docx_with_imgs}")
    lines.append(f"  Average alt-text coverage:    {avg_alt}")
    lines.append(f"  Documents with tables:        {docx_with_tables}")
    lines.append(f"  Tables without header rows:   {tbl_no_hdr}")
    lines.append(f"  Total vague hyperlinks:       {vague_total}")
    lines.append(f"  Total word count:             {docx_words}")
lines.append("")

# Excel files
lines.append(f"Excel files ({xlsx_count} {s_label(xlsx_count, 'file')})")
lines.append("-" * len(f"Excel files ({xlsx_count} {s_label(xlsx_count, 'file')})"))
if xlsx_count == 0:
    lines.append("  None in this audit.")
else:
    lines.append(f"  Multi-sheet:                  {xlsx_multi}")
    lines.append(f"  With merged cells:            {xlsx_merged}")
    lines.append(f"  With charts:                  {xlsx_charts}")
    lines.append(f"  With embedded images:         {xlsx_images}")
    lines.append(f"  Sheets with default names:    {xlsx_def_names}")
lines.append("")

# Legacy Office
lines.append(f"Legacy Office files ({legacy_total} {s_label(legacy_total, 'file')})")
lines.append("-" * len(f"Legacy Office files ({legacy_total} {s_label(legacy_total, 'file')})"))
if legacy_total == 0:
    lines.append("  None in this audit.")
else:
    lines.append(f"  .doc:                         {legacy_counts['doc']}")
    lines.append(f"  .xls:                         {legacy_counts['xls']}")
    lines.append(f"  .ppt:                         {legacy_counts['ppt']}")
lines.append("")

# By file type
ALL_CATS = ['pdf', 'image', 'office-document', 'spreadsheet', 'presentation',
            'archive', 'text', 'web', 'audio-video', 'other']
lines.append("By file type")
lines.append("------------")
for cat in ALL_CATS:
    if cat in cat_counts:
        lines.append(f"  {(cat + ':'):<22} {cat_counts[cat]} {s_label(cat_counts[cat], 'file')}, {humanize_bytes(cat_bytes[cat])}")
lines.append("")

# Filename quality
lines.append("Filename quality")
lines.append("----------------")
lines.append(f"  Files with name issues:           {flagged_files}")
lines.append(f"  Files with spaces in name:        {with_spaces}")
lines.append(f"  Files with non-ASCII chars:       {with_non_ascii}")
lines.append(f"  Files with very long names:       {with_long_name}")
lines.append(f"  Files with scanned-name pattern:  {with_scanned}")
lines.append("")

# Largest files
lines.append("Largest files")
lines.append("-------------")
if not top5:
    lines.append("  None in this audit.")
else:
    for i, e in enumerate(top5, 1):
        lines.append(f"  {i}. {e.get('filename', '?')}  ({humanize_bytes(e.get('sizeBytes', 0))})")
lines.append("")

# What this means
observations = []
if pdf_count > 0:
    if image_only_cnt == 0:
        observations.append(f"All {pdf_count} PDFs are text-based — no OCR needed (good news, OCR is expensive)")
    else:
        observations.append(f"{image_only_cnt} of {pdf_count} PDFs are image-only — these need OCR before remediation")
    if tagged_cnt == 0:
        observations.append(f"No PDFs are tagged — all {pdf_count} need structural tagging")
    elif tagged_cnt < pdf_count:
        observations.append(f"{pdf_count - tagged_cnt} of {pdf_count} PDFs lack structural tags")
if docx_count > 0:
    if docx_no_headings > 0:
        observations.append(f"{docx_no_headings} Word doc{'s' if docx_no_headings != 1 else ''} lack heading styles — need restructuring")
    if tbl_no_hdr > 0:
        observations.append(f"{tbl_no_hdr} Word doc table{'s' if tbl_no_hdr != 1 else ''} need header rows")
    if vague_total > 0:
        observations.append(f"{vague_total} vague hyperlink{'s' if vague_total != 1 else ''} across the Word docs — review for descriptive text")
if legacy_total > 0:
    observations.append(f"{legacy_total} legacy Office file{'s' if legacy_total != 1 else ''} (.doc/.xls/.ppt) need manual review or conversion")
if observations:
    lines.append("What this means for the audit")
    lines.append("-----------------------------")
    for obs in observations:
        lines.append(f"  - {obs}")
    lines.append("")

# Where to find files
lines.append("Where to find files")
lines.append("-------------------")
lines.append("  For per-server detail, see the inventories/ subfolder of this audit run.")
lines.append("  The consolidated inventory is in:")
lines.append("    consolidated-report/audit-file-list.csv")
lines.append("")
lines.append("  Each row in audit-file-list.csv has 'Server IP' and 'Full file path on")
lines.append("  server' columns. To open or download a flagged file:")
lines.append("    ssh <user>@<server-ip>")
lines.append("    cat '<full-file-path>'")
lines.append("")

# Failed servers
if failed_lines:
    lines.append("Failed servers:")
    for fl in failed_lines:
        lines.append(f"  - {fl}")
    lines.append("  (see failed_servers.txt in this run directory for details)")
else:
    lines.append("Failed servers: none")
lines.append("")

output = '\n'.join(lines) + '\n'
with open(summary_out, 'w', encoding='utf-8') as fh:
    fh.write(output)

print(f"  -> wrote {len(lines)} lines to manager summary")
PYMANAGER

# ── update _fleet/latest symlink ─────────────────────────────────────────────
FLEET_LATEST_LINK="${HOME}/filecap-audits/_fleet/latest"
ln -sfn "${FLEET_TS}" "${FLEET_LATEST_LINK}.tmp" && mv -f "${FLEET_LATEST_LINK}.tmp" "${FLEET_LATEST_LINK}"
info "Updated '_fleet/latest' symlink → ${FLEET_TS}"

# ── final output ──────────────────────────────────────────────────────────────
printf "\n${G}Fleet audit complete${N}\n\n"
printf "${G}Files generated:${N}\n"
printf "  Server manifest  : %s\n" "${SERVERS_TXT}"
printf "  Fleet inventories: %s\n" "${INVENTORIES_DIR}/"
printf "  Consolidated     : %s\n" "${CONSOLIDATED}"
printf "  Consolidated rpt : %s\n" "${CONSOLIDATED_REPORT_DIR}/"
if [[ -n "$HTML_FLAG" ]]; then
  printf "  HTML report      : %s\n" "${CONSOLIDATED_REPORT_DIR}/audit-file-list.html"
fi
printf "  Manager summary  : %s\n" "${MANAGER_SUMMARY}"

if [[ -f "${FAILED_SERVERS_TXT}" ]]; then
  printf "  Failed servers   : %s\n" "${FAILED_SERVERS_TXT}"
fi

printf "\n${Y}Hint:${N} open the manager summary at:\n"
printf "  %s\n" "${MANAGER_SUMMARY}"
xopen "${MANAGER_SUMMARY}"
if [[ -n "$HTML_FLAG" ]]; then
  printf "\n${Y}Hint:${N} open the consolidated HTML report at:\n"
  printf "  %s\n" "${CONSOLIDATED_REPORT_DIR}/audit-file-list.html"
  xopen "${CONSOLIDATED_REPORT_DIR}/audit-file-list.html"
fi
