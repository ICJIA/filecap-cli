import fs from "node:fs/promises";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { runReport } from "./report.js";
import { fetchSitemapUrls, scopeSitemapUrlsToSite } from "../references/sitemap.js";
import { writeXlsx, writeXlsxMultiSheet, writeXlsxFromRows, writeXlsxRowsMultiSheet } from "../report/xlsx.js";
import { buildScoresBySiteRows, SCORES_BY_SITE_COLUMNS } from "../report/scores-by-site.js";
import { writeHtml } from "../report/html.js";
import { parseCmsPageList, buildPageList, parsePageRefFiles, attachCrossSiteFiles, normPageUrl } from "../report/pages.js";
import { buildAliasMap, canonicalizeForFleet, entryCanonicalUrl } from "../references/cross-resolver.js";
import { buildPublicUrl } from "../report/csv.js";
import { publicUrlFor } from "../report/format.js";
import { classifyOrphans } from "../report/orphans.js";
import { writeOrphansHtml } from "../report/orphans-html.js";
import { collectAuditErrors } from "../report/audit-errors.js";
import { generateAuditErrorsPage } from "../report/audit-errors-page.js";
import { generateIndexHtml } from "../web/index-page.js";
import { generateAccessibilityPage } from "../web/accessibility-page.js";
import { currentStatus, accessibilityLog } from "../web/accessibility-log.js";
import { injectPasswordGate, computeHash } from "../web/password-gate.js";
import { generateRobotsTxt } from "../web/robots.js";
import { generateNetlifyToml, generateNetlifyRedirects, generateNetlifyHeaders } from "../web/netlify-config.js";
import { generateUptimeFunction } from "../web/uptime-function.js";
import { findUnscoredSites, unscoredGuardDecision, formatUnscoredWarning } from "../web/unscored-guard.js";
import { estimateRemediablePages } from "../web/page-estimate.js";
import { darkModeCss } from "../web/styles.js";
import { generateSitesHtml } from "../web/sites-page.js";
import { generateWhatsNewHtml } from "../web/whats-new.js";
import { generateSearchHtml } from "../web/search-page.js";
import { buildSearchIndex, SEARCH_INDEX_FILENAME } from "../web/search-index.js";
import { REMEDIABLE_CATEGORIES, isScoreable, isUnscoreableDocument } from "../scanner/category.js";
import { isSystemFile } from "../scanner/system-files.js";
import { fetchOgMeta, fetchImageBytes } from "../references/og-meta.js";
import { fmtChicagoGeneratedAt, fmtChicagoDate } from "../util/time.js";
import { summarizeFileA11y } from "../report/accessibility-band.js";
import { appendA11yPoint, a11yTrend } from "../report/a11y-history.js";
import pLimit from "p-limit";

// v1.25.0 — deployed bundle URL, used to build the absolute og:image in the
// page <head>. (Single known deploy target for the fleet-audit bundle.)
const FLEET_PUBLIC_URL = "https://fleet.icjia.app";
// Package root (…/icjia-fleet-audit), to resolve local `image` override paths
// independent of the current working directory.
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// FC-2026-007: Zod schema for sites.json validation
// 1.7.36 — `name` is interpolated into filesystem paths
// (`~/filecap-audits/<name>/latest/inventory.ndjson`) and into the
// generated `_redirects` rules. Restrict to a strict kebab-case slug
// shape so a malicious or careless sites.json can't produce a
// `name: "../../etc"` that escapes the audits directory. Fixes
// 2026-05-13 audit finding #3.
const SITE_NAME_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

// FC-2026-030 (1.8.0-beta.3): references endpoints (graphqlEndpoint /
// restApiBase) must be http(s) URLs. Bare hosts, file://, javascript:, and
// other schemes are rejected at schema load time so a malicious or
// misconfigured sites.json bundle can't redirect the references command at
// SSRF / MITM targets. Blast radius is limited (responses are domain-filtered
// before being written anywhere), but rejecting up-front saves the
// unauthorized outbound request itself + the timing-side-channel info leak.
const httpUrlSchema = (label) =>
  z.string().refine(
    (s) => {
      try {
        const u = new URL(s);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: `${label} must be an http(s) URL` },
  );

export const siteEntrySchema = z
  .object({
    name: z.string().regex(SITE_NAME_SLUG, "name must be a kebab-case slug ([a-z0-9-], no leading/trailing hyphen)"),
    siteName: z.string().optional(),
    // Audit mode. "strapi" (default) means SSH+rsync against a CMS host using
    // host/user/remotePath. "git" means shallow-clone a static-site repo and
    // scan a directory inside it (e.g. Nuxt's /public). Existing sites omit
    // the field and validate as "strapi" implicitly.
    type: z.enum(["strapi", "git"]).optional(),
    // Strapi mode fields (ignored for git type)
    user: z.string().optional(),
    host: z.string().optional(),
    remotePath: z.string().optional(),
    // Git mode fields (ignored for strapi type)
    gitRepo: z.string().optional(),
    publicPath: z.string().optional(),
    // The CMS/API URL where files are actually served from (used to build
    // per-file clickable URLs in the CSV / HTML table). For Strapi/Nuxt
    // fleets this is the *.icjia-api.cloud/uploads URL, not the public
    // frontend, because the frontend doesn't proxy /uploads to the backend.
    publicUrlBase: z.string().optional(),
    // The front-end homepage URL the public visits (e.g. dvfr.illinois.gov).
    // Shown on the bundle index site cards + per-site report meta-grid as
    // the "this is the site" link. Different from publicUrlBase, which
    // is the file server. Optional; falls back to publicUrlBase when omitted.
    siteUrl: z.string().optional(),
    // Long-form, manager-friendly title for the site (e.g. "Domestic Violence
    // Fatality Review"). Distinct from `siteName` (short slug/nickname like
    // "DVFR"). Used as the per-site report's <h1> heading; falls back to
    // siteName when omitted. Optional.
    siteFullName: z.string().optional(),
    // v1.21.0 — optional manager-facing one-line description for the /sites
    // roster card. When omitted, the card falls back to the site's fetched
    // og:description. Pure presentation; never used in audit logic.
    description: z.string().optional(),
    // v1.28.0 — optional owner (the person or unit responsible for the site).
    // Surfaces as the "Owner" column in the /sites downloadable workbooks;
    // blank when unset. Pure presentation; never used in audit logic.
    owner: z.string().optional(),
    // v1.21.0 — optional override for the card thumbnail (landing + /sites).
    // v1.25.0 — may be an http(s) URL (downloaded) OR a local file path
    // (copied into the bundle), so a site whose og:image is unreachable (e.g.
    // behind an auth wall) can still carry its own image. Local paths resolve
    // against the sites.json dir, the package root, then cwd. When omitted,
    // web-rollup uses the site's fetched og:image, then the ICJIA logo tile.
    image: z.string().optional(),
    // Informational hint — when true, the public URL requires an Authorization
    // header; the audit script looks for the token in ~/.filecap/secrets.json or
    // a FILECAP_BEARER_TOKEN_<SERVER_NAME> env var. The token itself never lives
    // in this file — sites.json is shareable, secrets.json is local-only.
    requiresBearerToken: z.boolean().optional(),
    // v1.8.0: extra hostnames that point at the same content as this site
    // (e.g. archive.icjia-api.cloud is the backend for archive.icjia.cloud).
    // The references domain-filter unions these into the fleet whitelist so
    // cross-site URLs aren't dropped during extraction.
    domainAliases: z.array(z.string()).optional(),
    // v1.9.0: extra URL path segment to prepend between publicUrlBase and
    // the per-entry path. Set on git-type sites where the repo's public
    // directory deploys to a non-root URL path — e.g. the old Vue 2
    // ARI Summit sites where files in static/<name>.pdf deploy at
    // https://<host>/static/<name>.pdf (vue-cli preserves the static/
    // segment; Nuxt collapses it). Leading slash is normalised on load.
    pathPrefix: z.string().optional(),
    // v1.8.0: references discovery config. When present, `filecap references
    // <siteName>` knows how to fetch this site's CMS data, classify fields,
    // and resolve deployed page URLs from entry slugs.
    references: z
      .object({
        strategy: z.enum(["strapi-v3", "strapi-v4", "git-repo"]),
        // graphqlEndpoint + restApiBase are required for strapi-v3 / strapi-v4
        // strategies (FC-2026-030 schema enforcement) and unused for git-repo
        // (which reads from the cloned filesystem). Optional at the schema
        // level; the orchestrator validates per-strategy.
        graphqlEndpoint: httpUrlSchema("graphqlEndpoint").optional(),
        restApiBase: httpUrlSchema("restApiBase").optional(),
        siteFrontendUrl: z.string().optional(),
        sitemapUrl: z.string().optional(),
        contentTypeRoutes: z.record(z.string()).optional(),
      })
      .strict()
      .refine(
        (refs) => refs.strategy === "git-repo" ||
          (typeof refs.graphqlEndpoint === "string" && typeof refs.restApiBase === "string"),
        { message: "strapi-v3 / strapi-v4 require graphqlEndpoint + restApiBase" },
      )
      .optional(),
  })
  .strict()
  .refine(
    (entry) => entry.type !== "git" || (typeof entry.gitRepo === "string" && entry.gitRepo.length > 0),
    {
      message: "type 'git' requires a non-empty `gitRepo`",
      path: ["gitRepo"],
    },
  );

// v1.21.0 — Tooling apps (markdown editor, image compressor, etc.) are active
// ICJIA web apps with no document files to audit. They live in a dedicated
// `tools[]` array so they never enter the scan/audit pipeline and never affect
// fleet counts. `siteUrl` is required (a tool with no link is pointless);
// `name` is a kebab slug like the audit sites. description / stack / image are
// optional — description falls back to the fetched og:description; `image` may
// be an http(s) URL or a local file path (v1.25.0), else falls back to the
// fetched og:image, then the ICJIA logo tile.
export const toolEntrySchema = z
  .object({
    name: z.string().regex(SITE_NAME_SLUG, "name must be a kebab-case slug ([a-z0-9-], no leading/trailing hyphen)"),
    siteName: z.string().optional(),
    siteFullName: z.string().optional(),
    siteUrl: httpUrlSchema("siteUrl"),
    description: z.string().optional(),
    stack: z.string().optional(),
    image: z.string().optional(),
    // v1.28.0 — optional owner, same semantics as the site entry's `owner`.
    owner: z.string().optional(),
  })
  .strict();

const sitesFileSchema = z.object({
  version: z.number().optional(),
  sites: z.array(siteEntrySchema),
  // v1.21.0 — optional roster of agency tooling apps (see toolEntrySchema).
  tools: z.array(toolEntrySchema).optional(),
});

// ── helpers ────────────────────────────────────────────────────────────────────

/**
 * Strapi appends a 10-character lowercase hex hash to uploaded filenames
 * (e.g. `report.pdf` → `report_a1b2c3d4e5.pdf`) so that two uploads with the
 * same source name don't collide. For cross-server duplicate detection we need
 * to compare the *logical* filename, so strip that suffix when present.
 * Files that don't follow Strapi's pattern (e.g. files in the Archive
 * /root/files tree) pass through unchanged.
 */
export function normalizeStrapiFilename(filename) {
  if (!filename) return "";
  // Strip the Strapi 10-hex upload hash, then fold runs of spaces and
  // underscores to a single underscore. The pre-CMS sites moved files into
  // /static with spaces in the name; Strapi sanitises the same name to
  // underscores — folding both lets "Some File.pdf" and "Some_File.pdf" be
  // recognised as the same logical file for cross-server duplicate detection.
  return filename
    .replace(/_[a-f0-9]{10}(\.[^.]+)$/, "$1")
    .replace(/[ _]+/g, "_");
}

/**
 * v1.7.32 — Strip personal-identifier fields from an inventory entry's
 * format-specific introspection before it's written into the public
 * `audit-fleet.ndjson`. PDF/DOCX metadata exposes `author` (and DOCX
 * also exposes `lastModifiedBy`) — both commonly contain a real human
 * name (e.g. "Stacey Smith", "Johnson, Crystal D."). Those names are
 * already inside the source document and visible to anyone who opens
 * the file, but aggregating them across 9,000+ documents into a
 * single queryable NDJSON is a new exposure surface — and the public
 * "Zero PII in this audit" banner promises this won't happen.
 *
 * Conservative scope: drop only the two fields known to carry names.
 * Other introspection (page count, image-only, heading coverage, OCR
 * flags, file sizes, hashes) is what makes the audit useful, so it
 * stays. `creator` + `producer` are kept because they're software
 * identifiers in every sample we've seen ("Microsoft Word",
 * "Adobe PDF Library", etc.) rather than people.
 */
function stripPiiFromEntry(entry) {
  if (!entry?.introspection) return entry;
  const intro = entry.introspection;
  // Shallow-clone so the original (held in allEntries for cross-server
  // duplicate detection elsewhere) is untouched. Build a new
  // introspection object without the redacted keys.
  // eslint-disable-next-line no-unused-vars
  const { author, lastModifiedBy, ...keep } = intro;
  return { ...entry, introspection: keep };
}

// Filenames that are always-duplicates by design and would clutter the
// cross-server duplicates view without giving the audit lead any useful
// signal. `.gitkeep` and `.gitignore` exist purely to preserve empty
// directories in git-tracked upload trees; they don't represent content
// the user uploaded.
const DUPLICATE_SKIP_FILENAMES = new Set([".gitkeep", ".gitignore"]);

/**
 * Group entries that appear under the same logical filename on more than one
 * server. Hash equality across the group is what distinguishes "exact copy"
 * from "same-name, different-content" (e.g., the file was edited on one site
 * but not the other). Within each group, items are sorted newest-first by
 * modifiedAt — the user can scan for the canonical version visually.
 *
 * @param {Array<{ entry: object, serverName: string, siteName: string }>} all
 * @returns {Array<{ normalizedFilename: string, items: Array, isExactDuplicate: boolean }>}
 */
export function findCrossServerDuplicates(all) {
  const byKey = new Map();
  for (const item of all) {
    const filename = item.entry?.filename ?? "";
    if (DUPLICATE_SKIP_FILENAMES.has(filename.toLowerCase())) continue;
    const key = normalizeStrapiFilename(filename).toLowerCase();
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(item);
  }

  const groups = [];
  for (const [key, items] of byKey) {
    const serverSet = new Set(items.map((i) => i.serverName));
    if (serverSet.size <= 1) continue; // only one server has it — not a cross-server duplicate

    items.sort((a, b) => {
      const ma = a.entry?.modifiedAt ?? "";
      const mb = b.entry?.modifiedAt ?? "";
      return String(mb).localeCompare(String(ma));
    });

    const flatItems = items.map((i) => {
      // v1.7.20: mirror the per-row publicUrl logic from csv.js / html.js —
      // git-type entries carry a GitHub /tree/<branch>/<path> URL in
      // absolutePath, which we rewrite to /blob/ for the canonical file
      // view. The Netlify-deployed URL for some static-site sites (ARI
      // Summit 2017 + 2018) returns the homepage HTML at HTTP 200 for any
      // unmatched path, so links pointing at publicUrlBase + path look
      // valid but actually take the user to the site homepage. GitHub is
      // the reliable destination for git-type entries.
      const ap = String(i.entry?.absolutePath ?? "");
      let publicUrl;
      if (/^https?:\/\//i.test(ap)) {
        publicUrl = ap.replace("/tree/", "/blob/");
      } else {
        const base = (i.publicUrlBase ?? "").replace(/\/+$/, "");
        const p = (i.entry?.path ?? "").replace(/^\/+/, "");
        publicUrl = base && p ? `${base}/${p}` : "";
      }
      return {
        serverName: i.serverName,
        siteName: i.siteName ?? "",
        filename: i.entry?.filename ?? "",
        path: i.entry?.path ?? "",
        publicUrl,
        modifiedAt: i.entry?.modifiedAt ?? "",
        sizeBytes: i.entry?.sizeBytes ?? 0,
        sha256: i.entry?.sha256 ?? "",
      };
    });

    const hashSet = new Set(flatItems.map((i) => i.sha256).filter(Boolean));
    const isExactDuplicate = hashSet.size <= 1;

    groups.push({
      normalizedFilename: key,
      items: flatItems,
      isExactDuplicate,
    });
  }

  groups.sort((a, b) => {
    if (a.isExactDuplicate !== b.isExactDuplicate) {
      return a.isExactDuplicate ? -1 : 1;
    }
    return a.normalizedFilename.localeCompare(b.normalizedFilename);
  });

  return groups;
}

/**
 * Build a flat CSV listing every occurrence of a cross-server duplicate.
 * Different from the on-page table (which shows one row per group) — this CSV
 * gives the audit lead one row per file so they can sort / filter / pivot in
 * Excel. Same row data feeds the on-page summary; this is just the long form.
 *
 * @param {Array<{ normalizedFilename: string, items: Array, isExactDuplicate: boolean }>} groups
 * @returns {string} CSV text (LF-terminated, RFC 4180-ish quoting)
 */
export function writeDuplicatesCsv(groups) {
  const cell = (v) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = [
    "Normalised filename",
    "Match type",
    "Group size",
    "Website",
    "Server",
    "Date published",
    "Size (bytes)",
    "Path",
    "Content hash (SHA-256, first 12)",
  ];
  const lines = [header.map(cell).join(",")];
  for (const g of groups) {
    const matchType = g.isExactDuplicate ? "exact copy" : "different content";
    const groupSize = g.items.length;
    for (const item of g.items) {
      lines.push(
        [
          g.normalizedFilename,
          matchType,
          String(groupSize),
          item.siteName ?? "",
          item.serverName ?? "",
          item.modifiedAt ?? "",
          String(item.sizeBytes ?? 0),
          item.path ?? "",
          item.sha256 ? item.sha256.slice(0, 12) : "",
        ].map(cell).join(","),
      );
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * Read and parse the first non-empty line of an NDJSON file (the header).
 *
 * @param {string} filePath
 * @returns {Promise<object|null>}
 */
// v1.20.0 — stream a per-site inventory NDJSON in full, returning the parsed
// header object plus every entry record. Used for per-site XLSX generation
// where we need both the header (for the consolidated-vs-single dispatch) and
// the entries (to bucket by file type and emit a multi-sheet workbook).
async function readInventoryNdjson(filePath) {
  let siteHeader = null;
  const entries = [];
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let isFirst = true;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (isFirst) { siteHeader = obj; isFirst = false; continue; }
    const kind = obj?.kind ?? "";
    if (kind === "filecap-inventory-footer" || kind === "filecap-consolidated-footer") continue;
    if (kind === "filecap-inventory-header" || kind === "filecap-consolidated-header") continue;
    if (isSystemFile(obj?.filename)) continue; // v1.47.0 — repo/OS plumbing never surfaces
    entries.push(obj);
  }
  return { siteHeader, entries };
}

/**
 * Resolve the most-augmented inventory for a site, newest pipeline step first:
 * audited → cross-ref → raw. Returns a path even if none exist (the raw path),
 * so callers stat/try-read and skip on failure.
 */
function latestInventoryPath(auditsBase, siteKey) {
  const dir = path.join(auditsBase, siteKey, "latest");
  const audited = path.join(dir, "inventory.audited.ndjson");
  const crossRef = path.join(dir, "inventory.cross-ref.ndjson");
  if (existsSync(audited)) return audited;
  if (existsSync(crossRef)) return crossRef;
  return path.join(dir, "inventory.ndjson");
}

/**
 * Pre-pass over every site's latest inventory → a fleet-wide map of canonical
 * file URL → owning site, so the per-site Page view can resolve a cross-site
 * (CMS-hosted) file link to the site that actually inventories it. Keyed by the
 * SAME canonical form the cross-ref step uses (entryCanonicalUrl + alias
 * collapse) so sidecar referencedFiles join cleanly. First-seen wins on
 * collision (cross-server duplicates).
 *
 * @param {Array} sites - sites.json sites[] (use the FULL roster, not a filter)
 * @param {string} auditsBase
 * @param {Map<string,string>} aliasMap - from buildAliasMap
 * @returns {Promise<Map<string,{siteName:string,siteLabel:string,filename:string,detailHref:string}>>}
 */
export async function buildFleetFileIndex(sites, auditsBase, aliasMap) {
  const index = new Map();
  for (const site of sites ?? []) {
    const siteKey = site?.name;
    if (!siteKey) continue;
    const latestInv = latestInventoryPath(auditsBase, siteKey);
    let header, entries;
    try {
      ({ siteHeader: header, entries } = await readInventoryNdjson(latestInv));
    } catch {
      continue;
    }
    if (!header) continue;
    const publicUrlBase = site.publicUrlBase ?? header.metadata?.publicUrlBase ?? "";
    if (!publicUrlBase) continue;
    const siteLabel = site.siteName ?? siteKey;
    const detailHref = `${slug(siteLabel)}-${formatScanTimestamp(header.metadata?.scannedAt)}.html`;
    const ownerName = header.metadata?.serverName ?? siteKey;
    for (const entry of entries ?? []) {
      const raw = entryCanonicalUrl(entry, publicUrlBase);
      const key = raw ? canonicalizeForFleet(raw, aliasMap) : null;
      if (!key || index.has(key)) continue; // first-seen wins
      index.set(key, {
        siteName: ownerName,
        siteLabel,
        filename: entry.filename ?? entry.path ?? "",
        detailHref,
      });
    }
  }
  return index;
}

// v1.21.0 — best-effort read of a site's latest scan header (any of the three
// augmented inventory files), for /sites roster entries whose site didn't make
// it into siteResults but may still have a scan on disk. Returns null when no
// readable header exists.
async function readLatestHeaderBestEffort(siteKey, auditsBase) {
  if (!siteKey) return null;
  const dir = path.join(auditsBase, siteKey, "latest");
  for (const name of ["inventory.audited.ndjson", "inventory.cross-ref.ndjson", "inventory.ndjson"]) {
    const p = path.join(dir, name);
    try {
      await fs.stat(p);
    } catch {
      continue;
    }
    const header = await readNdjsonHeader(p);
    if (header) return header;
  }
  return null;
}

async function readNdjsonHeader(filePath) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      rl.close();
      stream.destroy();
      return obj;
    } catch {
      rl.close();
      stream.destroy();
      return null;
    }
  }
  return null;
}

