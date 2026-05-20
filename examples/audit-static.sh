#!/usr/bin/env bash
# ============================================================================
#  filecap audit — static-site (no-CMS Nuxt-style) audit script
# ============================================================================
#
#  WHAT THIS DOES
#    Audits a static-site repo where files live inside the repo itself (e.g.
#    Nuxt's /public folder) rather than on a Strapi/CMS host. Shallow-clones
#    the repo, runs `filecap scan` on the configured public directory,
#    rewrites entry paths to GitHub source URLs so a vendor clicking through
#    in the bundle lands on the file's source in github.com, and drops the
#    result into the same per-site directory layout the Strapi audits use
#    (~/filecap-audits/<server-name>/runs/<ts>/inventory.ndjson + latest/
#    symlink). filecap web-rollup picks it up unchanged.
#
#  HOW IT'S INVOKED
#    Direct (single repo):
#      ./audit-static.sh <gitRepo> <publicPath> <serverName>
#    Example:
#      ./audit-static.sh https://github.com/ICJIA/icjia-vpp-2025.git public vpp-git
#
#    Via fleet (typical):
#      ./audit-fleet.sh                # audit-fleet.sh dispatches to here
#                                      # for entries with `"type": "git"`
#
#  AUTH (private repos)
#    1. `gh auth login` is preferred. When `gh auth status` succeeds the
#       gh credential helper handles git clones transparently.
#    2. Fallback: FILECAP_GITHUB_TOKEN env var (PAT with `repo` scope).
#       Token is interpolated into an https://x-access-token:... URL for the
#       single git operation, never written to disk and never logged.
#    3. With neither configured, public repos still clone fine; private
#       repos fail fast with a clear error.
#
#  ENV VARS HONORED (passed through by audit-fleet.sh)
#    SITE_NAME_ARG          - the friendly nickname (e.g. "VPP")
#    PUBLIC_URL_BASE_ARG    - URL files are served at (e.g. "https://vpp.illinois.gov")
#    FILECAP_GITHUB_TOKEN   - PAT fallback for private repos
#    SKIP_VERSION_CHECK     - skip the self-version check (set by fleet runner)
#
#  REQUIREMENTS
#    - bash 3.2+, git, python3, npx (Node 18+)
#    - For private repos: gh CLI (preferred) OR FILECAP_GITHUB_TOKEN set
#
# ============================================================================

set -euo pipefail

# ── filecap CLI ────────────────────────────────────────────────────────────────
# The @icjia/filecap npm package is deprecated — filecap is git-only now. Run
# the CLI from this checkout (these scripts live in examples/, so bin/filecap.js
# is one directory up) instead of `npx @icjia/filecap@latest`.
FILECAP_BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)/bin/filecap.js"
if [[ ! -f "$FILECAP_BIN" ]]; then
  echo "ERROR: filecap CLI not found at $FILECAP_BIN" >&2
  echo "       Run this script from inside a filecap-cli checkout." >&2
  exit 1
fi

# ── colors ────────────────────────────────────────────────────────────────────
G='\033[0;32m'
R='\033[0;31m'
B='\033[0;34m'
Y='\033[0;33m'
N='\033[0m'

die()  { printf "${R}ERROR:${N} %s\n" "$*" >&2; exit 1; }
step() { printf "${G}==>${N} %s\n" "$*"; }
info() { printf "${B}  ->${N} %s\n" "$*"; }
warn() { printf "${Y}WARN:${N} %s\n" "$*" >&2; }

# ── args ──────────────────────────────────────────────────────────────────────
GIT_REPO="${1:-}"
PUBLIC_PATH="${2:-public}"
SERVER_NAME="${3:-}"
SITE_NAME="${SITE_NAME_ARG:-}"
PUBLIC_URL_BASE="${PUBLIC_URL_BASE_ARG:-}"

[[ -z "$GIT_REPO" ]]    && die "first arg required: gitRepo (e.g. https://github.com/ICJIA/icjia-vpp-2025.git)"
[[ -z "$SERVER_NAME" ]] && die "third arg required: serverName (used as the work-dir under ~/filecap-audits/)"

# ── derive owner/repo from gitRepo URL ────────────────────────────────────────
# Supports:
#   https://github.com/<owner>/<repo>.git
#   https://github.com/<owner>/<repo>
#   git@github.com:<owner>/<repo>.git
GIT_REPO_NO_GIT="${GIT_REPO%.git}"
if [[ "$GIT_REPO_NO_GIT" =~ github\.com[:/]([^/]+)/([^/]+) ]]; then
  OWNER="${BASH_REMATCH[1]}"
  REPO_BASENAME="${BASH_REMATCH[2]}"
