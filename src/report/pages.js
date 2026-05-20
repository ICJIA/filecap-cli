// Page-centric view of the inventory.
//
// The default report is file-centric: one row per file, with the pages that
// link to it (entry.references[]). The Page view is the transpose — one row
// per page, with the files attached to it. buildPageList() inverts the file
// entries' references[] into that page list.
//
// Each reference object already carries everything a page row needs:
//   { siteName, contentType, entryId, pageUrl, pageAudit }
// and pageAudit carries { score, grade, violationCount, pageTitle, reportUrl, … }.
// So no new pipeline data is required — the Page view is a pure transform.

function normPageUrl(u) {
  return String(u ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Invert file entries into a list of pages, then merge in sitemap-only URLs.
 *
 * @param {Array} entries - inventory file entries (each may carry references[])
 * @param {string[]} [sitemapUrls] - page URLs from the site's sitemap.xml; any
 *        not surfaced by the inversion are appended as thin rows
 *        (fromSitemap: true — URL only, no audit/files).
 * @returns {Array<{pageUrl,pageTitle,contentType,siteName,pageAudit,files,fromSitemap?}>}
 */
export function buildPageList(entries, sitemapUrls = []) {
  const byUrl = new Map();
  const seenByUrl = new Map();
  for (const entry of entries ?? []) {
    const refs = Array.isArray(entry?.references) ? entry.references : [];
    for (const ref of refs) {
      const pageUrl = ref?.pageUrl;
      if (!pageUrl) continue;
      if (!byUrl.has(pageUrl)) {
        byUrl.set(pageUrl, {
          pageUrl,
          pageTitle: ref.pageAudit?.pageTitle ?? "",
          contentType: ref.contentType ?? "",
          siteName: ref.siteName ?? "",
          pageAudit: ref.pageAudit ?? null,
          files: [],
        });
        seenByUrl.set(pageUrl, new Set());
      }
      // A file usually references a page once, but guard against a file
      // listed twice in one page's references producing a duplicate row.
      const fileKey = entry?.path ?? entry?.filename ?? "";
      const seen = seenByUrl.get(pageUrl);
      if (seen.has(fileKey)) continue;
      seen.add(fileKey);
      byUrl.get(pageUrl).files.push(entry);
    }
  }
  const pages = [...byUrl.values()];
  // v1.14.0: merge in sitemap URLs the inversion didn't surface — pages that
  // exist but link to no files. They render as thin rows so the Page view is
  // a complete list of the site's pages, not just the file-linking ones.
  const seen = new Set(pages.map((p) => normPageUrl(p.pageUrl)));
  for (const url of sitemapUrls ?? []) {
    const norm = normPageUrl(url);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    pages.push({
      pageUrl: url,
      pageTitle: "",
      contentType: "",
      siteName: "",
      pageAudit: null,
      files: [],
      fromSitemap: true,
    });
  }
  return pages;
}
