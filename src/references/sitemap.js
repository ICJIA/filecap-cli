// Sitemap fetching + parsing for the Page view's complete page list.
//
// The Page view's primary source is the inversion of each file's references[]
// (pages that link to a file). A site's sitemap.xml fills in the rest — every
// page, including the ones that link to no files — so the Page view can show a
// complete list. This module fetches and parses sitemaps; the merge into the
// page list happens in src/report/pages.js (buildPageList).

import { XMLParser } from "fast-xml-parser";

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
 * @param {string} sitemapUrl
 * @param {number} [depth] - recursion guard (internal)
 * @returns {Promise<string[]>}
 */
export async function fetchSitemapUrls(sitemapUrl, depth = 0) {
  if (typeof sitemapUrl !== "string" || sitemapUrl.length === 0 || depth > 2) {
    return [];
  }
  let xml;
  try {
    const res = await fetch(sitemapUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    xml = await res.text();
  } catch {
    return [];
  }
  const { pageUrls, subSitemaps } = parseSitemapXml(xml);
  let all = pageUrls.slice();
  for (const sub of subSitemaps) {
    all = all.concat(await fetchSitemapUrls(sub, depth + 1));
  }
  return [...new Set(all)];
}
