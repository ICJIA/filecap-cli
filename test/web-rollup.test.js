import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";
import {
  runWebRollup,
  normalizeStrapiFilename,
  findCrossServerDuplicates,
  writeDuplicatesCsv,
  deriveAccessKind,
  buildFleetFileIndex,
} from "../src/commands/web-rollup.js";
import { buildAliasMap } from "../src/references/cross-resolver.js";
import { HELP_SCREENSHOTS } from "../src/web/help-page.js";

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Write a minimal valid inventory NDJSON to a path.
 * @param {string} filePath
 * @param {object} [meta] - override metadata fields
 */
async function writeInventory(filePath, meta = {}) {
  const header = JSON.stringify({
    schemaVersion: 1,
    kind: "filecap-inventory-header",
    metadata: {
      serverName: meta.serverName ?? "test-server",
      hostname: meta.hostname ?? "test.example.com",
      serverIp: meta.serverIp ?? "10.0.0.1",
      scannedPath: meta.scannedPath ?? "/uploads",
      scannedAt: meta.scannedAt ?? "2026-05-09T16:05:04.000Z",
      filecapVersion: "1.1.1",
      nodeVersion: "v20.18.0",
      options: { hash: true, introspect: false, maxIntrospectMb: 200, concurrency: 4 },
    },
  });
  const entry = JSON.stringify({
    path: "doc.pdf",
    absolutePath: "/uploads/doc.pdf",
    filename: "doc.pdf",
    extension: "pdf",
    category: "pdf",
    remediable: true,
    sizeBytes: 1024,
    modifiedAt: "2024-01-01T00:00:00.000Z",
    sha256: "a1b2c3",
    flags: [],
  });
  const footer = JSON.stringify({
    kind: "filecap-inventory-footer",
    entryCount: 1,
    scannedAt: meta.scannedAt ?? "2026-05-09T16:05:04.000Z",
  });
  await fs.writeFile(filePath, [header, entry, footer].join("\n") + "\n", "utf8");
}

/**
 * Create a minimal sites.json.
 */
async function writeSitesJson(sitesPath, sites) {
  await fs.mkdir(path.dirname(sitesPath), { recursive: true });
  await fs.writeFile(sitesPath, JSON.stringify({ version: 1, sites }));
}

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-web-rollup-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── fixtures helper ────────────────────────────────────────────────────────────

/**
 * Set up fixture files and return params for runWebRollup.
 * Uses _auditsBase to avoid requiring HOME manipulation.
 */
