// Recursive file-URL collection from Strapi component values.
//
// Components (v3 "groups", modern "components", dynamic zones) embed their
// data inside the parent entry, so the only way to find the files they carry
// is to walk the JSON value: collect the .url of anything shaped like an
// upload file, and run the text extractor over embedded strings (component
// bodies hold markdown links too).
//
// An object counts as an upload file when it has a string `url` plus at
// least one file-ish sibling (`mime`, `ext`, `hash`, `provider`). The
// signal set deliberately excludes `name` — link-style components
// ({url, name}) would otherwise fabricate references to arbitrary pages.
//
// Known trade-off: a relation embedded INSIDE a component is walked too
// (v3 populates relations inline), so a related entry's media could be
// attributed to the parent page. Bounded by MAX_DEPTH and acceptable
// against the alternative — dropping every component-carried file.

const MAX_DEPTH = 8;
const FILE_SIGNAL_KEYS = ["mime", "ext", "hash", "provider"];

function isUploadShaped(obj) {
  if (typeof obj?.url !== "string" || obj.url.length === 0) return false;
  return FILE_SIGNAL_KEYS.some((k) => k in obj);
}

/**
 * Walk a component value and collect every file URL it carries.
 *
 * @param {*} value - the component field's value (object, array, anything)
 * @param {object} helpers
 * @param {(raw: string) => string|null} helpers.resolveUploadUrl - resolve a
 *        possibly-relative upload URL to absolute (adapter-specific base)
 * @param {(text: string) => string[]} helpers.extractText - extract file
 *        URLs from a string (extract-urls bound with the adapter's baseUrl)
 * @returns {string[]} deduplicated absolute URLs in first-seen order
 */
export function collectComponentFileUrls(value, helpers, depth = 0) {
  const seen = new Set();
  const out = [];
  const add = (u) => {
    if (typeof u === "string" && u.length > 0 && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  };
  walk(value, helpers, depth, add);
  return out;
}

function walk(value, helpers, depth, add) {
  if (depth > MAX_DEPTH || value === null || value === undefined) return;
  if (typeof value === "string") {
    for (const u of helpers.extractText(value) ?? []) add(u);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, helpers, depth + 1, add);
    return;
  }
  if (typeof value !== "object") return;
  if (isUploadShaped(value)) {
    add(helpers.resolveUploadUrl(value.url));
    return;
  }
  for (const v of Object.values(value)) walk(v, helpers, depth + 1, add);
}
