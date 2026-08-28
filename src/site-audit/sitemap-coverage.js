// Sitemap completeness: which of a site's live pages are missing from its
// sitemap.xml, and which absences are deliberate?
//
// v1.68.0 — a hand-run comparison of "CMS pages ∪ sitemap" on 2026-08-27
// reported three sites as having sitemap gaps. Two were wrong:
//
//   - ilfvcc's /counties/* and /circuits/* are 301s. The pages were retired
//     deliberately (SFY27: the detail pages carried outdated council data and
//     /councils/ replaced them). A `curl -L` followed the redirect and
//     reported the target's 200, hiding the fact entirely.
//   - infonet's /tabs/* return 200 but send noindex — they duplicate content
//     on /screenshots/ and /resources/ and are excluded on purpose.
//
// Only the legacy Research Hub's 47 pages were genuine. A checker that does
// not follow those two rules produces mostly false alarms, and a report that
// is mostly false alarms gets ignored — so classification is the whole point
// of this module, not the set difference, which is trivial.
//
// The probe is injected: this module is pure and testable without a network.

/** Absence verdicts, in the order a reader should care about them. */
export const VERDICTS = ["omission", "broken", "retired", "noindex", "unknown"];

const DEFAULT_MAX_PROBES = 300;

/** Compare URLs ignoring a trailing slash, which sitemaps and CMSes disagree on. */
function normalize(url) {
  return String(url ?? "").trim().replace(/\/+$/, "");
}

/**
 * Turn one probe result into a verdict.
 *
 *   3xx            → retired  (the site moved it on purpose)
 *   200 + noindex  → noindex  (present, deliberately unlisted)
 *   4xx/5xx        → broken   (a different problem — see docs/findings/)
 *   200 + index    → omission (the only genuine finding)
 *   no status      → unknown  (never guess; an unreachable probe is not evidence)
 *
 * @param {{status:number|null, location?:string, indexable?:boolean, error?:string}} probeResult
 * @returns {{verdict:string, status:number|null, location?:string, error?:string}}
 */
export function classifyCandidate({ status = null, location, indexable = true, error } = {}) {
  const base = { status, ...(location !== undefined ? { location } : {}), ...(error ? { error } : {}) };
  if (status === null || status === undefined) return { ...base, verdict: "unknown" };
  if (status >= 300 && status < 400) return { ...base, verdict: "retired" };
  if (status >= 400) return { ...base, verdict: "broken" };
  if (indexable === false) return { ...base, verdict: "noindex" };
  return { ...base, verdict: "omission" };
}

/**
 * Find the site's live pages that its sitemap does not list, classified.
 *
 * Only URLs absent from the sitemap are probed, so the cost is proportional to
 * the problem, not to the site. `maxProbes` bounds a misconfigured site from
 * turning one run into thousands of requests; whatever it drops is reported as
 * `skipped` rather than silently ignored.
 *
 * @param {object} args
 * @param {string[]} [args.sitemapUrls]
 * @param {string[]} [args.cmsPageUrls]  the site's own page URLs, from the CMS
 * @param {(url:string)=>Promise<object>} args.probe
 * @param {number} [args.maxProbes]
 * @param {number} [args.concurrency]
 * @returns {Promise<{omissions:Array,broken:Array,retired:Array,noindex:Array,unknown:Array,probed:number,skipped:number}>}
 */
export async function findSitemapOmissions({
  sitemapUrls = [],
  cmsPageUrls = [],
  probe,
  maxProbes = DEFAULT_MAX_PROBES,
  concurrency = 4,
} = {}) {
  const listed = new Set((Array.isArray(sitemapUrls) ? sitemapUrls : []).map(normalize));

  const seen = new Set();
  const candidates = [];
  for (const u of Array.isArray(cmsPageUrls) ? cmsPageUrls : []) {
    const n = normalize(u);
    if (!n || listed.has(n) || seen.has(n)) continue;
    seen.add(n);
    candidates.push(u);
  }

  const toProbe = candidates.slice(0, Math.max(0, maxProbes));
  const skipped = candidates.length - toProbe.length;

  const out = { omissions: [], broken: [], retired: [], noindex: [], unknown: [], probed: toProbe.length, skipped };
  const bucket = { omission: out.omissions, broken: out.broken, retired: out.retired, noindex: out.noindex, unknown: out.unknown };

  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, toProbe.length) }, async () => {
      while (i < toProbe.length) {
        const url = toProbe[i++];
        let result;
        try {
          result = classifyCandidate(await probe(url));
        } catch (err) {
          // A probe that throws is a fact about the probe, not the site.
          result = classifyCandidate({ status: null, error: err?.message ?? String(err) });
        }
        bucket[result.verdict].push({ url, ...result });
      }
    }),
  );
  return out;
}