async function buildFixture({
  siteName = "DVFR",
  siteServerName = "dvfr",
  ip = "203.0.113.10",
  scannedAt = "2026-05-09T16:05:04.000Z",
} = {}) {
  const auditsBase = path.join(tmpDir, "filecap-audits");
  // As of 1.2.2, audit dirs are keyed by server-name (not host IP).
  const latestDir = path.join(auditsBase, siteServerName, "latest");
  await fs.mkdir(latestDir, { recursive: true });
  const invPath = path.join(latestDir, "inventory.ndjson");
  await writeInventory(invPath, { serverName: siteServerName, serverIp: ip, scannedAt });

  const sitesFile = path.join(tmpDir, "sites.json");
  await writeSitesJson(sitesFile, [
    { name: siteServerName, siteName, host: ip, user: "forge", remotePath: "/uploads" },
  ]);

  const outputDir = path.join(tmpDir, "output");

  return { sitesFile, outputDir, auditsBase, siteIp: ip, siteName, invPath };
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe("runWebRollup", () => {
  it("returns exitCode 2 when sites file does not exist", async () => {
    const result = await runWebRollup({
      output: path.join(tmpDir, "out"),
      sitesFile: path.join(tmpDir, "nonexistent-sites.json"),
    });
    expect(result.exitCode).toBe(2);
    expect(result.error).toMatch(/cannot read sites file/i);
  });

  it("returns exitCode 2 when no sites match the include filter", async () => {
    const sitesFile = path.join(tmpDir, "sites.json");
    await writeSitesJson(sitesFile, [
      { name: "dvfr", siteName: "DVFR", host: "1.2.3.4", user: "forge", remotePath: "/uploads" },
    ]);
    const result = await runWebRollup({
      output: path.join(tmpDir, "out"),
      sitesFile,
      includeSite: ["nonexistent-site"],
    });
    expect(result.exitCode).toBe(2);
    expect(result.error).toMatch(/no sites match/i);
  });

  it("filters out excluded sites", async () => {
    const sitesFile = path.join(tmpDir, "sites.json");
    await writeSitesJson(sitesFile, [
      { name: "dvfr", siteName: "DVFR", host: "1.2.3.4", user: "forge", remotePath: "/uploads" },
      { name: "i2i", siteName: "i2i", host: "1.2.3.5", user: "forge", remotePath: "/uploads" },
    ]);
    const result = await runWebRollup({
      output: path.join(tmpDir, "out"),
      sitesFile,
      excludeSite: ["dvfr", "i2i"],
    });
    expect(result.exitCode).toBe(2);
    expect(result.error).toMatch(/no sites match/i);
  });

  it("warns and skips sites with no inventory, continues with others", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();

    // Add a second site with no inventory
    const sitesData = JSON.parse(await fs.readFile(sitesFile, "utf8"));
    sitesData.sites.push({
      name: "missing",
      siteName: "Missing",
      host: "9.9.9.9",
      user: "forge",
      remotePath: "/uploads",
    });
    await fs.writeFile(sitesFile, JSON.stringify(sitesData));

    let stderrOutput = "";
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (s) => { stderrOutput += s; return true; };

    let result;
    try {
      result = await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
    } finally {
      process.stderr.write = origWrite;
    }

    expect(stderrOutput).toMatch(/WARN.*skipping.*Missing/i);
    expect(result.exitCode).toBe(0);
    expect(result.summary.sitesIncluded).toBe(1);
    expect(result.summary.sitesSkipped).toBe(1);
  });

  it("creates output directory and writes index.html, robots.txt, assets/style.css", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const files = await fs.readdir(outputDir);
    expect(files).toContain("index.html");
    expect(files).toContain("robots.txt");
    expect(files).toContain("_headers");
    expect(files).toContain("assets");

    const assets = await fs.readdir(path.join(outputDir, "assets"));
    expect(assets).toContain("style.css");
  });

  it("emits an accessibility.html page into the bundle", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const files = await fs.readdir(outputDir);
    expect(files).toContain("accessibility.html");
    const html = await fs.readFile(path.join(outputDir, "accessibility.html"), "utf8");
    expect(html).toContain("<h1>Accessibility</h1>");
  });

  it("emits a fleet file-errors report (audit-file-errors.html + .xlsx) — v1.20.0", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const files = await fs.readdir(outputDir);
    expect(files).toContain("audit-file-errors.html");
    expect(files).toContain("audit-file-errors.xlsx");
    expect(files).not.toContain("audit-file-errors.csv");
    const html = await fs.readFile(path.join(outputDir, "audit-file-errors.html"), "utf8");
    expect(html).toContain("<h1>File errors</h1>");
  });

  it("names per-site files as <slug>-<timestamp>.html and .xlsx (v1.20.0: was .csv)", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture({
      siteName: "DVFR",
      scannedAt: "2026-05-09T16:05:04.000Z",
    });
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const files = await fs.readdir(outputDir);
    expect(files.some((f) => f.match(/^dvfr-20260509-160504Z\.html$/))).toBe(true);
    expect(files.some((f) => f.match(/^dvfr-20260509-160504Z\.xlsx$/))).toBe(true);
    expect(files.some((f) => f.match(/^dvfr-20260509-160504Z\.csv$/))).toBe(false);
  });

  it("index.html references the per-site HTML and XLSX files (v1.20.0)", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture({
      siteName: "DVFR",
      scannedAt: "2026-05-09T16:05:04.000Z",
    });
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const index = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(index).toContain("dvfr-20260509-160504Z.html");
    expect(index).toContain("dvfr-20260509-160504Z.xlsx");
    expect(index).not.toContain("dvfr-20260509-160504Z.csv");
  });

  it("robots.txt contains User-agent: * / Disallow: /", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const robots = await fs.readFile(path.join(outputDir, "robots.txt"), "utf8");
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Disallow: /");
  });

  it("injects password gate JS into per-site HTML when password is set", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture({
      siteName: "DVFR",
      scannedAt: "2026-05-09T16:05:04.000Z",
    });
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, password: "secret" });

    const files = await fs.readdir(outputDir);
    const htmlFile = files.find((f) => f.endsWith(".html") && f !== "index.html");
    expect(htmlFile).toBeTruthy();

    const html = await fs.readFile(path.join(outputDir, htmlFile), "utf8");
    expect(html).toContain("sessionStorage");
    expect(html).toContain("SHA-256");
  });

  it("does NOT inject password gate JS when password is omitted", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture({
      siteName: "DVFR",
      scannedAt: "2026-05-09T16:05:04.000Z",
    });
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const files = await fs.readdir(outputDir);
    const htmlFile = files.find((f) => f.endsWith(".html") && f !== "index.html");
    expect(htmlFile).toBeTruthy();

    const html = await fs.readFile(path.join(outputDir, htmlFile), "utf8");
    expect(html).not.toContain("sessionStorage.getItem(\"fc-pw\")");
  });

  it("index.html password gate injected when password set", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({
      output: outputDir,
      sitesFile,
      _auditsBase: auditsBase,
      password: "mypassword",
    });

    const index = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(index).toContain("sessionStorage");
  });

  it("summary includes correct sitesIncluded and sitesSkipped counts", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    const result = await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
    expect(result.exitCode).toBe(0);
    expect(result.summary.sitesIncluded).toBe(1);
    expect(result.summary.sitesSkipped).toBe(0);
    expect(result.summary.outputDir).toBe(outputDir);
  });

  it("passwordEnabled is true when password was provided", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    const result = await runWebRollup({
      output: outputDir,
      sitesFile,
      _auditsBase: auditsBase,
      password: "pw",
    });
    expect(result.summary.passwordEnabled).toBe(true);
  });

  it("passwordEnabled is false when no password was provided", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    const result = await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
    expect(result.summary.passwordEnabled).toBe(false);
  });

  it("--include-site filters to only the named site", async () => {
    const sitesFile = path.join(tmpDir, "sites.json");
    const auditsBase = path.join(tmpDir, "filecap-audits");

    for (const [name, ip] of [["dvfr", "10.0.1.1"], ["i2i", "10.0.1.2"]]) {
      // Audit dirs keyed by server-name (not IP) since 1.2.2.
      const latestDir = path.join(auditsBase, name, "latest");
      await fs.mkdir(latestDir, { recursive: true });
      await writeInventory(path.join(latestDir, "inventory.ndjson"), { serverName: name, serverIp: ip });
    }
    await writeSitesJson(sitesFile, [
      { name: "dvfr", siteName: "DVFR", host: "10.0.1.1", user: "forge", remotePath: "/uploads" },
      { name: "i2i", siteName: "i2i", host: "10.0.1.2", user: "forge", remotePath: "/uploads" },
    ]);

    const outputDir = path.join(tmpDir, "output-include");
    const result = await runWebRollup({
      output: outputDir,
      sitesFile,
      _auditsBase: auditsBase,
      includeSite: ["dvfr"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.summary.sitesIncluded).toBe(1);

    const files = await fs.readdir(outputDir);
    expect(files.some((f) => f.startsWith("dvfr"))).toBe(true);
    expect(files.some((f) => f.startsWith("i2i"))).toBe(false);
  });

  it("--exclude-site omits the named site from the bundle", async () => {
    const sitesFile = path.join(tmpDir, "sites.json");
    const auditsBase = path.join(tmpDir, "filecap-audits");

    for (const [name, ip] of [["dvfr", "10.0.2.1"], ["i2i", "10.0.2.2"]]) {
      // Audit dirs keyed by server-name (not IP) since 1.2.2.
      const latestDir = path.join(auditsBase, name, "latest");
      await fs.mkdir(latestDir, { recursive: true });
      await writeInventory(path.join(latestDir, "inventory.ndjson"), { serverName: name, serverIp: ip });
    }
    await writeSitesJson(sitesFile, [
      { name: "dvfr", siteName: "DVFR", host: "10.0.2.1", user: "forge", remotePath: "/uploads" },
      { name: "i2i", siteName: "i2i", host: "10.0.2.2", user: "forge", remotePath: "/uploads" },
    ]);

    const outputDir = path.join(tmpDir, "output-exclude");
    const result = await runWebRollup({
      output: outputDir,
      sitesFile,
      _auditsBase: auditsBase,
      excludeSite: ["dvfr"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.summary.sitesIncluded).toBe(1);

    const files = await fs.readdir(outputDir);
    expect(files.some((f) => f.startsWith("dvfr"))).toBe(false);
    expect(files.some((f) => f.startsWith("i2i"))).toBe(true);
  });

  it("returns exitCode 2 when all sites have missing scans", async () => {
    const sitesFile = path.join(tmpDir, "sites.json");
    const auditsBase = path.join(tmpDir, "filecap-audits");
    await writeSitesJson(sitesFile, [
      { name: "ghost", siteName: "Ghost", host: "99.99.99.99", user: "forge", remotePath: "/uploads" },
    ]);
    const result = await runWebRollup({
      output: path.join(tmpDir, "out"),
      sitesFile,
      _auditsBase: auditsBase,
    });
    expect(result.exitCode).toBe(2);
    expect(result.error).toMatch(/no sites had scans/i);
  });

  it("bundle includes netlify.toml with expected build/publish settings", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const files = await fs.readdir(outputDir);
    expect(files).toContain("netlify.toml");

    const toml = await fs.readFile(path.join(outputDir, "netlify.toml"), "utf8");
    expect(toml).toContain('publish = "."');
  });

  it("netlify.toml has CSV cache-control and Content-Disposition rules", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const toml = await fs.readFile(path.join(outputDir, "netlify.toml"), "utf8");
    expect(toml).toContain('for = "/*.csv"');
    expect(toml).toContain("max-age=3600");
    expect(toml).toContain('Content-Disposition = "attachment"');
  });

  it("--no-client-gate skips password JS injection even when --password is set", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture({
      siteName: "DVFR",
      scannedAt: "2026-05-09T16:05:04.000Z",
    });

    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = () => true;

    let result;
    try {
      result = await runWebRollup({
        output: outputDir,
        sitesFile,
        _auditsBase: auditsBase,
        password: "secret",
        noClientGate: true,
      });
    } finally {
      process.stderr.write = origWrite;
    }

    expect(result.exitCode).toBe(0);

    // Per-site HTML must NOT contain the password gate script
    const files = await fs.readdir(outputDir);
    const htmlFile = files.find((f) => f.endsWith(".html") && f !== "index.html");
    expect(htmlFile).toBeTruthy();
    const html = await fs.readFile(path.join(outputDir, htmlFile), "utf8");
    expect(html).not.toContain("sessionStorage.getItem(\"fc-pw\")");

    // index.html must NOT contain the password gate script either
    const index = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(index).not.toContain("sessionStorage.getItem(\"fc-pw\")");

    // clientGateEnabled should be false in the summary
    expect(result.summary.clientGateEnabled).toBe(false);
  });

  it("clientGateEnabled is true when password is set and noClientGate is false", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    const result = await runWebRollup({
      output: outputDir,
      sitesFile,
      _auditsBase: auditsBase,
      password: "mypassword",
      noClientGate: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.summary.clientGateEnabled).toBe(true);
  });

  it("clientGateEnabled is false when no password is set", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    const result = await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
    expect(result.exitCode).toBe(0);
    expect(result.summary.clientGateEnabled).toBe(false);
  });

  it("index.html contains the manager explainer section", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(html).toContain("Why aren&#39;t all");
  });

  // v1.39.0 (E12) — SSR card order follows the pressed "Most recently added"
  // button (reverse sites.json declaration order), not the alphabet. The
  // pre-v1.39.0 expectation (alphabetical SSR) contradicted the toolbar's
  // shipped aria-pressed state, so this test was updated with the fix.
  describe("SSR card order = 'Most recently added' (v1.39.0; was alphabetical v1.7.15)", () => {
    it("renders cards in reverse sites.json declaration order (added), not alphabetical", async () => {
      // sites.json declares Zebra → Alpha → Mango; "added" order renders
      // Mango → Alpha → Zebra. Alphabetical would be Alpha → Mango → Zebra,
      // so the assertion distinguishes the two modes.
      const auditsBase = path.join(tmpDir, "filecap-audits");
      for (const slug of ["zebra-prod", "alpha-prod", "mango-prod"]) {
        const dir = path.join(auditsBase, slug, "latest");
        await fs.mkdir(dir, { recursive: true });
        await writeInventory(path.join(dir, "inventory.ndjson"), { serverName: slug, hostname: `${slug}.example.com`, serverIp: "1.2.3.4" });
      }
      const sitesFile = path.join(tmpDir, "sites-sort.json");
      await writeSitesJson(sitesFile, [
        { name: "zebra-prod",  siteName: "Z",  siteFullName: "Zebra Site",  user: "x", host: "1.2.3.4", remotePath: "/u" },
        { name: "alpha-prod",  siteName: "A",  siteFullName: "Alpha Site",  user: "x", host: "1.2.3.4", remotePath: "/u" },
        { name: "mango-prod",  siteName: "M",  siteFullName: "Mango Site",  user: "x", host: "1.2.3.4", remotePath: "/u" },
      ]);
      const outputDir = path.join(tmpDir, "output-sort");
      await runWebRollup({ sitesFile, output: outputDir, _auditsBase: auditsBase, password: null });
      const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
      const posMango = html.indexOf("Mango Site");
      const posAlpha = html.indexOf("Alpha Site");
      const posZebra = html.indexOf("Zebra Site");
      expect(posMango).toBeGreaterThan(-1);
      expect(posAlpha).toBeGreaterThan(posMango);
      expect(posZebra).toBeGreaterThan(posAlpha);
    });
  });

  describe("by-file-type detail pages + audit.xlsx (v1.20.0)", () => {
    it("emits per-type HTML and a single shared audit.xlsx (no per-bucket CSVs)", async () => {
      const { sitesFile, outputDir, auditsBase } = await buildFixture();
      await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
      const files = await fs.readdir(outputDir);
      // v1.20.0: per-type HTML stays; the per-bucket CSVs are gone, replaced by
      // a single multi-sheet audit.xlsx covering all remediable buckets.
      expect(files).toContain("audit-pdfs.html");
      expect(files).toContain("audit.xlsx");
      expect(files).not.toContain("audit-pdfs.csv");
      expect(files).not.toContain("audit-docx.csv");
    });

    it("the by-type HTML detail page has the same dp-hero block as a per-site report", async () => {
      const { sitesFile, outputDir, auditsBase } = await buildFixture();
      await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
      const html = await fs.readFile(path.join(outputDir, "audit-pdfs.html"), "utf8");
      // Hero block exists
      expect(html).toMatch(/<header class="dp-hero">/);
      // Title is the bucket label ("PDFs")
      expect(html).toMatch(/<h1 class="dp-title">PDFs<\/h1>/);
      // v1.20.0: download link in the sticky bar points to the shared workbook
      expect(html).toMatch(/<a class="report-csv-link" href="audit\.xlsx" download>/);
      // Back link returns to the fleet index
      expect(html).toMatch(/<a class="report-back-link" href="index\.html">/);
      // Eyebrow says it's the across-the-fleet view, not a single site
      expect(html).toContain("Across the fleet");
    });

    it("the index by-type table links labels to per-type HTML and counts to audit.xlsx", async () => {
      const { sitesFile, outputDir, auditsBase } = await buildFixture();
      await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
      const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
      // Label → HTML detail page (unchanged)
      expect(html).toMatch(/<a class="by-type-link" href="audit-pdfs\.html"[^>]*>PDFs/);
      // v1.20.0: count link points at the shared audit.xlsx for every
      // remediable bucket. PDF row is the easiest to assert on.
      expect(html).toMatch(/<a class="by-type-csv-link" href="audit\.xlsx" download/);
    });

    it("audit.xlsx is a real parseable workbook with one tab per non-empty remediable bucket", async () => {
      const { sitesFile, outputDir, auditsBase } = await buildFixture();
      await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(path.join(outputDir, "audit.xlsx"));
      const sheetNames = wb.worksheets.map((w) => w.name);
      // The default fixture seeds PDFs only, so the workbook should have a
      // PDFs tab and no others.
      expect(sheetNames).toContain("PDFs");
      expect(sheetNames).not.toContain("DOCX");
      expect(sheetNames).not.toContain("Images");
    });

    it("skips buckets that have zero matching files (no empty CSV/HTML pairs)", async () => {
      const { sitesFile, outputDir, auditsBase } = await buildFixture();
      await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
      const files = await fs.readdir(outputDir);
      // The default fixture has only PDFs — buckets like office-legacy or
      // audio-video should produce no artifacts.
      expect(files).not.toContain("audit-office-legacy.csv");
      expect(files).not.toContain("audit-office-legacy.html");
      expect(files).not.toContain("audit-audio-video.csv");
      expect(files).not.toContain("audit-audio-video.html");
    });
  });

  describe("fleet-hero infographic (v1.7.13)", () => {
    it("leads with the AUDIT count, not the total, in the .fleet-hero-num block", async () => {
      const { sitesFile, outputDir, auditsBase } = await buildFixture();
      await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
      const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
      // The big number is the audit count (remediable across the fleet).
      // The fixture entries are remediable: true, so audit count > 0.
      expect(html).toMatch(/<p class="fleet-hero-num">\d+(,\d{3})*<\/p>/);
      // Eyebrow above the number names what it is.
      expect(html).toMatch(/<p class="fleet-hero-eyebrow">Files that may need accessibility audit<\/p>/);
    });

    it("renders a fleet-hero donut with the audit-share % inline-styled", async () => {
      const { sitesFile, outputDir, auditsBase } = await buildFixture();
      await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
      const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
      // Donut element with --pct CSS custom property, matching the per-card pattern.
      expect(html).toMatch(/<div class="fleet-hero-donut" style="--pct:\d+(\.\d+)?%"/);
      // Centred percentage + "may need audit" caption inside.
      expect(html).toMatch(/<div class="fleet-hero-donut-pct">\d+%<small>may need audit<\/small>/);
    });

    it("emits a plain-English phrase caption beneath the donut", async () => {
      const { sitesFile, outputDir, auditsBase } = await buildFixture();
      await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
      const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
      // Same phrase buckets as per-card: "Two-thirds may need audit",
      // "About half may need audit", etc. The fixture uses 100% remediable
      // (every entry has remediable: true), so the phrase is the high-pct one.
      expect(html).toMatch(/<p class="fleet-hero-phrase"><strong>(No files inventoried|.+ may need audit)<\/strong><\/p>/);
    });

    it("includes the total in the secondary context line, not as the headline", async () => {
      const { sitesFile, outputDir, auditsBase } = await buildFixture();
      await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
      const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
      expect(html).toMatch(/<p class="fleet-hero-context">out of <strong>\d+(,\d{3})*<\/strong> files scanned across \d+ ICJIA websites?/);
    });

    it("no longer emits the pre-v1.7.13 fleet-total-headline / fleet-split-bar / fleet-equation markup", async () => {
      const { sitesFile, outputDir, auditsBase } = await buildFixture();
      await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
      const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
      expect(html).not.toMatch(/class="fleet-total-headline/);
      expect(html).not.toMatch(/class="fleet-split-bar/);
      expect(html).not.toMatch(/class="fleet-split-segment/);
      expect(html).not.toMatch(/class="fleet-equation"/);
    });

    it("sets an aria-label on the .fleet-hero so screen readers get the audit/total phrasing", async () => {
      const { sitesFile, outputDir, auditsBase } = await buildFixture();
      await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
      const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
      expect(html).toMatch(/<div class="fleet-hero" role="img" aria-label="\d[^"]* of \d[^"]* files may need accessibility audit, \d+ percent\./);
    });
  });

  it("index.html contains both by-type column headings", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    // v1.7.8 softened both headings: "Files needing remediation" →
    // "Files that may need remediation"; "Files NOT requiring remediation"
    // → "Files that may not need remediation". Don't be prescriptive.
    expect(html).toContain("Files that may need remediation");
    expect(html).toContain("Files that may not need remediation");
  });

  it("index.html by-type tables skip rows where count is zero", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    // PDF row must be present (count = 1)
    expect(html).toContain("PDFs");
    // These categories have count 0 in the fixture — their rows must be absent
    expect(html).not.toContain("Word documents (.docx)");
    expect(html).not.toContain("Excel spreadsheets (.xlsx)");
    expect(html).not.toContain("PowerPoint (.pptx)");
    expect(html).not.toContain("Images (.jpg");
    expect(html).not.toContain("Text files (.txt");
  });

  it("index.html site cards contain the file-types/technical-details disclosure", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    // v1.62.0 — the disclosure absorbed the per-type chips and scan meta,
    // and its summary label widened to say so.
    expect(html).toContain("File types &amp; technical details");
    expect(html).toContain("<details");
    expect(html).toContain("<summary>");
    expect(html).toMatch(/<details class="tech-details">[\s\S]*?class="chips"/);
  });

  it("index.html hero uses plain-English wording (v1.7.13: audit-first phrasing)", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    // The new fleet-hero leads with the audit count + a "Files that may
    // need accessibility audit" eyebrow, with the total in the secondary
    // context line. Pre-v1.7.13 wording ("We scanned X websites and found
    // Y files in total") was dropped because it foregrounded the total.
    expect(html).toContain("Files that may need accessibility audit");
    expect(html).toContain("files scanned across");
    expect(html).toContain("may need audit"); // covers donut caption + phrase bucket
  });

  // ── Security: FC-2026-006 sitesFile path validation ─────────────────────────

  it("rejects sitesFile that does not have a .json extension (FC-2026-006)", async () => {
    const result = await runWebRollup({
      output: path.join(tmpDir, "fc-rollup-test"),
      sitesFile: "/etc/hosts",
    });
    expect(result.exitCode).toBe(2);
    expect(result.error).toMatch(/sites file/i);
    // Error must NOT include file content snippets
    expect(result.error).not.toMatch(/127\.0\.0\.1/);
    expect(result.error).not.toMatch(/localhost/);
  });

  it("does not leak file content in error message when sites file is missing (FC-2026-006)", async () => {
    const result = await runWebRollup({
      output: path.join(tmpDir, "fc-rollup-test2"),
      sitesFile: path.join(tmpDir, "nonexistent-file.json"),
    });
    expect(result.exitCode).toBe(2);
    expect(result.error).toMatch(/cannot read sites file/i);
    // Error must reference the path but not file content
    expect(result.error).toContain("nonexistent-file.json");
  });

  // ── Security: FC-2026-007 sites.json schema validation ──────────────────────

  it("rejects sites.json with unrecognized extra fields in a site entry (FC-2026-007)", async () => {
    const sitesFile = path.join(tmpDir, "bad-schema.json");
    await fs.writeFile(
      sitesFile,
      JSON.stringify({
        version: 1,
        sites: [{ name: "dvfr", injectedField: "malicious; rm -rf" }],
      }),
    );
    const result = await runWebRollup({
      output: path.join(tmpDir, "out-bad"),
      sitesFile,
    });
    expect(result.exitCode).toBe(2);
    expect(result.error).toMatch(/schema validation/i);
  });

  it("rejects sites.json where name is not a string (FC-2026-007)", async () => {
    const sitesFile = path.join(tmpDir, "bad-name.json");
    await fs.writeFile(
      sitesFile,
      JSON.stringify({
        version: 1,
        sites: [{ name: 42, host: "1.2.3.4" }],
      }),
    );
    const result = await runWebRollup({
      output: path.join(tmpDir, "out-bad-name"),
      sitesFile,
    });
    expect(result.exitCode).toBe(2);
    expect(result.error).toMatch(/schema validation/i);
  });

  // ── type: "git" static-site entries (v1.6.0) ────────────────────────────────

  it("accepts a sites.json entry with type:git + gitRepo + publicPath", async () => {
    const sitesFile = path.join(tmpDir, "git-site.json");
    await fs.writeFile(
      sitesFile,
      JSON.stringify({
        version: 1,
        sites: [
          {
            name: "vpp-git",
            siteName: "VPP",
            type: "git",
            gitRepo: "https://github.com/ICJIA/icjia-vpp-2025.git",
            publicPath: "public",
            publicUrlBase: "https://vpp.illinois.gov",
          },
        ],
      }),
    );
    // No inventory exists for vpp-git, so web-rollup will fail with
    // "no sites had scans available" — that's exit code 2 and proves the
    // schema accepted the entry. (We can't easily exercise the full path
    // without setting up an inventory fixture.)
    const result = await runWebRollup({
      output: path.join(tmpDir, "out-git"),
      sitesFile,
      _auditsBase: path.join(tmpDir, "no-such-base"),
    });
    expect(result.error).not.toMatch(/schema validation/i);
  });

  it("accepts a sites.json entry without `type` (defaults to strapi, back-compat)", async () => {
    const sitesFile = path.join(tmpDir, "no-type.json");
    await fs.writeFile(
      sitesFile,
      JSON.stringify({
        version: 1,
        sites: [
          { name: "dvfr", siteName: "DVFR", user: "forge", host: "1.2.3.4", remotePath: "/uploads" },
        ],
      }),
    );
    const result = await runWebRollup({
      output: path.join(tmpDir, "out-no-type"),
      sitesFile,
      _auditsBase: path.join(tmpDir, "no-such-base"),
    });
    expect(result.error).not.toMatch(/schema validation/i);
  });

  it("rejects type:git without gitRepo (refine)", async () => {
    const sitesFile = path.join(tmpDir, "git-no-repo.json");
    await fs.writeFile(
      sitesFile,
      JSON.stringify({
        version: 1,
        sites: [{ name: "vpp-git", type: "git", publicPath: "public" }],
      }),
    );
    const result = await runWebRollup({
      output: path.join(tmpDir, "out-git-no-repo"),
      sitesFile,
    });
    expect(result.exitCode).toBe(2);
    expect(result.error).toMatch(/schema validation/i);
    expect(result.error).toMatch(/gitRepo/);
  });

  it("rejects an unknown type value", async () => {
    const sitesFile = path.join(tmpDir, "bad-type.json");
    await fs.writeFile(
      sitesFile,
      JSON.stringify({
        version: 1,
        sites: [{ name: "weird", type: "ftp", host: "1.2.3.4" }],
      }),
    );
    const result = await runWebRollup({
      output: path.join(tmpDir, "out-bad-type"),
      sitesFile,
    });
    expect(result.exitCode).toBe(2);
    expect(result.error).toMatch(/schema validation/i);
  });

  it("accepts a mixed-mode sites.json (strapi + git entries side-by-side)", async () => {
    const sitesFile = path.join(tmpDir, "mixed.json");
    await fs.writeFile(
      sitesFile,
      JSON.stringify({
        version: 1,
        sites: [
          { name: "dvfr", siteName: "DVFR", user: "forge", host: "1.2.3.4", remotePath: "/uploads" },
          {
            name: "vpp-git",
            siteName: "VPP",
            type: "git",
            gitRepo: "https://github.com/ICJIA/icjia-vpp-2025.git",
            publicPath: "public",
          },
        ],
      }),
    );
    const result = await runWebRollup({
      output: path.join(tmpDir, "out-mixed"),
      sitesFile,
      _auditsBase: path.join(tmpDir, "no-such-base"),
    });
    expect(result.error).not.toMatch(/schema validation/i);
  });

  it("rejects unknown top-level field on a git entry (.strict() still applies)", async () => {
    const sitesFile = path.join(tmpDir, "git-extra.json");
    await fs.writeFile(
      sitesFile,
      JSON.stringify({
        version: 1,
        sites: [
          {
            name: "vpp-git",
            type: "git",
            gitRepo: "https://github.com/ICJIA/icjia-vpp-2025.git",
            injectedField: "x",
          },
        ],
      }),
    );
    const result = await runWebRollup({
      output: path.join(tmpDir, "out-git-extra"),
      sitesFile,
    });
    expect(result.exitCode).toBe(2);
    expect(result.error).toMatch(/schema validation/i);
  });
});

