// v1.46.0 — rollup-time emitter for search-index.json, the compact dataset
// behind the /search page. The full audit-fleet.ndjson is ~12MB of
// introspection the search UI never reads; this index carries only what a
// result row renders, as positional arrays with sites + categories folded
// out to lookup tables (8,787 records × repeated JSON keys is pure
// wire-weight — Netlify compression does the rest).
//
// Row positions (keep in sync with search-page.js's client renderer):
//   0 filename   1 path        2 siteIdx (→ sites[])  3 catIdx (→ categories[])
//   4 sizeBytes  5 modified (YYYY-MM-DD)  6 score|null  7 grade|null  8 publicUrl
//   9 per-file audit report URL (audit.icjia.app, shareable) | null

import { publicUrlFor } from "../report/format.js";

export const SEARCH_INDEX_FILENAME = "search-index.json";

// Canonical category order — mirrors TYPE_BUCKETS in web-rollup.js
// (remediable formats first, reference formats after).
const CATEGORY_ORDER = [
  "pdf", "office-document", "spreadsheet", "presentation", "legacy-office",
  "image", "text", "archive", "audio-video", "web", "other",
];

/**
 * Resolve the URL a search result should link to. Git-type entries carry a
 * GitHub /tree/ URL in absolutePath, rewritten to /blob/ — the reliable
 * destination, because some static-site deploys answer HTTP 200 with the
 * homepage for ANY path (same rationale as findCrossServerDuplicates).
 */
function entryUrl(entry, publicUrlBase, pathPrefix) {
  const ap = String(entry?.absolutePath ?? "");
  if (/^https?:\/\//i.test(ap)) return ap.replace("/tree/", "/blob/");
  return publicUrlFor(entry, publicUrlBase, pathPrefix);
}

/**
 * Build the search index from the rollup's in-memory fleet data.
 *
 * @param {object} args
 * @param {Array<{entry: object, serverName: string, publicUrlBase: string, pathPrefix: string|null}>} args.allEntries
 * @param {Array<{site: object, htmlFile: string}>} args.siteResults
 * @param {string} [args.generatedAt] - ISO timestamp stamped into the artifact
 * @returns {{generatedAt: string, sites: Array, categories: Array<string>, rows: Array<Array>}}
 */
export function buildSearchIndex({ allEntries, siteResults, generatedAt = new Date().toISOString() }) {
  const sites = (siteResults ?? []).map((sr) => ({
    label: sr.site?.siteName ?? sr.site?.name ?? "",
    full: sr.site?.siteFullName ?? "",
    slug: sr.site?.name ?? "",
    detail: sr.htmlFile ?? "",
  }));
  const siteIdxBySlug = new Map(sites.map((s, i) => [s.slug, i]));

  const categoriesPresent = new Set();
  for (const it of allEntries ?? []) {
    if (siteIdxBySlug.has(it.serverName)) categoriesPresent.add(it.entry?.category ?? "other");
  }
  const categories = CATEGORY_ORDER.filter((c) => categoriesPresent.has(c));
  // Any category outside the canonical list (future scanner additions) still
  // gets a slot rather than being dropped.
  for (const c of categoriesPresent) if (!categories.includes(c)) categories.push(c);
  const catIdx = new Map(categories.map((c, i) => [c, i]));

  const rows = [];
  for (const it of allEntries ?? []) {
    const siteIdx = siteIdxBySlug.get(it.serverName);
    if (siteIdx === undefined) continue;
    const entry = it.entry ?? {};
    const audit = entry.audit;
    rows.push([
      entry.filename ?? "",
      entry.path ?? "",
      siteIdx,
      catIdx.get(entry.category ?? "other"),
      entry.sizeBytes ?? 0,
      String(entry.modifiedAt ?? "").slice(0, 10),
      typeof audit?.score === "number" ? audit.score : null,
      typeof audit?.grade === "string" ? audit.grade : null,
      entryUrl(entry, it.publicUrlBase, it.pathPrefix),
      typeof audit?.reportUrl === "string" && audit.reportUrl ? audit.reportUrl : null,
    ]);
  }
  rows.sort((a, b) => {
    const fa = String(a[0]).toLowerCase();
    const fb = String(b[0]).toLowerCase();
    return fa < fb ? -1 : fa > fb ? 1 : a[2] - b[2];
  });

  return { generatedAt, sites, categories, rows };
}
