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
#    - curl       (ships with macOS; install via package manager on Linux)
#    - npx        (comes with Node.js 18+; install Node from https://nodejs.org)
#
#  WHAT YOU WILL BE ASKED
#    - SSH username on the target server (defaults to "forge"; override with
#      env var FILECAP_DEFAULT_SSH_USER or by typing a different name at the prompt)
#    - Server IP or hostname
#    - Full path to the uploads directory on the remote
#    - A friendly name for the server (used in the report header)
#    - Website nickname (e.g. DVFR, i2i, vpp — press Enter to skip)
#    - Public URL base (e.g. https://dvfr.icjia-api.cloud/uploads — press Enter to skip)
#    - Whether to also generate a self-contained HTML report (optional)
#
#  WHERE OUTPUT GOES
#    ~/filecap-audits/<server-ip>/
#      ├── mirror/                           shared local rsync copy (incremental)
#      ├── runs/
#      │   ├── 20260509-143000Z/             each run gets its own timestamped dir (UTC)
#      │   │   ├── SOURCE_INFO.txt           provenance: who, what, when
#      │   │   ├── inventory.ndjson          raw scan output
#      │   │   └── report/
#      │   │       ├── audit-file-list.csv   vendor work-order
#      │   │       ├── audit-file-list.html  (only if --html or "yes" answered)
#      │   │       ├── audit-summary.txt     counts by category, manager-friendly
#      │   │       ├── README.txt            explains all artifacts
#      │   │       └── ...
#      │   ├── 20260516-093000Z/
#      │   └── 20260523-100000Z/
#      └── latest -> runs/20260523-100000Z   symlink, updated after each run
#
#    Re-running the script against the same server preserves history — each
#    run lands in its own timestamped subdirectory. The 'latest' symlink always
#    points to the most recent successful run for convenient access.
#
#  USAGE
#    ./audit-remote.sh                                                              # interactive
#    ./audit-remote.sh USER HOST REMOTE_PATH [SERVER_NAME] [SITE_NAME] [PUBLIC_URL_BASE] [AUDIT_LINK_PATTERN]
#    ./audit-remote.sh forge 192.241.146.85 ~/uploads dvfr-strapi-prod DVFR https://dvfr.icjia-api.cloud/uploads
#    ./audit-remote.sh --no-version-check                                           # skip update check
#    SKIP_VERSION_CHECK=1 ./audit-remote.sh                                         # same, via env var
#    RUN_AUDIT_ENRICH=y FILECAP_AUDIT_TOKEN=fap_xxx ./audit-remote.sh              # non-interactive enrich
#
#  NOTE: REMOTE_PATH must not contain spaces or shell metacharacters.
#    Tilde paths such as ~/uploads are supported (the remote shell expands them).
#    For paths with spaces, use the absolute path instead.
#
#  SAVED SITES (NEW)
#    On startup, the script offers a menu of previously-audited sites stored
#    in ~/.filecap/sites.json. Pick a number to skip re-typing the SSH user,
#    server IP, remote path, etc. New sites can be added; existing ones can
#    be edited or deleted via the same menu.
#
#    The audit token is NEVER stored in this file. Keep it in env or your
#    keychain (FILECAP_AUDIT_TOKEN env var).
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

# ── saved-sites manager ──────────────────────────────────────────────────────
SITES_FILE="${FILECAP_SITES_FILE:-${HOME}/.filecap/sites.json}"

ensure_sites_file() {
  local dir
  dir="$(dirname "$SITES_FILE")"
  if [[ ! -d "$dir" ]]; then
    mkdir -p "$dir"
    chmod 700 "$dir" 2>/dev/null || true
  fi
  if [[ ! -f "$SITES_FILE" ]]; then
    echo '{"version": 1, "sites": []}' > "$SITES_FILE"
    chmod 600 "$SITES_FILE" 2>/dev/null || true
  fi
}

list_saved_sites() {
  ensure_sites_file
  python3 - <<'PYLIST' "$SITES_FILE"
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
except (json.JSONDecodeError, FileNotFoundError):
    sys.exit(0)
sites = data.get("sites", [])
if not sites:
    sys.exit(0)
for i, s in enumerate(sites, 1):
    nick = s.get("siteName") or "(no nickname)"
    name = s.get("name") or "(unnamed)"
    user = s.get("user") or "?"
    host = s.get("host") or "?"
    print(f"  {i}. {nick} ({name}) — {user}@{host}")
PYLIST
}

