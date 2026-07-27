# Manager-Facing Fleet Snapshot Index Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the `filecap web-rollup` index page so non-technical managers can understand what was found, why not all files need remediation, and a side-by-side type breakdown — without knowing what a11y, alt-text, CMS, or remediation mean.

**Architecture:** All changes land in `src/web/index-page.js` (new HTML structure + inline CSS) and `test/web-rollup.test.js` (updated + new assertions). No new modules — the page is self-contained. The `generateIndexHtml` function signature is unchanged so callers (`src/commands/web-rollup.js`) need no modifications. Version bump to 1.2.3 and CHANGELOG entry follow.

**Tech Stack:** ESM, vanilla template literals, Vitest, Node ≥ 20

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `src/web/index-page.js` | Modify | Hero section rewrite; new "Why not all N files?" explainer section; new side-by-side "By file type" tables; per-site card simplified (hostname/IP folded into `<details>`); new inline CSS blocks; footer tagline softened |
| `test/web-rollup.test.js` | Modify | Update assertion for old "Total inventoried" wording; add 5 new assertions |
| `package.json` | Modify | Bump version 1.2.2 → 1.2.3 |
| `CHANGELOG.md` | Modify | Add `[1.2.3]` entry |

---

## Task 1: Update `src/web/index-page.js` — Hero and explainer sections

**Files:**
- Modify: `src/web/index-page.js`

### Background

The current `generateIndexHtml` function has:
- A two-stat `.hero-stats` grid showing "total files" and "need remediation" with no context
- A flat "By type across the fleet" `<table class="by-type-table">` that mixes remediable and non-remediable categories
- `renderCard()` exposing hostname and IP in the header with no toggle

Key notes from reading the existing code:
- The function already computes `fleetTotalFiles`, `fleetRemediable`, `fleetByCategory` — reuse them
- `fleetNonRemediable = fleetTotalFiles - fleetRemediable` is NOT currently computed — add it
- Category key `"office-legacy"` is used in existing card rendering (`byCategory["legacy-office"]`) — NOTE: in the card code line 85 there is a bug-like inconsistency: `byCategory["legacy-office"]` but the CHANGELOG and design spec says `"office-legacy"`. The `CAT_LABELS` at line 172 uses `"legacy-office"`. The spec's JS computation uses `"office-legacy"`. Audit the actual NDJSON category values via the test fixture to know which is canonical — the test fixture at `test/web-rollup.test.js` line 34 sets `category: "pdf"` only. For the remediable/reference tables, both keys should be tried with a fallback of 0 so the tables render correctly regardless.
- The spec asks to skip table rows where count is zero

- [ ] **Step 1: Add fleet-wide computation for `fleetNonRemediable` and category maps**

In `src/web/index-page.js`, find the existing block after the `for (const sr of siteResults)` loop (currently ending around line 157) and add the following immediately after:

```js
  const fleetNonRemediable = fleetTotalFiles - fleetRemediable;

  // Manager-friendly categories for the by-type breakdown tables
  const remediableCategories = [
    { key: "pdf",              label: "PDFs" },
    { key: "office-document",  label: "Word documents (.docx)" },
    { key: "spreadsheet",      label: "Excel spreadsheets (.xlsx)" },
    { key: "presentation",     label: "PowerPoint (.pptx)" },
    { key: "office-legacy",    label: "Legacy Office (.doc, .xls, .ppt)" },
    { key: "legacy-office",    label: "Legacy Office (.doc, .xls, .ppt)" },
  ];

  const referenceCategories = [
    { key: "image",       label: "Images (.jpg, .png, .gif, .webp, .svg)" },
    { key: "text",        label: "Text files (.txt, .md)" },
    { key: "archive",     label: "Archives (.zip, .tar, etc.)" },
    { key: "audio-video", label: "Audio / video" },
    { key: "web",         label: "Web pages (.html, .css, .js)" },
    { key: "other",       label: "Other (placeholders, unrecognized)" },
  ];
```

**Note on legacy-office / office-legacy duplication:** The two keys both map to the same label. When building the table rows later (Step 4), we will deduplicate by summing them into one row.

- [ ] **Step 2: Replace the hero section HTML inside the template literal**

Find the existing `<section class="hero">` block (lines 490–503 of current file) and replace the entire section with:

