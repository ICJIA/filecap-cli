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

// Small clipboard-outline icon used by the meta-grid copy buttons. Inline SVG
// (no external request, no font dependency) and stroke: currentColor so the
// hover/copied states can recolor it via CSS.
const COPY_ICON_SVG = '<svg class="meta-copy-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4.25" y="3.25" width="8.5" height="10.5" rx="1.25"/><path d="M10.75 3.25V2.75a1 1 0 0 0-1-1h-2.5a1 1 0 0 0-1 1v0.5"/></svg>';

/**
 * Wrap a meta-grid value in a flex container with the value text and a small
 * copy-to-clipboard button. Designed for the per-site detail page so a
 * remediator can copy IP / hostname / scanned path / public URL with one
 * click instead of selecting the monospace text by hand. The button copies
 * the *raw* value (no surrounding HTML escapes); display HTML can be richer
 * (e.g. an <a> wrapping the URL) without affecting what gets copied.
 *
 * @param {string} value - raw text that goes on the clipboard
 * @param {string|null} displayHtml - HTML to render (defaults to escaped value)
 * @param {string} label - aria-label suffix, e.g. "IP address"
 * @returns {string}
 */
function copyableMetaCell(value, displayHtml, label) {
  if (value === undefined || value === null || value === "") return "<span></span>";
  const display = displayHtml ?? htmlEscape(value);
  return `<span class="meta-value">${display}<button type="button" class="meta-copy" data-copy="${htmlEscape(value)}" aria-label="Copy ${htmlEscape(label || "value")} to clipboard" title="Copy to clipboard">${COPY_ICON_SVG}<span class="meta-copy-feedback" aria-hidden="true">Copied</span></button></span>`;
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

  const duplicateOf = entry.duplicateOf
    ? `${entry.duplicateOf.serverName}:${entry.duplicateOf.path}`
    : "";

  const raw = [
    serverName,
    siteName,
    serverIp,
    publicUrl,
    entry.modifiedAt,
    scannedPath,
    entry.path,
    entry.absolutePath,
    entry.filename,
    entry.extension,
    entry.category,
    entry.sizeBytes,
    entry.sha256 ?? "",
    duplicateOf,
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
/**
 * Write a self-contained HTML report.
 *
 * @param {object} args
 * @param {object} args.sourceHeader  - the inventory header
 * @param {Array}  args.entries       - inventory entries
 * @param {Array}  args.sources       - per-source headers (consolidated mode)
 * @param {string} args.outputPath    - absolute path to write the .html file
 * @param {string|null} [args.backHref] - relative href to a "back" navigation
 *                                        target. When set, a sticky bar at
 *                                        the top of the page shows a "← Back
 *                                        to fleet index" link. Web-rollup
 *                                        passes "index.html" here so each
 *                                        bundled per-site report has a
 *                                        visible way back to the fleet index.
 *                                        Standalone single-site audits omit
 *                                        this (nothing to navigate back to).
 */
// Detail-page access-panel copy. Keep in lock-step with ACCESS_CHIP_LABEL in
// src/web/index-page.js so a manager going from index → detail sees consistent
// language.
const ACCESS_PANEL_COPY = {
  strapi: {
    label: "Strapi CMS / SSH required",
    method: "Files are served by a Strapi CMS instance on a remote Linux host. To audit or remediate them you need to rsync the uploads directory over SSH.",
    credential: "An OpenSSH public key on the file server is required.",
    action: "Contact IDS at ICJIA to request access.",
  },
  github: {
    label: "GitHub repo / access required",
    method: "Files live in an ICJIA-owned GitHub repository. To audit or remediate them you clone the repo and inspect the static asset directory.",
    credential: "A GitHub.com account with ICJIA organization access is required.",
    action: "Contact IDS at ICJIA to request access.",
  },
  server: {
    label: "Server / SSH required",
    method: "Files are stored in a static directory on a remote Linux host (no CMS). To audit or remediate them you need to rsync the directory over SSH.",
    credential: "An OpenSSH public key on the file server is required.",
    action: "Contact IDS at ICJIA to request access.",
  },
};

export async function writeHtml({ sourceHeader, entries, sources, outputPath, backHref = null, csvHref = null, siteUrl = null, siteFullName = null, accessKind = null }) {
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

  // Optional "image-only PDFs" chip — only rendered if at least one row would
  // match. These rows have no text layer (scanned PDFs, no OCR) and are
  // typically the most expensive remediation work, so giving the auditor a
  // one-click filter to look at them is worth the chip slot.
  const imageOnlyChipHtml = imageOnlyCount > 0
    ? `<button class="chip chip-warn" data-filter="image-only">Image-only PDFs / need OCR (${imageOnlyCount})</button>`
    : "";

  const filterBarHtml = `
  <section class="filter-bar filter-bar-primary">
    <strong>Show:</strong>
    <button class="chip chip-active" data-filter="remediable">Remediable only (${remediableCount})</button>
    <button class="chip" data-filter="reference">Reference only (${nonRemediableCount})</button>
    <button class="chip" data-filter="all">All (${totalFiles})</button>
    ${imageOnlyChipHtml}
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
  // v1.7.3: per-column initial widths emitted into a <colgroup> so the table
  // uses `table-layout: fixed`, which lets the user click-and-drag the right
  // edge of any <th> to resize that column. Widths are starting points
  // tuned to the typical content of each column.
  const COL_INITIAL_PX = {
    serverName:   140,
    siteName:     110,
    serverIp:     130,
    publicUrl:    300,
    modifiedAt:   170,
    scannedPath:  220,
    path:         260,
    absolutePath: 300,
    filename:     220,
    extension:    90,
    category:     110,
    sizeBytes:    110,
    sha256:       220,
    duplicateOf:  220,
  };
  const colgroupHtml = `<colgroup>${
    CSV_COLUMNS.map((col) => {
      const w = COL_INITIAL_PX[col.name] ?? 140;
      return `<col data-col="${htmlEscape(col.name)}" style="width:${w}px">`;
    }).join("")
  }</colgroup>`;
  const headerCells = CSV_COLUMNS.map((col) =>
    `<th data-col="${htmlEscape(col.name)}">${htmlEscape(col.label)}<span class="col-resize-handle" data-resize-handle aria-hidden="true"></span></th>`
  ).join("");

  // ── server/scan metadata display ─────────────────────────────────────────────
  // Per-site reports pull from top-level metadata fields. Consolidated fleet
  // reports have a different shape — metadata.sources[] holds per-server info
  // and the top-level fields are absent. Branch the meta-grid render on that.
  const serverName = meta?.serverName ?? "";
  const siteName = meta?.siteName ?? "";
  const serverIp = meta?.serverIp ?? "";
  const hostname = meta?.hostname ?? "";
  const scannedPath = meta?.scannedPath ?? "";
  const scannedAt = meta?.scannedAt ?? "";
  // Prefer the siteUrl param (passed by web-rollup from sites.json), then
  // anything carried in the NDJSON header (scan / future writers may add it),
  // and finally publicUrlBase (the file-server URL) as a last resort so older
  // standalone audits still surface something useful.
  const publicUrlBase = siteUrl ?? meta?.siteUrl ?? meta?.publicUrlBase ?? "";

  let metaGridHtml;
  let titleSuffix;
  if (isConsolidated) {
    const consolidatedSources = meta?.sources ?? [];
    const consolidatedAt = meta?.consolidatedAt ?? "";
    const serverNames = consolidatedSources.map((s) => s.serverName).filter(Boolean);
    const siteNamesList = consolidatedSources.map((s) => s.siteName).filter(Boolean);
    const scanTimes = consolidatedSources.map((s) => s.scannedAt).filter(Boolean).slice().sort();
    const earliest = scanTimes[0] ?? "";
    const latest = scanTimes[scanTimes.length - 1] ?? "";
    const scanWindow = earliest && latest && earliest !== latest
      ? `${earliest} — ${latest}`
      : earliest || latest || "";
    titleSuffix = "Fleet";
    metaGridHtml = `
  <span class="meta-label">Audit type:</span>      <span>Multi-server fleet</span>
  <span class="meta-label">Servers:</span>         <span>${htmlEscape(String(consolidatedSources.length))}${serverNames.length ? ` (${htmlEscape(serverNames.join(", "))})` : ""}</span>
  ${siteNamesList.length ? `<span class="meta-label">Websites:</span>        <span>${htmlEscape(siteNamesList.join(", "))}</span>` : ""}
  ${scanWindow ? `<span class="meta-label">Scan window:</span>     <span>${htmlEscape(scanWindow)}</span>` : ""}
  ${consolidatedAt ? `<span class="meta-label">Consolidated at:</span> <span>${htmlEscape(consolidatedAt)}</span>` : ""}`;
  } else {
    titleSuffix = siteName !== "" ? siteName : serverName;
    metaGridHtml = `
  ${siteName !== "" ? `<span class="meta-label">Website:</span>      <span>${htmlEscape(siteName)}</span>` : ""}
  <span class="meta-label">Server:</span>      <span>${htmlEscape(serverName)}</span>
  <span class="meta-label">IP:</span>           ${copyableMetaCell(serverIp, null, "IP address")}
  <span class="meta-label">Hostname:</span>     ${copyableMetaCell(hostname, null, "hostname")}
  <span class="meta-label">Scanned path:</span> ${copyableMetaCell(scannedPath, null, "scanned path")}
  <span class="meta-label">Scanned at:</span>   ${copyableMetaCell(scannedAt, null, "scan timestamp")}
  ${publicUrlBase !== "" ? `<span class="meta-label">Public URL:</span>   ${copyableMetaCell(publicUrlBase, `<a href="${htmlEscape(publicUrlBase)}" target="_blank" rel="noopener noreferrer">${htmlEscape(publicUrlBase)}</a>`, "public URL")}` : ""}`;
  }

  // ── embed data as JSON for client-side search/sort ────────────────────────────
  // The JSON sits in a separate <script type="application/json"> block, so we
  // never need to worry about JS string-literal escaping (single quotes from PDF
  // date metadata like 'D:20250207-08'00'' previously broke the IIFE silently).
  // We still escape </script> sequences to prevent premature script-tag termination.
  const jsonData = JSON.stringify(
    entries.map((entry) => buildRowValues({ entry, sourceHeader, sourceMap, isConsolidated }))
  ).replace(/<\/script/gi, "<\\/script");

  // ── hero block (v1.7.0 manager-friendly rollup redesign, decision D7) ────────
  // Replaces the top <h1> with the same "infographic" pattern used by the index
  // card (Q5 Variant 1): nickname -> big full name -> two-up tiles (total +
  // audit) -> donut on its own row -> plain-English caption. All values are
  // pre-computed here; the template literal below just interpolates them.
  // CSS for these `dp-*` classes lands in Task 6 of the plan.
  const heroTotal = totalFiles;
  const heroAudit = remediableCount;
  const heroPctRaw = heroTotal > 0 ? (heroAudit / heroTotal) * 100 : 0;
  const heroPct = Math.round(heroPctRaw * 10) / 10;
  const heroPctInt = Math.round(heroPctRaw);
  let heroPhrase;
  if (heroTotal === 0)             heroPhrase = "No files inventoried";
  else if (heroPctInt === 0)       heroPhrase = "No files may need audit";
  else if (heroPctInt <= 12)       heroPhrase = "A small share may need audit";
  else if (heroPctInt <= 28)       heroPhrase = "About a quarter may need audit";
  else if (heroPctInt <= 42)       heroPhrase = "About a third may need audit";
  else if (heroPctInt <= 58)       heroPhrase = "About half may need audit";
  else if (heroPctInt <= 72)       heroPhrase = "Two-thirds may need audit";
  else if (heroPctInt <= 88)       heroPhrase = "Most may need audit";
  else                              heroPhrase = "Nearly all may need audit";
  const heroTitle = htmlEscape(siteFullName || siteName || "filecap inventory report");
  const heroNick = htmlEscape(siteName ?? "");

  // Access-method panel: shown when web-rollup passes an accessKind. Tells a
  // manager/remediator at a glance how the site's files are served + what
  // credentials are needed to reach them. The index card carries the chip
  // version; this is the verbose treatment with the SSH-key + Contact IDS
  // call-to-action that the chip can't fit.
  const accessCopy = accessKind && ACCESS_PANEL_COPY[accessKind] ? ACCESS_PANEL_COPY[accessKind] : null;
  const accessPanelHtml = accessCopy
    ? `<section class="access-panel access-${accessKind}" aria-labelledby="access-panel-heading">
  <div class="access-panel-eyebrow">How to access this site's files</div>
  <h2 class="access-panel-heading" id="access-panel-heading">${htmlEscape(accessCopy.label)}</h2>
  <p class="access-panel-method">${htmlEscape(accessCopy.method)}</p>
  <p class="access-panel-credential"><strong>${htmlEscape(accessCopy.credential)}</strong> ${htmlEscape(accessCopy.action)}</p>
</section>`
    : "";

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
  background: #0d1117;
  margin: 0;
  padding: 1rem 1.5rem;
}
.report-back-bar {
  /* Sticky bar at the top of every per-site detail page. Two actions:
     back-to-fleet on the left (when bundled), download CSV on the right
     (always useful — the HTML shows the basics, the CSV is what people
     do real work in). Negative margin breaks out of body padding so the
     bar spans the full viewport width. */
  position: sticky;
  top: 0;
  z-index: 100;
  background: #161b22;
  border-bottom: 1px solid #21262d;
  padding: 0.55rem 1.5rem;
  margin: -1rem -1.5rem 1rem -1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.report-back-link {
  display: inline-block;
  color: #58a6ff;
  text-decoration: none;
  font-weight: 600;
  font-size: 0.95rem;
  padding: 0.25rem 0.5rem;
  margin-left: -0.5rem;
  border-radius: 3px;
  transition: background 120ms ease;
}
.report-back-link:hover { background: rgba(88,166,255,0.08); text-decoration: underline; }
.report-back-link:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
  background: rgba(88,166,255,0.08);
}
.report-csv-link {
  /* CSV is the real deliverable — render the link as a prominent button
     so it reads as a primary action, not an afterthought. */
  display: inline-block;
  background: #1f6feb;
  color: #ffffff !important;
  text-decoration: none;
  font-weight: 600;
  font-size: 0.95rem;
  padding: 0.4rem 0.9rem;
  border-radius: 4px;
  border: 1px solid #1f6feb;
  transition: background 120ms ease;
}
.report-csv-link:hover { background: #388bfd; text-decoration: none; }
.report-csv-link:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
}
h1 { font-size: 1.4rem; margin: 0 0 0.25rem; color: #e5e5e5; letter-spacing: -0.02em; }
h2 { font-size: 1.1rem; margin: 1.25rem 0 0.5rem; color: #e5e5e5; font-weight: 600; }
p { margin: 0 0 0.5rem; }
a { color: #60a5fa; text-decoration: none; }
a:hover { color: #93c5fd; text-decoration: underline; }

/* ─── Detail-page hero block v1.7.0 ─── */
.dp-hero {
  margin: 0 0 28px;
  padding: 30px 32px 26px;
  background: linear-gradient(180deg, #18202b 0%, #141a23 100%);
  border: 1px solid #2a323d;
  border-radius: 22px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.32);
  color: #e5e5e5;
}
.dp-hero .dp-nickname {
  margin: 0 0 6px;
  font-size: 0.82em;
  font-weight: 800;
  color: #c0cdda;
  letter-spacing: 0.10em;
  text-transform: uppercase;
}
.dp-hero .dp-title {
  margin: 0 0 22px;
  font-size: 2.6em;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: #ffffff;
  line-height: 1.12;
}
.dp-hero .dp-nums {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin: 0 0 22px;
}
.dp-hero .dp-tile {
  padding: 22px 14px;
  border-radius: 16px;
  text-align: center;
}
.dp-hero .dp-tile.dp-total { background: rgba(77, 171, 247, 0.10); }
.dp-hero .dp-tile.dp-audit { background: rgba(255, 168, 77, 0.13); }
.dp-hero .dp-tile .dp-num {
  font-size: 4em;
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  display: block;
}
.dp-hero .dp-tile.dp-total .dp-num { color: #4dabf7; }
.dp-hero .dp-tile.dp-audit .dp-num { color: #ffa84d; }
.dp-hero .dp-tile .dp-lbl {
  display: block;
  margin-top: 8px;
  font-size: 0.82em;
  color: #9aa5b1;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.dp-hero .dp-donut-row {
  display: flex; align-items: center; justify-content: center;
  gap: 22px;
}
.dp-hero .dp-donut {
  width: 150px; height: 150px;
  border-radius: 50%;
  /* --pct is emitted with a "%" suffix. CSS calc() cannot multiply two
     percentages, so we use the var directly as a percentage stop. */
  background: conic-gradient(
    #ffa84d 0 var(--pct, 0%),
    rgba(77, 171, 247, 0.45) var(--pct, 0%) 100%
  );
  display: flex; align-items: center; justify-content: center;
  position: relative;
  flex: none;
}
.dp-hero .dp-donut::after {
  content: "";
  position: absolute;
  inset: 16px;
  background: #141a23;
  border-radius: 50%;
}
.dp-hero .dp-donut .dp-pct {
  position: relative; z-index: 1;
  font-weight: 900;
  font-size: 1.7em;
  color: #ffa84d;
  line-height: 1;
  text-align: center;
}
.dp-hero .dp-donut .dp-pct small {
  display: block;
  font-size: 0.42em;
  color: #9aa5b1;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 4px;
}
.dp-hero .dp-donut-caption {
  margin: 0;
  color: #9aa5b1;
  font-size: 1em;
}
.dp-hero .dp-donut-caption strong { color: #ffffff; }

@media (max-width: 720px) {
  .dp-hero .dp-nums { grid-template-columns: 1fr; }
  .dp-hero .dp-tile .dp-num { font-size: 3em; }
  .dp-hero .dp-donut-row { flex-direction: column; }
  .dp-hero .dp-title { font-size: 2em; }
}

/* ── access-method panel (v1.7.6) ────────────────────────────
   Verbose treatment of the index card's access chip. Tells a
   manager or remediator how the site's files are served + what
   credentials are required to reach them (OpenSSH key for the
   server/Strapi cases, GitHub org access for the repo case).
   Three variants share the same layout; the left border + heading
   color make the access category visually obvious.
*/
.access-panel {
  margin: 1.2rem 0 1.6rem;
  padding: 1.1rem 1.3rem 1.15rem 1.55rem;
  border-radius: 12px;
  background: linear-gradient(180deg, #151c26 0%, #121821 100%);
  border: 1px solid #232a35;
  border-left: 6px solid currentColor;
  color: #c0cdda;
}
.access-panel .access-panel-eyebrow {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: #9aa5b1;
  margin: 0 0 0.35rem;
}
.access-panel .access-panel-heading {
  margin: 0 0 0.55rem;
  font-size: 1.45rem;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: currentColor;
}
.access-panel .access-panel-method {
  margin: 0 0 0.5rem;
  font-size: 0.95rem;
  line-height: 1.55;
  color: #d4dae0;
}
.access-panel .access-panel-credential {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.55;
  color: #d4dae0;
}
.access-panel .access-panel-credential strong { color: #ffffff; }
/* Per-variant accent. The text inside the panel stays neutral light grey
   for AA contrast; only the heading + left border use the brand color. */
.access-panel.access-strapi { color: #7dd3fc; }
.access-panel.access-github { color: #c4b5fd; }
.access-panel.access-server { color: #fcd34d; }

@media (max-width: 720px) {
  .access-panel { padding: 1rem 1.1rem 1.05rem 1.2rem; }
  .access-panel .access-panel-heading { font-size: 1.2rem; }
}

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

/* v1.7.7 — copy-to-clipboard buttons on the right edge of select meta-grid
   values (IP, hostname, scanned path, scanned at, public URL). Designed
   for remediators who need to paste these into a terminal or browser
   without text-selecting monospace text by hand. */
.meta-value {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}
.meta-value > a { word-break: break-all; }
.meta-copy {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  width: 24px;
  height: 22px;
  padding: 0;
  background: transparent;
  border: 1px solid #2a323d;
  border-radius: 4px;
  color: #9aa5b1;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.78rem;
  line-height: 1;
  transition: background 100ms ease, color 100ms ease, border-color 100ms ease, width 140ms ease;
  overflow: hidden;
  vertical-align: middle;
}
.meta-copy:hover {
  background: rgba(88, 166, 255, 0.10);
  color: #58a6ff;
  border-color: #58a6ff;
}
.meta-copy:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
}
.meta-copy.copied {
  width: 64px;
  color: #66d9a3;
  border-color: #66d9a3;
  background: rgba(102, 217, 163, 0.10);
}
.meta-copy-icon { width: 13px; height: 13px; flex: none; }
.meta-copy-feedback {
  display: none;
  font-weight: 700;
  font-size: 0.74rem;
  letter-spacing: 0.04em;
}
.meta-copy.copied .meta-copy-icon { display: none; }
.meta-copy.copied .meta-copy-feedback { display: inline; }

/* ── summary cards ─────────────────────────────────────────── */
.summary-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.card {
  background: #161b22;
  border: 1px solid #21262d;
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
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 6px;
}

.chip {
  display: inline-block;
  padding: 0.4em 0.9em;
  border: 1px solid #30363d;
  border-radius: 999px;
  background: #0d1117;
  color: #e5e5e5;
  cursor: pointer;
  font-size: 0.9em;
  font-family: inherit;
  transition: background 150ms ease-out, border-color 150ms ease-out;
}

.chip:hover {
  border-color: #60a5fa;
  background: #161b22;
}

.chip-active {
  background: #60a5fa;
  color: #0d1117;
  border-color: #60a5fa;
  font-weight: 600;
}

.chip-warn {
  border-color: #fbbf24;
  color: #fbbf24;
}
.chip-warn:hover {
  background: #1a1400;
  border-color: #fbbf24;
}
.chip-warn.chip-active {
  background: #fbbf24;
  color: #0d1117;
  border-color: #fbbf24;
}
.chip-warn.chip-active:hover {
  background: #fcd34d;
  border-color: #fcd34d;
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
  border: 1px solid #30363d;
  border-radius: 4px;
  font-size: 13px;
  width: 320px;
  background: #161b22;
  color: #e5e5e5;
}
.controls input[type="search"]::placeholder { color: #666666; }
.controls input[type="search"]:focus {
  outline: 2px solid #60a5fa;
  outline-offset: 1px;
}
#row-count { font-size: 12px; color: #999999; }

/* ── table wrapper (v1.7.2: scrolls both axes, touch-friendly) ──────────── */
.table-wrap {
  /* 'overflow: auto' activates BOTH axes - horizontal for wide tables, and
     vertical so the file table is bounded by a scrollable pane instead of
     pushing the page footer hundreds of viewport-heights down. Per CSS spec,
     'overflow-x: auto' alone leaves 'overflow-y: visible', which combined
     with max-height would clip rather than scroll. Explicit 'auto' here
     fixes that. */
  overflow: auto;
  border: 1px solid #21262d;
  border-radius: 4px;
  max-height: 75vh;
  /* Momentum scrolling on iOS; touch-action lets the browser handle native
     two-finger / single-finger pan in both axes without delay. */
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x pan-y;
  overscroll-behavior: contain;
  /* Drag-to-pan affordance for mouse users; touch panning is native. */
  cursor: grab;
}
.table-wrap.is-panning {
  cursor: grabbing;
  user-select: none;
}
.table-wrap.is-panning * {
  user-select: none !important;
}

/* ── scrollable container (alias for table-wrap) ───────────── */
.table-scroll {
  /* v1.7.2: same dual-axis scroll + touch behaviour as .table-wrap so any
     non-file-table data (category breakdown, etc.) is equally touch-pannable. */
  overflow: auto;
  width: 100%;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x pan-y;
  overscroll-behavior: contain;
}

/* ── sticky first column ───────────────────────────────────── */
.table-wrap th:first-child,
.table-wrap td:first-child {
  position: sticky;
  left: 0;
  background: #0d1117;
  z-index: 1;
  border-right: 1px solid #21262d;
}

.table-wrap thead th:first-child {
  background: #161b22;
  z-index: 2;
}

/* ── data table ────────────────────────────────────────────── */
table {
  border-collapse: collapse;
  /* v1.7.3: switched to table-layout: fixed so the user can click-and-drag
     the right edge of any <th> to resize that column. Widths are read from
     the emitted <colgroup>; the table width adapts to the sum of column
     widths so the parent .table-wrap can scroll horizontally as columns
     expand. */
  table-layout: fixed;
  width: max-content;
  min-width: 100%;
  font-size: 12px;
}
thead {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #161b22;
}
thead th {
  position: relative;          /* anchor for .col-resize-handle */
  padding: 0.45rem 0.65rem;
  text-align: left;
  white-space: nowrap;
  border-bottom: 2px solid #21262d;
  cursor: pointer;
  user-select: none;
  color: #e5e5e5;
  overflow: hidden;            /* clip the header label when col is narrow */
  text-overflow: ellipsis;
}
/* v1.7.3: column-resize handle on the right edge of each header cell.
   8px wide hit zone (touch-friendly), 2px visual indicator on hover. */
.col-resize-handle {
  position: absolute;
  top: 0; right: 0;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  user-select: none;
  z-index: 3;
  touch-action: none;          /* let pointer events drive the resize */
}
.col-resize-handle::after {
  content: "";
  position: absolute;
  top: 4px; bottom: 4px; right: 3px;
  width: 2px;
  background: transparent;
  border-radius: 1px;
  transition: background 120ms ease;
}
.col-resize-handle:hover::after,
.col-resize-handle.is-active::after {
  background: #4dabf7;
}
.table-wrap.is-resizing,
.table-wrap.is-resizing * {
  cursor: col-resize !important;
  user-select: none !important;
}
thead th:hover { background: #1a1a1a; }
thead th.sort-asc::after  { content: " ▲"; font-size: 10px; color: #60a5fa; }
thead th.sort-desc::after { content: " ▼"; font-size: 10px; color: #60a5fa; }
tbody tr:nth-child(even) { background: #0c0c0c; }
tbody tr:nth-child(odd)  { background: #0d1117; }
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

/* ── row-marker legend (immediately above the table) ─────────── */
.row-marker-legend {
  background: #161b22;
  border: 1px solid #21262d;
  border-left: 4px solid #fbbf24;
  border-radius: 4px;
  padding: 0.8rem 1rem 0.7rem 1rem;
  margin: 0.5rem 0 1rem 0;
  font-size: 13px;
  line-height: 1.5;
}
.row-marker-legend h3 {
  margin: 0 0 0.4rem 0;
  font-size: 0.96rem;
  font-weight: 600;
  color: #e5e5e5;
}
/* v1.7.11 — proper 3-column table layout. Pre-v1.7.11 the legend was a
   two-line flex block where the description text wrapped under itself
   under the swatch, leading to ragged paragraphs with awkward line breaks
   like "it ... or matches a default scanner output pattern like" wrapping
   in three places. The table separates "marker / what it means / what to
   do" into clean columns. */
.row-marker-table {
  /* The global "table { table-layout: fixed; width: max-content }" rule
     above is for the file-inventory table (drag-to-resize columns). The
     legend table needs auto layout + 100% width so the marker column
     shrinks to its content and the meaning/action columns absorb the rest. */
  table-layout: auto;
  width: 100%;
  border-collapse: collapse;
  margin: 0.4rem 0 0;
  color: #c9d1d9;
  font-size: 13px;
  line-height: 1.5;
}
.row-marker-table colgroup .rmt-col-marker  { width: 26%; }
.row-marker-table colgroup .rmt-col-meaning { width: 37%; }
.row-marker-table colgroup .rmt-col-action  { width: 37%; }
.row-marker-table thead th {
  text-align: left;
  font-weight: 700;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #9aa5b1;
  padding: 0.45rem 0.85rem;
  border-bottom: 1px solid #21262d;
}
.row-marker-table tbody th,
.row-marker-table tbody td {
  vertical-align: top;
  padding: 0.7rem 0.85rem;
  text-align: left;
  border-bottom: 1px solid #21262d;
  font-weight: normal;
}
.row-marker-table tbody tr:last-child th,
.row-marker-table tbody tr:last-child td {
  border-bottom: 0;
}
.row-marker-table tbody th {
  white-space: normal;
  color: #e5e5e5;
  font-weight: 600;
  width: 1%; /* shrink-to-content; the meaning + action cols absorb the rest */
}
.row-marker-table .rmt-marker-name {
  display: inline-block;
  margin-left: 0.45rem;
  vertical-align: middle;
  white-space: nowrap;
}
.row-marker-table code {
  background: #0d1117;
  padding: 0.05em 0.4em;
  border-radius: 3px;
  font-size: 0.92em;
}
.row-marker-table em { font-style: italic; color: #e5e5e5; }
.row-marker-swatch {
  display: inline-block;
  flex-shrink: 0;
  width: 1.5em;
  height: 1.5em;
  vertical-align: middle;
  border-radius: 2px;
}
.row-marker-flagged {
  /* Mirror the actual yellow left border on flagged rows. */
  border-left: 3px solid #fbbf24;
  background: #0d1117;
}
.row-marker-imageonly {
  /* Mirror the actual image-only row tint. */
  background: #111000;
  border: 1px solid #1a1400;
}
/* On narrow viewports, collapse the table to a stacked layout so cells
   don't squeeze each other into single-character columns. */
@media (max-width: 700px) {
  .row-marker-table,
  .row-marker-table thead,
  .row-marker-table tbody,
  .row-marker-table tr,
  .row-marker-table th,
  .row-marker-table td { display: block; }
  .row-marker-table thead { display: none; }
  .row-marker-table tbody tr {
    border-bottom: 1px solid #21262d;
    padding: 0.5rem 0;
  }
  .row-marker-table tbody tr:last-child { border-bottom: 0; }
  .row-marker-table tbody th,
  .row-marker-table tbody td {
    border-bottom: 0;
    padding: 0.35rem 0;
    width: auto;
  }
  .row-marker-table .rmt-marker-name { white-space: normal; }
}

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
  border-top: 1px solid #21262d;
  padding-top: 0.5rem;
}

/* ── primary / secondary filter bars ───────────────────────── */
.filter-bar-primary .chip { font-weight: 600; }
.filter-bar-secondary { margin-top: 0.25em; background: transparent; border: none; font-size: 0.95em; }
.filter-bar-secondary .chip { font-size: 0.85em; }

/* ── audit-stats two-column summary ────────────────────────── */
.audit-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 1em; margin: 1em 0; }
.stat-card { padding: 1em; border-radius: 8px; border: 1px solid; background: #161b22; }
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
  .report-back-bar { display: none; }
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

${(backHref || csvHref) ? `<nav class="report-back-bar" aria-label="Report navigation">
  ${backHref ? `<a class="report-back-link" href="${htmlEscape(backHref)}">
    <span aria-hidden="true">&larr;</span> Back to fleet index
  </a>` : '<span></span>'}
  ${csvHref ? `<a class="report-csv-link" href="${htmlEscape(csvHref)}" download>
    <span aria-hidden="true">&#x2913;</span> Download spreadsheet (CSV)
  </a>` : ''}
</nav>` : ""}
<header class="dp-hero">
  ${heroNick ? `<p class="dp-nickname">${heroNick}</p>` : ""}
  <h1 class="dp-title">${heroTitle}</h1>
  <div class="dp-nums">
    <div class="dp-tile dp-total"><span class="dp-num">${heroTotal.toLocaleString()}</span><span class="dp-lbl">total files</span></div>
    <div class="dp-tile dp-audit"><span class="dp-num">${heroAudit.toLocaleString()}</span><span class="dp-lbl">may need audit</span></div>
  </div>
  <div class="dp-donut-row">
    <div class="dp-donut" style="--pct:${heroPct}%"><div class="dp-pct">${heroPctInt}%<small>may need audit</small></div></div>
    <p class="dp-donut-caption"><strong>${heroPhrase}</strong> &middot; ${heroAudit.toLocaleString()} of ${heroTotal.toLocaleString()} files</p>
  </div>
</header>

${accessPanelHtml}

<div class="meta-grid">${metaGridHtml}
</div>

<section class="audit-stats">
  <div class="stat-card remediable">
    <div class="stat-heading">Audit work</div>
    <div class="stat-number">${remediableCount}</div>
    <div class="stat-label">files may need remediation</div>
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

<aside class="row-marker-legend" role="note" aria-label="Row marker key">
  <h3>What are the colored row markers in the table?</h3>
  <table class="row-marker-table">
    <colgroup>
      <col class="rmt-col-marker">
      <col class="rmt-col-meaning">
      <col class="rmt-col-action">
    </colgroup>
    <thead>
      <tr>
        <th scope="col">Marker</th>
        <th scope="col">What it means</th>
        <th scope="col">What to do about it</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <th scope="row">
          <span class="row-marker-swatch row-marker-flagged" aria-hidden="true"></span>
          <span class="rmt-marker-name">Yellow vertical bar on the left edge of a row</span>
        </th>
        <td>The filename has been flagged for human review: it contains spaces, non-ASCII characters, more than 200 characters, or matches a default scanner output pattern like <code>Scan_20240115_001.pdf</code>.</td>
        <td>Often correlates with files that were OCR'd from paper. Worth a quick rename or close look before remediation.</td>
      </tr>
      <tr>
        <th scope="row">
          <span class="row-marker-swatch row-marker-imageonly" aria-hidden="true"></span>
          <span class="rmt-marker-name">Faint yellow row tint</span>
        </th>
        <td>The file is an <em>image-only PDF</em> — a scanned page with no text layer.</td>
        <td>May need OCR before it can be tagged for screen readers. Typically the most expensive remediation work — a vendor will price these higher than text-based PDFs.</td>
      </tr>
    </tbody>
  </table>
</aside>

<div class="table-wrap table-scroll">
  <table id="inventory-table" aria-label="File inventory">
    ${colgroupHtml}
    <thead><tr>${headerCells}</tr></thead>
    <tbody id="inventory-body">
${rowsHtml}
    </tbody>
  </table>
</div>

<footer>
  Generated by filecap v${htmlEscape(FILECAP_VERSION)} &mdash; ${htmlEscape(scannedAt)}
  &mdash; <a href="https://github.com/ICJIA/filecap-cli" target="_blank" rel="noopener noreferrer">filecap on GitHub</a>
  &mdash; <a href="https://github.com/ICJIA/filecap-cli/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">CHANGELOG</a>
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
      else if (activeFilter === "image-only") matchFilter = row.classList.contains("image-only");
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

/* ── click-and-drag horizontal pan ──────────────────────────────────────────
   Mouse: drag-to-pan with a 5px threshold so small clicks still trigger text
   selection. Once threshold is exceeded, takes pointer capture and pans.
   Touch: skipped — the browser's native overflow-x:auto handles touch
   scrolling (with momentum on iOS). */
(function() {
  const wrap = document.querySelector(".table-wrap");
  if (!wrap || typeof wrap.scrollBy !== "function") return;

  const PAN_THRESHOLD = 5;
  let start = null;
  let panning = false;

  wrap.addEventListener("pointerdown", function (e) {
    // Mouse only — touch is native, pen is fine to ignore
    if (e.pointerType !== "mouse") return;
    if (e.button !== 0) return;
    // Don't start drag on interactive children (links, buttons, sort headers, inputs)
    // or on the v1.7.3 column-resize handles.
    if (e.target.closest("a, button, input, select, [role='button'], [data-resize-handle]")) return;
    start = {
      x: e.clientX,
      scrollLeft: wrap.scrollLeft,
      pointerId: e.pointerId,
    };
  });

  wrap.addEventListener("pointermove", function (e) {
    if (!start || e.pointerId !== start.pointerId) return;
    const dx = e.clientX - start.x;
    if (!panning) {
      if (Math.abs(dx) < PAN_THRESHOLD) return;
      panning = true;
      wrap.classList.add("is-panning");
      try { wrap.setPointerCapture(e.pointerId); } catch (_) {}
      // Cancel any in-progress text selection caused by the initial click
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
})();

/* ── v1.7.3 column-resize: drag the right edge of any <th> to resize the
   column. Each handle has data-resize-handle and its <th> has data-col
   matching a <col data-col="..."> in the table's <colgroup>. We update the
   <col>'s style.width so the column actually resizes regardless of cell
   content (works because table-layout is fixed). Pointer events handle
   both mouse and touch. */
(function() {
  const wrap = document.querySelector(".table-wrap");
  if (!wrap) return;
  const table = wrap.querySelector("table");
  if (!table) return;
  const cols = Array.from(table.querySelectorAll("colgroup col"));
  if (cols.length === 0) return;
  const handles = wrap.querySelectorAll(".col-resize-handle");
  if (handles.length === 0) return;

  const MIN_WIDTH = 60;
  const colByName = new Map(cols.map((c) => [c.getAttribute("data-col"), c]));

  handles.forEach(function (handle) {
    let state = null;

    handle.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      const th = handle.parentElement;
      if (!th) return;
      const colName = th.getAttribute("data-col");
      const col = colByName.get(colName);
      if (!col) return;
      // Measure the column's CURRENT rendered width so the drag is relative
      // to whatever it is right now (initial 220px, or a previous resize).
      const startW = th.getBoundingClientRect().width;
      state = { startX: e.clientX, startW: startW, pointerId: e.pointerId, col: col };
      handle.classList.add("is-active");
      wrap.classList.add("is-resizing");
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      e.stopPropagation();
    });

    handle.addEventListener("pointermove", function (e) {
      if (!state || e.pointerId !== state.pointerId) return;
      const dx = e.clientX - state.startX;
      const newW = Math.max(MIN_WIDTH, state.startW + dx);
      state.col.style.width = newW + "px";
    });

    function endResize(e) {
      if (!state) return;
      if (e.pointerId !== undefined && e.pointerId !== state.pointerId) return;
      handle.classList.remove("is-active");
      wrap.classList.remove("is-resizing");
      try { handle.releasePointerCapture(state.pointerId); } catch (_) {}
      state = null;
    }
    handle.addEventListener("pointerup",     endResize);
    handle.addEventListener("pointercancel", endResize);

    // Prevent click from bubbling up to the <th> sort handler when the user
    // releases without dragging (a stationary click on the 8px handle is
    // still a "resize intent," not a sort intent).
    handle.addEventListener("click", function (e) { e.stopPropagation(); });
  });
})();

// v1.7.7 — meta-grid copy-to-clipboard handler. One delegated listener on
// document.body covers every copy button (no per-button wiring, works
// regardless of how many cells the report has). Visual confirmation: the
// button widens and swaps the icon for the word "Copied" for 1.4 s.
(function () {
  "use strict";
  function flashCopied(btn) {
    btn.classList.add("copied");
    if (btn._copiedTimer) clearTimeout(btn._copiedTimer);
    btn._copiedTimer = setTimeout(function () {
      btn.classList.remove("copied");
      btn._copiedTimer = null;
    }, 1400);
  }
  function fallbackCopy(text) {
    // Older browsers and some file:// loads don't expose navigator.clipboard.
    // Use a hidden textarea + execCommand("copy") which has worked since 2015
    // and degrades silently if the browser disallows it. (No worse than the
    // old behavior of select-by-hand.)
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  document.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest(".meta-copy") : null;
    if (!btn) return;
    e.preventDefault();
    var text = btn.getAttribute("data-copy");
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        flashCopied(btn);
      }).catch(function () {
        if (fallbackCopy(text)) flashCopied(btn);
      });
    } else {
      if (fallbackCopy(text)) flashCopied(btn);
    }
  });
})();
</script>

</body>
</html>`;

  await fs.writeFile(outputPath, html, "utf8");
}