describe("normalizeStrapiFilename", () => {
  it("strips Strapi's 10-char hex suffix before the extension", () => {
    expect(normalizeStrapiFilename("report_a1b2c3d4e5.pdf")).toBe("report.pdf");
  });
  it("handles long filenames", () => {
    expect(normalizeStrapiFilename("DVFR_Annual_Report_2023_FINAL_dee7ed44b6.pdf"))
      .toBe("DVFR_Annual_Report_2023_FINAL.pdf");
  });
  it("preserves filenames without a hex suffix", () => {
    expect(normalizeStrapiFilename("plain.pdf")).toBe("plain.pdf");
  });
  it("does not strip suffixes shorter or longer than 10 chars", () => {
    expect(normalizeStrapiFilename("report_abc123.pdf")).toBe("report_abc123.pdf"); // 6
    expect(normalizeStrapiFilename("report_abcdef0123456.pdf"))
      .toBe("report_abcdef0123456.pdf"); // 13
  });
  it("does not strip uppercase or non-hex suffixes", () => {
    expect(normalizeStrapiFilename("report_A1B2C3D4E5.pdf"))
      .toBe("report_A1B2C3D4E5.pdf");
    expect(normalizeStrapiFilename("report_xyz1234567.pdf"))
      .toBe("report_xyz1234567.pdf");
  });
  it("handles empty / nullish input", () => {
    expect(normalizeStrapiFilename("")).toBe("");
    expect(normalizeStrapiFilename(null)).toBe("");
    expect(normalizeStrapiFilename(undefined)).toBe("");
  });
  it("folds spaces and underscore runs so pre-CMS and Strapi names match (v1.12.2)", () => {
    // Pre-CMS sites moved files into /static with spaces in the name; Strapi
    // sanitises the same name to underscores. Both must normalise alike or a
    // cross-server duplicate is missed.
    expect(normalizeStrapiFilename("Some File.pdf")).toBe(normalizeStrapiFilename("Some_File.pdf"));
    expect(normalizeStrapiFilename("Agenda  Summit 2017.pdf")).toBe("Agenda_Summit_2017.pdf");
  });
});