```html
  <section class="hero">
    <h1>ICJIA accessibility audit fleet</h1>
    <p class="subtitle">Generated <time>${he(generatedAt)}</time> from ${he(String(siteCount))} website${siteCount !== 1 ? "s" : ""}</p>

    <div class="hero-summary">
      <p class="lead">
        We scanned ${he(String(siteCount))} ICJIA website${siteCount !== 1 ? "s" : ""} and found
        <strong>${he(fleetTotalFiles.toLocaleString())}</strong> files in total.
      </p>
      <p class="hero-stat-row">
        <span class="stat-block remediable">
          <span class="stat-num">${he(fleetRemediable.toLocaleString())}</span>
          <span class="stat-label">need accessibility work</span>
        </span>
        <span class="stat-block reference">
          <span class="stat-num">${he(fleetNonRemediable.toLocaleString())}</span>
          <span class="stat-label">don't</span>
        </span>
      </p>
    </div>
  </section>
```

- [ ] **Step 3: Add the explainer section immediately after the hero**

Remove the old `<section class="section">` with `<h2>By type across the fleet</h2>` (current lines 505–511). In its place, insert:

```html
  <section class="explanation">
    <h2>Why aren't all ${he(fleetTotalFiles.toLocaleString())} files counted as needing work?</h2>

    <p>
      Good question — the number of files we found and the number that
      need accessibility work are different on purpose. Here's the gist:
    </p>

    <div class="explanation-grid">
      <div class="explanation-card">
        <h3>Files that need accessibility work</h3>
        <p>
          These are documents people read directly — <strong>PDFs</strong>
          (like meeting agendas, annual reports, statutes),
          <strong>Word documents</strong> (policies, forms),
          <strong>Excel spreadsheets</strong>, and
          <strong>PowerPoint presentations</strong>.
        </p>
        <p>
          Each of these has internal structure that affects whether someone
          using a screen reader (a tool that reads web pages aloud for
          people with vision impairments) can navigate and understand it.
          A remediation vendor adds proper headings, descriptions for
          embedded images, table header rows, and similar fixes — directly
          to each document.
        </p>
      </div>

      <div class="explanation-card">
        <h3>Files that <em>don't</em> need accessibility work</h3>
        <p>
          Most of these are <strong>images</strong> uploaded alongside blog
          posts, news announcements, and page content. Images don't get
          fixed inside the image file itself.
        </p>
        <p>
          Instead, the website's editing tool (its "content management
          system") attaches a separate description to each image —
          the description that screen readers actually read aloud.
          That happens when someone uploads the image to the site, not
          when a vendor processes the file. So those images are listed
          below for completeness, but no vendor will work on them.
        </p>
        <p>
          A handful of other files — text files, READMEs, empty placeholder
          files — also don't need remediation. They're listed for
          completeness too.
        </p>
      </div>
    </div>
  </section>
```

- [ ] **Step 4: Add the "By file type" side-by-side section**

After the explainer section, insert the by-type section. This requires a JS helper inside the function to render only rows with count > 0. Place this in the JS computation area (above the HTML template literal) alongside the other computations:

```js
  // Build by-type table rows — skip zero-count rows
  // Sum both "office-legacy" and "legacy-office" into one row under "office-legacy"
  const normByCategory = { ...fleetByCategory };
  if (normByCategory["legacy-office"]) {
    normByCategory["office-legacy"] = (normByCategory["office-legacy"] ?? 0) + normByCategory["legacy-office"];
    delete normByCategory["legacy-office"];
  }

  function byTypeRows(categories) {
    // Deduplicate: skip if we already rendered this label (handles the legacy alias)
    const seenLabels = new Set();
    return categories
      .filter(({ key, label }) => {
        if (seenLabels.has(label)) return false;
        seenLabels.add(label);
        return (normByCategory[key] ?? 0) > 0;
      })
      .map(({ key, label }) => {
        const n = normByCategory[key] ?? 0;
        return `<tr><td>${he(label)}</td><td class="num">${he(n.toLocaleString())}</td></tr>`;
      })
      .join("");
  }

  const remediableRowsHtml = byTypeRows(remediableCategories);
  const referenceRowsHtml = byTypeRows(referenceCategories);
  // Totals for tfoot — sum just the remediable categories
  const remediableTotal = remediableCategories
    .reduce((sum, { key }) => sum + (normByCategory[key] ?? 0), 0);
  const referenceTotal = referenceCategories
    .reduce((sum, { key }) => sum + (normByCategory[key] ?? 0), 0);
```