count_saved_sites() {
  ensure_sites_file
  python3 - <<'PYCOUNT' "$SITES_FILE"
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
    print(len(data.get("sites", [])))
except Exception:
    print(0)
PYCOUNT
}

# Load a saved site by 1-based index. Prints shell-eval-able assignments.
# Caller does:  eval "$(load_saved_site 1)"
load_saved_site() {
  local idx="$1"
  ensure_sites_file
  python3 - <<'PYLOAD' "$SITES_FILE" "$idx"
import json, sys, shlex
with open(sys.argv[1]) as f:
    data = json.load(f)
i = int(sys.argv[2]) - 1
sites = data.get("sites", [])
if not (0 <= i < len(sites)):
    sys.exit(1)
s = sites[i]
fields = [
    ("USER_ARG", "user"),
    ("HOST_ARG", "host"),
    ("REMOTE_PATH_ARG", "remotePath"),
    ("SERVER_NAME_ARG", "name"),
    ("SITE_NAME_ARG", "siteName"),
    ("PUBLIC_URL_BASE_ARG", "publicUrlBase"),
    ("AUDIT_LINK_PATTERN_ARG", "auditLinkPattern"),
]
for var, key in fields:
    val = s.get(key) or ""
    print(f"{var}={shlex.quote(val)}")
PYLOAD
}

save_or_update_site() {
  ensure_sites_file
  python3 - <<'PYSAVE' "$SITES_FILE" "$SERVER_NAME" "$SITE_NAME" "$SSH_USER" "$HOST" "$REMOTE_PATH" "$PUBLIC_URL_BASE" "$AUDIT_LINK_PATTERN"
import json, sys
file_path = sys.argv[1]
new_site = {
    "name":             sys.argv[2],
    "siteName":         sys.argv[3],
    "user":             sys.argv[4],
    "host":             sys.argv[5],
    "remotePath":       sys.argv[6],
    "publicUrlBase":    sys.argv[7],
    "auditLinkPattern": sys.argv[8],
}
# Strip empty optional fields for cleanliness
for k in ["siteName", "publicUrlBase", "auditLinkPattern"]:
    if not new_site.get(k):
        new_site.pop(k, None)
with open(file_path) as f:
    data = json.load(f)
sites = data.setdefault("sites", [])
# Update if name matches an existing site, else append
for i, s in enumerate(sites):
    if s.get("name") == new_site["name"]:
        sites[i] = new_site
        break
else:
    sites.append(new_site)
with open(file_path, "w") as f:
    json.dump(data, f, indent=2)
print(f"Saved to {file_path}")
PYSAVE
}

