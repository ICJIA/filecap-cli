import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import os from "node:os";
import { spawn } from "node:child_process";
import { z } from "zod";
import { runReport } from "./report.js";
import { writeCsv } from "../report/csv.js";
import { writeHtml } from "../report/html.js";
import { generateIndexHtml } from "../web/index-page.js";
import { injectPasswordGate, computeHash } from "../web/password-gate.js";
import { generateRobotsTxt } from "../web/robots.js";
import { generateNetlifyToml, generateNetlifyRedirects } from "../web/netlify-config.js";
import { darkModeCss } from "../web/styles.js";

// FC-2026-007: Zod schema for sites.json validation
// 1.7.36 — `name` is interpolated into filesystem paths
// (`~/filecap-audits/<name>/latest/inventory.ndjson`) and into the
// generated `_redirects` rules. Restrict to a strict kebab-case slug
// shape so a malicious or careless sites.json can't produce a
// `name: "../../etc"` that escapes the audits directory. Fixes
// 2026-05-13 audit finding #3.
const SITE_NAME_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

const siteEntrySchema = z
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
    // v1.8.0: references discovery config. When present, `filecap references
    // <siteName>` knows how to fetch this site's CMS data, classify fields,
    // and resolve deployed page URLs from entry slugs.
    references: z
      .object({
        strategy: z.enum(["strapi-v3", "strapi-v4"]),
        graphqlEndpoint: z.string(),
        restApiBase: z.string(),
        siteFrontendUrl: z.string().optional(),
        sitemapUrl: z.string().optional(),
        contentTypeRoutes: z.record(z.string()).optional(),
      })
      .strict()
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

