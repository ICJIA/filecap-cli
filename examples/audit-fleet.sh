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
#
#  REQUIREMENTS
#    - bash 3.2+  (ships with macOS; standard on Linux)
#    - python3    (ships with macOS 12+; install via package manager on Linux)
#    - ssh        (with keys configured for each target server)
#    - rsync      (ships with macOS; install via package manager on Linux)
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
#    ~/filecap-audits/_fleet/<timestamp>/
#      ├── servers.txt              (manifest of servers audited)
#      ├── MANAGER_SUMMARY.txt      (rollup counts by server and category)
#      ├── consolidated.ndjson      (merged raw scan output)
#      ├── consolidated-report/
#      │   ├── files.csv            (32-column vendor work-order, all servers)
#      │   └── SUMMARY.txt
#      └── inventories/
#          └── <server-name>.ndjson (per-server scan output)
#
#    Per-server reports also remain at:
#      ~/filecap-audits/<server-ip>/report/
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

# ── per-server audits ─────────────────────────────────────────────────────────
FAILED_SERVERS_TXT="${FLEET_DIR}/failed_servers.txt"
SUCCESS_COUNT=0
FAIL_COUNT=0

for (( i=0; i<${#SRV_NAMES[@]}; i++ )); do
  SRV_NAME="${SRV_NAMES[$i]}"
  SRV_USER="${SRV_USERS[$i]}"
  SRV_HOST="${SRV_HOSTS[$i]}"
  SRV_PATH="${SRV_PATHS[$i]}"

  printf "\n${B}==> Auditing %s (%s)${N}\n" "$SRV_NAME" "$SRV_HOST"

  if "$AUDIT_REMOTE" "$SRV_USER" "$SRV_HOST" "$SRV_PATH" "$SRV_NAME"; then
    SRC_INVENTORY="${HOME}/filecap-audits/${SRV_HOST}/inventory.ndjson"
    DEST_INVENTORY="${INVENTORIES_DIR}/${SRV_NAME}.ndjson"
    if [[ -f "$SRC_INVENTORY" ]]; then
      cp "$SRC_INVENTORY" "$DEST_INVENTORY"
      info "Copied inventory → ${DEST_INVENTORY}"
      (( SUCCESS_COUNT++ )) || true
    else
      warn "audit-remote succeeded but inventory not found at: ${SRC_INVENTORY}"
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
  "${HOME}/filecap-audits" \
  "${FAILED_SERVERS_TXT}" \
  <<'PYMANAGER'
import sys, json, os

consolidated_path   = sys.argv[1]
summary_out         = sys.argv[2]
success_count       = int(sys.argv[3])
total_count         = int(sys.argv[4])
fleet_ts            = sys.argv[5]
consolidated_report = sys.argv[6]
audits_base         = sys.argv[7]   # ~/filecap-audits
failed_txt          = sys.argv[8]

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

def thousands(n):
    return f"{n:,}"

# ── extract sources from header ───────────────────────────────────────────────
is_consolidated = (header.get('kind') == 'filecap-consolidated-header')
sources_list = []
if is_consolidated:
    sources_list = header.get('metadata', {}).get('sources', [])

# Build per-server lookup: serverName → source metadata dict
source_by_name = {s['serverName']: s for s in sources_list}

# ── aggregate totals ──────────────────────────────────────────────────────────
total_files       = len(entries)
total_bytes       = sum(e.get('sizeBytes', 0) for e in entries)
total_remediable  = sum(1 for e in entries if e.get('remediable', False))

# By category
cat_counts = {}
for e in entries:
    cat = e.get('category', 'other')
    cat_counts[cat] = cat_counts.get(cat, 0) + 1

# ── per-server counts ─────────────────────────────────────────────────────────
srv_counts = {}   # serverName → {files, remediable, pdfs, image_only_pdfs, bytes, serverIp}
for e in entries:
    sname = e.get('serverName', 'unknown')
    if sname not in srv_counts:
        srv_counts[sname] = {
            'files': 0, 'remediable': 0, 'pdfs': 0,
            'image_only_pdfs': 0, 'bytes': 0, 'serverIp': ''
        }
    srv_counts[sname]['files'] += 1
    srv_counts[sname]['bytes'] += e.get('sizeBytes', 0)
    if e.get('remediable', False):
        srv_counts[sname]['remediable'] += 1
    if e.get('category') == 'pdf':
        srv_counts[sname]['pdfs'] += 1
    intro = e.get('introspection') or {}
    if intro.get('kind') == 'pdf' and intro.get('isImageOnly') is True:
        srv_counts[sname]['image_only_pdfs'] += 1

# Pull serverIp from entries (first occurrence per serverName)
for e in entries:
    sname = e.get('serverName', 'unknown')
    if sname in srv_counts and not srv_counts[sname]['serverIp']:
        # serverIp may be on the entry (consolidated schema adds serverName but not
        # serverIp directly; pull from source header instead)
        pass

# Fill serverIp from sources list (more reliable)
for s in sources_list:
    sname = s.get('serverName', '')
    if sname in srv_counts:
        srv_counts[sname]['serverIp'] = s.get('serverIp', '')

# For entries that have serverIp directly (some builds embed it)
for e in entries:
    sname = e.get('serverName', 'unknown')
    if sname in srv_counts and not srv_counts[sname]['serverIp']:
        srv_counts[sname]['serverIp'] = e.get('serverIp', '')

# ── failed servers ────────────────────────────────────────────────────────────
failed_lines = []
if os.path.exists(failed_txt):
    with open(failed_txt, 'r', encoding='utf-8') as fh:
        failed_lines = [l.strip() for l in fh if l.strip()]

# ── build the summary text ────────────────────────────────────────────────────
lines = []
lines.append("filecap fleet audit — manager summary")
lines.append("=====================================")
lines.append("")

# Derive audit-run timestamp from consolidated header if present
audit_run = header.get('metadata', {}).get('consolidatedAt', fleet_ts + 'Z')
lines.append(f"Audit run:        {audit_run}")
lines.append(f"Servers audited:  {success_count} of {total_count}")
lines.append(f"Total files:      {thousands(total_files)}")
lines.append(f"Total bytes:      {humanize_bytes(total_bytes)}")
lines.append(f"Files needing remediation:  {thousands(total_remediable)}")
lines.append("")

# ── per-server table ──────────────────────────────────────────────────────────
lines.append("By server:")
lines.append("")

C1, C2, C3, C4, C5, C6 = 28, 17, 12, 12, 7, 18
hdr  = f"  {'Name':<{C1}} {'IP':<{C2}} {'File count':>{C3}} {'Remediable':>{C4}} {'PDFs':>{C5}} {'Image-only PDFs':>{C6}}"
sep  = f"  {'─'*C1} {'─'*C2} {'─'*C3} {'─'*C4} {'─'*C5} {'─'*C6}"
lines.append(hdr)
lines.append(sep)

for sname, sc in sorted(srv_counts.items(), key=lambda x: x[0]):
    row = (
        f"  {sname:<{C1}} "
        f"{sc['serverIp']:<{C2}} "
        f"{sc['files']:>{C3},} "
        f"{sc['remediable']:>{C4},} "
        f"{sc['pdfs']:>{C5},} "
        f"{sc['image_only_pdfs']:>{C6},}"
    )
    lines.append(row)

lines.append("")

# ── by category ───────────────────────────────────────────────────────────────
lines.append("By file category (across fleet):")
for cat, cnt in sorted(cat_counts.items(), key=lambda x: -x[1]):
    lines.append(f"  {cat+':':<20} {thousands(cnt)}")
lines.append("")

# ── for auditors ──────────────────────────────────────────────────────────────
lines.append("For auditors:")
lines.append("")
lines.append(f"  - Detailed file list (one row per file): {consolidated_report}/files.csv")
lines.append("  - Each row has: serverName, serverIp, scannedPath, path, filename, sizeBytes,")
lines.append("    sha256, category, remediable, plus introspection fields (where available).")
lines.append("  - To locate any flagged file: ssh into the server listed in the row's serverIp column.")
lines.append("")

# ── per-server report dirs ────────────────────────────────────────────────────
lines.append("Per-server reports (each has its own SUMMARY.txt and files.csv):")
for sname, sc in sorted(srv_counts.items(), key=lambda x: x[0]):
    ip = sc['serverIp'] or sname
    lines.append(f"  - {audits_base}/{ip}/report/")
lines.append("")

# ── failed servers ────────────────────────────────────────────────────────────
if failed_lines:
    lines.append("Failed servers:")
    for fl in failed_lines:
        lines.append(f"  - {fl}")
    lines.append(f"  (see {failed_txt} for details)")
else:
    lines.append("Failed servers: none")
lines.append("")

output = '\n'.join(lines) + '\n'
with open(summary_out, 'w', encoding='utf-8') as fh:
    fh.write(output)

print(f"  -> wrote {len(lines)} lines to manager summary")
PYMANAGER

# ── final output ──────────────────────────────────────────────────────────────
printf "\n${G}Fleet audit complete${N}\n\n"
printf "${G}Files generated:${N}\n"
printf "  Server manifest  : %s\n" "${SERVERS_TXT}"
printf "  Fleet inventories: %s\n" "${INVENTORIES_DIR}/"
printf "  Consolidated     : %s\n" "${CONSOLIDATED}"
printf "  Consolidated rpt : %s\n" "${CONSOLIDATED_REPORT_DIR}/"
if [[ -n "$HTML_FLAG" ]]; then
  printf "  HTML report      : %s\n" "${CONSOLIDATED_REPORT_DIR}/files.html"
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
  printf "  %s\n" "${CONSOLIDATED_REPORT_DIR}/files.html"
  xopen "${CONSOLIDATED_REPORT_DIR}/files.html"
fi
