import fs from "node:fs/promises";
import { CSV_COLUMNS, formatPageCount } from "./csv.js";
import { buildPageList } from "./pages.js";
import { humanizeBytes } from "./format.js";
import { FILECAP_VERSION } from "../version.js";
import { fmtChicagoDate, fmtChicagoGeneratedAt } from "../util/time.js";
import { estimateRemediablePages, PAGE_ESTIMATES } from "../web/page-estimate.js";

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
 * 1.7.36 — Return the URL string only when it parses cleanly and its
 * scheme is http: or https:; otherwise return null. Used to gate every
 * `<a href="…">` emit site so a malicious value in sites.json or in
 * scanned entry data (e.g. `javascript:alert(1)`) can't produce a
 * clickable XSS-vector anchor. Fixes 2026-05-13 audit finding #2.
 *
 * Callers should emit a plain <span> instead of <a> when this returns
 * null, so the offending value still appears as text but isn't
 * clickable.
 */
function safeUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return String(url);
  } catch {
    return null;
  }
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
  // v1.7.40 — see csv.js buildPublicUrl for full rationale. All sites now
  // build the Public URL as publicUrlBase + entry.path so links land on
  // the deployed public site instead of github.com (which broke for
  // anyone without repo access).
  let base;
  let pathPrefix;
  if (isConsolidated) {
    const src = sourceMap.get(entry.serverName);
    base = src?.publicUrlBase ?? "";
    pathPrefix = src?.pathPrefix ?? "";
  } else {
    base = sourceHeader.metadata?.publicUrlBase ?? "";
    pathPrefix = sourceHeader.metadata?.pathPrefix ?? "";
  }
  if (base) {
    const cleanBase = base.replace(/\/+$/, "");
    const cleanPath = (entry.path ?? "").replace(/^\/+/, "");
    // v1.12.2: apply the site's pathPrefix (git sites such as the old ARI
    // Summit deploys serve files under /static), and percent-encode each
    // path segment so pre-CMS filenames with spaces produce valid URLs
    // instead of links that bounce to the SPA catch-all (the homepage).
    const cleanPrefix = pathPrefix
      ? "/" + String(pathPrefix).replace(/^\/+|\/+$/g, "")
      : "";
    const encodedPath = cleanPath.split("/").map(encodeURIComponent).join("/");
    return `${cleanBase}${cleanPrefix}/${encodedPath}`;
  }
  // Defensive fallback for legacy inventories missing publicUrlBase but
  // carrying an https:// absolutePath from an older audit-static.sh run.
  const ap = String(entry.absolutePath ?? "");
  if (/^https?:\/\//i.test(ap)) {
    return ap.replace("/tree/", "/blob/");
  }
  return "";
}

// v1.8.0: Build the Referenced cell. Three states:
//   undefined / null / non-array → empty cell (cross-references not run yet
//                                  or this entry's site doesn't support
//                                  reference discovery).
//   empty array []              → "No references found" muted chip — file is
//                                  orphaned, no known referrers in the fleet.
//   one or more entries         → comma-separated "Page N" anchor chips, each
//                                  linking to entry.references[N].pageUrl,
//                                  with the full URL surfaced via title on
//                                  hover. Anchors open in a new tab.
function buildReferencedCell(refs) {
  if (!Array.isArray(refs)) return "<td></td>";
  if (refs.length === 0) {
    return '<td><span class="no-refs">No references found</span></td>';
  }
  // 1.8.0-beta.5: working refs render as numbered "Page N" anchors; refs
  // whose pageUrl couldn't be resolved (no contentTypeRoute mapping for
  // their content type, missing slug, or unsafe scheme) render as an
  // explicit "no page URL" non-link chip with an informative tooltip
  // identifying the source (siteName / contentType / entryId). Previously
  // these rendered as a red "Page N" label that looked like a broken link.
  let pageNum = 0;
  const chips = refs.map((r) => {
    const url = r?.pageUrl ?? "";
    const safe = safeUrl(url);
    if (safe) {
      pageNum += 1;
      const escapedUrl = htmlEscape(safe);
      const anchor = `<a class="ref-link" href="${escapedUrl}" title="${escapedUrl}" target="_blank" rel="noopener noreferrer">Page ${pageNum}</a>`;
      // v1.10.0: tiny page-accessibility grade chip next to the anchor
      // when ref.pageAudit has been populated by `filecap audits
      // --enable-pages`. Answers the manager's "but is that page
      // accessible too?" question inline, without expanding the cell.
      return `${anchor}${buildPageAuditChip(r?.pageAudit)}`;
    }
    const sourceParts = [];
    if (r?.siteName) sourceParts.push(r.siteName);
    if (r?.contentType) sourceParts.push(r.contentType);
    if (r?.entryId !== null && r?.entryId !== undefined) sourceParts.push(`#${r.entryId}`);
    const tip = sourceParts.length > 0
      ? `Reference from ${sourceParts.join(" ")} — deployed page URL could not be resolved`
      : "Reference exists but deployed page URL could not be resolved";
    return `<span class="ref-link-bad" title="${htmlEscape(tip)}">no page URL</span>`;
  }).join(", ");
  return `<td>${chips}</td>`;
}

// v1.10.0: tiny chip rendered next to each "Page N" anchor when the
// page-audit pass has scored that URL via audit.icjia.app's axe-core
// endpoint. Three states:
//   - no audit data            → "" (page-audit pass didn't run)
//   - error from audit endpoint → muted "—" chip
//   - score                    → "(B)" small chip in the grade colour
function buildPageAuditChip(pa) {
  if (!pa || typeof pa !== "object") return "";
  // Tiny attribution after the chip — managers should know who scored the
  // page (axe-core via audit.icjia.app's Puppeteer renderer), distinct from
  // the WCAG/IITAA strict profile used for PDF audits. Same string on both
  // the error and success branches.
  const source = ` <small class="page-audit-source" title="Page accessibility graded by axe-core, run server-side via headless Chromium on audit.icjia.app">axe-core</small>`;
  if (pa.error) {
    return ` <span class="page-audit-chip page-audit-chip-error" title="${htmlEscape(`Page audit unavailable — ${pa.error}`)}">(—)</span>${source}`;
  }
  const grade = typeof pa.grade === "string" ? pa.grade : null;
  const score = typeof pa.score === "number" ? pa.score : null;
  if (!grade) return "";
  const cls = `page-audit-chip-${grade.toLowerCase()}`;
  const violationLabel =
    typeof pa.violationCount === "number"
      ? ` — ${pa.violationCount} violation${pa.violationCount === 1 ? "" : "s"}`
      : "";
  // 1.10.0 final: render as a non-clickable label, NOT a link. The grade
  // chip is the whole signal we want next to "Page N" — managers ask
  // "is that page accessible?" and the letter answers it. A clickable
  // page-report viewer was scoped out of audit.icjia.app's 1.10.0
  // release; only PDF audits get an "Open report" link. The tooltip
  // still shows the full score + violation count for hover.
  const tip = `Page accessibility: ${grade}${score !== null ? ` (${score})` : ""}${violationLabel}`;
  return ` <span class="page-audit-chip ${cls}" title="${htmlEscape(tip)}">(${htmlEscape(grade)})</span>${source}`;
}

