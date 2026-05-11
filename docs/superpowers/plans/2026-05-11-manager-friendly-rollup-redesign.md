# Manager-friendly Rollup Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `v1.7.0` of `@icjia/filecap` so the fleet rollup index and per-site detail pages read like an infographic for non-technical managers — full site names, big color-coded "total" + "need audit" numbers, donut chart with plain-English caption, file-type chips, and a big CTA — without breaking any of the existing inventory / filter / CSV-download machinery.

**Architecture:** All visible changes live in three generators (`src/web/index-page.js`, `src/report/html.js`, `src/web/styles.js`) and the data field `siteFullName` plumbed end-to-end through `web-rollup.js → report.js → html.js` alongside the existing `siteUrl` field. The donut is CSS-only (`conic-gradient` + `::after` mask) — no SVG, no chart library, works offline. Equal-height card alignment is enforced via `display: flex; flex-direction: column` on each card with fixed-height slots and a bottom-pinned CTA (`margin-top: auto`).

**Tech Stack:** Node 20+ ESM, vitest snapshot tests, vanilla CSS (no preprocessor), no new runtime dependencies. Existing test count: 288 across 27 files.

**Reference spec:** `docs/superpowers/specs/2026-05-11-manager-friendly-rollup-redesign.md`

---

## File map

**Modify**
- `src/web/index-page.js` (1299 lines) — export `renderCard`, rewrite card markup, replace card CSS block, switch grid to 2-col.
- `src/report/html.js` (1007 lines) — add `siteFullName` parameter to `writeHtml`, replace the page-top `<h1>` + meta-grid block with the new V1 hero, add hero CSS.
- `src/web/styles.js` (70 lines) — add new color tokens to `DESIGN_TOKENS` and emit them as CSS custom properties from `darkModeCss()`.
- `src/commands/web-rollup.js` (lines 437-446, ~516) — pass `site.siteFullName` to `runReport` and into the `siteResult` object that feeds `renderCard`.
- `src/commands/report.js` (lines 81, 135-148) — accept `siteFullName` parameter, forward to `writeHtml`.
- `test/web-rollup.test.js` — add tests covering `siteFullName` plumbing through `runWebRollup`.
- `test/report-html.test.js` — add tests covering `writeHtml` with/without `siteFullName` + the new hero block markup.
- `CHANGELOG.md` — `[1.7.0] — 2026-05-11` entry.
- `package.json` — `"version": "1.7.0"`.

**Update (non-repo, user data)**
- `~/.filecap/sites.json` — add `siteFullName` to each of the 17 entries.

**No changes**
- NDJSON schema / `filecap scan` / `audit-remote.sh` — `siteFullName` lives in `sites.json` and flows through `web-rollup`, not through the per-site scan.
- Existing file-table / filter-chip / CSV-download machinery in `report/html.js`. Only the page-top hero block changes.

---

## Task 1: Add `siteFullName` to `~/.filecap/sites.json`

**Files:**
- Modify: `~/.filecap/sites.json` (user-local, not git-tracked)

**Why this is Task 1:** later tasks reference this data through `runWebRollup` integration tests. The 17-name map lives in the spec (decision D1). Sites without `siteFullName` cleanly fall back to `siteName` (zero-config compatibility), so this is purely additive.

- [ ] **Step 1: Back up the existing sites.json**

```bash
cp ~/.filecap/sites.json ~/.filecap/sites.json.bak-v1.7.0
```

Expected: no output. Confirm with `ls -l ~/.filecap/sites.json.bak-v1.7.0`.

- [ ] **Step 2: Apply the 17 `siteFullName` values using a Python in-place edit**

```bash
python3 - <<'PY'
import json
p = "/Users/cschweda/.filecap/sites.json"
m = {
    "dvfr-strapi-prod":   "Domestic Violence Fatality Review",
    "r3-strapi-prod":     "Restore. Reinvest. Renew. (R3) Program",
    "i2i-strapi-prod":    "Institute to Innovate",
    "icjia-agency-prod":  "Illinois Criminal Justice Information Authority",
    "infonet-strapi-prod":"InfoNet",
    "ilfvcc-api-prod":    "Illinois Family Violence Coordinating Council",
    "archive-prod":       "ICJIA Document Archive",
    "intranet-api-prod":  "ICJIA Staff Intranet",
    "vpp-git":            "Violence Prevention Project",
    "ari-api-prod":       "Adult Redeploy Illinois",
    "ilheals-git":        "Illinois HEALS",
    "researchhub-prod":   "ICJIA Research Hub",
    "spac-prod":          "Sentencing Policy Advisory Council",
    "ari-summit-2023-git":"Adult Redeploy All Sites Summit 2023",
    "ari-summit-2019-git":"Adult Redeploy All Sites Summit 2019",
    "ari-summit-2018-git":"Adult Redeploy All Sites Summit 2018",
    "ari-summit-2017-git":"Adult Redeploy All Sites Summit 2017",
}
with open(p) as f: d = json.load(f)
for s in d["sites"]:
    if s["name"] in m: s["siteFullName"] = m[s["name"]]
with open(p, "w") as f: json.dump(d, f, indent=2)
print("updated", len([s for s in d["sites"] if "siteFullName" in s]), "of", len(d["sites"]))
PY
```

Expected output: `updated 17 of 17`.

- [ ] **Step 3: Verify**

```bash
python3 -c "import json; d=json.load(open('/Users/cschweda/.filecap/sites.json')); [print(f'{s[\"name\"]:30s} -> {s.get(\"siteFullName\",\"(missing)\")}') for s in d['sites']]"
```

Expected: every site prints with a full name; none say `(missing)`.

- [ ] **Step 4: No commit — `sites.json` is not in the repo.**

---

## Task 2: Plumb `siteFullName` through `web-rollup → report → writeHtml` (TDD)

**Files:**
- Modify: `src/commands/web-rollup.js` (around lines 437-446, ~516)
- Modify: `src/commands/report.js` (lines 81, 135-148)
- Modify: `src/report/html.js` (around line 138 — `writeHtml` signature only; markup change comes in Task 4)
- Test: `test/web-rollup.test.js` (extend existing tests)
- Test: `test/report-html.test.js` (extend existing tests)

- [ ] **Step 1: Add a failing test in `test/report-html.test.js`**

Append this test to the existing file (after the last existing `it()` block — find it with `grep -n "^});" test/report-html.test.js | tail -2`):

