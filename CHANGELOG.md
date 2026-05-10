# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-05-10

### Added

- **`filecap web-rollup` subcommand.** Bundles the most recent scan of every saved site into a self-contained static-site directory (index.html fleet overview, per-site HTML reports, downloadable CSVs, `robots.txt`). Optional client-side password gate via `--password`. Output defaults to `~/filecap-audits/_web-rollup/<UTC-timestamp>/`. Ready for drag-and-drop to Netlify or any static host.
- **`filecap_web_rollup` MCP tool.** Exposes the web-rollup orchestrator to AI agents (Claude Desktop, Claude Code, etc.). The MCP server now advertises five tools.
- **`w` menu option in `audit-remote.sh`.** Selecting `w` in the saved-sites menu prompts for an optional password and runs `filecap web-rollup` against all saved sites, then offers to open the resulting `index.html`.

### Changed

- **Dark-mode reskin of per-site HTML reports.** `filecap report --html` now produces a dark-mode report matching the web-rollup design system (background `#0a0a0a`, accent `#60a5fa`, amber remediable indicators). This applies to every direct `filecap report --html` invocation as well as per-site files in a web-rollup bundle — single visual language everywhere. Includes `@media print` that inverts to white background + black text.
- **`robots.txt` and `<meta name="robots">` noindex on all bundle pages.** Prevents search-engine indexing of published bundles.

[1.2.0]: https://github.com/ICJIA/filecap-cli/compare/v1.1.1...v1.2.0

## [1.1.1] — 2026-05-10

### Fixed

- **README not displaying on npmjs.com.** The npm registry's per-version readme field was empty for every version since 1.0.0, even though `README.md` was present in every published tarball. Republished 1.1.1 via the explicit `npm pack` + `npm publish <tarball>` flow to force the registry to populate the per-version readme. The `./publish` script now uses this flow by default.

[1.1.1]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.1.1

## [1.1.0] — 2026-05-10

### Removed