else
  die "could not parse owner/repo from gitRepo URL: $GIT_REPO"
fi

# ── auth resolution ──────────────────────────────────────────────────────────
# Order: gh CLI (if logged in) -> FILECAP_GITHUB_TOKEN -> anonymous
#
# FC-2026-018 mitigation: when FILECAP_GITHUB_TOKEN is used, the token is
# injected via the GIT_CONFIG_* env vars (http.extraheader) rather than baked
# into a URL passed as a git command-line argument. argv is visible to other
# local users via `ps aux`; env vars are not (process environment requires
# same-UID read access on macOS/Linux). The token never appears in argv.
USE_GIT_TOKEN_ENV=0
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  info "Using gh CLI credential helper for git operations"
elif [[ -n "${FILECAP_GITHUB_TOKEN:-}" ]]; then
  USE_GIT_TOKEN_ENV=1
  info "Using FILECAP_GITHUB_TOKEN via GIT_CONFIG_* env (not visible in ps aux)"
else
  info "No gh auth / FILECAP_GITHUB_TOKEN — assuming repo is public"
fi

# Shell function that wraps `git ...` with the auth header in env vars when
# FILECAP_GITHUB_TOKEN is set. Token stays in the process environment for
# this single invocation, never in argv.
git_with_auth() {
  if [[ "$USE_GIT_TOKEN_ENV" == "1" ]]; then
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0=http.extraheader \
    GIT_CONFIG_VALUE_0="Authorization: Bearer ${FILECAP_GITHUB_TOKEN}" \
      git "$@"
  else
    git "$@"
  fi
}

# ── work directory ────────────────────────────────────────────────────────────
WORKDIR="${HOME}/filecap-audits/${SERVER_NAME}"
CLONE_DIR="${WORKDIR}/clone"
TS=$(date -u +"%Y%m%d-%H%M%SZ")
RUN_DIR="${WORKDIR}/runs/${TS}"
INVENTORY="${RUN_DIR}/inventory.ndjson"
SOURCE_INFO="${RUN_DIR}/SOURCE_INFO.txt"

mkdir -p "${RUN_DIR}"
chmod 700 "${HOME}/filecap-audits/${SERVER_NAME}" 2>/dev/null || true

step "Audit: ${SERVER_NAME} (${GIT_REPO})"
info "Work dir: ${WORKDIR}"

# ── clone or update ───────────────────────────────────────────────────────────
# Always use the clean GIT_REPO URL (no token interpolation). git_with_auth
# adds the Authorization header via env vars when needed.

if [[ -d "${CLONE_DIR}/.git" ]]; then
  step "Updating existing clone ..."
  # Make sure the on-disk remote URL is the clean URL (in case an earlier
  # version of this script wrote a token-bearing URL into .git/config).
  git -C "${CLONE_DIR}" remote set-url origin "${GIT_REPO}"
  if ! git_with_auth -C "${CLONE_DIR}" fetch --depth=1 origin; then
    die "git fetch failed — check repo URL or auth (gh auth status / FILECAP_GITHUB_TOKEN)"
  fi
  # Detect default branch from the remote HEAD; fall back to main
  DEFAULT_BRANCH=$(git -C "${CLONE_DIR}" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null \
    | sed 's|^origin/||' || echo "main")
  [[ -z "$DEFAULT_BRANCH" ]] && DEFAULT_BRANCH="main"
  git -C "${CLONE_DIR}" reset --hard "origin/${DEFAULT_BRANCH}" >/dev/null
else
  step "Cloning ${GIT_REPO} ..."
  if ! git_with_auth clone --depth=1 "${GIT_REPO}" "${CLONE_DIR}"; then
    die "git clone failed — repo may be private (set FILECAP_GITHUB_TOKEN or run 'gh auth login') or URL may be wrong"
  fi
  DEFAULT_BRANCH=$(git -C "${CLONE_DIR}" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null \
    | sed 's|^origin/||' || echo "main")
  [[ -z "$DEFAULT_BRANCH" ]] && DEFAULT_BRANCH="main"
fi

COMMIT_SHA=$(git -C "${CLONE_DIR}" rev-parse HEAD)
info "Branch: ${DEFAULT_BRANCH} @ ${COMMIT_SHA:0:12}"

# ── verify publicPath exists ──────────────────────────────────────────────────
SCAN_TARGET="${CLONE_DIR}/${PUBLIC_PATH}"
if [[ ! -d "${SCAN_TARGET}" ]]; then
  die "publicPath '${PUBLIC_PATH}' not found inside repo ${OWNER}/${REPO_BASENAME}. Check sites.json."
