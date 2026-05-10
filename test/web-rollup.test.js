import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runWebRollup } from "../src/commands/web-rollup.js";

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
  ip = "192.241.146.85",
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
    expect(files).toContain("assets");

    const assets = await fs.readdir(path.join(outputDir, "assets"));
    expect(assets).toContain("style.css");
  });

  it("names per-site files as <slug>-<timestamp>.html and .csv", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture({
      siteName: "DVFR",
      scannedAt: "2026-05-09T16:05:04.000Z",
    });
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const files = await fs.readdir(outputDir);
    expect(files.some((f) => f.match(/^dvfr-20260509-160504Z\.html$/))).toBe(true);
    expect(files.some((f) => f.match(/^dvfr-20260509-160504Z\.csv$/))).toBe(true);
  });

  it("index.html references the per-site HTML and CSV files", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture({
      siteName: "DVFR",
      scannedAt: "2026-05-09T16:05:04.000Z",
    });
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const index = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(index).toContain("dvfr-20260509-160504Z.html");
    expect(index).toContain("dvfr-20260509-160504Z.csv");
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

  it("index.html contains both by-type column headings", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(html).toContain("Files needing remediation");
    expect(html).toContain("Files NOT requiring remediation");
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

  it("index.html site cards contain Technical details disclosure element", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(html).toContain("Technical details");
    expect(html).toContain("<details");
    expect(html).toContain("<summary>");
  });

  it("index.html hero section uses plain-English lead paragraph wording", async () => {
    const { sitesFile, outputDir, auditsBase } = await buildFixture();
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });

    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(html).toContain("We scanned");
    expect(html).toContain("files in total");
    expect(html).toContain("need accessibility audit");
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
});