delete_saved_site() {
  local idx="$1"
  ensure_sites_file
  python3 - <<'PYDEL' "$SITES_FILE" "$idx"
import json, sys
file_path = sys.argv[1]
i = int(sys.argv[2]) - 1
with open(file_path) as f:
    data = json.load(f)
sites = data.setdefault("sites", [])
if not (0 <= i < len(sites)):
    sys.exit(1)
removed = sites.pop(i)
with open(file_path, "w") as f:
    json.dump(data, f, indent=2)
nick = removed.get("siteName") or removed.get("name", "?")
print(f"Removed site: {nick}")
PYDEL
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

# Default: don't auto-save the run's config
SAVE_AFTER_RUN="${SAVE_AFTER_RUN:-no}"

# ── saved-sites menu ─────────────────────────────────────────────────────────
# Skip the menu when invoked with positional args (auditor knows what they want)
# OR when SKIP_SITES_MENU=1 (e.g., from audit-fleet.sh).
SHOULD_SHOW_MENU=1
if [[ -n "${1:-}" ]] || [[ "${SKIP_SITES_MENU:-0}" == "1" ]]; then
  SHOULD_SHOW_MENU=0
fi

if [[ "$SHOULD_SHOW_MENU" == "1" ]]; then
  ensure_sites_file
  while :; do
    saved_count=$(count_saved_sites)
    echo
    if [[ "$saved_count" -gt 0 ]]; then
      echo "Saved sites:"
      list_saved_sites
      echo
      echo "  Type a number 1-${saved_count} to select a saved site"
    fi
    echo "    a  →  add a new site"
    if [[ "$saved_count" -gt 0 ]]; then
      echo "    e  →  edit a saved site"
      echo "    d  →  delete a saved site"
    fi
    echo "    s  →  skip (one-off prompts, don't save)"
    echo "    q  →  quit"
    read -r -p "  Select: " menu_choice
    case "$menu_choice" in
      [0-9]*)
        if [[ "$menu_choice" -lt 1 || "$menu_choice" -gt "$saved_count" ]]; then
          warn "Invalid number. Pick 1-${saved_count}."
          continue
        fi
        if loaded=$(load_saved_site "$menu_choice"); then
          eval "$loaded"
          info "Loaded site: $(list_saved_sites | sed -n "${menu_choice}p" | sed 's/^[ ]*[0-9]*\. //')"
          break
        else
          warn "Failed to load site $menu_choice."
          continue
        fi
        ;;
      a|A)
        info "Adding a new site — answer the prompts; you'll be asked to save at the end."
        SAVE_AFTER_RUN=ask
        break
        ;;
      e|E)
        if [[ "$saved_count" -eq 0 ]]; then
          warn "No saved sites to edit."
          continue
        fi
        read -r -p "  Edit which site number? " edit_idx
        if [[ "$edit_idx" -lt 1 || "$edit_idx" -gt "$saved_count" ]]; then
          warn "Invalid number."
          continue
        fi
        if loaded=$(load_saved_site "$edit_idx"); then
          eval "$loaded"
          info "Loaded site for editing — current values shown as defaults; press Enter to keep."
          SAVE_AFTER_RUN=force
          break
        fi
        ;;
      d|D)
        if [[ "$saved_count" -eq 0 ]]; then
          warn "No saved sites to delete."
          continue
        fi
        read -r -p "  Delete which site number? " del_idx
        if [[ "$del_idx" -lt 1 || "$del_idx" -gt "$saved_count" ]]; then
          warn "Invalid number."
          continue
        fi
        read -r -p "  Are you sure? [y/N]: " confirm
        if [[ "$confirm" =~ ^[Yy]$ ]]; then
          delete_saved_site "$del_idx"
        fi
        # Loop again — show the updated menu
        ;;
      s|S)
        info "Skipping saved-sites menu — running with one-off prompts."
        break
        ;;
      q|Q)
        die "Aborted by user."
        ;;
      *)
        warn "Unrecognized: '${menu_choice}'."
        ;;
    esac
  done
fi

# ── parse / prompt for arguments ─────────────────────────────────────────────
USER_ARG="${1:-}"
HOST_ARG="${2:-}"
REMOTE_PATH_ARG="${3:-}"
SERVER_NAME_ARG="${4:-}"
SITE_NAME_ARG="${5:-${SITE_NAME_ARG:-}}"
PUBLIC_URL_BASE_ARG="${6:-${PUBLIC_URL_BASE_ARG:-}}"
AUDIT_LINK_PATTERN_ARG="${7:-${AUDIT_LINK_PATTERN_ARG:-}}"

DEFAULT_SSH_USER="${FILECAP_DEFAULT_SSH_USER:-forge}"
if [[ -z "$USER_ARG" ]]; then
  read -r -p "SSH username on the target server [${DEFAULT_SSH_USER}]: " USER_ARG
  USER_ARG="${USER_ARG:-$DEFAULT_SSH_USER}"
fi
while [[ -z "$HOST_ARG" ]]; do
  read -r -p "Server IP or hostname (e.g. 192.241.146.85): " HOST_ARG
  if [[ -z "$HOST_ARG" ]]; then
    echo "  (required — please type a value)" >&2
  fi
done
while [[ -z "$REMOTE_PATH_ARG" ]]; do
  read -r -p "Full path to uploads directory on the remote (e.g. ~/uploads): " REMOTE_PATH_ARG
  if [[ -z "$REMOTE_PATH_ARG" ]]; then
    echo "  (required — please type a value)" >&2
  fi
