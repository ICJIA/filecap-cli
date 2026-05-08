# @icjia/filecap

**File inventory CLI for accessibility audit scoping.**

`filecap` walks a directory tree, introspects each file (PDFs and — soon — Office documents), and produces a structured NDJSON inventory suitable for accessibility remediation scoping. The primary use case is generating per-server inventories of file stores (Strapi `/uploads` directories, general file servers) to hand to remediation vendors so they can produce a defensible, fixed-price quote on ADA Title II / WCAG 2.1 AA remediation work.

## Status

**Phase 2 shipped (v0.2.0).** PDF introspection is functional. Each PDF entry carries page count, text-layer presence, image-only flag, structure-tag presence, form-field presence, signature presence, encryption state, document language, producer/creator/creation-date metadata, and PDF version.

The full design specification lives at [`docs/filecap-design.md`](docs/filecap-design.md).

| Phase | Version | Status | Deliverable |
|---|---|---|---|
| 1 | v0.1.0 | shipped | Core scan — recursive walk, hashing, NDJSON output |
| 2 | v0.2.0 | **shipped** | PDF introspection (image-only, tags, producer, signatures, language) |
| 3 | v0.3.0 | next | Office introspection (DOCX, XLSX) |
| 4 | v0.4.0 | planned | Filename flagging |
| 5 | v0.5.0 | planned | Multi-server rollup |
| 6 | v0.6.0 | planned | CSV reporter and summary artifacts |
| 7 | v1.0.0 | planned | MCP server entry point |
| 8 | vNext | deferred | Strapi-aware mode (separate package) |

## Quick start

Scan a directory and write an NDJSON inventory:

```bash
npx --yes @icjia/filecap scan /var/strapi/uploads
# → writes filecap-<hostname>.ndjson in cwd
```

The output is line-delimited JSON: one header line, one line per file, one footer line.

## CLI reference

### `filecap scan <directory>`

Walk a directory tree and produce an NDJSON inventory.

| Flag | Default | Description |
|---|---|---|
| `-o, --output <path>` | `filecap-<hostname>.ndjson` | Output path (use `-` for stdout) |
| `-s, --server-name <name>` | `os.hostname()` | Override server identifier in metadata |
| `--server-ip <ip>` | auto-detected | Override server IP (defaults to first non-loopback IPv4) |
| `--no-hash` | (off) | Skip SHA-256 hashing (much faster, but no dedup) |
| `--no-introspect` | (off) | Skip PDF introspection (filesystem stats only) |
| `--max-introspect-mb <n>` | `200` | Skip introspection for files larger than this |
| `--include-ext <list>` | (all) | Comma-separated extensions to include |
| `--exclude-ext <list>` | (none) | Comma-separated extensions to exclude |
| `--concurrency <n>` | `4` | Parallel introspection/hashing workers |
| `--progress` | (off) | Emit progress to stderr |

**Exit codes.** `0` success, `1` argument or runtime error, `2` directory not readable, `3` partial completion (some files unreadable; NDJSON still written, footer line present).

### `filecap rollup` and `filecap report`

Stubs printing "not implemented in v0.2.0". Phase 5 and Phase 6 respectively.

## Multi-server workflow

When scanning multiple servers from a single coordinator machine that has SSH access (e.g., keys in `~/.ssh`), use stdout piping to avoid copying files:

```bash
ssh deploy@strapi-prod-01 "npx --yes @icjia/filecap scan /var/strapi/uploads -o -" \
  > ./inventories/strapi-prod-01.ndjson
```

The `-o -` flag writes NDJSON to stdout, which SSH transports back to your coordinator. The compute (walk, hash, introspection) happens on the remote where the files live; only the inventory output (a few MB) crosses the network.

A sample bash orchestrator that does this for a list of servers is in [`examples/multi-scan.sh`](examples/multi-scan.sh).

## NDJSON output format

The output is line-delimited JSON. Each file produces a single line. The first line is a header carrying scan metadata; the last line is a footer carrying summary stats.

**Example header:**

```json
{
  "schemaVersion": 1,
  "kind": "filecap-inventory-header",
  "metadata": {
    "serverName": "strapi-prod-01",
    "hostname": "strapi-prod-01.icjia.local",
    "serverIp": "10.42.7.18",
    "scannedPath": "/var/strapi/uploads",
    "scannedAt": "2026-05-08T14:23:11.000Z",
    "filecapVersion": "0.2.0",
    "nodeVersion": "v20.11.1",
    "options": { "introspect": true, "hash": true, "maxIntrospectMb": 200, "concurrency": 4 }
  }
}
```

**Example file entry (PDF with introspection):**

```json
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
  "flags": [],
  "introspection": {
    "kind": "pdf",
    "pageCount": 47,
    "hasTextLayer": true,
    "textLayerCoverage": 0.94,
    "isImageOnly": false,
    "hasTags": false,
    "hasFormFields": false,
    "hasSignatures": false,
    "encrypted": false,
    "producer": "Microsoft Word",
    "creator": "Microsoft Word",
    "creationDate": "2024-03-12T09:14:00.000Z",
    "pdfVersion": "1.6"
  }
}
```

