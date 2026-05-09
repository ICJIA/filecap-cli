# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.3] — 2026-05-09

### Added

- **Self-version-check in audit scripts.** `audit-remote.sh` and `audit-fleet.sh` now compare their SHA-256 against the latest version on GitHub at startup. If outdated, a yellow warning prints the exact `curl` command to re-download. Non-blocking; skipped silently if offline. Override with `--no-version-check` flag or `SKIP_VERSION_CHECK=1` env var.
- **Timestamped runs preserve audit history.** Each run of `audit-remote.sh` now produces output in `~/filecap-audits/<server-ip>/runs/<utc-timestamp>/`, with a `latest/` symlink at the workdir root pointing to the most recent successful run. The shared `mirror/` directory stays at the workdir root and benefits from rsync's incremental transfers. Fleet runs follow the same pattern: each fleet audit goes to `~/filecap-audits/_fleet/<timestamp>/` with a `_fleet/latest` symlink. No more clobbering previous reports.
- **Optional `--site-name` flag.** New CLI option for `filecap scan` that records a human-friendly website nickname (e.g., DVFR, i2i, vpp) in the inventory header's `metadata.siteName`. Surfaces in CSV (new "Website" column at position 2), HTML (page title and summary box), audit-summary.txt (top-level "Website:" line before the Server line), and the fleet MANAGER_SUMMARY.txt per-server table (new "Site" column at the front). The audit scripts prompt for it interactively (press Enter to skip), accept it via positional arg (5th arg), and the fleet script's CSV format gains an optional 5th `site_name` column. Existing 4-column fleet CSVs and inventories without `siteName` remain valid.
- **README rewritten for non-technical audiences.** Front-loaded with audience-targeted TL;DRs (managers, developers, vendors/auditors, curious onlookers) and a "Just count the files, all right?" section that explains why filecap's per-file introspection matters for accurate vendor quotes. Added a Table of Contents and a "Quick start for managers" section with copy-pasteable handoff instructions. All existing technical sections preserved and audited for accuracy against the current shipped state: stale "stub" language removed from rollup/report CLI reference, CSV column count updated from 32 to 58, new introspection fields (PDF title/author/approxWordCount; DOCX headingLevelsUsed/wordCount/etc.; XLSX title/author/totalCells) added to field tables, artifact names updated to current (audit-file-list.csv, audit-summary.txt), Node.js engine requirement corrected to 20+, NDJSON header example updated with all required fields, and new troubleshooting entries added for pdfjs-dist warnings, EOL-Ubuntu glibc, and rsync --info=progress2.

[1.0.3]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.3

## [1.0.2] — 2026-05-09

### Added

