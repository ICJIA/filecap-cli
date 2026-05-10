import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import os from "node:os";
import { spawn } from "node:child_process";
import { z } from "zod";
import { runReport } from "./report.js";
import { writeCsv } from "../report/csv.js";
import { generateIndexHtml } from "../web/index-page.js";
import { injectPasswordGate, computeHash } from "../web/password-gate.js";
import { generateRobotsTxt } from "../web/robots.js";
import { generateNetlifyToml } from "../web/netlify-config.js";
import { darkModeCss } from "../web/styles.js";

// FC-2026-007: Zod schema for sites.json validation
const siteEntrySchema = z
  .object({
    name: z.string().min(1),
    siteName: z.string().optional(),
    user: z.string().optional(),
    host: z.string().optional(),
    remotePath: z.string().optional(),
    publicUrlBase: z.string().optional(),
    // Informational hint — when true, the public URL requires an Authorization
    // header; the audit script looks for the token in ~/.filecap/secrets.json or
    // a FILECAP_BEARER_TOKEN_<SERVER_NAME> env var. The token itself never lives
    // in this file — sites.json is shareable, secrets.json is local-only.
    requiresBearerToken: z.boolean().optional(),
  })
  .strict();

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
      const base = (i.publicUrlBase ?? "").replace(/\/+$/, "");
      const p = (i.entry?.path ?? "").replace(/^\/+/, "");
      const publicUrl = base && p ? `${base}/${p}` : "";
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
    const reportResult = await runReport({
      input: latestInv,
      outputDir: tempDir,
      html: true,
      backHref: "index.html",
      csvHref: `${baseName}.csv`,
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
    // user-visible nickname, and inventories from older scans may not carry
    // the siteName field at all.
    consolidatedSources.push({
      ...header.metadata,
      siteName: site.siteName ?? header.metadata?.siteName ?? "",
      serverName: header.metadata?.serverName ?? siteServerName,
    });

    siteResults.push({
      site,
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
    };
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
  });
  await fs.writeFile(path.join(output, "index.html"), indexHtml);

  // 7. Generate robots.txt
  await fs.writeFile(path.join(output, "robots.txt"), generateRobotsTxt());

  // 8. Generate netlify.toml
  await fs.writeFile(path.join(output, "netlify.toml"), generateNetlifyToml());

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