**Example file entry (image-only PDF):**

```json
{
  "path": "2019/scans/Scan_001.pdf",
  "filename": "Scan_001.pdf",
  "extension": "pdf",
  "category": "pdf",
  "remediable": true,
  "sizeBytes": 184729183,
  "introspection": {
    "kind": "pdf",
    "pageCount": 312,
    "hasTextLayer": false,
    "isImageOnly": true,
    "hasTags": false,
    "hasFormFields": false,
    "hasSignatures": false,
    "encrypted": false,
    "producer": "Adobe Scan",
    "creator": "Adobe Scan",
    "creationDate": "2019-04-22T16:08:00.000Z"
  }
}
```

**Example footer:**

```json
{
  "kind": "filecap-inventory-footer",
  "stats": {
    "fileCount": 14823,
    "totalBytes": 84327192834,
    "scanDurationMs": 1283740,
    "introspectionFailures": 12,
    "permissionDenials": 0
  }
}
```

A scan that ends without a footer line indicates an interrupted run (SIGINT, OOM, SSH drop). Downstream tools should treat such files as partial.

## What gets introspected (Phase 2)

For PDF files, filecap extracts:

| Field | What it tells you |
|---|---|
| `pageCount` | Total pages |
| `hasTextLayer` / `textLayerCoverage` | Whether text is extractable; fraction of pages with text |
| `isImageOnly` | True when no page has any extractable text — the headline cost driver in PDF remediation (OCR + manual tagging required) |
| `hasTags` | PDF structure tags (`/StructTreeRoot`) — the single most important PDF accessibility feature |
| `hasOutline` | Document outline / bookmarks |
| `hasFormFields` | AcroForm or XFA form fields — separate remediation specialty |
| `hasSignatures` | Digital signatures — flagged because remediation can invalidate them, requiring vendor coordination |
| `encrypted` | Encryption state |
| `documentLanguage` | PDF `/Lang` entry — required for WCAG 3.1.1 |
| `producer` / `creator` | Creating software — strong triage signal: "Microsoft Word" PDFs are usually born-digital and quick; "Adobe Scan", "ABBYY FineReader" etc. are usually OCR'd from paper and expensive |
| `creationDate` | Internal PDF timestamp (distinct from filesystem `mtime`) |
| `pdfVersion` | PDF format version |
| `isLinearized` | Web-optimized streaming PDFs |

When introspection fails (corrupt PDF, unsupported variant, parse exception), the `introspection` field is omitted from the entry. The file row still appears with full filesystem stats. An empty `introspection` next to a `category=pdf` row is itself a signal: the file needs a closer look before quoting.

Files larger than `--max-introspect-mb` (default 200) skip introspection regardless of type — a parse-cost guard for pathological inputs.

## What filecap does not do

filecap reports *what files exist and their structural accessibility characteristics*. It does not:

- Perform full WCAG conformance auditing of files (that's [audit.icjia.app](https://audit.icjia.app)'s job, per-file)
- Remediate, fix, or modify any files
- Track vendor remediation status or workflow (out of scope — the NDJSON inventories are themselves the time-series record)
- Integrate directly with the Strapi API (deferred to Phase 8 in a separate package)

## Troubleshooting

**Scan exits with code 3.** At least one directory was unreadable (permission denied). The footer's `permissionDenials` count tells you how many. Inspect the inventory's entries to see which files made it; investigate the missing subtrees separately.

**`introspection` field missing from a PDF entry.** filecap couldn't parse this file. Likely causes: malformed PDF, encrypted with a password we don't have, exotic feature pdfjs-dist doesn't yet support. The file still appears in the inventory; the vendor's deeper tooling (Acrobat Pro, qpdf) will surface the actual issue.

**Scans are slow on large directories.** Hashing dominates wall time. For triage scans, pass `--no-hash` to skip SHA-256 (you lose dedup detection but gain ~3-5× speed). For PDF-heavy stores, increase `--concurrency` (default 4; bump to 8 or 16 if your I/O can keep up). Skip introspection with `--no-introspect` for filesystem-only inventories.

**`./publish` says "local main is not in sync with origin/main".** Either `git push` first (the remote has commits you don't, or vice versa), or your fetch state is stale (`git fetch origin && git status`).

## License

[MIT](LICENSE) © Illinois Criminal Justice Information Authority

## Related @icjia tools

filecap is the inventory-side complement to ICJIA's audit tooling:

- `@icjia/viewcap` — screenshot capture (MCP)
- `@icjia/lightcap` — Lighthouse audits (MCP)
- `@icjia/axecap` — axe-core accessibility audits (MCP)
- `@icjia/contrastcap` — color contrast auditing (MCP)
- `audit.icjia.app` — full WCAG conformance auditing (per-file)
