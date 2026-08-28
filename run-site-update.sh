#!/usr/bin/env bash
# ============================================================================
#  run-site-update.sh — refresh the FILE stats of ONE (or a few) site(s),
#                       then rebuild + deploy the fleet-audit bundle
# ============================================================================
#
#  Remediation happens one site at a time (inaccessible PDFs fixed in place, or
#  moved into the long-term archive). This refreshes just the site(s) you name
#  and republishes the bundle — every other site's numbers come straight from
#  cache, untouched. web-rollup already rebuilds the whole bundle from each
#  site's cached inventory, so only the named site(s) need re-processing.
#
#  Name sites by URL (front-end or file-server), domain alias, slug, or
#  nickname — whatever you have. A bare front-end host shared by several apps
#  (icjia.illinois.gov) is rejected with the unique alternatives listed.
#
#  ARCHIVE: moving excepted PDFs into archive.icjia.cloud changes its file count
#  too, so updating a content site PROMPTS to also refresh the archive
#  (default Y). Refreshing it only updates its cached inventory: as of v1.69.0
#  the archive is roster-excluded (`excluded: true` in sites.json) while its
#  contents are in flux, so it appears in no published numbers until that
#  flag is deleted — keeping the cache fresh is what makes its return cheap.
#
#  USAGE
#    ./run-site-update.sh i2i.illinois.gov                     # one site (+ archive prompt)
#    ./run-site-update.sh i2i.illinois.gov archive.icjia.cloud # source + archive together
#    ./run-site-update.sh i2i.illinois.gov --no-archive        # one site, leave the archive alone
#    ./run-site-update.sh i2i.illinois.gov --scores-only       # skip the SSH re-scan; re-score documents only
#    ./run-site-update.sh i2i.illinois.gov --no-deploy         # build locally, do NOT deploy
#    ./run-site-update.sh i2i.illinois.gov --no-purge          # keep old run dirs
#    ./run-site-update.sh i2i.illinois.gov --dry-run           # resolve + show the plan, do nothing
#    ./run-site-update.sh --help
#
#  FULL refresh (default), per named site:  SSH re-scan -> references ->
#  cross-references (against the fleet-wide index) -> PDF audits. The audit
#  cache means only changed PDFs hit the network. --scores-only skips the SSH
#  scan + references and only re-scores PDFs over the existing inventory; if a
#  named site has no cached inventory it asks to do a full run for it first
#  (default Y).
#
#  Deploy happens only if web-rollup config has autoDeploy enabled (same as
#  run-full-audit.sh); --no-deploy forces a local build. Prereqs match
#  run-full-audit.sh: SSH keys, expect, Netlify login.
#
#  Transcript: ~/filecap-audits/_runs/site-update-<UTC>.log
# ============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
FILECAP_BIN="$SCRIPT_DIR/bin/filecap.js"
AUDIT_FLEET_PATH="$SCRIPT_DIR/examples/audit-fleet.sh"
SITES_JSON="${SITES_JSON:-${FILECAP_SITES_FILE:-$HOME/.filecap/sites.json}}"
# Child `filecap` invocations (references, audits, web-rollup) resolve their
# roster from FILECAP_SITES_FILE — export so SITES_JSON steers them too.
export FILECAP_SITES_FILE="$SITES_JSON"
AUDITS_BASE="${AUDITS_BASE:-$HOME/filecap-audits}"
ROLLUP_DIR="$AUDITS_BASE/_web-rollup"
# Where excepted files land — overridable, resolved through the same resolver.
ARCHIVE_URL="${ARCHIVE_URL:-archive.icjia.cloud}"

say()  { printf '\n=== %s ===\n' "$*"; }
ok()   { printf '  [ok] %s\n' "$*"; }
warn() { printf '  [!]  %s\n' "$*" >&2; }
die()  { printf '\n[FAIL] %s\n' "$*" >&2; exit 1; }

show_help() {
  awk 'NR==1 {next} /^#/ {sub(/^# ?/, ""); print; next} {exit}' "${BASH_SOURCE[0]}"
}

