# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.16] — 2026-05-13

### Added

- **Two staff-fill columns appended to every CSV the bundle emits — `Delete?` and `Notes`.** Per-site CSVs (`dvfr-…csv`), the master CSV (`audit-file-list-master.csv`), and every by-file-type CSV (`audit-pdfs.csv`, `audit-docx.csv`, …) now ship 16 columns instead of 14. `Delete?` defaults to `No` on every row; staff types `Yes` to flag a file for removal before the next audit. `Notes` is empty by default; free-text for whatever context the staff member wants to leave on a row. The intended workflow: download CSV → mark `Yes`-Delete on rows that should be removed + add notes → send the CSV back to the audit lead → lead deletes the flagged files on each source server, reads notes, and re-runs the audit. Implementation: new descriptor field `csvOnly: true` on the two columns in `CSV_COLUMNS`; the HTML view derives `HTML_COLUMNS = CSV_COLUMNS.filter(c => !c.csvOnly)` so the web table stays at 14 columns (still 14 `<col>` + 14 `<th>` + 14 `<td>` per row). CSV is plain text — the "dropdown" feel for `Delete?` needs Excel/Google-Sheets data validation set by the staff member (the column defaults to `No` so an unedited CSV behaves sensibly either way). 4 new tests pin the schema additions, the default values, the 16-column CSV header row, and the absence of the columns from the HTML view.
- **"Use ICJIA's PDF audit tool" button in every navbar — links to https://audit.icjia.app, opens in a new tab.** Visually prominent (filled blue button with external-link icon), sits in the right zone of the index-page `.site-header` and in the right side of every per-site detail page's `.report-back-bar`. Single-button label on mobile (icon only at < 600 px viewport so it doesn't crowd the back-link). Same affordance on the per-file-type detail pages too — every page in the bundle now has a one-click path to the PDF accessibility checker. Restores the audit.icjia.app integration that was removed in v1.1.0 (now wired as a visible link rather than embedded checks). 5 new tests cover the index navbar variant + the detail-page sticky-bar variant + the rel="noopener noreferrer" attribute + the "Use ICJIA's PDF audit tool" label + the inline SVG icon.
- **"Last audit: <date>" caption beneath every CSV download button** so staff can tell whether their downloaded copy is current vs the deployed version. Date format is `<Month> <Day>, <Year>` (e.g., `May 13, 2026`) — date-only because what matters is which day the scan ran, not the minute. Per-card CSV download caption pulls the per-site `scannedAt`; master-CSV section caption uses `consolidatedAt` (the moment the rollup was built); per-site detail page sticky bar pulls the per-site `scannedAt` again; per-file-type detail page sticky bar uses `consolidatedAt` (across-the-fleet view). Implementation: new exported helper `fmtAuditDate(iso)` in `index-page.js`; the consolidated branch of `writeHtml` resolves `meta.consolidatedAt`, the non-consolidated branch resolves `meta.scannedAt`. Master-CSV meta gains a new `lastAuditAt` field set at rollup time.

### Changed

- **README pass top-to-bottom — every claim now reflects the current version.** Stale spots that had accumulated since v1.4.x: "30-column CSV" was claimed in three places (now correctly 16; the 30-column reference dated to before the v1.4.x trim); test count was "408 tests" (now 434); the CSV column-order block listed Public URL at position 8 (v1.7.2 moved it to position 4); the Vendor TL;DR listed format-specific introspection columns (PDF page count, has-text-layer, DOCX heading coverage, XLSX sheet count, etc.) as CSV columns when they've been NDJSON-only since v1.4.0/1.4.1; the Status section + table only went through v1.7.8 (now extended through v1.7.16); the "Publishing a fleet snapshot → What's in the bundle" file tree only showed 2 sites + index + assets and was missing the master CSV, duplicates CSV, and all 9 per-file-type CSV+HTML pairs added in v1.5.0 / v1.5.1 / v1.7.14; the Manager TL;DR's "New in 1.7.x" block grew into a multi-version run-on paragraph through 1.7.8 (now rewritten as a single concise "current shape of the fleet rollup" paragraph). Manager-facing "needs/needing remediation" instances softened to "may need …" matching the v1.7.8 sweep that hit the live output but not the README copy.

[1.7.16]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.16

## [1.7.15] — 2026-05-12

### Added

- **ICJIA wordmark logo in the index-page navbar.** Inline SVG (~13 kB) from the agency's standard asset set (https://github.com/ICJIA/archived-website-page/blob/main/assets/icjia-logo.svg), sed-themed so every `rgb(100%, 100%, 100%)` fill becomes `currentColor` — the logo recolors via `.site-header .icjia-logo { color: … }`, so dark navbar → `#ffffff`, print mode → `#000000` without forking the markup. New `.site-header-left` flex container groups the 38 px-tall logo + the "filecap fleet audit snapshot" brand text with a thin vertical divider between them. Stacks the logo down to 32 px under 600 px viewport. Accessible name "Illinois Criminal Justice Information Authority" is set via `role="img"` + `aria-label` on the SVG; the wrapping `<span>` is `aria-hidden` so screen readers only see the label once.

### Changed

- **Index-page cards now sorted alphabetically by site title (siteFullName).** Pre-v1.7.15 cards rendered in sites.json declaration order — which matched how the audit team thought about the fleet but not how an outside viewer scans the page. Sort happens at render time in `generateIndexHtml` (`siteResults.sort((a, b) => aKey.localeCompare(bKey, undefined, { sensitivity: "base" }))`), falling back to `siteName` then `name` if `siteFullName` is missing. `sensitivity: "base"` handles mixed case + diacritics naturally on a real keyboard. New test pins the order against a fixture that declares sites in B-first / C-first order to prove the renderer is doing the work.
- **ARI Summit 2023 full name updated** in `~/.filecap/sites.json` from `Adult Redeploy All Sites Summit 2023` → `ARI All Sites Summit 2023` per user request. (The 2017/2018/2019 summits still spell out "Adult Redeploy" — flagged for follow-up if the renaming should propagate.)

[1.7.15]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.15

## [1.7.14] — 2026-05-12

### Added

- **Per-file-type detail pages with CSV downloads — click "PDFs" on the index and get every PDF across the fleet in one infographic-style page.** Every non-empty bucket in the index's "By file type" table now has two artefacts emitted next to the master CSV: `audit-<slug>.csv` (filtered master, same 14 columns, every row tagged with its source server) and `audit-<slug>.html` (per-site-style detail page — same dp-hero pattern with two-up tiles + donut + plain-English caption + sortable file table + row-marker legend + click-and-drag resizable columns + sticky back-link / CSV-download bar). The slug for each bucket is stable and readable: `audit-pdfs.csv`, `audit-docx.csv`, `audit-xlsx.csv`, `audit-pptx.csv`, `audit-office-legacy.csv`, `audit-images.csv`, `audit-text-files.csv`, `audit-archives.csv`, `audit-audio-video.csv`, `audit-web-files.csv`, `audit-other.csv` (and matching `.html` for each). Empty buckets are skipped — no zero-row CSV/HTML pairs on disk. On the index page, the by-type row's **label** now opens the detail page and the **count column** downloads just the CSV; both styled subtly (hover-only blue, dotted underline on the count) so the table still scans as a table. Implementation: new exported `TYPE_BUCKETS` constant in `src/commands/web-rollup.js` is the single source of truth (used by both the CSV writer and the index renderer). Each bucket has `keys` (so the legacy-office and legacy-office synonyms merge into one bucket), `side` ("remediable" / "reference"), `label`, and `slug`. The per-bucket HTML reuses `writeHtml` with a consolidated header — the `dp-hero` shows "Across the fleet" as the eyebrow and the bucket label as the H1, with the donut showing 100 % audit for remediable buckets and 0 % for reference. 5 new tests cover CSV emission, master/per-type schema parity, dp-hero structure, index linking, and the empty-bucket skip path. Total now 30 test files / 422 tests.

[1.7.14]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.14

## [1.7.13] — 2026-05-12

### Changed

