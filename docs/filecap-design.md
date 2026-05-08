# @icjia/filecap — Design Document

**File inventory CLI for accessibility audit scoping.**

Status: Design draft for build via Claude Code.
Audience: Implementation reference.

---

## 1. Overview

`filecap` is a Node.js CLI tool that walks a directory tree, introspects each file (with deep-dive support for PDFs and Office docs), and produces a structured NDJSON inventory suitable for accessibility remediation scoping.

**Primary use case.** ICJIA operates ~4–5 file storage locations: several Strapi CMS instances (each with a `/uploads` directory containing thousands of PDFs and Office documents), plus general-purpose file servers. To scope ADA Title II / WCAG 2.1 AA remediation work across these stores, an inventory is needed that goes beyond raw file counts — it must distinguish image-only PDFs from text PDFs, flag scanned-original filename patterns, surface size outliers, and identify true duplicates by content hash. The resulting inventory is handed to remediation vendors as the canonical scope-of-work document.

**Fit in the @icjia toolchain.** filecap follows the same conventions as the existing @icjia MCP suite (viewcap, lightcap, axecap, strapi, plausible, contrastcap):

- Plain JavaScript ES modules (no TypeScript build step)
- Commander.js for CLI argument parsing
- Zod for schema validation of inputs and outputs
- Single npm package, npx-first install (`npx @icjia/filecap …`)
- stdio-based MCP server entry point as a secondary mode (deferred to a later phase)

**Out of scope for v1.** filecap reports *what files exist and their structural accessibility characteristics*. It does **not** do:

- Full WCAG conformance auditing of files (that's audit.icjia.app's job, per-file)
- Remediation, fixing, or modification of any files
- Remediation status tracking, vendor workflow integration, or progress diff between scans (the NDJSON inventories *are* the time-series record; if an explicit diff command is wanted later it can be added against archived inventories without rework)
- Direct integration with the Strapi API (deferred; filesystem-only in v1)
- Web UI (CLI + NDJSON/CSV output only)

---

## 2. Why This Tool Exists

### The problem filecap solves

ICJIA is responsible for the accessibility of every document it publishes — internally and to the public. Under ADA Title II and the IITAA, thousands of PDFs and Office documents scattered across multiple Strapi CMS instances and shared file servers must meet the same WCAG 2.1 AA standards as any web page on icjia.illinois.gov.

ICJIA does not perform document remediation in-house. That work goes to specialized accessibility remediation vendors — *the professionals* — who fix structure tags, add alt text, restructure tables, OCR scanned pages, and produce conformant versions of each document.

