// HTML emitter for the orphaned-files report.
//
// Lays out: explainer block (why files become orphan) → summary tiles
// (counts, confidence distribution) → sortable table of orphan rows.

import { humanizeBytes } from "./format.js";

function htmlEscape(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(s) {
  if (typeof s !== "string") return null;
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  } catch {
    /* ignore */
  }
  return null;
}

const REASON_LABELS = {
  "strapi-hash-variant":
    "Same name + extension as a referenced file; differs only by Strapi upload hash",
  "newer-than-live":
    "Anomaly: this orphan is newer than the currently-referenced sibling",
  "same-batch":
    "Uploaded within 7 days of the referenced sibling (possibly batch-uploaded together)",
  "older-than-1yr": "Last modified more than a year ago",
};

function confidenceClass(pct) {
  if (pct >= 85) return "conf-high";
  if (pct >= 60) return "conf-medium";
  if (pct > 0) return "conf-low";
  return "conf-none";
}

function statusBadge(status) {
  if (status === "stale-revision") {
    return '<span class="status-badge status-stale">Stale revision</span>';
  }
  return '<span class="status-badge status-orphan">Truly unreferenced</span>';
}

function buildPublicUrl(entry, source) {
  if (!entry || !source) return null;
  const base = source.publicUrlBase ?? "";
  if (!base) return null;
  const prefix = source.pathPrefix
    ? `/${source.pathPrefix.replace(/^\/+|\/+$/g, "")}`
    : "";
  const path = (entry.path ?? entry.filename ?? "").replace(/^\/+/, "");
  return safeUrl(`${base.replace(/\/+$/, "")}${prefix}/${path}`);
}

function siteBreakdown(orphans, siteTotals, sourcesByServer) {
  // Aggregate orphans by site
  const bySite = new Map();
  for (const o of orphans) {
    const server = o.entry?.serverName ?? "(unknown)";
    if (!bySite.has(server)) {
      bySite.set(server, { stale: 0, truly: 0 });
    }
    const bucket = bySite.get(server);
    if (o.status === "stale-revision") bucket.stale += 1;
    else bucket.truly += 1;
  }
  // Build rows, ordered by orphan-count descending
  const rows = [];
  for (const [server, counts] of bySite) {
    const total = siteTotals.get(server) ?? 0;
    const orphanCount = counts.stale + counts.truly;
    const pct = total > 0 ? (100 * orphanCount) / total : 0;
    const source = sourcesByServer.get(server);
    const siteLabel = source?.siteName ?? server;
    rows.push({ server, siteLabel, total, orphanCount, pct, ...counts });
  }
  rows.sort((a, b) => b.orphanCount - a.orphanCount);

  const headerRow = `<tr>
    <th>Site</th><th>Total files (with refs resolved)</th>
    <th>Orphan count</th><th>% orphan</th>
    <th>Stale revision</th><th>Truly unreferenced</th>
  </tr>`;
  const bodyRows = rows
    .map((r) => {
      const pctClass = r.pct >= 20 ? "pct-high" : r.pct >= 12 ? "pct-medium" : "pct-low";
      return `<tr>
        <td>${htmlEscape(r.siteLabel)}</td>
        <td class="num">${r.total}</td>
        <td class="num">${r.orphanCount}</td>
        <td class="num ${pctClass}">${r.pct.toFixed(1)}%</td>
        <td class="num">${r.stale}</td>
        <td class="num">${r.truly}</td>
      </tr>`;
    })
    .join("\n");
  return `<section class="site-breakdown">
    <h2>Where are orphans concentrated?</h2>
    <p>Per-site orphan rate, sorted by orphan count. <strong>Healthy benchmark: ≤12%.</strong>
       Anything ≥20% is a smoking gun — almost certainly a content-type or
       cross-Strapi extraction gap rather than genuine orphan content.</p>
    <table class="site-table">
      <thead>${headerRow}</thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </section>`;
}

function summaryTiles(orphans) {
  const total = orphans.length;
  const stale = orphans.filter((o) => o.status === "stale-revision").length;
  const truly = total - stale;
  const high = orphans.filter((o) => o.replaceabilityConfidence >= 85).length;
  const medium = orphans.filter(
    (o) => o.replaceabilityConfidence >= 60 && o.replaceabilityConfidence < 85,
  ).length;
  const tiles = [
    { label: "Total orphans", value: total },
    { label: "Stale revision (likely deletable)", value: stale },
    { label: "Truly unreferenced", value: truly },
    { label: "High-confidence (≥85%)", value: high },
    { label: "Medium-confidence (60-84%)", value: medium },
  ];
  return tiles
    .map(
      (t) =>
        `<div class="tile"><div class="tile-num">${htmlEscape(
          t.value,
        )}</div><div class="tile-label">${htmlEscape(t.label)}</div></div>`,
    )
    .join("\n");
}