done
if [[ -z "$SERVER_NAME_ARG" ]]; then
  # Default: strapi-<ip-with-dashes>
  DEFAULT_NAME="strapi-${HOST_ARG//./-}"
  read -r -p "Friendly server name [${DEFAULT_NAME}]: " SERVER_NAME_ARG
  SERVER_NAME_ARG="${SERVER_NAME_ARG:-$DEFAULT_NAME}"
fi

# Optional: human-friendly website nickname (DVFR, i2i, vpp, infonet, etc.)
# SITE_NAME_ARG may be pre-set by audit-fleet.sh via env var to avoid re-prompting.
if [[ -z "$SITE_NAME_ARG" ]]; then
  read -r -p "Website nickname (e.g. DVFR, i2i, vpp; press Enter to skip): " SITE_NAME_ARG
fi
SITE_NAME="$SITE_NAME_ARG"

# Optional: public URL base — where files are publicly served (enables clickable links in report)
# PUBLIC_URL_BASE_ARG may be pre-set by audit-fleet.sh via env var.
if [[ -z "$PUBLIC_URL_BASE_ARG" ]]; then
  read -r -p "Public URL prefix (optional, e.g. https://dvfr.icjia-api.cloud/uploads; press Enter to skip): " PUBLIC_URL_BASE_ARG
fi
PUBLIC_URL_BASE="$PUBLIC_URL_BASE_ARG"

# Optional: URL template for an external audit service
# AUDIT_LINK_PATTERN_ARG may be pre-set by audit-fleet.sh via env var.
if [[ -z "$AUDIT_LINK_PATTERN_ARG" ]]; then
  echo
  echo "Optional: a URL template for an external audit service (audit.icjia.app, etc.)"
  echo "Placeholders: {publicUrl} {sha256} {filename} {path} {serverIp} {siteName}"
  echo "Example: https://audit.icjia.app/?prefill={publicUrl}"
  read -r -p "Audit link template (press Enter to skip): " AUDIT_LINK_PATTERN_ARG
fi
AUDIT_LINK_PATTERN="$AUDIT_LINK_PATTERN_ARG"

SSH_USER="$USER_ARG"
HOST="$HOST_ARG"
REMOTE_PATH="$REMOTE_PATH_ARG"
SERVER_NAME="$SERVER_NAME_ARG"

# ── HTML report flag ──────────────────────────────────────────────────────────
# Always generate the HTML report — no prompt. The CSV is always produced;
# the HTML is the manager-facing version of the same data. Set AUDIT_HTML=0
# explicitly to opt out (rare).
if [[ "${AUDIT_HTML:-1}" == "0" ]]; then
  HTML_FLAG=""
else
  HTML_FLAG="--html"
fi

# ── audit-enrich prompt (asked early so it's part of the config review) ──────
RUN_AUDIT_ENRICH="${RUN_AUDIT_ENRICH:-}"
if [[ -z "$RUN_AUDIT_ENRICH" ]]; then
  echo
  read -r -p "Enrich inventory with audit.icjia.app scores after the scan? [y/N]: " RUN_AUDIT_ENRICH
fi

