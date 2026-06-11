// File-URL regex extraction from arbitrary text (markdown body, HTML, plain
// prose). Captures http/https URLs whose path ends in one of the file
// extensions that filecap audits, plus optional query string. Stops the URL
// at common terminators (whitespace, quotes, angle brackets, closing paren or
// bracket, non-breaking space) so trailing punctuation in prose ("see
// foo.pdf.") doesn't get glued onto the URL.
const FILE_URL_RE =
  /https?:\/\/[^\s"'<>)\] ]+?\.(?:pdf|docx?|xlsx?|pptx?|zip)(?:\?[^\s"'<>)\] ]*)?/gi;

// v1.29.0 — root-relative links ("/files/x.pdf", "/uploads/x.pdf"). The
// fleet's own markdown/CMS bodies usually link same-site files this way, so
// absolute-only extraction silently dropped them (VPP's plan PDF, SPAC body
// links). The leading character class anchors the match to a link-ish
// boundary so "files/local.pdf" (no leading slash) and the path half of an
// absolute URL don't match.
const RELATIVE_FILE_URL_RE =
  /(^|[\s"'<>([=])(\/[^\s"'<>)\]]+?\.(?:pdf|docx?|xlsx?|pptx?|zip)(?:\?[^\s"'<>)\]]*)?)/gi;

/**
 * Extract audited-extension file URLs from free text.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {string} [options.baseUrl] - when set, root-relative links
 *        ("/uploads/x.pdf") are also extracted and resolved against this
 *        base's origin. Without it, behavior is absolute-only (unchanged).
 * @returns {string[]} deduplicated URLs in first-seen order, absolute first
 */
export function extractFileUrls(text, options = {}) {
  if (typeof text !== "string" || text.length === 0) return [];
  const seen = new Set();
  const result = [];
  const add = (u) => {
    if (!seen.has(u)) {
      seen.add(u);
      result.push(u);
    }
  };

  const absolute = text.match(FILE_URL_RE) ?? [];
  for (const m of absolute) add(m);

  const baseUrl = options.baseUrl;
  if (typeof baseUrl === "string" && baseUrl.length > 0) {
    // Blank out the absolute matches so their path component can't re-match
    // as a root-relative link (".../sites/default/files/x.pdf" would
    // otherwise resolve against the wrong host).
    let scrubbed = text;
    for (const m of absolute) {
      scrubbed = scrubbed.split(m).join(" ".repeat(m.length));
    }
    for (const match of scrubbed.matchAll(RELATIVE_FILE_URL_RE)) {
      let resolved;
      try {
        resolved = new URL(match[2], baseUrl).href;
      } catch {
        continue;
      }
      add(resolved);
    }
  }
  return result;
}
