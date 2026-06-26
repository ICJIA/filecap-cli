# Card Score Donuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace each homepage card's single "% may need audit" scope donut and the site-score tile with a paired **File accessibility | Website accessibility** score-donut row, so managers see at a glance that document accessibility and web-page accessibility are separate, non-correlated measures.

**Architecture:** A new `renderScorecards(summary, siteAudit)` helper in `index-page.js` renders two grade-band-colored score donuts (data already on the card object — `summary.auditScoreSum/auditedPdfCount` for files, `sr.siteAudit.score` for the site). It replaces the `renderSiteA11yTile` call and the `.donut-row` block inside `renderCard`. `renderSiteA11yTile` is removed. CSS for the paired donuts is added to `index-css.js`; the now-unused scope-donut and site-a11y CSS is removed.

**Tech Stack:** Node ≥20 ESM, vitest. Reuses `gradeForScore` from `src/site-audit/aggregate.js` and the `he()` escaper + conic-gradient donut technique already in `index-page.js`/`index-css.js`.

## Global Constraints

- **Node ≥20**, ESM; match existing file style.
- **Two scores are independent and must read as separate** — distinct labels ("File accessibility" / "Website accessibility"), "documents" / "web pages" tags, and a caption stating they don't correlate.
- **File score = scored-PDF average only** (`auditScoreSum / auditedPdfCount`); Office files aren't auto-scored — label it "scored PDFs". Never show a 0 for "unscored" — use a "not scored yet" placeholder.
- **Reuse `gradeForScore`** (`src/site-audit/aggregate.js`) for A–F bands; do not duplicate the bands. Bands: A≥90, B≥80, C≥70, D≥60, F<60.
- **Folds into the unpushed 1.35.0** — extend that CHANGELOG entry; no new version.
- **Escape all interpolated values with `he()`.**
- Lint: the repo has **4 known pre-existing errors** (`src/audits/retrying-fetcher.js`, `test/report-remediation-score.test.js`) — introduce no new ones; removing the scope-donut's `pct`/`phrase` vars is required so they don't become unused-var lint errors.
- Git: conventional commit; **never** an AI co-author trailer.

---

## Task 1: Replace card donut + tile with paired score donuts

**Files:**
- Modify: `src/web/index-page.js` — add `gradeForScore` import; remove `renderSiteA11yTile`; add `renderScorecards` + `renderScoreDonut`; in `renderCard` remove the `pct`/`phrase` block and replace the tile-call + `.donut-row` with `renderScorecards(...)`.
- Modify: `src/web/index-css.js` — replace the `.site-a11y*` + scope `.donut*` rules with `.scorecards`/`.scorecard`/`.score-donut` rules; swap the light/print donut overrides for score-donut overrides.
- Modify: `test/index-page.test.js` — remove the `renderSiteA11yTile` import + its describe block; add `renderScorecards` tests.
- Modify: `CHANGELOG.md` — add a bullet to the `## [1.35.0]` entry.

**Interfaces:**
- Consumes: `gradeForScore(score) => "A".."F"|null` (`src/site-audit/aggregate.js`); `he(s)`, `renderCard`'s in-scope `summary` + `sr.siteAudit`.
- Produces: `renderScorecards(summary, siteAudit) => string` (exported, for tests).
  - `summary`: `{ auditScoreSum?: number, auditedPdfCount?: number }`
  - `siteAudit`: `{ score?: number, grade?: string, coverage?: { scored?: number, pagesInSet?: number } } | null`

- [ ] **Step 1: Write the failing tests**

In `test/index-page.test.js`: remove the line `import { renderSiteA11yTile } from "../src/web/index-page.js";` and delete the entire `describe("renderSiteA11yTile", ...)` block. Add `renderScorecards` to the import from `../src/web/index-page.js` and append:

```js
describe("renderScorecards", () => {
  const summary = { auditScoreSum: 340, auditedPdfCount: 5 }; // avg 68 → D
  const siteAudit = { score: 94, grade: "A", coverage: { scored: 150, pagesInSet: 412 } };

  it("renders both donuts with scores, grades, coverage, and the separation note", () => {
    const html = renderScorecards(summary, siteAudit);
    expect(html).toContain("File accessibility");
    expect(html).toContain("Website accessibility");
    expect(html).toContain(">68<");                       // file score value
    expect(html).toContain(">94<");                       // site score value
    expect(html).toContain("5 scored PDFs");              // file coverage
    expect(html).toContain("150 / 412 pages scored");     // site coverage
    expect(html).toContain("grade-d");                    // 68 → D band class
    expect(html).toContain("grade-a");                    // 94 → A band class
    expect(html).toMatch(/don.t correlate|separate measures/i);
    expect(html).toContain("documents");
    expect(html).toContain("web pages");
  });

  it("placeholders the file side when no PDFs are scored", () => {
    const html = renderScorecards({ auditedPdfCount: 0 }, siteAudit);
    expect(html).toContain("No PDFs scored yet");
    expect(html).toContain(">94<"); // site still scored
  });

  it("placeholders the site side when there is no site audit", () => {
    const html = renderScorecards(summary, null);
    expect(html).toContain("Site not scored yet");
    expect(html).toContain(">68<"); // file still scored
  });

  it("placeholders both when neither is scored", () => {
    const html = renderScorecards({ auditedPdfCount: 0 }, null);
    expect(html).toContain("No PDFs scored yet");
    expect(html).toContain("Site not scored yet");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/index-page.test.js`
Expected: FAIL — `renderScorecards` is not exported (and the removed `renderSiteA11yTile` import is gone).

- [ ] **Step 3: Add the `gradeForScore` import**

In `src/web/index-page.js`, add to the top import block (after the `./index-css.js` import line):

```js
import { gradeForScore } from "../site-audit/aggregate.js";
```

- [ ] **Step 4: Replace `renderSiteA11yTile` with `renderScorecards` + `renderScoreDonut`**

In `src/web/index-page.js`, delete the entire `renderSiteA11yTile` function (its `// v1.35.0 — compact "Website accessibility" tile...` comment through its closing `}`) and put this in its place:

```js
// v1.35.0 — paired File-vs-Website accessibility score donuts on each card.
// Replaces the old "% may need audit" scope donut and the site-a11y tile. The
// pairing is the point: a site's DOCUMENT accessibility and its WEB-PAGE
// accessibility are separate measures that do not correlate.
//
// File score = average axe score of the site's SCORED PDFs
//   (summary.auditScoreSum / summary.auditedPdfCount). Office files are never
//   auto-scored, so it is labeled "scored PDFs".
// Site score = the page-audit sidecar's score (sr.siteAudit.score).
// Either side shows a "not scored yet" placeholder independently when absent.
export function renderScorecards(summary, siteAudit) {
  const auditedPdfCount = summary?.auditedPdfCount ?? 0;
  const fileScore = auditedPdfCount > 0
    ? Math.round((summary?.auditScoreSum ?? 0) / auditedPdfCount)
    : null;
  const fileCov = auditedPdfCount > 0
    ? `avg of ${auditedPdfCount.toLocaleString()} scored PDF${auditedPdfCount === 1 ? "" : "s"}`
    : "";

  const siteScore = typeof siteAudit?.score === "number" ? siteAudit.score : null;
  const cov = siteAudit?.coverage;
  const siteCov = cov
    ? `${(cov.scored ?? 0).toLocaleString()} / ${(cov.pagesInSet ?? 0).toLocaleString()} pages scored`
    : "";

  return `<div class="scorecards">
    ${renderScoreDonut({ score: fileScore, label: "File accessibility", tag: "documents", coverage: fileCov, empty: "No PDFs scored yet" })}
    ${renderScoreDonut({ score: siteScore, label: "Website accessibility", tag: "web pages", coverage: siteCov, empty: "Site not scored yet" })}
  </div>
  <p class="scorecards-note">Two separate measures — a site can score well on its <strong>pages</strong> and still publish inaccessible <strong>files</strong> (or the reverse). They don&#39;t correlate.</p>`;
}