// v1.9.0: Audit Report column cell. v1.10.2: combined with the report-link.
// v1.19.0: the grade chip + numeric score were removed — the
// audit.icjia.app scoring heuristic is still being refined, so the table
// no longer asserts a grade. The cell renders only an "Open report" anchor
// to audit.icjia.app/report/<id>; the score lives in that report. Non-PDF
// entries, missing audits, and audited PDFs with no report URL render an
// empty cell. audit.error renders an "Unavailable" chip.
function buildAuditScoreCell(audit) {
  if (!audit || typeof audit !== "object") return "<td></td>";
  if (audit.skipped) return "<td></td>";
  if (audit.error) {
    return `<td><span class="audit-grade audit-grade-error" title="${htmlEscape(audit.error)}">Unavailable</span></td>`;
  }
  if (typeof audit.score !== "number") return "<td></td>";
  const safeReport =
    typeof audit.reportUrl === "string" ? safeUrl(audit.reportUrl) : null;
  if (safeReport) {
    const escaped = htmlEscape(safeReport);
    return `<td><a class="audit-report-link" href="${escaped}" target="_blank" rel="noopener noreferrer" title="${escaped}">Open report</a></td>`;
  }
  return `<td></td>`;
}

// ── Page view (v1.13.0) — the transpose of the file table ───────────────────
// buildPageList() (pages.js) inverts the file entries into a list of pages;
// these helpers render the page table. `ctx` = { sourceHeader, sourceMap,
// isConsolidated } so buildPublicUrl can resolve each attached file's URL.

function buildPageFilesCell(page, ctx) {
  const files = page.files ?? [];
  if (files.length === 0) {
    return `<td data-count="0"><span class="no-refs">No files</span></td>`;
  }
  const chips = files
    .map((entry) => {
      const url = buildPublicUrl({ entry, ...ctx });
      const safe = safeUrl(url);
      const name = htmlEscape(entry.filename ?? entry.path ?? "");
      return safe
        ? `<a class="ref-link" href="${htmlEscape(safe)}" target="_blank" rel="noopener noreferrer" title="${htmlEscape(safe)}">${name}</a>`
        : `<span class="ref-link-bad">${name}</span>`;
    })
    .join(" ");
  return `<td data-count="${files.length}"><span class="page-file-count">${files.length}</span> ${chips}</td>`;
}

function buildPageRow(page, ctx) {
  const safePageUrl = safeUrl(page.pageUrl);
  // v1.15.3: the first column shows the page's own URL, not its CMS <title>.
  // Many CMS sites set every page's <title> to the same generic site name,
  // so a title column read identically on every row; the URL is the real,
  // distinct per-page identifier.
  const urlText = htmlEscape(safePageUrl || page.pageUrl || "(no URL)");
  let tag = "";
  if (page.fromSitemap) {
    tag = ` <span class="page-sitemap-tag" title="Listed in the site's sitemap; filecap found no files linked from this page.">sitemap</span>`;
  } else if (page.fromCms) {
    tag = ` <span class="page-cms-tag" title="A page from the site's CMS; filecap found no files linked from it.">cms</span>`;
  }
  const pageCell = safePageUrl
    ? `<td><a href="${htmlEscape(safePageUrl)}" target="_blank" rel="noopener noreferrer">${urlText}</a>${tag}</td>`
    : `<td>${urlText}${tag}</td>`;
  const typeCell = `<td>${htmlEscape(page.contentType || "—")}</td>`;
  return `<tr>${pageCell}${typeCell}${buildPageFilesCell(page, ctx)}</tr>`;
}

function buildPageViewSection(pages, ctx) {
  if (!pages || pages.length === 0) {
    return `<div id="page-view" hidden>
  <h2>Pages</h2>
  <p class="page-view-empty">Page view needs CMS reference data — the map of which pages link to which files. filecap extracts that from CMS sites (Strapi); this is a static (non-CMS) site, so file-to-page mapping isn't available for it. The <strong>File view</strong> above lists every file on the site.</p>
</div>`;
  }
  const rows = pages.map((p) => buildPageRow(p, ctx)).join("\n");
  return `<div id="page-view" hidden>
  <h2>Pages on this site</h2>
  <p class="page-view-note">One row per page. <strong>Files</strong> are the documents the page links to. Rows tagged <span class="page-sitemap-tag">sitemap</span> or <span class="page-cms-tag">cms</span> are pages with no files linked from them — sourced from the site's sitemap.xml and CMS respectively.</p>
  <nav class="paginator" aria-label="Page table pagination">
    <span class="pag-info" id="pv-page-info"></span>
    <span class="pag-controls">
      <label class="pag-size">Rows per page
        <select id="pv-page-size">
          <option value="25" selected>25</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </label>
      <button type="button" id="pv-pag-prev" class="pag-btn">&larr; Prev</button>
      <span class="pag-pages" id="pv-pag-pages"></span>
      <button type="button" id="pv-pag-next" class="pag-btn">Next &rarr;</button>
    </span>
  </nav>
  <div class="table-wrap table-scroll">
    <table id="page-table" aria-label="Page inventory">
      <thead><tr>
        <th data-sort="page">Page</th>
        <th data-sort="type">Content type</th>
        <th data-sort="files">Files</th>
      </tr></thead>
      <tbody id="page-body">
${rows}
      </tbody>
    </table>
  </div>
</div>`;
}

