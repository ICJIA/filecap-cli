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
#    The saved-sites menu now also offers option w → build web rollup, which
#    bundles the most recent scans of every saved site into a static-site
#    directory ready to drag-and-drop to Netlify for manager-facing sharing.
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
#
#  WHERE OUTPUT GOES
#    ~/filecap-audits/<server-name>/    (e.g., dvfr-strapi-prod, not 192.241.146.85)
#      ├── mirror/                       shared local rsync copy (incremental)
#      ├── runs/
#      │   ├── 20260509-143000Z/         each run gets its own timestamped dir (UTC)
#      │   │   ├── SOURCE_INFO.txt
#      │   │   ├── inventory.ndjson
#      │   │   └── report/
#      │   │       ├── audit-file-list.csv
#      │   │       ├── audit-file-list.html
#      │   │       └── ...
#      │   └── 20260516-093000Z/
#      └── latest -> runs/<most-recent-ts>
#
#    Multiple sites on the same physical server (shared IP) each get their
#    own directory — keyed by the friendly server name, not the IP.
#
#    Re-running the script against the same server preserves history — each
#    run lands in its own timestamped subdirectory. The 'latest' symlink always
#    points to the most recent successful run for convenient access.
#
#  USAGE
#    ./audit-remote.sh                                                              # interactive
#    ./audit-remote.sh USER HOST REMOTE_PATH [SERVER_NAME] [SITE_NAME] [PUBLIC_URL_BASE]
#    ./audit-remote.sh forge 192.241.146.85 ~/uploads dvfr-strapi-prod DVFR https://dvfr.icjia-api.cloud/uploads
#    ./audit-remote.sh --no-version-check                                           # skip update check
#    SKIP_VERSION_CHECK=1 ./audit-remote.sh                                         # same, via env var
#
#  NOTE: REMOTE_PATH must not contain spaces or shell metacharacters.
#    Tilde paths such as ~/uploads are supported (the remote shell expands them).
#    For paths with spaces, use the absolute path instead.
#
#  SAVED SITES
#    On startup, the script offers a menu of previously-audited sites stored
#    in ~/.filecap/sites.json. Pick a number to skip re-typing the SSH user,
#    server IP, remote path, etc. New sites can be added; existing ones can
#    be edited or deleted via the same menu.
#
# ============================================================================

set -euo pipefail

RUN_START_EPOCH=$(date +%s)

# Format seconds as a human-readable duration: "1s", "45s", "2m 34s", "1h 15m"
fmt_duration() {
  local secs=$1
  if [[ "$secs" -lt 1 ]]; then
    echo "<1s"
  elif [[ "$secs" -lt 60 ]]; then
    echo "${secs}s"
  elif [[ "$secs" -lt 3600 ]]; then
    local m=$((secs / 60))
    local s=$((secs % 60))
    echo "${m}m ${s}s"
  else
    local h=$((secs / 3600))
    local m=$(((secs % 3600) / 60))
    echo "${h}h ${m}m"
  fi
}

# Convert raw bytes to human-readable string (no external tools required)
human_bytes() {
  local b=$1
  if [[ -z "$b" || "$b" == "?" ]]; then echo "?"; return; fi
  awk -v b="$b" 'BEGIN {
    if (b < 1024) printf "%d B", b
    else if (b < 1024*1024) printf "%.1f KB", b/1024
    else if (b < 1024*1024*1024) printf "%.1f MB", b/1024/1024
    else printf "%.2f GB", b/1024/1024/1024
  }'
}

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
]
for var, key in fields:
    val = s.get(key) or ""
    print(f"{var}={shlex.quote(val)}")
PYLOAD
}