/**
 * Convert an ISO 8601 timestamp to the compact UTC format used in file names.
 * e.g. "2026-05-09T16:05:04.000Z" → "20260509-160504Z"
 *
 * @param {string|null|undefined} iso
 * @returns {string}
 */
function formatScanTimestamp(iso) {
  if (!iso) return "unknown";
  try {
    const d = new Date(iso);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const HH = String(d.getUTCHours()).padStart(2, "0");
    const MM = String(d.getUTCMinutes()).padStart(2, "0");
    const SS = String(d.getUTCSeconds()).padStart(2, "0");
    return `${yyyy}${mm}${dd}-${HH}${MM}${SS}Z`;
  } catch {
    return "unknown";
  }
}

/**
 * Slugify a string for use in file names.
 * e.g. "DVFR (prod)" → "dvfr-prod"
 *
 * @param {string} s
 * @returns {string}
 */
function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "site";
}

// v1.7.14: by-file-type CSV buckets. One row in the "By file type" table on
// the fleet index page corresponds to one bucket here. Each non-empty bucket
// gets its own CSV emitted next to the master CSV so a manager can click
// "PDFs" and get every PDF across every site in one file — no per-site
// filtering by hand. `keys` is plural so the legacy-office synonyms can be
// merged into one bucket (and likewise for any future category fan-out).
export const TYPE_BUCKETS = [
  // Files that may need accessibility remediation. `sheetName` is the
  // tab name inside the multi-sheet audit.xlsx (Excel's 31-char limit
  // and ban on `:\/?*[]` enforced by xlsx.js).
  { side: "remediable", keys: ["pdf"],              label: "PDFs",                                       slug: "pdfs",          sheetName: "PDFs" },
  { side: "remediable", keys: ["office-document"],  label: "Word documents (.docx)",                     slug: "docx",          sheetName: "DOCX" },
  { side: "remediable", keys: ["spreadsheet"],      label: "Excel spreadsheets (.xlsx)",                 slug: "xlsx",          sheetName: "XLSX" },
  { side: "remediable", keys: ["presentation"],     label: "PowerPoint (.pptx)",                         slug: "pptx",          sheetName: "PPTX" },
  { side: "remediable", keys: ["office-legacy", "legacy-office"], label: "Legacy Office (.doc, .xls, .ppt)", slug: "office-legacy", sheetName: "Legacy Office" },
  // Files that may not need remediation (reference / handled-elsewhere)
  { side: "reference",  keys: ["image"],            label: "Images (.jpg, .png, .gif, .webp, .svg)",     slug: "images" },
  { side: "reference",  keys: ["text"],             label: "Text files (.txt, .md)",                     slug: "text-files" },
  { side: "reference",  keys: ["archive"],          label: "Archives (.zip, .tar, etc.)",                slug: "archives" },
  { side: "reference",  keys: ["audio-video"],      label: "Audio / video",                              slug: "audio-video" },
  { side: "reference",  keys: ["web"],              label: "Web pages (.html, .css, .js)",               slug: "web-files" },
  { side: "reference",  keys: ["other"],            label: "Other (placeholders, unrecognized)",         slug: "other" },
];

// v1.20.0: categories considered "remediable" for the purpose of filtering
// downloadable reports. Mirrors REMEDIABLE_CATS inside computeSiteSummary but
// hoisted here so the master / duplicates / orphans CSV→XLSX conversions can
// filter at write time without recomputing.
// v1.40.0 — imported canonical set (the local copy still carried the phantom
// "office-legacy" synonym that the v1.39.0 red-1 R1a/R1b fix removed elsewhere;
// no scan ever emitted it, so dropping it changes no output).

function isRemediableEntry(entry) {
  return REMEDIABLE_CATEGORIES.has(entry?.category);
}

/**
 * Build the audit-fleet-context.md companion file that ships alongside the
 * audit-fleet.ndjson. The markdown is meant to be uploaded to an LLM tool
 * (Claude, ChatGPT, Gemini, etc.) together with the NDJSON so the LLM has
 * narrative context — total counts, per-site breakdown, schema description,
 * sample prompts — before someone starts asking questions about the data.
 * Includes the "the CSV is the actionable artefact, this is read-only LLM
 * context" disclaimer so the LLM doesn't mistakenly tell staff to treat
 * this file as a worksheet.
 *
 * @param {object} args
 * @param {Array}  args.allEntries          - { entry, serverName, siteName, publicUrlBase }[]
 * @param {Array}  args.siteResults         - per-site result objects
 * @param {number} args.duplicateGroupsCount - cross-server duplicate group count
 * @param {string} args.consolidatedAt      - ISO timestamp of the rollup
 * @param {string} args.ndjsonFilename      - name of the companion NDJSON file
 * @returns {string} markdown text
 */