function buildRowValues({ entry, sourceHeader, sourceMap, isConsolidated }) {
  // v1.21.2 — serverIp + scannedPath are no longer surfaced (origin recon), so
  // their table cells render blank below. serverName + siteName stay.
  let serverName, siteName;
  if (isConsolidated) {
    serverName = entry.serverName;
    const src = sourceMap.get(entry.serverName);
    siteName = src?.siteName ?? "";
  } else {
    const m = sourceHeader.metadata;
    serverName = m.serverName;
    siteName = m.siteName ?? "";
  }

  const publicUrl = buildPublicUrl({ entry, sourceHeader, sourceMap, isConsolidated });

  const duplicateOf = entry.duplicateOf
    ? `${entry.duplicateOf.serverName}:${entry.duplicateOf.path}`
    : "";

  const raw = [
    serverName,
    siteName,
    "",
    publicUrl,
    // v1.8.0: placeholder for the Referenced column. The cell loop in
    // writeHtml() bypasses this value and renders entry.references[] as
    // anchor chips directly, so the placeholder is only here to keep array
    // indices aligned with CSV_COLUMNS positions. v1.8.0-beta.5: position
    // moved to be immediately after publicUrl.
    "",
    // v1.9.0: placeholder for the Audit Report column (single column as
    // of 1.10.2 — score chip + report link combined). Cell loop bypasses
    // this and renders entry.audit directly.
    "",
    entry.modifiedAt,
    "",
    entry.path,
    entry.absolutePath,
    entry.filename,
    // v1.20.0: pageCount slotted between filename and extension to match
    // CSV_COLUMNS. PDFs get a number; non-PDFs and unintrospected PDFs get "".
    formatPageCount(entry),
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
// Detail-page access-panel copy. v1.7.33: the `label` (panel headline)
// now matches the index-card chip's plain-English "For bulk file access"
// across all three site types. The per-type `method` / `credential` /
// `action` body still spells out the underlying specifics (Strapi rsync
// vs GitHub clone vs server rsync) because a remediator visiting this
// panel does need to know what credential to ask for. Keep in lock-step
// with ACCESS_CHIP_LABEL in src/web/index-page.js.
const ACCESS_PANEL_COPY = {
  strapi: {
    label: "For bulk file access",
    method: "Files are served by a Strapi CMS instance on a remote Linux host. To audit or remediate them you need to rsync the uploads directory over SSH.",
    credential: "An OpenSSH public key on the file server is required.",
    action: `Email Chris Schweda at <a href="mailto:christopher.schweda@illinois.gov">christopher.schweda@illinois.gov</a> — he's the sole authorizer for SSH and GitHub access at ICJIA, so emailing him directly is the fastest path.`,
  },
  github: {
    label: "For bulk file access",
    method: "Files live in an ICJIA-owned GitHub repository. To audit or remediate them you clone the repo and inspect the static asset directory.",
    credential: "A GitHub.com account with ICJIA organization access is required.",
    action: `Email Chris Schweda at <a href="mailto:christopher.schweda@illinois.gov">christopher.schweda@illinois.gov</a> — he's the sole authorizer for SSH and GitHub access at ICJIA, so emailing him directly is the fastest path.`,
  },
  server: {
    label: "For bulk file access",
    method: "Files are stored in a static directory on a remote Linux host (no CMS). To audit or remediate them you need to rsync the directory over SSH.",
    credential: "An OpenSSH public key on the file server is required.",
    action: `Email Chris Schweda at <a href="mailto:christopher.schweda@illinois.gov">christopher.schweda@illinois.gov</a> — he's the sole authorizer for SSH and GitHub access at ICJIA, so emailing him directly is the fastest path.`,
  },
};

export async function writeHtml({ sourceHeader, entries, sources, outputPath, backHref = null, csvHref = null, siteUrl = null, siteFullName = null, accessKind = null, sitemapUrls = [], cmsPages = [] }) {
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

  // v1.20.0: inclusive page-count estimate for the hero. PDFs contribute
  // their measured pdfjs page count; DOCX/PPTX/XLSX/legacy-office add
  // per-format averages (see src/web/page-estimate.js). Vendors quote
  // remediation per page, so the file count alone undersells the workload.
  const pdfPagesMeasured = entries
    .filter((e) => e.category === "pdf" && typeof e.introspection?.pageCount === "number")
    .reduce((s, e) => s + e.introspection.pageCount, 0);
  const remediablePages = estimateRemediablePages({
    pdfPagesMeasured,
    docxCount: officeCount,
    pptxCount: presentationCount,
    xlsxCount: spreadsheetCount,
    legacyOfficeCount: legacyCount,
  });
  const pagesTooltip = `≈${remediablePages.toLocaleString()} potential remediation pages. `
    + `${pdfPagesMeasured.toLocaleString()} measured PDF pages from pdfjs `
    + `+ DOCX×${PAGE_ESTIMATES.docx} (${officeCount}) `
    + `+ PPTX×${PAGE_ESTIMATES.pptx} (${presentationCount}) `
    + `+ XLSX×${PAGE_ESTIMATES.xlsx} (${spreadsheetCount}) `
    + `+ legacy Office×${PAGE_ESTIMATES.legacyOffice} (${legacyCount}). `
    + `Subject to change as files are added, edited, or removed.`;
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
  // v1.12.0: the HTML table shows only the columns a manager acts on. The CSV
  // (CSV_COLUMNS, 18 cols) stays the full forensic record; the HTML table is a
  // projection. buildRowValues() still returns the full value array (aligned to
  // the non-csvOnly CSV columns) — we pick the columns we want by name.
  const VALUE_COLUMNS = CSV_COLUMNS.filter((c) => !c.csvOnly);
  const valueIdxByName = (name) => VALUE_COLUMNS.findIndex((c) => c.name === name);
  // Single-site reports drop the Website column (the whole report is one site).
  // Consolidated multi-site reports prepend it so each row's site is identifiable.
  const HTML_TABLE_COLUMNS = [
    ...(isConsolidated ? [{ name: "siteName", label: "Website" }] : []),
    { name: "filename",    label: "File name" },
    // v1.20.0: Pages column. Right-aligned in CSS via td.col-pages. PDFs
    // render the integer; non-PDFs render blank.
    { name: "pageCount",   label: "Pages" },
    { name: "category",    label: "File type" },
    { name: "auditScore",  label: "Audit Report" },
    { name: "referenced",  label: "Page References" },
    { name: "duplicateOf", label: "Duplicate of" },
    { name: "modifiedAt",  label: "Date published" },
  ];
  const htmlColValueIdx = HTML_TABLE_COLUMNS.map((c) => valueIdxByName(c.name));
  const publicUrlVi = valueIdxByName("publicUrl");

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
    const publicUrl = values[publicUrlVi];
    const cells = HTML_TABLE_COLUMNS.map((col, i) => {
      const v = values[htmlColValueIdx[i]];
      if (col.name === "referenced") {
        return buildReferencedCell(entry.references);
      }
      if (col.name === "auditScore") {
        return buildAuditScoreCell(entry.audit);
      }
      if (col.name === "filename") {
        // File name text linked to the file's public URL. safeUrl() gates the
        // href so a bad scheme renders as plain text, not a live anchor.
        const safe = safeUrl(publicUrl);
        const txt = htmlEscape(v);
        return safe
          ? `<td class="col-filename"><a href="${htmlEscape(safe)}" target="_blank" rel="noopener noreferrer">${txt}</a></td>`
          : `<td class="col-filename">${txt}</td>`;
      }
      if (col.name === "category") {
        return `<td>${htmlEscape(formatCategory(v))}</td>`;
      }
      if (col.name === "pageCount") {
        // Empty cell for non-PDFs and unintrospected PDFs; otherwise the
        // raw integer, right-aligned. data-num so the sort comparator
        // (already in the table JS) treats it numerically.
        const numStr = v === "" || v === null || v === undefined ? "" : String(v);
        const data = numStr ? ` data-num="${numStr}"` : "";
        return `<td class="col-pages num"${data}>${htmlEscape(numStr)}</td>`;
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
  // v1.12.0: column-resize + drag-pan removed — the 6-column table fits without
  // horizontal panning, so there is no <colgroup>/resize-handle machinery.
  const headerCells = HTML_TABLE_COLUMNS.map((col) =>
    `<th data-col="${htmlEscape(col.name)}">${htmlEscape(col.label)}</th>`
  ).join("");

  // ── Page view (v1.13.0): invert the file entries into a page list ────────────
  const pageList = buildPageList(entries, sitemapUrls, cmsPages);
  const pageViewSectionHtml = buildPageViewSection(pageList, { sourceHeader, sourceMap, isConsolidated });
  const viewToggleHtml = `
<div class="view-toggle" role="group" aria-label="Switch report view">
  <div class="view-toggle-buttons">
    <button type="button" class="view-toggle-btn is-active" data-view="file" aria-pressed="true">File view</button>
    <button type="button" class="view-toggle-btn" data-view="page" aria-pressed="false">Page view</button>
  </div>
  <p class="view-toggle-blurb"><strong>File view</strong> (shown) lists every file and the pages that link to it. <strong>Page view</strong> flips it around — one row per page on the site, with the files it links to.</p>
</div>`;

  // ── server/scan metadata display ─────────────────────────────────────────────
  // Per-site reports pull from top-level metadata fields. Consolidated fleet
  // reports have a different shape — metadata.sources[] holds per-server info
  // and the top-level fields are absent. Branch the meta-grid render on that.
  const serverName = meta?.serverName ?? "";
  const siteName = meta?.siteName ?? "";
  // v1.21.2 — serverIp / hostname / scannedPath are no longer shown in the
  // meta-grid (origin-server recon a reader doesn't need); only the timestamp.
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
  <span class="meta-label">Scanned at:</span>   ${copyableMetaCell(fmtChicagoGeneratedAt(scannedAt) || scannedAt, null, "scan timestamp")}
  ${publicUrlBase !== "" ? (() => {
    // Gate the meta-grid Public URL row through safeUrl so a malicious
    // sites.json `siteUrl` (e.g. `javascript:…`) can't render as a
    // clickable anchor. Plain text is shown when the scheme is bad.
    const safe = safeUrl(publicUrlBase);
    const escaped = htmlEscape(publicUrlBase);
    const display = safe
      ? `<a href="${htmlEscape(safe)}" target="_blank" rel="noopener noreferrer">${escaped}</a>`
      : escaped;
    return `<span class="meta-label">Public URL:</span>   ${copyableMetaCell(publicUrlBase, display, "public URL")}`;
  })() : ""}`;
  }

  // ── embed data as JSON for client-side search/sort ────────────────────────────
  // The JSON sits in a separate <script type="application/json"> block, so we
  // never need to worry about JS string-literal escaping (single quotes from PDF
  // date metadata like 'D:20250207-08'00'' previously broke the IIFE silently).
  // We still escape </script> sequences to prevent premature script-tag termination.
  // v1.12.0: projected onto HTML_TABLE_COLUMNS so sort/search indices line up
  // with the visible headers.
  const jsonData = JSON.stringify(
    entries.map((entry) => {
      const values = buildRowValues({ entry, sourceHeader, sourceMap, isConsolidated });
      return htmlColValueIdx.map((vi) => values[vi]);
    })
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
  <p class="access-panel-credential"><strong>${htmlEscape(accessCopy.credential)}</strong> ${accessCopy.action}</p>
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
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%230d1117'/><path d='M12 9L12 23L23 16Z' fill='%23ffb000'/></svg>">
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
  font-size: 0.8rem;
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
     so it reads as a primary action, not an afterthought. v1.7.29: green
     CTA so the download button is visibly distinct from the two blue
     navbar buttons (FAQ + PDF Audit Tool) sitting next to it. Color
     register: download / get / "take this artefact away." */
  display: inline-block;
  background: linear-gradient(180deg, #1f7a30 0%, #176127 100%);
  color: #ffffff !important;
  text-decoration: none;
  font-weight: 700;
  font-size: 0.8rem;
  padding: 0.35rem 0.75rem;
  border-radius: 7px;
  border: 1px solid #1f7a30;
  transition: background 120ms ease, filter 120ms ease, transform 120ms ease;
  white-space: nowrap;
}
.report-csv-link:hover {
  filter: brightness(1.06);
  text-decoration: none;
  transform: translateY(-1px);
}
.report-csv-link:focus-visible {
  outline: 2px solid #3fb950;
  outline-offset: 2px;
}
/* v1.7.16: cluster of right-side actions in the sticky bar. v1.7.27:
   switched to align-items: flex-start so the two buttons (audit-tool +
   csv-link) line up on their TOP edges. Pre-v1.7.27 they were
   align-items: center, which centered the .audit-tool-link button on
   the .report-csv-block's vertical midpoint — but the csv-block is
   taller because it has the "Last audit: …" caption stacked below the
   button, so the csv-link button sat above the audit-tool button.
   Top-aligning both buttons puts them on the same baseline; the date
   caption hangs below the csv-link without pushing it around. */
.report-back-bar-right {
  display: flex;
  align-items: flex-start;
  gap: 0.85rem;
  flex-wrap: wrap;
}
.report-csv-block {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.2rem;
}
.report-csv-date {
  margin: 0;
  font-size: 0.78rem;
  color: #8b949e;
  letter-spacing: 0.02em;
}
.report-csv-date strong { color: #c9d1d9; font-weight: 700; }
/* Mirror of .audit-tool-link styling on the index page so the affordance
   reads the same across surfaces. v1.7.28: font dropped to 0.8rem
   (matched against the index navbar variant) to leave more horizontal
   room for the two-button cluster (FAQ + audit tool) on narrow viewports. */
.audit-tool-link {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.35rem 0.75rem;
  background: linear-gradient(180deg, #4dabf7 0%, #2f8de0 100%);
  color: #0c1219 !important;
  font-weight: 700;
  font-size: 0.8rem;
  letter-spacing: 0.01em;
  text-decoration: none;
  border-radius: 7px;
  border: 1px solid #2f8de0;
  transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
  white-space: nowrap;
}
.audit-tool-link:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(77, 171, 247, 0.35);
  filter: brightness(1.05);
  text-decoration: none;
}
.audit-tool-link:focus-visible {
  outline: 3px solid #58a6ff;
  outline-offset: 2px;
}
.audit-tool-icon { width: 14px; height: 14px; flex: none; }
@media (max-width: 600px) {
  .audit-tool-link { padding: 0.35rem 0.65rem; font-size: 0.82rem; }
  .audit-tool-link span { display: none; }
  .audit-tool-icon { width: 16px; height: 16px; }
}
h1 { font-size: 1.4rem; margin: 0 0 0.25rem; color: #e5e5e5; letter-spacing: -0.02em; }
h2 { font-size: 1.1rem; margin: 1.25rem 0 0.5rem; color: #e5e5e5; font-weight: 600; }
p { margin: 0 0 0.5rem; }
a { color: #60a5fa; text-decoration: none; }
a:hover { color: #93c5fd; text-decoration: underline; }

/* ─── Referenced column chips v1.8.0 ───
   The Referenced column shows comma-separated Page-N anchors, each linking
   to a page that references this file. Hover surfaces the full URL via
   title="…". The .no-refs muted chip marks files the cross-references
   resolver checked but found no referrers for (entry.references === []). */
.ref-link {
  display: inline-block;
  padding: 1px 6px;
  margin: 0 2px 2px 0;
  border-radius: 4px;
  background: #1f2a37;
  border: 1px solid #2e3b4d;
  color: #93c5fd;
  font-size: 0.85em;
  text-decoration: none;
  white-space: nowrap;
}
.ref-link:hover {
  background: #2a3a52;
  color: #bfdbfe;
  text-decoration: none;
}
.ref-link-bad {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  background: #2a1d1d;
  border: 1px solid #4d2e2e;
  color: #ff8888;
  font-size: 0.85em;
  font-style: italic;
}
.no-refs {
  color: #9aa5b1;
  font-style: italic;
  font-size: 0.9em;
}

/* ─── Audit Score + Audit Report chips v1.9.0 ───
   The Audit Score column renders a coloured grade chip + the numeric score
   in muted text alongside. Colours map to the strict-profile grade scale
   audit.icjia.app uses (A green → F red). The Audit Report column is a
   plain anchor to the persisted shareable report on audit.icjia.app. */
.audit-grade {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 700;
  font-size: 0.9em;
  min-width: 1.5em;
  text-align: center;
}
.audit-grade-a { background: rgba(34, 197, 94, 0.15);  color: #4ade80; border: 1px solid #166534; }
.audit-grade-b { background: rgba(20, 184, 166, 0.15); color: #5eead4; border: 1px solid #115e59; }
.audit-grade-c { background: rgba(234, 179, 8, 0.15);  color: #fde047; border: 1px solid #854d0e; }
.audit-grade-d { background: rgba(249, 115, 22, 0.15); color: #fdba74; border: 1px solid #9a3412; }
.audit-grade-f { background: rgba(239, 68, 68, 0.15);  color: #fca5a5; border: 1px solid #991b1b; }
.audit-grade-error {
  background: rgba(107, 114, 128, 0.15);
  color: #9ca3af;
  border: 1px solid #4b5563;
  font-style: italic;
  font-weight: 500;
}
.audit-score-num {
  color: #9aa5b1;
  font-size: 0.85em;
}
.audit-report-link {
  color: #6fbafd;
  font-size: 0.9em;
  text-decoration: none;
}
.audit-report-link:hover {
  color: #bfdbfe;
  text-decoration: underline;
}

/* ─── Page-audit grade chips v1.10.0 ───
   Rendered next to each "Page N" anchor in the Referenced column. Tiny
   parenthesised letter (A/B/C/D/F) in the same colour register as the
   file audit grades. When the chip carries a reportUrl, it itself is
   a clickable anchor — click to open the axe-core deep-dive on
   audit.icjia.app. */
.page-audit-chip {
  display: inline-block;
  font-size: 0.78em;
  font-weight: 700;
  padding: 0 4px;
  border-radius: 3px;
  text-decoration: none;
  vertical-align: baseline;
  margin-left: 2px;
}
a.page-audit-chip:hover {
  text-decoration: underline;
}
.page-audit-chip-a { color: #4ade80; background: rgba(34, 197, 94, 0.10);  border: 1px solid #166534; }
.page-audit-chip-b { color: #5eead4; background: rgba(20, 184, 166, 0.10); border: 1px solid #115e59; }
.page-audit-chip-c { color: #fde047; background: rgba(234, 179, 8, 0.10);  border: 1px solid #854d0e; }
.page-audit-chip-d { color: #fdba74; background: rgba(249, 115, 22, 0.10); border: 1px solid #9a3412; }
.page-audit-chip-f { color: #fca5a5; background: rgba(239, 68, 68, 0.10);  border: 1px solid #991b1b; }
.page-audit-chip-error {
  color: #9ca3af;
  background: rgba(107, 114, 128, 0.10);
  border: 1px solid #4b5563;
  font-style: italic;
}
.page-audit-source {
  font-size: 0.62em;
  color: #9aa5b1;
  margin-left: 2px;
  font-style: italic;
  letter-spacing: 0.02em;
  vertical-align: baseline;
}

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
.dp-hero .dp-tile .dp-sub {
  display: block;
  margin-top: 0.4em;
  font-size: 0.95em;
  font-weight: 600;
  color: #ffc888;
  letter-spacing: 0.02em;
  cursor: help;
  border-top: 1px dashed rgba(255,168,77,0.28);
  padding-top: 0.5em;
}
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

/* v1.20.0 — snapshot hedge underneath the donut. Subtle amber-left strip
   reminding remediators that page + file counts are a moment-in-time
   estimate, not a contractual figure. */
.dp-hero .dp-snapshot-note {
  margin: 1.4rem 0 0;
  padding: 0.7rem 0.9rem;
  background: rgba(255, 168, 77, 0.06);
  border-left: 3px solid #d97706;
  border-radius: 4px;
  color: #c9d1d9;
  font-size: 0.9em;
  line-height: 1.5;
}
.dp-hero .dp-snapshot-note strong { color: #ffc888; font-weight: 700; }

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
/* Inline prose links (e.g. the "Email Chris Schweda" contact) keep an
   underline so they are distinguished from the surrounding paragraph text by
   more than color alone — WCAG 1.4.1 (Use of Color). The global report link
   rule sets text-decoration:none for the chip/button-styled links, so this
   scoped rule restores it for links that sit inside body copy. */
.access-panel a { text-decoration: underline; }
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
  height: 24px;
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

/* ── v1.20.0: PDF page-count column. Right-aligned, tabular-nums so the
   digits line up across rows. Non-PDFs render a blank cell, so the column
   reads as a sparse stripe of numbers next to the filename. */
td.col-pages { text-align: right; font-variant-numeric: tabular-nums; color: #c0cdda; padding-right: 0.6em; }
th[data-col="pageCount"] { text-align: right; }

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
  /* v1.12.0: 6-column manager table — auto layout, full width, no resize. */
  table-layout: auto;
  width: 100%;
  font-size: 13px;
}
/* v1.15.3 — Page view table: a fixed 4-column layout. Under the default
   table-layout:auto the file-chip column (a long, unbreakable filename)
   claimed most of the width and the page-URL column collapsed to a sliver
   of vertically-wrapped text. Explicit widths give the URL column the room
   it needs; overflow-wrap lets long URLs and file names wrap inside their
   cells instead of forcing the column wider. */
#page-table { table-layout: fixed; }
#page-table th:nth-child(1), #page-table td:nth-child(1) { width: 52%; }
#page-table th:nth-child(2), #page-table td:nth-child(2) { width: 12%; }
#page-table th:nth-child(3), #page-table td:nth-child(3) { width: 36%; }
#page-table td { overflow-wrap: anywhere; vertical-align: top; }
/* The shared .ref-link chip is nowrap — right for the short "Page N" chips in
   the File view, but in the Page view the chips carry long file names. Let
   them wrap inside the fixed-width Files column instead of overflowing it. */
#page-table .ref-link { white-space: normal; }
thead {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #161b22;
}
thead th {
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
/* ── paginator (v1.12.0 — replaces click-and-drag panning) ──── */
.paginator {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.55rem 1rem;
  margin: 0.6rem 0;
  font-size: 13px;
  color: #c9d1d9;
}
.pag-info { font-weight: 600; }
.pag-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.pag-size { color: #9aa5b1; }
.pag-size select {
  background: #161b22;
  color: #e5e5e5;
  border: 1px solid #2e3b4d;
  border-radius: 4px;
  padding: 2px 5px;
  font-size: 13px;
  margin-left: 4px;
}
.pag-btn,
.pag-num {
  background: #1f2a37;
  color: #93c5fd;
  border: 1px solid #2e3b4d;
  border-radius: 4px;
  padding: 3px 9px;
  font-size: 13px;
  cursor: pointer;
}
.pag-btn:hover:not(:disabled),
.pag-num:hover { background: #2a3a52; color: #bfdbfe; }
.pag-btn:disabled { opacity: 0.4; cursor: default; }
.pag-num-active,
.pag-num-active:hover {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
  font-weight: 700;
}
.pag-pages { display: inline-flex; gap: 0.25rem; align-items: center; }
.pag-gap { color: #6b7280; padding: 0 1px; }

/* ── File / Page view toggle (v1.13.0) ──────────────────────── */
.view-toggle { margin: 1.2rem 0 0.5rem; }
.view-toggle-buttons {
  display: inline-flex;
  border: 1px solid #2e3b4d;
  border-radius: 6px;
  overflow: hidden;
}
.view-toggle-btn {
  background: #161b22;
  color: #c9d1d9;
  border: 0;
  padding: 8px 22px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.view-toggle-btn + .view-toggle-btn { border-left: 1px solid #2e3b4d; }
.view-toggle-btn:hover { background: #1f2a37; }
.view-toggle-btn.is-active { background: #2563eb; color: #fff; }
.view-toggle-blurb {
  margin: 0.5rem 0 0;
  font-size: 13px;
  color: #9aa5b1;
  max-width: 78ch;
  line-height: 1.5;
}
.view-toggle-blurb strong { color: #e5e5e5; }
.page-view-note,
.page-view-empty {
  font-size: 14px;
  color: #c9d1d9;
  line-height: 1.55;
  max-width: 78ch;
}
.page-view-empty {
  background: #161b22;
  border: 1px solid #21262d;
  border-left: 4px solid #4dabf7;
  border-radius: 4px;
  padding: 0.9rem 1.1rem;
}
.page-file-count {
  display: inline-block;
  min-width: 1.6em;
  font-weight: 700;
  color: #e5e5e5;
}
.page-sitemap-tag {
  display: inline-block;
  font-size: 0.72em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #9aa5b1;
  background: #1f2632;
  border: 1px solid #2e3b4d;
  border-radius: 3px;
  padding: 0 4px;
  vertical-align: middle;
}
.page-cms-tag {
  display: inline-block;
  font-size: 0.72em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #86b8a6;
  background: #18241f;
  border: 1px solid #2d4339;
  border-radius: 3px;
  padding: 0 4px;
  vertical-align: middle;
}
thead th:hover { background: #1a1a1a; }
thead th.sort-asc::after  { content: " ▲"; font-size: 10px; color: #60a5fa; }
thead th.sort-desc::after { content: " ▼"; font-size: 10px; color: #60a5fa; }
tbody tr:nth-child(even) { background: #0c0c0c; }
tbody tr:nth-child(odd)  { background: #0d1117; }
tbody tr:hover { background: #1a1a1a; }
td {
  padding: 0.4rem 0.7rem;
  border-bottom: 1px solid #1a1a1a;
  color: #e5e5e5;
  vertical-align: top;
  word-break: break-word;
}
td a { color: #60a5fa; }
td a:hover { color: #93c5fd; text-decoration: underline; }

/* ── row state classes ─────────────────────────────────────── */
/* v1.7.12 — image-only tint now applies across every cell of the row (not
   just the first cell) and is noticeably yellower so a manager scanning the
   table can see the flag at a glance. Pre-v1.7.12 the "tbody tr:nth-child(even)"
   striping rule above (specificity 0,1,2) outranked "tr.image-only" (0,1,1),
   so the row-level tint never won — only "tr.image-only td:first-child" (0,1,2,
   plus later in source order) rendered, leaving a barely-visible marker on the
   first column. New rules target "tbody tr.image-only td" (0,1,3) so the tint
   beats both the striping and the per-row backgrounds. */
tbody tr.image-only td { background: #3a2c08; }
tbody tr.image-only td:first-child { background: #4d3a0c; }
/* The default link blue (#60a5fa) only reaches ~4.3:1 on the lighter
   first-column amber tint (#4d3a0c) — under the 4.5:1 AA floor. Brighten
   filename links inside image-only rows to the hover blue, which clears
   6:1 on the first column and 7.5:1 on the rest. WCAG 1.4.3. */
tbody tr.image-only td a { color: #93c5fd; }
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
  /* v1.7.12 — mirror the new, more visible image-only row tint
     (tbody tr.image-only td background above). */
  background: #3a2c08;
  border: 1px solid #4d3a0c;
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
  color: #9aa5b1;
  border-top: 1px solid #21262d;
  padding-top: 0.5rem;
}
footer a { text-decoration: underline; }

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
.audit-total { text-align: center; margin: 0.5em 0 1em; font-size: 0.9em; color: #9aa5b1; }
@media (max-width: 720px) { .audit-stats { grid-template-columns: 1fr; } }

/* ── print ─────────────────────────────────────────────────── */
@media print {
  .report-back-bar { display: none; }
  body { background: #fff; color: #000; padding: 0; font-size: 10px; }
  h1, h2 { color: #000; }
  .controls { display: none; }
  .filter-bar { display: none; }
  .paginator { display: none; }
  .table-wrap { max-height: none; overflow: visible; border: 1px solid #ccc; }
  #inventory-body tr { display: table-row !important; }
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
<main>

${(() => {
  // v1.7.16: sticky nav now also surfaces the audit-tool button (visible on
  // every per-site + by-type detail page) and shows the last-audit date under
  // the CSV download so staff can tell whether their downloaded CSV is
  // current. The audit-tool button uses the same visual style as the index
  // navbar variant — managers see identical affordances across pages.
  const lastAuditIso = (isConsolidated ? meta?.consolidatedAt : meta?.scannedAt) ?? "";
  // 1.7.37 — Chicago time (DST-aware) so the date matches what an
  // ICJIA reader would call "today" rather than a UTC day boundary.
  const lastAuditFmt = fmtChicagoDate(lastAuditIso);
  return `<nav class="report-back-bar" aria-label="Report navigation">
  ${backHref ? `<a class="report-back-link" href="${htmlEscape(backHref)}">
    <span aria-hidden="true">&larr;</span> Back to fleet index
  </a>` : '<span></span>'}
  <div class="report-back-bar-right">
    <a class="audit-tool-link" href="https://accessibility.icjia.app" target="_blank" rel="noopener noreferrer" title="ICJIA accessibility FAQs (accessibility.icjia.app, opens in a new tab)">
      <svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="8" cy="8" r="6.5"/>
        <path d="M6 6.2a2 2 0 1 1 2.6 1.9c-0.5 0.2-0.6 0.5-0.6 0.9"/>
        <circle cx="8" cy="11.2" r="0.55" fill="currentColor"/>
      </svg>
      <span>ICJIA Accessibility FAQs</span>
    </a>
    <a class="audit-tool-link" href="https://audit.icjia.app" target="_blank" rel="noopener noreferrer" title="ICJIA PDF Audit Tool (audit.icjia.app, opens in a new tab)">
      <svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 3h-2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2"/>
        <path d="M9 2h5v5"/>
        <path d="M8 8l6-6"/>
      </svg>
      <span>ICJIA PDF Audit Tool</span>
    </a>
    ${csvHref ? `<div class="report-csv-block">
      <a class="report-csv-link" href="${htmlEscape(csvHref)}" download>
        <span aria-hidden="true">&#x2913;</span> Download spreadsheet (XLSX)
      </a>
      ${lastAuditFmt ? `<p class="report-csv-date">Last audit: <strong>${htmlEscape(lastAuditFmt)}</strong></p>` : ""}
    </div>` : ""}
  </div>
</nav>`;
})()}
<header class="dp-hero">
  ${heroNick ? `<p class="dp-nickname">${heroNick}</p>` : ""}
  <h1 class="dp-title">${heroTitle}</h1>
  <div class="dp-nums">
    <div class="dp-tile dp-total"><span class="dp-num">${heroTotal.toLocaleString()}</span><span class="dp-lbl">total files</span></div>
    <div class="dp-tile dp-audit"><span class="dp-num">${heroAudit.toLocaleString()}</span><span class="dp-lbl">may need audit</span>${remediablePages > 0 ? `<span class="dp-sub" title="${htmlEscape(pagesTooltip)}">≈ ${remediablePages.toLocaleString()} potential pages</span>` : ""}</div>
  </div>
  <div class="dp-donut-row">
    <div class="dp-donut" style="--pct:${heroPct}%"><div class="dp-pct">${heroPctInt}%<small>may need audit</small></div></div>
    <p class="dp-donut-caption"><strong>${heroPhrase}</strong> &middot; ${heroAudit.toLocaleString()} of ${heroTotal.toLocaleString()} files</p>
  </div>
  ${remediablePages > 0 ? `<p class="dp-snapshot-note"><strong>Snapshot as of ${htmlEscape(fmtChicagoDate(scannedAt) || "the latest scan")}.</strong> These counts are a point-in-time view — they may change as files are added, edited, or removed from the site.</p>` : ""}
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

<div class="file-view">
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
</div>
${viewToggleHtml}
<div class="file-view">
<nav class="paginator" aria-label="Table pagination">
  <span class="pag-info" id="page-info"></span>
  <span class="pag-controls">
    <label class="pag-size">Rows per page
      <select id="page-size">
        <option value="25" selected>25</option>
        <option value="50">50</option>
        <option value="100">100</option>
      </select>
    </label>
    <button type="button" id="pag-prev" class="pag-btn">&larr; Prev</button>
    <span class="pag-pages" id="pag-pages"></span>
    <button type="button" id="pag-next" class="pag-btn">Next &rarr;</button>
  </span>
</nav>
<div class="table-wrap table-scroll">
  <table id="inventory-table" aria-label="File inventory">
    <thead><tr>${headerCells}</tr></thead>
    <tbody id="inventory-body">
${rowsHtml}
    </tbody>
  </table>
</div>
</div>
${pageViewSectionHtml}
</main>

<footer>
  Generated by filecap v${htmlEscape(FILECAP_VERSION)} &mdash; ${htmlEscape(fmtChicagoGeneratedAt(scannedAt) || scannedAt)}
  &mdash; <a href="https://github.com/ICJIA/filecap-cli" target="_blank" rel="noopener noreferrer">filecap on GitHub</a>
  &mdash; <a href="https://github.com/ICJIA/filecap-cli/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">CHANGELOG</a>
  &mdash; <a href="sites.html">Sites</a>
  &mdash; <a href="accessibility.html">Accessibility</a>
</footer>

<script type="application/json" id="filecap-data">${jsonData}</script>
<script>
(function () {
  "use strict";

  // ── embedded data (column-parallel to the visible table headers) ────────────
  const data = JSON.parse(document.getElementById("filecap-data").textContent);

  const tbody = document.getElementById("inventory-body");
  const searchInput = document.getElementById("search");
  const rowCountEl = document.getElementById("row-count");
  const allRows = Array.from(tbody.querySelectorAll("tr"));
  // Row element -> its data array. Survives DOM re-ordering by sort.
  const rowData = new Map();
  allRows.forEach(function (row, i) { rowData.set(row, data[i] || []); });

  let activeFilter = "remediable";
  let activeCategory = "";
  const REMEDIABLE_CATS = ["pdf", "office-document", "spreadsheet", "presentation", "legacy-office"];

  // ── pagination state (v1.12.0 — replaces click-and-drag panning) ────────────
  let pageSize = 25;
  let currentPage = 1;
  let matched = [];  // matching <tr>, in current (sorted) DOM order

  const pageInfoEl = document.getElementById("page-info");
  const pagPrev = document.getElementById("pag-prev");
  const pagNext = document.getElementById("pag-next");
  const pagPagesEl = document.getElementById("pag-pages");
  const pageSizeSel = document.getElementById("page-size");

  function updateRowCount(visible) {
    if (!rowCountEl) return;
    rowCountEl.textContent = visible === allRows.length
      ? visible.toLocaleString() + " rows"
      : visible.toLocaleString() + " of " + allRows.length.toLocaleString() + " rows";
  }

  // Recompute the matching set in current DOM order (filter + category + search).
  function computeMatched() {
    const q = (searchInput ? searchInput.value.trim().toLowerCase() : "");
    matched = [];
    Array.from(tbody.children).forEach(function (row) {
      if (row.tagName !== "TR") return;
      const cat = row.dataset.category || "other";
      let matchFilter;
      if (activeFilter === "all") matchFilter = true;
      else if (activeFilter === "remediable") matchFilter = REMEDIABLE_CATS.indexOf(cat) >= 0;
      else if (activeFilter === "reference") matchFilter = REMEDIABLE_CATS.indexOf(cat) < 0;
      else if (activeFilter === "image-only") matchFilter = row.classList.contains("image-only");
      else matchFilter = true;
      const matchCategory = !activeCategory || cat === activeCategory;
      const rd = rowData.get(row);
      const matchSearch = !q || (rd && rd.some(function (v) {
        return v !== null && v !== undefined && String(v).toLowerCase().indexOf(q) >= 0;
      }));
      if (matchFilter && matchCategory && matchSearch) matched.push(row);
    });
  }

  // Show only the current page's slice of the matching set.
  function renderPage() {
    const total = matched.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, total);

    allRows.forEach(function (row) { row.style.display = "none"; });
    for (let i = startIdx; i < endIdx; i++) matched[i].style.display = "";

    updateRowCount(total);
    if (pageInfoEl) {
      pageInfoEl.textContent = total === 0
        ? "No matching files"
        : "Showing " + (startIdx + 1).toLocaleString() + "–" +
          endIdx.toLocaleString() + " of " + total.toLocaleString() + " files";
    }
    if (pagPrev) pagPrev.disabled = currentPage <= 1;
    if (pagNext) pagNext.disabled = currentPage >= totalPages;
    renderPageButtons(totalPages);
  }

  // Windowed page-number buttons: 1 ... (cur-1) cur (cur+1) ... last.
  function renderPageButtons(totalPages) {
    if (!pagPagesEl) return;
    pagPagesEl.textContent = "";
    if (totalPages <= 1) return;
    const want = [1, totalPages, currentPage, currentPage - 1, currentPage + 1];
    const pages = [];
    for (let p = 1; p <= totalPages; p++) {
      if (want.indexOf(p) >= 0) pages.push(p);
    }
    let prev = 0;
    pages.forEach(function (p) {
      if (p - prev > 1) {
        const gap = document.createElement("span");
        gap.className = "pag-gap";
        gap.textContent = "…";
        pagPagesEl.appendChild(gap);
      }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pag-num" + (p === currentPage ? " pag-num-active" : "");
      b.textContent = String(p);
      b.addEventListener("click", function () { currentPage = p; renderPage(); });
      pagPagesEl.appendChild(b);
      prev = p;
    });
  }

  // Re-derive matches then jump to page 1. Used by every filter/search change.
  function applyFilters() {
    computeMatched();
    currentPage = 1;
    renderPage();
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

  // ── paginator controls ───────────────────────────────────────────────────────
  if (pagPrev) pagPrev.addEventListener("click", function () { currentPage--; renderPage(); });
  if (pagNext) pagNext.addEventListener("click", function () { currentPage++; renderPage(); });
  if (pageSizeSel) pageSizeSel.addEventListener("change", function () {
    const n = parseInt(pageSizeSel.value, 10);
    if (!isNaN(n) && n > 0) pageSize = n;
    currentPage = 1;
    renderPage();
  });

  // ── sort ────────────────────────────────────────────────────────────────────
  const headers = Array.from(document.querySelectorAll("#inventory-table thead th"));
  let sortColIdx = -1;
  let sortAsc = true;

  function sortBy(colIdx, asc) {
    const pairs = allRows.map(function (row) {
      return { row: row, vals: rowData.get(row) || [] };
    });
    pairs.sort(function (a, b) {
      const av = a.vals[colIdx] == null ? "" : a.vals[colIdx];
      const bv = b.vals[colIdx] == null ? "" : b.vals[colIdx];
      const an = typeof av === "number" ? av : parseFloat(av);
      const bn = typeof bv === "number" ? bv : parseFloat(bv);
      let cmp;
      if (!isNaN(an) && !isNaN(bn)) cmp = an - bn;
      else cmp = String(av).localeCompare(String(bv));
      return asc ? cmp : -cmp;
    });
    pairs.forEach(function (p) { tbody.appendChild(p.row); });
  }

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
      sortBy(colIdx, sortAsc);
      applyFilters();
    });
  });

  // ── default sort: by Date published, descending (most recent first) ──────────
  const dateColIdx = headers.findIndex(function (th) { return th.dataset.col === "modifiedAt"; });
  if (dateColIdx >= 0) {
    sortColIdx = dateColIdx;
    sortAsc = false;
    headers[dateColIdx].classList.add("sort-desc");
    sortBy(dateColIdx, false);
  }

  // Initial paint.
  applyFilters();
})();

/* v1.12.0: click-and-drag pan + column-resize handlers removed. The trimmed
   6-column table fits without horizontal panning and is navigated with the
   paginator (see the IIFE above), so neither handler is needed — and the
   drag-pan handler was the source of links occasionally not registering a
   click. Native wheel/scrollbar/touch scrolling still works. */

/* v1.13.0 — File view / Page view toggle. The File view's controls and its
   table are two .file-view blocks; the toggle sits between them (directly
   above the table) and shows/hides both as a unit, vs #page-view. */
(function () {
  "use strict";
  var buttons = document.querySelectorAll(".view-toggle-btn");
  var fileViews = document.querySelectorAll(".file-view");
  var pageView = document.getElementById("page-view");
  if (!buttons.length || !fileViews.length || !pageView) return;
  buttons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var showPage = btn.getAttribute("data-view") === "page";
      fileViews.forEach(function (fv) { fv.hidden = showPage; });
      pageView.hidden = !showPage;
      buttons.forEach(function (b) {
        var on = b === btn;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    });
  });
})();

/* v1.13.0 — Page view table: column sort + paginator. Scoped to #page-table;
   the file table's paginator is a separate IIFE above. */
(function () {
  "use strict";
  var table = document.getElementById("page-table");
  var tbody = table ? table.querySelector("tbody") : null;
  if (!tbody) return;
  var allRows = Array.prototype.slice.call(tbody.children);
  var matched = allRows.slice();
  var pageSize = 25;
  var currentPage = 1;
  var pageInfo = document.getElementById("pv-page-info");
  var pagPrev = document.getElementById("pv-pag-prev");
  var pagNext = document.getElementById("pv-pag-next");
  var pagPages = document.getElementById("pv-pag-pages");
  var pageSizeSel = document.getElementById("pv-page-size");

  function renderPageButtons(totalPages) {
    if (!pagPages) return;
    pagPages.textContent = "";
    if (totalPages <= 1) return;
    var want = [1, totalPages, currentPage, currentPage - 1, currentPage + 1];
    var prev = 0;
    for (var p = 1; p <= totalPages; p++) {
      if (want.indexOf(p) < 0) continue;
      if (p - prev > 1) {
        var gap = document.createElement("span");
        gap.className = "pag-gap";
        gap.textContent = "…";
        pagPages.appendChild(gap);
      }
      var b = document.createElement("button");
      b.type = "button";
      b.className = "pag-num" + (p === currentPage ? " pag-num-active" : "");
      b.textContent = String(p);
      (function (target) {
        b.addEventListener("click", function () { currentPage = target; renderPage(); });
      })(p);
      pagPages.appendChild(b);
      prev = p;
    }
  }

  function renderPage() {
    var total = matched.length;
    var totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    var start = (currentPage - 1) * pageSize;
    var end = Math.min(start + pageSize, total);
    allRows.forEach(function (r) { r.style.display = "none"; });
    for (var i = start; i < end; i++) matched[i].style.display = "";
    if (pageInfo) {
      pageInfo.textContent = total === 0
        ? "No pages"
        : "Showing " + (start + 1).toLocaleString() + "–" + end.toLocaleString() +
          " of " + total.toLocaleString() + " pages";
    }
    if (pagPrev) pagPrev.disabled = currentPage <= 1;
    if (pagNext) pagNext.disabled = currentPage >= totalPages;
    renderPageButtons(totalPages);
  }

  function cellSortValue(row, idx) {
    var cell = row.children[idx];
    if (!cell) return "";
    if (cell.dataset.score !== undefined) return Number(cell.dataset.score);
    if (cell.dataset.count !== undefined) return Number(cell.dataset.count);
    return cell.textContent.trim().toLowerCase();
  }

  var headers = Array.prototype.slice.call(table.querySelectorAll("thead th"));
  headers.forEach(function (th, idx) {
    th.addEventListener("click", function () {
      var asc = th.dataset.dir !== "asc";
      th.dataset.dir = asc ? "asc" : "desc";
      headers.forEach(function (h) { h.classList.remove("sort-asc", "sort-desc"); });
      th.classList.add(asc ? "sort-asc" : "sort-desc");
      var rows = allRows.slice();
      rows.sort(function (a, b) {
        var av = cellSortValue(a, idx), bv = cellSortValue(b, idx);
        var cmp;
        if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
        else cmp = String(av).localeCompare(String(bv));
        return asc ? cmp : -cmp;
      });
      rows.forEach(function (r) { tbody.appendChild(r); });
      matched = Array.prototype.slice.call(tbody.children);
      currentPage = 1;
      renderPage();
    });
  });

  if (pagPrev) pagPrev.addEventListener("click", function () { currentPage--; renderPage(); });
  if (pagNext) pagNext.addEventListener("click", function () { currentPage++; renderPage(); });
  if (pageSizeSel) pageSizeSel.addEventListener("change", function () {
    var n = parseInt(pageSizeSel.value, 10);
    if (!isNaN(n) && n > 0) pageSize = n;
    currentPage = 1;
    renderPage();
  });

  renderPage();
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