save_or_update_site() {
  ensure_sites_file
  python3 - <<'PYSAVE' "$SITES_FILE" "$SERVER_NAME" "$SITE_NAME" "$SSH_USER" "$HOST" "$REMOTE_PATH" "$PUBLIC_URL_BASE"
import json, sys
file_path = sys.argv[1]
new_site = {
    "name":          sys.argv[2],
    "siteName":      sys.argv[3],
    "user":          sys.argv[4],
    "host":          sys.argv[5],
    "remotePath":    sys.argv[6],
    "publicUrlBase": sys.argv[7],
}
# Strip empty optional fields for cleanliness
for k in ["siteName", "publicUrlBase"]:
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

# Export saved sites to an external JSON file (no credentials are stored).
# Useful for handing a pre-configured fleet to other auditors who already have
# their own SSH access.
export_sites_to_file() {
  local out_path="$1"
  ensure_sites_file
  python3 - <<'PYEXPORT' "$SITES_FILE" "$out_path"
import json, sys, os
src, dst = sys.argv[1], sys.argv[2]
with open(src) as f:
    data = json.load(f)
sites = data.get("sites", [])
# Strip empty optional fields and any unexpected fields (e.g., never a token)
allowed = {"name", "siteName", "user", "host", "remotePath", "publicUrlBase"}
clean = []
for s in sites:
    c = {k: v for k, v in s.items() if k in allowed and v}
    if c.get("name"):
        clean.append(c)
out = {"version": 1, "sites": clean}
dst = os.path.expanduser(dst)
with open(dst, "w") as f:
    json.dump(out, f, indent=2)
print(f"Wrote {len(clean)} site(s) to {dst}")
PYEXPORT
}

# Import sites from an external JSON file. Caller chooses merge or replace.
# mode = "merge"    → add new sites by name, skip names that already exist
# mode = "replace"  → wipe current sites and use only the imported ones
import_sites_from_file() {
  local in_path="$1"
  local mode="$2"
  ensure_sites_file
  python3 - <<'PYIMPORT' "$SITES_FILE" "$in_path" "$mode"
import json, sys, os
dst, src, mode = sys.argv[1], sys.argv[2], sys.argv[3]
src = os.path.expanduser(src)
if not os.path.isfile(src):
    print(f"ERROR: file not found: {src}", file=sys.stderr); sys.exit(1)
try:
    with open(src) as f:
        incoming = json.load(f)
except json.JSONDecodeError as e:
    print(f"ERROR: not a valid JSON file: {e}", file=sys.stderr); sys.exit(2)
if not isinstance(incoming, dict) or "sites" not in incoming:
    print("ERROR: file does not look like a sites.json (no 'sites' key)", file=sys.stderr); sys.exit(2)
new_sites = incoming.get("sites", [])
if not isinstance(new_sites, list):
    print("ERROR: 'sites' is not a list", file=sys.stderr); sys.exit(2)
allowed = {"name", "siteName", "user", "host", "remotePath", "publicUrlBase"}
cleaned = []
for s in new_sites:
    if not isinstance(s, dict): continue
    c = {k: v for k, v in s.items() if k in allowed and v}
    if c.get("name"):
        cleaned.append(c)
with open(dst) as f:
    current = json.load(f)
existing = current.get("sites", [])
if mode == "replace":
    final = cleaned
    added = len(cleaned)
    skipped = 0
else:
    existing_names = {s.get("name") for s in existing}
    added_list = [s for s in cleaned if s.get("name") not in existing_names]
    skipped = len(cleaned) - len(added_list)
    final = existing + added_list
    added = len(added_list)
current["sites"] = final
current["version"] = 1
with open(dst, "w") as f:
    json.dump(current, f, indent=2)
print(f"Imported {added} site(s) ({skipped} skipped because the name already existed) into {dst}")
PYIMPORT
}

# Preview an import file without modifying anything. Prints the sites that
# would be imported so the auditor can confirm before committing.
preview_import_file() {
  local in_path="$1"
  python3 - <<'PYPREVIEW' "$in_path"
import json, sys, os
src = os.path.expanduser(sys.argv[1])
if not os.path.isfile(src):
    print(f"ERROR: file not found: {src}", file=sys.stderr); sys.exit(1)
try:
    with open(src) as f:
        data = json.load(f)
except json.JSONDecodeError as e:
    print(f"ERROR: not a valid JSON file: {e}", file=sys.stderr); sys.exit(2)
sites = data.get("sites") if isinstance(data, dict) else None
if not isinstance(sites, list):
    print("ERROR: file does not contain a 'sites' array", file=sys.stderr); sys.exit(2)
print(f"Found {len(sites)} site(s) in {src}:")
for i, s in enumerate(sites, 1):
    if not isinstance(s, dict): continue
    nick = s.get("siteName") or "(no nickname)"
    name = s.get("name") or "(unnamed)"
    user = s.get("user") or "?"
    host = s.get("host") or "?"
    print(f"  {i}. {nick} ({name}) — {user}@{host}")
PYPREVIEW
}

# Preflight every saved site. Verifies SSH connectivity, remote path existence
# and readability, and counts files. Prints a status table; does not modify
# any state. Useful for catching issues before running a full audit.
preflight_all_sites() {
  ensure_sites_file

  local sites_tsv
  sites_tsv=$(python3 - <<'PYTSV' "$SITES_FILE"
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
for s in data.get("sites", []):
    print("\t".join([
        s.get("siteName") or "(no nickname)",
        s.get("name") or "?",
        s.get("user") or "?",
        s.get("host") or "?",
        s.get("remotePath") or "",
    ]))
PYTSV
)

  if [[ -z "$sites_tsv" ]]; then
    warn "No saved sites to preflight."
    return 0
  fi

  echo
  step "Preflight check on every saved site (a few seconds per site) ..."
  echo

  printf "  %-18s %-22s %-18s %-8s %-8s %-8s %s\n" \
    "Nickname" "Server name" "Host" "SSH" "Path" "Files" "Notes"
  printf "  %-18s %-22s %-18s %-8s %-8s %-8s %s\n" \
    "------------------" "----------------------" "------------------" "--------" "--------" "--------" "----------------"

  local fail_count=0
  local warn_count=0
  local total_count=0

  while IFS=$'\t' read -r nick name user host rpath; do
    [[ -z "$nick" && -z "$name" ]] && continue
    total_count=$((total_count + 1))

    if [[ -z "$host" || "$host" == "?" || -z "$rpath" ]]; then
      printf "  %-18s %-22s %-18s ${R}%-8s${N} %-8s %-8s %s\n" \
        "$nick" "$name" "${host:-?}" "MISSING" "-" "-" "missing host or path"
      fail_count=$((fail_count + 1))
      continue
    fi

    # SSH connectivity check
    if ! ssh -o ConnectTimeout=10 -o BatchMode=yes "${user}@${host}" true 2>/dev/null; then
      printf "  %-18s %-22s %-18s ${R}%-8s${N} %-8s %-8s %s\n" \
        "$nick" "$name" "$host" "FAIL" "-" "-" "SSH connect failed"
      fail_count=$((fail_count + 1))
      continue
    fi

    # Remote path existence + readability
    local qrpath
    qrpath=$(printf '%q' "${rpath}")
    if ! ssh -o ConnectTimeout=10 "${user}@${host}" "test -d ${qrpath} && test -r ${qrpath}" 2>/dev/null; then
      printf "  %-18s %-22s %-18s ${G}%-8s${N} ${R}%-8s${N} %-8s %s\n" \
        "$nick" "$name" "$host" "OK" "FAIL" "-" "path missing or unreadable"
      fail_count=$((fail_count + 1))
      continue
    fi

    # File count (find -type f)
    local file_count
    file_count=$(ssh -o ConnectTimeout=10 "${user}@${host}" "find ${qrpath} -type f 2>/dev/null | wc -l" 2>/dev/null | tr -d '[:space:]')
    if [[ -z "$file_count" || ! "$file_count" =~ ^[0-9]+$ ]]; then
      printf "  %-18s %-22s %-18s ${G}%-8s${N} ${G}%-8s${N} ${Y}%-8s${N} %s\n" \
        "$nick" "$name" "$host" "OK" "OK" "?" "couldn't count files"
      warn_count=$((warn_count + 1))
    elif [[ "$file_count" -eq 0 ]]; then
      printf "  %-18s %-22s %-18s ${G}%-8s${N} ${G}%-8s${N} ${Y}%-8s${N} %s\n" \
        "$nick" "$name" "$host" "OK" "OK" "0" "directory is empty"
      warn_count=$((warn_count + 1))
    else
      printf "  %-18s %-22s %-18s ${G}%-8s${N} ${G}%-8s${N} %-8s %s\n" \
        "$nick" "$name" "$host" "OK" "OK" "$file_count" ""
    fi
  done <<< "$sites_tsv"

  echo
  local ok_count=$((total_count - fail_count - warn_count))
  if [[ "$fail_count" -eq 0 && "$warn_count" -eq 0 ]]; then
    info "All ${total_count} site(s) OK."
  else
    if [[ "$fail_count" -gt 0 ]]; then
      warn "${fail_count} of ${total_count} site(s) FAILED preflight (see above)."
    fi
    if [[ "$warn_count" -gt 0 ]]; then
      warn "${warn_count} of ${total_count} site(s) have warnings (empty dir or count failure)."
    fi
    if [[ "$ok_count" -gt 0 ]]; then
      info "${ok_count} of ${total_count} site(s) passed cleanly."
    fi
  fi
  echo
  read -r -p "  Press Enter to return to the menu..." _
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
      echo "    p  →  preflight all saved sites (verify SSH + path + file count)"
      echo "    x  →  export all sites to a JSON file (no credentials)"
      echo "    w  →  build web rollup from latest scans (publishable static site)"
    fi
    echo "    i  →  import sites from a JSON file"
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
      p|P)
        if [[ "$saved_count" -eq 0 ]]; then
          warn "No saved sites to preflight."
          continue
        fi
        preflight_all_sites
        ;;
      x|X)
        if [[ "$saved_count" -eq 0 ]]; then
          warn "No saved sites to export."
          continue
        fi
        read -r -p "  Export to file path [~/Desktop/icjia-sites.json]: " export_path
        export_path="${export_path:-${HOME}/Desktop/icjia-sites.json}"
        if export_sites_to_file "$export_path"; then
          info "Hand this file to other auditors. It contains hostnames and paths but NO audit token."
        fi
        ;;
      w|W)
        if [[ "$saved_count" -eq 0 ]]; then
          warn "No saved sites to bundle."
          continue
        fi
        echo
        echo "  Password protection mode:"
        echo "    n → none (open access)"
        echo "    c → client-side gate (free; not real security; a SHA-256 prompt embedded in HTML)"
        echo "    s → use Netlify Site Password (recommended; requires paid Netlify; set later in dashboard)"
        read -r -p "  Choice [n]: " GATE_MODE
        GATE_MODE="${GATE_MODE:-n}"

        WEB_PW=""
        case "$GATE_MODE" in
          c|C) read -r -s -p "  Set a password for the client-side gate (input hidden): " WEB_PW; echo ;;
          s|S) info "Bundle will be built without a client-side gate. After deploying, set the password in the Netlify dashboard." ;;
        esac

        WEB_OUT="${HOME}/filecap-audits/_web-rollup/$(date -u +%Y%m%dT%H%M%SZ)"
        step "Building web rollup at ${WEB_OUT} ..."
        ROLLUP_ARGS=( --output "$WEB_OUT" )
        case "$GATE_MODE" in
          c|C) [[ -n "$WEB_PW" ]] && ROLLUP_ARGS+=( --password "$WEB_PW" ) ;;
          s|S) ROLLUP_ARGS+=( --no-client-gate ) ;;
        esac

        echo
        read -r -p "  Auto-deploy to Netlify? [y/N]: " AUTO_DEPLOY
        [[ "$AUTO_DEPLOY" =~ ^[Yy]$ ]] && ROLLUP_ARGS+=( --deploy )

        if npx --yes @icjia/filecap@latest web-rollup "${ROLLUP_ARGS[@]}"; then
          info "Bundle ready. To preview: open ${WEB_OUT}/index.html"
          if ! [[ "$AUTO_DEPLOY" =~ ^[Yy]$ ]]; then
            info "To deploy: drop the directory at https://app.netlify.com/drop"
          fi
          read -r -p "  Open the index now? [y/N]: " open_now
          [[ "$open_now" =~ ^[Yy]$ ]] && xopen "${WEB_OUT}/index.html"
        fi
        ;;
      i|I)
        read -r -p "  Import from file path: " import_path
        if [[ -z "$import_path" ]]; then
          warn "No path given."
          continue
        fi
        if ! preview_import_file "$import_path"; then
          continue
        fi
        echo
        echo "  How to import?"
        echo "    m  →  merge (add new sites by name; skip names that already exist)"
        echo "    r  →  replace (wipe current saved sites; use only the imported ones)"
        echo "    c  →  cancel"
        read -r -p "  Choice [m]: " import_mode
        import_mode="${import_mode:-m}"
        case "$import_mode" in
          m|M|merge)
            import_sites_from_file "$import_path" "merge"
            ;;
          r|R|replace)
            read -r -p "  Wipe current sites and replace with imported? [y/N]: " confirm_replace
            if [[ "$confirm_replace" =~ ^[Yy]$ ]]; then
              import_sites_from_file "$import_path" "replace"
            else
              info "Cancelled."
            fi
            ;;
          c|C|cancel|*)
            info "Cancelled."
            ;;
        esac
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
  if [[ -n "$HTML_FLAG" ]]; then
    printf "  7. %-22s %s\n" "HTML report:"        "Yes (always)"
  else
    printf "  7. %-22s %s\n" "HTML report:"        "No (AUDIT_HTML=0)"
  fi
  echo
  printf "     %-22s %s\n" "Output destination:"   "${HOME}/filecap-audits/${SERVER_NAME}/runs/<this run>/"
  echo
  echo "══════════════════════════════════════════════════════════════════════════"
  echo "  Press Enter (or y) to proceed."
  echo "  Type a number 1-7 to edit that value."
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
      if [[ -n "$HTML_FLAG" ]]; then
        HTML_FLAG=""
        info "HTML report disabled."
      else
        HTML_FLAG="--html"
        info "HTML report enabled."
      fi
      ;;
    *)
      warn "Unrecognized: '${CONFIRM_CONFIG}'. Type 1-7, Enter, or q."
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
# Check for legacy IP-keyed audit directories that suggest the user has
# pre-1.2.2 data. Print a one-line advisory pointing at the new layout.
if [[ -d "${HOME}/filecap-audits/${HOST}" && ! -d "${HOME}/filecap-audits/${SERVER_NAME}" ]]; then
  warn "Legacy audit directory found at ~/filecap-audits/${HOST}/"
  warn "  As of 1.2.2, audit dirs are keyed by server-name. New runs will go to:"
  warn "  ~/filecap-audits/${SERVER_NAME}/"
  warn "  The old directory is harmless but orphaned. To migrate manually:"
  warn "    mv ~/filecap-audits/${HOST} ~/filecap-audits/${SERVER_NAME}"