```javascript
it("uses siteFullName for the page title when provided", async () => {
  const outputPath = path.join(tmpDir, "out.html");
  await writeHtml({
    sourceHeader: sampleHeader,
    entries: sampleEntries,
    sources: null,
    outputPath,
    siteFullName: "Domestic Violence Fatality Review",
  });
  const html = await fs.readFile(outputPath, "utf8");
  expect(html).toContain("Domestic Violence Fatality Review");
});

it("falls back to siteName when siteFullName is not provided", async () => {
  const outputPath = path.join(tmpDir, "out.html");
  await writeHtml({
    sourceHeader: { ...sampleHeader, metadata: { ...sampleHeader.metadata, siteName: "DVFR" } },
    entries: sampleEntries,
    sources: null,
    outputPath,
  });
  const html = await fs.readFile(outputPath, "utf8");
  expect(html).toContain("DVFR");
});
```

- [ ] **Step 2: Run the new tests to verify they FAIL**

```bash
cd /Volumes/satechi/webdev/filecap-cli
npx vitest run test/report-html.test.js -t "siteFullName"
```

Expected: 2 failing tests. First fails because `writeHtml` doesn't accept `siteFullName` yet (or accepts it silently and doesn't render it). Second probably passes already since `siteName=DVFR` is rendered somewhere; that's fine — both tests stay in the suite.

- [ ] **Step 3: Add the parameter to `writeHtml` in `src/report/html.js`**

Change line ~138:

```javascript
// before
export async function writeHtml({ sourceHeader, entries, sources, outputPath, backHref = null, csvHref = null, siteUrl = null }) {
```

to:

```javascript
// after
export async function writeHtml({ sourceHeader, entries, sources, outputPath, backHref = null, csvHref = null, siteUrl = null, siteFullName = null }) {
```

(Just adds `siteFullName = null` to the destructured args — pure additive, no behavior change yet.)

- [ ] **Step 4: Wire siteFullName into the existing `<h1>` line as a minimal first step**

Find the existing line (around line 718 of `src/report/html.js`):

```html
<h1>filecap inventory report</h1>
```

Replace with:

```html
<h1>${htmlEscape(siteFullName ?? siteName ?? "filecap inventory report")}</h1>
```

(`siteName` is already in scope at line 249. This is a minimal change to make the first new test pass. The full hero block lands in Task 4.)

- [ ] **Step 5: Run the two new tests to verify they PASS**

```bash
npx vitest run test/report-html.test.js -t "siteFullName"
```

Expected: 2 passing tests.

- [ ] **Step 6: Run the full `report-html` test suite to check nothing else broke**

```bash
npx vitest run test/report-html.test.js
```

Expected: all tests pass (existing snapshots may need updating if any assert the old `<h1>filecap inventory report</h1>` text — if so, update the test fixture string, not the production code).

- [ ] **Step 7: Add `siteFullName` to `runReport` in `src/commands/report.js`**

Change line 81:

```javascript
// before
export async function runReport({ input, outputDir, html = false, backHref = null, csvHref = null, siteUrl = null }) {
```

to:

```javascript
// after
export async function runReport({ input, outputDir, html = false, backHref = null, csvHref = null, siteUrl = null, siteFullName = null }) {
```

Then in the `writeHtml` call (line ~135-148), add `siteFullName,` as a new property:

```javascript
await writeHtml({
  sourceHeader: header,
  entries,
  sources,
  outputPath: path.join(outputDir, "audit-file-list.html"),
  backHref,
  csvHref: csvHref ?? "audit-file-list.csv",
  siteUrl,
  siteFullName,            // ← NEW
});
```

- [ ] **Step 8: Pass `siteFullName` from `web-rollup.js` to `runReport`**

In `src/commands/web-rollup.js` find the `runReport(...)` call (around line 437-446). Add a new property to the args object:

```javascript
const reportResult = await runReport({
  input: latestInv,
  outputDir: tempDir,
  html: true,
  backHref: "index.html",
  csvHref: `${baseName}.csv`,
  siteUrl: site.siteUrl ?? null,
  siteFullName: site.siteFullName ?? null,   // ← NEW
});
```

- [ ] **Step 9: Pass `siteFullName` into the `siteResult` object that feeds `renderCard`**

Around line 510-518 in `src/commands/web-rollup.js`, find the `siteResults.push({...})` block. Add `siteFullName` so `renderCard` can read it from `sr.site` (this is purely belt-and-suspenders — `sr.site` is already the same `site` reference, but stashing it explicitly makes the intent clear and survives any future restructuring):

```javascript
siteResults.push({
  site: { ...site, siteFullName: site.siteFullName ?? null },
  header,
  summary,
  htmlFile: `${baseName}.html`,
  csvFile: `${baseName}.csv`,
  scannedAt: header.metadata?.scannedAt ?? null,
});
```

- [ ] **Step 10: Add a `web-rollup` integration test that confirms end-to-end plumbing**

Append to `test/web-rollup.test.js` (after the existing `describe("runWebRollup", ...)` block — search for the last `});` at column 1):

```javascript
describe("runWebRollup — siteFullName plumbing", () => {
  let tmpDir, sitesFile, auditsBase, outputDir;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-fullname-"));
    sitesFile = path.join(tmpDir, "sites.json");
    auditsBase = path.join(tmpDir, "audits");
    outputDir = path.join(tmpDir, "out");
  });
  afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

  it("threads siteFullName into the generated per-site HTML", async () => {
    const siteDir = path.join(auditsBase, "dvfr-strapi-prod", "runs", "20260101-000000Z");
    await fs.mkdir(siteDir, { recursive: true });
    await writeInventory(path.join(siteDir, "inventory.ndjson"), {
      serverName: "dvfr-strapi-prod", hostname: "1.2.3.4", siteName: "DVFR",
    });
    await fs.symlink(path.relative(path.dirname(path.join(auditsBase, "dvfr-strapi-prod", "latest")), siteDir),
                     path.join(auditsBase, "dvfr-strapi-prod", "latest"));

    await writeSitesJson(sitesFile, [{
      name: "dvfr-strapi-prod", siteName: "DVFR",
      siteFullName: "Domestic Violence Fatality Review",
      user: "forge", host: "1.2.3.4", remotePath: "/uploads",
    }]);

    const result = await runWebRollup({
      sitesFile, output: outputDir, auditsBase, password: null,
    });
    expect(result.exitCode).toBe(0);

    // Find the per-site HTML in the bundle dir
    const files = await fs.readdir(outputDir);
    const dvfrHtml = files.find((f) => f.startsWith("dvfr-") && f.endsWith(".html"));
    expect(dvfrHtml).toBeDefined();
    const html = await fs.readFile(path.join(outputDir, dvfrHtml), "utf8");
    expect(html).toContain("Domestic Violence Fatality Review");
  });
});
```