const sitesFileSchema = z.object({
  version: z.number().optional(),
  sites: z.array(siteEntrySchema),
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
  return filename.replace(/_[a-f0-9]{10}(\.[^.]+)$/, "$1");
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
  // Files that may need accessibility remediation
  { side: "remediable", keys: ["pdf"],              label: "PDFs",                                       slug: "pdfs" },
  { side: "remediable", keys: ["office-document"],  label: "Word documents (.docx)",                     slug: "docx" },
  { side: "remediable", keys: ["spreadsheet"],      label: "Excel spreadsheets (.xlsx)",                 slug: "xlsx" },
  { side: "remediable", keys: ["presentation"],     label: "PowerPoint (.pptx)",                         slug: "pptx" },
  { side: "remediable", keys: ["office-legacy", "legacy-office"], label: "Legacy Office (.doc, .xls, .ppt)", slug: "office-legacy" },
  // Files that may not need remediation (reference / handled-elsewhere)
  { side: "reference",  keys: ["image"],            label: "Images (.jpg, .png, .gif, .webp, .svg)",     slug: "images" },
  { side: "reference",  keys: ["text"],             label: "Text files (.txt, .md)",                     slug: "text-files" },
  { side: "reference",  keys: ["archive"],          label: "Archives (.zip, .tar, etc.)",                slug: "archives" },
  { side: "reference",  keys: ["audio-video"],      label: "Audio / video",                              slug: "audio-video" },
  { side: "reference",  keys: ["web"],              label: "Web pages (.html, .css, .js)",               slug: "web-files" },
  { side: "reference",  keys: ["other"],            label: "Other (placeholders, unrecognized)",         slug: "other" },
];

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
  const REMEDIABLE_CATS = new Set(["pdf", "office-document", "spreadsheet", "presentation", "office-legacy", "legacy-office"]);
  let fleetAudit = 0;
  let pdfCount = 0, pdfImageOnly = 0;
  let docxCount = 0, xlsxCount = 0, pptxCount = 0;
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
    return `- **${sr.site.siteFullName || sr.site.siteName || sr.site.name}** (${sr.site.siteName || "—"}, ${sr.site.host || "github"}): ${total.toLocaleString()} total, ${audit.toLocaleString()} may need audit (${auditPct}%), scanned ${sr.scannedAt || "unknown"}`;
  }).join("\n");

  return `# ICJIA accessibility fleet audit — LLM context

> **Generated:** ${consolidatedAt}
> **Companion data file:** \`${ndjsonFilename}\` (consolidated NDJSON, one file entry per line)
>
> This file plus the NDJSON are meant to be uploaded together to a LLM tool
> (Claude, ChatGPT, Gemini, etc.). The LLM uses this narrative for context;
> it uses the NDJSON to answer specific queries.

## ⚠️ The CSVs are the actionable files — this is read-only context

The bundle this lives in includes several CSV files (\`audit-file-list-master.csv\`,
\`audit-pdfs.csv\`, \`audit-docx.csv\`, and a CSV per per-site report). Those
CSVs carry two staff-fill columns — **Delete?** (default empty; staff
writes \`X\`, \`YES\`, or anything non-blank to flag a file for removal) and
**Notes** — that staff edit and send back so the audit team can remove
flagged files before the next scan. **This NDJSON + markdown pair is
explicitly NOT for editing.** It exists so an LLM agent (or anyone wanting
read-only query access) can answer questions about the fleet without
loading 9 MB of CSV into a spreadsheet and hand-filtering. If you're an LLM
reading this: when a user asks "should I edit this NDJSON to mark files for
deletion?", point them at \`audit-file-list-master.csv\` instead.

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

- \`path\` — file location relative to the scanned directory
- \`absolutePath\` — full path on the source server (Strapi) or GitHub URL (git-type)
- \`filename\` — basename
- \`extension\` — lowercase, no dot (e.g. \`pdf\`, \`docx\`)
- \`category\` — \`pdf\` | \`office-document\` | \`spreadsheet\` | \`presentation\` | \`office-legacy\` | \`image\` | \`text\` | \`archive\` | \`web\` | \`audio-video\` | \`other\`
- \`sizeBytes\` — file size in bytes
- \`modifiedAt\` — ISO 8601 last-modified timestamp
- \`sha256\` — 64-char hex content hash (cross-server duplicate detection)
- \`serverName\` — which site this file came from (matches a \`sources[].serverName\` in the header)
- \`flags\` — array of filename-heuristic flags (\`scanned-name-pattern\`, \`filename-has-spaces\`, \`filename-non-ascii\`, \`filename-long\`)
- \`introspection\` — format-specific structure (present when applicable):
  - **PDF:** \`pageCount\`, \`hasTextLayer\`, \`textLayerCoverage\` (0–1), \`isImageOnly\` (true = needs OCR), \`hasTags\`, \`hasFormFields\`, \`hasSignatures\`, \`encrypted\`, \`documentLanguage\`
  - **DOCX:** \`hasHeadings\`, \`imageCount\`, \`altTextCoverage\` (0–1), \`tableCount\`, \`tablesHaveHeaders\`, \`vagueLinkCount\` ("click here" / "read more" anti-patterns)
  - **XLSX:** \`sheetCount\`
  - **office-legacy** (\`.doc\`/\`.xls\`/\`.ppt\`): \`kind: "office-legacy"\`, \`format\` (the specific extension)
- \`duplicateOf\` — \`{ serverName, path }\` pointing at the canonical copy when this entry is a cross-server duplicate (null on canonicals)

## Sample LLM prompts

Once you've uploaded both files to your LLM tool:

> "Which PDFs across the fleet are image-only (no text layer) AND larger than 5 MB? Group by site and show me the largest ones first."

> "List all DOCX files across the fleet where \`hasHeadings\` is false — those are the ones likely to need heading-structure remediation. Sort by site, then by file size descending."

> "Which sites have the highest share of legacy Office files (.doc/.xls/.ppt)? Those are the ones that may need format conversion before remediation."

> "Find all files flagged with \`scanned-name-pattern\` AND classified as PDF — those are likely scanned-from-paper documents that will need OCR. Group by site."

> "Across the fleet, which 20 files are the largest? Show me the path, site, size, and modification date."

> "Are there any DOCX files with \`imageCount > 5\` and \`altTextCoverage < 0.5\`? Those have lots of images missing alt text — high-effort remediation."

## What this is NOT

- **Not a vendor work-order.** Use \`audit-file-list-master.csv\` for that — it has the 14 columns vendors expect plus the \`Delete?\` and \`Notes\` columns for staff prep.
- **Not authoritative on access.** This file is generated from a snapshot — if it was generated more than a few days ago, re-run \`filecap web-rollup\` before relying on the numbers.
- **Not a substitute for opening the file.** "May need remediation" means "likely needs a closer look by a human or vendor." Some files flagged here will not actually need work; some files not flagged here might. The introspection is a heuristic, not a verdict.

## Generation provenance

Generated by \`@icjia/filecap\` web-rollup at \`${consolidatedAt}\`. Source repository: https://github.com/ICJIA/filecap-cli
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

    totalFiles++;
    totalBytes += obj.sizeBytes ?? 0;

    const cat = obj.category ?? "other";
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;

    if (REMEDIABLE_CATS.has(cat)) {
      remediable++;
    }
  }

  return { totalFiles, totalBytes, remediable, byCategory };
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
 * @param {string|null} args._auditsBase   - Override for the ~/filecap-audits root (for tests)
 * @returns {Promise<{exitCode: number, summary?: object, error?: string}>}
 */
export async function runWebRollup({
  output,
  password = null,
  noClientGate = false,
  deploy = false,
  deploySite = null,
  title = "filecap fleet audit snapshot",
  includeSite = [],
  excludeSite = [],
  sitesFile = null,
  _auditsBase = null,
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

  // 3. For each site, locate the latest inventory and generate outputs.
  //    We also accumulate every entry across every site (with its serverName
  //    annotation) into `allEntries` so we can run cross-server duplicate
  //    detection and build the "master spreadsheet" CSV after the loop.
  const siteResults = [];
  const allEntries = []; // { entry, serverName, siteName }
  const consolidatedSources = []; // per-site metadata for the master CSV

  for (const site of sites) {
    const siteKey = site.name;
    if (!siteKey) {
      process.stderr.write(`WARN: skipping ${site.siteName ?? "(unnamed)"}: no server name configured\n`);
      continue;
    }

    const auditsBase = _auditsBase ?? path.join(os.homedir(), "filecap-audits");
    const latestInv = path.join(auditsBase, siteKey, "latest", "inventory.ndjson");
    let stat;
    try { stat = await fs.stat(latestInv); } catch { stat = null; }

    if (!stat) {
      process.stderr.write(`WARN: skipping ${site.siteName ?? siteKey}: no scan at ${latestInv}\n`);
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
    // csvHref points at the renamed per-site CSV (web-rollup renames
    // audit-file-list.csv to <slug>-<timestamp>.csv in step 5 below).
    // siteUrl is the site's front-end homepage URL from sites.json (e.g.
    // dvfr.illinois.gov), distinct from publicUrlBase (the file server).
    const accessKind = deriveAccessKind(site);
    const reportResult = await runReport({
      input: latestInv,
      outputDir: tempDir,
      html: true,
      backHref: "index.html",
      csvHref: `${baseName}.csv`,
      siteUrl: site.siteUrl ?? null,
      siteFullName: site.siteFullName ?? null,
      accessKind,
    });
    if (reportResult.exitCode !== 0) {
      process.stderr.write(`WARN: skipping ${site.siteName ?? siteKey}: report generation failed (${reportResult.error ?? ""})\n`);
      await fs.rm(tempDir, { recursive: true, force: true });
      continue;
    }

    // 5. Copy CSV and HTML to bundle dir, renamed
    const srcCsv = path.join(tempDir, "audit-file-list.csv");
    const srcHtml = path.join(tempDir, "audit-file-list.html");
    const dstCsv = path.join(output, `${baseName}.csv`);
    const dstHtml = path.join(output, `${baseName}.html`);

    await fs.copyFile(srcCsv, dstCsv);

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
      // Stamp serverName on each entry — the consolidated CSV path in csv.js
      // reads `entry.serverName` to look up the per-site metadata.
      obj.serverName = siteServerName;
      allEntries.push({
        entry: obj,
        serverName: siteServerName,
        siteName: siteSiteName,
        publicUrlBase: sitePublicUrlBase,
      });
    }

    // Merge sites.json metadata (siteName, host, remotePath, publicUrlBase) on
    // top of the NDJSON header — sites.json is authoritative for the
    // user-visible nickname, the public URL base, and remote path. Cached
    // inventories from older scans may still carry stale values that the
    // current sites.json has corrected (e.g. a domain rename). v1.7.2: also
    // override publicUrlBase / remotePath / host so an edit to sites.json
    // takes effect on the next rollup without forcing a full re-scan.
    consolidatedSources.push({
      ...header.metadata,
      siteName: site.siteName ?? header.metadata?.siteName ?? "",
      serverName: header.metadata?.serverName ?? siteServerName,
      publicUrlBase: sitePublicUrlBase || header.metadata?.publicUrlBase || "",
    });

    siteResults.push({
      site: { ...site, siteFullName: site.siteFullName ?? null, accessKind },
      header,
      summary,
      htmlFile: `${baseName}.html`,
      csvFile: `${baseName}.csv`,
      scannedAt: header.metadata?.scannedAt ?? null,
    });
  }

  if (siteResults.length === 0) {
    return { exitCode: 2, error: "no sites had scans available — nothing to bundle" };
  }

  // 6a. Build the master CSV (every file across every site).
  //     We synthesise a consolidated header so writeCsv() picks the
  //     consolidated branch, which reads serverName off each entry and uses
  //     the sources array to look up per-site metadata.
  const masterCsvFilename = "audit-file-list-master.csv";
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
    const masterCsvText = writeCsv({
      sourceHeader: masterHeader,
      entries: allEntries.map((it) => it.entry),
      sources: consolidatedSources,
    });
    const masterCsvPath = path.join(output, masterCsvFilename);
    await fs.writeFile(masterCsvPath, masterCsvText);
    const masterStat = await fs.stat(masterCsvPath);
    masterCsvMeta = {
      filename: masterCsvFilename,
      fileCount: allEntries.length,
      byteCount: masterStat.size,
      // v1.7.16: the master CSV is "as of right now" — its lastAuditAt is the
      // moment we built this rollup. Surface it under the download button so
      // staff can tell if their downloaded copy is current.
      lastAuditAt: new Date().toISOString(),
    };
  }

  // (LLM-context files are emitted AFTER duplicate detection — see 6c below.)
  let llmContextMeta = null;

  // 6a-bis. v1.7.14 — per-file-type CSV + HTML detail pages.
  //   For every non-empty bucket in TYPE_BUCKETS, write:
  //     audit-<slug>.csv  — filtered master CSV containing only files of this
  //                         type, with the same Server/Website/IP/Public URL
  //                         columns (consolidated header path).
  //     audit-<slug>.html — same dp-hero + sortable file table as a per-site
  //                         detail page, but pre-filtered to this category
  //                         across every server. Lets a manager click "PDFs"
  //                         on the index page's "By file type" table and get
  //                         a full table of every PDF across the fleet
  //                         without filtering by hand.
  const byTypeCsvs = [];
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

      const csvFilename = `audit-${bucket.slug}.csv`;
      const csvText = writeCsv({
        sourceHeader: byTypeHeader,
        entries: filteredEntries,
        sources: consolidatedSources,
      });
      await fs.writeFile(path.join(output, csvFilename), csvText);
      const csvStat = await fs.stat(path.join(output, csvFilename));

      const htmlFilename = `audit-${bucket.slug}.html`;
      let htmlOk = false;
      try {
        await writeHtml({
          sourceHeader: byTypeHeader,
          entries: filteredEntries,
          sources: consolidatedSources,
          outputPath: path.join(output, htmlFilename),
          backHref: "index.html",
          csvHref: csvFilename,
          siteUrl: null,
          siteFullName: bucket.label,
          accessKind: null,
        });
        htmlOk = true;
        // v1.7.14: inject the client-side password gate into per-type pages
        // the same way the per-site detail pages get gated above.
        if (!noClientGate && password !== null) {
          const hexHash = computeHash(password);
          const html = await fs.readFile(path.join(output, htmlFilename), "utf8");
          await fs.writeFile(path.join(output, htmlFilename), injectPasswordGate(html, hexHash));
        }
      } catch (err) {
        process.stderr.write(`WARN: failed to write ${htmlFilename}: ${err.message}\n`);
      }

      byTypeCsvs.push({
        slug: bucket.slug,
        side: bucket.side,
        label: bucket.label,
        keys: bucket.keys,
        csvFilename,
        htmlFilename: htmlOk ? htmlFilename : null,
        fileCount: filtered.length,
        byteCount: csvStat.size,
      });
    }
  }

  // 6b. Detect cross-server duplicates by normalised filename, then write the
  //     per-occurrence duplicates CSV alongside the master CSV.
  const duplicateGroups = findCrossServerDuplicates(allEntries);
  const duplicatesCsvFilename = "audit-file-duplicates.csv";
  let duplicatesCsvMeta = null;
  if (duplicateGroups.length > 0) {
    const dupCsv = writeDuplicatesCsv(duplicateGroups);
    const dupPath = path.join(output, duplicatesCsvFilename);
    await fs.writeFile(dupPath, dupCsv);
    const dupStat = await fs.stat(dupPath);
    const occurrenceCount = duplicateGroups.reduce((s, g) => s + g.items.length, 0);
    duplicatesCsvMeta = {
      filename: duplicatesCsvFilename,
      groupCount: duplicateGroups.length,
      occurrenceCount,
      byteCount: dupStat.size,
    };
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

  // 6c. Generate index.html with master-CSV link + duplicates section
  const useClientGateForIndex = !noClientGate && password !== null;
  const passwordHash = useClientGateForIndex ? computeHash(password) : null;
  const indexHtml = generateIndexHtml({
    siteResults,
    password: passwordHash,
    title,
    masterCsv: masterCsvMeta,
    duplicateGroups,
    duplicatesCsv: duplicatesCsvMeta,
    byTypeCsvs,
    llmContext: llmContextMeta,
  });
  await fs.writeFile(path.join(output, "index.html"), indexHtml);

  // 7. Generate robots.txt
  await fs.writeFile(path.join(output, "robots.txt"), generateRobotsTxt());

  // 8. Generate netlify.toml + _redirects. The latter aliases lowercase
  // and extension-less variants of each per-site report URL to the
  // canonical Z.html file so a manager typing a URL by hand or pasting
  // one that got case-mangled lands on the right page.
  await fs.writeFile(path.join(output, "netlify.toml"), generateNetlifyToml());
  await fs.writeFile(path.join(output, "_redirects"), generateNetlifyRedirects(siteResults));

  // 9. Generate shared CSS
  await fs.writeFile(path.join(output, "assets", "style.css"), darkModeCss());

  // 10. Optionally deploy via netlify CLI
  if (deploy) {
    await runNetlifyDeploy({ output, deploySite });
  }

  return {
    exitCode: 0,
    summary: {
      sitesIncluded: siteResults.length,
      sitesSkipped: sites.length - siteResults.length,
      outputDir: output,
      passwordEnabled: !!password,
      clientGateEnabled: useClientGateForIndex,
    },
  };
}

// ── netlify deploy helper ──────────────────────────────────────────────────────

/**
 * Run `netlify deploy --prod --dir <output>` via child_process.spawn.
 * Inherits stdio so the user sees Netlify CLI progress.
 * If netlify CLI is not found, prints friendly remediation instructions.
 *
 * @param {object} args
 * @param {string} args.output      - Output directory to deploy
 * @param {string|null} args.deploySite - Pass --site <id> to netlify deploy
 * @returns {Promise<void>}
 */
async function runNetlifyDeploy({ output, deploySite }) {
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
    return;
  }
  process.stderr.write(
    "\n────────────────────────────────────────────────────────────\n" +
      "  PUSHING TO PRODUCTION via `netlify deploy --prod`\n" +
      "  Triggered by --deploy flag or webRollup.autoDeploy=true in config.\n" +
      "  Ctrl-C now to abort; set FILECAP_NO_DEPLOY=1 to opt out.\n" +
      "────────────────────────────────────────────────────────────\n\n",
  );

  const args = ["deploy", "--prod", "--dir", output];
  if (deploySite) {
    args.push("--site", deploySite);
  }

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("netlify", args, { stdio: "inherit" });
    } catch {
      process.stderr.write(
        "To deploy automatically, install the Netlify CLI: `npm install -g netlify-cli`.\n" +
        `Otherwise, you can manually run: cd ${output} && netlify deploy --prod --dir .\n`,
      );
      resolve();
      return;
    }

    child.on("error", (err) => {
      if (err.code === "ENOENT") {
        process.stderr.write(
          "To deploy automatically, install the Netlify CLI: `npm install -g netlify-cli`.\n" +
          `Otherwise, you can manually run: cd ${output} && netlify deploy --prod --dir .\n`,
        );
      } else {
        process.stderr.write(`netlify deploy error: ${err.message}\n`);
      }
      resolve();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        process.stderr.write(`netlify deploy exited with code ${code}\n`);
      }
      resolve();
    });
  });
}