// One 0–100 score donut colored by grade band, or a placeholder when unscored.
function renderScoreDonut({ score, label, tag, coverage, empty }) {
  if (typeof score !== "number") {
    return `<div class="scorecard">
      <span class="scorecard-label">${he(label)}</span>
      <div class="score-donut score-donut-empty"><span class="score-na">—</span></div>
      <span class="scorecard-cov">${he(empty)}</span>
      <span class="scorecard-tag">${he(tag)}</span>
    </div>`;
  }
  const grade = gradeForScore(score) ?? "";
  return `<div class="scorecard">
    <span class="scorecard-label">${he(label)}</span>
    <div class="score-donut grade-${he(grade.toLowerCase())}" style="--pct:${score}%"><span class="score-val">${he(String(score))}</span><span class="score-grade">${he(grade)}</span></div>
    <span class="scorecard-cov">${he(coverage)}</span>
    <span class="scorecard-tag">${he(tag)}</span>
  </div>`;
}
```

- [ ] **Step 5: Remove the now-dead `pct`/`phrase` block in `renderCard`**

In `src/web/index-page.js` `renderCard`, delete this whole block (it only fed the scope donut; leaving it would create unused-var lint errors):

```js
  // Audit-share percentage — rounded to 1 decimal so the conic-gradient is
  // smooth but the percent badge in the donut stays short.
  const pctRaw = totalFiles > 0 ? (remediable / totalFiles) * 100 : 0;
  const pct = Math.round(pctRaw * 10) / 10;
  const pctInt = Math.round(pctRaw);

  // Plain-English caption rounded to colloquial buckets so a manager
  // doesn't have to read a percentage to grasp the share.
  let phrase;
  if (totalFiles === 0)             phrase = "No files inventoried";
  else if (pctInt === 0)            phrase = "No files may need audit";
  else if (pctInt <= 12)            phrase = "A small share may need audit";
  else if (pctInt <= 28)            phrase = "About a quarter may need audit";
  else if (pctInt <= 42)            phrase = "About a third may need audit";
  else if (pctInt <= 58)            phrase = "About half may need audit";
  else if (pctInt <= 72)            phrase = "Two-thirds may need audit";
  else if (pctInt <= 88)            phrase = "Most may need audit";
  else                              phrase = "Nearly all may need audit";

```

- [ ] **Step 6: Swap the markup in `renderCard`**

In `src/web/index-page.js` `renderCard`'s returned template, replace this block:

```js
  ${renderSiteA11yTile(sr.siteAudit)}
  <div class="donut-row">
    <div class="donut" style="--pct:${pct}%"><div class="pct">${pctInt}%<small>may need audit</small></div></div>
    <div class="donut-caption"><strong>${he(phrase)}</strong><span>${he(remediable.toLocaleString())} of ${he(totalFiles.toLocaleString())} files</span></div>
  </div>
```

with this single line:

```js
  ${renderScorecards(summary, sr.siteAudit)}
