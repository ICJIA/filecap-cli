# Manager-friendly rollup redesign

**Date:** 2026-05-11
**Author:** brainstorming session (cschweda + Claude)
**Status:** Draft for user review
**Target version:** 1.7.0 (minor bump — visible UX change)

## Problem

Non-technical managers who land on the fleet rollup at `fleet.icjia.app` need to grok each site's accessibility-audit scope in a glance. The current cards bury the site title in a small `<h3>`, use the short nickname only (e.g. "DVFR", "i2i") with no explanation, and present one paragraph of mixed numbers ("69 need accessibility audit · 33 other · 38 MB"). For a manager who _won't_ read (busy, skim-mode), this lands as undifferentiated gray text. Detail pages have the same issue: small `<h1>`, modest stat block, then the file table.

The redesign goal is one sentence: **make each card and each detail page read like an infographic for an executive who has 3 seconds**.

## Non-goals

- No changes to the file table, filter chips, row-marker legend, CSV download mechanics, or the "image-only PDFs / need OCR" chip on detail pages — those work and are not in this scope.
- No changes to the master-spreadsheet card or the duplicates section on the index page beyond inheriting the new color tokens. (Both are already prominent; redesigning their internals is out of scope.)
- No light mode. Existing dark-mode palette is the only target.
- No per-site brand color identity (e.g., DVFR purple, ARI green). Single color system across the fleet; per-card differentiation comes from data, not chrome.
- No npm-publish in this version bump. `commit + push + Netlify deploy` only. The user runs `./publish.sh first` (or similar) when they want it on npm.

## Decisions (locked during brainstorming)

| #   | Decision                                                                                                                                                                                               | Source                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| D1  | Each site gets an optional `siteFullName` in `sites.json`. Card title prefers `siteFullName`; falls back to `siteName`. Full-name map for all 17 sites baked into the deliverable (`sites.json` edit). | Q1 + user-supplied full names                                                                  |
| D2  | The hero numbers on each card are **total files** and **files needing audit**, both shown big, both color-coded (blue = scope, amber = workload). No size hero.                                        | Q2 → "B"                                                                                       |
| D3  | Cards include a **donut chart** with the audit percentage in the center plus a plain-English caption ("Two-thirds need audit · 69 of 102 files").                                                      | Q3 → "donut + percentage"                                                                      |
| D4  | Index grid switches from 3-col to **2-col** at desktop; collapses to **1-col** on mobile (<820 px).                                                                                                    | User: "More space, easier to make responsive."                                                 |
| D5  | The donut sits on **its own row below** the two-up tiles, not beside them. Rationale: gives the two-up tiles the full card width so the numbers themselves can scale up (~3.6em, up from 3em).         | User: "Feel free to put the donut graph on its own line… in order to make the numbers bigger." |
| D6  | Nickname (DVFR, i2i, ICJIA…) renders bold (font-weight 800) on light gray (`#c0cdda`) for ≥ 7:1 contrast on the card background — comfortably above WCAG AA 2.1 (4.5:1 normal, 3:1 large).             | User: "make the nickname WCAG AA 2.1 contrasty."                                               |
| D7  | The detail-page header uses **Variant 1**: the same two-up tiles + donut pattern as the index card, blown up wide across the top of the page. Donut on its own row here too.                           | Q5 → "1"                                                                                       |
| D8  | "Managers who won't read" is the design audience, not "managers who can't read." Visual-first because they're busy, not because of literacy.                                                           | User clarification                                                                             |

## Architecture

### Data layer — `sites.json`

Add an optional `siteFullName` string to each site entry. Existing `siteName` (nickname) stays — it now drives the small uppercase label above the title. The full name flows into the card and the detail page header. Sites without `siteFullName` fall back to `siteName` (zero-config compatibility for older user configs).

The 17 ICJIA-fleet full names landed during brainstorming:

| siteName         | siteFullName                                    |
| ---------------- | ----------------------------------------------- |
| DVFR             | Domestic Violence Fatality Review               |
| r3               | Restore. Reinvest. Renew. (R3) Program          |
| i2i              | Institute to Innovate                           |
| ICJIA            | Illinois Criminal Justice Information Authority |
| Infonet          | InfoNet                                         |
| ILFVCC           | Illinois Family Violence Coordinating Council   |
| Archive          | ICJIA Document Archive                          |
| Intranet         | ICJIA Staff Intranet                            |
| VPP              | Violence Prevention Project                     |
| ARI              | Adult Redeploy Illinois                         |
| ILHEALS          | Illinois HEALS                                  |
| Research Hub 1.0 | ICJIA Research Hub                              |
| SPAC             | Sentencing Policy Advisory Council              |
| ARI Summit 2023  | Adult Redeploy All Sites Summit 2023            |
| ARI Summit 2019  | Adult Redeploy All Sites Summit 2019            |
| ARI Summit 2018  | Adult Redeploy All Sites Summit 2018            |
| ARI Summit 2017  | Adult Redeploy All Sites Summit 2017            |

These get written to `~/.filecap/sites.json` as part of the implementation rollout.

### View layer — three touchpoints

1. **`src/web/index-page.js`** — generates `index.html`. Changes:
   - New card grid layout (2-col, equal-height).
   - New card anatomy as defined in "Card anatomy" below.
   - New color tokens (blue / amber pair) added to the embedded stylesheet.
2. **`src/report/html.js`** — generates `<site>.html` (per-site detail page). Changes:
   - New page-header block (Variant 1 from Q5) using the same two-up tiles + donut pattern.
   - File table and existing filter UI below it: **unchanged**.
3. **`src/web/styles.js`** — shared stylesheet (currently 70 lines). Add the new color tokens + the donut SVG-free CSS (conic-gradient based).

### Donut implementation

CSS-only via `conic-gradient`:

```css
.donut {
  width: 140px;
  height: 140px;
  border-radius: 50%;
  background: conic-gradient(
    var(--audit-color) 0 calc(var(--pct) * 1%),
    var(--total-color) calc(var(--pct) * 1%) 100%
  );
  position: relative;
}
.donut::after {
  content: "";
  position: absolute;
  inset: 16px;
  background: var(--card-bg);
  border-radius: 50%;
}
.donut .pct {
  /* the % number in the middle */
}
```

`--pct` is set inline per card from the inventory summary. No SVG, no JS, no chart library — works offline once Netlify serves the page.

## Card anatomy (final)

```
┌──────────────────────────────────────────┐  ← min-height: 520 px
│              DVFR  (nickname)            │     bold #c0cdda, 0.78em, AA-AA
│       Domestic Violence Fatality Review  │     1.6em, weight 800, max-w 28ch
│                                          │
│  ┌────────────┐  ┌────────────┐          │     two-up tiles
│  │   102      │  │    69      │          │     each tile 50% width
│  │ total files│  │ need audit │          │     num: 3.6em weight 900
│  └────────────┘  └────────────┘          │     blue tile / amber tile
│                                          │
│             ┌────────────┐               │     donut on its own row
│             │    68%     │               │     140 × 140 px
│             │ need audit │               │
│             └────────────┘               │
│       Two-thirds need audit              │     plain-English caption
│       69 of 102 files                    │
│                                          │
│  📄 63 PDFs   📝 6 Word   🖼 33 images  │     file-type chips
│                                          │
│  38 MB · scanned May 11, 2026            │     meta strip
│                                          │
│  ┌──────────────────────────────────┐    │     CTA: full-width within card
│  │   View detailed report →         │    │     blue background, dark text
│  └──────────────────────────────────┘    │     padding 18px / 22px
└──────────────────────────────────────────┘
```

Equal-height alignment guaranteed via:

- `display: flex; flex-direction: column` on the card.
- Fixed slots for nickname (1 line), name (`min-height: 2.4em`), tiles (fixed), donut row (fixed), chips (fixed), meta (fixed), CTA pinned with `margin-top: auto`.

## Detail-page header (Q5 Variant 1, final)

```
← All sites
Domestic Violence Fatality Review              ← h1, 2.4em, weight 900
DVFR · dvfr-strapi-prod · scanned May 11, 2026

┌────────────────────┐ ┌────────────────────┐
│      102           │ │       69           │  ← two-up tiles, wider page
│ total files        │ │ need audit         │     so num: 4em weight 900
└────────────────────┘ └────────────────────┘

           ┌──────────┐
           │   68%    │                          ← donut on its own row
           │need audit│
           └──────────┘
       Two-thirds need audit
       69 of 102 files

63 PDFs · 6 Word docs · 33 images · 38 MB total
▾ 7 image-only PDFs need OCR — focus filter below

[ ...existing filter chips and file table, unchanged... ]
```

