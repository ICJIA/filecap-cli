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
function renderMasterCsvSection(masterCsv) {
  if (!masterCsv || !masterCsv.filename) return "";
  const fileCount = masterCsv.fileCount ?? 0;
  const byteCount = masterCsv.byteCount ?? 0;
  return `
  <section class="section master-csv">
    <h2>Master spreadsheet — every file across every server</h2>
    <p>If you'd rather skim a single spreadsheet instead of per-site files, this combined CSV has every file from every server above in one row-per-file table. Same columns as the per-site spreadsheets, plus a "Server" column at the front so you can tell which website each row came from.</p>
    <p class="master-csv-download">
      <a class="cta-button" href="${he(masterCsv.filename)}" download>
        Download <strong>${he(masterCsv.filename)}</strong>
      </a>
      <span class="master-csv-meta">${he(fileCount.toLocaleString())} files · ${he(humanBytes(byteCount))}</span>
    </p>
  </section>`;
}

function renderDuplicatesSection(groups, duplicatesCsv) {
  if (!groups || groups.length === 0) return "";

  const exactCount = groups.filter((g) => g.isExactDuplicate).length;
  const variantCount = groups.length - exactCount;

  // One row per group — easier to scan than the per-item-row version. The
  // per-occurrence detail lives in audit-file-duplicates.csv for pivot work.
  const groupRows = groups.map((g) => {
    const items = g.items ?? [];
    const dates = items.map((i) => i.modifiedAt).filter(Boolean).sort();
    const newest = dates[dates.length - 1] ?? "";
    const oldest = dates[0] ?? "";
    const totalBytes = items.reduce((s, i) => s + (i.sizeBytes ?? 0), 0);
    // Each site is rendered as a link to its file's public URL (the canonical
    // way for a manager / remediator to actually go look at the document).
    // Falls back to plain text when the site has no publicUrlBase configured.
    const sites = items.map((i) => {
      const label = he(i.siteName || i.serverName || "");
      if (i.publicUrl) {
        return `<a href="${he(i.publicUrl)}" target="_blank" rel="noopener noreferrer" title="${he(i.publicUrl)}">${label}</a>`;
      }
      return label;
    }).join(", ");
    const matchBadge = g.isExactDuplicate
      ? `<span class="dup-kind dup-exact">exact</span>`
      : `<span class="dup-kind dup-variant">variant</span>`;
    const datesText = (newest && oldest && newest !== oldest)
      ? `${he(fmtDate(newest))} <span class="dup-dim">↓</span> ${he(fmtDate(oldest))}`
      : he(newest ? fmtDate(newest) : "—");
    const sitesText = items.map((i) => i.siteName || i.serverName || "").join(", ");
    return `<tr>
      <td title="${he(g.normalizedFilename)}">${he(g.normalizedFilename)}</td>
      <td>${matchBadge}</td>
      <td title="${he(sitesText)}">${sites}</td>
      <td class="num">${he(String(items.length))}</td>
      <td title="${he(datesPlain(items))}">${datesText}</td>
      <td class="num">${he(humanBytes(totalBytes))}</td>
    </tr>`;
  });

  // Plain-text dates for the title tooltip (no markup, friendly for SR users).
  function datesPlain(items) {
    const dates = items.map((i) => i.modifiedAt).filter(Boolean).sort();
    if (dates.length === 0) return "—";
    if (dates.length === 1) return fmtDate(dates[0]);
    return `Newest ${fmtDate(dates[dates.length - 1])}, oldest ${fmtDate(dates[0])}`;
  }

  const csvDownloadHtml = duplicatesCsv && duplicatesCsv.filename
    ? `<p class="dup-csv-download">
        <a class="cta-button" href="${he(duplicatesCsv.filename)}" download>
          Download <strong>${he(duplicatesCsv.filename)}</strong>
        </a>
        <span class="master-csv-meta">${he((duplicatesCsv.groupCount ?? 0).toLocaleString())} filenames · ${he((duplicatesCsv.occurrenceCount ?? 0).toLocaleString())} occurrences · ${he(humanBytes(duplicatesCsv.byteCount ?? 0))}</span>
      </p>
      <p class="dup-csv-blurb">The CSV has one row per occurrence — useful in Excel for sorting by site, by date, or by match type. The on-page table below shows one row per filename group.</p>`
    : "";

  return `
  <section class="section duplicates">
    <header class="dup-hero">
      <p class="dup-eyebrow">Cross-server file map</p>
      <h2 class="dup-title">${he(groups.length.toLocaleString())} files appear on more than one site</h2>
      <p class="dup-subtitle"><strong>This is normal — not a webmaster error.</strong> The same PDF might be linked from DVFR, ICJIA, and the Archive simultaneously, and a copy lives on each site. We're listing them here so you can <strong>remediate the file once and push the fix to every site that hosts it</strong>, instead of paying a vendor to remediate the same document three times.</p>
      <div class="dup-stat-tiles">
        <div class="dup-tile dup-tile-exact">
          <span class="dup-tile-num">${he(exactCount.toLocaleString())}</span>
          <span class="dup-tile-lbl">exact ${exactCount === 1 ? "copy" : "copies"}</span>
          <span class="dup-tile-sub">same filename, same content on every site</span>
        </div>
        <div class="dup-tile dup-tile-variant">
          <span class="dup-tile-num">${he(variantCount.toLocaleString())}</span>
          <span class="dup-tile-lbl">${variantCount === 1 ? "variant" : "variants"}</span>
          <span class="dup-tile-sub">same filename, content differs between sites</span>
        </div>
      </div>
    </header>

    ${csvDownloadHtml}

    <section class="dup-explainer-open">
      <h3 class="dup-explainer-open-h3">Why are we showing you this?</h3>
      <p>ICJIA's web presence has evolved over many years. The Archive site was historically the agency's <em>library</em> — a single repository where reports, meeting minutes, and reference documents lived. Over time, individual programs (DVFR, R3, ICJIA, ILFVCC, i2i, Infonet, Intranet) developed their own websites, and copies of relevant Archive files were placed into each program's CMS so they'd appear in context. Files were sometimes updated on one server without being updated on the others — that's why a "duplicate" pair may have <strong>different content even though the filename matches</strong>. <code>.gitkeep</code> and <code>.gitignore</code> are filtered out (placeholder files that always exist as duplicates by design).</p>

      <p class="dup-not-error"><strong>A duplicate is not an error.</strong> It is not the webmaster's fault. It just means the same filename appears in more than one place — typically because the same document was meant to be visible on multiple sites. Use this list as a <strong>cross-check</strong>, not a deletion queue.</p>

      <div class="dup-kind-cards">
        <div class="dup-kind-card dup-kind-card-exact">
          <h4 class="dup-kind-card-h4"><span class="dup-kind dup-exact">exact</span> — same content on every site</h4>
          <p>Byte-for-byte identical file in N places. <strong>Remediate it once</strong> on the canonical copy (typically the newest or most-frequently-linked one), then push the corrected file to the other sites' CMSes using the same filename. <strong>Don't delete the duplicates</strong> — most are referenced by CMS entries on each site; removing them would break the link. The goal is "one corrected file appearing in N places," not "one file existing in one place."</p>
        </div>
        <div class="dup-kind-card dup-kind-card-variant">
          <h4 class="dup-kind-card-h4"><span class="dup-kind dup-variant">variant</span> — same filename, different content</h4>
          <p>The file was edited on one server and the others still hold the older version. <strong>Each variant likely needs its own remediation pass</strong>. Open each in the table below to check whether they're truly distinct documents or whether one is the canonical version the others should be replaced with. Once you decide, either remediate all variants individually, or remediate the canonical one and overwrite the others (treating it like an <em>exact</em> case going forward).</p>
        </div>
      </div>

      <p class="dup-caveat"><strong>Heads up on false positives.</strong> Cross-server matching strips Strapi's appended 10-character hex hash before comparing filenames (so <code>report_a1b2c3d4e5.pdf</code> matches <code>report_xxxxxxxxxx.pdf</code>). Two unrelated files that happen to follow the same naming convention before the hash can be flagged as a <em>variant</em> here even though they're logically different documents. The <em>exact</em> match (same content hash) is the high-confidence signal; <em>variant</em> matches are worth opening to confirm.</p>
    </section>

    <details class="dup-table-details" open>
      <summary>Summary table — ${he(groups.length.toLocaleString())} filename groups (one row each)</summary>
      <div class="dup-pan-wrap" data-dup-pan>
        <table class="dup-table">
          <thead>
            <tr>
              <th scope="col" class="dup-col-filename">Filename (normalised)</th>
              <th scope="col" class="dup-col-match">Match</th>
              <th scope="col" class="dup-col-sites">Sites</th>
              <th scope="col" class="dup-col-copies">Copies</th>
              <th scope="col" class="dup-col-dates">Newest → oldest</th>
              <th scope="col" class="dup-col-size">Total size</th>
            </tr>
          </thead>
          <tbody>
            ${groupRows.join("\n")}
          </tbody>
        </table>
      </div>
    </details>
  </section>`;
}

