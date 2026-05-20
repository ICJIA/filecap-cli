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
    <h2>Why orphan files exist (and why some rate is normal)</h2>

    <p>An "orphan" is a file present on the server that no Strapi entry currently
    references — not in any <code>attachments</code> list, not in any URL-typed
    field, and not as an absolute URL in any entry's body markdown.</p>

    <p>We verified that the <strong>Nuxt frontend (icjia.illinois.gov) only renders
    files it pulls from Strapi at runtime</strong> — it never hardcodes file URLs
    in source. So if a file isn't referenced from a Strapi entry, it isn't being
    served from any public page. It really is orphan.</p>

    <p>Across a 5+ year fleet of continuously-edited content, some orphan
    rate is expected. Each of the following is a normal content-lifecycle event
    that produces orphan files:</p>

    <table class="lifecycle-table">
      <thead>
        <tr>
          <th>How it became orphan</th>
          <th>What it looks like</th>
          <th>Disposition</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Stale Strapi revision</strong></td>
          <td>Re-uploading a file to a Strapi <code>UploadFile</code> field creates a
              new <code>_xxxxxxxxxx.ext</code> hash on disk; the prior hash stays
              orphaned. On agency.icjia-api.cloud, re-uploads of already-hashed
              filenames create double-hashed orphans
              (<code>foo_HASH1_HASH2.pdf</code>).</td>
          <td><strong>Safe to delete</strong> when the fuzzy matcher finds a live
              sibling (≥85% confidence).</td>
        </tr>
        <tr>
          <td><strong>Replaced agenda / attachment</strong></td>
          <td>Staff swapped an old draft for a new one in a meeting or grant's
              attachments list. Old file lives on disk; entry still references
              only the new one.</td>
          <td><strong>Safe to delete</strong> when fuzzy-matched (60-84% confidence
              when the swap was close in time to the live sibling).</td>
        </tr>
        <tr>
          <td><strong>Deleted entry</strong></td>
          <td>A meeting, grant, or post entry was deleted entirely. Its attachments
              stayed on disk.</td>
          <td><strong>Needs human review</strong> — was the entry deleted on purpose?
              If yes, the orphan attachments are too.</td>
        </tr>
        <tr>
          <td><strong>Manual version naming</strong></td>
          <td><code>Report_v1.pdf</code>, <code>Report (1).pdf</code>,
              <code>Report copy.pdf</code>, "NEW_" prefixed agendas. Only the live
              version is attached.</td>
          <td><strong>Safe to delete</strong> when fuzzy-matched.</td>
        </tr>
        <tr>
          <td><strong>Genuinely uploaded but never linked</strong></td>
          <td>Admin uploaded a file through the Strapi backend but forgot to attach
              it to a page or entry. Singleton on disk, no sibling.</td>
          <td><strong>Needs human review</strong> — file has no live reference and
              no clear replacement.</td>
        </tr>
      </tbody>
    </table>

    <h3 class="action-guide-h">How to act on this report</h3>
    <ul class="action-guide">
      <li><strong>Confidence ≥85% (high)</strong> — A clearly newer, currently-referenced
          revision of this file exists. Safe to delete with high confidence.</li>
      <li><strong>Confidence 60-84% (medium)</strong> — A live sibling exists but the
          time gap is short (within 30 days) or the match wasn't a clean Strapi-hash
          variant. Spot-check that the live file really supersedes this one before
          deleting.</li>
      <li><strong>Confidence 0-59% (low / none)</strong> — Either no live sibling
          exists, or this file is somehow newer than the referenced sibling
          (anomaly). Treat as "truly unreferenced" and decide manually whether
          it's still needed for compliance/archive.</li>
    </ul>

    <p class="next-steps"><strong>Recommended workflow:</strong> sort by
    "Confidence %" descending. The top of the table is your safe-to-delete list.
    The bottom is your manual-review list. The "Replaced by" column shows which
    currently-attached file supersedes each orphan — open both side-by-side to
    confirm before bulk-deleting.</p>
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
  /* WCAG 1.4.1 — in-text links (the filename anchors live in running table
     text) must not rely on color alone, so they stay underlined, not just
     on hover. */
  .filename-cell a { color: #0050a0; text-decoration: underline; }
  /* Muted/secondary text colors below are tuned for this report's LIGHT
     background (#f7f7f7 page, #fff cards/table). #888 fails WCAG 1.4.3 AA
     here (3.5:1 on white); #595959 clears it at ~7:1 while still reading
     as muted next to the #222 body text. */
  .path-hint { font-size: 11px; color: #595959; margin-top: 2px; }
  .size-cell { font-variant-numeric: tabular-nums; }
  .days-old { font-size: 11px; color: #595959; margin-top: 2px; }
  .status-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
  .status-stale { background: #e8f0ff; color: #0050a0; }
  .status-orphan { background: #fff0e8; color: #c04000; }
  .confidence-cell { font-weight: 700; font-variant-numeric: tabular-nums; }
  .conf-high { color: #1a8055; }
  .conf-medium { color: #92590c; }
  .conf-low { color: #a44; }
  .conf-none { color: #595959; }
  .replaced-by { font-size: 12px; word-break: break-all; }
  .replaced-on { font-size: 11px; color: #595959; }
  .reasons-cell { max-width: 260px; }
  .reason-tag { display: inline-block; background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; margin-bottom: 2px; color: #444; }
  .site-breakdown { background: #fff; padding: 20px 28px; border-radius: 10px; border: 1px solid #e4e4e4; margin-bottom: 24px; }
  .site-breakdown h2 { margin-top: 0; }
  .site-table th, .site-table td { padding: 6px 10px; }
  .site-table .num { text-align: right; font-variant-numeric: tabular-nums; }
  .pct-high { color: #c04000; font-weight: 700; }
  .pct-medium { color: #92590c; font-weight: 600; }
  .pct-low { color: #1a8055; }
  .lifecycle-table { width: 100%; margin: 16px 0; border-collapse: collapse; }
  .lifecycle-table th, .lifecycle-table td { padding: 8px 12px; border-bottom: 1px solid #eee; vertical-align: top; text-align: left; font-size: 13px; line-height: 1.5; }
  .lifecycle-table th { background: #fafafa; font-weight: 600; }
  .lifecycle-table td:first-child { width: 200px; }
  .lifecycle-table td:last-child { width: 200px; }
  .action-guide-h { margin-top: 18px; }
  .action-guide { line-height: 1.6; }
  .action-guide li { margin-bottom: 8px; }
  .toolbar { margin-bottom: 12px; }
  .toolbar input { padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; min-width: 280px; font-size: 13px; }
  .paginator { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; margin: 12px 0; font-size: 13px; color: #444; }
  .pag-info { font-weight: 600; }
  .pag-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
  .pag-size { color: #666; }
  .pag-size select { padding: 3px 6px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; margin-left: 4px; }
  .pag-btn, .pag-num { background: #fff; color: #0050a0; border: 1px solid #ccc; border-radius: 4px; padding: 3px 9px; font-size: 13px; cursor: pointer; }
  .pag-btn:hover:not(:disabled), .pag-num:hover { background: #eef4fb; }
  .pag-btn:disabled { opacity: 0.45; cursor: default; }
  .pag-num-active, .pag-num-active:hover { background: #0050a0; color: #fff; border-color: #0050a0; font-weight: 700; }
  .pag-pages { display: inline-flex; gap: 4px; align-items: center; }
  .pag-gap { color: #595959; padding: 0 1px; }
`;

const TABLE_SCRIPT = `
  (function () {
    const table = document.getElementById('orphan-table');
    const tbody = table ? table.querySelector('tbody') : null;
    if (!tbody) return;
    const allRows = Array.from(tbody.children);
    let matched = allRows.slice();
    let pageSize = 25;
    let currentPage = 1;

    const pageInfo = document.getElementById('page-info');
    const pagPrev = document.getElementById('pag-prev');
    const pagNext = document.getElementById('pag-next');
    const pagPages = document.getElementById('pag-pages');
    const pageSizeSel = document.getElementById('page-size');
    const filterInput = document.getElementById('orphan-filter');

    function renderPageButtons(totalPages) {
      if (!pagPages) return;
      pagPages.textContent = '';
      if (totalPages <= 1) return;
      const want = [1, totalPages, currentPage, currentPage - 1, currentPage + 1];
      let prev = 0;
      for (let p = 1; p <= totalPages; p++) {
        if (want.indexOf(p) < 0) continue;
        if (p - prev > 1) {
          const gap = document.createElement('span');
          gap.className = 'pag-gap';
          gap.textContent = '…';
          pagPages.appendChild(gap);
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pag-num' + (p === currentPage ? ' pag-num-active' : '');
        b.textContent = String(p);
        const target = p;
        b.addEventListener('click', () => { currentPage = target; renderPage(); });
        pagPages.appendChild(b);
        prev = p;
      }
    }

    function renderPage() {
      const total = matched.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      if (currentPage > totalPages) currentPage = totalPages;
      if (currentPage < 1) currentPage = 1;
      const start = (currentPage - 1) * pageSize;
      const end = Math.min(start + pageSize, total);
      allRows.forEach((r) => { r.style.display = 'none'; });
      for (let i = start; i < end; i++) matched[i].style.display = '';
      if (pageInfo) {
        pageInfo.textContent = total === 0
          ? 'No matching files'
          : 'Showing ' + (start + 1).toLocaleString() + '–' + end.toLocaleString() +
            ' of ' + total.toLocaleString() + ' orphans';
      }
      if (pagPrev) pagPrev.disabled = currentPage <= 1;
      if (pagNext) pagNext.disabled = currentPage >= totalPages;
      renderPageButtons(totalPages);
    }

    function applyFilter() {
      const q = filterInput ? filterInput.value.toLowerCase() : '';
      matched = Array.from(tbody.children).filter(
        (tr) => !q || tr.textContent.toLowerCase().includes(q),
      );
      currentPage = 1;
      renderPage();
    }

    document.querySelectorAll('th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const idx = Array.from(th.parentElement.children).indexOf(th);
        const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
        th.dataset.dir = dir;
        const rows = allRows.slice();
        rows.sort((a, b) => {
          const av = a.children[idx]?.dataset.bytes ?? a.children[idx]?.dataset.confidence ?? a.children[idx]?.textContent.trim();
          const bv = b.children[idx]?.dataset.bytes ?? b.children[idx]?.dataset.confidence ?? b.children[idx]?.textContent.trim();
          const an = Number(av), bn = Number(bv);
          const cmp = !Number.isNaN(an) && !Number.isNaN(bn) ? an - bn : String(av).localeCompare(String(bv));
          return dir === 'asc' ? cmp : -cmp;
        });
        tbody.replaceChildren(...rows);
        applyFilter();
      });
    });

    if (filterInput) filterInput.addEventListener('input', applyFilter);
    if (pagPrev) pagPrev.addEventListener('click', () => { currentPage--; renderPage(); });
    if (pagNext) pagNext.addEventListener('click', () => { currentPage++; renderPage(); });
    if (pageSizeSel) pageSizeSel.addEventListener('change', () => {
      const n = parseInt(pageSizeSel.value, 10);
      if (!isNaN(n) && n > 0) pageSize = n;
      currentPage = 1;
      renderPage();
    });

    applyFilter();
  })();
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
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%230d1117'/><path d='M12 9L12 23L23 16Z' fill='%23ffb000'/></svg>">
  <style>${STYLES}</style>
</head>
<body>
<main>
  <p><a href="${htmlEscape(backHref)}">&larr; Back to fleet index</a></p>
  <h1>Orphaned files (${totalCount})</h1>
  <p>Files on the server that no Strapi entry, page body, or attachments array currently references.</p>
  ${EXPLAINER}
  <div class="tiles">${summaryTiles(orphans)}</div>
  ${siteBreakdown(orphans, siteTotals, sourcesByServer)}
  <div class="toolbar">
    <input id="orphan-filter" type="search" placeholder="Filter by site, filename, status, reason…" autocomplete="off" />
  </div>
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
  <table id="orphan-table">
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
</main>
  <script>${TABLE_SCRIPT}</script>
</body>
</html>
`;
}
