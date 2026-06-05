# `/sites` roster page + agency tooling — design

**Date:** 2026-06-05
**Status:** Approved (design Q&A complete)
**Target version:** v1.21.0

## Goal

Add a shareable `/sites` page to the web-rollup bundle: a directory of **every
registered site** plus the agency's **tooling apps**, so someone can be handed a
link and see the full roster — titles, URLs, descriptions, and technical details —
*without* per-file/per-page audit data. Also surface the tooling apps in a
dedicated band on the home page.

## Audience & emphasis

Primary audience is **managers**, not remediators. Their question is literally
*"never mind the PDFs — how many sites do we have, and what are they?"* So the
page must:

- **Lead with the count.** A big, bold, infographic hero that answers "how many
  sites?" at a glance (registered-site count + tool count, broken down by access
  kind). This is the hero, not a footnote.
- **Keep cards clean.** Title, URL, and one-line description front-and-center;
  the IP/hostname/path tech block stays in a **collapsed** `<details>` disclosure
  so it never clutters the manager view but remains there for remediators.
- **Make the download obvious.** A clear, prominent "Download sites list (.xlsx)"
  action near the hero.

## Locked decisions

1. **Roster scope.** `/sites` lists every site in `~/.filecap/sites.json`
   (post `--include`/`--exclude` filtering), scanned or not. Unscanned sites
   render with whatever `sites.json` provides; scanned sites additionally get
   IP / hostname / scanned-path from their latest scan header.
2. **Registered-site card.** Title (`siteFullName`→`siteName`→`name`), live URL
   (`siteUrl`→`publicUrlBase`), an optional brief **description** (new field),
   and the existing home-page **"Technical details"** disclosure (Website, IP,
   hostname, path, URL — each copy-to-clipboard). **No** file/page numbers,
   donuts, chips, or audit actions.
3. **Tooling config.** A new top-level `tools[]` array in `sites.json` with its
   own strict schema. Tools never enter the audit pipeline and never affect
   fleet math.
4. **Tooling card.** Title, live URL, description, an optional `stack` line, and
   a **"Tooling"** badge. No host/IP/path.
5. **Home page tooling band.** An "Agency tools" section on `index.html` (active
   sites, nothing to audit), placed after the fleet cards / by-type tables and
   before "Cross-Server Duplicates". Excluded from the "N sites" count and all
   totals.
6. **"Infographic" look on `/sites`.** Reuse the home page's full stylesheet for
   identical visual language. Lead with a **bold count-first hero** — a large
   "N registered sites" headline number + tool count + a by-access-kind
   breakdown — so a manager's "how many sites?" is answered instantly. Cards are
   clean (title/URL/description prominent; tech block collapsed). No per-file
   donuts (no file data on this page).
7. **XLSX download.** One page-level **"Download sites list (.xlsx)"** on
   `/sites` → `sites-list.xlsx`, a two-sheet workbook:
   - **Sites** sheet: Site, Nickname, Description, URL, Type, Access, Hostname,
     IP, Path (one row per registered site).
   - **Tools** sheet: Tool, Nickname, Description, URL, Stack.
   Roster only — no file/page data. Netlify already force-downloads `/*.xlsx`.

## Architecture (Approach A — reuse, don't fork)

The card CSS, tech-details markup, access chips, clipboard script, and ICJIA
logo currently live *inside* the 162 KB `index-page.js` template. `/sites` needs
the same look and both pages need a tool-card renderer. We keep one source of
truth by exporting the shared pieces from `index-page.js`:

- Wrap the existing inline `<style>` body in a named **`INDEX_CSS`** const and
  reference `<style>${INDEX_CSS}</style>` (mechanical — home page renders
  byte-identically). Add the new `.tool-card` / tooling-band / roster-hero rules
  into `INDEX_CSS` so both pages share them.
- Factor the existing inline clipboard IIFE into an exported **`CLIPBOARD_SCRIPT`**
  const.
- Extract the card's tech-details markup into an exported
  **`renderTechDetails({ site, header })`** used by *both* `renderCard` (replacing
  its inline block) and the new roster card.
- `export` the already-top-level `he`, `copyableValue`, `ICJIA_LOGO_SVG`,
  `COPY_ICON_SVG`, `ACCESS_CHIP_LABEL`.
- Add an exported **`renderToolCard(tool)`** and the "Agency tools" band inside
  `generateIndexHtml` (new optional `tools` param).

New module **`src/web/sites-page.js`** → `generateSitesHtml({ siteRoster, tools,
sitesListXlsx, title, generatedAt })`: full document reusing `INDEX_CSS` +
`CLIPBOARD_SCRIPT`, a summary hero, a "Registered sites" section (roster cards,
alphabetized), a "Tooling" section, and the footer. `/sites` ships some unused
hero/donut CSS — negligible for an internal bundle, and it guarantees zero drift.

## Data model — `sites.json`

Add optional `description` to `siteEntrySchema`. Add `toolEntrySchema` +
`tools[]` to `sitesFileSchema` (in `src/commands/web-rollup.js`), reusing
`SITE_NAME_SLUG` and `httpUrlSchema`:

```jsonc
{
  "sites": [ /* … existing, each may now carry "description": "…" */ ],
  "tools": [
    { "name": "markdown", "siteName": "Markdown", "siteFullName": "ICJIA Markdown Editor",
      "siteUrl": "https://markdown.icjia.cloud", "description": "In-browser Markdown editor" },
    { "name": "squish", "siteName": "Squish", "siteFullName": "Squish — image compression",
      "siteUrl": "https://squish.icjia.app", "description": "Bulk image compression" },
    { "name": "metapeek", "siteName": "MetaPeek", "siteFullName": "MetaPeek — SEO checker",
      "siteUrl": "https://metapeek.icjia.app", "description": "SEO / meta-tag checker" },
    { "name": "ipsumify", "siteName": "Ipsumify", "siteFullName": "Ipsumify — placeholder text",
      "siteUrl": "https://ipsumify.com", "description": "Placeholder (lorem ipsum) text generator" },
    { "name": "icjia-qr", "siteName": "QR Generator", "siteFullName": "ICJIA QR Code Generator",
      "siteUrl": "https://icjia-qr.netlify.app", "description": "QR code generator" },
    { "name": "icjia-fleet-audit", "siteName": "Fleet Audit", "siteFullName": "ICJIA Accessibility Fleet Audit",
      "siteUrl": "https://icjia-fleet-audit.netlify.app", "description": "This fleet-wide file accessibility audit dashboard" }
  ]
}
```

`toolEntrySchema` (`.strict()`): `name` (slug, required), `siteUrl` (http(s),
required), `siteName?`, `siteFullName?`, `description?`, `stack?`.

## Components & files

- **`src/commands/web-rollup.js`** — schema additions; build `siteRoster` over
  all filtered `sites` (reuse `siteResults` for scanned, best-effort header read
  for unscanned, stamp `accessKind` via `deriveAccessKind`); build
  `sites-list.xlsx`; write `sites.html` (password-gated when a password is set);
  pass `tools` to `generateIndexHtml`; add "Sites" to the footer link set.
- **`src/web/index-page.js`** — the Approach-A exports/refactors + the home-page
  "Agency tools" band + a "Sites" footer link.
- **`src/web/sites-page.js`** (new) — `generateSitesHtml(...)`.
- **`src/report/xlsx.js`** — add `writeXlsxRowsMultiSheet({ outputPath, sheets:
  [{ sheetName, columns, rows }] })` (or extend `writeXlsxFromRows`) for the
  two-sheet roster workbook.

## Routing & discoverability

Netlify serves `/accessibility` → `accessibility.html` via clean URLs with no
redirect rule, so `/sites` → `sites.html` needs no `_redirects` change. Add a
**"Sites"** link to the home-page footer and mirror the footer on `/sites`.

## Testing & versioning

- **Schema:** valid `tools` entry; missing `siteUrl`, bad slug, non-http URL,
  and extra keys all rejected; optional `description` on a site accepted.
- **`test/sites-page.test.js`** (new): roster cards show title/URL/description/
  tech details and **omit** numbers ("may need audit", donut, total files);
  unscanned site renders without IP/path rows; tooling section renders;
  empty `tools` → no tooling section.
- **`test/index-page.test.js`:** tooling band renders each tool; fleet counts
  unaffected; no `tools` → no band.
- **`test/web-rollup.test.js`:** `sites.html` and `sites-list.xlsx` written;
  roster includes an unscanned-but-registered site and the tools; password
  gate applied when a password is set.
- `npm run lint` + `npm test`; bump to **v1.21.0**; CHANGELOG entry.

## Out of scope

- Per-site file-inventory download on `/sites` (explicitly rejected — roster
  workbook only).
- Per-file donuts/number tiles on `/sites`.
- A `tools.json` separate file (chose `tools[]` in `sites.json`).

---

## Addendum (2026-06-05) — OG metadata, card images, content/tooling split

Added after the initial design during the same session. These supersede the
matching earlier points.

### Sections renamed

`/sites` has two sections: **"Content sites"** (the audited fleet) and
**"Tooling sites"** (the agency apps). The home-page band is **"Tooling sites"**
too (was "Agency tools").

### OG metadata fetch

At rollup, fetch `og:image` / `og:title` / `og:description` (twitter:image as an
image fallback) for **every content site and tooling site**. New module
`src/references/og-meta.js`:

- `fetchOgMeta(url, { timeoutMs, fetchImpl })` → `{ image, title, description }`,
  best-effort (nulls on failure/timeout); resolves relative image URLs against
  the page URL; decodes HTML entities.
- The whole enrichment is injectable on `runWebRollup` (`ogEnrich` / a stub) and
  skippable (`--no-og`) so **tests never hit the network**.

Probe (2026-06-05) confirmed coverage: all main `.illinois.gov` sites + markdown
/ squish / metapeek / ipsumify expose clean OG tags; only `icjia-qr` (SPA) lacks
og:image.

### Card images — download into `assets/og/`

og:images are **downloaded into the bundle** (`assets/og/<slug>.<ext>`,
content-type→ext, size-capped, best-effort) for a self-contained snapshot.
Referenced locally on the cards (lazy-loaded cover image, ~1.91:1).

**Fallback when no og:image (or download fails):** render the **ICJIA logo**
tile (reuse `ICJIA_LOGO_SVG`, centered on the dark card bg) — not a monogram.
An optional `image` field per entry (site or tool) overrides the fetched image.

### Descriptions

`/sites` card description = config `description` (if set) → else **og:description**
→ else empty. Same for the roster XLSX "Description" column. og:description means
no hand-authoring is required.

### Image scope

Card images appear on: `/sites` **Content sites** cards, `/sites` **Tooling
sites** cards, and the **home-page Tooling sites band**. The home page's existing
audit content cards (donut/number layout) stay image-less for now.

### Schema additions (final)

- `siteEntrySchema`: + optional `description`, + optional `image`.
- `toolEntrySchema` (strict): `name` (slug, req), `siteUrl` (http, req),
  `siteName?`, `siteFullName?`, `description?`, `image?`, `stack?`.

### Tooling content (to add to `~/.filecap/sites.json`)

markdown · squish · metapeek · ipsumify · icjia-qr (see `tools[]` block above;
descriptions auto-fill from og:description, so the config `description` is
optional).
