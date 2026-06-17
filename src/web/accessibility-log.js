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
  asOf: "2026-06-17",
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
    date: "2026-06-17",
    source: "backend",
    tool: "axecap (axe-core 4.11) + lightcap (Lighthouse)",
    scope: "per-site detail report — v1.33.0 visual-density redesign: work-first hero + small proportion ring, collapsed \"Breakdown by file type\" / \"Site details\" / row-marker-legend disclosures, and a single inventory heading the File/Page toggle swaps",
    viewport: "desktop + mobile",
    status: "fixed",
    result:
      "Per-site detail pages were reorganized to cut visual density — one work-first hero plus two collapsed disclosures replace the four stacked metric blocks, and the always-open three-column row-marker legend became a collapsed <details>. Re-checked with axe-core (A + AA) and Lighthouse. Found and fixed one issue during the redesign: WCAG 1.4.3 (AA) contrast — the new disclosure hint text (e.g. \"every type & category count\") rendered in #6e7681 on the page background at ~4:1, under the 4.5:1 floor; brightened to #8b949e (~6:1). Also demoted the in-disclosure \"By category\" label from an <h3> to a styled paragraph so the collapsed breakdown can't introduce an h1->h3 heading-order skip. After the fixes, on the deployed bundle: 0 axe-core violations and Lighthouse accessibility 100, on both desktop and mobile. (Body text over the hero's gradient panel remains an axe \"needs review\" item — gradients can't be auto-evaluated — as in prior builds.)",
    notes: "v1.33.0",
  },
  {
    date: "2026-06-12",
    source: "backend",
    tool: "axecap (axe-core 4.11) + lightcap (Lighthouse)",
    scope: "shared sticky footer rollout — fleet index, /sites, /accessibility, per-site detail (DVFR), by-type (PDFs), orphaned-files, file-errors pages",
    viewport: "desktop + mobile",
    status: "pass",
    result:
      "Every bundle page now ends in the same sticky bottom bar (contentinfo landmark, underlined links, dark + light palettes), pinned to the viewport so long detail grids never read as cut off. Re-checked all seven affected page templates: 0 axe-core violations (desktop, plus mobile on the index and a per-site report); Lighthouse accessibility 100 on the index (desktop + mobile) and the per-site report.",
    notes: "v1.30.0",
  },
  {
    date: "2026-06-07",
    source: "backend",
    tool: "axecap (axe-core 4.11) + lightcap (Lighthouse)",
    scope: "every bundle page — landing, /sites, all 13 per-site detail reports, 11 by-file-type pages, /accessibility (27 in all, desktop)",
    viewport: "desktop",
    status: "fixed",
    result:
      "Full-bundle sweep after adding the Community Engagement roster card. Found and fixed two issues. (1) WCAG 1.4.3 (AA) contrast: image-only PDF filename links rendered in #60a5fa on the lighter first-column amber row tint (#4d3a0c) measured ~4.3:1 — under the 4.5:1 floor — on the Archive and ILFVCC reports; brightened those links to #93c5fd (>=6:1 on the first column, ~7.5:1 elsewhere). (2) WCAG 1.4.1 (A) use-of-color: the access-panel \"Email Chris Schweda\" contact link was set apart from body copy by colour alone; restored its underline. After the fixes: 0 axe-core violations across all 27 pages; Lighthouse accessibility 100 on the landing, /sites, both remediated reports, and representative detail/by-type pages.",
    notes: "v1.26.0",
  },
  {
    date: "2026-06-06",
    source: "backend",
    tool: "axecap (axe-core 4.11) + Lighthouse",
    scope: "new /sites directory + fleet index (desktop + mobile)",
    viewport: "desktop + mobile",
    status: "fixed",
    result:
      "Found one WCAG 2.5.8 (AA) target-size issue on the per-card site-URL links and fixed it (>=24px tap target). After the fix: 0 axe-core violations; Lighthouse accessibility 100 and best-practices 100 (desktop + mobile); mobile performance 94-99. SEO is intentionally low (noindex) and out of scope for this protected bundle.",
    notes: "v1.21.1",
  },
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
    scope: "live fleet index + a per-site report",
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
