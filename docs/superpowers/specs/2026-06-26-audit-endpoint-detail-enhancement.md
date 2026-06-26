# audit.icjia.app — `/api/audit-url-page` detail + SPA-render enhancement

- **Date:** 2026-06-26
- **Target repo:** **`audit.icjia.app`** (NOT filecap-cli). This doc lives in filecap because filecap is the consumer; carry it into the audit app's repo to implement.
- **Status:** IMPLEMENTED on branches (2026-06-26), not yet deployed.
  - **audit.icjia.app** (`file-accessibility-audit` repo): branch `feat/page-audit-detail` (commit `cf1228e`) — exposes `axe.violations[]` + `axe.incomplete[]`. **Deploy is yours** (their infra).
  - **filecap** consumer side: landed on `main` (`7b25f26`).
  - **Correction to this draft:** §2.2 (render SPAs before auditing) was **already implemented** in the endpoint (`networkidle2` + a 2 s hydration wait) — no change was needed there; only the detail exposure (§2.1) was added. So `icjia.illinois.gov`'s 100/0 was a real hydrated render, not a shell.
  - **Actual shipped per-issue shape:** `{ id, impact, description, helpUrl, tags, nodeCount, nodes: [{ target }] }`, where `nodeCount` is the uncapped `max(1, nodes.length)` and `nodes` is capped at 25. filecap counts `nodeCount` in its WCAG breakdown so it reconciles with the endpoint's node-based `bySeverity` (resolving the §3 unit concern).
- **Consumer dependency:** filecap's `site-audit` feature (v1.35.0, merged to `main`) is built and ships **dormant** until this lands. filecap's normalizer already tolerates the absence of these fields (treats them as `[]`), so this change is non-breaking to deploy independently.

---

## 1. Why

`POST /api/audit-url-page` runs `@axe-core/puppeteer` against the live DOM and returns a score, but **discards the per-rule detail** axe already computed, and (for client-rendered SPAs) may run axe **before the page hydrates**. filecap needs:

1. **Per-rule detail** (`axe.violations[]` + `axe.incomplete[]`) to render a WCAG A/AA breakdown, a needs-review count, and a true fixed/new issue-set trend.
2. **Correct SPA rendering** so the flagship `icjia.illinois.gov` (a client-rendered Vuetify SPA that ships a ~12 KB shell) is scored on its *hydrated* DOM, not its empty mount point. Static-generated Nuxt sites (the rest of the fleet) are unaffected either way.

Confirmed empirically 2026-06-26: the live endpoint returns aggregates only (404-byte body, no `violations` key), and `icjia.illinois.gov`'s delivered HTML is a shell whose real content (`.v-tab`, `.v-slide-group`, `<footer>`) appears only after JS hydration.

## 2. Scope — two changes

### 2.1 Expose per-rule detail (the data already exists)

`@axe-core/puppeteer`'s `.analyze()` already returns `results.violations[]` and `results.incomplete[]`. The endpoint currently reads them only to compute `score`/`grade`/`violationCount`/`bySeverity`, then drops them. Map each down to the **minimum** filecap needs and add them to the `axe` object:

```js
function slimIssues(arr) {
  return (Array.isArray(arr) ? arr : []).map((v) => ({
    id: v.id,                                   // axe rule id, e.g. "color-contrast"
    impact: v.impact ?? null,                   // "critical" | "serious" | "moderate" | "minor"
    tags: Array.isArray(v.tags) ? v.tags : [],  // e.g. ["cat.color","wcag2aa","wcag143"]
    nodes: (Array.isArray(v.nodes) ? v.nodes : [])
      .slice(0, MAX_NODES_PER_RULE)             // cap to bound payload (see §4)
      .map((n) => ({ target: Array.isArray(n.target) ? n.target : [] })),
  }));
}
// in the response builder, alongside the existing axe fields:
axe.violations = slimIssues(results.violations);
axe.incomplete = slimIssues(results.incomplete);
```

Do **not** include `html`, `failureSummary`, `description`, `help`, `helpUrl`, or `passes`/`inapplicable` — filecap doesn't use them and they bloat the payload. The full human-readable report still lives at `reportUrl` (unchanged).

### 2.2 Render SPAs before auditing

**ALREADY IMPLEMENTED — no change was needed.** `pageAuditor.ts` already navigates with `waitUntil: 'networkidle2'` plus a 2 s hydration wait, so SPAs (incl. `icjia.illinois.gov`) are already scored on the hydrated DOM. The guidance below is retained only as a record of what was verified.

Ensure the page has settled before `.analyze()`. With Puppeteer:

```js
await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS }); // was likely "load"/"domcontentloaded"
// settle insurance for late hydration (no-op cost on static pages):
await new Promise((r) => setTimeout(r, SETTLE_MS));
// optional, per-request override for stubborn SPAs (see §3 request):
if (waitForSelector) {
  await page.waitForSelector(waitForSelector, { timeout: 5000 }).catch(() => {});
}
// then: const results = await new AxePuppeteer(page).analyze();
```

`networkidle2` (≤2 in-flight connections for 500 ms) after `goto` catches SPA hydration in the common case; `SETTLE_MS` is insurance. Static Nuxt pages already have content in the initial HTML, so this only adds a small fixed delay for them.

## 3. The contract

**Request** (additive, all new fields optional — existing callers unaffected):
```jsonc
POST /api/audit-url-page
{ "url": "https://...",
  "force": false,           // existing
  "waitFor": ".v-tab" }      // NEW, optional: CSS selector to await post-nav (per-site override)
```