Then in the HTML template, after the explainer section and before the Sites section, insert:

```html
  <section class="by-type">
    <h2>By file type</h2>

    <div class="by-type-grid">
      <div class="by-type-column remediable">
        <h3>Files needing remediation</h3>
        <p class="caption">
          Vendor scope — these documents will be processed file by file.
        </p>
        <table>
          <tbody>${remediableRowsHtml}</tbody>
          <tfoot>
            <tr><td>Total</td><td class="num">${he(remediableTotal.toLocaleString())}</td></tr>
          </tfoot>
        </table>
      </div>

      <div class="by-type-column reference">
        <h3>Files NOT requiring remediation</h3>
        <p class="caption">
          Handled separately by site editors — or simply don't apply.
        </p>
        <table>
          <tbody>${referenceRowsHtml}</tbody>
          <tfoot>
            <tr><td>Total</td><td class="num">${he(referenceTotal.toLocaleString())}</td></tr>
          </tfoot>
        </table>
      </div>
    </div>
  </section>
```

- [ ] **Step 5: Run tests to confirm nothing is broken yet (tests expected to fail on old assertions)**

```bash
cd /Volumes/satechi/webdev/icjia-fleet-audit && npx vitest run test/web-rollup.test.js 2>&1 | tail -20
```

Expected output: Some failures are OK at this point since we haven't updated the test assertions yet. What we must NOT see: JS syntax errors or `Cannot find module` errors.

---

## Task 2: Rewrite the `renderCard` function and update the footer

**Files:**
- Modify: `src/web/index-page.js`

- [ ] **Step 1: Replace `renderCard` with the new manager-facing card**

Replace the entire existing `renderCard` function (lines 71–129) with:

```js
/**
 * Render a single site card for managers.
 *
 * @param {object} sr - siteResult entry
 * @returns {string}
 */
function renderCard(sr) {
  const { site, summary, htmlFile, csvFile, scannedAt } = sr;
  const siteName = he(site.siteName ?? site.name ?? "");
  const hostname = he(site.host ?? "");
  const ip = he(sr.header?.metadata?.serverIp ?? site.host ?? "");

  const totalFiles = summary?.totalFiles ?? 0;
  const remediable = summary?.remediable ?? 0;
  const nonRemediable = totalFiles - remediable;
  const totalBytes = summary?.totalBytes ?? 0;
  const byCategory = summary?.byCategory ?? {};

  const pdfCount = byCategory["pdf"] ?? 0;
  const officeCount =
    (byCategory["office-document"] ?? 0) +
    (byCategory["spreadsheet"] ?? 0) +
    (byCategory["presentation"] ?? 0) +
    (byCategory["office-legacy"] ?? 0) +
    (byCategory["legacy-office"] ?? 0);

  const breakdownItems = [];
  if (pdfCount > 0) breakdownItems.push(`<li>${pdfCount.toLocaleString()} PDF${pdfCount !== 1 ? "s" : ""}</li>`);
  if (officeCount > 0) breakdownItems.push(`<li>${officeCount.toLocaleString()} Office doc${officeCount !== 1 ? "s" : ""}</li>`);
  const breakdownHtml = breakdownItems.length > 0
    ? `<ul class="breakdown">${breakdownItems.join("")}</ul>`
    : "";

  const scanMeta = `Scanned ${he(fmtDate(scannedAt))} &middot; ${he(humanBytes(totalBytes))}`;

  // Only show details element if there's a hostname or IP
  const hasTechDetails = hostname || (ip && ip !== hostname);
  const techDetailsHtml = hasTechDetails
    ? `<details class="tech-details">
    <summary>Technical details</summary>
    ${hostname ? `<p class="hostname">${hostname}</p>` : ""}
    ${ip && ip !== hostname ? `<p class="ip">${ip}</p>` : ""}
  </details>`
    : "";

  return `<article class="site-card">
  <header>
    <h3>${siteName}</h3>
    <p class="scan-meta">${scanMeta}</p>
  </header>
  <div class="big-stat">
    <span class="number">${he(totalFiles.toLocaleString())}</span>
    <span class="label">total files inventoried</span>
  </div>
  <div class="remediation-summary">
    <p class="remediable-count">${he(remediable.toLocaleString())} need accessibility work</p>
    ${breakdownHtml}
    <p class="reference-count muted">${he(nonRemediable.toLocaleString())} other (mostly images)</p>
  </div>
  ${techDetailsHtml}
  <div class="actions">
    <a href="${he(htmlFile)}" class="btn btn-primary">View detailed report &rarr;</a>
    <a href="${he(csvFile)}" class="btn btn-secondary" download>Download spreadsheet</a>
  </div>
