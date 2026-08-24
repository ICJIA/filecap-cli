#!/usr/bin/env bash
# logs.sh — read this Mac's fleet-audit logs in a hurry.
#
# QUICK START
#   ./logs.sh                        the 500 most recent audit failures, newest first (across runs)
#   ./logs.sh 200                    the 200 most recent failures
#   ./logs.sh run 20260824-124619Z  one run's failures (leave the id off for the newest run)
#   ./logs.sh errors                 the newest run's error detail (message + stack per fault)
#   ./logs.sh tail                   watch the newest run transcript live (Ctrl-C to stop)
#   ./logs.sh help                   this text
#   Tables open in a pager: arrow keys scroll (right too — long lines are not wrapped), q quits.
#
# WHERE THE LOGS ARE
#   The fleet audit runs HERE, on this Mac, and only pushes the web rollup to Netlify — so
#   every log stays local, under ~/filecap-audits/_runs/. Nothing on the deployed site serves
#   them. The pipeline writes three kinds of file:
#     errors-<runId>.csv     one row per document/page that failed to audit that run: the time,
#                            the site, the file URL, an HTTP status/error code, and the message.
#                            Opens in Excel. Written only when a run has at least one failure.
#     errors-<runId>.ndjson  the same failures with full detail — the error message and stack
#                            trace per fault — for debugging. `errors` prints this.
#     full-audit-<UTC>.log   the whole run transcript (also site-update-<UTC>.log). `tail` follows it.
#   A runId looks like 20260824-124619Z (UTC). ./logs.sh list shows which runs are on file.
#
# COMMANDS
#   ./logs.sh [recent [N]] [FMT]     the N most recent failures (default 500), newest first,
#                                    across as many runs as it takes
#   ./logs.sh run [RUNID] [FMT]      one run's failures (default: the newest run)
#   ./logs.sh errors [RUNID]         one run's error detail — message + stack per fault (default: newest)
#   ./logs.sh grep PATTERN [RUNID]   search the error logs (one run, or all when RUNID is left out)
#   ./logs.sh tail                   follow the newest run transcript live (Ctrl-C to stop)
#   ./logs.sh list [N]               the N newest files in the logs dir (default 15): which runs exist
#   ./logs.sh help                   this text (also -h, --help)
#   Shortcuts: a bare RUNID means "run RUNID"; a bare number means "recent N".
#
# FMT — how a table of failures is printed (recent / run)
#   --table   aligned columns for reading in the terminal   (default at a terminal)
#   --csv     the file as-is                                 (default when piped or redirected)
#   --tsv     tab-separated — pastes into Excel / Numbers / Sheets as columns
#   --md      a Markdown table — pastes into GitHub, Slack, docs
#   --copy    put the output on the clipboard instead of the screen (TSV unless a FMT is given)
#   Examples:
#     ./logs.sh --md                          the 500 most recent failures as a Markdown table
#     ./logs.sh run --copy                     the newest run's failures, as TSV, on the clipboard
#     ./logs.sh recent 200 > recent.csv        the raw rows (piped, so --csv is the default)
#
# REQUIREMENTS
#   bash; python3 for the table formats (present on macOS). Terminal output is paged with
#   $PAGER (default: less -S).
#
# ENVIRONMENT OVERRIDES — rarely needed
#   LOGS_DIR     the logs directory (default: ~/filecap-audits/_runs)
#   AUDITS_BASE  the audits root    (default: ~/filecap-audits); LOGS_DIR is $AUDITS_BASE/_runs
set -euo pipefail

AUDITS_BASE="${AUDITS_BASE:-$HOME/filecap-audits}"
LOGS_DIR="${LOGS_DIR:-$AUDITS_BASE/_runs}"
RECENT_DEFAULT=500  # rows shown by a bare ./logs.sh
LIST_DEFAULT=15     # files shown by ./logs.sh list
COMMANDS="recent run errors grep tail list help"
SELF="${BASH_SOURCE[0]:-$0}"

# The help text IS the comment block above (so the two cannot drift apart).
usage() { sed -n '2,/^set -euo/p' "$SELF" | sed '$d' | sed 's/^# \{0,1\}//'; }
die() { echo "logs.sh: $*" >&2; exit 1; }

