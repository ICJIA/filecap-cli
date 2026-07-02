// File-URL extraction from arbitrary text (markdown body, HTML, plain
// prose).
//
// v1.39.0 (B6) — rewritten from one lazy mega-regex to span-then-verify:
//   1. grab maximal URL-ish spans (absolute, root-relative, and quoted
//      href/src attribute values — the quoted form is what lets filenames
//      with spaces extract whole),
//   2. trim trailing prose punctuation (".,;:!") and unbalanced ")" / "]"
//      the way markdown autolinkers do,
//   3. keep the span only when an audited extension sits at a real
//      boundary: end of URL, "?query" or "#fragment" (whitespace, quotes
//      and <> can never appear inside a span). This makes
//      "report.doc.pdf" match in full, "report(1).pdf" keep its parens,
//      and "report.pdfx" not match at all.
//
// The extension whitelist is pinned (pdf/docx?/xlsx?/pptx?/zip) — widening
// it is out of scope; image/page references are handled structurally
// elsewhere.

const AUDITED_EXT_PATTERN = "pdf|docx?|xlsx?|pptx?|zip";

// The audited extension must be followed by end-of-URL, a query or a
// fragment. Used on trimmed spans AND on quoted attribute / url-string
// values (which may contain spaces, hence the permissive `.*`).
const AUDITED_TAIL_RE = new RegExp(
  `\\.(?:${AUDITED_EXT_PATTERN})(?:[?#].*)?$`,
  "i",
);