</article>`;
}
```

- [ ] **Step 2: Update the footer in the HTML template**

Find the current `<footer class="site-footer">` block (lines 521–524) and replace it with:

```html
<footer class="site-footer">
  <span>Generated by filecap. For questions, contact the audit administrator.</span>
  <span>Generated ${he(generatedAt)}</span>
</footer>
```

- [ ] **Step 3: Remove the sticky header `<span class="gen-ts">` duplicate timestamp**

The sticky header currently shows `Generated ${generatedAt}`. With the footer now showing it, keep the header but drop the timestamp from it to avoid repetition. Change the header to:

```html
<header class="site-header">
  <span class="brand"><span>filecap</span> audit fleet snapshot</span>
</header>
```

- [ ] **Step 4: Update the "Sites" section heading to be manager-friendly**

Find `<h2>Sites</h2>` and replace it with `<h2>Websites in this audit</h2>`.

- [ ] **Step 5: Run tests to verify card changes don't break existing structural assertions**

```bash
cd /Volumes/satechi/webdev/icjia-fleet-audit && npx vitest run test/web-rollup.test.js 2>&1 | grep -E "(FAIL|PASS|✓|✗)" | head -30
```

Expected: The test `"index.html references the per-site HTML and CSV files"` must still pass since `htmlFile` and `csvFile` are still rendered in the card.

---

## Task 3: Add new CSS to the inline style block

**Files:**
- Modify: `src/web/index-page.js`

The CSS lives inside the `<style>` block in the HTML template literal. All additions go before the closing `</style>` tag. The existing print block must be extended to handle the new sections.

- [ ] **Step 1: Add hero-summary CSS after the existing `.hero` block CSS**

Find the `/* ── by-type section ─────────────────────────────────────────── */` comment in the CSS and insert before it:

```css
/* ── hero summary (new layout) ───────────────────────────────── */
.hero h1 { margin-bottom: 0.25rem; }
.hero .subtitle {
  font-size: 0.9rem;
  color: #999999;
  margin: 0 0 1.5rem;
}
.hero-summary p.lead {
  font-size: 1.25em;
  line-height: 1.6;
  color: #e5e5e5;
  margin: 0 0 1.5em;
}
.hero-summary .hero-stat-row {
  display: flex;
  gap: 2em;
  align-items: baseline;
  flex-wrap: wrap;
}
.hero-summary .stat-block {
  display: flex;
  flex-direction: column;
}
.hero-summary .stat-block .stat-num {
  font-size: 3.5em;
  font-weight: 700;
  line-height: 1;
}
.hero-summary .stat-block.remediable .stat-num { color: #fbbf24; }
.hero-summary .stat-block.reference .stat-num { color: #999999; }
.hero-summary .stat-block .stat-label {
  font-size: 1em;
  color: #999999;
  margin-top: 0.5em;
}
```

- [ ] **Step 2: Replace the existing `.by-type-table` CSS block with the new split-column CSS**

Find and remove:
```css
/* ── by-type section ─────────────────────────────────────────── */
.section { margin-bottom: 2.5rem; }
.by-type-table {
  border-collapse: collapse;
  font-size: 0.9rem;
}
.by-type-table td { padding: 0.3rem 1rem 0.3rem 0; vertical-align: baseline; }
.by-type-table .type-label { color: #e5e5e5; min-width: 140px; }
.by-type-table .type-count { font-weight: 600; color: #60a5fa; text-align: right; min-width: 64px; }
.by-type-table .type-pct { color: #666666; font-size: 0.85rem; }
```

Replace with:

```css
/* ── explanation section ───────────────────────────────────────── */
.explanation {
  margin: 3em 0;
}
.explanation > h2 {
  font-size: 1.15rem;
  margin-bottom: 0.75rem;
}
.explanation > p {
  font-size: 1.05em;
  line-height: 1.7;
  color: #e5e5e5;
  max-width: 65ch;
}
.explanation-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 2em;
  margin-top: 1.5em;
}
.explanation-card {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 12px;
  padding: 1.5em;
}
.explanation-card h3 {
  margin-top: 0;
  font-size: 1.1em;
  font-weight: 600;
  color: #e5e5e5;
}
.explanation-card p {
  font-size: 0.95em;
  line-height: 1.65;
  color: #c4c4c4;
  margin: 0.75em 0;
}
.explanation-card strong {
  color: #e5e5e5;
}

/* ── by-type breakdown ─────────────────────────────────────────── */
.by-type {
  margin: 3em 0;
}
.by-type > h2 {
  font-size: 1.15rem;
  margin-bottom: 1rem;
}
.by-type-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 2em;
}
.by-type-column {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 12px;
  padding: 1.5em;
}
.by-type-column.remediable { border-top: 3px solid #fbbf24; }
.by-type-column.reference  { border-top: 3px solid #71717a; }
.by-type-column h3 {
  margin: 0 0 0.25em;
  font-size: 1.05em;
  font-weight: 600;
}
.by-type-column .caption {
  margin: 0 0 1em;
  font-size: 0.9em;
  color: #999999;
}
.by-type-column table {
  width: 100%;
  border-collapse: collapse;
}
.by-type-column td {
  padding: 0.5em 0;
  border-bottom: 1px solid #21262d;
}
.by-type-column tfoot td {
  font-weight: 600;
  border-bottom: none;
  border-top: 2px solid #30363d;
  padding-top: 0.7em;
}
.by-type-column td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: Add site card refinements CSS**

Find the existing `.site-card .scan-meta` CSS block and, after it, insert:

```css
/* ── site card manager refinements ─────────────────────────────── */
.site-card .remediation-summary {
  margin: 0;
}
.site-card .remediable-count {
  color: #fbbf24;
  font-weight: 500;
  margin: 0;
}
.site-card .breakdown {
  list-style: disc;
  padding-left: 1.25em;
  margin: 0.5em 0 0;
  color: #c4c4c4;
}
.site-card .reference-count.muted {
  color: #999999;
  font-size: 0.95em;
  margin: 0.75em 0 0;
}
.site-card details.tech-details {
  margin-top: 0.5em;
  font-size: 0.85em;
  color: #999999;
}
.site-card details.tech-details summary {
  cursor: pointer;
  user-select: none;
}
.site-card details.tech-details p {
  margin: 0.25em 0;
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.85em;
}
```

**Also remove** the now-unused `.site-card header .hostname` and `.site-card header .ip` CSS rules from the existing site-card CSS block (they were used by the old card layout):

```css
/* DELETE these two blocks: */
.site-card header .hostname {
  font-size: 0.85rem;
  color: #999999;
  margin: 0;
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
}
.site-card header .ip {
  font-size: 0.8rem;
  color: #666666;
  margin: 0;
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
}
```

- [ ] **Step 4: Update the `@media print` block**

The existing print block has rules for `.hero-stat .number`, `.hero-stat.needs-work .number`, `.by-type-table .type-label`, etc. These classes no longer exist. Replace the entire `@media print` block with:

```css
@media print {
  body { background: #fff; color: #000; }
  .site-header { position: static; background: #fff; border-bottom: 1px solid #ccc; }
  .site-header .brand, .site-header .gen-ts { color: #000; }
  .site-header .brand span { color: #0066cc; }
  h1, h2, h3 { color: #000; }
  .hero { background: #f8f8f8; border-color: #ccc; }
  .hero-summary p.lead { color: #000; }
  .hero-summary .stat-block.remediable .stat-num { color: #d97706; }
  .hero-summary .stat-block.reference .stat-num { color: #555; }
  .explanation { break-inside: avoid; }
  .explanation-card { background: #f8f8f8; border: 1px solid #ccc; border-left: none; border-radius: 0; }
  .explanation-card p { color: #000; }
  .by-type-column { background: #f8f8f8; border: 1px solid #ccc; border-top: none; border-radius: 0; }
  .by-type-column.remediable, .by-type-column.reference { border-top: 1px solid #ccc; }
  .site-card { background: #f8f8f8; border-color: #ccc; box-shadow: none; transform: none; }
  .site-card header h3 { color: #000; }
  .site-card .big-stat .number { color: #000; }
  .site-card .big-stat .label, .site-card .scan-meta { color: #555; }
  .site-card .remediable-count { color: #d97706; }
  .site-card .breakdown { color: #555; }
  .site-card .reference-count.muted { color: #555; }
  .site-footer { color: #555; border-color: #ccc; }
  .btn { display: none; }
  .site-card { page-break-inside: avoid; }
  details.tech-details { display: none; }
}
```

- [ ] **Step 5: Verify no leftover class references**

```bash
cd /Volumes/satechi/webdev/icjia-fleet-audit && grep -n "hero-stats\|by-type-table\|hero-stat\b\|type-label\|type-count\|type-pct" src/web/index-page.js
```

Expected: no output (those classes should be gone).

---

## Task 4: Update tests in `test/web-rollup.test.js`

**Files:**
- Modify: `test/web-rollup.test.js`

The test fixture in `buildFixture()` writes ONE inventory entry with `category: "pdf"`, `remediable: true`, so:
- `fleetTotalFiles = 1`, `fleetRemediable = 1`, `fleetNonRemediable = 0`
- `fleetByCategory = { pdf: 1 }`
- The by-type tables will show 1 PDF row in the remediable table; the reference table footer will show 0

### Tests to UPDATE

- [ ] **Step 1: There are no existing tests that check "Total inventoried: N files"**

After reading the test file — the existing tests do NOT contain `"Total inventoried: N files"` literally, so there is nothing to update for that specific wording. The test at line 193 (`"index.html references the per-site HTML and CSV files"`) checks for `.html` and `.csv` filenames in the index, which still applies — do not change it.

**Verification:**
```bash
cd /Volumes/satechi/webdev/icjia-fleet-audit && grep -n "Total inventoried\|total files\|hero-stats\|need remediation" test/web-rollup.test.js
```

Expected: no matches for "Total inventoried" or "hero-stats". If matches exist, update them to match the new wording.

### Tests to ADD

- [ ] **Step 2: Add test — explainer section appears**

Add a new `it` block inside the `describe("runWebRollup")` block, after the last existing test:

```js
  it("index.html contains the manager explainer section", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(html).toContain("Why aren&#39;t all");
  });
```

Note: the `he()` function escapes single quotes as `&#39;`, so `Why aren't all` becomes `Why aren&#39;t all` in the HTML output.

- [ ] **Step 3: Add test — by-type section headings appear**

```js
  it("index.html contains both by-type column headings", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(html).toContain("Files needing remediation");
    expect(html).toContain("Files NOT requiring remediation");
  });
```

- [ ] **Step 4: Add test — zero-count rows are NOT rendered**

The fixture has 1 PDF (`category: "pdf"`) and nothing else, so the XLSX, PPTX, Word, images, etc. rows should not appear:

```js
  it("index.html by-type tables skip rows where count is zero", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    // PDF row must be present (count = 1)
    expect(html).toContain("PDFs");
    // These categories have count 0 in the fixture — their rows must be absent
    expect(html).not.toContain("Word documents (.docx)");
    expect(html).not.toContain("Excel spreadsheets (.xlsx)");
    expect(html).not.toContain("PowerPoint (.pptx)");
    expect(html).not.toContain("Images (.jpg");
    expect(html).not.toContain("Text files (.txt");
  });
```

- [ ] **Step 5: Add test — Technical details `<details>` element appears in site cards**

```js
  it("index.html site cards contain Technical details disclosure element", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(html).toContain("Technical details");
    expect(html).toContain("<details");
    expect(html).toContain("<summary>");
  });
```

- [ ] **Step 6: Add test — hero section uses new wording**

```js
  it("index.html hero section uses plain-English lead paragraph wording", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(html).toContain("We scanned");
    expect(html).toContain("files in total");
    expect(html).toContain("need accessibility work");
  });
```

- [ ] **Step 7: Run tests**

```bash
cd /Volumes/satechi/webdev/icjia-fleet-audit && npx vitest run test/web-rollup.test.js 2>&1 | tail -15
```

Expected: all tests in `web-rollup.test.js` pass. Total count will be 288 + 5 new = 293 in that file. Confirm with:

```bash
cd /Volumes/satechi/webdev/icjia-fleet-audit && npx vitest run 2>&1 | grep "Tests "
```

---

## Task 5: Version bump, CHANGELOG, npm install

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version in `package.json`**

Change `"version": "1.2.2"` to `"version": "1.2.3"`.

- [ ] **Step 2: Add CHANGELOG entry**

Add the following at the top of the changelog entries (after the `## [1.2.2]` block, before the empty line separating it from `## [1.2.1]`):

Wait — the 1.2.3 entry should go BEFORE the 1.2.2 entry (most recent first). Insert after the first `---` or after the "format is based on Keep a Changelog" header block, before the existing `## [1.2.2]` line:

```markdown
## [1.2.3] — 2026-05-10

### Changed

- **Fleet snapshot index page rewritten for non-technical managers.** The page that managers see when handed the URL now leads with plain-English context ("We scanned 7 websites and found 1,247 files in total. 892 need accessibility work; 355 don't.") followed by an explainer section answering the obvious follow-up question ("Why aren't all 1,247 counted?") with side-by-side cards explaining what gets fixed (PDFs, Word docs, Excel, PowerPoint) versus what doesn't (images get descriptions in the CMS; text files, placeholders). The "By file type" breakdown is now a side-by-side table showing remediation-scope vs reference-only counts. Per-site cards drop the hostname and IP from the visible part (folded into a collapsed "Technical details" disclosure) and use friendlier button labels ("View detailed report" / "Download spreadsheet"). Designed for managers who don't know what a11y, alt text, CMS, or remediation mean — every term is defined in plain language at first use.

[1.2.3]: https://github.com/ICJIA/icjia-fleet-audit/releases/tag/v1.2.3
```

- [ ] **Step 3: Run npm install to update package-lock.json**

```bash
cd /Volumes/satechi/webdev/icjia-fleet-audit && npm install --package-lock-only 2>&1 | tail -5
```

Expected: `up to date` or similar (no new dependencies).

---

## Task 6: Full test suite + lint verification

- [ ] **Step 1: Run full test suite**

```bash
cd /Volumes/satechi/webdev/icjia-fleet-audit && npx vitest run 2>&1 | tail -10
```

Expected:
```
Test Files  27 passed (27)
     Tests  293 passed (293)
```

(288 existing + 5 new = 293)

- [ ] **Step 2: Run ESLint**

```bash
cd /Volumes/satechi/webdev/icjia-fleet-audit && npx eslint src/ test/ 2>&1
```

Expected: no errors or warnings.

- [ ] **Step 3: Verify version string**

```bash
cd /Volumes/satechi/webdev/icjia-fleet-audit && ./bin/filecap.js --version
```

Expected: `1.2.3`

---

## Task 7: Smoke test — generate bundle and inspect visually

- [ ] **Step 1: Generate bundle**

```bash
rm -rf /tmp/icjia-fleet-demo && /Volumes/satechi/webdev/icjia-fleet-audit/bin/filecap.js web-rollup --output /tmp/icjia-fleet-demo --title "ICJIA accessibility audit fleet"
```

If no saved sites exist (`~/.filecap/sites.json` is missing or empty), the command will return exit 2. That's expected in a dev environment with no real inventories. Verify the HTML was written, OR confirm the expected error if no sites are configured:

```bash
ls /tmp/icjia-fleet-demo/ 2>/dev/null || echo "No output dir (no saved sites — expected)"
```

- [ ] **Step 2: If bundle was generated, check index.html structure**

```bash
grep -n "Why aren" /tmp/icjia-fleet-demo/index.html | head -3
grep -n "We scanned" /tmp/icjia-fleet-demo/index.html | head -3
grep -n "Files needing remediation" /tmp/icjia-fleet-demo/index.html | head -3
grep -n "Technical details" /tmp/icjia-fleet-demo/index.html | head -3
```

All four should return matches.

---

## Task 8: Commit and push

- [ ] **Step 1: Stage changed files**

```bash
cd /Volumes/satechi/webdev/icjia-fleet-audit && git add src/web/index-page.js test/web-rollup.test.js package.json CHANGELOG.md package-lock.json
```

- [ ] **Step 2: Commit**

```bash
cd /Volumes/satechi/webdev/icjia-fleet-audit && git commit -m "$(cat <<'EOF'
feat(web-rollup): rewrite index page for non-technical managers with plain-English explainer + by-type breakdown

- Hero section replaced with narrative lead: "We scanned N websites and found N files" plus two-stat remediable/non-remediable blocks
- New explainer section immediately after hero answers "Why aren't all N files counted?" with plain-English side-by-side cards (what gets fixed vs what doesn't)
- New side-by-side "By file type" tables split vendor-scope files (PDFs, Word, Excel, PPTX) from reference files (images, text, other); rows with zero count are omitted
- Per-site cards: hostname/IP folded into collapsed Technical details <details> element; button labels softened ("View detailed report", "Download spreadsheet")
- Footer simplified to manager-facing tagline
- Inline CSS updated throughout; @media print updated for new class names
- 5 new tests added (explainer section, by-type headings, zero-row suppression, technical details element, hero wording)
- Version bumped to 1.2.3
EOF
)"
```

- [ ] **Step 3: Push**

```bash
cd /Volumes/satechi/webdev/icjia-fleet-audit && git push origin main
```

- [ ] **Step 4: Verify push succeeded**

```bash
cd /Volumes/satechi/webdev/icjia-fleet-audit && git log --oneline -3
```

Expected: latest commit message contains "rewrite index page for non-technical managers".

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|-----------------|------|
| Hero: "We scanned N websites / found N files" lead paragraph | Task 1 Step 2 |
| Hero: two-stat block (remediable / non-remediable) | Task 1 Step 2 |
| New explainer section: "Why aren't all N files..." | Task 1 Step 3 |
| Explainer: side-by-side cards for each group | Task 1 Step 3 |
| "By file type" side-by-side tables | Task 1 Step 4 |
| Skip zero-count rows in type tables | Task 1 Step 4 |
| Per-site cards: drop hostname/IP from visible area | Task 2 Step 1 |
| Per-site cards: `<details>` Technical details | Task 2 Step 1 |
| Button labels softened | Task 2 Step 1 |
| Footer tagline: "Generated by filecap. For questions..." | Task 2 Step 2 |
| New hero-summary CSS | Task 3 Step 1 |
| New explanation/by-type CSS | Task 3 Step 2 |
| Site card refinement CSS | Task 3 Step 3 |
| Print CSS updated | Task 3 Step 4 |
| Test: explainer section appears | Task 4 Step 2 |
| Test: by-type headings appear | Task 4 Step 3 |
| Test: zero-count rows absent | Task 4 Step 4 |
| Test: `<details>` element in cards | Task 4 Step 5 |
| Test: hero wording | Task 4 Step 6 |
| Version bump 1.2.2 → 1.2.3 | Task 5 Step 1 |
| CHANGELOG entry | Task 5 Step 2 |
| npm install --package-lock-only | Task 5 Step 3 |
| Full test suite passes | Task 6 Step 1 |
| ESLint clean | Task 6 Step 2 |
| filecap --version returns 1.2.3 | Task 6 Step 3 |
| Smoke test bundle | Task 7 |
| Commit + push | Task 8 |

### Placeholder scan

No TBDs, no "similar to Task N", no "fill in details" — all steps have complete code.

### Type/naming consistency

- `fleetNonRemediable` defined in Task 1 Step 1, used in Task 1 Step 2 ✓
- `byTypeRows()` function defined in Task 1 Step 4, used in the same step's HTML ✓
- `normByCategory` defined in Task 1 Step 4, used in the same step ✓
- `remediableTotal`, `referenceTotal` defined in Task 1 Step 4, used in HTML ✓
- `renderCard` replaced wholesale in Task 2 Step 1 — no partial edits that could conflict ✓
- CSS class names in HTML match CSS rules: `.hero-summary`, `.stat-block`, `.explanation`, `.explanation-grid`, `.explanation-card`, `.by-type`, `.by-type-grid`, `.by-type-column`, `.remediation-summary`, `.remediable-count`, `.reference-count.muted`, `.tech-details` — all defined in Task 3 ✓
- Test assertions use `"Why aren&#39;t all"` (HTML-escaped) matching the `he()` function output ✓