fi

# Key the work directory by server-name (not host IP) so multiple sites
# on the same physical server (common with Forge / shared-IP setups)
# get their own dedicated audit directory.
WORK_DIR="${HOME}/filecap-audits/${SERVER_NAME}"
MIRROR_DIR="${WORK_DIR}/mirror"

RUN_TS=$(date -u +"%Y%m%d-%H%M%SZ")
THIS_RUN_DIR="${WORK_DIR}/runs/${RUN_TS}"
LATEST_LINK="${WORK_DIR}/latest"
REPORT_DIR="${THIS_RUN_DIR}/report"

step "Setting up work directory: ${WORK_DIR}"
mkdir -p "${MIRROR_DIR}" "${THIS_RUN_DIR}/report"
chmod 700 "${WORK_DIR}" 2>/dev/null || true

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
  printf "Audit started: %s\n" "${AUDIT_TS}"
  printf "\n"
  printf "To locate a file on the remote:\n"
  printf "  ssh %s@%s\n" "${SSH_USER}" "${HOST}"
  printf "  cd %s\n" "${REMOTE_PATH}"
} > "${THIS_RUN_DIR}/SOURCE_INFO.txt"
info "Wrote ${THIS_RUN_DIR}/SOURCE_INFO.txt"

# ── SSH sanity check ──────────────────────────────────────────────────────────
SSH_PHASE_START=$(date +%s)
step "Verifying SSH connectivity to ${SSH_USER}@${HOST} ..."
if ! ssh -o ConnectTimeout=10 -o BatchMode=yes "${SSH_USER}@${HOST}" true 2>/dev/null; then
  echo
  echo -e "${R}ERROR:${N} Cannot SSH to ${SSH_USER}@${HOST}." >&2
  echo >&2
  echo "Most likely cause: your SSH public key isn't on the server yet." >&2
  echo >&2
  echo "To set up access:" >&2
  echo "  1. Generate a key (one-time):  ssh-keygen -t ed25519 -C \"you@example.com\"" >&2
  echo "  2. Copy ~/.ssh/id_ed25519.pub  (the .pub file, not the private key)" >&2
  echo "  3. Email the public key to ICJIA IDS, asking them to add it to" >&2
  echo "     forge@${HOST}:~/.ssh/authorized_keys" >&2
  echo "  4. Re-run this script after IDS confirms" >&2
  echo >&2
  echo "If you already have key-based access, check ssh-agent and try:" >&2
  echo "  ssh ${SSH_USER}@${HOST} \"echo OK\"" >&2
  echo >&2
  echo "See the README's 'Setting up SSH access' section for full setup details:" >&2
  echo "  https://github.com/ICJIA/filecap-cli#setting-up-ssh-access" >&2
  exit 1