## Color tokens

| Token             | Hex                     | Used for                               |
| ----------------- | ----------------------- | -------------------------------------- |
| `--card-bg-top`   | `#18202b`               | Card gradient top                      |
| `--card-bg-bot`   | `#141a23`               | Card gradient bottom (also page bg)    |
| `--card-border`   | `#2a323d`               | Card border                            |
| `--total-color`   | `#4dabf7`               | Blue — scope (total files)             |
| `--audit-color`   | `#ffa84d`               | Amber — workload (files needing audit) |
| `--total-tile-bg` | `rgba(77,171,247,0.10)` | Blue tile background                   |
| `--audit-tile-bg` | `rgba(255,168,77,0.13)` | Amber tile background                  |
| `--name-color`    | `#ffffff`               | Site title                             |
| `--nick-color`    | `#c0cdda`               | Nickname (≥ 7:1 on card bg)            |
| `--meta-color`    | `#788391`               | Meta strip / muted text                |
| `--cta-bg`        | `#4dabf7`               | CTA button background                  |
| `--cta-fg`        | `#0c1219`               | CTA button text                        |

All AA-2.1-validated against the relevant backgrounds.

## Responsive behavior

- `≥ 820 px` viewport: 2-col grid, cards at ~440 px wide.
- `< 820 px`: 1-col grid, cards stretch full width minus page padding.
- Card internals (tiles, donut, chips, CTA) flex to the available width; no second breakpoint needed below 820 px because the 1-col layout already gives each card its own row.

## Error / edge cases

| Case                              | Behavior                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site has no `siteFullName`        | Title slot shows `siteName` (current behavior preserved).                                                                                                                                                                                                                                                            |
| Site has no `siteUrl`             | Nickname-line URL link omitted (current behavior preserved).                                                                                                                                                                                                                                                         |
| Site inventory has 0 files        | Both tiles show `0`; donut renders fully blue (0% amber slice); caption reads "No files inventoried." CTA still links to the (empty) detail page.                                                                                                                                                                    |
| Audit percentage 0% or 100%       | `conic-gradient` handles both endpoints natively — verified visually in mockup.                                                                                                                                                                                                                                      |
| Name longer than 28 ch (~3 lines) | Name container has `max-width: 28ch` so long names wrap to up to 3 lines without overflowing the card. `min-height: 2.4em` reserves space for 2 lines (shorter names align consistently); 3-line names push the rest of the card down but the row stays aligned because all cards in the row stretch to the tallest. |

## Testing strategy

Existing test suites (288 tests across 27 files) cover the data layer + introspection — none of that changes.

Net-new tests:

1. `test/web/index-page.test.js` — snapshot of one rendered card to catch regressions on the markup structure (assert classes, the presence of donut `--pct` style, the two `<span class="num">` elements, etc.). One green-path snapshot + one zero-files edge case.
2. `test/report/html.test.js` — snapshot of the new detail-page header block. Same idea.
3. Manual / Lighthouse: verify WCAG AA 2.1 contrast on the deployed Netlify page using the `axecap` / `contrastcap` MCP. Capture screenshots via `viewcap` before/after for the design retrospective.

No visual-regression test infrastructure exists; not adding one for this version. Snapshot tests catch structural regressions; a human looks at the page after deploy.

## Migration path

Single git branch, single commit (or two commits — see below). The data-layer change (`siteFullName` in `sites.json`) is the only thing the user sees that affects their saved config; new field is optional so adding it to one fleet doesn't break another fleet's `sites.json`.

Commit shape (single tag `v1.7.0`):

- `examples/audit-fleet-auto.sh`-era version → 1.7.0
- `package.json` bump
- `CHANGELOG.md` entry under `[1.7.0]`
- `src/web/index-page.js` — card markup + styles
- `src/report/html.js` — detail-page header block
- `src/web/styles.js` — color tokens
- `test/...` — two new snapshot tests
- `docs/superpowers/specs/2026-05-11-manager-friendly-rollup-redesign.md` — this file

User's `~/.filecap/sites.json` gets the 17 `siteFullName` fields applied as a separate (non-git) edit during rollout — it's not in the repo.

## Open questions

None requiring user input before implementation planning. (`siteFullName` map is locked. Color/typography choices were validated visually in the brainstorming session.)
