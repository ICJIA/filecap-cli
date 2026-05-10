import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import os from "node:os";
import { runReport } from "./report.js";
import { generateIndexHtml } from "../web/index-page.js";
import { injectPasswordGate, computeHash } from "../web/password-gate.js";
import { generateRobotsTxt } from "../web/robots.js";
import { darkModeCss } from "../web/styles.js";

// ── helpers ────────────────────────────────────────────────────────────────────

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
  title = "filecap audit fleet snapshot",
  includeSite = [],
  excludeSite = [],
  sitesFile = null,
  _auditsBase = null,
}) {
  // 1. Load sites.json
  const sitesPath = sitesFile
    ?? process.env.FILECAP_SITES_FILE
    ?? path.join(os.homedir(), ".filecap", "sites.json");

  let sitesData;
  try {
    const raw = await fs.readFile(sitesPath, "utf8");
    sitesData = JSON.parse(raw);
  } catch (err) {
    return { exitCode: 2, error: `cannot read sites file ${sitesPath}: ${err.message}` };
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

  // 3. For each site, locate the latest inventory and generate outputs
  const siteResults = [];

  for (const site of sites) {
    const ip = site.host;
    if (!ip) {
      process.stderr.write(`WARN: skipping ${site.siteName ?? site.name ?? "(unnamed)"}: no host configured\n`);
      continue;
    }

    const auditsBase = _auditsBase ?? path.join(os.homedir(), "filecap-audits");
    const latestInv = path.join(auditsBase, ip, "latest", "inventory.ndjson");
    let stat;
    try { stat = await fs.stat(latestInv); } catch { stat = null; }

    if (!stat) {
      process.stderr.write(`WARN: skipping ${site.siteName ?? site.name ?? ip}: no scan at ${latestInv}\n`);
      continue;
    }

    // Read the header to get the scan timestamp
    const header = await readNdjsonHeader(latestInv);
    if (!header) {
      process.stderr.write(`WARN: skipping ${site.siteName ?? site.name ?? ip}: cannot parse inventory header\n`);
      continue;
    }

    const scanTimestamp = formatScanTimestamp(header.metadata?.scannedAt);
    const siteLabelForSlug = site.siteName ?? site.name ?? ip;
    const baseName = `${slug(siteLabelForSlug)}-${scanTimestamp}`;

    // 4. Run runReport against the latest inventory in a temp dir
    const tempDir = path.join(output, `.__tmp_${baseName}`);
    await fs.mkdir(tempDir, { recursive: true });

    const reportResult = await runReport({ input: latestInv, outputDir: tempDir, html: true });
    if (reportResult.exitCode !== 0) {
      process.stderr.write(`WARN: skipping ${site.siteName ?? site.name ?? ip}: report generation failed (${reportResult.error ?? ""})\n`);
      await fs.rm(tempDir, { recursive: true, force: true });
      continue;
    }

    // 5. Copy CSV and HTML to bundle dir, renamed
    const srcCsv = path.join(tempDir, "audit-file-list.csv");
    const srcHtml = path.join(tempDir, "audit-file-list.html");
    const dstCsv = path.join(output, `${baseName}.csv`);
    const dstHtml = path.join(output, `${baseName}.html`);

    await fs.copyFile(srcCsv, dstCsv);

    let htmlContent = await fs.readFile(srcHtml, "utf8");
    if (password) {
      const hexHash = computeHash(password);
      htmlContent = injectPasswordGate(htmlContent, hexHash);
    }
    await fs.writeFile(dstHtml, htmlContent);
    await fs.rm(tempDir, { recursive: true, force: true });

    // Compute per-site summary stats
    const summary = await computeSiteSummary(latestInv);

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

  // 6. Generate index.html
  const passwordHash = password ? computeHash(password) : null;
  const indexHtml = generateIndexHtml({ siteResults, password: passwordHash, title });
  await fs.writeFile(path.join(output, "index.html"), indexHtml);

  // 7. Generate robots.txt
  await fs.writeFile(path.join(output, "robots.txt"), generateRobotsTxt());

  // 8. Generate shared CSS
  await fs.writeFile(path.join(output, "assets", "style.css"), darkModeCss());

  return {
    exitCode: 0,
    summary: {
      sitesIncluded: siteResults.length,
      sitesSkipped: sites.length - siteResults.length,
      outputDir: output,
      passwordEnabled: !!password,
    },
  };
}
