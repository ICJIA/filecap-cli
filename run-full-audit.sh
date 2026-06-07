#!/usr/bin/env bash
# ============================================================================
#  run-full-audit.sh — ONE command for the entire ICJIA filecap fleet audit
# ============================================================================
#
#  Run this and walk away. It does the whole thing, end to end:
#
#    1. Pre-flight — checks expect, Netlify login, sites.json, free disk
#    2. Scan       — inventories every file on all content sites (ssh + rsync)
#    3. Enrich     — CMS references -> cross-references -> PDF a11y scores
#    4. Web audit  — builds the deployable web-rollup bundle
#                    (all content sites + the tooling-site roster)
#    5. Deploy     — pushes the bundle to Netlify (the live fleet-audit site)
#    6. Purge      — keeps only the newest run per site + the newest rollup
#    7. Summary    — prints the file/page totals and the live URL
#
#  USAGE
#    ./run-full-audit.sh              # the usual: full audit + push + cleanup
#    ./run-full-audit.sh --no-deploy  # build everything locally, do NOT push
#    ./run-full-audit.sh --no-purge   # keep old audit runs (skip cleanup)
#    ./run-full-audit.sh --help
#
#  A full transcript is saved to:
#    ~/filecap-audits/_runs/full-audit-<UTC-timestamp>.log
#
#  The scan + enrich + rollup + deploy heavy lifting is delegated to the
#  battle-tested examples/audit-fleet-auto.sh. This wrapper adds friendly
#  pre-flight, cleanup, and a summary so there is exactly one thing to run.
# ============================================================================

set -uo pipefail

# ── paths ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
AUTO="$SCRIPT_DIR/examples/audit-fleet-auto.sh"
FILECAP_BIN="$SCRIPT_DIR/bin/filecap.js"
SITES_JSON="${SITES_JSON:-$HOME/.filecap/sites.json}"
AUDITS_BASE="${AUDITS_BASE:-$HOME/filecap-audits}"
ROLLUP_DIR="$AUDITS_BASE/_web-rollup"

# ── pretty output (plain ASCII so the tee'd log stays clean) ──────────────────
say()  { printf '\n=== %s ===\n' "$*"; }
ok()   { printf '  [ok] %s\n' "$*"; }
warn() { printf '  [!]  %s\n' "$*" >&2; }
die()  { printf '\n[FAIL] %s\n' "$*" >&2; exit 1; }

show_help() {
  # Print the header comment block (everything from line 2 up to the first
  # non-comment line), stripping the leading "# ".
  awk 'NR==1 {next} /^#/ {sub(/^# ?/, ""); print; next} {exit}' "${BASH_SOURCE[0]}"
}

# ── args ─────────────────────────────────────────────────────────────────────
DEPLOY=1
PURGE=1
for arg in "$@"; do
  case "$arg" in
    --no-deploy) DEPLOY=0 ;;
    --no-purge)  PURGE=0 ;;
    -h|--help)   show_help; exit 0 ;;
    *) die "Unknown option: $arg  (try --help)" ;;
  esac
done

# ── logging: tee everything to a timestamped transcript ──────────────────────
TS="$(date -u +%Y%m%d-%H%M%SZ)"
RUNS_DIR="$AUDITS_BASE/_runs"
mkdir -p "$RUNS_DIR"
LOG="$RUNS_DIR/full-audit-$TS.log"
exec > >(tee -a "$LOG") 2>&1

printf 'filecap full fleet audit — %s\n' "$TS"
printf 'transcript: %s\n' "$LOG"

# ── 1. pre-flight ────────────────────────────────────────────────────────────
say "Pre-flight"

command -v expect >/dev/null 2>&1 || die "'expect' not found. Install with: brew install expect"
ok "expect present"

[ -f "$AUTO" ] || die "Cannot find $AUTO — run this from inside the filecap-cli checkout."
ok "pipeline script found"

[ -f "$SITES_JSON" ] || die "No sites.json at $SITES_JSON"
SITE_COUNT=$(jq '.sites | length' "$SITES_JSON" 2>/dev/null || echo 0)
TOOL_COUNT=$(jq '.tools | length' "$SITES_JSON" 2>/dev/null || echo 0)
[ "${SITE_COUNT:-0}" -gt 0 ] 2>/dev/null || die "sites.json lists no content sites"
ok "roster: $SITE_COUNT content sites + $TOOL_COUNT tooling sites"
jq -r '.sites[].name' "$SITES_JSON" 2>/dev/null | sed 's/^/       - /'

if pgrep -fl 'audit-fleet|audit-remote' >/dev/null 2>&1; then
  warn "Another fleet scan looks like it is already running:"
  pgrep -fl 'audit-fleet|audit-remote' >&2 || true
  die "Refusing to start a second scan. Wait for the other one or kill it."
fi
ok "no scan already running"

FREE_GB=$(df -g "$HOME" 2>/dev/null | awk 'NR==2{print $4}')
if [ -n "${FREE_GB:-}" ] && [ "$FREE_GB" -lt 10 ] 2>/dev/null; then
  warn "Only ${FREE_GB}GB free in $HOME (>10GB recommended)."
else
  ok "disk: ${FREE_GB:-?}GB free in $HOME"
fi

FC_VER=$(node "$FILECAP_BIN" --version 2>/dev/null || echo "?")
ok "filecap CLI v$FC_VER"

