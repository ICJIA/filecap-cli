// src/commands/site-audit.js
// `filecap site-audit <site>` — score a site's web pages for accessibility
// (axe via audit.icjia.app/api/audit-url-page), sitemap-driven and independent
// of the file/PDF scores. Writes a purge-safe per-site sidecar
// (<auditsBase>/<site>/site-audit.json, sibling of latest/ since v1.39.0)
// with the score, breakdown, and issue-set history.
//
// Pipeline placement: scan → references → cross-references → audits → site-audit
// → web-rollup. Shares ~/.filecap/page-audit-cache.json with the audits stage.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadAuditCache, saveAuditCache, isCacheEntryFresh } from "../audits/cache.js";
import { fetchPageAuditScore } from "../audits/page-scorer.js";
import { createRetryingJsonFetcher } from "../audits/retrying-fetcher.js";
import { createLimiter } from "../util/concurrency.js";
import { resolveSitePageSet } from "../site-audit/page-set.js";
import { aggregateSite } from "../site-audit/aggregate.js";
import { collectIssueKeys, collectIssueKeysByPage } from "../site-audit/issue-keys.js";
import { readPriorSidecar, buildSidecar, writeSidecar } from "../site-audit/sidecar.js";

const DEFAULT_PAGE_AUDIT_ENDPOINT = "https://audit.icjia.app/api/audit-url-page";
const DEFAULT_PAGE_CACHE_PATH = path.join(os.homedir(), ".filecap", "page-audit-cache.json");
const DEFAULT_SITES_FILE = path.join(os.homedir(), ".filecap", "sites.json");
const DEFAULT_AUDITS_BASE = path.join(os.homedir(), "filecap-audits");

function defaultJsonFetcher(log) {
  return createRetryingJsonFetcher({ maxRetries: 6, baseDelayMs: 2000, maxDelayMs: 60000, log });
}

function loadSiteEntry(sitesFile, siteName) {
  const data = JSON.parse(fs.readFileSync(sitesFile, "utf8"));
  const sites = Array.isArray(data?.sites) ? data.sites : [];
  return sites.find((s) => s?.name === siteName) ?? null;
}

// v1.39.0 post-audit fix (red-1 R5): last-resort prior lookup. After a scan
// repoints latest/ to a fresh run dir, a pre-1.39 sidecar can survive ONLY
// inside runs/<ts>Z/ — invisible to both the canonical and latest/ reads, so
// the first post-fix site-audit would reset trend/scoreHistory and the purge
// would then delete the stranded copy permanently. Scavenge the retained run
// dirs newest-first (reverse-sorted *Z names, mirroring web-rollup's E2
// a11y-history migration). Read-only: the normal write path lands the fresh
// sidecar at the canonical location right after, so this self-retires.
function readNewestRunsSidecar(auditsBase, siteName) {
  const runsDir = path.join(auditsBase, siteName, "runs");
  let names;
  try {
    names = fs.readdirSync(runsDir);
  } catch {
    return null; // no runs/ dir
  }
  for (const name of names.filter((n) => n.endsWith("Z")).sort().reverse()) {
    const prior = readPriorSidecar(path.join(runsDir, name, "site-audit.json"));
    if (prior) return prior;
  }
  return null;
}