describe("findCrossServerDuplicates", () => {
  const mk = (serverName, filename, opts = {}) => ({
    serverName,
    siteName: opts.siteName ?? serverName.toUpperCase(),
    entry: {
      filename,
      path: opts.path ?? filename,
      modifiedAt: opts.modifiedAt ?? "2024-01-01T00:00:00.000Z",
      sizeBytes: opts.sizeBytes ?? 1024,
      sha256: opts.sha256 ?? "hash-default",
    },
  });

  it("returns empty when no filename appears on more than one server", () => {
    const all = [
      mk("dvfr", "a.pdf"),
      mk("r3", "b.pdf"),
    ];
    expect(findCrossServerDuplicates(all)).toEqual([]);
  });

  it("groups exact duplicates (same hash) across two servers", () => {
    const all = [
      mk("dvfr", "report.pdf", { sha256: "h1" }),
      mk("archive", "report.pdf", { sha256: "h1" }),
    ];
    const groups = findCrossServerDuplicates(all);
    expect(groups).toHaveLength(1);
    expect(groups[0].normalizedFilename).toBe("report.pdf");
    expect(groups[0].isExactDuplicate).toBe(true);
    expect(groups[0].items).toHaveLength(2);
  });

  it("flags variant duplicates (same name, different hash) as not exact", () => {
    const all = [
      mk("dvfr", "report.pdf", { sha256: "h1" }),
      mk("archive", "report.pdf", { sha256: "h2" }),
    ];
    const groups = findCrossServerDuplicates(all);
    expect(groups).toHaveLength(1);
    expect(groups[0].isExactDuplicate).toBe(false);
  });

  it("normalises Strapi suffixes before grouping", () => {
    const all = [
      mk("dvfr", "report_a1b2c3d4e5.pdf", { sha256: "h1" }),
      mk("archive", "report.pdf", { sha256: "h1" }),
    ];
    const groups = findCrossServerDuplicates(all);
    expect(groups).toHaveLength(1);
    expect(groups[0].normalizedFilename).toBe("report.pdf");
  });

  it("sorts items within a group newest-first by modifiedAt", () => {
    const all = [
      mk("dvfr", "report.pdf", { modifiedAt: "2020-01-01T00:00:00Z", sha256: "old" }),
      mk("archive", "report.pdf", { modifiedAt: "2025-06-15T00:00:00Z", sha256: "new" }),
      mk("r3", "report.pdf", { modifiedAt: "2023-03-10T00:00:00Z", sha256: "mid" }),
    ];
    const groups = findCrossServerDuplicates(all);
    expect(groups[0].items.map((i) => i.serverName)).toEqual(["archive", "r3", "dvfr"]);
  });

  it("ignores entries that appear multiple times on the same server only", () => {
    const all = [
      mk("dvfr", "x.pdf", { sha256: "h1" }),
      mk("dvfr", "x.pdf", { sha256: "h2", path: "subdir/x.pdf" }),
    ];
    expect(findCrossServerDuplicates(all)).toEqual([]);
  });

  it("ignores empty filenames", () => {
    const all = [
      mk("dvfr", "", { sha256: "h1" }),
      mk("archive", "", { sha256: "h2" }),
    ];
    expect(findCrossServerDuplicates(all)).toEqual([]);
  });

  it("sorts groups exact-first, then by normalised filename", () => {
    const all = [
      mk("dvfr", "zeta.pdf", { sha256: "z1" }),
      mk("archive", "zeta.pdf", { sha256: "z1" }), // exact
      mk("dvfr", "alpha.pdf", { sha256: "a1" }),
      mk("archive", "alpha.pdf", { sha256: "a2" }), // variant
    ];
    const groups = findCrossServerDuplicates(all);
    expect(groups.map((g) => g.normalizedFilename)).toEqual(["zeta.pdf", "alpha.pdf"]);
    expect(groups[0].isExactDuplicate).toBe(true);
    expect(groups[1].isExactDuplicate).toBe(false);
  });
});

