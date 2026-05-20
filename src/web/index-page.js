import { injectPasswordGate } from "./password-gate.js";
import { fmtChicagoDateTime, fmtChicagoDate, fmtChicagoGeneratedAt } from "../util/time.js";

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

// 1.7.37 — Time formatting delegated to src/util/time.js. All
// user-visible timestamps now display in Chicago time (America/Chicago,
// DST-aware) with an explicit "Chicago time" label. Raw NDJSON
// timestamps remain ISO 8601 UTC; conversion happens at the rendering
// layer. These wrappers keep the original local-function names so the
// rest of this module's call sites don't need touching.
const fmtDate = fmtChicagoDateTime;
const fmtAuditDate = fmtChicagoDate;
const fmtGeneratedAt = fmtChicagoGeneratedAt;

/**
 * Render a single site card for managers.
 *
 * @param {object} sr - siteResult entry
 * @returns {string}
 */
/* v1.7.21 — "For AI models" section. Two read-only files sit next to the
   master CSV: a consolidated NDJSON and a context.md. Together they let
   someone using an AI tool (Claude, ChatGPT, Gemini, Copilot, etc.) ask
   questions about the fleet inventory without having to load 9 MB of CSV
   into a spreadsheet and hand-filter. The tone is deliberately matter-of-
   fact + forward-looking: the user's office may or may not permit AI tool
   use yet, but if/when that changes, these files are ready to be uploaded.
   The CSV remains the actionable artefact. */
function renderLlmContextSection(llmContext) {
  if (!llmContext || !llmContext.ndjsonFilename) return "";
  const ndjsonSize = humanBytes(llmContext.ndjsonByteCount ?? 0);
  const mdSize = humanBytes(llmContext.contextMdByteCount ?? 0);
  return `
  <section class="section llm-context" aria-labelledby="llm-context-heading">
    <header class="llm-context-head">
      <p class="llm-context-eyebrow">Optional · for AI models</p>
      <h2 id="llm-context-heading">For AI models</h2>
    </header>
    <p class="llm-context-lead">If your office permits using AI tools like Claude, ChatGPT, Gemini, or Copilot, you can upload these two files to a chat session and ask questions about the audit. <strong>This is optional.</strong> The CSV spreadsheets above are the actionable files — that's the workflow staff use to mark which files should be removed. The two files in this section are <strong>read-only</strong> and exist for AI-assisted analysis.</p>

    <p class="llm-context-future"><strong>Why this is here.</strong> State-agency policy on AI tool use is still evolving. Today, your office may or may not allow uploading files to AI chat tools — that's your call, governed by your office's data-handling rules. We're including these files because in 6–12 months, AI-assisted analysis of audits like this one is likely to be much more routine, and we'd rather have them in the bundle now than try to add them later. If you don't use AI tools, you can ignore this section entirely; nothing about the rest of the audit changes.</p>

    <div class="llm-context-files">
      <a class="llm-context-file" href="${he(llmContext.ndjsonFilename)}" download>
        <span class="llm-context-file-name" role="heading" aria-level="3">${he(llmContext.ndjsonFilename)}</span>
        <span class="llm-context-file-meta">${he(ndjsonSize)} · the full data</span>
        <span class="llm-context-file-desc">One JSON object per file across every site. Includes everything the spreadsheets do, plus the PDF / Word / Excel details the spreadsheets leave out (page counts, image-only flag, heading coverage, alt-text coverage, etc.).</span>
      </a>
      <a class="llm-context-file" href="${he(llmContext.contextMdFilename)}" download>
        <span class="llm-context-file-name" role="heading" aria-level="3">${he(llmContext.contextMdFilename)}</span>
        <span class="llm-context-file-meta">${he(mdSize)} · the narrative</span>
        <span class="llm-context-file-desc">A short readable summary of the audit (total counts, per-site breakdown), a schema description for the NDJSON, and a few sample prompts you can paste into the AI tool to get started.</span>
      </a>
    </div>

    <details class="llm-context-howto">
      <summary>How to use these (if you want to)</summary>
      <ol class="llm-context-steps">
        <li><strong>Confirm with your office</strong> that uploading file inventories to an AI chat tool is allowed. This audit contains site / file structure data; check your office's data-handling policy before uploading anywhere.</li>
        <li><strong>Open the AI tool you use</strong> (Claude.ai, ChatGPT, Gemini, etc.). Start a new chat.</li>
        <li><strong>Attach both files</strong> using the tool's file-upload button. Upload the <code>${he(llmContext.contextMdFilename)}</code> first so the AI reads the narrative + schema; then upload <code>${he(llmContext.ndjsonFilename)}</code> as the actual data.</li>
        <li><strong>Ask questions</strong> in plain English. Example starter prompts are inside <code>${he(llmContext.contextMdFilename)}</code>. The AI will read the data file and answer based on what's actually in your audit.</li>
      </ol>
      <p class="llm-context-actionable-reminder"><strong>The CSVs are still the actionable files.</strong> If the AI suggests "let me mark these files for deletion," redirect it to the <code>audit-file-list-master.csv</code> file — that's where the <code>Delete?</code> and <code>Notes</code> columns live, and that's the file staff hands back to the audit team to actually remove flagged files. The AI files exist for asking and learning, not for changing.</p>
    </details>
  </section>`;
}

function renderMasterCsvSection(masterCsv) {
  if (!masterCsv || !masterCsv.filename) return "";
  const fileCount = masterCsv.fileCount ?? 0;
  const byteCount = masterCsv.byteCount ?? 0;
  const lastAudit = masterCsv.lastAuditAt ? fmtAuditDate(masterCsv.lastAuditAt) : "";
  return `
  <section class="section master-csv">
    <h2>Master spreadsheet — every file across every server</h2>
    <p>If you'd rather skim a single spreadsheet instead of per-site files, this combined CSV has every file from every server above in one row-per-file table. Same columns as the per-site spreadsheets, plus a "Server" column at the front so you can tell which website each row came from. The CSV also has two empty columns — <strong>Delete?</strong> and <strong>Notes</strong> — for staff to mark which files should be removed and why before the next audit. Put <code>X</code>, <code>YES</code>, or anything non-blank in the Delete? cell for any file you want removed.</p>
    <p class="master-csv-download">
      <a class="cta-button" href="${he(masterCsv.filename)}" download>
        Download <strong>${he(masterCsv.filename)}</strong>
      </a>
      <span class="master-csv-meta">${he(fileCount.toLocaleString())} files · ${he(humanBytes(byteCount))}</span>
    </p>
    ${lastAudit ? `<p class="master-csv-last-audit">Last audit: <strong>${he(lastAudit)}</strong></p>` : ""}
  </section>`;
}

function renderOrphansSection(orphans) {
  if (!orphans || !orphans.htmlFilename) return "";
  return `
  <section class="section orphans">
    <h2>Orphaned files</h2>
    <p>${he(orphans.orphanCount)} files on the fleet had no detectable references after cross-resolution. ${he(orphans.staleRevisionCount)} look like upgrade-replaced stale revisions (a newer version of the same logical file is still attached). ${he(orphans.trulyUnreferencedCount)} are truly unreferenced — uploaded and never linked.</p>
    <ul class="action-list">
      <li><a href="${he(orphans.htmlFilename)}">Open orphan report (HTML)</a> — sortable table with per-site breakdown, confidence scores, fuzzy-match replacements, reason flags.</li>
      <li><a href="${he(orphans.csvFilename)}" download>Download orphan report (CSV, ${humanBytes(orphans.csvByteCount ?? 0)})</a> — pivot in Excel/Sheets.</li>
    </ul>
  </section>
`;
}

