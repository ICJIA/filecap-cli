# Website Accessibility Score (SiteImprove-style, per site)

- **Date:** 2026-06-26
- **Status:** Approved design — ready for implementation plan
- **Scope:** icjia-fleet-audit, plus one dependency change in the `audit.icjia.app` repo

---

## 1. Problem

Managers conflate two unrelated things:

1. **File accessibility** — whether the PDFs / Office docs a site publishes are remediable. filecap already measures this (the `audits` stage scores every PDF via `audit.icjia.app/api/audit-url`; it is surfaced **download-only** in the scores-by-site spreadsheet, deliberately kept off-page per the "contested scoring" decision).
2. **Website accessibility** — whether the site's own **HTML pages** meet WCAG. filecap does **not** currently surface this as a per-site number.

A site can have pristine pages and a swamp of inaccessible PDFs, or vice-versa — the two **do not correlate**. We want to make that distinction concrete and visible, modeled on what SiteImprove reports for site accessibility: an overall score, an outstanding-issues breakdown, and a fixed/new trend.

## 2. Goals

- A single **website accessibility score** (0–100 + A–F grade) per site, computed from the site's **own pages** (sitemap-driven), **never** from file counts or file rankings.
- A SiteImprove-style breakdown: **outstanding issues** by severity and by WCAG level, a **needs-review** count, and a **fixed / new / still-open** trend vs. the previous run.
- Surfaced as a compact tile on each audit-bundle **site card** (next to total files / may-need-audit) and as a full section on each **per-site detail page**.
- Explicit, manager-facing copy stating the website score is **independent of the file/PDF scores**.

## 3. Non-goals

- No change to the file/PDF aggregate-scoring stance: it stays **download-only** (off-page).
- No accessibility numbers on `/sites` — it stays the count-first, roster-only directory (v1.21.0 decision).
- No fleet-wide public leaderboard ranking sites best→worst.
- Not a replacement for SiteImprove or a full WCAG audit tool; it is an axe-core snapshot of the site's pages.

## 4. Findings from investigation (these justify the decisions below)

1. **The page endpoint returns aggregates only.** A live probe of `POST /api/audit-url-page` for `https://icjia.illinois.gov/` returned (404 bytes):
   ```json
   { "url": "...", "pageTitle": "ICJIA | Home", "audited": "...",
     "axe": { "score": 100, "grade": "A", "violationCount": 0,
              "bySeverity": { "critical": 0, "serious": 0, "moderate": 0, "minor": 0 } },
     "reportId": "...", "reportUrl": "https://audit.icjia.app/page-report/...", "cached": false }
   ```
   There is **no `violations[]`**, no rule IDs, no WCAG tags, no node selectors in the JSON. The per-rule detail exists server-side (the `reportUrl` renders a full report) but is not exposed via the API. The headline score is computable today; the WCAG-level breakdown and true issue-set diff are **not**.
2. **`icjia.illinois.gov` is a client-rendered SPA.** Its delivered HTML is a ~12 KB shell (`<div id="app">` + a tiny static splash; no `__NUXT__` state payload, no `<nav>`/`<footer>`). Real content (Vuetify components: `.v-tab`, `.v-slide-group`) appears only after JS hydration. The other fleet sites are static-generated Nuxt (content is in the initial HTML).
3. **The flagship homepage is genuinely clean — when hydrated.** An axecap (Playwright) audit forcing hydration (`waitFor: footer`) found the footer + Vuetify components and reported **0 AA violations, 1 needs-review** (`color-contrast` on the tab strip). So the endpoint's 100/A is correct *for this page* — but only because the page is clean. **An interior SPA page with real violations would be mis-scored as 100 if axe ran against the un-hydrated shell.** Therefore "render SPAs before scoring" is a hard requirement, not a nicety.
4. **axe `incomplete` (needs-review) is a useful third bucket** that SiteImprove also surfaces ("issues to review"). The endpoint currently ignores it.

