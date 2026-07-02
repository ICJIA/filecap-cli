#!/usr/bin/env bash
# test/shell/purge-fixture-probe.sh — durable regression probe for the A1
# purge rules shared by run-full-audit.sh and run-site-update.sh (v1.39.0
# post-audit fix, red-4 MED-1: the highest-stakes fix had no automated test —
# nothing went red if the purge logic was reverted).
#
# The per-site purge loop is extracted from each script BY MARKER, not by
# line number: both scripts bound it with the unique lines
#   PER_SITE_REMOVED=0   (start, inclusive)
#   ROLLUPS_REMOVED=0    (end, exclusive)
# so editing surrounding code cannot silently detach the probe, and editing
# or reverting the loop itself turns the probe (and its vitest wrapper,
# test/purge-scripts.test.js) red.
#
# Asserted rules (the A1 contract):
#   1. the run `latest` points to survives even when it is NOT the lexically
#      newest run dir (a partial dir left by a killed scan can sort newer),
#   2. the newest run dir survives,
#   3. older run dirs are deleted,
#   4. a dangling `latest` link means the site's state is suspect: the site
#      is skipped entirely (nothing deleted) with a WARN,
#   5. mirror/ rsync caches are untouched (no trailing Z — outside the glob).
#
# Usage: purge-fixture-probe.sh [workdir]
#   Without a workdir a temp dir is created and removed on exit.
#   RUN_FULL_AUDIT_SH / RUN_SITE_UPDATE_SH env vars override the script
#   locations (used to red-prove the probe against a pre-fix copy).

set -u

HERE=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$HERE/../.." && pwd)
FULL_SH="${RUN_FULL_AUDIT_SH:-$REPO_ROOT/run-full-audit.sh}"
UPDATE_SH="${RUN_SITE_UPDATE_SH:-$REPO_ROOT/run-site-update.sh}"

CLEANUP=0
if [ "$#" -ge 1 ] && [ -n "$1" ]; then
  WORK="$1"
  mkdir -p "$WORK"
else
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/filecap-purge-probe.XXXXXX")
  CLEANUP=1
fi
cleanup() { [ "$CLEANUP" -eq 1 ] && rm -rf "$WORK"; }
trap cleanup EXIT

FAILURES=0
fail() { echo "FAIL: $*" >&2; FAILURES=$((FAILURES + 1)); }
pass() { echo "  ok: $*"; }

for script in "$FULL_SH" "$UPDATE_SH"; do
  if [ ! -f "$script" ]; then
    echo "FATAL: script not found: $script" >&2
    exit 2
  fi
done

extract_purge_loop() {
  # $1 = script path, $2 = snippet output path
  awk '/^[[:space:]]*PER_SITE_REMOVED=0[[:space:]]*$/{grab=1}
       /^[[:space:]]*ROLLUPS_REMOVED=0[[:space:]]*$/{grab=0}
       grab{print}' "$1" > "$2"
  if ! grep -q 'for runs_dir in' "$2"; then
    echo "FATAL: could not extract the per-site purge loop from $1" >&2
    echo "       expected it between the PER_SITE_REMOVED=0 and ROLLUPS_REMOVED=0 markers" >&2
    exit 2
  fi
  if ! bash -n "$2"; then
    echo "FATAL: extracted purge loop from $1 does not parse standalone" >&2
    exit 2
  fi
}

build_fixture() {
  # $1 = AUDITS_BASE for this scenario
  local base="$1"
  rm -rf "$base"
  # siteA: latest -> an OLDER run than the lexically newest (the killed-scan
  # shape the A1 fix exists for). mirror/ must never be touched.
  mkdir -p "$base/siteA/runs/20260101-000000Z" \
           "$base/siteA/runs/20260201-000000Z" \
           "$base/siteA/runs/20260301-000000Z" \
           "$base/siteA/mirror"
  echo inv > "$base/siteA/runs/20260201-000000Z/inventory.ndjson"
  echo cached > "$base/siteA/mirror/cache.bin"
  ln -s "runs/20260201-000000Z" "$base/siteA/latest"
  # siteB: dangling latest — the target run dir does not exist.
  mkdir -p "$base/siteB/runs/20260101-000000Z" \
           "$base/siteB/runs/20260201-000000Z"
  ln -s "runs/20250101-000000Z" "$base/siteB/latest"
}

run_scenario() {
  # $1 = label, $2 = extracted-snippet path
  local label="$1" snippet="$2"
  local base="$WORK/$label/audits"
  local warnings="$WORK/$label/warnings.log"
  mkdir -p "$WORK/$label"
  build_fixture "$base"
  : > "$warnings"

  # Execute the extracted loop in a subshell with the helpers/vars the real
  # scripts provide around it (warn + AUDITS_BASE). The subshell inherits
  # this function's locals; nothing leaks back out.
  (
    warn() { echo "WARN: $*" >> "$warnings"; }
    AUDITS_BASE="$base"
    # shellcheck disable=SC1090
    . "$snippet"
  ) || fail "$label: purge loop exited non-zero"

  if [ -d "$base/siteA/runs/20260201-000000Z" ]; then
    pass "$label: latest-target run survives (not the newest)"
  else
    fail "$label: latest-target run 20260201-000000Z was DELETED"
  fi
  if [ -d "$base/siteA/runs/20260301-000000Z" ]; then
    pass "$label: newest run survives"
  else
    fail "$label: newest run 20260301-000000Z was deleted"
  fi
  if [ ! -d "$base/siteA/runs/20260101-000000Z" ]; then
    pass "$label: older run purged"
  else
    fail "$label: old run 20260101-000000Z was NOT deleted"
  fi
  if [ -f "$base/siteA/mirror/cache.bin" ]; then
    pass "$label: mirror/ untouched"
  else
    fail "$label: mirror/ cache was deleted"
  fi
  if [ -d "$base/siteB/runs/20260101-000000Z" ] && [ -d "$base/siteB/runs/20260201-000000Z" ]; then
    pass "$label: dangling-latest site skipped (nothing deleted)"
  else
    fail "$label: dangling-latest site had run dirs deleted"
  fi
  if grep -qi "dangling" "$warnings"; then
    pass "$label: dangling latest emitted a WARN"
  else
    fail "$label: no dangling-latest WARN emitted"
  fi
}

echo "== extracting per-site purge loops =="
SNIP_FULL="$WORK/purge-loop.run-full-audit.sh"
SNIP_UPDATE="$WORK/purge-loop.run-site-update.sh"
extract_purge_loop "$FULL_SH" "$SNIP_FULL"
extract_purge_loop "$UPDATE_SH" "$SNIP_UPDATE"

echo "== scenario: run-full-audit.sh =="
run_scenario "run-full-audit" "$SNIP_FULL"
echo "== scenario: run-site-update.sh =="
run_scenario "run-site-update" "$SNIP_UPDATE"

if [ "$FAILURES" -gt 0 ]; then
  echo "purge-fixture-probe: $FAILURES assertion(s) FAILED" >&2
  exit 1
fi
echo "purge-fixture-probe: all assertions passed"
