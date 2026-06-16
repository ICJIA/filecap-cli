# Surface CMS-hosted (cross-site) files in the per-site Page view

**Date:** 2026-06-16
**Status:** Approved (design)
**Ships via:** `node bin/filecap.js web-rollup` only — no re-scan.

## Problem

The per-site Page view (`src/report/pages.js` → `src/report/html.js`, and the
web-rollup XLSX Pages tab) lists, for each page, the files that page links. The
file→page association is built by inverting each inventory entry's
`references[]` (`buildPageList`). That inventory only contains files that
physically live in **this** site's scanned source.

For git-repo sites whose pages link documents served from the shared ICJIA
Strapi CMS, those documents are inventoried under a **different** fleet site
(the CMS site, e.g. `icjia-agency-prod` at `agency.icjia-api.cloud/uploads`).
The cross-resolver already attaches the correct back-reference to that file on
its owning site — but the link is invisible on the **referring** site's Page
view, so the page appears to link fewer files than it actually does.

### Canonical case — Safe From the Start (`sfs-git`)

`/research` links two files in `src/pages/research.astro`:

1. `/QuickStart_PartOne_NavIntakeBIF.pdf` → `sfs.icjia.illinois.gov/...` — in
   SFS's own inventory, **shown** (Files: 1).
2. `https://agency.icjia-api.cloud/uploads/SFS_Evaluation_Protocol_FINAL_10012024_b9ba78161c.docx`
   — inventoried under the **ICJIA agency** site, **not shown** on SFS's page.

The references sidecar already records both URLs for `/research`
(`referencedFiles[]`). The agency inventory entry already carries the
back-reference `sfs-git | template | …/research`. No re-scan is required; the
data exists and is correct. The gap is purely in what the per-site Page view
chooses to display.

This is **not** a bug in `buildPageList` or in the v1.31.0 "each file listed
once" dedup. It is a data-model display limitation that affects every git-repo /
Astro site that pulls uploads from Strapi (SFS, ARI summits, ilheals, vpp, …).

## Design decisions (locked)

1. **Separate group.** The per-page `Files` count keeps meaning "files in THIS
   site's own inventory linked here." CMS-hosted files appear as a distinct,
   muted group on the row — mirroring the existing v1.31.0 "listed under other
   pages" pattern. Fleet file/page totals are unaffected (cross-site files
   belong to their owner's count).
2. **Chip links to the owning site's detail page** within the same bundle, so
   you can jump to the file's real a11y audit / remediation status. Falls back
   to plain text if the owner isn't in the bundle.
3. **Both outputs** — HTML Page view and the per-site XLSX Pages tab — kept in
   sync as v1.29.0 / v1.31.0 did.

## Architecture

`buildPageList` stays the pure local transpose. A separate decoration step adds
cross-site files, fed by fleet-wide data that only `web-rollup` has.

### New / changed units

1. **`parsePageRefFiles(ndjson)`** — new in `src/report/pages.js`.
   Parses the references sidecar into `Map<normalizedPageUrl, string[]>`: every
   file URL a page links, merged across the page's markdown + template records
   (the same normalized-URL fold `buildPageList` uses). Sibling to the existing
   `parseCmsPageList`, which discards the file URLs. Skips malformed lines.

2. **`attachCrossSiteFiles(pages, { pageRefFiles, fleetFileIndex, currentSiteName })`**
   — new in `src/report/pages.js`. For each page row:
   - look up its linked file URLs in `pageRefFiles` (by normalized page URL);
   - canonicalize each (reuse `canonicalizeUrl` + the alias map);
   - resolve each through `fleetFileIndex`;
   - **drop** any whose resolved owner `siteName` equals `currentSiteName`
     (already shown as a local file or local dupe via the references inversion);
   - attach `page.crossSiteFiles = [{ filename, siteLabel, detailHref|null }]`
     for the rest;
   - ICJIA URLs that resolve nowhere in the fleet fall back to host-only text
     (`{ filename: <basename>, siteLabel: <host>, detailHref: null }`).
   No cross-site dedup: a file is shown on every page that links it (cross-site
   files are informational and not counted toward remediation totals, so the
   v1.31.0 over-counting rationale does not apply).