export async function runSiteAudit({
  siteName,
  sitesFile = process.env.FILECAP_SITES_FILE ?? DEFAULT_SITES_FILE,
  auditsBase = process.env.AUDITS_BASE ?? DEFAULT_AUDITS_BASE,
  auditEndpoint = DEFAULT_PAGE_AUDIT_ENDPOINT,
  pageCachePath = DEFAULT_PAGE_CACHE_PATH,
  ttlDays = 14,
  concurrency = 2,
  maxNewPages = 150,
  force = false,
  bearerToken,
  fetcher,
  fetchSitemap, // injectable for tests; undefined → page-set uses the live fetch
  now = new Date(),
  log = console.error,
}) {
  if (typeof siteName !== "string" || siteName.length === 0) {
    throw new Error("runSiteAudit: siteName is required");
  }
  const site = loadSiteEntry(sitesFile, siteName);
  if (!site) return { siteName, error: `site "${siteName}" not found in ${sitesFile}` };

  const latestDir = path.join(auditsBase, siteName, "latest");
  let cmsNdjson = "";
  try {
    cmsNdjson = fs.readFileSync(path.join(latestDir, "references-sidecar.ndjson"), "utf8");
  } catch {
    /* no sidecar — sitemap only */
  }

  const { pageSet } = await resolveSitePageSet({ site, cmsNdjson, fetchSitemap });
  log(`[site-audit] ${siteName}: ${pageSet.length} pages in set (sitemap ∪ CMS)`);

  const cache = loadAuditCache({ cachePath: pageCachePath });
  const httpFetcher = fetcher ?? defaultJsonFetcher(log);

  const toFetch = [];
  const cachedResults = new Map();
  for (const url of pageSet) {
    const c = cache[url];
    if (!force && isCacheEntryFresh(c, { now, ttlDays })) cachedResults.set(url, c);
    else toFetch.push(url);
  }
  const capped = Math.max(0, toFetch.length - maxNewPages);
  const fetchNow = toFetch.slice(0, maxNewPages);
  log(`[site-audit] ${siteName}: ${cachedResults.size} cached, ${fetchNow.length} to fetch, ${capped} capped`);

  let errored = 0;
  const fetched = new Map();
  const limit = createLimiter(concurrency);
  await Promise.all(
    fetchNow.map((url) =>
      limit(async () => {
        try {
          const result = await fetchPageAuditScore({ pageUrl: url, auditEndpoint, bearerToken, force, fetcher: httpFetcher });
          if (result === null) { errored++; return; }
          // v1.39.0: a 200 without a numeric score is an error, not a
          // cacheable success — count it and keep it out of the page cache.
          if (!Number.isFinite(result.score)) {
            errored++;
            log(`[site-audit] ${siteName} WARN ${url}: no score in response`);
            return;
          }
          const stored = { ...result, checkedAt: now.toISOString() };
          cache[url] = stored;
          fetched.set(url, stored);
        } catch (err) {
          errored++;
          log(`[site-audit] ${siteName} WARN ${url}: ${err?.message ?? err}`);
        }
      }),
    ),
  );

  try {
    saveAuditCache({ cachePath: pageCachePath, cache });
  } catch (err) {
    log(`[site-audit] ${siteName} WARN: failed to persist page cache: ${err.message}`);
  }

  const scoredPages = [];
  for (const url of pageSet) {
    const r = fetched.get(url) ?? cachedResults.get(url);
    if (r && typeof r.score === "number") scoredPages.push({ pageUrl: url, ...r });
  }

  const aggregate = aggregateSite(scoredPages);
  const issueKeys = collectIssueKeys(scoredPages);
  const issueKeysByPage = collectIssueKeysByPage(scoredPages);
  const auditedAt = now.toISOString();
  // v1.39.0 (Interface Contract 2): the sidecar's canonical home is
  // <auditsBase>/<slug>/site-audit.json — a sibling of latest/, so run
  // purges can never take it out. Prior runs wrote latest/site-audit.json;
  // read that as a one-release fallback and never delete it.
  const sidecarPath = path.join(auditsBase, siteName, "site-audit.json");
  const legacySidecarPath = path.join(latestDir, "site-audit.json");
  // Prior precedence: canonical → legacy latest/ → newest stranded runs/*Z
  // copy (v1.39.0 audit fix, red-1 R5 — see readNewestRunsSidecar above).
  const prior =
    readPriorSidecar(sidecarPath) ??
    readPriorSidecar(legacySidecarPath) ??
    readNewestRunsSidecar(auditsBase, siteName);
  const sidecar = buildSidecar({
    siteName, auditedAt, endpoint: auditEndpoint,
    coverage: { pagesInSet: pageSet.length, scored: scoredPages.length, errored, capped },
    aggregate, issueKeys, issueKeysByPage, prior,
  });
  writeSidecar(sidecarPath, sidecar);
  log(`[site-audit] ${siteName}: score ${aggregate.score ?? "n/a"} (${aggregate.grade ?? "—"}), ${scoredPages.length}/${pageSet.length} pages → ${sidecarPath}`);

  return { siteName, scored: scoredPages.length, errored, capped, score: aggregate.score, grade: aggregate.grade, sidecarPath };
}
