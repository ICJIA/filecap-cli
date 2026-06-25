// `filecap audits` — walks an inventory NDJSON and scores every PDF via
// audit.icjia.app's /api/audit-url endpoint. Other file types (docx, xlsx,
// pptx, image, etc.) pass through unchanged — they have their own in-app
// remediation checkers and aren't in scope for this scorer.
//
// Pipeline placement (v1.9.0):
//   scan → references → cross-references → audits → web-rollup
//
// Each PDF gets `entry.audit = { score, grade, reportUrl, reportId,
// reportExpiresAt, audited, checkedAt, cached }` attached. Errors / skips
// surface as `entry.audit = { error: "..." }` or `{ skipped: "..." }` so
// the report layer can render an explicit cell instead of pretending the
// audit never ran.

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  loadAuditCache,
  saveAuditCache,
  isCacheEntryFresh,
  DEFAULT_CACHE_PATH,
} from "../audits/cache.js";
import { fetchAuditScore } from "../audits/score-fetcher.js";
import { fetchPageAuditScore } from "../audits/page-scorer.js";
import { createRetryingJsonFetcher } from "../audits/retrying-fetcher.js";

const DEFAULT_AUDIT_ENDPOINT = "https://audit.icjia.app/api/audit-url";
const DEFAULT_PAGE_AUDIT_ENDPOINT = "https://audit.icjia.app/api/audit-url-page";
// Page cache lives next to the PDF audit cache. URL-keyed (the URL is the
// stable identity for a page; the rendered bytes change every request).
const DEFAULT_PAGE_CACHE_PATH = path.join(
  os.homedir(),
  ".filecap",
  "page-audit-cache.json",
);

// PDF is the only category we score. The others have native checkers in
// their authoring tools (Word, Excel, PowerPoint) — duplicating that work
// here adds noise without value.
function isScoreableEntry(entry) {
  return entry && entry.extension === "pdf" && entry.category === "pdf";
}

// The default HTTP layer retries 429 (audit.icjia.app's 100/min per-IP rate
// limit) and transient 5xx, honoring Retry-After. Without this a big batch
// of cold PDFs trips the limiter and every over-limit request is recorded as
// a permanent error. Tests inject their own fetcher and bypass this.
function defaultJsonFetcher(log) {
  return createRetryingJsonFetcher({
    maxRetries: 6,
    baseDelayMs: 2000,
    maxDelayMs: 60000,
    log,
  });
}

// Bounded-concurrency mapper. Each task is a () => Promise. Limits how many
// run at once — important for staying under audit.icjia.app's global 100/min
// IP-based rate limiter and its 2-at-a-time pdfAnalyzer semaphore.
async function mapWithConcurrency(items, limit, taskFor) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await taskFor(items[i], i);
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