describe("runWebRollup — master XLSX + duplicates", () => {
  it("writes audit-file-list-master.xlsx to the output dir (v1.20.0: was .csv)", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    const result = await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
    expect(result.exitCode).toBe(0);
    const masterPath = path.join(outputDir, "audit-file-list-master.xlsx");
    const stat = await fs.stat(masterPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  it("master XLSX has the CSV_COLUMNS header row and a remediable-only data area", async () => {
    const { sitesFile, outputDir, auditsBase, siteName } = await buildFixture({
      siteServerName: "dvfr-prod",
    });
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(outputDir, "audit-file-list-master.xlsx"));
    const sheet = wb.worksheets[0];
    const headerLabels = [];
    sheet.getRow(1).eachCell((cell) => headerLabels.push(String(cell.value)));
    expect(headerLabels).toContain("Server");
    expect(headerLabels).toContain("File name");
    expect(headerLabels).toContain("Page Count");
    // The first data row carries the server-name so manager can tell which site each row came from
    const firstDataRow = [];
    sheet.getRow(2).eachCell((cell) => firstDataRow.push(String(cell.value ?? "")));
    expect(firstDataRow).toContain("dvfr-prod");
    expect(firstDataRow).toContain(siteName);
  });

  it("index.html links to the master XLSX", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(html).toMatch(/href="audit-file-list-master\.xlsx"/);
    expect(html).toContain("Master spreadsheet");
  });

  it("renders the duplicates section when two sites share a filename", async () => {
    // Build a 2-site fixture where both sites have the same filename.
    const auditsBase = path.join(tmpDir, "filecap-audits");
    for (const sn of ["dvfr", "archive"]) {
      const latestDir = path.join(auditsBase, sn, "latest");
      await fs.mkdir(latestDir, { recursive: true });
      await writeInventory(path.join(latestDir, "inventory.ndjson"), {
        serverName: sn,
        serverIp: sn === "dvfr" ? "10.0.0.1" : "10.0.0.2",
        scannedAt: "2026-05-09T16:05:04.000Z",
      });
    }
    const sitesFile = path.join(tmpDir, "sites.json");
    await writeSitesJson(sitesFile, [
      { name: "dvfr", siteName: "DVFR", host: "10.0.0.1", user: "forge", remotePath: "/uploads" },
      { name: "archive", siteName: "Archive", host: "10.0.0.2", user: "forge", remotePath: "/uploads" },
    ]);
    const outputDir = path.join(tmpDir, "output");
    const result = await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
    expect(result.exitCode).toBe(0);
    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    // v1.7.22: section banner replaced the small "Cross-server file map"
    // eyebrow with a big "Cross-Server Duplicates" h2. Assert on the new
    // banner copy + the section class which is stable.
    expect(html).toContain("Cross-Server Duplicates");
    expect(html).toMatch(/section class="section duplicates"/);
    // Both inventories' seed entry is "doc.pdf"
    expect(html).toContain("doc.pdf");
    expect(html).toContain("not an error");
  });

  it("does not render duplicates section when no cross-server duplicates exist", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(html).not.toContain("Cross-server file map");
    expect(html).not.toMatch(/section class="section duplicates"/);
  });
});

describe("findCrossServerDuplicates — placeholder filtering", () => {
  const mk = (serverName, filename) => ({
    serverName,
    siteName: serverName,
    entry: {
      filename,
      path: filename,
      modifiedAt: "2024-01-01T00:00:00Z",
      sizeBytes: 0,
      sha256: "x",
    },
  });

  it("skips .gitkeep when it appears on multiple servers", () => {
    const all = [mk("dvfr", ".gitkeep"), mk("archive", ".gitkeep")];
    expect(findCrossServerDuplicates(all)).toEqual([]);
  });
  it("skips .gitignore when it appears on multiple servers", () => {
    const all = [mk("dvfr", ".gitignore"), mk("archive", ".gitignore")];
    expect(findCrossServerDuplicates(all)).toEqual([]);
  });
  it("skip is case-insensitive (.GitKeep / .GITIGNORE both filtered)", () => {
    const all = [
      mk("dvfr", ".GitKeep"), mk("archive", ".GITKEEP"),
      mk("r3", ".GITIGNORE"), mk("i2i", ".gitignore"),
    ];
    expect(findCrossServerDuplicates(all)).toEqual([]);
  });
  it("does NOT skip real filenames that contain 'gitkeep' as a substring", () => {
    const all = [
      mk("dvfr", "post-gitkeep-cleanup.pdf"),
      mk("archive", "post-gitkeep-cleanup.pdf"),
    ];
    expect(findCrossServerDuplicates(all)).toHaveLength(1);
  });
});

describe("writeDuplicatesCsv", () => {
  const grp = {
    normalizedFilename: "report.pdf",
    isExactDuplicate: true,
    items: [
      { serverName: "dvfr", siteName: "DVFR", path: "report.pdf", modifiedAt: "2025-01-01T00:00:00Z", sizeBytes: 1024, sha256: "abc1234567890def" },
      { serverName: "archive", siteName: "Archive", path: "library/report.pdf", modifiedAt: "2020-01-01T00:00:00Z", sizeBytes: 1024, sha256: "abc1234567890def" },
    ],
  };

  it("emits a header row + one row per occurrence", () => {
    const csv = writeDuplicatesCsv([grp]);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3); // header + 2 occurrences
  });

  it("header includes the expected columns", () => {
    const csv = writeDuplicatesCsv([grp]);
    const header = csv.split("\n")[0];
    expect(header).toContain("Normalised filename");
    expect(header).toContain("Match type");
    expect(header).toContain("Website");
    expect(header).toContain("Server");
    expect(header).toContain("Path");
  });

  it("includes the website nick + server-name on each occurrence row", () => {
    const csv = writeDuplicatesCsv([grp]);
    expect(csv).toContain("DVFR");
    expect(csv).toContain("Archive");
    expect(csv).toContain("dvfr");
    expect(csv).toContain("archive");
  });

  it("truncates SHA-256 to the first 12 chars", () => {
    const csv = writeDuplicatesCsv([grp]);
    expect(csv).toContain("abc123456789");
    expect(csv).not.toContain("abc1234567890def");
  });

  it("labels variant groups as 'different content'", () => {
    const variantGrp = { ...grp, isExactDuplicate: false };
    const csv = writeDuplicatesCsv([variantGrp]);
    expect(csv).toContain("different content");
  });
});

describe("runWebRollup — duplicates XLSX (v1.20.0: was CSV)", () => {
  it("writes audit-file-duplicates.xlsx when cross-server duplicates exist", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    for (const sn of ["dvfr", "archive"]) {
      const latestDir = path.join(auditsBase, sn, "latest");
      await fs.mkdir(latestDir, { recursive: true });
      await writeInventory(path.join(latestDir, "inventory.ndjson"), {
        serverName: sn, serverIp: sn === "dvfr" ? "10.0.0.1" : "10.0.0.2",
      });
    }
    const sitesFile = path.join(tmpDir, "sites.json");
    await writeSitesJson(sitesFile, [
      { name: "dvfr", siteName: "DVFR", host: "10.0.0.1", user: "forge", remotePath: "/uploads" },
      { name: "archive", siteName: "Archive", host: "10.0.0.2", user: "forge", remotePath: "/uploads" },
    ]);
    const outputDir = path.join(tmpDir, "output");
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const dupXlsxPath = path.join(outputDir, "audit-file-duplicates.xlsx");
    const stat = await fs.stat(dupXlsxPath);
    expect(stat.size).toBeGreaterThan(0);
    // v1.20.0: the old .csv file should NOT exist
    await expect(fs.stat(path.join(outputDir, "audit-file-duplicates.csv"))).rejects.toThrow();

    // The index page should NOT link to the duplicates download (callout-only).
    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(html).not.toMatch(/href="audit-file-duplicates\.(csv|xlsx)"/);
    expect(html).toContain("For information only");
    expect(html).toContain("Don&#39;t treat this list as a delete-worksheet");
  });

  it("does not write the duplicates XLSX when no cross-server duplicates exist", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
    await expect(fs.stat(path.join(outputDir, "audit-file-duplicates.xlsx"))).rejects.toThrow();
  });
});

describe("runWebRollup — siteFullName plumbing", () => {
  it("threads siteFullName into the generated per-site HTML", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    const latestDir = path.join(auditsBase, "dvfr-strapi-prod", "latest");
    await fs.mkdir(latestDir, { recursive: true });
    await writeInventory(path.join(latestDir, "inventory.ndjson"), {
      serverName: "dvfr-strapi-prod",
      serverIp: "1.2.3.4",
      hostname: "dvfr.example.com",
    });

    const sitesFile = path.join(tmpDir, "sites-fullname.json");
    await writeSitesJson(sitesFile, [
      {
        name: "dvfr-strapi-prod",
        siteName: "DVFR",
        siteFullName: "Domestic Violence Fatality Review",
        user: "forge",
        host: "1.2.3.4",
        remotePath: "/uploads",
      },
    ]);

    const outputDir = path.join(tmpDir, "output-fullname");
    const result = await runWebRollup({
      sitesFile,
      output: outputDir,
      _auditsBase: auditsBase,
      password: null,
    });
    expect(result.exitCode).toBe(0);

    const files = await fs.readdir(outputDir);
    const dvfrHtml = files.find((f) => f.startsWith("dvfr-") && f.endsWith(".html"));
    expect(dvfrHtml).toBeDefined();
    const html = await fs.readFile(path.join(outputDir, dvfrHtml), "utf8");
    expect(html).toContain("Domestic Violence Fatality Review");
  });
});