**Response** (additive — the `axe` object gains `violations` + `incomplete`; everything else byte-identical):
```jsonc
{
  "url": "https://icjia.illinois.gov/news/...",
  "pageTitle": "...", "audited": "2026-...", "cached": false,
  "reportId": "...", "reportUrl": "https://audit.icjia.app/page-report/...", "reportExpiresAt": "...",
  "axe": {
    "score": 87, "grade": "B",
    "violationCount": 5,
    "bySeverity": { "critical": 0, "serious": 2, "moderate": 2, "minor": 1 },
    "violations": [
      { "id": "color-contrast", "impact": "serious",
        "tags": ["cat.color", "wcag2aa", "wcag143"],
        "nodes": [ { "target": ["main .hero > h1"] } ] }
    ],
    "incomplete": [
      { "id": "color-contrast", "impact": "serious",
        "tags": ["wcag2aa"], "nodes": [ { "target": [".v-tab[role=\"tab\"]:nth-child(2)"] } ] }
    ]
  }
}
```

**Invariant filecap relies on (important):** `violationCount === violations.length` and `bySeverity` is counted **per rule** (one increment per `violations[]` entry, by its `impact`), so `sum(bySeverity) === violationCount`. filecap derives outstanding-by-severity from `bySeverity` and outstanding-by-WCAG from `violations[]`; they must reconcile at the **rule** level. (filecap's per-(page,rule,node) issue keys are a separate, finer metric and intentionally count nodes — that's fine.) If today's `bySeverity` already counts rules, no change; just don't switch it to node counts.

## 4. Decisions / recommendations (confirm before building)

- **Always return detail** (vs. gating behind `?detail=1`): recommended — filecap always wants it, the slimmed shape is small, and an unconditional response keeps the API simple. If payload is a concern, prefer the node cap below over a gate.
- **`MAX_NODES_PER_RULE` cap** (recommend 25): bounds a pathological page (one rule failing on hundreds of nodes). `violationCount`/`bySeverity` stay the true totals; only the per-rule `nodes[]` list is truncated. filecap's issue-key diff degrades gracefully (a capped page slightly undercounts node-level churn — acceptable).
- **`SETTLE_MS`** (recommend 800): tune against `icjia.illinois.gov` interior pages.
- **`waitUntil`**: `networkidle2` recommended over `networkidle0` (some sites keep a long-poll/analytics socket open, which would hang `networkidle0` to the nav timeout).
- **Auth / rate-limit / caching**: unchanged. The `shared_reports` persistence is unchanged.

## 5. Backward compatibility & payload

- Additive request + response; no existing field changes type or meaning. Existing consumers (and filecap against an un-upgraded endpoint) keep working.
- filecap's `src/audits/page-scorer.js` already maps `axe.violations`/`axe.incomplete` defensively (absent → `[]`), so deploy order is free — but the feature only produces real WCAG/trend data once this is live.
- Payload: a clean page adds `"violations":[],"incomplete":[]` (~30 bytes). A messy page with the node cap stays in low-KB territory.

## 6. Implementation steps (adapt paths to your repo)

1. `‹locate the /api/audit-url-page handler in your repo›` — find where `results = await new AxePuppeteer(page).analyze()` (or equivalent) runs and where the JSON response is assembled.
2. Add `slimIssues` (§2.1) and set `axe.violations` / `axe.incomplete` on the response. Keep the existing score/grade/violationCount/bySeverity logic; verify `bySeverity` is rule-level (§3 invariant).
3. Change the navigation to `waitUntil: "networkidle2"` + `SETTLE_MS` settle; add optional `waitFor` selector from the request body (§2.2).
4. Add the three constants (`MAX_NODES_PER_RULE`, `SETTLE_MS`, `NAV_TIMEOUT_MS`) to config.
5. Tests (in the audit app's suite):
   - **Unit:** `slimIssues` maps id/impact/tags/nodes[].target, drops other fields, caps nodes, tolerates missing/empty input.
   - **Unit:** response builder sets `violations`/`incomplete`; `sum(bySeverity) === violationCount === violations.length` on a fixture.
   - **Integration (the decisive one):** audit a **known-dirty interior `icjia.illinois.gov` page** (an SPA route with real content) and assert `violations.length > 0` with WCAG tags present — proving hydration happened. Re-audit a **static Nuxt** fleet page and assert its result is unchanged from before (no regression from the settle/networkidle change).

## 7. Verify against filecap (acceptance)

After deploy:
1. Re-probe directly:
   `curl -sS -X POST https://audit.icjia.app/api/audit-url-page -H 'Content-Type: application/json' -d '{"url":"https://icjia.illinois.gov/"}'` — confirm an `axe.violations` key is present (it'll be `[]` for the clean homepage; pick an interior page to see non-empty).
2. In filecap: `node bin/filecap.js site-audit icjia-illinois-gov` then open the resulting `latest/site-audit.json` — confirm `outstanding.byWcag` (A/AA) and `trend` are now populated (not all-zero), and `coverage.scored` looks right for the SPA (not just a handful of shell pages).
3. Confirm a static Nuxt site's score is stable across the upgrade.

## 8. Out of scope

- No change to the PDF endpoint (`/api/audit-url`).
- No change to score/grade math, the `shared_reports` rows, or `reportUrl`.
- filecap-side consumption is already built (v1.35.0); the only filecap follow-up is the §3 reconciliation check once real detail flows.
