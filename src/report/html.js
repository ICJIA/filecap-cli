import fs from "node:fs/promises";
import { PLAUSIBLE_SNIPPET } from "../web/analytics.js";
import { CSV_COLUMNS, formatPageCount, formatRemediationScore } from "./csv.js";
import { buildPageList, attachCrossSiteFiles } from "./pages.js";
import { categorizeAuditError } from "./audit-errors.js";
import { humanizeBytes } from "./format.js";
import { fmtChicagoDate, fmtChicagoGeneratedAt } from "../util/time.js";
import { estimateRemediablePages, PAGE_ESTIMATES } from "../web/page-estimate.js";
import { renderSiteFooter, siteFooterCss } from "../web/site-footer.js";
import { paginatorNav } from "../web/paginator-nav.js";
import { helpNavLink, helpNavCss } from "../web/help-nav.js";
import { renderSiteAccessibilitySection } from "./site-accessibility-section.js";
import { escapeHtml as htmlEscape, safeUrl } from "../util/html.js";
import { REMEDIABLE_CATEGORIES, isScoreable, isUnscoreableDocument } from "../scanner/category.js";
import { copyableValue as copyableMetaCell } from "../util/html.js";
import { summarizeFileA11y, bandForScore, fileA11yCoverageText,
  fileA11yThinDataText, fileA11yGaugeHtml, fileA11yTrendChipHtml } from "./accessibility-band.js";

// v1.35.1: the per-page accessibility grade chip in the Page view is hidden
// (the fleet bundle is file-only). buildPageAuditChip + its CSS are kept
// dormant; set this to true to re-enable the inline page-accessibility grades.
const SHOW_PAGE_AUDIT_CHIP = false;

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
  // v1.39.0 — .doc/.xls/.ppt from new scans (old inventories keep the three
  // categories above for these files; both render fine).
  "legacy-office": "Legacy Office",
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
// (safeUrl moved to src/util/html.js — same semantics, one implementation)

// Small clipboard-outline icon used by the meta-grid copy buttons. Inline SVG
// (no external request, no font dependency) and stroke: currentColor so the
// hover/copied states can recolor it via CSS.

// (copyableMetaCell → src/util/html.js copyableValue — shared with the index)

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
      return SHOW_PAGE_AUDIT_CHIP ? `${anchor}${buildPageAuditChip(r?.pageAudit)}` : anchor;
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
  // release; every scored document gets an "Open report" link (the page-report viewer stays scoped out). The tooltip
  // still shows the full score + violation count for hover.
  const tip = `Page accessibility: ${grade}${score !== null ? ` (${score})` : ""}${violationLabel}`;
  return ` <span class="page-audit-chip ${cls}" title="${htmlEscape(tip)}">(${htmlEscape(grade)})</span>${source}`;
}