fi
SSH_PHASE_DURATION=$(( $(date +%s) - SSH_PHASE_START ))
info "SSH OK"

# ── verify remote path ────────────────────────────────────────────────────────
# NOTE: REMOTE_PATH must not contain spaces or shell metacharacters.
# We intentionally omit inner single-quotes around ${REMOTE_PATH} so the remote
# shell can expand tilde paths (e.g. ~/uploads). Paths with spaces should be
# given as absolute paths instead.
step "Verifying remote path exists: ${REMOTE_PATH}"
QPATH=$(printf '%q' "${REMOTE_PATH}")
if ! ssh -o ConnectTimeout=10 "${SSH_USER}@${HOST}" "test -d ${QPATH}" 2>/dev/null; then
  die "Remote path '${REMOTE_PATH}' does not exist or is not a directory on ${HOST}."
fi
if ! ssh -o ConnectTimeout=10 "${SSH_USER}@${HOST}" "test -r ${QPATH}" 2>/dev/null; then
  die "Remote path '${REMOTE_PATH}' exists but is not readable by user '${SSH_USER}'."
fi
info "Remote path confirmed and readable"

# ── preflight: verify public URL is reachable (non-blocking — auditor can override) ──
# Resolve a bearer token in this priority:
#   1. BEARER_TOKEN env var (already set by audit-fleet.sh, or by the user
#      running audit-remote.sh directly with `BEARER_TOKEN=eyJ... ./audit-remote.sh`)
#   2. FILECAP_BEARER_TOKEN_<SERVER_NAME_UPPER_SNAKE> env var (per-site override)
#   3. ~/.filecap/secrets.json `tokens.<server-name>` field
# The token is fed to curl via stdin (--header @-) so it does not appear in
# argv / `ps aux`.
if [[ -z "${BEARER_TOKEN:-}" ]]; then
  _env_var_name="FILECAP_BEARER_TOKEN_$(echo "$SERVER_NAME" | tr '[:lower:]-' '[:upper:]_')"
  if [[ -n "${!_env_var_name:-}" ]]; then
    BEARER_TOKEN="${!_env_var_name}"
  elif [[ -f "${HOME}/.filecap/secrets.json" ]]; then
    BEARER_TOKEN=$(python3 - "${HOME}/.filecap/secrets.json" "$SERVER_NAME" <<'PYTOK' 2>/dev/null
import json, sys
try:
    with open(sys.argv[1], "r", encoding="utf-8") as fh:
        data = json.load(fh)
    tok = data.get("tokens", {}).get(sys.argv[2], "")
    if isinstance(tok, str):
        sys.stdout.write(tok)
except Exception:
    pass
PYTOK
)
  fi
