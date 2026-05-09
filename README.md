# @icjia/filecap

**File inventory CLI for accessibility audit scoping.**

`filecap` walks a directory tree, introspects each file (PDFs, DOCX, XLSX), and produces a structured NDJSON inventory suitable for accessibility remediation scoping. The primary use case is generating per-server inventories of file stores (Strapi `/uploads` directories, general file servers) to hand to remediation vendors so they can produce a defensible, fixed-price quote on ADA Title II / WCAG 2.1 AA remediation work.

## Status

**Phase 7 shipped (v1.0.0) — v1.0 milestone reached.** MCP server entry point is live: `filecap mcp` starts an stdio MCP server exposing `filecap_scan`, `filecap_rollup`, `filecap_report`, and `filecap_query_inventory` as tools callable by AI agents (Claude Desktop, Claude Code, etc.). The full inventory pipeline `scan → rollup → report` remains end-to-end functional. All prior phases continue unchanged.

The full design specification lives at [`docs/filecap-design.md`](docs/filecap-design.md).

| Phase | Version | Status | Deliverable |
|---|---|---|---|
| 1 | v0.1.0 | shipped | Core scan — recursive walk, hashing, NDJSON output |
| 2 | v0.2.0 | shipped | PDF introspection (image-only, tags, producer, signatures, language) |
| 3 | v0.3.0 | shipped | Office introspection (DOCX, XLSX, legacy flag) |
| 4 | v0.4.0 | shipped | Filename flagging |
| 5 | v0.5.0 | shipped | Multi-server rollup |
| 6 | v0.6.0 | **shipped** | CSV reporter and summary artifacts |
| 7 | v1.0.0 | **shipped** | MCP server entry point |
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
| `--site-name <name>` | (none) | Optional website nickname (e.g., DVFR). Used as a human-friendly identifier alongside `--server-name`. |
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
    "siteName": "DVFR",
    "serverName": "dvfr-strapi-prod",
    "scannedPath": "/var/strapi/uploads",
    "scannedAt": "2026-05-08T14:23:11.000Z",
    "filecapVersion": "1.0.3",
    "options": { "introspect": true, "hash": true, "maxIntrospectMb": 200, "concurrency": 4 }
  }
}
```

`siteName` is optional. Omitting it is valid. Old inventories without it continue to validate.

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
filecap report consolidated.ndjson -o ./report-2026-Q2/ --html   # also writes files.html
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

3. **Node.js 18 or newer installed on your local machine.** Node is the JavaScript runtime the tool uses; it's free and widely used. Check whether it's already installed by opening a terminal and typing `node --version`. If you see `v18.x.x` or higher, you're done. If not:
   - macOS: `brew install node` (if you have Homebrew) or download the installer from https://nodejs.org
   - Ubuntu/Linux: `sudo apt install -y nodejs` or download from https://nodejs.org
   - Windows (WSL2/Ubuntu): see the [Windows](#windows-the-situation) section

4. **`npx` available in your terminal.** `npx` comes bundled with Node.js 18+ — if you have Node, you have `npx`. It's the tool that downloads and runs `filecap` automatically; you don't have to install `filecap` separately.

5. **`bash`, `ssh`, `rsync`, and `python3` available.** These are pre-installed on every Mac (macOS 12+), every modern Ubuntu/Debian Linux, and every WSL2/Ubuntu environment. You don't need to do anything. The scripts check for these at startup and tell you if something is missing.

### How to use it (single server)

Three commands. The first downloads the script, the second makes it executable, the third runs it:

```bash
curl -O https://raw.githubusercontent.com/ICJIA/filecap-cli/main/examples/audit-remote.sh
chmod +x audit-remote.sh
./audit-remote.sh
```

The script walks you through the rest interactively. It asks a few questions (see below), connects to the server, collects the inventory, and writes the output to `~/filecap-audits/<server-ip>/report/`. When it's done, it prints the path to the results.

If you already know all the details and want to skip the prompts, you can pass them directly:

```bash
./audit-remote.sh forge 192.241.146.85 ~/dvfr.icjia-api.cloud/strapi_v4/public/uploads dvfr-strapi-prod
```

### What you'll be asked

In interactive mode, the script asks six questions. Here's what each one means and what a sensible answer looks like:

- **SSH username** — The login name on the remote server. Defaults to `forge` (the ICJIA Strapi convention). Press Enter to accept the default, or type a different name if your server uses one.
- **Server IP or hostname** — The address of the server you're auditing. Examples: `192.241.146.85` or `strapi-prod-01.example.com`. This is required — there's no default.
- **Full path to the uploads folder on the remote** — Where the files live on the server. Example: `~/dvfr.icjia-api.cloud/strapi_v4/public/uploads`. Your server administrator can confirm this path. Required.
- **Friendly server name** — A human-readable label (the technical identifier) used in report headings. Defaults to `strapi-<IP-with-dashes>` (e.g., `strapi-192-241-146-85`). Optional — press Enter to accept the default, or type something like `dvfr-strapi-prod`.
- **Website nickname** — An optional short name managers and vendors use to identify the site (e.g., `DVFR`, `i2i`, `vpp`). Different from the server name — this is the business-facing identity. Press Enter to skip if you don't have one.
- **Generate HTML report? [y/N]** — Defaults to no (just press Enter). If you answer `y`, the script also produces `audit-file-list.html` — a self-contained web page with the same data, interactive column sorting, full-text search, and visual highlights for image-only PDFs. Useful to have open during a vendor review meeting.

### What you get

After the script finishes, navigate to `~/filecap-audits/<server-ip>/latest/report/`. You'll find:

- **`audit-file-list.csv`** — The main deliverable. One row per file, 32 columns covering file type, size, PDF page count, image-only flag, DOCX heading and alt-text data, and more. Open in Excel, Google Sheets, or Numbers. This is what you hand to the remediation vendor.
- **`audit-summary.txt`** — Top-line numbers: total files by type, total storage, how many PDFs are image-only, how many documents are remediable. Good for an executive summary or a project charter.
- **`audit-file-list.html`** — (Only present if you answered `y` to the HTML prompt.) A self-contained web page version of the same data. Open in any browser — no internet connection required. Supports sorting by any column, full-text search, and print-to-PDF.
- **`README.txt`** — A plain-text guide to all the files in this folder. Start here if you're not sure which file to open.
- **`largest_files.txt`** — The top 50 files by size. Helpful for scheduling the most time-consuming remediation work first.
- **`flagged_filenames.txt`** — Files whose names suggest they're scanned documents or unprocessed camera photos (`Scan_001.pdf`, `IMG_4567.pdf`, etc.) — typically the highest-cost items to remediate.
- **`duplicate_hashes.txt`** — Files that are byte-for-byte identical to another file on the server. Useful for identifying redundant copies before remediation.
- **`pdf_image_only.txt`** — PDFs that contain no text layer — they're essentially photos of pages. These require OCR before any accessibility remediation can begin, and they're usually the cost driver in a vendor quote.

The run directory also contains `inventory.ndjson` (the raw scan data used to generate the report) and `SOURCE_INFO.txt` (a provenance record: which server was scanned, when, and how to SSH in and locate a specific file).

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
# Install Node.js 20 (the audit scripts require Node 18 or newer):
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
- npx (comes with Node.js 18+; install Node from https://nodejs.org)
- Node.js 18+ locally (the scripts verify this at startup and abort with guidance if the version is too old)

The scripts run a tool-presence and Node-version preflight at startup and abort with clear remediation messages if anything is missing.

### Why local-mode scanning matters

Many production Strapi servers run on Ubuntu 18.04 with Node 16. Prebuilt Node 18+ binaries require glibc 2.28+ (Ubuntu 20+); compiling Node from source on EOL Ubuntu is fragile due to old g++. The `audit-remote.sh` script sidesteps this by detecting Node 16 and pulling the files down via rsync, then running filecap on the auditor's local machine. The output CSV still records the *source* server's IP and remote path so vendors can ssh in and locate any flagged file — the auditor's local machine is invisible in the deliverable.

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
