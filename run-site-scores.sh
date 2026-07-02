#!/usr/bin/env bash
# ============================================================================
#  run-site-scores.sh — refresh per-site WEBSITE accessibility scores, then
#                       rebuild + deploy the fleet-audit bundle
# ============================================================================
#
#  Runs `filecap site-audit <site>` for every content site in sites.json
#  (sitemap-driven axe page scoring via audit.icjia.app — independent of the
#  file/PDF scores), then `filecap web-rollup` to rebuild the bundle from the
#  cached file inventories + the fresh site-audit sidecars and deploy it.
#
#  LIGHT publish path: it does NOT re-scan the file fleet over SSH. Use it to
#  refresh the website-accessibility scores/donuts when the file inventories
#  are already current. For a full file re-scan + deploy, use ./run-full-audit.sh.
#
#  Deploy happens only if your web-rollup config has autoDeploy enabled (same
#  behavior as run-full-audit.sh); --no-deploy forces a local build, no deploy.
#
#  USAGE
#    ./run-site-scores.sh                            # all sites, then build + deploy
#    ./run-site-scores.sh --no-deploy                # build locally, do NOT deploy
#    ./run-site-scores.sh --only icjia-agency-prod   # one site only
#    ./run-site-scores.sh --max-new-pages 400        # raise per-run page cap (default 150)
#    ./run-site-scores.sh --help
#
#  Sites are scored sequentially (audit.icjia.app has a 100/min IP rate limit,
#  so parallel sites only contend). A per-site failure is logged and skipped;
#  it never aborts the run. Coverage is cache-amortized: a large site (e.g.
#  icjia-agency-prod, ~2,400 pages) fills in over several runs at the per-run
#  cap; small sites complete in one.
#
#  Transcript: ~/filecap-audits/_runs/site-scores-<UTC>.log
# ============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
FILECAP_BIN="$SCRIPT_DIR/bin/filecap.js"
SITES_JSON="${SITES_JSON:-${FILECAP_SITES_FILE:-$HOME/.filecap/sites.json}}"
# Child `filecap` invocations (site-audit, web-rollup) resolve their roster
# from FILECAP_SITES_FILE — export so SITES_JSON steers them too.
export FILECAP_SITES_FILE="$SITES_JSON"
AUDITS_BASE="${AUDITS_BASE:-$HOME/filecap-audits}"

say()  { printf '\n=== %s ===\n' "$*"; }
ok()   { printf '  [ok] %s\n' "$*"; }
warn() { printf '  [!]  %s\n' "$*" >&2; }
die()  { printf '\n[FAIL] %s\n' "$*" >&2; exit 1; }

show_help() {
  awk 'NR==1 {next} /^#/ {sub(/^# ?/, ""); print; next} {exit}' "${BASH_SOURCE[0]}"
}

# ── args ──────────────────────────────────────────────────────────────────────
DEPLOY=1
ONLY=""
MAX_NEW_PAGES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-deploy) DEPLOY=0 ;;
    --only) ONLY="${2:-}"; shift ;;
    --max-new-pages) MAX_NEW_PAGES="${2:-}"; shift ;;
    -h|--help) show_help; exit 0 ;;
    *) die "Unknown option: $1  (try --help)" ;;
  esac
  shift
done

# ── pre-flight ─────────────────────────────────────────────────────────────────
[ -f "$FILECAP_BIN" ] || die "filecap CLI not found at $FILECAP_BIN"
[ -f "$SITES_JSON" ]  || die "No sites.json at $SITES_JSON"
command -v node    >/dev/null 2>&1 || die "node not found"
command -v python3 >/dev/null 2>&1 || die "python3 not found (used to read sites.json)"

# ── transcript ─────────────────────────────────────────────────────────────────
TS="$(date -u +%Y%m%d-%H%M%SZ)"
RUNS_DIR="$AUDITS_BASE/_runs"
mkdir -p "$RUNS_DIR"
LOG="$RUNS_DIR/site-scores-$TS.log"
exec > >(tee -a "$LOG") 2>&1
printf 'filecap site-scores — %s\n' "$TS"
printf 'transcript: %s\n' "$LOG"

# ── site list ──────────────────────────────────────────────────────────────────
if [ -n "$ONLY" ]; then
  SITES="$ONLY"
else
  SITES="$(python3 -c "
import json
with open('$SITES_JSON') as f: d = json.load(f)
for s in d.get('sites', []):
    if s.get('name'): print(s['name'])
")"
fi
[ -n "$SITES" ] || die "no sites found in $SITES_JSON"

MNP_FLAG=""
[ -n "$MAX_NEW_PAGES" ] && MNP_FLAG="--max-new-pages $MAX_NEW_PAGES"

# ── 1. score each site (sequential — respects the 100/min IP rate limit) ────────
say "Scoring website accessibility per site"
PROCESSED=0
FAILED=0
for site in $SITES; do
  if [ ! -d "$AUDITS_BASE/$site" ]; then
    warn "skip $site — no audit dir (run a file scan first via run-full-audit.sh)"
    continue
  fi
  PROCESSED=$((PROCESSED + 1))
  # $MNP_FLAG is intentionally unquoted so an empty value expands to nothing and
  # a set value splits into two args; it is only ever "--max-new-pages <int>".
  if node "$FILECAP_BIN" site-audit "$site" $MNP_FLAG; then
    ok "site-audit $site"
  else
    FAILED=$((FAILED + 1))
    warn "site-audit failed for $site (continuing)"
  fi
done
ok "scored $PROCESSED site(s), $FAILED failed"

# ── 2. rebuild + deploy the bundle ──────────────────────────────────────────────
say "Rebuilding fleet-audit bundle"
if [ "$DEPLOY" -eq 1 ]; then
  node "$FILECAP_BIN" web-rollup || die "web-rollup failed"
else
  warn "--no-deploy: building bundle, NOT deploying"
  FILECAP_NO_DEPLOY=1 node "$FILECAP_BIN" web-rollup || die "web-rollup failed"
fi

say "Done"
ok "Website accessibility scores published. Transcript: $LOG"
