import fs from "node:fs/promises";
import { CSV_COLUMNS } from "./csv.js";
import { humanizeBytes } from "./format.js";
import { FILECAP_VERSION } from "../version.js";

function formatCellValue(v) {
  if (v === true) return "Yes";
  if (v === false) return "No";
  return v;
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
    scannedPath,
    entry.path,
    entry.absolutePath,
    publicUrl,
    entry.filename,
    entry.extension,
    entry.category,
    entry.remediable,
    entry.sizeBytes,
    entry.modifiedAt,
    entry.sha256 ?? "",
    duplicateOf,
    (entry.flags ?? []).join("|"),
    // PDF
    isPdf ? intro.pageCount : "",
    isPdf ? intro.hasTextLayer : "",
    isPdf ? (intro.textLayerCoverage ?? "") : "",
    isPdf ? intro.isImageOnly : "",
    isPdf ? intro.hasTags : "",
    isPdf ? (intro.hasOutline ?? "") : "",
    isPdf ? intro.hasFormFields : "",
    isPdf ? intro.hasSignatures : "",
    isPdf ? intro.encrypted : "",
    isPdf ? (intro.isLinearized ?? "") : "",
    isPdf ? (intro.pdfVersion ?? "") : "",
    intro?.documentLanguage ?? "",
    isPdf ? (intro.producer ?? "") : "",
    isPdf ? (intro.creator ?? "") : "",
    isPdf ? (intro.creationDate ?? "") : "",
    isPdf ? (intro.title ?? "") : "",
    isPdf ? (intro.author ?? "") : "",
    isPdf ? (intro.subject ?? "") : "",
    isPdf ? (intro.keywords ?? "") : "",
    isPdf ? (intro.modificationDate ?? "") : "",
    isPdf ? (intro.approxWordCount ?? "") : "",
    // DOCX
    isDocx ? intro.hasHeadings : "",
    isDocx ? intro.imageCount : "",
    isDocx ? (intro.altTextCoverage ?? "") : "",
    isDocx ? intro.tableCount : "",
    isDocx ? (intro.tablesHaveHeaders ?? "") : "",
    isDocx ? intro.hyperlinkCount : "",
    isDocx ? intro.vagueLinkCount : "",
    isDocx ? (intro.title ?? "") : "",
    isDocx ? (intro.author ?? "") : "",
    isDocx ? (intro.lastModifiedBy ?? "") : "",
    isDocx ? (intro.wordCount ?? "") : "",
    isDocx ? (intro.paragraphCount ?? "") : "",
    isDocx ? (intro.headingLevelsUsed ?? []).join("|") : "",
    // XLSX
    isXlsx ? intro.sheetCount : "",
    isXlsx ? intro.sheetNames.join("|") : "",
    isXlsx ? intro.defaultSheetNameCount : "",
    isXlsx ? intro.hasHeaderRows : "",
    isXlsx ? intro.mergedCellCount : "",
    isXlsx ? intro.hasCharts : "",
    isXlsx ? intro.hasImages : "",
    isXlsx ? (intro.title ?? "") : "",
    isXlsx ? (intro.author ?? "") : "",
    isXlsx ? (intro.totalCells ?? "") : "",
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
    const cells = values.map((v, i) => {
      if (i === publicUrlColIdx && v !== "" && v !== null && v !== undefined) {
        const escaped = htmlEscape(v);
        return `<td><a href="${escaped}" target="_blank" rel="noopener noreferrer">${escaped}</a></td>`;
      }
      return `<td>${htmlEscape(v)}</td>`;
    }).join("");
    return `<tr${classAttr}>${cells}</tr>`;
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
  // Safe JSON embedding: prevent </script> from ending the script block early
  const jsonData = JSON.stringify(
    entries.map((entry) => buildRowValues({ entry, sourceHeader, sourceMap, isConsolidated }))
  ).replace(/<\/script/gi, "<\\/script");

  // ── assemble HTML ─────────────────────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>filecap audit — ${htmlEscape(titleSuffix)}</title>
<style>
/* ── base ──────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #212529;
  background: #fff;
  margin: 0;
  padding: 1rem 1.5rem;
}
h1 { font-size: 1.4rem; margin: 0 0 0.25rem; }
h2 { font-size: 1.1rem; margin: 1.25rem 0 0.5rem; }
p { margin: 0 0 0.5rem; }

/* ── metadata grid ─────────────────────────────────────────── */
.meta-grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.1rem 1rem;
  margin: 0.75rem 0 1rem;
  font-size: 13px;
}
.meta-label { font-weight: 600; color: #495057; }

/* ── summary cards ─────────────────────────────────────────── */
.summary-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.card {
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  padding: 0.5rem 0.85rem;
  min-width: 130px;
}
.card-label { font-size: 11px; color: #6c757d; text-transform: uppercase; letter-spacing: 0.04em; }
.card-value { font-size: 1.5rem; font-weight: 700; line-height: 1.2; }

/* ── category table ────────────────────────────────────────── */
.cat-table { border-collapse: collapse; font-size: 13px; margin-bottom: 1rem; }
.cat-table td { padding: 0.2rem 0.75rem 0.2rem 0; }
.cat-table td:last-child { text-align: right; font-weight: 600; }

/* ── controls ──────────────────────────────────────────────── */
.controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}
.controls input[type="search"] {
  padding: 0.35rem 0.6rem;
  border: 1px solid #adb5bd;
  border-radius: 4px;
  font-size: 13px;
  width: 320px;
}
.controls input[type="search"]:focus {
  outline: 2px solid #0d6efd;
  outline-offset: 1px;
}
#row-count { font-size: 12px; color: #6c757d; }

/* ── table wrapper ─────────────────────────────────────────── */
.table-wrap {
  overflow-x: auto;
  border: 1px solid #dee2e6;
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
  background: #fff;
  z-index: 1;
  border-right: 1px solid #dee2e6;
}

.table-wrap thead th:first-child {
  background: #f8f9fa;
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
  background: #f8f9fa;
}
thead th {
  padding: 0.45rem 0.65rem;
  text-align: left;
  white-space: nowrap;
  border-bottom: 2px solid #dee2e6;
  cursor: pointer;
  user-select: none;
}
thead th:hover { background: #e9ecef; }
thead th.sort-asc::after  { content: " ▲"; font-size: 10px; }
thead th.sort-desc::after { content: " ▼"; font-size: 10px; }
tbody tr:nth-child(even) { background: #f8f9fa; }
tbody tr:hover { background: #e9ecef; }
td {
  padding: 0.35rem 0.65rem;
  white-space: nowrap;
  border-bottom: 1px solid #f0f0f0;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── row state classes ─────────────────────────────────────── */
tr.image-only td:first-child { background: #fff3cd; }
tr.image-only { background: #fff8e1; }
tr.flagged { border-left: 3px solid #d97706; }
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
.badge-warn { background: #fff3cd; color: #856404; border: 1px solid #ffc107; }

/* ── footer ────────────────────────────────────────────────── */
footer {
  margin-top: 1.5rem;
  font-size: 11px;
  color: #6c757d;
  border-top: 1px solid #dee2e6;
  padding-top: 0.5rem;
}

/* ── print ─────────────────────────────────────────────────── */
@media print {
  .controls { display: none; }
  .table-wrap { max-height: none; overflow: visible; border: none; }
  thead { position: static; }
  body { padding: 0; font-size: 10px; }
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

<script>
(function () {
  "use strict";

  // ── embedded data (column-parallel to CSV_COLUMNS) ─────────────────────────
  const data = JSON.parse('${jsonData}');

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

  function filterRows() {
    const q = searchInput.value.trim().toLowerCase();
    let visible = 0;
    allRows.forEach(function (row, i) {
      const rowData = data[i];
      const match = !q || (rowData && rowData.some(function (v) {
        return v !== null && v !== undefined && String(v).toLowerCase().includes(q);
      }));
      row.style.display = match ? "" : "none";
      if (match) visible++;
    });
    updateRowCount(visible);
  }

  searchInput.addEventListener("input", filterRows);
  updateRowCount(allRows.length);

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
})();
</script>

</body>
</html>`;

  await fs.writeFile(outputPath, html, "utf8");
}
