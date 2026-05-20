#!/usr/bin/env bash
# ============================================================================
#  audit-fleet-auto.sh — non-interactive wrapper around audit-fleet.sh
#                       plus the v1.8.0 references pipeline + web-rollup
# ============================================================================
#
#  WHY THIS EXISTS
#    audit-fleet.sh asks two interactive questions per run:
#      1. "Proceed with audit of N server(s)? [y/N]:"   (fleet-level confirm)
#      2. "Choice:"  for each server                     (audit-remote config
#         review — accept with Enter, edit with 1-7, abort with q)
#    A plain `echo y | ./audit-fleet.sh` does not work because the SSH calls
#    in the pre-validation loop inherit (and drain) the script's stdin, so the
#    "y" is consumed by the first ssh and `read` later sees EOF — under
#    `set -e` the script aborts silently before printing the prompt.
#
#    This wrapper runs audit-fleet.sh under `expect`, which allocates a pty.
#    With a pty, ssh no longer drains the parent script's stdin, and expect
#    sends an answer to each prompt as it appears.
#
#    v1.8.0: after scan + report finishes, the wrapper also runs the new
#    references pipeline (filecap references → cross-references → web-rollup)
#    so a single fleet refresh produces the deployed bundle with the
#    Referenced column populated. Set SKIP_REFERENCES=1 to opt out of the
#    references step; SKIP_ROLLUP=1 to opt out of the bundle build.
#
#  REQUIREMENTS
#    - expect    (preinstalled on macOS; `apt install expect` on Debian/Ubuntu)
#    - python3   (for parsing sites.json — ships with macOS and most Linux)
#    - audit-fleet.sh, audit-remote.sh, (audit-static.sh) in the same dir
#    - ~/.filecap/sites.json  (or a sites.json the inner script can auto-find)
#
#  USAGE
#    ./audit-fleet-auto.sh                # full pipeline (scan → references → audits → rollup → deploy)
#    AUDIT_HTML=0 ./audit-fleet-auto.sh   # skip HTML report generation
#    SKIP_VERSION_CHECK=0 ./audit-fleet-auto.sh   # keep the npm version check
#    SKIP_REFERENCES=1 ./audit-fleet-auto.sh      # skip references + cross-references
#    SKIP_AUDITS=1 ./audit-fleet-auto.sh          # skip the PDF accessibility scoring (v1.9.0)
#    SKIP_ROLLUP=1 ./audit-fleet-auto.sh          # skip web-rollup bundle build
#    FILECAP_NO_DEPLOY=1 ./audit-fleet-auto.sh    # build but don't deploy to Netlify
#
#  EXIT CODE
#    Mirrors audit-fleet.sh's exit code if scan fails; otherwise reflects
#    references / rollup outcome. Non-zero on any step's failure.
# ============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
AUDIT_FLEET_PATH="${SCRIPT_DIR}/audit-fleet.sh"
SITES_JSON="${SITES_JSON:-${HOME}/.filecap/sites.json}"
AUDITS_BASE="${AUDITS_BASE:-${HOME}/filecap-audits}"

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

if ! command -v expect >/dev/null 2>&1; then
  echo "ERROR: 'expect' is required but not installed." >&2
  echo "       macOS:  brew install expect" >&2
  echo "       Debian: sudo apt install expect" >&2
  exit 1
fi

if [[ ! -r "$AUDIT_FLEET_PATH" ]]; then
  echo "ERROR: cannot find audit-fleet.sh at $AUDIT_FLEET_PATH" >&2
  exit 1
fi

export AUDIT_FLEET_PATH
export SKIP_VERSION_CHECK="${SKIP_VERSION_CHECK:-1}"
export AUDIT_HTML="${AUDIT_HTML:-1}"

# ────────────────────────────────────────────────────────────────────────────
#  Stage 1: scan + report (existing expect-driven audit-fleet.sh)
# ────────────────────────────────────────────────────────────────────────────
expect <<'EXPECT_EOF'
# Allow any single rsync to take as long as it needs (no overall timeout).
set timeout -1
log_user 1

spawn -noecho bash $env(AUDIT_FLEET_PATH)