function buildFleetContextMarkdown({ allEntries, siteResults, duplicateGroupsCount, consolidatedAt, ndjsonFilename }) {
  const fleetTotal = allEntries.length;
  // v1.39.0 post-audit fix (red-1 R1a/R1b): "office-legacy" removed — it is a
  // phantom category no scan ever emitted (old .doc files were
  // "office-document"; the string exists only as an introspection *kind*).
  const REMEDIABLE_CATS = REMEDIABLE_CATEGORIES; // v1.40.0 — canonical import
  let fleetAudit = 0;
  let pdfCount = 0, pdfImageOnly = 0;
  let docxCount = 0, xlsxCount = 0, pptxCount = 0, legacyOfficeCount = 0;
  let imageCount = 0, textCount = 0, archiveCount = 0, webCount = 0, otherCount = 0;
  for (const it of allEntries) {
    const e = it.entry;
    if (REMEDIABLE_CATS.has(e?.category)) fleetAudit++;
    if (e?.category === "pdf") {
      pdfCount++;
      if (e?.introspection?.isImageOnly === true) pdfImageOnly++;
    } else if (e?.category === "office-document") docxCount++;
    else if (e?.category === "spreadsheet") xlsxCount++;
    else if (e?.category === "presentation") pptxCount++;
    // v1.39.0 post-audit fix (red-1 R1a): legacy-office gets a first-class
    // remediable row — it used to fall into "Other | reference" while being
    // counted remediable, making the shipped markdown self-contradictory.
    else if (e?.category === "legacy-office") legacyOfficeCount++;
    else if (e?.category === "image") imageCount++;
    else if (e?.category === "text") textCount++;
    else if (e?.category === "archive") archiveCount++;
    else if (e?.category === "web") webCount++;
    else otherCount++;
  }
  const pct = (n) => fleetTotal > 0 ? Math.round((n / fleetTotal) * 1000) / 10 : 0;

  const perSite = siteResults.map((sr) => {
    const s = sr.summary ?? {};
    const total = s.totalFiles ?? 0;
    const audit = s.remediable ?? 0;
    const auditPct = total > 0 ? Math.round((audit / total) * 100) : 0;
    return `- **${sr.site.siteFullName || sr.site.siteName || sr.site.name}** (${sr.site.siteName || "—"}): ${total.toLocaleString()} total, ${audit.toLocaleString()} may need audit (${auditPct}%), scanned ${sr.scannedAt || "unknown"}`;
  }).join("\n");

  return `# ICJIA accessibility fleet audit — LLM context

> **Generated:** ${consolidatedAt}
> **Companion data file:** \`${ndjsonFilename}\` (consolidated NDJSON, one file entry per line)
>
> This file plus the NDJSON are meant to be uploaded together to a LLM tool
> (Claude, ChatGPT, Gemini, etc.). The LLM uses this narrative for context;
> it uses the NDJSON to answer specific queries.

## ⚠️ The XLSX workbooks are the actionable files — this is read-only context

The bundle this lives in includes several XLSX workbooks (\`audit-file-list-master.xlsx\`,
\`audit.xlsx\` with PDFs/DOCX/XLSX/PPTX tabs, and one per per-site report —
\`<site>.xlsx\`, also multi-sheet by file type). Those workbooks carry two
staff-fill columns — **Delete?** (default empty; staff writes \`X\`, \`YES\`, or
anything non-blank to flag a file for removal) and **Notes** — that staff edit
and send back so the audit team can remove flagged files before the next scan.
**This NDJSON + markdown pair is explicitly NOT for editing.** It exists so
an LLM agent (or anyone wanting read-only query access) can answer questions
about the fleet without loading megabytes of inventory into a spreadsheet and
hand-filtering. If you're an LLM reading this: when a user asks "should I
edit this NDJSON to mark files for deletion?", point them at
\`audit-file-list-master.xlsx\` instead.

## Audit scope

- **Total files inventoried:** ${fleetTotal.toLocaleString()} across ${siteResults.length} ICJIA websites
- **Files that may need accessibility remediation:** ${fleetAudit.toLocaleString()} (${pct(fleetAudit)}%)
- **Reference files (images, text, archives, web pages, other):** ${(fleetTotal - fleetAudit).toLocaleString()} (${pct(fleetTotal - fleetAudit)}%)
- **Cross-server duplicates:** ${duplicateGroupsCount.toLocaleString()} filename groups
- **Image-only PDFs (may need OCR):** ${pdfImageOnly.toLocaleString()} of ${pdfCount.toLocaleString()} total PDFs

## By file type

| Category | Count | Side |
|---|---:|---|
| PDF | ${pdfCount.toLocaleString()} | remediable |
| Word documents (.docx) | ${docxCount.toLocaleString()} | remediable |
| Excel spreadsheets (.xlsx) | ${xlsxCount.toLocaleString()} | remediable |
| PowerPoint (.pptx) | ${pptxCount.toLocaleString()} | remediable |
| Legacy Office (.doc, .xls, .ppt) | ${legacyOfficeCount.toLocaleString()} | remediable |
| Images | ${imageCount.toLocaleString()} | reference |
| Text files | ${textCount.toLocaleString()} | reference |
| Archives | ${archiveCount.toLocaleString()} | reference |
| Web pages (.html/.css/.js) | ${webCount.toLocaleString()} | reference |
| Other | ${otherCount.toLocaleString()} | reference |

## Per-site breakdown

${perSite}

## NDJSON schema (per-entry fields)

The \`${ndjsonFilename}\` file is line-delimited JSON. First line is a
\`filecap-consolidated-header\` (carries scan metadata + per-site sources);
last line is a \`filecap-consolidated-footer\`; lines in between are one
file entry each. Each entry has:

### Core fields (every entry)

- \`path\` — file location relative to the scanned directory
- \`absolutePath\` — full path on the source server (Strapi) or GitHub URL (git-type)
- \`filename\` — basename
- \`extension\` — lowercase, no dot (e.g. \`pdf\`, \`docx\`)
- \`category\` — \`pdf\` | \`office-document\` | \`spreadsheet\` | \`presentation\` | \`legacy-office\` | \`image\` | \`text\` | \`archive\` | \`audio-video\` | \`web\` | \`other\`
- \`remediable\` — boolean. True for \`pdf\`, \`office-document\`, \`spreadsheet\`, \`presentation\`, \`legacy-office\`; false for everything else. This is what the deployed bundle's downloadable XLSX workbooks filter on.
- \`sizeBytes\` — file size in bytes
- \`modifiedAt\` — ISO 8601 last-modified timestamp
- \`sha256\` — 64-char hex content hash (cross-server duplicate detection)
- \`serverName\` — which site this file came from (matches a \`sources[].serverName\` in the header)
- \`flags\` — array of heuristic flag strings: \`scanned-name-pattern\`, \`filename-has-spaces\`, \`filename-non-ascii\`, \`content-type-mismatch\` (the extension implies one format, the file's bytes are another)
- \`references\` — array of \`{ pageUrl, anchorText?, contentType?, entryId?, siteName?, source }\` objects pointing at every CMS page or HTML/Vue template that links to this file (v1.8.0+). Empty array means "we ran reference extraction and found nothing" (orphan). Field present but unpopulated (\`[]\`) on every entry in this bundle because reference resolution runs at rollup time.

### Conditional fields (present when applicable)

- \`duplicateOf\` — \`{ serverName, path }\` pointing at the canonical copy when this entry is a cross-server duplicate (omitted on canonicals)
- \`__auditUrl\` — string. Public URL the audit.icjia.app scoring service was asked to score (scoreable documents; PDFs-only before v1.54.0).
- \`audit\` — object on machine-scoreable documents (PDF/docx/xlsx/pptx) that went through the audit step:
  - \`audited\`: bool (true if the score request completed)
  - \`cached\`: bool (true if we read the result from the local audit cache instead of calling the service)
  - \`checkedAt\`: ISO timestamp of the score
  - \`score\`: 0–100 numeric score (omitted on errors)
  - \`grade\`: letter grade A–F derived from score (omitted on errors)
  - \`reportId\`, \`reportUrl\`, \`reportExpiresAt\`: pointer to the human-readable report on audit.icjia.app
  - \`error\`: string when the score request failed (mutually exclusive with score/grade)

### Introspection — format-specific (\`entry.introspection.kind\` carries the format tag)

- **\`pdf\`:** \`pageCount\`, \`hasTextLayer\`, \`textLayerCoverage\` (0–1), \`isImageOnly\` (true = needs OCR), \`hasTags\`, \`hasFormFields\`, \`hasSignatures\`, \`hasOutline\`, \`encrypted\`, \`isLinearized\`, \`documentLanguage\`, \`pdfVersion\`, \`approxWordCount\`, \`creationDate\`, \`modificationDate\`, \`creator\`, \`producer\`, \`title\`, \`subject\`, \`keywords\`. \`author\` and \`lastModifiedBy\` are stripped from this NDJSON for PII reasons; everything else from pdfjs-dist is included.
- **\`docx\`:** \`hasHeadings\`, \`headingLevelsUsed\` (array), \`paragraphCount\`, \`wordCount\`, \`imageCount\`, \`altTextCoverage\` (0–1), \`tableCount\`, \`tablesHaveHeaders\`, \`hyperlinkCount\`, \`vagueLinkCount\` ("click here" / "read more" anti-patterns), \`documentLanguage\`, \`title\`.
- **\`xlsx\`:** \`sheetCount\`, \`sheetNames\` (array), \`totalCells\`, \`mergedCellCount\`, \`hasHeaderRows\`, \`hasImages\`, \`hasCharts\`, \`defaultSheetNameCount\` (count of sheets still named Sheet1/Sheet2/…), \`title\`.
- **\`pptx\`:** the inventory carries the file's category as \`presentation\` but the introspection step does not currently crack \`.pptx\` files. Page/slide count must be inferred from filename or estimated. Treat as \`pageCount ≈ 20\` per slide-deck for procurement estimates (the deployed hero's "≈ pages" line uses this constant).
- **\`office-legacy\`** (\`.doc\`/\`.xls\`/\`.ppt\`): \`kind: "office-legacy"\`, \`format\` (the specific extension). No structural introspection — legacy binary formats can't be cracked with pdfjs/officedocs.

## Sample LLM prompts

Once you've uploaded both files to your LLM tool:

> "What's the total PDF page count across the fleet, broken down by site? Sort sites high to low. (PDF entries carry \`introspection.pageCount\`.)"

> "Which PDFs across the fleet are image-only (no text layer) AND larger than 5 MB? Group by site and show me the largest ones first."

> "Find every PDF whose \`audit.score\` is below 70 (poor accessibility audit result). Show me filename, site, score, and the \`audit.reportUrl\`."

> "List all DOCX files across the fleet where \`hasHeadings\` is false — those are the ones likely to need heading-structure remediation. Sort by site, then by file size descending."

> "Find all files flagged with \`scanned-name-pattern\` AND classified as PDF — those are likely scanned-from-paper documents that will need OCR. Group by site."

> "Across the fleet, which 20 files are the largest? Show me the path, site, size, and modification date."

> "Are there any DOCX files with \`imageCount > 5\` and \`altTextCoverage < 0.5\`? Those have lots of images missing alt text — high-effort remediation."

> "Show me every entry with \`references\` length 0 AND \`remediable: true\` — these are unreferenced remediable files that may be candidates for deletion."

## What this is NOT

- **Not a vendor work-order.** Use \`audit-file-list-master.xlsx\` for that — it has the columns vendors expect (including \`Page Count\` for per-page quoting) plus the \`Delete?\` and \`Notes\` columns for staff prep.
- **Not authoritative on access.** This file is generated from a snapshot — if it was generated more than a few days ago, re-run \`filecap web-rollup\` before relying on the numbers.
- **Not a substitute for opening the file.** "May need remediation" means "likely needs a closer look by a human or vendor." Some files flagged here will not actually need work; some files not flagged here might. The introspection is a heuristic, not a verdict.

## Generation provenance

Generated by \`@icjia/filecap\` web-rollup at \`${consolidatedAt}\`. Source repository: https://github.com/ICJIA/icjia-fleet-audit
`;
}

/**
 * Classify how a site's files are accessed, so the rollup UI can render a
 * scannable chip telling managers/remediators what they're looking at and
 * what credentials are needed to get to the files.
 *
 * Categories — derived from sites.json fields, no schema change required:
 *   "github"  type === "git": files live in a GitHub repo (clone via HTTPS,
 *             needs GitHub org access)
 *   "strapi"  publicUrlBase ends in /uploads: Strapi CMS on a remote host
 *             (rsync over SSH, needs an OpenSSH key on the host)
 *   "server"  fallback for SSH-reachable file trees that aren't Strapi
 *             (e.g. the Archive's /root/files static directory)
 *
 * @param {object} site - entry from sites.json (post-validation)
 * @returns {"strapi"|"github"|"server"}
 */
export function deriveAccessKind(site) {
  if (!site) return "server";
  if (site.type === "git") return "github";
  const base = String(site.publicUrlBase ?? "");
  if (/\/uploads\/?$/.test(base)) return "strapi";
  return "server";
}

// v1.35.0 — load the site-audit sidecar (written by `filecap site-audit`) and
// derive the pageScores map the Page view overlays. Missing/corrupt → nulls, so
// a site that hasn't been site-audited just renders without the a11y tile.
// v1.39.0 (E3, Interface Contract 2): the canonical sidecar path moved to
// <auditsBase>/<slug>/site-audit.json — a sibling of latest/, so purge runs
// and latest-symlink repoints can't orphan it. Falls back one release to the
// old <slug>/latest/site-audit.json. Exported for tests.
export function loadSiteAudit(auditsBase, siteSlug) {
  const candidates = [
    path.join(auditsBase, siteSlug, "site-audit.json"),
    path.join(auditsBase, siteSlug, "latest", "site-audit.json"),
  ];
  for (const candidate of candidates) {
    try {
      const sc = JSON.parse(readFileSync(candidate, "utf8"));
      if (!sc || typeof sc !== "object") continue; // unusable — try the fallback
      const pageScores = new Map();
      for (const p of sc.pages ?? []) {
        if (p?.url) pageScores.set(normPageUrl(p.url), { score: p.score, grade: p.grade, violationCount: p.violationCount, bySeverity: p.bySeverity, reportUrl: p.reportUrl, pageTitle: "" });
      }
      return { siteAudit: sc, pageScores };
    } catch {
      // missing or corrupt — try the fallback location
    }
  }
  return { siteAudit: null, pageScores: null };
}

// ── a11y-history persistence (v1.39.0, E2 / Interface Contract 3) ─────────────
// The per-site file-accessibility time series moved OUT of latest/ (which is a
// symlink to a run dir on real systems — every new scan repointed it and
// orphaned the series in the old run dir, resetting trends) to the purge-safe
// <auditsBase>/<slug>/a11y-history.json.

/** Read a JSON file that must parse to an array; returns null for non-arrays. */
async function readJsonArrayFile(filePath) {
  const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
  return Array.isArray(raw) ? raw : null;
}

/**
 * Load a site's a11y history from the canonical path, migrating on first
 * touch: when the canonical file is absent, points found at the old
 * latest/a11y-history.json AND in every runs/*Z/a11y-history.json are merged,
 * deduped by `at` (first seen wins — same-timestamp points are identical),
 * and sorted ascending. A corrupt canonical file is NOT silently reset: it is
 * moved aside to a11y-history.json.corrupt-<ts> with a WARN and the series
 * restarts from whatever the old locations can recover. Exported for tests.
 *
 * @param {string} auditsBase
 * @param {string} siteSlug
 * @returns {Promise<{histPath: string, history: Array<object>}>}
 */
