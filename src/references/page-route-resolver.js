// CMS entry → deployed page URL, driven by each site's `contentTypeRoutes`
// map in sites.json.
//
// v1.65.0 — routes may now carry more than `:slug`. Before this release a
// route was a flat string with a single `:slug` token, which silently
// produced a wrong URL for every content type whose front end nests detail
// pages under a category segment. ARI meetings are the worst case: the
// configured `/adultredeploy/news/:slug/` 404s for 94 of 101 entries, so
// 199 agenda/minutes PDFs were attributed to pages that do not exist, while
// the real `/adultredeploy/about/meetings/<committee>/<slug>` pages showed
// no files at all.
//
// A route is therefore either:
//
//   "post": "/news/:slug/"                       // flat (unchanged)
//   "meeting": {                                 // multi-segment
//     "route": "/about/meetings/:category/:slug",
//     "segments": { "category": { "regular": "regular-oversight" } }
//   }
//
// Every `:token` is resolved against the entry itself — `:slug` is not
// special-cased. `segments[token]` optionally translates a stored field
// value into the segment the front end actually renders (ARI stores
// `category: "regular"` but routes it as `regular-oversight`). A token
// with no resolvable value yields null: a missing page URL is recoverable
// downstream, a confidently wrong one is not.

// Tokens are `:name` or `:dotted.path`. The trailing `(?![\w.])` stops the
// match at a path separator so `/:category/:slug` reads as two tokens.
const TOKEN_RE = /:([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)(?![\w.])/g;

/**
 * Read a dotted path off an entry, following v3/v4 field nesting. v3 stores
 * fields flat on the entry; v4 nests them under `attributes`. Try the flat
 * path first either way — `id` sits at the top level on both.
 *
 * @param {object} entry
 * @param {string} path - "category" or "committee.slug"
 * @param {boolean} isV4
 * @returns {unknown}
 */
function readField(entry, path, isV4) {
  const parts = path.split(".");
  const roots = isV4 ? [entry, entry?.attributes] : [entry];
  for (const root of roots) {
    let cur = root;
    for (const part of parts) {
      if (cur === null || typeof cur !== "object") {
        cur = undefined;
        break;
      }
      cur = cur[part];
    }
    // v4 relations wrap the payload one more level: { data: { attributes } }.
    if (cur && typeof cur === "object" && !Array.isArray(cur)) {
      const unwrapped = cur?.data?.attributes ?? cur?.attributes;
      if (unwrapped !== undefined) cur = unwrapped;
    }
    if (cur !== undefined && cur !== null) return cur;
  }
  return undefined;
}

/**
 * Coerce a resolved field value to a URL path segment. Numbers are valid
 * (a numeric category id is still a segment); objects and empty strings are
 * not.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function toSegment(value) {
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Normalize either route form to `{ route, segments }`.
 *
 * @param {string|object} raw
 * @returns {{ route: string, segments: object } | null}
 */
function normalizeRoute(raw) {
  if (typeof raw === "string") return { route: raw, segments: {} };
  if (raw && typeof raw === "object" && typeof raw.route === "string") {
    return {
      route: raw.route,
      segments: raw.segments && typeof raw.segments === "object" ? raw.segments : {},
    };
  }
  return null;
}

/**
 * Build a deployed page URL for one CMS entry.
 *
 * Returns null — never a partially-filled URL — when the content type has no
 * route, the base is missing, or any `:token` in the route has no usable
 * value on the entry.
 *
 * @param {object} args
 * @param {string} args.contentType     - singular content-type name
 * @param {object} args.entry           - the raw CMS entry
 * @param {boolean} [args.isV4]         - entry nests fields under `attributes`
 * @param {string} args.siteFrontendUrl - front-end origin (path prefixes live in the route)
 * @param {object} args.contentTypeRoutes
 * @returns {string|null}
 */
export function resolvePageUrl({
  contentType,
  entry,
  isV4 = false,
  siteFrontendUrl,
  contentTypeRoutes,
}) {
  const spec = normalizeRoute(contentTypeRoutes?.[contentType]);
  if (!spec) return null;

  // Strapi v3 has no draft/publish system, so the v3 sites carry a plain
  // `isPublished` boolean that the front end honours by not rendering a
  // route at all. Only an explicit `false` counts — an absent field means
  // the content type doesn't model publication state. (v4 needs no
  // equivalent: its REST API omits drafts unless asked for them.)
  if (readField(entry, "isPublished", isV4) === false) return null;

  const base = String(siteFrontendUrl ?? "").replace(/\/+$/, "");
  if (!base) return null;

  let failed = false;
  const filledPath = spec.route.replace(TOKEN_RE, (_match, token) => {
    const raw = toSegment(readField(entry, token, isV4));
    if (raw === null) {
      failed = true;
      return "";
    }
    const mapped = spec.segments?.[token]?.[raw];
    return encodeURIComponent(mapped ?? raw);
  });
  if (failed) return null;

  return `${base}${filledPath}`;
}