// Access-method chip copy. Keep these strings in lock-step with the detail-page
// access panel in src/report/html.js so managers see consistent language.
const ACCESS_CHIP_LABEL = {
  strapi: "Strapi CMS / SSH required",
  github: "GitHub repo / access required",
  server: "Server / SSH required",
};

export function renderCard(sr) {
  const { site, summary, htmlFile, csvFile, scannedAt } = sr;
  const nickname = he(site.siteName ?? site.name ?? "");
  // `||` (not `??`) so an empty-string siteFullName falls through to siteName.
  // Same rationale as commit 01c1d4e on the detail-page H1.
  const fullName = he(site.siteFullName || site.siteName || site.name || "");
  const hostname = he(site.host ?? "");
  const ip = he(sr.header?.metadata?.serverIp ?? site.host ?? "");
  const accessKind = site.accessKind && ACCESS_CHIP_LABEL[site.accessKind] ? site.accessKind : null;
  const accessLabel = accessKind ? ACCESS_CHIP_LABEL[accessKind] : "";

  const siteUrlRaw = site.siteUrl ?? site.publicUrlBase ?? sr.header?.metadata?.publicUrlBase ?? "";
  const publicUrlBaseRaw = siteUrlRaw;
  const publicUrlBase = he(siteUrlRaw);

  const totalFiles = summary?.totalFiles ?? 0;
  const remediable = summary?.remediable ?? 0;
  const totalBytes = summary?.totalBytes ?? 0;
  const byCategory = summary?.byCategory ?? {};

  const pdfCount = byCategory["pdf"] ?? 0;
  const officeCount =
    (byCategory["office-document"] ?? 0) +
    (byCategory["spreadsheet"] ?? 0) +
    (byCategory["presentation"] ?? 0) +
    (byCategory["office-legacy"] ?? 0) +
    (byCategory["legacy-office"] ?? 0);
  const imageCount = byCategory["image"] ?? 0;

  // Audit-share percentage — rounded to 1 decimal so the conic-gradient is
  // smooth but the percent badge in the donut stays short.
  const pctRaw = totalFiles > 0 ? (remediable / totalFiles) * 100 : 0;
  const pct = Math.round(pctRaw * 10) / 10;
  const pctInt = Math.round(pctRaw);

  // Plain-English caption rounded to colloquial buckets so a manager
  // doesn't have to read a percentage to grasp the share.
  let phrase;
  if (totalFiles === 0)             phrase = "No files inventoried";
  else if (pctInt === 0)            phrase = "No files need audit";
  else if (pctInt <= 12)            phrase = "A small share need audit";
  else if (pctInt <= 28)            phrase = "About a quarter need audit";
  else if (pctInt <= 42)            phrase = "About a third need audit";
  else if (pctInt <= 58)            phrase = "About half need audit";
  else if (pctInt <= 72)            phrase = "Two-thirds need audit";
  else if (pctInt <= 88)            phrase = "Most need audit";
  else                              phrase = "Nearly all need audit";

  const chipsHtml = [
    pdfCount   > 0 ? `<span class="chip chip-pdf"><svg class="ico"><use href="#i-file"/></svg>${pdfCount.toLocaleString()} PDF${pdfCount !== 1 ? "s" : ""}</span>` : "",
    officeCount > 0 ? `<span class="chip chip-doc"><svg class="ico"><use href="#i-file"/></svg>${officeCount.toLocaleString()} Office</span>` : "",
    imageCount > 0 ? `<span class="chip chip-img"><svg class="ico"><use href="#i-img"/></svg>${imageCount.toLocaleString()} image${imageCount !== 1 ? "s" : ""}</span>` : "",
  ].filter(Boolean).join("");

  const scanMeta = `${he(humanBytes(totalBytes))} &middot; scanned ${he(fmtDate(scannedAt))}`;

  const hasTechDetails = hostname || (ip && ip !== hostname);
  const techDetailsHtml = hasTechDetails
    ? `<details class="tech-details">
    <summary>Technical details</summary>
    ${hostname ? `<p class="hostname">${hostname}</p>` : ""}
    ${ip && ip !== hostname ? `<p class="ip">${ip}</p>` : ""}
  </details>`
    : "";

  return `<article class="site-card">
  <a class="card-stretched-link" href="${he(htmlFile)}" aria-label="View detailed report for ${fullName}"></a>
  <header class="card-head">
    ${accessKind ? `<p class="access-chip access-${accessKind}" title="${he(accessLabel)} — see detail page for access steps"><span class="access-dot" aria-hidden="true"></span>${he(accessLabel)}</p>` : ""}
    <p class="nickname">${nickname}</p>
    <h3 class="full-name">${fullName}</h3>
    ${publicUrlBaseRaw ? `<p class="site-url"><a href="${publicUrlBase}" target="_blank" rel="noopener noreferrer">${publicUrlBase}</a></p>` : ""}
  </header>
  <div class="nums">
    <div class="tile total"><span class="num">${he(totalFiles.toLocaleString())}</span><span class="lbl">total files</span></div>
    <div class="tile audit"><span class="num">${he(remediable.toLocaleString())}</span><span class="lbl">need audit</span></div>
  </div>
  <div class="donut-row">
    <div class="donut" style="--pct:${pct}%"><div class="pct">${pctInt}%<small>need audit</small></div></div>
    <div class="donut-caption"><strong>${he(phrase)}</strong><span>${he(remediable.toLocaleString())} of ${he(totalFiles.toLocaleString())} files</span></div>
  </div>
  ${chipsHtml ? `<div class="chips">${chipsHtml}</div>` : ""}
  <p class="scan-meta">${scanMeta}</p>
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
export function generateIndexHtml({
  siteResults,
  password = null,
  title = "filecap fleet audit snapshot",
  duplicateGroups = [],
  masterCsv = null, // { filename: string, fileCount: number, byteCount: number } | null
  duplicatesCsv = null, // { filename: string, groupCount: number, occurrenceCount: number, byteCount: number } | null
}) {
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
/* ── infographic-style hero split ────────────────────────────── */
.fleet-total-headline-block {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin: 1.5em 0 0.7em 0;
}
.fleet-total-headline {
  font-size: clamp(3.5em, 9vw, 6em);
  font-weight: 700;
  color: #58a6ff;
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.fleet-total-headline-label {
  font-size: 1em;
  color: #8b949e;
  margin-top: 0.4em;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* Proportional split bar — flex:N 0 0 weights each segment by its count.
   On a fleet of 14,914 with 11,097 remediable, the yellow segment is
   ~74% of the bar; the grey segment is ~26%. */
.fleet-split-bar {
  display: flex;
  height: clamp(4rem, 9vh, 5.5rem);
  border-radius: 6px;
  overflow: hidden;
  margin: 0.5em 0 1em 0;
  background: #1c2128;
  border: 1px solid #21262d;
  box-shadow: 0 1px 2px rgba(0,0,0,0.4);
}
.fleet-split-segment {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0.3em 0.6em;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
  min-width: 0;
  overflow: hidden;
  transition: filter 120ms ease;
}
.fleet-split-segment:hover { filter: brightness(1.06); }
.fleet-split-num {
  font-size: 1.5em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.fleet-split-label {
  font-size: 0.8em;
  font-weight: 500;
  opacity: 0.85;
  margin-top: 0.25em;
  /* Hide the label when the segment is too narrow to fit it gracefully —
     the number + percentage still convey the story. */
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.fleet-split-pct {
  font-size: 0.78em;
  font-weight: 500;
  opacity: 0.7;
  margin-top: 0.15em;
}
.fleet-split-remediable {
  background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
  color: #1c2128;
}
.fleet-split-reference {
  background: linear-gradient(135deg, #6e7681 0%, #484f58 100%);
  color: #ffffff;
}

/* The equation underneath spells out the arithmetic in case the bar is
   too abstract — "14,914 = 11,097 need audit + 3,817 don't". */
.fleet-equation {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: center;
  gap: 0.3em 0.6em;
  margin: 0 0 1.2em 0;
  padding: 0.6em 0.8em;
  background: #0d1117;
  border: 1px solid #21262d;
  border-radius: 4px;
  font-size: 1.02rem;
  text-align: center;
}
.fleet-eq-num {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #c9d1d9;
}
.fleet-eq-cap {
  color: #8b949e;
  font-size: 0.92em;
}
.fleet-eq-op {
  color: #6e7681;
  font-weight: 700;
  font-size: 1.15em;
  padding: 0 0.2em;
}

@media (max-width: 640px) {
  .fleet-split-bar { flex-direction: column; height: auto; }
  .fleet-split-segment { padding: 0.8em 0.6em; }
  .fleet-split-label { font-size: 0.9em; }
  .fleet-equation { font-size: 0.95rem; padding: 0.5em 0.4em; }
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

/* ─── Site-card anatomy v1.7.0 + v1.7.1 clickable card ─── */
.site-card {
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #18202b 0%, #141a23 100%);
  border: 1px solid var(--fc-border-subtle, #2a323d);
  border-radius: 22px;
  padding: 28px 26px 24px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.32);
  min-height: 540px;
  color: var(--fc-text-primary, #e5e5e5);
  /* v1.7.1 — whole card is clickable (stretched-link pattern) with
     a hover lift so the affordance is obvious. The actual <a> overlay
     sits absolutely positioned at z-index 0; siblings get z-index 1. */
  position: relative;
  cursor: pointer;
  transition: transform 200ms ease, box-shadow 200ms ease, border-color 200ms ease;
}
.site-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
  border-color: #4dabf7;
}
.site-card:focus-within {
  outline: 3px solid #4dabf7;
  outline-offset: 4px;
}
.site-card .card-stretched-link {
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: inherit;
  /* hide the empty-text content from screen readers' visual rendering;
     aria-label provides the accessible name */
  text-indent: -9999px;
  overflow: hidden;
}
.site-card .card-stretched-link:focus { outline: none; }
.site-card > *:not(.card-stretched-link) {
  position: relative;
  z-index: 1;
}
/* v1.7.7: make the whole card clickable. Pre-v1.7.7 the stretched-link
   pattern only worked on the small padding gaps between children — every
   visible text/tile/donut sat above the link (z-index 1 vs 0) and
   captured the click but had no click handler. Bumping the link's
   z-index introduces its own landmines: it would cover the action
   buttons (which would then need higher z-index escape hatches), and
   the donut's internal .pct (position relative, z-index 1) would still
   end up on top of the link. Cleaner solution: make every
   non-interactive descendant pointer-events:none so the click falls
   through to the link, then explicitly re-enable pointer-events on the
   real interactive elements (action buttons + tech-details disclosure
   summary). The site-url anchor in the card-head intentionally stays
   click-through so the whole card maps to one action — go to the detail
   page. */
.site-card > *:not(.card-stretched-link),
.site-card > *:not(.card-stretched-link) * {
  pointer-events: none;
}
.site-card .actions .btn,
.site-card .tech-details summary {
  pointer-events: auto;
}
@media (prefers-reduced-motion: reduce) {
  .site-card { transition: none; }
  .site-card:hover { transform: none; }
}
.site-card .card-head { text-align: center; margin-bottom: 18px; }
.site-card .nickname {
  font-size: 0.82em;
  font-weight: 800;
  color: var(--fc-nickname, #c0cdda);  /* ≥ 7:1 on card bg — WCAG AAA at small sizes */
  letter-spacing: 0.10em;
  text-transform: uppercase;
  margin: 0 0 6px;
}
.site-card .full-name {
  font-size: 1.55em;
  font-weight: 800;
  line-height: 1.18;
  color: #ffffff;
  letter-spacing: -0.01em;
  margin: 0 auto;
  max-width: 28ch;
  min-height: 2.4em;             /* reserve 2 lines so single-line names still align */
  display: flex;
  align-items: center;
  justify-content: center;
}
.site-card .site-url {
  margin: 6px 0 0;
  font-size: 0.85em;
  color: var(--fc-text-muted, #788391);
}
.site-card .site-url a { color: var(--fc-accent, #4dabf7); text-decoration: none; }

/* v1.7.6 — access-method chip in the card-head eyebrow position. Three
   variants (Strapi/GitHub/Server) with distinct hue so a manager can scan
   the index and immediately tell what credentials each site needs. The
   detail page repeats this in a larger "How to access" panel with the
   "Contact IDS at ICJIA" line + SSH-key copy. */
.site-card .access-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0 auto 10px;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 0.74em;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1.2;
  border: 1px solid currentColor;
}
.site-card .access-chip .access-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: currentColor;
  flex: none;
}
/* Cyan — Strapi CMS (most common). #7dd3fc on dark gives ≥ 8:1 contrast. */
.site-card .access-strapi { color: #7dd3fc; background: rgba(125, 211, 252, 0.08); }
/* Violet — GitHub repo. #c4b5fd gives ≥ 7:1 contrast on the card bg. */
.site-card .access-github { color: #c4b5fd; background: rgba(196, 181, 253, 0.08); }
/* Amber — bare server (uncommon, signals "different"). #fcd34d ≥ 9:1. */
.site-card .access-server { color: #fcd34d; background: rgba(252, 211, 77, 0.08); }

.site-card .nums {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin: 0 0 18px;
}
.site-card .tile { padding: 18px 8px; border-radius: 14px; text-align: center; }
.site-card .tile.total { background: rgba(77, 171, 247, 0.10); }
.site-card .tile.audit { background: rgba(255, 168, 77, 0.13); }
.site-card .tile .num {
  font-size: 3.6em;
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  display: block;
}
.site-card .tile.total .num { color: #4dabf7; }
.site-card .tile.audit .num { color: #ffa84d; }
.site-card .tile .lbl {
  display: block;
  margin-top: 8px;
  font-size: 0.78em;
  color: var(--fc-text-muted, #9aa5b1);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.site-card .donut-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  margin: 6px 0 18px;
}
.site-card .donut {
  width: 130px; height: 130px;
  border-radius: 50%;
  /* --pct is emitted with a "%" suffix (e.g. "--pct:67.6%"). CSS calc()
     cannot multiply two percentages, so we use the var directly as a
     percentage stop. */
  background: conic-gradient(
    #ffa84d 0 var(--pct, 0%),
    rgba(77, 171, 247, 0.45) var(--pct, 0%) 100%
  );
  display: flex; align-items: center; justify-content: center;
  position: relative;
  flex: none;
}
.site-card .donut::after {
  content: "";
  position: absolute;
  inset: 14px;
  background: #141a23;
  border-radius: 50%;
}
.site-card .donut .pct {
  position: relative; z-index: 1;
  font-weight: 900;
  font-size: 1.5em;
  color: #ffa84d;
  line-height: 1;
}
.site-card .donut .pct small {
  display: block;
  font-size: 0.45em;
  color: #9aa5b1;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 4px;
}
.site-card .donut-caption { text-align: left; }
.site-card .donut-caption strong { display: block; color: #ffffff; font-size: 1em; }
.site-card .donut-caption span { color: #9aa5b1; font-size: 0.85em; }

.site-card .chips {
  display: flex; justify-content: center; flex-wrap: wrap;
  gap: 8px; margin: 0 0 12px;
}
.site-card .chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 11px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 999px;
  font-size: 0.88em;
  color: #d4dae0;
}
.site-card .chip .ico { width: 16px; height: 16px; flex: none; }
.site-card .chip-pdf .ico { color: #ff6b6b; }
.site-card .chip-doc .ico { color: #4dabf7; }
.site-card .chip-img .ico { color: #9aa5b1; }

.site-card .scan-meta {
  font-size: 0.82em;
  color: var(--fc-text-muted, #788391);
  margin: 6px 0 12px;
  text-align: center;
}

.site-card .tech-details { margin: 6px 0 12px; font-size: 0.82em; color: var(--fc-text-muted, #788391); }
.site-card .tech-details summary { cursor: pointer; }
.site-card .tech-details .hostname,
.site-card .tech-details .ip { margin: 4px 0 0; }

.site-card .actions {
  margin-top: auto;             /* pin to bottom of card */
  display: flex; flex-direction: column; gap: 10px;
}
.site-card .actions .btn {
  /* v1.7.2: explicit position+z-index 2 puts the action buttons unambiguously
     above the stretched-link overlay (z-index 0) so clicks land on the button
     and the download attribute fires correctly. */
  position: relative;
  z-index: 2;
  display: inline-block;
  padding: 16px 22px;
  border-radius: 14px;
  font-weight: 700;
  font-size: 1em;
  text-decoration: none;
  text-align: center;
}
.site-card .actions .btn-primary { background: #4dabf7; color: #0c1219; }
.site-card .actions .btn-secondary { background: transparent; color: #4dabf7; border: 1px solid #2a323d; }

/* 2-col grid: desktop 2-up, mobile 1-up */
.site-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 22px;
}
@media (max-width: 820px) {
  .site-grid { grid-template-columns: 1fr; }
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
  .fleet-total-headline { color: #0066cc; }
  .fleet-total-headline-label { color: #444; }
  .fleet-split-bar { border: 1px solid #999; box-shadow: none; }
  .fleet-split-remediable { background: #d97706 !important; color: #fff; }
  .fleet-split-reference { background: #6e7681 !important; color: #fff; }
  .fleet-equation { background: #f5f5f5 !important; border-color: #ccc; }
  .fleet-eq-num { color: #000; }
  .fleet-eq-cap { color: #444; }
  .fleet-eq-op { color: #666; }
  .explanation { break-inside: avoid; }
  .explanation-card { background: #f8f8f8; border: 1px solid #ccc; border-left: none; border-radius: 0; }
  .explanation-card p { color: #000; }
  .by-type-column { background: #f8f8f8; border: 1px solid #ccc; border-top: none; border-radius: 0; }
  .by-type-column.remediable, .by-type-column.reference { border-top: 1px solid #ccc; }
  .site-card { background: #f8f8f8; border-color: #ccc; box-shadow: none; transform: none; color: #000; }
  .site-card .nickname { color: #444; }
  .site-card .full-name { color: #000; }
  .site-card .tile.total { background: #eef5ff; }
  .site-card .tile.audit { background: #fff1e0; }
  .site-card .tile.total .num { color: #0066cc; }
  .site-card .tile.audit .num { color: #b45309; }
  .site-card .tile .lbl { color: #555; }
  .site-card .donut .pct { color: #b45309; }
  .site-card .donut .pct small { color: #555; }
  .site-card .donut-caption strong { color: #000; }
  .site-card .donut-caption span { color: #555; }
  .site-card .chip { background: #f0f0f0; color: #000; }
  .site-card .scan-meta { color: #555; }
  .site-footer { color: #555; border-color: #ccc; }
  .site-card .actions { display: none; }
  .site-card { page-break-inside: avoid; }
  details.tech-details { display: none; }
}

/* ── master-csv download section ───────────────────────────────────────── */
.master-csv .master-csv-download {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  margin-top: 0.75rem;
}
.master-csv .cta-button {
  display: inline-block;
  padding: 0.6rem 1rem;
  background: #1f6feb;
  color: #ffffff;
  text-decoration: none;
  border-radius: 4px;
  font-weight: 600;
  border: 1px solid #1f6feb;
  transition: background 120ms ease;
}
.master-csv .cta-button:hover { background: #388bfd; }
.master-csv .cta-button:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
}
.master-csv-meta { color: #8b949e; font-size: 0.95rem; }

/* ── duplicates section — v1.7.2 big visual treatment ─────────────────── */
.duplicates .dup-hero {
  background: linear-gradient(180deg, #18202b 0%, #141a23 100%);
  border: 1px solid #2a323d;
  border-radius: 22px;
  padding: 36px 36px 28px;
  margin: 0 0 24px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.32);
}
.duplicates .dup-eyebrow {
  margin: 0 0 8px;
  font-size: 0.82em;
  font-weight: 800;
  color: #c0cdda;
  letter-spacing: 0.10em;
  text-transform: uppercase;
}
.duplicates .dup-title {
  margin: 0 0 14px;
  font-size: 2.4em;
  font-weight: 900;
  color: #ffffff;
  letter-spacing: -0.02em;
  line-height: 1.12;
}
.duplicates .dup-subtitle {
  margin: 0 0 22px;
  font-size: 1.05em;
  line-height: 1.5;
  color: #d4dae0;
  max-width: 78ch;
}
.duplicates .dup-subtitle strong { color: #ffffff; }
.duplicates .dup-stat-tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin-top: 8px;
}
@media (max-width: 720px) {
  .duplicates .dup-stat-tiles { grid-template-columns: 1fr; }
  .duplicates .dup-title { font-size: 1.8em; }
  .duplicates .dup-hero { padding: 24px 22px 20px; }
}
.duplicates .dup-tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 22px 20px;
  border-radius: 16px;
}
.duplicates .dup-tile-exact   { background: rgba(77, 171, 247, 0.10); border: 1px solid rgba(77, 171, 247, 0.30); }
.duplicates .dup-tile-variant { background: rgba(255, 168, 77, 0.12); border: 1px solid rgba(255, 168, 77, 0.32); }
.duplicates .dup-tile-num {
  font-size: 3.2em;
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
.duplicates .dup-tile-exact   .dup-tile-num { color: #4dabf7; }
.duplicates .dup-tile-variant .dup-tile-num { color: #ffa84d; }
.duplicates .dup-tile-lbl {
  margin-top: 4px;
  font-size: 0.95em;
  font-weight: 700;
  color: #ffffff;
  text-transform: lowercase;
  letter-spacing: 0.01em;
}
.duplicates .dup-tile-sub {
  margin-top: 6px;
  font-size: 0.85em;
  color: #9aa5b1;
  line-height: 1.4;
}
.duplicates .dup-explainer-open {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 12px;
  padding: 22px 26px;
  margin: 0 0 24px;
  color: #d4dae0;
  line-height: 1.55;
}
.duplicates .dup-explainer-open p { margin: 0.6rem 0; }
.duplicates .dup-explainer-open-h3 {
  margin: 0 0 0.8rem;
  font-size: 1.2em;
  font-weight: 700;
  color: #ffffff;
}
.duplicates .dup-not-error {
  margin: 1rem 0 1.3rem !important;
  padding: 14px 18px;
  background: rgba(77, 171, 247, 0.08);
  border-left: 3px solid #4dabf7;
  border-radius: 6px;
  color: #e8ecf1;
}
.duplicates .dup-kind-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin: 1.4rem 0;
}
@media (max-width: 820px) {
  .duplicates .dup-kind-cards { grid-template-columns: 1fr; }
}
.duplicates .dup-kind-card {
  padding: 18px 20px;
  border-radius: 12px;
  background: #0d1117;
  border: 1px solid #21262d;
}
.duplicates .dup-kind-card-exact   { border-color: rgba(77, 171, 247, 0.32); }
.duplicates .dup-kind-card-variant { border-color: rgba(255, 168, 77, 0.34); }
.duplicates .dup-kind-card-h4 {
  margin: 0 0 0.6rem;
  font-size: 1.05em;
  font-weight: 700;
  color: #ffffff;
}
.duplicates .dup-kind-card p { margin: 0; font-size: 0.95em; }

/* Legacy collapsible explainer kept for back-compat if reactivated later */
.duplicates .dup-explainer {
  margin: 1rem 0;
  padding: 0.8rem 1rem;
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 4px;
}
.duplicates .dup-explainer summary {
  font-weight: 600;
  cursor: pointer;
  color: #79c0ff;
}
.duplicates .dup-explainer summary:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
  border-radius: 2px;
}
.duplicates .dup-explainer p { margin: 0.5rem 0; line-height: 1.55; }
.duplicates .dup-explainer-h3 {
  margin: 1.2rem 0 0.3rem 0;
  font-size: 1rem;
  color: #c9d1d9;
  font-weight: 600;
}
.duplicates .dup-caveat {
  margin-top: 1.2rem;
  padding: 0.6rem 0.8rem;
  background: #0d1117;
  border-left: 3px solid #d29922;
  border-radius: 2px;
  font-size: 0.93rem;
}

.dup-table-details {
  margin-top: 1rem;
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 4px;
  padding: 0.6rem 0.8rem;
}
.dup-table-details > summary {
  font-weight: 600;
  cursor: pointer;
  color: #79c0ff;
  margin-bottom: 0.6rem;
}
.dup-table-details > summary:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
  border-radius: 2px;
}
/* Duplicates scroll wrapper — same patterns as the per-site report's
   .table-wrap: horizontal overflow with -webkit-overflow-scrolling for iOS
   momentum, grab/grabbing cursor for mouse drag-pan, sticky first column +
   sticky header so the filename / column labels stay anchored. */
.dup-pan-wrap {
  /* width:fit-content + max-width:100% means the wrapper hugs the table on
     wide monitors (no blank padding to the right of the last column) but
     caps at 100% on narrow viewports, where overflow-x kicks in for the
     horizontal scroll / drag-pan path. */
  width: fit-content;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: auto;
  max-height: 70vh;
  border-top: 1px solid #21262d;
  -webkit-overflow-scrolling: touch;
  cursor: grab;
  border-radius: 2px;
}
.dup-pan-wrap.is-panning {
  cursor: grabbing;
  user-select: none;
}
.dup-pan-wrap.is-panning * { user-select: none !important; }
/* Mirror the per-site report table styling exactly (src/report/html.js)
   so every data table in the app looks the same: 12px tabular type, tight
   padding, alternating dark stripes, brighter hover row, sticky thead +
   sticky first column. Auto-sized columns — content drives width via
   width:max-content; no per-column min-widths, so the "Sites" column
   shrinks to its longest cell instead of leaving blank space. Cells use
   white-space:nowrap + max-width:320px + ellipsis to clip very long
   filenames; the full text is in a title= tooltip on the cell. */
.dup-table {
  border-collapse: collapse;
  width: max-content;
  font-size: 12px;
}
.dup-table thead {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #161b22;
}
.dup-table thead th {
  padding: 0.45rem 0.65rem;
  text-align: left;
  white-space: nowrap;
  border-bottom: 2px solid #21262d;
  color: #e5e5e5;
  font-weight: 600;
}
.dup-table tbody tr:nth-child(even) { background: #0c0c0c; }
.dup-table tbody tr:nth-child(odd)  { background: #0d1117; }
.dup-table tbody tr:hover { background: #1a1a1a; }
.dup-table td {
  padding: 0.35rem 0.65rem;
  white-space: nowrap;
  border-bottom: 1px solid #1a1a1a;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #e5e5e5;
  vertical-align: top;
}
.dup-table td a { color: #60a5fa; text-decoration: none; }
.dup-table td a:hover { color: #93c5fd; text-decoration: underline; }
.dup-table td a:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
  border-radius: 2px;
}

/* Sticky first column (filename) — keeps the row's identity visible when
   the user scrolls right. Background is set explicitly per stripe so the
   sticky cell doesn't show the row behind it bleeding through. */
.dup-table th:first-child,
.dup-table td:first-child {
  position: sticky;
  left: 0;
  z-index: 1;
  border-right: 1px solid #21262d;
}
.dup-table thead th:first-child {
  background: #161b22;
  z-index: 3;
}
.dup-table tbody tr:nth-child(even) td:first-child { background: #0c0c0c; }
.dup-table tbody tr:nth-child(odd)  td:first-child { background: #0d1117; }
.dup-table tbody tr:hover td:first-child { background: #1a1a1a; }

.dup-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.dup-dates { font-size: 0.85rem; color: #c9d1d9; white-space: nowrap; }
.dup-dim { color: #6e7681; padding: 0 0.2rem; }
.dup-csv-download {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  margin: 0.75rem 0 0.3rem 0;
}
.dup-csv-download .cta-button {
  display: inline-block;
  padding: 0.55rem 0.95rem;
  background: #1f6feb;
  color: #ffffff;
  text-decoration: none;
  border-radius: 4px;
  font-weight: 600;
  border: 1px solid #1f6feb;
  transition: background 120ms ease;
}
.dup-csv-download .cta-button:hover { background: #388bfd; }
.dup-csv-download .cta-button:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
}
.dup-csv-blurb { color: #8b949e; font-size: 0.92rem; margin-top: 0.2rem; }
.dup-kind {
  display: inline-block;
  margin-left: 0.6rem;
  padding: 0.1rem 0.45rem;
  border-radius: 3px;
  font-size: 0.78rem;
  font-weight: 500;
  vertical-align: middle;
}
.dup-exact { background: #1f6feb; color: #ffffff; }
.dup-variant { background: #d29922; color: #1c2128; }
.dup-newest {
  display: inline-block;
  margin-left: 0.4rem;
  padding: 0.05rem 0.4rem;
  border-radius: 3px;
  font-size: 0.72rem;
  background: #238636;
  color: #ffffff;
  font-weight: 500;
  vertical-align: middle;
}

@media print {
  .duplicates .dup-explainer { background: #ffffff !important; border-color: #ccc; }
  .duplicates .dup-explainer summary { color: #000; }
  .dup-table-details { background: #ffffff !important; border-color: #ccc; }
  .dup-table-details > summary { color: #000; }
  .dup-pan-wrap { background: #ffffff !important; }
  .dup-table thead th { background: #f5f5f5; color: #000; }
  .dup-filename { background: #ffffff !important; color: #000; }
  .dup-table tbody tr:nth-child(even) .dup-filename { background: #fafafa !important; }
  .dup-table th { background: #f5f5f5; color: #000; }
  .dup-group-header td { background: #fafafa; color: #000; border-top-color: #ccc; }
  .master-csv .cta-button { background: #fff; color: #000; border-color: #000; }
}
</style>
</head>
<body>

<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <symbol id="i-file" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></symbol>
    <symbol id="i-img"  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.6"/><polyline points="21 15 16 10 5 21"/></symbol>
  </defs>
</svg>

<header class="site-header">
  <span class="brand"><span>filecap</span> fleet audit snapshot</span>
</header>

<main>

  <section class="hero">
    <h1>ICJIA accessibility fleet audit</h1>
    <p class="subtitle">Generated <time>${he(generatedAt)}</time> from ${he(String(siteCount))} website${siteCount !== 1 ? "s" : ""}</p>

    <div class="hero-summary">
      <p class="lead">
        We scanned ${he(String(siteCount))} ICJIA website${siteCount !== 1 ? "s" : ""} and found
        <strong>${he(fleetTotalFiles.toLocaleString())}</strong> files in total.
      </p>

      <div class="fleet-total-headline-block">
        <span class="fleet-total-headline">${he(fleetTotalFiles.toLocaleString())}</span>
        <span class="fleet-total-headline-label">total files scanned across ${he(String(siteCount))} website${siteCount !== 1 ? "s" : ""}</span>
      </div>

      <div class="fleet-split-bar" role="img" aria-label="${he(fleetTotalFiles.toLocaleString())} total files: ${he(fleetRemediable.toLocaleString())} need accessibility audit (${he(String(fleetTotalFiles > 0 ? Math.round((fleetRemediable / fleetTotalFiles) * 100) : 0))} percent), ${he(fleetNonRemediable.toLocaleString())} don't (${he(String(fleetTotalFiles > 0 ? Math.round((fleetNonRemediable / fleetTotalFiles) * 100) : 0))} percent)">
        <div class="fleet-split-segment fleet-split-remediable" style="flex: ${he(String(fleetRemediable))} 0 0">
          <span class="fleet-split-num">${he(fleetRemediable.toLocaleString())}</span>
          <span class="fleet-split-label">need accessibility audit</span>
          <span class="fleet-split-pct">${he(String(fleetTotalFiles > 0 ? Math.round((fleetRemediable / fleetTotalFiles) * 100) : 0))}%</span>
        </div>
        <div class="fleet-split-segment fleet-split-reference" style="flex: ${he(String(fleetNonRemediable))} 0 0">
          <span class="fleet-split-num">${he(fleetNonRemediable.toLocaleString())}</span>
          <span class="fleet-split-label">don&#39;t need work</span>
          <span class="fleet-split-pct">${he(String(fleetTotalFiles > 0 ? Math.round((fleetNonRemediable / fleetTotalFiles) * 100) : 0))}%</span>
        </div>
      </div>

      <p class="fleet-equation">
        <span class="fleet-eq-num">${he(fleetTotalFiles.toLocaleString())}</span>
        <span class="fleet-eq-cap">total</span>
        <span class="fleet-eq-op">=</span>
        <span class="fleet-eq-num">${he(fleetRemediable.toLocaleString())}</span>
        <span class="fleet-eq-cap">need accessibility audit</span>
        <span class="fleet-eq-op">+</span>
        <span class="fleet-eq-num">${he(fleetNonRemediable.toLocaleString())}</span>
        <span class="fleet-eq-cap">don&#39;t</span>
      </p>
    </div>
  </section>

  <section class="explanation">
    <h2>Why aren&#39;t all ${he(fleetTotalFiles.toLocaleString())} files counted as needing work?</h2>

    <p>
      Good question — the number of files we found and the number that
      need accessibility audit are different on purpose. Here&#39;s the gist:
    </p>

    <div class="explanation-grid">
      <div class="explanation-card">
        <h3>Files that need accessibility audit</h3>
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
        <h3>Files that <em>don&#39;t</em> need accessibility audit</h3>
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

${renderMasterCsvSection(masterCsv)}
${renderDuplicatesSection(duplicateGroups, duplicatesCsv)}

</main>

<footer class="site-footer">
  <span>Generated by filecap. For questions, contact the audit administrator.</span>
  <span>Generated ${he(generatedAt)}</span>
  <span class="site-footer-links">
    <a href="https://github.com/ICJIA/filecap-cli" target="_blank" rel="noopener noreferrer">filecap on GitHub</a>
    <span aria-hidden="true">&middot;</span>
    <a href="https://github.com/ICJIA/filecap-cli/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">CHANGELOG</a>
  </span>
</footer>

<script>
/* Drag-to-pan for the duplicates table, mirroring the per-site report's
   pan behaviour. Mouse-only — touch users get native overflow scrolling
   (with iOS momentum) for free via overflow-x:auto + -webkit-overflow-scrolling.
   5px threshold so small clicks still select text and interactive elements
   still fire. setPointerCapture keeps the drag alive even if the cursor
   leaves the wrapper. */
(function() {
  const wraps = document.querySelectorAll("[data-dup-pan]");
  if (wraps.length === 0) return;
  const PAN_THRESHOLD = 5;

  wraps.forEach(function (wrap) {
    let start = null;
    let panning = false;

    wrap.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse") return;
      if (e.button !== 0) return;
      if (e.target.closest("a, button, input, select, [role='button']")) return;
      start = { x: e.clientX, scrollLeft: wrap.scrollLeft, pointerId: e.pointerId };
    });

    wrap.addEventListener("pointermove", function (e) {
      if (!start || e.pointerId !== start.pointerId) return;
      const dx = e.clientX - start.x;
      if (!panning) {
        if (Math.abs(dx) < PAN_THRESHOLD) return;
        panning = true;
        wrap.classList.add("is-panning");
        try { wrap.setPointerCapture(e.pointerId); } catch (_) {}
        const sel = window.getSelection && window.getSelection();
        if (sel && sel.removeAllRanges) sel.removeAllRanges();
      }
      if (panning) {
        e.preventDefault();
        wrap.scrollLeft = start.scrollLeft - dx;
      }
    });

    function endPan(e) {
      if (!start) return;
      if (e.pointerId !== undefined && e.pointerId !== start.pointerId) return;
      start = null;
      panning = false;
      wrap.classList.remove("is-panning");
    }
    wrap.addEventListener("pointerup", endPan);
    wrap.addEventListener("pointercancel", endPan);
    wrap.addEventListener("pointerleave", endPan);
  });
})();
</script>

</body>
</html>`;

  if (password) {
    return injectPasswordGate(html, password);
  }
  return html;
}