// v1.9.0: Audit Report column cell. v1.10.2: combined with the report-link.
// v1.19.0: the grade chip + numeric score were removed — the
// audit.icjia.app scoring heuristic is still being refined, so the table
// no longer asserts a grade. The cell renders only an "Open report" anchor
// to audit.icjia.app/report/<id>; the score lives in that report. Unscored
// entries, missing audits, and audited documents with no report URL render an
// empty cell. audit.error renders an "Unavailable" chip — except a 413
// (v1.50.0), which renders "Too large" with categorizeAuditError's
// introspection-aware reason in the tooltip, so the one chip and the File
// errors page can never tell different stories about the same file.
function buildAuditScoreCell(audit, entry) {
  if (!audit || typeof audit !== "object") return "<td></td>";
  if (audit.skipped) return "<td></td>";
  if (audit.error) {
    const cat = entry ? categorizeAuditError(entry) : null;
    if (cat?.kind === "too-large") {
      return `<td><span class="audit-grade audit-grade-error" title="${htmlEscape(cat.reason)}">Too large</span></td>`;
    }
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
  // v1.31.0 — a file is listed once in the whole Page view, under the first
  // page that links it (see buildPageList). Repeat mentions on later pages
  // collapse into this muted count so the same filename never appears twice.
  const dupes = page.dupeFileCount ?? 0;
  const dupeNote = dupes > 0
    ? `<span class="no-refs">${files.length > 0 ? "+" : ""}${dupes} ${dupes === 1 ? "file" : "files"} listed under other pages</span>`
    : "";
  // v1.32.0 — files this page links that live in another fleet site's
  // inventory (e.g. CMS/Strapi uploads). Shown as a separate muted group; the
  // local Files count is unchanged.
  const crossSite = page.crossSiteFiles ?? [];
  const crossNote = crossSite.length > 0
    ? `<span class="page-xsite">&#8627; hosted on another site: ${crossSite
        .map((f) => {
          const name = htmlEscape(f.filename ?? "");
          const label = htmlEscape(f.siteLabel ?? "");
          // detailHref is a pipeline-generated slug-timestamp.html path (no
          // scheme), so htmlEscape is sufficient — do NOT switch to safeUrl
          // (which is for scanned public URLs): safeUrl would reject this
          // relative path and null out the in-bundle link.
          const chip = f.detailHref
            ? `<a class="ref-link" href="${htmlEscape(f.detailHref)}" title="On ${label}">${name}</a>`
            : `<span class="ref-link-bad">${name}</span>`;
          return `${chip} <span class="xsite-owner">(${label})</span>`;
        })
        .join(" ")}</span>`
    : "";
  if (files.length === 0) {
    const empty = [dupeNote, crossNote].filter(Boolean).join(" ");
    return `<td data-count="0">${empty || `<span class="no-refs">No files</span>`}</td>`;
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
  return `<td data-count="${files.length}"><span class="page-file-count">${files.length}</span> ${chips}${dupeNote ? ` ${dupeNote}` : ""}${crossNote ? ` ${crossNote}` : ""}</td>`;
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
    tag = ` <span class="page-sitemap-tag" title="Listed in the site's sitemap; no files were found linked from this page.">sitemap</span>`;
  } else if (page.fromCms) {
    tag = ` <span class="page-cms-tag" title="A page from the site's CMS; no files were found linked from it.">cms</span>`;
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
  <p class="page-view-empty">Page view needs CMS reference data — the map of which pages link to which files. The audit extracts that from CMS sites (Strapi); this is a static (non-CMS) site, so file-to-page mapping isn't available for it. The <strong>File view</strong> above lists every file on the site.</p>
</div>`;
  }
  const rows = pages.map((p) => buildPageRow(p, ctx)).join("\n");
  return `<div id="page-view" hidden>
  <p class="page-view-note">One row per page. <strong>Files</strong> are the documents the page links to. Each file is listed once — under the first page that links it; a page whose other linked files already appear above shows them as a count ("listed under other pages") instead of repeating them. Rows tagged <span class="page-sitemap-tag">sitemap</span> or <span class="page-cms-tag">cms</span> are pages with no files linked from them — sourced from the site's sitemap.xml and CMS respectively. A file a page links that is hosted on another fleet site (for example the CMS) appears in a muted <span class="page-xsite">hosted on another site</span> group that links to that site's report.</p>
  ${paginatorNav({ idPrefix: "pv-", ariaLabel: "Page table pagination", live: true })}
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
  ${paginatorNav({ idPrefix: "pv-", ariaLabel: "Page table pagination", live: true, bottom: true })}
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
    // v1.34.0: Remediation Score ("B/88", "N/A (legacy format)", "Not scored").
    // Appended last to match its position in CSV_COLUMNS (the non-csvOnly
    // tail) so the by-name value index lookup in writeHtml resolves correctly.
    formatRemediationScore(entry),
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

// v1.36.0 — detail-page "File accessibility (documents)" hero banner. Mirrors
// the homepage card's renderFileA11y() (same summarizeFileA11y() input) so the
// two surfaces never disagree: excluded archive, thin data, or score + band.
// The average is the site's scored documents only — nothing site-level.
// v1.57.0 — one copy of the orange files scope icon; used by the hero
// banner's compact lockup AND the big "File accessibility" section header
// so the two can never drift apart.
const FILES_SCOPE_ICON_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5.5L13 5v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z"/><path d="M9.5 1.5V5H13"/><path d="M5.5 8.5h5M5.5 11h3.5"/></svg>`;

function renderFileA11yBanner(a, trend) {
  // v1.56.0 — scope lockup: orange document icon + a subtitle naming WHAT
  // this banner scores (the files), paired with the blue-globe lockup on the
  // "Website accessibility" section below it. Managers kept reading one
  // score as the other; icon + hue + words make the scope unmistakable.
  const head = `<div class="scope-head scope-head-files">
    <span class="scope-head-icon" aria-hidden="true">${FILES_SCOPE_ICON_SVG}</span>
    <span class="scope-head-text">
      <span class="dp-a11y-head">File accessibility <small>(documents)</small></span>
      <span class="scope-head-sub">Scores the files this site publishes &mdash; PDFs, Word, Excel, PowerPoint &mdash; not its web pages</span>
    </span>
  </div>`;
  if (a.excluded) {
    return `<div class="dp-a11y dp-a11y-na">${head}<span class="dp-a11y-note">Score N/A &mdash; long-term archive (many files are ADA Title&nbsp;II exceptions)</span></div>`;
  }
  if (!a.enoughData) {
    return `<div class="dp-a11y dp-a11y-na">${head}<span class="dp-a11y-note">${htmlEscape(fileA11yThinDataText(a))}</span></div>`;
  }
  const key = a.band?.key ?? "na";
  const label = htmlEscape(a.band?.label ?? "");
  const cover = htmlEscape(fileA11yCoverageText(a));
  const trendChip = fileA11yTrendChipHtml(trend);
  return `<div class="dp-a11y dp-a11y-${key}">${head}${fileA11yGaugeHtml(a)}<span class="dp-a11y-body"><span class="dp-a11y-score">${a.avg}<small>/100</small></span><span class="dp-a11y-pill"><span class="dp-a11y-dot" aria-hidden="true"></span>${label}</span>${trendChip}</span><span class="dp-a11y-cover">${cover}</span></div>`;
}

export async function writeHtml({ sourceHeader, entries, sources, outputPath, backHref = null, csvHref = null, siteUrl = null, siteFullName = null, accessKind = null, sitemapUrls = [], cmsPages = [], resolveFleetFile = null, pageRefFiles = null, currentSiteName = null, siteSlug = null, fileA11yTrend = null, siteAudit = null, pageScores = null }) {
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
  // v1.36.0 — per-file document audit tally, mirroring computeSiteSummary() so
  // the detail-page file-accessibility banner agrees with the homepage card.
  // Every machine-scoreable document (PDF + modern Office) carries a numeric
  // score when audited; legacy Office is remediable but unscoreable.
  let auditScoreSum = 0;
  let auditedDocCount = 0;
  let auditErrorCount = 0;
  let auditPending = 0;
  let unscoreableCount = 0;

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
    if (isScoreable(entry)) {
      const audit = entry.audit;
      if (audit && typeof audit === "object") {
        if (typeof audit.score === "number") {
          auditedDocCount++;
          auditScoreSum += audit.score;
        } else if (audit.error) {
          auditErrorCount++;
        } else {
          auditPending++;
        }
      } else {
        auditPending++;
      }
    } else if (isUnscoreableDocument(entry)) {
      unscoreableCount++;
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
  const pagesTooltip = `≈${remediablePages.toLocaleString()} document pages (pages inside the PDF/Office files — not web pages). `
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
  const CHIP_ORDER = ["pdf", "office-document", "spreadsheet", "presentation", "legacy-office", "image", "archive", "text", "web", "audio-video", "other"];
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
    // v1.34.0: the grade/score ("B/88") sits left of the report link so a
    // manager reads "what's the score" before "open the report".
    { name: "remediationScore", label: "Remediation Score" },
    // v1.39.0: the Audit Report + Page References cells are rendered
    // directly from entry data; their row values are "" placeholders, so
    // sorting them is meaningless — mark them non-sortable (no cursor, no
    // click handler; see data-nosort below).
    { name: "auditScore",  label: "Audit Report", sortable: false },
    { name: "referenced",  label: "Page References", sortable: false },
    { name: "duplicateOf", label: "Duplicate of" },
    { name: "modifiedAt",  label: "Date published" },
  ];
  const htmlColValueIdx = HTML_TABLE_COLUMNS.map((c) => valueIdxByName(c.name));
  const publicUrlVi = valueIdxByName("publicUrl");
  // v1.40.0 — path (and serverName on consolidated reports) are searchable but
  // not visible columns. They ride each row as a data-search attribute; the
  // client projection appends them to the haystack. This replaced the embedded
  // values blob that shipped every row's data a second time (May review P1).
  const pathVi = valueIdxByName("path");
  const serverVi = valueIdxByName("serverName");

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
    const searchExtras = [values[pathVi], isConsolidated ? values[serverVi] : null]
      .filter(Boolean).join(" ");
    const searchAttr = searchExtras ? ` data-search="${htmlEscape(searchExtras)}"` : "";
    const publicUrl = values[publicUrlVi];
    const cells = HTML_TABLE_COLUMNS.map((col, i) => {
      const v = values[htmlColValueIdx[i]];
      if (col.name === "referenced") {
        return buildReferencedCell(entry.references);
      }
      if (col.name === "auditScore") {
        return buildAuditScoreCell(entry.audit, entry);
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
      if (col.name === "modifiedAt") {
        // v1.62.0 — the table used to print the raw ISO timestamp
        // ("2026-08-13T14:14:49.000Z"), machine noise for the manager
        // audience. Human date in the cell; the ISO rides along in
        // data-sort-value so chronological sort (plain string compare on
        // ISO) and column search keep working exactly as before.
        const iso = v === null || v === undefined ? "" : String(v);
        const human = fmtChicagoDate(iso);
        return `<td class="col-date"${iso ? ` data-sort-value="${htmlEscape(iso)}" title="${htmlEscape(iso)}"` : ""}>${htmlEscape(human || iso)}</td>`;
      }
      if (col.name === "pageCount") {
        // Empty cell for non-PDFs and unintrospected PDFs; otherwise the
        // raw integer, right-aligned. data-num so the sort comparator
        // (already in the table JS) treats it numerically.
        const numStr = v === "" || v === null || v === undefined ? "" : String(v);
        const data = numStr ? ` data-num="${numStr}"` : "";
        return `<td class="col-pages num"${data}>${htmlEscape(numStr)}</td>`;
      }
      if (col.name === "remediationScore") {
        // v1.36.0 — tint the per-file score cell red/yellow/green by the same
        // far/partial/closer band the homepage card uses, so a manager scanning
        // the table sees at a glance which files still need work. Unscored
        // files (no numeric audit.score) get no band and render unstyled.
        const band = bandForScore(entry.audit?.score);
        const cls = band ? ` rem-band-${band.key}` : "";
        return `<td class="rem-score${cls}">${htmlEscape(v)}</td>`;
      }
      return `<td>${htmlEscape(v)}</td>`;
    }).join("");
    return `<tr${classAttr}${categoryAttr}${searchAttr}>${cells}</tr>`;
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
    (col.sortable === false
      ? `<th data-col="${htmlEscape(col.name)}" scope="col" data-nosort>${htmlEscape(col.label)}</th>`
      // v1.40.0 — a real <button> makes the sort keyboard-operable for free
      // (Enter/Space fire click); aria-sort carries the state for AT.
      : `<th data-col="${htmlEscape(col.name)}" scope="col" aria-sort="none"><button type="button" class="th-sort-btn">${htmlEscape(col.label)}</button></th>`)
  ).join("");

  // ── Page view (v1.13.0): invert the file entries into a page list ────────────
  const pageList = buildPageList(entries, sitemapUrls, cmsPages, pageScores);
  // v1.32.0 — decorate each page with the CMS-hosted (cross-site) files it
  // links, resolved to their owning fleet site. No-op without fleet data
  // (standalone `report` command).
  if (resolveFleetFile && pageRefFiles) {
    attachCrossSiteFiles(pageList, { pageRefFiles, resolveFleetFile, currentSiteName });
  }
  const pageViewSectionHtml = buildPageViewSection(pageList, { sourceHeader, sourceMap, isConsolidated });
  // v1.33.0 — the toggle sits in the inventory header beside the heading that
  // the toggle JS swaps between "File accessibility" and "Pages on this
  // site" (v1.57.0 rename); the explanatory blurb renders just below.
  const viewToggleHtml = `
<div class="view-toggle" role="group" aria-label="Switch report view">
  <div class="view-toggle-buttons">
    <button type="button" class="view-toggle-btn is-active" data-view="file" aria-pressed="true">File view</button>
    <button type="button" class="view-toggle-btn" data-view="page" aria-pressed="false">Page view</button>
  </div>
</div>`;
  const viewToggleBlurbHtml = `<p class="view-toggle-blurb"><strong>File view</strong> lists every file and the pages that link to it. <strong>Page view</strong> flips it around — one row per page on the site, with the files it links to.</p>`;

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
  // v1.39.0: path (and serverName, consolidated only) are appended as hidden
  // trailing values so the search box's promised "path, server" matching
  // works — the visible-column projection had dropped both. The extras sit
  // beyond every sortable column index, so sortBy never reads them.
  // (values blob removed in v1.40.0 — rows carry their own data; see data-search)

  // ── hero block (v1.33.0 work-first redesign) ────────────────────────────────
  // The hero leads with the one number a site manager acts on — how many files
  // may need audit work — plus the page-count effort and the audit proportion.
  // The full inventory totals (file count, size, scan date) drop to a single
  // quiet metaline below, instead of being restated across stacked tiles, two
  // stat cards, a "total inventoried" line and a four-card summary bar. A small
  // ring carries the proportion (the old large donut was mostly empty at the
  // low percentages typical of these audits). Values are pre-computed here; the
  // template literal below just interpolates them.
  const heroTotal = totalFiles;
  const heroAudit = remediableCount;
  const heroPctRaw = heroTotal > 0 ? (heroAudit / heroTotal) * 100 : 0;
  const heroPct = Math.round(heroPctRaw * 10) / 10;
  // Point-in-time date for the metaline: scan date for a single site, the
  // consolidation date for a fleet rollup (whose per-source scans vary).
  const heroDateFmt = fmtChicagoDate((isConsolidated ? meta?.consolidatedAt : meta?.scannedAt) ?? "");
  const heroTitle = htmlEscape(siteFullName || siteName || "ICJIA inventory report");
  const heroNick = htmlEscape(siteName ?? "");

  // v1.36.0 — file-accessibility read for the hero: the average of this site's
  // scored documents, banded far→closer (archive excluded by slug).
  const fileA11yBannerHtml = renderFileA11yBanner(summarizeFileA11y({
    auditScoreSum,
    auditedDocCount,
    auditErrorCount,
    auditPending,
    unscoreable: unscoreableCount,
    remediable: remediableCount,
    siteSlug,
  }), fileA11yTrend);

  // Access-method panel: shown when web-rollup passes an accessKind. Tells a
  // remediator how the site's files are served + what credentials are needed
  // to reach them. The index card carries the chip version; this is the
  // verbose treatment with the SSH-key call-to-action the chip can't fit.
  // v1.62.0 — rendered LAST on the page, after both assessments. It used to
  // sit directly under the hero, which made rsync/SSH instructions the
  // second thing a non-technical manager read; it's sysadmin content, and
  // the worklist they came for was two sections further down.
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
<meta name="description" content="File inventory and accessibility-audit scoping for ${htmlEscape(siteFullName || titleSuffix)} — counts, remediation workload, and per-file detail.">
<meta name="robots" content="noindex, nofollow">
<title>ICJIA Fleet Audit Assessment — ${htmlEscape(titleSuffix)}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%230d1117'/><path d='M12 9L12 23L23 16Z' fill='%23ffb000'/></svg>">
${backHref ? PLAUSIBLE_SNIPPET : ""}
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
  /* v1.30.0 — bottom padding removed; the sticky .site-footer (shared CSS at
     the end of this stylesheet) closes the page instead. */
  padding: 1rem 1.5rem 0;
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
     navbar buttons (FAQ + File Audit Tool) sitting next to it. Color
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
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.45rem 1.05rem;
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
/* v1.55.0 — the download block now renders inside the hero, not the sticky
   bar. In the hero it lays out as a row (big button, "Last audit" caption
   beside it) and the button steps up a size: it's the page's primary
   deliverable, so it reads as the hero's call to action. */
.dp-hero-download {
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.9rem;
  margin: 1.05rem 0 0.15rem;
}
.dp-hero-download .report-csv-link {
  font-size: 0.95rem;
  padding: 0.55rem 1.15rem;
}
/* Mirror of .audit-tool-link styling on the index page so the affordance
   reads the same across surfaces. v1.7.28: font dropped to 0.8rem
   (matched against the index navbar variant) to leave more horizontal
   room for the two-button cluster (FAQ + audit tool) on narrow viewports. */
/* v1.61.2 — mirror of INDEX_CSS: plain links, not filled pills. Only
   Help (helpNavCss) stays a button. */
.audit-tool-link {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.15rem;
  background: none;
  border: 0;
  color: #a9b8c6 !important;
  font-weight: 600;
  font-size: 0.78rem;
  letter-spacing: 0.01em;
  text-decoration: none;
  border-radius: 4px;
  transition: color 120ms ease;
  white-space: nowrap;
}
.audit-tool-link:hover { color: #ffffff !important; text-decoration: underline; }
.audit-tool-link:focus-visible { outline: 2px solid #58a6ff; outline-offset: 3px; }
.audit-tool-link .audit-tool-icon { opacity: 0.75; }
.audit-tool-link:hover .audit-tool-icon { opacity: 1; }
.audit-tool-icon { width: 13px; height: 13px; flex: none; }
@media (max-width: 700px) {
  .audit-tool-link { font-size: 0.8rem; }
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
/* v1.32.0 — CMS-hosted (cross-site) files a page links. Muted group after the
   local file chips; the chip reuses .ref-link, the owner label is muted. */
.page-xsite {
  display: inline;
  color: #9aa5b1;
  font-style: italic;
  font-size: 0.9em;
}
.page-xsite .xsite-owner {
  color: #86b8a6;
  font-style: normal;
  font-size: 0.92em;
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
/* v1.33.0 — work-first hero: one big actionable number (files that may need
   audit work) + a small proportion ring, with the inventory totals demoted to
   a single quiet metaline below. */
.dp-hero .dp-hero-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin: 4px 0 0;
}
.dp-hero .dp-headline { min-width: 0; }
.dp-hero .dp-headline-num {
  display: block;
  font-size: 4.6em;
  font-weight: 900;
  line-height: 0.95;
  letter-spacing: -0.03em;
  color: #ffa84d;
  font-variant-numeric: tabular-nums;
}
.dp-hero .dp-headline-cap {
  display: block;
  margin-top: 6px;
  font-size: 1.18em;
  font-weight: 700;
  color: #ffffff;
}
.dp-hero .dp-headline-sub {
  display: block;
  margin-top: 8px;
  font-size: 0.95em;
  color: #9aa5b1;
}
.dp-hero .dp-headline-sub span { cursor: help; border-bottom: 1px dashed rgba(154, 165, 177, 0.4); }
.dp-hero .dp-ring {
  flex: none;
  width: 92px; height: 92px;
  border-radius: 50%;
  /* --pct is emitted with a "%" suffix; used directly as a conic stop. */
  background: conic-gradient(#ffa84d 0 var(--pct, 0%), rgba(255, 168, 77, 0.16) var(--pct, 0%) 100%);
  display: flex; align-items: center; justify-content: center;
  position: relative;
}
.dp-hero .dp-ring::after {
  content: "";
  position: absolute;
  inset: 11px;
  background: #141a23;
  border-radius: 50%;
}
.dp-hero .dp-ring-pct {
  position: relative; z-index: 1;
  font-weight: 800;
  font-size: 1.1em;
  color: #ffa84d;
  line-height: 1;
  text-align: center;
}
.dp-hero .dp-ring-pct small {
  display: block;
  font-size: 0.5em;
  color: #9aa5b1;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-top: 3px;
}
.dp-hero .dp-metaline {
  margin: 22px 0 0;
  font-size: 0.92em;
  color: #8b949e;
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
}
.dp-hero .dp-metaline strong { color: #9aa5b1; font-weight: 600; }

/* v1.20.0 — snapshot hedge: page + file counts are a moment-in-time estimate,
   not a contractual figure. Kept (info preserved) but visually quiet. */
.dp-hero .dp-snapshot-note {
  margin: 0.85rem 0 0;
  font-size: 0.82em;
  line-height: 1.5;
  color: #8b949e;
}
.dp-hero .dp-snapshot-note strong { color: #9aa5b1; font-weight: 600; }
/* v1.36.0 — file-accessibility banner in the hero: the average of the site's
   scored documents + a far/partial/closer band. Band class sets
   --dpa-accent (bar/dot/score/pill) and --dpa-tint (pill bg). dp-a11y-na covers
   the excluded archive + thin-data sites (note only). */
.dp-a11y {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 7px;
  max-width: 100%;
  margin: 2px 0 14px;
  padding: 10px 16px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border-left: 4px solid var(--dpa-accent, #6e7681);
}
.dp-a11y-cover { font-size: 0.8rem; color: #8b95a1; line-height: 1.45; }
/* v1.38.0 — infographic gauge (shared markup with the homepage card): a fixed
   red→amber→green track with a marker at the score. */
.dp-a11y .a11y-gauge { width: 260px; max-width: 100%; padding-top: 7px; margin: 1px 0 4px; }
.dp-a11y .a11y-gauge-track {
  position: relative;
  height: 13px;
  border-radius: 7px;
  background: linear-gradient(to right, #e5484d 0 60%, #e3a008 60% 80%, #30a46c 80% 100%);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.30);
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}
.dp-a11y .a11y-gauge-marker {
  position: absolute;
  top: -3px; bottom: -3px;
  width: 3px;
  background: #fff;
  transform: translateX(-50%);
  border-radius: 2px;
  box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.55);
}
.dp-a11y .a11y-gauge-marker::before {
  content: "";
  position: absolute;
  top: -7px; left: 50%;
  transform: translateX(-50%);
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 6px solid #fff;
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.6));
}
/* v1.38.0 — "since last audit" trend chip in the banner. */
.dp-a11y .a11y-trend {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.82rem;
  font-weight: 700;
  padding: 2px 9px;
  border-radius: 999px;
  white-space: nowrap;
}
.dp-a11y .a11y-trend-up   { color: #56d364; background: rgba(63, 185, 80, 0.14); }
.dp-a11y .a11y-trend-down { color: #ff7b72; background: rgba(248, 81, 73, 0.14); }
.dp-a11y .a11y-trend-flat { color: #9aa5b1; background: rgba(255, 255, 255, 0.06); }
.dp-a11y-head { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #9aa5b1; }
.dp-a11y-head small { text-transform: none; letter-spacing: 0; font-weight: 600; opacity: 0.85; }
.dp-a11y-body { display: inline-flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.dp-a11y-score { font-size: 1.9rem; font-weight: 900; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--dpa-accent, #e5e5e5); }
.dp-a11y-score small { font-size: 0.42em; font-weight: 700; color: #9aa5b1; }
.dp-a11y-pill { display: inline-flex; align-items: center; gap: 7px; padding: 4px 12px; border-radius: 999px; background: var(--dpa-tint, rgba(255, 255, 255, 0.06)); color: var(--dpa-accent, #d4dae0); font-size: 0.85rem; font-weight: 700; }
.dp-a11y-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--dpa-accent, #9aa5b1); flex: none; }
.dp-a11y-note { color: #9aa5b1; font-size: 0.9rem; }
.dp-a11y-far     { --dpa-accent: #ff7b72; --dpa-tint: rgba(248, 81, 73, 0.14); }
.dp-a11y-partial { --dpa-accent: #e3b341; --dpa-tint: rgba(227, 160, 8, 0.15); }
.dp-a11y-closer  { --dpa-accent: #56d364; --dpa-tint: rgba(63, 185, 80, 0.15); }
.dp-a11y-na      { --dpa-accent: #6e7681; --dpa-tint: rgba(255, 255, 255, 0.05); }

@media (max-width: 720px) {
  .dp-hero .dp-hero-main { flex-direction: column-reverse; align-items: flex-start; gap: 14px; }
  .dp-hero .dp-headline-num { font-size: 3.4em; }
  .dp-hero .dp-title { font-size: 2em; }
}

/* ── v1.33.0 progressive-disclosure sections (Breakdown / Site details) ───── */
.dp-disclosure { border-top: 1px solid #21262d; margin: 0; }
.dp-disclosure:last-of-type { border-bottom: 1px solid #21262d; }
.dp-disclosure > summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.95rem 0.25rem;
  font-size: 0.98rem;
  font-weight: 600;
  color: #e5e5e5;
}
.dp-disclosure > summary::-webkit-details-marker { display: none; }
.dp-disclosure > summary::before {
  content: "\\25B8";
  color: #8b949e;
  font-size: 0.85em;
  transition: transform 120ms ease;
}
.dp-disclosure[open] > summary::before { transform: rotate(90deg); }
.dp-disclosure > summary:hover { color: #ffffff; }
.dp-disclosure > summary:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; border-radius: 4px; }
.dp-disclosure .dp-disclosure-hint { margin-left: auto; font-size: 0.8rem; font-weight: 400; color: #8b949e; }
.dp-disclosure-body { padding: 0.25rem 0.25rem 1.25rem 1.6rem; }
.dp-breakdown-misc { margin: 0.9rem 0 0; font-size: 0.9em; color: #9aa5b1; }
.dp-breakdown-misc strong { color: #e5e5e5; }
.dp-breakdown-label {
  margin: 1.1rem 0 0.4rem;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #9aa5b1;
}

/* ── v1.33.0 inventory header: shared heading + view toggle on one row ────── */
.inv-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin: 2rem 0 0;
}
.inv-header h2 { margin: 0; }
.inv-header .view-toggle { margin: 0; }

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

/* ── category table ────────────────────────────────────────── */
.cat-table { border-collapse: collapse; font-size: 13px; margin-bottom: 1rem; color: #e5e5e5; }
.cat-table td { padding: 0.2rem 0.75rem 0.2rem 0; }
.cat-table td:last-child { text-align: right; font-weight: 600; color: #60a5fa; }

/* ── v1.20.0: PDF page-count column. Right-aligned, tabular-nums so the
   digits line up across rows. Non-PDFs render a blank cell, so the column
   reads as a sparse stripe of numbers next to the filename. */
td.col-pages { text-align: right; font-variant-numeric: tabular-nums; color: #c0cdda; padding-right: 0.6em; }
/* v1.36.0 — per-file Remediation Score cell tinted by the same far/partial/
   closer band as the homepage card, so a manager scanning the table sees which
   files are far from / closer to accessible. Unscored cells stay unstyled. */
td.rem-score { font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 700; }
td.rem-band-far     { background: rgba(248, 81, 73, 0.15); color: #ff9d96; }
td.rem-band-partial { background: rgba(227, 160, 8, 0.15); color: #e3b341; }
td.rem-band-closer  { background: rgba(63, 185, 80, 0.15); color: #56d364; }
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
  /* v1.36.0 — the vertical max-height:75vh cap was removed. It predated row
     pagination; once the table is already bounded to one page of rows (25 by
     default), the cap only created a NESTED vertical scroll region. With tall
     Page-view rows that pane overflowed, and its wheel got trapped at the
     bottom (overscroll-behavior wouldn't chain to the page) while the sticky
     site-footer overlapped the last rows — the "scrolling stops / rows cut off"
     bug. Letting the document own the vertical scroll fixes both.
     'overflow-x: auto' keeps HORIZONTAL scroll for a wide file table; with no
     height constraint the pane grows to its content, so there is no vertical
     scrollbar to trap (per CSS spec overflow-y resolves to auto here, but at
     content height there is nothing to scroll vertically). overscroll-behavior
     is scoped to x only so a trackpad back-swipe doesn't navigate away mid-pan. */
  overflow-x: auto;
  border: 1px solid #21262d;
  border-radius: 4px;
  /* Momentum scrolling on iOS; touch-action lets the browser handle native
     two-finger / single-finger pan in both axes without delay. */
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x pan-y;
  overscroll-behavior-x: contain;
}

/* ── scrollable container (alias for table-wrap) ───────────── */
.table-scroll {
  /* v1.7.2: horizontal touch-pan for non-file-table data (category breakdown,
     etc.). v1.36.0: overscroll scoped to x (matches .table-wrap) so vertical
     wheel always chains to the page — no nested vertical scroll trap. */
  overflow-x: auto;
  width: 100%;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x pan-y;
  overscroll-behavior-x: contain;
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
/* v1.55.0 — a second copy of each paginator renders below its table. The
   scroll-margin keeps the sticky nav bar from covering the top copy when a
   bottom-copy click snaps the view back up to it. */
.paginator { scroll-margin-top: 3.4rem; }
.paginator-bottom { margin-top: 0.8rem; }

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
/* v1.39.0 — placeholder columns (Page References / Audit Report) are not
   sortable: their row values are "" by design, so drop the pointer cursor
   and the hover invite. The click handler skips them too. */
thead th[data-nosort] { cursor: default; }
thead th[data-nosort]:hover { background: #161b22; }
/* v1.40.0 — sortable-header buttons: inherit the th look, add a visible
   keyboard focus ring. The sort arrows stay on the th classes below. */
.col-date { white-space: nowrap; }
.th-sort-btn { background: none; border: 0; padding: 0; margin: 0; font: inherit; letter-spacing: inherit; text-transform: inherit; color: inherit; cursor: pointer; }
.th-sort-btn:focus-visible { outline: 2px solid #58a6ff; outline-offset: 2px; border-radius: 3px; }
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
/* v1.33.0 — the legend is now a collapsed <details>; reference material a
   click away rather than an always-open three-column wall above the table. */
.row-marker-legend {
  background: #12161d;
  border: 1px solid #21262d;
  border-radius: 6px;
  margin: 0.6rem 0 1rem 0;
  font-size: 13px;
  line-height: 1.5;
}
.row-marker-legend[open] { border-left: 3px solid #fbbf24; }
.row-marker-legend > summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 0.9rem;
  font-weight: 600;
  color: #bfdbfe;
}
.row-marker-legend > summary::-webkit-details-marker { display: none; }
.row-marker-legend > summary::before {
  content: "\\25B8";
  color: #8b949e;
  font-size: 0.85em;
  transition: transform 120ms ease;
}
.row-marker-legend[open] > summary::before { transform: rotate(90deg); }
.row-marker-legend > summary:hover { color: #93c5fd; }
.row-marker-legend > summary:focus-visible { outline: 2px solid #60a5fa; outline-offset: -2px; }
.row-marker-legend[open] > summary { border-bottom: 1px solid #21262d; }
.row-marker-legend .row-marker-table { margin: 0.5rem 0.9rem 0.7rem; width: auto; }
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
${siteFooterCss()}
${helpNavCss()}
/* Detail pages have no max-width column — body side padding (1.5rem) is the
   content edge. Pull the bar full-bleed the same way .report-back-bar does,
   and align its content with the page content rather than a centered 1200px
   column. */
.site-footer { margin-left: -1.5rem; margin-right: -1.5rem; padding-left: 1.5rem; padding-right: 1.5rem; }
.site-footer-inner { max-width: none; }

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
@media (max-width: 720px) { .audit-stats { grid-template-columns: 1fr; } }

/* ── site-accessibility section ─────────────────────────────── */
/* v1.40.0 — restyled to the detail page's dark idiom (the original palette
   was a light-page draft; the section itself first ships in v1.40.0). */
.site-accessibility { margin: 28px 0; padding: 20px 22px; border: 1px solid #21262d; border-left: 5px solid #4dabf7; border-radius: 10px; background: #161b22; }
.site-accessibility h2 { margin: 0 0 8px; color: #e5e5e5; }
.site-accessibility .sa-independence { font-size: 0.95rem; color: #9aa5b1; max-width: 70ch; }
.site-accessibility .sa-independence strong { color: #d4dae0; }
.site-accessibility .sa-headline { display: flex; align-items: center; gap: 18px; margin: 14px 0; }
.site-accessibility .sa-num { font-size: 3rem; font-weight: 800; color: #e5e5e5; line-height: 1; }
.site-accessibility .sa-grade { font-size: 1.4rem; font-weight: 700; color: #4dabf7; margin-left: 6px; }
.site-accessibility .sa-coverage { margin: 0; color: #9aa5b1; }
.site-accessibility .sa-coverage strong { color: #d4dae0; }
.site-accessibility .sa-trend { margin: 6px 0 14px; color: #9aa5b1; }
.site-accessibility .sa-trend strong { color: #d4dae0; }
.site-accessibility .sa-breakdown { display: flex; flex-wrap: wrap; gap: 16px; }
.site-accessibility .sa-card { flex: 1 1 240px; min-width: 0; background: #0d1117; border: 1px solid #21262d; border-radius: 8px; padding: 12px 14px; }
.site-accessibility .sa-card h3 { margin: 0 0 8px; font-size: 0.95rem; color: #c0cdda; }
.site-accessibility .sa-card ul { margin: 0; padding-left: 18px; color: #9aa5b1; }
.site-accessibility .sa-card strong { color: #d4dae0; }
.site-accessibility .sa-muted { color: #8b949e; font-size: 0.85rem; list-style: none; margin-left: -18px; }
/* v1.59.1 — reconciliation note inside the WCAG card: shown only when
   issues exist but none map to Level A/AA, so the card explains itself
   instead of looking like it contradicts the severity card. v1.59.2 —
   the severity card gets the same treatment: per-level plain-language
   glosses + a footer note (severity = axe user-impact rating, independent
   of WCAG conformance level). */
.site-accessibility .sa-wcag-note,
.site-accessibility .sa-sev-note { margin: 10px 0 0; padding-top: 8px; border-top: 1px solid #21262d; font-size: 0.85rem; color: #9aa5b1; line-height: 1.5; }
.site-accessibility .sa-wcag-note strong,
.site-accessibility .sa-sev-note strong { color: #d4dae0; }
.site-accessibility .sa-sev-gloss { color: #8b949e; font-size: 0.85em; }
.site-accessibility .sa-pages { margin-top: 14px; }
.site-accessibility .sa-pages summary { cursor: pointer; color: #c0cdda; }
.site-accessibility .sa-pages table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 8px; }
.site-accessibility .sa-pages th, .site-accessibility .sa-pages td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #21262d; color: #9aa5b1; }
.site-accessibility .sa-pages td:first-child { word-break: break-all; }

/* ── scope lockups (v1.56.0) ────────────────────────────────── */
/* The two assessments on this page score different things and kept being
   read as one. Each card now leads with an icon tile + subtitle naming its
   scope: GREEN document = the FILES the site publishes (green = the
   download/deliverable hue; v1.58.0 moved off orange because orange is a
   score-band indicator in the table cells), BLUE globe = the WEBSITE's own
   pages (same blue as that section's border). Distinct icons + explicit
   words carry the pairing for color-blind readers; print inks below. */
.scope-head { display: flex; align-items: flex-start; gap: 11px; }
.scope-head-icon { width: 32px; height: 32px; flex: none; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; }
.scope-head-icon svg { width: 18px; height: 18px; }
.scope-head-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.scope-head-text h2 { margin: 0; }
.scope-head-sub { font-size: 0.78rem; font-weight: 600; line-height: 1.35; letter-spacing: 0.01em; }
.scope-head-files .scope-head-icon { color: #3fb950; background: rgba(63, 185, 80, 0.13); border: 1px solid rgba(63, 185, 80, 0.4); }
.scope-head-files .scope-head-sub { color: #3fb950; }
.scope-head-website .scope-head-icon { color: #4dabf7; background: rgba(77, 171, 247, 0.13); border: 1px solid rgba(77, 171, 247, 0.4); }
.scope-head-website .scope-head-sub { color: #4dabf7; }
.site-accessibility .scope-head { margin-bottom: 10px; }
/* v1.57.0 — infographic size for the two SECTION titles (the hero banner's
   compact lockup keeps the default size). v1.58.0 — the whole files region
   (header + breakdown/site-details disclosures + both table views) is one
   .files-section element whose GREEN left bar runs its full length,
   mirroring the blue-barred website card; green is distinct from the
   blue/purple/amber access-panel bars and from the orange/amber
   score-band colors used inside the table cells. */
.scope-head-lg .scope-head-icon { width: 40px; height: 40px; border-radius: 10px; }
.scope-head-lg .scope-head-icon svg { width: 22px; height: 22px; }
.scope-head-lg h2 { font-size: 1.45rem; font-weight: 800; letter-spacing: -0.015em; line-height: 1.15; }
.scope-head-lg .scope-head-sub { font-size: 0.82rem; }
.files-section { border-left: 5px solid #3fb950; padding-left: 16px; margin: 2rem 0 0; border-radius: 2px; }
.files-section .inv-header { margin: 0; }
/* v1.59.0 — mirror of the website card's .sa-independence explainer: same
   umbrella (digital accessibility), completely different remediation
   disciplines — written for managers deciding who does which work. */
.files-section .fa-independence { font-size: 0.95rem; color: #9aa5b1; max-width: 70ch; margin: 10px 0 14px; }
.files-section .fa-independence strong { color: #d4dae0; }
.files-section .fa-independence em { color: #c0cdda; font-style: italic; }

/* ── print ─────────────────────────────────────────────────── */
@media print {
  .report-back-bar { display: none; }
  .dp-hero-download { display: none; }
  .scope-head-files .scope-head-icon, .scope-head-files .scope-head-sub { color: #1a7f37; }
  .scope-head-files .scope-head-icon { background: #e8f5ec; border-color: #9fd4ab; }
  .scope-head-website .scope-head-icon, .scope-head-website .scope-head-sub { color: #0a5bd3; }
  .scope-head-website .scope-head-icon { background: #e7f0fb; border-color: #9cc3ee; }
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
  .stat-card { background: #f8f8f8; border-color: #ccc; }
  .stat-card .stat-number, .stat-card .stat-heading, .stat-card .stat-label,
  .stat-card .stat-detail { color: #000; }
  .stat-card.remediable .stat-number { color: #d97706; }
  .stat-card.reference .stat-number { color: #555; }
  tbody tr:nth-child(even) { background: #f8f8f8; }
  tbody tr:nth-child(odd) { background: #fff; }
  tbody tr:hover { background: inherit; }
  .table-wrap th:first-child, .table-wrap td:first-child { background: inherit; }
  .cat-table td:last-child { color: #000; }
  .dp-a11y { background: #f6f8fa; }
  .dp-a11y-head, .dp-a11y-note, .dp-a11y-cover, .dp-a11y-score small { color: #555; }
  .dp-a11y .a11y-trend-up { color: #1a7f37; background: #e8f5ec; }
  .dp-a11y .a11y-trend-down { color: #b42318; background: #fbe9e7; }
  .dp-a11y .a11y-trend-flat { color: #57606a; background: #f0f0f0; }
  .dp-a11y-far     { --dpa-accent: #b42318; --dpa-tint: #fbe9e7; }
  .dp-a11y-partial { --dpa-accent: #8a6100; --dpa-tint: #fff5e0; }
  .dp-a11y-closer  { --dpa-accent: #1a7f37; --dpa-tint: #e8f5ec; }
  .dp-a11y-na      { --dpa-accent: #57606a; --dpa-tint: #f0f0f0; }
  td.rem-band-far     { background: #fbe9e7; color: #b42318; }
  td.rem-band-partial { background: #fff5e0; color: #8a6100; }
  td.rem-band-closer  { background: #e8f5ec; color: #1a7f37; }
  a { color: #0066cc; }
  td a { color: #0066cc; }
}
</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<main id="main">

${(() => {
  // v1.7.16: sticky nav surfaces the audit-tool buttons on every per-site +
  // by-type detail page — managers see identical affordances across pages.
  // v1.55.0: the XLSX download button + "Last audit" caption moved out of
  // this bar into the hero (.dp-hero-download): the download is the page's
  // primary deliverable and kept being missed at the right edge of a
  // four-button nav cluster.
  return `<nav class="report-back-bar" aria-label="Report navigation">
  ${backHref ? `<a class="report-back-link" href="${htmlEscape(backHref)}">
    <span aria-hidden="true">&larr;</span> Back to fleet index
  </a>` : '<span></span>'}
  <div class="report-back-bar-right">
    ${backHref ? helpNavLink() : ""}
    <a class="audit-tool-link" href="https://accessibility.icjia.app" target="_blank" rel="noopener noreferrer" title="ICJIA accessibility FAQs (accessibility.icjia.app, opens in a new tab)">
      <svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="8" cy="8" r="6.5"/>
        <path d="M6 6.2a2 2 0 1 1 2.6 1.9c-0.5 0.2-0.6 0.5-0.6 0.9"/>
        <circle cx="8" cy="11.2" r="0.55" fill="currentColor"/>
      </svg>
      <span>Accessibility FAQs</span>
    </a>
    <a class="audit-tool-link" href="https://audit.icjia.app" target="_blank" rel="noopener noreferrer" title="File Audit Tool — score any PDF for accessibility (audit.icjia.app, opens in a new tab)">
      <svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 3h-2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2"/>
        <path d="M9 2h5v5"/>
        <path d="M8 8l6-6"/>
      </svg>
      <span>File Audit Tool</span>
    </a>
    ${backHref ? `<a class="audit-tool-link nav-search" href="search.html" title="Search every file across the fleet by full or partial filename">
      <svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
      <span>Search</span>
    </a>` : ""}
    ${backHref ? `<a class="audit-tool-link nav-whats-new" href="whats-new.html" title="What's New — updates and improvements to this audit site">
      <svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 1.8 9.6 6l4.4 1.6L9.6 9.2 8 13.4 6.4 9.2 2 7.6 6.4 6z"/>
      </svg>
      <span>What's New</span>
    </a>` : ""}
  </div>
</nav>`;
})()}
<header class="dp-hero">
  ${heroNick ? `<p class="dp-nickname">${heroNick}</p>` : ""}
  <h1 class="dp-title">${heroTitle}</h1>
  <div class="dp-hero-main">
    <div class="dp-headline">
      <span class="dp-headline-num">${heroAudit.toLocaleString()}</span>
      <span class="dp-headline-cap">file${heroAudit === 1 ? "" : "s"} may need audit work</span>
      <span class="dp-headline-sub">${remediablePages > 0 ? `<span title="${htmlEscape(pagesTooltip)}">≈ ${remediablePages.toLocaleString()} document pages to remediate</span> &middot; ` : ""}${heroPct}% of inventory</span>
    </div>
    <div class="dp-ring" style="--pct:${heroPct}%" role="img" aria-label="${heroPct}% of files may need audit">
      <div class="dp-ring-pct">${heroPct}%<small>audit</small></div>
    </div>
  </div>
  ${csvHref ? `<div class="report-csv-block dp-hero-download">
    <a class="report-csv-link" href="${htmlEscape(csvHref)}" download>
      <span aria-hidden="true">&#x2913;</span> ${/\.csv$/i.test(String(csvHref)) ? "Download CSV" : "Download spreadsheet (XLSX)"}
    </a>
    ${heroDateFmt ? `<p class="report-csv-date">Last audit: <strong>${htmlEscape(heroDateFmt)}</strong></p>` : ""}
  </div>` : ""}
  ${fileA11yBannerHtml}
  <p class="dp-metaline"><strong>${heroTotal.toLocaleString()}</strong> file${heroTotal === 1 ? "" : "s"} &middot; <strong>${htmlEscape(humanizeBytes(totalBytes))}</strong>${heroDateFmt ? ` &middot; scanned <strong>${htmlEscape(heroDateFmt)}</strong>` : ""}</p>
  ${remediablePages > 0 ? `<p class="dp-snapshot-note"><strong>Snapshot as of ${htmlEscape(heroDateFmt || "the latest scan")}.</strong> These counts are a point-in-time view — they may change as files are added, edited, or removed from the site.</p>` : ""}
</header>

<section class="files-section" aria-labelledby="dp-inv-heading">
<div class="inv-header inv-header-files">
  <div class="scope-head scope-head-files scope-head-lg">
    <span class="scope-head-icon" aria-hidden="true">${FILES_SCOPE_ICON_SVG}</span>
    <div class="scope-head-text">
      <h2 id="dp-inv-heading">File accessibility</h2>
      <span class="scope-head-sub" id="dp-inv-sub">Every file this site publishes, with its accessibility score &mdash; the remediation worklist</span>
    </div>
  </div>
  ${viewToggleHtml}
</div>

<p class="fa-independence"><strong>File accessibility is not website accessibility.</strong> Both fall under <em>digital accessibility</em>, but they are separate disciplines — the process and manner of remediation are completely different. Fixing a web page means changing the site's code and content; fixing a document means remediating that individual PDF, Word, Excel, or PowerPoint file, one file at a time. A website accessibility specialist may not have the skills or experience to remediate files — and a document remediation specialist may not be able to fix web pages. When planning work or hiring a vendor, treat the two as separate scopes.</p>

<details class="dp-disclosure dp-breakdown">
  <summary><span class="dp-disclosure-title">Breakdown by file type</span> <span class="dp-disclosure-hint">every type &amp; category count</span></summary>
  <div class="dp-disclosure-body">
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
    <p class="dp-breakdown-misc">Total inventoried: <strong>${totalFiles.toLocaleString()}</strong> files (${htmlEscape(humanizeBytes(totalBytes))}) &middot; Image-only PDFs: <strong>${imageOnlyCount.toLocaleString()}</strong> &middot; Flagged for review: <strong>${flaggedCount.toLocaleString()}</strong></p>
    <p class="dp-breakdown-label">By category</p>
    <table class="cat-table">
      <tbody>
${categoryRows}
      </tbody>
    </table>
  </div>
</details>

<details class="dp-disclosure dp-sitedetails">
  <summary><span class="dp-disclosure-title">Site details</span> <span class="dp-disclosure-hint">server &middot; scan time &middot; public URL</span></summary>
  <div class="dp-disclosure-body">
    <div class="meta-grid">${metaGridHtml}
    </div>
  </div>
</details>

${viewToggleBlurbHtml}
<div class="file-view">
${filterBarHtml}
<div class="controls">
  <input type="search" id="search" placeholder="Filter by filename, path, server…" aria-label="Filter table rows">
  <span id="row-count"></span>
</div>

<details class="row-marker-legend" role="note" aria-label="Row marker key">
  <summary class="row-marker-summary">What do the colored row markers in the table mean?</summary>
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
</details>
${paginatorNav({ live: true })}
<div class="table-wrap table-scroll">
  <table id="inventory-table" aria-label="File inventory">
    <thead><tr>${headerCells}</tr></thead>
    <tbody id="inventory-body">
${rowsHtml}
    </tbody>
  </table>
</div>
${paginatorNav({ live: true, bottom: true })}
</div>
${pageViewSectionHtml}
</section>

${renderSiteAccessibilitySection(siteAudit)}
${accessPanelHtml}
</main>

${renderSiteFooter({ generatedAt: fmtChicagoGeneratedAt(scannedAt) || scannedAt })}

<script>
(function () {
  "use strict";

  const tbody = document.getElementById("inventory-body");
  const searchInput = document.getElementById("search");
  const rowCountEl = document.getElementById("row-count");
  const allRows = Array.from(tbody.querySelectorAll("tr"));
  // v1.40.0 — no embedded values blob: sort/search values are projected from
  // the rendered cells (data-num for numerics, textContent otherwise), plus
  // each row's hidden data-search extras (path, serverName). One copy of the
  // data on the page instead of two. Survives DOM re-ordering by sort.
  const rowData = new Map();
  allRows.forEach(function (row) {
    const vals = Array.from(row.cells).map(function (td) { return td.dataset.num || td.dataset.sortValue || td.textContent.trim(); });
    if (row.dataset.search) vals.push(row.dataset.search);
    rowData.set(row, vals);
  });

  let activeFilter = "remediable";
  let activeCategory = "";
  const REMEDIABLE_CATS = ${JSON.stringify([...REMEDIABLE_CATEGORIES])};

  // ── pagination state (v1.12.0 — replaces click-and-drag panning) ────────────
  let pageSize = 25;
  let currentPage = 1;
  let matched = [];  // matching <tr>, in current (sorted) DOM order

  // v1.55.0 — every paginator control exists twice: a copy above the table
  // and a copy below it (bottom ids end in "-b"). All updates fan out to
  // both copies so they never disagree.
  function pagEls(id) {
    return [document.getElementById(id), document.getElementById(id + "-b")]
      .filter(function (el) { return el; });
  }
  const pageInfoEls = pagEls("page-info");
  const pagPrevEls = pagEls("pag-prev");
  const pagNextEls = pagEls("pag-next");
  const pagPagesEls = pagEls("pag-pages");
  const pageSizeSels = pagEls("page-size");

  // Interacting with the BOTTOM copy re-renders rows above the viewport, so
  // snap back up to the top paginator — the reader lands at the start of the
  // page they asked for instead of staring at its tail.
  function snapToTableTop() {
    const nav = pageInfoEls[0] && pageInfoEls[0].closest(".paginator");
    if (nav && nav.scrollIntoView) nav.scrollIntoView();
  }

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
    const infoText = total === 0
      ? "No matching files"
      : "Showing " + (startIdx + 1).toLocaleString() + "–" +
        endIdx.toLocaleString() + " of " + total.toLocaleString() + " files";
    pageInfoEls.forEach(function (el) { el.textContent = infoText; });
    pagPrevEls.forEach(function (b) { b.disabled = currentPage <= 1; });
    pagNextEls.forEach(function (b) { b.disabled = currentPage >= totalPages; });
    renderPageButtons(totalPages);
  }

  // Windowed page-number buttons: 1 ... (cur-1) cur (cur+1) ... last.
  // Rebuilt per copy — buttons can't be shared between the two containers.
  function renderPageButtons(totalPages) {
    pagPagesEls.forEach(function (container, ci) {
      container.textContent = "";
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
          container.appendChild(gap);
        }
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pag-num" + (p === currentPage ? " pag-num-active" : "");
        b.textContent = String(p);
        b.addEventListener("click", function () {
          currentPage = p;
          renderPage();
          if (ci > 0) snapToTableTop();
        });
        container.appendChild(b);
        prev = p;
      });
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

  // ── paginator controls (both copies; bottom-copy clicks snap back up) ────────
  pagPrevEls.forEach(function (b, i) {
    b.addEventListener("click", function () { currentPage--; renderPage(); if (i > 0) snapToTableTop(); });
  });
  pagNextEls.forEach(function (b, i) {
    b.addEventListener("click", function () { currentPage++; renderPage(); if (i > 0) snapToTableTop(); });
  });
  pageSizeSels.forEach(function (sel, i) {
    sel.addEventListener("change", function () {
      const n = parseInt(sel.value, 10);
      if (!isNaN(n) && n > 0) pageSize = n;
      pageSizeSels.forEach(function (other) { if (other !== sel) other.value = sel.value; });
      currentPage = 1;
      renderPage();
      if (i > 0) snapToTableTop();
    });
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
      // v1.39.0: numeric compare ONLY when BOTH values are fully numeric.
      // parseFloat("2025-06-15") is 2025, so every same-year ISO date (and
      // "2023_Budget.pdf"-style filename) compared as equal and never
      // sorted. ISO timestamps order chronologically under plain string
      // comparison, so everything non-numeric goes through localeCompare.
      const numRe = /^-?\\d+(\\.\\d+)?$/;
      const aNum = typeof av === "number" || numRe.test(String(av));
      const bNum = typeof bv === "number" || numRe.test(String(bv));
      let cmp;
      if (aNum && bNum) cmp = Number(av) - Number(bv);
      else cmp = String(av).localeCompare(String(bv));
      return asc ? cmp : -cmp;
    });
    pairs.forEach(function (p) { tbody.appendChild(p.row); });
  }

  headers.forEach(function (th, colIdx) {
    // v1.39.0: placeholder columns (data-nosort) get no sort handler.
    if (th.hasAttribute("data-nosort")) return;
    th.addEventListener("click", function () {
      if (sortColIdx === colIdx) {
        sortAsc = !sortAsc;
      } else {
        sortColIdx = colIdx;
        sortAsc = true;
      }
      headers.forEach(function (h) {
        h.classList.remove("sort-asc", "sort-desc");
        if (h.hasAttribute("aria-sort")) h.setAttribute("aria-sort", "none");
      });
      th.classList.add(sortAsc ? "sort-asc" : "sort-desc");
      th.setAttribute("aria-sort", sortAsc ? "ascending" : "descending");
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
    headers[dateColIdx].setAttribute("aria-sort", "descending");
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
  // v1.33.0 — one heading sits in the always-visible inventory header and is
  // swapped here, so each view keeps its own title without two competing h2s.
  // v1.57.0 — the heading is "File accessibility" and its subtitle swaps too.
  var heading = document.getElementById("dp-inv-heading");
  var headingSub = document.getElementById("dp-inv-sub");
  if (!buttons.length || !fileViews.length || !pageView) return;
  buttons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var showPage = btn.getAttribute("data-view") === "page";
      fileViews.forEach(function (fv) { fv.hidden = showPage; });
      pageView.hidden = !showPage;
      if (heading) heading.textContent = showPage ? "Pages on this site" : "File accessibility";
      if (headingSub) headingSub.textContent = showPage
        ? "One row per page, with the files each page links to"
        : "Every file this site publishes, with its accessibility score — the remediation worklist";
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
  // v1.55.0 — the Page view paginator also renders above AND below its
  // table; ids of the bottom copy end in "-b". Same fan-out pattern as the
  // file-view script above.
  function pagEls(id) {
    return [document.getElementById(id), document.getElementById(id + "-b")]
      .filter(function (el) { return el; });
  }
  var pageInfoEls = pagEls("pv-page-info");
  var pagPrevEls = pagEls("pv-pag-prev");
  var pagNextEls = pagEls("pv-pag-next");
  var pagPagesEls = pagEls("pv-pag-pages");
  var pageSizeSels = pagEls("pv-page-size");

  function snapToTableTop() {
    var nav = pageInfoEls[0] && pageInfoEls[0].closest(".paginator");
    if (nav && nav.scrollIntoView) nav.scrollIntoView();
  }

  function renderPageButtons(totalPages) {
    pagPagesEls.forEach(function (container, ci) {
      container.textContent = "";
      if (totalPages <= 1) return;
      var want = [1, totalPages, currentPage, currentPage - 1, currentPage + 1];
      var prev = 0;
      for (var p = 1; p <= totalPages; p++) {
        if (want.indexOf(p) < 0) continue;
        if (p - prev > 1) {
          var gap = document.createElement("span");
          gap.className = "pag-gap";
          gap.textContent = "…";
          container.appendChild(gap);
        }
        var b = document.createElement("button");
        b.type = "button";
        b.className = "pag-num" + (p === currentPage ? " pag-num-active" : "");
        b.textContent = String(p);
        (function (target) {
          b.addEventListener("click", function () {
            currentPage = target;
            renderPage();
            if (ci > 0) snapToTableTop();
          });
        })(p);
        container.appendChild(b);
        prev = p;
      }
    });
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
    var infoText = total === 0
      ? "No pages"
      : "Showing " + (start + 1).toLocaleString() + "–" + end.toLocaleString() +
        " of " + total.toLocaleString() + " pages";
    pageInfoEls.forEach(function (el) { el.textContent = infoText; });
    pagPrevEls.forEach(function (b) { b.disabled = currentPage <= 1; });
    pagNextEls.forEach(function (b) { b.disabled = currentPage >= totalPages; });
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

  pagPrevEls.forEach(function (b, i) {
    b.addEventListener("click", function () { currentPage--; renderPage(); if (i > 0) snapToTableTop(); });
  });
  pagNextEls.forEach(function (b, i) {
    b.addEventListener("click", function () { currentPage++; renderPage(); if (i > 0) snapToTableTop(); });
  });
  pageSizeSels.forEach(function (sel, i) {
    sel.addEventListener("change", function () {
      var n = parseInt(sel.value, 10);
      if (!isNaN(n) && n > 0) pageSize = n;
      pageSizeSels.forEach(function (other) { if (other !== sel) other.value = sel.value; });
      currentPage = 1;
      renderPage();
      if (i > 0) snapToTableTop();
    });
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
