# Office scoring — design spec

**Date:** 2026-08-17 · **Target release:** v1.53.0 · **Status:** approved design, pre-implementation

## Goal

Score modern Office documents (`.docx`, `.xlsx`, `.pptx`) through the same
audit.icjia.app API that scores PDFs, blend those scores into the site and
fleet file-accessibility averages, and give legacy Office files an honest
"can't be machine-scored" verdict. Today the fleet shows scores for 3,180
PDFs while 1,425 Office-family files sit unscored with "N/A (Office)".

## Decisions (made with the user, 2026-08-17)

1. **Blend into averages.** The site/fleet file-accessibility number becomes
   "average across all machine-scoreable documents", not a PDF-only average.
   Scope-change framing in What's New, same playbook as the archive re-add.
2. **Legacy files get a verdict, not API calls.** `.doc/.xls/.ppt` (and
   `.rtf/.odt/.ods/.odp`) are never sent to the API — the outcome is known
   (confirmed live: HTTP 422 "legacy format that cannot be audited").
3. **Extension-based gate.** Scoreable = extension `pdf|docx|xlsx|pptx`.
   Category alone is unsafe: `office-document` also contains `.rtf/.odt`,
   `spreadsheet` contains `.ods`, `presentation` contains `.odp`, and
   pre-v1.39.0 cached inventories can carry `.doc` under the modern slugs.
4. **Strict score, as for PDFs.** `score-fetcher` already reads only the
   `strict` profile; Office responses carry the same shape. No change.
5. **Same bands, min-5 rule now counts documents.** Thresholds (≥80 Closer /
   ≥60 Partial / else Far) unchanged; `MIN_SCORED_PDFS = 5` generalizes to
   scored documents.

## Ground truth (measured 2026-08-17)

### Fleet inventory (bundle 2026-08-17T13-13-24Z, 8,762 files)

| Group | Count | Notes |
|---|---|---|
| Scoreable OOXML | **674** | 383 docx · 278 xlsx · 13 pptx |
| Legacy binary | **748** | 709 xls · 39 doc (no .ppt on the fleet) |
| Other unscoreable | 3 | 1 rtf · 2 odt |
| Over the 25 MB cap | 2 | 1 xlsx · 1 pptx → "Too large" verdict via 413 |
| Scored PDFs today | 3,180 | plus 22 unscoreable PDFs |

Per-site OOXML/legacy/scored-PDFs: ICJIA 218/697/914 · Archive 199/7/1209 ·
ARI 95/17/318 · ILFVCC 50/7/87 · Infonet 35/3/8 · Intranet 26/17/250 ·
r3 23/0/86 · Research Hub 20/0/239 · DVFR 6/0/66 · SFS 1/0/1 · i2i 1/0/1.
Notable: **Infonet's average becomes Office-dominated** (35 vs 8);
**93% of legacy files live on ICJIA main**.

### audit.icjia.app URL-audit contract (verified in code + live probes)

- Detection is content-sniffed (magic bytes / OOXML parts), never extension.
- Success shape identical to PDF: `{filename, pageCount, audited,
  strict:{score,grade}, practical:{score,grade}, reportId, reportUrl,
  reportExpiresAt, cached}`. `pageCount` = pages/slides/sheets; filecap
  discards it (unchanged). Shareable `/report/<id>` works for Office.
