import fs from "node:fs/promises";
import { CSV_COLUMNS } from "./csv.js";
import { humanizeBytes } from "./format.js";
import { FILECAP_VERSION } from "../version.js";

function formatCellValue(v) {
  if (v === true) return "Yes";
  if (v === false) return "No";
  return v;
}

const CATEGORY_LABELS = {
  "pdf": "PDF",
  "office-document": "Office docs",
  "spreadsheet": "Spreadsheet",
  "presentation": "Presentation",
  "image": "Image",
  "archive": "Archive",
  "text": "Text",
  "web": "Web",
  "audio-video": "Audio/Video",
  "other": "Other",
};

function formatCategory(cat) {
  return CATEGORY_LABELS[cat] ?? cat;
}

/**
 * Escape a value for safe insertion into HTML.
 * @param {*} s
 * @returns {string}
 */
function htmlEscape(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build a display-ready row value array for one entry, parallel to CSV_COLUMNS.
 * Booleans are converted to "Yes"/"No" for human readability.
 *
 * @param {object} entry
 * @param {object} sourceHeader
 * @param {Map} sourceMap - serverName → source metadata (consolidated only)
 * @param {boolean} isConsolidated
 * @returns {Array<string|number>}
 */
function buildPublicUrl({ entry, sourceHeader, sourceMap, isConsolidated }) {
  let base;
  if (isConsolidated) {
    const src = sourceMap.get(entry.serverName);
    base = src?.publicUrlBase ?? "";
  } else {
    base = sourceHeader.metadata?.publicUrlBase ?? "";
  }
  if (!base) return "";
  const cleanBase = base.replace(/\/+$/, "");
  const cleanPath = (entry.path ?? "").replace(/^\/+/, "");
  return `${cleanBase}/${cleanPath}`;
}

function buildRowValues({ entry, sourceHeader, sourceMap, isConsolidated }) {
  let serverName, siteName, serverIp, scannedPath;
  if (isConsolidated) {
    serverName = entry.serverName;
    const src = sourceMap.get(entry.serverName);
    siteName = src?.siteName ?? "";
    serverIp = src?.serverIp ?? "";
    scannedPath = src?.scannedPath ?? "";
  } else {
    const m = sourceHeader.metadata;
    serverName = m.serverName;
    siteName = m.siteName ?? "";
    serverIp = m.serverIp;
    scannedPath = m.scannedPath;
  }

  const publicUrl = buildPublicUrl({ entry, sourceHeader, sourceMap, isConsolidated });

  const intro = entry.introspection ?? null;
  const isPdf = intro?.kind === "pdf";
  const isDocx = intro?.kind === "docx";
  const isXlsx = intro?.kind === "xlsx";
  const isLegacy = intro?.kind === "office-legacy";

  const duplicateOf = entry.duplicateOf
    ? `${entry.duplicateOf.serverName}:${entry.duplicateOf.path}`
    : "";

  const raw = [
    serverName,
    siteName,
    serverIp,
    entry.modifiedAt,
    entry.remediable === true ? "Yes — needs accessibility work" : entry.remediable === false ? "No — reference file (image, placeholder, etc.)" : "",
    scannedPath,
    entry.path,
    entry.absolutePath,
    publicUrl,
    entry.filename,
    entry.extension,
    entry.category,
    entry.sizeBytes,
    entry.sha256 ?? "",
    duplicateOf,
    // PDF
    isPdf ? intro.pageCount : "",
    isPdf ? intro.hasTextLayer : "",
    isPdf ? intro.isImageOnly : "",
    isPdf ? intro.hasTags : "",
    isPdf ? intro.hasFormFields : "",
    isPdf ? intro.encrypted : "",
    intro?.documentLanguage ?? "",
    // DOCX
    isDocx ? intro.hasHeadings : "",
    isDocx ? intro.imageCount : "",
    isDocx ? (intro.altTextCoverage ?? "") : "",
    isDocx ? intro.tableCount : "",
    isDocx ? (intro.tablesHaveHeaders ?? "") : "",
    isDocx ? intro.vagueLinkCount : "",
    // XLSX
    isXlsx ? intro.sheetCount : "",
    // Legacy
    isLegacy ? intro.format : "",
  ];

  return raw.map(formatCellValue);
}

/**
 * Write a self-contained HTML report.
 *
 * @param {object} args
 * @param {object} args.sourceHeader - the inventory's header object
 * @param {Array}  args.entries      - the inventory's entries
 * @param {Array|null} args.sources  - sources[] array (consolidated only); null/undefined for single-instance
 * @param {string} args.outputPath   - absolute path to write the .html file
 * @returns {Promise<void>}
 */
export async function writeHtml({ sourceHeader, entries, sources, outputPath }) {
  const isConsolidated = sourceHeader.kind === "filecap-consolidated-header";
  const sourceMap = new Map();
  if (isConsolidated && sources) {
    for (const s of sources) {
      sourceMap.set(s.serverName ?? s.metadata?.serverName, s.metadata ?? s);
    }
  }

  const meta = sourceHeader.metadata;

  // ── summary stats ────────────────────────────────────────────────────────────
  let totalBytes = 0;
  const categoryCounts = {};
  let imageOnlyCount = 0;
  let flaggedCount = 0;

  for (const entry of entries) {
    totalBytes += entry.sizeBytes ?? 0;
    const cat = entry.category ?? "other";
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
    const intro = entry.introspection ?? null;
    if (intro?.kind === "pdf" && intro.isImageOnly === true) {
      imageOnlyCount++;
    }
    if ((entry.flags ?? []).length > 0) {
      flaggedCount++;
    }
  }

  const totalFiles = entries.length;

  // ── remediable vs reference breakdown ────────────────────────────────────────
  const pdfCount = categoryCounts["pdf"] ?? 0;
  const officeCount = categoryCounts["office-document"] ?? 0;
  const spreadsheetCount = categoryCounts["spreadsheet"] ?? 0;
  const presentationCount = categoryCounts["presentation"] ?? 0;
  const legacyCount = categoryCounts["legacy-office"] ?? 0;
  const remediableCount = pdfCount + officeCount + spreadsheetCount + presentationCount + legacyCount;
  const nonRemediableCount = totalFiles - remediableCount;
  const imageCount = categoryCounts["image"] ?? 0;
  const textCount = (categoryCounts["text"] ?? 0) + (categoryCounts["web"] ?? 0);
  const otherNonRemCount = nonRemediableCount - imageCount - textCount;

  // ── filter bar (category chips) ──────────────────────────────────────────────
  const CHIP_ORDER = ["pdf", "office-document", "spreadsheet", "presentation", "image", "archive", "text", "web", "audio-video", "other"];
  const chipsHtml = CHIP_ORDER
    .filter((cat) => categoryCounts[cat])
    .map((cat) => `<button class="chip" data-category="${htmlEscape(cat)}">${htmlEscape(formatCategory(cat))} (${categoryCounts[cat]})</button>`)
    .join(" ");

  const filterBarHtml = `
  <section class="filter-bar filter-bar-primary">
    <strong>Show:</strong>
    <button class="chip chip-active" data-filter="remediable">Remediable only (${remediableCount})</button>
    <button class="chip" data-filter="reference">Reference only (${nonRemediableCount})</button>
    <button class="chip" data-filter="all">All (${totalFiles})</button>
  </section>
  <section class="filter-bar filter-bar-secondary">
    <strong>Or by type:</strong>
    ${chipsHtml}
  </section>`;

  // ── build table rows ─────────────────────────────────────────────────────────
  const publicUrlColIdx = CSV_COLUMNS.findIndex((c) => c.name === "publicUrl");

  const rowsHtml = entries.map((entry) => {
    const values = buildRowValues({ entry, sourceHeader, sourceMap, isConsolidated });
    const intro = entry.introspection ?? null;
    const isImageOnly = intro?.kind === "pdf" && intro.isImageOnly === true;
    const isFlagged = (entry.flags ?? []).length > 0;

    const classes = [];
    if (isImageOnly) classes.push("image-only");
    if (isFlagged) classes.push("flagged");

    const classAttr = classes.length > 0 ? ` class="${classes.join(" ")}"` : "";
    const categoryAttr = ` data-category="${htmlEscape(entry.category ?? "other")}"`;
    const cells = values.map((v, i) => {
      if (i === publicUrlColIdx && v !== "" && v !== null && v !== undefined) {
        const escaped = htmlEscape(v);
        return `<td><a href="${escaped}" target="_blank" rel="noopener noreferrer">${escaped}</a></td>`;
      }
      return `<td>${htmlEscape(v)}</td>`;
    }).join("");
    return `<tr${classAttr}${categoryAttr}>${cells}</tr>`;
  }).join("\n");

  // ── category breakdown ───────────────────────────────────────────────────────
  const categoryRows = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, count]) => `<tr><td>${htmlEscape(cat)}</td><td>${count}</td></tr>`)
    .join("\n");

  // ── header columns ───────────────────────────────────────────────────────────
  const headerCells = CSV_COLUMNS.map((col) => `<th data-col="${htmlEscape(col.name)}">${htmlEscape(col.label)}</th>`).join("");

  // ── server/scan metadata display ─────────────────────────────────────────────
  const serverName = meta?.serverName ?? "";
  const siteName = meta?.siteName ?? "";
  const serverIp = meta?.serverIp ?? "";
  const hostname = meta?.hostname ?? "";
  const scannedPath = meta?.scannedPath ?? "";
  const scannedAt = meta?.scannedAt ?? "";
  const titleSuffix = siteName !== "" ? siteName : serverName;

  // ── embed data as JSON for client-side search/sort ────────────────────────────
  // The JSON sits in a separate <script type="application/json"> block, so we
  // never need to worry about JS string-literal escaping (single quotes from PDF
  // date metadata like 'D:20250207-08'00'' previously broke the IIFE silently).
  // We still escape </script> sequences to prevent premature script-tag termination.
  const jsonData = JSON.stringify(
    entries.map((entry) => buildRowValues({ entry, sourceHeader, sourceMap, isConsolidated }))
  ).replace(/<\/script/gi, "<\\/script");

  // ── assemble HTML ─────────────────────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>filecap audit — ${htmlEscape(titleSuffix)}</title>