# ── config review — loop until user confirms or aborts ──────────────────────
while :; do
  # Enforce required: HOST must not be empty
  while [[ -z "$HOST" ]]; do
    warn "Server IP/hostname is required."
    read -r -p "  Server IP or hostname: " HOST
  done

  echo
  echo "══════════════════════════════════════════════════════════════════════════"
  echo "  AUDIT CONFIGURATION — please review"
  echo "══════════════════════════════════════════════════════════════════════════"
  echo
  printf "  1. %-22s %s\n" "SSH user:"             "$SSH_USER"
  printf "  2. %-22s %s\n" "Server IP/hostname:"   "$HOST"
  printf "  3. %-22s %s\n" "Remote path:"          "$REMOTE_PATH"
  printf "  4. %-22s %s\n" "Friendly server name:" "$SERVER_NAME"
  printf "  5. %-22s %s\n" "Website nickname:"     "${SITE_NAME:-(none)}"
  printf "  6. %-22s %s\n" "Public URL prefix:"    "${PUBLIC_URL_BASE:-(none)}"
  printf "  7. %-22s %s\n" "Audit link template:"  "${AUDIT_LINK_PATTERN:-(none)}"
  if [[ -n "$HTML_FLAG" ]]; then
    printf "  8. %-22s %s\n" "HTML report:"        "Yes (always)"
  else
    printf "  8. %-22s %s\n" "HTML report:"        "No (AUDIT_HTML=0)"
  fi
  if [[ "$RUN_AUDIT_ENRICH" =~ ^[Yy]$ ]]; then
    printf "  9. %-22s %s\n" "Enrich audit scores:" "Yes (will call audit.icjia.app — adds ~15-30 min)"
  else
    printf "  9. %-22s %s\n" "Enrich audit scores:" "No"
  fi
  echo
  printf "     %-22s %s\n" "Output destination:"   "${HOME}/filecap-audits/${HOST}/runs/<this run>/"
  echo
  echo "══════════════════════════════════════════════════════════════════════════"
  echo "  Press Enter (or y) to proceed."
  echo "  Type a number 1-9 to edit that value."
  echo "  Type q to abort."
  read -r -p "  Choice: " CONFIRM_CONFIG
  case "$CONFIRM_CONFIG" in
    ""|y|Y|yes|YES) break ;;
    q|Q|quit|QUIT|abort|ABORT) die "Aborted." ;;
    1)
      read -r -p "  SSH user [${SSH_USER}]: " _new
      SSH_USER="${_new:-$SSH_USER}"
      ;;
    2)
      _new=""
      while [[ -z "$_new" ]]; do
        read -r -p "  Server IP or hostname: " _new
        [[ -z "$_new" ]] && echo "  (required — please type a value)" >&2
      done
      HOST="$_new"
      ;;
    3)
      _new=""
      while [[ -z "$_new" ]]; do
        read -r -p "  Remote path on server: " _new
        [[ -z "$_new" ]] && echo "  (required — please type a value)" >&2
      done
      REMOTE_PATH="$_new"
      ;;
    4)
      read -r -p "  Friendly server name [${SERVER_NAME}]: " _new
      SERVER_NAME="${_new:-$SERVER_NAME}"
      ;;
    5)
      read -r -p "  Website nickname (Enter to clear) [${SITE_NAME}]: " _new
      SITE_NAME="$_new"
      ;;
    6)
      read -r -p "  Public URL prefix (e.g. https://example.com/uploads, Enter to clear) [${PUBLIC_URL_BASE}]: " _new
      PUBLIC_URL_BASE="$_new"
      ;;
    7)
      echo "  Placeholders: {publicUrl} {sha256} {filename} {path} {serverIp} {siteName}"
      read -r -p "  Audit link template (Enter to clear) [${AUDIT_LINK_PATTERN}]: " _new
      AUDIT_LINK_PATTERN="$_new"
      ;;
    8)
      if [[ -n "$HTML_FLAG" ]]; then
        HTML_FLAG=""
        info "HTML report disabled."
      else
        HTML_FLAG="--html"
        info "HTML report enabled."
      fi
      ;;
    9)
      read -r -p "  Enrich audit scores after scan? [y/N]: " _new
      RUN_AUDIT_ENRICH="$_new"
      ;;
    *)
      warn "Unrecognized: '${CONFIRM_CONFIG}'. Type 1-9, Enter, or q."
      ;;
  esac
done

# ── optionally save site config for next time ────────────────────────────────
if [[ "$SAVE_AFTER_RUN" == "ask" ]]; then
  echo
  read -r -p "Save these settings as a named site for next time? [y/N]: " ans
  if [[ "$ans" =~ ^[Yy]$ ]]; then
    if save_or_update_site; then
      info "Site '${SERVER_NAME}' saved to ${SITES_FILE}"
    fi
  fi
elif [[ "$SAVE_AFTER_RUN" == "force" ]]; then
  if save_or_update_site; then
    info "Site '${SERVER_NAME}' updated in ${SITES_FILE}"
  fi
fi

# ── work directory ────────────────────────────────────────────────────────────
WORK_DIR="${HOME}/filecap-audits/${HOST}"
MIRROR_DIR="${WORK_DIR}/mirror"