// Maximal absolute-URL spans: stop only at characters that cannot appear
// raw in a URL (whitespace incl. NBSP via \s, quotes, angle brackets,
// backtick, braces, pipe, backslash, caret). Parens and brackets are
// ALLOWED — they occur in real filenames ("report(1).pdf").
const ABSOLUTE_SPAN_RE = /https?:\/\/[^\s"'<>`{}|\\^]+/gi;

// Root-relative spans ("/files/x.pdf"). The leading character class anchors
// the match to a link-ish boundary so "files/local.pdf" (no leading slash)
// and the path half of an absolute URL don't match.
const RELATIVE_SPAN_RE = /(^|[\s"'<>([=])(\/[^\s"'<>`{}|\\^]+)/g;

// Quoted href/src attribute values. Quotes delimit the URL exactly, so
// spaced filenames survive here even though free-text spans stop at spaces.
const ATTR_VALUE_RE = /\b(?:href|src)\s*=\s*("[^"]*"|'[^']*')/gi;

// v1.39.0 audit fix (red-2 R-2a): a maximal span glues comma/semicolon-
// joined URL LISTS ("…a.pdf,https://…b.pdf") into ONE unmatchable URL,
// losing both references. Break the span before every ","/";" that is
// immediately followed by a scheme — each piece then trims and verifies
// independently. Separators NOT followed by a scheme stay in the span
// (they are legal path characters; making ","/";" a general boundary
// would re-open the pre-B6 truncation bug).
const SPAN_LIST_SPLIT_RE = /(?<=[,;])(?=https?:\/\/)/i;

// v1.39.0 audit fix (red-2 R-2b): quoted attribute values arrive
// HTML-entity-encoded ("…a.pdf&amp;v=1"). Decode the basic entities in ONE
// pass (so "&amp;quot;" single-decodes to "&quot;", never twice). Applies
// to the quoted-attribute path ONLY — bare text spans are never decoded.
const BASIC_ENTITIES = {
  "&amp;": "&",
  "&#38;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&lt;": "<",
  "&gt;": ">",
};
const BASIC_ENTITY_RE = /&(?:amp|quot|lt|gt|#38|#39);/g;

function decodeBasicEntities(s) {
  return s.replace(BASIC_ENTITY_RE, (m) => BASIC_ENTITIES[m]);
}

// After decoding, a "&" directly following the audited extension is a query
// separator (cache-busters like "a.pdf&v=1"). B3's canonicalization strips
// only "?"-queries, so restore the pre-1.39 outcome by truncating the value
// at that "&" — the extracted URL is the file URL itself (key "a.pdf").
// Lazy prefix so "a.pdf&b.pdf&v=1" truncates at the FIRST extension
// boundary, exactly like the old lazy regex. A mid-name "&" (NOFOQ&A.pdf)
// never matches because it does not follow an audited extension.
const ATTR_AMP_QUERY_RE = new RegExp(
  `^([^?#]*?\\.(?:${AUDITED_EXT_PATTERN}))&`,
  "i",
);

const TRAILING_PROSE_PUNCT = new Set([".", ",", ";", ":", "!"]);

function countChar(s, ch) {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

// Autolinker-style trailing trim: prose punctuation always; ")" and "]"
// only while unbalanced (so "report(1).pdf" keeps its closing paren but
// "(see …/a.pdf)" loses the prose one).
function trimTrailingPunct(span) {
  let s = span;
  while (s.length > 0) {
    const last = s[s.length - 1];
    if (TRAILING_PROSE_PUNCT.has(last)) {
      s = s.slice(0, -1);
      continue;
    }
    if (last === ")" && countChar(s, ")") > countChar(s, "(")) {
      s = s.slice(0, -1);
      continue;
    }
    if (last === "]" && countChar(s, "]") > countChar(s, "[")) {
      s = s.slice(0, -1);
      continue;
    }
    break;
  }
  return s;
}

/**
 * True when `url` ends in an audited file extension at a real boundary
 * (end of string, "?query" or "#fragment"). Shared by the extractor and by
 * the Strapi adapters' url-string filter (v1.39.0, B7) so page links never
 * enter referencedFiles.
 *
 * @param {*} url
 * @returns {boolean}
 */
export function isAuditedFileUrl(url) {
  return typeof url === "string" && AUDITED_TAIL_RE.test(url);
}

/**
 * Extract audited-extension file URLs from free text.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {string} [options.baseUrl] - when set, root-relative links
 *        ("/uploads/x.pdf") are also extracted and resolved against this
 *        base's origin. Without it, behavior is absolute-only (unchanged).
 * @returns {string[]} deduplicated URLs in first-seen order, absolute
 *        spans first, then attribute values, then root-relative links.
 *        Absolute URLs are returned verbatim; resolved relative links come
 *        back percent-encoded by `new URL`.
 */
export function extractFileUrls(text, options = {}) {
  if (typeof text !== "string" || text.length === 0) return [];
  const baseUrl =
    typeof options.baseUrl === "string" && options.baseUrl.length > 0
      ? options.baseUrl
      : null;
  const seen = new Set();
  const result = [];
  const add = (u) => {
    if (!seen.has(u)) {
      seen.add(u);
      result.push(u);
    }
  };

  // Accepted raw substrings, scrubbed from the text before the relative
  // pass so an absolute URL's path (or an already-captured attr value)
  // can't re-match as a root-relative link against the wrong host.
  const accepted = [];

  for (const span of text.match(ABSOLUTE_SPAN_RE) ?? []) {
    // v1.39.0 audit fix (R-2a): comma/semicolon-joined URL lists — each
    // piece keeps its trailing separator, which trimTrailingPunct removes.
    for (const piece of span.split(SPAN_LIST_SPLIT_RE)) {
      const trimmed = trimTrailingPunct(piece);
      if (!isAuditedFileUrl(trimmed)) continue;
      add(trimmed);
      accepted.push(trimmed);
    }
  }

  for (const m of text.matchAll(ATTR_VALUE_RE)) {
    // v1.39.0 audit fix (R-2b): decode entities, then treat a "&" right
    // after the audited extension as the start of a query and drop it.
    let value = decodeBasicEntities(m[1].slice(1, -1).trim());
    const ampQuery = value.match(ATTR_AMP_QUERY_RE);
    if (ampQuery) value = ampQuery[1];
    if (!isAuditedFileUrl(value)) continue;
    if (/^https?:\/\//i.test(value)) {
      add(value);
      accepted.push(value);
    } else if (baseUrl && value.startsWith("/")) {
      let resolved;
      try {
        resolved = new URL(value, baseUrl).href;
      } catch {
        continue;
      }
      add(resolved);
      accepted.push(value);
    }
  }

  if (baseUrl) {
    let scrubbed = text;
    for (const a of accepted) {
      scrubbed = scrubbed.split(a).join(" ".repeat(a.length));
    }
    for (const match of scrubbed.matchAll(RELATIVE_SPAN_RE)) {
      const trimmed = trimTrailingPunct(match[2]);
      if (!isAuditedFileUrl(trimmed)) continue;
      let resolved;
      try {
        resolved = new URL(trimmed, baseUrl).href;
      } catch {
        continue;
      }
      add(resolved);
    }
  }
  return result;
}