# Every interactive prompt audit-fleet.sh / audit-remote.sh can show during a
# fleet run, with the desired non-interactive answer:
#   - fleet "Proceed with audit of N server(s)? [y/N]:" → y
#   - per-server "Choice:" config review                → Enter (accept)
#   - per-server "Continue anyway? [y/N]:"  (URL HEAD failed) → y
#   - per-server "Proceed anyway? [y/N]:"   (low disk)        → y
expect {
    -re "Proceed with audit of \[0-9]+ server" {
        send -- "y\r"
        exp_continue
    }
    -re "Choice: *$" {
        send -- "\r"
        exp_continue
    }
    -re "Continue anyway\\? \\\[y/N\\]:" {
        send -- "y\r"
        exp_continue
    }
    -re "Proceed anyway\\? \\\[y/N\\]:" {
        send -- "y\r"
        exp_continue
    }
    eof
}

catch wait result
exit [lindex $result 3]
EXPECT_EOF
FLEET_EXIT=$?

if [[ $FLEET_EXIT -ne 0 ]]; then
  echo "[fleet-auto] audit-fleet.sh exited with code $FLEET_EXIT — skipping references/rollup" >&2
  exit $FLEET_EXIT
fi

# ────────────────────────────────────────────────────────────────────────────
#  Stage 2 (v1.8.0): references — per-site CMS reference extraction
# ────────────────────────────────────────────────────────────────────────────
if [[ "${SKIP_REFERENCES:-0}" == "1" ]]; then
  echo "[fleet-auto] SKIP_REFERENCES=1 — skipping references + cross-references"
