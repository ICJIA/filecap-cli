# `/accessibility` page — design spec

**Date:** 2026-05-21
**Status:** approved (design); pending spec review
**Task:** #171

## Purpose

filecap audits other sites' accessibility; the deployed fleet-audit bundle should
hold itself to the same standard and *show* it. This adds an `/accessibility` page
to the bundle — a credibility artifact that presents the bundle's current
accessibility standing plus a chronological, timestamped log of every
accessibility check run against it, from both the **browser** (axe DevTools, run
by hand) and the **backend build** tooling (axecap / Lighthouse / contrastcap).

The audience is non-technical managers: the page is the one-glance answer to
"is this thing itself accessible, and how do you know?"

## Decision: how the log is stored

The accessibility log is a **committed data file** (`src/web/accessibility-log.js`).
The page generator renders it. New checks are appended to the file as part of any
accessibility change — an existing standing practice.

Rejected alternatives:

- **Build self-audit** — `web-rollup` running axe-core / Lighthouse on its own
  output. axecap and lightcap are MCP servers, not processes the build can spawn;
  and the browser axe DevTools runs cannot be automated at all. The build would
  gain a large, fragile dependency surface.
- **Markdown log** parsed by the generator — fragile parsing for what is
  structured, columnar data.

## Data file — `src/web/accessibility-log.js`

Two named exports:

```js
export const currentStatus = {
  asOf: "2026-05-21",
  lighthouse: 100,                  // Lighthouse accessibility score
  axeCore: "0 violations",           // axe-core (A + AA)
  axeDevTools: "0 serious — pending live re-verification",
  viewports: "desktop + mobile",
};

export const accessibilityLog = [
  // newest first; the generator does not re-sort
  {
    date: "2026-05-20",             // ISO date, YYYY-MM-DD
    source: "backend",               // "browser" | "backend"
    tool: "contrastcap + axe-core + Lighthouse",
    scope: "fleet index, per-site reports",
    viewport: "desktop",             // "desktop" | "mobile" | "desktop + mobile"
    status: "pass",                  // "pass" | "found" | "fixed"
    result: "contrast failures cleared; 0 axe violations; Lighthouse 100",
    notes: "v1.15.2",                // optional
  },
  // ...
];
```

`status` drives a colour chip: `pass` green, `found` amber, `fixed` blue.

## Page — `/accessibility` (served from `accessibility.html`)

Dark theme, consistent with `index-page.js` and the reports. Sections, top to
bottom:

1. **Header** — `<h1>Accessibility</h1>` and one sentence of intro.
2. **Current-status panel** — a prominent card rendering `currentStatus`:
   Lighthouse score, axe-core result, axe DevTools result, viewport coverage,
   "as of" date. Green treatment when clean.
3. **Chronological log** — a `<table>` with columns **Date · Source · Tool ·
   Scope · Result**. One row per `accessibilityLog` entry, newest first (the
   array is already ordered). Source renders as a chip (browser / backend
   build); Result carries the `status` colour.
4. **Footer** — the standard `site-footer`.

The page itself meets the same accessibility bar as the rest of the bundle:
inline SVG favicon, exactly one `<main>` landmark, headings in order, ≥4.5:1
text contrast, underlined links.

## Generator — `src/web/accessibility-page.js`

`generateAccessibilityPage({ currentStatus, log, password })` → HTML string.
Mirrors the structure of `generateIndexHtml` / `writeOrphansHtml`. `password` is
the already-hashed gate hash (or null); the caller injects the client gate when
present, consistent with the other pages.

## web-rollup wiring — `src/commands/web-rollup.js`

After the index is written, import `{ currentStatus, accessibilityLog }` and
`generateAccessibilityPage`, render the page, write `accessibility.html` to the
bundle root, and inject the password gate when `!noClientGate && password !== null`
— identical handling to the orphans report. Netlify serves `accessibility.html`
at the clean URL `/accessibility`.

## Footer link

A new "Accessibility" link (`href="accessibility.html"`) is added to the footer
of every bundle page so it is reachable from anywhere:

- `src/web/index-page.js` — the `site-footer-links` span.
- `src/report/html.js` — per-site and by-type report footers.
- `src/report/orphans-html.js` — the orphans report footer.

A relative `accessibility.html` href works from every page in the flat bundle.

## Seed log entries

The log ships pre-populated with this session's real history (newest first):

1. `2026-05-21` · backend · axe-core + Lighthouse · fleet index, per-site report ·
   **mobile** · pass — 0 violations / 100 (mobile run during this build).
2. `2026-05-20` · backend · contrastcap + axe-core + Lighthouse · index + reports ·
   desktop · pass — v1.15.2: contrast failures cleared, 0 violations, 100.
3. `2026-05-20` · browser · axe DevTools (advanced ruleset) · live index + SPAC
   report · desktop · fixed — 28 + 1 serious found, fixed in v1.15.2.
4. `2026-05-20` · backend · axe-core + Lighthouse · index + reports + orphans ·
   desktop · fixed — v1.15.1: raised the 88–93 baseline to 100.

During implementation, mobile axe-core + Lighthouse are run against the
verification build so entry 1 carries real numbers.

## Testing (TDD)

New `test/accessibility-page.test.js`:

- `generateAccessibilityPage` renders the `currentStatus` values.
- One table row per log entry; order preserved (newest first).
- Source chip renders distinctly for browser vs. backend entries.
- a11y structure: favicon link present, exactly one `<main>` landmark.

Existing web-rollup tests gain a case asserting `accessibility.html` is emitted
into the bundle.

## Out of scope

- Build-time self-auditing (rejected above).
- Tablet-specific audits — coverage is desktop + mobile, the tools' native
  viewports.
- Perf / SEO logs — this page is accessibility only.

## Files

| File | Change |
|---|---|
| `src/web/accessibility-log.js` | new — `currentStatus` + `accessibilityLog` data |
| `src/web/accessibility-page.js` | new — `generateAccessibilityPage` |
| `src/commands/web-rollup.js` | render + write + gate `accessibility.html` |
| `src/web/index-page.js` | footer "Accessibility" link |
| `src/report/html.js` | footer "Accessibility" link |
| `src/report/orphans-html.js` | footer "Accessibility" link |
| `test/accessibility-page.test.js` | new — generator tests |
| web-rollup test suite | assert `accessibility.html` emitted |
| `CHANGELOG.md` | v1.16.0 entry |

Version: minor bump → **v1.16.0** (new user-facing page).