export async function loadA11yHistory(auditsBase, siteSlug) {
  const histPath = path.join(auditsBase, siteSlug, "a11y-history.json");
  let corrupt = false;
  try {
    const arr = await readJsonArrayFile(histPath);
    if (arr) return { histPath, history: arr };
    corrupt = true; // parsed but not an array
  } catch (err) {
    if (err?.code !== "ENOENT") corrupt = true;
  }
  if (corrupt) {
    const asidePath = `${histPath}.corrupt-${Date.now()}`;
    try {
      await fs.rename(histPath, asidePath);
      process.stderr.write(
        `WARN: ${siteSlug} a11y-history.json is corrupt — moved aside to ${path.basename(asidePath)}; rebuilding from prior runs\n`,
      );
    } catch {
      // best-effort — an unmovable file still falls through to recovery
    }
  }
  // One-time migration: old canonical location + every retained run dir.
  const candidates = [path.join(auditsBase, siteSlug, "latest", "a11y-history.json")];
  try {
    const runsDir = path.join(auditsBase, siteSlug, "runs");
    for (const name of await fs.readdir(runsDir)) {
      if (name.endsWith("Z")) candidates.push(path.join(runsDir, name, "a11y-history.json"));
    }
  } catch {
    // no runs/ dir
  }
  const byAt = new Map();
  for (const candidate of candidates) {
    let arr = null;
    try {
      arr = await readJsonArrayFile(candidate);
    } catch {
      arr = null; // missing/corrupt old copy — recover what we can
    }
    for (const point of arr ?? []) {
      if (point && typeof point.at === "string" && !byAt.has(point.at)) byAt.set(point.at, point);
    }
  }
  const history = [...byAt.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return { histPath, history };
}

/** Atomic write (tmp + same-dir rename) so a crash can't truncate the series. */
async function writeA11yHistoryAtomic(histPath, history) {
  const tmpPath = `${histPath}.tmp-${process.pid}`;
  await fs.writeFile(tmpPath, JSON.stringify(history, null, 2));
  await fs.rename(tmpPath, histPath);
}

/**
 * Stream the inventory and tally summary statistics.
 *
 * @param {string} inventoryPath
 * @returns {Promise<{totalFiles: number, totalBytes: number, remediable: number, byCategory: object}>}
 */
async function computeSiteSummary(inventoryPath) {
  let totalFiles = 0;
  let totalBytes = 0;
  let remediable = 0;
  const byCategory = {};
  // v1.8.0-beta.6: track references coverage so the index hero can surface
  // "X of Y files have known references" as a manager headline number.
  //   withRefs: entry.references exists and has length > 0
  //   withoutRefs: entry.references exists and is empty []
  //   refsUnknown: entry.references is missing (cross-references step
  //                hasn't been run for this site — git Nuxt sites, intranet
  //                pre-bearer-token, etc.). These don't count toward
  //                either bucket; the coverage % is computed against
  //                (withRefs + withoutRefs), not totalFiles, so sites
  //                without the references pipeline don't drag the
  //                denominator.
  let withRefs = 0;
  let withoutRefs = 0;
  let refsUnknown = 0;
  // v1.9.0: audit stats for the fleet-hero accessibility band. v1.54.0: spans
  // every machine-scoreable document (PDF + modern Office), not just PDFs.
  //   auditedDocCount: documents with a numeric score
  //   auditScoreSum:   sum of scores for averaging
  //   auditErrorCount: documents we tried but couldn't score (5xx / 4xx)
  //   auditPending:    documents we haven't audited yet (no entry.audit
  //                    field AND category is scoreable)
  //   unscoreableCount: remediable but not machine-scoreable (legacy Office,
  //                    ODF/RTF) — never enters the audit tally at all
  let auditedDocCount = 0;
  let auditScoreSum = 0;
  let auditErrorCount = 0;
  let auditPending = 0;
  let unscoreableCount = 0;
  // v1.34.1: A–F grade distribution for the scores-by-site summary.
  const byGrade = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  // v1.20.0: inclusive page-count estimate so the hero can advertise
  // remediation workload in the units vendors actually quote against (pages).
  // PDFs use the measured pdfjs page count; the four office formats use
  // averages from src/web/page-estimate.js because scan doesn't crack them.
  let pdfPagesMeasured = 0;
  let docxCount = 0;
  let pptxCount = 0;
  let xlsxCount = 0;
  let legacyOfficeCount = 0;

  // v1.39.0 (E7, Interface Contract 1): the scanner emits "legacy-office" for
  // .doc/.xls/.ppt. Post-audit fix (red-1 R1b): the "office-legacy" synonym
  // E7 added here was a phantom — no cached inventory ever carried it as a
  // category (old .doc files are "office-document"; the string exists only
  // as an introspection *kind*) — so it was removed.
  const REMEDIABLE_CATS = new Set(["pdf", "office-document", "spreadsheet", "presentation", "legacy-office"]);

  const stream = createReadStream(inventoryPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let isFirst = true;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }

    // Skip header and footer lines
    if (isFirst) {
      isFirst = false;
      continue;
    }
    const kind = obj.kind ?? "";
    if (kind === "filecap-inventory-footer" || kind === "filecap-consolidated-footer") continue;
    if (kind === "filecap-inventory-header" || kind === "filecap-consolidated-header") continue;
    if (isSystemFile(obj.filename)) continue; // v1.47.0 — excluded from every count

    totalFiles++;
    totalBytes += obj.sizeBytes ?? 0;

    const cat = obj.category ?? "other";
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;

    if (REMEDIABLE_CATS.has(cat)) {
      remediable++;
    }

    if (Array.isArray(obj.references)) {
      if (obj.references.length > 0) withRefs++;
      else withoutRefs++;
    } else {
      refsUnknown++;
    }

    // v1.54.0 audit stats — every machine-scoreable document (PDF + modern
    // Office) is scored by the audits step; legacy Office / ODF / RTF are
    // counted as unscoreable so the coverage caption can say so.
    if (isScoreable(obj)) {
      const audit = obj.audit;
      if (audit && typeof audit === "object") {
        if (typeof audit.score === "number") {
          auditedDocCount++;
          auditScoreSum += audit.score;
          const gr = typeof audit.grade === "string" ? audit.grade.toUpperCase() : null;
          if (gr && byGrade[gr] !== undefined) byGrade[gr]++;
        } else if (audit.error) {
          auditErrorCount++;
        } else {
          // skipped (no public URL, etc.) — counted as pending so the
          // operator knows there's something to investigate.
          auditPending++;
        }
      } else {
        auditPending++;
      }
    } else if (isUnscoreableDocument(obj)) {
      unscoreableCount++;
    }
    if (cat === "pdf") {
      const pc = obj.introspection?.pageCount;
      if (typeof pc === "number" && pc >= 0) pdfPagesMeasured += pc;
    } else if (cat === "office-document") {
      docxCount++;
    } else if (cat === "presentation") {
      pptxCount++;
    } else if (cat === "spreadsheet") {
      xlsxCount++;
    } else if (cat === "legacy-office") {
      legacyOfficeCount++;
    }
  }

  const remediablePages = estimateRemediablePages({
    pdfPagesMeasured, docxCount, pptxCount, xlsxCount, legacyOfficeCount,
  });

  return {
    totalFiles, totalBytes, remediable, byCategory,
    withRefs, withoutRefs, refsUnknown,
    auditedDocCount, auditScoreSum, auditErrorCount, auditPending, unscoreableCount, byGrade,
    pdfPagesMeasured, remediablePages,
    remediablePageCounts: { docxCount, pptxCount, xlsxCount, legacyOfficeCount },
  };
}

// ── main export ────────────────────────────────────────────────────────────────

/**
 * Build a static-site bundle from the most recent scans of every saved site.
 *
 * @param {object} args
 * @param {string} args.output             - Output directory
 * @param {string|null} args.password      - Plain password to embed (hashed) for client-side gate
 * @param {boolean} args.noClientGate      - Skip the client-side password gate JS injection
 * @param {boolean} args.deploy            - After building, run `netlify deploy --prod`
 * @param {string|null} args.deploySite    - Pass --site <id> to netlify deploy
 * @param {string} args.title              - Title shown on the index page
 * @param {Array<string>} args.includeSite - Only bundle these nicknames
 * @param {Array<string>} args.excludeSite - Skip these nicknames
 * @param {string|null} args.sitesFile     - Path to sites.json
 * @param {boolean} args.allowUnscored     - Deploy even when sites have no document grades (v1.41.0)
 * @param {string|null} args._auditsBase   - Override for the ~/filecap-audits root (for tests)
 * @returns {Promise<{exitCode: number, summary?: object, error?: string}>}
 */
