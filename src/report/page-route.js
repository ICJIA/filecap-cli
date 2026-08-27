// Page URL → route, the sortable grouping key for the workbook's Pages tab.
//
// v1.65.0 — a site's page list is flat, so finding "every meetings page" in
// the spreadsheet meant eyeballing URLs. The route is the page's site-relative
// parent path: sorting on it puts every page of a section together, and the
// autofilter dropdown turns each section into a one-click filter.
//
//   /adultredeploy/about/meetings/regular-oversight/ariob-meeting-2026-3
//     → /about/meetings/regular-oversight/
//   /adultredeploy/news/ari-10-years  → /news/
//   /adultredeploy                    → /
//
// Parent path rather than a fixed depth: a fixed two-segment rule reads well
// for nested sections but shatters flat ones (every /news/<slug> would become
// its own route — 320 distinct values on ARI instead of 24).

/**
 * The site-relative parent path of a page URL, with leading and trailing
 * slashes. Returns "" for input that isn't a URL.
 *
 * @param {string} pageUrl
 * @param {string} [siteUrl] - the site's front-end URL; its path prefix is
 *        stripped so a subpath-hosted site's routes read as if it were at the
 *        domain root. Omitted or unparseable → no stripping.
 * @returns {string}
 */
export function pageRoute(pageUrl, siteUrl) {
  let path;
  try {
    path = new URL(pageUrl).pathname;
  } catch {
    return "";
  }
  path = path.replace(/\/+$/, "");

  let prefix = "";
  try {
    prefix = new URL(siteUrl).pathname.replace(/\/+$/, "");
  } catch {
    /* no siteUrl, or not a URL — keep the full path */
  }
  if (prefix) {
    const lower = path.toLowerCase();
    const lowerPrefix = prefix.toLowerCase();
    // Segment-aligned match only: /adultredeploy must not swallow
    // /adultredeployXX.
    if (lower === lowerPrefix) return "/";
    if (lower.startsWith(`${lowerPrefix}/`)) path = path.slice(prefix.length);
  }

  const parent = path.slice(0, path.lastIndexOf("/"));
  return parent === "" ? "/" : `${parent}/`;
}