if [ "$DEPLOY" -eq 1 ]; then
  command -v netlify >/dev/null 2>&1 \
    || die "netlify CLI not found. Install: npm i -g netlify-cli  (or rerun with --no-deploy)"
  NSTATUS=$(netlify status 2>&1 || true)
  if printf '%s' "$NSTATUS" | grep -qiE 'not logged in|you are not logged'; then
    die "netlify CLI is not logged in. Run: netlify login   (or rerun with --no-deploy)"
  fi
  ok "netlify CLI present and authenticated"
else
  warn "--no-deploy set: bundle will be BUILT but NOT pushed to Netlify"
fi

# ── 2-5. scan -> enrich -> web rollup (-> deploy) ────────────────────────────
if [ "$DEPLOY" -eq 1 ]; then
  say "Full audit: scan -> enrich -> web rollup -> DEPLOY"
else
  say "Full audit: scan -> enrich -> web rollup (no deploy)"
fi
echo "  Expect ~15-40 min depending on how much content changed since the last run."
echo "  Watching progress:  tail -f \"$LOG\""

START=$(date +%s)
if [ "$DEPLOY" -eq 1 ]; then
  "$AUTO"
else
  FILECAP_NO_DEPLOY=1 "$AUTO"
fi
RC=$?
ELAPSED=$(( $(date +%s) - START ))
HUMAN="$((ELAPSED / 60))m $((ELAPSED % 60))s"

[ "$RC" -eq 0 ] || die "Audit pipeline failed (exit $RC) after $HUMAN. See $LOG"
ok "Audit pipeline finished in $HUMAN"

# ── 6. purge old runs (keep newest per site + newest rollup) ─────────────────
# Rules (deliberate): keep the newest timestamped run dir per site and the
# newest rollup bundle. Never touch `latest/` symlinks or `mirror/` rsync
# caches (they do not end in 'Z' so the *Z glob skips them), and leave the
# _fleet/ consolidated dirs alone.
if [ "$PURGE" -eq 1 ]; then
  say "Purge old runs (keep newest per site + newest rollup)"
  PRE_SIZE=$(du -sh "$AUDITS_BASE" 2>/dev/null | awk '{print $1}')

  PER_SITE_REMOVED=0
  for runs_dir in "$AUDITS_BASE"/*/runs; do
    [ -d "$runs_dir" ] || continue
    newest=$(ls -1d "$runs_dir"/*Z 2>/dev/null | sort | tail -1)
    [ -n "$newest" ] || continue
    for d in "$runs_dir"/*Z; do
      [ -d "$d" ] || continue
      [ "$d" = "$newest" ] && continue
      rm -rf "$d" && PER_SITE_REMOVED=$((PER_SITE_REMOVED + 1))
    done
  done

  ROLLUPS_REMOVED=0
  if [ -d "$ROLLUP_DIR" ]; then
    newest_rollup=$(ls -1d "$ROLLUP_DIR"/*Z 2>/dev/null | sort | tail -1)
    for d in "$ROLLUP_DIR"/*Z; do
      [ -d "$d" ] || continue
      [ "$d" = "$newest_rollup" ] && continue
      rm -rf "$d" && ROLLUPS_REMOVED=$((ROLLUPS_REMOVED + 1))
    done
  fi

  POST_SIZE=$(du -sh "$AUDITS_BASE" 2>/dev/null | awk '{print $1}')
  ok "Removed $PER_SITE_REMOVED old site runs + $ROLLUPS_REMOVED old rollups (was ${PRE_SIZE:-?}, now ${POST_SIZE:-?})"
else
  warn "--no-purge set: keeping all old runs"
fi

# ── 7. summary ───────────────────────────────────────────────────────────────
say "Summary"
NEWEST_ROLLUP=$(ls -1d "$ROLLUP_DIR"/*Z 2>/dev/null | sort | tail -1)
if [ -n "$NEWEST_ROLLUP" ] && [ -f "$NEWEST_ROLLUP/index.html" ]; then
  FILES=$(grep -oE 'out of <strong>[0-9,]+</strong>' "$NEWEST_ROLLUP/index.html" | head -1 | grep -oE '[0-9,]+' | tr -d ',')
  REMEDIABLE=$(grep -oE '<p class="fleet-hero-num">[0-9,]+</p>' "$NEWEST_ROLLUP/index.html" | head -1 | grep -oE '[0-9,]+' | tr -d ',')
  echo "  bundle:       $NEWEST_ROLLUP"
  echo "  total files:  ${FILES:-?}"
  echo "  remediable:   ${REMEDIABLE:-?}"
fi
if [ "$DEPLOY" -eq 1 ]; then
  # Netlify CLI v2 prints "Production URL: <https://...>" (angle brackets);
  # older output used "Website URL:". Match either, strip the brackets.
  URL=$(grep -oiE '(Production|Website) URL: *<?https?://[^[:space:]>]+' "$LOG" | tail -1 | grep -oiE 'https?://[^[:space:]>]+')
  [ -z "${URL:-}" ] && URL=$(grep -oiE 'Unique deploy URL: *<?https?://[^[:space:]>]+' "$LOG" | tail -1 | grep -oiE 'https?://[^[:space:]>]+')
  echo "  deployed:     ${URL:-<see transcript>}"
else
  echo "  deployed:     (skipped — --no-deploy)"
fi
echo "  transcript:   $LOG"
ok "Full audit complete."
