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