- Live probes: docx → 79 C · xlsx → 79 C · pptx → 64 D · legacy xls → 422.
- Errors: **413** download over 25 MB (`ANALYSIS.MAX_FILE_SIZE_MB`, all
  formats) · **422** legacy format / unsupported format / corrupt OOXML
  (`*_PARSE_FAILED`) · **415** format disabled via env flag · **504**
  analysis timeout (20 s wall clock, "too complex") · **503** busy
  (retryable; filecap's fetcher already retries 429/502/503/504).
- Same 100/min per-IP rate limit as PDFs; OOXML analysis runs in a child
  process with per-format element caps (30 MB uncompressed per ZIP part).
- Office scores use format-specific category weights renormalized onto the
  shared 0–100 + letter-grade scale (docx: no reading-order/forms/bookmarks;
  pptx: slide-titles category; xlsx: sheet-oriented checks). Comparable as a
  directional gauge, which is all the fleet number claims to be.

## Changes

### 1. Canonical gate — `src/scanner/category.js`

Add beside `REMEDIABLE_CATEGORIES` (the v1.40.0 anti-drift precedent):

- `SCOREABLE_EXTENSIONS = new Set(["pdf", "docx", "xlsx", "pptx"])`
- `isScoreable(entry)` — extension-based, tolerant of the category drift
  noted in Decision 3.
- `isUnscoreableDocument(entry)` — remediable but not machine-scoreable:
  legacy-office plus rtf/odt/ods/odp (equivalent to
  `isRemediable(category) && !isScoreable(entry)`, named for the tallies).

Consumers replace their own gates:
- `src/commands/audits.js:41` `isScoreableEntry` → `isScoreable`.
- `src/commands/web-rollup.js:1001` and `src/report/html.js:502` tallies.
- `src/report/csv.js:193-221` cell formatters.
- `src/web/unscored-guard.js` tally.

### 2. Audits command — `src/commands/audits.js`

- Send every `isScoreable` entry with a resolvable URL to the API (cache
  unchanged: sha256-keyed, 30-day TTL, format-neutral).
- Log copy: "N PDFs to audit" → "N documents to audit"; module header and
  `bin/filecap.js` help text updated (`:287-289`, `:311`, `:145`).
- Legacy/other unscoreable entries: no API call, no `entry.audit` — they are
  identified at render time by the canonical helpers (no new NDJSON field;
  keeps old bundles readable and the schema untouched).

### 3. Aggregation — blended averages

`src/report/accessibility-band.js`:
- `MIN_SCORED_PDFS` → `MIN_SCORED_DOCS = 5` (value unchanged).
- `summarizeFileA11y` input renames: `auditedPdfCount` → `auditedDocCount`
  (scored documents); the derived `office = remediable − pdfs` subtraction is replaced
  by an explicit `unscoreable` count passed in by both tallies (legacy +
  rtf/odt/ods/odp). Scope note at `:8-12` rewritten.
- `fileA11yCoverageText`: "X of Y remediable files scored · 748 legacy Office
  files can't be machine-scored — re-saving as .docx/.xlsx/.pptx makes them
  scoreable — remediable files only, not all files."
- `fileA11yThinDataText`: "PDFs" → "documents" ("Only 3 documents scored so
  far — too few for a reliable score (needs 5).").

Both tally sites (`web-rollup.js:1001-1021`, `html.js:502-516`) widen from
`cat === "pdf"` to `isScoreable(entry)` and additionally count unscoreable
remediable files. The summary contract gains the `unscoreable` field;
`byGrade` blends all scored documents.

`src/web/unscored-guard.js`: counts scoreable documents; warning copy
"N documents scoreable, 0 scored" (condition stays zero-of-many).

### 4. Per-file cells — workbooks and detail pages

`src/report/csv.js`:
- `formatRemediationScore`: scored → `"B/88"` · scoreable-with-error →
  `"Not scored"` · legacy/odf → `"N/A (legacy format)"` · non-remediable → `""`.
- `formatAuditScoreNum` / `formatAuditGrade` / pageCount gate: `category !==
  "pdf"` gates become `isScoreable` (pageCount stays PDF-only — measured
  pages exist only for PDFs; `page-estimate.js` untouched).

`src/report/html.js` audit-report cell (`:205-223`) is already
format-agnostic — Office rows gain "Open report" links with no change. The
`:664-671` remediation cell tint already uses `bandForScore`; its text comes
from the updated formatter. Comment blocks at `:185-204` updated.

The search index, search page, search workbook, and XLSX hyperlink layers
are verified format-agnostic — zero changes.

### 5. Error taxonomy — format-aware

`src/audits/retrying-fetcher.js:139-141`: on a non-OK response, read the
JSON body's `error` field (best-effort) and append it to the thrown message
— `HTTP 422 Unprocessable Entity for <url> — The fetched Excel file could
not be read.` Benefits PDFs too; the regexes in the categorizer keep
matching (status code still present).

`src/report/audit-errors.js`:
- 422 branch: format-aware wording — PDF keeps "not actually a PDF"; Office
  becomes "not a valid Word/Excel/PowerPoint file — corrupt or mislabeled".
- 413 "too-large" reasons: PDF branches unchanged (introspection-aware);
  non-PDF gets a format-neutral reason without the "split into parts under
  25 MB" PDF advice.
- 504 timeouts already categorize as `audit-unavailable` (retryable) — copy
  gains "very large or complex documents can time out".
- Legacy files never reach this page (no API call, no `audit.error`).

`src/report/audit-errors-page.js:111` lede and `src/web/index-page.js:155`
blurb updated to mention document (not just PDF) errors.

### 6. Copy inventory (user-visible strings to rewrite)

- `src/web/index-page.js:120-121` — flagship "Scores cover PDFs only…"
  section; new text explains PDF + modern Office scoring and the legacy
  exception. Also `:643` donut caption, `:653` empty state, `:685` card head
  "File accessibility (documents)", `:632-634` comment.
- `src/report/html.js:453` detail banner head, `:483-485` comment.
- `src/report/scores-by-site.js` columns: "PDFs"→"Documents scoreable",
  "PDFs scored"→"Documents scored", "% PDFs scored"→"% scored",
  "Avg PDF score"→"Avg score", "Office files (not scored)"→"Legacy Office
  (not scoreable)"; `officeCount` becomes the unscoreable count.
- `src/commands/web-rollup.js:730-738` `audit-fleet-context.md` shape docs.
- Historical What's New entries and their tests stay untouched (past-state
  descriptions). New What's New entry written at release time with measured
  numbers (see Release).
- Out of scope: "score any PDF" nav titles for the File Audit Tool link
  (describes that tool's upload page, still accurate), duplicate-scope copy,
  page-estimate workload copy.

### 7. Tests

- `test/audits-orchestrator.test.js` — the "does NOT score xlsx/docx/pptx"
  pin inverts; add fixtures proving docx/xlsx/pptx are sent, legacy/rtf are
  not, and Office errors record like PDF errors.
- Update pins: `report-accessibility-band` (renames + unscoreable +
  coverage/thin-data strings), `unscored-guard` (copy), `report-remediation-
  score` ("N/A (legacy format)" split), `report-audit-errors` (format-aware
  422/413), `report-html` (labels, blended tally), `index-page` (labels),
  `scores-by-site` (columns), `report-xlsx`/`report-csv` (Office score cells
  now filled), `web-rollup*` (summary contract + guard), `category` (new
  helpers).
- New coverage: search-index Office-row-with-score fixture (existing gap).

### 8. Release (v1.53.0)

1. Implement + full suite green.
2. Score run: per-site `filecap audits` over existing inventories (no
   re-scan) with `FILECAP_AUDIT_TOKEN` set — ~674 fresh calls, ~10 min.
   Expect: 2 × 413 "Too large", a handful of parse failures.
3. Rebundle, then **reconcile before deploying**: fleet/site averages,
   "X of Y scored" coverage lines, scores-by-site workbook, search page,
   audit-errors page, hero counts — every number a manager sees must agree
   (house rule).
4. Write the What's New scope-change entry with the measured movement
   (probes suggest fleet 54 → ~57; measure, don't predict). CHANGELOG,
   version bump, commit/tag/push, `web-rollup` deploy, live verify in
   Chrome via rendered DOM.
5. Update project memory (fleet numbers change materially).

## Out of scope

- Converting/scoring legacy `.doc/.xls/.ppt` (they need re-saving in modern
  formats first — that's content-owner work the verdict copy now requests).
- The audit app's upload path, page audits, and `pageCount` for Office.
- Any change to bands, thresholds, or the remediation-list definition.
- Historical What's New entries.
