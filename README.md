# @icjia/filecap

**File inventory CLI for accessibility audit scoping.**

`filecap` walks a directory tree, introspects each file (PDFs, DOCX, XLSX), and produces a structured NDJSON inventory suitable for accessibility remediation scoping. The primary use case is generating per-server inventories of file stores (Strapi `/uploads` directories, general file servers) to hand to remediation vendors so they can produce a defensible, fixed-price quote on ADA Title II / WCAG 2.1 AA remediation work.

## Status

**Phase 3 shipped (v0.3.0).** Office introspection is functional. Each Office entry now carries format-specific accessibility signals: DOCX (headings, image alt-text coverage, table headers, hyperlink anti-patterns, language); XLSX (sheet count, default-name detection, header rows, merged cells, charts, images); legacy `.doc/.ppt/.xls` flagged by extension. PDFs continue to carry the full Phase 2 introspection block.

The full design specification lives at [`docs/filecap-design.md`](docs/filecap-design.md).

| Phase | Version | Status | Deliverable |
|---|---|---|---|
| 1 | v0.1.0 | shipped | Core scan — recursive walk, hashing, NDJSON output |
| 2 | v0.2.0 | shipped | PDF introspection (image-only, tags, producer, signatures, language) |
| 3 | v0.3.0 | **shipped** | Office introspection (DOCX, XLSX, legacy flag) |
| 4 | v0.4.0 | next | Filename flagging |
| 5 | v0.5.0 | planned | Multi-server rollup |
| 6 | v0.6.0 | planned | CSV reporter and summary artifacts |
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
