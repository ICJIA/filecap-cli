// Sitemap fetching + parsing for the Page view's complete page list.
//
// The Page view's primary source is the inversion of each file's references[]
// (pages that link to a file). A site's sitemap.xml fills in the rest — every
// page, including the ones that link to no files — so the Page view can show a
// complete list. This module fetches and parses sitemaps; the merge into the
// page list happens in src/report/pages.js (buildPageList).

import { XMLParser } from "fast-xml-parser";
import { safeFetch } from "../util/safe-fetch.js";

const parser = new XMLParser();

function toArray(v) {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function locOf(node) {
  if (node && typeof node === "object") return node.loc;
  return node;
}

/**
 * Parse a sitemap XML string into page URLs and (for sitemap-index files)
 * sub-sitemap URLs. Pure — no I/O. Malformed input yields empty arrays.
 *
 * @param {string} xml
 * @returns {{ pageUrls: string[], subSitemaps: string[] }}
 */
export function parseSitemapXml(xml) {
  if (typeof xml !== "string" || xml.trim() === "") {
    return { pageUrls: [], subSitemaps: [] };
  }
  let obj;
  try {
    obj = parser.parse(xml);
  } catch {
    return { pageUrls: [], subSitemaps: [] };
  }
  const pageUrls = toArray(obj?.urlset?.url)
    .map(locOf)
    .filter((u) => typeof u === "string" && u.length > 0)
    .map((u) => u.trim());
  const subSitemaps = toArray(obj?.sitemapindex?.sitemap)
    .map(locOf)
    .filter((u) => typeof u === "string" && u.length > 0)
    .map((u) => u.trim());
  return { pageUrls, subSitemaps };
}

/**
 * Fetch a sitemap and return every page URL it lists. Follows one or two
 * levels of <sitemapindex> nesting. Any failure (network error, non-200,
 * unparseable body) resolves to an empty array — a missing or broken sitemap
 * must never break report generation.
 *
 * The recursive sub-sitemap URLs come from the fetched (attacker-influenceable)
 * XML body, so every fetch — the initial one included — goes through
 * `safeFetch`, which refuses loopback/link-local/private/metadata hosts and
 * does not chase redirects. A hostile `<loc>` pointing at 169.254.169.254 or
 * 127.0.0.1 is thus never probed (2026-08-24 SSRF fix).
 *
 * @param {string} sitemapUrl
 * @param {number} [depth] - recursion guard (internal)
 * @param {object} [deps] - test seam; `{ fetchImpl }` is forwarded to safeFetch
 * @returns {Promise<string[]>}
 */
export async function fetchSitemapUrls(sitemapUrl, depth = 0, deps = {}) {
  if (typeof sitemapUrl !== "string" || sitemapUrl.length === 0 || depth > 2) {
    return [];
  }
  let xml;
  try {
    const res = await safeFetch(sitemapUrl, {
      ...deps,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    xml = await res.text();
  } catch {
    return [];
  }
  const { pageUrls, subSitemaps } = parseSitemapXml(xml);
  let all = pageUrls.slice();
  for (const sub of subSitemaps) {
    all = all.concat(await fetchSitemapUrls(sub, depth + 1, deps));
  }
  return [...new Set(all)];
}

/**
 * Scope a list of sitemap URLs to a site that lives under a path prefix.
 *
 * When a site's front-end URL carries a path (e.g.
 * https://icjia.illinois.gov/researchhub/), its configured sitemap is often the
 * parent site's full sitemap. Keep only the URLs under the site's own path so
 * the Page view isn't padded with the parent site's pages. A site at the domain
 * root (path "/" or none) — or one whose siteUrl can't be parsed — keeps every
 * URL.
 *
 * @param {string[]} urls - page URLs from a sitemap
 * @param {string} siteUrl - the site's front-end URL (may carry a path prefix)
 * @returns {string[]}
 */
export function scopeSitemapUrlsToSite(urls, siteUrl) {
  const list = Array.isArray(urls) ? urls : [];
  let prefix;
  try {
    prefix = new URL(siteUrl).pathname.replace(/\/+$/, "").toLowerCase();
  } catch {
    return list;
  }
  if (!prefix) return list;
  return list.filter((u) => {
    let path;
    try {
      path = new URL(u).pathname.replace(/\/+$/, "").toLowerCase();
    } catch {
      return false;
    }
    return path === prefix || path.startsWith(`${prefix}/`);
  });
}