- **Index-page hero redesigned around the audit count, not the total.** Pre-v1.7.13 the hero led with `<span class="fleet-total-headline">14,914</span>` in 96 px blue type, with `total files scanned across N websites` underneath. Managers were misreading that headline as *"the audit team has 14,914 files to remediate"* — but 14,914 is the *inventory* number; only ~74 % of those flagged for accessibility review, and the actual scope of work is the 11,097 remediable subset. The new hero is a two-column infographic — left column has the audit count in 105 px amber (`#ffa84d`, matching the per-card audit tile) with a small "Files that may need accessibility audit" eyebrow above it and `out of 9,096 files scanned across 17 ICJIA websites` as a secondary context line. Right column is a 200 × 200 px donut (same conic-gradient pattern as the per-site cards, just larger) with `54 %` + `may need audit` in the center and a phrase-bucket caption beneath (`About half may need audit` / `Two-thirds may need audit` / etc.) reusing the same caption logic as the cards so fleet view and per-site view share visual language. Stacks to a single column under 720 px. The split bar and equation row (`14,914 = 11,097 need audit + 3,817 don't`) are dropped — the new headline + donut convey the same information without the math-class framing that read as cold. 6 new tests pin the new markup (audit count as the headline, donut with `--pct` style, phrase caption, total in secondary line, no surviving pre-v1.7.13 classes, aria-label on the role=img hero). Print-mode CSS overrides updated to match the new class names.

[1.7.13]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.13

## [1.7.12] — 2026-05-12

### Fixed

- **Image-only PDF row tint now actually visible on the per-site detail page's file table — and applies across every cell, not just the first.** Hidden CSS-specificity bug present since the original v1.0.2 row-marker code: `tbody tr:nth-child(even/odd) { background: ... }` (selector specificity 0,1,2) outranked `tr.image-only { background: #111000 }` (0,1,1), so the row-level tint never won. Only `tr.image-only td:first-child` (also 0,1,2, plus later in source order) rendered — leaving a barely-perceptible marker on the leftmost column and nothing on the rest of the row. The result was that the "faint yellow row tint" legend entry described a marker that was essentially invisible against the dark `#0d1117` page background. Fixed by retargeting at `tbody tr.image-only td` (0,1,3, beats the striping) and bumping the color from a luminance-twin-of-page-bg `#111000` to a clearly-amber `#3a2c08` (with `#4d3a0c` on the first-cell marker stripe). Legend swatch (`.row-marker-imageonly`) updated to match the new color so the legend accurately mirrors what the row looks like. Text contrast on the new background remains ≥ 8 : 1 against the `#e5e5e5` foreground — comfortably above WCAG AA.

[1.7.12]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.12

## [1.7.11] — 2026-05-12

### Changed

- **Per-site detail page's row-marker legend redesigned as a proper 3-column table.** Pre-v1.7.11 the legend was two flex-row paragraphs (swatch + run-on text), and on a wide viewport the long descriptions broke awkwardly mid-clause — "...it" + "contains spaces, non-ASCII characters, exceeds 200 chars," + "or matches a default scanner output pattern like" + "Scan_20240115_001.pdf" + ". Often correlates..." on five visually-distinct lines that the eye had to reassemble. The new layout is a `<table class="row-marker-table">` with three columns — **Marker** (~26% width, holds the swatch + name), **What it means** (~37%, the definition), **What to do about it** (~37%, the remediator guidance) — with `<thead>` column labels and `border-bottom` row dividers so each marker reads as one self-contained row. The marker name (`Yellow vertical bar on the left edge of a row` / `Faint yellow row tint`) gets `white-space: nowrap` to stay on one line in the Marker column. A `@media (max-width: 700px)` rule collapses the table to a stacked layout so the cells don't squeeze each other on narrow viewports. Required overriding the global `table { table-layout: fixed; width: max-content }` (used by the file-inventory table for click-and-drag column resize) with `table-layout: auto; width: 100%` plus an explicit `<colgroup>` for the % widths. 3 new tests pin the table structure (3 header cells, 2 body rows with swatches, no surviving `.row-marker-row` paragraphs).

[1.7.11]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.11

## [1.7.10] — 2026-05-12

### Changed