is_count() { [[ "${1:-}" =~ ^[1-9][0-9]*$ ]]; }
is_runid() { [[ "${1:-}" =~ ^[0-9]{8}-[0-9]{6}Z$ ]]; }

newest_runid() {
  ls -1t "$LOGS_DIR"/errors-*.csv 2>/dev/null | head -1 | sed -E 's#.*/errors-(.+)\.csv$#\1#'
}

# --- output sinks -----------------------------------------------------------------
page() { if [ -t 1 ]; then ${PAGER:-less -S}; else cat; fi; }

clipboard_tool() {
  if command -v pbcopy >/dev/null 2>&1; then echo "pbcopy"
  elif command -v wl-copy >/dev/null 2>&1; then echo "wl-copy"
  elif command -v xclip >/dev/null 2>&1; then echo "xclip -selection clipboard"
  elif command -v xsel >/dev/null 2>&1; then echo "xsel --clipboard --input"
  else return 1; fi
}

clip() {
  local tool content lines
  content="$(cat)"
  lines=$(printf '%s\n' "$content" | wc -l | tr -d ' ')
  if tool="$(clipboard_tool)"; then
    printf '%s\n' "$content" | $tool
    echo "copied $lines line(s) to the clipboard ($tool)" >&2
  else
    printf '%s\n' "$content"
    echo "no clipboard program found; printed $lines line(s) instead" >&2
  fi
}

# --- CSV rendering (python3: real RFC 4180 parsing — quoted commas, the BOM) ----------
# render FORMAT LIMIT FILE...
#   FORMAT: table|csv|tsv|md
#   LIMIT 0: one run's file, rows in file order, "N failure(s)" caption.
#   LIMIT N: many runs' files; merge the rows, newest (by ts) first, take N, with a caption.
# (the Python program arrives on stdin, so the CSVs are opened by path, not piped)
render() {
  command -v python3 >/dev/null 2>&1 || die "python3 is required for --table/--tsv/--md (use --csv)"
  python3 - "$@" <<'PY'
import csv, os, re, sys
fmt, limit, paths = sys.argv[1], int(sys.argv[2]), sys.argv[3:]

def read(path):
    try:
        with open(path, encoding="utf-8-sig", newline="") as fh:
            rows = list(csv.reader(fh))
    except FileNotFoundError:
        return [], []
    return (rows[0], rows[1:]) if rows else ([], [])

def runid_of(path):
    m = re.search(r"\d{8}-\d{6}Z", os.path.basename(path))
    return m.group(0) if m else os.path.basename(path)

header, body, caption = [], [], None
if limit == 0:
    header, body = read(paths[0])
    caption = f"{len(body)} failure(s) — run {runid_of(paths[0])}"
else:
    allrows = []
    for path in paths:
        h, rows = read(path)
        if not h:
            continue
        if not header:
            header = h
        elif h != header:                                    # an older layout: match by column name
            at = {name: i for i, name in enumerate(h)}
            rows = [[r[at[c]] if c in at and at[c] < len(r) else "" for c in header] for r in rows]
        allrows.extend(rows)
    allrows.sort(key=lambda r: r[0] if r else "", reverse=True)   # newest ts first
    body = allrows[:limit] if limit > 0 else allrows
    if not header:
        print("no failures on file — every audited document passed", file=sys.stderr)
        sys.exit(0)
    s = "" if len(body) == 1 else "s"
    what = f"the {len(body)} most recent failure{s}" if len(body) == limit else f"all {len(body)} failure{s} on file"
    caption = f"{what}, newest first"

if not header:
    sys.exit(0)
one_line = lambda c: c.replace("\r", " ").replace("\n", " ")
if caption and fmt != "table":
    print(caption, file=sys.stderr)

if fmt == "csv":
    w = csv.writer(sys.stdout, lineterminator="\n")
    w.writerow(header); w.writerows(body)
elif fmt == "tsv":
    for r in [header] + body:
        print("\t".join(one_line(c).replace("\t", " ") for c in r))
else:
    ui = header.index("url") if "url" in header else -1
    mi = header.index("message") if "message" in header else -1
    def cell(i, c):
        c = one_line(c)
        if fmt == "table" and i == ui and len(c) > 46: c = c[:45] + "…"
        if fmt == "table" and i == mi and len(c) > 50: c = c[:49] + "…"
        return c
    disp = [[cell(i, c) for i, c in enumerate(r)] for r in [header] + body]
    if fmt == "md":
        esc = lambda c: c.replace("|", "\\|")
        print("| " + " | ".join(esc(c) for c in disp[0]) + " |")
        print("|" + "|".join("---" for _ in disp[0]) + "|")
        for r in disp[1:]:
            print("| " + " | ".join(esc(c) for c in r) + " |")
    else:
        if caption:
            print(caption); print()
        n = len(header)
        widths = [max(len(r[i]) if i < len(r) else 0 for r in disp) for i in range(n)]
        for k, r in enumerate(disp):
            print("  ".join((r[i] if i < len(r) else "").ljust(widths[i]) for i in range(n)).rstrip())
            if k == 0:
                print("  ".join("-" * w for w in widths))
PY
}

