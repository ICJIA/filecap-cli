# @icjia/filecap

**File inventory CLI for accessibility audit scoping.**

`filecap` walks a directory tree, introspects each file (PDFs, DOCX, XLSX), and produces a structured NDJSON inventory suitable for accessibility remediation scoping. The primary use case is generating per-server inventories of file stores (Strapi `/uploads` directories, general file servers) to hand to remediation vendors so they can produce a defensible, fixed-price quote on ADA Title II / WCAG 2.1 AA remediation work.

## Are you a...

- **Manager** running an organization that has to comply with accessibility law? → [Manager TL;DR](#tldr-for-managers)
- **Developer** evaluating this for technical fit? → [Developer TL;DR](#tldr-for-developers)
- **Accessibility vendor or auditor** receiving an inventory? → [Vendor / auditor TL;DR](#tldr-for-vendors-and-auditors)
- **Just curious** about what problem this solves? → [Curious-onlooker TL;DR](#tldr-for-the-curious)

---

## TL;DR for managers

You run a website. Like most websites, it hosts hundreds or thousands of uploaded documents — PDFs of meeting minutes, Word documents of policies, image attachments, spreadsheets. Federal accessibility law (ADA Title II / WCAG 2.1 AA) requires those files to be accessible to people with disabilities.

To budget the remediation work, you need to know what's actually there: file counts by type, which PDFs are scanned images (need OCR — often substantially more expensive than tagging born-digital PDFs), which Word docs lack heading structure, which tables are missing header rows, and so on.

`filecap` produces this inventory automatically. It walks your website's `/uploads` folder, parses every file, and writes a spreadsheet (CSV) plus an interactive HTML report with one row per file and detailed accessibility-relevant metadata. You hand the spreadsheet to a remediation vendor; they give you a fixed-price quote with confidence.

The included `audit-remote.sh` script automates the entire workflow against any server you have SSH access to. Auditors run one command, answer a few prompts, and get a vendor-ready deliverable. Works on macOS, Linux, and Windows (via WSL2). Free; open source.

**Three things you, as a manager, get out of this:**
1. A precise count of files needing remediation, with composition (not just `wc -l`).
2. A spreadsheet you can email to bid-out vendors without explanation.
3. Repeatability — re-run quarterly, see what changed.

→ Skip to [Quick start for managers](#quick-start-for-managers) for handoff instructions.

---

## TL;DR for developers

Node.js CLI written in ESM, distributed via npm as `@icjia/filecap`. Walks a directory tree (concurrent-bounded), produces line-delimited JSON (NDJSON): a header line, one entry per file, a footer line. Each entry includes filesystem metadata + SHA-256 hash + format-specific introspection (pdfjs-dist for PDFs, jszip + fast-xml-parser for DOCX, exceljs for XLSX). 58-column CSV writer + self-contained HTML report with sortable/filterable client-side JS. Cross-server rollup with content-duplicate detection via SHA-256.

Includes an MCP server (`filecap mcp`) exposing `filecap_scan`, `filecap_rollup`, `filecap_report`, and `filecap_query_inventory` as tools for AI agents (Claude Desktop, Claude Code, Cursor, Windsurf, Continue).

Two distribution shapes: `filecap` CLI invoked directly via npx, plus standalone bash scripts (`audit-remote.sh`, `audit-fleet.sh`) auditors curl from GitHub raw URLs. The bash scripts handle SSH preflight, rsync mirroring (for older Ubuntu servers that can't run Node 20+), and post-scan path rewriting so the resulting CSV reflects source-server paths regardless of where filecap actually ran.

ESM-only. Node 20+ required. ~25 test files; 200+ tests via vitest. Source under `src/`; entrypoint `bin/filecap.js`. License: MIT.

→ Skip to [Quick start](#quick-start) for installation and basic usage.

---

## TL;DR for vendors and auditors

You receive an `audit-file-list.csv` (30 columns, one row per file) with everything needed to scope and quote a remediation engagement:

- **Identification**: server name, website nickname, server IP, source folder on server, full path, absolute path, public URL, filename, extension, category.
- **Filesystem metadata**: size in bytes, last-modified timestamp, SHA-256 content hash (for cross-server dedup detection).
- **PDF introspection**: page count, has-text-layer (Yes/No), image-only flag (signals OCR needed), tag presence, form fields, encryption, document language.
- **DOCX introspection**: has-headings, image count, alt-text coverage, table count, tables-have-headers, vague-link count ("click here", "read more").
- **XLSX introspection**: sheet count.
- **Office-legacy flag**: whether the file is in a legacy Office format (`.doc`, `.xls`, `.ppt`).

The "Server IP" and "Full file path on server" columns identify exactly where each file lives — you ssh into the server and download the file directly. Optionally accompanied by an `audit-file-list.html` rendering of the same data with sortable/searchable browser-based interface.

Zero account creation; the inventory is a vendor-neutral structured file you can ingest into your own tooling.

→ Skip to [Report workflow](#report-workflow-phase-6) for the full output spec.

---

## TL;DR for the curious

filecap was originally built at ICJIA (the [Illinois Criminal Justice Information Authority](https://icjia.illinois.gov)) to inventory the document files on our agency's public-facing websites — PDFs of meeting agendas, annual reports, statutes, etc. Federal accessibility law requires those files to be reachable for screen-readers, keyboard navigation, and assistive technology, but figuring out exactly *which* files need *which* kind of work, across multiple servers, was a manual job that took weeks.

The tool is general-purpose. Any organization that hosts public-facing document repositories — government agencies, schools, libraries, nonprofits, businesses — can use it to scope their accessibility work. The output is a spreadsheet a remediation vendor can quote against, line by line.

The complexity in filecap exists because "is this PDF accessible?" is a much harder question than "does this file exist?" Answering it requires actually opening every file and inspecting its internal structure — see the [next section](#just-count-the-files-all-right--why-filecap-is-more-than-wc--l) for why this matters.

→ See the project page on GitHub: https://github.com/ICJIA/filecap-cli

---

## "Just count the files, all right?" — why filecap is more than `wc -l`

Imagine asking a remediation vendor for a quote. They say "I need to see the files first." You forward them a list of filenames and sizes. They reply: "Great — but how many are scanned PDFs vs born-digital? How many Word docs lack heading structure? How many tables are missing header rows? Without that detail, my quote will be the worst-case price for every single file."

That's why filecap exists. A simple `find . -type f` gives you filenames and sizes — but a vendor can't price accurately against that. They'll either give you a worst-case quote (you overpay), or insist on inspecting every file themselves (the audit takes weeks instead of hours).

filecap is built around one question: **what does a remediation vendor need to know, per file, to give a defensible fixed-price quote?** Every "complexity" in this tool answers a specific vendor question:

| Vendor question | What filecap captures |
|---|---|
| Is this PDF a scan (needs OCR — often substantially more expensive)? | `isImageOnly`, `hasTextLayer`, `textLayerCoverage` |
| Is this PDF already partly accessible? | `hasTags`, `hasOutline`, `documentLanguage` |
| Does this PDF need special handling? | `encrypted`, `hasFormFields`, `hasSignatures` |
| Is this Word doc structured for screen readers? | `hasHeadings`, `headingLevelsUsed` (gap detection) |
| Are tables marked up for accessibility? | `tableCount`, `tablesHaveHeaders` |
| Do images have alt text? | `imageCount`, `altTextCoverage` |
| Are hyperlinks descriptive? | `vagueLinkCount` (counts "click here", "read more", etc.) |
| Are spreadsheets navigable for screen readers? | `mergedCellCount`, `defaultSheetNameCount`, `hasHeaderRows` |
| Do the same files appear on multiple servers? | `sha256` content hash + `duplicateOf` cross-server linking |
| Are filenames human-readable? | filename heuristic flags |

**The cost of NOT having this information is often substantially greater than the cost of running filecap.** Scanned PDFs typically cost vendors substantially more to remediate than born-digital ones, because OCR + tagging is an order of magnitude more work than tagging alone. If your inventory has 100 PDFs and 30 of them are scanned, knowing that distinction affects the vendor quote materially.

filecap takes a few seconds per file to extract this metadata — and produces a spreadsheet a vendor can price line by line. That's the whole game.

So: yes, "just count the files" is a one-liner. But the count alone won't help you budget for compliance. The detail is the point.

---

## Table of contents

- [Are you a...](#are-you-a)
  - [TL;DR for managers](#tldr-for-managers)
  - [TL;DR for developers](#tldr-for-developers)
  - [TL;DR for vendors and auditors](#tldr-for-vendors-and-auditors)
  - [TL;DR for the curious](#tldr-for-the-curious)
- ["Just count the files, all right?"](#just-count-the-files-all-right--why-filecap-is-more-than-wc--l)
- [Status](#status)
- [Quick start](#quick-start)
- [Quick start for managers](#quick-start-for-managers)
- [CLI reference](#cli-reference)
- [Multi-server workflow](#multi-server-workflow)
- [NDJSON output format](#ndjson-output-format)
- [What gets introspected](#what-gets-introspected)
- [Filename flags](#filename-flags-phase-4)
- [Rollup workflow](#rollup-workflow-phase-5)
- [Report workflow](#report-workflow-phase-6)
- [MCP server](#mcp-server-phase-7)
- [For auditors: self-contained audit scripts](#for-auditors-self-contained-audit-scripts)
- [What filecap does not do](#what-filecap-does-not-do)
- [Troubleshooting](#troubleshooting)
- [License](#license)
- [Related tools](#related-icjia-tools)

---

## Status

**v1.0.3 shipped.** MCP server, full vendor handoff pipeline, self-contained audit scripts, and comprehensive per-file introspection are all live. The full inventory pipeline `scan → rollup → report` is end-to-end functional. Timestamped audit history, optional website nicknames, and self-version-checking audit scripts landed in 1.0.2–1.0.3.

The full design specification lives at [`docs/filecap-design.md`](docs/filecap-design.md).

| Phase | Version | Status | Deliverable |
|---|---|---|---|
| 1 | v0.1.0 | shipped | Core scan — recursive walk, hashing, NDJSON output |
| 2 | v0.2.0 | shipped | PDF introspection (image-only, tags, producer, signatures, language) |
| 3 | v0.3.0 | shipped | Office introspection (DOCX, XLSX, legacy flag) |
| 4 | v0.4.0 | shipped | Filename flagging |
| 5 | v0.5.0 | shipped | Multi-server rollup |
| 6 | v0.6.0 | shipped | CSV reporter and summary artifacts |
| 7 | v1.0.0 | shipped | MCP server entry point |
| 8 | v1.0.1 | shipped | MCP client docs (Claude Desktop, Claude Code, Cursor, Windsurf, Continue) |
| 9 | v1.0.2 | shipped | Audit automation scripts, HTML report, enhanced metadata, auditor-readable output |
| 10 | v1.0.3 | shipped | Self-version-check, timestamped runs, `--site-name` flag, README overhaul |
| — | vNext | deferred | Strapi-aware mode (separate package) |

## Quick start

```bash
npx --yes @icjia/filecap scan /var/strapi/uploads
# → writes filecap-<hostname>.ndjson in cwd
```

The output is line-delimited JSON: one header line, one line per file, one footer line.

## Quick start for managers

If you're handing this off to an auditor or accessibility coordinator, copy the block below verbatim. They have everything they need.

> **For the auditor:**
>
> 1. Make sure you have macOS, Linux, or Windows-with-WSL2 installed (see [Windows: the situation](#windows-the-situation) below if you're on Windows).
> 2. Make sure you have Node.js 20+ installed (https://nodejs.org).
> 3. Make sure you have SSH access to the target server.
> 4. Run these three commands:
>
>    ```bash
>    curl -O https://raw.githubusercontent.com/ICJIA/filecap-cli/main/examples/audit-remote.sh
>    chmod +x audit-remote.sh
>    ./audit-remote.sh
>    ```
>
> 5. Answer the prompts (SSH user, server IP, path to uploads, optional website nickname).
> 6. The deliverable is at `~/filecap-audits/<server-ip>/latest/report/`. Open `audit-file-list.csv` (Excel/Numbers/Sheets) or `audit-file-list.html` (any browser).
> 7. Email the entire `report/` folder to your remediation vendor.

## CLI reference

### `filecap scan <directory>`

| Flag | Default | Description |

|---|---|---|
| `-o, --output <path>` | `filecap-<hostname>.ndjson` | Output path (use `-` for stdout) |
| `-s, --server-name <name>` | `os.hostname()` | Override server identifier in metadata |
| `--server-ip <ip>` | auto-detected | Override server IP (defaults to first non-loopback IPv4) |
| `--site-name <name>` | (none) | Optional website nickname (e.g., DVFR or any short site nickname). Used as a human-friendly identifier alongside `--server-name`. |
| `--no-hash` | (off) | Skip SHA-256 hashing (much faster, but no dedup) |
| `--no-introspect` | (off) | Skip PDF/Office introspection (filesystem stats only) |
| `--max-introspect-mb <n>` | `200` | Skip introspection for files larger than this |
| `--include-ext <list>` | (all) | Comma-separated extensions to include |
| `--exclude-ext <list>` | (none) | Comma-separated extensions to exclude |
| `--concurrency <n>` | `4` | Parallel introspection/hashing workers |
| `--progress` | (off) | Emit progress to stderr |
| `--quiet` | (off) | Suppress non-error output |

**Exit codes.** `0` success, `1` argument or runtime error, `2` directory not readable, `3` partial completion.

### `filecap rollup <files...>`

Merge multiple per-server NDJSONs into a consolidated inventory.

| Flag | Default | Description |
|---|---|---|
| `-o, --output <path>` | `consolidated.ndjson` | Output path |
| `--strict` | (off) | Fail on schema mismatch or missing footer in any input (default: warn and skip) |

### `filecap report <inventory>`

Generate vendor handoff package (CSV + summary + flagged lists) from an inventory NDJSON (single-instance or consolidated).

| Flag | Default | Description |
|---|---|---|
| `-o, --output <dir>` | `./filecap-report-<ts>/` | Output directory |
| `--html` | (off) | Also write a self-contained sortable HTML report (`audit-file-list.html`) |

### `filecap mcp`

Starts an stdio MCP server for use with AI agent clients (Claude Desktop, Claude Code, Cursor, etc.). No flags — configuration is handled by the client.

## Multi-server workflow

When scanning multiple servers from a single coordinator with SSH access:

```bash
ssh deploy@strapi-prod-01 "npx --yes @icjia/filecap scan /var/strapi/uploads -o -" \
  > ./inventories/strapi-prod-01.ndjson
```

The `-o -` flag writes NDJSON to stdout, which SSH transports back. Compute (walk, hash, introspection) happens on the remote; only the inventory output crosses the network.

A sample bash orchestrator is in [`examples/multi-scan.sh`](examples/multi-scan.sh).

## NDJSON output format

Line-delimited JSON. First line: header (scan metadata). Last line: footer (summary stats). Lines in between: one per file.

**Example header:**

```json
{
  "schemaVersion": 1,
  "kind": "filecap-inventory-header",
  "metadata": {
    "siteName": "DVFR",
    "serverName": "dvfr-strapi-prod",
    "hostname": "dvfr-strapi-prod",
    "serverIp": "192.241.146.85",
    "scannedPath": "/var/strapi/uploads",
    "scannedAt": "2026-05-09T14:23:11.000Z",
    "filecapVersion": "1.0.3",
    "nodeVersion": "20.19.0",
    "options": { "introspect": true, "hash": true, "maxIntrospectMb": 200, "concurrency": 4 }
  }
}
```

`siteName` is optional. Omitting it is valid. Old inventories without it continue to validate.

**Example file entry (PDF):**

```json
{
  "path": "2024/reports/annual-report.pdf",
  "absolutePath": "/var/strapi/uploads/2024/reports/annual-report.pdf",
  "filename": "annual-report.pdf",
  "extension": "pdf",
  "category": "pdf",
  "remediable": true,
  "sizeBytes": 4827193,
  "modifiedAt": "2024-03-12T09:14:22.000Z",
  "sha256": "e3b0c44...",
  "flags": [],
  "introspection": {
    "kind": "pdf",
    "pageCount": 48,
    "hasTextLayer": true,
    "textLayerCoverage": 1.0,
    "isImageOnly": false,
    "hasTags": false,
    "hasOutline": true,
    "hasFormFields": false,
    "hasSignatures": false,
    "encrypted": false,
    "documentLanguage": "en-US",
    "producer": "Adobe PDF Library 15.0",
    "creator": "Adobe InDesign CC 2019",
    "creationDate": "2024-03-10T08:00:00.000Z",
    "title": "DVFR Annual Report 2024",
    "author": "Illinois Criminal Justice Information Authority",
    "subject": "Annual Report",
    "keywords": null,
    "modificationDate": null,
    "approxWordCount": 14230
  }
}
```

**Example file entry (DOCX):**

```json
{
  "path": "2024/policies/handbook.docx",
  "absolutePath": "/var/strapi/uploads/2024/policies/handbook.docx",
  "filename": "handbook.docx",
  "extension": "docx",
  "category": "office-document",
  "remediable": true,
  "sizeBytes": 152340,
  "modifiedAt": "2024-06-15T13:00:00.000Z",
  "sha256": "a1b2c3d4...",
  "flags": [],
  "introspection": {
    "kind": "docx",
    "hasHeadings": true,
    "imageCount": 5,
    "altTextCoverage": 0.8,
    "tableCount": 3,
    "tablesHaveHeaders": true,
    "hyperlinkCount": 12,
    "vagueLinkCount": 2,
    "documentLanguage": "en-US",
    "title": "Staff Handbook",
    "author": "HR Department",
    "lastModifiedBy": "Jane Smith",
    "wordCount": 8450,
    "paragraphCount": 342,
    "headingLevelsUsed": ["H1", "H2", "H4"]
  }
}
```

Note: `headingLevelsUsed: ["H1", "H2", "H4"]` signals a missing H3 — a heading gap that can confuse screen reader navigation.

**Example file entry (XLSX):**

```json
{
  "path": "2024/data/budget.xlsx",
  "absolutePath": "/var/strapi/uploads/2024/data/budget.xlsx",
  "filename": "budget.xlsx",
  "extension": "xlsx",
  "category": "spreadsheet",
  "remediable": true,
  "sizeBytes": 48720,
  "modifiedAt": "2024-04-01T09:00:00.000Z",
  "sha256": "f9e8d7c6...",
  "flags": [],
  "introspection": {
    "kind": "xlsx",
    "sheetCount": 4,
    "sheetNames": ["Summary", "Q1", "Q2", "Sheet4"],
    "defaultSheetNameCount": 1,
    "hasHeaderRows": true,
    "mergedCellCount": 3,
    "hasCharts": true,
    "hasImages": false,
    "title": "FY2024 Budget",
    "author": "Finance",
    "totalCells": 14400
  }
}
```

**Example file entry (legacy `.doc`):**

```json
{
  "path": "archive/2010-memo.doc",
  "filename": "2010-memo.doc",
  "extension": "doc",
  "category": "office-document",
  "remediable": true,
  "introspection": {
    "kind": "office-legacy",
    "format": "doc"
  }
}
```

The presence of `kind: "office-legacy"` is itself the signal: this file needs manual review with Office or an upgrade to a modern format before remediation.

## What gets introspected

### PDF

| Field | What it tells you |
|---|---|
| `pageCount`, `hasTextLayer`, `textLayerCoverage`, `isImageOnly` | Text vs. scanned content |
| `hasTags` | PDF structure tags (most important PDF a11y feature) |
| `hasFormFields`, `hasSignatures` | Specialized remediation requirements |
| `producer`, `creator` | Strong triage signal (born-digital vs. OCR'd from paper) |
| `documentLanguage`, `creationDate`, `pdfVersion` | Document metadata |
| `encrypted`, `isLinearized`, `hasOutline` | Structural state |
| `title`, `author`, `subject`, `keywords` | Embedded PDF metadata (often the actual document name, vs. a hashed filename) |
| `modificationDate` | PDF-internal modification timestamp (separate from filesystem mtime) |
| `approxWordCount` | Sum of word counts across all pages (signals document complexity) |

### DOCX

| Field | What it tells you |
|---|---|
| `hasHeadings` | Document uses Word heading styles (essential for screen-reader navigation) |
| `imageCount`, `altTextCoverage` | Number of images and what fraction have alt text |
| `tableCount`, `tablesHaveHeaders` | Table count and whether any table has marked header rows |
| `hyperlinkCount`, `vagueLinkCount` | Total links and how many use ambiguous text ("click here", "read more") |
| `documentLanguage` | Declared language (WCAG 3.1.1) |
| `title`, `author`, `lastModifiedBy` | From `docProps/core.xml` — useful for document identification |
| `wordCount` | From `docProps/app.xml` — signals document complexity |
| `paragraphCount` | Count of paragraph elements |
| `headingLevelsUsed` | Sorted unique array of heading levels actually used (e.g., `["H1", "H2", "H4"]` flags an H3 gap) |

### XLSX

| Field | What it tells you |
|---|---|
| `sheetCount`, `sheetNames` | Total sheets and their names |
| `defaultSheetNameCount` | Sheets named `Sheet1`/`Sheet2`/etc. (lazy naming → screen reader hostility) |
| `hasHeaderRows` | At least one sheet has a styled (bold) first row |
| `mergedCellCount` | Total merged cell ranges across all sheets (accessibility anti-pattern) |
| `hasCharts`, `hasImages` | Embedded objects |
| `title`, `author` | From `core.xml` — document identification metadata |
| `totalCells` | Sum of cell counts across all sheets (signals spreadsheet complexity) |

### Legacy `.doc/.ppt/.xls`

Flagged by extension only — `kind: "office-legacy"` with the specific format. These binary formats need Office or specialized tools to inspect.

When introspection fails (corrupt file, unsupported variant, parse exception), the `introspection` field is omitted from the entry. The file row still appears with full filesystem stats.

Files larger than `--max-introspect-mb` (default 200) skip introspection regardless of type.

## Filename flags (Phase 4)

Every entry's `flags[]` array is populated with applicable filename-heuristic flags. Vendors filter and sort the inventory CSV by these flags during triage:

| Flag | When applied |
|---|---|
| `scanned-name-pattern` | Filename matches scanner / photo / default-output naming: `Scan_001.pdf`, `IMG_4567.jpg`, `Document1.docx`, `Untitled-1.pdf`, `12345.tiff`, `DOC001.pdf`, `FAX-2024-04-12.pdf`, `Microsoft Word - draft.pdf`, etc. Strong signal that the file is an unprocessed export from a scanner, phone camera, or default save-as. |
| `filename-has-spaces` | Basename contains whitespace. URL-encoded spaces (`%20`) are a common source of CMS friction and copy-paste bugs. |
| `filename-non-ascii` | Basename contains characters outside the printable ASCII range (e.g., `résumé.pdf`, `文件.docx`). Web-server URL handling and some legacy systems still mishandle these. |
| `filename-long` | Basename exceeds 200 characters. Long names cause filesystem truncation and URL length issues. |

Flags are emitted as a sorted array; the CSV reporter joins them with `|` for spreadsheet consumption.

A file with no triggered flags has `flags: []` (empty array).

## Rollup workflow (Phase 5)

After scanning N servers, merge the per-server NDJSONs into a consolidated inventory:

```bash
filecap rollup ./inventories/*.ndjson -o consolidated.ndjson
```

The consolidated NDJSON has the same line-delimited structure as a single-instance inventory but with three differences:

1. **Header.** `kind: "filecap-consolidated-header"` and `metadata.sources` is an array with one entry per source inventory (each carrying the original server identity, scan options, and stats).
2. **Entries.** Each entry gains `serverName: string` (which source it came from) and `duplicateOf: {serverName, path} | null`. Content-duplicates (identical SHA-256 across servers) get `duplicateOf` set to the canonical copy. The canonical entry has `duplicateOf: null`.
3. **Footer.** `kind: "filecap-consolidated-footer"` with cross-instance stats: `totalUniqueHashes`, `totalDuplicateGroups`, `bytesSavedIfDeduped` (bytes that could be reclaimed by deleting non-canonical duplicates).

**Why one row per physical copy?** Each duplicate entry in the consolidated CSV represents real disk space someone has to decide to keep or delete. The `duplicateOf` link tells the consumer "this is the same content as `<serverName>:<path>`" so a vendor can group by hash for de-dup analysis OR filter to canonicals only for remediation work. Both views are one query away.

**Canonical-pick rule.** When two or more entries share a SHA-256, the canonical is the one with the oldest `modifiedAt`. Ties are broken alphabetically by `serverName`. The canonical entry has `duplicateOf: null`; all others have `duplicateOf: {serverName, path}` pointing at it.

**Example consolidated entry (canonical):**

```json
{
  "path": "2024/case-001.pdf",
  "filename": "case-001.pdf",
  "extension": "pdf",
  "category": "pdf",
  "remediable": true,
  "sizeBytes": 4827193,
  "modifiedAt": "2024-03-12T09:14:22.000Z",
  "sha256": "e3b0c44...",
  "flags": [],
  "serverName": "strapi-prod-01",
  "duplicateOf": null
}
```

**Example consolidated entry (duplicate):**

```json
{
  "path": "archive/case-001-copy.pdf",
  "filename": "case-001-copy.pdf",
  "extension": "pdf",
  "category": "pdf",
  "remediable": true,
  "sizeBytes": 4827193,
  "modifiedAt": "2024-08-01T12:30:00.000Z",
  "sha256": "e3b0c44...",
  "flags": [],
  "serverName": "strapi-prod-02",
  "duplicateOf": { "serverName": "strapi-prod-01", "path": "2024/case-001.pdf" }
}
```

## Report workflow (Phase 6)

Generate the vendor handoff package from an inventory NDJSON (single-instance or consolidated):

```bash
filecap report consolidated.ndjson -o ./report-2026-Q2/
filecap report consolidated.ndjson -o ./report-2026-Q2/ --html   # also writes audit-file-list.html
```

Output directory contents:

| File | Purpose |
|---|---|
| `audit-file-list.csv` | One row per file, 30 columns (the work-order vendors actually consume). Human-readable column headers. Booleans render as Yes/No. Filterable in Excel, Smartsheet, etc. |
| `audit-file-list.html` | (Only when `--html` is passed.) Self-contained interactive page — same data, sortable columns, full-text search, no external dependencies. Image-only PDFs highlighted. |
| `audit-summary.txt` | Manager-friendly top-line numbers: file counts by category, total bytes, image-only PDF count, remediable count, heading coverage, alt-text coverage, and "What this means" observation bullets. |
| `README.txt` | Plain-text guide to all files in this folder. Start here if you're not sure which file to open. |
| `largest_files.txt` | Top 50 files by size (helps schedule the biggest remediation work) |
| `flagged_filenames.txt` | Files whose `flags[]` includes scanned-original or filename anti-patterns |
| `duplicate_hashes.txt` | Content-duplicate groups (entries sharing a SHA-256) — useful for de-dup analysis |
| `pdf_image_only.txt` | PDFs with `isImageOnly: true` — the headline cost driver in PDF remediation |

The CSV is pure inventory — there are NO vendor-fill columns. Vendors return remediated files; ICJIA re-scans and uses a future `filecap diff` command to detect changes. This division-of-labor decision is documented in the design doc and locks vendor workflow out of the inventory tool itself.

**CSV column order** (30 columns, stable):

`Server, Website, Server IP, Last modified, Needs remediation, Source folder on server, File location (relative to source folder), Full file path on server, Public URL, File name, File extension, File type, Size (bytes), Content hash (SHA-256), Duplicate of, PDF: page count, PDF: has searchable text, PDF: image-only (needs OCR), PDF: structurally tagged, PDF: has form fields, PDF: encrypted, Document language, DOCX: has headings, DOCX: image count, DOCX: alt-text coverage (fraction), DOCX: table count, DOCX: tables have header rows, DOCX: vague hyperlinks ("click here"), XLSX: sheet count, Legacy Office format`

Column headers are human-facing labels (not raw field names). Empty cells indicate the field doesn't apply to this file's type.

**Inputs.** `filecap report` accepts BOTH a single-instance NDJSON (from `filecap scan`) and a consolidated NDJSON (from `filecap rollup`). For consolidated inputs, the per-entry `serverName` is used and `serverIp` / `hostname` are looked up from the header's `metadata.sources[]` array. Both input shapes produce the same 30-column CSV — the consumer doesn't need to know which scanner/rollup pipeline produced the data.

## MCP server (Phase 7)

`filecap mcp` starts an stdio MCP server that exposes four tools AI agents can call during conversational audits:

| Tool | What it does |
|---|---|
| `filecap_scan` | Walk a directory, produce an NDJSON inventory at the specified path |
| `filecap_rollup` | Merge multiple per-server NDJSONs into a consolidated inventory |
| `filecap_report` | Generate vendor handoff package (CSV + summary + flagged lists) |
| `filecap_query_inventory` | Filter/sort entries in an existing NDJSON by size, extension, flags, isImageOnly, etc. |

### Always-latest config (recommended)

Pin to `@latest` (or omit the version tag entirely) so the host re-checks the npm registry each time it spawns the MCP process. This guarantees you pick up new tool definitions and bug fixes without touching your config file:

```json
"args": ["--yes", "@icjia/filecap@latest", "mcp"]
```

All client snippets below use this form.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, or `%APPDATA%\Claude\claude_desktop_config.json` on Windows. Restart Claude Desktop after saving.

```json
{
  "mcpServers": {
    "filecap": {
      "command": "npx",
      "args": ["--yes", "@icjia/filecap@latest", "mcp"]
    }
  }
}
```

### Claude Code

`.claude/mcp.json` in your project root for project-scoped access, or `~/.claude/mcp.json` for user-global access:

```json
{
  "mcpServers": {
    "filecap": {
      "command": "npx",
      "args": ["--yes", "@icjia/filecap@latest", "mcp"]
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` (also configurable in-app at Settings → Features → MCP):

```json
{
  "mcpServers": {
    "filecap": {
      "command": "npx",
      "args": ["--yes", "@icjia/filecap@latest", "mcp"]
    }
  }
}
```

### Windsurf (Codeium)

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "filecap": {
      "command": "npx",
      "args": ["--yes", "@icjia/filecap@latest", "mcp"]
    }
  }
}
```

### Continue

`~/.continue/config.json` for user-global access, or `.continue/config.json` in your project root for project-scoped access. Continue uses a different shape — MCP servers go under `experimental.modelContextProtocolServers`:

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "npx",
          "args": ["--yes", "@icjia/filecap@latest", "mcp"]
        }
      }
    ]
  }
}
```

### How auto-update works

When you use `@latest`, npx checks the npm registry on each spawn. If a newer version has been published, npx downloads it before starting the server — typically 1–3 seconds of additional startup time. If the installed version is already current, npx reuses the cached package with no network round-trip.

For zero startup overhead with explicit update control, install globally instead:

```bash
npm install -g @icjia/filecap
```

Then reference the binary directly in your client config:

```json
{
  "mcpServers": {
    "filecap": {
      "command": "filecap",
      "args": ["mcp"]
    }
  }
}
```

To update: `npm install -g @icjia/filecap@latest`.

### Verifying it works

After wiring up your client, ask the AI agent:

- "Run filecap_scan on /var/strapi/uploads with introspection enabled, write to /tmp/strapi.ndjson"
- "Use filecap_query_inventory on /tmp/consolidated.ndjson to find PDFs over 100 MB on server strapi-prod-02"
- "Generate a report from /tmp/consolidated.ndjson into /tmp/report-2026-Q2/"

If the tools are registered correctly, the agent will call them directly rather than suggesting you run the CLI manually.

## For auditors: self-contained audit scripts

### What this is

`filecap` is a tool for taking a complete inventory of the document files stored on a remote web server — typically the `/uploads` folder of a Strapi-powered website — so that a remediation vendor can see exactly what work is needed and produce a defensible, fixed-price quote. It works by connecting to the server over SSH, walking the entire file tree, and recording structured metadata about each file: PDF page counts, whether a PDF is image-only (scanned), DOCX heading structure, alt-text coverage, and more. The result is a spreadsheet (CSV) the vendor can open in Excel, plus an optional interactive web page (HTML) you can open in any browser for review meetings. No files on the server are modified — this is a read-only audit.

### What you'll need

Check this list before running anything. All five items are required.

1. **A computer running macOS, Linux, or Windows with WSL2.** Standard Mac and Linux terminals work out of the box. Windows users need one extra setup step — see [Windows: the situation](#windows-the-situation) below for a plain-language explanation of why, and how to fix it in about 5 minutes.

2. **SSH access to the remote server.** This means you (or your IT team) already have a username and an SSH key configured for the target machine. The default username for ICJIA Strapi servers is `forge`. If you can already run `ssh forge@<server-ip>` and get a prompt, you're ready. If not, you'll need your server administrator to set this up before running the audit.

3. **Node.js 20 or newer installed on your local machine.** Node is the JavaScript runtime the tool uses; it's free and widely used. Check whether it's already installed by opening a terminal and typing `node --version`. If you see `v20.x.x` or higher, you're done. If not:
   - macOS: `brew install node` (if you have Homebrew) or download the installer from https://nodejs.org
   - Ubuntu/Linux: `sudo apt install -y nodejs` or download from https://nodejs.org
   - Windows (WSL2/Ubuntu): see the [Windows](#windows-the-situation) section

4. **`npx` available in your terminal.** `npx` comes bundled with Node.js 20+ — if you have Node, you have `npx`. It's the tool that downloads and runs `filecap` automatically; you don't have to install `filecap` separately.

5. **`bash`, `ssh`, `rsync`, and `python3` available.** These are pre-installed on every Mac (macOS 12+), every modern Ubuntu/Debian Linux, and every WSL2/Ubuntu environment. You don't need to do anything. The scripts check for these at startup and tell you if something is missing.

### How to use it (single server)

Three commands. The first downloads the script, the second makes it executable, the third runs it:

```bash
curl -O https://raw.githubusercontent.com/ICJIA/filecap-cli/main/examples/audit-remote.sh
chmod +x audit-remote.sh
./audit-remote.sh
```

The script walks you through the rest interactively. It asks a few questions (see below), connects to the server, collects the inventory, and writes the output to `~/filecap-audits/<server-ip>/latest/report/`. When it's done, it prints the path to the results.

If you already know all the details and want to skip the prompts, you can pass them directly:

```bash
./audit-remote.sh forge 192.241.146.85 ~/dvfr.icjia-api.cloud/strapi_v4/public/uploads dvfr-strapi-prod
```

### What you'll be asked

In interactive mode, the script asks a few questions. Here's what each one means and what a sensible answer looks like:

- **(If saved sites exist, you'll see a menu first — pick a number to skip the per-field prompts.)**
- **SSH username** — The login name on the remote server. Defaults to `forge` (the ICJIA Strapi convention). Press Enter to accept the default, or type a different name if your server uses one.
- **Server IP or hostname** — The address of the server you're auditing. Examples: `192.241.146.85` or `strapi-prod-01.example.com`. Required — empty values are not accepted.
- **Full path to the uploads folder on the remote** — Where the files live on the server. Example: `~/dvfr.icjia-api.cloud/strapi_v4/public/uploads`. Your server administrator can confirm this path. Required — empty values are not accepted.
- **Friendly server name** — A human-readable label (the technical identifier) used in report headings. Defaults to `strapi-<IP-with-dashes>` (e.g., `strapi-192-241-146-85`). Optional — press Enter to accept the default, or type something like `dvfr-strapi-prod`.
- **Website nickname** — An optional short name managers and vendors use to identify the site (e.g., `DVFR`, `i2i`, `vpp`, `infonet`). Different from the server name — this is the business-facing identity. Press Enter to skip if you don't have one.

### What you get

After the script finishes, navigate to `~/filecap-audits/<server-ip>/latest/report/`. You'll find:

- **`audit-file-list.csv`** — The main deliverable. One row per file, 30 columns covering file type, size, PDF page count, image-only flag, DOCX heading and alt-text data, and more. Open in Excel, Google Sheets, or Numbers. This is what you hand to the remediation vendor.
- **`audit-summary.txt`** — Top-line numbers: total files by type, total storage, how many PDFs are image-only, how many documents are remediable. Good for an executive summary or a project charter.
- **`audit-file-list.html`** — A self-contained web page version of the same data. Open in any browser — no internet connection required. Supports sorting by any column, full-text search, and print-to-PDF. (Set `AUDIT_HTML=0` in the environment to suppress this file on rare occasions when you don't want it.)
- **`README.txt`** — A plain-text guide to all the files in this folder. Start here if you're not sure which file to open.
- **`largest_files.txt`** — The top 50 files by size. Helpful for scheduling the most time-consuming remediation work first.
- **`flagged_filenames.txt`** — Files whose names suggest they're scanned documents or unprocessed camera photos (`Scan_001.pdf`, `IMG_4567.pdf`, etc.) — typically the highest-cost items to remediate.
- **`duplicate_hashes.txt`** — Files that are byte-for-byte identical to another file on the server. Useful for identifying redundant copies before remediation.
- **`pdf_image_only.txt`** — PDFs that contain no text layer — they're essentially photos of pages. These require OCR before any accessibility remediation can begin, and they're usually the cost driver in a vendor quote.

The run directory also contains `inventory.ndjson` (the raw scan data used to generate the report) and `SOURCE_INFO.txt` (a provenance record: which server was scanned, when, and how to SSH in and locate a specific file).

### Why two file counts?

The deliverable shows **two** numbers, deliberately:

- **Audit work** (e.g., 69) — files that need actual accessibility remediation: PDFs, Word docs, Excel sheets, PowerPoint, legacy Office files. These are what your remediation vendor will quote against.
- **Reference files** (e.g., 33) — files that are inventoried but don't need direct work: images (their alt text lives in your CMS schema, not in the JPEG), text files (`.txt`, `.md`), `.gitkeep` placeholders, etc. They're listed for completeness so the inventory is comprehensive, but no remediator will touch them.

The HTML report opens filtered to "Remediable only" by default. Click the "All" chip to see everything; click a category chip to drill into a specific type.

### Saved sites — type each site's config once

If you audit the same fleet repeatedly, the script remembers each site's config in `~/.filecap/sites.json` so you don't re-type the SSH user, IP, remote path, etc. every run.

On startup, the script offers a menu:

```
Saved sites:
  1. DVFR (dvfr-strapi-prod) — forge@192.241.146.85
  2. i2i (i2i-strapi-prod) — forge@10.0.0.5

  Type a number 1-2 to select a saved site
    a  →  add a new site
    e  →  edit a saved site
    d  →  delete a saved site
    p  →  preflight all saved sites (verify SSH + path + file count)
    s  →  skip (one-off prompts, don't save)
    q  →  quit
```

Picking a number loads the site's full config and jumps straight to the **config review screen** (where you can override any field for this run by typing its number).

Picking `a` walks you through the prompts for a new site. At the end, the script asks "Save these settings as a named site for next time? [y/N]". Answer yes and the site is selectable from the menu thereafter.

The file is created with mode `600` (user-only readable) inside `~/.filecap/` (mode `700`). Override the location with `FILECAP_SITES_FILE=/some/path` if you want to keep multiple sets of saved sites.

### Preflight all saved sites

The `p` option in the saved-sites menu runs a quick health check across every saved site. For each: SSH connectivity, remote path existence + readability, file count via `find`. Prints a status table:

```
  Nickname           Server name            Host               SSH      Path     Files    Notes
  ------------------ ---------------------- ------------------ -------- -------- -------- ----------------
  DVFR               dvfr-strapi-prod       192.241.146.85     OK       OK       102
  i2i                i2i-strapi-prod        10.0.0.5           FAIL     -        -        SSH connect failed
  VPP                vpp-strapi-prod        10.0.0.6           OK       OK       0        directory is empty
```

Useful for catching SSH key drift, moved-or-renamed remote paths, and unexpectedly empty directories before running a full audit. ~5 seconds per site (sequential SSH probes).

The preflight is read-only — no rsync, no scan, no audit. It returns to the menu when complete so you can still pick a site to audit (or fix issues first).

### Sharing saved sites — auditor onboarding

When external auditors join a project, you typically want them up and running fast. Two new menu options make this trivial:

- **`x → export all sites to a JSON file`** — writes the current saved sites to a path you choose (default `~/Desktop/icjia-sites.json`). The file contains hostnames, paths, nicknames, and public URLs — but no credentials.
- **`i → import sites from a JSON file`** — reads a sites JSON file, previews what would be imported, and asks: merge (add new sites by name, skip names that already exist) / replace (wipe current sites + use only the imported ones) / cancel.

The intended workflow:

1. **Admin** configures every site once on their machine (or imports an existing list).
2. **Admin** picks `x → export`, enters a path, hands the resulting JSON file to each visiting auditor (email, secure file share, USB stick).
3. **Each auditor** receives the file plus their own SSH access (configured separately by the admin).
4. **Auditor** runs `./audit-remote.sh` for the first time on their machine. The menu shows just `a / i / s / q` (no saved sites yet).
5. **Auditor** picks `i → import`, pastes the path to the JSON file. Picks `m` for merge.
6. Menu now shows the full fleet. Auditor picks a site number and runs an audit. Total onboarding time after SSH setup: ~30 seconds.

The import option is shown in the menu **even when there are no saved sites yet**, so first-time auditors with a fresh machine see it immediately.

If you want to keep multiple unrelated sets of sites (different clients, different fleets), set `FILECAP_SITES_FILE=/path/to/other-sites.json` in your shell to point at a different file. Each `FILECAP_SITES_FILE` value is its own independent saved-sites bundle.

### Required-input validation and always-HTML

A few smaller UX improvements:

- **Server IP and remote path are required** — empty values re-prompt with "(required — please type a value)". No more silent acceptance leading to confusing later failures.
- **HTML report is always produced alongside the CSV** — no more "generate HTML?" prompt. Set `AUDIT_HTML=0` in the environment to opt out (rare).
- **Config review with per-field correction** — review screen lets you fix any field by typing its number (1-9). The screen re-renders so you can keep adjusting until everything's right, then press Enter to proceed.

### How to use it (multiple servers / fleet mode)

If you're responsible for more than one server, the fleet script runs the single-server audit on each one and then produces a combined report across all of them.

```bash
curl -O https://raw.githubusercontent.com/ICJIA/filecap-cli/main/examples/audit-fleet.sh
curl -O https://raw.githubusercontent.com/ICJIA/filecap-cli/main/examples/audit-remote.sh
chmod +x audit-fleet.sh audit-remote.sh
./audit-fleet.sh
```

Or, if you have a list of servers ready, pass it as a CSV file:

```bash
./audit-fleet.sh servers.csv
```

The servers.csv format (no header row; `#` lines are comments). An optional 5th column adds the website nickname:

```
# server_name,user,host,remote_path[,site_name]
dvfr-strapi-prod,forge,192.241.146.85,~/dvfr.icjia-api.cloud/strapi_v4/public/uploads,DVFR
i2i-strapi-prod,forge,10.0.0.5,/var/strapi/uploads,i2i
vpp-strapi-prod,forge,10.0.0.6,/var/strapi/uploads
# (the third row has no site_name — that's allowed; old 4-column CSVs still work)
```

Output lands in `~/filecap-audits/_fleet/<timestamp>/` and includes a per-server breakdown (`MANAGER_SUMMARY.txt`), a combined CSV (`audit-file-list.csv`) with one row per file across all servers, and a `duplicate_hashes.txt` that catches files that appear on multiple servers.

### Re-running audits over time

Running the audit against the same server multiple times preserves history. Each run lands in its own timestamped subdirectory under `~/filecap-audits/<server-ip>/runs/`, and a `latest/` symlink at the workdir root points to the most recent successful run.

```
~/filecap-audits/192.241.146.85/
├── mirror/                              (shared local copy)
├── runs/
│   ├── 20260509-143000Z/                ← May 9 audit
│   │   ├── inventory.ndjson
│   │   └── report/
│   ├── 20260516-093000Z/                ← May 16 audit
│   └── 20260523-100000Z/                ← May 23 audit
└── latest → runs/20260523-100000Z       (always points to most recent run)
```

Practical implications:

- **The `mirror/` directory is shared across runs.** rsync handles incremental updates — only changed files transfer each time, so subsequent runs are fast.
- **Each run is self-contained.** You can zip `runs/<timestamp>/` and email it without including any other run.
- **The `latest/` symlink is your shortcut to "the current report":** `open ~/filecap-audits/<ip>/latest/report/audit-file-list.csv`.
- **Old runs accumulate.** They're tiny (typically tens to hundreds of KB each) but if you're running daily over many months, you may want to occasionally `rm -rf` the oldest runs.
- **No conflicts when re-running** — two runs in the same minute would land in distinct timestamped dirs (UTC seconds resolution).

The fleet script (`audit-fleet.sh`) follows the same pattern: each fleet run goes to `~/filecap-audits/_fleet/<timestamp>/` and a `~/filecap-audits/_fleet/latest` symlink points to the most recent run.

### Staying current

The audit scripts have a built-in version check. Each time you run them, they compare their content against the latest version on GitHub and warn you if your local copy is outdated. The check happens at startup, takes ~1 second, and is non-blocking — if it can't reach GitHub (e.g., you're offline), it just notes that and continues.

If your script is out of date, you'll see a yellow warning telling you the exact `curl` command to run to get the latest version.

To skip the check (e.g., on an air-gapped system or for faster startup):

```bash
./audit-remote.sh --no-version-check
# or
SKIP_VERSION_CHECK=1 ./audit-remote.sh
```

The `filecap` package itself (which the script invokes via `npx`) auto-updates separately on each run — it always pulls the latest from npm.

---

### Windows: the situation

If you're on a Windows machine and wondering why you can't just double-click the script or run it in PowerShell, here's the full explanation — and a straightforward fix.

#### Why this script doesn't run natively on Windows

The audit scripts depend on four tools that come from the Unix world. Here's what each one does and why there's no drop-in Windows replacement:

1. **The script is written in `bash`, the standard Unix shell.** Bash has been the native command line on Mac and Linux since 1989. Windows has two different command languages — PowerShell (the modern one) and cmd.exe (the older one) — and they use an entirely different vocabulary. A bash script is not something either of them can read directly, any more than a Spanish speaker can read Japanese without translation.

2. **The script depends on `rsync`, a Unix file-transfer tool with no Windows equivalent.** `rsync` does three things simultaneously: it copies files, transfers them over SSH, and only re-transfers what has changed since the last run. Windows has separate tools for each of those pieces (`robocopy` for local copying, `scp` for SSH transfer) but nothing that combines all three. We use `rsync` because it makes re-running an audit fast and reliable — subsequent runs on the same server take a fraction of the time.

3. **The script uses `python3` for some glue logic.** Python itself runs fine on Windows, but the way Unix scripts invoke it (via a "shebang line" — the `#!/usr/bin/env python3` at the top of a file) is a Unix convention that Windows ignores. So even if Python is installed, Windows doesn't know to use it when our script calls for it.

4. **Unix and Windows use different file path conventions.** A file in your home folder is `~/filecap-audits` on Mac/Linux but `C:\Users\YourName\filecap-audits` on Windows — different separators, different home-directory conventions. A script written for one won't translate to the other without rewriting all the path-handling code.

5. **More broadly: Unix shell scripting is a 50-year-old tradition.** What takes one line in bash often takes 5–10 lines in PowerShell because the two ecosystems developed separately. A clean Windows port isn't a translation pass — it's a full rewrite, with its own test coverage and long-term maintenance. (See [Native PowerShell support — on the roadmap](#native-powershell-support--on-the-roadmap) below for our current thinking on this.)

#### What Microsoft recommends: WSL2

WSL2 — Windows Subsystem for Linux, version 2 — is **Microsoft's official answer** to exactly this problem. They built it because Windows developer customers were missing out on the rich ecosystem of Unix tools, and they needed a first-class solution. It's not a workaround; it's a supported Microsoft product.

**What WSL2 actually is:**

- A real Linux operating system running inside Windows. Specifically, you install Ubuntu Linux (recommended) alongside your normal Windows installation.
- It runs in a lightweight virtual machine that starts in under a second and uses negligible memory when you're not actively using it.
- It's not a separate computer or a separate login. WSL2's filesystem can see your Windows files (your `C:` drive shows up inside Linux at `/mnt/c/`), and Windows Explorer can browse your WSL2 files (under `\\wsl.localhost\Ubuntu\`). The two sides coexist cleanly.
- It's built into Windows 10 and 11. No separate purchase, no third-party software.

**Why Ubuntu specifically:**

- Ubuntu is the most widely used Linux distribution in the world, and most cross-platform Unix tools are tested on it first.
- Ubuntu publishes Long-Term Support (LTS) releases — currently 22.04 and 24.04 — that receive security updates for at least five years.
- The audit scripts have been tested on macOS and Ubuntu. Other Linux distributions (Debian, Fedora, Arch) almost certainly work, but aren't formally tested.

#### How to install WSL2 with Ubuntu

This is a one-time setup. Subsequent audit runs need no admin rights and no extra steps.

```powershell
# Open PowerShell as Administrator.
# (Right-click the Start button, choose "Windows PowerShell (Admin)" or "Terminal (Admin)".)
# Then run this single command:
wsl --install
```

That one command installs both WSL2 and Ubuntu. When it finishes, reboot your computer when prompted.

After the reboot, find "Ubuntu" in your Start menu and open it. The first time you launch it, Ubuntu asks you to choose a username and password for the Linux side — these are independent of your Windows login and can be anything you like.

Then, inside the Ubuntu terminal, install Node.js and run the audit:

```bash
# Install Node.js 20 (the audit scripts require Node 20 or newer):
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Confirm it worked:
node --version    # should print v20.x.x

# Now run the audit exactly as you would on a Mac or Linux machine:
curl -O https://raw.githubusercontent.com/ICJIA/filecap-cli/main/examples/audit-remote.sh
chmod +x audit-remote.sh
./audit-remote.sh
```

#### Common questions from Windows users

**Will WSL2 slow down my computer?**
No. The Linux environment uses essentially no resources when you're not actively running something in it. It's not running in the background.

**Will WSL2 see my Windows files?**
Yes. Your `C:` drive appears inside Linux at `/mnt/c/`. If you've downloaded files in Windows, you can access them from inside Ubuntu at `/mnt/c/Users/<YourWindowsName>/Downloads/`.

**Will Windows see my WSL2 files?**
Yes. From Windows Explorer, navigate to `\\wsl.localhost\Ubuntu\home\<your-linux-username>\` to browse WSL2 files. Audit CSVs generated inside WSL2 can be opened directly in Excel or any Windows browser without copying them anywhere.

**Can I delete WSL2 later if I don't want it?**
Yes, completely. Run `wsl --unregister Ubuntu` in PowerShell and the Linux environment is gone with no leftovers. WSL2 itself can also be uninstalled through Windows Settings → Apps.

**Do I need administrator rights?**
Yes, for the initial WSL2 install. After that, day-to-day use (opening Ubuntu, running audit scripts) does not require admin rights.

**Will my company's antivirus or IT department block this?**
Usually no — Microsoft officially endorses WSL2, and most enterprise antivirus products treat it as a known-good Microsoft component. However, some tightly locked-down corporate machines do disable it via Group Policy. If `wsl --install` fails with a permissions error, contact your IT department and ask them to enable WSL2 (specifically: enable the "Windows Subsystem for Linux" optional feature and the "Virtual Machine Platform" optional feature). This is a routine request.

**What if my company really won't allow WSL2?**
You have a couple of options. First, another team member on a Mac or Linux machine can run the audit and email you the resulting CSV and HTML files — the audit itself doesn't need to run on your machine. Second, native PowerShell support is on our roadmap (see below). If your organization genuinely cannot use WSL2, please open an issue so we can gauge demand.

#### Native PowerShell support — on the roadmap

A native Windows/PowerShell version of the audit scripts is possible, but it's a meaningful engineering project rather than a quick port. The work involved: approximately 1,500 lines of net-new PowerShell, a replacement for `rsync` over SSH (likely `robocopy` + `scp` with resumption logic), replacements for the inline Python helpers, full path-translation between Windows and Unix conventions, and a separate test matrix across PowerShell 5.1 and 7 on both Windows 10 and Windows 11. Estimated effort: 2–3 focused days of development plus ongoing maintenance as Windows tooling evolves.

We'll prioritize this if there's clear demand from organizations that genuinely cannot use WSL2. If that's your team, please open an issue at https://github.com/ICJIA/filecap-cli/issues with a brief description of why WSL2 isn't viable — that information directly informs our roadmap.

---

### Output structure reference

For completeness, the full directory layout written by `audit-remote.sh`:

```
~/filecap-audits/<server-ip>/
├── mirror/                     Local rsync copy of remote files (shared across runs)
├── runs/
│   ├── 20260509-143000Z/       Each run gets its own timestamped subdirectory (UTC)
│   │   ├── SOURCE_INFO.txt     Provenance — server, path, audit timestamp, find-a-file recipe
│   │   ├── inventory.ndjson    Raw scan output (one entry per file)
│   │   └── report/
│   │       ├── README.txt              Explains all artifacts (start here)
│   │       ├── audit-file-list.csv     The vendor work-order, one row per file
│   │       ├── audit-file-list.html    (only if --html or "yes" answered at the prompt)
│   │       ├── audit-summary.txt       Manager-friendly counts by category and PDF/DOCX/XLSX detail
│   │       ├── largest_files.txt       Top files by size
│   │       ├── flagged_filenames.txt   Files with name patterns suggesting scanned/IMG-prefixed origin
│   │       ├── duplicate_hashes.txt    Content-identical files (by SHA-256)
│   │       └── pdf_image_only.txt      PDFs with no text layer (require OCR before remediation)
│   ├── 20260516-093000Z/
│   └── 20260523-100000Z/
└── latest -> runs/20260523-100000Z    Symlink, always points to the most recent successful run
```

And for `audit-fleet.sh`:

```
~/filecap-audits/_fleet/
├── 20260509-134500/
│   ├── servers.txt                   List of servers audited
│   ├── failed_servers.txt            (only if any audits failed)
│   ├── MANAGER_SUMMARY.txt           Full audit numbers + per-server breakdown
│   ├── inventories/                  Per-server NDJSON inventories
│   ├── consolidated.ndjson           Cross-server consolidated NDJSON
│   └── consolidated-report/
│       ├── README.txt                Explains all artifacts (start here)
│       ├── audit-file-list.csv       One row per file across the entire fleet
│       ├── audit-file-list.html      (only if HTML was requested)
│       ├── audit-summary.txt         Fleet-wide summary with per-server breakdown
│       ├── largest_files.txt
│       ├── flagged_filenames.txt
│       ├── duplicate_hashes.txt
│       └── pdf_image_only.txt
└── latest -> 20260509-134500         Symlink, always points to the most recent fleet run
```

### Technical requirements

- bash 3.2+ (default on macOS; default on Linux and WSL2/Ubuntu)
- python3 (default on macOS 12+; default on most Linux distros and WSL2/Ubuntu)
- ssh (with keys configured for the target server[s])
- rsync
- npx (comes with Node.js 20+; install Node from https://nodejs.org)
- Node.js 20+ locally (the scripts verify this at startup and abort with guidance if the version is too old)

The scripts run a tool-presence and Node-version preflight at startup and abort with clear remediation messages if anything is missing.

### Why local-mode scanning matters

Many production Strapi servers run on Ubuntu 18.04 with Node 16. Prebuilt Node 18+ binaries require glibc 2.28+ (Ubuntu 20+); compiling Node from source on EOL Ubuntu is fragile due to old g++. The `audit-remote.sh` script sidesteps this by detecting Node 16 (or any Node < 20) on the remote and pulling the files down via rsync, then running filecap on the auditor's local machine. The output CSV still records the *source* server's IP and remote path so vendors can ssh in and locate any flagged file — the auditor's local machine is invisible in the deliverable.

## Publishing a fleet snapshot to Netlify

`filecap web-rollup` bundles the most recent scan of every saved site into a single self-contained static-site directory you can share with managers or stakeholders — no server required.

### What the bundle contains

```
~/filecap-audits/_web-rollup/2026-05-10T13-42-00Z/
├── index.html                    landing page: fleet totals + per-site cards
├── robots.txt                    User-agent: *  Disallow: /
├── assets/
│   └── style.css                 shared design tokens
├── dvfr-20260509-160504Z.html    per-site interactive HTML report
├── dvfr-20260509-160504Z.csv     per-site CSV (downloadable)
├── i2i-20260510-093000Z.html
└── i2i-20260510-093000Z.csv
```

The index page shows a fleet overview (total files, files needing remediation, breakdown by type) and one card per site. Each card links directly to that site's HTML report and CSV download.

### Running the rollup

```bash
filecap web-rollup
```

Or with options:

```bash
filecap web-rollup --output ~/Desktop/fleet-snapshot --password "mypassword" --title "ICJIA Fleet — May 2026"
```

The `audit-remote.sh` menu also has a `w` option that prompts for an optional password and calls this command automatically.

### Three deployment paths

**Option A — Netlify drag-and-drop (zero setup)**

1. Visit https://app.netlify.com/drop
2. Drag the entire output directory onto the drop zone
3. Netlify gives you a randomly-named URL within seconds
4. Optionally rename the site in Netlify settings

**Option B — Netlify CLI (scriptable)**

```bash
cd ~/filecap-audits/_web-rollup/2026-05-10T13-42-00Z
netlify deploy --prod --dir .
```

**Option C — Git-connected Netlify site (auto-deploy on push)**

1. Create a private `icjia-filecap-snapshots/` Git repo
2. After each web-rollup, copy the output into the repo, commit, and push
3. Netlify watches the repo and deploys on every push
4. URL stays stable; auditors bookmark it once

### Password gate

Pass `--password` to embed a client-side SHA-256 gate on every page in the bundle. Users see a `prompt()` for the password; correct entry stores a hash in `sessionStorage` so navigation within the session does not re-prompt.

**Caveats — this is "ward off the curious" protection only:**

- Anyone with DevTools or view-source can read the embedded hash
- CSV files served at direct URLs are NOT covered by the prompt
- For real access control use Netlify's paid Visitor Access feature or an HTTP Basic Auth function

### robots.txt

Every bundle includes `robots.txt` with `Disallow: /` and a `<meta name="robots">` noindex tag on every page. This does not prevent direct-URL access but does ask search engines not to index the content.

### Dark-mode reports

The per-site HTML reports (`audit-file-list.html`) and the index page share a single dark-mode design system. This is also the default visual style when `filecap report --html` is run directly — there is no separate light/dark toggle.

## What filecap does not do

- Perform full WCAG conformance auditing (that's [audit.icjia.app](https://audit.icjia.app)'s job, per-file)
- Remediate, fix, or modify any files
- Track vendor remediation status (out of scope — NDJSON inventories are themselves the time-series record)
- Integrate with the Strapi API (deferred to a future release; the core inventory pipeline is format-agnostic)
- Introspect PPTX (deferred to a future phase; current introspection covers DOCX, XLSX, and legacy stubs)

## Troubleshooting

**Scan exits with code 3.** At least one directory was unreadable. The footer's `permissionDenials` count tells you how many.

**`introspection` field missing from a PDF / DOCX / XLSX entry.** filecap couldn't parse this file. Likely causes: malformed file, encrypted, exotic variant. The file still appears in the inventory; vendor's deeper tooling (Acrobat Pro, Office, qpdf) will surface the actual issue.

**Scans are slow on large directories.** Hashing dominates wall time. For triage scans, pass `--no-hash`. For Office-heavy stores, increase `--concurrency`. Skip introspection with `--no-introspect` for filesystem-only inventories.

**pdfjs-dist warning chatter on stderr.** pdfjs-dist emits informational warnings for non-fatal conditions (e.g., "TT: undefined function", unsupported PDF features). These are cosmetic noise — the scan continues and the introspection result is valid. Pipe stderr to `/dev/null` or use `--quiet` if you want a clean terminal.

**EOL Ubuntu / Node 16 / glibc-2.27 on the remote server.** The audit scripts handle this automatically: if the remote server has Node < 20 (or no Node at all), the script falls back to rsync-and-scan-locally. No manual intervention needed. If you're running filecap directly on such a server (not via the audit scripts), you'll need to install a compatible Node version — see [Why local-mode scanning matters](#why-local-mode-scanning-matters).

**rsync `--info=progress2` not supported on macOS.** The audit scripts use a macOS-compatible rsync progress flag. If you're running rsync manually and see this error, use `--progress` instead of `--info=progress2`.

## License

[MIT](LICENSE) © Illinois Criminal Justice Information Authority

## Related @icjia tools

- `@icjia/viewcap` — screenshot capture (MCP)
- `@icjia/lightcap` — Lighthouse audits (MCP)
- `@icjia/axecap` — axe-core accessibility audits (MCP)
- `@icjia/contrastcap` — color contrast auditing (MCP)
- `audit.icjia.app` — full WCAG conformance auditing (per-file)