# ── args ──────────────────────────────────────────────────────────────────────
DEPLOY=1
PURGE=1
SCORES_ONLY=0
ASK_ARCHIVE=1
DRY_RUN=0
QUERIES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --no-deploy)   DEPLOY=0 ;;
    --no-purge)    PURGE=0 ;;
    --scores-only) SCORES_ONLY=1 ;;
    --no-archive)  ASK_ARCHIVE=0 ;;
    --dry-run)     DRY_RUN=1 ;;
    -h|--help)     show_help; exit 0 ;;
    -*)            die "Unknown option: $1  (try --help)" ;;
    *)             QUERIES+=("$1") ;;
  esac
  shift
done
[ ${#QUERIES[@]} -gt 0 ] || die "Name at least one site by URL or slug (try --help)"

# ── pre-flight ─────────────────────────────────────────────────────────────────
[ -f "$FILECAP_BIN" ] || die "filecap CLI not found at $FILECAP_BIN"
[ -f "$SITES_JSON" ]  || die "No sites.json at $SITES_JSON"
command -v node    >/dev/null 2>&1 || die "node not found"
command -v python3 >/dev/null 2>&1 || die "python3 not found (used to read sites.json)"

# Scan prereqs live in a function because --scores-only can still escalate a
# site without a cached inventory to a full scan; the checks are re-run right
# before any scan starts, regardless of mode.
require_scan_prereqs() {
  command -v expect >/dev/null 2>&1 ||
    die "expect not found (needed for the SSH scan — brew install expect)"
  [ -f "$AUDIT_FLEET_PATH" ] ||
    die "audit-fleet.sh not found at $AUDIT_FLEET_PATH"
}
if [ "$SCORES_ONLY" -eq 0 ]; then
  require_scan_prereqs
fi

# ── concurrency guard ──────────────────────────────────────────────────────────
# Same rule as run-full-audit.sh: never interleave with a fleet scan. Also
# refuse to run alongside run-full-audit.sh or another run-site-update.sh —
# both purge run dirs and repoint latest/.
if pgrep -fl 'audit-fleet|audit-remote' >/dev/null 2>&1; then
  warn "Another fleet scan looks like it is already running:"
  pgrep -fl 'audit-fleet|audit-remote' >&2 || true
  die "Refusing to start. Wait for the other one or kill it."
fi
# pgrep -f would match this very process, so take a ps snapshot and filter
# out our own PID, our own subshells (their PPID is us), and our direct
# parent (a `bash -c './run-site-update.sh …'` wrapper carries the script
# name on its command line). The [b]rackets keep the awk process from
# matching its own argv.
PS_SNAPSHOT="$(ps -axo pid=,ppid=,command=)"
OTHER_RUNS="$(printf '%s\n' "$PS_SNAPSHOT" | awk -v me="$$" -v pp="$PPID" '
  $1 != me && $1 != pp && $2 != me &&
  /run-[f]ull-audit\.sh|run-[s]ite-update\.sh/')"
if [ -n "$OTHER_RUNS" ]; then
  warn "Another orchestrator run is in progress:"
  printf '%s\n' "$OTHER_RUNS" >&2
  die "Refusing to run two orchestrators at once. Wait or kill it."
fi

# ── transcript ─────────────────────────────────────────────────────────────────
TS="$(date -u +%Y%m%d-%H%M%SZ)"
RUNS_DIR="$AUDITS_BASE/_runs"
mkdir -p "$RUNS_DIR"
LOG="$RUNS_DIR/site-update-$TS.log"
exec > >(tee -a "$LOG") 2>&1
printf 'filecap site-update — %s\n' "$TS"
printf 'transcript: %s\n' "$LOG"

# ── resolve queries -> slugs (abort on any ambiguous/unknown) ───────────────────
resolve_slug() { node "$FILECAP_BIN" resolve-site "$1" --sites-file "$SITES_JSON"; }

TARGETS=()
for q in "${QUERIES[@]}"; do
  slug="$(resolve_slug "$q")" || die "could not resolve '$q' to a single site (see candidates above)"
  # Dedup without expanding a possibly-empty array (fatal under `set -u` in the
  # bash 3.2 that ships with macOS).
  dup=0
  if [ ${#TARGETS[@]} -gt 0 ]; then
    for t in "${TARGETS[@]}"; do
      if [ "$t" = "$slug" ]; then dup=1; break; fi
    done
  fi
  if [ "$dup" -eq 1 ]; then
    warn "duplicate: '$q' -> $slug (already listed)"
  else
    TARGETS+=("$slug"); ok "$q -> $slug"
  fi
done

ARCHIVE_SLUG="$(resolve_slug "$ARCHIVE_URL" 2>/dev/null || true)"

# ── archive auto-prompt ─────────────────────────────────────────────────────────
# Skipped when: --no-archive, --scores-only (no file moves), the archive is
# already named, or the archive can't be resolved. Default Y.
if [ "$ASK_ARCHIVE" -eq 1 ] && [ "$SCORES_ONLY" -eq 0 ] && [ -n "$ARCHIVE_SLUG" ]; then
  archive_in=0; nonarchive=0
  for s in "${TARGETS[@]}"; do
    if [ "$s" = "$ARCHIVE_SLUG" ]; then archive_in=1; else nonarchive=1; fi
  done
  if [ "$archive_in" -eq 0 ] && [ "$nonarchive" -eq 1 ]; then
    printf '\nAlso update the archive (%s), where excepted files land? [Y/n] ' "$ARCHIVE_URL"
    read -r ans || ans=""
    case "$ans" in
      [Nn]*) warn "leaving the archive untouched" ;;
      *)     TARGETS+=("$ARCHIVE_SLUG"); ok "will also update $ARCHIVE_SLUG (count refreshes; score stays N/A)" ;;
    esac
  fi
fi

say "Targets: ${TARGETS[*]}  (mode: $( [ "$SCORES_ONLY" -eq 1 ] && echo scores-only || echo full ))"

# ── decide which targets need a full refresh (scan + references + cross-refs) ────
# Full mode: all of them. Scores-only: only those lacking a cached inventory,
# after a per-site prompt (default Y) to do a full run for them first.
FULL_TARGETS=()
if [ "$SCORES_ONLY" -eq 0 ]; then
  FULL_TARGETS=("${TARGETS[@]}")
else
  for site in "${TARGETS[@]}"; do
    if [ ! -f "$AUDITS_BASE/$site/latest/inventory.cross-ref.ndjson" ] \
       && [ ! -f "$AUDITS_BASE/$site/latest/inventory.ndjson" ]; then
      printf '\n%s has no cached inventory — do a full scan + refresh for it first? [Y/n] ' "$site"
      read -r ans || ans=""
      case "$ans" in
        [Nn]*) die "aborted: $site needs a full run first" ;;
        *)     FULL_TARGETS+=("$site") ;;
      esac
    fi
  done