- **audit.icjia.app integration dropped entirely.** The `audit-enrich` subcommand, `--audit-link-pattern` scan option, `filecap_audit_enrich` MCP tool, `auditBlockSchema` Zod shape, `audit` entry field, `auditLinkPattern` header metadata field, and all related logic in `merge.js`, `csv.js`, and `html.js` have been removed. The integration was tightly coupled to an external service and added maintenance surface with no payoff for the core accessibility-scoping use case. Inventories created with 1.0.x that contain `audit` blocks will still parse (unknown fields are ignored by Zod's `strip` default), but the blocks will not appear in reports.
- **`filecap_audit_enrich` MCP tool removed.** The MCP server now exposes four tools: `filecap_scan`, `filecap_rollup`, `filecap_report`, `filecap_query_inventory`.
- **audit-remote.sh and audit-fleet.sh audit-enrich prompts removed.** The "Enrich inventories with audit.icjia.app scores?" interactive prompt and all downstream `audit-enrich` shell calls have been removed from both example scripts. The `audit_link_pattern` column has been dropped from the fleet CSV input format.

### Changed

- **CSV and HTML report columns slimmed to 30 accessibility-critical fields.** Dropped: `flags`; all PDF metadata text fields (`pdfTitle`, `pdfAuthor`, `pdfSubject`, `pdfCreator`, `pdfProducer`, `pdfApproxWordCount`); most DOCX introspection counts that duplicate what's already captured (`docxWordCount`, `docxParagraphCount`, `docxSectionCount`, `docxTotalImageCount`); all XLSX introspection except `xlsxSheetCount`; all `audit*` columns. Kept: every field needed to scope remediation work and measure baseline accessibility coverage.

[1.1.0]: https://github.com/ICJIA/filecap-cli/compare/v1.0.9...v1.1.0

## [1.0.9] — 2026-05-09

### Changed

- **Documentation: the two audit columns now BOTH work end-to-end.** When `--audit-link-pattern` was added in 1.0.5, the "Audit Link" column rendered clickable URLs that opened audit.icjia.app's homepage with a `?prefill=URL` query param the web app ignored. As of audit.icjia.app's PR #12 (merged + deployed today), `?prefill=URL` now triggers an on-demand audit via the new `POST /api/analyze-url` endpoint. The README's audit section was rewritten to explain when to use each column: "View audit →" for ad-hoc spot checks (no precomputation), "View report →" for pre-saved bulk results (after audit-enrich). No code changes — purely a documentation update reflecting the now-working behavior.

[1.0.9]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.9

## [1.0.8] — 2026-05-09

### Added

- **Saved-sites manager.** `audit-remote.sh` now stores per-site configs in `~/.filecap/sites.json` and offers a menu on startup: select a saved site (skipping all per-field prompts), add a new one, edit, delete, or preflight all of them. Each site stores SSH user, host, remote path, friendly name, website nickname, public URL prefix, and audit link template — but never the audit token (that stays in env). File is created with mode 600 inside `~/.filecap/` (mode 700). Override location with `FILECAP_SITES_FILE` env var.
- **Preflight-all-sites.** New `p` option in the saved-sites menu runs a quick health check on every saved site (SSH connectivity, remote path existence and readability, file count) and prints a status table. Read-only — no rsync, no scan. Catches SSH key drift, moved paths, and unexpectedly empty directories before running a full audit.
- **Import / export sites as JSON.** Two new menu options: `x` exports the current saved sites to a JSON file (no credentials — just hostnames, paths, nicknames), and `i` imports sites from a JSON file in either merge mode (add new sites by name, skip existing) or replace mode (wipe + use only imported). Designed for the auditor-onboarding workflow: an admin configures all sites once on their machine, exports the JSON, hands it to each visiting auditor; auditors import it on their machines (with their own SSH access already configured) and pick a site from the menu in seconds.

### Changed

- **HTML report is now always generated alongside the CSV.** No more "Also generate HTML report? [y/N]" prompt. Set `AUDIT_HTML=0` in the environment to opt out (rare). The CSV and HTML are the same data; the HTML is the manager-facing version with sortable filterable interactive controls.
- **Config review now allows per-field correction.** When the auditor sees the configuration summary before the audit runs, they can type a number 1-9 to fix any single field, then the table re-renders. Loop continues until they press Enter to proceed.

### Fixed

- **Required-input validation on Server IP and remote path.** Empty values are no longer silently accepted; the script re-prompts with "(required — please type a value)". Previously, pressing Enter at the IP prompt led to silent failure later (`forge@` with no host).

[1.0.8]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.8

## [1.0.7] — 2026-05-09

### Added

- **`filecap audit-enrich` subcommand.** New command that calls audit.icjia.app's `/api/bulk-from-inventory` endpoint (POST NDJSON, `Content-Type: text/plain`, `Authorization: Bearer <token>`) and writes per-file accessibility scores back into the inventory NDJSON in place (or to a specified `-o` output path). Each matched PDF entry gains an `audit` block with `score` (0–100), `grade` (A–F scale), `reportId`, `reportUrl` (user-facing `https://audit.icjia.app/report/<id>` — the subcommand constructs this itself from `<apiBase>/report/<reportId>`, ignoring the raw `/api/reports/` URL returned by the endpoint), and `enrichedAt` (ISO timestamp). Matching is by SHA-256 hash with path as fallback. Entries the audit service could not score (not publicly reachable, service error) are left unchanged.
- **Three new report columns: Audit score, Audit grade, Audit report.** When `filecap report` encounters entries with an `audit` block, it adds three columns at the end of the CSV and HTML: the score formatted as a percentage (`84%`), the grade letter (`B`), and the audit report URL. In the HTML report the Audit report cell renders as a "View report →" link that opens the saved accessibility report on audit.icjia.app. Entries without an `audit` block emit empty cells — the columns are always present in the output regardless.
- **`audit` block in `entrySchema` and `consolidatedEntrySchema`.** The Zod schema now accepts an optional `audit` object with `score` (int 0–100), `grade` (regex `^[A-F][+-]?$`), `reportId` (32 hex chars), `reportUrl` (URL), and `enrichedAt` (ISO datetime). Schema change is non-breaking: existing inventories without audit blocks remain valid.
- **`filecap_audit_enrich` MCP tool.** Same enrichment workflow available to AI agent clients: accepts `input` (required), `output` (optional, defaults to `input`), `apiBase` (optional, defaults to `https://audit.icjia.app`), and `authToken` (optional, falls back to `FILECAP_AUDIT_TOKEN` env var).
- **Optional audit-enrich step in `audit-remote.sh` and `audit-fleet.sh`.** After generating the initial report, both scripts now prompt "Enrich inventory with audit.icjia.app scores? [y/N]". If yes, they call `filecap audit-enrich`, then regenerate the report so the CSV/HTML include the audit columns. The prompt can be suppressed by setting `RUN_AUDIT_ENRICH=y` (or `=n`) before running. `audit-fleet.sh` also enriches the consolidated inventory after the per-server audits complete.

### Manager clarity (1.0.7)

- **Summary, CSV, and HTML now lead with the audit-relevant count, not the total file count.** Managers reading "Total files: 102" were assuming that was the audit workload — but only 69 of those 102 are remediable (PDFs + Office docs); the other 33 are images / placeholders / text files where alt text lives in the CMS schema, not in the file itself.
- `audit-summary.txt` and the HTML report both now open with an "AUDIT SCOPE" block (remediable count) and a parallel "OTHER FILES" block (reference count).
- HTML report has a two-stat box at the top — `Audit work: 69 files need remediation` vs `Reference files: 33 files no direct work needed` — and the chip filter defaults to "Remediable only" on page load.
- CSV's "Needs remediation" column was renamed to "Remediation needed?" and moved to column 5 (was column 12). Cell values now read "Yes — needs accessibility work" / "No — reference file (image, placeholder, etc.)" so a non-technical reader sees the meaning, not jargon.
- `MANAGER_SUMMARY.txt` (fleet runs) follows the same AUDIT SCOPE / OTHER FILES structure.

[1.0.7]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.7

## [1.0.6] — 2026-05-09

### Fixed

- **Excel auto-converts SHA-256 hash column to scientific notation (data loss).** Excel detects 64-character hex strings as numeric and offers conversion that truncates to ~15 digits, breaking cross-server duplicate detection. SHA-256 cells are now wrapped in Excel text-formula syntax (`="<hash>"`) so Excel preserves them as literal strings. Other CSV consumers (Numbers, Google Sheets, programmatic parsers) see the formula syntax and parse correctly.
- **`latest/` symlink not updating after successful runs.** The atomic `ln -sfn ... && mv -f ...` pattern was failing silently on macOS (`mv -f` has historical quirks with symlink replacement). Replaced with a more robust `rm -f ... && ln -s ...` sequence inside a subshell that `cd`s to the workdir first so the relative target resolves correctly. Same fix applied to `audit-fleet.sh`'s `_fleet/latest` symlink.
- **CSV header row had unquoted commas and quotes inside column labels** like `XLSX: default sheet names (Sheet1, Sheet2, …)` and `DOCX: vague hyperlinks ("click here")`. Naive CSV parsers (e.g., `awk -F,` or non-text-qualified Excel imports) mis-split the header. Now properly escaped per RFC 4180.
- **HTML report's category-filter chips, column-header sort, and search input were all silently broken.** PDF date metadata (Adobe's format `D:YYYYMMDDHHMMSS-08'00'`) contains single quotes that broke the JS string literal `JSON.parse('...')` used to embed the row data. The whole IIFE crashed, so chips, sort, and search never wired up. Fixed by moving the data into a separate `<script type="application/json" id="filecap-data">` block — the JSON now sits in its own script tag where single quotes (and any other JS-string-special characters) are safe.