function tableRow(orphan, sourcesByServer) {
  const e = orphan.entry;
  const serverName = e.serverName ?? "";
  const source = sourcesByServer.get(serverName);
  const siteLabel = source?.siteName ?? serverName ?? "";
  const publicUrl = buildPublicUrl(e, source);
  const filenameCell = publicUrl
    ? `<a href="${htmlEscape(publicUrl)}" target="_blank" rel="noopener noreferrer">${htmlEscape(e.filename ?? "")}</a>`
    : htmlEscape(e.filename ?? "");
  const reasonsHtml = (orphan.reasons ?? [])
    .map((r) => {
      const label = REASON_LABELS[r] ?? r;
      return `<span class="reason-tag" title="${htmlEscape(label)}">${htmlEscape(r)}</span>`;
    })
    .join(" ");
  const confidence = orphan.replaceabilityConfidence;
  const confClass = confidenceClass(confidence);
  const replacedByHtml = orphan.replacedBy
    ? `<div class="replaced-by">${htmlEscape(orphan.replacedBy)}</div><div class="replaced-on">${htmlEscape(orphan.replacedOn ?? "")}</div>`
    : "—";
  return `<tr data-status="${htmlEscape(orphan.status)}" data-confidence="${confidence}">
  <td>${htmlEscape(siteLabel)}</td>
  <td class="filename-cell">${filenameCell}<div class="path-hint">${htmlEscape(e.path ?? "")}</div></td>
  <td>${htmlEscape(e.extension ?? "")}</td>
  <td class="size-cell" data-bytes="${e.sizeBytes ?? 0}">${htmlEscape(humanizeBytes(e.sizeBytes ?? 0))}</td>
  <td>${htmlEscape(e.modifiedAt ? e.modifiedAt.slice(0, 10) : "")}<div class="days-old">${orphan.daysOld != null ? `${orphan.daysOld}d ago` : ""}</div></td>
  <td>${statusBadge(orphan.status)}</td>
  <td class="confidence-cell ${confClass}">${confidence}%</td>
  <td>${replacedByHtml}</td>
  <td class="reasons-cell">${reasonsHtml}</td>
</tr>`;
}

const EXPLAINER = `
  <section class="explainer">
    <h2>Why does a file end up orphan?</h2>
    <p>An "orphan" is a file on the server that no Strapi entry, no page body, and no
    attachments array currently links to. This report bucks orphans into two groups
    and assigns a confidence score that the orphan is a stale upgrade-replaced version
    (safe to delete) vs. a file that was uploaded but never linked anywhere.</p>
    <h3>The five most common reasons</h3>
    <ol>
      <li><strong>Stale Strapi upload revision</strong> — Re-uploading a file to a
        Strapi UploadFile field creates a new <code>_xxxxxxxxxx.ext</code> hash
        on disk but doesn't delete the prior file. Old hash variants accumulate.</li>
      <li><strong>Manual version naming</strong> — <code>Report_v1.pdf</code>,
        <code>Report (1).pdf</code>, <code>Report copy.pdf</code>. Only the live
        version is linked; the others sit on disk.</li>
      <li><strong>Genuinely uploaded but never linked</strong> — A file was uploaded
        through the Strapi admin but never attached to a page, post, grant, or
        program entry. Common for content drafts that didn't ship.</li>
      <li><strong>Cross-Strapi reference (extraction gap)</strong> — A file is
        hosted on one site (e.g. agency.icjia-api.cloud) but referenced from a
        different Strapi backend (e.g. ari.icjia-api.cloud). The cross-resolver
        should catch these, but extraction bugs can hide cross-instance links.</li>
      <li><strong>Historical / archived</strong> — Older fiscal-year reports kept
        on disk for compliance even though the live program page only links the
        current year's file.</li>
    </ol>
    <p class="next-steps"><strong>How to use this report:</strong> sort by
    "Confidence %" descending. Anything ≥85% is high-confidence safe-to-delete
    (a clearly newer revision exists in the same upload directory). Items at
    0% confidence with status "Truly unreferenced" need human eyes — they're
    uploaded files with no link anywhere on the fleet.</p>
  </section>
`;