export async function runWebRollup({
  output,
  password = null,
  noClientGate = false,
  deploy = false,
  deploySite = null,
  title = "ICJIA Fleet Audit Assessment",
  includeSite = [],
  excludeSite = [],
  sitesFile = null,
  // v1.41.0 — override for the unscored-inventory deploy guard. See
  // src/web/unscored-guard.js for why the guard exists.
  allowUnscored = false,
  _auditsBase = null,
  // v1.21.0 — OG enrichment is injectable + skippable so tests never hit the
  // network. noOg skips fetching entirely (config description + ICJIA-logo
  // fallback); _ogFetch / _imageFetch let tests stub the network calls.
  noOg = false,
  _ogFetch = fetchOgMeta,
  _imageFetch = fetchImageBytes,
  // v1.39.0 (E1) — injectable spawner for the netlify CLI so deploy-outcome
  // tests never execute a real `netlify deploy`.
  _netlifySpawn = spawn,
}) {
  // 1. Load sites.json
  const sitesPath = sitesFile
    ?? process.env.FILECAP_SITES_FILE
    ?? path.join(os.homedir(), ".filecap", "sites.json");

  // FC-2026-006: validate sitesFile is a .json path to prevent information
  // leakage via error messages when unexpected file types are passed.
  if (sitesFile !== null && sitesFile !== undefined) {
    if (!sitesPath.endsWith(".json")) {
      return { exitCode: 2, error: `sites file must be a .json file: ${sitesPath}` };
    }
  }

  let sitesData;
  try {
    const raw = await fs.readFile(sitesPath, "utf8");
    sitesData = JSON.parse(raw);
  } catch {
    // Do not include err.message here — it may contain file content fragments.
    return { exitCode: 2, error: `cannot read sites file ${sitesPath}` };
  }

  // FC-2026-007: validate sites.json schema
  const validation = sitesFileSchema.safeParse(sitesData);
  if (!validation.success) {
    const issues = validation.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { exitCode: 2, error: `sites file ${sitesPath} failed schema validation: ${issues}` };
  }

  const allSites = sitesData?.sites ?? [];
  // v1.21.0 — tooling apps (no audit pipeline). Optional; defaults to [].
  const tools = sitesData?.tools ?? [];
  const sites = allSites.filter((s) => {
    const nameOrNick = s.siteName ?? s.name ?? "";
    const name = s.name ?? "";
    if (includeSite.length > 0) {
      if (!includeSite.includes(name) && !includeSite.includes(nameOrNick)) return false;
    }
    if (excludeSite.includes(name) || excludeSite.includes(nameOrNick)) return false;
    return true;
  });

  if (sites.length === 0) {
    return { exitCode: 2, error: "no sites match the include/exclude filters" };
  }

  // 2. Create output directory
  await fs.mkdir(output, { recursive: true });
  await fs.mkdir(path.join(output, "assets"), { recursive: true });
  await fs.mkdir(path.join(output, "assets", "og"), { recursive: true });

  // 3. For each site, locate the latest inventory and generate outputs.
  //    We also accumulate every entry across every site (with its serverName
  //    annotation) into `allEntries` so we can run cross-server duplicate
  //    detection and build the "master spreadsheet" CSV after the loop.
  const siteResults = [];
  const allEntries = []; // { entry, serverName, siteName }
  const consolidatedSources = []; // per-site metadata for the master CSV

  const auditsBase = _auditsBase ?? path.join(os.homedir(), "filecap-audits");
  // v1.32.0 — fleet-wide file index so each per-site Page view can surface the
  // CMS-hosted files its pages link (inventoried under another site). Built
  // from the FULL roster (allSites), not the include-filtered `sites`, so a
  // targeted rebuild still resolves cross-site links to other sites' caches.
  const fleetAliasMap = buildAliasMap({ sites: allSites });
  const fleetFileIndex = await buildFleetFileIndex(allSites, auditsBase, fleetAliasMap);
  const resolveFleetFile = (fileUrl) => {
    const key = canonicalizeForFleet(fileUrl, fleetAliasMap);
    return key ? (fleetFileIndex.get(key) ?? null) : null;
  };

  // v1.38.0 — pre-pass: record each site's file-accessibility average into a
  // purge-exempt time series (<slug>/a11y-history.json as of v1.39.0) and
  // derive the "since last audit" trend. A point is appended only when the
  // numbers change, so template-only rebuilds don't pad the series. The
  // excluded archive and zero-scored sites are skipped (no displayable score).
  // Runs before the main loop so the trend can be handed to BOTH the detail
  // page and the card.
  const a11yNowIso = new Date().toISOString();
  const a11yTrendBySlug = new Map();
  const a11yHistoryBySlug = new Map();
  for (const site of sites) {
    const slug = site?.name;
    if (!slug) continue;
    const inv = latestInventoryPath(auditsBase, slug);
    let summary;
    try {
      await fs.stat(inv);
      summary = await computeSiteSummary(inv);
    } catch {
      continue; // no inventory for this site yet
    }
    const a = summarizeFileA11y({
      auditScoreSum: summary.auditScoreSum,
      auditedDocCount: summary.auditedDocCount,
      auditErrorCount: summary.auditErrorCount,
      auditPending: summary.auditPending,
      unscoreable: summary.unscoreableCount,
      remediable: summary.remediable,
      siteSlug: slug,
    });
    if (a.excluded || a.scored === 0 || a.avg === null) continue;
    // v1.39.0 (E2): the series lives at <auditsBase>/<slug>/a11y-history.json
    // (purge-safe, survives latest repoints); loadA11yHistory migrates any
    // points stranded at the old latest/ + runs/*Z locations on first touch,
    // and the write is atomic (tmp + rename).
    const { histPath, history } = await loadA11yHistory(auditsBase, slug);
    // On-disk key stays "pdfs" for continuity; from v1.54.0 the value counts ALL scored documents (PDF + Office), not just PDFs — points before that date are PDF-only.
    const updated = appendA11yPoint(history, {
      at: a11yNowIso, avg: a.avg, scored: a.scored, pdfs: a.docs,
      remediable: a.remediable, band: a.band?.key ?? null,
    });
    try {
      await writeA11yHistoryAtomic(histPath, updated);
    } catch (e) {
      process.stderr.write(`WARN: could not write a11y-history for ${slug}: ${e.message}\n`);
    }
    a11yHistoryBySlug.set(slug, updated);
    const t = a11yTrend(updated);
    a11yTrendBySlug.set(slug, t ? { delta: t.delta, dir: t.dir, sinceText: fmtChicagoDate(t.sinceAt) } : null);
  }

  for (const site of sites) {
    const siteKey = site.name;
    if (!siteKey) {
      process.stderr.write(`WARN: skipping ${site.siteName ?? "(unnamed)"}: no server name configured\n`);
      continue;
    }
    const rawInv = path.join(auditsBase, siteKey, "latest", "inventory.ndjson");
    // v1.8.0 + v1.9.0: prefer the most-augmented inventory available.
    //   inventory.audited.ndjson      ← v1.9.0, has entry.audit + entry.references[]
    //   inventory.cross-ref.ndjson    ← v1.8.0, has entry.references[]
    //   inventory.ndjson              ← v1.0.0, raw scan
    // The most-augmented file is always a strict superset of the previous,
    // so this chain just walks "most-recent pipeline step" backward.
    const auditedInv = path.join(auditsBase, siteKey, "latest", "inventory.audited.ndjson");
    const crossRefInv = path.join(auditsBase, siteKey, "latest", "inventory.cross-ref.ndjson");
    let auditedStat, crossRefStat;
    try { auditedStat = await fs.stat(auditedInv); } catch { auditedStat = null; }
    try { crossRefStat = await fs.stat(crossRefInv); } catch { crossRefStat = null; }
    const latestInv = auditedStat ? auditedInv : (crossRefStat ? crossRefInv : rawInv);
    let stat;
    try { stat = await fs.stat(latestInv); } catch { stat = null; }

    if (!stat) {
      process.stderr.write(`WARN: skipping ${site.siteName ?? siteKey}: no scan at ${rawInv}\n`);
      continue;
    }

    // Read the header to get the scan timestamp
    const header = await readNdjsonHeader(latestInv);
    if (!header) {
      process.stderr.write(`WARN: skipping ${site.siteName ?? siteKey}: cannot parse inventory header\n`);
      continue;
    }

    const scanTimestamp = formatScanTimestamp(header.metadata?.scannedAt);
    const siteLabelForSlug = site.siteName ?? siteKey;
    const baseName = `${slug(siteLabelForSlug)}-${scanTimestamp}`;

    // 4. Run runReport against the latest inventory in a temp dir
    const tempDir = path.join(output, `.__tmp_${baseName}`);
    await fs.mkdir(tempDir, { recursive: true });

    // Web-rollup bundles index.html as a sibling of each per-site report —
    // pass backHref so each detail page has a "← Back to fleet index" link.
    // csvHref points at the per-site workbook (<slug>-<timestamp>.xlsx,
    // written in step 5 below when the site has any sheets).
    // siteUrl is the site's front-end homepage URL from sites.json (e.g.
    // dvfr.illinois.gov), distinct from publicUrlBase (the file server).
    const accessKind = deriveAccessKind(site);
    // v1.14.0: fetch the site's sitemap.xml so the Page view lists every page,
    // not just the file-linking ones. Try references.sitemapUrl, then the
    // frontend siteUrl, then publicUrlBase — some sites' siteUrl domain isn't
    // live and the deployed copy sits on the publicUrlBase host (e.g. VPP).
    // First non-empty hit wins; a missing or broken sitemap resolves to [].
    const sitemapCandidates = [];
    if (site.references?.sitemapUrl) sitemapCandidates.push(site.references.sitemapUrl);
    for (const b of [site.siteUrl, site.publicUrlBase]) {
      const base = String(b ?? "").replace(/\/+$/, "");
      if (base) sitemapCandidates.push(`${base}/sitemap.xml`);
    }
    let sitemapUrls = [];
    for (const cand of sitemapCandidates) {
      sitemapUrls = await fetchSitemapUrls(cand);
      if (sitemapUrls.length > 0) break;
    }
    // A site that lives under a path (e.g. Research Hub at
    // icjia.illinois.gov/researchhub/) usually shares the parent site's full
    // sitemap — scope the URLs to the site's own path so the Page view lists
    // only its pages, not the whole parent site's.
    sitemapUrls = scopeSitemapUrlsToSite(sitemapUrls, site.siteUrl);
    process.stderr.write(`[web-rollup] ${site.siteName ?? siteKey}: ${sitemapUrls.length} sitemap page URLs\n`);
    // v1.14.x: also merge the site's full CMS page list — every content
    // entry's page, from the references sidecar retained in latest/ — so the
    // Page view is complete even where the sitemap is missing or partial.
    let cmsPages = [];
    let pageRefFiles = new Map();
    try {
      const sidecarPath = path.join(path.dirname(latestInv), "references-sidecar.ndjson");
      const sidecarContent = await fs.readFile(sidecarPath, "utf8");
      cmsPages = parseCmsPageList(sidecarContent);
      pageRefFiles = parsePageRefFiles(sidecarContent);
    } catch {
      // no retained sidecar for this site — the Page view uses the sitemap only
    }
    if (cmsPages.length > 0) {
      process.stderr.write(`[web-rollup] ${site.siteName ?? siteKey}: ${cmsPages.length} CMS page URLs\n`);
    }
    // v1.39.0 (E3): sidecar read moved to the relocated canonical path
    // (<slug>/site-audit.json) with a one-release latest/ fallback.
    const { siteAudit, pageScores } = loadSiteAudit(auditsBase, siteKey);

    // 5. v1.20.0 — per-site XLSX replaces the per-site CSV. Multi-sheet
    // workbook with one tab per remediable file type, scoped to this site.
    // Reference categories (images / text / archives / web / audio-video /
    // other) are dropped so the download holds only what vendors quote
    // against. HTML is unchanged (still shows everything, chip filter
    // available). v1.39.0 (E8): the sheet configs are built BEFORE runReport
    // so the detail page's download link can be omitted (csvHref: null) when
    // no workbook will be written for this site.
    const srcHtml = path.join(tempDir, "audit-file-list.html");
    const dstXlsx = path.join(output, `${baseName}.xlsx`);
    const dstHtml = path.join(output, `${baseName}.html`);

    // Stream the per-site inventory + build sheets per remediable bucket.
    const { siteHeader: perSiteHeader, entries: perSiteEntries } = await readInventoryNdjson(latestInv);
    // v1.39.0 (E6, Interface Contracts 4+5): per-site sheet URLs build from
    // sites.json-resolved metadata — publicUrlBase (authoritative over a
    // stale cached header, mirroring the consolidatedSources override below)
    // and pathPrefix — extending the v1.29.0 pagesHeader pattern to ALL
    // per-site sheets.
    const sheetMetaOverride = {};
    if (site.publicUrlBase) sheetMetaOverride.publicUrlBase = site.publicUrlBase;
    if (site.pathPrefix) sheetMetaOverride.pathPrefix = site.pathPrefix;
    const perSiteSheetHeader = Object.keys(sheetMetaOverride).length > 0
      ? { ...perSiteHeader, metadata: { ...perSiteHeader.metadata, ...sheetMetaOverride } }
      : perSiteHeader;
    const perSiteSheetConfigs = [];
    for (const bucket of TYPE_BUCKETS) {
      if (bucket.side !== "remediable") continue;
      const bucketEntries = perSiteEntries.filter((e) => bucket.keys.includes(e?.category));
      if (bucketEntries.length === 0) continue;
      perSiteSheetConfigs.push({
        name: bucket.sheetName,
        sourceHeader: perSiteSheetHeader,
        entries: bucketEntries,
        sources: null,
        totals: bucket.slug === "pdfs" ? { pageCount: true } : undefined,
      });
    }
    // v1.29.0 — "Pages" tab, the workbook twin of the HTML Page view: one
    // row per page with the files it links (file-linking pages first), then
    // cms/sitemap pages that link nothing. Same inputs as the HTML report.
    const pageList = buildPageList(perSiteEntries, sitemapUrls, cmsPages, pageScores);
    attachCrossSiteFiles(pageList, {
      pageRefFiles,
      resolveFleetFile,
      currentSiteName: perSiteHeader.metadata?.serverName ?? siteKey,
    });
    const pageRows = pageList
      .map((p) => {
        // v1.31.0 — mirrors the HTML Page view: a file is listed once, under
        // the first page that links it; repeat mentions on later pages roll
        // up into "Files listed elsewhere" so no filename appears twice.
        // v1.32.0 — crossSite = CMS-hosted files the page links, owned by
        // another fleet site.
        const files = p.files ?? [];
        const filesElsewhere = p.dupeFileCount ?? 0;
        const crossSite = p.crossSiteFiles ?? [];
        const linksSomething = files.length > 0 || filesElsewhere > 0 || crossSite.length > 0;
        return {
          pageUrl: p.pageUrl,
          contentType: p.contentType || "",
          source: linksSomething ? "links files" : (p.fromSitemap ? "sitemap" : "cms"),
          fileCount: files.length,
          filesElsewhere,
          fileNames: files.map((f) => f.filename ?? f.path ?? "").join("; "),
          fileUrls: files
            .map((f) => buildPublicUrl({ entry: f, sourceHeader: perSiteSheetHeader, sourceMap: null, isConsolidated: false }))
            .filter(Boolean)
            .join("; "),
          crossSiteFiles: crossSite
            .map((f) => (f.siteLabel ? `${f.filename} (${f.siteLabel})` : f.filename))
            .join("; "),
        };
      })
      .sort((a, b) => (b.fileCount - a.fileCount) || a.pageUrl.localeCompare(b.pageUrl));
    if (pageRows.length > 0) {
      perSiteSheetConfigs.push({
        name: "Pages",
        columns: [
          { key: "pageUrl", label: "Page", type: "url" },
          { key: "contentType", label: "Content type" },
          { key: "source", label: "Source" },
          { key: "fileCount", label: "Files", type: "number" },
          { key: "filesElsewhere", label: "Files listed elsewhere", type: "number" },
          { key: "fileNames", label: "File names" },
          { key: "fileUrls", label: "File URLs" },
          { key: "crossSiteFiles", label: "Files on other sites" },
        ],
        rows: pageRows,
      });
    }
    // v1.39.0 (E8): only claim a downloadable workbook when one will exist.
    const hasWorkbook = perSiteSheetConfigs.length > 0;

    const reportResult = await runReport({
      input: latestInv,
      outputDir: tempDir,
      html: true,
      backHref: "index.html",
      csvHref: hasWorkbook ? `${baseName}.xlsx` : null,
      siteUrl: site.siteUrl ?? null,
      siteFullName: site.siteFullName ?? null,
      accessKind,
      pathPrefix: site.pathPrefix ?? null,
      // v1.39.0 (E6, Interface Contract 5): sites.json's publicUrlBase is
      // authoritative for the detail page's per-row URLs too — cached
      // headers may carry a stale base from before a domain move.
      publicUrlBaseOverride: site.publicUrlBase ?? null,
      sitemapUrls,
      cmsPages,
      // v1.32.0 — cross-site (CMS-hosted) file resolution for the Page view.
      resolveFleetFile,
      pageRefFiles,
      currentSiteName: header.metadata?.serverName ?? siteKey,
      siteSlug: siteKey,
      fileA11yTrend: a11yTrendBySlug.get(siteKey) ?? null,
      siteAudit,
      pageScores,
    });
    if (reportResult.exitCode !== 0) {
      process.stderr.write(`WARN: skipping ${site.siteName ?? siteKey}: report generation failed (${reportResult.error ?? ""})\n`);
      await fs.rm(tempDir, { recursive: true, force: true });
      continue;
    }

    if (hasWorkbook) {
      await writeXlsxMultiSheet({ outputPath: dstXlsx, sheets: perSiteSheetConfigs });
    }

    const useClientGate = !noClientGate && password !== null;
    let htmlContent = await fs.readFile(srcHtml, "utf8");
    if (useClientGate) {
      const hexHash = computeHash(password);
      htmlContent = injectPasswordGate(htmlContent, hexHash);
    }
    await fs.writeFile(dstHtml, htmlContent);
    await fs.rm(tempDir, { recursive: true, force: true });

    // Compute per-site summary stats
    const summary = await computeSiteSummary(latestInv);

    // Accumulate entries from this site's inventory for the master CSV +
    // cross-server duplicate detection. We re-read the file here (small cost
    // — the bigger work is rsync + scan, both already done) so the existing
    // `runReport` path is left undisturbed.
    const siteServerName = site.name;
    const siteSiteName = site.siteName ?? site.name ?? "";
    const sitePublicUrlBase = site.publicUrlBase ?? header.metadata?.publicUrlBase ?? "";
    const stream2 = createReadStream(latestInv, { encoding: "utf8" });
    const rl2 = readline.createInterface({ input: stream2, crlfDelay: Infinity });
    for await (const line of rl2) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      const kind = obj.kind ?? "";
      if (kind === "filecap-inventory-header" || kind === "filecap-consolidated-header") continue;
      if (kind === "filecap-inventory-footer" || kind === "filecap-consolidated-footer") continue;
      // v1.47.0 — system files never reach allEntries, so the master
      // workbook, duplicates, NDJSON, per-type pages, and search index all
      // exclude them in one place.
      if (isSystemFile(obj.filename)) continue;
      // Stamp serverName on each entry — the consolidated CSV path in csv.js
      // reads `entry.serverName` to look up the per-site metadata.
      obj.serverName = siteServerName;
      allEntries.push({
        entry: obj,
        serverName: siteServerName,
        siteName: siteSiteName,
        publicUrlBase: sitePublicUrlBase,
        // v1.39.0 (E6, Interface Contract 4): collectAuditErrors' publicUrlFor
        // inserts this between the base and the entry path (git sites deployed
        // under a sub-path).
        pathPrefix: site.pathPrefix ?? null,
      });
    }

    // Merge sites.json metadata (siteName, host, remotePath, publicUrlBase) on
    // top of the NDJSON header — sites.json is authoritative for the
    // user-visible nickname, the public URL base, and remote path. Cached
    // inventories from older scans may still carry stale values that the
    // current sites.json has corrected (e.g. a domain rename). v1.7.2: also
    // override publicUrlBase / remotePath / host so an edit to sites.json
    // takes effect on the next rollup without forcing a full re-scan.
    // v1.21.2 — strip server-identity fields (serverIp, scannedPath, hostname)
    // before they land in the consolidated sources, which ship in the
    // audit-fleet.ndjson header. Pure origin-server recon with no per-file
    // value; the public URL + relative path are what consumers actually need.
    // eslint-disable-next-line no-unused-vars
    const { serverIp: _ip, scannedPath: _sp, hostname: _hn, ...metaScrubbed } = header.metadata ?? {};
    consolidatedSources.push({
      ...metaScrubbed,
      siteName: site.siteName ?? header.metadata?.siteName ?? "",
      serverName: header.metadata?.serverName ?? siteServerName,
      publicUrlBase: sitePublicUrlBase || header.metadata?.publicUrlBase || "",
      // v1.9.0: pathPrefix lives in sites.json. Passed through to the
      // master CSV / consolidated rollup so buildPublicUrl can include
      // it for sites that need it (old Vue 2 ARI Summit deploys).
      pathPrefix: site.pathPrefix ?? null,
    });

    siteResults.push({
      site: { ...site, siteFullName: site.siteFullName ?? null, accessKind },
      header,
      summary,
      htmlFile: `${baseName}.html`,
      // v1.20.0: per-site download is the multi-sheet .xlsx workbook now.
      // v1.39.0 (E8, Interface Contract 6): null when no workbook was written
      // (zero sheets) — renderers omit the download link for null.
      csvFile: hasWorkbook ? `${baseName}.xlsx` : null,
      scannedAt: header.metadata?.scannedAt ?? null,
      siteAudit,
      fileA11yTrend: a11yTrendBySlug.get(site.name) ?? null,
    });
  }

  if (siteResults.length === 0) {
    return { exitCode: 2, error: "no sites had scans available — nothing to bundle" };
  }

  // ── v1.21.0: /sites roster + OG enrichment ─────────────────────────────
  // Build a directory entry for EVERY filtered site (scanned or not), then
  // enrich each content site and tooling app with its og:image /
  // og:description and download thumbnails into assets/og/. Best-effort and
  // concurrency-limited; skipped under noOg (tests). A registered-but-unscanned
  // site contributes whatever sites.json knows (its scan header is null).
  const auditsBaseForRoster = _auditsBase ?? path.join(os.homedir(), "filecap-audits");
  const scannedByServerName = new Map(siteResults.map((sr) => [sr.site.name, sr]));
  const contentRoster = [];
  for (const site of sites) {
    const scanned = scannedByServerName.get(site.name);
    const accessKind = scanned?.site?.accessKind ?? deriveAccessKind(site);
    if (scanned) {
      // v1.42.0 — csvFile (the per-site audit workbook, or null when no
      // workbook was written) rides along so the /sites roster card can offer
      // the same download as the home-page card.
      contentRoster.push({ site: scanned.site, header: scanned.header, accessKind, csvFile: scanned.csvFile });
    } else {
      const header = await readLatestHeaderBestEffort(site.name, auditsBaseForRoster);
      contentRoster.push({ site: { ...site, accessKind }, header, accessKind });
    }
  }

  const ogLimit = pLimit(5);
  const sitesDir = path.dirname(sitesPath);

  // Resolve a local `image` path to an on-disk file. Relative paths are tried
  // against the sites.json dir, then the package root, then cwd; absolute paths
  // are used as-is. Returns the resolved path or null.
  async function resolveLocalImage(src) {
    const candidates = path.isAbsolute(src)
      ? [src]
      : [path.resolve(sitesDir, src), path.resolve(PKG_ROOT, src), path.resolve(process.cwd(), src)];
    for (const c of candidates) {
      try { if ((await fs.stat(c)).isFile()) return c; } catch { /* try next */ }
    }
    return null;
  }

  // Bring an image SOURCE into the bundle and return its bundle-relative path
  // (or null). v1.25.0 — a config `image` may be an http(s) URL (downloaded)
  // OR a local file path (copied), so a site whose og:image is unreachable —
  // e.g. behind an auth wall, like the gated fleet-audit bundle — can still
  // carry its own card image. A non-URL path matching no file is treated as an
  // already-in-bundle path (legacy). URLs are skipped under noOg (no network).
  async function bundleImage(src, slugName) {
    if (!src) return null;
    if (/^https?:\/\//i.test(src)) {
      if (noOg) return null;
      let bytes = null;
      try { bytes = await _imageFetch(src); } catch { bytes = null; }
      if (!bytes) return null;
      const rel = `assets/og/${slugName}.${bytes.ext}`;
      try { await fs.writeFile(path.join(output, rel), bytes.buffer); return rel; }
      catch { return null; }
    }
    const local = await resolveLocalImage(src);
    if (local) {
      const ext = (path.extname(local).slice(1) || "png").toLowerCase();
      const rel = `assets/og/${slugName}.${ext}`;
      try { await fs.copyFile(local, path.join(output, rel)); return rel; }
      catch { return null; }
    }
    return src; // legacy: assume an already-in-bundle path
  }

  // Description + live/down status from the og scrape; the card image prefers
  // an explicit config `image` (URL or local file), else the scraped og:image.
  // v1.39.0 (E4): a config `description` wins over the scraped og:description
  // — mirroring configImage — so a curated blurb (or a gated site whose scrape
  // 401s, like the fleet-audit tool itself) keeps its copy.
  async function enrichOg({ url, slug: slugName, configImage, configDescription }) {
    let og = { image: null, title: null, description: null, reachable: false };
    let status = null;
    if (!noOg && url) {
      try { og = await _ogFetch(url); } catch { /* best-effort */ }
      status = og.reachable ? "live" : "down";
    }
    const scrapedDescription = !noOg && url ? og.description || "" : "";
    const description = configDescription || scrapedDescription || "";
    const image = await bundleImage(configImage || og.image, slugName);
    return { description, image, status };
  }

  await Promise.all(contentRoster.map((entry) => ogLimit(async () => {
    const s = entry.site;
    const url = s.siteUrl ?? s.publicUrlBase ?? entry.header?.metadata?.publicUrlBase ?? "";
    const { description, image, status } = await enrichOg({
      url,
      slug: slug(s.name ?? s.siteName ?? "site"),
      configImage: s.image,
      configDescription: s.description,
    });
    entry.description = description;
    entry.image = image;
    entry.status = status;
  })));

  const toolsEnriched = tools.map((t) => ({ ...t }));
  await Promise.all(toolsEnriched.map((t) => ogLimit(async () => {
    const { description, image, status } = await enrichOg({
      url: t.siteUrl,
      slug: slug(t.name ?? t.siteName ?? "tool"),
      configImage: t.image,
      configDescription: t.description,
    });
    t.description = description;
    t.image = image;
    t.status = status;
  })));

  // v1.21.3 — propagate the live/down status onto siteResults so the landing
  // page's fleet cards show the same dot as /sites (matched by server name).
  // v1.24.0 — likewise carry each site's og:description onto the fleet card.
  // v1.26.0 — and the bundled og:image (assets/og/<slug>) so the home-page
  // content cards show the exact same thumbnail as the /sites roster cards.
  const statusByServerName = new Map(contentRoster.map((e) => [e.site.name, e.status]));
  const descByServerName = new Map(contentRoster.map((e) => [e.site.name, e.description]));
  const imageByServerName = new Map(contentRoster.map((e) => [e.site.name, e.image]));
  for (const sr of siteResults) {
    sr.status = statusByServerName.get(sr.site.name) ?? null;
    sr.description = descByServerName.get(sr.site.name) ?? "";
    sr.image = imageByServerName.get(sr.site.name) ?? null;
  }

  // v1.22.0 — collect the on-demand uptime targets (the same sites that get a
  // status dot, keyed by the same data-uptime-key) so the generated Netlify
  // function probes exactly them — never anything attacker-supplied.
  const uptimeTargets = [];
  for (const e of contentRoster) {
    const u = e.site?.siteUrl ?? e.site?.publicUrlBase ?? e.header?.metadata?.publicUrlBase;
    if (e.site?.name && u) uptimeTargets.push({ key: e.site.name, url: u });
  }
  for (const t of toolsEnriched) {
    if (t.name && t.siteUrl) uptimeTargets.push({ key: t.name, url: t.siteUrl });
  }

  // 6a. Build the master XLSX (every REMEDIABLE file across every site).
  //     v1.20.0: was .csv with every file; downloads are now .xlsx and
  //     filtered to remediable categories only — vendors don't quote
  //     against images/text/archives so they're just noise in a worksheet.
  const masterCsvFilename = "audit-file-list-master.xlsx";
  let masterCsvMeta = null;
  if (allEntries.length > 0) {
    const masterHeader = {
      schemaVersion: 1,
      kind: "filecap-consolidated-header",
      metadata: {
        consolidatedAt: new Date().toISOString(),
        filecapVersion: "web-rollup",
        sources: consolidatedSources,
      },
    };
    const masterEntries = allEntries
      .map((it) => it.entry)
      .filter(isRemediableEntry);
    const masterCsvPath = path.join(output, masterCsvFilename);
    await writeXlsx({
      sourceHeader: masterHeader,
      entries: masterEntries,
      sources: consolidatedSources,
      outputPath: masterCsvPath,
      sheetName: "All remediable files",
    });
    const masterStat = await fs.stat(masterCsvPath);
    masterCsvMeta = {
      filename: masterCsvFilename,
      fileCount: masterEntries.length,
      byteCount: masterStat.size,
      // v1.7.16: the master CSV is "as of right now" — its lastAuditAt is the
      // moment we built this rollup. Surface it under the download button so
      // staff can tell if their downloaded copy is current.
      lastAuditAt: new Date().toISOString(),
    };
  }

  // 6a-ii. v1.34.1 — scores-by-site summary (manager bird's-eye view).
  //   One row per site with PDF score coverage + the A–F grade distribution,
  //   plus a fleet TOTAL row. A downloadable companion to the 4,500-row master
  //   so "give me the sites and their scores" is one click, not a pivot table.
  let scoresBySiteMeta = null;
  if (siteResults.length > 0) {
    const scoresBySiteFilename = "scores-by-site.xlsx";
    const scoresRows = buildScoresBySiteRows(
      siteResults.map((r) => ({
        siteName: r.site?.siteName ?? r.site?.name ?? "",
        summary: r.summary,
      })),
    );
    const scoresPath = path.join(output, scoresBySiteFilename);
    await writeXlsxFromRows({
      outputPath: scoresPath,
      sheetName: "Scores by site",
      columns: SCORES_BY_SITE_COLUMNS,
      rows: scoresRows,
    });
    const scoresStat = await fs.stat(scoresPath);
    scoresBySiteMeta = {
      filename: scoresBySiteFilename,
      siteCount: scoresRows.length - 1, // minus the fleet TOTAL row
      byteCount: scoresStat.size,
      lastAuditAt: new Date().toISOString(),
    };
  }

  // (LLM-context files are emitted AFTER duplicate detection — see 6c below.)
  let llmContextMeta = null;

  // 6a-bis. v1.7.14 → v1.20.0 — per-file-type HTML detail pages + single
  // multi-sheet audit.xlsx for the remediable formats.
  //   For every non-empty REMEDIABLE bucket, collect the entries for an
  //   audit.xlsx tab; ALL non-empty buckets still get audit-<slug>.html for
  //   the website (the HTML can filter to remediable/reference, but the
  //   per-type pages are still useful as "show me every image" links).
  //   No per-type CSVs (they're noise now that downloads are a single
  //   multi-tab XLSX) — reference buckets (images / text / archives / ...)
  //   ship with HTML only, no download.
  const byTypeCsvs = [];
  const remediableSheetConfigs = [];
  if (allEntries.length > 0) {
    for (const bucket of TYPE_BUCKETS) {
      const filtered = allEntries.filter((it) => bucket.keys.includes(it.entry?.category));
      if (filtered.length === 0) continue;

      // Reuse the same consolidated-header shape that the master CSV/HTML
      // path uses. Setting `siteName` to bucket.label gives the dp-hero a
      // nickname/eyebrow that reads as a file-type page rather than a site.
      const byTypeHeader = {
        schemaVersion: 1,
        kind: "filecap-consolidated-header",
        metadata: {
          consolidatedAt: new Date().toISOString(),
          filecapVersion: "web-rollup",
          sources: consolidatedSources,
          siteName: "Across the fleet",
        },
      };
      const filteredEntries = filtered.map((it) => it.entry);
      const isRemediableBucket = bucket.side === "remediable";

      const htmlFilename = `audit-${bucket.slug}.html`;
      let htmlOk = false;
      try {
        await writeHtml({
          sourceHeader: byTypeHeader,
          entries: filteredEntries,
          sources: consolidatedSources,
          outputPath: path.join(output, htmlFilename),
          backHref: "index.html",
          // v1.20.0: only remediable per-type pages get a download link,
          // and the link goes to the shared multi-sheet audit.xlsx (the
          // browser opens the workbook; the user clicks the right tab).
          csvHref: isRemediableBucket ? "audit.xlsx" : null,
          siteUrl: null,
          siteFullName: bucket.label,
          accessKind: null,
        });
        htmlOk = true;
        if (!noClientGate && password !== null) {
          const hexHash = computeHash(password);
          const html = await fs.readFile(path.join(output, htmlFilename), "utf8");
          await fs.writeFile(path.join(output, htmlFilename), injectPasswordGate(html, hexHash));
        }
      } catch (err) {
        process.stderr.write(`WARN: failed to write ${htmlFilename}: ${err.message}\n`);
      }

      if (isRemediableBucket) {
        remediableSheetConfigs.push({
          name: bucket.sheetName,
          sourceHeader: byTypeHeader,
          entries: filteredEntries,
          sources: consolidatedSources,
          // v1.20.0: the PDFs tab gets a bottom SUM row over Page Count so a
          // vendor can read "how many pages do I need to quote against" at a
          // glance without writing a formula.
          totals: bucket.slug === "pdfs" ? { pageCount: true } : undefined,
        });
      }

      byTypeCsvs.push({
        slug: bucket.slug,
        side: bucket.side,
        label: bucket.label,
        keys: bucket.keys,
        // v1.20.0: csvFilename is now the multi-sheet audit.xlsx for all
        // remediable buckets, null for reference buckets (no download).
        csvFilename: isRemediableBucket ? "audit.xlsx" : null,
        xlsxFilename: isRemediableBucket ? "audit.xlsx" : null,
        sheetName: bucket.sheetName ?? null,
        htmlFilename: htmlOk ? htmlFilename : null,
        fileCount: filtered.length,
        byteCount: 0,
      });
    }
  }

  // 6a-ter. v1.20.0 — write the single multi-sheet audit.xlsx that the index
  // by-type table now links to (one workbook, one tab per remediable file
  // type, no images / text / archives noise). Filled by the loop above.
  // v1.21.0 — the audit.xlsx metadata object here was dead (assigned, never
  // read); dropped so lint stays clean. The workbook write + the byteCount
  // backfill onto byTypeCsvs remain.
  if (remediableSheetConfigs.length > 0) {
    const auditXlsxPath = path.join(output, "audit.xlsx");
    await writeXlsxMultiSheet({ outputPath: auditXlsxPath, sheets: remediableSheetConfigs });
    const auditXlsxStat = await fs.stat(auditXlsxPath);
    // Backfill byteCount on the byTypeCsvs entries that pointed at audit.xlsx
    // so callers that report sizes have a non-zero figure to show.
    for (const meta of byTypeCsvs) {
      if (meta.xlsxFilename === "audit.xlsx") meta.byteCount = auditXlsxStat.size;
    }
  }

  // 6b. Detect cross-server duplicates by normalised filename, then write the
  //     per-occurrence duplicates XLSX alongside the master XLSX. v1.20.0: was
  //     .csv with every entry; emitted as a real workbook (one row per file
  //     occurrence within each duplicate group).
  // v1.39.0 (E5): the detector runs over ALL entries again. The v1.20.0
  // remediable-only pre-filter left the index page's Reference-only /
  // All duplicate filters permanently empty — the page classifies each
  // group's side by filename extension, so it was built for the full data.
  const duplicateGroups = findCrossServerDuplicates(allEntries);
  const duplicatesCsvFilename = "audit-file-duplicates.xlsx";
  let duplicatesCsvMeta = null;
  if (duplicateGroups.length > 0) {
    const dupPath = path.join(output, duplicatesCsvFilename);
    const dupRows = [];
    for (const g of duplicateGroups) {
      const matchType = g.isExactDuplicate ? "exact copy" : "different content";
      for (const item of g.items) {
        dupRows.push({
          normalisedFilename: g.normalizedFilename,
          matchType,
          groupSize: g.items.length,
          siteName: item.siteName ?? "",
          serverName: item.serverName ?? "",
          modifiedAt: item.modifiedAt ?? "",
          sizeBytes: item.sizeBytes ?? 0,
          path: item.path ?? "",
          shaPrefix: item.sha256 ? item.sha256.slice(0, 12) : "",
        });
      }
    }
    await writeXlsxFromRows({
      outputPath: dupPath,
      sheetName: "Duplicates",
      columns: [
        { key: "normalisedFilename", label: "Normalised filename" },
        { key: "matchType",          label: "Match type" },
        { key: "groupSize",          label: "Group size", type: "number" },
        { key: "siteName",           label: "Website" },
        { key: "serverName",         label: "Server" },
        { key: "modifiedAt",         label: "Date published" },
        { key: "sizeBytes",          label: "Size (bytes)", type: "number" },
        { key: "path",               label: "Path" },
        { key: "shaPrefix",          label: "Content hash (SHA-256, first 12)" },
      ],
      rows: dupRows,
    });
    const dupStat = await fs.stat(dupPath);
    const occurrenceCount = duplicateGroups.reduce((s, g) => s + g.items.length, 0);
    duplicatesCsvMeta = {
      filename: duplicatesCsvFilename,
      groupCount: duplicateGroups.length,
      occurrenceCount,
      byteCount: dupStat.size,
    };
  }

  // 6b-iii. v1.11.0 — orphaned-files report.
  //   audit-orphaned-files.xlsx: every remediable file with `references: []` after
  //                              cross-resolution, plus its fuzzy-matched
  //                              upgrade-replacement (if any) and a
  //                              confidence score (0-95).
  //   audit-orphaned-files.html: same data, rendered with explainer +
  //                              per-site orphan-rate breakdown.
  // Only entries with references resolved (i.e. an array, not undefined or
  // null) participate. Per-site totals count only resolved entries.
  let orphansMeta = null;
  if (allEntries.length > 0) {
    const resolvableEntries = allEntries
      .map((it) => it.entry)
      .filter((e) => Array.isArray(e?.references));
    // v1.20.0: orphans are filtered to remediable formats only. Reference
    // files (images, etc.) that are unreferenced are noise — vendors don't
    // care about them and the report wasn't actionable for them anyway.
    const remediableOrphans = classifyOrphans(resolvableEntries.filter(isRemediableEntry));
    const orphans = remediableOrphans;
    if (orphans.length > 0) {
      const siteTotals = new Map();
      for (const e of resolvableEntries.filter(isRemediableEntry)) {
        const k = e.serverName ?? "";
        siteTotals.set(k, (siteTotals.get(k) ?? 0) + 1);
      }
      const orphansCsvFilename = "audit-orphaned-files.xlsx";
      const orphansHtmlFilename = "audit-orphaned-files.html";
      const sourcesByServer = new Map();
      for (const s of consolidatedSources) {
        if (s.serverName) sourcesByServer.set(s.serverName, s);
      }
      const orphanRows = orphans.map((o) => {
        const e = o.entry;
        const source = sourcesByServer.get(e.serverName ?? "");
        const siteLabel = source?.siteName ?? e.serverName ?? "";
        // v1.39.0 post-audit fix (red-1 R2): shared format.js publicUrlFor —
        // per-segment encoding (Sheet#… → Sheet%23…) instead of raw concat,
        // matching the audit-errors and orphans-html emitters.
        const publicUrl = publicUrlFor(e, source?.publicUrlBase, source?.pathPrefix);
        return {
          siteLabel, path: e.path ?? "", filename: e.filename ?? "",
          extension: e.extension ?? "", sizeBytes: e.sizeBytes ?? "",
          modifiedAt: e.modifiedAt ?? "", daysOld: o.daysOld ?? "",
          status: o.status, confidence: o.replaceabilityConfidence,
          replacedBy: o.replacedBy ?? "", replacedOn: o.replacedOn ?? "",
          daysBetween: o.daysBetween ?? "", reasons: (o.reasons ?? []).join("|"),
          groupSize: o.groupSize, publicUrl,
        };
      });
      await writeXlsxFromRows({
        outputPath: path.join(output, orphansCsvFilename),
        sheetName: "Orphaned files",
        columns: [
          { key: "siteLabel",   label: "Site" },
          { key: "path",        label: "Path" },
          { key: "filename",    label: "Filename" },
          { key: "extension",   label: "Type" },
          { key: "sizeBytes",   label: "Size (bytes)", type: "number" },
          { key: "modifiedAt",  label: "Modified" },
          { key: "daysOld",     label: "Days old", type: "number" },
          { key: "status",      label: "Status" },
          { key: "confidence",  label: "Confidence %", type: "number" },
          { key: "replacedBy",  label: "Replaced by" },
          { key: "replacedOn",  label: "Replaced on" },
          { key: "daysBetween", label: "Days between", type: "number" },
          { key: "reasons",     label: "Reasons" },
          { key: "groupSize",   label: "Group size", type: "number" },
          { key: "publicUrl",   label: "Public URL", type: "url" },
        ],
        rows: orphanRows,
      });
      const csvStat = await fs.stat(path.join(output, orphansCsvFilename));
      const htmlText = writeOrphansHtml({
        orphans,
        sources: consolidatedSources,
        siteTotals,
        backHref: "index.html",
      });
      const htmlPath = path.join(output, orphansHtmlFilename);
      await fs.writeFile(htmlPath, htmlText);
      if (!noClientGate && password !== null) {
        const hexHash = computeHash(password);
        const gated = injectPasswordGate(
          await fs.readFile(htmlPath, "utf8"),
          hexHash,
        );
        await fs.writeFile(htmlPath, gated);
      }
      const htmlStat = await fs.stat(htmlPath);
      orphansMeta = {
        csvFilename: orphansCsvFilename,
        htmlFilename: orphansHtmlFilename,
        orphanCount: orphans.length,
        staleRevisionCount: orphans.filter(
          (o) => o.status === "stale-revision",
        ).length,
        trulyUnreferencedCount: orphans.filter(
          (o) => o.status === "truly-unreferenced",
        ).length,
        csvByteCount: csvStat.size,
        htmlByteCount: htmlStat.size,
      };
    }
  }

  // 6b-ii. v1.7.21 — "For AI models" companion files.
  //   audit-fleet.ndjson  : consolidated NDJSON with full introspection
  //                         (every field the CSV strips for readability)
  //   audit-fleet-context.md : human-readable narrative + schema doc +
  //                            sample prompts + CSV-is-actionable disclaimer
  //   Both are read-only. The CSVs remain the primary artefact.
  if (allEntries.length > 0 && masterCsvMeta) {
    const ndjsonFilename = "audit-fleet.ndjson";
    const consolidatedAt = masterCsvMeta.lastAuditAt;
    const ndjsonHeader = {
      schemaVersion: 1,
      kind: "filecap-consolidated-header",
      metadata: { consolidatedAt, filecapVersion: "web-rollup", sources: consolidatedSources },
    };
    const ndjsonFooter = {
      schemaVersion: 1,
      kind: "filecap-consolidated-footer",
      entryCount: allEntries.length,
      consolidatedAt,
    };
    const ndjsonLines = [JSON.stringify(ndjsonHeader)];
    for (const it of allEntries) ndjsonLines.push(JSON.stringify(stripPiiFromEntry(it.entry)));
    ndjsonLines.push(JSON.stringify(ndjsonFooter));
    const ndjsonPath = path.join(output, ndjsonFilename);
    await fs.writeFile(ndjsonPath, ndjsonLines.join("\n") + "\n");
    const ndjsonStat = await fs.stat(ndjsonPath);

    const contextMdFilename = "audit-fleet-context.md";
    const contextMd = buildFleetContextMarkdown({
      allEntries, siteResults,
      duplicateGroupsCount: duplicateGroups.length,
      consolidatedAt, ndjsonFilename,
    });
    const contextMdPath = path.join(output, contextMdFilename);
    await fs.writeFile(contextMdPath, contextMd);
    const contextMdStat = await fs.stat(contextMdPath);

    llmContextMeta = {
      ndjsonFilename,
      ndjsonByteCount: ndjsonStat.size,
      contextMdFilename,
      contextMdByteCount: contextMdStat.size,
      lastAuditAt: consolidatedAt,
    };
  }

  // 6b-iv. Fleet "File errors" report — every file the audit step (or the
  //   scanner's content-type check) flagged, grouped by site. Sites with no
  //   errors are listed too, explicitly marked clean.
  let fileErrorsMeta = null;
  if (allEntries.length > 0) {
    const errorGroups = collectAuditErrors(allEntries);
    const errorsCsvFilename = "audit-file-errors.xlsx";
    const errorsHtmlFilename = "audit-file-errors.html";
    const errorRows = [];
    for (const g of errorGroups ?? []) {
      for (const e of g.errors ?? []) {
        errorRows.push({
          siteName: g.siteName,
          filename: e.filename,
          extension: e.extension,
          sizeBytes: e.sizeBytes,
          publicUrl: e.publicUrl,
          errorText: e.error,
          reason: e.reason,
        });
      }
    }
    await writeXlsxFromRows({
      outputPath: path.join(output, errorsCsvFilename),
      sheetName: "Audit errors",
      columns: [
        { key: "siteName",  label: "Website" },
        { key: "filename",  label: "File" },
        { key: "extension", label: "File type" },
        { key: "sizeBytes", label: "Size (bytes)", type: "number" },
        { key: "publicUrl", label: "Public URL", type: "url" },
        { key: "errorText", label: "Error" },
        { key: "reason",    label: "Likely reason" },
      ],
      rows: errorRows,
    });
    let errorsHtml = generateAuditErrorsPage({ groups: errorGroups, backHref: "index.html" });
    if (!noClientGate && password !== null) {
      errorsHtml = injectPasswordGate(errorsHtml, computeHash(password));
    }
    await fs.writeFile(path.join(output, errorsHtmlFilename), errorsHtml);
    fileErrorsMeta = {
      htmlFilename: errorsHtmlFilename,
      csvFilename: errorsCsvFilename,
      errorCount: errorGroups.reduce((s, g) => s + g.errors.length, 0),
      siteCount: errorGroups.length,
      sitesWithErrors: errorGroups.filter((g) => g.errors.length > 0).length,
    };
  }

  // 6c. Generate index.html with master-CSV link + duplicates section
  const useClientGateForIndex = !noClientGate && password !== null;
  const passwordHash = useClientGateForIndex ? computeHash(password) : null;
  // v1.25.0 — the fleet-audit bundle's own og:image is its tooling-card image
  // (gated, so it can't fetch its own; supplied via the tools[] `image`
  // override). Absolute URL for the <head> meta on the landing + /sites pages.
  const fleetSelfTool = toolsEnriched.find((t) => t.name === "icjia-fleet-audit");
  const ogImageUrl = fleetSelfTool?.image ? `${FLEET_PUBLIC_URL}/${fleetSelfTool.image}` : null;

  const indexHtml = generateIndexHtml({
    siteResults,
    password: passwordHash,
    title,
    masterCsv: masterCsvMeta,
    scoresBySite: scoresBySiteMeta,
    duplicateGroups,
    duplicatesCsv: duplicatesCsvMeta,
    byTypeCsvs,
    llmContext: llmContextMeta,
    orphans: orphansMeta,
    fileErrors: fileErrorsMeta,
    ogImage: ogImageUrl,
  });
  await fs.writeFile(path.join(output, "index.html"), indexHtml);

  // v1.38.0 — consolidated file-accessibility history for the bundle: per-site
  // time series keyed by slug, so a future graph page can fetch one file. The
  // per-site <slug>/a11y-history.json files (v1.39.0 location) are the
  // purge-exempt source of truth; this is the published snapshot.
  await fs.writeFile(
    path.join(output, "a11y-history.json"),
    JSON.stringify(Object.fromEntries(a11yHistoryBySlug), null, 2),
  );

  // 6d. Generate the /accessibility page — current a11y standing + audit log.
  let accessibilityHtml = generateAccessibilityPage({ currentStatus, log: accessibilityLog });
  if (passwordHash) {
    accessibilityHtml = injectPasswordGate(accessibilityHtml, passwordHash);
  }
  await fs.writeFile(path.join(output, "accessibility.html"), accessibilityHtml);

  // 6e. v1.21.0 — /sites roster page + the sites-list.xlsx directory workbook
  // (Content sites + Tooling sites tabs). Roster only — names, owners,
  // descriptions, URLs, and the sites' tech details; no per-file/per-page data.
  // v1.28.0 — two additional single-audience workbooks (content-only and
  // tooling-only) alongside the combined one, and an Owner column (from the
  // optional sites.json `owner` field, blank when unset) on every sheet.
  const sitesListXlsxFilename = "sites-list.xlsx";
  const contentSitesXlsxFilename = "sites-list-content.xlsx";
  const toolingSitesXlsxFilename = "sites-list-tools.xlsx";
  const siteRows = contentRoster.map((e) => {
    const s = e.site;
    return {
      site: s.siteFullName || s.siteName || s.name || "",
      nickname: s.siteName || "",
      owner: s.owner || "",
      description: e.description || "",
      url: s.siteUrl || s.publicUrlBase || e.header?.metadata?.publicUrlBase || "",
      type: s.type || "strapi",
      access: e.accessKind || "",
    };
  });
  const toolRows = toolsEnriched.map((t) => ({
    tool: t.siteFullName || t.siteName || t.name || "",
    nickname: t.siteName || "",
    owner: t.owner || "",
    description: t.description || "",
    url: t.siteUrl || "",
    stack: t.stack || "",
  }));
  const contentSiteColumns = [
    { key: "site", label: "Site" },
    { key: "nickname", label: "Nickname" },
    { key: "owner", label: "Owner" },
    { key: "description", label: "Description" },
    { key: "url", label: "URL", type: "url" },
    { key: "type", label: "Type" },
    { key: "access", label: "Access" },
  ];
  const toolColumns = [
    { key: "tool", label: "Tool" },
    { key: "nickname", label: "Nickname" },
    { key: "owner", label: "Owner" },
    { key: "description", label: "Description" },
    { key: "url", label: "URL", type: "url" },
    { key: "stack", label: "Stack" },
  ];
  await writeXlsxRowsMultiSheet({
    outputPath: path.join(output, sitesListXlsxFilename),
    sheets: [
      { sheetName: "Content sites", columns: contentSiteColumns, rows: siteRows },
      { sheetName: "Tooling sites", columns: toolColumns, rows: toolRows },
    ],
  });
  await writeXlsxFromRows({
    outputPath: path.join(output, contentSitesXlsxFilename),
    sheetName: "Content sites",
    columns: contentSiteColumns,
    rows: siteRows,
  });
  await writeXlsxFromRows({
    outputPath: path.join(output, toolingSitesXlsxFilename),
    sheetName: "Tooling sites",
    columns: toolColumns,
    rows: toolRows,
  });

  let sitesHtml = generateSitesHtml({
    contentRoster,
    tools: toolsEnriched,
    sitesListXlsx: sitesListXlsxFilename,
    contentSitesXlsx: contentSitesXlsxFilename,
    toolingSitesXlsx: toolingSitesXlsxFilename,
    title: "ICJIA site directory",
    generatedAt: fmtChicagoGeneratedAt(new Date().toISOString()),
    ogImage: ogImageUrl,
    // v1.40.0 — the roster can list registered-but-unscanned sites; the lede
    // must not claim more sites are under audit than the snapshot shows.
    auditedCount: siteResults.length,
  });
  if (passwordHash) {
    sitesHtml = injectPasswordGate(sitesHtml, passwordHash);
  }
  await fs.writeFile(path.join(output, "sites.html"), sitesHtml);

  // v1.44.0 — the What's New archive page (every home-page banner, newest
  // first). Gated like every other page of the bundle.
  let whatsNewHtml = generateWhatsNewHtml({
    generatedAt: fmtChicagoGeneratedAt(new Date().toISOString()),
  });
  if (passwordHash) {
    whatsNewHtml = injectPasswordGate(whatsNewHtml, passwordHash);
  }
  await fs.writeFile(path.join(output, "whats-new.html"), whatsNewHtml);

  // v1.46.0 — /search: fleet-wide filename search. One compact JSON of every
  // inventoried file (search-index.js documents the row shape) plus the
  // static page that queries it client-side, gated like every other page.
  const searchIndex = buildSearchIndex({ allEntries, siteResults });
  await fs.writeFile(path.join(output, SEARCH_INDEX_FILENAME), JSON.stringify(searchIndex));
  let searchHtml = generateSearchHtml({
    generatedAt: fmtChicagoGeneratedAt(new Date().toISOString()),
    totalFiles: searchIndex.rows.length,
    siteCount: siteResults.length,
    // Same source as the hero's remediation-list number (per-site summaries),
    // so the two surfaces can never drift apart.
    remediableFiles: siteResults.reduce((n, sr) => n + (sr.summary?.remediable ?? 0), 0),
  });
  if (passwordHash) {
    searchHtml = injectPasswordGate(searchHtml, passwordHash);
  }
  await fs.writeFile(path.join(output, "search.html"), searchHtml);

  // 7. Generate robots.txt
  await fs.writeFile(path.join(output, "robots.txt"), generateRobotsTxt());

  // 8. Generate netlify.toml + _redirects + _headers. _redirects aliases
  // lowercase and extension-less variants of each per-site report URL to
  // the canonical Z.html file. _headers carries the X-Robots-Tag +
  // security headers — Netlify does NOT apply netlify.toml [[headers]] on
  // a no-build manual `netlify deploy --dir`, only a _headers file.
  await fs.writeFile(path.join(output, "netlify.toml"), generateNetlifyToml());
  await fs.writeFile(path.join(output, "_redirects"), generateNetlifyRedirects(siteResults));
  await fs.writeFile(path.join(output, "_headers"), generateNetlifyHeaders());

  // 8a. On-demand uptime probe (Netlify Functions v2). Checks the fleet
  // server-side; the page polls it at most once per 6h (client localStorage
  // gate in uptime-client.js). Emitted only when there are targets to check.
  if (uptimeTargets.length) {
    await fs.mkdir(path.join(output, "netlify", "functions"), { recursive: true });
    await fs.writeFile(
      path.join(output, "netlify", "functions", "uptime.mjs"),
      generateUptimeFunction(uptimeTargets),
    );
  }

  // 9. Generate shared CSS
  await fs.writeFile(path.join(output, "assets", "style.css"), darkModeCss());

  const summary = {
    sitesIncluded: siteResults.length,
    sitesSkipped: sites.length - siteResults.length,
    outputDir: output,
    passwordEnabled: !!password,
    clientGateEnabled: useClientGateForIndex,
  };

  // 9.5 (v1.41.0) — unscored-inventory guard. A rollup whose sites carry
  // scoreable documents but no grades means the `filecap audits` stage never
  // produced its output; shipping that would blank every Remediation Score on
  // the live report. Warn always, and refuse the deploy unless the operator
  // opted in. The bundle is already written either way, so the degraded
  // output stays inspectable.
  // The guard keys off whether a deploy will ACTUALLY run, not the flag:
  // FILECAP_NO_DEPLOY=1 turns an autoDeploy config into a build-only run, and
  // blocking one of those would just break local rebuilds. Same env check
  // runNetlifyDeploy() makes, read here so the decision stays pure.
  const deployWillRun = deploy && process.env.FILECAP_NO_DEPLOY !== "1";
  const unscored = findUnscoredSites(siteResults);
  const guard = unscoredGuardDecision({ unscored, deploy: deployWillRun, allowUnscored });
  if (guard.level !== "none") {
    process.stderr.write(`\nWARN: ${formatUnscoredWarning(unscored)}\n`);
  }
  if (guard.block) {
    process.stderr.write(
      "\nweb-rollup: REFUSING to deploy — publishing this bundle would replace the live\n"
      + `  report with one that has no document grades. The bundle IS written to ${output}\n`
      + "  so you can inspect it. Re-run the audits stage, or pass --allow-unscored.\n",
    );
    return {
      exitCode: 3,
      error: "refusing to deploy: site inventories have no document accessibility scores",
      summary,
    };
  }

  // 10. Optionally deploy via netlify CLI. v1.39.0 (E1): a REQUESTED deploy
  // that fails must fail the whole run — pre-v1.39.0 the helper printed the
  // netlify error and resolved anyway, so orchestration scripts reported
  // success while production was never updated. A deploy skipped via
  // FILECAP_NO_DEPLOY=1 is not a failure (bundle written, exit 0).
  if (deploy) {
    const deployResult = await runNetlifyDeploy({ output, deploySite, _spawn: _netlifySpawn });
    const deployExit = deployOutcomeToExit({
      requested: !deployResult.skipped,
      ok: deployResult.ok,
    });
    if (deployExit !== 0) {
      process.stderr.write(
        `web-rollup: bundle written to ${output} but deploy FAILED — production not updated\n`,
      );
      return {
        exitCode: 1,
        error: "netlify deploy failed — production not updated",
        summary,
      };
    }
  }

  return { exitCode: 0, summary };
}

