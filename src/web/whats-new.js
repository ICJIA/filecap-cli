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
    id: "file-scoring-rubric-update-2026-08-15",
    badge: "Scoring update",
    text: "The File Audit Tool refined how it scores documents, and on August 15, 2026 every PDF on every site was re-scored from scratch under the new rubric — 1,971 files, none reused from earlier runs. The fleet-wide average moved from 64 to 69. If a site's file-accessibility number or its ▲/▼ change chip jumped around that date, the movement mostly reflects the improved rubric, not files being fixed or getting worse. Every number shown here — the site cards, the sortable Score and Grade columns in the downloadable spreadsheets, and the fleet master list — comes from that same August 15 re-score, so all surfaces agree.",
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
  return `<div class="whats-new-banner" id="whats-new-banner" role="region" aria-label="Site announcement" data-announcement-id="${he(current.id)}">
    <span class="whats-new-badge">${he(current.badge)}</span>
    <p class="whats-new-text">${he(current.text)}${renderEntryLink(current)}
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
    <a class="audit-tool-link" href="https://accessibility.icjia.app" target="_blank" rel="noopener noreferrer" title="ICJIA accessibility FAQs (accessibility.icjia.app, opens in a new tab)">
      <svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="8" cy="8" r="6.5"/>
        <path d="M6 6.2a2 2 0 1 1 2.6 1.9c-0.5 0.2-0.6 0.5-0.6 0.9"/>
        <circle cx="8" cy="11.2" r="0.55" fill="currentColor"/>
      </svg>
      <span>ICJIA Accessibility FAQs</span>
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