fi

if [[ -n "$PUBLIC_URL_BASE" ]]; then
  step "Verifying public URL is reachable: ${PUBLIC_URL_BASE}"
  url_ok=1
  if [[ -n "${BEARER_TOKEN:-}" ]]; then
    info "Using bearer token for Authorization header (site requires auth)"
    if printf 'Authorization: Bearer %s\n' "${BEARER_TOKEN}" \
        | curl -fsSL --head --header @- --connect-timeout 5 --max-time 10 "$PUBLIC_URL_BASE" >/dev/null 2>&1; then
      url_ok=0
    fi
  else
    if curl -fsSL --head --connect-timeout 5 --max-time 10 "$PUBLIC_URL_BASE" >/dev/null 2>&1; then
      url_ok=0
    fi
  fi
  if [[ "$url_ok" -eq 0 ]]; then
    info "Public URL responded successfully"
  else
    warn "Public URL did not respond (HEAD ${PUBLIC_URL_BASE})."
    warn "This may be due to a typo, network restrictions, or the site being temporarily down."
    if [[ -z "${BEARER_TOKEN:-}" ]]; then
      warn "If the site requires authentication, set FILECAP_BEARER_TOKEN_${SERVER_NAME//-/_} or add an entry to ~/.filecap/secrets.json."
    fi
    read -r -p "Continue anyway? [y/N]: " ans
    [[ "$ans" =~ ^[Yy]$ ]] || die "Aborted by user."
  fi