## 5. Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Scoring engine | **axe-core** via the existing `audit.icjia.app/api/audit-url-page` (HTTP — works in the headless pipeline; MCP tools like `axecap`/`lightcap` cannot be called from the automated run) |
| 2 | Coverage | **Full, cache-amortized** — score every page in the site's page set, leaning on the existing 14-day `page-audit-cache.json`; a per-run cap bounds the first crawl |
| 3 | Headline | **Average per-page axe score** (0–100) + A–F grade — transparent, reproducible, hardest to contest |
| 4 | Trend | **Issue-set history** (true fixed/new) via a per-site sidecar that is purge-exempt |
| 5 | Placement | **Compact tile on cards + full section on detail pages**; `/sites` stays roster-only; file/PDF score stays download-only |
| 6 | Pipeline architecture | **New dedicated `site-audit` stage** writes a per-site sidecar; `web-rollup` only reads it (keeps the fast `web-rollup`-only path fast) |
| 7 | Detail data | **Enhance the endpoint first** to return raw `violations[]` + `incomplete[]`, so the first shipped version has WCAG A/AA + true issue-set fixed/new |

## 6. Dependency: `audit.icjia.app` endpoint enhancement (separate repo)

This filecap design depends on two additions to `POST /api/audit-url-page`. The data already exists server-side (the full report is rendered and persisted); this exposes it and hardens rendering.

### 6.1 Return per-rule detail

Add to the `axe` object:

```jsonc
"axe": {
  "score": 94, "grade": "A", "violationCount": 7,
  "bySeverity": { "critical": 0, "serious": 2, "moderate": 3, "minor": 2 },
  "violations": [
    { "id": "color-contrast", "impact": "serious",
      "tags": ["cat.color", "wcag2aa", "wcag143"],
      "nodes": [ { "target": ["main .hero > h1"] } ] }
  ],
  "incomplete": [
    { "id": "color-contrast", "impact": "serious",
      "tags": ["wcag2aa", "wcag143"],
      "nodes": [ { "target": [".v-tab[role=\"tab\"]:nth-child(2)"] } ] }
  ]
}
```

Each `violations[]` / `incomplete[]` item carries the **minimum** filecap needs: `id` (axe rule), `impact`, `tags` (for WCAG level), and `nodes[].target` (CSS selector path, for the stable issue key). Full `html`/`failureSummary` are **not** required by filecap (keep payloads small).

### 6.2 Render SPAs before auditing

Before running axe, wait for the page to settle: `waitUntil: 'networkidle'` (or networkidle0/2 equivalent) **plus a short post-idle delay**. This is a no-op for static Nuxt sites and fixes the Vuetify SPA. Optionally honor a per-site `waitFor` CSS selector passed in the request body (filecap can send one from `sites.json` for a stubborn site).

### 6.3 Backward/forward compatibility

filecap's `page-scorer.js` normalizer must treat `violations`/`incomplete` as optional (default `[]`) so it keeps working against an un-enhanced endpoint (it just won't have detail). The sidecar schema (§10) holds the richer data when present.

## 7. New `site-audit` pipeline stage

### 7.1 Placement

```
scan → references → cross-references → audits → site-audit → web-rollup
```

In `examples/audit-fleet-auto.sh` this is **Stage 3.6**, after `audits` (3.5) and before `web-rollup` (4), gated by `SKIP_SITE_AUDIT=1` (mirrors `SKIP_AUDITS` / `SKIP_REFERENCES`).

### 7.2 Command

`filecap site-audit <site>` — per-site, mirroring `filecap references <site>`, so the script loops `KNOWN_SITES` **sequentially** (one site at a time; the global 100/min IP rate limit means parallel sites would only contend). Internally uses bounded concurrency (default 2, like `audits`) and the existing retrying fetcher (handles 429/5xx with Retry-After). A `<site>` filter also enables targeted **backfill** of one site without a full run.

### 7.3 What it does per site

1. **Resolve the site's page set** (the "site itself", independent of files):
   - Sitemap URLs: `fetchSitemapUrls(...)` over `references.sitemapUrl → siteUrl/sitemap.xml → publicUrlBase/sitemap.xml`, then `scopeSitemapUrlsToSite(...)` (same logic web-rollup already uses).
   - ∪ CMS content pages from `latest/references-sidecar.ndjson` (`parseCmsPageList`).
   - Dedupe by normalized URL. **File-reference-derived pages are excluded** from the scored set (they may still appear in the Page *view*, but never move the site *score*). This sitemap+CMS resolution should be factored into a shared helper reused by web-rollup to avoid drift.
