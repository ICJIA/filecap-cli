#!/usr/bin/env bash
# ============================================================================
#  audit-fleet-auto.sh — non-interactive wrapper around audit-fleet.sh
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
#  REQUIREMENTS
#    - expect  (preinstalled on macOS; `apt install expect` on Debian/Ubuntu)
#    - audit-fleet.sh, audit-remote.sh, (audit-static.sh) in the same dir
#    - ~/.filecap/sites.json  (or a sites.json the inner script can auto-find)
#
#  USAGE
#    ./audit-fleet-auto.sh                # full fleet, all auto-answered
#    AUDIT_HTML=0 ./audit-fleet-auto.sh   # skip HTML report generation
#    SKIP_VERSION_CHECK=0 ./audit-fleet-auto.sh   # keep the npm version check
#
#  EXIT CODE
#    Mirrors audit-fleet.sh's exit code.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
AUDIT_FLEET_PATH="${SCRIPT_DIR}/audit-fleet.sh"

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

exec expect <<'EXPECT_EOF'
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
