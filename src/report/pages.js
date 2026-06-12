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
 * Invert file entries into a list of pages, then merge in CMS-only and
 * sitemap-only URLs so the result is a complete list of the site's pages.
 *
 * @param {Array} entries - inventory file entries (each may carry references[])
 * @param {string[]} [sitemapUrls] - page URLs from the site's sitemap.xml
 * @param {Array<{pageUrl:string,contentType?:string}>} [cmsPages] - every CMS
 *        entry's page (from the references sidecar). Pages not surfaced by the
 *        inversion are appended as thin rows — cmsPages → fromCms (carry the
 *        content type), sitemap URLs → fromSitemap — URL-only, no audit/files.
 * @returns {Array<{pageUrl,pageTitle,contentType,siteName,pageAudit,files,dupeFileCount,fromSitemap?,fromCms?}>}
 *          files holds only the files FIRST listed under that page;
 *          dupeFileCount counts the page's additional linked files already
 *          listed under earlier pages.
 */
export function buildPageList(entries, sitemapUrls = [], cmsPages = []) {
  // v1.29.0 — key the inversion by the NORMALIZED URL (same rule as the
  // sitemap/CMS merge below) so raw variants of one page ("/About/" vs
  // "/about") fold into a single row instead of splitting its files across
  // two. The first-seen raw URL stays as the display URL.
  //
  // v1.31.0 — each file is listed ONCE in the whole page list, under the
  // first page that references it. A page whose reference would repeat a
  // file already listed under an earlier page counts it in dupeFileCount
  // instead. (Before: a file linked from seven pages produced seven
  // identical-looking mentions, which read as duplication and over-counted
  // remediation work. The file view still shows every referencing page.)
  const byUrl = new Map();
  // fileKey -> set of page keys that mentioned it. Server-qualified so the
  // same path on two servers (consolidated by-type inventories) does not
  // collide.
  const pagesByFile = new Map();
  for (const entry of entries ?? []) {
    const refs = Array.isArray(entry?.references) ? entry.references : [];
    const fileKey = `${entry?.serverName ?? ""}:${entry?.path ?? entry?.filename ?? ""}`;
    for (const ref of refs) {
      const pageUrl = ref?.pageUrl;
      if (!pageUrl) continue;
      const key = normPageUrl(pageUrl);
      if (!byUrl.has(key)) {
        byUrl.set(key, {
          pageUrl,
          pageTitle: ref.pageAudit?.pageTitle ?? "",
          contentType: ref.contentType ?? "",
          siteName: ref.siteName ?? "",
          pageAudit: ref.pageAudit ?? null,
          files: [],
          dupeFileCount: 0,
        });
      }
      if (!pagesByFile.has(fileKey)) pagesByFile.set(fileKey, new Set());
      const mentionedOn = pagesByFile.get(fileKey);
      // The same file repeated in one page's references is pure noise — drop.
      if (mentionedOn.has(key)) continue;
      mentionedOn.add(key);
      const page = byUrl.get(key);
      if (mentionedOn.size === 1) page.files.push(entry);
      else page.dupeFileCount += 1;
    }
  }
  const pages = [...byUrl.values()];
  // Merge in pages the reference inversion didn't surface — pages that exist
  // but link to no files — so the Page view is a complete list of the site's
  // pages. Two sources, in priority order: the CMS's own entry list (carries
  // the content type), then the sitemap.
  const seen = new Set(pages.map((p) => normPageUrl(p.pageUrl)));
  for (const cp of cmsPages ?? []) {
    const norm = normPageUrl(cp?.pageUrl);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    pages.push({
      pageUrl: cp.pageUrl,
      pageTitle: "",
      contentType: cp.contentType ?? "",
      siteName: "",
      pageAudit: null,
      files: [],
      dupeFileCount: 0,
      fromCms: true,
    });
  }
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
      dupeFileCount: 0,
      fromSitemap: true,
    });
  }
  return pages;
}

/**
 * Parse a references sidecar (NDJSON, one record per CMS entry) into the
 * site's page list — {pageUrl, contentType} for every entry with a resolvable
 * page URL, de-duplicated by normalised URL. Malformed lines are skipped.
 *
 * @param {string} ndjson
 * @returns {Array<{pageUrl: string, contentType: string}>}
 */
export function parseCmsPageList(ndjson) {
  if (typeof ndjson !== "string" || ndjson.trim() === "") return [];
  const out = [];
  const seen = new Set();
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
    const norm = normPageUrl(pageUrl);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push({ pageUrl, contentType: rec.contentType ?? "" });
  }
  return out;
}