2. **Score each page** via `audit-url-page` (enhanced), reusing `~/.filecap/page-audit-cache.json` (14-day TTL, URL-keyed — shared with the existing page pass, so no URL is scored twice). Enforce a **per-run new-page cap** (default ~150; configurable) so the first crawl of a large SPA is bounded; un-fetched pages are recorded as `capped`, not scored as 0.
3. **Compute** the score, the severity/WCAG/needs-review breakdown, and the issue-set.
4. **Diff** against the prior `latest/site-audit.json` (read before overwrite) to produce fixed/new/still-open.
5. **Write** the new `latest/site-audit.json` sidecar (§10).

### 7.4 Subsumes the references-only page pass

The page-audit pass currently inside `audits.js` scores only pages found in `entry.references[]`. Once `site-audit` scores the full page set, that pass is redundant; fold it out so there is **one** page-scoring pass. Side benefit: the Page view's per-page axe column fills in for **every** page, not just file-linking ones (wire the sidecar's per-page scores into `buildPageList` so sitemap-only pages get a score too).

## 8. Scored page set (the "site itself")

- **Scored:** sitemap pages ∪ CMS content pages, deduped.
- **Not scored into the headline:** pages discovered only via a file's `references[]` (shown in the Page view, excluded from the score) — keeps the number purely site-based.
- A page that errors, 5xx's, or is over the per-run cap is **excluded** from the mean and reported under coverage — never counted as 0 (which would falsely tank the score).

## 9. Score model

- **Headline** = `round(mean(page.score for each scored page))`, 0–100.
- **Grade** via fixed bands that **mirror the endpoint's per-page grade bands**, so a site's averaged grade stays consistent with the per-page grades in the table (the endpoint's bands are the source of truth; they are approximately A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, F < 60).
- **Coverage** is always reported alongside the score (e.g. "scored 142 / 412 pages"), so a partially-scored big site is honest.
- A site with **zero** scorable pages shows **"not yet scored"** (tile omitted on the card), never "0".

## 10. Sidecar schema

`<AUDITS_BASE>/<site>/latest/site-audit.json` — lives in `latest/`, so the purge step (which deletes only `*Z` run dirs) never removes it. Self-sufficient rolling baseline: each run reads the existing file for the diff, then overwrites it.

```jsonc
{
  "schema": 1,
  "siteName": "icjia-illinois-gov",
  "auditedAt": "2026-06-26T14:03:40Z",
  "endpoint": "https://audit.icjia.app/api/audit-url-page",
  "coverage": { "pagesInSet": 412, "scored": 150, "errored": 2, "capped": 260 },
  "score": 94,
  "grade": "A",
  "outstanding": {
    "total": 37,
    "bySeverity": { "critical": 0, "serious": 4, "moderate": 18, "minor": 15 },
    "byWcag":     { "A": 9, "AA": 28, "AAA": 0, "bestPractice": 4 },
    "needsReview": 11
  },
  "trend": { "vsDate": "2026-06-12T...", "fixed": 12, "new": 5, "stillOpen": 32 },
  "issueKeys": [ "<sha1(pageUrl|ruleId|nodeTarget)>", "..." ],
  "scoreHistory": [ { "date": "2026-06-12T...", "score": 91, "outstandingTotal": 44 } ],
  "pages": [
    { "url": "https://...", "score": 96, "grade": "A", "violationCount": 1,
      "bySeverity": { "critical": 0, "serious": 0, "moderate": 1, "minor": 0 },
      "needsReview": 1, "reportUrl": "https://audit.icjia.app/page-report/..." }
  ]
}
```

- **`issueKeys`** — the current run's set, used as the baseline for *next* run's diff. Key = `sha1(normalizedPageUrl + "|" + ruleId + "|" + nodeTarget)`.
- **`byWcag`** — derived from each violation's `tags`: `wcag2a`/`wcag21a` → A, `wcag2aa`/`wcag21aa` → AA, `wcag2aaa` → AAA, else bestPractice. The compliance headline counts A + AA only (mirrors the `siteimprove-compare` skill's logic); AAA/best-practice are shown but excluded from the compliance framing.
- **`scoreHistory`** — compact rolling series (cap ~24 entries) for a small trend line on the detail page, without retaining full issue-sets historically.

## 11. UI — card tile (`renderCard`, `index-page.js`)

A third tile in the `.nums` row, visually distinct from the file tiles (different accent so it never reads as a file metric):

```
┌ Website accessibility ┐
│      94   (A)         │
│  37 open · 12 fixed   │
│  ⓘ pages only — not files
└───────────────────────┘
```

- Shows score + grade; a one-line "N open · M fixed" since last run; an ⓘ affordance linking to the detail-page explainer.
- **Omitted** (not zeroed) for unscored sites.
- Pure addition to the existing card; file tiles and donut unchanged.

