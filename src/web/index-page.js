import { injectPasswordGate } from "./password-gate.js";

/**
 * Escape a value for safe insertion into HTML.
 * @param {*} s
 * @returns {string}
 */
function he(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Format bytes as human-readable string (e.g. 38.1 MB).
 * @param {number} bytes
 * @returns {string}
 */
function humanBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${i === 0 ? val : val.toFixed(1)} ${units[i]}`;
}

/**
 * Format an ISO timestamp as "May 9, 16:05 UTC".
 * @param {string|null} iso
 * @returns {string}
 */
function fmtDate(iso) {
  if (!iso) return "unknown";
  try {
    const d = new Date(iso);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mon = months[d.getUTCMonth()];
    const day = d.getUTCDate();
    const HH = String(d.getUTCHours()).padStart(2, "0");
    const MM = String(d.getUTCMinutes()).padStart(2, "0");
    return `${mon} ${day}, ${HH}:${MM} UTC`;
  } catch {
    return iso;
  }
}

/**
 * Format a Date as "YYYY-MM-DD HH:MM UTC" for the generated-at stamp.
 * @param {Date} d
 * @returns {string}
 */
function fmtGeneratedAt(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const HH = String(d.getUTCHours()).padStart(2, "0");
  const MM = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${HH}:${MM} UTC`;
}

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

/**
 * Generate the fleet index page HTML.
 *
 * @param {object} args
 * @param {Array}  args.siteResults  - array of siteResult objects from web-rollup
 * @param {string|null} args.password - hex hash to inject (or null for no gate)
 * @param {string} args.title        - page title / H1 text
 * @returns {string} full HTML document
 */