The challenge is the handoff. When ICJIA hands a vendor "all the files in `/uploads`," what the vendor receives is a directory tree of thousands of files with no information beyond filenames. They cannot quote the work. They cannot prioritize. They cannot tell the difference between a 2 MB born-digital PDF (fifteen minutes to remediate) and a 400 MB scanned legal record (a full day's work). They will either refuse to quote until they have done their own discovery — which costs ICJIA weeks of calendar time — or pad the quote heavily to hedge against the unknowns. Either way, ICJIA pays for the missing context.

filecap performs that discovery before the handoff. It walks each file store, looks inside every file, and produces a single structured document that tells the vendor exactly what they are dealing with: how many files, what kinds, what sizes, which PDFs have a real text layer, which are scanned image-only, which Office documents already have proper headings, which are duplicates of files in other folders, which have suspicious filename patterns suggesting auto-generated scans. The vendor walks into the project with the same map ICJIA has, and can quote tightly, plan sensibly, and start the actual work on day one instead of week three.

### Who benefits, and how

The following stories describe people who benefit from filecap. None of them is required to know what filecap is, run it themselves, or read NDJSON. They benefit because the output exists.

**The remediation vendor's project manager.** The vendor's intake desk receives an email from ICJIA on Monday asking for a fixed-price quote on remediating the documents at a Strapi instance. Without filecap, the project manager has two options: refuse to quote until the vendor's own team has spent a week doing discovery, or quote high and hope. With filecap, the project manager opens the CSV that ICJIA generated from the consolidated inventory and attached to the email — one row per file, with size, type, server of origin, and the structural details that drive remediation cost (image-only flag, tag presence, page count) — sorts and filters it the way every project manager filters every spreadsheet, and within an hour has the volume numbers needed to quote: 14,800 documents across five instances totaling 84 GB; 4,200 PDFs flagged as image-only (the most expensive line item); 1,800 content-duplicates already counted on other servers; the largest 50 files accounting for 30% of total volume. By Tuesday afternoon a defensible quote is on the desk of whoever asked for it.

**The remediation technician.** This is the person who actually opens each file in a tagging tool and does the work. Without filecap, the technician discovers each file's nature at the moment of opening it — half a day in, surprised by a 300-page scanned exhibit that needs OCR before any tagging can begin, switching tools mid-flow, losing the rhythm. With filecap, the technician's queue is pre-sorted: the simple born-digital PDFs first to build momentum, the image-only batch grouped together so the OCR workflow can run as one pass, the monster files scheduled for fresh-coffee hours. The same volume gets remediated in less time and with fewer mistakes from context-switching.

**The future ICJIA developer.** Six months after the initial remediation pass, ICJIA program staff have uploaded several hundred new documents. Without filecap, those documents accumulate silently and the next compliance review starts from scratch. With filecap, the developer reruns `filecap scan` on each instance, runs `filecap rollup` against the previous baseline, and sees exactly which files are new, which have changed, and which require fresh remediation triage. Compliance becomes a maintainable cycle rather than a one-time project that decays the moment it ships.

**The member of the public using assistive technology.** A paralegal who is blind needs to access an ICJIA case file from 2019 to research precedent for a client. Without proper remediation, the file she finds on icjia.illinois.gov is a scanned-image PDF her screen reader cannot read — she requests an accessible version, waits days, and the request may or may not be fulfilled in time. With remediation already complete (because filecap helped scope the project accurately and the vendor delivered on time), she opens the file and works with it the same way any sighted user does. **filecap does not help her directly. It helps the people whose job it is to make sure she can do hers.** This is the actual point of the tool.

### Institutional benefits

Beyond the people who interact directly with files, filecap produces benefits at the level of the agency as a whole. These are agency-level outcomes, not chores assigned to any particular role.

**Concrete numbers replace qualitative status updates.** ICJIA's accessibility program operates against a hard federal deadline and a finite budget. Without filecap, status reporting necessarily leans qualitative — *"we have many files; we are working on them."* With filecap, the same reports carry numbers that hold up under scrutiny: a count of documents and total volume across all file stores, a percentage of PDFs flagged as image-only and accounting for the bulk of estimated remediation effort, a count of duplicates already consolidated. Re-run three months later, the same command produces a comparable snapshot, and the delta is the story of progress against a known total.

**The output is audit-ready on its face.** ADA Title II compliance is not only a state of a website; it is a state of the *program* that maintains the website. Federal reviewers, state oversight, and any future discovery process expect to see evidence that the agency has been actively managing its obligations, not merely discussing them. filecap's output — timestamped, version-controlled, reproducible — is exactly that kind of evidence. If a reviewer asks what ICJIA knew about its document accessibility posture and when, the answer is in version control, not in someone's memory.

**Vendor contracting becomes defensible.** The first time ICJIA solicits bids on a remediation contract, the bidders will price the unknown. The price of the unknown is always higher than the price of the known. filecap turns the unknown into the known before the RFP goes out, so the agency receives bids on real, scoped work and can compare them on equivalent terms.

**The handoff artifact is a CSV anyone can open.** Although filecap's structured output is NDJSON, the format remediators actually consume is CSV — one row per file, columns for server name, server IP, full path, filename, size, type, modification date, hash, and the per-format accessibility findings (image-only PDF, missing structure tags, alt-text coverage, etc.). A remediation vendor's project manager can drop this CSV directly into Excel, Smartsheet, Asana, or whatever tracking system they use to assign and bill work. No data engineering required on their end. ICJIA produces the NDJSON; `filecap report` produces the CSV from it.

### Why CLI-first (not MCP-first)

The other tools in the @icjia suite — viewcap, lightcap, axecap, contrastcap — are MCP-first. Their natural user is Claude or another AI agent inspecting a website during an interactive audit conversation. The CLI is a secondary entry point: useful, but not central.

filecap inverts the default. Its primary use is unattended batch execution: an engineer SSHs into a file server, runs the command, the inventory is produced, the engineer moves on to the next server. There is no agent in the loop. The output is consumed by other humans (the remediation vendor, ICJIA leadership) and by other tools (audit.icjia.app, spreadsheet trackers, project management systems).

That said, an MCP wrapper is still a worthwhile second entry point — for the cases where someone wants to ask Claude "show me every PDF over 100 MB on the prod-02 instance" against an existing consolidated inventory, or "list the ten Strapi folders with the highest concentration of image-only PDFs." That conversation-style query layer is genuinely useful. It just isn't the critical path. It ships in Phase 7, after the CLI is solid and proven.

The convention going forward in the @icjia suite: **MCP-first** for tools whose primary job is to inform an AI agent's reasoning during interactive audits (web inspection, contrast checks, structured-data lookups). **CLI-first** for tools whose primary job is to produce artifacts consumed by humans and downstream pipelines (inventories, reports, batch transformations). filecap is the first of the second kind.

---

## 3. Workflow

The intended end-to-end flow:

```
┌─────────────────────┐     ┌─────────────────────┐
│  Strapi instance 1  │     │  Strapi instance N  │
│  /var/strapi/uploads│ ... │  /var/strapi/uploads│
└──────────┬──────────┘     └──────────┬──────────┘
           │                           │
           │  ssh + npx @icjia/filecap scan
           │                           │
           ▼                           ▼
   filecap-prod-01.ndjson      filecap-prod-N.ndjson
           │                           │
           └───────────┬───────────────┘
                       │  scp back to primary machine
                       ▼
              ┌──────────────────┐
              │  ~/inventories/  │
              │  *.ndjson        │
              └────────┬─────────┘
                       │  filecap rollup *.ndjson
                       ▼
              consolidated.ndjson
                       │  filecap report consolidated.ndjson
                       ▼
              ┌──────────────────┐
              │  Summary, CSVs,  │
              │  flagged lists   │
              └──────────────────┘
```

**Per-server commands** (run via SSH on each instance):

```bash
npx @icjia/filecap scan /var/strapi/uploads
# writes filecap-<hostname>.ndjson in cwd
```

**On the primary machine** (after scp'ing NDJSONs back):

```bash
filecap rollup ~/inventories/*.ndjson -o consolidated.ndjson
filecap report consolidated.ndjson -o ./report/
```

Hostname is auto-detected via `os.hostname()` and stamped into the NDJSON header metadata. Override with `--server-name <name>` if hostname is meaningless or duplicate.

---

## 4. Architecture

```
@icjia/filecap/
├── bin/
│   └── filecap.js              # CLI entry point (Commander)
├── src/
│   ├── commands/
│   │   ├── scan.js             # `filecap scan <dir>`
│   │   ├── rollup.js           # `filecap rollup <files...>`
│   │   ├── report.js           # `filecap report <consolidated.ndjson>`
│   │   └── mcp.js              # stdio MCP server (Phase 7, deferred)
│   ├── scanner/
│   │   ├── walk.js             # recursive filesystem walk
│   │   ├── stats.js            # size, mtime, ext extraction
│   │   └── hash.js             # SHA-256 streaming hash
│   ├── introspect/
│   │   ├── pdf.js              # pdfjs-dist text-vs-image detection
│   │   ├── docx.js             # mammoth-based docx introspection
│   │   ├── xlsx.js             # exceljs-based xlsx introspection
│   │   └── index.js            # dispatcher by extension
│   ├── flag/
│   │   ├── filename.js         # scan/IMG/Untitled patterns
│   │   └── size.js             # size-based heuristics
│   ├── schema/
│   │   ├── inventory.js        # Zod: single-instance inventory
│   │   └── consolidated.js     # Zod: rollup output
│   ├── rollup/
│   │   ├── merge.js            # combine inventories, link content-duplicates via duplicateOf
│   │   └── group.js            # group-by views (server, ext, size)
│   ├── report/
│   │   ├── summary.js          # human-readable text summary
│   │   ├── csv.js              # CSV exports for tracking systems
│   │   └── flagged.js          # red-flag lists (scanned, dupes, etc.)
│   └── util/
│       ├── progress.js         # progress reporting (TTY + JSON-line)
│       └── concurrency.js      # bounded parallel introspection
├── test/
│   ├── fixtures/               # sample PDFs, docx, etc.
│   └── *.test.js               # vitest
├── publish                     # release script
├── package.json
└── README.md
```

**Concurrency model.** The filesystem walk is single-threaded and fast. Introspection (PDF parsing, hashing) is the slow part; run it in a bounded worker pool (default 4 concurrent, configurable via `--concurrency N`). For a 10,000-file Strapi instance with mostly PDFs, expect ~10–30 minutes on a typical server. The largest individual file set in practice is ~10,000 files; the more common case is 100–1,000.

**Streaming output as NDJSON.** Inventory output is line-delimited JSON (`.ndjson`): one **header line** carrying static metadata (server identity, scan options, schema version), one line per file entry, one **footer line** carrying dynamic stats (`fileCount`, `totalBytes`, `scanDurationMs`, `introspectionFailures`) computed at scan completion. The format is append-only — no seeking, no in-memory buffering of the entry list — so an interrupted scan still produces a file that downstream tools can parse line-by-line. A missing footer is itself a signal: "scan was interrupted, partial inventory only." `rollup` and `report` stream-read their inputs the same way, so memory cost is bounded regardless of inventory size.

---

## 5. CLI Interface

### `filecap scan <directory>`

Walk a directory tree and produce a single-instance inventory NDJSON.

| Flag | Default | Description |
|---|---|---|
| `-o, --output <path>` | `filecap-<hostname>.ndjson` | Output path |
| `-s, --server-name <name>` | `os.hostname()` | Override server identifier in metadata |
| `--server-ip <ip>` | auto-detected | Override server IP stamped into metadata (defaults to first non-loopback IPv4) |
| `--no-introspect` | (off) | Skip PDF/Office introspection (filesystem stats only) |
| `--no-hash` | (off) | Skip SHA-256 hashing (much faster, but no dedup) |
| `--max-introspect-mb <n>` | `200` | Skip introspection for files larger than this |
| `--include-ext <list>` | (all) | Comma-separated extensions to include |
| `--exclude-ext <list>` | (none) | Comma-separated extensions to exclude |
| `--concurrency <n>` | `4` | Parallel introspection workers |
| `--progress` | (off) | Emit progress to stderr |
| `--quiet` | (off) | Suppress non-error output |

**Exit codes.** `0` success, `1` argument error, `2` directory not readable, `3` partial completion (some files unreadable; NDJSON still written, footer line present).

### `filecap rollup <files...>`

Merge multiple single-instance inventories into a consolidated inventory. Performs hash-based deduplication and computes cross-instance statistics.

| Flag | Default | Description |
|---|---|---|
| `-o, --output <path>` | `consolidated.ndjson` | Output path |
| `--strict` | (off) | Fail if any input file has schema mismatch (default: warn and skip) |

### `filecap report <consolidated.ndjson | inventory.ndjson>`

Emit human-readable summaries and CSV exports for handoff to remediators.

| Flag | Default | Description |
|---|---|---|
| `-o, --output <dir>` | `./filecap-report-<timestamp>/` | Output directory |
| `--format <list>` | `summary,csv,flagged` | Comma-separated: `summary`, `csv`, `flagged`, `all` |
| `--per-server` | (off) | Emit one `files-<serverName>.csv` per source server in addition to (or instead of) the consolidated `files.csv` |
| `--csv-only` | (off) | Skip text summaries, emit CSVs only (useful when piping straight to a vendor) |

Outputs:
- `SUMMARY.txt` — top-level numbers, breakdowns, scoping signal
- `files.csv` — every file, every field, one row per file (see column spec below)
- `files-<serverName>.csv` — same shape, one per server, only when `--per-server` is set
- `largest_files.txt` — top 50 by size
- `flagged_filenames.txt` — scanned-original patterns, default names
- `duplicate_hashes.txt` — true content duplicates across folders/servers
- `pdf_image_only.txt` — PDFs detected as image-only (top remediation cost driver)

**`files.csv` column spec.** Stable column order; every column always present (empty string when not applicable to a given file type). Header row included.

| # | Column | Source | Notes |
|---|---|---|---|
| 1 | `serverName` | metadata | e.g., `strapi-prod-01` |
| 2 | `serverIp` | metadata | First non-loopback IPv4 at scan time, or `--server-ip` override |
| 3 | `hostname` | metadata | Full DNS hostname |
| 4 | `scannedPath` | metadata | The root the scan was run against |
| 5 | `relativePath` | file | Path relative to `scannedPath` |
| 6 | `absolutePath` | file | Full filesystem path on the server |
| 7 | `filename` | file | Basename only |
| 8 | `extension` | file | Lowercased, no leading dot |
| 9 | `category` | derived | High-level bucket: `pdf` / `office-document` / `spreadsheet` / `presentation` / `image` / `archive` / `text` / `web` / `audio-video` / `other` |
| 10 | `remediable` | derived | `true` for `pdf` / `office-document` / `spreadsheet` / `presentation`; `false` otherwise |
| 11 | `sizeBytes` | file | Integer |
| 12 | `sizeHuman` | file | Pretty-printed (e.g., `4.6 MB`) for spreadsheet readability |
| 13 | `modifiedAt` | file | ISO 8601 UTC |
| 14 | `sha256` | file | Empty if scan was run with `--no-hash` |
| 15 | `documentLanguage` | introspection | ISO code from PDF `/Lang` or DOCX `<w:lang>`; empty if not declared or not introspected |
| 16 | `pdfPageCount` | introspection | PDFs only |
| 17 | `pdfHasTextLayer` | introspection | PDFs only, `true`/`false` |
| 18 | `pdfIsImageOnly` | introspection | PDFs only, the headline a11y signal |
| 19 | `pdfHasTags` | introspection | PDFs only, structure-tag presence |
| 20 | `pdfHasFormFields` | introspection | PDFs only, AcroForm presence |
| 21 | `pdfHasSignatures` | introspection | PDFs only — flagged because remediation can invalidate digital signatures |
| 22 | `pdfEncrypted` | introspection | PDFs only |
| 23 | `pdfProducer` | introspection | PDFs only — software that produced the file (strong triage signal: `Microsoft Word` vs. `Adobe Scan` etc.) |
| 24 | `pdfCreator` | introspection | PDFs only — companion field to producer |
| 25 | `pdfCreationDate` | introspection | PDFs only, ISO 8601, internal PDF metadata (distinct from filesystem `mtime`) |
| 26 | `docxHasHeadings` | introspection | DOCX only |
| 27 | `docxAltTextCoverage` | introspection | DOCX only, fraction 0.0–1.0 |
| 28 | `docxTableCount` | introspection | DOCX only |
| 29 | `docxImageCount` | introspection | DOCX only, integer count |
| 30 | `xlsxSheetCount` | introspection | XLSX only |
| 31 | `xlsxHasMergedCells` | introspection | XLSX only |
| 32 | `flags` | derived | Pipe-separated list (e.g., `image-only-pdf\|scanned-name-pattern\|large-file`); empty if none |

The pipe-separator on `flags` keeps the column scalar so spreadsheet filters work; remediators can split-to-columns if they prefer one column per flag.

**Empty-on-failure rule.** When a file's introspection fails (corrupted PDF, password-protected DOCX, parser exception, etc.), the introspection-derived columns for that row are emitted as empty strings — *not* a stub error block, *not* `null`, just empty. An empty `pdfPageCount` next to a non-empty `extension=pdf` is itself the signal: "this file needs a closer look before quoting." Vendors will have their own deeper tooling (qpdf, Acrobat Pro, etc.) for these cases; filecap's job is to surface them, not parse them heroically.

### `filecap mcp` (Phase 7, deferred)

Start an stdio MCP server exposing `scan`, `rollup`, `report`, and read-only query tools over consolidated inventories.

---

## 6. NDJSON Schema

Both `filecap scan` and `filecap rollup` write **line-delimited JSON** (`.ndjson`). Each line is a self-contained JSON object. The first line is a header, the last line is a footer, and every line in between is a single file entry. This shape is append-only (no JSON-array bookkeeping), parseable line-by-line, and tail-readable while a scan is in progress.

### Single-instance inventory (`filecap scan` output)

**Line 1 — header:**

```json
{"schemaVersion":1,"kind":"filecap-inventory-header","metadata":{"serverName":"strapi-prod-01","hostname":"strapi-prod-01.icjia.local","serverIp":"10.42.7.18","scannedPath":"/var/strapi/uploads","scannedAt":"2026-05-08T14:23:11.000Z","filecapVersion":"0.4.0","nodeVersion":"v20.11.1","options":{"introspect":true,"hash":true,"maxIntrospectMb":200,"concurrency":4}}}
```

**Lines 2..N — one file entry per line** (formatted for readability; on disk each is a single line):

```jsonc
{
  "path": "2024/intake/case-2024-001.pdf",
  "absolutePath": "/var/strapi/uploads/2024/intake/case-2024-001.pdf",
  "filename": "case-2024-001.pdf",
  "extension": "pdf",
  "category": "pdf",
  "remediable": true,
  "sizeBytes": 4827193,
  "modifiedAt": "2024-03-12T09:14:22.000Z",
  "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "introspection": {
    "kind": "pdf",
    "pageCount": 47,
    "hasTextLayer": true,
    "textLayerCoverage": 0.94,
    "isImageOnly": false,
    "hasOutline": false,
    "hasTags": false,
    "hasFormFields": false,
    "hasSignatures": false,
    "isLinearized": true,
    "pdfVersion": "1.6",
    "encrypted": false,
    "documentLanguage": "en-US",
    "producer": "Microsoft® Word for Microsoft 365",
    "creator": "Microsoft® Word for Microsoft 365",
    "creationDate": "2024-03-12T09:14:00.000Z"
  },
  "flags": []
}
```

```jsonc
{
  "path": "2019/scans/Scan_001.pdf",
  "filename": "Scan_001.pdf",
  "extension": "pdf",
  "category": "pdf",
  "remediable": true,
  "sizeBytes": 184729183,
  "sha256": "...",
  "introspection": {
    "kind": "pdf",
    "pageCount": 312,
    "hasTextLayer": false,
    "isImageOnly": true,
    "hasTags": false,
    "hasFormFields": false,
    "hasSignatures": false,
    "encrypted": false,
    "documentLanguage": "",
    "producer": "Adobe Scan",
    "creator": "Adobe Scan",
    "creationDate": "2019-04-22T16:08:00.000Z"
  },
  "flags": ["scanned-name-pattern", "image-only-pdf", "large-file"]
}
```

**Failure case** — when introspection throws (corrupted PDF, encrypted DOCX, parser exception), the `introspection` key is **omitted entirely** from the entry. The file row still appears with all filesystem-derived fields populated; introspection-derived CSV columns will be empty for that row.

**Last line — footer:**

```json
{"kind":"filecap-inventory-footer","stats":{"fileCount":14823,"totalBytes":84327192834,"scanDurationMs":1283740,"introspectionFailures":12,"permissionDenials":0}}
```

A missing footer line indicates an interrupted scan: downstream tools should treat the inventory as partial and surface a warning.

### Consolidated inventory (`filecap rollup` output)

Same NDJSON shape, with these differences:

- Header `kind`: `"filecap-consolidated-header"`
- Header `metadata.sources`: array of source-inventory headers (one per input file)
- Each entry gains a top-level `serverName` field
- **Content-duplicate handling.** Each physical copy is a separate line in the output (one line per `serverName` × `path`). Copies that share a SHA-256 with another entry gain a `duplicateOf` field whose value is the canonical entry's `{serverName, path}` pair (chosen as the entry with the oldest `modifiedAt`; ties broken alphabetically by `serverName`). The canonical entry has `duplicateOf` set to `null`. This preserves every physical instance's per-server path/mtime in the CSV while letting consumers group by hash for dedup analysis.
- Footer `kind`: `"filecap-consolidated-footer"`, with cross-instance stats (`totalUniqueHashes`, `totalDuplicateGroups`, `bytesSavedIfDeduped`) added to `stats`.

---

## 7. File Type Introspection

### PDF (highest priority)

Library: `pdfjs-dist` (already in use at audit.icjia.app).

Per file, extract:
- Page count
- Text layer presence and coverage (fraction of pages with extractable text)
- Whether the file is image-only (no text layer at all → OCR + manual tagging required)
- Structure tag presence (the single most important PDF accessibility feature)
- Form field presence (AcroForm / XFA — separate remediation specialty)
- Digital signature presence (flagged because remediation can invalidate signatures, requiring vendor coordination)
- Outline/bookmark presence
- Linearization, PDF version, encryption status
- **Document language** (PDF `/Lang` entry in catalog) — required for WCAG 3.1.1
- **Producer and creator** (XMP/Info metadata) — strong triage signal: `Microsoft Word` PDFs are usually born-digital and quick; `Adobe Scan`, `ABBYY FineReader`, etc. are usually OCR'd from paper and expensive
- **Creation date** (PDF internal metadata, distinct from filesystem `mtime`) — useful when files were bulk-copied and `mtime` is the copy time

The image-only flag alone is the headline finding for most ICJIA stores — it's the #1 cost driver in PDF remediation. The producer/creator pair is a close second for triage.

If `pdfjs-dist` throws on a malformed PDF, the entry's `introspection` key is omitted entirely (see section 6). The vendor will have deeper tooling for these edge cases.

### DOCX

Library: `mammoth` (lightweight) or unzip + parse `word/document.xml` directly (zero deps, more control).

Per file, extract:
- Heading structure presence (any `Heading 1`, `Heading 2`, etc.)
- **Image count** (raw integer alongside alt-text coverage — a doc with 0 images is trivial, one with 200 needs different cost modeling)
- Image alt-text coverage (fraction of images with non-empty alt)
- Table count and presence of header rows
- Hyperlink count and "click here" / "read more" anti-pattern detection
- **Document language** (read from `word/styles.xml` `<w:lang>` declaration) — same `documentLanguage` column as PDFs, populated from a different source

### XLSX

Library: `exceljs`.

Per file, extract:
- Sheet count
- Whether sheets have header rows (heuristic: row 1 is bold/styled differently)
- Merged cell count (accessibility anti-pattern)
- Image / chart presence
- Defined-name accessibility (sheet names that are just `Sheet1`, `Sheet2`)

### DOC, PPT, XLS (legacy binary formats)

Phase 3 stretch goal. Hard to introspect without heavy libraries. Initial version: flag presence and report counts only ("legacy binary format — manual review required").

### TXT, CSV, MD, HTML

Lightweight. Report size, line count, and for HTML, presence of basic landmarks. Most are remediation-trivial.

### Everything else

Catch-all category: report extension and size, no introspection. Includes images, archives, ebooks, uncategorized binaries.

---

## 8. Tech Stack

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 20+ (LTS) | Modern fs/promises, stable streaming |
| Language | Plain JS, ESM | Matches @icjia suite, no build step |
| CLI | `commander` | Same as viewcap/lightcap/axecap |
| Schema validation | `zod` | Same as @icjia suite |
| PDF introspection | `pdfjs-dist` | Already in use at audit.icjia.app |
| DOCX introspection | `mammoth` (or unzip + xml) | Lightweight, no native deps |
| XLSX introspection | `exceljs` | Mature, pure JS |
| Hashing | Node built-in `crypto` (SHA-256, streaming) | C-backed via OpenSSL — outperforms any pure-JS alternative under the no-native-deps constraint |
| Concurrency | `p-limit` | Tiny, well-known |
| Testing | `vitest` | Same as other @icjia tools |
| Linting | `eslint` + `prettier` | Standard |

**No native dependencies.** Avoid `sharp`, `canvas`, `node-poppler`, etc. Everything must work via `npx @icjia/filecap` on a stock Ubuntu 20.04 server with only Node installed.

**Package metadata:**

```json
{
  "name": "@icjia/filecap",
  "version": "0.1.0",
  "description": "File inventory CLI for accessibility audit scoping",
  "type": "module",
  "bin": { "filecap": "./bin/filecap.js" },
  "engines": { "node": ">=20.0.0" },
  "publishConfig": { "access": "public" }
}
```

---

## 9. Phases

Each phase is a complete, shippable npm release.

### Phase 1 — Core scan (v0.1.0)

- Recursive filesystem walk
- Per-file stats: size, mtime, extension
- Derived fields: `category` (high-level bucket) and `remediable` (boolean from category)
- Streaming SHA-256 hash via Node's native `crypto` module (no JS-side hashing libraries)
- NDJSON output: header line + entry lines + footer line, schema version 1
- Permission-denied handling (warn + continue, counted in footer `permissionDenials`)
- Tests: walk fixtures, hash verification, header/entry/footer round-trip, partial-file (missing footer) detection
- **Deliverable:** can produce a usable inventory of any directory tree.

### Phase 2 — PDF introspection (v0.2.0)

- pdfjs-dist integration
- Page count, text layer detection, text coverage calculation
- Tag and outline detection
- Image-only flag
- Form field (AcroForm) and digital signature detection
- PDF metadata extraction: `producer`, `creator`, `creationDate`, `documentLanguage` (`/Lang`)
- Encrypted/linearization detection
- Per-file `--max-introspect-mb` cutoff
- Bounded concurrency (`p-limit`)
- Empty-on-failure: `introspection` key omitted from entry when pdfjs-dist throws
- Tests: image-only fixture, tagged fixture, untagged fixture, encrypted fixture, form-field fixture, signed-PDF fixture, malformed-PDF fixture (verify omitted-key behavior)
- **Deliverable:** the headline a11y signal works, plus producer-based triage signals.

### Phase 3 — Office introspection (v0.3.0)

- DOCX: heading structure, image count, alt text coverage, table headers, hyperlink anti-patterns, `documentLanguage`
- XLSX: header detection, merged cells, sheet naming
- Legacy `.doc/.ppt/.xls`: presence flag only
- **Deliverable:** Office files contribute to scoping.

### Phase 4 — Filename flagging (v0.4.0)

- Scanned-original patterns: `Scan_*`, `IMG_*`, `Document[0-9]+`, `Untitled*`, all-digit names, default printer names
- Filename anti-patterns: spaces, non-ASCII, very long names
- **Deliverable:** `flags[]` array populated, surfaceable in reports.

### Phase 5 — Rollup (v0.5.0)

- `filecap rollup` subcommand
- Multi-source merge by streaming line-by-line read of each input NDJSON
- One output line per physical copy (preserves per-server path/mtime); content-duplicates linked via `duplicateOf` field pointing to the canonical entry (oldest `modifiedAt`, alphabetical tiebreaker on `serverName`)
- Cross-instance footer stats: `totalUniqueHashes`, `totalDuplicateGroups`, `bytesSavedIfDeduped`
- Tests: 3-instance synthetic rollup with intentional duplicates, schema-version-mismatch handling under `--strict`, missing-footer (interrupted source) handling
- **Deliverable:** ICJIA-wide consolidated inventory works.

### Phase 6 — Reporter (v0.6.0)

- `filecap report` subcommand
- Streams the source NDJSON line-by-line — no whole-file load into memory
- Outputs:
  - `SUMMARY.txt` — top-level numbers, breakdowns, scoping signal
  - `files.csv` — every file, every column per the spec in section 5 (32 columns, stable order, header row)
  - `files-<serverName>.csv` — one per source server, when `--per-server` is set
  - `largest_files.txt` — top 50 by size
  - `flagged_filenames.txt` — scanned-original patterns, default names
  - `duplicate_hashes.txt` — content-duplicate groups across folders/servers
  - `pdf_image_only.txt` — PDFs detected as image-only (top remediation cost driver)
- Format flag (`--format`)
- Vendors get the CSV as a pure inventory; the CSV does not have vendor-fill columns and there is no return-roundtrip protocol — vendor workflow is out of scope
- **Deliverable:** full handoff package for remediation vendors.

### Phase 7 — MCP server (v1.0.0, optional)

- stdio MCP wrapper exposing scan/rollup/report and read-only query tools
- mcp.json registration example for Claude Code
- **Deliverable:** filecap is callable from Claude as a tool, completing the @icjia suite pattern.

### Phase 8 — Strapi-aware mode (vNext, deferred)

- Optional `--strapi-url <url> --strapi-token <token>` flags
- Correlate physical files in `/uploads` with Strapi `files` table records
- Flag orphans (files on disk not referenced in CMS) and ghosts (CMS records pointing to missing files)
- Reuses patterns from @icjia/strapi MCP server
- **Deliverable:** Strapi-specific report becomes substantially more actionable.

---

## 10. Publish Script

`./publish` — handles first-time publication and subsequent releases.

```bash
#!/usr/bin/env bash
# publish — release @icjia/filecap to npm
#
# Usage:
#   ./publish              # patch bump (default)
#   ./publish patch        # patch bump
#   ./publish minor        # minor bump
#   ./publish major        # major bump
#   ./publish first        # first-time publish (uses version in package.json as-is)

set -euo pipefail

BUMP="${1:-patch}"

# --- preflight ---

# Must be on main branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
    echo "Refusing to publish: not on main (currently on $BRANCH)" >&2
    exit 1
fi

# Working tree must be clean
if [ -n "$(git status --porcelain)" ]; then
    echo "Refusing to publish: working tree not clean" >&2
    git status --short >&2
    exit 1
fi

# Must be up to date with origin
git fetch origin main
LOCAL=$(git rev-parse main)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" != "$REMOTE" ]; then
    echo "Refusing to publish: local main is not in sync with origin/main" >&2
    exit 1
fi

# Must be authenticated to npm
if ! npm whoami >/dev/null 2>&1; then
    echo "Not logged in to npm. Run: npm login" >&2
    exit 1
fi

# --- test ---

echo "==> Running tests"
npm test

# --- version + publish ---

if [ "$BUMP" = "first" ]; then
    VERSION=$(node -p "require('./package.json').version")
    echo "==> First-time publish at v$VERSION"
    npm publish --access public
    git tag "v$VERSION"
    git push origin "v$VERSION"
else
    echo "==> Bumping version ($BUMP)"
    NEW_VERSION=$(npm version "$BUMP" -m "Release v%s")
    echo "==> Publishing $NEW_VERSION"
    npm publish --access public
    git push origin main --follow-tags
fi

echo
echo "==> Done."
echo "    npm:    https://www.npmjs.com/package/@icjia/filecap"
echo "    GitHub: https://github.com/ICJIA/filecap-cli"
```

`chmod +x publish` after creating. The `first` mode is for initial registration (`npm publish` on the version already in package.json, no bump). After that, `./publish patch` (or minor/major) for every subsequent release.

---

## 11. README sketch

The published README should include:

1. One-paragraph what-it-does
2. The SSH-based workflow diagram (section 3 of this doc)
3. Quick-start: three commands (`scan`, `rollup`, `report`)
4. CLI reference (auto-generate from Commander if possible)
5. NDJSON schema example (header / entry / footer line shape)
6. Note on what filecap does NOT do (full WCAG audit — point at audit.icjia.app; vendor workflow tracking — out of scope)
7. Link to bash quick-start script (the one-liner alternative for Node-less environments)

---

## 12. Resolved decisions

The following decisions were locked during design review and govern Phase 1+ implementation:

| # | Decision | Resolution |
|---|---|---|
| 1 | GitHub repo location | `github.com/ICJIA/filecap-cli` |
| 2 | Output format (single-instance and consolidated) | **NDJSON** with header line + entry lines + footer line. File extension `.ndjson`. Streamed write, streamed read in `rollup`/`report`. |
| 3 | Hash algorithm | **SHA-256** via Node native `crypto` (C-backed via OpenSSL). Default-on; `--no-hash` for fast triage. Native crypto outperforms any pure-JS alternative (BLAKE3, xxHash) at our constraint of no native deps. |
| 4 | Rollup canonical-row semantics | **One row per physical copy** in the consolidated NDJSON and CSV. Content-duplicates carry a `duplicateOf` field pointing to the canonical entry (oldest `modifiedAt`, alphabetical tiebreaker on `serverName`). Canonical entry has `duplicateOf: null`. Preserves per-server path/mtime in the CSV; consumers group by hash for dedup analysis. |
| 5 | PDF introspection failure shape | **Omit the `introspection` key entirely** from the entry on parser failure. CSV introspection columns emit empty strings for that row. Empty fields next to a `category=pdf` row are themselves the signal: "needs a closer look." Filecap does not attempt heroic recovery — vendors have qpdf, Acrobat Pro, etc. for that. |
| 6 | Vendor workflow integration | **Out of scope.** filecap is an inventory tool. Vendor returns remediated files to the server; ICJIA re-scans to capture new state. No vendor-fill CSV columns, no protocol negotiation, no `reconcile` or `diff` command in v1. NDJSON inventories *are* the time-series; if a structured diff is needed later, it can be added against archived inventories without rework. |
| 7 | Additional CSV columns | `category`, `remediable`, `documentLanguage`, `pdfHasFormFields`, `pdfHasSignatures`, `pdfProducer`, `pdfCreator`, `pdfCreationDate`, `docxImageCount`. See section 5 column spec for placement. |
| 8 | Test fixture strategy | Deferred to Phase 1 implementation. Three viable approaches (hand-crafted byte sequences, `pdf-lib` devDependency, fixtures under the 1 MB cap) — choice has no design ripple. |
| 9 | DOCX library | `mammoth` (mature, lightweight) for v1. Revisit if bundle size or extraction depth becomes a concern. |
| 10 | MCP wrapper packaging (Phase 7) | Same package, second binary entry point. Consistent with the @icjia suite pattern. |
| 11 | Strapi-aware mode (Phase 8) | Separate package (`@icjia/strapi-inventory` or similar) depending on `@icjia/strapi`. Keeps filecap pure-filesystem. |

---

## 13. Build prompt notes (for Claude Code)

When feeding this doc to Claude Code phase-by-phase, the standard preamble:

- Read this entire design doc before writing any code.
- Implement Phase N only. Do not touch later phases.
- Match @icjia conventions: ESM, Commander, Zod, vitest, no TypeScript build, no native deps.
- Every public function must have a Zod schema for inputs and outputs.
- All errors must propagate as typed objects, not strings.
- Tests must run via `npm test` with no fixtures larger than 1 MB committed (synthesize larger fixtures at test runtime).
- Each NDJSON line must validate against its Zod schema (separate schemas for header, entry, footer). CI should enforce by streaming the test fixtures through the validators.

End of design doc.
