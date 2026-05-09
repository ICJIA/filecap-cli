# @icjia/filecap

**File inventory CLI for accessibility audit scoping.**

`filecap` walks a directory tree, introspects each file (PDFs, DOCX, XLSX), and produces a structured NDJSON inventory suitable for accessibility remediation scoping. The primary use case is generating per-server inventories of file stores (Strapi `/uploads` directories, general file servers) to hand to remediation vendors so they can produce a defensible, fixed-price quote on ADA Title II / WCAG 2.1 AA remediation work.

## Status

**Phase 6 shipped (v0.6.0).** Report command is functional: `filecap report consolidated.ndjson -o ./report/` produces the vendor handoff package — `files.csv` (32-column work-order), `SUMMARY.txt` with file-count breakdowns, plus four flagged-list `.txt` files (largest, flagged-names, duplicate-hashes, image-only PDFs). The full inventory pipeline `scan → rollup → report` is now end-to-end functional. Phases 5, 4, 3, and 2 all continue unchanged.

The full design specification lives at [`docs/filecap-design.md`](docs/filecap-design.md).

| Phase | Version | Status | Deliverable |
|---|---|---|---|
| 1 | v0.1.0 | shipped | Core scan — recursive walk, hashing, NDJSON output |
| 2 | v0.2.0 | shipped | PDF introspection (image-only, tags, producer, signatures, language) |
| 3 | v0.3.0 | shipped | Office introspection (DOCX, XLSX, legacy flag) |
| 4 | v0.4.0 | shipped | Filename flagging |
| 5 | v0.5.0 | shipped | Multi-server rollup |
| 6 | v0.6.0 | **shipped** | CSV reporter and summary artifacts |
| 7 | v1.0.0 | planned | MCP server entry point |
| 8 | vNext | deferred | Strapi-aware mode (separate package) |

## Quick start

```bash
npx --yes @icjia/filecap scan /var/strapi/uploads
# → writes filecap-<hostname>.ndjson in cwd
```

The output is line-delimited JSON: one header line, one line per file, one footer line.

## CLI reference

### `filecap scan <directory>`

| Flag | Default | Description |
|---|---|---|
| `-o, --output <path>` | `filecap-<hostname>.ndjson` | Output path (use `-` for stdout) |
| `-s, --server-name <name>` | `os.hostname()` | Override server identifier in metadata |
| `--server-ip <ip>` | auto-detected | Override server IP (defaults to first non-loopback IPv4) |
| `--no-hash` | (off) | Skip SHA-256 hashing (much faster, but no dedup) |
| `--no-introspect` | (off) | Skip PDF/Office introspection (filesystem stats only) |
| `--max-introspect-mb <n>` | `200` | Skip introspection for files larger than this |
| `--include-ext <list>` | (all) | Comma-separated extensions to include |
| `--exclude-ext <list>` | (none) | Comma-separated extensions to exclude |
| `--concurrency <n>` | `4` | Parallel introspection/hashing workers |
| `--progress` | (off) | Emit progress to stderr |

**Exit codes.** `0` success, `1` argument or runtime error, `2` directory not readable, `3` partial completion.

### `filecap rollup` and `filecap report`