const STYLES = `
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 1280px; margin: 0 auto; padding: 24px; color: #222; background: #f7f7f7; }
  h1 { margin-top: 0; }
  .explainer { background: #fff; padding: 20px 28px; border-radius: 10px; border: 1px solid #e4e4e4; margin-bottom: 24px; }
  .explainer h2 { margin-top: 0; }
  .explainer p { line-height: 1.55; }
  .explainer .next-steps { background: #fffbe6; padding: 12px 16px; border-radius: 6px; border-left: 4px solid #e0b020; margin-top: 16px; }
  .tiles { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
  .tile { background: #fff; padding: 12px 16px; border-radius: 8px; border: 1px solid #e4e4e4; min-width: 180px; }
  .tile-num { font-size: 28px; font-weight: 700; }
  .tile-label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.4px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e4e4e4; border-radius: 8px; overflow: hidden; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #f0f0f0; font-size: 13px; vertical-align: top; }
  th { background: #f4f4f4; font-weight: 600; cursor: pointer; user-select: none; }
  th:hover { background: #ebebeb; }
  tr:hover { background: #fafafa; }
  .filename-cell { max-width: 380px; word-break: break-all; }
  .filename-cell a { color: #0050a0; text-decoration: none; }
  .filename-cell a:hover { text-decoration: underline; }
  .path-hint { font-size: 11px; color: #888; margin-top: 2px; }
  .size-cell { font-variant-numeric: tabular-nums; }
  .days-old { font-size: 11px; color: #888; margin-top: 2px; }
  .status-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
  .status-stale { background: #e8f0ff; color: #0050a0; }
  .status-orphan { background: #fff0e8; color: #c04000; }
  .confidence-cell { font-weight: 700; font-variant-numeric: tabular-nums; }
  .conf-high { color: #1a8055; }
  .conf-medium { color: #b07020; }
  .conf-low { color: #a44; }
  .conf-none { color: #888; }
  .replaced-by { font-size: 12px; word-break: break-all; }
  .replaced-on { font-size: 11px; color: #888; }
  .reasons-cell { max-width: 260px; }
  .reason-tag { display: inline-block; background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; margin-bottom: 2px; color: #444; }
  .site-breakdown { background: #fff; padding: 20px 28px; border-radius: 10px; border: 1px solid #e4e4e4; margin-bottom: 24px; }
  .site-breakdown h2 { margin-top: 0; }
  .site-table th, .site-table td { padding: 6px 10px; }
  .site-table .num { text-align: right; font-variant-numeric: tabular-nums; }
  .pct-high { color: #c04000; font-weight: 700; }
  .pct-medium { color: #b07020; font-weight: 600; }
  .pct-low { color: #1a8055; }
  .toolbar { margin-bottom: 12px; }
  .toolbar input { padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; min-width: 280px; font-size: 13px; }
`;

const TABLE_SCRIPT = `
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const idx = Array.from(th.parentElement.children).indexOf(th);
      const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
      th.dataset.dir = dir;
      const tbody = th.closest('table').querySelector('tbody');
      const rows = Array.from(tbody.children);
      rows.sort((a, b) => {
        const av = a.children[idx]?.dataset.bytes ?? a.children[idx]?.dataset.confidence ?? a.children[idx]?.textContent.trim();
        const bv = b.children[idx]?.dataset.bytes ?? b.children[idx]?.dataset.confidence ?? b.children[idx]?.textContent.trim();
        const an = Number(av), bn = Number(bv);
        const cmp = !Number.isNaN(an) && !Number.isNaN(bn) ? an - bn : String(av).localeCompare(String(bv));
        return dir === 'asc' ? cmp : -cmp;
      });
      tbody.replaceChildren(...rows);
    });
  });
  const filterInput = document.getElementById('orphan-filter');
  if (filterInput) {
    filterInput.addEventListener('input', () => {
      const q = filterInput.value.toLowerCase();
      document.querySelectorAll('tbody tr').forEach((tr) => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }
`;

export function writeOrphansHtml({
  orphans,
  sources = [],
  siteTotals = new Map(),
  backHref = "index.html",
}) {
  const sourcesByServer = new Map();
  for (const s of sources) {
    if (s.serverName) sourcesByServer.set(s.serverName, s);
  }
  // Default sort: confidence desc.
  const sorted = [...orphans].sort(
    (a, b) =>
      b.replaceabilityConfidence - a.replaceabilityConfidence ||
      (b.daysOld ?? 0) - (a.daysOld ?? 0),
  );
  const rows = sorted.map((o) => tableRow(o, sourcesByServer)).join("\n");
  const totalCount = orphans.length;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Orphaned files report (${totalCount})</title>
  <style>${STYLES}</style>
</head>
<body>
  <p><a href="${htmlEscape(backHref)}">&larr; Back to fleet index</a></p>
  <h1>Orphaned files (${totalCount})</h1>
  <p>Files on the server that no Strapi entry, page body, or attachments array currently references.</p>
  ${EXPLAINER}
  <div class="tiles">${summaryTiles(orphans)}</div>
  ${siteBreakdown(orphans, siteTotals, sourcesByServer)}
  <div class="toolbar">
    <input id="orphan-filter" type="search" placeholder="Filter by site, filename, status, reason…" autocomplete="off" />
  </div>
  <table>
    <thead>
      <tr>
        <th data-sort="site">Site</th>
        <th data-sort="filename">Filename / Path</th>
        <th data-sort="type">Type</th>
        <th data-sort="size">Size</th>
        <th data-sort="modified">Modified</th>
        <th data-sort="status">Status</th>
        <th data-sort="confidence">Confidence %</th>
        <th data-sort="replaced">Replaced by</th>
        <th data-sort="reasons">Reasons</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <script>${TABLE_SCRIPT}</script>
</body>
</html>
`;
}