- **Audit automation scripts** in `examples/`: `audit-remote.sh` (single-server interactive workflow) and `audit-fleet.sh` (multi-server orchestrator with consolidated `MANAGER_SUMMARY.txt`). Portable to macOS and Linux. Auditors can curl them directly from `https://raw.githubusercontent.com/ICJIA/filecap-cli/main/examples/<script>.sh` and run without cloning the repo. The scripts auto-detect Node version on the remote: native filecap scan over SSH if Node ≥20, rsync-and-scan-locally otherwise (for the EOL-Ubuntu fleet). Inventory paths are rewritten post-scan to reflect the source server, not the auditor's local machine.
- README "For auditors: self-contained audit scripts" section with download URLs, input prompts documented, output structure, and the rationale behind local-mode scanning for older Ubuntu fleets.
- **Optional HTML report.** `filecap report --html` writes a self-contained `audit-file-list.html` alongside the CSV. Same columns as the CSV; rendered as a sortable (click-header), filterable (search input), and print-friendly table with no external dependencies. Image-only PDFs are highlighted with a yellow row background; flagged filenames get a left accent border. `writeHtml` is exported from the package main. The `filecap_report` MCP tool gains an optional `html: boolean` parameter. Both audit scripts prompt the auditor to opt in and propagate the flag through.
- **Additional metadata extraction:** PDF introspection now surfaces `title`, `author`, `subject`, `keywords`, `modificationDate`, and `approxWordCount`. DOCX introspection adds `title`, `author`, `lastModifiedBy`, `wordCount`, `paragraphCount`, and `headingLevelsUsed` (sorted array of heading levels actually used, enabling gap detection). XLSX introspection adds `title`, `author`, and `totalCells`.
- **Auditor-readable CSV and HTML.** All CSV and HTML column headers are now human-facing labels (e.g. "File name", "Needs remediation", "PDF: page count") instead of raw field names. Boolean values render as `Yes`/`No` instead of `true`/`false`.
- **Renamed report artifacts** for clarity: `files.csv` → `audit-file-list.csv`, `files.html` → `audit-file-list.html`, `SUMMARY.txt` → `audit-summary.txt`. A new `README.txt` is generated in every report directory explaining each artifact and how to locate files on the server.
- **Enriched `audit-summary.txt`** with manager-friendly sections: PDFs (OCR needs, tag status, form fields, page counts), Word documents (heading coverage, alt-text coverage, table headers, vague links, word count), Excel files (chart/image/merge counts), Legacy Office, per-file-type breakdown, filename quality metrics, top-5 largest files, and "What this means for the audit" observation bullets. Consolidated reports include a per-server breakdown table.
- **Enhanced preflight in bash scripts:** Both scripts now verify Node 18+ locally (warn on <20), check read access on the remote path (not just existence), and validate local free disk space before starting an rsync. `audit-fleet.sh` adds a fleet-wide pre-validation pass that SSH-probes every server before beginning any audit work — showing a status table and aborting cleanly if 0 servers are reachable.
- **Windows/WSL2 subsection** in README explaining how Windows-based auditors can run the bash scripts via WSL2.

[1.0.2]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.2

## [1.0.1] — 2026-05-09

### Changed

- **Docs only.** Expanded README MCP section to cover five clients (Claude Desktop, Claude Code, Cursor, Windsurf, Continue) and switched all configuration examples to `@icjia/filecap@latest` so the MCP host re-checks the registry on each spawn. Added a "How auto-update works" subsection explaining the trade-off between `npx --yes @latest` (auto-update with ~1–3s startup cost) and `npm install -g` (manual update, zero startup cost).

[1.0.1]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.1

## [1.0.0] — 2026-05-09

### Added

- **MCP server.** New command `filecap mcp` runs an stdio MCP server exposing four tools (`filecap_scan`, `filecap_rollup`, `filecap_report`, `filecap_query_inventory`) for AI agents (Claude Desktop, Claude Code, etc.).
- New programmatic exports: `runMcp`, `TOOL_DEFINITIONS`, `dispatchTool`, `queryInventory`.
- Read-only `queryInventory` helper for filtering/sorting inventories programmatically without going through the MCP server.

### Changed

- Version bumped to **1.0.0** to mark feature-complete v0.x → v1.0 milestone. The v0.x line covered scan (Phase 1), PDF introspection (Phase 2), Office introspection (Phase 3), filename flagging (Phase 4), rollup (Phase 5), report (Phase 6), and now MCP server (Phase 7). The full inventory-to-handoff pipeline is functional end-to-end.