// v1.39.0 (E1) — pure decision: only a deploy that was actually REQUESTED
// (i.e. not skipped via FILECAP_NO_DEPLOY=1) and did not succeed fails the
// run. Bundle-written + deploy-skipped stays success.
export function deployOutcomeToExit({ requested, ok }) {
  return requested && !ok ? 1 : 0;
}

// ── netlify deploy helper ──────────────────────────────────────────────────────

/**
 * Run `netlify deploy --prod --dir <output>` via child_process.spawn.
 * Inherits stdio so the user sees Netlify CLI progress.
 * If netlify CLI is not found, prints friendly remediation instructions.
 *
 * v1.39.0 (E1): resolves a deploy OUTCOME instead of swallowing failures —
 * `{ok, skipped?, reason?}`. Non-zero exit / spawn error → ok:false; missing
 * CLI (ENOENT) → ok:false with reason "netlify-cli-missing" (install hint
 * still printed); FILECAP_NO_DEPLOY=1 → ok:true + skipped:true.
 *
 * @param {object} args
 * @param {string} args.output      - Output directory to deploy
 * @param {string|null} args.deploySite - Pass --site <id> to netlify deploy
 * @param {Function} [args._spawn]  - injectable spawner (tests)
 * @returns {Promise<{ok: boolean, skipped?: boolean, reason?: string}>}
 */