fi

# ── remote size / file count ──────────────────────────────────────────────────
step "Checking remote upload size ..."
REMOTE_SIZE=$(ssh -o ConnectTimeout=10 "${SSH_USER}@${HOST}" \
  "LC_ALL=C du -sh ${QPATH} 2>/dev/null | tr -s ' \t' ' ' | cut -d' ' -f1" 2>/dev/null || echo "unknown")
REMOTE_COUNT=$(ssh -o ConnectTimeout=10 "${SSH_USER}@${HOST}" \
  "LC_ALL=C find ${QPATH} -type f 2>/dev/null | wc -l | tr -d ' \t'" 2>/dev/null || echo "?")
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

# Phase timing placeholders (rsync only used in local mode)
RSYNC_PHASE_DURATION=0
RSYNC_BYTES="?"
RSYNC_FILES="?"

SCAN_PHASE_START=$(date +%s)

if [[ "$REMOTE_NODE_MAJOR" -ge 20 ]]; then
  # ─ native mode: filecap runs on the remote, NDJSON streams back ─────────────
  step "Mode: NATIVE (remote Node ${REMOTE_NODE} >= 20 — scan runs on the server)"
  info "Running: ssh ${SSH_USER}@${HOST} npx @icjia/filecap@latest scan '${REMOTE_PATH}' ..."

  QNAME=$(printf '%q' "${SERVER_NAME}")
  QHOST=$(printf '%q' "${HOST}")
  NATIVE_SITE_ARGS=""
  [[ -n "$SITE_NAME" ]] && NATIVE_SITE_ARGS="--site-name $(printf '%q' "${SITE_NAME}")"
  NATIVE_PUBURL_ARGS=""
  [[ -n "$PUBLIC_URL_BASE" ]] && NATIVE_PUBURL_ARGS="--public-url-base $(printf '%q' "${PUBLIC_URL_BASE}")"

  if ! ssh -o ConnectTimeout=30 "${SSH_USER}@${HOST}" \
      "npx --yes @icjia/filecap@latest scan ${QPATH} \
        --server-name ${QNAME} \
        --server-ip ${QHOST} \
        ${NATIVE_SITE_ARGS} \
        ${NATIVE_PUBURL_ARGS} \
        -o -" \
      > "${INVENTORY}" 2> >(grep -v 'Warning:' >&2); then
    die "Remote filecap scan failed. Check stderr above for details."
  fi

