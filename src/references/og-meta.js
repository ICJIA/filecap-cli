// v1.21.0 — Open Graph metadata fetch for the /sites roster + tooling cards.
//
// The web-rollup bundle shows a thumbnail, title, and one-line description for
// every content site and tooling app. Rather than hand-author those, we read
// each site's own `og:image` / `og:title` / `og:description` (with
// `twitter:image` as an image fallback). A 2026-06-05 probe confirmed every
// main *.illinois.gov site plus markdown / squish / metapeek / ipsumify expose
// clean OG tags; SPAs without them (e.g. icjia-qr) fall back to the ICJIA logo
// tile at render time.
//
// Everything here is best-effort and fully injectable: `fetchImpl` defaults to
// the global fetch but tests pass a stub so the suite never hits the network.

import { safeFetch } from "../util/safe-fetch.js";

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_IMAGE_BYTES = 5_000_000;
const USER_AGENT = "filecap-og/1.0 (+https://github.com/ICJIA/icjia-fleet-audit)";

/**
 * Fetch a page and extract its Open Graph metadata.
 *
 * @param {string} url - the page to read (http/https only)
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {Function} [opts.fetchImpl] - fetch-compatible impl (for tests)
 * @returns {Promise<{ image: string|null, title: string|null, description: string|null }>}
 *   Relative `og:image` URLs are resolved against `url`. Never throws.
 */
export async function fetchOgMeta(url, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const empty = { image: null, title: null, description: null, reachable: false };
  let base;
  try {
    base = new URL(url);
  } catch {
    return empty;
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") return empty;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let html;
  let reachable = false;
  try {
    // safeFetch: refuse a scraped URL that points at a private/metadata host
    // and never chase a redirect into one (redirect: "manual" internally).
    const res = await safeFetch(url, {
      fetchImpl,
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,*/*" },
    });
    if (!res) return empty;
    // The server answered (any status, incl. a gated 401) — the site is up.
    reachable = true;
    if (!res.ok) return { image: null, title: null, description: null, reachable };
    html = await res.text();
  } catch {
    return empty;
  } finally {
    clearTimeout(timer);
  }
  if (!html || typeof html !== "string") return { image: null, title: null, description: null, reachable };

  const meta = parseMetaTags(html);
  const rawImage = meta["og:image"] || meta["og:image:url"] || meta["twitter:image"] || null;
  let image = null;
  if (rawImage) {
    try {
      image = new URL(decodeEntities(rawImage), base).toString();
    } catch {
      image = null;
    }
  }
  const title = meta["og:title"] ? decodeEntities(meta["og:title"]) : null;
  const description = meta["og:description"] ? decodeEntities(meta["og:description"]) : null;
  return { image, title, description, reachable };
}

/**
 * Fetch an image's bytes so the caller can write them into the bundle. Returns
 * the chosen file extension + a Buffer, or null on any failure (timeout,
 * non-image content type, empty, or over the size cap). Never throws.
 *
 * @param {string} imageUrl
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxBytes]
 * @param {Function} [opts.fetchImpl]
 * @returns {Promise<{ ext: string, buffer: Buffer }|null>}
 */
export async function fetchImageBytes(imageUrl, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_IMAGE_BYTES,
  fetchImpl = fetch,
} = {}) {
  let u;
  try {
    u = new URL(imageUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await safeFetch(imageUrl, {
      fetchImpl,
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT },
    });
    if (!res || !res.ok) return null;
    const ct = (res.headers?.get?.("content-type") || "").toLowerCase();
    const ext = extForImage(ct, imageUrl);
    if (!ext) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0 || buffer.length > maxBytes) return null;
    return { ext, buffer };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── internals ────────────────────────────────────────────────────────────────

/**
 * Parse every <meta> tag into a `{ key: content }` map, keyed by the tag's
 * `property` (or `name`) attribute lower-cased. First occurrence wins. Tolerant
 * of attribute order and single/double/unquoted values.
 */
export function parseMetaTags(html) {
  const map = {};
  const metaRe = /<meta\b[^>]*>/gi;
  let m;
  while ((m = metaRe.exec(html)) !== null) {
    const tag = m[0];
    const key = (attr(tag, "property") || attr(tag, "name") || "").toLowerCase();
    if (!key) continue;
    const content = attr(tag, "content");
    if (content === null || content === undefined) continue;
    if (!(key in map)) map[key] = content;
  }
  return map;
}

// Read a single attribute value out of one tag. The leading (?:^|\s) keeps
// `content=` from matching `data-content=` and friends.
function attr(tag, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s">]+))`, "i");
  const m = re.exec(tag);
  if (!m) return null;
  const v = m[2] ?? m[3] ?? m[4] ?? "";
  return v.trim() || null;
}

function extForImage(contentType, url) {
  const ct = contentType || "";
  if (ct.includes("png")) return "png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("svg")) return "svg";
  if (ct.includes("avif")) return "avif";
  // No usable content type — fall back to the URL's own extension.
  const m = /\.(png|jpe?g|webp|gif|svg|avif)(?:[?#]|$)/i.exec(url || "");
  if (m) return m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  return null;
}

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", trade: "™", reg: "®", copy: "©",
};

// Decode the HTML entities that realistically show up in og:title /
// og:description (numeric + a small named set). Best-effort; unknown named
// entities are left as-is.
export function decodeEntities(s) {
  if (!s) return s;
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (whole, name) => {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : whole;
    })
    .trim();
}

function safeCodePoint(cp) {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return "";
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}