async function runNetlifyDeploy({ output, deploySite, _spawn = spawn }) {
  // 1.7.36 — Honor FILECAP_NO_DEPLOY=1 so local builds / tests / quick
  // regenerations don't accidentally push to production when the user
  // has `webRollup.autoDeploy: true` in ~/.filecap/config.json. Loud
  // banner first so the operator sees what's about to happen and can
  // Ctrl-C if it wasn't intended. Fixes 2026-05-13 audit finding #6.
  if (process.env.FILECAP_NO_DEPLOY === "1") {
    process.stderr.write(
      "FILECAP_NO_DEPLOY=1 set — skipping `netlify deploy --prod`. " +
        `Bundle is in ${output}.\n`,
    );
    return { ok: true, skipped: true };
  }
  process.stderr.write(
    "\n────────────────────────────────────────────────────────────\n" +
      "  PUSHING TO PRODUCTION via `netlify deploy --prod`\n" +
      "  Triggered by --deploy flag or webRollup.autoDeploy=true in config.\n" +
      "  Ctrl-C now to abort; set FILECAP_NO_DEPLOY=1 to opt out.\n" +
      "────────────────────────────────────────────────────────────\n\n",
  );

  const args = ["deploy", "--prod", "--dir", output];
  // v1.22.0 — include the uptime function (when the bundle emitted one) so the
  // manual --dir deploy carries it.
  if (existsSync(path.join(output, "netlify", "functions"))) {
    args.push("--functions", path.join(output, "netlify", "functions"));
  }
  if (deploySite) {
    args.push("--site", deploySite);
  }

  const installHint =
    "To deploy automatically, install the Netlify CLI: `npm install -g netlify-cli`.\n" +
    `Otherwise, you can manually run: cd ${output} && netlify deploy --prod --dir .\n`;

  return new Promise((resolve) => {
    // "error" (ENOENT) and "close" can both fire — first outcome wins.
    let settled = false;
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    let child;
    try {
      child = _spawn("netlify", args, { stdio: "inherit" });
    } catch {
      process.stderr.write(installHint);
      settle({ ok: false, reason: "spawn-error" });
      return;
    }

    child.on("error", (err) => {
      if (err.code === "ENOENT") {
        process.stderr.write(installHint);
        settle({ ok: false, reason: "netlify-cli-missing" });
      } else {
        process.stderr.write(`netlify deploy error: ${err.message}\n`);
        settle({ ok: false, reason: err.message });
      }
    });

    child.on("close", (code) => {
      if (code !== 0) {
        process.stderr.write(`netlify deploy exited with code ${code}\n`);
        settle({ ok: false, reason: `exit-${code}` });
      } else {
        settle({ ok: true });
      }
    });
  });
}
