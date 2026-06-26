# Website Accessibility Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-site, SiteImprove-style **website accessibility score** (0–100 + A–F grade, outstanding-issue breakdown, fixed/new trend) computed from each site's own pages (sitemap-driven), shown on the audit-bundle cards and per-site detail pages, and kept explicitly independent of the existing file/PDF scores.

**Architecture:** A new `site-audit` pipeline stage scores every page in a site's page set (sitemap ∪ CMS pages) through the existing `audit.icjia.app/api/audit-url-page` endpoint, reusing the shared 14-day page cache. It aggregates the per-page axe results into a purge-exempt per-site sidecar (`latest/site-audit.json`) carrying the score, a severity + WCAG-level breakdown, and an issue-set snapshot for true fixed/new diffing. `web-rollup` reads the sidecar and threads it into a compact card tile and a full detail-page section.

**Tech Stack:** Node ≥20 ESM, `commander` (CLI), `vitest` (tests), `node:crypto` (issue keys). Reuses existing `src/audits/*` (cache, page-scorer, retrying-fetcher) and `src/references/sitemap.js`.

## Global Constraints

Every task's requirements implicitly include these (copied from the spec):

- **Node ≥20**, ESM modules (`import`/`export`), match existing file style.
- **Score is sitemap/CMS-driven, NEVER derived from file counts or file rankings.** File-only-referenced pages may appear in the Page view but never move the score.
- **The website score and the file/PDF score are independent and must read as separate** — distinct visual treatment, explicit copy.
- **File/PDF aggregate score stays download-only** (off-page). **`/sites` stays roster-only** (no audit numbers). **No fleet leaderboard.**
- **Share the existing page cache:** `~/.filecap/page-audit-cache.json` (URL-keyed, 14-day TTL) so no page is scored twice across the `audits` and `site-audit` stages.
- **Sidecar lives in `latest/`** so the purge step (deletes only `*Z` run dirs) never removes it.
- **axe engine via the HTTP endpoint only** — the pipeline cannot call MCP tools (`axecap`/`lightcap`).
- **Endpoint dependency:** WCAG-level breakdown and true issue-set fixed/new require the `audit.icjia.app` endpoint to return `axe.violations[]` + `axe.incomplete[]` (each `{id, impact, tags, nodes:[{target}]}`) and to render SPAs before auditing (`networkidle` + settle). This is a change in the **separate** `audit.icjia.app` repo (see spec §6). filecap code degrades gracefully when the fields are absent (treats them as `[]`), so all filecap tasks below are buildable and testable against fixtures now; the feature only ships *truthfully* once the endpoint is live.
- **Git:** frequent commits; conventional-commit messages; **never** add an AI co-author trailer. Keep any shell command lines short (no trailing-backslash continuations).
- **Release hygiene:** CHANGELOG `## [X.Y.Z]` entry before push; append a timestamped entry to the deployed `/accessibility` log when this ships.

---

## File Structure