RUN_TS=$(date -u +"%Y%m%d-%H%M%SZ")
THIS_RUN_DIR="${WORK_DIR}/runs/${RUN_TS}"
LATEST_LINK="${WORK_DIR}/latest"
REPORT_DIR="${THIS_RUN_DIR}/report"

step "Setting up work directory: ${WORK_DIR}"
mkdir -p "${MIRROR_DIR}" "${THIS_RUN_DIR}/report"

# ── write SOURCE_INFO.txt ─────────────────────────────────────────────────────
AUDIT_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
{
  printf "filecap audit — source server info\n"
  printf "===================================\n"
  printf "\n"
  printf "Audit run timestamp: %s\n" "${RUN_TS}"
  [[ -n "$SITE_NAME" ]] && printf "Website      : %s\n" "${SITE_NAME}"
  printf "Server name  : %s\n" "${SERVER_NAME}"
  printf "Server IP    : %s\n" "${HOST}"
  printf "SSH user     : %s\n" "${SSH_USER}"
  printf "Remote path  : %s\n" "${REMOTE_PATH}"
  [[ -n "$PUBLIC_URL_BASE" ]] && printf "Public URL base: %s\n" "${PUBLIC_URL_BASE}"
  [[ -n "$AUDIT_LINK_PATTERN" ]] && printf "Audit link template: %s\n" "${AUDIT_LINK_PATTERN}"
  printf "Audit started: %s\n" "${AUDIT_TS}"
  printf "\n"
  printf "To locate a file on the remote:\n"
  printf "  ssh %s@%s\n" "${SSH_USER}" "${HOST}"
  printf "  cd %s\n" "${REMOTE_PATH}"
} > "${THIS_RUN_DIR}/SOURCE_INFO.txt"
info "Wrote ${THIS_RUN_DIR}/SOURCE_INFO.txt"

# ── SSH sanity check ──────────────────────────────────────────────────────────
step "Verifying SSH connectivity to ${SSH_USER}@${HOST} ..."
if ! ssh -o ConnectTimeout=10 -o BatchMode=yes "${SSH_USER}@${HOST}" true 2>/dev/null; then
  die "Cannot SSH to ${SSH_USER}@${HOST}. Check your SSH config / keys and retry."
fi
info "SSH OK"

# ── verify remote path ────────────────────────────────────────────────────────
# NOTE: REMOTE_PATH must not contain spaces or shell metacharacters.
# We intentionally omit inner single-quotes around ${REMOTE_PATH} so the remote
# shell can expand tilde paths (e.g. ~/uploads). Paths with spaces should be
# given as absolute paths instead.
step "Verifying remote path exists: ${REMOTE_PATH}"
if ! ssh -o ConnectTimeout=10 "${SSH_USER}@${HOST}" "test -d ${REMOTE_PATH}" 2>/dev/null; then
  die "Remote path '${REMOTE_PATH}' does not exist or is not a directory on ${HOST}."
fi
if ! ssh -o ConnectTimeout=10 "${SSH_USER}@${HOST}" "test -r ${REMOTE_PATH}" 2>/dev/null; then
  die "Remote path '${REMOTE_PATH}' exists but is not readable by user '${SSH_USER}'."
fi
info "Remote path confirmed and readable"

# ── preflight: verify public URL is reachable (non-blocking — auditor can override) ──
if [[ -n "$PUBLIC_URL_BASE" ]]; then
  step "Verifying public URL is reachable: ${PUBLIC_URL_BASE}"
  if curl -fsSL --head --connect-timeout 5 --max-time 10 "$PUBLIC_URL_BASE" >/dev/null 2>&1; then
    info "Public URL responded successfully"
  else
    warn "Public URL did not respond (HEAD ${PUBLIC_URL_BASE})."
    warn "This may be due to a typo, network restrictions, or the site being temporarily down."
    read -r -p "Continue anyway? [y/N]: " ans
    [[ "$ans" =~ ^[Yy]$ ]] || die "Aborted by user."
  fi
fi

# ── remote size / file count ──────────────────────────────────────────────────
step "Checking remote upload size ..."
REMOTE_SIZE=$(ssh -o ConnectTimeout=10 "${SSH_USER}@${HOST}" \
  "LC_ALL=C du -sh ${REMOTE_PATH} 2>/dev/null | tr -s ' \t' ' ' | cut -d' ' -f1" 2>/dev/null || echo "unknown")