else
  # ─ local mode: rsync mirror, then scan locally ───────────────────────────────
  step "Mode: LOCAL (remote Node ${REMOTE_NODE} < 20 or absent — will rsync and scan locally)"
  info "This is expected for Ubuntu 18.04 / Node 16 servers."
  info "Step 1/2: rsyncing ${SSH_USER}@${HOST}:${REMOTE_PATH}/ → ${MIRROR_DIR}/"

  RSYNC_PHASE_START=$(date +%s)
  RSYNC_TMPOUT=$(mktemp)
  if ! rsync -av --delete --stats --no-links \
      "${SSH_USER}@${HOST}:${REMOTE_PATH}/" \
      "${MIRROR_DIR}/" 2>&1 | tee "${RSYNC_TMPOUT}"; then
    rm -f "${RSYNC_TMPOUT}"
    die "rsync failed. Check SSH connectivity / permissions and retry."
  fi
  RSYNC_PHASE_DURATION=$(( $(date +%s) - RSYNC_PHASE_START ))
  # Parse rsync --stats output for transferred counts.
  # macOS rsync (BSD) emits "Number of files transferred:"; modern GNU rsync (Linux)
  # emits "Number of regular files transferred:". Match either; suppress pipefail
  # set -e if grep finds no match (legitimate when rsync stats are unavailable).
  RSYNC_FILES=$( { grep -iE 'Number of (regular )?files transferred:' "${RSYNC_TMPOUT}" 2>/dev/null || true; } | awk '{print $NF}' | tr -d ',')
  RSYNC_BYTES=$( { grep -i 'Total transferred file size:' "${RSYNC_TMPOUT}" 2>/dev/null || true; } | awk '{print $NF}' | tr -d ',')
  [[ -z "$RSYNC_FILES" ]] && RSYNC_FILES="?"
  [[ -z "$RSYNC_BYTES" || ! "$RSYNC_BYTES" =~ ^[0-9]+$ ]] && RSYNC_BYTES="?"
  rm -f "${RSYNC_TMPOUT}"

  # Reset scan timer — scan phase begins after rsync
  SCAN_PHASE_START=$(date +%s)

  info "Step 2/2: scanning local mirror with filecap ..."
  # Build scan args array; include optional flags only when non-empty
  SCAN_ARGS=( "${MIRROR_DIR}" --server-name "${SERVER_NAME}" --server-ip "${HOST}" -o "${INVENTORY}" )
  [[ -n "$SITE_NAME" ]] && SCAN_ARGS+=( --site-name "${SITE_NAME}" )
  [[ -n "$PUBLIC_URL_BASE" ]] && SCAN_ARGS+=( --public-url-base "${PUBLIC_URL_BASE}" )

  if ! npx --yes @icjia/filecap@latest scan "${SCAN_ARGS[@]}" \
      2> >(grep -v 'Warning:' >&2); then
    die "Local filecap scan failed. Check stderr above for details."
  fi
fi