describe("deriveAccessKind (v1.7.6)", () => {
  it("returns 'github' when site.type is 'git'", () => {
    expect(deriveAccessKind({ type: "git", gitRepo: "https://github.com/ICJIA/foo.git" })).toBe("github");
  });

  it("returns 'strapi' when publicUrlBase ends in /uploads", () => {
    expect(deriveAccessKind({ publicUrlBase: "https://files.example.org/uploads" })).toBe("strapi");
  });

  it("returns 'strapi' when publicUrlBase ends in /uploads/ with trailing slash", () => {
    expect(deriveAccessKind({ publicUrlBase: "https://files.example.org/uploads/" })).toBe("strapi");
  });

  it("returns 'server' when host is set but publicUrlBase is /files (Archive case)", () => {
    expect(deriveAccessKind({ host: "203.0.113.12", publicUrlBase: "https://archive.icjia.cloud/files" })).toBe("server");
  });

  it("returns 'server' as the fallback when nothing matches", () => {
    expect(deriveAccessKind({})).toBe("server");
  });

  it("returns 'server' when given null/undefined site", () => {
    expect(deriveAccessKind(null)).toBe("server");
    expect(deriveAccessKind(undefined)).toBe("server");
  });

  it("prefers 'github' over publicUrlBase pattern when type is 'git'", () => {
    // A git-mode site with a misleading /uploads URL should still classify
    // as github since type is the authoritative signal.
    expect(deriveAccessKind({
      type: "git",
      gitRepo: "https://github.com/ICJIA/foo.git",
      publicUrlBase: "https://foo.example.com/uploads",
    })).toBe("github");
  });
});

describe("runWebRollup — access chip + panel plumbing (v1.7.6)", () => {
  it("threads accessKind='strapi' through to both index card chip and detail-page panel", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    const latestDir = path.join(auditsBase, "dvfr-strapi-prod", "latest");
    await fs.mkdir(latestDir, { recursive: true });
    await writeInventory(path.join(latestDir, "inventory.ndjson"), {
      serverName: "dvfr-strapi-prod",
      serverIp: "1.2.3.4",
      hostname: "dvfr.example.com",
      publicUrlBase: "https://files.example.org/uploads",
    });

    const sitesFile = path.join(tmpDir, "sites-strapi.json");
    await writeSitesJson(sitesFile, [
      {
        name: "dvfr-strapi-prod",
        siteName: "DVFR",
        siteFullName: "Domestic Violence Fatality Review",
        user: "forge",
        host: "1.2.3.4",
        remotePath: "/uploads",
        publicUrlBase: "https://files.example.org/uploads",
      },
    ]);

    const outputDir = path.join(tmpDir, "output-strapi-access");
    const result = await runWebRollup({
      sitesFile,
      output: outputDir,
      _auditsBase: auditsBase,
      password: null,
    });
    expect(result.exitCode).toBe(0);

    const indexHtml = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(indexHtml).toMatch(/class="access-chip access-strapi"/);
    // v1.7.33: chip label collapsed to plain English across all site types.
    expect(indexHtml).toContain("For bulk file access");

    const files = await fs.readdir(outputDir);
    const dvfrHtml = files.find((f) => f.startsWith("dvfr-") && f.endsWith(".html"));
    expect(dvfrHtml).toBeDefined();
    const detailHtml = await fs.readFile(path.join(outputDir, dvfrHtml), "utf8");
    expect(detailHtml).toMatch(/<section class="access-panel access-strapi"/);
    expect(detailHtml).toContain("OpenSSH public key");
    // v1.7.35: access-panel action line now points at Chris Schweda's
    // email directly.
    expect(detailHtml).toContain("christopher.schweda@illinois.gov");
  });

  it("threads accessKind='github' for a git-mode site", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    const latestDir = path.join(auditsBase, "vpp-static", "latest");
    await fs.mkdir(latestDir, { recursive: true });
    await writeInventory(path.join(latestDir, "inventory.ndjson"), {
      serverName: "vpp-static",
      serverIp: "github.com",
      hostname: "vpp-static",
      publicUrlBase: "https://vpp.icjia.illinois.gov",
    });

    const sitesFile = path.join(tmpDir, "sites-github.json");
    await writeSitesJson(sitesFile, [
      {
        name: "vpp-static",
        siteName: "VPP",
        siteFullName: "Violence Prevention Project",
        type: "git",
        gitRepo: "https://github.com/ICJIA/icjia-vpp-2025.git",
        publicPath: "public",
        publicUrlBase: "https://vpp.icjia.illinois.gov",
      },
    ]);

    const outputDir = path.join(tmpDir, "output-github-access");
    const result = await runWebRollup({
      sitesFile,
      output: outputDir,
      _auditsBase: auditsBase,
      password: null,
    });
    expect(result.exitCode).toBe(0);

    const indexHtml = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(indexHtml).toMatch(/class="access-chip access-github"/);
    expect(indexHtml).toContain("For bulk file access");

    const files = await fs.readdir(outputDir);
    const vppHtml = files.find((f) => f.startsWith("vpp-") && f.endsWith(".html"));
    expect(vppHtml).toBeDefined();
    const detailHtml = await fs.readFile(path.join(outputDir, vppHtml), "utf8");
    expect(detailHtml).toMatch(/<section class="access-panel access-github"/);
    expect(detailHtml).toContain("ICJIA organization access");
  });
});