<style>
/* ── base ──────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  color: #e5e5e5;
  background: #0a0a0a;
  margin: 0;
  padding: 1rem 1.5rem;
}
h1 { font-size: 1.4rem; margin: 0 0 0.25rem; color: #e5e5e5; letter-spacing: -0.02em; }
h2 { font-size: 1.1rem; margin: 1.25rem 0 0.5rem; color: #e5e5e5; font-weight: 600; }
p { margin: 0 0 0.5rem; }
a { color: #60a5fa; text-decoration: none; }
a:hover { color: #93c5fd; text-decoration: underline; }

/* ── metadata grid ─────────────────────────────────────────── */
.meta-grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.1rem 1rem;
  margin: 0.75rem 0 1rem;
  font-size: 13px;
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
}
.meta-label { font-weight: 600; color: #999999; }

/* ── summary cards ─────────────────────────────────────────── */
.summary-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.card {
  background: #161616;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  padding: 0.5rem 0.85rem;
  min-width: 130px;
}
.card-label { font-size: 11px; color: #999999; text-transform: uppercase; letter-spacing: 0.04em; }
.card-value { font-size: 1.5rem; font-weight: 700; line-height: 1.2; color: #e5e5e5; }

/* ── category table ────────────────────────────────────────── */
.cat-table { border-collapse: collapse; font-size: 13px; margin-bottom: 1rem; color: #e5e5e5; }
.cat-table td { padding: 0.2rem 0.75rem 0.2rem 0; }
.cat-table td:last-child { text-align: right; font-weight: 600; color: #60a5fa; }

/* ── filter bar / chips ────────────────────────────────────── */
.filter-bar {
  display: flex;
  gap: 0.5em;
  flex-wrap: wrap;
  align-items: center;
  margin: 1em 0;
  padding: 0.5em;
  background: #161616;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
}

.chip {
  display: inline-block;
  padding: 0.4em 0.9em;
  border: 1px solid #404040;
  border-radius: 999px;
  background: #0a0a0a;
  color: #e5e5e5;
  cursor: pointer;
  font-size: 0.9em;
  font-family: inherit;
  transition: background 150ms ease-out, border-color 150ms ease-out;
}

.chip:hover {
  border-color: #60a5fa;
  background: #161616;
}

.chip-active {
  background: #60a5fa;
  color: #0a0a0a;
  border-color: #60a5fa;
  font-weight: 600;
}

.chip-active:hover {
  background: #93c5fd;
  border-color: #93c5fd;
}

/* ── controls ──────────────────────────────────────────────── */
.controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}
.controls input[type="search"] {
  padding: 0.35rem 0.6rem;
  border: 1px solid #404040;
  border-radius: 4px;
  font-size: 13px;
  width: 320px;
  background: #161616;
  color: #e5e5e5;
}
.controls input[type="search"]::placeholder { color: #666666; }
.controls input[type="search"]:focus {
  outline: 2px solid #60a5fa;
  outline-offset: 1px;
}
#row-count { font-size: 12px; color: #999999; }

/* ── table wrapper ─────────────────────────────────────────── */
.table-wrap {
  overflow-x: auto;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  max-height: 70vh;
  -webkit-overflow-scrolling: touch;
}

/* ── scrollable container (alias for table-wrap) ───────────── */
.table-scroll {
  overflow-x: auto;
  width: 100%;
  -webkit-overflow-scrolling: touch;
}

/* ── sticky first column ───────────────────────────────────── */
.table-wrap th:first-child,
.table-wrap td:first-child {
  position: sticky;
  left: 0;
  background: #0a0a0a;
  z-index: 1;
  border-right: 1px solid #2a2a2a;
}

.table-wrap thead th:first-child {
  background: #161616;
  z-index: 2;
}

/* ── data table ────────────────────────────────────────────── */
table {
  border-collapse: collapse;
  width: max-content;
  min-width: 100%;
  font-size: 12px;
}
thead {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #161616;
}
thead th {
  padding: 0.45rem 0.65rem;
  text-align: left;
  white-space: nowrap;
  border-bottom: 2px solid #2a2a2a;
  cursor: pointer;
  user-select: none;
  color: #e5e5e5;
}
thead th:hover { background: #1a1a1a; }
thead th.sort-asc::after  { content: " ▲"; font-size: 10px; color: #60a5fa; }
thead th.sort-desc::after { content: " ▼"; font-size: 10px; color: #60a5fa; }
tbody tr:nth-child(even) { background: #0c0c0c; }
tbody tr:nth-child(odd)  { background: #0a0a0a; }
tbody tr:hover { background: #1a1a1a; }
td {
  padding: 0.35rem 0.65rem;
  white-space: nowrap;
  border-bottom: 1px solid #1a1a1a;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #e5e5e5;
}
td a { color: #60a5fa; }
td a:hover { color: #93c5fd; text-decoration: underline; }

/* ── row state classes ─────────────────────────────────────── */
tr.image-only td:first-child { background: #1a1400; }
tr.image-only { background: #111000; }
tr.flagged { border-left: 3px solid #fbbf24; }
tr.flagged td { /* let row bg show through; border is the indicator */ }

/* ── badge ─────────────────────────────────────────────────── */
.badge {
  display: inline-block;
  padding: 0.1em 0.4em;
  font-size: 10px;
  border-radius: 3px;
  font-weight: 600;
  vertical-align: middle;
  margin-left: 0.25em;
}
.badge-warn { background: #2a1f00; color: #fbbf24; border: 1px solid #fbbf24; }

/* ── footer ────────────────────────────────────────────────── */
footer {
  margin-top: 1.5rem;
  font-size: 11px;
  color: #666666;
  border-top: 1px solid #2a2a2a;
  padding-top: 0.5rem;
}

/* ── primary / secondary filter bars ───────────────────────── */
.filter-bar-primary .chip { font-weight: 600; }
.filter-bar-secondary { margin-top: 0.25em; background: transparent; border: none; font-size: 0.95em; }
.filter-bar-secondary .chip { font-size: 0.85em; }

/* ── audit-stats two-column summary ────────────────────────── */
.audit-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 1em; margin: 1em 0; }
.stat-card { padding: 1em; border-radius: 8px; border: 1px solid; background: #161616; }
.stat-card.remediable { border-color: #fbbf24; }
.stat-card.reference { border-color: #71717a; }
.stat-card .stat-heading { text-transform: uppercase; font-size: 0.85em; letter-spacing: 0.05em; color: #999999; margin-bottom: 0.5em; }
.stat-card .stat-number { font-size: 2.5em; font-weight: 700; line-height: 1; color: #e5e5e5; }
.stat-card.remediable .stat-number { color: #fbbf24; }
.stat-card.reference .stat-number { color: #71717a; }
.stat-card .stat-label { font-size: 0.95em; margin-top: 0.25em; color: #999999; }
.stat-card .stat-detail { margin-top: 0.75em; font-size: 0.9em; color: #999999; padding: 0; }
.stat-card .stat-detail li { list-style: disc; margin-left: 1.5em; padding-left: 0.25em; }
.audit-total { text-align: center; margin: 0.5em 0 1em; font-size: 0.9em; color: #666666; }
@media (max-width: 720px) { .audit-stats { grid-template-columns: 1fr; } }

/* ── print ─────────────────────────────────────────────────── */
@media print {
  body { background: #fff; color: #000; padding: 0; font-size: 10px; }
  h1, h2 { color: #000; }
  .controls { display: none; }
  .filter-bar { display: none; }
  .table-wrap { max-height: none; overflow: visible; border: 1px solid #ccc; }
  thead { position: static; background: #f0f0f0; }
  thead th { background: #f0f0f0; color: #000; border-bottom: 2px solid #ccc; }
  td { color: #000; border-bottom: 1px solid #eee; }
  .card { background: #f8f8f8; border-color: #ccc; }
  .card-value, .card-label { color: #000; }
  .stat-card { background: #f8f8f8; border-color: #ccc; }
  .stat-card .stat-number, .stat-card .stat-heading, .stat-card .stat-label,
  .stat-card .stat-detail { color: #000; }
  .stat-card.remediable .stat-number { color: #d97706; }
  .stat-card.reference .stat-number { color: #555; }
  footer { color: #555; border-color: #ccc; }
  .audit-total { color: #555; }
  tbody tr:nth-child(even) { background: #f8f8f8; }
  tbody tr:nth-child(odd) { background: #fff; }
  tbody tr:hover { background: inherit; }
  .table-wrap th:first-child, .table-wrap td:first-child { background: inherit; }
  .cat-table td:last-child { color: #000; }
  a { color: #0066cc; }
  td a { color: #0066cc; }
  .card-value { font-size: 1.1rem; }
}
</style>
</head>
<body>

<h1>filecap inventory report</h1>

<div class="meta-grid">
  ${siteName !== "" ? `<span class="meta-label">Website:</span>      <span>${htmlEscape(siteName)}</span>` : ""}
  <span class="meta-label">Server:</span>      <span>${htmlEscape(serverName)}</span>
  <span class="meta-label">IP:</span>           <span>${htmlEscape(serverIp)}</span>
  <span class="meta-label">Hostname:</span>     <span>${htmlEscape(hostname)}</span>
  <span class="meta-label">Scanned path:</span> <span>${htmlEscape(scannedPath)}</span>
  <span class="meta-label">Scanned at:</span>   <span>${htmlEscape(scannedAt)}</span>
</div>

<section class="audit-stats">
  <div class="stat-card remediable">
    <div class="stat-heading">Audit work</div>
    <div class="stat-number">${remediableCount}</div>
    <div class="stat-label">files need remediation</div>
    <ul class="stat-detail">
      ${pdfCount > 0 ? `<li>${pdfCount} PDF${pdfCount === 1 ? "" : "s"}</li>` : ""}
      ${officeCount > 0 ? `<li>${officeCount} Office doc${officeCount === 1 ? "" : "s"}</li>` : ""}
      ${spreadsheetCount > 0 ? `<li>${spreadsheetCount} spreadsheet${spreadsheetCount === 1 ? "" : "s"}</li>` : ""}
      ${presentationCount > 0 ? `<li>${presentationCount} presentation${presentationCount === 1 ? "" : "s"}</li>` : ""}
      ${legacyCount > 0 ? `<li>${legacyCount} legacy Office</li>` : ""}
    </ul>
  </div>
  <div class="stat-card reference">
    <div class="stat-heading">Reference files</div>
    <div class="stat-number">${nonRemediableCount}</div>
    <div class="stat-label">no direct work needed</div>
    <ul class="stat-detail">
      ${imageCount > 0 ? `<li>${imageCount} image${imageCount === 1 ? "" : "s"}</li>` : ""}
      ${textCount > 0 ? `<li>${textCount} text file${textCount === 1 ? "" : "s"}</li>` : ""}
      ${otherNonRemCount > 0 ? `<li>${otherNonRemCount} other</li>` : ""}
    </ul>
  </div>
</section>
<div class="audit-total">
  Total inventoried: ${totalFiles} files (${htmlEscape(humanizeBytes(totalBytes))})
</div>

<div class="summary-bar">
  <div class="card">
    <div class="card-label">Total files</div>
    <div class="card-value">${totalFiles.toLocaleString()}</div>
  </div>
  <div class="card">
    <div class="card-label">Total size</div>
    <div class="card-value">${htmlEscape(humanizeBytes(totalBytes))}</div>
  </div>
  <div class="card">
    <div class="card-label">Image-only PDFs</div>
    <div class="card-value">${imageOnlyCount.toLocaleString()}</div>
  </div>
  <div class="card">
    <div class="card-label">Flagged files</div>
    <div class="card-value">${flaggedCount.toLocaleString()}</div>
  </div>
</div>

<h2>By category</h2>
<table class="cat-table">
  <tbody>
${categoryRows}
  </tbody>
</table>

<h2>File inventory</h2>
${filterBarHtml}
<div class="controls">
  <input type="search" id="search" placeholder="Filter by filename, path, server…" aria-label="Filter table rows">
  <span id="row-count"></span>
</div>

<div class="table-wrap table-scroll">
  <table id="inventory-table" aria-label="File inventory">
    <thead><tr>${headerCells}</tr></thead>
    <tbody id="inventory-body">
${rowsHtml}
    </tbody>
  </table>
</div>

<footer>
  Generated by filecap v${htmlEscape(FILECAP_VERSION)} &mdash; ${htmlEscape(scannedAt)}
  &mdash; <a href="https://github.com/ICJIA/filecap-cli" target="_blank" rel="noopener noreferrer">filecap on GitHub</a>
</footer>

<script type="application/json" id="filecap-data">${jsonData}</script>
<script>
(function () {
  "use strict";

  // ── embedded data (column-parallel to CSV_COLUMNS) ─────────────────────────
  const data = JSON.parse(document.getElementById("filecap-data").textContent);

  const tbody = document.getElementById("inventory-body");
  const searchInput = document.getElementById("search");
  const rowCountEl = document.getElementById("row-count");
  const allRows = Array.from(tbody.querySelectorAll("tr"));

  // ── filter ──────────────────────────────────────────────────────────────────
  function updateRowCount(visible) {
    rowCountEl.textContent = visible === allRows.length
      ? \`\${visible.toLocaleString()} rows\`
      : \`\${visible.toLocaleString()} of \${allRows.length.toLocaleString()} rows\`;
  }

  let activeFilter = "remediable";
  let activeCategory = "";

  const REMEDIABLE_CATS = ["pdf", "office-document", "spreadsheet", "presentation", "legacy-office"];

  function applyFilters() {
    const q = (searchInput ? searchInput.value.trim().toLowerCase() : "");
    let visible = 0;
    allRows.forEach(function (row, i) {
      const cat = row.dataset.category || "other";
      let matchFilter;
      if (activeFilter === "all") matchFilter = true;
      else if (activeFilter === "remediable") matchFilter = REMEDIABLE_CATS.indexOf(cat) >= 0;
      else if (activeFilter === "reference") matchFilter = REMEDIABLE_CATS.indexOf(cat) < 0;
      else matchFilter = true;
      const matchCategory = !activeCategory || cat === activeCategory;
      const rowData = data[i];
      const matchSearch = !q || (rowData && rowData.some(function (v) {
        return v !== null && v !== undefined && String(v).toLowerCase().includes(q);
      }));
      const show = matchFilter && matchCategory && matchSearch;
      row.style.display = show ? "" : "none";
      if (show) visible++;
    });
    updateRowCount(visible);
  }

  // ── primary chip click handler ───────────────────────────────────────────────
  const primaryChips = document.querySelectorAll(".filter-bar-primary .chip");
  primaryChips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      primaryChips.forEach(function (c) { c.classList.remove("chip-active"); });
      chip.classList.add("chip-active");
      activeFilter = chip.dataset.filter;
      activeCategory = "";
      document.querySelectorAll(".filter-bar-secondary .chip").forEach(function (c) {
        c.classList.remove("chip-active");
      });
      applyFilters();
    });
  });

  // ── secondary chip click handler ─────────────────────────────────────────────
  const secondaryChips = document.querySelectorAll(".filter-bar-secondary .chip");
  secondaryChips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      secondaryChips.forEach(function (c) { c.classList.remove("chip-active"); });
      chip.classList.add("chip-active");
      activeCategory = chip.dataset.category;
      activeFilter = "all";
      primaryChips.forEach(function (c) { c.classList.remove("chip-active"); });
      if (primaryChips[2]) primaryChips[2].classList.add("chip-active");
      applyFilters();
    });
  });

  if (searchInput) {
    searchInput.addEventListener("input", applyFilters);
  }
  applyFilters();

  // ── sort ────────────────────────────────────────────────────────────────────
  const headers = Array.from(document.querySelectorAll("#inventory-table thead th"));
  let sortColIdx = -1;
  let sortAsc = true;

  headers.forEach(function (th, colIdx) {
    th.addEventListener("click", function () {
      if (sortColIdx === colIdx) {
        sortAsc = !sortAsc;
      } else {
        sortColIdx = colIdx;
        sortAsc = true;
      }
      headers.forEach(function (h) { h.classList.remove("sort-asc", "sort-desc"); });
      th.classList.add(sortAsc ? "sort-asc" : "sort-desc");

      // Pair data rows with their data for stable sort
      const pairs = allRows.map(function (row, i) { return { row: row, vals: data[i] || [] }; });
      pairs.sort(function (a, b) {
        const av = a.vals[colIdx] ?? "";
        const bv = b.vals[colIdx] ?? "";
        const an = typeof av === "number" ? av : parseFloat(av);
        const bn = typeof bv === "number" ? bv : parseFloat(bv);
        let cmp;
        if (!isNaN(an) && !isNaN(bn)) {
          cmp = an - bn;
        } else {
          cmp = String(av).localeCompare(String(bv));
        }
        return sortAsc ? cmp : -cmp;
      });
      pairs.forEach(function (p) { tbody.appendChild(p.row); });
    });
  });

  // ── default sort: by Date published, descending (most recent first) ──────────
  const dateColIdx = headers.findIndex(function (th) { return th.dataset.col === "modifiedAt"; });
  if (dateColIdx >= 0) {
    // Trigger the sort logic for this column, descending
    sortColIdx = dateColIdx;
    sortAsc = false;
    headers[dateColIdx].classList.add("sort-desc");
    const pairs = allRows.map(function (row, i) { return { row: row, vals: data[i] || [] }; });
    pairs.sort(function (a, b) {
      const av = a.vals[dateColIdx] ?? "";
      const bv = b.vals[dateColIdx] ?? "";
      return String(bv).localeCompare(String(av));  // desc: bv vs av
    });
    pairs.forEach(function (p) { tbody.appendChild(p.row); });
  }
})();
</script>

</body>
</html>`;

  await fs.writeFile(outputPath, html, "utf8");
}
