// v1.61.0 — the Help nav link, in one place.
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
//
// Labelled "Help", not "Start here". The earlier label read as an
// instruction — as though the reader had to go through it before they were
// allowed to use the rest of the site. The page is optional guidance, and
// the label should say so. It stays the one real button in the nav because
// it still has to be findable, not because it is compulsory.

/** Compass-rose glyph — "you are here / find your way". */
const HELP_NAV_ICON = `<svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><path d="M10.6 5.4 6.2 6.9 4.7 11.3l4.4-1.5z"/></svg>`;

const HELP_NAV_TITLE =
  "Not sure where to start? A ten-minute guide to downloading your site's file list and deciding what happens to each file";

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
  return `<a class="audit-tool-link nav-help${current ? " is-current" : ""}" href="help.html"${current ? ` aria-current="page"` : ""} title="${current ? "You are reading this guide" : HELP_NAV_TITLE}">
      ${HELP_NAV_ICON}
      <span>Help</span>
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
/* v1.61.2 — the wordmark used to be hidden between 601px and 1180px,
   because six filled pills crowded it off the line. The nav is plain
   links now and takes about a third of the width, and .site-header-right
   wraps, so the wordmark stays at every size. */
`;
}