```

- [ ] **Step 7: Replace the card CSS**

In `src/web/index-css.js`, replace the contiguous block from `.site-card .site-a11y {` through `.site-card .donut-caption span { color: #9aa5b1; font-size: 0.85em; }` (the `.site-a11y*` rules and ALL `.donut*` rules) with:

```css
/* v1.35.0 — paired File/Website accessibility score donuts (replace the old
   single "% may need audit" scope donut + the site-a11y tile). Same conic-
   gradient technique as the old .donut, sized for two side by side and colored
   by grade band. */
.site-card .scorecards {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin: 6px 0 8px;
}
.site-card .scorecard {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
}
.site-card .scorecard-label {
  font-weight: 700;
  font-size: 0.8em;
  color: #cfe0f0;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.site-card .score-donut {
  width: 112px; height: 112px;
  border-radius: 50%;
  background: conic-gradient(
    var(--fill, #4dabf7) 0 var(--pct, 0%),
    rgba(255, 255, 255, 0.12) var(--pct, 0%) 100%
  );
  display: flex; align-items: center; justify-content: center;
  position: relative;
  flex: none;
}
.site-card .score-donut::after {
  content: "";
  position: absolute;
  inset: 13px;
  background: #141a23;
  border-radius: 50%;
}
.site-card .score-donut .score-val {
  position: relative; z-index: 1;
  font-weight: 900; font-size: 1.7em; line-height: 1;
  color: #ffffff;
  font-variant-numeric: tabular-nums;
}
.site-card .score-donut .score-grade {
  position: relative; z-index: 1;
  font-weight: 700; font-size: 0.9em; margin-left: 3px;
  color: var(--fill, #4dabf7);
}
.site-card .score-donut.grade-a { --fill: #37b24d; }
.site-card .score-donut.grade-b { --fill: #74b816; }
.site-card .score-donut.grade-c { --fill: #f59f00; }
.site-card .score-donut.grade-d { --fill: #e8590c; }
.site-card .score-donut.grade-f { --fill: #e03131; }
.site-card .score-donut-empty { background: rgba(255, 255, 255, 0.06); }
.site-card .score-donut-empty .score-na {
  position: relative; z-index: 1;
  color: #6a7c8c; font-size: 1.6em; font-weight: 700;
}
.site-card .scorecard-cov { font-size: 0.73em; color: #9aa5b1; }
.site-card .scorecard-tag {
  font-size: 0.7em; color: #7d8b99;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.site-card .scorecards-note {
  text-align: center; font-size: 0.78em; color: #9aa5b1;
  margin: 0 0 14px; line-height: 1.45;
}
```

- [ ] **Step 8: Swap the light/print donut overrides**

In `src/web/index-css.js`, find these four lines (inside the light/print override block, ~line 1261):

```css
  .site-card .donut .pct { color: #b45309; }
  .site-card .donut .pct small { color: #555; }
  .site-card .donut-caption strong { color: #000; }
  .site-card .donut-caption span { color: #555; }
```

and replace them with:

```css
  .site-card .score-donut::after { background: #ffffff; }
  .site-card .score-donut .score-val { color: #1b2733; }
  .site-card .scorecard-label { color: #1b4a78; }
  .site-card .scorecard-cov,
  .site-card .scorecard-tag,
  .site-card .scorecards-note { color: #555; }
```

- [ ] **Step 9: Run tests + lint to verify green**

Run: `npx vitest run test/index-page.test.js`
Expected: PASS (the 4 `renderScorecards` tests; no `renderSiteA11yTile` references remain).

Run: `npm test`
Expected: PASS (full suite).

Run: `npm run lint`
Expected: 4 problems total, all pre-existing (`retrying-fetcher.js` ×2, `report-remediation-score.test.js` ×2). `src/web/index-page.js` and `src/web/index-css.js` clean — confirm no unused-var error for `pct`/`pctInt`/`phrase` (you removed them) and no `class="donut"` / `class="site-a11y"` references remain (`grep -n 'class="donut\|class="site-a11y' src/web/index-page.js` → empty).

- [ ] **Step 10: Add the CHANGELOG bullet**

In `CHANGELOG.md`, under the existing `## [1.35.0]` → `### Added`, append:

```markdown
- Each fleet-audit site card now shows a paired **File accessibility** vs **Website accessibility** score donut (grade-banded A–F), replacing the single "% may need audit" donut — making explicit that a site's document scores and its web-page score are independent and don't correlate. Each side shows "not scored yet" until data exists.
```

- [ ] **Step 11: Commit**

```bash
git add src/web/index-page.js src/web/index-css.js test/index-page.test.js CHANGELOG.md
git commit -m "feat: paired file-vs-website score donuts on site cards"
```

---

## Self-Review

**1. Spec coverage:**
- Paired donuts replace scope donut + site tile → Steps 4, 6, 7. ✓
- File score = scored-PDF avg; site score = sidecar; both already on card → Step 4. ✓
- Empty/partial states (independent "not scored yet") → Step 4 (`renderScoreDonut` placeholder) + tests Step 1. ✓
- Grade-band colors via `gradeForScore` → Steps 3, 4, 7. ✓
- Separation caption + documents/web-pages tags → Step 4. ✓
- Coverage lines shown → Step 4. ✓
- Out of scope (detail page, /sites, fleet hero untouched) → no task touches them. ✓
- Release folds into 1.35.0 → Step 10. ✓

**2. Placeholder scan:** No TBD/vague steps; every code step has complete code; tests have real assertions. ✓

**3. Type consistency:** `renderScorecards(summary, siteAudit)` signature matches the `renderCard` call (Step 6) and tests (Step 1). `gradeForScore` import path matches `src/site-audit/aggregate.js` (Task 3 of the prior plan, landed). `score-donut.grade-<a..f>` classes (Step 4) match the CSS variants (Step 7). The `>68<` / `>94<` test assertions match the `<span class="score-val">${score}</span>` markup. ✓

---

## Execution Handoff

Plan complete. One task, sonnet-appropriate (precise multi-edit change across two large files). Execute via subagent-driven-development, then it joins the website-accessibility-score work for the single final whole-branch review.