fi

# ── dry run: show the plan and stop before any side effects ─────────────────────
if [ "$DRY_RUN" -eq 1 ]; then
  say "DRY RUN — nothing will be scanned, scored, deployed, or purged"
  printf '  mode:          %s\n' "$( [ "$SCORES_ONLY" -eq 1 ] && echo scores-only || echo full )"
  printf '  targets:       %s\n' "${TARGETS[*]}"
  if [ ${#FULL_TARGETS[@]} -gt 0 ]; then
    printf '  full refresh:  %s  (SSH scan -> references -> cross-references -> audits)\n' "${FULL_TARGETS[*]}"
  else
    printf '  full refresh:  (none)\n'
  fi
  printf '  re-score docs: %s\n' "${TARGETS[*]}"
  printf '  deploy:        %s\n' "$( [ "$DEPLOY" -eq 1 ] && echo yes || echo 'no (--no-deploy)' )"
  printf '  purge:         %s\n' "$( [ "$PURGE" -eq 1 ] && echo yes || echo 'no (--no-purge)' )"
  exit 0
fi

# ── scan (full targets only) ────────────────────────────────────────────────────
# Build a temp sites.json with just the full-refresh targets and drive the
# existing fleet scanner (audit-fleet.sh) over it under expect — same answers as
# audit-fleet-auto.sh. Writes ~/filecap-audits/<slug>/latest/inventory.ndjson.
scan_targets() {
  local tmpdir tmp rc
  # audit-fleet.sh only takes its sites.json branch when the roster path ends
  # in .json, and macOS mktemp appends a random suffix to file templates — so
  # build the roster inside a temp dir under an exact sites.json name.
  tmpdir="$(mktemp -d -t filecap-update.XXXXXX)"
  tmp="$tmpdir/sites.json"
  python3 - "$SITES_JSON" "$tmp" "$@" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
want = set(sys.argv[3:])
d = json.load(open(src))
out = {"version": d.get("version", 1),
       "sites": [s for s in d.get("sites", []) if s.get("name") in want]}
json.dump(out, open(dst, "w"))
PY
  AUDIT_FLEET_PATH="$AUDIT_FLEET_PATH" TEMP_SITES_JSON="$tmp" expect <<'EXPECT_EOF'
set timeout -1
log_user 1
spawn -noecho bash $env(AUDIT_FLEET_PATH) $env(TEMP_SITES_JSON)
expect {
    -re "Proceed with audit of \[0-9]+ server" { send -- "y\r"; exp_continue }
    -re "Choice: *$"                           { send -- "\r";  exp_continue }
    -re "Continue anyway\\? \\\[y/N\\]:"        { send -- "y\r"; exp_continue }
    -re "Proceed anyway\\? \\\[y/N\\]:"         { send -- "y\r"; exp_continue }
    eof
}
catch wait result
# A signal-killed child reports {pid spawnid 0 0 CHILDKILLED ...}, where
# element 3 is 0 — it must not be used as the exit code. An OS-level wait
# error sets element 2 to -1 (element 3 is then errno, not a status).
if {[llength $result] > 4 && [lindex $result 4] eq "CHILDKILLED"} { exit 143 }
if {[lindex $result 2] == -1} { exit 1 }
exit [lindex $result 3]
EXPECT_EOF
  rc=$?
  rm -rf "$tmpdir"
  return $rc
}

if [ ${#FULL_TARGETS[@]} -gt 0 ]; then
  # --scores-only can reach here too (targets that had no cached inventory),
  # so re-check the scan prereqs regardless of mode.
  require_scan_prereqs
  say "Scanning ${#FULL_TARGETS[@]} site(s) over SSH: ${FULL_TARGETS[*]}"
  scan_targets "${FULL_TARGETS[@]}" || die "scan failed"

  # references for each full target that has a references block; refresh the
  # persisted sidecar atomically (keep the old one on failure).
  say "Refreshing references"
  for site in "${FULL_TARGETS[@]}"; do
    has_refs="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print('1' if any(s.get('name')==sys.argv[2] and s.get('references') for s in d.get('sites',[])) else '0')" "$SITES_JSON" "$site")"
    if [ "$has_refs" != "1" ]; then
      warn "$site: no references block — skipping references"
      continue
    fi
    sc="$AUDITS_BASE/$site/latest/references-sidecar.ndjson"
    mkdir -p "$(dirname "$sc")"
    if node "$FILECAP_BIN" references "$site" -o "$sc.tmp" >/tmp/filecap-refs-"$site".log 2>&1; then
      mv "$sc.tmp" "$sc"; ok "references $site"
    else
      rm -f "$sc.tmp"; warn "references failed for $site (kept previous sidecar; see /tmp/filecap-refs-$site.log)"
    fi
  done

  # cross-references each full target against the FLEET-WIDE sidecar index
  # (fresh target sidecars + every other site's persisted sidecar), so the
  # target's page->file links resolve to their owning fleet site. Other sites'
  # cross-refs are intentionally left as cached.
  SIDECAR_ARGS=()
  for s in "$AUDITS_BASE"/*/latest/references-sidecar.ndjson; do
    [ -f "$s" ] && SIDECAR_ARGS+=(-s "$s")
  done
  say "Cross-referencing against the fleet index"
  for site in "${FULL_TARGETS[@]}"; do
    inv="$AUDITS_BASE/$site/latest/inventory.ndjson"
    out="$AUDITS_BASE/$site/latest/inventory.cross-ref.ndjson"
    if [ ! -f "$inv" ]; then
      warn "$site: no inventory.ndjson (scan may have failed) — skipping cross-references"
      continue
    fi
    if [ ${#SIDECAR_ARGS[@]} -gt 0 ] \
       && node "$FILECAP_BIN" cross-references "$inv" "${SIDECAR_ARGS[@]}" -o "$out" >/tmp/filecap-xref-"$site".log 2>&1; then
      ok "cross-references $site"
    else
      warn "cross-references skipped/failed for $site (see /tmp/filecap-xref-$site.log)"
    fi
  done
fi

# ── audits (ALL targets, both modes) — re-score documents; cache keeps it cheap ──
say "Scoring documents (PDF + Office)"
for site in "${TARGETS[@]}"; do
  d="$AUDITS_BASE/$site/latest"
  inv="$d/inventory.cross-ref.ndjson"
  [ -f "$inv" ] || inv="$d/inventory.ndjson"
  if [ ! -f "$inv" ]; then
    warn "$site: no inventory — skipping audits"
    continue
  fi
  if node "$FILECAP_BIN" audits "$inv" -o "$d/inventory.audited.ndjson" >/tmp/filecap-audit-"$site".log 2>&1; then
    ok "audits $site: $(tail -1 /tmp/filecap-audit-"$site".log)"
  else
    warn "audits failed for $site (see /tmp/filecap-audit-$site.log)"
  fi
done

# ── rebuild + deploy the bundle (full roster: fresh targets + cached others) ─────
say "Rebuilding fleet-audit bundle"
if [ "$DEPLOY" -eq 1 ]; then
  node "$FILECAP_BIN" web-rollup || die "web-rollup failed"
else
  warn "--no-deploy: building bundle, NOT deploying"
  FILECAP_NO_DEPLOY=1 node "$FILECAP_BIN" web-rollup || die "web-rollup failed"
fi

# ── purge old runs (keep newest per site + newest rollup) ────────────────────────
# Keep the newest timestamped run dir per site AND the run `latest` points to
# (normally the same dir — but a partial dir left by a failed/killed scan can
# be lexically newer than the good run). Never touch latest/ symlinks,
# mirror/ caches, or _fleet/ (they don't end in 'Z' so the *Z glob skips them).
if [ "$PURGE" -eq 1 ]; then
  say "Purge old runs (keep newest per site + newest rollup)"
  PER_SITE_REMOVED=0
  for runs_dir in "$AUDITS_BASE"/*/runs; do
    [ -d "$runs_dir" ] || continue
    site_dir="${runs_dir%/runs}"
    newest=$(ls -1d "$runs_dir"/*Z 2>/dev/null | sort | tail -1)
    [ -n "$newest" ] || continue
    # Resolve `latest` to its physical target so it is never deleted. A
    # dangling link means the site's state is suspect: warn, delete nothing.
    keep_latest=""
    if [ -e "$site_dir/latest" ] || [ -L "$site_dir/latest" ]; then
      keep_latest=$(cd "$site_dir/latest" 2>/dev/null && pwd -P)
      if [ -z "$keep_latest" ]; then
        warn "$(basename "$site_dir"): dangling latest link — purging nothing for this site"
        continue
      fi
    fi
    for dd in "$runs_dir"/*Z; do
      [ -d "$dd" ] || continue
      [ "$dd" = "$newest" ] && continue
      if [ -n "$keep_latest" ]; then
        dd_phys=$(cd "$dd" 2>/dev/null && pwd -P)
        [ "$dd_phys" = "$keep_latest" ] && continue
      fi
      rm -rf "$dd" && PER_SITE_REMOVED=$((PER_SITE_REMOVED + 1))
    done
  done
  ROLLUPS_REMOVED=0
  if [ -d "$ROLLUP_DIR" ]; then
    newest_rollup=$(ls -1d "$ROLLUP_DIR"/*Z 2>/dev/null | sort | tail -1)
    for dd in "$ROLLUP_DIR"/*Z; do
      [ -d "$dd" ] || continue
      [ "$dd" = "$newest_rollup" ] && continue
      rm -rf "$dd" && ROLLUPS_REMOVED=$((ROLLUPS_REMOVED + 1))
    done
  fi
  ok "Removed $PER_SITE_REMOVED old site runs + $ROLLUPS_REMOVED old rollups"
else
  warn "--no-purge set: keeping all old runs"
fi

say "Done"
ok "Updated: ${TARGETS[*]}. Transcript: $LOG"
