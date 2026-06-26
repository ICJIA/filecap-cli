# Paired File-vs-Website Score Donuts on Site Cards

- **Date:** 2026-06-26
- **Status:** Approved design — ready for implementation plan
- **Scope:** filecap-cli, homepage site cards only. Extends the website-accessibility-score work on the same branch (`website-accessibility-score`).

---

## 1. Problem

Managers conflate **file accessibility** (the PDFs/Office docs a site publishes) with **website accessibility** (the site's HTML pages). They are independent and do not correlate. The fleet-audit cards need to make that separation immediately, visually obvious — two scores, side by side, clearly labeled as different things.

## 2. Goal

On each homepage site card, show a **paired row of two score donuts**:
- **File accessibility** — average axe score of the site's scored PDFs.
- **Website accessibility** — the site's page-audit score (the sidecar built in the website-accessibility-score work).

The pairing, labels, and caption make "documents ≠ web pages, don't compare them" the takeaway.

## 3. Decisions

- **Layout (chosen):** the two paired score donuts **replace** both the existing "% may need audit" scope donut **and** the Task 9 site-score tile (`renderSiteA11yTile`). The `.nums` tiles (total files / may-need-audit count + ≈pages) stay — that is where remediation *scope* now lives.
- **Reversal of a standing decision (intentional):** filecap has deliberately kept aggregate file/PDF scores **off-page** (download-only) — it is a non-goal in the website-accessibility-score spec and a saved project note. This feature **intentionally reverses that for the card view**: the file score is now surfaced on the homepage, because the file-vs-site contrast is the teaching tool. The "contested scoring" note/non-goal will be updated to reflect this.
- **Release:** folds into the **unpushed 1.35.0** branch — extend that CHANGELOG entry, no new version.

## 4. The two scores — data is already on the card object

No new pipeline. `renderCard` already receives `sr.summary` and `sr.siteAudit`.

- **File score** = `round(summary.auditScoreSum / summary.auditedPdfCount)` when `auditedPdfCount > 0`, else `null`. This is the average axe score of the site's **scored PDFs** (the same numbers behind the download-only scores-by-site sheet). It covers PDFs only — Office files are never auto-scored — so the donut is labeled "avg of N scored PDFs."
- **Site score** = `sr.siteAudit?.score` (from `latest/site-audit.json`, loaded by web-rollup in Task 12), with a coverage line ("N / M pages scored").

## 5. Empty / partial states

- File donut: `auditedPdfCount === 0` (or no summary) → render a "not scored yet" placeholder, **not** a 0 donut.
- Site donut: no `siteAudit` or `siteAudit.score` non-numeric → "not scored yet" placeholder.
- Both omit-to-placeholder independently — a site can have one score and not the other (which itself reinforces the separation).
- Coverage is always shown beneath each donut so a thinly-scored site (e.g. few PDFs scored) is honest.

## 6. Visual treatment

- Both are 0–100 donuts colored by **grade band** (A green → F red) via the existing `gradeForScore` bands, reusing the current conic-gradient donut CSS pattern so they read as a matched pair.
- Each donut shows the numeric score in the center + the letter grade; a label above ("File accessibility" / "Website accessibility"); a coverage subline; and a "documents" / "web pages" tag.
- A single caption under the pair states they are separate measures that do not correlate.
- Accessibility: the score/grade is conveyed as text (not color alone), per the bundle's WCAG 1.4.1 practice already used for the status dot.

## 7. Code shape (contained)

- New `renderScorecards(summary, siteAudit)` helper in `src/web/index-page.js` returning the paired-donut HTML (with the two empty-state paths). It **replaces** the `.donut-row` block and the `renderSiteA11yTile(sr.siteAudit)` call inside `renderCard`.
- Remove `renderSiteA11yTile` (Task 9) and update/replace its unit tests with `renderScorecards` tests.
- New CSS for the paired score donuts in `src/web/index-css.js` (reuse/extend the existing `.donut` conic-gradient rules; add grade-band color variants). Remove now-unused scope-donut CSS only if it is not shared.
- `gradeForScore` already exists in `src/site-audit/aggregate.js`; reuse it (import) rather than duplicating the bands.

## 8. Out of scope (flagged, not included)

- The per-site **detail page** keeps its existing Website-accessibility section; no file-score donut added there.
- `/sites` stays roster-only.
- The homepage **fleet hero** is unchanged (no fleet-wide paired donuts).

## 9. Testing

Unit tests for `renderScorecards`:
- both scored → two donuts with scores, grades, coverage lines, and the separation caption.
- file-only scored (no siteAudit) → file donut + site "not scored yet".
- site-only scored (no scored PDFs) → site donut + file "not scored yet".
- neither → both placeholders, no crash.
- grade-band color/class selection for representative scores (e.g. 95→A, 65→D).
Confirm the existing card tests still pass and `renderSiteA11yTile`'s tests are removed/replaced. Full suite green; no new lint errors (the 4 pre-existing remain).