else
  if [[ ! -f "$SITES_JSON" ]]; then
    echo "[fleet-auto] WARN: no sites.json at $SITES_JSON; skipping references" >&2
  else
    SIDECARS_DIR="${TMPDIR:-/tmp}/filecap-references-$$"
    mkdir -p "$SIDECARS_DIR"
    trap 'rm -rf "$SIDECARS_DIR"' EXIT

    # Discover sites that have a `references` block in sites.json. Sites
    # without one (e.g. archive-prod, ones whose pipeline hasn't been
    # configured yet) are skipped naturally — cross-references can still
    # resolve their files against sidecars from other sites.
    SITES_WITH_REFS=$(python3 -c "
import json, sys
with open('$SITES_JSON') as f: d = json.load(f)
for s in d.get('sites', []):
    if s.get('references'): print(s['name'])
")

    if [[ -z "$SITES_WITH_REFS" ]]; then
      echo "[fleet-auto] No sites in sites.json have a references block — skipping references"
    else
      echo "[fleet-auto] Stage 2: running 'filecap references' for $(echo "$SITES_WITH_REFS" | wc -l | tr -d ' ') sites (in parallel)"

      # Run references in parallel — each site's references step is
      # independent. Bounded by however many sites have a references block
      # (typically ≤ 11 in the ICJIA fleet). Each one is network-bound to
      # its own Strapi backend so parallelism doesn't contend.
      for site in $SITES_WITH_REFS; do
        (
          if ! node "$FILECAP_BIN" references "$site" \
                 -o "$SIDECARS_DIR/$site.refs.ndjson" >/tmp/filecap-refs-"$site".log 2>&1; then
            echo "[fleet-auto] WARN: references failed for $site (see /tmp/filecap-refs-$site.log)" >&2
          else
            echo "[fleet-auto]   ✓ references $site"
          fi
        ) &
      done
      wait

      # Cross-references: walk every inventory in ~/filecap-audits/ and
      # build entry.references[] from the sidecars. Sites without their
      # own sidecar still get matched against the fleet-wide index, so
      # archive-prod's files pick up references from icjia-agency-prod's
      # meeting attachments, etc.
      SIDECAR_ARGS=()
      for s in "$SIDECARS_DIR"/*.refs.ndjson; do
        [[ -f "$s" ]] && SIDECAR_ARGS+=(-s "$s")
      done

      if [[ ${#SIDECAR_ARGS[@]} -eq 0 ]]; then
        echo "[fleet-auto] No sidecars were produced; skipping cross-references"
      else
        echo "[fleet-auto] Stage 3: running 'filecap cross-references' over $(ls "$AUDITS_BASE"/*/latest/inventory.ndjson 2>/dev/null | wc -l | tr -d ' ') inventories"
        for site_dir in "$AUDITS_BASE"/*/; do
          site=$(basename "$site_dir")
          inv="$site_dir/latest/inventory.ndjson"
          out="$site_dir/latest/inventory.cross-ref.ndjson"
          if [[ -f "$inv" ]]; then
            if node "$FILECAP_BIN" cross-references "$inv" \
                 "${SIDECAR_ARGS[@]}" -o "$out" >/tmp/filecap-xref-"$site".log 2>&1; then
              echo "[fleet-auto]   ✓ cross-references $site"
            else
              echo "[fleet-auto] WARN: cross-references failed for $site" >&2
            fi
          fi
        done
      fi
    fi
  fi
fi

# ────────────────────────────────────────────────────────────────────────────
#  Stage 3.5 (v1.9.0): PDF audits — score every PDF in every augmented
#  inventory via audit.icjia.app's /api/audit-url endpoint. Each PDF gets
#  entry.audit = { score, grade, reportUrl, ... } attached. Other file
#  types (docx, xlsx, pptx, image) pass through unchanged — they have
#  their own remediation checkers inside their authoring apps.
#
#  Local cache at ~/.filecap/audit-cache.json (30-day TTL) means subsequent
#  runs make zero HTTP calls for unchanged files. The first full fleet run
#  is the heavy one; everything after is essentially free.
# ────────────────────────────────────────────────────────────────────────────
if [[ "${SKIP_AUDITS:-0}" == "1" ]]; then
  echo "[fleet-auto] SKIP_AUDITS=1 — skipping PDF accessibility scoring"
else
  echo "[fleet-auto] Stage 3.5: running 'filecap audits' over each augmented inventory"
  # v1.9.0+: only audit directories whose name matches a site in
  # sites.json. Older filecap-audits/ dirs (manual test scans, IP-named
  # leftovers from pre-1.6.x audits, etc.) often carry malformed
  # publicUrlBase values that fail the audit step's URL validation and
  # produce dozens of "Unavailable" cells on the deployed bundle.
  # Listing only known sites keeps stale data out without forcing
  # operators to clean up the directory.
  KNOWN_SITES=$(python3 -c "
import json
with open('$SITES_JSON') as f: d = json.load(f)
for s in d.get('sites', []):
    if s.get('name'): print(s['name'])
" 2>/dev/null)
  for site in $KNOWN_SITES; do
    site_dir="$AUDITS_BASE/$site"
    [[ -d "$site_dir" ]] || continue
    # Audits step consumes the most-augmented inventory available
    # (cross-ref'd if present, otherwise raw). Output is
    # inventory.audited.ndjson which web-rollup loader prefers.
    inv="$site_dir/latest/inventory.cross-ref.ndjson"
    [[ -f "$inv" ]] || inv="$site_dir/latest/inventory.ndjson"
    out="$site_dir/latest/inventory.audited.ndjson"
    if [[ -f "$inv" ]]; then
      if node "$FILECAP_BIN" audits "$inv" \
           -o "$out" >/tmp/filecap-audit-"$site".log 2>&1; then
        result=$(tail -1 /tmp/filecap-audit-"$site".log)
        echo "[fleet-auto]   ✓ audits $site: $result"
      else
        echo "[fleet-auto] WARN: audits failed for $site (see /tmp/filecap-audit-$site.log)" >&2
      fi
    fi
  done
fi

# ────────────────────────────────────────────────────────────────────────────
#  Stage 4: web-rollup — bundle every site into a static-site directory
#  (deploys to Netlify if ~/.filecap/config.json has webRollup.autoDeploy:
#  true and FILECAP_NO_DEPLOY is not set)
# ────────────────────────────────────────────────────────────────────────────
if [[ "${SKIP_ROLLUP:-0}" == "1" ]]; then
  echo "[fleet-auto] SKIP_ROLLUP=1 — skipping web-rollup"
else
  echo "[fleet-auto] Stage 4: running 'filecap web-rollup'"
  if ! node "$FILECAP_BIN" web-rollup; then
    echo "[fleet-auto] ERROR: web-rollup failed" >&2
    exit 1
  fi
  echo "[fleet-auto] ✓ web-rollup complete"
fi

echo "[fleet-auto] Full pipeline complete (scan → references → cross-references → audits → rollup)"
exit 0