[1.0.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.0

## [0.6.0] — 2026-05-08

### Added

- **Report command.** `filecap report <inventory.ndjson> -o ./report/` consumes a single-instance OR consolidated inventory NDJSON and emits the vendor handoff package: `files.csv` (32-column work-order), `SUMMARY.txt`, `largest_files.txt`, `flagged_filenames.txt`, `duplicate_hashes.txt`, `pdf_image_only.txt`.
- 32-column CSV writer per design-doc spec, with stable column order, header row, and pipe-separated `flags` cell.
- New programmatic exports: `runReport`, `writeCsv`, `CSV_COLUMNS`, `writeSummary`, `writeLargestFiles`, `writeFlaggedFilenames`, `writeDuplicateHashes`, `writePdfImageOnly`, `humanizeBytes`, `csvCell`.

[0.6.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v0.6.0

## [0.5.0] — 2026-05-08

### Added

- **Multi-server rollup.** New command `filecap rollup <files...>` merges per-server NDJSONs into a consolidated NDJSON with content-duplicate detection. Each entry in the output gets `serverName` (source) and `duplicateOf` (canonical copy reference, or null). Canonical entry: oldest `modifiedAt`; alphabetical tiebreaker on `serverName`.
- New consolidated NDJSON schemas: `consolidatedHeaderSchema` (with `metadata.sources` array of source inventory headers), `consolidatedEntrySchema` (entry + serverName + duplicateOf), `consolidatedFooterSchema` (with `totalUniqueHashes`, `totalDuplicateGroups`, `bytesSavedIfDeduped` cross-instance stats).
- `--strict` flag on `filecap rollup`: fails on schema mismatch or missing footer (default: warn and skip).
- New programmatic exports from package main: `runRollup`, `rollupInventories`, `pickCanonical`, plus the three consolidated schemas.

[0.5.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v0.5.0

## [0.4.0] — 2026-05-08

### Added

- **Filename heuristic flags.** Every entry's `flags[]` array is now populated with applicable flags from the Phase 4 taxonomy: `scanned-name-pattern` (Scan_*, IMG_*, Document\d+, Untitled*, all-digit, DOC\d+, FAX*, "Microsoft Word - *"), `filename-has-spaces`, `filename-non-ascii`, `filename-long` (>200 chars). Pure regex matching against the basename — no new runtime dependencies.
- New programmatic export from package main: `computeFilenameFlags(filename)`. Returns a sorted string array of applicable flags.

### Changed

- The orchestrator's entry construction switches `flags: []` to `flags: computeFilenameFlags(filename)`. Phase 1–3 entries had empty `flags[]` arrays; Phase 4 entries populate them. Backward-compatible at the schema level (still `z.array(z.string())`).

[0.4.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v0.4.0

## [0.3.0] — 2026-05-08

### Added

- **DOCX introspection** via `jszip` + `fast-xml-parser`. Each DOCX entry now carries: `hasHeadings`, `imageCount`, `altTextCoverage`, `tableCount`, `tablesHaveHeaders`, `hyperlinkCount`, `vagueLinkCount` (count of "click here" / "read more" anti-patterns), and `documentLanguage`.
- **XLSX introspection** via `exceljs`. Each XLSX entry now carries: `sheetCount`, `sheetNames`, `defaultSheetNameCount` (count of `Sheet1`/`Sheet2`/etc.), `hasHeaderRows`, `mergedCellCount`, `hasCharts`, `hasImages`.
- **Legacy Office presence flag.** `.doc`, `.ppt`, and `.xls` files now carry an `introspection` block with `kind: "office-legacy"` and the specific format. No deep parsing; the marker indicates the file needs manual review.
- **Discriminated-union schema.** `entrySchema.introspection` is now `z.discriminatedUnion("kind", [...])` over `pdf`, `docx`, `xlsx`, `office-legacy`. Each variant has its own typed shape.
- New schema exports: `docxIntrospectionSchema`, `xlsxIntrospectionSchema`, `legacyOfficeIntrospectionSchema`.
- New programmatic exports from package main: `introspectDocx`, `introspectXlsx`, `introspectLegacyOffice`.

### Known limitations

- PPTX is not introspected in Phase 3 — entries with `extension: "pptx"` get no introspection block. Deferred to a future phase.
- DOCX language detection reads `word/styles.xml` first; some documents place language declarations elsewhere (e.g., `word/document.xml` `sectPr`). Coverage is best-effort; rare DOCX variants may report no language even when one is declared. A corrupt `word/styles.xml` falls through gracefully to the `document.xml` fallback (Phase 3 review fix).
- DOCX heading detection looks for style names matching `Heading[1-9]`; corporate templates with custom heading style names (e.g., `ChapterTitle`, `Titre 1`) will not be detected.
- XLSX chart detection uses `worksheet.model.charts`, which is populated inconsistently across `exceljs` versions. False negatives are possible for files with charts.
- DOCX image alt-text coverage tests don't currently exercise the non-zero path (the `docx` library's image API is awkward for runtime fixtures); the code path is verified against real-world Word documents.

[0.3.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v0.3.0

## [0.2.0] — 2026-05-08

### Added

- **PDF introspection** via `pdfjs-dist`. Each PDF entry now carries an `introspection` block with: `pageCount`, `hasTextLayer` + `textLayerCoverage`, `isImageOnly`, `hasTags`, `hasOutline`, `hasFormFields`, `hasSignatures`, `encrypted`, `documentLanguage`, `producer`, `creator`, `creationDate`, `pdfVersion`, and `isLinearized`.
- **Empty-on-failure handling.** When `pdfjs-dist` cannot parse a file (malformed, encrypted-without-password, exotic variant), the entry's `introspection` key is omitted entirely. The file row still appears with full filesystem stats; the footer's `introspectionFailures` count increments. The empty field itself is the signal: "this file needs a closer look."
- **`--no-introspect` CLI flag.** Skip introspection for fast triage scans (filesystem-only).
- **`--max-introspect-mb <n>` CLI flag** (default 200). Skip introspection for files larger than this — a parse-cost guard for pathological inputs.
- **Introspection dispatcher** (`src/introspect/index.js`). Routes by extension to the appropriate introspector; returns `null` for non-introspectable types or oversized files. Phase 3 will add DOCX/XLSX entries to the dispatcher.
- New schema export: `pdfIntrospectionSchema` (Zod) for validating introspection blocks. `entrySchema` now accepts an optional `introspection` field.
- New programmatic exports from package main: `introspect`, `introspectPdf`, `pdfIntrospectionSchema`.

### Changed

- The scan orchestrator now defaults to introspecting (`introspect: true` at the CLI layer); pass `--no-introspect` to opt out. Phase 1's behavior was equivalent to `--no-introspect`. **This is a user-visible default-behavior change between v0.1.0 and v0.2.0.**

### Known limitations

- Test fixtures don't currently cover tagged, encrypted, or signed PDFs (`pdf-lib` cannot synthesize them at runtime). The detection paths for these features are exercised against real PDFs in production use; we plan to add committed fixtures or alternative synthesis in a future patch.

[0.2.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v0.2.0

## [0.1.0] — 2026-05-08

### Added

- Initial design document at `docs/filecap-design.md`.
- Project metadata: `README.md`, `LICENSE` (MIT), `.gitignore`, `CHANGELOG.md`.
- `filecap scan <directory>` command — recursive filesystem walk, per-file stats (size, mtime, extension), category derivation, optional SHA-256 hashing, and NDJSON output (header + entries + footer).
- `-o -` stdout-output convention: `filecap scan /path -o -` writes NDJSON to stdout, enabling SSH-piped multi-server orchestration without round-tripping files.
- Bounded concurrency for hashing via `p-limit`.
- Permission-denied handling: per-directory errors are captured and counted in the footer's `permissionDenials`; scan exits with code 3 (partial completion) when any directory was unreadable.
- TOCTOU resilience: files deleted between walk and stat are silently skipped; stat-level permission errors are counted alongside hash-level ones.
- Consistent error contract: `runScan` always returns `{exitCode, error?}`; never throws.
- Zod schemas validating header, entry, and footer NDJSON lines.
- Sample bash orchestrator at `examples/multi-scan.sh` for SSH-piped multi-server scans.
- Publish script (`./publish`) for npm releases.

### Design decisions locked

- **Output format.** NDJSON (`.ndjson`) for both single-instance scans and consolidated rollups.
- **Rollup canonical-row semantics.** One row per physical copy; content-duplicates carry a `duplicateOf` field (oldest `modifiedAt` wins; alphabetical tiebreaker on `serverName`). *(Implementation pending Phase 5.)*
- **PDF introspection failure handling.** Empty fields, no stub error block. *(Implementation pending Phase 2.)*
- **Hash algorithm.** SHA-256 via Node native `crypto`.
- **Vendor workflow.** Out of scope. filecap is a pure inventory tool.
- **CSV column additions.** `category`, `remediable`, `documentLanguage`, `pdfHasFormFields`, `pdfHasSignatures`, `pdfProducer`, `pdfCreator`, `pdfCreationDate`, `docxImageCount`. *(Implementation pending Phase 6.)*

[0.1.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v0.1.0
