# CMS-hosted (cross-site) files in the per-site Page view — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the per-site Page view (HTML + XLSX Pages tab) show, for each page, the CMS/Strapi-hosted files it links that live in another fleet site's inventory — as a separate "hosted on another site" group that links to the owning site's bundle page.

**Architecture:** `buildPageList` stays the pure local transpose. Two new pure functions in `pages.js` (`parsePageRefFiles`, `attachCrossSiteFiles`) add the cross-site decoration, fed by a fleet-wide URL→owner index that `web-rollup` builds in a pre-pass (`buildFleetFileIndex`) and exposes as a `resolveFleetFile(url)` resolver. The standalone `report` command passes no fleet data, so it is unchanged.

**Tech Stack:** Node ESM, Vitest, ExcelJS (XLSX). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-16-cms-hosted-files-page-view-design.md`

---

## File structure

- `src/report/pages.js` — add `parsePageRefFiles`, `attachCrossSiteFiles` (+ two tiny URL helpers). Pure, unit-tested.
- `src/references/cross-resolver.js` — export the existing `canonicalizeForFleet` (currently module-private) so web-rollup can key/lookup consistently with the cross-ref step.
- `src/commands/web-rollup.js` — add `latestInventoryPath` + `buildFleetFileIndex` helpers; build the resolver in a pre-pass; thread `resolveFleetFile` / `pageRefFiles` / `currentSiteName` into the HTML path and apply them to the XLSX Pages tab.
- `src/commands/report.js` — thread the three new optional params through `runReport` → `writeHtml`.
- `src/report/html.js` — apply `attachCrossSiteFiles` after `buildPageList`; render the cross-site group in `buildPageFilesCell`; CSS + legend note.
- `test/report-pages.test.js` — unit tests for the two new pure functions.
- `test/web-rollup.test.js` — unit test for `buildFleetFileIndex` + an end-to-end two-site test.
- `package.json`, `CHANGELOG.md` — version bump to 1.32.0 + entry.

---

## Task 1: `parsePageRefFiles` (sidecar → page→files map)

**Files:**
- Modify: `src/report/pages.js`
- Test: `test/report-pages.test.js`

- [ ] **Step 1: Write the failing test**

Add to `test/report-pages.test.js` (and add `parsePageRefFiles` to the existing import on line 2: `import { buildPageList, parseCmsPageList, parsePageRefFiles, attachCrossSiteFiles } from "../src/report/pages.js";`):

```js
describe("parsePageRefFiles", () => {
  it("returns an empty map for empty / non-string input", () => {
    expect(parsePageRefFiles("").size).toBe(0);
    expect(parsePageRefFiles(undefined).size).toBe(0);
  });

  it("maps normalized page URL → its referenced file URLs", () => {
    const ndjson = [
      JSON.stringify({ pageUrl: "https://x/research", referencedFiles: ["https://cms/a.docx", "https://x/b.pdf"] }),
    ].join("\n");
    const m = parsePageRefFiles(ndjson);
    expect(m.get("https://x/research")).toEqual(["https://cms/a.docx", "https://x/b.pdf"]);
  });

  it("merges + dedupes files across records that share a normalized page URL", () => {
    const ndjson = [
      JSON.stringify({ pageUrl: "https://x/Research/", referencedFiles: ["https://cms/a.docx"] }),
      JSON.stringify({ pageUrl: "https://x/research", referencedFiles: ["https://cms/a.docx", "https://x/b.pdf"] }),
    ].join("\n");
    const m = parsePageRefFiles(ndjson);
    expect(m.get("https://x/research")).toEqual(["https://cms/a.docx", "https://x/b.pdf"]);
  });

  it("skips records with no pageUrl, no files, or malformed JSON", () => {
    const ndjson = [
      "{not json",
      JSON.stringify({ pageUrl: "", referencedFiles: ["https://cms/a.docx"] }),
      JSON.stringify({ pageUrl: "https://x/p", referencedFiles: [] }),
      JSON.stringify({ pageUrl: "https://x/q" }),
    ].join("\n");
    const m = parsePageRefFiles(ndjson);
    expect(m.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/report-pages.test.js -t parsePageRefFiles`
Expected: FAIL — `parsePageRefFiles is not a function` (or import error).

- [ ] **Step 3: Implement `parsePageRefFiles`**

In `src/report/pages.js`, add after `parseCmsPageList` (end of file). It reuses the existing module-private `normPageUrl`:

```js
/**
 * Parse a references sidecar into a map of normalized page URL → the file URLs
 * that page links (each record's `referencedFiles`), merged across every record
 * that resolves to the same page (a page often has both a markdown and a
 * template record). Order-preserving, de-duplicated per page. Unlike
 * parseCmsPageList, this keeps the file URLs. Malformed lines are skipped.
 *
 * @param {string} ndjson
 * @returns {Map<string, string[]>}
 */
export function parsePageRefFiles(ndjson) {
  const out = new Map();
  if (typeof ndjson !== "string" || ndjson.trim() === "") return out;
  for (const line of ndjson.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const pageUrl = rec?.pageUrl;
    if (typeof pageUrl !== "string" || pageUrl === "") continue;
    const files = Array.isArray(rec?.referencedFiles) ? rec.referencedFiles : [];
    if (files.length === 0) continue;
    const key = normPageUrl(pageUrl);
    let bucket = out.get(key);
    if (!bucket) {
      bucket = [];
      out.set(key, bucket);
    }
    for (const f of files) {
      if (typeof f === "string" && f !== "" && !bucket.includes(f)) bucket.push(f);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/report-pages.test.js -t parsePageRefFiles`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/report/pages.js test/report-pages.test.js
git commit -m "feat: parsePageRefFiles — sidecar page URL to linked file URLs"
```

---

## Task 2: `attachCrossSiteFiles` (decorate pages with cross-site files)

**Files:**
- Modify: `src/report/pages.js`
- Test: `test/report-pages.test.js`

- [ ] **Step 1: Write the failing test**

Add to `test/report-pages.test.js`:

```js
describe("attachCrossSiteFiles", () => {
  // resolver: maps known URLs to a fleet owner; null otherwise.
  const resolveFleetFile = (url) => {
    if (url === "https://sfs.icjia.illinois.gov/q.pdf")
      return { siteName: "sfs-git", siteLabel: "SFS", filename: "q.pdf", detailHref: "sfs-1.html" };
    if (url === "https://agency.cms/uploads/proto_abc.docx")
      return { siteName: "agency", siteLabel: "ICJIA agency", filename: "proto_abc.docx", detailHref: "icjia-1.html" };
    return null;
  };

  it("adds cross-site files, skips files owned by the current site", () => {
    const pages = [{ pageUrl: "https://sfs.icjia.illinois.gov/research", files: [] }];
    const pageRefFiles = new Map([[
      "https://sfs.icjia.illinois.gov/research",
      ["https://sfs.icjia.illinois.gov/q.pdf", "https://agency.cms/uploads/proto_abc.docx"],
    ]]);
    attachCrossSiteFiles(pages, { pageRefFiles, resolveFleetFile, currentSiteName: "sfs-git" });
    expect(pages[0].crossSiteFiles).toEqual([
      { filename: "proto_abc.docx", siteLabel: "ICJIA agency", detailHref: "icjia-1.html" },
    ]);
  });

  it("falls back to host-only (no link) for URLs inventoried nowhere", () => {
    const pages = [{ pageUrl: "https://x/p", files: [] }];
    const pageRefFiles = new Map([["https://x/p", ["https://other.gov/files/report.pdf"]]]);
    attachCrossSiteFiles(pages, { pageRefFiles, resolveFleetFile, currentSiteName: "x" });
    expect(pages[0].crossSiteFiles).toEqual([
      { filename: "report.pdf", siteLabel: "other.gov", detailHref: null },
    ]);
  });

  it("sets an empty array on pages with no linked files and is a no-op without inputs", () => {
    const pages = [{ pageUrl: "https://x/p", files: [] }];
    attachCrossSiteFiles(pages, { pageRefFiles: new Map(), resolveFleetFile, currentSiteName: "x" });
    expect(pages[0].crossSiteFiles).toEqual([]);
    const pages2 = [{ pageUrl: "https://x/p", files: [] }];
    attachCrossSiteFiles(pages2);
    expect(pages2[0].crossSiteFiles).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/report-pages.test.js -t attachCrossSiteFiles`
Expected: FAIL — `attachCrossSiteFiles is not a function`.

- [ ] **Step 3: Implement `attachCrossSiteFiles` + URL helpers**

In `src/report/pages.js`, add the helpers near `normPageUrl` (top of file):

```js
function basenameFromUrl(u) {
  try {
    const p = new URL(u).pathname;
    return decodeURIComponent(p.split("/").filter(Boolean).pop() ?? "") || String(u);
  } catch {
    return String(u ?? "");
  }
}

function hostFromUrl(u) {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}
```

Add `attachCrossSiteFiles` after `buildPageList`:

```js
/**
 * Decorate each page row with the files it links that live in ANOTHER fleet
 * site's inventory (e.g. CMS/Strapi-hosted uploads). buildPageList attaches
 * only files from THIS site's inventory; the references sidecar records every
 * file a page links (including cross-site ones), so this fills in the rest.
 *
 * Each page gets `crossSiteFiles = [{ filename, siteLabel, detailHref|null }]`.
 * Files owned by `currentSiteName` are skipped (already shown as local files /
 * local dupes on the row). URLs that resolve to no fleet site fall back to
 * host-only text with no link. No cross-site dedup across pages — a file shows
 * on every page that links it.
 *
 * @param {Array} pages - output of buildPageList (mutated in place + returned)
 * @param {object} [opts]
 * @param {Map<string,string[]>} [opts.pageRefFiles] - normPageUrl → linked file URLs
 * @param {(fileUrl:string)=>({siteName:string,siteLabel:string,filename:string,detailHref:string|null}|null)} [opts.resolveFleetFile]
 * @param {string} [opts.currentSiteName]
 * @returns {Array} the same pages
 */
export function attachCrossSiteFiles(pages, { pageRefFiles, resolveFleetFile, currentSiteName } = {}) {
  const refs = pageRefFiles instanceof Map ? pageRefFiles : new Map();
  const resolve = typeof resolveFleetFile === "function" ? resolveFleetFile : () => null;
  for (const page of pages ?? []) {
    page.crossSiteFiles = [];
    const urls = refs.get(normPageUrl(page.pageUrl)) ?? [];
    const seen = new Set();
    for (const url of urls) {
      const owner = resolve(url);
      // Owned by this site → already shown as a local file/dupe on this row.
      if (owner && owner.siteName === currentSiteName) continue;
      const item = owner
        ? {
            filename: owner.filename || basenameFromUrl(url),
            siteLabel: owner.siteLabel || hostFromUrl(url),
            detailHref: owner.detailHref ?? null,
          }
        : { filename: basenameFromUrl(url), siteLabel: hostFromUrl(url), detailHref: null };
      const dedupeKey = `${item.siteLabel}:${item.filename}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      page.crossSiteFiles.push(item);
    }
  }
  return pages;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/report-pages.test.js -t attachCrossSiteFiles`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/report/pages.js test/report-pages.test.js
git commit -m "feat: attachCrossSiteFiles — decorate page rows with CMS-hosted files"
```

---

## Task 3: Fleet file index in web-rollup

**Files:**
- Modify: `src/references/cross-resolver.js:51` (export `canonicalizeForFleet`)
- Modify: `src/commands/web-rollup.js` (add `latestInventoryPath`, `buildFleetFileIndex`; new imports)
- Test: `test/web-rollup.test.js`

- [ ] **Step 1: Export `canonicalizeForFleet`**

In `src/references/cross-resolver.js`, change line 51 from:

```js
function canonicalizeForFleet(url, aliasMap) {
```

to:

```js
export function canonicalizeForFleet(url, aliasMap) {
```

- [ ] **Step 2: Add imports to web-rollup**

In `src/commands/web-rollup.js`, replace the pages import (line 13) and add a cross-resolver import beneath it:

```js
import { parseCmsPageList, buildPageList, parsePageRefFiles, attachCrossSiteFiles } from "../report/pages.js";
import { buildAliasMap, canonicalizeForFleet, entryCanonicalUrl } from "../references/cross-resolver.js";
```

- [ ] **Step 3: Write the failing test**

Add to `test/web-rollup.test.js`. It needs `buildFleetFileIndex` and `buildAliasMap` imported — add `buildFleetFileIndex` to the `../src/commands/web-rollup.js` import block (lines 6-20) and add `import { buildAliasMap } from "../src/references/cross-resolver.js";` near the top. Helper writes an inventory with a chosen serverName + entry path:

```js
async function writeInvWithEntry(filePath, { serverName, scannedAt, publicUrlBase, entryPath, filename }) {
  const header = JSON.stringify({
    schemaVersion: 1, kind: "filecap-inventory-header",
    metadata: { serverName, scannedAt, publicUrlBase },
  });
  const entry = JSON.stringify({ path: entryPath, filename, category: "office-document", remediable: true });
  const footer = JSON.stringify({ kind: "filecap-inventory-footer", entryCount: 1 });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, [header, entry, footer].join("\n") + "\n", "utf8");
}

describe("buildFleetFileIndex", () => {
  it("maps each entry's canonical URL → owning site, label, filename, detail href", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    await writeInvWithEntry(path.join(auditsBase, "agency", "latest", "inventory.ndjson"), {
      serverName: "agency", scannedAt: "2026-06-12T20:14:54.000Z",
      publicUrlBase: "https://agency.cms/uploads", entryPath: "proto_abc.docx", filename: "proto_abc.docx",
    });
    const sites = [{ name: "agency", siteName: "ICJIA agency", publicUrlBase: "https://agency.cms/uploads" }];
    const aliasMap = buildAliasMap({ sites });
    const index = await buildFleetFileIndex(sites, auditsBase, aliasMap);
    expect(index.get("https://agency.cms/uploads/proto_abc.docx")).toEqual({
      siteName: "agency",
      siteLabel: "ICJIA agency",
      filename: "proto_abc.docx",
      detailHref: "icjia-agency-20260612-201454Z.html",
    });
  });
});
```

(Note: `detailHref` uses `slug("ICJIA agency")` = `icjia-agency` and `formatScanTimestamp("2026-06-12T20:14:54.000Z")` = `20260612-201454Z`. If the slug/timestamp formatting differs, read the actual value from the failing assertion and update the expectation to match — these helpers are existing and authoritative.)

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run test/web-rollup.test.js -t buildFleetFileIndex`
Expected: FAIL — `buildFleetFileIndex is not a function`.

- [ ] **Step 5: Implement `latestInventoryPath` + `buildFleetFileIndex`**

In `src/commands/web-rollup.js`, add both helpers near the other inventory helpers (after `readInventoryNdjson`, ~line 430). `existsSync`, `slug`, `formatScanTimestamp`, `readInventoryNdjson` already exist in this file:

```js
/**
 * Resolve the most-augmented inventory for a site, newest pipeline step first:
 * audited → cross-ref → raw. Returns a path even if none exist (the raw path),
 * so callers stat/try-read and skip on failure.
 */
function latestInventoryPath(auditsBase, siteKey) {
  const dir = path.join(auditsBase, siteKey, "latest");
  const audited = path.join(dir, "inventory.audited.ndjson");
  const crossRef = path.join(dir, "inventory.cross-ref.ndjson");
  if (existsSync(audited)) return audited;
  if (existsSync(crossRef)) return crossRef;
  return path.join(dir, "inventory.ndjson");
}

/**
 * Pre-pass over every site's latest inventory → a fleet-wide map of canonical
 * file URL → owning site, so the per-site Page view can resolve a cross-site
 * (CMS-hosted) file link to the site that actually inventories it. Keyed by the
 * SAME canonical form the cross-ref step uses (entryCanonicalUrl + alias
 * collapse) so sidecar referencedFiles join cleanly. First-seen wins on
 * collision (cross-server duplicates).
 *
 * @param {Array} sites - sites.json sites[] (use the FULL roster, not a filter)
 * @param {string} auditsBase
 * @param {Map<string,string>} aliasMap - from buildAliasMap
 * @returns {Promise<Map<string,{siteName:string,siteLabel:string,filename:string,detailHref:string}>>}
 */
export async function buildFleetFileIndex(sites, auditsBase, aliasMap) {
  const index = new Map();
  for (const site of sites ?? []) {
    const siteKey = site?.name;
    if (!siteKey) continue;
    const latestInv = latestInventoryPath(auditsBase, siteKey);
    let header, entries;
    try {
      ({ siteHeader: header, entries } = await readInventoryNdjson(latestInv));
    } catch {
      continue;
    }
    if (!header) continue;
    const publicUrlBase = site.publicUrlBase ?? header.metadata?.publicUrlBase ?? "";
    if (!publicUrlBase) continue;
    const siteLabel = site.siteName ?? siteKey;
    const detailHref = `${slug(siteLabel)}-${formatScanTimestamp(header.metadata?.scannedAt)}.html`;
    const ownerName = header.metadata?.serverName ?? siteKey;
    for (const entry of entries ?? []) {
      const raw = entryCanonicalUrl(entry, publicUrlBase);
      const key = raw ? canonicalizeForFleet(raw, aliasMap) : null;
      if (!key || index.has(key)) continue; // first-seen wins
      index.set(key, {
        siteName: ownerName,
        siteLabel,
        filename: entry.filename ?? entry.path ?? "",
        detailHref,
      });
    }
  }
  return index;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run test/web-rollup.test.js -t buildFleetFileIndex`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/references/cross-resolver.js src/commands/web-rollup.js test/web-rollup.test.js
git commit -m "feat: buildFleetFileIndex — fleet-wide canonical URL to owning site map"
```

---

## Task 4: Thread the resolver + sidecar files through to writeHtml

**Files:**
- Modify: `src/commands/web-rollup.js` (hoist `auditsBase`, build resolver pre-pass, parse `pageRefFiles`, pass to `runReport`)
- Modify: `src/commands/report.js:81,142` (accept + forward params)
- Modify: `src/report/html.js:3,445,623` (import, accept params, call `attachCrossSiteFiles`)

- [ ] **Step 1: Hoist `auditsBase` and build the fleet resolver before the site loop**

In `src/commands/web-rollup.js`, the per-site loop currently defines `auditsBase` inside it (line ~954: `const auditsBase = _auditsBase ?? path.join(os.homedir(), "filecap-audits");`). Delete that in-loop line, and add this block just before the `for (const site of sites) {` loop (after `const consolidatedSources = [];`, ~line 945):

```js
  const auditsBase = _auditsBase ?? path.join(os.homedir(), "filecap-audits");
  // v1.32.0 — fleet-wide file index so each per-site Page view can surface the
  // CMS-hosted files its pages link (inventoried under another site). Built
  // from the FULL roster (allSites), not the include-filtered `sites`, so a
  // targeted rebuild still resolves cross-site links to other sites' caches.
  const fleetAliasMap = buildAliasMap({ sites: allSites });
  const fleetFileIndex = await buildFleetFileIndex(allSites, auditsBase, fleetAliasMap);
  const resolveFleetFile = (fileUrl) => {
    const key = canonicalizeForFleet(fileUrl, fleetAliasMap);
    return key ? (fleetFileIndex.get(key) ?? null) : null;
  };
```

- [ ] **Step 2: Parse `pageRefFiles` from the sidecar in the loop**

In `src/commands/web-rollup.js`, the loop reads the sidecar for `cmsPages` (~lines 1023-1029). Replace that block with one that reads the sidecar once and parses both:

```js
    let cmsPages = [];
    let pageRefFiles = new Map();
    try {
      const sidecarPath = path.join(path.dirname(latestInv), "references-sidecar.ndjson");
      const sidecarContent = await fs.readFile(sidecarPath, "utf8");
      cmsPages = parseCmsPageList(sidecarContent);
      pageRefFiles = parsePageRefFiles(sidecarContent);
    } catch {
      // no retained sidecar for this site — the Page view uses the sitemap only
    }
```

- [ ] **Step 3: Pass the new params into `runReport`**

In `src/commands/web-rollup.js`, the `runReport({ ... })` call (~lines 1033-1045) already passes `sitemapUrls, cmsPages`. Add three lines inside that object (after `cmsPages,`):

```js
      // v1.32.0 — cross-site (CMS-hosted) file resolution for the Page view.
      resolveFleetFile,
      pageRefFiles,
      currentSiteName: header.metadata?.serverName ?? siteKey,
```

- [ ] **Step 4: Forward the params through `runReport`**

In `src/commands/report.js`, extend the `runReport` signature (line 81) — add to the destructured params (after `cmsPages = []`):

```js
, resolveFleetFile = null, pageRefFiles = null, currentSiteName = null
```

So the signature tail reads `…, sitemapUrls = [], cmsPages = [], resolveFleetFile = null, pageRefFiles = null, currentSiteName = null }) {`.

Then in the `writeHtml({ ... })` call (~lines 142-167), add after `cmsPages,`:

```js
      // v1.32.0 — passed through from web-rollup so the Page view can resolve
      // CMS-hosted files a page links to their owning fleet site. Null in the
      // standalone `report` command (no fleet context) → no cross-site group.
      resolveFleetFile,
      pageRefFiles,
      currentSiteName,
```

- [ ] **Step 5: Accept + apply in `writeHtml`**

In `src/report/html.js`:

(a) line 3 — extend the import:

```js
import { buildPageList, attachCrossSiteFiles } from "./pages.js";
```

(b) line 445 — extend the `writeHtml` signature (add before the closing `}`):

```js
, resolveFleetFile = null, pageRefFiles = null, currentSiteName = null }) {
```

(c) line 623 — after `const pageList = buildPageList(entries, sitemapUrls, cmsPages);`, add:

```js
  // v1.32.0 — decorate each page with the CMS-hosted (cross-site) files it
  // links, resolved to their owning fleet site. No-op without fleet data
  // (standalone `report` command).
  if (resolveFleetFile && pageRefFiles) {
    attachCrossSiteFiles(pageList, { pageRefFiles, resolveFleetFile, currentSiteName });
  }
```

- [ ] **Step 6: Run the full suite (nothing should break yet; rendering comes next)**

Run: `npx vitest run`
Expected: PASS (existing tests unaffected; `crossSiteFiles` is attached but not yet rendered).

- [ ] **Step 7: Commit**

```bash
git add src/commands/web-rollup.js src/commands/report.js src/report/html.js
git commit -m "feat: thread fleet resolver + sidecar files into the Page view"
```

---

## Task 5: Render the cross-site group (HTML) + CSS + legend

**Files:**
- Modify: `src/report/html.js` (`buildPageFilesCell` ~250, `buildPageViewSection` note ~305, CSS ~933)

- [ ] **Step 1: Render `crossSiteFiles` in `buildPageFilesCell`**

In `src/report/html.js`, replace the body of `buildPageFilesCell` (lines 250-273) with the version below. It adds the muted cross-site group, keeps `data-count` / the `Files` count local-only, and shows the group even when there are zero local files:

```js
function buildPageFilesCell(page, ctx) {
  const files = page.files ?? [];
  // v1.31.0 — a file is listed once in the whole Page view, under the first
  // page that links it (see buildPageList). Repeat mentions on later pages
  // collapse into this muted count so the same filename never appears twice.
  const dupes = page.dupeFileCount ?? 0;
  const dupeNote = dupes > 0
    ? `<span class="no-refs">${files.length > 0 ? "+" : ""}${dupes} ${dupes === 1 ? "file" : "files"} listed under other pages</span>`
    : "";
  // v1.32.0 — files this page links that live in another fleet site's
  // inventory (e.g. CMS/Strapi uploads). Shown as a separate muted group; the
  // local Files count is unchanged.
  const crossSite = page.crossSiteFiles ?? [];
  const crossNote = crossSite.length > 0
    ? `<span class="page-xsite">&#8627; hosted on another site: ${crossSite
        .map((f) => {
          const name = htmlEscape(f.filename ?? "");
          const label = htmlEscape(f.siteLabel ?? "");
          const chip = f.detailHref
            ? `<a class="ref-link" href="${htmlEscape(f.detailHref)}" title="On ${label}">${name}</a>`
            : `<span class="ref-link-bad">${name}</span>`;
          return `${chip} <span class="xsite-owner">(${label})</span>`;
        })
        .join(" ")}</span>`
    : "";
  if (files.length === 0) {
    const empty = [dupeNote, crossNote].filter(Boolean).join(" ");
    return `<td data-count="0">${empty || `<span class="no-refs">No files</span>`}</td>`;
  }
  const chips = files
    .map((entry) => {
      const url = buildPublicUrl({ entry, ...ctx });
      const safe = safeUrl(url);
      const name = htmlEscape(entry.filename ?? entry.path ?? "");
      return safe
        ? `<a class="ref-link" href="${htmlEscape(safe)}" target="_blank" rel="noopener noreferrer" title="${htmlEscape(safe)}">${name}</a>`
        : `<span class="ref-link-bad">${name}</span>`;
    })
    .join(" ");
  return `<td data-count="${files.length}"><span class="page-file-count">${files.length}</span> ${chips}${dupeNote ? ` ${dupeNote}` : ""}${crossNote ? ` ${crossNote}` : ""}</td>`;
}
```

- [ ] **Step 2: Update the Page view legend note**

In `src/report/html.js`, in `buildPageViewSection` (line 305), append one sentence to the `page-view-note` paragraph, just before the closing `</p>` (after "…sitemap.xml and CMS respectively."):

```
 A file a page links that is hosted on another fleet site (for example the CMS) appears in a muted <span class="page-xsite">hosted on another site</span> group that links to that site's report.
```

- [ ] **Step 3: Add CSS**

In `src/report/html.js`, after the `.no-refs { … }` rule (ends line 933), add:

```css
/* v1.32.0 — CMS-hosted (cross-site) files a page links. Muted group after the
   local file chips; the chip reuses .ref-link, the owner label is muted. */
.page-xsite {
  display: inline;
  color: #9aa5b1;
  font-style: italic;
  font-size: 0.9em;
}
.page-xsite .xsite-owner {
  color: #86b8a6;
  font-style: normal;
  font-size: 0.92em;
}
```

- [ ] **Step 4: Run the suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/report/html.js
git commit -m "feat: render the CMS-hosted files group in the HTML Page view"
```

---

## Task 6: XLSX Pages tab — cross-site column

**Files:**
- Modify: `src/commands/web-rollup.js` (~lines 1080-1121)

- [ ] **Step 1: Apply `attachCrossSiteFiles` after the XLSX `buildPageList`**

In `src/commands/web-rollup.js`, right after `const pageList = buildPageList(perSiteEntries, sitemapUrls, cmsPages);` (line 1080), add:

```js
    attachCrossSiteFiles(pageList, {
      pageRefFiles,
      resolveFleetFile,
      currentSiteName: perSiteHeader.metadata?.serverName ?? siteKey,
    });
```

- [ ] **Step 2: Add cross-site data to each row + the column**

In the `pageRows = pageList.map((p) => { … })` block (lines 1086-1106), update the `files`/return to include cross-site files. Replace that map body with:

```js
      .map((p) => {
        // v1.31.0 — mirrors the HTML Page view: a file is listed once, under
        // the first page that links it; repeat mentions on later pages roll
        // up into "Files listed elsewhere" so no filename appears twice.
        // v1.32.0 — crossSite = CMS-hosted files the page links, owned by
        // another fleet site.
        const files = p.files ?? [];
        const filesElsewhere = p.dupeFileCount ?? 0;
        const crossSite = p.crossSiteFiles ?? [];
        const linksSomething = files.length > 0 || filesElsewhere > 0 || crossSite.length > 0;
        return {
          pageUrl: p.pageUrl,
          contentType: p.contentType || "",
          source: linksSomething ? "links files" : (p.fromSitemap ? "sitemap" : "cms"),
          fileCount: files.length,
          filesElsewhere,
          fileNames: files.map((f) => f.filename ?? f.path ?? "").join("; "),
          fileUrls: files
            .map((f) => buildPublicUrl({ entry: f, sourceHeader: pagesHeader, sourceMap: null, isConsolidated: false }))
            .filter(Boolean)
            .join("; "),
          crossSiteFiles: crossSite
            .map((f) => (f.siteLabel ? `${f.filename} (${f.siteLabel})` : f.filename))
            .join("; "),
        };
      })
```

- [ ] **Step 3: Add the column definition**

In the `columns: [ … ]` array (lines 1110-1117), add after the `fileUrls` column entry:

```js
          { key: "crossSiteFiles", label: "Files on other sites" },
```

- [ ] **Step 4: Run the suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/web-rollup.js
git commit -m "feat: add Files-on-other-sites column to the XLSX Pages tab"
```

---

## Task 7: End-to-end two-site integration test

**Files:**
- Test: `test/web-rollup.test.js`

- [ ] **Step 1: Write the failing test**

Add to `test/web-rollup.test.js`. It builds two sites — `sfs` (a page links a doc on the CMS host) and `agency` (whose inventory owns that doc) — runs the full rollup, and asserts the cross-site link appears in `sfs`'s HTML and XLSX. Uses the existing `tmpDir`, `writeSitesJson`, ExcelJS:

```js
describe("cross-site (CMS-hosted) files in the Page view (v1.32.0)", () => {
  async function writeRichInventory(filePath, { serverName, scannedAt, publicUrlBase, entries }) {
    const lines = [JSON.stringify({
      schemaVersion: 1, kind: "filecap-inventory-header",
      metadata: { serverName, scannedAt, publicUrlBase, siteName: serverName },
    })];
    for (const e of entries) lines.push(JSON.stringify(e));
    lines.push(JSON.stringify({ kind: "filecap-inventory-footer", entryCount: entries.length }));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, lines.join("\n") + "\n", "utf8");
  }

  it("surfaces a CMS-hosted file on the referring site's page, linked to the owner", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    const ts = "2026-06-12T20:14:54.000Z";

    // agency inventory owns the DOCX (CMS host).
    await writeRichInventory(path.join(auditsBase, "agency", "latest", "inventory.cross-ref.ndjson"), {
      serverName: "agency", scannedAt: ts, publicUrlBase: "https://agency.cms/uploads",
      entries: [{ path: "proto_abc.docx", filename: "proto_abc.docx", category: "office-document", remediable: true, references: [] }],
    });

    // sfs inventory: a PDF (local) whose page also links the agency DOCX.
    await writeRichInventory(path.join(auditsBase, "sfs", "latest", "inventory.cross-ref.ndjson"), {
      serverName: "sfs", scannedAt: ts, publicUrlBase: "https://sfs.gov",
      entries: [{
        path: "q.pdf", filename: "q.pdf", category: "pdf", remediable: true,
        references: [{ siteName: "sfs", contentType: "template", entryId: "p", pageUrl: "https://sfs.gov/research" }],
      }],
    });
    // sfs sidecar: /research links both the local PDF and the agency DOCX.
    await fs.writeFile(
      path.join(auditsBase, "sfs", "latest", "references-sidecar.ndjson"),
      JSON.stringify({
        siteName: "sfs", contentType: "template", entryId: "p", pageUrl: "https://sfs.gov/research",
        referencedFiles: ["https://sfs.gov/q.pdf", "https://agency.cms/uploads/proto_abc.docx"],
      }) + "\n",
      "utf8",
    );

    const sitesFile = path.join(tmpDir, "sites.json");
    await writeSitesJson(sitesFile, [
      { name: "sfs", siteName: "SFS", publicUrlBase: "https://sfs.gov", siteUrl: "https://sfs.gov/" },
      { name: "agency", siteName: "ICJIA agency", publicUrlBase: "https://agency.cms/uploads" },
    ]);
    const outputDir = path.join(tmpDir, "output");
    const result = await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, password: null });
    expect(result.exitCode).toBe(0);

    // SFS HTML shows the cross-site group with the DOCX, linked to the agency page.
    const sfsHtml = await fs.readFile(path.join(outputDir, `sfs-20260612-201454Z.html`), "utf8");
    expect(sfsHtml).toContain("hosted on another site");
    expect(sfsHtml).toContain("proto_abc.docx");
    expect(sfsHtml).toContain(`href="icjia-agency-20260612-201454Z.html"`);

    // SFS XLSX Pages tab has the new column populated for /research.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(outputDir, `sfs-20260612-201454Z.xlsx`));
    const pagesSheet = wb.getWorksheet("Pages");
    expect(pagesSheet).toBeTruthy();
    const headerRow = pagesSheet.getRow(1).values.map((v) => (v && v.text) ? v.text : v);
    expect(headerRow).toContain("Files on other sites");
    let found = false;
    pagesSheet.eachRow((row) => {
      const cells = row.values.map((v) => (v && v.text) ? v.text : v);
      if (cells.some((c) => typeof c === "string" && c.includes("proto_abc.docx") && c.includes("ICJIA agency"))) found = true;
    });
    expect(found).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run test/web-rollup.test.js -t "cross-site"`
Expected: PASS.

If the HTML filename or `detailHref` assertion fails, read the actual generated filename from `outputDir` (it is `slug(siteName)-formatScanTimestamp(scannedAt)`) and align both the file read and the `href=` expectation to it — the slug/timestamp helpers are authoritative.

- [ ] **Step 3: Commit**

```bash
git add test/web-rollup.test.js
git commit -m "test: end-to-end cross-site file surfacing in the Page view"
```

---

## Task 8: Version bump, CHANGELOG, real-data verification

**Files:**
- Modify: `package.json` (version → `1.32.0`)
- Modify: `CHANGELOG.md` (new `## [1.32.0]` entry)

- [ ] **Step 1: Bump the version**

In `package.json`, change `"version": "1.31.1"` to `"version": "1.32.0"`.

- [ ] **Step 2: Add the CHANGELOG entry**

In `CHANGELOG.md`, add a new entry directly above the `## [1.31.1]` heading. Note the date separator is an **em dash** (`—`), matching every existing entry:

```markdown
## [1.32.0] — 2026-06-16

### Added
- **Per-site Page view now surfaces CMS-hosted (cross-site) files.** When a page
  links a document served from another fleet site (e.g. the shared Strapi CMS at
  `agency.icjia-api.cloud/uploads`), that file now appears on the referring
  page's row in a muted "hosted on another site" group, linking to the owning
  site's report. Previously a git-repo site's Page view showed only files in its
  own repo, so CMS-hosted links (the SFS `/research` Evaluation Protocol DOCX,
  for example) were invisible even though the association was already captured
  fleet-wide. The per-page **Files** count is unchanged (still local-inventory
  only); cross-site files are a separate group.
- XLSX per-site **Pages** tab gains a **"Files on other sites"** column mirroring
  the HTML group.

### Notes
- Rebuild-only change: ships via `node bin/filecap.js web-rollup` (no re-scan).
  Fleet file/page totals are unaffected.
```

- [ ] **Step 3: Run the full suite + lint**

Run: `npx vitest run && npx eslint src test`
Expected: all tests PASS, no lint errors.

- [ ] **Step 4: Real-data spot check (no deploy)**

Confirm the real SFS sidecar + real fleet inventories resolve the DOCX to the agency page, using the actual cached data (does NOT touch Netlify). Run from the repo root:

```bash
node --input-type=module -e '
import { parsePageRefFiles, attachCrossSiteFiles } from "./src/report/pages.js";
import { buildFleetFileIndex } from "./src/commands/web-rollup.js";
import { buildAliasMap, canonicalizeForFleet } from "./src/references/cross-resolver.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const auditsBase = path.join(os.homedir(), "filecap-audits");
const sitesJson = JSON.parse(await fs.readFile(path.join(os.homedir(), ".filecap", "sites.json"), "utf8"));
const aliasMap = buildAliasMap(sitesJson);
const index = await buildFleetFileIndex(sitesJson.sites, auditsBase, aliasMap);
const resolveFleetFile = (u) => { const k = canonicalizeForFleet(u, aliasMap); return k ? (index.get(k) ?? null) : null; };
const sidecar = await fs.readFile(path.join(auditsBase, "sfs-git", "latest", "references-sidecar.ndjson"), "utf8");
const pageRefFiles = parsePageRefFiles(sidecar);
const pages = [{ pageUrl: "https://sfs.icjia.illinois.gov/research", files: [] }];
attachCrossSiteFiles(pages, { pageRefFiles, resolveFleetFile, currentSiteName: "sfs-git" });
console.log(JSON.stringify(pages[0].crossSiteFiles, null, 2));
'
```

Expected output: one entry for `SFS_Evaluation_Protocol_FINAL_10012024_b9ba78161c.docx` with `siteLabel` = the agency site's label and a non-null `detailHref` pointing at the agency bundle page.

- [ ] **Step 5: Commit**

```bash
git add package.json CHANGELOG.md
git commit -m "v1.32.0: CMS-hosted files surfaced in the per-site Page view"
```

- [ ] **Step 6: Ship (user-confirmed)**

Shipping the live bundle is the user's call. Per their workflow this is a template-only rebuild: `node bin/filecap.js web-rollup` (rebuilds from cached inventories, re-scrapes og live, autodeploys to Netlify) — no full `run-full-audit.sh`, no re-scan. Confirm with the user before running it.

---

## Notes for the implementer

- **Dark theme, hard-coded colors.** The report CSS uses literal hex values, not CSS variables. The cross-site styles above match the existing `.no-refs` (`#9aa5b1`) and `.page-cms-tag` (`#86b8a6`) palette — keep it that way.
- **`detailHref` is a sibling relative link.** All per-site pages land in the bundle root next to each other, so `detailHref` is just `<slug>-<timestamp>.html` (no path). This matches how `backHref="index.html"` already works.
- **Graceful degradation is intended.** No sidecar, no fleet match, or owner not in the bundle → host-only text / empty group. Never throw from the render path.
- **Don't change the `Files` count semantics.** `data-count` and the `fileCount` XLSX column stay local-inventory only; other sorting/filtering relies on them.
