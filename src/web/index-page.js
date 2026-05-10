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
 * Render a single site card.
 *
 * @param {object} sr - siteResult entry
 * @returns {string}
 */
function renderCard(sr) {
  const { site, summary, htmlFile, csvFile, scannedAt } = sr;
  const siteName = he(site.siteName ?? site.name ?? "");
  const hostname = he(site.host ?? "");
  // Try to get the IP from the inventory header metadata; fall back to host
  const ip = he(sr.header?.metadata?.serverIp ?? site.host ?? "");

  const totalFiles = summary?.totalFiles ?? 0;
  const remediable = summary?.remediable ?? 0;
  const totalBytes = summary?.totalBytes ?? 0;
  const byCategory = summary?.byCategory ?? {};

  // Build breakdown list items
  const pdfCount = byCategory["pdf"] ?? 0;
  const officeCount = (byCategory["office-document"] ?? 0) + (byCategory["spreadsheet"] ?? 0) + (byCategory["presentation"] ?? 0) + (byCategory["legacy-office"] ?? 0);
  const imageCount = byCategory["image"] ?? 0;
  const otherCount = totalFiles - pdfCount - officeCount - imageCount;

  const breakdownItems = [];
  if (remediable > 0) {
    breakdownItems.push(`<li class="remediable">&#x25CD; ${he(remediable)} need remediation</li>`);
  }
  const detailParts = [];
  if (pdfCount > 0) detailParts.push(`${pdfCount} PDF${pdfCount !== 1 ? "s" : ""}`);
  if (officeCount > 0) detailParts.push(`${officeCount} Office`);
  if (detailParts.length > 0) {
    breakdownItems.push(`<li class="detail">${he(detailParts.join(" · "))}</li>`);
  }
  if (imageCount > 0) {
    breakdownItems.push(`<li class="detail">${imageCount} image${imageCount !== 1 ? "s" : ""}</li>`);
  }
  if (otherCount > 0) {
    breakdownItems.push(`<li class="detail">${otherCount} other</li>`);
  }

  const breakdownHtml = breakdownItems.length > 0
    ? `<ul class="breakdown">${breakdownItems.join("")}</ul>`
    : `<ul class="breakdown"><li class="detail">No files found</li></ul>`;

  const scanMeta = `Scanned ${he(fmtDate(scannedAt))} &middot; ${he(humanBytes(totalBytes))}`;

  return `<article class="site-card">
  <header>
    <h3>${siteName}</h3>
    <p class="hostname">${hostname}</p>
    ${ip && ip !== hostname ? `<p class="ip">${ip}</p>` : ""}
  </header>
  <div class="big-stat">
    <span class="number">${he(totalFiles.toLocaleString())}</span>
    <span class="label">total files</span>
  </div>
  ${breakdownHtml}
  <p class="scan-meta">${scanMeta}</p>
  <div class="actions">
    <a href="${he(htmlFile)}" class="btn btn-primary">View HTML report &rarr;</a>
    <a href="${he(csvFile)}" class="btn btn-secondary" download>Download CSV</a>
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
  let fleetTotalBytes = 0;
  const fleetByCategory = {};

  for (const sr of siteResults) {
    const s = sr.summary ?? {};
    fleetTotalFiles += s.totalFiles ?? 0;
    fleetRemediable += s.remediable ?? 0;
    fleetTotalBytes += s.totalBytes ?? 0;
    if (s.byCategory) {
      for (const [cat, n] of Object.entries(s.byCategory)) {
        fleetByCategory[cat] = (fleetByCategory[cat] ?? 0) + n;
      }
    }
  }

  // By-type section
  const CAT_LABELS = {
    "pdf": "PDFs",
    "office-document": "Word docs",
    "spreadsheet": "Excel",
    "presentation": "Presentations",
    "image": "Images",
    "archive": "Archives",
    "text": "Text files",
    "web": "Web files",
    "audio-video": "Audio / Video",
    "other": "Other",
    "legacy-office": "Legacy Office",
  };

  const byTypeRows = Object.entries(fleetByCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => {
      const pct = fleetTotalFiles > 0 ? Math.round((n / fleetTotalFiles) * 100) : 0;
      const label = CAT_LABELS[cat] ?? cat;
      return `<tr><td class="type-label">${he(label)}</td><td class="type-count">${n.toLocaleString()}</td><td class="type-pct">${pct > 0 ? `(${pct}%)` : ""}</td></tr>`;
    })
    .join("");

  // Latest scan across all sites
  const latestScan = siteResults
    .map((sr) => sr.scannedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  const latestScanStr = latestScan ? fmtDate(latestScan) : "unknown";
  const generatedAt = fmtGeneratedAt(new Date());
  const siteCount = siteResults.length;

  const h1Text = `Fleet snapshot — ${siteCount} site${siteCount !== 1 ? "s" : ""}`;
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
.site-header .gen-ts {
  font-size: 12px;
  color: #666666;
  white-space: nowrap;
}

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
.hero h1 { margin-bottom: 1.5rem; }
.hero-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
  margin-bottom: 1.5rem;
}
.hero-stat .number {
  font-size: 3.5em;
  font-weight: 700;
  line-height: 1;
  display: block;
  color: #e5e5e5;
}
.hero-stat.needs-work .number { color: #fbbf24; }
.hero-stat .label {
  font-size: 0.9rem;
  color: #999999;
  margin-top: 0.25rem;
  display: block;
}
.hero-meta {
  font-size: 0.85rem;
  color: #666666;
}
@media (max-width: 480px) {
  .hero-stats { grid-template-columns: 1fr; gap: 1rem; }
  .hero-stat .number { font-size: 2.5em; }
}

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
.site-card .breakdown {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.site-card .breakdown li.remediable {
  color: #fbbf24;
  font-weight: 500;
}
.site-card .breakdown li.detail {
  color: #999999;
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
  .site-header .brand, .site-header .gen-ts { color: #000; }
  .site-header .brand span { color: #0066cc; }
  h1, h2 { color: #000; }
  .hero { background: #f8f8f8; border-color: #ccc; }
  .hero-stat .number { color: #000; }
  .hero-stat.needs-work .number { color: #d97706; }
  .hero-meta, .hero-stat .label { color: #555; }
  .site-card { background: #f8f8f8; border-color: #ccc; box-shadow: none; transform: none; }
  .site-card header h3 { color: #000; }
  .site-card header .hostname, .site-card header .ip { color: #555; }
  .site-card .big-stat .number { color: #000; }
  .site-card .big-stat .label, .site-card .scan-meta { color: #555; }
  .site-card .breakdown li.remediable { color: #d97706; }
  .site-card .breakdown li.detail { color: #555; }
  .by-type-table .type-label { color: #000; }
  .by-type-table .type-count { color: #0066cc; }
  .by-type-table .type-pct { color: #555; }
  .site-footer { color: #555; border-color: #ccc; }
  .btn { display: none; }
  .site-card { page-break-inside: avoid; }
}
</style>
</head>
<body>

<header class="site-header">
  <span class="brand"><span>filecap</span> audit fleet snapshot</span>
  <span class="gen-ts">Generated ${he(generatedAt)}</span>
</header>

<main>

  <section class="hero">
    <h1>${he(h1Text)}</h1>
    <div class="hero-stats">
      <div class="hero-stat">
        <span class="number">${fleetTotalFiles.toLocaleString()}</span>
        <span class="label">total files</span>
      </div>
      <div class="hero-stat needs-work">
        <span class="number">${fleetRemediable.toLocaleString()}</span>
        <span class="label">need remediation</span>
      </div>
    </div>
    <p class="hero-meta">Across ${siteCount} server${siteCount !== 1 ? "s" : ""} &middot; ${he(humanBytes(fleetTotalBytes))} &middot; last scan ${he(latestScanStr)}</p>
  </section>

  <section class="section">
    <h2>By type across the fleet</h2>
    <table class="by-type-table">
      <tbody>${byTypeRows}</tbody>
    </table>
  </section>

  <section class="section">
    <h2>Sites</h2>
    <div class="site-grid">
${cardsHtml}
    </div>
  </section>

</main>

<footer class="site-footer">
  <span>Generated by <a href="https://github.com/ICJIA/filecap-cli" target="_blank" rel="noopener noreferrer">@icjia/filecap</a></span>
  <span>Manager-facing data only &middot; For internal use</span>
</footer>

</body>
</html>`;

  if (password) {
    return injectPasswordGate(html, password);
  }
  return html;
}