### Changed

- **`Last modified` column renamed to `Date published` and moved to position 4 in the CSV/HTML.** For most accessibility-audit use cases the file's filesystem modification time IS its publish date (files aren't typically edited after upload). The column was previously buried around position 12 — now it's right after Server IP so it's visible without scrolling. Internal field name (`modifiedAt`) is unchanged for programmatic consumers.
- **HTML report now default-sorts by Date published, descending (most recent first).** Previously the report opened in alphabetical filename order. Auditors typically want to see new uploads first; the default sort matches that expectation. The column header still works for click-to-resort.

[1.0.6]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.6

## [1.0.5] — 2026-05-09

### Added

- **Domain preflight verification for `--public-url-base`.** The audit scripts now HEAD-check the public URL prefix before running the scan. If unreachable (typo, network restrictions, or site down), a yellow warning prompts the auditor to confirm whether to proceed. Same check applied per-server in `audit-fleet.sh`'s pre-validation pass.
- **Category filter chips in HTML report.** New chip row at the top of the report (`[All]`, `[PDFs]`, `[Office docs]`, `[Images]`, etc.) with counts. Clicking a chip filters the table to that category. Combines with the existing search input. Print stylesheet hides the chips on paper output.
- **Optional `--audit-link-pattern` flag.** Accepts a URL template with placeholders (`{publicUrl}`, `{sha256}`, `{filename}`, `{path}`, `{serverIp}`, `{siteName}`) — rendered as a clickable "View audit →" column in the HTML report. Lets auditors jump from a row in the filecap inventory to the corresponding page on an external audit service (audit.icjia.app or otherwise). The audit scripts prompt for it interactively, accept it as a 7th positional arg, and `audit-fleet.sh` CSV format gains an optional 7th column. See [filecap issue #100](https://github.com/ICJIA/filecap-cli/issues) and the related issue at https://github.com/ICJIA/file-accessibility-audit/issues/9 for the broader integration plan.

[1.0.5]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.5

## [1.0.4] — 2026-05-09

### Fixed

- **`audit-summary.txt` had blank Server / Source location fields and missing Website line.** `runReport` was not passing the inventory header to `writeSummary`. The header data was correctly captured in `inventory.ndjson` but never reached the summary text. Fixed by passing `header` through.
- **Tilde (`~`) paths failed the remote path check in `audit-remote.sh` and `audit-fleet.sh`.** Inner single quotes around the path in the SSH `test -d '${path}'` call prevented the remote shell from expanding `~`. Removed the inner quotes so tilde paths now work correctly. Note: paths containing spaces or shell metacharacters should still be passed as absolute paths.

### Added

- **Public URL column.** New `--public-url-base <url>` flag for `filecap scan` records the URL prefix where files are publicly served (e.g., `https://example.com/uploads`). The CSV and HTML reports gain a "Public URL" column with one full URL per file. In the HTML report, the URL is rendered as a clickable link that opens the file in a new tab. The audit scripts prompt for it interactively (press Enter to skip), accept it via positional arg or env var, and the fleet script CSV format gains an optional 6th column.
- **Scrollable HTML table with sticky first column.** The 58-column HTML report is now wrapped in a horizontally-scrolling container so the rightmost columns are reachable on any screen. The first column ("Server") stays pinned in place while you scroll, so you don't lose context.

[1.0.4]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.4

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
