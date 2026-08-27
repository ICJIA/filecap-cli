// Is this URL a web page, or a file that happens to be listed in a sitemap?
//
// v1.67.0 — the website-accessibility score is about a site's PAGES. The
// archive's sitemap.xml lists the files it hosts (1,534 PDFs, 213 JPEGs, 182
// spreadsheets, 149 zips, even 14 .DS_Store), so `resolveSitePageSet` was
// handing all of them to the page scorer, which points a headless browser at
// each URL and runs axe. 89% of that site's 2,421-URL "page set" was binary
// files: 712 of its 804 scored "pages" were documents and images, so its
// published website score described almost nothing about its pages. The ones
// that failed outright came back `504 Page navigation timed out`.
//
// Those documents are not going unaudited — the `audits` stage scores PDFs and
// OOXML Office files properly, against a rubric built for documents. This
// filter only keeps them out of the PAGE score.
//
// Allowlist, not blocklist. A blocklist built from the scanner's
// EXTENSION_MAP would have missed .pub, .mdown, .msg and .gitignore — all
// present in the archive sitemap. Measured across every fleet sitemap
// (2026-08-27), the only URLs with a non-web extension in their last path
// segment were archive-prod's 2,370 files; no site publishes a page whose
// slug could be mistaken for a filename. The risk that remains — silently
// dropping a real page — is why callers log what was dropped.

/** Extensions that name a web page rather than a file. */
const PAGE_EXTENSIONS = new Set([
  "html", "htm", "xhtml", "shtml",
  "php", "asp", "aspx", "jsp", "jspx", "cfm",
]);

/**
 * True when the URL addresses something a browser can render as a page:
 * a directory-style path, an extensionless slug, or an explicit page
 * extension. Anything carrying a file extension is a file.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isPageUrl(url) {
  let pathname;
  try {
    ({ pathname } = new URL(url));
  } catch {
    return false; // not a URL at all
  }
  let last;
  try {
    last = decodeURIComponent(pathname).replace(/\/+$/, "").split("/").pop() ?? "";
  } catch {
    last = pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  }
  if (last === "") return true; // "/" or a trailing-slash directory URL

  const dot = last.lastIndexOf(".");
  // No dot → a slug. A leading dot and nothing else → a published dotfile
  // (.DS_Store, .gitignore), which is never a page.
  if (dot === -1) return true;
  if (dot === 0) return false;

  return PAGE_EXTENSIONS.has(last.slice(dot + 1).toLowerCase());
}

/**
 * Partition a URL list into renderable pages and the file URLs removed.
 * Order is preserved so the caller's page set stays stable.
 *
 * @param {string[]} urls
 * @returns {{ pages: string[], dropped: string[] }}
 */
export function filterPageUrls(urls) {
  const pages = [];
  const dropped = [];
  for (const u of Array.isArray(urls) ? urls : []) {
    (isPageUrl(u) ? pages : dropped).push(u);
  }
  return { pages, dropped };
}