- [ ] **Step 11: Run the new web-rollup test to verify PASS**

```bash
npx vitest run test/web-rollup.test.js -t "siteFullName plumbing"
```

Expected: 1 passing test.

- [ ] **Step 12: Run the full test suite to catch regressions**

```bash
npm test
```

Expected: 288 → 291 tests pass (288 existing + 3 new). Zero failures.

- [ ] **Step 13: Commit**

```bash
git add src/commands/web-rollup.js src/commands/report.js src/report/html.js test/web-rollup.test.js test/report-html.test.js
git commit -m "feat(rollup): plumb siteFullName through web-rollup → report → writeHtml"
```

---

## Task 3: Refactor `renderCard` to use `siteFullName` + export it for testing (TDD)

**Files:**
- Modify: `src/web/index-page.js` (lines 196-264 — `renderCard` function)
- Test: `test/index-page.test.js` (new file)

- [ ] **Step 1: Create the new test file `test/index-page.test.js`**

```javascript
import { describe, it, expect } from "vitest";
import { renderCard } from "../src/web/index-page.js";

const baseSr = {
  site: {
    name: "dvfr-strapi-prod",
    siteName: "DVFR",
    siteFullName: "Domestic Violence Fatality Review",
    siteUrl: "https://dvfr.illinois.gov/",
    host: "1.2.3.4",
  },
  summary: {
    totalFiles: 102, remediable: 69, totalBytes: 38_000_000,
    byCategory: { pdf: 63, "office-document": 6, image: 33 },
  },
  htmlFile: "dvfr-2026.html",
  csvFile: "dvfr-2026.csv",
  scannedAt: "2026-05-11T14:00:00.000Z",
  header: { metadata: { serverIp: "1.2.3.4" } },
};

describe("renderCard", () => {
  it("uses siteFullName as the card title when provided", () => {
    const html = renderCard(baseSr);
    expect(html).toContain("Domestic Violence Fatality Review");
  });

  it("renders the nickname as a small uppercase label", () => {
    const html = renderCard(baseSr);
    // Class name comes from the new anatomy (Task 3 markup).
    expect(html).toMatch(/class="[^"]*\bnickname\b[^"]*"[^>]*>DVFR</);
  });

  it("falls back to siteName when siteFullName is missing", () => {
    const sr = { ...baseSr, site: { ...baseSr.site, siteFullName: undefined } };
    const html = renderCard(sr);
    expect(html).toContain(">DVFR<");
  });

  it("renders both total and audit numbers in two-up tiles", () => {
    const html = renderCard(baseSr);
    expect(html).toMatch(/<span class="num">102<\/span>/);
    expect(html).toMatch(/<span class="num">69<\/span>/);
  });

  it("emits a donut element with inline --pct custom property", () => {
    const html = renderCard(baseSr);
    // 69/102 = 67.6%
    expect(html).toMatch(/class="donut"[^>]*style="--pct:67\.6%/);
  });

  it("renders a plain-English donut caption", () => {
    const html = renderCard(baseSr);
    // "Two-thirds need audit" at 67.6%
    expect(html).toMatch(/need audit/i);
  });

  it("zero-files edge case renders 0/0 tiles and 0% donut", () => {
    const sr = { ...baseSr, summary: { totalFiles: 0, remediable: 0, totalBytes: 0, byCategory: {} } };
    const html = renderCard(sr);
    expect(html).toMatch(/<span class="num">0<\/span>/);
    expect(html).toMatch(/--pct:0%/);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
npx vitest run test/index-page.test.js
```

Expected: import error — `renderCard` is not exported yet.

- [ ] **Step 3: Export `renderCard` from `src/web/index-page.js`**

Change line 196:

```javascript
// before
function renderCard(sr) {
```

to:

```javascript
// after
export function renderCard(sr) {
```

- [ ] **Step 4: Rerun the tests to confirm FAIL on the assertions, not on the import**

```bash
npx vitest run test/index-page.test.js
```

Expected: the import works; most assertions still fail because the markup is the old structure.

- [ ] **Step 5: Replace the body of `renderCard` with the new card markup**

In `src/web/index-page.js`, replace the entire `renderCard` function body (lines 196-264) with this — read the new function in full and paste:

```javascript
export function renderCard(sr) {
  const { site, summary, htmlFile, csvFile, scannedAt } = sr;
  const nickname = he(site.siteName ?? site.name ?? "");
  const fullName = he(site.siteFullName ?? site.siteName ?? site.name ?? "");
  const hostname = he(site.host ?? "");
  const ip = he(sr.header?.metadata?.serverIp ?? site.host ?? "");

  const siteUrlRaw = site.siteUrl ?? site.publicUrlBase ?? sr.header?.metadata?.publicUrlBase ?? "";
  const publicUrlBaseRaw = siteUrlRaw;
  const publicUrlBase = he(siteUrlRaw);

  const totalFiles = summary?.totalFiles ?? 0;
  const remediable = summary?.remediable ?? 0;
  const nonRemediable = totalFiles - remediable;
  const totalBytes = summary?.totalBytes ?? 0;
  const byCategory = summary?.byCategory ?? {};

  const pdfCount = byCategory["pdf"] ?? 0;
  const officeCount =
    (byCategory["office-document"] ?? 0) +
    (byCategory["spreadsheet"] ?? 0) +
    (byCategory["presentation"] ?? 0) +
    (byCategory["office-legacy"] ?? 0) +
    (byCategory["legacy-office"] ?? 0);
  const imageCount = byCategory["image"] ?? 0;

  // Audit-share percentage — rounded to 1 decimal so the conic-gradient is
  // smooth but the percent badge in the donut stays short.
  const pctRaw = totalFiles > 0 ? (remediable / totalFiles) * 100 : 0;
  const pct = Math.round(pctRaw * 10) / 10;
  const pctInt = Math.round(pctRaw);

  // Plain-English caption rounded to colloquial buckets so a manager
  // doesn't have to read a percentage to grasp the share.
  let phrase;
  if (totalFiles === 0)             phrase = "No files inventoried";
  else if (pctInt === 0)            phrase = "No files need audit";
  else if (pctInt <= 12)            phrase = "A small share need audit";
  else if (pctInt <= 28)            phrase = "About a quarter need audit";
  else if (pctInt <= 42)            phrase = "About a third need audit";
  else if (pctInt <= 58)            phrase = "About half need audit";
  else if (pctInt <= 72)            phrase = "Two-thirds need audit";
  else if (pctInt <= 88)            phrase = "Most need audit";
  else                              phrase = "Nearly all need audit";

  const chipsHtml = [
    pdfCount   > 0 ? `<span class="chip chip-pdf"><svg class="ico"><use href="#i-file"/></svg>${pdfCount.toLocaleString()} PDF${pdfCount !== 1 ? "s" : ""}</span>` : "",
    officeCount > 0 ? `<span class="chip chip-doc"><svg class="ico"><use href="#i-file"/></svg>${officeCount.toLocaleString()} Office</span>` : "",
    imageCount > 0 ? `<span class="chip chip-img"><svg class="ico"><use href="#i-img"/></svg>${imageCount.toLocaleString()} image${imageCount !== 1 ? "s" : ""}</span>` : "",
  ].filter(Boolean).join("");

  const scanMeta = `${he(humanBytes(totalBytes))} &middot; scanned ${he(fmtDate(scannedAt))}`;

  const hasTechDetails = hostname || (ip && ip !== hostname);
  const techDetailsHtml = hasTechDetails
    ? `<details class="tech-details">
    <summary>Technical details</summary>
    ${hostname ? `<p class="hostname">${hostname}</p>` : ""}
    ${ip && ip !== hostname ? `<p class="ip">${ip}</p>` : ""}
  </details>`
    : "";

  return `<article class="site-card">
  <header class="card-head">
    <p class="nickname">${nickname}</p>
    <h3 class="full-name">${fullName}</h3>
    ${publicUrlBaseRaw ? `<p class="site-url"><a href="${publicUrlBase}" target="_blank" rel="noopener noreferrer">${publicUrlBase}</a></p>` : ""}
  </header>
  <div class="nums">
    <div class="tile total"><span class="num">${he(totalFiles.toLocaleString())}</span><span class="lbl">total files</span></div>
    <div class="tile audit"><span class="num">${he(remediable.toLocaleString())}</span><span class="lbl">need audit</span></div>
  </div>
  <div class="donut-row">
    <div class="donut" style="--pct:${pct}%"><div class="pct">${pctInt}%<small>need audit</small></div></div>
    <div class="donut-caption"><strong>${he(phrase)}</strong><span>${he(remediable.toLocaleString())} of ${he(totalFiles.toLocaleString())} files</span></div>
  </div>
  ${chipsHtml ? `<div class="chips">${chipsHtml}</div>` : ""}
  <p class="scan-meta">${scanMeta}</p>
  ${techDetailsHtml}
  <div class="actions">
    <a href="${he(htmlFile)}" class="btn btn-primary">View detailed report &rarr;</a>
    <a href="${he(csvFile)}" class="btn btn-secondary" download>Download spreadsheet</a>
  </div>
</article>`;
}
```

(Note: `he` and `humanBytes` and `fmtDate` are already imported / defined at the top of `index-page.js` — no new imports needed.)

- [ ] **Step 6: Add the SVG symbol definitions to `generateIndexHtml` so `<use href="#i-file">` resolves**

In `generateIndexHtml` (around line 275), inside the returned HTML document just after the opening `<body>` tag, add this once-per-page SVG `<defs>` block. Find the existing `<body>` element start (search `<body` in the function) and add immediately after:

```html
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <symbol id="i-file" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></symbol>
    <symbol id="i-img"  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.6"/><polyline points="21 15 16 10 5 21"/></symbol>
  </defs>
</svg>
```

- [ ] **Step 7: Run `test/index-page.test.js` — verify all assertions PASS**

```bash
npx vitest run test/index-page.test.js
```

Expected: 7 passing tests.

- [ ] **Step 8: Run the full test suite — verify nothing broke**

```bash
npm test
```

Expected: 291 → 298 tests pass (3 from Task 2 + 7 from Task 3).

- [ ] **Step 9: Commit**

```bash
git add src/web/index-page.js test/index-page.test.js
git commit -m "feat(index-page): rewrite renderCard with infographic anatomy + export for tests"
```

---

## Task 4: Replace the per-site detail-page header with the new V1 hero block

**Files:**
- Modify: `src/report/html.js` (around lines 718-770 — replace the `<h1>filecap inventory report</h1>` + meta-grid block)
- Test: `test/report-html.test.js` (extend the Task 2 tests)

- [ ] **Step 1: Read the current header block in `src/report/html.js`**

Run:

```bash
sed -n '710,790p' /Volumes/satechi/webdev/filecap-cli/src/report/html.js
```

Identify the `<h1>` line (~718) and the surrounding meta-grid / summary-bar block (~751+). Keep the meta-grid (it has useful "scanned at" / "scanned path" / "filecap version" rows for auditors); only the title block above it changes.

- [ ] **Step 2: Add a snapshot-style test for the new hero markup to `test/report-html.test.js`**

Append after the `siteFullName` tests added in Task 2:

```javascript
it("renders the new hero block with two-up tiles + donut row", async () => {
  const outputPath = path.join(tmpDir, "out.html");
  await writeHtml({
    sourceHeader: { ...sampleHeader, metadata: { ...sampleHeader.metadata, siteName: "DVFR" } },
    entries: sampleEntries,
    sources: null,
    outputPath,
    siteFullName: "Domestic Violence Fatality Review",
  });
  const html = await fs.readFile(outputPath, "utf8");
  // Two-up tiles
  expect(html).toMatch(/<div class="dp-tile dp-total">[\s\S]*<span class="dp-num">2<\/span>/);
  expect(html).toMatch(/<div class="dp-tile dp-audit">[\s\S]*<span class="dp-num">2<\/span>/);
  // Donut on its own row with --pct custom property
  expect(html).toMatch(/<div class="dp-donut"[^>]*style="--pct:100%/); // 2/2 = 100%
  // Plain-English caption present
  expect(html).toMatch(/dp-donut-caption/);
});
```

(The `sampleEntries` fixture has 2 entries, both `remediable: true` → 2 total / 2 audit / 100%. If a different fixture is more convenient, adapt the numerics in the assertions — the structural assertions are what matter.)

- [ ] **Step 3: Run to verify FAIL**

```bash
npx vitest run test/report-html.test.js -t "hero block"
```

