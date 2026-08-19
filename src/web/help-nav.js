// v1.61.0 — the "Start here" nav link, in one place.
//
// The header nav markup is hand-written in six generators (index-page,
// sites-page, whats-new, search-page, help-page, report/html). Adding a
// sixth link by hand in each of them guarantees drift — one page would
// end up with a different title, a different icon, or no link at all.
// This module has no imports on purpose: report/html.js and every
// src/web page can pull it in without creating an import cycle.
//
// Placed FIRST in the nav on every page. The complaint this page answers
// is "I don't know where to start" — a link a reader has to scan four
// other buttons to find is not an answer to that.

/** Compass-rose glyph — "you are here / find your way". */
const HELP_NAV_ICON = `<svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><path d="M10.6 5.4 6.2 6.9 4.7 11.3l4.4-1.5z"/></svg>`;

const HELP_NAV_TITLE =
  "New here? A ten-minute walkthrough: find your site, download its spreadsheet, fill in the Notes column";

/**
 * The nav button linking to help.html. Interpolate into a
 * `.site-header-right` (or the per-site report's `.report-back-bar-right`)
 * ahead of the other `.audit-tool-link` buttons.
 *
 * @param {object} [args]
 * @param {boolean} [args.current] - true on help.html itself, which marks
 *   the button as the current page instead of linking in a circle.
 * @returns {string}
 */
export function helpNavLink({ current = false } = {}) {
  return `<a class="audit-tool-link nav-help${current ? " is-current" : ""}" href="help.html"${current ? ` aria-current="page"` : ""} title="${current ? "You are here" : HELP_NAV_TITLE}">
      ${HELP_NAV_ICON}
      <span>Start here</span>
    </a>`;
}

/** Convenience binding for the common (non-current) case. */
export const HELP_NAV_LINK = helpNavLink();

/**
 * Accent styling for the Start-here nav button. Amber register — the one
 * warm button in a row of blue ones, so a first-time reader's eye lands on
 * it. Keeps the base button's bright-fill/dark-ink pattern (and so its
 * contrast); only the hue changes. Appended after the page's own
 * stylesheet by every page that renders the link.
 *
 * @returns {string}
 */
export function helpNavCss() {
  return `
.audit-tool-link.nav-help {
  background: linear-gradient(180deg, #f0a92a 0%, #d1890f 100%);
  border-color: #d1890f;
  color: #1a1204;
}
.audit-tool-link.nav-help:hover { box-shadow: 0 4px 14px rgba(240, 169, 42, 0.35); }
.audit-tool-link.nav-help:focus-visible { outline: 3px solid #f0a92a; }
.audit-tool-link.nav-help.is-current {
  background: none;
  border-color: #d1890f;
  color: #f0a92a;
  cursor: default;
}
.audit-tool-link.nav-help.is-current:hover { transform: none; box-shadow: none; filter: none; }
/* A sixth nav button no longer fits beside the wordmark on a narrow
   desktop — .site-header-right is flex:none, so the wordmark is what
   wraps to three lines. The logo beside it identifies and links the site
   on its own, so the wordmark is the thing that goes. Below 600px the
   button labels collapse to icons and it fits again. */
@media (min-width: 601px) and (max-width: 1180px) {
  .site-header .brand { display: none; }
}
`;
}