# The error detail for one run: message + up to five stack frames per fault.
render_ndjson() {
  command -v python3 >/dev/null 2>&1 || { cat "$1"; return 0; }
  python3 - "$1" <<'PY'
import json, sys
n = 0
for line in open(sys.argv[1], encoding="utf-8"):
    line = line.strip()
    if not line:
        continue
    try:
        r = json.loads(line)
    except Exception:
        continue
    n += 1
    c = r.get("context") or {}
    print(f"{r.get('ts','')}  [{r.get('scope','')}]  {c.get('event', r.get('level',''))}")
    print(f"    {r.get('message','')}")
    bits = [f"{k}={c[k]}" for k in ("site", "file", "url", "httpStatus", "code", "reason") if c.get(k) not in (None, "")]
    if bits:
        print("    " + "  ".join(bits))
    err = c.get("error") or {}
    if err.get("message"):
        print(f"    -> {err['message']}")
    if err.get("stack"):
        for ln in str(err["stack"]).split("\n")[1:6]:
            print(f"       {ln.strip()}")
    print()
print(f"{n} failure(s)", file=sys.stderr)
PY
}

# --- commands ----------------------------------------------------------------------
cmd_recent() {  # $1 count, $2 format
  local n="${1:-$RECENT_DEFAULT}"
  is_count "$n" || die "N must be a whole number, 1 or more (for example: ./logs.sh recent 100) — got '$n'"
  [ -d "$LOGS_DIR" ] || die "no directory $LOGS_DIR — run ./run-full-audit.sh first"
  local f files=()
  for f in "$LOGS_DIR"/errors-*.csv; do [ -f "$f" ] && files+=("$f"); done
  [ ${#files[@]} -gt 0 ] || die "no errors-<runId>.csv files in $LOGS_DIR yet — one is written per run only when a document fails to audit (./logs.sh list shows what is there)"
  render "$2" "$n" "${files[@]}"
}

cmd_run() {  # $1 runId (optional), $2 format
  [ -d "$LOGS_DIR" ] || die "no directory $LOGS_DIR — run ./run-full-audit.sh first"
  local id="${1:-}"
  if [ -z "$id" ]; then
    id="$(newest_runid)"
    [ -n "$id" ] || die "no error logs in $LOGS_DIR yet — a run writes errors-<runId>.csv only when a document fails to audit (./logs.sh list shows what is there)"
  fi
  local f="$LOGS_DIR/errors-$id.csv"
  [ -f "$f" ] || die "no errors-$id.csv in $LOGS_DIR — ./logs.sh list shows which runs are on file"
  render "$2" 0 "$f"
}

cmd_errors() {  # $1 runId (optional)
  [ -d "$LOGS_DIR" ] || die "no directory $LOGS_DIR — run ./run-full-audit.sh first"
  local id="${1:-}"
  if [ -z "$id" ]; then
    id="$(newest_runid)"
    [ -n "$id" ] || { echo "no error logs yet in $LOGS_DIR" >&2; return 0; }
  fi
  local f="$LOGS_DIR/errors-$id.ndjson"
  [ -f "$f" ] || die "no errors-$id.ndjson in $LOGS_DIR — ./logs.sh list shows which runs are on file"
  render_ndjson "$f"
}

cmd_grep() {  # $1 pattern, $2 runId (optional)
  local pattern="${1:-}"; [ -n "$pattern" ] || die "usage: grep PATTERN [runId] (for example: ./logs.sh grep timeout)"
  [ -d "$LOGS_DIR" ] || die "no directory $LOGS_DIR"
  local id="${2:-}"
  if [ -n "$id" ]; then
    local f="$LOGS_DIR/errors-$id.ndjson"
    [ -f "$f" ] || die "no errors-$id.ndjson in $LOGS_DIR"
    grep -n -i -- "$pattern" "$f" || echo "(no match for '$pattern' in errors-$id.ndjson)"
  else
    grep -n -i -- "$pattern" "$LOGS_DIR"/errors-*.ndjson 2>/dev/null || echo "(no match for '$pattern' in any error log)"
  fi
}

cmd_list() {  # $1 count
  local n="${1:-$LIST_DEFAULT}"
  is_count "$n" || die "N must be a whole number, 1 or more (for example: ./logs.sh list 30) — got '$n'"
  [ -d "$LOGS_DIR" ] || die "no directory $LOGS_DIR — run ./run-full-audit.sh first"
  # sed rather than head: head closes the pipe early and ls dies of SIGPIPE under pipefail
  ls -lt "$LOGS_DIR" | sed -n "1,$((n + 1))p"
}

cmd_tail() {
  [ -d "$LOGS_DIR" ] || die "no directory $LOGS_DIR — run ./run-full-audit.sh first"
  local f; f="$(ls -1t "$LOGS_DIR"/*.log 2>/dev/null | head -1)"
  [ -n "$f" ] || die "no run transcripts (*.log) in $LOGS_DIR yet"
  echo "following $(basename "$f") (Ctrl-C to stop)" >&2
  tail -n 50 -F "$f"
}

# --- dispatch -----------------------------------------------------------------------
main() {
  local cmd="" copy=0 fmt="" positional=()
  for a in "$@"; do
    case "$a" in
      --copy) copy=1 ;;
      --table|--csv|--tsv|--md) fmt="${a#--}" ;;
      -h|--help|help) usage; return 0 ;;
      --*) die "unknown option '$a' — the formats are --table, --csv, --tsv, --md, and --copy (./logs.sh help)" ;;
      *) positional+=("$a") ;;
    esac
  done
  cmd="${positional[0]:-recent}"
  positional=(${positional[@]+"${positional[@]:1}"})
  # Shortcuts: ./logs.sh 20260824-124619Z = run RUNID; ./logs.sh 200 = recent 200
  if is_runid "$cmd"; then
    positional=("$cmd" ${positional[@]+"${positional[@]}"}); cmd=run
  elif is_count "$cmd"; then
    positional=("$cmd" ${positional[@]+"${positional[@]}"}); cmd=recent
  fi

  case "$cmd" in
    tail) ;;  # no sink: follows the file
    recent|run|errors|grep|list) ;;
    *) die "unknown command '$cmd' — the commands are: $COMMANDS (./logs.sh help explains each)" ;;
  esac

  # Default format: a table for a person at a terminal, the raw file for a pipe,
  # TSV for the clipboard (it pastes into a spreadsheet as columns).
  if [ -z "$fmt" ]; then
    if [ "$copy" = 1 ]; then fmt="tsv"; elif [ -t 1 ]; then fmt="table"; else fmt="csv"; fi
  fi

  local out
  case "$cmd" in
    recent) out="$(cmd_recent "${positional[0]:-}" "$fmt")" ;;
    run)    out="$(cmd_run "${positional[0]:-}" "$fmt")" ;;
    errors) out="$(cmd_errors "${positional[0]:-}")" ;;
    grep)   out="$(cmd_grep "${positional[0]:-}" "${positional[1]:-}")" ;;
    list)   out="$(cmd_list "${positional[0]:-}")" ;;
    tail)   cmd_tail; return 0 ;;
  esac
  [ -n "$out" ] || return 0   # nothing to show (the reason, if any, is already on stderr)

  local sink="page"; [ "$copy" = 1 ] && sink="clip"
  printf '%s\n' "$out" | $sink
}

main "$@"