function renderDuplicatesSection(groups, duplicatesCsv) {
  if (!groups || groups.length === 0) return "";

  // v1.7.19: classify each duplicate group's filename so the on-page table
  // can be filtered "Remediable only / Reference only / All" — the same
  // remediable/reference split filecap uses on the per-site detail page.
  // v1.7.20: also compute per-bucket exact/variant breakdowns so the hero
  // tiles can reflect whichever filter the user has active. Default state
  // is "remediable" — managers see the actionable number first, with a
  // tiny note explaining which kinds count.
  const REMEDIABLE_EXT = new Set(["pdf", "docx", "xlsx", "pptx", "doc", "xls", "ppt"]);
  function sideForFilename(name) {
    const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    const ext = m ? m[1] : "";
    return REMEDIABLE_EXT.has(ext) ? "remediable" : "reference";
  }
  const stats = {
    all:        { total: 0, exact: 0, variant: 0 },
    remediable: { total: 0, exact: 0, variant: 0 },
    reference:  { total: 0, exact: 0, variant: 0 },
  };
  for (const g of groups) {
    const side = sideForFilename(g.normalizedFilename);
    const kind = g.isExactDuplicate ? "exact" : "variant";
    stats.all.total++;          stats.all[kind]++;
    stats[side].total++;        stats[side][kind]++;
  }
  // Initial render values use the remediable bucket — matches the default
  // filter on the table below.
  const dupTotalCount     = stats.remediable.total;
  const exactCount        = stats.remediable.exact;
  const variantCount      = stats.remediable.variant;
  const dupRemediableCount = stats.remediable.total;
  const dupReferenceCount  = stats.reference.total;

  // One row per group — easier to scan than the per-item-row version. The
  // per-occurrence detail lives in audit-file-duplicates.csv for pivot work.
  const groupRows = groups.map((g) => {
    const items = g.items ?? [];
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
    const sitesText = items.map((i) => i.siteName || i.serverName || "").join(", ");
    const side = sideForFilename(g.normalizedFilename);
    // v1.12.1: HTML table trimmed to the essential columns; the full
    // per-occurrence detail (dates, sizes) stays in audit-file-duplicates.csv.
    return `<tr data-dup-side="${he(side)}">
      <td title="${he(g.normalizedFilename)}">${he(g.normalizedFilename)}</td>
      <td>${matchBadge}</td>
      <td title="${he(sitesText)}">${sites}</td>
      <td class="num">${he(String(items.length))}</td>
    </tr>`;
  });

  // v1.7.17: the duplicates CSV download was pulled (the file is still
  // generated server-side and accessible via direct URL for the audit lead,
  // but it's no longer surfaced as a button on the index page). Reasoning:
  // duplicate removal is meaningfully trickier than removing a unique file,
  // and surfacing a downloadable worksheet implies "go act on this list,"
  // which is not what we want staff to do without per-site reference checks.
  // The on-page table stays — managers should still SEE that duplicates
  // exist; they just shouldn't be invited to action them via spreadsheet.
  const infoOnlyCalloutHtml = `<aside class="dup-info-only" role="note" aria-label="Duplicate handling — for information only">
    <p class="dup-info-only-eyebrow">For information only</p>
    <h3 class="dup-info-only-title">Don&#39;t treat this list as a delete-worksheet</h3>
    <p>Removing a duplicate looks like a free win — same file on three sites, surely two of them can go. It isn&#39;t. Removing <strong>any</strong> file can break the page that links to it (a 404), and duplicates carry extra risk on top of that:</p>
    <ol class="dup-info-only-reasons">
      <li><strong>N-times the search surface.</strong> A unique file might be linked from one site&#39;s HTML. A file present on three servers might be linked from three sites&#39; HTML — you have to check all three before touching any copy.
        <p class="dup-info-only-plain"><em>What does "N-times" mean?</em> <strong>N</strong> is just a placeholder for "however many copies of this file exist." Software engineers use <strong>Big&nbsp;O notation</strong> like <code>O(N)</code> to describe how the work grows with the size of the problem. <code>O(N)</code> means the effort scales <em>linearly</em>: if a file is on 3 sites, you do roughly 3&times; the reference-checking work; on 5 sites, 5&times;. (Compare <code>O(1)</code>, which means the work is the same no matter how many copies there are — that&#39;s not the case here.) The practical implication for a manager: budget review time per duplicate as <strong>roughly 5&ndash;15&nbsp;minutes per copy</strong>, because each copy needs its own site walked for incoming links before you can decide whether removal is safe.</p>
      </li>
      <li><strong>"Wrong copy" risk.</strong> SHA-256 equality only tells you the bytes match. It doesn&#39;t tell you which copy is the canonical one. If Site A links to it and Site B doesn&#39;t, the obvious move is "delete from B" — but if B was the original and A&#39;s link is the stale one, you just removed the wrong copy.</li>
      <li><strong>Asymmetric references.</strong> Two copies can be linked from completely different contexts (one from a meeting-agendas page, the other from an annual-reports archive). Deleting either causes a 404 somewhere; neither is obviously safer than the other without looking.</li>
    </ol>
    <p>Site editors in their own CMS only see references on their own site — they can&#39;t independently judge "safe to delete on my site" because they don&#39;t see the cross-site references. <strong>Treat this section as awareness, not action.</strong> Cross-server consolidation requires per-site reference-checking before any file is removed.</p>
  </aside>`;

  return `
  <section class="section duplicates">
    <!-- v1.7.22: big section banner so the eye sees a clear "new section starts here"
         break after the For-AI-models block. The amber accent bar echoes the
         duplicates section's existing color register (warning/notice yellow). -->
    <div class="dup-section-banner" role="presentation">
      <p class="dup-section-eyebrow">Section · Duplicates</p>
      <h2 class="dup-section-headline">Cross-Server Duplicates</h2>
      <p class="dup-section-lede">Files that appear on more than one ICJIA site — why that&#39;s almost always normal, when it&#39;s intentional, and why removing any single copy needs careful per-site reference checks before anything is deleted.</p>
    </div>

    <header class="dup-hero" data-dup-stats='${JSON.stringify(stats).replace(/</g, "\\u003c").replace(/'/g, "&#39;")}' data-dup-active="remediable">
      <h3 class="dup-title"><span data-dup-stat="total">${he(dupTotalCount.toLocaleString())}</span> files appear on more than one site</h3>
      <p class="dup-counting-note"><strong>Counting only files that may need accessibility remediation</strong> — PDFs, Word, Excel, PowerPoint, legacy Office. Images, text, markdown, and other reference files are duplicated too but they don&#39;t affect audit scope, so they&#39;re excluded from the headline number. Change the filter below the explainer to see all duplicates or only reference files.</p>
      <p class="dup-subtitle"><strong>This is normal — not a webmaster error.</strong> The same PDF might be linked from DVFR, ICJIA, and the Archive simultaneously, and a copy lives on each site. We&#39;re listing them here so you can <strong>remediate the file once and push the fix to every site that hosts it</strong>, instead of paying a vendor to remediate the same document three times.</p>
      <div class="dup-stat-tiles">
        <div class="dup-tile dup-tile-exact">
          <span class="dup-tile-num" data-dup-stat="exact">${he(exactCount.toLocaleString())}</span>
          <span class="dup-tile-lbl" data-dup-stat-label="exact">${exactCount === 1 ? "exact copy" : "exact copies"}</span>
          <span class="dup-tile-sub">same filename, same content on every site</span>
        </div>
        <div class="dup-tile dup-tile-variant">
          <span class="dup-tile-num" data-dup-stat="variant">${he(variantCount.toLocaleString())}</span>
          <span class="dup-tile-lbl" data-dup-stat-label="variant">${variantCount === 1 ? "variant" : "variants"}</span>
          <span class="dup-tile-sub">same filename, content differs between sites</span>
        </div>
      </div>
    </header>

    ${infoOnlyCalloutHtml}

    <!-- v1.7.24: explainer compressed into one cohesive block. Same info as
         the previous five-callout layout (historical context, not-an-error,
         intentional duplicates, exact/variant cards, false-positives caveat),
         but consolidated into three tight paragraphs + the kind-cards (the
         most useful visual) + a collapsed false-positives <details>. Single
         visual register — no per-paragraph colored borders — so the eye
         lands on the typography contrast (h3 + inline strong), not on a
         rainbow of callout backgrounds. -->
    <section class="dup-explainer">
      <h3 class="dup-explainer-h3">Why this list exists</h3>

      <p>ICJIA's web presence evolved over many years. The Archive site was historically the agency's <em>library</em> — a single repository for reports, meeting minutes, and reference documents. Over time, individual programs (DVFR, R3, ICJIA, ILFVCC, i2i, Infonet, Intranet) got their own websites, and copies of relevant Archive files were placed into each program's CMS so they'd appear in context. Files were sometimes updated on one server but not the others, which is why a "duplicate" pair may have <strong>different content even though the filename matches</strong>. <code>.gitkeep</code> and <code>.gitignore</code> placeholders are filtered out.</p>

      <p><strong>A duplicate is not an error</strong> — it's almost always the same document deliberately published on more than one site. <strong>Many duplicates are intentional and required</strong>: a DVFR board agenda is posted on the DVFR site <em>and</em> on the main ICJIA site (Open Meetings Act compliance, plus stakeholder findability). Someone looking up "when's the next DVFR meeting?" on dvfr.illinois.gov shouldn't have to know to also visit icjia.illinois.gov. Same logic applies anywhere a document needs to live on multiple sites for discoverability.</p>

      <p>Use this list as a <strong>cross-check</strong>, not a deletion queue.</p>

      <div class="dup-kind-cards">
        <div class="dup-kind-card dup-kind-card-exact">
          <h4 class="dup-kind-card-h4"><span class="dup-kind dup-exact">exact</span> &mdash; same content on every site</h4>
          <p>Byte-for-byte identical file in N places. <strong>Remediate once</strong> on the canonical copy (typically the newest or most-linked one), then push the corrected file to the other sites' CMSes using the same filename. <strong>Don't delete the duplicates</strong> — most are referenced by CMS entries on each site; removing them would break the link. The goal is "one corrected file appearing in N places," not "one file existing in one place."</p>
        </div>
        <div class="dup-kind-card dup-kind-card-variant">
          <h4 class="dup-kind-card-h4"><span class="dup-kind dup-variant">variant</span> &mdash; same filename, different content</h4>
          <p>The file was edited on one server, others still hold the older version. <strong>Each variant may need its own remediation pass</strong>. Open each in the table below to check whether they're truly distinct documents or whether one is the canonical version the others should be replaced with. Then either remediate all variants individually, or remediate the canonical one and overwrite the others (treating it like an <em>exact</em> case going forward).</p>
        </div>
      </div>

      <details class="dup-caveat-details">
        <summary>Heads up on false positives in <em>variant</em> matches</summary>
        <p>Cross-server matching strips Strapi's appended 10-character hex hash before comparing filenames (so <code>report_a1b2c3d4e5.pdf</code> matches <code>report_xxxxxxxxxx.pdf</code>). Two unrelated files that follow the same naming convention before the hash can be flagged as a <em>variant</em> here even though they're logically different documents. The <em>exact</em> match (same content hash) is the high-confidence signal; <em>variant</em> matches are worth opening to confirm.</p>
      </details>
    </section>

    <details class="dup-table-details" open>
      <summary>Summary table — ${he(groups.length.toLocaleString())} filename groups (one row each)</summary>
      <div class="dup-filter-bar" role="group" aria-label="Filter duplicates by file kind">
        <p class="dup-filter-help">For managers and auditors, the remediable files (PDFs, Word, Excel, PowerPoint, legacy Office) are the ones that matter for accessibility scope. Reference files (images, text, archives, web pages) are listed here for completeness — vendors don't usually quote against them.</p>
        <div class="dup-filter-chips" data-dup-filter-bar>
          <button type="button" class="dup-filter-chip is-active" data-dup-filter="remediable" aria-pressed="true">Remediable only <span class="dup-filter-count">${he(dupRemediableCount.toLocaleString())}</span></button>
          <button type="button" class="dup-filter-chip" data-dup-filter="reference" aria-pressed="false">Reference only <span class="dup-filter-count">${he(dupReferenceCount.toLocaleString())}</span></button>
          <button type="button" class="dup-filter-chip" data-dup-filter="all" aria-pressed="false">All <span class="dup-filter-count">${he(groups.length.toLocaleString())}</span></button>
        </div>
      </div>
      <nav class="paginator" aria-label="Duplicate table pagination">
        <span class="pag-info" id="dup-page-info"></span>
        <span class="pag-controls">
          <label class="pag-size">Rows per page
            <select id="dup-page-size">
              <option value="25" selected>25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
          <button type="button" id="dup-pag-prev" class="pag-btn">&larr; Prev</button>
          <span class="pag-pages" id="dup-pag-pages"></span>
          <button type="button" id="dup-pag-next" class="pag-btn">Next &rarr;</button>
        </span>
      </nav>
      <div class="dup-pan-wrap" data-dup-pan data-dup-active-filter="remediable">
        <table class="dup-table">
          <thead>
            <tr>
              <th scope="col" class="dup-col-filename">Filename (normalised)</th>
              <th scope="col" class="dup-col-match">Match</th>
              <th scope="col" class="dup-col-sites">Sites</th>
              <th scope="col" class="dup-col-copies">Copies</th>
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

/**
 * v1.7.30 — "Coming soon" / in-development section at the bottom of the
 * fleet index. Mirrors the layout register of the fleet + duplicates
 * section banners (eyebrow + clamped headline + lede + accent bar), but
 * with a violet accent so the eye reads it as a third visual category:
 * not "current state" (blue), not "warning / awareness" (amber), but
 * "upcoming." v1.12.2: the reference-discovery items shipped; this now
 * previews the two upcoming features — the Page view and fuzzy search.
 */
function renderTodoSection() {
  return `
  <section class="section todo">
    <div class="todo-section-banner" role="presentation">
      <p class="todo-section-eyebrow">Section · Coming soon</p>
      <h2 class="todo-section-headline">What's next for this audit</h2>
      <p class="todo-section-lede">Two new ways to explore the same audit data are in active development and will appear in upcoming releases. The numbers don&#39;t change &mdash; these are just different lenses on the same fleet.</p>
    </div>

    <ul class="todo-list">
      <li class="todo-item">
        <h3 class="todo-item-h3">A &ldquo;Page view&rdquo; alongside the current &ldquo;File view&rdquo;</h3>
        <p>Today every report is organised <strong>by file</strong> &mdash; one row per document, with the pages that link to it. A new <strong>Page view</strong> turns that around: one row per <strong>page</strong> on a site, showing that page&#39;s own accessibility score and the files attached to it. A clear toggle at the top of each report switches between the two &mdash; <strong>File view stays the default</strong>, with a short plain-English note by the toggle explaining the difference. Useful when a manager wants to walk a smaller site page by page rather than file by file.</p>
      </li>
      <li class="todo-item">
        <h3 class="todo-item-h3">Fuzzy search across every file and page</h3>
        <p>A fleet-wide search box: type part of a filename or a page name and it finds the match instantly across all the sites &mdash; no need for the exact name. Have a PDF and want to know where it lives? The result returns everything the audit knows about it: which site it&#39;s on, the pages that reference it, its accessibility score, and any duplicate copies on other sites.</p>
        <p class="todo-item-payoff"><strong>Why it matters:</strong> answering &ldquo;is this file on our site, and where?&rdquo; goes from reading the spreadsheet by hand to a one-box lookup.</p>
      </li>
    </ul>

    <p class="todo-footer-note">Track progress on the <a href="https://github.com/ICJIA/filecap-cli/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">filecap CHANGELOG</a> — the next major release will roll these out.</p>
  </section>`;
}

/**
 * v1.7.34 — Render the per-access-type modals once at the page footer.
 * Each per-site card's "For bulk file access" chip is a <button> with
 * `data-access-modal="strapi|github|server"`; the page-level click
 * handler reads that attr and opens the matching dialog. Three dialogs
 * total regardless of site count — they're shared.
 *
 * Uses the native <dialog> element + showModal(): handles focus trap,
 * Escape-key close, and click-outside-to-close via the ::backdrop
 * pseudo-element with a click handler. No external modal library.
 */
function renderAccessModals() {
  const dialogs = Object.entries(ACCESS_MODAL_COPY).map(([kind, copy]) => {
    const paragraphsHtml = (copy.paragraphs ?? [])
      .map((p) => `<p>${p}</p>`)
      .join("");
    const stepsHtml = (copy.steps ?? [])
      .map((s) => `<li>${s}</li>`)
      .join("");
    return `<dialog class="access-modal access-modal-${he(kind)}" id="access-modal-${he(kind)}" aria-labelledby="access-modal-${he(kind)}-title">
  <form method="dialog" class="access-modal-close-form">
    <button type="submit" class="access-modal-close" aria-label="Close access-instructions dialog" title="Close">&times;</button>
  </form>
  <h2 id="access-modal-${he(kind)}-title" class="access-modal-title">${he(copy.title)}</h2>
  <div class="access-modal-body">
    ${paragraphsHtml}
    <h3 class="access-modal-steps-h3">Step-by-step</h3>
    <ol class="access-modal-steps">${stepsHtml}</ol>
    <p class="access-modal-cta"><strong>Need access? Email <a href="mailto:christopher.schweda@illinois.gov">christopher.schweda@illinois.gov</a></strong> — Chris Schweda is the sole authorizer for SSH and GitHub access at ICJIA, so emailing him directly is the fastest path. He'll help with credentials, walkthroughs, and any question about getting these files in bulk.</p>
  </div>
</dialog>`;
  }).join("\n");
  return dialogs;
}

// v1.7.15: ICJIA wordmark for the navbar. Sourced from the agency's standard
// asset set (https://github.com/ICJIA/archived-website-page/blob/main/assets/
// icjia-logo.svg). White fills were swapped to currentColor so a CSS color
// property on .icjia-logo can theme it — dark navbar → #ffffff, print mode →
// #000000. ~13 kB inlined; that's a one-time cost on the index page (per-site
// detail pages have a different sticky bar with no agency logo).
const ICJIA_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="154.06pt" height="72.89pt" viewBox="0 0 154.06 72.89" role="img" aria-label="Illinois Criminal Justice Information Authority">
<defs>
<clipPath id="clip-0"><path clip-rule="nonzero" d="M 95 1 L 153.125 1 L 153.125 71 L 95 71 Z M 95 1 "/></clipPath>
<clipPath id="clip-1"><path clip-rule="nonzero" d="M 0 69 L 153 69 L 153 72.613281 L 0 72.613281 Z M 0 69 "/></clipPath>
<clipPath id="clip-2"><path clip-rule="nonzero" d="M 0 69 L 153.125 69 L 153.125 72.613281 L 0 72.613281 Z M 0 69 "/></clipPath>
<clipPath id="clip-3"><path clip-rule="nonzero" d="M 0 0.167969 L 126 0.167969 L 126 4 L 0 4 Z M 0 0.167969 "/></clipPath>
<clipPath id="clip-4"><path clip-rule="nonzero" d="M 0 0.167969 L 127 0.167969 L 127 4 L 0 4 Z M 0 0.167969 "/></clipPath>
</defs>
<path fill-rule="nonzero" fill="currentColor" fill-opacity="1" d="M 17.796875 64.757812 L 0.613281 64.757812 L 0.613281 62.535156 L 1.09375 62.535156 C 3.1875 62.535156 4.558594 62.058594 5.207031 61.109375 C 5.855469 60.15625 6.183594 58.136719 6.183594 55.046875 L 6.183594 17.71875 C 6.183594 14.636719 5.855469 12.621094 5.207031 11.664062 C 4.558594 10.707031 3.1875 10.226562 1.09375 10.226562 L 0.613281 10.226562 L 0.613281 8.003906 L 17.796875 8.003906 L 17.796875 10.226562 L 17.347656 10.226562 C 15.25 10.226562 13.875 10.707031 13.214844 11.664062 C 12.558594 12.621094 12.230469 14.636719 12.230469 17.71875 L 12.230469 55.046875 C 12.230469 58.109375 12.558594 60.125 13.214844 61.085938 C 13.875 62.054688 15.25 62.535156 17.347656 62.535156 L 17.796875 62.535156 L 17.796875 64.757812 "/>
<path fill="none" stroke-width="10" stroke-linecap="butt" stroke-linejoin="miter" stroke="currentColor" stroke-opacity="1" stroke-miterlimit="4" d="M 179.05463 79.044363 L 6.170232 79.044363 L 6.170232 101.406542 L 11.004235 101.406542 C 32.069486 101.406542 45.864081 106.201244 52.38802 115.751349 C 58.91196 125.340754 62.213231 145.659288 62.213231 176.746253 L 62.213231 552.305086 C 62.213231 583.313449 58.91196 603.592683 52.38802 613.221389 C 45.864081 622.850095 32.069486 627.684098 11.004235 627.684098 L 6.170232 627.684098 L 6.170232 650.046276 L 179.05463 650.046276 L 179.05463 627.684098 L 174.535033 627.684098 C 153.430482 627.684098 139.596586 622.850095 132.954744 613.221389 C 126.352202 603.592683 123.050932 583.313449 123.050932 552.305086 L 123.050932 176.746253 C 123.050932 145.934394 126.352202 125.65516 132.954744 115.987154 C 139.596586 106.240545 153.430482 101.406542 174.535033 101.406542 L 179.05463 101.406542 Z M 179.05463 79.044363 " transform="matrix(0.0993935, 0, 0, -0.0993935, 0.000000000000000444, 72.614312)"/>
<path fill-rule="nonzero" fill="currentColor" fill-opacity="1" d="M 54.578125 53.582031 C 50.34375 56.097656 45.066406 57.246094 40.847656 57.246094 C 33.851562 57.246094 28.304688 55.023438 24.203125 50.574219 C 20.105469 46.125 18.054688 40.117188 18.054688 32.554688 C 18.054688 25.148438 20.09375 19.207031 24.179688 14.726562 C 28.265625 10.246094 33.667969 8.003906 40.390625 8.003906 C 45.367188 8.003906 49.96875 8.648438 54.195312 9.921875 L 55.105469 19.234375 L 52.800781 19.234375 L 52.714844 18.6875 C 52.238281 15.878906 50.949219 13.699219 48.847656 12.148438 C 46.742188 10.601562 44.011719 9.828125 40.65625 9.828125 C 36.03125 9.828125 32.226562 11.953125 29.246094 16.203125 C 26.261719 20.457031 24.773438 25.882812 24.773438 32.488281 C 24.773438 39.332031 26.304688 44.863281 29.375 49.074219 C 32.441406 53.285156 36.457031 55.386719 41.421875 55.386719 C 48.113281 55.386719 52.003906 52.398438 53.097656 46.425781 L 53.1875 45.917969 L 54.578125 45.917969 L 54.578125 53.582031 "/>
<path fill="none" stroke-width="10" stroke-linecap="butt" stroke-linejoin="miter" stroke="currentColor" stroke-opacity="1" stroke-miterlimit="4" d="M 549.111345 191.484068 C 506.509233 166.174327 453.413798 154.61988 410.96889 154.61988 C 340.581084 154.61988 284.773891 176.982058 243.508008 221.745716 C 202.281426 266.509373 181.648485 326.954066 181.648485 403.040493 C 181.648485 477.554887 202.163524 537.331465 243.272203 582.40953 C 284.380882 627.487594 338.733945 650.046276 406.370692 650.046276 C 456.439963 650.046276 502.736353 643.561638 545.259862 630.749563 L 554.416958 537.05636 L 531.229462 537.05636 L 530.364844 542.558477 C 525.570141 570.815782 512.600864 592.745651 491.457011 608.348084 C 470.273858 623.911217 442.802571 631.692784 409.043149 631.692784 C 362.510954 631.692784 324.231935 610.313126 294.245393 567.553812 C 264.219551 524.755196 249.245931 470.166329 249.245931 403.708607 C 249.245931 334.853535 264.65186 279.203544 295.542321 236.837238 C 326.393481 194.470932 366.794745 173.32708 416.746114 173.32708 C 484.068453 173.32708 523.212091 203.392223 534.216326 263.483208 L 535.120245 268.592318 L 549.111345 268.592318 Z M 549.111345 191.484068 " transform="matrix(0.0993935, 0, 0, -0.0993935, 0.000000000000000444, 72.614312)"/>
<path fill-rule="nonzero" fill="currentColor" fill-opacity="1" d="M 54.785156 63.519531 L 54.785156 55.902344 L 56.753906 55.902344 L 56.84375 56.355469 L 57.117188 58.753906 C 57.316406 60.074219 57.875 61.144531 58.785156 61.960938 C 59.980469 63.042969 61.445312 63.582031 63.183594 63.582031 C 65.371094 63.582031 66.941406 62.640625 67.894531 60.757812 C 68.847656 58.871094 69.328125 55.785156 69.328125 51.492188 L 69.328125 15.972656 C 69.328125 13.445312 69.003906 11.789062 68.355469 11.003906 C 67.707031 10.222656 66.332031 9.828125 64.238281 9.828125 L 63.761719 9.828125 L 63.761719 8.003906 L 80.941406 8.003906 L 80.941406 9.828125 L 80.464844 9.828125 C 78.367188 9.828125 76.996094 10.222656 76.347656 11.003906 C 75.699219 11.789062 75.375 13.445312 75.375 15.972656 L 75.375 48.714844 C 75.375 52.824219 75.179688 55.789062 74.789062 57.59375 C 74.398438 59.402344 73.605469 60.949219 72.40625 62.25 C 70.328125 64.546875 67.308594 65.695312 63.351562 65.695312 C 59.835938 65.695312 57.203125 64.886719 54.785156 63.519531 "/>
<path fill="none" stroke-width="10" stroke-linecap="butt" stroke-linejoin="miter" stroke="currentColor" stroke-opacity="1" stroke-miterlimit="4" d="M 551.194289 91.50273 L 551.194289 168.139369 L 571.001913 168.139369 L 571.905832 163.580471 L 574.656891 139.449755 C 576.661234 126.166071 582.281254 115.397641 591.43835 107.183765 C 603.464407 96.297432 618.202222 90.873916 635.691096 90.873916 C 657.699567 90.873916 673.498505 100.345419 683.08791 119.288424 C 692.677315 138.27073 697.511319 169.318394 697.511319 212.510018 L 697.511319 569.872561 C 697.511319 595.300205 694.249349 611.963762 687.725409 619.863231 C 681.20147 627.723399 667.367574 631.692784 646.302323 631.692784 L 641.507621 631.692784 L 641.507621 650.046276 L 814.352718 650.046276 L 814.352718 631.692784 L 809.558015 631.692784 C 788.453464 631.692784 774.658869 627.723399 768.134929 619.863231 C 761.61099 611.963762 758.34902 595.300205 758.34902 569.872561 L 758.34902 240.452916 C 758.34902 199.108431 756.383978 169.279093 752.453894 151.122105 C 748.52381 132.925816 740.545739 117.362683 728.480381 104.275503 C 707.572334 81.166609 677.192784 69.612162 637.381033 69.612162 C 602.010276 69.612162 575.521509 77.747436 551.194289 91.50273 Z M 551.194289 91.50273 " transform="matrix(0.0993935, 0, 0, -0.0993935, 0.000000000000000444, 72.614312)"/>
<path fill-rule="nonzero" fill="currentColor" fill-opacity="1" d="M 102.292969 54.558594 L 85.109375 54.558594 L 85.109375 52.734375 L 85.589844 52.734375 C 87.683594 52.734375 89.058594 52.34375 89.707031 51.566406 C 90.355469 50.785156 90.679688 49.125 90.679688 46.589844 L 90.679688 15.972656 C 90.679688 13.445312 90.355469 11.789062 89.707031 11.003906 C 89.058594 10.222656 87.683594 9.828125 85.589844 9.828125 L 85.109375 9.828125 L 85.109375 8.003906 L 102.292969 8.003906 L 102.292969 9.828125 L 101.84375 9.828125 C 99.75 9.828125 98.371094 10.222656 97.710938 11.003906 C 97.054688 11.789062 96.726562 13.445312 96.726562 15.972656 L 96.726562 46.589844 C 96.726562 49.105469 97.054688 50.757812 97.710938 51.550781 C 98.371094 52.34375 99.75 52.734375 101.84375 52.734375 L 102.292969 52.734375 L 102.292969 54.558594 "/>
<path fill="none" stroke-width="10" stroke-linecap="butt" stroke-linejoin="miter" stroke="currentColor" stroke-opacity="1" stroke-miterlimit="4" d="M 1029.171112 181.658858 L 856.286715 181.658858 L 856.286715 200.012351 L 861.120718 200.012351 C 882.185969 200.012351 896.019864 203.942435 902.543804 211.763302 C 909.067743 219.62347 912.329713 236.326327 912.329713 261.832573 L 912.329713 569.872561 C 912.329713 595.300205 909.067743 611.963762 902.543804 619.863231 C 896.019864 627.723399 882.185969 631.692784 861.120718 631.692784 L 856.286715 631.692784 L 856.286715 650.046276 L 1029.171112 650.046276 L 1029.171112 631.692784 L 1024.651516 631.692784 C 1003.586265 631.692784 989.713068 627.723399 983.071226 619.863231 C 976.468685 611.963762 973.167414 595.300205 973.167414 569.872561 L 973.167414 261.832573 C 973.167414 236.522832 976.468685 219.898576 983.071226 211.920505 C 989.713068 203.942435 1003.586265 200.012351 1024.651516 200.012351 L 1029.171112 200.012351 Z M 1029.171112 181.658858 " transform="matrix(0.0993935, 0, 0, -0.0993935, 0.000000000000000444, 72.614312)"/>
<path fill-rule="nonzero" fill="currentColor" fill-opacity="1" d="M 115.875 37.566406 L 134.214844 37.566406 L 124.789062 15.648438 Z M 113.476562 39.871094 L 110.675781 46.8125 C 109.855469 48.789062 109.449219 50.035156 109.449219 50.5625 C 109.449219 51.789062 110.476562 52.496094 112.539062 52.675781 L 113.015625 52.734375 L 113.015625 54.558594 L 101.589844 54.558594 L 101.589844 52.734375 L 102.070312 52.734375 C 103.269531 52.734375 104.261719 52.308594 105.042969 51.453125 C 105.820312 50.597656 106.691406 48.976562 107.648438 46.597656 L 123.972656 6.660156 L 125.914062 6.660156 L 147.320312 56.949219 C 148.378906 59.445312 149.21875 61.09375 149.839844 61.890625 C 150.457031 62.683594 151.210938 63.082031 152.089844 63.082031 L 152.480469 63.082031 L 152.480469 64.90625 L 138.738281 64.90625 L 138.738281 63.082031 L 139.246094 63.082031 C 140.46875 63.082031 141.285156 62.960938 141.707031 62.71875 C 142.125 62.476562 142.335938 62 142.335938 61.296875 C 142.335938 60.714844 141.855469 59.265625 140.894531 56.945312 L 133.671875 39.871094 L 113.476562 39.871094 "/>
<g clip-path="url(#clip-0)"><path fill="none" stroke-width="10" stroke-linecap="butt" stroke-linejoin="miter" stroke="currentColor" stroke-opacity="1" stroke-miterlimit="4" d="M 1165.820135 352.617515 L 1350.337582 352.617515 L 1255.504653 573.134531 Z M 1141.689419 329.430019 L 1113.510716 259.592425 C 1105.25754 239.7062 1101.170252 227.169232 1101.170252 221.863618 C 1101.170252 209.523154 1111.506373 202.409702 1132.257217 200.601863 L 1137.05192 200.012351 L 1137.05192 181.658858 L 1022.096961 181.658858 L 1022.096961 200.012351 L 1026.930964 200.012351 C 1038.996322 200.012351 1048.978736 204.296142 1056.838904 212.903026 C 1064.659771 221.509911 1073.423859 237.819759 1083.052565 261.753971 L 1247.290778 663.565765 L 1266.823295 663.565765 L 1482.191902 157.606744 C 1492.842429 132.493507 1501.29211 115.908552 1507.540944 107.89118 C 1513.750477 99.91311 1521.335539 95.904424 1530.178228 95.904424 L 1534.108312 95.904424 L 1534.108312 77.550931 L 1395.847955 77.550931 L 1395.847955 95.904424 L 1400.957064 95.904424 C 1413.258227 95.904424 1421.472103 97.12275 1425.716594 99.559402 C 1429.921784 101.996054 1432.044029 106.790757 1432.044029 113.864908 C 1432.044029 119.720733 1427.210026 134.301345 1417.542019 157.646045 L 1344.874765 329.430019 Z M 1141.689419 329.430019 " transform="matrix(0.0993935, 0, 0, -0.0993935, 0.000000000000000444, 72.614312)"/></g>
<g clip-path="url(#clip-1)"><path fill-rule="nonzero" fill="currentColor" fill-opacity="1" d="M 0.496094 69.554688 L 0.496094 72.117188 L 152.632812 72.117188 L 152.632812 69.554688 L 0.496094 69.554688 "/></g>
<g clip-path="url(#clip-2)"><path fill="none" stroke-width="10" stroke-linecap="butt" stroke-linejoin="miter" stroke="currentColor" stroke-opacity="1" stroke-miterlimit="4" d="M 4.991207 30.782931 L 4.991207 5.00158 L 1535.641045 5.00158 L 1535.641045 30.782931 Z M 4.991207 30.782931 " transform="matrix(0.0993935, 0, 0, -0.0993935, 0.000000000000000444, 72.614312)"/></g>
<g clip-path="url(#clip-3)"><path fill-rule="nonzero" fill="currentColor" fill-opacity="1" d="M 0.496094 0.660156 L 0.496094 3.21875 L 125.890625 3.21875 L 125.890625 0.660156 L 0.496094 0.660156 "/></g>
<g clip-path="url(#clip-4)"><path fill="none" stroke-width="10" stroke-linecap="butt" stroke-linejoin="miter" stroke="currentColor" stroke-opacity="1" stroke-miterlimit="4" d="M 4.991207 723.931857 L 4.991207 698.189806 L 1266.58749 698.189806 L 1266.58749 723.931857 Z M 4.991207 723.931857 " transform="matrix(0.0993935, 0, 0, -0.0993935, 0.000000000000000444, 72.614312)"/></g>
</svg>`;

// Access-method chip copy. Keep these strings in lock-step with the detail-page
// access panel in src/report/html.js so managers see consistent language.
// v1.7.33 — chip label collapsed to a single plain-English phrase across
// all three site types. The pre-v1.7.33 labels ("Strapi CMS / SSH required",
// "GitHub repo / access required", "Server / SSH required") leaked
// implementation details to a non-technical reader who only cares about
// the practical question: "how do I get the files?" The per-site
// detail page's access panel still spells out the underlying
// requirements (SSH key vs GitHub org access vs rsync) — that's where a
// remediator goes when they need the specifics. The chip on the index
// card just says what the panel is FOR.
const ACCESS_CHIP_LABEL = {
  strapi: "For bulk file access",
  github: "For bulk file access",
  server: "For bulk file access",
};

// v1.7.34 — clickable chip opens a modal with the per-type instructions.
// Pre-v1.7.34 the chip used a `title=` tooltip, but `pointer-events: none`
// on every card descendant (set so whole-card clicks fall through to the
// stretched-link) suppressed the tooltip's hover event entirely.
// Switching to a click-opens-<dialog> pattern: chip gets pointer-events
// re-enabled, click opens a native <dialog> with the full instructions
// for that site's access type. Each access type is a separate dialog
// rendered once at the bottom of the page; any chip of that type
// targets the same dialog by id.
const ACCESS_MODAL_COPY = {
  strapi: {
    title: "How to access this site's files (Strapi-managed)",
    paragraphs: [
      "This site's files live on a remote Linux host running a Strapi CMS. The files inventoried in this audit are everything inside that host's <code>/uploads/</code> directory — the same documents the public sees when browsing the live site.",
      "To download the files in bulk (so a remediation vendor can fix accessibility issues across the whole site), you'll need to copy them off the Strapi host directly. The standard tool for that is <code>rsync</code> over SSH — it copies entire directories efficiently and skips files that haven't changed since last time.",
    ],
    steps: [
      "Email Chris Schweda at ICJIA to add your SSH public key to this Strapi host's authorized-keys list. (If you don't have an SSH key yet, he can walk you through generating one.)",
      "Once your key is on the host, run a one-line <code>rsync</code> command from your laptop to pull a copy of the uploads directory locally. Chris can provide the exact command.",
      "Hand the local copy to your remediation vendor — they apply fixes to the files in-place, and you <code>rsync</code> the corrected files back up to the host when the work is done.",
    ],
  },
  github: {
    title: "How to access this site's files (GitHub-managed)",
    paragraphs: [
      "This site's files live in an ICJIA-owned GitHub repository — every PDF, image, and document the public sees is stored alongside the site's source code on github.com.",
      "To download the files in bulk, you don't need server access — you clone the GitHub repository. Cloning makes a complete local copy of the repo, including every file inventoried in this audit. The remediation vendor works on the local clone, and the corrected files are committed back into the repository.",
    ],
    steps: [
      "Email Chris Schweda at ICJIA to add your GitHub username to the ICJIA organization on github.com.",
      "Once you're added, sign in to github.com and clone the repository (the URL is on this site's per-site detail page). A laptop-side GitHub app or the command-line <code>git</code> tool both work.",
      "Hand the local clone to your remediation vendor — they fix the files in-place, commit the changes, and push back to GitHub when done.",
    ],
  },
  server: {
    title: "How to access this site's files (server-managed)",
    paragraphs: [
      "This site's files live in a regular directory on a remote Linux host — no content-management system in the middle, just files-on-disk that a web server publishes. The files inventoried in this audit are everything inside that directory.",
      "To download the files in bulk, you'll need to copy them off the host directly. The standard tool for that is <code>rsync</code> over SSH — it copies entire directories efficiently and skips files that haven't changed since last time.",
    ],
    steps: [
      "Email Chris Schweda at ICJIA to add your SSH public key to this host's authorized-keys list. (If you don't have an SSH key yet, he can walk you through generating one.)",
      "Once your key is on the host, run a one-line <code>rsync</code> command from your laptop to pull a copy of the directory locally. Chris can provide the exact command.",
      "Hand the local copy to your remediation vendor — they apply fixes to the files in-place, and you <code>rsync</code> the corrected files back up when the work is done.",
    ],
  },
};

// Same clipboard-outline icon as src/report/html.js's COPY_ICON_SVG — kept
// in lock-step visually. Duplicated rather than imported so the two pages
// stay decoupled (changes to one don't risk regressing the other).
const COPY_ICON_SVG = '<svg class="meta-copy-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4.25" y="3.25" width="8.5" height="10.5" rx="1.25"/><path d="M10.75 3.25V2.75a1 1 0 0 0-1-1h-2.5a1 1 0 0 0-1 1v0.5"/></svg>';

/**
 * Wrap a value in a flex container with the value text + a copy-to-clipboard
 * button on the right. Used inside the per-card <details class="tech-details">
 * disclosure so a remediator can copy the site's website nickname, IP,
 * hostname, scanned path, and public URL straight from the index page
 * without first opening the detail page. The button copies the *raw* value
 * (passed verbatim to data-copy); displayHtml lets the rendered cell be
 * richer (e.g. an <a> wrapping the URL) without affecting what gets copied.
 *
 * @param {string} value - raw text that goes on the clipboard
 * @param {string|null} displayHtml - HTML to render (defaults to escaped value)
 * @param {string} label - aria-label suffix, e.g. "IP address"
 * @returns {string}
 */
function copyableValue(value, displayHtml, label) {
  if (value === undefined || value === null || value === "") return "<span></span>";
  const display = displayHtml ?? he(value);
  return `<span class="meta-value">${display}<button type="button" class="meta-copy" data-copy="${he(value)}" aria-label="Copy ${he(label || "value")} to clipboard" title="Copy to clipboard">${COPY_ICON_SVG}<span class="meta-copy-feedback" aria-hidden="true">Copied</span></button></span>`;
}

export function renderCard(sr, { sortIndex = 0 } = {}) {
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
  else if (pctInt === 0)            phrase = "No files may need audit";
  else if (pctInt <= 12)            phrase = "A small share may need audit";
  else if (pctInt <= 28)            phrase = "About a quarter may need audit";
  else if (pctInt <= 42)            phrase = "About a third may need audit";
  else if (pctInt <= 58)            phrase = "About half may need audit";
  else if (pctInt <= 72)            phrase = "Two-thirds may need audit";
  else if (pctInt <= 88)            phrase = "Most may need audit";
  else                              phrase = "Nearly all may need audit";

  const chipsHtml = [
    pdfCount   > 0 ? `<span class="chip chip-pdf"><svg class="ico"><use href="#i-file"/></svg>${pdfCount.toLocaleString()} PDF${pdfCount !== 1 ? "s" : ""}</span>` : "",
    officeCount > 0 ? `<span class="chip chip-doc"><svg class="ico"><use href="#i-file"/></svg>${officeCount.toLocaleString()} Office</span>` : "",
    imageCount > 0 ? `<span class="chip chip-img"><svg class="ico"><use href="#i-img"/></svg>${imageCount.toLocaleString()} image${imageCount !== 1 ? "s" : ""}</span>` : "",
  ].filter(Boolean).join("");

  const scanMeta = `${he(humanBytes(totalBytes))} &middot; scanned ${he(fmtDate(scannedAt))}`;

  // v1.7.8: expanded tech-details now mirrors the per-site detail page's
  // meta-grid (website, IP, hostname, scanned path, public URL) with a
  // copy-to-clipboard button on every row so a remediator can grab any of
  // these strings without first opening the detail page. Raw values flow
  // into data-copy; the cells render the escaped value (or, for the URL, an
  // <a target="_blank"> so the user can still visit the live site).
  const techWebsiteRaw = site.siteName ?? site.name ?? "";
  const techIpRaw = sr.header?.metadata?.serverIp ?? "";
  const techHostnameRaw = sr.header?.metadata?.hostname ?? site.host ?? "";
  const techScannedPathRaw = sr.header?.metadata?.scannedPath ?? "";
  const techUrlRaw = siteUrlRaw;

  const techFieldsPopulated = [techWebsiteRaw, techIpRaw, techHostnameRaw, techScannedPathRaw, techUrlRaw].filter(Boolean).length;
  const hasTechDetails = techFieldsPopulated > 0;

  const techDetailsHtml = hasTechDetails
    ? `<details class="tech-details">
    <summary>Technical details</summary>
    <div class="tech-grid">
      ${techWebsiteRaw ? `<span class="tech-label">Website:</span>${copyableValue(techWebsiteRaw, null, "site nickname")}` : ""}
      ${techIpRaw ? `<span class="tech-label">IP:</span>${copyableValue(techIpRaw, null, "IP address")}` : ""}
      ${techHostnameRaw ? `<span class="tech-label">Hostname:</span>${copyableValue(techHostnameRaw, null, "hostname")}` : ""}
      ${techScannedPathRaw ? `<span class="tech-label">Path:</span>${copyableValue(techScannedPathRaw, null, "scanned path")}` : ""}
      ${techUrlRaw ? `<span class="tech-label">URL:</span>${copyableValue(techUrlRaw, `<a href="${he(techUrlRaw)}" target="_blank" rel="noopener noreferrer">${he(techUrlRaw)}</a>`, "public URL")}` : ""}
    </div>
  </details>`
    : "";

  // v1.7.39 — data-sort-* attributes feed the client-side sort control
  // above the grid. `sort-az` is the lower-cased visible heading (matches
  // the default alphabetical order). `sort-added` is the entry's index
  // in sites.json (highest = most recently added → sorts first when the
  // user picks "Most recently added"). `sort-files` is total file count
  // (highest first when the user picks "Most files").
  const sortAzKey = (site.siteFullName || site.siteName || site.name || "").toLowerCase();
  return `<article class="site-card" data-sort-az="${he(sortAzKey)}" data-sort-added="${sortIndex}" data-sort-files="${totalFiles}">
  <a class="card-stretched-link" href="${he(htmlFile)}" aria-label="View detailed report for ${fullName}"></a>
  <header class="card-head">
    ${accessKind ? `<button type="button" class="access-chip access-${accessKind}" data-access-modal="${he(accessKind)}" aria-haspopup="dialog" aria-controls="access-modal-${he(accessKind)}" title="${he(accessLabel)} — click for the credentials and steps"><span class="access-dot" aria-hidden="true"></span>${he(accessLabel)}</button>` : ""}
    <p class="nickname">${nickname}</p>
    <h3 class="full-name">${fullName}</h3>
    ${publicUrlBaseRaw ? `<p class="site-url"><span>${publicUrlBase}</span></p>` : ""}
  </header>
  <div class="nums">
    <div class="tile total"><span class="num">${he(totalFiles.toLocaleString())}</span><span class="lbl">total files</span></div>
    <div class="tile audit"><span class="num">${he(remediable.toLocaleString())}</span><span class="lbl">may need audit</span></div>
  </div>
  <div class="donut-row">
    <div class="donut" style="--pct:${pct}%"><div class="pct">${pctInt}%<small>may need audit</small></div></div>
    <div class="donut-caption"><strong>${he(phrase)}</strong><span>${he(remediable.toLocaleString())} of ${he(totalFiles.toLocaleString())} files</span></div>
  </div>
  ${chipsHtml ? `<div class="chips">${chipsHtml}</div>` : ""}
  <p class="scan-meta">${scanMeta}</p>
  ${techDetailsHtml}
  <div class="actions">
    <a href="${he(htmlFile)}" class="btn btn-primary">View detailed report &rarr;</a>
    <a href="${he(csvFile)}" class="btn btn-secondary" download>Download spreadsheet</a>
    ${scannedAt ? `<p class="csv-last-audit">Last audit: <strong>${he(fmtAuditDate(scannedAt))}</strong></p>` : ""}
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
  byTypeCsvs = [], // v1.7.14: [{ slug, side, label, keys, csvFilename, htmlFilename, fileCount, byteCount }, …]
  llmContext = null, // v1.7.21: { ndjsonFilename, ndjsonByteCount, contextMdFilename, contextMdByteCount, lastAuditAt } | null
  orphans = null, // v1.11.0: { csvFilename, htmlFilename, orphanCount, staleRevisionCount, trulyUnreferencedCount, csvByteCount, htmlByteCount } | null
}) {
  // Fleet totals
  let fleetTotalFiles = 0;
  let fleetRemediable = 0;
  const fleetByCategory = {};
  // v1.8.0-beta.6: references coverage rollup. Sites where the references
  // pipeline has run contribute to (withRefs + withoutRefs); sites where it
  // hasn't (git Nuxt sites, intranet pre-bearer-token) sit in refsUnknown.
  // The headline % is computed against the resolved denominator so we don't
  // penalise the coverage number for sites we haven't extended to yet.
  // v1.9.0 audit-band totals
  let fleetAuditedPdfCount = 0;
  let fleetAuditScoreSum = 0;
  let fleetAuditErrorCount = 0;
  let fleetAuditPending = 0;

  for (const sr of siteResults) {
    const s = sr.summary ?? {};
    fleetTotalFiles += s.totalFiles ?? 0;
    fleetRemediable += s.remediable ?? 0;
    fleetAuditedPdfCount += s.auditedPdfCount ?? 0;
    fleetAuditScoreSum += s.auditScoreSum ?? 0;
    fleetAuditErrorCount += s.auditErrorCount ?? 0;
    fleetAuditPending += s.auditPending ?? 0;
    if (s.byCategory) {
      for (const [cat, n] of Object.entries(s.byCategory)) {
        fleetByCategory[cat] = (fleetByCategory[cat] ?? 0) + n;
      }
    }
  }

  const fleetNonRemediable = fleetTotalFiles - fleetRemediable;

  // v1.9.0 fleet-wide audit averages. Only PDFs are scored; the average
  // is computed across PDFs that actually got a score (not pending /
  // error). Grade letter is derived from the same brackets used per-file:
  //   90-100 → A, 80-89 → B, 70-79 → C, 60-69 → D, < 60 → F.
  const fleetAvgScore = fleetAuditedPdfCount > 0
    ? Math.round(fleetAuditScoreSum / fleetAuditedPdfCount)
    : null;
  function gradeFor(score) {
    if (score === null || typeof score !== "number") return null;
    if (score >= 90) return "A";
    if (score >= 80) return "B";
    if (score >= 70) return "C";
    if (score >= 60) return "D";
    return "F";
  }
  const fleetAvgGrade = gradeFor(fleetAvgScore);

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

  // v1.7.14: build a lookup of bucket → its HTML/CSV pair so a row can
  // become a clickable link to the by-type detail page. The bucket
  // identity is on the `keys` array — the first key in `categories` order
  // determines whether the row matches.
  const bucketByKey = new Map();
  for (const b of byTypeCsvs) {
    for (const k of (b.keys || [])) {
      bucketByKey.set(k, b);
    }
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
        const bucket = bucketByKey.get(key);
        // When a per-type detail page exists, the whole row label is a link
        // to it; otherwise (older bundles without by-type CSVs) the row
        // renders as plain text.
        const labelHtml = bucket?.htmlFilename
          ? `<a class="by-type-link" href="${he(bucket.htmlFilename)}" aria-label="Open ${he(label)} detail page (${he(n.toLocaleString())} files)">${he(label)}<svg class="by-type-link-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8h10M9 4l4 4-4 4"/></svg></a>`
          : he(label);
        const numHtml = bucket?.csvFilename
          ? `<a class="by-type-csv-link" href="${he(bucket.csvFilename)}" download aria-label="Download ${he(label)} CSV (${he(n.toLocaleString())} files)" title="Download CSV — ${he(label)}">${he(n.toLocaleString())}</a>`
          : he(n.toLocaleString());
        return `<tr><td>${labelHtml}</td><td class="num">${numHtml}</td></tr>`;
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

  // v1.7.15: cards alphabetized by siteFullName (fallback siteName, then
  // the server-name slug) so managers can find a site by its visible title.
  // Pre-v1.7.15 the order followed sites.json declaration order, which
  // matched how the audit team thought about the fleet but not how an
  // outside viewer scans the page. localeCompare so case + diacritics
  // behave naturally on a real keyboard.
  //
  // v1.7.39 — capture the original input order before sorting so each
  // rendered card carries its sites.json declaration index as
  // `data-sort-added`. That's the data the "Most recently added" sort
  // option in the toolbar above the grid reads.
  const originalOrder = new Map(siteResults.map((sr, i) => [sr, i]));
  const sortedSiteResults = [...siteResults].sort((a, b) => {
    const aKey = a.site?.siteFullName || a.site?.siteName || a.site?.name || "";
    const bKey = b.site?.siteFullName || b.site?.siteName || b.site?.name || "";
    return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
  });
  const cardsHtml = sortedSiteResults
    .map((sr) => renderCard(sr, { sortIndex: originalOrder.get(sr) ?? 0 }))
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${pageTitle}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%230d1117'/><path d='M12 9L12 23L23 16Z' fill='%23ffb000'/></svg>">
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
a { color: #60a5fa; text-decoration: underline; }
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
.site-header-left {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  min-width: 0;
}
.site-header .icjia-logo {
  display: inline-flex;
  align-items: center;
  color: #ffffff;
  height: 38px;
  flex: none;
}
.site-header .icjia-logo svg {
  height: 100%;
  width: auto;
  display: block;
}
.site-header .brand {
  font-weight: 700;
  font-size: 0.88rem;
  color: #e5e5e5;
  letter-spacing: -0.01em;
  padding-left: 0.85rem;
  border-left: 1px solid #21262d;
}
.site-header .brand span { color: #60a5fa; }
@media (max-width: 600px) {
  .site-header .icjia-logo { height: 32px; }
  .site-header .brand { font-size: 0.9rem; padding-left: 0.65rem; }
}

/* v1.7.16: ICJIA PDF accessibility audit tool button. Visually prominent
   (filled blue) so managers/remediators see it without scanning. Same
   pattern repeats in the per-site detail page sticky bar. */
.site-header-right {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: none;
}
.audit-tool-link {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.4rem 0.8rem;
  background: linear-gradient(180deg, #4dabf7 0%, #2f8de0 100%);
  color: #0c1219;
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
}
.audit-tool-link:focus-visible {
  outline: 3px solid #58a6ff;
  outline-offset: 2px;
}
.audit-tool-link:active { transform: translateY(0); filter: brightness(0.96); }
.audit-tool-icon { width: 14px; height: 14px; flex: none; }
@media (max-width: 600px) {
  .audit-tool-link { padding: 0.4rem 0.7rem; font-size: 0.82rem; }
  .audit-tool-link span { display: none; }
  .audit-tool-icon { width: 16px; height: 16px; }
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
.hero h1 { margin-bottom: 0.25rem; }
.hero .subtitle {
  font-size: 0.9rem;
  color: #999999;
  margin: 0 0 1.5rem;
}
/* v1.7.23 — top section banner. Mirrors the v1.7.22 dup-section-banner so
   the page reads as TWO symmetric major sections (Fleet snapshot, Cross-
   Server Duplicates). Blue accent bar here vs amber on duplicates — the
   color encodes section identity at a glance. */
.fleet-section-banner {
  margin: 1.5rem 0 1.5rem;
  padding-top: 0;
}
.fleet-section-banner::before {
  content: "";
  display: block;
  width: 72px;
  height: 5px;
  background: linear-gradient(90deg, #4dabf7 0%, #1f6feb 100%);
  border-radius: 3px;
  margin-bottom: 1.4rem;
}
.fleet-section-eyebrow {
  margin: 0 0 0.55rem;
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #4dabf7;
}
.fleet-section-headline {
  margin: 0 0 0.9rem;
  font-size: clamp(2.2rem, 4.5vw, 3.1rem);
  font-weight: 900;
  line-height: 1.08;
  letter-spacing: -0.025em;
  color: #ffffff;
}
.fleet-section-lede {
  margin: 0 0 0.7rem;
  max-width: 72ch;
  font-size: 1.1rem;
  line-height: 1.55;
  color: #c0cdda;
}
.fleet-section-meta {
  margin: 0;
  font-size: 0.85rem;
  color: #8b949e;
  letter-spacing: 0.02em;
}
@media (max-width: 720px) {
  .fleet-section-banner { margin: 1rem 0 1.2rem; }
  .fleet-section-banner::before { width: 56px; height: 4px; margin-bottom: 1rem; }
  .fleet-section-lede { font-size: 1rem; }
}

/* v1.7.23 — "Zero PII" reassurance banner. Sits right under the top section
   banner so anyone on the page sees it immediately. Green color register
   = "safe / verified." Two-column IN / NOT-IN list so a manager can
   scan the data scope without reading prose. */
/* v1.7.25: vertically tightened. Same content (eyebrow + title + lede +
   two-column in/out lists + footnote about the Intranet) but ~30% less
   vertical real estate — every padding and margin pulled in, smaller
   icon column, tighter list line-height + item gaps. */
.no-pii-banner {
  margin: 0 0 1.6rem;
  padding: 1rem 1.2rem;
  display: grid;
  grid-template-columns: 42px 1fr;
  gap: 0.9rem;
  background: linear-gradient(180deg, #11221a 0%, #0f1d17 100%);
  border: 1px solid #1f4a37;
  border-left: 5px solid #66d9a3;
  border-radius: 10px;
}
.no-pii-banner-icon {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 0.15rem;
  color: #66d9a3;
}
.no-pii-banner-icon svg { width: 36px; height: 36px; }
.no-pii-banner-body { min-width: 0; }
.no-pii-banner-eyebrow {
  margin: 0 0 0.2rem;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #66d9a3;
}
.no-pii-banner-title {
  margin: 0 0 0.4rem;
  font-size: 1.35rem;
  font-weight: 900;
  letter-spacing: -0.012em;
  line-height: 1.2;
  color: #ffffff;
}
.no-pii-banner-lede {
  margin: 0 0 0.7rem;
  font-size: 0.95rem;
  line-height: 1.45;
  color: #d4dae0;
}
.no-pii-banner-lede strong { color: #ffffff; }
.no-pii-banner-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.7rem;
  margin: 0 0 0.65rem;
}
@media (max-width: 720px) {
  .no-pii-banner { grid-template-columns: 1fr; padding: 0.9rem 1rem; }
  .no-pii-banner-icon { padding-top: 0; }
  .no-pii-banner-icon svg { width: 30px; height: 30px; }
  .no-pii-banner-columns { grid-template-columns: 1fr; gap: 0.55rem; }
}
.no-pii-banner-col {
  padding: 0.55rem 0.75rem;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid #1f3a30;
  border-radius: 6px;
}
.no-pii-banner-col-in   { border-left: 3px solid #66d9a3; }
.no-pii-banner-col-out  { border-left: 3px solid #f57878; }
.no-pii-banner-col h3 {
  margin: 0 0 0.3rem;
  font-size: 0.86rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: #ffffff;
}
.no-pii-banner-col-in h3 em  { color: #66d9a3; font-style: italic; font-weight: 700; }
.no-pii-banner-col-out h3 em { color: #f57878; font-style: italic; font-weight: 700; }
.no-pii-banner-col ul {
  margin: 0;
  padding-left: 1rem;
  font-size: 0.85rem;
  line-height: 1.4;
  color: #c0cdda;
}
.no-pii-banner-col ul li { margin: 0.12rem 0; }
.no-pii-banner-footer {
  margin: 0;
  padding: 0.5rem 0.8rem;
  background: rgba(102, 217, 163, 0.08);
  border-left: 3px solid #66d9a3;
  border-radius: 0 5px 5px 0;
  font-size: 0.87rem;
  line-height: 1.45;
  color: #c8e6d2;
}
.no-pii-banner-footer strong { color: #ffffff; }

/* ── fleet-hero (v1.7.13) ────────────────────────────────────────
   Manager-friendly infographic hero. Pre-v1.7.13 the hero led with the
   TOTAL files number (e.g. "14,914") which managers misread as "every
   one of these needs work." The new hero leads with the AUDIT count
   (e.g. "11,097") in big amber type, with a donut chart on the right
   echoing the per-site card pattern so the fleet view and the per-site
   view feel like the same product. Two-column on desktop; stacked on
   narrow viewports. */
.fleet-hero {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 2.5rem;
  align-items: center;
  margin-top: 1rem;
}
@media (max-width: 720px) {
  .fleet-hero { grid-template-columns: 1fr; gap: 1.5rem; }
}

.fleet-hero-num-block { min-width: 0; }
.fleet-hero-eyebrow {
  font-size: 0.85rem;
  font-weight: 800;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: #c0cdda;
  margin: 0 0 0.6rem;
}
.fleet-hero-num {
  font-size: clamp(4em, 12vw, 7em);
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.03em;
  color: #ffa84d;
  font-variant-numeric: tabular-nums;
  margin: 0 0 0.6rem;
}
.fleet-hero-context {
  font-size: 1rem;
  color: #9aa5b1;
  line-height: 1.5;
  max-width: 38ch;
  margin: 0;
}
.fleet-hero-context strong { color: #d4dae0; font-weight: 700; }

.fleet-hero-donut-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  min-width: 0;
}
.fleet-hero-donut {
  width: 200px;
  height: 200px;
  border-radius: 50%;
  background: conic-gradient(
    #ffa84d 0 var(--pct, 0%),
    rgba(77, 171, 247, 0.45) var(--pct, 0%) 100%
  );
  display: flex; align-items: center; justify-content: center;
  position: relative;
  flex: none;
}
.fleet-hero-donut::after {
  content: "";
  position: absolute;
  inset: 26px;
  background: #161b22;
  border-radius: 50%;
}
.fleet-hero-donut-pct {
  position: relative;
  z-index: 1;
  font-weight: 900;
  font-size: 2.2em;
  color: #ffa84d;
  line-height: 1;
  text-align: center;
}
.fleet-hero-donut-pct small {
  display: block;
  font-size: 0.36em;
  color: #9aa5b1;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 6px;
}
.fleet-hero-phrase {
  text-align: center;
  color: #d4dae0;
  font-size: 1.05em;
  margin: 0;
  max-width: 22ch;
}
.fleet-hero-phrase strong { color: #ffffff; font-weight: 700; }

/* ── fleet-audit-band (v1.9.0) ──────────────────────────────────
   Strip below the cross-site reference band. Surfaces the PDF
   accessibility-score average + counts from audit.icjia.app, distinct
   colour register (green/teal) so the eye can tell it apart from the
   amber audit-count hero and the blue references band. */
.fleet-audit-band {
  margin-top: 1.5rem;
  padding: 1.25rem 1.5rem;
  border: 1px solid #1f4837;
  border-radius: 6px;
  background: linear-gradient(180deg, rgba(20, 184, 166, 0.10) 0%, rgba(20, 184, 166, 0.04) 100%);
}
.fleet-audit-eyebrow {
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: #5eead4;
  margin: 0 0 0.6rem;
}
.fleet-audit-row {
  display: flex;
  flex-wrap: wrap;
  gap: 2.5rem 3rem;
  align-items: center;
}
.fleet-audit-stat {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  min-width: 0;
}
.fleet-audit-grade {
  display: inline-block;
  font-size: clamp(1.6em, 4vw, 2.2em);
  font-weight: 800;
  letter-spacing: -0.02em;
  padding: 0.05em 0.45em;
  border-radius: 6px;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.fleet-audit-grade-a { background: rgba(34, 197, 94, 0.18);  color: #4ade80; border: 1px solid #166534; }
.fleet-audit-grade-b { background: rgba(20, 184, 166, 0.18); color: #5eead4; border: 1px solid #115e59; }
.fleet-audit-grade-c { background: rgba(234, 179, 8, 0.18);  color: #fde047; border: 1px solid #854d0e; }
.fleet-audit-grade-d { background: rgba(249, 115, 22, 0.18); color: #fdba74; border: 1px solid #9a3412; }
.fleet-audit-grade-f { background: rgba(239, 68, 68, 0.18);  color: #fca5a5; border: 1px solid #991b1b; }
.fleet-audit-grade-x { background: rgba(107, 114, 128, 0.15); color: #9ca3af; border: 1px solid #4b5563; }
.fleet-audit-num {
  font-size: clamp(1.6em, 4vw, 2.2em);
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #5eead4;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.fleet-audit-num-dim {
  color: #c0cdda;
}
.fleet-audit-lbl {
  font-size: 0.95rem;
  color: #c0cdda;
  line-height: 1.4;
}
.fleet-audit-lbl strong {
  color: #ffffff;
  font-weight: 700;
}
.fleet-audit-context {
  margin: 0.9rem 0 0;
  font-size: 0.88rem;
  color: #9aa5b1;
  line-height: 1.5;
  max-width: 80ch;
}
.fleet-audit-context a {
  color: #5eead4;
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

/* v1.7.14 — clickable by-type row. Label opens the per-type detail page
   (table of every file of that type across the fleet, with a CSV
   download). Count opens just the CSV. Both styled subtly so the rows
   still scan as a table; hover lights them up. */
.by-type-column .by-type-link {
  display: inline-flex;
  align-items: center;
  gap: 0.45em;
  color: #d4dae0;
  text-decoration: none;
  transition: color 100ms ease;
}
.by-type-column .by-type-link:hover,
.by-type-column .by-type-link:focus-visible {
  color: #58a6ff;
  text-decoration: underline;
}
.by-type-column .by-type-link:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
  border-radius: 2px;
}
.by-type-column .by-type-link-icon {
  width: 12px;
  height: 12px;
  opacity: 0.55;
  flex: none;
  transition: opacity 100ms ease, transform 140ms ease;
}
.by-type-column .by-type-link:hover .by-type-link-icon,
.by-type-column .by-type-link:focus-visible .by-type-link-icon {
  opacity: 1;
  transform: translateX(2px);
}
.by-type-column .by-type-csv-link {
  color: #d4dae0;
  text-decoration: none;
  font-variant-numeric: tabular-nums;
  border-bottom: 1px dotted #2a323d;
  transition: color 100ms ease, border-color 100ms ease;
}
.by-type-column .by-type-csv-link:hover,
.by-type-column .by-type-csv-link:focus-visible {
  color: #58a6ff;
  border-bottom-color: #58a6ff;
}
.by-type-column .by-type-csv-link:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
  border-radius: 2px;
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
.site-card .tech-details summary,
.site-card .tech-details .meta-copy,
.site-card .tech-details .meta-value a,
.site-card .access-chip {
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
  color: var(--fc-text-muted, #9aa5b1);
}
.site-card .site-url span { color: var(--fc-accent, #4dabf7); }

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
  /* v1.7.34: chip is now a <button> that opens an access-instructions
     modal. Reset browser-default button styling so it still reads as a
     chip; cursor-pointer + subtle hover lift signal interactivity. */
  font-family: inherit;
  background-image: none;
  cursor: pointer;
  transition: filter 120ms ease, transform 120ms ease;
}
.site-card .access-chip:hover,
.site-card .access-chip:focus-visible {
  filter: brightness(1.18);
  transform: translateY(-1px);
}
.site-card .access-chip:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
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
  /* v1.7.10: bumped from 130x130 → 180x180 (and ::after inset 14 → 22)
     so the inner hole's horizontal chord at the y-position of the
     "MAY NEED AUDIT" caption is comfortably wider than the text. Pre-
     v1.7.10 the inner hole was 102 px diameter and "may need audit" was
     ~101 px wide — at the chord-narrower bottom of the .pct box the text
     bled into the colored ring, reading as "the text is offset". With a
     136 px inner hole the chord at +/- 20 px from center (where the
     bottom of the .pct sits) is ~130 px, leaving ~10 px of clearance on
     each side of "may need audit". */
  width: 180px; height: 180px;
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
  inset: 22px;
  background: #141a23;
  border-radius: 50%;
}
.site-card .donut .pct {
  position: relative; z-index: 1;
  font-weight: 900;
  font-size: 1.7em;
  color: #ffa84d;
  line-height: 1;
  /* v1.7.9: center both the percentage and the <small> caption inside the
     donut. Pre-v1.7.9 this was accidentally OK because "need audit" and
     "67%" happened to be near-equal widths; the v1.7.8 softening to
     "may need audit" made the caption wider, exposing that the .pct box
     was a left-aligned column. The detail-page sibling .dp-pct had this
     rule from the start. */
  text-align: center;
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
  color: var(--fc-text-muted, #9aa5b1);
  margin: 6px 0 12px;
  text-align: center;
}

.site-card .tech-details { margin: 6px 0 12px; font-size: 0.82em; color: var(--fc-text-muted, #9aa5b1); }
.site-card .tech-details summary { cursor: pointer; min-height: 24px; padding: 3px 0; }
.site-card .tech-details .hostname,
.site-card .tech-details .ip { margin: 4px 0 0; }
/* v1.7.8 — expanded tech-details: 5-row mini-grid mirroring the per-site
   detail page's meta-grid (website, IP, hostname, scanned path, public URL)
   with a copy-to-clipboard button on every row. Label is monospace + muted
   so the value reads as the foreground content. Long values (scanned path)
   word-break so the card width stays bounded. */
.site-card .tech-details .tech-grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.3rem 0.8rem;
  margin: 8px 0 0;
  align-items: center;
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.92em;
}
.site-card .tech-details .tech-label {
  font-weight: 700;
  color: var(--fc-text-muted, #9aa5b1);
}
.site-card .tech-details .meta-value {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  color: #d4dae0;
  word-break: break-all;
}
.site-card .tech-details .meta-value > a {
  color: var(--fc-accent, #4dabf7);
  text-decoration: none;
  word-break: break-all;
}
.site-card .tech-details .meta-value > a:hover { text-decoration: underline; }
.site-card .tech-details .meta-copy {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  width: 24px;
  height: 22px;
  padding: 0;
  background: transparent;
  border: 1px solid #2a323d;
  border-radius: 4px;
  color: #9aa5b1;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.72rem;
  line-height: 1;
  overflow: hidden;
  vertical-align: middle;
  transition: background 100ms ease, color 100ms ease, border-color 100ms ease, width 140ms ease;
}
.site-card .tech-details .meta-copy:hover {
  background: rgba(88, 166, 255, 0.10);
  color: #58a6ff;
  border-color: #58a6ff;
}
.site-card .tech-details .meta-copy:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
}
.site-card .tech-details .meta-copy.copied {
  width: 64px;
  color: #66d9a3;
  border-color: #66d9a3;
  background: rgba(102, 217, 163, 0.10);
}
.site-card .tech-details .meta-copy-icon { width: 13px; height: 13px; flex: none; }
.site-card .tech-details .meta-copy-feedback {
  display: none;
  font-weight: 700;
  font-size: 0.7rem;
  letter-spacing: 0.04em;
}
.site-card .tech-details .meta-copy.copied .meta-copy-icon { display: none; }
.site-card .tech-details .meta-copy.copied .meta-copy-feedback { display: inline; }

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
.site-card .actions .csv-last-audit {
  margin: 0;
  font-size: 0.78em;
  text-align: center;
  color: var(--fc-text-muted, #9aa5b1);
  letter-spacing: 0.02em;
}
.site-card .actions .csv-last-audit strong { color: #c0cdda; font-weight: 700; }

/* 2-col grid: desktop 2-up, mobile 1-up */
.site-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 22px;
}
@media (max-width: 820px) {
  .site-grid { grid-template-columns: 1fr; }
}

/* v1.7.39 — big, visible sort toolbar above the site grid. Three
   segmented buttons (Alphabetical / Most recently added / Most files
   first) drive a small inline-JS reorder of .site-card elements
   already in the DOM. No animation on first paint so the user sees
   the default A-Z immediately. Buttons wrap to a second row on
   narrow screens; on phones the whole bar stacks. */
.site-grid-sort {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  margin: 0 0 1.4rem;
  padding: 0.85rem 1rem;
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.25);
}
.site-grid-sort-label {
  font-size: 1rem;
  font-weight: 600;
  color: #e5e5e5;
  letter-spacing: -0.005em;
  flex: none;
}
.site-grid-sort-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  flex: 1 1 auto;
}
.sort-btn {
  appearance: none;
  -webkit-appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  background: #0d1117;
  color: #e5e5e5;
  border: 1px solid #30363d;
  border-radius: 10px;
  padding: 0.65rem 1.05rem;
  font: inherit;
  font-size: 0.98rem;
  font-weight: 500;
  line-height: 1.1;
  cursor: pointer;
  transition: background-color 0.12s, border-color 0.12s, color 0.12s, transform 0.08s;
}
.sort-btn:hover {
  background: #1f2530;
  border-color: #4b81e0;
  color: #f0f6fc;
}
.sort-btn:active { transform: translateY(1px); }
.sort-btn:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: 2px;
}
.sort-btn.is-active,
.sort-btn[aria-pressed="true"] {
  background: #1f6feb;
  color: #ffffff;
  border-color: #58a6ff;
  font-weight: 600;
  box-shadow: 0 0 0 1px rgba(88,166,255,0.45) inset;
}
.sort-btn.is-active:hover,
.sort-btn[aria-pressed="true"]:hover {
  background: #2c7eff;
  color: #ffffff;
  border-color: #79b8ff;
}
.sort-btn-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.6em;
  height: 1.6em;
  padding: 0 0.3em;
  border-radius: 6px;
  background: rgba(255,255,255,0.06);
  font-size: 0.85em;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: inherit;
}
.sort-btn.is-active .sort-btn-glyph,
.sort-btn[aria-pressed="true"] .sort-btn-glyph {
  background: rgba(255,255,255,0.18);
}
.sort-btn-label { white-space: nowrap; }
@media (max-width: 600px) {
  .site-grid-sort { align-items: flex-start; flex-direction: column; gap: 0.6rem; }
  .sort-btn { padding: 0.55rem 0.9rem; font-size: 0.95rem; }
  .sort-btn-label { white-space: normal; }
}

/* ── footer ─────────────────────────────────────────────────── */
.site-footer {
  border-top: 1px solid #21262d;
  padding: 1.5rem 2rem;
  max-width: 1200px;
  margin: 0 auto;
  font-size: 0.8rem;
  color: #9aa5b1;
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
  .site-header .icjia-logo { color: #000; }
  .site-header .brand { color: #000; border-left-color: #ccc; }
  .site-header .brand span { color: #0066cc; }
  h1, h2, h3 { color: #000; }
  .hero { background: #f8f8f8; border-color: #ccc; }
  /* v1.7.13 print-mode overrides for the new fleet-hero */
  .fleet-hero-eyebrow { color: #444; }
  .fleet-hero-num { color: #d97706; }
  .fleet-hero-context { color: #333; }
  .fleet-hero-context strong { color: #000; }
  .fleet-hero-donut::after { background: #fff; }
  .fleet-hero-donut-pct { color: #d97706; }
  .fleet-hero-donut-pct small { color: #444; }
  .fleet-hero-phrase { color: #000; }
  .fleet-hero-phrase strong { color: #000; }
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
.master-csv-last-audit {
  margin: 0.45rem 0 0;
  font-size: 0.82rem;
  color: #9aa5b1;
  letter-spacing: 0.02em;
}
.master-csv-last-audit strong { color: #c0cdda; font-weight: 700; }

/* v1.7.21 — "For AI models" section. Sits between the master CSV section
   and the duplicates section. Visual register is "optional / read-only"
   so a manager doesn't mistake it for a workflow step. Muted background +
   small "Optional · for AI models" eyebrow + a softer color palette than
   the actionable CTA buttons. */
.llm-context {
  margin: 2.2rem 0;
  padding: 1.5rem 1.6rem;
  background: linear-gradient(180deg, #131b27 0%, #11161e 100%);
  border: 1px solid #2a3340;
  border-radius: 10px;
}
.llm-context-eyebrow {
  margin: 0 0 0.35rem;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: #8b949e;
}
.llm-context h2 {
  margin: 0 0 0.6rem;
  font-size: 1.5rem;
  font-weight: 800;
  color: #e5e5e5;
  letter-spacing: -0.01em;
}
.llm-context-lead {
  margin: 0 0 0.85rem;
  font-size: 1rem;
  line-height: 1.55;
  color: #c9d1d9;
  max-width: 78ch;
}
.llm-context-lead strong { color: #ffffff; }
.llm-context-future {
  margin: 0 0 1.1rem;
  padding: 0.7rem 0.9rem;
  background: rgba(255, 255, 255, 0.03);
  border-left: 3px solid #6e7681;
  border-radius: 0 6px 6px 0;
  font-size: 0.95em;
  line-height: 1.55;
  color: #b8c0c8;
  max-width: 78ch;
}
.llm-context-future strong { color: #d4dae0; }
.llm-context-files {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem;
  margin: 1rem 0 1.1rem;
}
@media (max-width: 720px) {
  .llm-context-files { grid-template-columns: 1fr; }
}
.llm-context-file {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.85rem 1rem;
  background: rgba(77, 171, 247, 0.05);
  border: 1px solid #2a3340;
  border-left: 3px solid #4dabf7;
  border-radius: 6px;
  color: #d4dae0;
  text-decoration: none;
  transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
}
.llm-context-file:hover {
  background: rgba(77, 171, 247, 0.10);
  border-left-color: #58a6ff;
  transform: translateY(-1px);
  text-decoration: none;
}
.llm-context-file:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
}
.llm-context-file-name {
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.95rem;
  font-weight: 700;
  color: #ffffff;
  word-break: break-all;
}
.llm-context-file-meta {
  font-size: 0.78rem;
  font-weight: 600;
  color: #8b949e;
  letter-spacing: 0.02em;
}
.llm-context-file-desc {
  font-size: 0.88rem;
  line-height: 1.5;
  color: #b8c0c8;
}
.llm-context-howto {
  margin-top: 0.5rem;
}
.llm-context-howto > summary {
  cursor: pointer;
  font-size: 0.92rem;
  font-weight: 600;
  color: #58a6ff;
  padding: 0.35rem 0;
}
.llm-context-howto > summary:hover { color: #93c5fd; }
.llm-context-steps {
  margin: 0.6rem 0 0.5rem 1.3rem;
  padding: 0;
  font-size: 0.95rem;
  line-height: 1.55;
  color: #c9d1d9;
}
.llm-context-steps li { margin: 0.4rem 0; }
.llm-context-steps strong { color: #ffffff; }
.llm-context-steps code {
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.88em;
  padding: 0.04em 0.35em;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
}
.llm-context-actionable-reminder {
  margin: 0.6rem 0 0;
  padding: 0.65rem 0.9rem;
  background: rgba(251, 191, 36, 0.06);
  border-left: 3px solid #fbbf24;
  border-radius: 0 6px 6px 0;
  font-size: 0.92rem;
  line-height: 1.55;
  color: #f4dfa0;
}
.llm-context-actionable-reminder strong { color: #ffffff; }
.llm-context-actionable-reminder code {
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.88em;
  padding: 0.04em 0.35em;
  background: rgba(255, 255, 255, 0.10);
  border-radius: 3px;
  color: #ffffff;
}

/* v1.7.22 — strong "new section" divider banner above the duplicates hero.
   Page has accumulated a lot of stacked content (master CSV, by-type, For AI
   models), and managers were missing where the duplicates block began. The
   banner uses an amber accent bar (echoes the section's existing notice-
   yellow color register), large clamped headline, and generous vertical
   margins so the eye registers a clear section break. */
.duplicates .dup-section-banner {
  margin: 4.5rem 0 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid #2a3340;
}
.duplicates .dup-section-banner::before {
  content: "";
  display: block;
  width: 72px;
  height: 5px;
  background: linear-gradient(90deg, #fbbf24 0%, #f59e0b 100%);
  border-radius: 3px;
  margin-bottom: 1.4rem;
}
.duplicates .dup-section-eyebrow {
  margin: 0 0 0.55rem;
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #fbbf24;
}
.duplicates .dup-section-headline {
  margin: 0 0 0.9rem;
  font-size: clamp(2.2rem, 4.5vw, 3.1rem);
  font-weight: 900;
  line-height: 1.08;
  letter-spacing: -0.025em;
  color: #ffffff;
}
.duplicates .dup-section-lede {
  margin: 0;
  max-width: 72ch;
  font-size: 1.1rem;
  line-height: 1.55;
  color: #c0cdda;
}
@media (max-width: 720px) {
  .duplicates .dup-section-banner { margin: 3rem 0 1.5rem; padding-top: 1.1rem; }
  .duplicates .dup-section-banner::before { width: 56px; height: 4px; margin-bottom: 1rem; }
  .duplicates .dup-section-lede { font-size: 1rem; }
}

/* v1.7.34 — access-instructions modal. Native <dialog> styled to fit the
   site's dark-mode register. Per-type accent (cyan for Strapi, violet
   for GitHub, amber for Server) on the title underline + the left
   border, so the modal visually echoes the chip the user clicked. */
dialog.access-modal {
  width: min(640px, calc(100vw - 2rem));
  max-height: calc(100vh - 4rem);
  padding: 0;
  background: #161b22;
  color: #c0cdda;
  border: 1px solid #2a3340;
  border-left: 4px solid #7dd3fc;
  border-radius: 10px;
  box-shadow: 0 25px 70px rgba(0, 0, 0, 0.7);
  overflow: hidden;
}
dialog.access-modal::backdrop {
  background: rgba(0, 0, 0, 0.65);
}
dialog.access-modal-github { border-left-color: #c4b5fd; }
dialog.access-modal-server { border-left-color: #fcd34d; }
dialog.access-modal .access-modal-close-form {
  margin: 0;
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
}
dialog.access-modal .access-modal-close {
  width: 36px;
  height: 36px;
  background: transparent;
  border: 1px solid transparent;
  color: #8b949e;
  font-size: 1.6rem;
  line-height: 1;
  cursor: pointer;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
dialog.access-modal .access-modal-close:hover,
dialog.access-modal .access-modal-close:focus-visible {
  color: #ffffff;
  border-color: #2a3340;
  background: rgba(255, 255, 255, 0.04);
  outline: none;
}
dialog.access-modal .access-modal-title {
  margin: 0;
  padding: 1.4rem 3.4rem 1rem 1.6rem;
  font-size: 1.45rem;
  font-weight: 800;
  line-height: 1.25;
  color: #f0f6fc;
  border-bottom: 1px solid #21262d;
}
dialog.access-modal .access-modal-body {
  padding: 1.2rem 1.6rem 1.4rem;
  max-height: calc(100vh - 12rem);
  overflow-y: auto;
}
dialog.access-modal .access-modal-body p {
  margin: 0 0 0.95rem;
  font-size: 1rem;
  line-height: 1.6;
}
dialog.access-modal .access-modal-body p:last-child { margin-bottom: 0; }
dialog.access-modal .access-modal-body code {
  background: rgba(0, 0, 0, 0.4);
  padding: 0.05rem 0.4rem;
  border-radius: 3px;
  font-size: 0.88em;
  color: #d2a8ff;
}
dialog.access-modal .access-modal-steps-h3 {
  margin: 1.3rem 0 0.6rem;
  font-size: 0.95rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #f0f6fc;
}
dialog.access-modal .access-modal-steps {
  margin: 0 0 1.1rem;
  padding-left: 1.2rem;
}
dialog.access-modal .access-modal-steps li {
  margin: 0 0 0.7rem;
  line-height: 1.55;
}
dialog.access-modal .access-modal-steps li:last-child { margin-bottom: 0; }
dialog.access-modal .access-modal-cta {
  margin: 1.3rem 0 0;
  padding: 0.95rem 1.1rem;
  background: rgba(125, 211, 252, 0.08);
  border-left: 3px solid #7dd3fc;
  border-radius: 4px;
  font-size: 0.98rem;
  line-height: 1.55;
}
dialog.access-modal-github .access-modal-cta {
  background: rgba(196, 181, 253, 0.08);
  border-left-color: #c4b5fd;
}
dialog.access-modal-server .access-modal-cta {
  background: rgba(252, 211, 77, 0.08);
  border-left-color: #fcd34d;
}
dialog.access-modal .access-modal-cta a {
  color: #58a6ff;
  text-decoration: underline;
  text-underline-offset: 2px;
}
@media (max-width: 540px) {
  dialog.access-modal { width: calc(100vw - 1rem); }
  dialog.access-modal .access-modal-title { font-size: 1.2rem; padding: 1.1rem 3.2rem 0.8rem 1.2rem; }
  dialog.access-modal .access-modal-body { padding: 1rem 1.2rem 1.2rem; }
}

/* v1.7.30 — "Coming soon" section. Same banner anatomy as the fleet +
   duplicates sections (eyebrow / clamped headline / lede / accent bar),
   but with a violet accent so the eye registers it as a third register:
   not current state (blue), not warning (amber), but upcoming work. */
.todo .todo-section-banner {
  margin: 4.5rem 0 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid #2a3340;
}
.todo .todo-section-banner::before {
  content: "";
  display: block;
  width: 72px;
  height: 5px;
  background: linear-gradient(90deg, #d2a8ff 0%, #8957e5 100%);
  border-radius: 3px;
  margin-bottom: 1.4rem;
}
.todo .todo-section-eyebrow {
  margin: 0 0 0.55rem;
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #d2a8ff;
}
.todo .todo-section-headline {
  margin: 0 0 0.9rem;
  font-size: clamp(2.2rem, 4.5vw, 3.1rem);
  font-weight: 900;
  line-height: 1.08;
  letter-spacing: -0.025em;
  color: #ffffff;
}
.todo .todo-section-lede {
  margin: 0 0 1.8rem;
  max-width: 72ch;
  font-size: 1.1rem;
  line-height: 1.55;
  color: #c0cdda;
}
.todo .todo-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 1rem;
}
.todo .todo-item {
  background: #181d27;
  border: 1px solid #2a2540;
  border-left: 4px solid #8957e5;
  border-radius: 6px;
  padding: 1rem 1.2rem 1.1rem;
}
.todo .todo-item-h3 {
  margin: 0 0 0.4rem;
  font-size: 1.05rem;
  font-weight: 700;
  color: #f0e7ff;
}
.todo .todo-item p {
  margin: 0;
  font-size: 0.96rem;
  line-height: 1.55;
  color: #c0cdda;
}
.todo .todo-item code {
  background: rgba(0, 0, 0, 0.35);
  padding: 0.05rem 0.35rem;
  border-radius: 3px;
  font-size: 0.85em;
}
.todo .todo-footer-note {
  margin: 1.4rem 0 0;
  font-size: 0.92rem;
  color: #8b949e;
}
.todo .todo-footer-note a {
  color: #d2a8ff;
  text-decoration: underline;
  text-underline-offset: 2px;
}
@media (max-width: 720px) {
  .todo .todo-section-banner { margin: 3rem 0 1.5rem; padding-top: 1.1rem; }
  .todo .todo-section-banner::before { width: 56px; height: 4px; margin-bottom: 1rem; }
  .todo .todo-section-lede { font-size: 1rem; }
  .todo .todo-item { padding: 0.9rem 1rem; }
  .todo .todo-item-h3 { font-size: 1rem; }
}

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
.duplicates .dup-counting-note {
  /* v1.7.20 — tiny sub-headline that explains what the big number is
     counting. Lives directly under the headline so a manager glancing
     at the section knows whether the number includes images/text/etc.
     or just the audit-actionable subset. Amber-tinted to read as an
     advisory note, not a normal body paragraph. */
  margin: -4px 0 16px;
  padding: 10px 14px;
  font-size: 0.93em;
  line-height: 1.5;
  color: #f4dfa0;
  background: rgba(251, 191, 36, 0.06);
  border: 1px solid rgba(251, 191, 36, 0.22);
  border-left: 3px solid #fbbf24;
  border-radius: 6px;
  max-width: 78ch;
}
.duplicates .dup-counting-note strong { color: #ffffff; font-weight: 700; }
.duplicates .dup-counting-note em { color: #fde6a1; font-style: italic; }
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
/* v1.7.24: single unified explainer block — replaces the pre-v1.7.24
   .dup-explainer-open + .dup-not-error + .dup-intentional + .dup-caveat
   layout (five visually-distinct callouts) with one cohesive container.
   Same information; less visual noise. Inline <strong> + <em> carry
   emphasis where colored borders used to. The exact/variant kind-cards
   still get their accent borders because they're the actually-useful
   visual comparison; everything else demoted to body prose. */
.duplicates .dup-explainer {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 12px;
  padding: 22px 28px 18px;
  margin: 0 0 24px;
  color: #d4dae0;
  line-height: 1.6;
}
.duplicates .dup-explainer > p {
  margin: 0 0 0.85rem;
  font-size: 0.98rem;
  max-width: 78ch;
}
.duplicates .dup-explainer > p:last-of-type { margin-bottom: 0.4rem; }
.duplicates .dup-explainer > p strong { color: #ffffff; }
.duplicates .dup-explainer > p em { color: #e8ecf1; font-style: italic; }
.duplicates .dup-explainer code {
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.88em;
  padding: 0.04em 0.4em;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
}
.duplicates .dup-explainer-h3 {
  margin: 0 0 0.9rem;
  font-size: 1.22rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: #ffffff;
}
.duplicates .dup-caveat-details {
  margin: 1rem 0 0;
  padding: 0.55rem 0.9rem;
  background: rgba(255, 255, 255, 0.03);
  border-left: 3px solid #6e7681;
  border-radius: 0 6px 6px 0;
  font-size: 0.92rem;
  color: #c0cdda;
}
.duplicates .dup-caveat-details > summary {
  cursor: pointer;
  font-weight: 600;
  color: #d4dae0;
  list-style: none;
  padding: 0.2rem 0;
}
.duplicates .dup-caveat-details > summary::-webkit-details-marker { display: none; }
.duplicates .dup-caveat-details > summary::before {
  content: "▸ ";
  display: inline-block;
  margin-right: 0.25rem;
  transition: transform 120ms ease;
  color: #8b949e;
}
.duplicates .dup-caveat-details[open] > summary::before { content: "▾ "; }
.duplicates .dup-caveat-details > summary em { color: #d4dae0; font-style: italic; }
.duplicates .dup-caveat-details > p {
  margin: 0.5rem 0 0.2rem;
  line-height: 1.55;
}
.duplicates .dup-caveat-details code {
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.86em;
  padding: 0.04em 0.35em;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
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

/* v1.7.24: legacy .dup-explainer (a collapsible details pattern that
   predated the v1.7.0 redesign) + .dup-caveat (the inline yellow note,
   superseded by .dup-caveat-details collapsible) removed — both classes
   are no longer emitted, and the v1.7.24 .dup-explainer / .dup-caveat-details
   styles defined above own the same selector names now. */

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
  /* v1.12.1: the trimmed 4-column table fills the width and wraps, so there
     is no horizontal panning — overflow-x:auto stays only as a mobile safety
     net. Vertical scroll within max-height keeps the sticky header useful. */
  width: 100%;
  overflow-x: auto;
  overflow-y: auto;
  max-height: 70vh;
  border-top: 1px solid #21262d;
  -webkit-overflow-scrolling: touch;
  border-radius: 2px;
}
.paginator {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.55rem 1rem;
  margin: 0.7rem 0 0.5rem;
  font-size: 13px;
  color: #c9d1d9;
}
.pag-info { font-weight: 600; }
.pag-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 0.4rem; }
.pag-size { color: #9aa5b1; }
.pag-size select {
  background: #161b22; color: #e5e5e5; border: 1px solid #2e3b4d;
  border-radius: 4px; padding: 2px 5px; font-size: 13px; margin-left: 4px;
}
.pag-btn, .pag-num {
  background: #1f2a37; color: #93c5fd; border: 1px solid #2e3b4d;
  border-radius: 4px; padding: 3px 9px; font-size: 13px; cursor: pointer;
}
.pag-btn:hover:not(:disabled), .pag-num:hover { background: #2a3a52; color: #bfdbfe; }
.pag-btn:disabled { opacity: 0.4; cursor: default; }
.pag-num-active, .pag-num-active:hover {
  background: #2563eb; color: #fff; border-color: #2563eb; font-weight: 700;
}
.pag-pages { display: inline-flex; gap: 0.25rem; align-items: center; }
.pag-gap { color: #6b7280; padding: 0 1px; }
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
  width: 100%;
  table-layout: auto;
  font-size: 13px;
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
  padding: 0.4rem 0.7rem;
  border-bottom: 1px solid #1a1a1a;
  color: #e5e5e5;
  vertical-align: top;
  word-break: break-word;
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
/* v1.7.17 — duplicates "for information only" callout. Replaces the
   pre-v1.7.17 download-the-duplicates-CSV button. Duplicate removal needs
   per-site reference checking, not a downloadable worksheet. The amber
   left border + eyebrow style says "warning, not action item." Three
   numbered reasons (N-times search surface / wrong-copy risk / asymmetric
   references) sit in their own slightly-tinted block so the eye lands on
   them rather than skimming past as prose. */
.dup-info-only {
  margin: 1.2rem 0 0.6rem;
  padding: 1.1rem 1.3rem 1.05rem 1.5rem;
  background: linear-gradient(180deg, #1c1a10 0%, #181610 100%);
  border: 1px solid #2a2618;
  border-left: 6px solid #fbbf24;
  border-radius: 10px;
  color: #d4dae0;
  line-height: 1.55;
}
.dup-info-only-eyebrow {
  margin: 0 0 0.3rem;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #fbbf24;
}
.dup-info-only-title {
  margin: 0 0 0.7rem;
  font-size: 1.18rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: #ffffff;
}
.dup-info-only p {
  margin: 0 0 0.65rem;
  font-size: 0.96rem;
}
.dup-info-only p strong { color: #ffffff; }
.dup-info-only-reasons {
  margin: 0.65rem 0 0.9rem;
  padding: 0.85rem 1rem 0.85rem 2.4rem;
  background: rgba(251, 191, 36, 0.06);
  border-radius: 6px;
  border: 1px solid rgba(251, 191, 36, 0.18);
  font-size: 0.95rem;
  list-style: decimal;
}
.dup-info-only-reasons li {
  margin: 0.35rem 0;
  padding-left: 0.3rem;
}
.dup-info-only-reasons li::marker {
  font-weight: 800;
  color: #fbbf24;
}
.dup-info-only-reasons strong { color: #ffffff; font-weight: 700; }
.dup-info-only-plain {
  margin: 0.5rem 0 0.1rem;
  padding: 0.55rem 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border-left: 3px solid #6e7681;
  border-radius: 0 4px 4px 0;
  font-size: 0.9rem;
  color: #b8c0c8;
  line-height: 1.55;
}
.dup-info-only-plain em {
  color: #d4dae0;
  font-style: italic;
  font-weight: 600;
}
.dup-info-only-plain code {
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.88em;
  padding: 0.04em 0.35em;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  color: #e5e5e5;
}
/* v1.7.19: duplicates table filter — remediable/reference/all chips above
   the table. Default state is "Remediable only" because that's where the
   manager/auditor attention belongs; the on-page table hides the
   non-remediable rows by JS toggle of [data-dup-side] visibility against
   the wrapper's [data-dup-active-filter] attribute. */
.dup-filter-bar {
  margin: 1rem 0 0.75rem;
  padding: 0.85rem 1rem;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid #21262d;
  border-radius: 8px;
}
.dup-filter-help {
  margin: 0 0 0.65rem;
  font-size: 0.9rem;
  color: #9aa5b1;
  line-height: 1.55;
}
.dup-filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.dup-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.85rem;
  background: transparent;
  color: #c9d1d9;
  border: 1px solid #2a323d;
  border-radius: 999px;
  font-family: inherit;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 100ms ease, color 100ms ease, border-color 100ms ease;
}
.dup-filter-chip:hover {
  background: rgba(88, 166, 255, 0.08);
  color: #58a6ff;
  border-color: #58a6ff;
}
.dup-filter-chip:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
}
.dup-filter-chip.is-active {
  background: #1f6feb;
  color: #ffffff;
  border-color: #1f6feb;
}
.dup-filter-chip.is-active:hover { background: #388bfd; color: #ffffff; }
.dup-filter-count {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 0.8em;
  opacity: 0.85;
}
.dup-filter-chip.is-active .dup-filter-count { opacity: 1; }
/* v1.12.1: row kind-filtering is JS-driven (see the duplicates IIFE) so it
   composes with the paginator's inline row show/hide. */
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
  <div class="site-header-left">
    <span class="icjia-logo" aria-hidden="true">${ICJIA_LOGO_SVG}</span>
    <span class="brand"><span>filecap</span> fleet audit snapshot</span>
  </div>
  <div class="site-header-right">
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
  </div>
</header>

<main>

  <!-- v1.7.23: top section banner — mirrors the v1.7.22 "Cross-Server Duplicates"
       banner so the page reads as TWO clearly-marked sections (Fleet snapshot
       at top, Cross-Server Duplicates below) with the same visual grammar. -->
  <div class="fleet-section-banner" role="presentation">
    <p class="fleet-section-eyebrow">Section · Fleet snapshot</p>
    <h1 class="fleet-section-headline">ICJIA Accessibility Fleet Audit</h1>
    <p class="fleet-section-lede">A complete scan of every file on ICJIA&#39;s ${he(String(siteCount))} sites, with audit-actionable counts, per-site detail, and a 30-second answer to &ldquo;what may need accessibility remediation across our fleet right now?&rdquo;</p>
    <p class="fleet-section-meta">Generated <time>${he(generatedAt)}</time> &middot; ${he(String(siteCount))} website${siteCount !== 1 ? "s" : ""}</p>
  </div>

  <section class="hero">
    <p class="subtitle">Generated <time>${he(generatedAt)}</time> from ${he(String(siteCount))} website${siteCount !== 1 ? "s" : ""}</p>

    ${(() => {
      // v1.7.13: infographic-style fleet hero. Leads with the AUDIT count
      // (the actionable number) plus a donut chart matching the per-card
      // pattern. Old hero led with the total — managers misread that as
      // "this is everything that needs work."
      const fleetPctRaw = fleetTotalFiles > 0 ? (fleetRemediable / fleetTotalFiles) * 100 : 0;
      const fleetPct = Math.round(fleetPctRaw * 10) / 10;
      const fleetPctInt = Math.round(fleetPctRaw);
      let fleetPhrase;
      if (fleetTotalFiles === 0)        fleetPhrase = "No files inventoried";
      else if (fleetPctInt === 0)       fleetPhrase = "No files may need audit";
      else if (fleetPctInt <= 12)       fleetPhrase = "A small share may need audit";
      else if (fleetPctInt <= 28)       fleetPhrase = "About a quarter may need audit";
      else if (fleetPctInt <= 42)       fleetPhrase = "About a third may need audit";
      else if (fleetPctInt <= 58)       fleetPhrase = "About half may need audit";
      else if (fleetPctInt <= 72)       fleetPhrase = "Two-thirds may need audit";
      else if (fleetPctInt <= 88)       fleetPhrase = "Most may need audit";
      else                              fleetPhrase = "Nearly all may need audit";
      const fleetAriaLabel = `${fleetRemediable.toLocaleString()} of ${fleetTotalFiles.toLocaleString()} files may need accessibility audit, ${fleetPctInt} percent.`;
      // v1.9.0: accessibility-score band. Only rendered when at least one
      // PDF has been audited; sites / fleets that haven't run the audits
      // step show nothing extra.
      const auditBandHtml = fleetAuditedPdfCount > 0 ? `
      <div class="fleet-audit-band" role="region" aria-label="PDF accessibility scoring summary">
        <p class="fleet-audit-eyebrow">PDF accessibility scoring</p>
        <div class="fleet-audit-row">
          <div class="fleet-audit-stat">
            <span class="fleet-audit-grade fleet-audit-grade-${fleetAvgGrade ? fleetAvgGrade.toLowerCase() : "x"}">${he(fleetAvgGrade ?? "—")}</span>
            <span class="fleet-audit-lbl">average score <strong>(${fleetAvgScore ?? "—"})</strong></span>
          </div>
          <div class="fleet-audit-stat">
            <span class="fleet-audit-num">${he(fleetAuditedPdfCount.toLocaleString())}</span>
            <span class="fleet-audit-lbl">PDFs audited</span>
          </div>
          ${fleetAuditPending > 0 ? `<div class="fleet-audit-stat">
            <span class="fleet-audit-num fleet-audit-num-dim">${he(fleetAuditPending.toLocaleString())}</span>
            <span class="fleet-audit-lbl">PDFs awaiting audit</span>
          </div>` : ""}
          ${fleetAuditErrorCount > 0 ? `<div class="fleet-audit-stat">
            <span class="fleet-audit-num fleet-audit-num-dim">${he(fleetAuditErrorCount.toLocaleString())}</span>
            <span class="fleet-audit-lbl">PDFs with audit errors</span>
          </div>` : ""}
        </div>
        <p class="fleet-audit-context">Accessibility scores come from <a href="https://audit.icjia.app" target="_blank" rel="noopener">audit.icjia.app</a> — strict WCAG 2.1 AA + IITAA §E205.4 scoring. Click "Open report" on any PDF row for the per-file breakdown and remediation hints. Spreadsheets, Word docs, and PowerPoints are not scored here; use their authoring apps' built-in checkers.</p>
      </div>
      ` : "";
      return `<div class="fleet-hero" role="img" aria-label="${he(fleetAriaLabel)}">
      <div class="fleet-hero-num-block">
        <p class="fleet-hero-eyebrow">Files that may need accessibility audit</p>
        <p class="fleet-hero-num">${he(fleetRemediable.toLocaleString())}</p>
        <p class="fleet-hero-context">out of <strong>${he(fleetTotalFiles.toLocaleString())}</strong> files scanned across ${he(String(siteCount))} ICJIA website${siteCount !== 1 ? "s" : ""}</p>
      </div>
      <div class="fleet-hero-donut-block">
        <div class="fleet-hero-donut" style="--pct:${fleetPct}%" aria-hidden="true">
          <div class="fleet-hero-donut-pct">${fleetPctInt}%<small>may need audit</small></div>
        </div>
        <p class="fleet-hero-phrase"><strong>${he(fleetPhrase)}</strong></p>
      </div>
    </div>
    ${auditBandHtml}`;
    })()}
  </section>

  <section class="explanation">
    <h2>Why aren&#39;t all ${he(fleetTotalFiles.toLocaleString())} files counted as possibly needing work?</h2>

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
          files — also may not need remediation. They&#39;re listed for
          completeness too.
        </p>
      </div>
    </div>
  </section>

  <section class="by-type">
    <h2>By file type</h2>

    <div class="by-type-grid">
      <div class="by-type-column remediable">
        <h3>Files that may need remediation</h3>
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
        <h3>Files that may not need remediation</h3>
        <p class="caption">
          Handled separately by site editors — or simply may not apply.
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

  <!-- v1.7.25: PII banner moved here from the top of the page. The audit
       numbers + donut hero are the most important above-the-fold content, so
       they get the top position; the PII reassurance sits right before the
       Websites-in-this-audit grid where a viewer would naturally start
       asking "wait, what's actually IN these audits?" Headline spells out
       PII so a non-technical reader who hasn't seen the acronym doesn't
       have to guess what it means (and doesn't misread it as "PILL"). -->
  <aside class="no-pii-banner" role="note" aria-labelledby="no-pii-heading">
    <div class="no-pii-banner-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        <path d="m9 12 2 2 4-4"/>
      </svg>
    </div>
    <div class="no-pii-banner-body">
      <p class="no-pii-banner-eyebrow">Privacy</p>
      <h2 id="no-pii-heading" class="no-pii-banner-title">Zero Personally Identifying Information (PII) in this audit</h2>
      <p class="no-pii-banner-lede">This is a file inventory of <strong>publicly-hosted documents</strong> on ICJIA&#39;s websites. <strong>No personally identifying information is included or referenced</strong> &mdash; not in this page, not in any CSV, not in any of the downloadable files.</p>

      <div class="no-pii-banner-columns">
        <div class="no-pii-banner-col no-pii-banner-col-in">
          <h3>What this audit <em>does</em> contain</h3>
          <ul>
            <li>Filenames and folder paths from each site&#39;s public file directory</li>
            <li>File metadata: size, modification date, file type</li>
            <li>Format-specific structure (PDF page counts, image-only flag, heading coverage, etc.)</li>
            <li>The same documents the public already sees on the live sites</li>
          </ul>
        </div>
        <div class="no-pii-banner-col no-pii-banner-col-out">
          <h3>What this audit <em>does not</em> contain</h3>
          <ul>
            <li>No Social Security numbers, dates of birth, or driver&#39;s-license numbers</li>
            <li>No names, addresses, phone numbers, or email addresses of individuals</li>
            <li>No case-file content, investigation details, or law-enforcement records</li>
            <li>No staff personnel records, payroll, or HR data</li>
            <li>No login credentials, session tokens, or internal system data</li>
          </ul>
        </div>
      </div>

      <p class="no-pii-banner-footer">The Intranet site contains <strong>ICJIA-internal materials</strong> (staff worksheets, bus schedules, internal references) &mdash; useful to ICJIA staff, but <strong>still contains zero personally identifying information</strong>. Same applies to every other site in this audit.</p>
    </div>
  </aside>

  <section class="section">
    <h2>Websites in this audit</h2>
    <div class="site-grid-sort" role="group" aria-label="Sort the websites list">
      <span class="site-grid-sort-label">Sort by:</span>
      <div class="site-grid-sort-buttons">
        <button type="button" class="sort-btn" data-sort="az" aria-pressed="false">
          <span class="sort-btn-glyph" aria-hidden="true">A&thinsp;&rarr;&thinsp;Z</span>
          <span class="sort-btn-label">Alphabetical</span>
        </button>
        <button type="button" class="sort-btn is-active" data-sort="added" aria-pressed="true">
          <span class="sort-btn-glyph" aria-hidden="true">&#9733;</span>
          <span class="sort-btn-label">Most recently added</span>
        </button>
        <button type="button" class="sort-btn" data-sort="files" aria-pressed="false">
          <span class="sort-btn-glyph" aria-hidden="true">&#9660;</span>
          <span class="sort-btn-label">Most files first</span>
        </button>
      </div>
    </div>
    <div class="site-grid">
${cardsHtml}
    </div>
  </section>

${renderMasterCsvSection(masterCsv)}
${renderOrphansSection(orphans)}
${renderLlmContextSection(llmContext)}
${renderDuplicatesSection(duplicateGroups, duplicatesCsv)}
${renderTodoSection()}

${renderAccessModals()}

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
/* v1.12.1: duplicates-table click-and-drag panning removed — the trimmed
   4-column table fits without horizontal panning, and the drag handler was
   a click-eating hazard. The filter + paginator IIFE below replaces it. */

/* v1.7.8 — clipboard handler for the expanded tech-details on each site
   card. One delegated listener on document.body covers every copy
   button regardless of how many cards the page has. stopPropagation +
   preventDefault so the click is consumed by the button alone and never
   bubbles to the stretched-link (which would navigate to the detail
   page mid-copy). navigator.clipboard.writeText preferred; falls back
   to a hidden-textarea + execCommand("copy") on file:// loads and very
   old browsers. */
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
    e.stopPropagation();
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

/* v1.12.1 — duplicates table: kind-filter chips + paginator. Replaces the
   v1.7.19 CSS-driven filter (display:none rules that fought the paginator's
   inline row show/hide). The chips also swap the hero stat numbers so the
   headline count always matches the active filter. */
(function () {
  "use strict";
  var wrap = document.querySelector("[data-dup-pan]");
  if (!wrap) return;
  var table = wrap.querySelector("table");
  var tbody = table ? table.querySelector("tbody") : null;
  if (!tbody) return;
  var allRows = Array.prototype.slice.call(tbody.children);

  var bar = document.querySelector("[data-dup-filter-bar]");
  var hero = document.querySelector(".dup-hero");

  var activeFilter = wrap.getAttribute("data-dup-active-filter") || "remediable";
  var pageSize = 25;
  var currentPage = 1;
  var matched = [];

  var pageInfo = document.getElementById("dup-page-info");
  var pagPrev = document.getElementById("dup-pag-prev");
  var pagNext = document.getElementById("dup-pag-next");
  var pagPages = document.getElementById("dup-pag-pages");
  var pageSizeSel = document.getElementById("dup-page-size");

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
        ? "No duplicates in this view"
        : "Showing " + (start + 1).toLocaleString() + "–" + end.toLocaleString() +
          " of " + total.toLocaleString() + " duplicate groups";
    }
    if (pagPrev) pagPrev.disabled = currentPage <= 1;
    if (pagNext) pagNext.disabled = currentPage >= totalPages;
    renderPageButtons(totalPages);
  }

  function apply() {
    matched = allRows.filter(function (tr) {
      return activeFilter === "all" || tr.getAttribute("data-dup-side") === activeFilter;
    });
    currentPage = 1;
    renderPage();
  }

  // Hero stat numbers track the active filter.
  var stats = null;
  if (hero) {
    try { stats = JSON.parse(hero.getAttribute("data-dup-stats") || "null"); }
    catch (e) { stats = null; }
  }
  var NOTES = {
    remediable: "<strong>Counting only files that may need accessibility remediation</strong> — PDFs, Word, Excel, PowerPoint, legacy Office. Images, text, markdown, and other reference files are duplicated too but they don’t affect audit scope, so they’re excluded from the headline number. Change the filter below the explainer to see all duplicates or only reference files.",
    reference:  "<strong>Counting reference-file duplicates only</strong> — images, text, markdown, archives, and similar. These don’t affect audit scope; the audit-actionable subset (PDFs, Word, Excel, PowerPoint, legacy Office) is hidden right now. Switch the filter back to <em>Remediable only</em> to see the headline number that matters.",
    all:        "<strong>Counting every duplicate</strong>, including non-actionable kinds (images, text, archives, etc.). The default <em>Remediable only</em> view shows just the duplicates that affect audit scope; switch back to that view for the headline number that matters most for accessibility planning."
  };
  function applyStats(side) {
    if (!hero || !stats) return;
    var s = stats[side] || stats.remediable;
    var total = hero.querySelector('[data-dup-stat="total"]');
    var exact = hero.querySelector('[data-dup-stat="exact"]');
    var variant = hero.querySelector('[data-dup-stat="variant"]');
    var exactLbl = hero.querySelector('[data-dup-stat-label="exact"]');
    var variantLbl = hero.querySelector('[data-dup-stat-label="variant"]');
    var note = hero.querySelector('.dup-counting-note');
    if (total) total.textContent = Number(s.total).toLocaleString();
    if (exact) exact.textContent = Number(s.exact).toLocaleString();
    if (variant) variant.textContent = Number(s.variant).toLocaleString();
    if (exactLbl) exactLbl.textContent = s.exact === 1 ? "exact copy" : "exact copies";
    if (variantLbl) variantLbl.textContent = s.variant === 1 ? "variant" : "variants";
    if (note && NOTES[side]) note.innerHTML = NOTES[side];
    hero.setAttribute("data-dup-active", side);
  }

  if (bar) {
    var chips = bar.querySelectorAll("[data-dup-filter]");
    bar.addEventListener("click", function (e) {
      var chip = e.target.closest ? e.target.closest("[data-dup-filter]") : null;
      if (!chip) return;
      activeFilter = chip.getAttribute("data-dup-filter");
      wrap.setAttribute("data-dup-active-filter", activeFilter);
      chips.forEach(function (c) {
        var on = c === chip;
        c.classList.toggle("is-active", on);
        c.setAttribute("aria-pressed", on ? "true" : "false");
      });
      applyStats(activeFilter);
      apply();
    });
  }

  if (pagPrev) pagPrev.addEventListener("click", function () { currentPage--; renderPage(); });
  if (pagNext) pagNext.addEventListener("click", function () { currentPage++; renderPage(); });
  if (pageSizeSel) pageSizeSel.addEventListener("change", function () {
    var n = parseInt(pageSizeSel.value, 10);
    if (!isNaN(n) && n > 0) pageSize = n;
    currentPage = 1;
    renderPage();
  });

  apply();
})();

/* v1.7.34 — access-instructions modal: click any per-site "For bulk
   file access" chip to open the matching <dialog> for that site's
   access type. Native showModal() handles focus trap + Escape close.
   Click on the ::backdrop (everything outside the dialog content)
   closes the dialog too — implemented by checking whether the click
   landed on the dialog element itself rather than a descendant. */
(function () {
  document.addEventListener("click", function (e) {
    if (!e.target || !e.target.closest) return;
    var chip = e.target.closest("[data-access-modal]");
    if (chip) {
      var kind = chip.getAttribute("data-access-modal");
      var dlg = document.getElementById("access-modal-" + kind);
      if (dlg && typeof dlg.showModal === "function") {
        e.preventDefault();
        e.stopPropagation();
        dlg.showModal();
      }
      return;
    }
    // Click on a <dialog>'s ::backdrop: target === the dialog itself
    // (the content is inside an inner wrapper, so a click on a child
    // wouldn't have target === the dialog).
    if (e.target.matches && e.target.matches("dialog.access-modal")) {
      e.target.close();
    }
  });
})();

/* v1.7.39 — site-grid sort toolbar. Reorders the .site-card
   articles already in the DOM by appending them back to .site-grid
   in the chosen order. Persists the user's choice to sessionStorage
   so it survives soft navigations (e.g. password-gate reload). */
(function () {
  var grid = document.querySelector(".site-grid");
  if (!grid) return;
  var buttons = document.querySelectorAll(".site-grid-sort .sort-btn");
  if (!buttons || buttons.length === 0) return;

  function sortCards(mode) {
    var cards = Array.prototype.slice.call(grid.querySelectorAll(".site-card"));
    if (mode === "added") {
      cards.sort(function (a, b) {
        return (Number(b.getAttribute("data-sort-added")) || 0) -
               (Number(a.getAttribute("data-sort-added")) || 0);
      });
    } else if (mode === "files") {
      cards.sort(function (a, b) {
        return (Number(b.getAttribute("data-sort-files")) || 0) -
               (Number(a.getAttribute("data-sort-files")) || 0);
      });
    } else {
      cards.sort(function (a, b) {
        var ak = a.getAttribute("data-sort-az") || "";
        var bk = b.getAttribute("data-sort-az") || "";
        return ak.localeCompare(bk, undefined, { sensitivity: "base" });
      });
    }
    var frag = document.createDocumentFragment();
    cards.forEach(function (c) { frag.appendChild(c); });
    grid.appendChild(frag);
  }

  function setActive(mode) {
    buttons.forEach(function (b) {
      var active = b.getAttribute("data-sort") === mode;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  buttons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var mode = btn.getAttribute("data-sort") || "az";
      sortCards(mode);
      setActive(mode);
      try { sessionStorage.setItem("filecap-site-sort", mode); } catch (_) {}
    });
  });

  // v1.12.2: default sort is "added" (most recently added first) so newer
  // sites lead and the oldest (e.g. the ARI summits) sit at the bottom. Cards
  // are rendered alphabetically server-side, so always sort on load.
  var saved = null;
  try { saved = sessionStorage.getItem("filecap-site-sort"); } catch (_) {}
  var initial = saved || "added";
  sortCards(initial);
  setActive(initial);
})();
</script>

</body>
</html>`;

  if (password) {
    return injectPasswordGate(html, password);
  }
  return html;
}