describe("/sites roster + tooling sites (v1.21.0)", () => {
  it("writes sites.html + sites-list.xlsx, downloads og images, and keeps tooling off the home page", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    await fs.mkdir(path.join(auditsBase, "dvfr", "latest"), { recursive: true });
    await writeInventory(path.join(auditsBase, "dvfr", "latest", "inventory.ndjson"), { serverName: "dvfr", serverIp: "10.0.0.1" });
    const sitesFile = path.join(tmpDir, "sites.json");
    await fs.writeFile(sitesFile, JSON.stringify({
      version: 1,
      sites: [{ name: "dvfr", siteName: "DVFR", siteFullName: "Domestic Violence Fatality Review", siteUrl: "https://dvfr.illinois.gov", host: "10.0.0.1", user: "forge", remotePath: "/uploads" }],
      tools: [{ name: "squish", siteName: "Squish", siteFullName: "Squish", siteUrl: "https://squish.icjia.app" }],
    }));
    const outputDir = path.join(tmpDir, "out");
    const _ogFetch = async (url) => ({ image: url.replace(/\/+$/, "") + "/og.png", title: "T", description: "Desc for " + url, reachable: true });
    const _imageFetch = async () => ({ ext: "png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });

    const result = await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, _ogFetch, _imageFetch });
    expect(result.exitCode).toBe(0);

    const sitesHtml = await fs.readFile(path.join(outputDir, "sites.html"), "utf8");
    expect(sitesHtml).toContain("Domestic Violence Fatality Review");
    expect(sitesHtml).toContain("Squish");
    expect(sitesHtml).toContain("Content sites");
    expect(sitesHtml).toContain("Tooling sites");
    expect(sitesHtml).toContain("Desc for https://dvfr.illinois.gov");
    expect(sitesHtml).toContain('src="assets/og/dvfr.png"');
    // v1.21.2 — live/down dot present (the og stub reports reachable: true)
    expect(sitesHtml).toContain("status-dot status-live");
    // server identity scrubbed from the roster: the origin IP must not appear
    expect(sitesHtml).not.toContain("10.0.0.1");
    // v1.42.0 — scanned site's workbook download threaded onto its roster card
    // (per-site workbooks are timestamped: <slug>-<scan-ts>.xlsx)
    expect(sitesHtml).toMatch(/class="roster-card-dl" href="dvfr-[^"]+\.xlsx" download/);

    // v1.44.0 — the bundle ships the What's New archive page, and the home
    // page carries the dismissible banner for the newest entry.
    const whatsNewHtml = await fs.readFile(path.join(outputDir, "whats-new.html"), "utf8");
    expect(whatsNewHtml).toMatch(/<title>[^<]*What/i);
    expect(whatsNewHtml).toContain('class="site-footer"');
    const indexForBanner = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(indexForBanner).toContain('data-announcement-id="');

    expect((await fs.stat(path.join(outputDir, "assets", "og", "dvfr.png"))).isFile()).toBe(true);
    expect((await fs.stat(path.join(outputDir, "assets", "og", "squish.png"))).isFile()).toBe(true);
    expect((await fs.stat(path.join(outputDir, "sites-list.xlsx"))).isFile()).toBe(true);

    const indexHtml = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    // v1.27.0 — tooling sites were removed from the landing page; they live only on /sites
    expect(indexHtml).not.toContain("Squish");
    expect(indexHtml).not.toContain("Tooling sites");
    expect(indexHtml).toContain('href="sites.html"');
    // v1.26.0 — the scraped og:image is propagated onto the home page's content
    // (audit) card too, not just the /sites roster card.
    expect(indexHtml).toContain('src="assets/og/dvfr.png"');
    // v1.25.0 — no self og:image meta when no icjia-fleet-audit tool carries an image
    expect(indexHtml).not.toContain('property="og:image"');
    expect(sitesHtml).not.toContain('property="og:image"');
  });

  it("v1.25.0 — copies a local `image` file into the bundle + adds the bundle og:image (works under noOg / behind auth)", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    await fs.mkdir(path.join(auditsBase, "dvfr", "latest"), { recursive: true });
    await writeInventory(path.join(auditsBase, "dvfr", "latest", "inventory.ndjson"), { serverName: "dvfr" });
    const localImg = path.join(tmpDir, "fleet-card.png");
    await fs.writeFile(localImg, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const sitesFile = path.join(tmpDir, "sites.json");
    await fs.writeFile(sitesFile, JSON.stringify({
      version: 1,
      sites: [{ name: "dvfr", siteName: "DVFR", host: "10.0.0.1", user: "forge", remotePath: "/uploads" }],
      tools: [{ name: "icjia-fleet-audit", siteName: "Fleet Audit", siteUrl: "https://fleet.icjia.app", image: localImg }],
    }));
    const outputDir = path.join(tmpDir, "out");
    // noOg: true → no network at all; the local file must still be copied in.
    const result = await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });
    expect(result.exitCode).toBe(0);
    // the local file was copied into the bundle under the tool's slug
    expect((await fs.stat(path.join(outputDir, "assets", "og", "icjia-fleet-audit.png"))).isFile()).toBe(true);
    const sitesHtml = await fs.readFile(path.join(outputDir, "sites.html"), "utf8");
    expect(sitesHtml).toContain('src="assets/og/icjia-fleet-audit.png"');
    // the bundle's own og:image meta points at it (absolute URL)
    expect(sitesHtml).toContain('<meta property="og:image" content="https://fleet.icjia.app/assets/og/icjia-fleet-audit.png">');
    const indexHtml = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(indexHtml).toContain('<meta property="og:image" content="https://fleet.icjia.app/assets/og/icjia-fleet-audit.png">');
    expect(indexHtml).toContain('name="twitter:image"');
  });

  it("lists a registered-but-unscanned site in the roster (no scan required)", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    await fs.mkdir(path.join(auditsBase, "dvfr", "latest"), { recursive: true });
    await writeInventory(path.join(auditsBase, "dvfr", "latest", "inventory.ndjson"), { serverName: "dvfr" });
    const sitesFile = path.join(tmpDir, "sites.json");
    await fs.writeFile(sitesFile, JSON.stringify({
      version: 1,
      sites: [
        { name: "dvfr", siteName: "DVFR", host: "10.0.0.1", user: "forge", remotePath: "/uploads" },
        { name: "newsite", siteName: "NewSite", siteFullName: "Brand New Site", siteUrl: "https://new.example.gov" },
      ],
    }));
    const outputDir = path.join(tmpDir, "out");
    const result = await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });
    expect(result.exitCode).toBe(0);
    const sitesHtml = await fs.readFile(path.join(outputDir, "sites.html"), "utf8");
    expect(sitesHtml).toContain("Brand New Site");
    expect(sitesHtml).toContain("DVFR");
  });

  it("password-gates sites.html when a password is set", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, password: "secret", noOg: true });
    const sitesHtml = await fs.readFile(path.join(outputDir, "sites.html"), "utf8");
    expect(sitesHtml).toContain("sessionStorage");
  });

  // v1.61.0 — /help, the start-here walkthrough. It is static (no per-run
  // data), so the only things the rollup can get wrong are writing it at
  // all, copying its screenshots, and gating it like every other page.
  it("writes help.html and copies its screenshots into the bundle", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });

    const helpHtml = await fs.readFile(path.join(outputDir, "help.html"), "utf8");
    expect(helpHtml).toContain('<ol class="hp-stepper">');
    expect(helpHtml).toContain("How to review your site&#39;s files");
    expect(helpHtml).toContain('class="site-footer"');

    for (const shot of HELP_SCREENSHOTS) {
      const onDisk = path.join(outputDir, "assets", "help", shot);
      expect((await fs.stat(onDisk)).isFile(), `assets/help/${shot} copied`).toBe(true);
      expect(helpHtml).toContain(`src="assets/help/${shot}"`);
    }
  });

  it("links help.html from every bundle page", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });
    const names = await fs.readdir(outputDir);
    const detail = names.find((n) => /^dvfr-\d{8}-\d{6}Z\.html$/.test(n));
    expect(detail, "per-site detail page exists").toBeTruthy();
    for (const page of ["index.html", "sites.html", "whats-new.html", "search.html", detail]) {
      const html = await fs.readFile(path.join(outputDir, page), "utf8");
      expect(html, `${page} should link help.html`).toContain('href="help.html"');
    }
  });

  // v1.61.2 — the bundle is internal ICJIA material; nothing in it should be
  // indexed, cached, archived, or trained on. robots.txt is the cooperative
  // layer under the Netlify password and the X-Robots-Tag header.
  it("emits a robots.txt that disallows every path for every crawler", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });
    const robots = await fs.readFile(path.join(outputDir, "robots.txt"), "utf8");

    // Wildcard rule first, and disallowing the root.
    expect(robots).toMatch(/User-agent: \*\nDisallow: \/\n/);

    // Every declared agent gets its own Disallow: / — a stanza with a
    // narrower path, or none at all, would silently permit that crawler.
    const stanzas = robots.split(/\n(?=User-agent: )/).filter((b) => b.startsWith("User-agent:"));
    expect(stanzas.length).toBeGreaterThan(10);
    for (const block of stanzas) {
      const agent = block.match(/User-agent: (.+)/)[1];
      expect(block, `${agent} must be disallowed from /`).toMatch(/\nDisallow: \/\s*$/);
    }

    // Named because these have ignored the wildcard in practice.
    for (const agent of ["GPTBot", "ClaudeBot", "CCBot", "Google-Extended", "ia_archiver"]) {
      expect(robots, `robots.txt should name ${agent}`).toContain(`User-agent: ${agent}`);
    }

    // Nothing may be re-allowed.
    expect(robots).not.toMatch(/^Allow:/m);
  });

  it("password-gates help.html when a password is set", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, password: "secret", noOg: true });
    const helpHtml = await fs.readFile(path.join(outputDir, "help.html"), "utf8");
    expect(helpHtml).toContain("sessionStorage");
  });

  it("emits sites-list.xlsx as a real workbook", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });
    const buf = await fs.readFile(path.join(outputDir, "sites-list.xlsx"));
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 2).toString("latin1")).toBe("PK"); // ZIP/XLSX magic
  });

  it("v1.28.0 — emits content-only + tooling-only workbooks and an Owner column in all three", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    await fs.mkdir(path.join(auditsBase, "dvfr", "latest"), { recursive: true });
    await writeInventory(path.join(auditsBase, "dvfr", "latest", "inventory.ndjson"), { serverName: "dvfr" });
    const sitesFile = path.join(tmpDir, "sites.json");
    await fs.writeFile(sitesFile, JSON.stringify({
      version: 1,
      sites: [{ name: "dvfr", siteName: "DVFR", siteUrl: "https://dvfr.illinois.gov", host: "10.0.0.1", user: "forge", remotePath: "/uploads", owner: "Jane Manager" }],
      tools: [{ name: "squish", siteName: "Squish", siteUrl: "https://squish.icjia.app", owner: "Web Team" }],
    }));
    const outputDir = path.join(tmpDir, "out");
    const result = await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });
    expect(result.exitCode).toBe(0);

    // All three workbooks exist and are real zip containers.
    for (const f of ["sites-list.xlsx", "sites-list-content.xlsx", "sites-list-tools.xlsx"]) {
      const buf = await fs.readFile(path.join(outputDir, f));
      expect(buf.slice(0, 2).toString("latin1")).toBe("PK");
    }

    // Combined workbook: Owner column on both tabs with the configured values.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await fs.readFile(path.join(outputDir, "sites-list.xlsx")));
    const contentSheet = wb.getWorksheet("Content sites");
    const contentHeader = contentSheet.getRow(1).values.slice(1);
    expect(contentHeader).toContain("Owner");
    expect(contentSheet.getRow(2).getCell(contentHeader.indexOf("Owner") + 1).value).toBe("Jane Manager");
    const toolSheet = wb.getWorksheet("Tooling sites");
    const toolHeader = toolSheet.getRow(1).values.slice(1);
    expect(toolHeader).toContain("Owner");
    expect(toolSheet.getRow(2).getCell(toolHeader.indexOf("Owner") + 1).value).toBe("Web Team");

    // Single-audience workbooks carry exactly their one sheet, with Owner.
    const wbContent = new ExcelJS.Workbook();
    await wbContent.xlsx.load(await fs.readFile(path.join(outputDir, "sites-list-content.xlsx")));
    expect(wbContent.worksheets.map((w) => w.name)).toEqual(["Content sites"]);
    expect(wbContent.getWorksheet("Content sites").getRow(1).values.slice(1)).toContain("Owner");
    const wbTools = new ExcelJS.Workbook();
    await wbTools.xlsx.load(await fs.readFile(path.join(outputDir, "sites-list-tools.xlsx")));
    expect(wbTools.worksheets.map((w) => w.name)).toEqual(["Tooling sites"]);
    expect(wbTools.getWorksheet("Tooling sites").getRow(1).values.slice(1)).toContain("Owner");

    // /sites renders all three download buttons.
    const sitesHtml = await fs.readFile(path.join(outputDir, "sites.html"), "utf8");
    expect(sitesHtml).toContain("All content and tooling sites");
    expect(sitesHtml).toContain('href="sites-list-content.xlsx"');
    expect(sitesHtml).toContain('href="sites-list-tools.xlsx"');
  });
});