Stubs printing "not implemented in v0.3.0". Phase 5 and Phase 6 respectively.

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
    "serverName": "strapi-prod-01",
    "scannedPath": "/var/strapi/uploads",
    "scannedAt": "2026-05-08T14:23:11.000Z",
    "filecapVersion": "0.3.0",
    "options": { "introspect": true, "hash": true, "maxIntrospectMb": 200, "concurrency": 4 }
  }
}
```

**Example file entry (DOCX):**

```json
{
  "path": "2024/policies/handbook.docx",
  "filename": "handbook.docx",
  "extension": "docx",
  "category": "office-document",
  "remediable": true,
  "sizeBytes": 152340,
  "introspection": {
    "kind": "docx",
    "hasHeadings": true,
    "imageCount": 5,
    "altTextCoverage": 0.8,
    "tableCount": 3,
    "tablesHaveHeaders": true,
    "hyperlinkCount": 12,
    "vagueLinkCount": 2,
    "documentLanguage": "en-US"
  }
}
```

**Example file entry (XLSX):**

```json
{
  "path": "2024/data/budget.xlsx",
  "filename": "budget.xlsx",
  "extension": "xlsx",
  "category": "spreadsheet",
  "remediable": true,
  "sizeBytes": 48720,
  "introspection": {
    "kind": "xlsx",
    "sheetCount": 4,
    "sheetNames": ["Summary", "Q1", "Q2", "Sheet4"],
    "defaultSheetNameCount": 1,
    "hasHeaderRows": true,
    "mergedCellCount": 3,
    "hasCharts": true,
    "hasImages": false
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

## What gets introspected (Phase 3)

### PDF (Phase 2)

| Field | What it tells you |
|---|---|
| `pageCount`, `hasTextLayer`, `textLayerCoverage`, `isImageOnly` | Text vs. scanned content |
| `hasTags` | PDF structure tags (most important PDF a11y feature) |
| `hasFormFields`, `hasSignatures` | Specialized remediation requirements |
| `producer`, `creator` | Strong triage signal (born-digital vs. OCR'd from paper) |
| `documentLanguage`, `creationDate`, `pdfVersion` | Document metadata |
| `encrypted`, `isLinearized`, `hasOutline` | Structural state |

### DOCX (new in Phase 3)

| Field | What it tells you |
|---|---|
| `hasHeadings` | Document uses Word heading styles (essential for screen-reader navigation) |
| `imageCount`, `altTextCoverage` | Number of images and what fraction have alt text |
| `tableCount`, `tablesHaveHeaders` | Table count and whether any table has marked header rows |
| `hyperlinkCount`, `vagueLinkCount` | Total links and how many use ambiguous text ("click here", "read more") |
| `documentLanguage` | Declared language (WCAG 3.1.1) |

### XLSX (new in Phase 3)

| Field | What it tells you |
|---|---|
| `sheetCount`, `sheetNames` | Total sheets and their names |
| `defaultSheetNameCount` | Sheets named `Sheet1`/`Sheet2`/etc. (lazy naming → screen reader hostility) |
| `hasHeaderRows` | At least one sheet has a styled (bold) first row |
| `mergedCellCount` | Total merged cell ranges across all sheets (accessibility anti-pattern) |
| `hasCharts`, `hasImages` | Embedded objects |

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

Flags are emitted as a sorted array; the CSV reporter (Phase 6) will join them with `|` for spreadsheet consumption.

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

**Flags:**

| Flag | Default | Description |
|---|---|---|
| `-o, --output <path>` | `consolidated.ndjson` | Output path |
| `--strict` | (off) | Fail on schema mismatch or missing footer in any input (default: warn and skip) |

**Why one row per physical copy?** Each duplicate entry in the consolidated CSV (Phase 6) represents real disk space someone has to decide to keep or delete. The `duplicateOf` link tells the consumer "this is the same content as `<serverName>:<path>`" so a vendor can group by hash for de-dup analysis OR filter to canonicals only for remediation work. Both views are one query away.

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
```

Output directory contents:

| File | Purpose |
|---|---|
| `files.csv` | One row per file, 32 columns (the work-order vendors actually consume). Filterable in Excel, Smartsheet, etc. |
| `SUMMARY.txt` | Top-level numbers: file counts by category, total bytes, image-only PDF count, remediable count, sources |
| `largest_files.txt` | Top 50 files by size (helps schedule the biggest remediation work) |
| `flagged_filenames.txt` | Files whose `flags[]` includes scanned-original or filename anti-patterns |
| `duplicate_hashes.txt` | Content-duplicate groups (entries sharing a SHA-256) — useful for de-dup analysis |
| `pdf_image_only.txt` | PDFs with `isImageOnly: true` — the headline cost driver in PDF remediation |

The CSV is pure inventory — there are NO vendor-fill columns. Vendors return remediated files; ICJIA re-scans and uses a future `filecap diff` command to detect changes. This division-of-labor decision is documented in the design doc and locks vendor workflow out of the inventory tool itself.

**CSV column order** (32 columns, stable):

`serverName, serverIp, hostname, scannedPath, relativePath, absolutePath, filename, extension, category, remediable, sizeBytes, sizeHuman, modifiedAt, sha256, documentLanguage, pdfPageCount, pdfHasTextLayer, pdfIsImageOnly, pdfHasTags, pdfHasFormFields, pdfHasSignatures, pdfEncrypted, pdfProducer, pdfCreator, pdfCreationDate, docxHasHeadings, docxAltTextCoverage, docxTableCount, docxImageCount, xlsxSheetCount, xlsxHasMergedCells, flags`

`flags` is pipe-separated (e.g., `scanned-name-pattern|filename-has-spaces`). Empty cells indicate the field doesn't apply to this file's type.

**Inputs.** `filecap report` accepts BOTH a single-instance NDJSON (from `filecap scan`) and a consolidated NDJSON (from `filecap rollup`). For consolidated inputs, the per-entry `serverName` is used and `serverIp`/`hostname` are looked up from the header's `metadata.sources[]` array. Both input shapes produce the same 32-column CSV — the consumer doesn't need to know which scanner/rollup pipeline produced the data.

## What filecap does not do

- Perform full WCAG conformance auditing (that's [audit.icjia.app](https://audit.icjia.app)'s job, per-file)
- Remediate, fix, or modify any files
- Track vendor remediation status (out of scope — NDJSON inventories are themselves the time-series record)
- Integrate with the Strapi API (deferred to Phase 8)
- Introspect PPTX (deferred to a future phase; Phase 3 only covers DOCX, XLSX, and legacy stubs)

## Troubleshooting

**Scan exits with code 3.** At least one directory was unreadable. The footer's `permissionDenials` count tells you how many.

**`introspection` field missing from a PDF / DOCX / XLSX entry.** filecap couldn't parse this file. Likely causes: malformed file, encrypted, exotic variant. The file still appears in the inventory; vendor's deeper tooling (Acrobat Pro, Office, qpdf) will surface the actual issue.

**Scans are slow on large directories.** Hashing dominates wall time. For triage scans, pass `--no-hash`. For Office-heavy stores, increase `--concurrency`. Skip introspection with `--no-introspect` for filesystem-only inventories.

## License

[MIT](LICENSE) © Illinois Criminal Justice Information Authority

## Related @icjia tools

- `@icjia/viewcap` — screenshot capture (MCP)
- `@icjia/lightcap` — Lighthouse audits (MCP)
- `@icjia/axecap` — axe-core accessibility audits (MCP)
- `@icjia/contrastcap` — color contrast auditing (MCP)
- `audit.icjia.app` — full WCAG conformance auditing (per-file)