- **Index-card donut grown from 130 × 130 px to 180 × 180 px (and the inner-hole inset from 14 to 22 px) so "MAY NEED AUDIT" comfortably fits inside the inner hole.** v1.7.9's `text-align: center` fix put the .pct flex item perfectly at the donut's geometric center (verified at exactly 0 px offset), but the small caption — at 113 px wide after v1.7.8's softening — was effectively the same width as the 102 px inner-hole diameter, so the text's edges touched the colored ring at the y-positions where the circular chord is narrower than the diameter. Result: even though the text was centered, it visually read as "off" because the caption was crowding the orange/blue ring at the corners. The new 180 × 180 donut yields a 136 px inner hole; "may need audit" sits ~10 px clear of the ring on each side and ~75 px clear around the percentage. Percentage glyph upsized in lock-step from 1.5 em to 1.7 em (matching the per-site detail page's `.dp-pct`). No other layout change on the card; the donut-row's caption column shrinks ~50 px to absorb the bump, which still leaves plenty of room for "Two-thirds may need audit · 69 of 102 files" on a single line at any sane viewport.

[1.7.10]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.10

## [1.7.9] — 2026-05-12

### Fixed

- **Donut percentage now stays centred inside the donut hole on every index-page card.** Side-effect of v1.7.8's softening of "need audit" → "may need audit": the longer caption widened the inner `.pct` box, but `.site-card .donut .pct` was a left-aligned column (no `text-align: center` rule). With "need audit" the percentage glyphs and the caption text happened to be near-equal width, so centering looked correct by coincidence; "may need audit" is two letters longer and broke the illusion (the percentage stuck to the left edge of a wider `.pct` box). Added `text-align: center` so both the percentage and the small caption properly centre inside the donut hole regardless of caption length. The sibling `.dp-hero .dp-donut .dp-pct` on the per-site detail page already had this rule from the start, which is why the detail-page donut was unaffected.

[1.7.9]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.9

## [1.7.8] — 2026-05-12

### Added

- **Expanded "Technical details" disclosure on every index-page card, with copy-to-clipboard buttons on every row.** The pre-v1.7.8 collapsed section showed only `hostname` and `ip` as two terse `<p>` lines. It now shows a five-row mini-grid mirroring the per-site detail page's meta-grid — **Website**, **IP**, **Hostname**, **Path**, **URL** — with a copy button on each so a remediator can grab any of these strings straight from the fleet index without first opening the detail page. The URL row keeps a clickable `<a target="_blank">` alongside the copy button so both intents (visit, paste) work in one place. Click feedback: the button widens, swaps the clipboard icon for a green "Copied" tag for 1.4 s, then snaps back. Implementation uses the same `navigator.clipboard.writeText` + `execCommand("copy")` fallback pair as v1.7.7's detail-page buttons; a small `COPY_ICON_SVG` + `copyableValue(...)` helper duplicate of the detail-page code lives in `src/web/index-page.js` so the two pages stay decoupled (a change to one doesn't risk regressing the other). pointer-events: auto is added for `.tech-details .meta-copy` and `.tech-details .meta-value a` so the copy buttons and URL link remain interactive even though the card-wide stretched-link covers them. The clipboard handler `stopPropagation`'s and `preventDefault`'s the click so the stretched-link never fires mid-copy. 6 new tests cover the five label/value rows, the data-copy raw values, the URL link's coexistence with the copy button, and the omit-when-empty fallback path.

### Changed

- **Gentler language throughout the rollup outputs: "needs/need remediation" → "may need remediation"; "need audit" → "may need audit".** The pre-v1.7.8 phrasing read as prescriptive ("Two-thirds need audit", "files need remediation", "Files needing remediation") — telling managers and remediators what *has* to happen. The new phrasing is accurate but soft: filecap surfaces files that *may* warrant a closer accessibility review, and the actual remediation decision is up to the audit team and the content owner. Touches every user-visible surface where the old wording appeared: the index-page card phrase buckets (`No files may need audit`, `A small share may need audit`, ..., `Nearly all may need audit`), the audit tile label, the donut caption, the "by-file-type" column headings (`Files that may need remediation` / `Files that may not need remediation`), the duplicates explainer ("Each variant **may need** its own remediation pass"), the per-site detail page's dp-hero (same phrase buckets), the stat-card label (`files may need remediation`), the row-color legend (`May need OCR before...`), the `audit-summary.txt` text deliverable (the `AUDIT SCOPE` label, the per-category captions, the per-server breakdown line, the totals row, the bullet point on image-only PDFs, the PDF detail line), and the `README.txt` template's "files that may need remediation" intro plus the renamed "What 'May need remediation' means" glossary entry. Phrasing in code comments was left alone — comments aren't manager-facing.

[1.7.8]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.8

## [1.7.7] — 2026-05-12

### Fixed

- **Whole-card click now works on every index-page card.** The v1.7.1 stretched-link pattern set the link at `z-index: 0` and the other card children at `z-index: 1`, which meant clicks on the visible content (full-name heading, total/audit tiles, donut percentage text, file-type chips, access chip) hit the children — none of which had a click handler — and the user saw nothing happen. Only the small padding gaps between children actually navigated to the detail page. Bumping the link's z-index introduces fresh landmines (it would cover the action buttons, which would need ever-higher escape hatches, and the donut's internal `.pct { position: relative; z-index: 1 }` would still escape on top of the link). Cleaner solution: pin `pointer-events: none` on every non-`.card-stretched-link` descendant of `.site-card` (parent + universal-descendant in one rule) so the click falls through to the stretched-link, then explicitly re-enable `pointer-events: auto` on the two action buttons (`.actions .btn`) and the disclosure summary (`.tech-details summary`) so those stay separately clickable. Two new tests pin the CSS rules so the regression can't slip in again.

### Added

- **Copy-to-clipboard buttons on the per-site detail-page meta-grid.** Designed for remediators who need to paste these values into a terminal or browser without text-selecting monospace strings by hand. Each of the five copy-worthy meta-grid rows — **IP**, **Hostname**, **Scanned path**, **Scanned at**, **Public URL** — gets a 24 × 22 px button on the right edge with a clipboard-outline SVG icon. The two short-identifier rows (**Website**, **Server**) intentionally don't get buttons per user spec. Click feedback: the button widens, swaps the icon for the word "Copied" in green for 1.4 s, then snaps back. Uses `navigator.clipboard.writeText` first, with a hidden-textarea + `document.execCommand("copy")` fallback for `file://` loads and very old browsers. Single delegated `document.addEventListener("click", …)` covers every button so the report can have as many copy targets as we add later without per-button wiring. New `copyableMetaCell(value, displayHtml, label)` helper in `src/report/html.js` keeps the markup terse; the wrapped Public URL row still renders its `<a target="_blank">` for one-click visit *and* shows the copy button on the same line. 5 new tests assert presence/absence of buttons on the right rows, the `data-copy` attribute carries the raw value, and the clipboard handler IIFE is embedded in the inline `<script>`.

[1.7.7]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.7

## [1.7.6] — 2026-05-12

### Added

- **Access-method chip on every index card + matching "How to access this site's files" panel on every per-site detail page.** Designed for non-technical managers and outside remediators who land on the rollup and don't yet know what kind of system each ICJIA site is, or what credentials they'd need to actually open a flagged file. Each site is auto-classified into one of three buckets from its existing `sites.json` config (no schema change required) — `strapi` (`publicUrlBase` ends in `/uploads`, ~10 ICJIA sites), `github` (`type: "git"`, 6 sites), or `server` (fallback for SSH-reachable static directories, e.g. the Archive's `/root/files`). The index card shows the chip in the card-head eyebrow position above the nickname, color-coded by category (cyan = Strapi, violet = GitHub, amber = bare server) with WCAG AA 4.5 : 1+ contrast on the card's dark background. The per-site detail page repeats the classification as a more prominent callout immediately below the dp-hero: eyebrow ("How to access this site's files"), heading ("Strapi CMS / SSH required" / "GitHub repo / access required" / "Server / SSH required"), a method paragraph ("Files are served by a Strapi CMS instance on a remote Linux host…" / "Files live in an ICJIA-owned GitHub repository…" / "Files are stored in a static directory on a remote Linux host…"), and a credential line ending with the SSH-key / GitHub-org-access requirement plus **"Contact IDS at ICJIA to request access."** Implementation lives in a new exported helper `deriveAccessKind(site)` in `src/commands/web-rollup.js` plus two parallel copy maps (`ACCESS_CHIP_LABEL` in `src/web/index-page.js` and `ACCESS_PANEL_COPY` in `src/report/html.js`) so a manager going index → detail sees consistent wording. 20 new tests (8 for `deriveAccessKind`, 5 chip variants in `renderCard`, 5 panel variants in `writeHtml`, 2 end-to-end plumbing tests through `runWebRollup`) — total now 30 test files / 395 tests.

[1.7.6]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.6

## [1.7.5] — 2026-05-11

### Documentation

- **README — "Wait, if it's password-protected, why can I still view-source on the gate page?" section** under Production deployment. Common observation from people who reach the gate page; the short answer is that what they're viewing the source of is Netlify's challenge page, not the underlying fleet rollup. The new section walks the reader through three `curl` commands they can run to verify that the actual inventory content (site names, file paths, public URLs, CSVs) is never served until they authenticate — including a grep against the 3.5 KB challenge body that returns zero matches for any fleet identifier, and a direct request for `audit-file-list-master.csv` that returns `HTTP 401` instead of the file. Also documents a known fallback design (custom Netlify Edge Function serving our own gate HTML from in-tree source for full auditability) that's intentionally not yet implemented; the section explains why and points readers at GitHub Issues if they need it.

[1.7.5]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.5

## [1.7.4] — 2026-05-11

### Documentation

- **README refresh for v1.7.x.** Manager TL;DR now mentions the v1.7.x infographic redesign (large cards, two-up colour-coded numbers, donut chart, plain-English captions, clickable cards, resizable detail-page columns, "Public URL" promoted to column 4) and points to `CHANGELOG.md` for the full release-by-release breakdown. Developer TL;DR is brought current: 30 test files / 375 tests; renderCard exported from `src/web/index-page.js`; `dp-hero` classes on per-site detail pages; CSS-only conic-gradient donut; `table-layout: fixed` + `<colgroup>` for resizable columns. Status section pinned to `v1.7.x shipped`, with a new row 18 in the phase-status table covering the visual redesign work (siteFullName plumbing, 2-col grid, donut, clickable cards, two-axis touch pan, column resize, big duplicates section). Schema docs now mention the optional `siteFullName` field. The `type: "git"` example was updated to the correct VPP domain (`vpp.icjia.illinois.gov`) and shows the full set of v1.7 fields (`siteFullName`, `siteUrl`, `publicUrlBase`). No code changes — this release exists so the npm registry's README mirrors the GitHub state.

[1.7.4]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.4

## [1.7.3] — 2026-05-11

### Added

- **Resizable columns on the per-site detail-page file table.** Click-and-drag the right edge of any column header to resize that column. Touch users can drag too — the 8 px hit zone uses pointer events with `touch-action: none` so the browser hands the drag to the resize logic instead of starting a horizontal pan. Implementation: each `<th>` gets a small absolutely-positioned `<span class="col-resize-handle">` on its right edge (subtle 2 px blue indicator on hover); the table emits a `<colgroup>` with one `<col data-col="…">` per CSV column carrying an initial width; JS pointermove updates the `<col>`'s style.width. Table is now `table-layout: fixed` so column widths are authoritative (was `auto`, which let cell content override `<col>` widths). The existing sort-on-click (header label area), filter-bar chips, sticky first column, and v1.7.2 two-axis touch panning of the table viewport all continue to work — the resize handle's `pointerdown` stops propagation so it doesn't trigger sort or pan, and the existing pan code's "bail on interactive child" selector was extended to also bail on `[data-resize-handle]`. Initial per-column widths are tuned to typical content: 90 px for File extension, 110 px for narrow text, 170 px for Date published, 220 px for filenames / paths, 300 px for Public URL and Full file path. Minimum after a drag is 60 px so a column can't be shrunk past readability.

[1.7.3]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.3

## [1.7.2] — 2026-05-11

### Changed

- **CSV column order — Public URL promoted from column 8 to column 4.** Managers and remediators open the public URL more often than any other column; under the old layout it was buried four columns deep, requiring horizontal scrolling on most viewports. The new order is: Server, Website, Server IP, **Public URL**, Date published, Source folder, File location, Full path, File name, … New v1.7.2 test pins `CSV_COLUMNS[3]` to `publicUrl`; the existing `colIndex("publicUrl")` lookups in the test suite already used dynamic indexing so they all kept working without further changes.
- **Per-site detail-page table now scrolls both axes with touch-pan support.** The `.table-wrap` rule used `overflow-x: auto` only, which combined with `max-height: 70vh` clipped vertical overflow rather than scrolling it; tables longer than the viewport pushed the page footer off-screen on iPad/iPhone. Switched to `overflow: auto` so both axes are scrollable, raised `max-height` to `75vh`, added `touch-action: pan-x pan-y` so iOS/Android handle native two-finger pan in both directions without delay, and `overscroll-behavior: contain` so the inner scroll doesn't bubble up to the page. `.table-scroll` (the wider container used by some non-file-table sections) got the same treatment.
- **`web-rollup` now honours `sites.json`'s `publicUrlBase` over the cached inventory header's value** for the master CSV. The old code spread `header.metadata` into `consolidatedSources` without overriding `publicUrlBase`, so a domain rename in `sites.json` was silently ignored on the next rollup unless the per-site inventory was re-scanned. The new code explicitly overrides `publicUrlBase` with `sitePublicUrlBase` (already computed earlier from `site.publicUrlBase ?? header.metadata?.publicUrlBase`) so the comment-promised "sites.json is authoritative" behaviour is actually enforced.

### Added

- **Big visual "duplicates" treatment on the fleet index.** The "Files that appear on more than one server" section is now an infographic-style banner — eyebrow label ("Cross-server file map"), 2.4 em weight-900 title with the actual filename count, and a 2-up tile pair showing exact-copy count (blue) and variant count (amber). Below the banner is a now-open-by-default explainer that leads with **"This is normal — not a webmaster error"** and explains the agency-history reason (Archive used to be the library; each program later got its own site and copies were pushed to each). The collapsible details block was replaced with a permanent panel because managers were scrolling past the small h2 and the collapsed details summary without realising what the section meant.
- **VPP `publicUrlBase` fixed** in `~/.filecap/sites.json` (`vpp.illinois.gov` → `vpp.icjia.illinois.gov`) so per-file links resolve to the live CMS. Re-scanned VPP so the cached inventory header carries the corrected domain forward.

### Fixed

- **Card CTA buttons now have explicit `position: relative; z-index: 2`** so the v1.7.1 stretched-link overlay can never accidentally swallow the "Download spreadsheet" click. The visual effect is the same — empty card areas still navigate to the detailed report — but the bottom buttons are guaranteed clickable independently. New v1.7.2 test asserts the download `<a>` is rendered as a separate element with the `download` attribute outside the stretched link.

[1.7.2]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.2

## [1.7.1] — 2026-05-11

### Fixed

- **Donut chart now renders.** The v1.7.0 CSS used `calc(var(--pct, 0) * 1%)` for the conic-gradient stop, but `--pct` is emitted with a `%` suffix (e.g. `--pct: 67.6%`) and CSS `calc()` cannot multiply two percentages — every browser silently rejected the property and `background-image` resolved to `none`, so the donut was invisible on every fleet-index card and every per-site detail page. Replaced both `calc(var(--pct, 0) * 1%)` references (one in `src/web/index-page.js`, one in `src/report/html.js`) with the direct `var(--pct, 0%)` percentage stop. The donut now renders correctly on the fleet index AND on every per-site detail page.

### Added

- **Whole-card clickability + hover lift on the fleet index.** Every site card is now itself a click target that navigates to the detailed report — a manager can click anywhere on the card body, not just on the small "View detailed report →" button. Implemented via the standard "stretched-link" pattern: an absolutely-positioned `<a class="card-stretched-link">` overlay covers the card area and inherits its border-radius; child interactive elements (`View detailed report` button, `Download spreadsheet` button, site-url link, technical-details disclosure) sit above the overlay at `z-index: 1` so they still work independently. On hover, the card translates up by 4 px, the shadow deepens, and the border tints to the accent blue — visually obvious affordance. `:focus-within` paints a 3 px accent-blue focus ring around the whole card for keyboard users. Honours `@media (prefers-reduced-motion: reduce)` to disable the lift animation for users who request reduced motion.
- **Empty-string `siteFullName` falls back to `siteName`** on the fleet index (matches the same treatment already applied to the detail-page H1 in v1.7.0 commit `01c1d4e`). Changed `siteFullName ?? siteName ?? site.name` (which only falls through on `null` / `undefined`) to `siteFullName || siteName || site.name` (which also falls through on `""`).

### Tests

- 3 net new tests in `test/index-page.test.js`: empty-string `siteFullName` fallback; tightened the previously-loose "two-up tiles" assertion into two separate tile-bound assertions so a future total/audit number swap actually fails (mirrors the equivalent dp-hero tightening in v1.7.0 commit `552f116`); new "stretched-link" markup assertion. 371/371 passing.

[1.7.1]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.1

## [1.7.0] — 2026-05-11

### Added

- **Optional `siteFullName` field in `~/.filecap/sites.json`.** Each site can now declare a verbose human name alongside its short nickname (`siteName`). The full name flows through `web-rollup → report → writeHtml` and is rendered as the card title on the fleet index and the H1 on the per-site detail page. Sites without `siteFullName` cleanly fall back to `siteName` — zero-config compatibility for existing fleets.
- **Manager-friendly card anatomy on the fleet index.** Each site card now leads with the full name (large, bold) and a small uppercase nickname above it (`#c0cdda`, weight 800 — comfortably above WCAG AA 2.1 contrast at small sizes). Below the title: a two-up "tile" pair — total files (blue, `#4dabf7`) and files needing audit (amber, `#ffa84d`) — with the numbers blown up to ~3.6em weight 900. Below the tiles, a CSS-only donut (conic-gradient + `::after` mask, no SVG/JS) shows the audit-share percentage in the centre, accompanied by a plain-English caption ("Two-thirds need audit · 69 of 102 files") so a manager grasps the share without reading a chart. A row of file-type chips (PDFs / Office / images) sits below the donut, with a meta strip ("38 MB · scanned May 11") and the large CTA pinned to the bottom of every card via `margin-top: auto`. Equal-height alignment across the row is guaranteed by reserving fixed vertical slots for every block.
- **Same hero pattern on the per-site detail page.** A new `.dp-hero` block at the top of each `<site>.html` mirrors the index card: nickname + big full name + two-up tiles + donut on its own row + plain-English caption. Numbers go a notch bigger here (~4em) because the page is wider than a card. The existing meta-grid, filter chips, row-marker legend, "image-only PDFs need OCR" chip, CSV download button, and file table all sit below — **unchanged**.
- **Donut chart is pure CSS** (`conic-gradient` ramp + `::after` mask). No SVG, no chart library, no JavaScript dependency. Renders identically online and offline.

### Changed

- **Card grid switches from 3-col to 2-col at desktop** (and collapses to 1-col below 820 px viewport). Each card gets significantly more horizontal room, which is what lets the hero numbers scale up and the donut sit on its own row.
- **`--fc-text-muted` token bumped from `#666666` to `#9aa5b1`** for WCAG AA 4.5:1 contrast against the card-gradient background. The legacy `#666666` was 3.0:1, below AA for normal text on `#18202b`.
- **Design tokens added to `src/web/styles.js`** for the new palette: `total` (#4dabf7), `audit` (#ffa84d), `totalTileBg`, `auditTileBg`, `nickname` (#c0cdda), `cardBgTop` / `cardBgBot`, `ctaBg`, `ctaFg`. Emitted as `--fc-*` CSS custom properties from `darkModeCss()`.
- **`renderCard` is now exported** from `src/web/index-page.js` so it can be unit-tested directly. Was previously a local helper. New test file `test/index-page.test.js` adds 7 cases covering the new anatomy.

[1.7.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.0

## [1.6.7] — 2026-05-11

### Added

- **`examples/audit-fleet-auto.sh`** — non-interactive wrapper around `audit-fleet.sh`. Drives the inner script under `expect` so the four interactive prompts that gate a fleet run (fleet-level "Proceed with audit of N server(s)?", per-server "Choice:" config-review, per-server "Continue anyway?" on URL HEAD failure, per-server "Proceed anyway?" on low local disk) all get auto-answered. The naive `echo y | ./audit-fleet.sh` pipeline doesn't work because the SSH calls in audit-fleet's pre-validation loop inherit (and drain) stdin, so `read` later sees EOF and `set -e` aborts silently before the prompt is reached; an `expect`-allocated pty side-steps that. Honours `SKIP_VERSION_CHECK` (defaults to 1) and `AUDIT_HTML` (defaults to 1). Same exit code as `audit-fleet.sh`. Requires `expect` (preinstalled on macOS; `apt install expect` on Debian).

### Changed

- **URL HEAD reachability check accepts HTTP 200–499 as "host reachable"** (in both `audit-fleet.sh` pre-validation and `audit-remote.sh` per-server check). Previously the check used `curl -fsSL --head`, which fails on any 4xx response and triggered an interactive "Continue anyway? [y/N]:" prompt for every Strapi-style site — those sites return **404 on the bare `/uploads`** because directory listing is disabled, even though the individual file URLs underneath are fine. The check now captures the HTTP code via `curl -sS -o /dev/null -w "%{http_code}"` and only treats 5xx, `000` (connection failure), or empty as a real reachability problem. The fleet pre-validation status column now shows the actual HTTP code (e.g. `404`, `200`) instead of `OK` / `FAILED`. Eight of ICJIA's existing fleet sites stopped throwing spurious prompts as a result.

[1.6.7]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.6.7

## [1.6.6] — 2026-05-11

### Security

- **Red/blue team re-audit covering 1.3.1 through 1.6.5** (full findings: `docs/security/audit-2026-05-11.md`). 5 new findings: 1 Moderate (fixed below), 4 Notes (accepted with documented mitigations). 0 production CVEs (`npm audit --omit=dev` clean). 356/356 tests green.
- **FC-2026-018 (Moderate) — fixed.** `audit-static.sh` was exposing the optional `FILECAP_GITHUB_TOKEN` PAT in `ps aux` argv for the ~10-second window of each `git clone` / `git remote set-url` call. The script previously inlined the token into the URL (`https://x-access-token:<TOKEN>@github.com/...`); on macOS and Linux, process arguments are world-readable, so any local user could see the token. The `gh CLI` auth path (the documented preferred option) was never affected. Fix: a new `git_with_auth` helper passes the PAT via the `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0=http.extraheader` / `GIT_CONFIG_VALUE_0` env-var triple instead — process environment is only readable by the same UID, so the token is no longer visible to other local users. Clone URL is always the clean `https://github.com/<owner>/<repo>.git`. Existing `.git/config` files with token-bearing URLs from earlier runs are scrubbed on the next invocation.
- **FC-2026-019 / 020 / 021 / 022 — Notes, accepted.** Master / duplicates CSV data-exposure surface (mitigated by Netlify Pro Site Password — verified HTTP 401 on every artifact), secrets.json same-UID readability (standard user-account trust boundary), audit-static.sh clone dir trust (same as Strapi mirrors), and new inline JS in HTML reports (reviewed for XSS — all handlers use class-list / dataset reads, no innerHTML or eval). Documented in the audit doc and README findings table.

[1.6.6]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.6.6

## [1.6.5] — 2026-05-11

### Added

- **"Image-only PDFs / need OCR (N)" filter chip on per-site detail pages.** Yellow-bordered chip in the primary filter bar. Conditionally rendered — only appears when the site has at least one image-only PDF in its inventory (no noise on sites that have none). Clicking it filters the table to just the rows where the PDF has no text layer; these are typically the most expensive remediation work because they need OCR before tagging is possible. Yellow accent matches the existing image-only row tint so the chip is visually tied to the rows it surfaces.

[1.6.5]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.6.5

## [1.6.4] — 2026-05-11

### Added

- **"What are the colored row markers?" legend on per-site detail pages**, rendered as an aside note immediately above the inventory table. Two visual swatches that mirror the actual table styling: a yellow-left-bordered swatch for flagged-filename rows (spaces / non-ASCII / overlong / scanner-default name patterns like `Scan_20240115_001.pdf`), and a faint-yellow-tinted swatch for image-only PDF rows (scanned, no text layer — needs OCR before remediation, typically the most expensive work). The legend is hard to miss but doesn't dominate — small font, dedicated card, sits between the filter chips and the table.

[1.6.4]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.6.4

## [1.6.3] — 2026-05-11

### Added

- **`siteUrl` field on sites.json entries — the front-end homepage URL** that visitors see (e.g. `https://dvfr.illinois.gov/`), distinct from `publicUrlBase` (the file-server URL like `https://dvfr.icjia-api.cloud/uploads` that backs per-file clickable links in the CSV/HTML reports). The bundle index site cards and per-site report meta-grid now display `siteUrl` as the "Public URL" link — manager clicks it and lands on the site's homepage, not the API server's uploads directory. Falls back to `publicUrlBase` (then NDJSON header's publicUrlBase) when `siteUrl` is omitted, so existing entries keep working unchanged.
- **Threading `siteUrl` through `runReport` → `writeHtml`** so per-site detail pages render the correct URL regardless of whether the NDJSON header carries the field. Standalone `filecap report` calls (no `siteUrl` arg) fall back to the inventory's metadata as before.

[1.6.3]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.6.3

## [1.6.2] — 2026-05-11

### Added

- **Strict mode in `audit-fleet.sh`: refuse to roll up a partial fleet.** When any per-site audit fails (SSH/clone/scan), the script now aborts before the consolidation + rollup step instead of quietly shipping a bundle that's missing sites. The auditor sees a clear "X of Y site(s) failed; refusing to roll up" error pointing at `failed_servers.txt` plus per-mode debugging hints (SSH, git, URL HEAD). Pass `--allow-partial` (or set `AUDIT_ALLOW_PARTIAL=1`) to opt out and ship a partial bundle anyway.

### Fixed

- **JSON loader bug shifting fields for `type:"git"` entries.** The TSV loader inside `audit-fleet.sh` used `IFS=$'\t'` for `read`, but bash collapses consecutive whitespace separators (tab is in bash's whitespace set), destroying the empty `user`/`host`/`remotePath` fields a git site has and shifting every subsequent field left by three positions. Result: `vpp-git` was parsed as `type=strapi`, `host=publicUrlBase`, and got routed through the SSH preflight where it failed with `UNREACHABLE`. Switched the separator to ASCII unit-separator (`\x1f`) — outside bash's whitespace set, so consecutive empties are preserved. Existing strapi-only `sites.json` files were unaffected because their entries always had all four fields populated.
- **`audit-static.sh` `git fetch`/`git clone` failing on the "update existing clone" path.** The script piped `git fetch` and `git clone` output through `| head -20`, which closed the pipe early and sent SIGPIPE back to git, making it return non-zero even on successful fetches/clones. Removed the truncation — output flows freely now and only real failures trigger the error branch.

### Changed

- **Site cards on the bundle index now show the site's URL** under the site name (small blue link), and the **per-site detail page meta-grid** has a new "Public URL:" row. Pulled from `sites.json publicUrlBase` first, falling back to the NDJSON header. (Frontend-vs-API URL distinction is a follow-up — currently using whatever `publicUrlBase` is set to.)

[1.6.2]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.6.2

## [1.6.1] — 2026-05-11

### Added

- **Public URL displayed in two places** for every site:
  - **Bundle index site card**: under the site name (h3), a small blue link showing the site's `publicUrlBase` (e.g. `https://dvfr.icjia-api.cloud/uploads`, `https://vpp.illinois.gov` for VPP-git). Clicking opens the actual site in a new tab. Hidden when the site has no `publicUrlBase` configured.
  - **Per-site detail page meta-grid**: a new "Public URL:" row alongside Server, IP, Hostname, Scanned path, Scanned at. Linked, same target/rel attrs as the index card. Skipped for consolidated reports (which already list the websites separately).

The data is pulled from `sites.json`'s `publicUrlBase` first (authoritative — the source of truth for what's deployed), falling back to the NDJSON header's `publicUrlBase` for inventories whose sites.json entry doesn't have it.

[1.6.1]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.6.1

## [1.6.0] — 2026-05-11

### Added

- **`type: "git"` site mode for self-contained static-site (Nuxt) repos.** Audits sites whose PDFs live inside a GitHub repo's `/public/` folder rather than on a CMS host. `sites.json` gets three new optional fields: `type` (enum `"strapi"` | `"git"`, defaults to `"strapi"`), `gitRepo` (the clone URL — required when type is `git`), and `publicPath` (the directory inside the repo to scan, defaults to `"public"`).
- **`examples/audit-static.sh`** — sibling to `audit-remote.sh`. Shallow-clones the repo to `~/filecap-audits/<name>/clone/` (or fetches + resets if already cloned), runs the existing `filecap scan` on the configured `publicPath`, and rewrites each entry's `absolutePath` to a GitHub source URL of the form `https://github.com/<owner>/<repo>/tree/<branch>/<publicPath>/<rel-path>` — clickable, portable, points at the source-of-truth. Default branch is detected from `git symbolic-ref refs/remotes/origin/HEAD`; falls back to `main`.
- **`audit-fleet.sh` branches on `type`** during both pre-validation and the per-site audit loop. Git-type entries get a `git ls-remote --exit-code` preflight (instead of SSH+du), then dispatch to `audit-static.sh`; strapi-type entries keep their existing SSH+rsync flow. Mixed sites.json (strapi + git side-by-side) works in a single fleet run; output drops into the same per-site directory layout (`runs/<ts>/inventory.ndjson` + `latest/` symlink), so `filecap web-rollup` picks up git-type entries unchanged.
- **Auth resolution chain for git operations**: (1) `gh auth status` (preferred — uses gh's credential helper transparently), (2) `FILECAP_GITHUB_TOKEN` env var (`x-access-token:<pat>` interpolation, never written to disk, scrubbed from `.git/config` after clone), (3) anonymous (public repos only). No PAT prompt, no SSH key requirement.

### Tests

- 6 new tests for the schema extension covering: accepts `type: "git"` + `gitRepo` + `publicPath`; accepts entries omitting `type` (defaults to strapi); rejects `type: "git"` without `gitRepo` (Zod refine); rejects unknown `type` value; accepts mixed strapi+git sites.json; `.strict()` still rejects unknown extra fields on git entries.

[1.6.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.6.0

## [1.5.8] — 2026-05-10

### Added

- **"Download spreadsheet (CSV)" button in the sticky top bar of every per-site detail page.** The HTML report shows the basics for at-a-glance review; the CSV is what people actually use for work. The button is rendered as a prominent blue primary action on the right side of the back-bar, paired with the "← Back to fleet index" link on the left — both critical actions visible together on every detail page without scrolling. `writeHtml` accepts a new `csvHref` parameter; `runReport` defaults it to `"audit-file-list.csv"` (the sibling file it just wrote) when omitted, so standalone single-site audits also get the button; `web-rollup` overrides with the renamed per-site CSV filename (`<slug>-<timestamp>.csv`).

[1.5.8]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.5.8

## [1.5.7] — 2026-05-10

### Added

- **"← Back to fleet index" sticky bar at the top of each per-site detail page** when the report is part of a web-rollup bundle. Always visible (`position: sticky`); link goes to `index.html` in the same directory. Standalone single-site audits don't render the bar (no `index.html` sibling to link to) — `runReport` only emits it when `backHref` is passed by `web-rollup`. Hidden in print stylesheet so paper output stays clean.
- **CHANGELOG link in both footers.** The per-site report footer (which already linked to GitHub) gained a CHANGELOG link; the bundle index footer gained both (GitHub + CHANGELOG). Both open in a new tab with `rel="noopener noreferrer"`.

### Changed

- **Wording: "audit fleet" → "fleet audit"** everywhere (index H1, brand bar, default title, MCP tool default, README docs). "Fleet audit" reads as the right noun phrase ("an audit of a fleet"); the prior order parsed awkwardly.

[1.5.7]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.5.7

## [1.5.6] — 2026-05-10

### Changed

- **Duplicates summary table now uses the same visual styling as the per-site report tables.** 12px tabular type, tight padding (`0.45rem 0.65rem` thead / `0.35rem 0.65rem` td), alternating row stripes (`#0c0c0c` / `#0d1117`), hover row (`#1a1a1a`), sticky thead, sticky first column, link color `#60a5fa`. Every data table in the app now looks the same.
- **Sites column (and every other column) auto-sizes to its content** — dropped per-column `min-width` rules that were forcing extra width. The "Sites" column was particularly weirdly wide before (~18ch min) because some rows had many comma-separated sites; now it shrinks to whatever the longest cell needs.
- Cells use `white-space: nowrap` + `max-width: 320px` + `text-overflow: ellipsis` (matching the per-site tables). Full text is in a `title=` tooltip on every clipped cell, so hover reveals the complete filename / site list / date range.

[1.5.6]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.5.6

## [1.5.5] — 2026-05-10

### Changed

- **Hero stat block rewritten as an infographic** instead of three side-by-side numbers. Three elements stacked vertically:
  1. **Big total** — single huge headline number (`clamp(3.5em, 9vw, 6em)`) above an uppercase "TOTAL FILES SCANNED ACROSS N WEBSITES" label, so a manager sees the headline before reading anything else.
  2. **Proportional split bar** — horizontal stacked bar with the remediable segment (orange gradient) sized by count and the reference segment (grey gradient) sized by count, each labeled with its absolute number, what-it-is, and percentage. The bar visually conveys the ratio at a glance — managers can see "most of the fleet needs audit work" without doing math. Has an `aria-label` describing both segments for screen-reader users. On viewports under 640px the segments stack vertically.
  3. **Arithmetic equation** — `14,914 total = 11,097 need accessibility audit + 3,817 don't`, in a low-key bordered box, so the number relationship is spelled out for managers who want to verify the math.

The old `.hero-stat-row` with three separate stat blocks is removed.

[1.5.5]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.5.5

## [1.5.4] — 2026-05-10

### Changed

- **Duplicates explainer rewritten to cover what to do with each kind.** Two new sub-sections now spell out the action for an audit lead:
  - **Exact (matching content hash):** fix accessibility once on the canonical copy, then push the corrected file to the other servers' CMSes under the same filename. Don't delete the duplicates — most are referenced by CMS entries on each site, and removing the file would break the page link. Goal: one corrected file appearing in N places.
  - **Variant (same filename, different content hash):** each variant is its own document and likely needs its own remediation pass. Open them in the per-site links to check whether they're truly distinct or one is canonical.
- **False-positive caveat added.** The cross-server matcher strips Strapi's 10-character hex suffix before comparing filenames, which can collide for unrelated files that happen to share a base pattern. The caveat explicitly calls out that `exact` matches are the high-confidence signal; `variant` matches are worth investigating but should be opened to confirm.

[1.5.4]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.5.4

## [1.5.3] — 2026-05-10

### Added

- **Headline "total files" stat in the hero**, alongside the existing "need accessibility audit" and "don't" blocks. Renders as a three-block row at the top of the index page so a manager can grab the headline number without reading the prose sentence below it. Coloured in the link-blue accent so it visually leads the row.
- **Clickable per-file site links in the duplicates summary table.** Each site name in the "Sites" column is now a link to that site's public URL for the file (opens in a new tab; the URL is also shown on hover via the `title` attribute). A manager or remediator can scan the table, spot a row that looks worth checking, and click straight through to the document on each server to compare them. Sites without a `publicUrlBase` configured fall back to plain text.

### Fixed

- **Duplicates table no longer pads to fill the wrapper.** Dropped `min-width: 100%` from the table and gave the scroll wrapper `width: fit-content; max-width: 100%`. On wide monitors the wrapper hugs the table (no blank space to the right of the last column); on narrow viewports the wrapper caps at 100% and horizontal scroll / drag-pan kicks in as before.

[1.5.3]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.5.3

## [1.5.2] — 2026-05-10

### Changed

- **Duplicates summary table styled to match the per-site report tables.** The 1.5.1 consolidated table read as squished — too-narrow columns, full filenames wrapping mid-word, no visual hierarchy. Now: per-column `min-width` (filename 28ch, sites 18ch, dates 24ch, …) so each column gets the space it needs and the table overflows horizontally rather than crushing; sticky first column (filename) stays anchored when you scroll right; sticky header row so column labels stay visible when you scroll down; row hover + alternating-row backgrounds; max-height with vertical scroll inside the wrapper. Same dark-palette treatment as the per-site report tables for visual consistency.
- **Click-and-drag horizontal pan on the duplicates table.** Mouse-drag horizontal pan with the same 5px-threshold / Pointer-Events / `setPointerCapture` pattern from the per-site reports (so single clicks still select text and hit links, drags pan smoothly even if the cursor leaves the wrapper). Touch panning was already native via `overflow-x: auto` with iOS momentum scroll preserved — that path is unchanged.

[1.5.2]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.5.2

## [1.5.1] — 2026-05-10

### Added

- **`audit-file-duplicates.csv`** — dedicated CSV of every cross-server duplicate occurrence, written into the bundle alongside the master CSV. Nine columns (Normalised filename, Match type, Group size, Website, Server, Date published, Size, Path, SHA-256 first 12), one row per occurrence so the audit lead can sort/filter/pivot in Excel — pivot by Website to see what each site has in common with Archive, or by Match type to focus on `variant` rows (same filename, different content) where content actually drifted. Download link added to the duplicates section on the index page.

### Changed

- **Duplicates table consolidated to one row per filename group** (was one row per file occurrence). For the ICJIA fleet that's 718 rows instead of ~1,800, and the per-page rendering drops the bundle's index.html from ~600 KB to ~270 KB. Columns: Filename, Match (exact / variant badge), Sites, Copies, Newest → oldest date, Total size. The detailed per-occurrence view lives in `audit-file-duplicates.csv` now.
- **Explainer copy** points readers toward `variant` rows (same filename, different content) as the more interesting cases — those are where someone updated a document on one site but not another. `exact` rows are usually intentional reposts.

### Removed

- **`.gitkeep` and `.gitignore` filtered out of the duplicates view.** These are placeholder/marker files that always exist as duplicates by design; including them was pure noise. Filter is case-insensitive and matches the exact filename only — files like `post-gitkeep-cleanup.pdf` still appear as duplicates if they actually exist on multiple servers.

[1.5.1]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.5.1

## [1.5.0] — 2026-05-10

### Added

- **Cross-server duplicates section on the bundle index page.** Detects files that appear under the same logical filename on more than one server (after stripping Strapi's appended 10-character hex hash, so `report_a1b2c3d4e5.pdf` on one site matches `report.pdf` on another). Each group is labeled either as an **exact copy** (same SHA-256) or a **same-name, different-content** variant (different SHA-256 — typically a file that was edited on one server but not the other). Within each group, items are sorted newest-first so the canonical version is at the top. Includes a manager-friendly explainer (collapsed by default) covering why duplicates exist (Archive's library legacy + per-program CMS migration) and that **a duplicate is not an error**, just something to examine. Section renders nothing when no cross-server duplicates exist.
- **Master spreadsheet — `audit-file-list-master.csv`.** A single CSV in the bundle root containing every file from every server in one row-per-file table. Same 14-column shape as the per-site CSVs; the leading `Server` column tells you which website each row came from. Auto-generated by `filecap web-rollup`; download link is added to the index page. For the 8-site ICJIA fleet that's a single 7 MB / ~15K-row spreadsheet a manager or vendor can open in Excel without juggling per-site files.
- **Site-name fallback in consolidated sources.** `web-rollup` now overlays the `siteName` from `sites.json` onto the consolidated metadata when building the master CSV — so the "Website" column populates correctly even for inventories scanned without `--site-name`.

[1.5.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.5.0

## [1.4.1] — 2026-05-10

### Fixed

- **Bug from 1.4.0: data rows had more cells than the header had labels.** When DOCX/XLSX columns were dropped from `CSV_COLUMNS`, the corresponding values in `buildRow()` / `buildRowValues()` were left in place. Result: per-site CSVs and HTML tables emitted 8 trailing cells without matching column headers, which Excel and the HTML table rendered as columns labeled `0`, `1`, `2`, … (the array indices) on the right edge. Both row-builders are now in sync with `CSV_COLUMNS`.

### Removed

- **PDF-specific introspection columns dropped from CSV / HTML.** Removed: `pageCount`, `hasTextLayer`, `isImageOnly`, `hasTags`, `hasFormFields`, `encrypted`, plus the format-agnostic `documentLanguage` and `officeLegacyFormat`. Same reasoning as the 1.4.0 DOCX/XLSX drop: remediators have Adobe Acrobat / Word / Excel and can read these properties directly from each file. The deliverable focuses on what's needed to *find* and *price* each file.
- **`Remediation needed?` column dropped.** Same reasoning — remediators classify files themselves once they can see the list. The `remediable` field is still on every entry in the underlying NDJSON (used by MCP `query_inventory`, the index-page stat cards, and the HTML report's category-filter chips). Only the per-row spreadsheet column is gone.

The CSV / HTML now has 14 columns total: Server, Website, Server IP, Date published, Source folder, File location, Full file path, Public URL, File name, File extension, File type, Size (bytes), Content hash (SHA-256), Duplicate of. Down from ~30 in 1.3.x.

[1.4.1]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.4.1

## [1.4.0] — 2026-05-10

### Removed

- **DOCX and XLSX introspection columns dropped from the CSV / HTML deliverable.** Removed: `docxHasHeadings`, `docxImageCount`, `docxAltTextCoverage`, `docxTableCount`, `docxTablesHaveHeaders`, `docxVagueLinkCount`, `xlsxSheetCount`. Remediators have native tools (Word, Excel) that surface these properties directly, and including them per-row inflated the table from ~30 columns to ~22 without giving anyone the file location, type, or duplicate signal that drives pricing. The deliverable now focuses on what's needed to *find* and *price* each file: filename, path, server, size, type, duplicate marker, public URL, plus PDF-specific cost drivers (page count, image-only/OCR, structurally tagged). The full DOCX/XLSX introspection remains in the underlying NDJSON inventory for any tooling that needs it (MCP `query_inventory`, custom reports). PDF columns are unchanged because image-only-PDF detection is a real cost driver for OCR work.

### Added

- **Click-and-drag horizontal pan on the per-site HTML table.** The cursor turns to the open-hand "grab" affordance over the table; clicking and dragging slides the table horizontally so wide tables don't require fishing for the bottom scrollbar. Implemented via the Pointer Events API with a 5px threshold so single clicks still trigger text selection and link clicks (sort headers, filename links, etc.). Mouse drags use `setPointerCapture` so the drag continues even if the cursor leaves the table. Touch panning was already native via `overflow-x: auto`; that path is unchanged (iOS momentum scroll intact).

[1.4.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.4.0

## [1.3.4] — 2026-05-10

### Fixed

- **Consolidated fleet HTML report header was rendering blank fields.** When `filecap report` runs against a consolidated NDJSON (output of `filecap rollup`), the metadata structure is `{ consolidatedAt, sources: [...] }` rather than the per-server `{ serverName, serverIp, hostname, scannedPath, scannedAt }` shape. The HTML header template assumed the per-server shape and rendered five empty `<span>`s. Now branches on `kind === "filecap-consolidated-header"` and shows fleet-appropriate fields: Audit type, Servers (count + names), Websites, Scan window (earliest → latest), Consolidated at. Per-site reports are unchanged.

### Changed

- **Wording softened from "needs accessibility work" to "needs accessibility audit"** across the index page, per-site HTML report cells, CSV cells, and the report-command preamble. The earlier wording read as definitive ("this file definitely needs fixes"); the new wording is appropriate for an inventory-scoping deliverable ("this file should be reviewed by the auditor"). Tests updated to match.

[1.3.4]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.3.4

## [1.3.3] — 2026-05-10

### Added

- **Bearer-token authentication for the public-URL HEAD-check.** Sites whose public URL is gated behind a JWT/bearer token (intranet portals, staff-only document libraries) can now be audited without the "URL FAILED" preflight warning. Tokens live in a new `~/.filecap/secrets.json` file (mode `0600`, never bundled, never exported via the saved-sites menu) keyed by server-name. An env var `FILECAP_BEARER_TOKEN_<SERVER_NAME_UPPER_SNAKE>` overrides the file when set — works with `op run -- ./audit-fleet.sh` (1Password CLI), `direnv`, or any other secret manager that injects env vars, so the JWT never has to touch disk. The token is fed to `curl` via stdin (`--header @-`) so it never appears in argv / `ps aux`. Resolution order: env var → secrets.json → none. Both `audit-fleet.sh` and `audit-remote.sh` self-resolve the token on each run.
- **`requiresBearerToken: boolean` field on `sites.json` entries.** Optional, informational — tells a remediator who receives a shared bundle "this site needs a JWT, ask for it separately." The token itself is never in `sites.json`; only this hint flag.
- **15 new tests** covering the secrets loader (missing-file, valid, invalid-JSON, schema violations, type errors), env-var precedence, server-name → env-var-name normalization, and tolerant fallback when secrets is null/empty. Full suite 327/327 green.

### Changed

- Fleet preflight URL status annotates token-authenticated sites as `OK*` instead of plain `OK`, so you can tell at a glance which sites probed with a bearer token.

[1.3.3]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.3.3

## [1.3.2] — 2026-05-10

### Added

- **`~/.filecap/config.json` user-config file with `webRollup.autoDeploy`.** When `webRollup.autoDeploy` is `true`, `filecap web-rollup` always runs `netlify deploy --prod` on completion — no `--deploy` flag needed. The CLI flag still wins when present, so the config only fills in defaults. Optional `webRollup.deploySite` (passed to `netlify deploy --site`) covers cases where the working directory isn't already linked. Config is validated against a Zod schema on load; unknown fields, typos, and wrong types fail loudly with a named error rather than being silently ignored. Loader returns `{}` cleanly when the file doesn't exist, so existing users see no behavior change unless they opt in.

[1.3.2]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.3.2

## [1.3.1] — 2026-05-10

### Fixed

- **`audit-remote.sh` rsync-stats parsing on macOS.** The script greped for `"Number of regular files transferred:"` (modern GNU rsync wording) but Apple's bundled `rsync` writes `"Number of files transferred:"` without the `regular`. With `set -o pipefail`, the no-match grep returned non-zero, which failed the assignment, which tripped `set -e` — the audit silently exited between rsync completion and the local scan with no error message. Symptom: every macOS fleet audit reported "0 succeeded, N failed" with empty inventories despite rsync clearly working. Grep now uses `(regular )?` to match either wording and is wrapped to tolerate no-match.

### Added

- **`audit-fleet.sh` accepts `~/.filecap/sites.json` directly.** Pass any `.json` path as the positional arg, or run with no arg and the script auto-detects `~/.filecap/sites.json` if present. Eliminates the sites.json → CSV conversion step. Enables the bundle-distribution workflow: hand a remediator the two `.sh` scripts plus a `sites.json` file, they drop it into `~/.filecap/` and run `./audit-fleet.sh` — no further configuration needed (assuming SSH keys are already authorized on the target servers).

[1.3.1]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.3.1

## [1.3.0] — 2026-05-10

### Security

- **Comprehensive red/blue audit completed.** Full findings in `docs/security/audit-2026-05-10.md`. 17 findings: 2 Critical, 6 Moderate, 7 Low, 2 Notes. All Critical and Moderate findings are fixed in 1.3.0; remaining Low items are either fixed or documented in the README's "residual risk" section.
  - **FC-2026-001 / FC-2026-002 (Critical):** Shell injection via SSH command interpolation. All variables are now passed through `printf '%q'` before embedding in SSH/rsync commands in `audit-remote.sh` and `audit-fleet.sh`.
  - **FC-2026-003 (Moderate):** rsync now uses `--no-links` to prevent symlink escapes from a compromised remote server.
  - **FC-2026-004 (Moderate):** MCP server gains `FILECAP_MCP_ALLOWED_PATHS` env var (colon-separated absolute paths) to restrict the `filecap_scan` tool's reachable directories. Unset = no restriction (backward-compatible).
  - **FC-2026-005 (Moderate):** README and `password-gate.js` CAVEAT now explicitly document that the client-side password gate uses an unsalted SHA-256 that can be cracked offline in seconds; Netlify Site Password is recommended for any non-public content.
  - **FC-2026-006 (Moderate):** `--sites-file` argument validation added: rejects non-`.json` paths; error messages no longer include `err.message` (which could leak file content fragments).
  - **FC-2026-007 (Moderate):** `sites.json` validated against a Zod schema on load; entries with unexpected fields or wrong types are rejected with a clear error.
  - **FC-2026-008 (Moderate):** XSS regression test suite added covering server name, site name, hostname, entry filename, and path injection vectors; confirms `htmlEscape()` covers all HTML table-cell output paths.
  - **FC-2026-011 (Low):** Audit work directory `~/filecap-audits/<server-name>/` now created with mode 700.
  - **FC-2026-013 (Low):** Added code comments to `src/introspect/docx.js` and `src/introspect/xlsx.js` documenting the intentional in-memory-only zip/XLSX parsing (prevents zip-slip).
- **Bumped `vitest` from `^1.6.0` to `^4.1.5`** to clear 4 moderate dev-dep CVEs (esbuild → vite → vite-node → vitest chain, GHSA-67mh-4wv8-2f99). All 304 tests pass on v4. Production dependencies remain zero-vulnerability per `npm audit --omit=dev`.

[1.3.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.3.0

## [1.2.3] — 2026-05-10

### Security

- **Bumped `fast-xml-parser` from `^4.5.6` to `^5.7.0`** to fix [GHSA-gh4j-gqv2-49f6](https://github.com/advisories/GHSA-gh4j-gqv2-49f6) (XML Comment / CDATA Injection via Unescaped Delimiters in `XMLBuilder`). Filecap doesn't use `XMLBuilder` (only `XMLParser` for DOCX introspection), but updating to the patched line is good hygiene. All 293 tests continue to pass against the new major.

### Changed

- **Fleet snapshot index page rewritten for non-technical managers.** The page that managers see when handed the URL now leads with plain-English context ("We scanned 7 websites and found 1,247 files in total. 892 need accessibility work; 355 don't.") followed by an explainer section answering the obvious follow-up question ("Why aren't all 1,247 counted?") with side-by-side cards explaining what gets fixed (PDFs, Word docs, Excel, PowerPoint) versus what doesn't (images get descriptions in the CMS; text files, placeholders). The "By file type" breakdown is now a side-by-side table showing remediation-scope vs reference-only counts. Per-site cards drop the hostname and IP from the visible part (folded into a collapsed "Technical details" disclosure) and use friendlier button labels ("View detailed report" / "Download spreadsheet"). Designed for managers who don't know what a11y, alt text, CMS, or remediation mean — every term is defined in plain language at first use.

[1.2.3]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.2.3

## [1.2.2] — 2026-05-10

### Fixed

- **Audit work directories now keyed by server-name instead of server IP.** Many Strapi fleets host multiple sites on the same physical server (e.g., 10 sites across 3 IPs is common with Forge). The pre-1.2.2 layout used `~/filecap-audits/<ip>/` which meant scanning two sites on the same IP would overwrite each other's local mirror and `latest` symlink. The new layout uses `~/filecap-audits/<server-name>/` (e.g., `dvfr-strapi-prod`, `r3-strapi-prod`, `i2i-strapi-prod`), giving each site its own dedicated audit directory regardless of how many share an IP. Applies to `audit-remote.sh`, `audit-fleet.sh`, and `filecap web-rollup`'s inventory lookup.

### Migration

- Pre-1.2.2 audit directories at `~/filecap-audits/<ip>/` are still readable but no longer referenced. To migrate existing data: `mv ~/filecap-audits/<ip> ~/filecap-audits/<server-name>`. The audit script prints a one-line advisory when it detects a legacy IP-keyed directory and the new server-name dir doesn't exist yet.

[1.2.2]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.2.2

## [1.2.1] — 2026-05-10

### Changed

- **Dark-mode palette warmed up to GitHub-Dark / Nuxt-style cool navy** instead of pure gray-black. Background `#0a0a0a` → `#0d1117`; card backgrounds `#161616` → `#161b22`; sunken backgrounds `#050505` → `#010409`; subtle borders `#2a2a2a` → `#21262d`; strong borders `#404040` → `#30363d`. Gives the bundle and per-site reports a slightly polished navy tint without being dramatically blue. Applies to web-rollup index, per-site HTML reports, and any direct `filecap report --html` output.

[1.2.1]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.2.1

## [1.2.0] — 2026-05-10

### Added

- **`filecap web-rollup` subcommand.** Bundles the most recent scan of every saved site into a self-contained static-site directory (index.html fleet overview, per-site HTML reports, downloadable CSVs, `robots.txt`). Optional client-side password gate via `--password`. Output defaults to `~/filecap-audits/_web-rollup/<UTC-timestamp>/`. Ready for drag-and-drop to Netlify or any static host.
- **`filecap_web_rollup` MCP tool.** Exposes the web-rollup orchestrator to AI agents (Claude Desktop, Claude Code, etc.). The MCP server now advertises five tools.
- **`w` menu option in `audit-remote.sh`.** Selecting `w` in the saved-sites menu prompts for an optional password and runs `filecap web-rollup` against all saved sites, then offers to open the resulting `index.html`.
- **`netlify.toml` in the bundle.** Auto-generated config with sensible cache headers (CSV cached 1h with `Content-Disposition: attachment`; HTML cached 5m with `X-Robots-Tag: noindex`), security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`), and the publish directory set to `.`. Drag-and-drop or Git-connected Netlify deployments work without any dashboard build-config tweaks.
- **`--no-client-gate` flag.** Skip embedding the client-side password gate JS in the bundle. Use this when relying on Netlify's paid Site Password feature for server-side authentication; the client-side gate is unnecessary (and overlaps awkwardly). If `--password` is also passed, it is ignored and a warning is printed.
- **`--deploy` flag.** After building the bundle, run `netlify deploy --prod --dir <output>` automatically. Combines build + push into a single command. Requires `netlify` CLI installed and `netlify login` already done. Prints friendly install instructions if the CLI is missing at runtime.
- **`--deploy-site <site-id>` flag.** Pass `--site <id>` to `netlify deploy` for non-linked sites.
- **`audit-remote.sh` `w` menu now offers three password modes** (none / client-side / Netlify Site Password) plus an optional auto-deploy prompt after building.
- **Postflight run summary.** After every successful `audit-remote.sh` run, a summary block prints showing total elapsed time, per-phase timings (SSH preflight, rsync, scan + introspect, report generation), bytes transferred, files updated, and inventory totals (file count, bytes, remediable count). For `audit-fleet.sh`, a per-server table shows timings, file counts, and byte counts side-by-side with fleet totals at the bottom. Helps auditors see where time is spent and spot anomalies (e.g., a server that suddenly takes 10× longer than usual).
- **SSH-key setup docs.** New "Setting up SSH access" section in the README explains how to generate an Ed25519 keypair on macOS or Linux, what to email IDS, and how to verify access. The audit scripts' SSH-preflight failure message now points at this section and explicitly mentions contacting IDS.

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