// v1.29.0 — the per-site workbook gains a "Pages" tab mirroring the HTML
// Page view: one row per page with the files it links (names + URLs), plus
// CMS-only pages with no files. The user-visible gap this closes: detail
// reports listed pages with no way to see their files in the download.
describe("runWebRollup — per-site Pages sheet (v1.29.0)", () => {
  it("writes a Pages tab with page URL, linked file names/URLs, and cms rows", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    const latestDir = path.join(auditsBase, "dvfr", "latest");
    await fs.mkdir(latestDir, { recursive: true });

    // Cross-ref'd inventory (preferred over raw): doc.pdf is referenced
    // from /about; orphan.pdf links nowhere.
    const header = JSON.stringify({
      schemaVersion: 1,
      kind: "filecap-inventory-header",
      metadata: {
        serverName: "dvfr",
        hostname: "cms-01",
        serverIp: "10.0.0.1",
        scannedPath: "/uploads",
        scannedAt: "2026-05-09T16:05:04.000Z",
        publicUrlBase: "https://files.example.gov/uploads",
        filecapVersion: "1.1.1",
        nodeVersion: "v20.18.0",
        options: { hash: true, introspect: false, maxIntrospectMb: 200, concurrency: 4 },
      },
    });
    const refEntry = JSON.stringify({
      path: "doc.pdf", absolutePath: "/uploads/doc.pdf", filename: "doc.pdf",
      extension: "pdf", category: "pdf", remediable: true, sizeBytes: 1024,
      modifiedAt: "2024-01-01T00:00:00.000Z", sha256: "a1b2c3", flags: [],
      references: [{ siteName: "dvfr", contentType: "page", entryId: 1, pageUrl: "https://dvfr.example.gov/about" }],
    });
    const orphanEntry = JSON.stringify({
      path: "orphan.pdf", absolutePath: "/uploads/orphan.pdf", filename: "orphan.pdf",
      extension: "pdf", category: "pdf", remediable: true, sizeBytes: 2048,
      modifiedAt: "2024-02-01T00:00:00.000Z", sha256: "d4e5f6", flags: [],
      references: [],
    });
    const footer = JSON.stringify({ kind: "filecap-inventory-footer", entryCount: 2, scannedAt: "2026-05-09T16:05:04.000Z" });
    await fs.writeFile(path.join(latestDir, "inventory.cross-ref.ndjson"), [header, refEntry, orphanEntry, footer].join("\n") + "\n");
    // Raw inventory must exist too (web-rollup requires a scan to bundle the site).
    await fs.writeFile(path.join(latestDir, "inventory.ndjson"), [header, refEntry, orphanEntry, footer].join("\n") + "\n");
    // Retained sidecar: the /about page (already in refs) + a no-files cms page.
    await fs.writeFile(
      path.join(latestDir, "references-sidecar.ndjson"),
      [
        JSON.stringify({ siteName: "dvfr", contentType: "page", entryId: 1, slug: "about", pageUrl: "https://dvfr.example.gov/about", referencedFiles: ["https://files.example.gov/uploads/doc.pdf"] }),
        JSON.stringify({ siteName: "dvfr", contentType: "faq", entryId: 2, slug: "faq-1", pageUrl: "https://dvfr.example.gov/faqs/faq-1", referencedFiles: [] }),
      ].join("\n") + "\n",
    );

    const sitesFile = path.join(tmpDir, "sites.json");
    await writeSitesJson(sitesFile, [
      { name: "dvfr", siteName: "DVFR", host: "10.0.0.1", user: "forge", remotePath: "/uploads" },
    ]);
    const outputDir = path.join(tmpDir, "out");
    const result = await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });
    expect(result.exitCode).toBe(0);

    const files = await fs.readdir(outputDir);
    const wbName = files.find((f) => /^dvfr-.*\.xlsx$/.test(f));
    expect(wbName).toBeTruthy();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await fs.readFile(path.join(outputDir, wbName)));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["PDFs", "Pages"]);

    const pages = wb.getWorksheet("Pages");
    const headerRow = pages.getRow(1).values.slice(1);
    // v1.31.0 — "Files listed elsewhere" counts a page's linked files that
    // are listed under an earlier page (each file appears once per workbook).
    expect(headerRow).toEqual(["Page", "Content type", "Source", "Files", "Files listed elsewhere", "File names", "File URLs", "Files on other sites"]);

    // Row 2: the file-linking page (sorted first).
    const aboutRow = pages.getRow(2);
    expect(aboutRow.getCell(1).value).toEqual({
      text: "https://dvfr.example.gov/about",
      hyperlink: "https://dvfr.example.gov/about",
    });
    expect(aboutRow.getCell(2).value).toBe("page");
    expect(aboutRow.getCell(3).value).toBe("links files");
    expect(aboutRow.getCell(4).value).toBe(1);
    expect(aboutRow.getCell(5).value).toBe(0);
    expect(aboutRow.getCell(6).value).toBe("doc.pdf");
    expect(aboutRow.getCell(7).value).toBe("https://files.example.gov/uploads/doc.pdf");

    // Row 3: the cms page with no files.
    const faqRow = pages.getRow(3);
    expect(faqRow.getCell(1).value).toEqual({
      text: "https://dvfr.example.gov/faqs/faq-1",
      hyperlink: "https://dvfr.example.gov/faqs/faq-1",
    });
    expect(faqRow.getCell(3).value).toBe("cms");
    expect(faqRow.getCell(4).value).toBe(0);
    expect(faqRow.getCell(5).value).toBe(0);
    expect(faqRow.getCell(6).value).toBeNull();
  });
});

async function writeInvWithEntry(filePath, { serverName, scannedAt, publicUrlBase, entryPath, filename }) {
  const header = JSON.stringify({
    schemaVersion: 1, kind: "filecap-inventory-header",
    metadata: { serverName, scannedAt, publicUrlBase },
  });
  const entry = JSON.stringify({ path: entryPath, filename, category: "office-document", remediable: true });
  const footer = JSON.stringify({ kind: "filecap-inventory-footer", entryCount: 1 });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, [header, entry, footer].join("\n") + "\n", "utf8");
}

describe("buildFleetFileIndex", () => {
  it("maps each entry's canonical URL → owning site, label, filename, detail href", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    await writeInvWithEntry(path.join(auditsBase, "agency", "latest", "inventory.ndjson"), {
      serverName: "agency", scannedAt: "2026-06-12T20:14:54.000Z",
      publicUrlBase: "https://agency.cms/uploads", entryPath: "proto_abc.docx", filename: "proto_abc.docx",
    });
    const sites = [{ name: "agency", siteName: "ICJIA agency", publicUrlBase: "https://agency.cms/uploads" }];
    const aliasMap = buildAliasMap({ sites });
    const index = await buildFleetFileIndex(sites, auditsBase, aliasMap);
    expect(index.get("https://agency.cms/uploads/proto_abc.docx")).toEqual({
      siteName: "agency",
      siteLabel: "ICJIA agency",
      filename: "proto_abc.docx",
      detailHref: "icjia-agency-20260612-201454Z.html",
    });
  });
});

describe("cross-site (CMS-hosted) files in the Page view (v1.32.0)", () => {
  async function writeRichInventory(filePath, { serverName, scannedAt, publicUrlBase, entries }) {
    const lines = [JSON.stringify({
      schemaVersion: 1, kind: "filecap-inventory-header",
      metadata: { serverName, scannedAt, publicUrlBase, siteName: serverName },
    })];
    for (const e of entries) lines.push(JSON.stringify(e));
    lines.push(JSON.stringify({ kind: "filecap-inventory-footer", entryCount: entries.length }));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, lines.join("\n") + "\n", "utf8");
  }

  it("surfaces a CMS-hosted file on the referring site's page, linked to the owner", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    const ts = "2026-06-12T20:14:54.000Z";

    // agency inventory owns the DOCX (CMS host).
    await writeRichInventory(path.join(auditsBase, "agency", "latest", "inventory.cross-ref.ndjson"), {
      serverName: "agency", scannedAt: ts, publicUrlBase: "https://agency.cms/uploads",
      entries: [{ path: "proto_abc.docx", filename: "proto_abc.docx", category: "office-document", remediable: true, references: [] }],
    });

    // sfs inventory: a PDF (local) whose page also links the agency DOCX.
    await writeRichInventory(path.join(auditsBase, "sfs", "latest", "inventory.cross-ref.ndjson"), {
      serverName: "sfs", scannedAt: ts, publicUrlBase: "https://sfs.gov",
      entries: [{
        path: "q.pdf", filename: "q.pdf", category: "pdf", remediable: true,
        references: [{ siteName: "sfs", contentType: "template", entryId: "p", pageUrl: "https://sfs.gov/research" }],
      }],
    });
    // sfs sidecar: /research links both the local PDF and the agency DOCX.
    await fs.writeFile(
      path.join(auditsBase, "sfs", "latest", "references-sidecar.ndjson"),
      JSON.stringify({
        siteName: "sfs", contentType: "template", entryId: "p", pageUrl: "https://sfs.gov/research",
        referencedFiles: ["https://sfs.gov/q.pdf", "https://agency.cms/uploads/proto_abc.docx"],
      }) + "\n",
      "utf8",
    );

    const sitesFile = path.join(tmpDir, "sites.json");
    await writeSitesJson(sitesFile, [
      { name: "sfs", siteName: "SFS", publicUrlBase: "https://sfs.gov", siteUrl: "https://sfs.gov/" },
      { name: "agency", siteName: "ICJIA agency", publicUrlBase: "https://agency.cms/uploads" },
    ]);
    const outputDir = path.join(tmpDir, "output");
    const result = await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, password: null });
    expect(result.exitCode).toBe(0);

    // SFS HTML shows the cross-site group with the DOCX, linked to the agency page.
    const sfsHtml = await fs.readFile(path.join(outputDir, `sfs-20260612-201454Z.html`), "utf8");
    expect(sfsHtml).toContain("hosted on another site");
    expect(sfsHtml).toContain("proto_abc.docx");
    expect(sfsHtml).toContain(`href="icjia-agency-20260612-201454Z.html"`);

    // SFS XLSX Pages tab has the new column populated for /research.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(outputDir, `sfs-20260612-201454Z.xlsx`));
    const pagesSheet = wb.getWorksheet("Pages");
    expect(pagesSheet).toBeTruthy();
    const headerRow = pagesSheet.getRow(1).values.map((v) => (v && v.text) ? v.text : v);
    expect(headerRow).toContain("Files on other sites");
    let found = false;
    pagesSheet.eachRow((row) => {
      const cells = row.values.map((v) => (v && v.text) ? v.text : v);
      if (cells.some((c) => typeof c === "string" && c.includes("proto_abc.docx") && c.includes("ICJIA agency"))) found = true;
    });
    expect(found).toBe(true);
  });
});