**New source modules** (`src/site-audit/` — the feature's cohesive home):
- `src/site-audit/wcag.js` — pure: axe tags → WCAG level.
- `src/site-audit/issue-keys.js` — pure: stable issue keys + set diff.
- `src/site-audit/aggregate.js` — pure: per-page results → site score + breakdown.
- `src/site-audit/page-set.js` — resolve sitemap ∪ CMS page set.
- `src/site-audit/sidecar.js` — read prior / build / write the sidecar.
- `src/commands/site-audit.js` — `runSiteAudit` orchestrator.
- `src/report/site-accessibility-section.js` — detail-page section HTML.

**Modified source:**
- `src/audits/page-scorer.js` — capture `violations[]` + `incomplete[]`.
- `src/report/pages.js` — export `normPageUrl`; `buildPageList` accepts a `pageScores` map.
- `src/web/index-page.js` — `renderSiteA11yTile` + insert into `renderCard`.
- `src/web/index-css.js` — card tile CSS.
- `src/report/html.js` — `writeHtml` accepts `siteAudit`/`pageScores`; render the section; pass `pageScores` to `buildPageList`; section CSS.
- `src/commands/report.js` — `runReport` threads `siteAudit`/`pageScores`.
- `src/commands/web-rollup.js` — load sidecar; attach `sr.siteAudit`; pass to `runReport`.
- `src/commands/audits.js` — (optional cleanup) remove the now-redundant references-only page pass.
- `bin/filecap.js` — register the `site-audit` command.
- `examples/audit-fleet-auto.sh`, `run-full-audit.sh` — Stage 3.6 wiring.
- `package.json`, `CHANGELOG.md`, `README.md` — release.

**New tests:** `test/site-audit-wcag.test.js`, `test/site-audit-issue-keys.test.js`, `test/site-audit-aggregate.test.js`, `test/site-audit-page-set.test.js`, `test/site-audit-sidecar.test.js`, `test/site-audit-command.test.js`, `test/site-accessibility-section.test.js`. **Extended tests:** `test/audits-page-scorer.test.js`, `test/report-pages.test.js`, `test/index-page.test.js`.

---

## Task 1: WCAG level mapper

**Files:**
- Create: `src/site-audit/wcag.js`
- Test: `test/site-audit-wcag.test.js`

**Interfaces:**
- Produces: `wcagLevelForTags(tags: string[]) => "A" | "AA" | "AAA" | "best-practice"`

- [ ] **Step 1: Write the failing test**

```js
// test/site-audit-wcag.test.js
import { describe, it, expect } from "vitest";
import { wcagLevelForTags } from "../src/site-audit/wcag.js";

describe("wcagLevelForTags", () => {
  it("maps AA tags to AA", () => {
    expect(wcagLevelForTags(["cat.color", "wcag2aa", "wcag143"])).toBe("AA");
  });
  it("maps level-A tags to A (most basic level present wins)", () => {
    expect(wcagLevelForTags(["wcag2a", "wcag111"])).toBe("A");
    expect(wcagLevelForTags(["wcag2a", "wcag2aa"])).toBe("A");
  });
  it("recognises 2.1 / 2.2 variants", () => {
    expect(wcagLevelForTags(["wcag21aa"])).toBe("AA");
    expect(wcagLevelForTags(["wcag22a"])).toBe("A");
    expect(wcagLevelForTags(["wcag2aaa"])).toBe("AAA");
  });
  it("falls back to best-practice with no success-criterion tag", () => {
    expect(wcagLevelForTags(["cat.semantics", "best-practice"])).toBe("best-practice");
    expect(wcagLevelForTags([])).toBe("best-practice");
    expect(wcagLevelForTags(undefined)).toBe("best-practice");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/site-audit-wcag.test.js`
Expected: FAIL — cannot find module `../src/site-audit/wcag.js`.

- [ ] **Step 3: Write the implementation**

```js
// src/site-audit/wcag.js
// Map an axe-core rule's tags to a WCAG conformance level. axe tags each rule
// with its WCAG mapping, e.g. ["cat.color","wcag2aa","wcag143"]. We bucket by
// the most basic level present (A before AA before AAA) — the binding
// conformance level — and fall back to "best-practice" for axe rules that carry
// no WCAG success-criterion tag.

const A_TAGS = new Set(["wcag2a", "wcag21a", "wcag22a"]);
const AA_TAGS = new Set(["wcag2aa", "wcag21aa", "wcag22aa"]);
const AAA_TAGS = new Set(["wcag2aaa", "wcag21aaa", "wcag22aaa"]);

export function wcagLevelForTags(tags) {
  const list = Array.isArray(tags) ? tags : [];
  if (list.some((t) => A_TAGS.has(t))) return "A";
  if (list.some((t) => AA_TAGS.has(t))) return "AA";
  if (list.some((t) => AAA_TAGS.has(t))) return "AAA";
  return "best-practice";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/site-audit-wcag.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/site-audit/wcag.js test/site-audit-wcag.test.js
git commit -m "feat: add axe-tags to WCAG-level mapper for site-audit"
```

---

## Task 2: Issue keys + set diff

**Files:**
- Create: `src/site-audit/issue-keys.js`
- Modify: `src/report/pages.js:13` (export `normPageUrl`)
- Test: `test/site-audit-issue-keys.test.js`

**Interfaces:**
- Consumes: `normPageUrl(u: string) => string` from `src/report/pages.js`
- Produces:
  - `issueKey(pageUrl: string, ruleId: string, nodeTarget: string[]|string) => string` (sha1 hex)
  - `collectIssueKeys(scoredPages: Array<{pageUrl, violations: Array<{id, nodes: Array<{target}>}>}>) => string[]` (deduped, sorted)
  - `diffIssueSets(prevKeys: string[], currKeys: string[]) => { fixed: number, introduced: number, stillOpen: number }`

- [ ] **Step 1: Export `normPageUrl` from pages.js**

In `src/report/pages.js`, change line 13 from:

```js
function normPageUrl(u) {
```

to:

```js
export function normPageUrl(u) {
```

- [ ] **Step 2: Write the failing test**

```js
// test/site-audit-issue-keys.test.js
import { describe, it, expect } from "vitest";
import { issueKey, collectIssueKeys, diffIssueSets } from "../src/site-audit/issue-keys.js";

describe("issueKey", () => {
  it("is deterministic and stable across trailing-slash / case URL variants", () => {
    const a = issueKey("https://x.com/About/", "color-contrast", ["main h1"]);
    const b = issueKey("https://x.com/about", "color-contrast", ["main h1"]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
  });
  it("differs by rule and by target", () => {
    const base = issueKey("https://x.com/p", "image-alt", ["img.logo"]);
    expect(base).not.toBe(issueKey("https://x.com/p", "color-contrast", ["img.logo"]));
    expect(base).not.toBe(issueKey("https://x.com/p", "image-alt", ["img.hero"]));
  });
});

describe("collectIssueKeys", () => {
  it("yields one deduped sorted key per (page, rule, node)", () => {
    const pages = [
      { pageUrl: "https://x.com/a", violations: [
        { id: "image-alt", nodes: [{ target: ["img.logo"] }, { target: ["img.hero"] }] },
      ] },
      { pageUrl: "https://x.com/b", violations: [
        { id: "image-alt", nodes: [{ target: ["img.logo"] }] },
      ] },
    ];
    const keys = collectIssueKeys(pages);
    expect(keys).toHaveLength(3);
    expect([...keys]).toEqual([...keys].sort());
  });
  it("handles a violation with no nodes without throwing", () => {
    const keys = collectIssueKeys([{ pageUrl: "https://x.com/a", violations: [{ id: "region", nodes: [] }] }]);
    expect(keys).toHaveLength(1);
  });
});

describe("diffIssueSets", () => {
  it("computes fixed / introduced / stillOpen", () => {
    const prev = ["k1", "k2", "k3"];
    const curr = ["k2", "k3", "k4", "k5"];
    expect(diffIssueSets(prev, curr)).toEqual({ fixed: 1, introduced: 2, stillOpen: 2 });
  });
  it("treats a null prior as all-introduced", () => {
    expect(diffIssueSets(null, ["k1", "k2"])).toEqual({ fixed: 0, introduced: 2, stillOpen: 0 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/site-audit-issue-keys.test.js`
Expected: FAIL — cannot find module `../src/site-audit/issue-keys.js`.

- [ ] **Step 4: Write the implementation**

```js
// src/site-audit/issue-keys.js
import { createHash } from "node:crypto";
import { normPageUrl } from "../report/pages.js";

// Stable identity for one accessibility issue occurrence: (normalized page URL,
// axe rule id, the element's CSS-selector target). Normalizing the URL keeps the
// key stable across trailing-slash / case variants so a page's issues don't all
// read as "fixed + new" between runs.
export function issueKey(pageUrl, ruleId, nodeTarget) {
  const target = Array.isArray(nodeTarget) ? nodeTarget.join(" ") : String(nodeTarget ?? "");
  return createHash("sha1")
    .update(`${normPageUrl(pageUrl)}|${ruleId ?? ""}|${target}`)
    .digest("hex");
}

// Deduped, sorted set of issue keys across every scored page.
// scoredPages: [{ pageUrl, violations: [{ id, nodes: [{ target }] }] }]
export function collectIssueKeys(scoredPages) {
  const keys = new Set();
  for (const page of scoredPages ?? []) {
    for (const v of page?.violations ?? []) {
      const nodes = Array.isArray(v?.nodes) && v.nodes.length ? v.nodes : [{ target: [] }];
      for (const n of nodes) keys.add(issueKey(page?.pageUrl, v?.id, n?.target));
    }
  }
  return [...keys].sort();
}

// Diff two issue-key sets into fixed / introduced / still-open counts.
export function diffIssueSets(prevKeys, currKeys) {
  const prev = new Set(prevKeys ?? []);
  const curr = new Set(currKeys ?? []);
  let fixed = 0;
  let stillOpen = 0;
  for (const k of prev) (curr.has(k) ? stillOpen++ : fixed++);
  let introduced = 0;
  for (const k of curr) if (!prev.has(k)) introduced++;
  return { fixed, introduced, stillOpen };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/site-audit-issue-keys.test.js test/report-pages.test.js`
Expected: PASS (issue-keys tests pass; report-pages still passes — the export is additive).

- [ ] **Step 6: Commit**

```bash
git add src/site-audit/issue-keys.js src/report/pages.js test/site-audit-issue-keys.test.js
git commit -m "feat: add issue-key + set-diff helpers; export normPageUrl"
```

---

## Task 3: Per-site aggregator

**Files:**
- Create: `src/site-audit/aggregate.js`
- Test: `test/site-audit-aggregate.test.js`

**Interfaces:**
- Consumes: `wcagLevelForTags` from `src/site-audit/wcag.js`
- Produces:
  - `gradeForScore(score: number|null) => "A"|"B"|"C"|"D"|"F"|null`
  - `aggregateSite(scoredPages) => { score, grade, outstanding: { total, bySeverity: {critical,serious,moderate,minor}, byWcag: {A,AA,AAA,bestPractice}, needsReview }, pages: Array<{url,score,grade,violationCount,bySeverity,needsReview,reportUrl}> }`
  - `scoredPages` item shape: `{ pageUrl, score, grade, violationCount, bySeverity, violations: [{tags}], incomplete: [], reportUrl }`

- [ ] **Step 1: Write the failing test**

```js
// test/site-audit-aggregate.test.js
import { describe, it, expect } from "vitest";
import { aggregateSite, gradeForScore } from "../src/site-audit/aggregate.js";

const pageA = {
  pageUrl: "https://x.com/a", score: 100, grade: "A", violationCount: 0,
  bySeverity: { critical: 0, serious: 0, moderate: 0, minor: 0 },
  violations: [], incomplete: [{ id: "color-contrast" }], reportUrl: "r/a",
};
const pageB = {
  pageUrl: "https://x.com/b", score: 80, grade: "B", violationCount: 2,
  bySeverity: { critical: 0, serious: 1, moderate: 1, minor: 0 },
  violations: [
    { id: "color-contrast", tags: ["wcag2aa"], nodes: [{ target: ["h1"] }] },
    { id: "image-alt", tags: ["wcag2a"], nodes: [{ target: ["img"] }] },
  ],
  incomplete: [], reportUrl: "r/b",
};

describe("gradeForScore", () => {
  it("uses fixed bands mirroring the endpoint", () => {
    expect(gradeForScore(95)).toBe("A");
    expect(gradeForScore(85)).toBe("B");
    expect(gradeForScore(59)).toBe("F");
    expect(gradeForScore(null)).toBe(null);
  });
});

describe("aggregateSite", () => {
  it("averages page scores and rolls up the breakdown", () => {
    const out = aggregateSite([pageA, pageB]);
    expect(out.score).toBe(90); // mean(100, 80)
    expect(out.grade).toBe("A");
    expect(out.outstanding.total).toBe(2);
    expect(out.outstanding.bySeverity).toEqual({ critical: 0, serious: 1, moderate: 1, minor: 0 });
    expect(out.outstanding.byWcag).toEqual({ A: 1, AA: 1, AAA: 0, bestPractice: 0 });
    expect(out.outstanding.needsReview).toBe(1);
    expect(out.pages).toHaveLength(2);
    expect(out.pages[1]).toMatchObject({ url: "https://x.com/b", score: 80, reportUrl: "r/b" });
  });
  it("returns null score for zero scored pages", () => {
    const out = aggregateSite([]);
    expect(out.score).toBe(null);
    expect(out.grade).toBe(null);
    expect(out.outstanding.total).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/site-audit-aggregate.test.js`
Expected: FAIL — cannot find module `../src/site-audit/aggregate.js`.

- [ ] **Step 3: Write the implementation**

```js
// src/site-audit/aggregate.js
import { wcagLevelForTags } from "./wcag.js";

// Fixed grade bands mirroring audit.icjia.app's per-page bands, so a site's
// averaged grade stays consistent with the per-page grades in the table.
export function gradeForScore(score) {
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

// Aggregate the SUCCESSFULLY-scored pages into the headline score, the
// outstanding-issue breakdown, and per-page rows. Errored / capped pages are
// not passed here (the caller tracks them as coverage), so they never drag the
// mean toward zero.
export function aggregateSite(scoredPages) {
  const pages = Array.isArray(scoredPages) ? scoredPages : [];
  const bySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const byWcag = { A: 0, AA: 0, AAA: 0, bestPractice: 0 };
  let needsReview = 0;
  let scoreSum = 0;
  let scoredCount = 0;

  const pageRows = pages.map((p) => {
    if (typeof p?.score === "number") { scoreSum += p.score; scoredCount++; }
    for (const sev of Object.keys(bySeverity)) bySeverity[sev] += p?.bySeverity?.[sev] ?? 0;
    for (const v of p?.violations ?? []) {
      const level = wcagLevelForTags(v?.tags);
      if (level === "best-practice") byWcag.bestPractice++;
      else byWcag[level]++;
    }
    const pageNeedsReview = (p?.incomplete ?? []).length;
    needsReview += pageNeedsReview;
    return {
      url: p?.pageUrl ?? "",
      score: typeof p?.score === "number" ? p.score : null,
      grade: p?.grade ?? gradeForScore(p?.score),
      violationCount: typeof p?.violationCount === "number" ? p.violationCount : (p?.violations?.length ?? 0),
      bySeverity: { critical: 0, serious: 0, moderate: 0, minor: 0, ...(p?.bySeverity ?? {}) },
      needsReview: pageNeedsReview,
      reportUrl: p?.reportUrl ?? null,
    };
  });

  const total = bySeverity.critical + bySeverity.serious + bySeverity.moderate + bySeverity.minor;
  const score = scoredCount ? Math.round(scoreSum / scoredCount) : null;
  return {
    score,
    grade: gradeForScore(score),
    outstanding: { total, bySeverity, byWcag, needsReview },
    pages: pageRows,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/site-audit-aggregate.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/site-audit/aggregate.js test/site-audit-aggregate.test.js
git commit -m "feat: add per-site axe aggregation (score + severity/WCAG breakdown)"
```

---

## Task 4: Capture per-rule detail in the page scorer

**Files:**
- Modify: `src/audits/page-scorer.js:85-96` (add `violations` + `incomplete` to the returned object)
- Test: `test/audits-page-scorer.test.js` (update existing exact-match test; add a new one)

**Interfaces:**
- Produces: `fetchPageAuditScore(...)` return object now additionally carries `violations: Array<{id,impact,tags,nodes:[{target}]}>` and `incomplete: Array<...>` (default `[]` when the endpoint omits them).

- [ ] **Step 1: Update the existing exact-match test + add a detail test**

In `test/audits-page-scorer.test.js`, the test "returns the score, grade, reportUrl + meta from the response" uses `toEqual` (exact). Add the two new fields to its expected object. Change (around line 52):

```js
    expect(result).toEqual({
      score: 87,
      grade: "B",
      violationCount: 5,
      bySeverity: { critical: 0, serious: 2, moderate: 2, minor: 1 },
      reportUrl: "https://audit.icjia.app/page-report/abc123",
      reportId: "abc123",
      reportExpiresAt: "2027-05-19T17:32:11.000Z",
      pageTitle: "ICJIA — Authority Board Meeting · April 9, 2026",
      audited: "2026-05-19T17:32:11.000Z",
      cached: false,
      violations: [],
      incomplete: [],
    });
```

Then append a new test inside the `describe("fetchPageAuditScore", ...)` block:

```js
  it("captures axe violations[] + incomplete[] when the endpoint returns them", async () => {
    const withDetail = {
      url: "https://x.com/p/", pageTitle: "P", audited: "2026-06-26T00:00:00.000Z",
      axe: {
        score: 80, grade: "B", violationCount: 1,
        bySeverity: { critical: 0, serious: 1, moderate: 0, minor: 0 },
        violations: [
          { id: "color-contrast", impact: "serious", tags: ["cat.color", "wcag2aa", "wcag143"],
            nodes: [{ target: ["main h1"] }] },
        ],
        incomplete: [
          { id: "color-contrast", impact: "serious", tags: ["wcag2aa"], nodes: [{ target: [".v-tab"] }] },
        ],
      },
      reportId: "x", reportUrl: "https://audit.icjia.app/page-report/x", cached: false,
    };
    const result = await fetchPageAuditScore({
      pageUrl: "https://x.com/p/",
      auditEndpoint: "https://audit.icjia.app/api/audit-url-page",
      fetcher: async () => withDetail,
    });
    expect(result.violations).toEqual([
      { id: "color-contrast", impact: "serious", tags: ["cat.color", "wcag2aa", "wcag143"], nodes: [{ target: ["main h1"] }] },
    ]);
    expect(result.incomplete).toEqual([
      { id: "color-contrast", impact: "serious", tags: ["wcag2aa"], nodes: [{ target: [".v-tab"] }] },
    ]);
  });
```

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `npx vitest run test/audits-page-scorer.test.js`
Expected: FAIL — the new test fails (`result.violations` is `undefined`); the updated `toEqual` test also fails (missing fields).

- [ ] **Step 3: Implement the capture in page-scorer.js**

In `src/audits/page-scorer.js`, add this helper just above `export async function fetchPageAuditScore` (after the leading comment block):

```js
// Normalise an axe violations[]/incomplete[] array down to the minimum filecap
// needs: rule id, impact, WCAG tags, and each node's CSS-selector target.
function normIssues(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((v) => ({
    id: typeof v?.id === "string" ? v.id : "",
    impact: typeof v?.impact === "string" ? v.impact : null,
    tags: Array.isArray(v?.tags) ? v.tags.filter((t) => typeof t === "string") : [],
    nodes: Array.isArray(v?.nodes)
      ? v.nodes.map((n) => ({
          target: Array.isArray(n?.target) ? n.target : n?.target != null ? [String(n.target)] : [],
        }))
      : [],
  }));
}
```

Then in the returned object (currently ending `cached: response?.cached === true,`), add two fields:

```js
    pageTitle: response?.pageTitle ?? null,
    audited: response?.audited ?? null,
    cached: response?.cached === true,
    // v1.35.0 — per-rule detail when the enhanced endpoint provides it
    // (absent on the legacy endpoint → []). Drives the WCAG-level breakdown
    // and the issue-set fixed/new diff.
    violations: normIssues(axe.violations),
    incomplete: normIssues(axe.incomplete),
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/audits-page-scorer.test.js`
Expected: PASS (all tests, including the two updated/added).

- [ ] **Step 5: Commit**

```bash
git add src/audits/page-scorer.js test/audits-page-scorer.test.js
git commit -m "feat: capture axe violations[]/incomplete[] in page-scorer"
```

---

## Task 5: Site page-set resolver

**Files:**
- Create: `src/site-audit/page-set.js`
- Test: `test/site-audit-page-set.test.js`

**Interfaces:**
- Consumes: `fetchSitemapUrls`, `scopeSitemapUrlsToSite` from `src/references/sitemap.js`; `parseCmsPageList`, `normPageUrl` from `src/report/pages.js`
- Produces: `resolveSitePageSet({ site, cmsNdjson?, fetchSitemap? }) => Promise<{ sitemapUrls: string[], pageSet: string[] }>`
  - `site`: `{ siteUrl?, publicUrlBase?, references?: { sitemapUrl? } }`
  - `pageSet`: sitemap ∪ CMS pages, deduped by `normPageUrl`, first-seen raw URL kept. **No file-derived URLs.**

- [ ] **Step 1: Write the failing test**

```js
// test/site-audit-page-set.test.js
import { describe, it, expect } from "vitest";
import { resolveSitePageSet } from "../src/site-audit/page-set.js";

describe("resolveSitePageSet", () => {
  it("unions sitemap + CMS pages, deduped by normalized URL", async () => {
    const fetchSitemap = async (url) =>
      url === "https://x.com/sitemap.xml" ? ["https://x.com/", "https://x.com/about"] : [];
    const cmsNdjson = [
      JSON.stringify({ pageUrl: "https://x.com/About/", contentType: "page" }), // dup of /about
      JSON.stringify({ pageUrl: "https://x.com/news", contentType: "article" }),
    ].join("\n");
    const { sitemapUrls, pageSet } = await resolveSitePageSet({
      site: { siteUrl: "https://x.com/" },
      cmsNdjson,
      fetchSitemap,
    });
    expect(sitemapUrls).toEqual(["https://x.com/", "https://x.com/about"]);
    expect(pageSet).toEqual(["https://x.com/", "https://x.com/about", "https://x.com/news"]);
  });

  it("returns an empty set when there is no sitemap and no CMS data", async () => {
    const { pageSet } = await resolveSitePageSet({
      site: { siteUrl: "https://x.com/" },
      cmsNdjson: "",
      fetchSitemap: async () => [],
    });
    expect(pageSet).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/site-audit-page-set.test.js`
Expected: FAIL — cannot find module `../src/site-audit/page-set.js`.

- [ ] **Step 3: Write the implementation**

```js
// src/site-audit/page-set.js
import { fetchSitemapUrls, scopeSitemapUrlsToSite } from "../references/sitemap.js";
import { parseCmsPageList, normPageUrl } from "../report/pages.js";

// Resolve the site's OWN page set — the spine of the website accessibility
// score. Sources, in order: the site's sitemap.xml (scoped to the site's path)
// and its CMS content pages (references sidecar). Explicitly NOT file-reference
// pages — the score is about the site, never its files. `fetchSitemap` is
// injectable for tests.
export async function resolveSitePageSet({ site, cmsNdjson = "", fetchSitemap = fetchSitemapUrls } = {}) {
  const candidates = [];
  if (site?.references?.sitemapUrl) candidates.push(site.references.sitemapUrl);
  for (const b of [site?.siteUrl, site?.publicUrlBase]) {
    const base = String(b ?? "").replace(/\/+$/, "");
    if (base) candidates.push(`${base}/sitemap.xml`);
  }
  let sitemapUrls = [];
  for (const cand of candidates) {
    sitemapUrls = await fetchSitemap(cand);
    if (Array.isArray(sitemapUrls) && sitemapUrls.length > 0) break;
  }
  sitemapUrls = scopeSitemapUrlsToSite(sitemapUrls ?? [], site?.siteUrl);

  const cmsPages = parseCmsPageList(cmsNdjson);

  const seen = new Set();
  const pageSet = [];
  for (const u of [...sitemapUrls, ...cmsPages.map((c) => c.pageUrl)]) {
    const norm = normPageUrl(u);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    pageSet.push(u);
  }
  return { sitemapUrls, pageSet };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/site-audit-page-set.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/site-audit/page-set.js test/site-audit-page-set.test.js
git commit -m "feat: resolve a site's page set (sitemap union CMS) for site-audit"
```

---

## Task 6: Sidecar read / build / write

**Files:**
- Create: `src/site-audit/sidecar.js`
- Test: `test/site-audit-sidecar.test.js`

**Interfaces:**
- Consumes: `diffIssueSets` from `src/site-audit/issue-keys.js`
- Produces:
  - `SIDECAR_SCHEMA = 1`
  - `readPriorSidecar(path: string) => object | null`
  - `buildSidecar({ siteName, auditedAt, endpoint, coverage, aggregate, issueKeys, prior? }) => object` — full sidecar; `trend` is `null` on first run else `{ vsDate, fixed, new, stillOpen }`; `scoreHistory` appends current run (cap 24).
  - `writeSidecar(path: string, sidecar: object) => void` (atomic)
  - `aggregate` arg is the output of `aggregateSite` (Task 3).

- [ ] **Step 1: Write the failing test**

```js
// test/site-audit-sidecar.test.js
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSidecar, readPriorSidecar, writeSidecar, SIDECAR_SCHEMA } from "../src/site-audit/sidecar.js";

const aggregate = {
  score: 90, grade: "A",
  outstanding: { total: 2, bySeverity: { critical: 0, serious: 1, moderate: 1, minor: 0 }, byWcag: { A: 1, AA: 1, AAA: 0, bestPractice: 0 }, needsReview: 1 },
  pages: [{ url: "https://x.com/a", score: 90, grade: "A", violationCount: 2, bySeverity: {}, needsReview: 1, reportUrl: "r" }],
};

describe("buildSidecar", () => {
  it("first run: no trend, history length 1", () => {
    const s = buildSidecar({
      siteName: "x", auditedAt: "2026-06-26T00:00:00Z", endpoint: "e",
      coverage: { pagesInSet: 1, scored: 1, errored: 0, capped: 0 },
      aggregate, issueKeys: ["k1", "k2"], prior: null,
    });
    expect(s.schema).toBe(SIDECAR_SCHEMA);
    expect(s.score).toBe(90);
    expect(s.trend).toBe(null);
    expect(s.issueKeys).toEqual(["k1", "k2"]);
    expect(s.scoreHistory).toHaveLength(1);
  });

  it("second run: diffs prior issueKeys and grows history", () => {
    const prior = {
      auditedAt: "2026-06-12T00:00:00Z", score: 80,
      issueKeys: ["k1", "k9"], outstanding: { total: 2 },
      scoreHistory: [{ date: "2026-06-12T00:00:00Z", score: 80, outstandingTotal: 2 }],
    };
    const s = buildSidecar({
      siteName: "x", auditedAt: "2026-06-26T00:00:00Z", endpoint: "e",
      coverage: { pagesInSet: 1, scored: 1, errored: 0, capped: 0 },
      aggregate, issueKeys: ["k1", "k2"], prior,
    });
    expect(s.trend).toEqual({ vsDate: "2026-06-12T00:00:00Z", fixed: 1, new: 1, stillOpen: 1 });
    expect(s.scoreHistory).toHaveLength(2);
  });
});

describe("readPriorSidecar", () => {
  it("returns null for a missing or corrupt file", () => {
    expect(readPriorSidecar(path.join(os.tmpdir(), "nope-site-audit.json"))).toBe(null);
  });
  it("round-trips a written sidecar", () => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fc-sc-")), "site-audit.json");
    const s = buildSidecar({ siteName: "x", auditedAt: "t", endpoint: "e", coverage: {}, aggregate, issueKeys: [], prior: null });
    writeSidecar(p, s);
    expect(readPriorSidecar(p)).toEqual(s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/site-audit-sidecar.test.js`
Expected: FAIL — cannot find module `../src/site-audit/sidecar.js`.

- [ ] **Step 3: Write the implementation**

```js
// src/site-audit/sidecar.js
import fs from "node:fs";
import path from "node:path";
import { diffIssueSets } from "./issue-keys.js";

export const SIDECAR_SCHEMA = 1;
const HISTORY_CAP = 24;

export function readPriorSidecar(sidecarPath) {
  try {
    const obj = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

export function buildSidecar({ siteName, auditedAt, endpoint, coverage, aggregate, issueKeys, prior = null }) {
  let trend = null;
  if (prior && Array.isArray(prior.issueKeys)) {
    const { fixed, introduced, stillOpen } = diffIssueSets(prior.issueKeys, issueKeys);
    trend = { vsDate: prior.auditedAt ?? null, fixed, new: introduced, stillOpen };
  }
  const history = Array.isArray(prior?.scoreHistory) ? prior.scoreHistory.slice() : [];
  history.push({ date: auditedAt, score: aggregate.score, outstandingTotal: aggregate.outstanding.total });

  return {
    schema: SIDECAR_SCHEMA,
    siteName,
    auditedAt,
    endpoint,
    coverage,
    score: aggregate.score,
    grade: aggregate.grade,
    outstanding: aggregate.outstanding,
    trend,
    issueKeys,
    scoreHistory: history.slice(-HISTORY_CAP),
    pages: aggregate.pages,
  };
}

export function writeSidecar(sidecarPath, sidecar) {
  fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
  const tmp = `${sidecarPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(sidecar, null, 2));
  fs.renameSync(tmp, sidecarPath);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/site-audit-sidecar.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/site-audit/sidecar.js test/site-audit-sidecar.test.js
git commit -m "feat: site-audit sidecar read/build/write with trend + history"
```

---

## Task 7: `site-audit` command orchestrator + CLI registration

**Files:**
- Create: `src/commands/site-audit.js`
- Modify: `bin/filecap.js` (top imports + new `program.command` before the `mcp` command at line 387)
- Test: `test/site-audit-command.test.js`

**Interfaces:**
- Consumes: `loadAuditCache`/`saveAuditCache`/`isCacheEntryFresh` (`src/audits/cache.js`), `fetchPageAuditScore` (`src/audits/page-scorer.js`), `createRetryingJsonFetcher` (`src/audits/retrying-fetcher.js`), `createLimiter` (`src/util/concurrency.js` — reuse, don't hand-roll a mapper), `resolveSitePageSet` (Task 5), `aggregateSite` (Task 3), `collectIssueKeys` (Task 2), `readPriorSidecar`/`buildSidecar`/`writeSidecar` (Task 6)
- Produces: `runSiteAudit({ siteName, sitesFile?, auditsBase?, auditEndpoint?, pageCachePath?, ttlDays?, concurrency?, maxNewPages?, force?, bearerToken?, fetcher?, now?, log? }) => Promise<{ siteName, scored, errored, capped, score, grade, sidecarPath } | { siteName, error }>`

- [ ] **Step 1: Write the failing test**

```js
// test/site-audit-command.test.js
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSiteAudit } from "../src/commands/site-audit.js";