Expected: 1 failing test (class names `dp-tile`, `dp-num`, `dp-donut`, `dp-donut-caption` don't exist yet).

- [ ] **Step 4: Replace the `<h1>` block in `src/report/html.js`**

Find the existing line (around line 718):

```html
<h1>${htmlEscape(siteFullName ?? siteName ?? "filecap inventory report")}</h1>
```

Replace with the new V1 hero block. Insert immediately above the existing meta-grid (which stays as-is):

```javascript
// Compute hero numbers from the existing summary-bar inputs.
// (`stats` is already in scope here from the existing summary computation
// further up in this function. If the variable name is different, adapt.)
const heroTotal = stats.totalFiles ?? 0;
const heroAudit = stats.remediable ?? 0;
const heroPctRaw = heroTotal > 0 ? (heroAudit / heroTotal) * 100 : 0;
const heroPct = Math.round(heroPctRaw * 10) / 10;
const heroPctInt = Math.round(heroPctRaw);
let heroPhrase;
if (heroTotal === 0)        heroPhrase = "No files inventoried";
else if (heroPctInt === 0)  heroPhrase = "No files need audit";
else if (heroPctInt <= 12)  heroPhrase = "A small share need audit";
else if (heroPctInt <= 28)  heroPhrase = "About a quarter need audit";
else if (heroPctInt <= 42)  heroPhrase = "About a third need audit";
else if (heroPctInt <= 58)  heroPhrase = "About half need audit";
else if (heroPctInt <= 72)  heroPhrase = "Two-thirds need audit";
else if (heroPctInt <= 88)  heroPhrase = "Most need audit";
else                        heroPhrase = "Nearly all need audit";

const heroTitle = htmlEscape(siteFullName ?? siteName ?? "filecap inventory report");
const heroNick  = htmlEscape(siteName ?? "");

const heroHtml = `
<header class="dp-hero">
  ${heroNick ? `<p class="dp-nickname">${heroNick}</p>` : ""}
  <h1 class="dp-title">${heroTitle}</h1>
  <div class="dp-nums">
    <div class="dp-tile dp-total"><span class="dp-num">${heroTotal.toLocaleString()}</span><span class="dp-lbl">total files</span></div>
    <div class="dp-tile dp-audit"><span class="dp-num">${heroAudit.toLocaleString()}</span><span class="dp-lbl">need audit</span></div>
  </div>
  <div class="dp-donut-row">
    <div class="dp-donut" style="--pct:${heroPct}%"><div class="dp-pct">${heroPctInt}%<small>need audit</small></div></div>
    <p class="dp-donut-caption"><strong>${heroPhrase}</strong> &middot; ${heroAudit.toLocaleString()} of ${heroTotal.toLocaleString()} files</p>
  </div>
</header>
`;
```

Then in the returned template literal, replace the old `<h1>...</h1>` with `${heroHtml}` (sitting above the existing meta-grid).

Verify locally that `stats.totalFiles` and `stats.remediable` are valid references. If the existing summary computation uses different names (e.g., `summary.totalFiles`), adapt the variable names — Step 6 here is "read the current variable names, don't guess".

- [ ] **Step 5: Run the hero-block test — verify PASS**

```bash
npx vitest run test/report-html.test.js -t "hero block"
```

Expected: 1 passing test.

- [ ] **Step 6: Run the full `report-html` suite**

```bash
npx vitest run test/report-html.test.js
```

Expected: all pass. If a snapshot test references the old `<h1>filecap inventory report</h1>` text and now fails, update the test expectation (this is the planned visible change).

- [ ] **Step 7: Commit**

```bash
git add src/report/html.js test/report-html.test.js
git commit -m "feat(detail-page): replace top h1 with two-up + donut hero block"
```

---

## Task 5: Add CSS for the new card anatomy in `src/web/index-page.js`

**Files:**
- Modify: `src/web/index-page.js` (the embedded `<style>` block — search for `.site-card` to find it)

This task is visual styling. No TDD; verification is via running `web-rollup` and viewing in the browser. Make a single commit per logical block of CSS so reverting is easy.

- [ ] **Step 1: Locate the existing `.site-card` CSS rules**

Run:

```bash
grep -n "\.site-card\|\.site-url\|\.big-stat\|\.remediation-summary\|\.actions\|\.btn-primary\|\.btn-secondary" /Volumes/satechi/webdev/filecap-cli/src/web/index-page.js | head -30
```

Note the line ranges (probably one contiguous block ~lines 370-540 based on the earlier survey).

- [ ] **Step 2: Replace the existing card CSS block**

Find the existing `.site-card { ... }` ruleset and following sibling rules (`.site-card header`, `.big-stat`, `.remediation-summary`, etc.). Replace with this new block. Keep the rest of the embedded stylesheet (page-level rules, hero summary, etc.) untouched.

```css
/* ─── Site-card anatomy v1.7.0 ─── */
.site-card {
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #18202b 0%, #141a23 100%);
  border: 1px solid var(--fc-border-subtle, #2a323d);
  border-radius: 22px;
  padding: 28px 26px 24px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.32);
  min-height: 540px;
  color: var(--fc-text-primary, #e5e5e5);
}
.site-card .card-head { text-align: center; margin-bottom: 18px; }
.site-card .nickname {
  font-size: 0.82em;
  font-weight: 800;
  color: var(--fc-nickname, #c0cdda);  /* ≥ 7:1 on card bg — AA-AAA */
  letter-spacing: 0.10em;
  text-transform: uppercase;
  margin: 0 0 6px;
}
.site-card .full-name {
  font-size: 1.55em;
  font-weight: 800;
  line-height: 1.18;
  color: #ffffff;
  letter-spacing: -0.01em;
  margin: 0 auto;
  max-width: 28ch;
  min-height: 2.4em;             /* reserve 2 lines so single-line names still align */
  display: flex;
  align-items: center;
  justify-content: center;
}
.site-card .site-url {
  margin: 6px 0 0;
  font-size: 0.85em;
  color: var(--fc-text-muted, #788391);
}
.site-card .site-url a { color: var(--fc-accent, #4dabf7); text-decoration: none; }

.site-card .nums {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin: 0 0 18px;
}
.site-card .tile { padding: 18px 8px; border-radius: 14px; text-align: center; }
.site-card .tile.total { background: rgba(77, 171, 247, 0.10); }
.site-card .tile.audit { background: rgba(255, 168, 77, 0.13); }
.site-card .tile .num {
  font-size: 3.6em;
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  display: block;
}
.site-card .tile.total .num { color: #4dabf7; }
.site-card .tile.audit .num { color: #ffa84d; }
.site-card .tile .lbl {
  display: block;
  margin-top: 8px;
  font-size: 0.78em;
  color: var(--fc-text-muted, #9aa5b1);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.site-card .donut-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  margin: 6px 0 18px;
}
.site-card .donut {
  width: 130px; height: 130px;
  border-radius: 50%;
  background: conic-gradient(
    #ffa84d 0 calc(var(--pct, 0) * 1%),
    rgba(77, 171, 247, 0.45) calc(var(--pct, 0) * 1%) 100%
  );
  display: flex; align-items: center; justify-content: center;
  position: relative;
  flex: none;
}
.site-card .donut::after {
  content: "";
  position: absolute;
  inset: 14px;
  background: #141a23;
  border-radius: 50%;
}
.site-card .donut .pct {
  position: relative; z-index: 1;
  font-weight: 900;
  font-size: 1.5em;
  color: #ffa84d;
  line-height: 1;
}
.site-card .donut .pct small {
  display: block;
  font-size: 0.45em;
  color: #9aa5b1;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 4px;
}
.site-card .donut-caption { text-align: left; }
.site-card .donut-caption strong { display: block; color: #ffffff; font-size: 1em; }
.site-card .donut-caption span { color: #9aa5b1; font-size: 0.85em; }

.site-card .chips {
  display: flex; justify-content: center; flex-wrap: wrap;
  gap: 8px; margin: 0 0 12px;
}
.site-card .chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 11px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 999px;
  font-size: 0.88em;
  color: #d4dae0;
}
.site-card .chip .ico { width: 16px; height: 16px; flex: none; }
.site-card .chip-pdf .ico { color: #ff6b6b; }
.site-card .chip-doc .ico { color: #4dabf7; }
.site-card .chip-img .ico { color: #9aa5b1; }

.site-card .scan-meta {
  font-size: 0.82em;
  color: var(--fc-text-muted, #788391);
  margin: 6px 0 12px;
  text-align: center;
}

.site-card .tech-details { margin: 6px 0 12px; font-size: 0.82em; color: var(--fc-text-muted, #788391); }
.site-card .tech-details summary { cursor: pointer; }
.site-card .tech-details .hostname,
.site-card .tech-details .ip { margin: 4px 0 0; }

.site-card .actions {
  margin-top: auto;             /* pin to bottom of card */
  display: flex; flex-direction: column; gap: 10px;
}
.site-card .actions .btn {
  display: inline-block;
  padding: 16px 22px;
  border-radius: 14px;
  font-weight: 700;
  font-size: 1em;
  text-decoration: none;
  text-align: center;
}
.site-card .actions .btn-primary { background: #4dabf7; color: #0c1219; }
.site-card .actions .btn-secondary { background: transparent; color: #4dabf7; border: 1px solid #2a323d; }

/* 2-col grid: desktop 2-up, mobile 1-up */
.site-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 22px;
}
@media (max-width: 820px) {
  .site-grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 3: Confirm the grid container exists and uses the `.site-grid` class**

Search for the current grid container in the same file:

```bash
grep -n "site-grid\|cards-grid\|class=\"grid" /Volumes/satechi/webdev/filecap-cli/src/web/index-page.js | head -10
```

If the existing class name is different (e.g., `.cards-grid`), either rename it to `.site-grid` in both places or change the CSS selector above. Goal: cards render in a 2-col grid.

- [ ] **Step 4: Re-run renderCard tests to confirm markup still matches**

```bash
npx vitest run test/index-page.test.js test/web-rollup.test.js
```

Expected: all pass — CSS changes don't affect markup tests.

- [ ] **Step 5: Generate a local bundle and eyeball it**

```bash
node /Volumes/satechi/webdev/filecap-cli/bin/filecap.js web-rollup -o /tmp/filecap-preview
open /tmp/filecap-preview/index.html
```

Expected: index loads with 2-col grid of cards, big DVFR-style numbers + donuts, full names visible. Spot-check 2-3 cards for layout integrity and equal-height alignment.

- [ ] **Step 6: Commit**

```bash
git add src/web/index-page.js
git commit -m "feat(index-page): new card CSS — two-up tiles, donut, 2-col grid, big numbers"
```

---

## Task 6: Add CSS for the new detail-page hero in `src/report/html.js`

**Files:**
- Modify: `src/report/html.js` (the embedded `<style>` block)

- [ ] **Step 1: Locate the existing detail-page `<style>` block**

```bash
grep -n "<style>\|h1 {\|\.summary-bar\|\.meta-grid" /Volumes/satechi/webdev/filecap-cli/src/report/html.js | head -10
```

- [ ] **Step 2: Add the new `dp-*` hero rules to the style block**

Find a suitable insertion point inside `<style>` (alphabetical / topical grouping, near the top-of-page rules). Add:

```css
/* ─── Detail-page hero block v1.7.0 ─── */
.dp-hero {
  margin: 0 0 28px;
  padding: 30px 32px 26px;
  background: linear-gradient(180deg, #18202b 0%, #141a23 100%);
  border: 1px solid #2a323d;
  border-radius: 22px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.32);
  color: #e5e5e5;
}
.dp-hero .dp-nickname {
  margin: 0 0 6px;
  font-size: 0.82em;
  font-weight: 800;
  color: #c0cdda;
  letter-spacing: 0.10em;
  text-transform: uppercase;
}
.dp-hero .dp-title {
  margin: 0 0 22px;
  font-size: 2.6em;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: #ffffff;
  line-height: 1.12;
}
.dp-hero .dp-nums {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin: 0 0 22px;
}
.dp-hero .dp-tile {
  padding: 22px 14px;
  border-radius: 16px;
  text-align: center;
}
.dp-hero .dp-tile.dp-total { background: rgba(77, 171, 247, 0.10); }
.dp-hero .dp-tile.dp-audit { background: rgba(255, 168, 77, 0.13); }
.dp-hero .dp-tile .dp-num {
  font-size: 4em;
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  display: block;
}
.dp-hero .dp-tile.dp-total .dp-num { color: #4dabf7; }
.dp-hero .dp-tile.dp-audit .dp-num { color: #ffa84d; }
.dp-hero .dp-tile .dp-lbl {
  display: block;
  margin-top: 8px;
  font-size: 0.82em;
  color: #9aa5b1;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.dp-hero .dp-donut-row {
  display: flex; align-items: center; justify-content: center;
  gap: 22px;
}
.dp-hero .dp-donut {
  width: 150px; height: 150px;
  border-radius: 50%;
  background: conic-gradient(
    #ffa84d 0 calc(var(--pct, 0) * 1%),
    rgba(77, 171, 247, 0.45) calc(var(--pct, 0) * 1%) 100%
  );
  display: flex; align-items: center; justify-content: center;
  position: relative;
  flex: none;
}
.dp-hero .dp-donut::after {
  content: "";
  position: absolute;
  inset: 16px;
  background: #141a23;
  border-radius: 50%;
}
.dp-hero .dp-donut .dp-pct {
  position: relative; z-index: 1;
  font-weight: 900;
  font-size: 1.7em;
  color: #ffa84d;
  line-height: 1;
  text-align: center;
}
.dp-hero .dp-donut .dp-pct small {
  display: block;
  font-size: 0.42em;
  color: #9aa5b1;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 4px;
}
.dp-hero .dp-donut-caption {
  margin: 0;
  color: #9aa5b1;
  font-size: 1em;
}
.dp-hero .dp-donut-caption strong { color: #ffffff; }

@media (max-width: 720px) {
  .dp-hero .dp-nums { grid-template-columns: 1fr; }
  .dp-hero .dp-tile .dp-num { font-size: 3em; }
  .dp-hero .dp-donut-row { flex-direction: column; }
  .dp-hero .dp-title { font-size: 2em; }
}
```

- [ ] **Step 3: Re-run detail-page tests to confirm markup tests still pass**

```bash
npx vitest run test/report-html.test.js
```

Expected: all pass.

- [ ] **Step 4: Eyeball a per-site report**

```bash
node /Volumes/satechi/webdev/filecap-cli/bin/filecap.js web-rollup -o /tmp/filecap-preview
open /tmp/filecap-preview/dvfr-*.html
```

Expected: detail page opens with big "Domestic Violence Fatality Review" title, two-up tiles, donut on its own row, then the existing meta-grid + filters + file table below — unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/report/html.js
git commit -m "feat(detail-page): hero block CSS — two-up tiles, donut, plain-English caption"
```

---

## Task 7: Add the new design tokens to `src/web/styles.js`

**Files:**
- Modify: `src/web/styles.js` (lines ~28-72)

The token additions document the palette in one canonical place. The CSS already uses literals in Tasks 5 and 6 — this step makes them themable in a future iteration without touching markup.

- [ ] **Step 1: Add new fields to the `DESIGN_TOKENS` export**

In `src/web/styles.js`, find the `export const DESIGN_TOKENS = { ... };` object and add these fields just before the closing brace:

```javascript
  // v1.7.0 — manager-friendly rollup redesign
  total:         "#4dabf7",   // blue — "scope" / total-files hero
  audit:         "#ffa84d",   // amber — "workload" / files-need-audit hero
  totalTileBg:   "rgba(77, 171, 247, 0.10)",
  auditTileBg:   "rgba(255, 168, 77, 0.13)",
  nickname:      "#c0cdda",   // ≥ 7:1 on card bg — WCAG AAA at small sizes
  cardBgTop:     "#18202b",
  cardBgBot:     "#141a23",
  ctaBg:         "#4dabf7",
  ctaFg:         "#0c1219",
```

- [ ] **Step 2: Add matching CSS custom properties in `darkModeCss()`**

Inside the `:root { ... }` declaration emitted by `darkModeCss()`, add:

```javascript
  --fc-total:           ${DESIGN_TOKENS.total};
  --fc-audit:           ${DESIGN_TOKENS.audit};
  --fc-total-tile-bg:   ${DESIGN_TOKENS.totalTileBg};
  --fc-audit-tile-bg:   ${DESIGN_TOKENS.auditTileBg};
  --fc-nickname:        ${DESIGN_TOKENS.nickname};
  --fc-card-bg-top:     ${DESIGN_TOKENS.cardBgTop};
  --fc-card-bg-bot:     ${DESIGN_TOKENS.cardBgBot};
  --fc-cta-bg:          ${DESIGN_TOKENS.ctaBg};
  --fc-cta-fg:          ${DESIGN_TOKENS.ctaFg};
```

- [ ] **Step 3: Run any tests that touch styles.js**

```bash
grep -l "styles.js\|DESIGN_TOKENS\|darkModeCss" /Volumes/satechi/webdev/filecap-cli/test/*.js
npm test
```

Expected: all tests pass. If no existing test imports `styles.js` directly, that's fine — the tokens are picked up transparently by the embedded CSS that uses `var(--fc-…)`.

- [ ] **Step 4: Commit**

```bash
git add src/web/styles.js
git commit -m "feat(styles): document v1.7.0 design tokens (total/audit/nickname/cardBg/cta)"
```

---

## Task 8: Update `CHANGELOG.md` and bump `package.json` to `1.7.0`

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `package.json`

- [ ] **Step 1: Bump version in `package.json`**

Change line 3:

```json
"version": "1.6.7",
```

to:

```json
"version": "1.7.0",
```

- [ ] **Step 2: Add the `[1.7.0]` entry to `CHANGELOG.md`** above the existing `[1.6.7]` heading:

```markdown
## [1.7.0] — 2026-05-11

### Added

- **Optional `siteFullName` field in `~/.filecap/sites.json`.** Each site can now declare a verbose human name alongside its short nickname (`siteName`). The full name flows through `web-rollup → report → writeHtml` and is rendered as the card title on the fleet index and the H1 on the per-site detail page. Sites without `siteFullName` cleanly fall back to `siteName` — zero-config compatibility for existing fleets.
- **Manager-friendly card anatomy on the fleet index.** Each site card now leads with the full name (large, bold) and a small uppercase nickname above it (`#c0cdda`, weight 800 — comfortably above WCAG AA 2.1 contrast at small sizes). Below the title: a two-up "tile" pair — total files (blue, `#4dabf7`) and files needing audit (amber, `#ffa84d`) — with the numbers blown up to ~3.6em weight 900. Below the tiles, a CSS-only donut (conic-gradient + `::after` mask, no SVG/JS) shows the audit-share percentage in the centre, accompanied by a plain-English caption ("Two-thirds need audit · 69 of 102 files") so a manager grasps the share without reading a chart. A row of file-type chips (PDFs / Office / images) sits below the donut, with a meta strip ("38 MB · scanned May 11") and the large CTA pinned to the bottom of every card via `margin-top: auto`. Equal-height alignment across the row is guaranteed by reserving fixed vertical slots for every block.
- **Same hero pattern on the per-site detail page.** A new `.dp-hero` block at the top of each `<site>.html` mirrors the index card: nickname + big full name + two-up tiles + donut on its own row + plain-English caption. Numbers go a notch bigger here (~4em) because the page is wider than a card. The existing meta-grid, filter chips, row-marker legend, "image-only PDFs need OCR" chip, CSV download button, and file table all sit below — **unchanged**.
- **Donut chart is pure CSS** (`conic-gradient` ramp + `::after` mask). No SVG, no chart library, no JavaScript dependency. Renders identically online and offline.

### Changed

- **Card grid switches from 3-col to 2-col at desktop** (and collapses to 1-col below 820 px viewport). Each card gets significantly more horizontal room, which is what lets the hero numbers scale up and the donut sit on its own row.
- **Design tokens added to `src/web/styles.js`** for the new palette: `total` (#4dabf7), `audit` (#ffa84d), `totalTileBg`, `auditTileBg`, `nickname` (#c0cdda), `cardBgTop` / `cardBgBot`, `ctaBg`, `ctaFg`. Emitted as `--fc-*` CSS custom properties from `darkModeCss()`.
- **`renderCard` is now exported** from `src/web/index-page.js` so it can be unit-tested directly. Was previously a local helper.

[1.7.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.0
```

- [ ] **Step 3: Run the full test suite to make sure everything is still green before the release commit**

```bash
npm test
```

Expected: all tests pass (291 + 7 new from Task 3 + 1 new from Task 4 = 299 total, give or take).

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md package.json
git commit -m "v1.7.0: manager-friendly rollup — siteFullName + two-up + donut + 2-col grid"
```

---

## Task 9: Tag `v1.7.0` and push to `origin`

**Files:**
- No file changes — git tag + push.

- [ ] **Step 1: Tag the release**

```bash
git tag v1.7.0
```

Expected: no output (silent success).

- [ ] **Step 2: Push commits + tag**

```bash
git push origin main --follow-tags
```

Expected: `main → main` + `[new tag] v1.7.0 → v1.7.0` in the output.

- [ ] **Step 3: Verify the tag exists on the remote**

```bash
git ls-remote --tags origin | grep v1.7.0
```

Expected: one line with the v1.7.0 SHA + `refs/tags/v1.7.0`.

---

## Task 10: Re-run `web-rollup` against `~/.filecap/sites.json` and deploy to Netlify

**Files:**
- None modified. This is a runtime build + deploy.

- [ ] **Step 1: Rebuild bundle and deploy via the existing `--deploy` flag**

```bash
node /Volumes/satechi/webdev/filecap-cli/bin/filecap.js web-rollup --deploy --deploy-site 9a079a16-be6d-4ccd-8f2b-074444baef39
```

Expected: bundle written under `~/filecap-audits/_web-rollup/2026-…/`, Netlify CLI uploads, deploy goes live. Final lines include `✔ Deploy is live!` and `Production URL: https://icjia-fleet-audit.netlify.app`.

- [ ] **Step 2: Verify the production page**

Open https://icjia-fleet-audit.netlify.app in a browser. Confirm:

- Cards display full site names (e.g., "Domestic Violence Fatality Review" instead of just "DVFR").
- Numbers are big and color-coded (blue total, amber audit).
- Donut renders with percentage in the center.
- 2-col grid on desktop, 1-col on mobile (resize the window to check).
- Click into a per-site report — the new hero block appears at the top; the file table below is unchanged.

- [ ] **Step 3: WCAG AA 2.1 spot-check via the `axecap` / `contrastcap` MCP**

Run an accessibility audit against the live URL:

```
mcp__axecap__audit_url url=https://icjia-fleet-audit.netlify.app
mcp__contrastcap__check_page_contrast url=https://icjia-fleet-audit.netlify.app
```

Expected: zero serious / critical violations on the nickname text (the contrast we explicitly engineered for). Any pre-existing violations unrelated to this redesign get flagged as out-of-scope.

- [ ] **Step 4: Capture a before/after screenshot of one site card (DVFR) for the design retrospective**

```
mcp__viewcap__take_screenshot url=https://icjia-fleet-audit.netlify.app selector=".site-card" filename=2026-05-11-v1.7.0-dvfr-card.png
```

(Optional but useful for the next review session.)

---

## Self-Review

This section is the final gate before the plan ships. Run through each item below in order.

### Spec coverage check

| Spec decision | Task(s) implementing it |
|---|---|
| D1 — `siteFullName` field with fallback | Task 1 (data), Task 2 (plumbing), Task 3 (card title), Task 4 (detail-page title) |
| D2 — two-up hero (total + audit, color-coded) | Task 3 (markup), Task 5 (CSS); Task 4 + 6 for detail page |
| D3 — donut + plain-English caption | Task 3 (markup + phrase logic), Task 4 (detail-page), Task 5/6 (CSS) |
| D4 — 2-col grid, 1-col mobile | Task 5 (CSS @media query) |
| D5 — donut on its own row → bigger numbers | Task 5 / 6 (CSS: `donut-row` separate from `nums`; `num` font-size 3.6em / 4em) |
| D6 — nickname WCAG AA contrast | Task 5 (`.nickname { color: #c0cdda; font-weight: 800; }`); Task 7 (token); Task 10 (axecap verification) |
| D7 — detail-page Variant 1 hero | Task 4 (markup), Task 6 (CSS) |
| D8 — "won't read" not "can't" (no scope change) | Reflected in design choices; no specific task |

### Placeholder scan

Search the plan for any TBD / TODO / "implement appropriately" / "similar to Task N":

```bash
grep -nE "TBD|TODO|FIXME|XXX|similar to Task|add appropriate|fill in" /Volumes/satechi/webdev/filecap-cli/docs/superpowers/plans/2026-05-11-manager-friendly-rollup-redesign.md || echo "clean"
```

Expected: `clean`.

### Type-consistency check

- `renderCard(sr)` — `sr.site` shape consistent across plan: `name`, `siteName`, `siteFullName?`, `siteUrl?`, `host?`. Task 3 test fixture uses this exact shape.
- `writeHtml({ ..., siteFullName })` — same param name in Task 2 and Task 4.
- `runReport({ ..., siteFullName })` — Task 2.
- CSS class names — `.tile`, `.tile.total`, `.tile.audit`, `.num`, `.lbl`, `.donut`, `.pct`, `.donut-row`, `.donut-caption`, `.chip`, `.chips`, `.chip-pdf` / `.chip-doc` / `.chip-img`, `.nickname`, `.full-name`, `.site-card`, `.site-grid`. All used consistently between Task 3 (markup) and Task 5 (CSS).
- Detail-page CSS class names — `.dp-hero`, `.dp-nickname`, `.dp-title`, `.dp-nums`, `.dp-tile`, `.dp-tile.dp-total` / `dp-audit`, `.dp-num`, `.dp-lbl`, `.dp-donut-row`, `.dp-donut`, `.dp-pct`, `.dp-donut-caption`. Used consistently between Task 4 and Task 6.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-11-manager-friendly-rollup-redesign.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan because tasks are well-scoped and have explicit TDD checkpoints.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints for review. Best if you'd rather watch the diffs live.

**Which approach?**
