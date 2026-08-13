#!/usr/bin/env bash
# v1.41.0 — probe for the SKIP_SCAN resume point in audit-fleet-auto.sh.
#
# SKIP_SCAN=1 exists so a run whose LATER stage died (the audit stage paces
# against a 500-req/hour limiter for hours, so it is the likeliest to be
# interrupted) can resume without re-rsyncing every host and repointing every
# latest/. Two failure modes matter and both are silent:
#
#   - SKIP_SCAN=1 still scans      -> the resume is pointless; hours wasted
#   - default (unset) skips scan   -> the pipeline QUIETLY stops scanning and
#                                     every later bundle is built from stale
#                                     inventories
#
# So the probe asserts both branches against a fixture tree: the real
# audit-fleet-auto.sh is copied in alongside a stub audit-fleet.sh that
# records whether it was invoked.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
REAL_AUTO="$REPO_ROOT/examples/audit-fleet-auto.sh"

FAILED=0
note() { printf '  %s\n' "$*"; }
fail() { printf '  FAIL: %s\n' "$*" >&2; FAILED=1; }
pass() { printf '  ok: %s\n' "$*"; }

[ -f "$REAL_AUTO" ] || { echo "cannot find $REAL_AUTO" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Fixture tree mirroring the repo layout the script expects:
#   <root>/examples/audit-fleet-auto.sh   (the real script under test)
#   <root>/examples/audit-fleet.sh        (stub — records invocation)
#   <root>/bin/filecap.js                 (stub — only its existence is checked)
mkdir -p "$TMP/examples" "$TMP/bin"
cp "$REAL_AUTO" "$TMP/examples/audit-fleet-auto.sh"
chmod +x "$TMP/examples/audit-fleet-auto.sh"
printf '// stub\n' > "$TMP/bin/filecap.js"

MARKER="$TMP/scan-was-invoked"
cat > "$TMP/examples/audit-fleet.sh" <<EOF
#!/usr/bin/env bash
touch "$MARKER"
exit 0
EOF
chmod +x "$TMP/examples/audit-fleet.sh"

cat > "$TMP/sites.json" <<'EOF'
{ "sites": [ { "name": "probe-site", "siteName": "Probe" } ] }
EOF

run_auto() {
  # All later stages off — this probe is only about the Stage 1 branch.
  env -u SKIP_SCAN \
    SITES_JSON="$TMP/sites.json" \
    AUDITS_BASE="$TMP/audits" \
    SKIP_REFERENCES=1 SKIP_AUDITS=1 SKIP_SITE_AUDIT=1 SKIP_ROLLUP=1 \
    "$@" bash "$TMP/examples/audit-fleet-auto.sh" 2>&1
}

# ── Branch 1: SKIP_SCAN=1 must NOT invoke the scan ──────────────────────────
rm -f "$MARKER"
OUT_SKIP="$(run_auto SKIP_SCAN=1)"
if [ -e "$MARKER" ]; then
  fail "SKIP_SCAN=1 still invoked audit-fleet.sh (the resume point does nothing)"
else
  pass "SKIP_SCAN=1 did not invoke audit-fleet.sh"
fi
if printf '%s' "$OUT_SKIP" | grep -q "SKIP_SCAN=1 — reusing existing scans"; then
  pass "SKIP_SCAN=1 announced the reuse"
else
  fail "SKIP_SCAN=1 printed no reuse notice"
  note "output was: $OUT_SKIP"
fi
if printf '%s' "$OUT_SKIP" | grep -q "Full pipeline complete"; then
  pass "SKIP_SCAN=1 continued to the later stages (FLEET_EXIT treated as 0)"
else
  fail "SKIP_SCAN=1 aborted instead of continuing past Stage 1"
  note "output was: $OUT_SKIP"
fi

# ── Branch 2: default (unset) MUST still scan ───────────────────────────────
rm -f "$MARKER"
OUT_DEFAULT="$(run_auto)"
if [ -e "$MARKER" ]; then
  pass "default run invoked audit-fleet.sh"
else
  fail "default run did NOT scan — the pipeline would silently build from stale data"
  note "output was: $OUT_DEFAULT"
fi

# ── Branch 3: SKIP_SCAN=0 is explicit-off, not a truthy string ──────────────
rm -f "$MARKER"
run_auto SKIP_SCAN=0 >/dev/null
if [ -e "$MARKER" ]; then
  pass "SKIP_SCAN=0 scanned (only the exact string '1' skips)"
else
  fail "SKIP_SCAN=0 skipped the scan"
fi

if [ "$FAILED" -ne 0 ]; then
  echo "skip-scan probe FAILED" >&2
  exit 1
fi
echo "skip-scan probe passed"