let tmp, sitesFile, auditsBase, cachePath;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-sa-"));
  sitesFile = path.join(tmp, "sites.json");
  auditsBase = path.join(tmp, "audits");
  cachePath = path.join(tmp, "page-cache.json");
  fs.writeFileSync(sitesFile, JSON.stringify({ sites: [{ name: "demo", siteUrl: "https://demo.test/" }] }));
});

function fakeFetcher(scoreByUrl) {
  return async (_endpoint, init) => {
    const { url } = JSON.parse(init.body);
    const score = scoreByUrl[url] ?? 100;
    return {
      url, pageTitle: "T", audited: "2026-06-26T00:00:00Z",
      axe: {
        score, grade: score >= 90 ? "A" : "B", violationCount: score >= 90 ? 0 : 1,
        bySeverity: { critical: 0, serious: score >= 90 ? 0 : 1, moderate: 0, minor: 0 },
        violations: score >= 90 ? [] : [{ id: "color-contrast", impact: "serious", tags: ["wcag2aa"], nodes: [{ target: ["h1"] }] }],
        incomplete: [],
      },
      reportId: "r", reportUrl: `https://audit.icjia.app/page-report/${score}`, cached: false,
    };
  };
}

describe("runSiteAudit", () => {
  it("scores the page set and writes a sidecar", async () => {
    const res = await runSiteAudit({
      siteName: "demo", sitesFile, auditsBase, pageCachePath: cachePath,
      fetcher: fakeFetcher({ "https://demo.test/": 100, "https://demo.test/about": 80 }),
      fetchSitemap: async () => ["https://demo.test/", "https://demo.test/about"],
      log: () => {},
    });
    expect(res.scored).toBe(2);
    expect(res.score).toBe(90);
    const sidecar = JSON.parse(fs.readFileSync(res.sidecarPath, "utf8"));
    expect(sidecar.coverage).toEqual({ pagesInSet: 2, scored: 2, errored: 0, capped: 0 });
    expect(sidecar.outstanding.bySeverity.serious).toBe(1);
    expect(sidecar.outstanding.byWcag.AA).toBe(1);
  });

  it("caps new pages per run", async () => {
    const res = await runSiteAudit({
      siteName: "demo", sitesFile, auditsBase, pageCachePath: cachePath, maxNewPages: 1,
      fetcher: fakeFetcher({}),
      fetchSitemap: async () => ["https://demo.test/", "https://demo.test/about"],
      log: () => {},
    });
    expect(res.scored).toBe(1);
    expect(res.capped).toBe(1);
  });

  it("errors cleanly for an unknown site", async () => {
    const res = await runSiteAudit({ siteName: "ghost", sitesFile, auditsBase, pageCachePath: cachePath, fetcher: fakeFetcher({}), fetchSitemap: async () => [], log: () => {} });
    expect(res.error).toMatch(/not found/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/site-audit-command.test.js`
Expected: FAIL — cannot find module `../src/commands/site-audit.js`.

- [ ] **Step 3: Write the orchestrator**

```js
// src/commands/site-audit.js
// `filecap site-audit <site>` — score a site's web pages for accessibility
// (axe via audit.icjia.app/api/audit-url-page), sitemap-driven and independent
// of the file/PDF scores. Writes a purge-exempt per-site sidecar
// (latest/site-audit.json) with the score, breakdown, and issue-set history.
//
// Pipeline placement: scan → references → cross-references → audits → site-audit
// → web-rollup. Shares ~/.filecap/page-audit-cache.json with the audits stage.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadAuditCache, saveAuditCache, isCacheEntryFresh } from "../audits/cache.js";
import { fetchPageAuditScore } from "../audits/page-scorer.js";
import { createRetryingJsonFetcher } from "../audits/retrying-fetcher.js";
import { createLimiter } from "../util/concurrency.js";
import { resolveSitePageSet } from "../site-audit/page-set.js";
import { aggregateSite } from "../site-audit/aggregate.js";
import { collectIssueKeys } from "../site-audit/issue-keys.js";
import { readPriorSidecar, buildSidecar, writeSidecar } from "../site-audit/sidecar.js";

const DEFAULT_PAGE_AUDIT_ENDPOINT = "https://audit.icjia.app/api/audit-url-page";
const DEFAULT_PAGE_CACHE_PATH = path.join(os.homedir(), ".filecap", "page-audit-cache.json");
const DEFAULT_SITES_FILE = path.join(os.homedir(), ".filecap", "sites.json");
const DEFAULT_AUDITS_BASE = path.join(os.homedir(), "filecap-audits");

function defaultJsonFetcher(log) {
  return createRetryingJsonFetcher({ maxRetries: 6, baseDelayMs: 2000, maxDelayMs: 60000, log });
}

function loadSiteEntry(sitesFile, siteName) {
  const data = JSON.parse(fs.readFileSync(sitesFile, "utf8"));
  const sites = Array.isArray(data?.sites) ? data.sites : [];
  return sites.find((s) => s?.name === siteName) ?? null;
}

export async function runSiteAudit({
  siteName,
  sitesFile = process.env.FILECAP_SITES_FILE ?? DEFAULT_SITES_FILE,
  auditsBase = process.env.AUDITS_BASE ?? DEFAULT_AUDITS_BASE,
  auditEndpoint = DEFAULT_PAGE_AUDIT_ENDPOINT,
  pageCachePath = DEFAULT_PAGE_CACHE_PATH,
  ttlDays = 14,
  concurrency = 2,
  maxNewPages = 150,
  force = false,
  bearerToken,
  fetcher,
  fetchSitemap, // injectable for tests; undefined → page-set uses the live fetch
  now = new Date(),
  log = console.error,
}) {
  if (typeof siteName !== "string" || siteName.length === 0) {
    throw new Error("runSiteAudit: siteName is required");
  }
  const site = loadSiteEntry(sitesFile, siteName);
  if (!site) return { siteName, error: `site "${siteName}" not found in ${sitesFile}` };

  const latestDir = path.join(auditsBase, siteName, "latest");
  let cmsNdjson = "";
  try {
    cmsNdjson = fs.readFileSync(path.join(latestDir, "references-sidecar.ndjson"), "utf8");
  } catch {
    /* no sidecar — sitemap only */
  }

  const { pageSet } = await resolveSitePageSet({ site, cmsNdjson, fetchSitemap });
  log(`[site-audit] ${siteName}: ${pageSet.length} pages in set (sitemap ∪ CMS)`);

  const cache = loadAuditCache({ cachePath: pageCachePath });
  const httpFetcher = fetcher ?? defaultJsonFetcher(log);

  const toFetch = [];
  const cachedResults = new Map();
  for (const url of pageSet) {
    const c = cache[url];
    if (!force && isCacheEntryFresh(c, { now, ttlDays })) cachedResults.set(url, c);
    else toFetch.push(url);
  }
  const capped = Math.max(0, toFetch.length - maxNewPages);
  const fetchNow = toFetch.slice(0, maxNewPages);
  log(`[site-audit] ${siteName}: ${cachedResults.size} cached, ${fetchNow.length} to fetch, ${capped} capped`);

  let errored = 0;
  const fetched = new Map();
  const limit = createLimiter(concurrency);
  await Promise.all(
    fetchNow.map((url) =>
      limit(async () => {
        try {
          const result = await fetchPageAuditScore({ pageUrl: url, auditEndpoint, bearerToken, force, fetcher: httpFetcher });
          if (result === null) { errored++; return; }
          const stored = { ...result, checkedAt: now.toISOString() };
          cache[url] = stored;
          fetched.set(url, stored);
        } catch (err) {
          errored++;
          log(`[site-audit] ${siteName} WARN ${url}: ${err?.message ?? err}`);
        }
      }),
    ),
  );

  try {
    saveAuditCache({ cachePath: pageCachePath, cache });
  } catch (err) {
    log(`[site-audit] ${siteName} WARN: failed to persist page cache: ${err.message}`);
  }

  const scoredPages = [];
  for (const url of pageSet) {
    const r = fetched.get(url) ?? cachedResults.get(url);
    if (r && typeof r.score === "number") scoredPages.push({ pageUrl: url, ...r });
  }

  const aggregate = aggregateSite(scoredPages);
  const issueKeys = collectIssueKeys(scoredPages);
  const auditedAt = now.toISOString();
  const sidecarPath = path.join(latestDir, "site-audit.json");
  const prior = readPriorSidecar(sidecarPath);
  const sidecar = buildSidecar({
    siteName, auditedAt, endpoint: auditEndpoint,
    coverage: { pagesInSet: pageSet.length, scored: scoredPages.length, errored, capped },
    aggregate, issueKeys, prior,
  });
  writeSidecar(sidecarPath, sidecar);
  log(`[site-audit] ${siteName}: score ${aggregate.score ?? "n/a"} (${aggregate.grade ?? "—"}), ${scoredPages.length}/${pageSet.length} pages → ${sidecarPath}`);

  return { siteName, scored: scoredPages.length, errored, capped, score: aggregate.score, grade: aggregate.grade, sidecarPath };
}
```

Note: `resolveSitePageSet` already accepts `fetchSitemap`; pass it straight through (it is `undefined` in production, so page-set falls back to the live `fetchSitemapUrls`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/site-audit-command.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Register the CLI command**

In `bin/filecap.js`, add to the top import block (next to the other `src/commands/*` imports):

```js
import { runSiteAudit } from "../src/commands/site-audit.js";
```

Then insert this block immediately before `program\n  .command("mcp")` (currently line 387):

```js
program
  .command("site-audit <siteName>")
  .description(
    "Score a site's web pages for accessibility (axe via audit.icjia.app/api/audit-url-page), sitemap-driven and independent of file/PDF scores. Writes the per-site latest/site-audit.json sidecar (purge-exempt) with the score, severity + WCAG-level breakdown, and issue-set fixed/new trend.",
  )
  .option("--endpoint <url>", "override the page-audit endpoint", "https://audit.icjia.app/api/audit-url-page")
  .option("--sites-file <path>", "override saved-sites JSON path")
  .option("--audits-base <dir>", "override the ~/filecap-audits root")
  .option("--max-new-pages <n>", "cap pages freshly fetched per run (default 150)", (v) => parseInt(v, 10))
  .option("--concurrency <n>", "concurrent page audits (default 2 — respects the 100/min IP cap)", (v) => parseInt(v, 10))
  .option("--ttl-days <n>", "page-cache freshness window in days (default 14)", (v) => parseInt(v, 10))
  .option("--force", "ignore cache; re-score every page")
  .action(async (siteName, opts) => {
    try {
      let bearerToken;
      try {
        const secretsPath = path.join(os.homedir(), ".filecap", "secrets.json");
        const s = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
        bearerToken = s?.credentials?.["audit-icjia-app"]?.bearerToken;
      } catch {
        /* anonymous mode — no token needed */
      }
      const res = await runSiteAudit({
        siteName,
        sitesFile: opts.sitesFile,
        auditsBase: opts.auditsBase,
        auditEndpoint: opts.endpoint,
        maxNewPages: opts.maxNewPages ?? 150,
        concurrency: opts.concurrency ?? 2,
        ttlDays: opts.ttlDays ?? 14,
        force: opts.force === true,
        bearerToken,
      });
      if (res.error) {
        process.stderr.write(`filecap site-audit error: ${res.error}\n`);
        process.exit(1);
      }
    } catch (err) {
      process.stderr.write(`filecap site-audit error: ${err.message}\n`);
      process.exit(1);
    }
  });
```

(If `fs`/`os`/`path` are not already imported at the top of `bin/filecap.js`, they are — the `audits` action above uses all three.)

- [ ] **Step 6: Smoke-test the CLI wiring**

Run: `node bin/filecap.js site-audit --help`
Expected: prints the `site-audit` usage with the options above (exit 0).

Run: `node bin/filecap.js site-audit __no_such_site__ --sites-file /dev/null 2>&1 || true`
Expected: prints `filecap site-audit error: ...` and a non-zero exit (the `/dev/null` parse fails → caught).

- [ ] **Step 7: Commit**

```bash
git add src/commands/site-audit.js bin/filecap.js test/site-audit-command.test.js
git commit -m "feat: add site-audit command (sitemap-driven page a11y scoring)"
```

---

## Task 8: Pipeline integration (Stage 3.6)

**Files:**
- Modify: `examples/audit-fleet-auto.sh` (add Stage 3.6 after the audits block ~line 254, before the web-rollup block ~line 256)
- Modify: `run-full-audit.sh` (update the "Enrich" comment on line 12)

**Interfaces:** none (shell). Verification is a dry run.

- [ ] **Step 1: Add Stage 3.6 to `examples/audit-fleet-auto.sh`**

Insert this block between the closing `fi` of the audits stage (after line 254) and the `# ───…` header of the web-rollup stage (line 256):

```bash
# ────────────────────────────────────────────────────────────────────────────
#  Stage 3.6 (v1.35.0): site-audit — score each site's WEB PAGES for
#  accessibility (axe via audit.icjia.app/api/audit-url-page), sitemap-driven
#  and independent of the file/PDF scores. Writes latest/site-audit.json per
#  site (purge-exempt). Shares ~/.filecap/page-audit-cache.json with Stage 3.5,
#  so unchanged pages are free. Sequential per site — the 100/min IP rate limit
#  means parallel sites would only contend.
# ────────────────────────────────────────────────────────────────────────────
if [[ "${SKIP_SITE_AUDIT:-0}" == "1" ]]; then
  echo "[fleet-auto] SKIP_SITE_AUDIT=1 — skipping website accessibility scoring"
else
  echo "[fleet-auto] Stage 3.6: running 'filecap site-audit' per site"
  KNOWN_SITES=$(python3 -c "
import json
with open('$SITES_JSON') as f: d = json.load(f)
for s in d.get('sites', []):
    if s.get('name'): print(s['name'])
" 2>/dev/null)
  for site in $KNOWN_SITES; do
    site_dir="$AUDITS_BASE/$site"
    [[ -d "$site_dir" ]] || continue
    if node "$FILECAP_BIN" site-audit "$site" >/tmp/filecap-siteaudit-"$site".log 2>&1; then
      result=$(tail -1 /tmp/filecap-siteaudit-"$site".log)
      echo "[fleet-auto]   ✓ site-audit $site: $result"
    else
      echo "[fleet-auto] WARN: site-audit failed for $site (see /tmp/filecap-siteaudit-$site.log)" >&2
    fi
  done
fi
```

Also add a usage line in the header comment block (near line 39, alongside the other `SKIP_*` docs):

```bash
#    SKIP_SITE_AUDIT=1 ./audit-fleet-auto.sh      # skip the website accessibility scoring (v1.35.0)
```

And update the final summary echo (line 272) to mention the new stage:

```bash
echo "[fleet-auto] Full pipeline complete (scan → references → cross-references → audits → site-audit → rollup)"
```

- [ ] **Step 2: Update `run-full-audit.sh` comment**

In `run-full-audit.sh`, change line 12 from:

```bash
#    3. Enrich     — CMS references -> cross-references -> PDF a11y scores
```

to:

```bash
#    3. Enrich     — CMS references -> cross-references -> PDF a11y scores -> website a11y scores
```

- [ ] **Step 3: Syntax-check the scripts**

Run: `bash -n examples/audit-fleet-auto.sh && bash -n run-full-audit.sh && echo OK`
Expected: `OK` (no syntax errors).

- [ ] **Step 4: Commit**

```bash
git add examples/audit-fleet-auto.sh run-full-audit.sh
git commit -m "feat: wire site-audit into the fleet pipeline as Stage 3.6"
```

---

## Task 9: Card tile renderer + CSS

**Files:**
- Modify: `src/web/index-page.js` (add `renderSiteA11yTile`; call it in `renderCard` after the `.nums` div, ~line 744)
- Modify: `src/web/index-css.js` (add `.site-a11y` rules near the `.site-card .nums` block ~line 757+)
- Test: `test/index-page.test.js` (add cases)

**Interfaces:**
- Consumes: `sr.siteAudit` (the sidecar object from Task 6) — `{ score, grade, outstanding: { total }, trend: { fixed, new } | null }`
- Produces: `renderSiteA11yTile(siteAudit) => string` (empty string when `siteAudit` is null or has no numeric score)

- [ ] **Step 1: Write the failing test**

Add to `test/index-page.test.js` (it already imports from `../src/web/index-page.js`; add `renderSiteA11yTile` to the import and append this describe block):

```js
import { renderSiteA11yTile } from "../src/web/index-page.js";

describe("renderSiteA11yTile", () => {
  it("renders score, grade, open + fixed counts and the 'not files' note", () => {
    const html = renderSiteA11yTile({
      score: 94, grade: "A",
      outstanding: { total: 37 },
      trend: { fixed: 12, new: 5, stillOpen: 32 },
    });
    expect(html).toContain("94");
    expect(html).toContain("Website accessibility");
    expect(html).toContain("37 open");
    expect(html).toContain("12 fixed");
    expect(html).toMatch(/not files|pages only/i);
  });
  it("returns empty string for an unscored site", () => {
    expect(renderSiteA11yTile(null)).toBe("");
    expect(renderSiteA11yTile({ score: null })).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/index-page.test.js`
Expected: FAIL — `renderSiteA11yTile` is not exported.

- [ ] **Step 3: Add the renderer**

In `src/web/index-page.js`, add this exported function just above `export function renderCard` (line 650):

```js
// v1.35.0 — compact "Website accessibility" tile for the card. Visually
// distinct from the file tiles so it never reads as a file metric. Omitted
// (not zeroed) when the site has no scored pages. Independent of file scores.
export function renderSiteA11yTile(siteAudit) {
  if (!siteAudit || typeof siteAudit.score !== "number") return "";
  const score = siteAudit.score;
  const grade = siteAudit.grade ?? "";
  const open = siteAudit.outstanding?.total ?? 0;
  const fixed = siteAudit.trend?.new != null || siteAudit.trend?.fixed != null
    ? `${(siteAudit.trend?.fixed ?? 0).toLocaleString()} fixed`
    : "";
  const openTxt = `${open.toLocaleString()} open issue${open === 1 ? "" : "s"}`;
  const trendTxt = fixed ? ` &middot; ${he(fixed)}` : "";
  return `<div class="site-a11y">
    <div class="site-a11y-score"><span class="num">${he(String(score))}</span><span class="grade">${he(grade)}</span></div>
    <div class="site-a11y-meta">
      <span class="site-a11y-label">Website accessibility</span>
      <span class="site-a11y-sub">${he(openTxt)}${trendTxt}</span>
      <span class="site-a11y-note">Scores the site&#39;s pages — not its files.</span>
    </div>
  </div>`;
}
```

Then in `renderCard`, insert the tile between the `.nums` closing `</div>` (line 744) and `<div class="donut-row">` (line 745):

```js
  </div>
  ${renderSiteA11yTile(sr.siteAudit)}
  <div class="donut-row">
```

- [ ] **Step 4: Add the CSS**

In `src/web/index-css.js`, add after the existing `.site-card .nums` / `.tile` rules (around line 757+; place it before the `.donut-row` rules):

```css
.site-card .site-a11y {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 14px 0 4px;
  padding: 12px 14px;
  border: 1px solid #c9d8e8;
  border-left: 4px solid #2f6fb0;
  border-radius: 8px;
  background: #f3f8fd;
}
.site-card .site-a11y-score {
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.site-card .site-a11y-score .num { font-size: 1.9rem; font-weight: 700; color: #1b4a78; line-height: 1; }
.site-card .site-a11y-score .grade { font-size: 1rem; font-weight: 700; color: #2f6fb0; }
.site-card .site-a11y-meta { display: flex; flex-direction: column; gap: 1px; }
.site-card .site-a11y-label { font-weight: 600; font-size: 0.9rem; color: #1b4a78; }
.site-card .site-a11y-sub { font-size: 0.82rem; color: #41607c; }
.site-card .site-a11y-note { font-size: 0.74rem; color: #6a7c8c; font-style: italic; }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/index-page.test.js`
Expected: PASS (existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add src/web/index-page.js src/web/index-css.js test/index-page.test.js
git commit -m "feat: website accessibility tile on site cards"
```

---

## Task 10: Per-page scores into the Page view

**Files:**
- Modify: `src/report/pages.js` (`buildPageList` gains a 4th `pageScores` arg)
- Test: `test/report-pages.test.js` (add a case)

**Interfaces:**
- Produces: `buildPageList(entries, sitemapUrls = [], cmsPages = [], pageScores = null)` — when `pageScores` is a `Map<normPageUrl, pageAuditObj>`, every page row's `pageAudit` is populated from it (so sitemap-only pages get scores too), overriding the reference-derived `pageAudit`.
- `pageScores` value shape: `{ score, grade, violationCount, bySeverity, reportUrl, pageTitle }`

- [ ] **Step 1: Write the failing test**

Add to `test/report-pages.test.js` (imports `buildPageList`, `normPageUrl` from `../src/report/pages.js`):

```js
import { normPageUrl } from "../src/report/pages.js";

describe("buildPageList with pageScores", () => {
  it("populates pageAudit for sitemap-only pages from the score map", () => {
    const scores = new Map([
      [normPageUrl("https://x.com/solo"), { score: 88, grade: "B", violationCount: 1, bySeverity: {}, reportUrl: "r" }],
    ]);
    const pages = buildPageList([], ["https://x.com/solo"], [], scores);
    const solo = pages.find((p) => p.pageUrl === "https://x.com/solo");
    expect(solo.pageAudit).toMatchObject({ score: 88, grade: "B", reportUrl: "r" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/report-pages.test.js`
Expected: FAIL — `solo.pageAudit` is `null` (the 4th arg is ignored).

- [ ] **Step 3: Implement the `pageScores` overlay**

In `src/report/pages.js`, change the signature (line 49) and append an overlay pass just before `return pages;` (line 130):

Signature:

```js
export function buildPageList(entries, sitemapUrls = [], cmsPages = [], pageScores = null) {
```

Before `return pages;`:

```js
  // v1.35.0 — overlay per-page accessibility scores from the site-audit sidecar
  // (keyed by normalized URL) onto every page row, so sitemap-only pages — not
  // just file-linking ones — show a score in the Page view.
  if (pageScores instanceof Map) {
    for (const page of pages) {
      const hit = pageScores.get(normPageUrl(page.pageUrl));
      if (hit) page.pageAudit = hit;
    }
  }
  return pages;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/report-pages.test.js`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/report/pages.js test/report-pages.test.js
git commit -m "feat: overlay site-audit per-page scores onto the Page view"
```

---

## Task 11: Detail-page "Website accessibility" section + report threading

**Files:**
- Create: `src/report/site-accessibility-section.js`
- Modify: `src/report/html.js` (`writeHtml` signature + insert section after `accessPanelHtml` line 1960 + pass `pageScores` to `buildPageList` line 648 + section CSS)
- Modify: `src/commands/report.js` (`runReport` signature + pass-through to `writeHtml`)
- Test: `test/site-accessibility-section.test.js`

**Interfaces:**
- Consumes: the sidecar object (Task 6)
- Produces: `renderSiteAccessibilitySection(siteAudit) => string` (empty when null/unscored)
- `writeHtml` and `runReport` both gain `siteAudit = null` and `pageScores = null` params.

- [ ] **Step 1: Write the failing test**

```js
// test/site-accessibility-section.test.js
import { describe, it, expect } from "vitest";
import { renderSiteAccessibilitySection } from "../src/report/site-accessibility-section.js";

const sidecar = {
  score: 94, grade: "A",
  coverage: { pagesInSet: 412, scored: 150, errored: 2, capped: 260 },
  outstanding: { total: 37, bySeverity: { critical: 0, serious: 4, moderate: 18, minor: 15 }, byWcag: { A: 9, AA: 28, AAA: 0, bestPractice: 4 }, needsReview: 11 },
  trend: { vsDate: "2026-06-12T00:00:00Z", fixed: 12, new: 5, stillOpen: 32 },
  pages: [{ url: "https://x.com/a", score: 96, grade: "A", violationCount: 1, bySeverity: { serious: 0 }, needsReview: 1, reportUrl: "https://audit.icjia.app/page-report/a" }],
};

describe("renderSiteAccessibilitySection", () => {
  it("renders score, coverage, severity + WCAG breakdown, trend, and the independence note", () => {
    const html = renderSiteAccessibilitySection(sidecar);
    expect(html).toContain("Website accessibility");
    expect(html).toContain("94");
    expect(html).toContain("150"); // scored of pagesInSet
    expect(html).toContain("28"); // AA count
    expect(html).toContain("12"); // fixed
    expect(html).toMatch(/independent|not.*files|separate/i);
    expect(html).toContain("audit.icjia.app/page-report/a");
  });
  it("returns empty string for an unscored site", () => {
    expect(renderSiteAccessibilitySection(null)).toBe("");
    expect(renderSiteAccessibilitySection({ score: null })).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/site-accessibility-section.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the section renderer**

```js
// src/report/site-accessibility-section.js
// Detail-page "Website accessibility" section — the SiteImprove-style depth:
// score + grade, coverage, outstanding issues by severity AND WCAG level,
// needs-review, fixed/new trend, and a per-page table. Opens with the blunt
// statement that this is the SITE's score, independent of the file/PDF scores.

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function renderSiteAccessibilitySection(siteAudit) {
  if (!siteAudit || typeof siteAudit.score !== "number") return "";
  const cov = siteAudit.coverage ?? {};
  const out = siteAudit.outstanding ?? {};
  const sev = out.bySeverity ?? {};
  const wcag = out.byWcag ?? {};
  const trend = siteAudit.trend;
  const pages = Array.isArray(siteAudit.pages) ? siteAudit.pages : [];

  const trendHtml = trend
    ? `<p class="sa-trend">Since the previous run: <strong>${(trend.fixed ?? 0).toLocaleString()} fixed</strong>, <strong>${(trend.new ?? 0).toLocaleString()} new</strong>, ${(trend.stillOpen ?? 0).toLocaleString()} still open.</p>`
    : `<p class="sa-trend">First run — no trend yet.</p>`;

  const pageRows = pages
    .slice()
    .sort((a, b) => (a.score ?? 101) - (b.score ?? 101))
    .map((p) => {
      const link = p.reportUrl
        ? `<a href="${esc(p.reportUrl)}" target="_blank" rel="noopener noreferrer">report &rarr;</a>`
        : "";
      return `<tr><td>${esc(p.url)}</td><td>${p.score ?? "—"}</td><td>${esc(p.grade ?? "")}</td><td>${(p.violationCount ?? 0).toLocaleString()}</td><td>${(p.needsReview ?? 0).toLocaleString()}</td><td>${link}</td></tr>`;
    })
    .join("");

  return `<section class="site-accessibility" aria-labelledby="sa-heading">
  <h2 id="sa-heading">Website accessibility</h2>
  <p class="sa-independence"><strong>This is the website&#39;s score — not its documents&#39;.</strong> It measures the accessibility of this site&#39;s <strong>web pages</strong> and says nothing about the <strong>files</strong> it publishes. The PDFs and Office documents are audited separately and may score far worse — or better. The two are measured independently and <strong>do not correlate</strong>.</p>
  <div class="sa-headline">
    <div class="sa-score"><span class="sa-num">${siteAudit.score}</span><span class="sa-grade">${esc(siteAudit.grade ?? "")}</span></div>
    <p class="sa-coverage">Scored <strong>${(cov.scored ?? 0).toLocaleString()}</strong> of ${(cov.pagesInSet ?? 0).toLocaleString()} pages${cov.capped ? ` (${cov.capped.toLocaleString()} not yet reached this run)` : ""}${cov.errored ? `, ${cov.errored.toLocaleString()} errored` : ""}.</p>
  </div>
  ${trendHtml}
  <div class="sa-breakdown">
    <div class="sa-card"><h3>Outstanding by severity</h3><ul>
      <li>Critical: <strong>${(sev.critical ?? 0).toLocaleString()}</strong></li>
      <li>Serious: <strong>${(sev.serious ?? 0).toLocaleString()}</strong></li>
      <li>Moderate: <strong>${(sev.moderate ?? 0).toLocaleString()}</strong></li>
      <li>Minor: <strong>${(sev.minor ?? 0).toLocaleString()}</strong></li>
    </ul></div>
    <div class="sa-card"><h3>Outstanding by WCAG level</h3><ul>
      <li>Level A: <strong>${(wcag.A ?? 0).toLocaleString()}</strong></li>
      <li>Level AA: <strong>${(wcag.AA ?? 0).toLocaleString()}</strong></li>
      <li class="sa-muted">AAA / best-practice: ${((wcag.AAA ?? 0) + (wcag.bestPractice ?? 0)).toLocaleString()} (outside the AA compliance target)</li>
      <li class="sa-muted">Needs review (manual): ${(out.needsReview ?? 0).toLocaleString()}</li>
    </ul></div>
  </div>
  <details class="sa-pages"><summary>Per-page scores (${pages.length.toLocaleString()})</summary>
    <table><thead><tr><th>Page</th><th>Score</th><th>Grade</th><th>Issues</th><th>Review</th><th></th></tr></thead><tbody>${pageRows}</tbody></table>
  </details>
</section>`;
}
```

- [ ] **Step 4: Run the section test to verify it passes**

Run: `npx vitest run test/site-accessibility-section.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Thread `siteAudit` + `pageScores` through `writeHtml`**

In `src/report/html.js`:

(a) Add the import at the top (next to the `./pages.js` import on line 3):

```js
import { renderSiteAccessibilitySection } from "./site-accessibility-section.js";
```

(b) Extend the `writeHtml` destructured params (line 467) — add `siteAudit = null, pageScores = null` to the end:

```js
export async function writeHtml({ sourceHeader, entries, sources, outputPath, backHref = null, csvHref = null, siteUrl = null, siteFullName = null, accessKind = null, sitemapUrls = [], cmsPages = [], resolveFleetFile = null, pageRefFiles = null, currentSiteName = null, siteAudit = null, pageScores = null }) {
```

(c) Pass `pageScores` into the `buildPageList` call (line 648):

```js
  const pageList = buildPageList(entries, sitemapUrls, cmsPages, pageScores);
```

(d) Build the section near where `accessPanelHtml` is built (after line 761) :

```js
  const siteAccessibilityHtml = renderSiteAccessibilitySection(siteAudit);
```

(e) Insert it into the body — change line 1960 from `${accessPanelHtml}` to:

```js
${accessPanelHtml}
${siteAccessibilityHtml}
```

(f) Add section CSS to the detail-page stylesheet. Find the `.audit-stats` CSS rule in the big `<style>` template literal and add these rules next to it:

```css
.site-accessibility { margin: 28px 0; padding: 20px 22px; border: 1px solid #c9d8e8; border-left: 5px solid #2f6fb0; border-radius: 10px; background: #f6fafe; }
.site-accessibility h2 { margin: 0 0 8px; color: #1b4a78; }
.site-accessibility .sa-independence { font-size: 0.95rem; color: #34526c; max-width: 70ch; }
.site-accessibility .sa-headline { display: flex; align-items: center; gap: 18px; margin: 14px 0; }
.site-accessibility .sa-num { font-size: 3rem; font-weight: 800; color: #1b4a78; line-height: 1; }
.site-accessibility .sa-grade { font-size: 1.4rem; font-weight: 700; color: #2f6fb0; margin-left: 6px; }
.site-accessibility .sa-coverage { margin: 0; color: #41607c; }
.site-accessibility .sa-trend { margin: 6px 0 14px; color: #34526c; }
.site-accessibility .sa-breakdown { display: flex; flex-wrap: wrap; gap: 16px; }
.site-accessibility .sa-card { flex: 1 1 240px; background: #fff; border: 1px solid #d8e4f0; border-radius: 8px; padding: 12px 14px; }
.site-accessibility .sa-card h3 { margin: 0 0 8px; font-size: 0.95rem; color: #1b4a78; }
.site-accessibility .sa-card ul { margin: 0; padding-left: 18px; }
.site-accessibility .sa-muted { color: #6a7c8c; font-size: 0.85rem; list-style: none; margin-left: -18px; }
.site-accessibility .sa-pages { margin-top: 14px; }
.site-accessibility .sa-pages table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 8px; }
.site-accessibility .sa-pages th, .site-accessibility .sa-pages td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #e4edf5; }
```

- [ ] **Step 6: Thread params through `runReport`**

In `src/commands/report.js`, add `siteAudit = null, pageScores = null` to the `runReport` destructured params (line 81), then add to the `writeHtml({ ... })` call (after `currentSiteName,`):

```js
      currentSiteName,
      siteAudit,
      pageScores,
```

- [ ] **Step 7: Run the full report test suite to verify nothing broke**

Run: `npx vitest run test/site-accessibility-section.test.js test/report-html.test.js test/report.test.js`
Expected: PASS (section tests pass; report/html tests unaffected — new params default to null).

- [ ] **Step 8: Commit**

```bash
git add src/report/site-accessibility-section.js src/report/html.js src/commands/report.js test/site-accessibility-section.test.js
git commit -m "feat: website accessibility section on per-site detail pages"
```

---

## Task 12: web-rollup loads the sidecar and threads it through

**Files:**
- Modify: `src/commands/web-rollup.js` (load `latest/site-audit.json` per site; build `pageScores` map; attach `sr.siteAudit`; pass `siteAudit` + `pageScores` to `runReport`)
- Test: `test/web-rollup.test.js` or `test/web-rollup-helpers.test.js` (smoke — see Step 4)

**Interfaces:**
- Consumes: the sidecar written by Task 7; `normPageUrl` from `src/report/pages.js`
- Produces: `sr.siteAudit` on each siteResult; `pageScores` Map passed into `runReport`.

- [ ] **Step 1: Add a sidecar loader helper near the top of web-rollup.js**

Add this import to the existing `src/report/pages.js` import line (line 14) — append `normPageUrl`:

```js
import { parseCmsPageList, buildPageList, parsePageRefFiles, attachCrossSiteFiles, normPageUrl } from "../report/pages.js";
```

Add this helper function above `computeSiteSummary` (line 793):

```js
// v1.35.0 — load the site-audit sidecar (written by `filecap site-audit`) and
// derive the pageScores map the Page view overlays. Missing/corrupt → nulls, so
// a site that hasn't been site-audited just renders without the a11y tile.
function loadSiteAudit(latestDir) {
  try {
    const sc = JSON.parse(require("node:fs").readFileSync(require("node:path").join(latestDir, "site-audit.json"), "utf8"));
    if (!sc || typeof sc !== "object") return { siteAudit: null, pageScores: null };
    const pageScores = new Map();
    for (const p of sc.pages ?? []) {
      if (p?.url) pageScores.set(normPageUrl(p.url), { score: p.score, grade: p.grade, violationCount: p.violationCount, bySeverity: p.bySeverity, reportUrl: p.reportUrl, pageTitle: "" });
    }
    return { siteAudit: sc, pageScores };
  } catch {
    return { siteAudit: null, pageScores: null };
  }
}
```

Note: web-rollup.js is ESM; if `require` is unavailable in that module, replace the two `require(...)` calls with the module's existing `fs`/`path` imports (the file already imports `fs` and `path` — use them directly: `fs.readFileSync` / `path.join`). Verify the imports at the top of web-rollup.js and use whichever is in scope.

- [ ] **Step 2: Load + thread it in the per-site loop**

In the per-site loop, just before the `runReport({ ... })` call (line 1112), add:

```js
    const latestDir = path.dirname(latestInv);
    const { siteAudit, pageScores } = loadSiteAudit(latestDir);
```

Add to the `runReport({ ... })` call (after `currentSiteName: ...` line 1127):

```js
      currentSiteName: header.metadata?.serverName ?? siteKey,
      siteAudit,
      pageScores,
```

And attach to the siteResult pushed at line 1285 (add `siteAudit` to the pushed object):

```js
    siteResults.push({
      site,
      header,
      summary,
      htmlFile: `${baseName}.html`,
      csvFile: `${baseName}.xlsx`,
      scannedAt: header.metadata?.scannedAt ?? null,
      siteAudit,
```

(Keep the existing fields; only `siteAudit` is added. If `siteAudit`/`pageScores` were declared inside a narrower block, hoist the `const { siteAudit, pageScores } = loadSiteAudit(latestDir);` so it is in scope at the push site — declare it right after `latestInv` is known.)

- [ ] **Step 3: Pass `pageScores` to the per-site XLSX Page tab `buildPageList` (parity)**

At the `buildPageList(perSiteEntries, sitemapUrls, cmsPages)` call (line 1163), add `pageScores`:

```js
    const pageList = buildPageList(perSiteEntries, sitemapUrls, cmsPages, pageScores);
```

- [ ] **Step 4: Smoke-verify with a no-deploy local build**

Run: `FILECAP_NO_DEPLOY=1 npx vitest run test/web-rollup.test.js`
Expected: PASS (existing web-rollup tests still pass — sidecar load is defensive and optional).

(If `test/web-rollup.test.js` builds a fixture bundle, optionally add a case asserting that a site with a `latest/site-audit.json` fixture produces a card containing `Website accessibility`. If the test harness makes that hard, rely on the unit-tested `renderSiteA11yTile` from Task 9 plus this smoke run.)

- [ ] **Step 5: Commit**

```bash
git add src/commands/web-rollup.js
git commit -m "feat: web-rollup reads site-audit sidecar into cards + detail pages"
```

---

## Task 13: (Optional cleanup) retire the references-only page pass

> **Deferrable.** The feature is complete after Task 12. This task removes the now-redundant page-audit pass inside `audits.js` (the site-audit stage scores the full page set and the Page view reads from the sidecar). They already share the cache, so leaving it in only costs a little redundant work. Skip if you'd rather not touch the working `audits` stage.

**Files:**
- Modify: `src/commands/audits.js` (remove the v1.10.0 page-audit pass block, lines ~245-346, and the now-unused page options)
- Modify: `bin/filecap.js` (drop the `--skip-pages` / `--page-*` options from the `audits` command)
- Test: `test/audits-orchestrator.test.js` (remove/adjust assertions about `ref.pageAudit` and `pagesAudited`)

**Interfaces:**
- `runAudits` return no longer includes `pagesTotalUnique/pagesAudited/pagesCached/pagesErrors`; entries no longer get `ref.pageAudit`.

- [ ] **Step 1: Read the current page-audit tests**

Run: `grep -n "pageAudit\|pagesAudited\|skipPages\|pages:" test/audits-orchestrator.test.js`
Expected: lists the assertions to adjust.

- [ ] **Step 2: Remove the page-audit pass from `audits.js`**

Delete the block from the `// v1.10.0: page-audit pass` comment (line ~245) through the end of the `if (!skipPages) { ... }` block (line ~346). Remove the now-unused params from the `runAudits` destructure (`pageAuditEndpoint`, `pageCachePath`, `pageTtlDays`, `skipPages`) and the `fetchPageAuditScore` import (line 25). Adjust the final `log(...)` and the returned object to drop the `pages*` fields.

- [ ] **Step 3: Drop the CLI page options**

In `bin/filecap.js`, remove the `--skip-pages`, `--page-audit-endpoint`, `--page-cache-path`, `--page-ttl-days` options (lines ~311-327) from the `audits` command and the matching keys in its `runAudits({ ... })` call (lines ~375-379).

- [ ] **Step 4: Update the orchestrator test**

Remove assertions referencing `ref.pageAudit` / `pagesAudited` / `skipPages`. Keep the PDF-scoring assertions.

- [ ] **Step 5: Run the audits tests**

Run: `npx vitest run test/audits-orchestrator.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands/audits.js bin/filecap.js test/audits-orchestrator.test.js
git commit -m "refactor: retire references-only page pass (site-audit owns page scoring)"
```

---

## Task 14: Release — version, CHANGELOG, README, accessibility log

**Files:**
- Modify: `package.json` (`version`)
- Modify: `CHANGELOG.md` (new entry)
- Modify: `README.md` (document the stage + the two-scores distinction)
- Reference: append a timestamped entry to the deployed `/accessibility` log (per project rule) — done via the site content, noted here as a release step.

- [ ] **Step 1: Run the full test suite + lint**

Run: `npm test && npm run lint`
Expected: all tests pass; lint clean.

- [ ] **Step 2: Bump the version**

In `package.json`, change `"version": "1.34.1"` to `"version": "1.35.0"`. (`src/version.js` reads from `package.json`, so nothing else to change.)

- [ ] **Step 3: Add the CHANGELOG entry**

Add at the top of the entries in `CHANGELOG.md`:

```markdown
## [1.35.0]

### Added
- **Website accessibility score** — a per-site, SiteImprove-style accessibility score (0–100 + A–F grade) for each site's web pages, scored with axe via `audit.icjia.app/api/audit-url-page` and driven by the site's sitemap (∪ CMS pages), explicitly independent of the file/PDF scores. New `filecap site-audit <site>` stage (pipeline Stage 3.6) writes a purge-exempt `latest/site-audit.json` sidecar with the score, a severity + WCAG-level (A/AA) outstanding-issue breakdown, a needs-review count, and a true fixed/new issue-set trend vs. the previous run.
- Compact "Website accessibility" tile on each audit-bundle site card, and a full breakdown section (score, coverage, severity + WCAG split, fixed/new trend, per-page table) on each per-site detail page — each carrying copy that the website score does not reflect the site's files.
- `SKIP_SITE_AUDIT=1` opt-out in the fleet pipeline scripts.

### Notes
- Requires `audit.icjia.app` to return `axe.violations[]` + `axe.incomplete[]` and to render SPAs before auditing; filecap degrades gracefully (severity-only, no trend) against an endpoint that doesn't yet.
```

- [ ] **Step 4: Document in README**

Add a short subsection under the CLI reference / pipeline area describing `filecap site-audit`, the two-scores distinction (website vs. files, do-not-correlate), and the `SKIP_SITE_AUDIT` flag. Mirror the wording in the CHANGELOG entry.

- [ ] **Step 5: Commit**

```bash
git add package.json CHANGELOG.md README.md
git commit -m "chore: release 1.35.0 — website accessibility score"
```

- [ ] **Step 6: Post-deploy reminder (not a code step)**

After the endpoint is enhanced and a full run ships, append a timestamped entry to the deployed `/accessibility` log noting the axe-core engine/version and that the new score covers sitemap pages only (not files).

---

## Self-Review

**1. Spec coverage:**
- Two-scores mental model + independence copy → Tasks 9, 11 (copy), Global Constraints.
- axe via existing endpoint → Tasks 4, 7. ✓
- Full, cache-amortized coverage + per-run cap → Task 7 (`maxNewPages`, shared cache). ✓
- Headline = avg per-page score + grade bands → Task 3. ✓
- Issue-set true fixed/new + purge-exempt sidecar in `latest/` → Tasks 2, 6, 7. ✓
- Endpoint contract (violations[]/incomplete[], SPA render) → Task 4 (consume), Global Constraints (the endpoint change itself is the separate-repo dependency, called out, not a filecap task). ✓
- New `site-audit` stage, sidecar read by web-rollup → Tasks 7, 8, 12. ✓
- Scored set = sitemap ∪ CMS, excludes file-only pages → Task 5. ✓
- Card tile + detail section; `/sites` untouched; file score still download-only → Tasks 9, 11 (no `/sites` or scores-by-site changes anywhere). ✓
- Page view fills for every page → Tasks 10, 12. ✓
- Subsume references-only page pass → Task 13 (optional). ✓
- Pipeline/script + CHANGELOG + /accessibility log → Tasks 8, 14. ✓
- Grade bands mirror endpoint → Task 3 + spec §9/§17. ✓

**2. Placeholder scan:** No "TBD"/"handle appropriately"/"write tests for the above"; every code step has complete code; every test step has real assertions. ✓

**3. Type consistency:** `wcagLevelForTags` → `aggregateSite.outstanding.byWcag {A,AA,AAA,bestPractice}` → sidecar `outstanding` → `renderSiteAccessibilitySection`/`renderSiteA11yTile` (read `byWcag.A/AA/bestPractice`, `outstanding.total`, `trend.fixed/new/stillOpen`, `coverage.scored/pagesInSet/capped/errored`). `diffIssueSets` returns `{fixed,introduced,stillOpen}`; `buildSidecar` maps `introduced → trend.new` — consumers read `trend.new`. ✓ `buildPageList(entries, sitemapUrls, cmsPages, pageScores)` — Task 10 defines, Tasks 11(f)/12 call with the 4th arg. ✓ `runSiteAudit` return fields (`scored/errored/capped/score/grade/sidecarPath`) match the command test. ✓

---

## Execution Handoff

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Which approach?
