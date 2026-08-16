import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runWebRollup } from "../src/commands/web-rollup.js";

// v1.46.0 — the /search feature's bundle wiring: web-rollup must emit
// search-index.json + search.html, gate the page like every other page,
// and every nav (home, /sites, what's-new, per-site reports, footer) must
// link to it.

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-search-rollup-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeInventory(filePath, { serverName, scannedAt = "2026-05-09T16:05:04.000Z" }) {
  const header = JSON.stringify({
    schemaVersion: 1,
    kind: "filecap-inventory-header",
    metadata: {
      serverName,
      hostname: "test.example.com",
      serverIp: "10.0.0.1",
      scannedPath: "/uploads",
      scannedAt,
      filecapVersion: "1.1.1",
      nodeVersion: "v20.18.0",
      options: { hash: true, introspect: false, maxIntrospectMb: 200, concurrency: 4 },
    },
  });
  const entry = JSON.stringify({
    path: "reports/Annual Report 2023.pdf",
    absolutePath: "/uploads/reports/Annual Report 2023.pdf",
    filename: "Annual Report 2023.pdf",
    extension: "pdf",
    category: "pdf",
    remediable: true,
    sizeBytes: 1024,
    modifiedAt: "2024-01-01T00:00:00.000Z",
    sha256: "a1b2c3",
    flags: [],
    audit: { audited: true, cached: false, checkedAt: "2026-05-09T16:05:04.000Z", score: 81, grade: "B" },
  });
  const footer = JSON.stringify({ kind: "filecap-inventory-footer", entryCount: 1, scannedAt });
  await fs.writeFile(filePath, [header, entry, footer].join("\n") + "\n", "utf8");
}

async function buildFixture() {
  const auditsBase = path.join(tmpDir, "filecap-audits");
  const latestDir = path.join(auditsBase, "dvfr", "latest");
  await fs.mkdir(latestDir, { recursive: true });
  await writeInventory(path.join(latestDir, "inventory.ndjson"), { serverName: "dvfr" });

  const sitesFile = path.join(tmpDir, "sites.json");
  await fs.writeFile(sitesFile, JSON.stringify({
    version: 1,
    sites: [{
      name: "dvfr",
      siteName: "DVFR",
      siteFullName: "Domestic Violence Fatality Review",
      host: "203.0.113.10",
      user: "forge",
      remotePath: "/uploads",
      publicUrlBase: "https://dvfr.icjia-api.cloud/uploads",
    }],
  }));

  const outputDir = path.join(tmpDir, "output");
  return { sitesFile, outputDir, auditsBase };
}

async function rollup(extra = {}) {
  const { sitesFile, outputDir, auditsBase } = await buildFixture();
  const result = await runWebRollup({
    output: outputDir,
    sitesFile,
    _auditsBase: auditsBase,
    noOg: true,
    ...extra,
  });
  expect(result.exitCode).toBe(0);
  return outputDir;
}

describe("web-rollup /search wiring", () => {
  it("emits search-index.json with the fleet's rows and site table", async () => {
    const out = await rollup();
    const idx = JSON.parse(await fs.readFile(path.join(out, "search-index.json"), "utf8"));
    expect(idx.sites).toHaveLength(1);
    expect(idx.sites[0].label).toBe("DVFR");
    expect(idx.sites[0].detail).toMatch(/^dvfr-.*Z\.html$/);
    expect(idx.rows).toHaveLength(1);
    const row = idx.rows[0];
    expect(row[0]).toBe("Annual Report 2023.pdf");
    expect(row[6]).toBe(81);
    expect(row[8]).toBe("https://dvfr.icjia-api.cloud/uploads/reports/Annual%20Report%202023.pdf");
  });

  it("emits search.html wired to the index artifact", async () => {
    const out = await rollup();
    const html = await fs.readFile(path.join(out, "search.html"), "utf8");
    expect(html).toContain("search-index.json");
    expect(html).toContain('id="search-input"');
    expect(html).not.toContain("fc-pw"); // ungated without a password
  });

  it("gates search.html when the bundle has a password", async () => {
    const out = await rollup({ password: "hunter2" });
    const html = await fs.readFile(path.join(out, "search.html"), "utf8");
    expect(html).toContain("fc-pw");
  });

  it("links Search from the home page, /sites, What's New, and per-site reports", async () => {
    const out = await rollup();
    const files = await fs.readdir(out);
    const detail = files.find((f) => /^dvfr-.*Z\.html$/.test(f));
    for (const page of ["index.html", "sites.html", "whats-new.html", detail]) {
      const html = await fs.readFile(path.join(out, page), "utf8");
      expect(html, `${page} should link search.html`).toContain('href="search.html"');
    }
  });
});
