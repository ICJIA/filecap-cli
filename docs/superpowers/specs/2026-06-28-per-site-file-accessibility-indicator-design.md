# Per-site file-accessibility indicator — design

**Date:** 2026-06-28
**Status:** approved (brainstorming), ready for implementation
**Ships via:** `node bin/filecap.js web-rollup` alone (template/report change, no re-scan)

## Problem

The deployed fleet-audit bundle shows, per site, how many files *may need* remediation
("May need audit" tile = `summary.remediable`), but gives no sense of **how far from
accessible those files currently are**. The per-PDF audit scores exist in each
inventory and are already averaged for the downloadable scores-by-site workbook
(`src/report/scores-by-site.js`), but that average is never surfaced on-page. A manager
looking at the homepage or a site's detail page can't tell at a glance whether a site's
documents are nearly compliant or badly broken.

## Goal

Surface, per site, a directional **file-accessibility** gauge so users can judge how much
remediation work remains:

- the count of potentially remediable files (already shown), and
- an **average PDF audit score** with a plain-language far→closer band.

This is an intentional, scoped reversal of the "no on-page aggregate score" stance — but
only for a *directional, per-site* gauge, **not** a fleet-wide compliance grade. No
fleet-level aggregate is added; the contested fleet-grade decision stays intact.

### Naming — avoid collision with the hidden "website accessibility" feature

A separate page-level "website accessibility" score was deliberately hidden (commits
`49824b5`, `7256098`). This feature is about **file** accessibility (PDF audit reports),
which is distinct. All UI labels say **"File accessibility (PDFs)"** so the two are never
conflated.

## Scope of the score

- The only per-file numeric score that exists is the **PDF audit score** (audit.icjia.app,
  0–100, higher = more accessible). Office files (`docx`/`xlsx`/`pptx`/legacy) are counted
  as remediable but are **never scored**, so they are **not** in the average. The label
  reflects this ("PDF audit average").
- Average = `auditScoreSum / auditedPdfCount` — both already on the per-site `summary`
  object that reaches the homepage card, and re-derivable on the detail page from
  `entry.audit.score`.

## Bands (shared thresholds)

Higher score = more accessible.

| Avg score | Band key | Label | Color |
|-----------|----------|-------|-------|
| `>= 80`   | `closer` | Closer to accessible | green |
| `60–79`   | `partial`| Partial progress     | yellow/amber |
| `< 60`    | `far`    | Far from accessible  | red |

Aligns with the A–F grades the audit reports already use (A–B / C–D / F). Per the real
data (2026-06-28), most fleet sites currently land in `far`/`partial`; none reach
`closer` — which is the intended "work remaining" signal.

### Low-data guard

An average over very few scored PDFs is noise. When a site has **fewer than 5 scored
PDFs**, show *"Not enough scored PDFs yet (n / N)"* instead of a score/band. (Currently
affects `vpp-git`, `203.0.113.10`, `ari-summit-2023`, `i2i`, and the zero-scored
`ari-summit-2019` / `sfs`.)

### Archive exclusion (hardcoded)

The long-term archive is exempt: many of its files are intentional ADA Title II
exceptions, so it will always score abysmally (avg ≈ 28). The site slug `archive-prod` is
**hardcoded-excluded**: it shows the remediable count plus the note *"Score N/A —
long-term archive (many files are ADA Title II exceptions)"*, no score/band. A single
exported constant `A11Y_SCORE_EXCLUDE_SLUGS = ["archive-prod"]` keeps the slug in one
place.

## Components

### New: `src/report/accessibility-band.js` (pure, unit-tested)

Single source of truth so the homepage card, the detail-page header, and the per-file
cells can never disagree.

- `A11Y_BANDS` — ordered band defs `{ key, label, min, color }` (color = a token both
  surfaces map to their own CSS).
