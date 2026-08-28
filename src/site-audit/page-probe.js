// One HTTP look at a page URL, for the sitemap-completeness check.
//
// v1.68.0 — `redirect: "manual"` is the entire reason this module exists.
// The 2026-08-27 review used `curl -L`, which followed ilfvcc's
// /counties/* → /councils/ 301s and reported the TARGET's 200. That turned
// 126 deliberately-retired URLs into a phantom "sitemap gap" and nearly
// produced a change that would have resurrected deleted pages. A checker
// that follows redirects cannot tell "this page is missing from the sitemap"
// from "this page was retired and now redirects".
//
// Only enough of the body is read to find a robots meta tag: a noindex page
// is deliberately absent from a sitemap and must not be reported.

import { safeFetch } from "../util/safe-fetch.js";

// A robots directive lives in <head>; 64 kB is far more than enough and
// keeps a huge page from being pulled into memory over the wire.
const MAX_SNIFF_BYTES = 64 * 1024;

/**
 * Does this response ask not to be indexed? Checks the X-Robots-Tag header
 * and the robots/googlebot meta tag. Deliberately narrow: it matches a
 * directive, not the word "noindex" appearing in prose.
 *
 * @param {string} html
 * @param {string|null} xRobotsTag
 * @returns {boolean}
 */
export function readsAsNoindex(html, xRobotsTag) {
  if (typeof xRobotsTag === "string" && /\bnoindex\b/i.test(xRobotsTag)) return true;
  if (typeof html !== "string" || html === "") return false;
  const meta = /<meta\s+[^>]*name\s*=\s*["']?(?:robots|googlebot)["']?[^>]*>/gi;
  for (const m of html.matchAll(meta)) {
    const content = /content\s*=\s*["']?([^"'>]*)/i.exec(m[0]);
    if (content && /\bnoindex\b/i.test(content[1])) return true;
  }
  return false;
}

/**
 * Build a probe: URL → { status, location, indexable, error }.
 *
 * A network failure resolves to `status: null` rather than throwing, so one
 * unreachable URL cannot fail a run or be mistaken for a finding.
 *
 * @param {object} [deps]
 * @param {Function} [deps.fetchImpl] test seam
 * @param {number} [deps.timeoutMs]
 * @returns {(url: string) => Promise<object>}
 */
export function createPageProbe({ fetchImpl, timeoutMs = 20000 } = {}) {
  return async function probe(url) {
    try {
      const res = await (fetchImpl
        ? fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) })
        : safeFetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) }));

      const status = res.status;
      const location = res.headers?.get?.("location") ?? undefined;
      const xRobots = res.headers?.get?.("x-robots-tag") ?? null;

      // Only a 200 needs its body inspected: a redirect or an error is
      // already decisive, and reading them wastes a round trip.
      let indexable = true;
      if (status >= 200 && status < 300) {
        if (xRobots && /\bnoindex\b/i.test(xRobots)) {
          indexable = false;
        } else {
          let html = "";
          try {
            html = (await res.text()).slice(0, MAX_SNIFF_BYTES);
          } catch {
            html = ""; // unreadable body — assume indexable, the status stands
          }
          indexable = !readsAsNoindex(html, xRobots);
        }
      }
      return { status, ...(location ? { location } : {}), indexable };
    } catch (err) {
      return { status: null, error: err?.message ?? String(err) };
    }
  };
}