REMOTE_COUNT=$(ssh -o ConnectTimeout=10 "${SSH_USER}@${HOST}" \
  "LC_ALL=C find ${REMOTE_PATH} -type f 2>/dev/null | wc -l | tr -d ' \t'" 2>/dev/null || echo "?")
info "Remote: ${REMOTE_COUNT} files, ${REMOTE_SIZE} total on disk"

# ── local disk-space check ────────────────────────────────────────────────────
if [[ "$REMOTE_SIZE" != "unknown" ]]; then
  REMOTE_BYTES=$(size_to_bytes "$REMOTE_SIZE")
  FREE_BYTES=$(df -Pk "${HOME}" | awk 'NR==2 { print $4 * 1024 }')
  if [[ "$REMOTE_BYTES" -gt "$FREE_BYTES" ]]; then
    die "Remote source size ($REMOTE_SIZE) exceeds local free disk. Aborting."
  fi
  if [[ "$REMOTE_BYTES" -gt $((FREE_BYTES * 9 / 10)) ]]; then
    warn "Remote source size ($REMOTE_SIZE) is more than 90% of local free disk."
    read -r -p "Proceed anyway? [y/N]: " ans
    [[ "$ans" =~ ^[Yy]$ ]] || die "Aborted by user."
  fi
fi

# ── detect remote Node version ────────────────────────────────────────────────
step "Detecting Node.js version on remote ..."
REMOTE_NODE=$(ssh -o ConnectTimeout=10 "${SSH_USER}@${HOST}" \
  'LC_ALL=C node --version 2>/dev/null || echo "v0"' 2>/dev/null | tr -d '[:space:]')
# Parse major version (e.g. "v16.20.0" → 16, "v0" → 0)
REMOTE_NODE_MAJOR=$(echo "${REMOTE_NODE}" | sed 's/[^0-9]/ /g' | awk '{print $1+0}')
info "Remote Node: ${REMOTE_NODE} (major=${REMOTE_NODE_MAJOR})"

# ── scan ──────────────────────────────────────────────────────────────────────
INVENTORY="${THIS_RUN_DIR}/inventory.ndjson"

if [[ "$REMOTE_NODE_MAJOR" -ge 20 ]]; then
  # ─ native mode: filecap runs on the remote, NDJSON streams back ─────────────
  step "Mode: NATIVE (remote Node ${REMOTE_NODE} >= 20 — scan runs on the server)"
  info "Running: ssh ${SSH_USER}@${HOST} npx @icjia/filecap@latest scan '${REMOTE_PATH}' ..."

  NATIVE_SITE_ARGS=""
  [[ -n "$SITE_NAME" ]] && NATIVE_SITE_ARGS="--site-name '${SITE_NAME}'"
  NATIVE_PUBURL_ARGS=""
  [[ -n "$PUBLIC_URL_BASE" ]] && NATIVE_PUBURL_ARGS="--public-url-base '${PUBLIC_URL_BASE}'"
  NATIVE_AUDITLINK_ARGS=""
  [[ -n "$AUDIT_LINK_PATTERN" ]] && NATIVE_AUDITLINK_ARGS="--audit-link-pattern '${AUDIT_LINK_PATTERN}'"

  # shellcheck disable=SC2029
  if ! ssh -o ConnectTimeout=30 "${SSH_USER}@${HOST}" \
      "npx --yes @icjia/filecap@latest scan '${REMOTE_PATH}' \
        --server-name '${SERVER_NAME}' \
        --server-ip '${HOST}' \
        ${NATIVE_SITE_ARGS} \
        ${NATIVE_PUBURL_ARGS} \
        ${NATIVE_AUDITLINK_ARGS} \
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
  # Build scan args array; include optional flags only when non-empty
  SCAN_ARGS=( "${MIRROR_DIR}" --server-name "${SERVER_NAME}" --server-ip "${HOST}" -o "${INVENTORY}" )
  [[ -n "$SITE_NAME" ]] && SCAN_ARGS+=( --site-name "${SITE_NAME}" )
  [[ -n "$PUBLIC_URL_BASE" ]] && SCAN_ARGS+=( --public-url-base "${PUBLIC_URL_BASE}" )
  [[ -n "$AUDIT_LINK_PATTERN" ]] && SCAN_ARGS+=( --audit-link-pattern "$AUDIT_LINK_PATTERN" )

  if ! npx --yes @icjia/filecap@latest scan "${SCAN_ARGS[@]}" \
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

