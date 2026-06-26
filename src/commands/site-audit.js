// src/commands/site-audit.js
// `filecap site-audit <site>` — score a site's web pages for accessibility
// (axe via audit.icjia.app/api/audit-url-page), sitemap-driven and independent
// of the file/PDF scores. Writes a purge-exempt per-site sidecar
// (latest/site-audit.json) with the score, breakdown, and issue-set history.
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
import { collectIssueKeys } from "../site-audit/issue-keys.js";
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
  const auditedAt = now.toISOString();
  const sidecarPath = path.join(latestDir, "site-audit.json");
  const prior = readPriorSidecar(sidecarPath);
  const sidecar = buildSidecar({
    siteName, auditedAt, endpoint: auditEndpoint,
    coverage: { pagesInSet: pageSet.length, scored: scoredPages.length, errored, capped },
    aggregate, issueKeys, prior,
  });
  writeSidecar(sidecarPath, sidecar);
  log(`[site-audit] ${siteName}: score ${aggregate.score ?? "n/a"} (${aggregate.grade ?? "—"}), ${scoredPages.length}/${pageSet.length} pages → ${sidecarPath}`);

  return { siteName, scored: scoredPages.length, errored, capped, score: aggregate.score, grade: aggregate.grade, sidecarPath };
}