## 12. UI — detail-page section

A "Website accessibility" panel on each per-site detail page (depth lives here):

- Big **score + grade**, **coverage** line, small **trend line** from `scoreHistory`.
- **Outstanding issues** two ways: by **severity** (critical/serious/moderate/minor) and by **WCAG level** (A / AA, with AAA/best-practice noted separately).
- **Fixed / new / still-open** since the previous run.
- **Needs-review** count (axe incomplete).
- **Per-page table**: page · score · grade · top issue(s) · link to the live `reportUrl`.
- Opens with the **conflation-breaking paragraph** (§13).

## 13. Distinctness copy (the point of the feature)

Verbatim intent, shown on the detail panel and summarized in the card ⓘ:

> **This is the website's score — not its documents'.** This site scores **94/A** on the accessibility of its **web pages**. That number says nothing about the **files** it publishes: the PDFs and Office documents on this site are audited separately and may score far worse (or better). A perfectly accessible website can still publish unreadable PDFs, and a site with minor page issues can host flawless documents. **The two are measured independently and do not correlate.**

## 14. Pipeline & ops integration

- **`examples/audit-fleet-auto.sh`** — add Stage 3.6 (loop `KNOWN_SITES` sequentially, `node bin/filecap.js site-audit <site>`, log per site), gated by `SKIP_SITE_AUDIT=1`. Document the new env var in the header block and in `run-full-audit.sh`'s comment ("Enrich" step).
- **Caching/rate limits** — reuse `page-audit-cache.json` + `createRetryingJsonFetcher`; respect the 100/min global IP cap (sequential sites, concurrency 2).
- **Purge** — no change needed; sidecar in `latest/` is already exempt.
- **CHANGELOG.md** — add the `## [X.Y.Z]` entry as part of the release commit (before push).
- **/accessibility log** — append a timestamped entry to the deployed site's accessibility log when this ships (per project rule), recording the axe-core engine/version and what the score covers.
- **README** — document the new stage + the two-scores distinction.

## 15. Testing strategy

Unit tests inject a fake fetcher (as existing `audits` tests do) — no live network:

- Score aggregation (mean, rounding, grade bands); unscored/errored/capped pages excluded from the mean; zero-scorable-pages → "not yet scored".
- Coverage accounting.
- Severity bucketing and **WCAG tag → level** mapping (incl. `wcag21aa`, best-practice, multi-tag).
- **Issue-key** construction + diff: fixed / new / still-open across two synthetic runs, including churn (some fixed + some new in the same run).
- Sidecar read → diff → write round-trip; schema-version handling; missing prior sidecar (first run, trend null).
- `page-scorer.js` normalizer tolerates both enhanced (`violations[]` present) and legacy (absent) responses.
- Card tile render (present / omitted-when-unscored) and detail-panel render from a fixture sidecar.
- Scored-set resolution excludes file-only-referenced pages.

## 16. Rollout sequence

1. **Endpoint first** (`audit.icjia.app`): add `violations[]` + `incomplete[]`; add SPA render-wait; redeploy. Verify with a known-dirty interior SPA page that violations now appear (and that a static Nuxt page is unchanged).
2. **filecap**: `page-scorer.js` (capture detail) → `site-audit` module + command → sidecar read/write + diff → fold out the references-only page pass → wire per-page scores into `buildPageList` → card tile → detail panel → script Stage 3.6 → tests → CHANGELOG/README/accessibility-log.
3. Run a full audit; confirm the SPA's interior pages score realistically (not all 100), and the static sites are stable.

## 17. Open questions / risks

- **Endpoint ownership/timing** — the §6 change is in a separate repo; filecap work that depends on detail data can be built against a fixture in the meantime, but can't ship truthfully until the endpoint is live.
- **SPA coverage** — if `icjia.illinois.gov`'s sitemap is thin (SPA routes not all listed), CMS pages backfill it; if both are thin, coverage will be honestly low until the sitemap/route list improves. Worth checking the SPA's sitemap completeness during implementation.
- **Grade-band alignment** — keep filecap's site grade bands identical to the endpoint's per-page bands so the averaged grade is consistent with the per-page grades shown in the table.
- **First-crawl cost** — the per-run cap means a very large site reaches full coverage over several runs; `log()` the capped count so partial coverage is never mistaken for full.