fi

REMOTE_COUNT=$(find "${SCAN_TARGET}" -type f | wc -l | tr -d ' \t')
info "Files in ${PUBLIC_PATH}/: ${REMOTE_COUNT}"

# ── filecap scan ──────────────────────────────────────────────────────────────
step "Scanning ${PUBLIC_PATH}/ ..."
SCAN_ARGS=( "${SCAN_TARGET}" --server-name "${SERVER_NAME}" --server-ip "github.com" -o "${INVENTORY}" )
[[ -n "$SITE_NAME" ]]       && SCAN_ARGS+=( --site-name "${SITE_NAME}" )
[[ -n "$PUBLIC_URL_BASE" ]] && SCAN_ARGS+=( --public-url-base "${PUBLIC_URL_BASE}" )

if ! node "$FILECAP_BIN" scan "${SCAN_ARGS[@]}" \
    2> >(grep -v 'Warning:' >&2); then
  die "filecap scan failed. Check stderr above for details."
fi

# ── path rewrite ──────────────────────────────────────────────────────────────
# Set absolutePath on each entry to a GitHub source URL the vendor can click
# through to: https://github.com/<owner>/<repo>/tree/<branch>/<publicPath>/<rel>
# Header gets scannedPath = publicPath and hostname = github.com/<owner>/<repo>
# (matching audit-remote.sh's rewrite shape so the bundle CSV columns work
# unchanged).
step "Rewriting paths to GitHub source URLs ..."
REPO_SLUG="${OWNER}/${REPO_BASENAME}"
GH_BASE="https://github.com/${REPO_SLUG}/tree/${DEFAULT_BRANCH}/${PUBLIC_PATH}"

python3 - "${INVENTORY}" "${PUBLIC_PATH}" "${REPO_SLUG}" "${GH_BASE}" <<'PYREWRITE'
import sys, json, os, tempfile, shutil

inventory_path, public_path, repo_slug, gh_base = sys.argv[1:5]

tmp_fd, tmp_path = tempfile.mkstemp(suffix=".ndjson",
                                    dir=os.path.dirname(inventory_path))
os.close(tmp_fd)

try:
    with open(tmp_path, 'w', encoding='utf-8') as out_f, \
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
            if kind in ('filecap-inventory-header', 'filecap-consolidated-header'):
                meta = obj.get('metadata', {})
                meta['scannedPath'] = public_path
                meta['hostname']    = f"github.com/{repo_slug}"
                obj['metadata'] = meta
            elif kind not in ('filecap-inventory-footer', 'filecap-consolidated-footer'):
                rel = (obj.get('path') or '').lstrip('/')
                obj['absolutePath'] = f"{gh_base}/{rel}"

            out_f.write(json.dumps(obj, separators=(',', ':')) + '\n')

    shutil.move(tmp_path, inventory_path)
    print(f"  -> path rewrite complete: scannedPath={public_path}, host=github.com/{repo_slug}")
except Exception as e:
    if os.path.exists(tmp_path):
        os.unlink(tmp_path)
    print(f"ERROR during path rewrite: {e}", file=sys.stderr)
    sys.exit(1)
PYREWRITE

# ── SOURCE_INFO.txt ──────────────────────────────────────────────────────────
{
  echo "filecap static-site audit"
  echo "========================="
  echo
  echo "Server name:    ${SERVER_NAME}"
  [[ -n "$SITE_NAME" ]]       && echo "Site name:      ${SITE_NAME}"
  echo "Repo:           ${GIT_REPO}"
  echo "Branch:         ${DEFAULT_BRANCH}"
  echo "Commit:         ${COMMIT_SHA}"
  echo "Public path:    ${PUBLIC_PATH}"
  [[ -n "$PUBLIC_URL_BASE" ]] && echo "Public URL base: ${PUBLIC_URL_BASE}"
  echo "Files scanned:  ${REMOTE_COUNT}"
  echo "Scanned at:     $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "${SOURCE_INFO}"

# ── update latest symlink ────────────────────────────────────────────────────
LATEST_LINK="${WORKDIR}/latest"
if [[ -L "${LATEST_LINK}" || -e "${LATEST_LINK}" ]]; then
  rm -f "${LATEST_LINK}"
fi
(cd "${WORKDIR}" && ln -s "runs/${TS}" "latest")

step "Done."
info "Inventory: ${INVENTORY}"
info "Source info: ${SOURCE_INFO}"
info "Latest symlink: ${LATEST_LINK} -> runs/${TS}"
