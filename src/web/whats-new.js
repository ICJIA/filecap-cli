// v1.44.0 — the What's New system, mirroring the file-accessibility-audit
// repo's announcements pattern (apps/web: AnnouncementBanner.vue +
// pages/announcements.vue), adapted to this bundle's static template-literal
// world:
//
//   - WHATS_NEW: a config array, NEWEST FIRST. To announce something, PREPEND
//     an entry — the home-page banner renders only WHATS_NEW[0]. Dismissal is
//     permanent per `id` (stored client-side); bump the id to re-show.
//   - renderWhatsNewBanner(): the dismissible home-page banner + its inline
//     dismiss script. Rendered visible by default (a banner that appears
//     after load shifts the whole page — the audit app measured that as
//     essentially its entire CLS) and hidden immediately by the script when
//     this visitor already dismissed it.
//   - generateWhatsNewHtml(): the archive page (whats-new.html) listing every
//     entry newest-first. Without it, an update a visitor dismissed — or that
//     was superseded before they next visited — becomes unreachable.

import { INDEX_CSS } from "./index-css.js";
import { renderSiteFooter, siteFooterCss } from "./site-footer.js";
import { escapeHtml as he } from "../util/html.js";
// Benign import cycle (whats-new ⇄ index-page): index-page renders the banner,
// this page borrows the header logo. Both are function-time accesses — neither
// module touches the other's bindings during evaluation — which Node ESM
// resolves fine. Same pattern as sites-page.js reusing index-page exports.
import { ICJIA_LOGO_SVG } from "./index-page.js";

const DISMISS_STORAGE_KEY = "fleet-audit:dismissed-whats-new";

/**
 * Every update announced on the fleet-audit bundle, newest first.
 * Entry shape (same as the audit app's ANNOUNCEMENTS):
 *   id        - kebab slug ending in the announce date; dismissal key
 *   badge     - short chip label ("Scoring update", "New", "Improved")
 *   text      - plain-language paragraph, written for non-technical readers
 *   linkText? - optional trailing link label
 *   linkHref? - optional trailing link target
 *   date      - human-readable date shown under the text
 */
export const WHATS_NEW = [
  {
    id: "custom-search-reports-2026-08-17",
    badge: "New",
    text: "The search page can now build a custom report. Tick the box next to any result — or add every match at once — then search for something else and keep adding: your picks from every search collect into one running report. A bar above the results shows how many files you've gathered and lets you view the list, remove single rows, download everything as an Excel workbook (with clickable links and a column showing which search found each file), or clear it and start over. The report is private to your browser tab: it survives leaving and returning to the search page — you'll be asked whether to keep or clear it — and it clears itself when the tab closes.",
    linkText: "Try it on the search page",
    linkHref: "search.html",
    date: "August 17, 2026",
  },
  {
    id: "fleet-file-search-2026-08-16",
    badge: "New",
    text: "You can now search every file on every audited site from one page. Type a full or partial filename — fragments are fine, like “dvfr report” or “annual 2023”, and close-enough spellings still match — and the results show each matching file, which site it lives on, its accessibility score, a link to open it, and a “View report” link to that file's shareable audit report (exactly what's wrong and how to fix it, in a new tab). The matched part of each name is highlighted, with a note when a match came from the site's name rather than the filename. Filter by file type or website with one click, and download whatever you found as an Excel workbook with clickable links, ready to share. Look for “Search” in the navigation on every page. Also in this update: invisible system files (like .gitkeep and .DS_Store) no longer count toward any file totals — that removed 25 files and moved the fleet total from 8,787 to 8,762. The remediation list is unchanged at 4,628, since none of those files were documents.",
    linkText: "Try the search page",
    linkHref: "search.html",
    date: "August 16, 2026",
  },
  {
    id: "archive-server-re-added-2026-08-16",
    badge: "Scope change",
    text: "The ICJIA Document Archive (archive.icjia.cloud) is back in the audit as of August 16, 2026. It was removed on August 13 on the premise that archived files aren't remediated — but the archive still serves live files that may need remediation, so it now counts like every other site. That adds 2,086 files to the inventory (1,429 of them on the remediation list) and 1,209 scored PDFs, all graded under the current rubric. Because the archive's documents score low (site average 28), the fleet-wide average moved from 69 to 54 — the fleet didn't get worse overnight; it now includes documents that were previously out of scope. Today's totals, after the same-day cleanup that removed 25 invisible system files from the counts: 8,762 files across 12 audited sites, with 4,628 on the remediation list — 3,180 scored PDFs, 22 PDFs that couldn't be scored, and 1,426 Word, Excel, and PowerPoint files (checked with the Office apps' built-in accessibility checkers).",
    date: "August 16, 2026",
  },
  {
    // v1.44.1 — rev2: the first wording said "1,971 files" directly above the
    // hero's "3,199 files may need audit" and invited "which is it?". Now the
    // entry reconciles the two counts. New id so visitors who dismissed the
    // rev-1 banner see the corrected one once.
    id: "file-scoring-rubric-update-2026-08-15-rev2",
    badge: "Scoring update",
    text: "The File Audit Tool refined how it scores documents, and on August 15, 2026 every PDF on every site was re-scored from scratch under the new rubric — all 1,971 scoreable PDFs, none reused from earlier runs. The fleet-wide average moved from 64 to 69. If a site's file-accessibility number or its ▲/▼ change chip jumped around that date, the movement mostly reflects the improved rubric, not files being fixed or getting worse. (Why 1,971 and not the 3,199 documents on the remediation list? The tool scores PDFs only: that list also counts 1,217 Word, Excel, and PowerPoint files — those are checked with the Office apps' built-in accessibility checkers instead — plus 11 PDFs that couldn't be scored, marked “Not scored” in the spreadsheets.) Every number shown on this site comes from that same August 15 re-score, so all surfaces agree.",
    linkText: "How files are scored",
    linkHref: "https://audit.icjia.app/technical-details",
    date: "August 15, 2026",
  },
];