export async function runAudits({
  inventoryPath,
  outputPath,
  cachePath = DEFAULT_CACHE_PATH,
  auditEndpoint = DEFAULT_AUDIT_ENDPOINT,
  bearerToken,
  fetcher,
  concurrency = 2,
  force = false,
  ttlDays = 30,
  pathPrefix = "",
  // v1.10.0: page-audit options. After scoring PDFs, walks every
  // entry.references[] in the inventory, dedupes unique pageUrls, scores
  // each via /api/audit-url-page (axe-core via headless Chromium), and
  // attaches the result back to each reference as ref.pageAudit. ON by
  // default in 1.10.0; pass skipPages=true to opt out for environments
  // where the page-audit endpoint isn't deployed yet.
  pageAuditEndpoint = DEFAULT_PAGE_AUDIT_ENDPOINT,
  pageCachePath = DEFAULT_PAGE_CACHE_PATH,
  pageTtlDays = 14, // pages change more than file content; shorter TTL
  skipPages = false,
  log = console.error,
}) {
  if (typeof inventoryPath !== "string" || inventoryPath.length === 0) {
    throw new Error("runAudits: inventoryPath is required");
  }
  if (typeof outputPath !== "string" || outputPath.length === 0) {
    throw new Error("runAudits: outputPath is required");
  }

  const raw = await fs.readFile(inventoryPath, "utf8");
  const lines = raw.split("\n");
  const records = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { /* skip malformed line */ }
  }

  // The publicUrlBase lives in the inventory header (kind: *-header). Each
  // entry carries `path` relative to that base. The public URL of any
  // given file is publicUrlBase + path. The audit endpoint needs the full
  // URL, so we resolve here.
  let publicUrlBase = null;
  for (const r of records) {
    if (typeof r?.kind === "string" && r.kind.endsWith("-header")) {
      publicUrlBase = r?.metadata?.publicUrlBase ?? null;
      break;
    }
  }
  // Normalise the optional pathPrefix to "/<segment>" (no trailing slash)
  // for clean concatenation. Empty when unset (default).
  const cleanPrefix = pathPrefix
    ? "/" + String(pathPrefix).replace(/^\/+|\/+$/g, "")
    : "";

  function resolveEntryUrl(entry) {
    if (typeof entry.publicUrl === "string" && entry.publicUrl.length > 0) {
      return entry.publicUrl;
    }
    if (!publicUrlBase || typeof entry.path !== "string") return null;
    const base = publicUrlBase.replace(/\/+$/, "");
    const rel = entry.path.replace(/^\/+/, "");
    if (!rel) return null;
    // URL-encode each path segment so spaces, parens, &c. become valid
    // URL bytes. Don't encode the segment separators themselves. This
    // matters for the git Nuxt sites where filenames may carry spaces
    // (Strapi sites all use hash-mangled filenames with no spaces).
    const encoded = rel.split("/").map((s) => encodeURIComponent(s)).join("/");
    return `${base}${cleanPrefix}/${encoded}`;
  }

  const cache = loadAuditCache({ cachePath });
  const httpFetcher = fetcher ?? defaultJsonFetcher(log);
  const now = new Date();

  // Identify the PDFs we need to actually call the endpoint for. Entries
  // with a fresh cache hit short-circuit before any HTTP.
  const pdfsToAudit = [];
  for (let i = 0; i < records.length; i++) {
    const entry = records[i];
    if (!isScoreableEntry(entry)) continue;
    const url = resolveEntryUrl(entry);
    if (!url) {
      entry.audit = { skipped: "no-public-url" };
      continue;
    }
    // Stash resolved URL on the entry for the fetch loop below to read
    // without re-computing.
    entry.__auditUrl = url;
    const sha = entry.sha256;
    if (!force && sha && isCacheEntryFresh(cache[sha], { now, ttlDays })) {
      const c = cache[sha];
      entry.audit = {
        score: c.score,
        grade: c.grade,
        reportUrl: c.reportUrl,
        reportId: c.reportId,
        reportExpiresAt: c.reportExpiresAt,
        audited: c.audited,
        checkedAt: c.checkedAt,
        cached: true,
      };
      continue;
    }
    pdfsToAudit.push(i);
  }

  log(
    `[audits] ${records.length} records total; ${pdfsToAudit.length} PDFs to audit ` +
      `(others cached or non-PDF)`,
  );

  let auditedCount = 0;
  let errorCount = 0;
  await mapWithConcurrency(pdfsToAudit, concurrency, async (recordIdx) => {
    const entry = records[recordIdx];
    try {
      const result = await fetchAuditScore({
        pdfUrl: entry.__auditUrl,
        auditEndpoint,
        bearerToken,
        force,
        fetcher: httpFetcher,
      });
      if (result === null) {
        // 5xx from server, fetcher swallowed and returned null
        entry.audit = { error: "server-unavailable" };
        errorCount++;
        return;
      }
      const checkedAt = new Date().toISOString();
      entry.audit = {
        score: result.score,
        grade: result.grade,
        reportUrl: result.reportUrl,
        reportId: result.reportId,
        reportExpiresAt: result.reportExpiresAt,
        audited: result.audited,
        checkedAt,
        cached: result.cached,
      };
      if (entry.sha256) {
        cache[entry.sha256] = {
          score: result.score,
          grade: result.grade,
          reportUrl: result.reportUrl,
          reportId: result.reportId,
          reportExpiresAt: result.reportExpiresAt,
          audited: result.audited,
          checkedAt,
        };
      }
      auditedCount++;
    } catch (err) {
      entry.audit = { error: err?.message ?? String(err) };
      errorCount++;
      log(`[audits] WARN: ${entry.filename ?? entry.path}: ${err?.message ?? err}`);
    }
  });

  // Persist cache before writing the augmented inventory so a crash
  // mid-write doesn't lose audit results we already paid for.
  try {
    saveAuditCache({ cachePath, cache });
  } catch (err) {
    log(`[audits] WARN: failed to persist audit cache: ${err.message}`);
  }

  // ──────────────────────────────────────────────────────────────────
  // v1.10.0: page-audit pass
  //
  // Walk every entry.references[] in the inventory, collect the unique
  // set of pageUrls, score each via audit.icjia.app's /api/audit-url-page
  // endpoint (axe-core via headless Chromium on the server), attach
  // ref.pageAudit = { score, grade, violationCount, bySeverity,
  // reportUrl, reportId, reportExpiresAt, pageTitle, cached } back to
  // every reference that points at that page. Cache is URL-keyed (not
  // hash-keyed like the PDF cache) because pages change more often than
  // file contents — 14-day default TTL.
  //
  // Skip entirely with skipPages=true. Pages with audit errors or 5xx
  // get { error: "..." } so the report layer can render explicitly.
  // ──────────────────────────────────────────────────────────────────
  let pagesAuditedCount = 0;
  let pagesCachedCount = 0;
  let pagesErrorCount = 0;
  let pagesTotalUnique = 0;
  if (!skipPages) {
    const pageCache = loadAuditCache({ cachePath: pageCachePath });
    const pageUrlSet = new Set();
    for (const r of records) {
      if (!Array.isArray(r?.references)) continue;
      for (const ref of r.references) {
        const u = ref?.pageUrl;
        if (typeof u === "string" && u.length > 0) pageUrlSet.add(u);
      }
    }
    const uniquePageUrls = [...pageUrlSet];
    pagesTotalUnique = uniquePageUrls.length;

    // Partition into cache hits vs URLs we need to fetch.
    const urlsToFetch = [];
    const urlToResult = new Map();
    for (const url of uniquePageUrls) {
      const cached = pageCache[url];
      if (!force && isCacheEntryFresh(cached, { now, ttlDays: pageTtlDays })) {
        urlToResult.set(url, { ...cached, cached: true });
        pagesCachedCount++;
      } else {
        urlsToFetch.push(url);
      }
    }

    log(
      `[audits] page-audit pass: ${pagesTotalUnique} unique pageUrls (${pagesCachedCount} cached, ${urlsToFetch.length} to fetch)`,
    );

    await mapWithConcurrency(urlsToFetch, concurrency, async (pageUrl) => {
      try {
        const result = await fetchPageAuditScore({
          pageUrl,
          auditEndpoint: pageAuditEndpoint,
          bearerToken,
          force,
          fetcher: httpFetcher,
        });
        if (result === null) {
          urlToResult.set(pageUrl, { error: "server-unavailable" });
          pagesErrorCount++;
          return;
        }
        const checkedAt = new Date().toISOString();
        const stored = {
          score: result.score,
          grade: result.grade,
          violationCount: result.violationCount,
          bySeverity: result.bySeverity,
          reportUrl: result.reportUrl,
          reportId: result.reportId,
          reportExpiresAt: result.reportExpiresAt,
          pageTitle: result.pageTitle,
          audited: result.audited,
          checkedAt,
        };
        pageCache[pageUrl] = stored;
        urlToResult.set(pageUrl, { ...stored, cached: result.cached });
        pagesAuditedCount++;
      } catch (err) {
        urlToResult.set(pageUrl, { error: err?.message ?? String(err) });
        pagesErrorCount++;
        log(`[audits] page-audit WARN: ${pageUrl}: ${err?.message ?? err}`);
      }
    });

    // Persist page cache + attach pageAudit back to every reference.
    try {
      saveAuditCache({ cachePath: pageCachePath, cache: pageCache });
    } catch (err) {
      log(`[audits] WARN: failed to persist page-audit cache: ${err.message}`);
    }
    for (const r of records) {
      if (!Array.isArray(r?.references)) continue;
      for (const ref of r.references) {
        const u = ref?.pageUrl;
        if (typeof u !== "string" || u.length === 0) continue;
        const result = urlToResult.get(u);
        if (result) ref.pageAudit = result;
      }
    }
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const ndjson = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await fs.writeFile(outputPath, ndjson);
  log(
    `[audits] wrote ${records.length} records → ${outputPath} ` +
      `(PDFs: ${auditedCount} freshly audited, ${errorCount} errors, ${pdfsToAudit.length === 0 ? "0" : (records.filter(r => r.audit?.cached).length)} from cache; ` +
      `pages: ${pagesTotalUnique} unique, ${pagesAuditedCount} freshly audited, ${pagesCachedCount} cached, ${pagesErrorCount} errors)`,
  );

  return {
    totalRecords: records.length,
    audited: auditedCount,
    errors: errorCount,
    pagesTotalUnique,
    pagesAudited: pagesAuditedCount,
    pagesCached: pagesCachedCount,
    pagesErrors: pagesErrorCount,
  };
}