SCAN_PHASE_DURATION=$(( $(date +%s) - SCAN_PHASE_START ))

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
REPORT_PHASE_START=$(date +%s)
step "Generating filecap report ..."
if ! npx --yes @icjia/filecap@latest report "${INVENTORY}" -o "${REPORT_DIR}" ${HTML_FLAG} \
    2> >(grep -v 'Warning:' >&2); then
  die "filecap report generation failed."
fi
REPORT_PHASE_DURATION=$(( $(date +%s) - REPORT_PHASE_START ))

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

# ── postflight run summary ────────────────────────────────────────────────────
TOTAL_DURATION=$(( $(date +%s) - RUN_START_EPOCH ))

INV_FILES=$(tail -1 "${INVENTORY}" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('stats', {}).get('fileCount', '?'))" 2>/dev/null || echo '?')
INV_BYTES=$(tail -1 "${INVENTORY}" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('stats', {}).get('totalBytes', '?'))" 2>/dev/null || echo '?')
INV_FAILURES=$(tail -1 "${INVENTORY}" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('stats', {}).get('introspectionFailures', '?'))" 2>/dev/null || echo '?')

INV_HUMAN="?"
if [[ "$INV_BYTES" =~ ^[0-9]+$ ]]; then
  INV_HUMAN=$(human_bytes "$INV_BYTES")
fi

# Compute remediable count from CSV (column 5 'Remediation needed?' starting with 'Yes')
REM_COUNT=$(awk -F'","' 'NR>1 && $5 ~ /^"?Yes/' "${REPORT_DIR}/audit-file-list.csv" 2>/dev/null | wc -l | tr -d ' ' || echo '?')

CSV_BYTES=$(stat -f%z "${REPORT_DIR}/audit-file-list.csv" 2>/dev/null || stat -c%s "${REPORT_DIR}/audit-file-list.csv" 2>/dev/null || echo '?')
HTML_BYTES="?"
if [[ -n "$HTML_FLAG" && -f "${REPORT_DIR}/audit-file-list.html" ]]; then
  HTML_BYTES=$(stat -f%z "${REPORT_DIR}/audit-file-list.html" 2>/dev/null || stat -c%s "${REPORT_DIR}/audit-file-list.html" 2>/dev/null || echo '?')
fi

CSV_HUMAN="?"
[[ "$CSV_BYTES" =~ ^[0-9]+$ ]] && CSV_HUMAN=$(human_bytes "$CSV_BYTES")
HTML_HUMAN="?"
[[ "$HTML_BYTES" =~ ^[0-9]+$ ]] && HTML_HUMAN=$(human_bytes "$HTML_BYTES")

RSYNC_BYTES_HUMAN="?"
[[ "$RSYNC_BYTES" =~ ^[0-9]+$ ]] && RSYNC_BYTES_HUMAN=$(human_bytes "$RSYNC_BYTES")

echo
echo "══════════════════════════════════════════════════════════════════════════"
echo "  Run completed in $(fmt_duration "$TOTAL_DURATION")"
echo "══════════════════════════════════════════════════════════════════════════"
echo
printf "  %-22s %-12s %s\n" "Phase" "Duration" "Notes"
printf "  %-22s %-12s %s\n" "--------------------" "----------" "----------------------------------------"
printf "  %-22s %-12s ${G}%s${N}\n" "SSH preflight" "$(fmt_duration "$SSH_PHASE_DURATION")" "${SSH_USER}@${HOST} — OK"
if [[ "$RSYNC_PHASE_DURATION" -gt 0 ]]; then
  printf "  %-22s %-12s %s\n" "rsync mirror" "$(fmt_duration "$RSYNC_PHASE_DURATION")" "${RSYNC_BYTES_HUMAN} transferred, ${RSYNC_FILES} files updated"
fi
printf "  %-22s %-12s %s\n" "Scan + introspect" "$(fmt_duration "$SCAN_PHASE_DURATION")" "${INV_FAILURES} introspection failures"
if [[ -n "$HTML_FLAG" ]]; then
  printf "  %-22s %-12s %s\n" "Report generation" "$(fmt_duration "$REPORT_PHASE_DURATION")" "CSV (${CSV_HUMAN}), HTML (${HTML_HUMAN})"
else
  printf "  %-22s %-12s %s\n" "Report generation" "$(fmt_duration "$REPORT_PHASE_DURATION")" "CSV (${CSV_HUMAN})"
fi
echo
printf "  Inventory:           %s files · %s · %s need remediation\n" "${INV_FILES}" "${INV_HUMAN}" "${REM_COUNT}"
echo