- `MIN_SCORED_PDFS = 5`, `A11Y_SCORE_EXCLUDE_SLUGS = ["archive-prod"]`.
- `bandForScore(score) -> { key, label, color }` — maps a 0–100 number to a band.
- `summarizeFileA11y({ auditScoreSum, auditedPdfCount, auditErrorCount, auditPending, remediable, siteSlug }) -> { excluded, avg, scored, pdfs, remediable, band, enoughData }`
  — the one function both pages call. `excluded` true for archive; `enoughData` false when
  `scored < MIN_SCORED_PDFS`.

No I/O; takes plain numbers/strings. This is the TDD target.

### Homepage card — `src/web/index-page.js` `renderCard()`

Add a compact "File accessibility (PDFs)" indicator beside the existing "May need audit"
tile. Calls `summarizeFileA11y()` with the site's `summary` + slug. Renders one of:
- excluded → count + archive note;
- `!enoughData` → "Not enough scored PDFs yet (n / N)";
- otherwise → `avg/100` + colored band chip.

The remediable count already lives on the card, so this adds the score/band, not a
duplicate count. CSS bands added to `src/web/index-css.js`.

### Detail page — `src/report/html.js`

1. **Header banner:** in the summary-stats area near the top, a one-line "File
   accessibility (PDFs)" banner using the same `summarizeFileA11y()` (computed from the
   site's entries / header counts), so card and detail agree. Detail page knows its own
   slug from the source header.
2. **Per-file score cells (Part 2):** the "Remediation Score" column cell (e.g. `B/88`)
   gets a red/yellow/green background via `bandForScore(entry.audit.score)` — same
   thresholds. Special-case `col.name === "remediationScore"` in the cell builder to emit
   `<td class="rem-score rem-band-{key}">…</td>`; add `.rem-band-*` CSS to the detail
   stylesheet. Files with no score render unstyled.

### Page-view scroll/cutoff fix (Part 3)

**Root cause (confirmed by live measurement, icjia-agency detail page):** the paginated
Page-view table sits in a `.table-wrap`/`.table-scroll` pane capped at `max-height: 75vh`
with `overscroll-behavior: contain`. Its 25 rows render ~1332px tall in a ~682px pane →
a nested vertical scroll region whose wheel is trapped at the bottom (`overscroll: contain`
won't chain to the page), and the `position: sticky; bottom:0` footer overlaps the last
rows. The `75vh` cap **predates pagination**; now that rows are bounded to 25/page the cap
only causes the trap.

**Fix:** remove the obsolete vertical `max-height` cap on the paginated table panes so the
document owns the vertical scroll (no nested scroll, no wheel-trap, footer pins normally).
Preserve **horizontal** scroll for wide tables — being careful of the documented
`overflow-x:auto`→`overflow-y:auto` CSS computed-value gotcha (can't just set
`overflow-y:visible` while `overflow-x:auto`). Verify in-browser: (a) one continuous page
scroll to the footer, (b) no rows hidden behind the footer, (c) sticky header + horizontal
scroll on wide tables still acceptable. Pagination itself is unchanged (it works).

## Out of scope (YAGNI)

- No fleet-wide aggregate grade.
- Office files stay unscored (no per-file score exists).
- Not presented as an authoritative compliance grade — directional "work remaining" gauge.

## Testing

- **Unit (vitest):** `accessibility-band.js` — band boundaries (59/60/79/80), low-data
  guard (4 vs 5 scored), archive exclusion, zero-PDF sites, rounding.
- **In-browser verification:** regenerate locally (served over HTTP), confirm the card
  indicator, detail banner, colored per-file cells, and the fixed Page-view scroll on a
  page-heavy Strapi site (e.g. icjia-agency) + the archive note.

## Implementation order

1. `accessibility-band.js` + unit tests (TDD), `npm test` green.
2. Homepage card indicator + CSS.
3. Detail-page header banner.
4. Detail-page per-file cell colors + CSS.
5. Page-view scroll fix + in-browser verify.
6. Regenerate via `web-rollup`, full in-browser pass, CHANGELOG entry, version bump.