# ── optional: enrich with audit scores from audit.icjia.app ─────────────────
RUN_AUDIT_ENRICH="${RUN_AUDIT_ENRICH:-}"
if [[ -z "$RUN_AUDIT_ENRICH" ]]; then
  echo
  read -r -p "Enrich inventory with audit.icjia.app scores? [y/N]: " RUN_AUDIT_ENRICH
fi

if [[ "$RUN_AUDIT_ENRICH" =~ ^[Yy]$ ]]; then
  if [[ -z "${FILECAP_AUDIT_TOKEN:-}" ]]; then
    warn "FILECAP_AUDIT_TOKEN not set in env. Set it via: export FILECAP_AUDIT_TOKEN=fap_xxx"
    read -r -s -p "Paste audit token (input hidden, used for this run only): " FILECAP_AUDIT_TOKEN
    echo  # newline after silent read
    export FILECAP_AUDIT_TOKEN
  fi

  step "Calling audit.icjia.app /api/bulk-from-inventory ..."
  if npx --yes @icjia/filecap@latest audit-enrich "${INVENTORY}" -o "${INVENTORY}" \
      2> >(grep -v 'Warning:' >&2); then
    info "Audit scores merged into inventory"

    step "Regenerating report with audit columns ..."
    npx --yes @icjia/filecap@latest report "${INVENTORY}" -o "${REPORT_DIR}/" ${HTML_FLAG} \
        2> >(grep -v 'Warning:' >&2) || warn "Report regeneration failed (continuing)"
  else
    warn "audit-enrich failed (continuing without audit scores)"
  fi
fi

# ── update 'latest' symlink ───────────────────────────────────────────────────
# Use rm-then-ln inside a subshell to avoid macOS mv-symlink quirks.
# The subshell cd ensures the relative target "runs/${RUN_TS}" resolves correctly
# regardless of the caller's cwd.
if [[ -L "${LATEST_LINK}" || -e "${LATEST_LINK}" ]]; then
  rm -f "${LATEST_LINK}"
fi
if (cd "${WORK_DIR}" && ln -s "runs/${RUN_TS}" "latest"); then
  info "Updated 'latest' symlink → runs/${RUN_TS}"
else
  warn "Failed to update 'latest' symlink (run output is at runs/${RUN_TS} regardless)"
fi

# ── summary ───────────────────────────────────────────────────────────────────
printf "\n${G}Audit complete${N} — ${SERVER_NAME} (${HOST})\n\n"

if [[ -f "${REPORT_DIR}/audit-summary.txt" ]]; then
  cat "${REPORT_DIR}/audit-summary.txt"
fi

printf "\n${G}Files generated:${N}\n"
printf "  Source info : %s\n" "${THIS_RUN_DIR}/SOURCE_INFO.txt"
printf "  Inventory   : %s\n" "${INVENTORY}"
printf "  CSV report  : %s\n" "${REPORT_DIR}/audit-file-list.csv"
if [[ -n "$HTML_FLAG" ]]; then
  printf "  HTML report : %s\n" "${REPORT_DIR}/audit-file-list.html"
fi
printf "  Full report : %s\n" "${REPORT_DIR}/"

printf "\n${Y}Hint:${N} open the CSV report at:\n"
printf "  %s\n" "${WORK_DIR}/latest/report/audit-file-list.csv"
xopen "${REPORT_DIR}/audit-file-list.csv"
if [[ -n "$HTML_FLAG" ]]; then
  printf "\n${Y}Hint:${N} open the HTML report at:\n"
  printf "  %s\n" "${WORK_DIR}/latest/report/audit-file-list.html"
  xopen "${REPORT_DIR}/audit-file-list.html"
fi

echo
info "Past runs for this server:"
ls -1t "${WORK_DIR}/runs" 2>/dev/null | head -5 | sed 's/^/  /'
