// v1.39.0 — D12 (Interface Contract 5, consumer side): runReport accepts a
// publicUrlBaseOverride that is injected into the header metadata exactly
// like the existing pathPrefix injection, so buildPublicUrl (csv.js/html.js)
// resolves rows against the sites.json base instead of the (possibly stale)
// base cached in the scanned inventory header.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runReport } from "../src/commands/report.js";

let tmpRoot;
let outDir;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-report-cmd-"));
  outDir = path.join(tmpRoot, "out");
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

const headerLine = JSON.stringify({
  schemaVersion: 1,
  kind: "filecap-inventory-header",
  metadata: {
    serverName: "test-server",
    hostname: "test-server.local",
    serverIp: "10.0.0.1",
    scannedPath: "/uploads",
    scannedAt: "2026-01-01T00:00:00.000Z",
    publicUrlBase: "https://old.example.com/uploads",
    filecapVersion: "1.38.0",
    nodeVersion: "v20.11.1",
    options: { introspect: false, hash: true, maxIntrospectMb: 200, concurrency: 4 },
  },
});

const entryLine = JSON.stringify({
  path: "docs/report a.pdf",
  absolutePath: "/uploads/docs/report a.pdf",
  filename: "report a.pdf",
  extension: "pdf",
  category: "pdf",
  remediable: true,
  sizeBytes: 1024,
  modifiedAt: "2026-01-01T00:00:00.000Z",
  sha256: "h1",
  flags: [],
});

const footerLine = JSON.stringify({
  kind: "filecap-inventory-footer",
  stats: { fileCount: 1, totalBytes: 1024, scanDurationMs: 1, introspectionFailures: 0, permissionDenials: 0 },
});

async function writeInventory() {
  const input = path.join(tmpRoot, "inv.ndjson");
  await fs.writeFile(input, [headerLine, entryLine, footerLine].join("\n") + "\n");
  return input;
}

describe("runReport csvHref pass-through (v1.39.0, Interface Contract 6)", () => {
  it("suppresses the download link when csvHref is explicitly null", async () => {
    const input = await writeInventory();
    const result = await runReport({
      input,
      outputDir: outDir,
      html: true,
      csvHref: null,
    });
    expect(result.exitCode).toBe(0);
    const html = await fs.readFile(path.join(outDir, "audit-file-list.html"), "utf8");
    // The stylesheet still carries .report-csv-* rules; assert on markup.
    expect(html).not.toContain('<div class="report-csv-block">');
    expect(html).not.toContain('<a class="report-csv-link"');
  });

  it("defaults the link to the sibling audit-file-list.csv when csvHref is not passed", async () => {
    const input = await writeInventory();
    const result = await runReport({ input, outputDir: outDir, html: true });
    expect(result.exitCode).toBe(0);
    const html = await fs.readFile(path.join(outDir, "audit-file-list.html"), "utf8");
    expect(html).toContain('href="audit-file-list.csv"');
    expect(html).toContain("report-csv-link");
  });

  it("keeps an explicit csvHref override untouched", async () => {
    const input = await writeInventory();
    const result = await runReport({
      input,
      outputDir: outDir,
      html: true,
      csvHref: "my-site-2026.xlsx",
    });
    expect(result.exitCode).toBe(0);
    const html = await fs.readFile(path.join(outDir, "audit-file-list.html"), "utf8");
    expect(html).toContain('href="my-site-2026.xlsx"');
  });
});

describe("runReport publicUrlBaseOverride (v1.39.0)", () => {
  it("uses the override base for CSV and HTML public URLs", async () => {
    const input = await writeInventory();
    const result = await runReport({
      input,
      outputDir: outDir,
      html: true,
      publicUrlBaseOverride: "https://new.example.com",
    });
    expect(result.exitCode).toBe(0);

    const csv = await fs.readFile(path.join(outDir, "audit-file-list.csv"), "utf8");
    expect(csv).toContain("https://new.example.com/docs/report%20a.pdf");
    expect(csv).not.toContain("https://old.example.com");

    const html = await fs.readFile(path.join(outDir, "audit-file-list.html"), "utf8");
    expect(html).toContain('href="https://new.example.com/docs/report%20a.pdf"');
  });

  it("composes with pathPrefix (override base + prefix + encoded path)", async () => {
    const input = await writeInventory();
    const result = await runReport({
      input,
      outputDir: outDir,
      html: false,
      pathPrefix: "/static",
      publicUrlBaseOverride: "https://new.example.com",
    });
    expect(result.exitCode).toBe(0);
    const csv = await fs.readFile(path.join(outDir, "audit-file-list.csv"), "utf8");
    expect(csv).toContain("https://new.example.com/static/docs/report%20a.pdf");
  });

  it("keeps the header's own base when no override is passed", async () => {
    const input = await writeInventory();
    const result = await runReport({ input, outputDir: outDir, html: false });
    expect(result.exitCode).toBe(0);
    const csv = await fs.readFile(path.join(outDir, "audit-file-list.csv"), "utf8");
    expect(csv).toContain("https://old.example.com/uploads/docs/report%20a.pdf");
  });
});