3. **`buildFleetFileIndex(sites, auditsBase)`** — new helper in
   `src/commands/web-rollup.js`. A lightweight pre-pass over every site's latest
   inventory → `Map<canonicalFileUrl, { siteName, siteLabel, filename, detailHref }>`.
   - `canonicalFileUrl` = `canonicalizeUrl(publicUrlBase + "/" + entry.path)`,
     same rule as `entryCanonicalUrl` in the cross-resolver.
   - `siteName` = the owning site's `serverName` (read from the inventory
     header's `metadata.serverName`, falling back to `site.name`). This is what
     `attachCrossSiteFiles` compares against `currentSiteName` for the
     local-exclusion check, so both sides use the same identifier.
   - `siteLabel` = the site's display name (`siteName ?? siteKey` from sites.json).
   - `detailHref` = that site's bundle page filename. The pre-pass reads each
     site's inventory header to get `metadata.scannedAt`, then computes the same
     `slug(siteLabelForSlug)-scanTimestamp` baseName the render loop uses, so
     chips link in-bundle.
   - Collision (one canonical URL inventoried under multiple sites, e.g.
     cross-server duplicates): **first-seen wins**, deterministic by sites.json
     order. Acceptable — any valid owner is a correct link target.
   Verified: the SFS DOCX URL canonicalizes identically to the agency entry's
   canonical URL — direct match, no alias required.

### Data flow

```
web-rollup
  ├─ pre-pass: buildFleetFileIndex(sites)            → fleetFileIndex
  └─ per site:
       parsePageRefFiles(sidecar)                    → pageRefFiles
       ├─ HTML:  runReport → writeHtml(… fleetFileIndex, pageRefFiles, currentSiteName)
       │            pages = buildPageList(entries, sitemapUrls, cmsPages)   // unchanged
       │            attachCrossSiteFiles(pages, …)                          // decorate
       └─ XLSX:  buildPageList(...) → attachCrossSiteFiles(...) → Pages tab
```

`currentSiteName` = the inventory header's `metadata.serverName`.

The standalone `report` command calls `writeHtml` **without** the fleet params
→ `crossSiteFiles` stays empty → no behavior change there (graceful default).

### Threading params

- `src/commands/report.js` (`runReport`) passes the three new optional params
  through to `writeHtml`.
- `src/report/html.js` (`writeHtml`) accepts `fleetFileIndex`, `pageRefFiles`,
  `currentSiteName` (all optional, default empty); after `buildPageList`, calls
  `attachCrossSiteFiles`.

## Rendering

### HTML — `buildPageFilesCell` (`src/report/html.js`)

After the local chips and the v1.31.0 dupe note, append a muted group when
`page.crossSiteFiles?.length`:

```
⤷ hosted on another site: SFS_Evaluation_Protocol_FINAL_10012024_b9ba78161c.docx (ICJIA agency)
```

- Each chip links to the owning site's bundle page (`detailHref`); plain text
  when `detailHref` is null.
- The `Files` count / `data-count` attribute stays **local-only**.
- Group label is generic ("another site") because the owner is not always the
  CMS; the specific owner is shown per chip in parentheses.
- Filename is displayed **raw** (matches the owner's page); CSS truncates. The
  Strapi hash suffix (`…_b9ba78161c`) is not stripped.
- Update the page-view legend note to mention the new group.

### XLSX — Pages tab (`src/commands/web-rollup.js`)

Add a `"Files hosted elsewhere"` column to the Pages tab, populated from
`crossSiteFiles` (filenames joined, mirroring the existing `fileNames` column).

## Testing

- **`parsePageRefFiles`** (`test/report-pages.test.js`): merge file URLs across
  multiple records for the same normalized page URL; dedupe; skip malformed
  lines; empty input → empty map.
- **`attachCrossSiteFiles`** (`test/report-pages.test.js`): local-owned files
  excluded; cross-site file resolved with correct `siteLabel` + `detailHref`;
  unresolved ICJIA URL → host-only fallback; page with no linked files left
  untouched; owner not in bundle → `detailHref` null.
- **web-rollup** (`test/web-rollup.test.js`): fleet index built across sites;
  Pages tab gains the "Files hosted elsewhere" column with the resolved
  filename; `buildPageList` output for the local site unchanged.

## Scope & rollout

- Web-rollup only; **no re-scan**. Ship with `node bin/filecap.js web-rollup`.
- Version bump + CHANGELOG entry before push (per project convention).
- Update the deployed `/accessibility` log only if the change touches a11y
  (it does not — this is a Page view content change), so no a11y-log entry is
  required; standard changelog entry applies.

## Out of scope (YAGNI)

- Stripping the Strapi hash suffix for display.
- Cross-site dedup ("listed under other pages" for CMS files).
- Surfacing cross-site files in the standalone `report` command (no fleet
  context there).
- Flagging the orphaned repo duplicate (`public/SFS_Evaluation_Protocol…docx`
  that nothing links) — that is a separate finding, not part of this change.