export function generateIndexHtml({ siteResults, password = null, title = "filecap audit fleet snapshot" }) {
  // Fleet totals
  let fleetTotalFiles = 0;
  let fleetRemediable = 0;
  const fleetByCategory = {};

  for (const sr of siteResults) {
    const s = sr.summary ?? {};
    fleetTotalFiles += s.totalFiles ?? 0;
    fleetRemediable += s.remediable ?? 0;
    if (s.byCategory) {
      for (const [cat, n] of Object.entries(s.byCategory)) {
        fleetByCategory[cat] = (fleetByCategory[cat] ?? 0) + n;
      }
    }
  }

  const fleetNonRemediable = fleetTotalFiles - fleetRemediable;

  // Manager-friendly categories for the by-type breakdown tables
  const remediableCategories = [
    { key: "pdf",             label: "PDFs" },
    { key: "office-document", label: "Word documents (.docx)" },
    { key: "spreadsheet",     label: "Excel spreadsheets (.xlsx)" },
    { key: "presentation",    label: "PowerPoint (.pptx)" },
    { key: "office-legacy",   label: "Legacy Office (.doc, .xls, .ppt)" },
    { key: "legacy-office",   label: "Legacy Office (.doc, .xls, .ppt)" },
  ];

  const referenceCategories = [
    { key: "image",       label: "Images (.jpg, .png, .gif, .webp, .svg)" },
    { key: "text",        label: "Text files (.txt, .md)" },
    { key: "archive",     label: "Archives (.zip, .tar, etc.)" },
    { key: "audio-video", label: "Audio / video" },
    { key: "web",         label: "Web pages (.html, .css, .js)" },
    { key: "other",       label: "Other (placeholders, unrecognized)" },
  ];

  // Build by-type table rows — skip zero-count rows
  // Normalise: sum both "office-legacy" and "legacy-office" into one row
  const normByCategory = { ...fleetByCategory };
  if (normByCategory["legacy-office"]) {
    normByCategory["office-legacy"] = (normByCategory["office-legacy"] ?? 0) + normByCategory["legacy-office"];
    delete normByCategory["legacy-office"];
  }

  function buildTypeRows(categories) {
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

  const remediableRowsHtml = buildTypeRows(remediableCategories);
  const referenceRowsHtml = buildTypeRows(referenceCategories);

  // Totals for tfoot
  const remediableTotal = remediableCategories
    .reduce((sum, { key }) => sum + (normByCategory[key] ?? 0), 0);
  const referenceTotal = referenceCategories
    .reduce((sum, { key }) => sum + (normByCategory[key] ?? 0), 0);

  const generatedAt = fmtGeneratedAt(new Date());
  const siteCount = siteResults.length;

  const pageTitle = he(title);

  const cardsHtml = siteResults.map(renderCard).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${pageTitle}</title>
<style>
/* ── base ────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.6;
  color: #e5e5e5;
  background: #0d1117;
  margin: 0;
  padding: 0;
}
a { color: #60a5fa; text-decoration: none; }
a:hover { color: #93c5fd; text-decoration: underline; }
h1 {
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #e5e5e5;
  margin: 0 0 0.5rem;
}
h2 {
  font-size: 1.1rem;
  font-weight: 600;
  color: #e5e5e5;
  margin: 0 0 1rem;
}

/* ── sticky header ───────────────────────────────────────────── */
.site-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: #161b22;
  border-bottom: 1px solid #21262d;
  padding: 0.75rem 2rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.site-header .brand {
  font-weight: 700;
  font-size: 1rem;
  color: #e5e5e5;
  letter-spacing: -0.01em;
}
.site-header .brand span { color: #60a5fa; }

/* ── main content ────────────────────────────────────────────── */
main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

/* ── hero / fleet totals ─────────────────────────────────────── */
.hero {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 12px;
  padding: 2rem;
  margin-bottom: 2.5rem;
}
.hero h1 { margin-bottom: 0.25rem; }
.hero .subtitle {
  font-size: 0.9rem;
  color: #999999;
  margin: 0 0 1.5rem;
}
@media (max-width: 480px) {
  .hero-summary .stat-block .stat-num { font-size: 2.5em; }
}

/* ── hero summary (new layout) ───────────────────────────────── */
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

/* ── site grid ───────────────────────────────────────────────── */
.site-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 1.5em;
}
@media (max-width: 480px) {
  .site-grid { grid-template-columns: 1fr; }
}

/* ── site card ───────────────────────────────────────────────── */
.site-card {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 12px;
  padding: 1.5em;
  display: flex;
  flex-direction: column;
  gap: 1em;
  transition: border-color 150ms ease-out, transform 150ms ease-out;
}
.site-card:hover {
  border-color: #30363d;
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
.site-card header { margin: 0; }
.site-card header h3 {
  font-size: 1.1rem;
  font-weight: 600;
  color: #e5e5e5;
  margin: 0 0 0.25rem;
}
.site-card .big-stat {
  display: flex;
  flex-direction: column;
}
.site-card .big-stat .number {
  font-size: 3em;
  font-weight: 700;
  color: #e5e5e5;
  line-height: 1;
}
.site-card .big-stat .label {
  font-size: 0.85rem;
  color: #999999;
  margin-top: 0.2rem;
}
.site-card .scan-meta {
  font-size: 0.8rem;
  color: #666666;
  margin: 0;
}
.site-card .actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: auto;
}

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

/* ── buttons ─────────────────────────────────────────────────── */
.btn {
  display: inline-block;
  padding: 0.5em 1em;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 150ms ease-out, color 150ms ease-out;
  text-decoration: none;
  white-space: nowrap;
}
.btn-primary {
  background: #60a5fa;
  color: #0d1117;
}
.btn-primary:hover {
  background: #93c5fd;
  color: #0d1117;
  text-decoration: none;
}
.btn-secondary {
  background: transparent;
  color: #60a5fa;
  border: 1px solid #30363d;
}
.btn-secondary:hover {
  border-color: #60a5fa;
  color: #93c5fd;
  text-decoration: none;
}

/* ── footer ─────────────────────────────────────────────────── */
.site-footer {
  border-top: 1px solid #21262d;
  padding: 1.5rem 2rem;
  max-width: 1200px;
  margin: 0 auto;
  font-size: 0.8rem;
  color: #666666;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.site-footer a { color: #60a5fa; }
.site-footer a:hover { color: #93c5fd; }

/* ── print ───────────────────────────────────────────────────── */
@media print {
  body { background: #fff; color: #000; }
  .site-header { position: static; background: #fff; border-bottom: 1px solid #ccc; }
  .site-header .brand { color: #000; }
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
</style>
</head>
<body>

<header class="site-header">
  <span class="brand"><span>filecap</span> audit fleet snapshot</span>
</header>

<main>

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
          <span class="stat-label">don&#39;t</span>
        </span>
      </p>
    </div>
  </section>

  <section class="explanation">
    <h2>Why aren&#39;t all ${he(fleetTotalFiles.toLocaleString())} files counted as needing work?</h2>

    <p>
      Good question — the number of files we found and the number that
      need accessibility work are different on purpose. Here&#39;s the gist:
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
        <h3>Files that <em>don&#39;t</em> need accessibility work</h3>
        <p>
          Most of these are <strong>images</strong> uploaded alongside blog
          posts, news announcements, and page content. Images don&#39;t get
          fixed inside the image file itself.
        </p>
        <p>
          Instead, the website&#39;s editing tool (its &#34;content management
          system&#34;) attaches a separate description to each image —
          the description that screen readers actually read aloud.
          That happens when someone uploads the image to the site, not
          when a vendor processes the file. So those images are listed
          below for completeness, but no vendor will work on them.
        </p>
        <p>
          A handful of other files — text files, READMEs, empty placeholder
          files — also don&#39;t need remediation. They&#39;re listed for
          completeness too.
        </p>
      </div>
    </div>
  </section>

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
          Handled separately by site editors — or simply don&#39;t apply.
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

  <section class="section">
    <h2>Websites in this audit</h2>
    <div class="site-grid">
${cardsHtml}
    </div>
  </section>

</main>

<footer class="site-footer">
  <span>Generated by filecap. For questions, contact the audit administrator.</span>
  <span>Generated ${he(generatedAt)}</span>
</footer>

</body>
</html>`;

  if (password) {
    return injectPasswordGate(html, password);
  }
  return html;
}