function renderEntryLink(entry) {
  if (!entry.linkHref || !entry.linkText) return "";
  return ` <a href="${he(entry.linkHref)}" target="_blank" rel="noopener noreferrer">${he(entry.linkText)}</a>`;
}

/**
 * The dismissible home-page banner for WHATS_NEW[0], plus its inline dismiss
 * script. Returns "" when there are no entries.
 */
export function renderWhatsNewBanner() {
  const current = WHATS_NEW[0];
  if (!current) return "";
  return `<div class="whats-new-banner" id="whats-new-banner" role="region" aria-label="What's New" data-announcement-id="${he(current.id)}">
    <span class="whats-new-badge">${he(current.badge)}</span>
    <p class="whats-new-text"><span class="whats-new-heading">What's New</span>${he(current.text)}${renderEntryLink(current)}
      <span class="whats-new-meta">Updated ${he(current.date)} &middot; <a href="whats-new.html" aria-label="See all updates — previous announcements">See all updates</a></span>
    </p>
    <button type="button" class="whats-new-dismiss" aria-label="Dismiss announcement" title="Dismiss">
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M6 6l12 12"/></svg>
    </button>
  </div>
  <script>(function () {
    "use strict";
    var KEY = "${DISMISS_STORAGE_KEY}";
    var banner = document.getElementById("whats-new-banner");
    if (!banner) return;
    var id = banner.getAttribute("data-announcement-id");
    function readDismissed() {
      try {
        var parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) { return []; }
    }
    if (readDismissed().indexOf(id) !== -1) banner.hidden = true;
    var btn = banner.querySelector(".whats-new-dismiss");
    if (btn) btn.addEventListener("click", function () {
      banner.hidden = true;
      try {
        var seen = readDismissed();
        if (seen.indexOf(id) === -1) seen.push(id);
        localStorage.setItem(KEY, JSON.stringify(seen));
      } catch (e) { /* storage unavailable (private mode) — session-only dismissal */ }
    });
  })();</script>`;
}

/**
 * Generate the whats-new.html archive page.
 *
 * @param {object} [args]
 * @param {string} [args.generatedAt] - preformatted "generated at" string
 * @returns {string} full HTML document
 */
export function generateWhatsNewHtml({ generatedAt = "" } = {}) {
  const entries = WHATS_NEW.map((entry, index) => `<li class="whats-new-entry">
      <div class="whats-new-entry-head">
        <span class="whats-new-badge">${he(entry.badge)}</span>
        <span class="whats-new-entry-date">${he(entry.date)}</span>${index === 0 ? `
        <span class="whats-new-current" aria-label="Most recent update">&middot; current</span>` : ""}
      </div>
      <p class="whats-new-entry-text">${he(entry.text)}${renderEntryLink(entry)}</p>
    </li>`).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="Every update announced on the ICJIA Fleet Audit Assessment, newest first — what changed, and when.">
<meta name="robots" content="noindex, nofollow">
<title>What&#39;s new — ICJIA Fleet Audit Assessment</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%230d1117'/><path d='M12 9L12 23L23 16Z' fill='%23ffb000'/></svg>">
<style>${INDEX_CSS}${siteFooterCss()}</style>
</head>
<body id="top">
<a class="skip-link" href="#main">Skip to content</a>

<header class="site-header">
  <div class="site-header-left">
    <a class="icjia-logo" href="index.html" aria-label="ICJIA Fleet Audit Assessment home" title="Back to the fleet snapshot">${ICJIA_LOGO_SVG}</a>
    <span class="brand"><span>ICJIA</span> Fleet Audit Assessment</span>
  </div>
  <div class="site-header-right">
    <a class="audit-tool-link nav-sites" href="index.html" title="Back to the fleet snapshot (home)">
      <svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 7.5 8 2.5l5.5 5"/><path d="M4 7v6h8V7"/></svg>
      <span>Home</span>
    </a>
    <a class="audit-tool-link nav-search" href="search.html" title="Search every file across the fleet by full or partial filename">
      <svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
      <span>Search</span>
    </a>
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
  </div>
</header>

<main id="main">
  <div class="fleet-section-banner" role="presentation">
    <p class="fleet-section-eyebrow">Update archive</p>
    <h1 class="fleet-section-headline">What&#39;s new</h1>
    <p class="fleet-section-lede">Every update announced on the <a href="index.html">home page</a>, newest first. The banner there shows only the most recent one and can be dismissed, so this is the full list.${generatedAt ? ` Generated <time>${he(generatedAt)}</time>.` : ""}</p>
  </div>

  <section class="whats-new-list-wrap" aria-label="Update archive">
    ${WHATS_NEW.length ? `<ol class="whats-new-list">
${entries}
    </ol>` : `<p class="whats-new-empty">There are no announcements yet.</p>`}
    <p class="whats-new-back"><a href="index.html">&larr; Back to the fleet snapshot</a></p>
  </section>
</main>

${renderSiteFooter({ generatedAt })}
</body>
</html>`;
}
