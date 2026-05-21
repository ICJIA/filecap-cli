// Accessibility audit log — data for the /accessibility page.
//
// A hand-maintained, chronological record of accessibility checks run against
// the deployed fleet-audit bundle. Appended to whenever accessibility work is
// done. The /accessibility page renders this; see src/web/accessibility-page.js.
//
// Two sources of checks:
//   "browser" — axe DevTools runs performed by hand in a browser
//   "backend" — axecap / Lighthouse / contrastcap runs from the tooling

/** Current verified accessibility standing — shown in the page's status panel. */
export const currentStatus = {
  asOf: "2026-05-21",
  lighthouse: 100,
  axeCore: "0 violations (WCAG A + AA)",
  axeDevTools: "0 serious — pending live re-verification",
  viewports: "desktop + mobile",
};

/**
 * Chronological log of accessibility checks, NEWEST FIRST. The page renders the
 * array in order and does not re-sort.
 *
 * Entry shape: { date, source, tool, scope, viewport, status, result, notes? }
 *   date     ISO date "YYYY-MM-DD"
 *   source   "browser" | "backend"
 *   tool     human-readable tool name
 *   scope    which page(s) were checked
 *   viewport "desktop" | "mobile" | "desktop + mobile"
 *   status   "pass" | "found" | "fixed"  — drives the result colour
 *   result   short result text
 *   notes    optional, e.g. the version it shipped in
 */
export const accessibilityLog = [
  {
    date: "2026-05-21",
    source: "backend",
    tool: "contrastcap + axe-core + Lighthouse",
    scope: "new /accessibility page (desktop); fleet index + per-site report (mobile)",
    viewport: "desktop + mobile",
    status: "pass",
    result: "/accessibility page: 0 contrast failures, 0 axe-core violations, Lighthouse 100. Mobile pass on the index and a per-site report: 0 violations, Lighthouse 100.",
    notes: "v1.16.0",
  },
  {
    date: "2026-05-20",
    source: "backend",
    tool: "contrastcap + axe-core + Lighthouse",
    scope: "fleet index, per-site reports",
    viewport: "desktop",
    status: "pass",
    result: "Contrast failures cleared; 0 axe-core violations; Lighthouse 100.",
    notes: "v1.15.2",
  },
  {
    date: "2026-05-20",
    source: "browser",
    tool: "axe DevTools extension (advanced ruleset)",
    scope: "live fleet index + SPAC per-site report",
    viewport: "desktop",
    status: "fixed",
    result: "28 serious on the index + 1 on a per-site report (text-contrast, heading-markup). Fixed in v1.15.2.",
  },
  {
    date: "2026-05-20",
    source: "backend",
    tool: "axe-core + Lighthouse",
    scope: "fleet index, per-site reports, orphans report",
    viewport: "desktop",
    status: "fixed",
    result: "Lighthouse accessibility raised from an 88-93 baseline to 100; 0 axe-core violations.",
    notes: "v1.15.1",
  },
];
