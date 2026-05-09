import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeHtml } from "../src/report/html.js";

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-html-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const sampleHeader = {
  schemaVersion: 1,
  kind: "filecap-inventory-header",
  metadata: {
    serverName: "test-server",
    hostname: "test.example.com",
    serverIp: "10.0.0.1",
    scannedPath: "/uploads",
    scannedAt: "2026-05-09T12:00:00.000Z",
    filecapVersion: "1.0.2",
    nodeVersion: "v20.18.0",
    options: { hash: true, introspect: true, maxIntrospectMb: 200, concurrency: 4 },
  },
};

const sampleEntries = [
  {
    path: "doc.pdf",
    absolutePath: "/uploads/doc.pdf",
    filename: "doc.pdf",
    extension: "pdf",
    category: "pdf",
    remediable: true,
    sizeBytes: 1024,
    modifiedAt: "2024-01-01T00:00:00.000Z",
    sha256: "a1b2",
    flags: [],
    introspection: { kind: "pdf", pageCount: 3, hasTextLayer: true, isImageOnly: false, hasTags: false, hasFormFields: false, hasSignatures: false, encrypted: false },
  },
  {
    path: "scan.pdf",
    absolutePath: "/uploads/scan.pdf",
    filename: "scan.pdf",
    extension: "pdf",
    category: "pdf",
    remediable: true,
    sizeBytes: 2048000,
    modifiedAt: "2024-02-01T00:00:00.000Z",
    sha256: "c3d4",
    flags: ["scanned-name-pattern"],
    introspection: { kind: "pdf", pageCount: 1, hasTextLayer: false, isImageOnly: true, hasTags: false, hasFormFields: false, hasSignatures: false, encrypted: false },
  },
];

describe("writeHtml", () => {
  it("produces a valid HTML file at the given path", async () => {
    const out = path.join(tmpDir, "files.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toMatch(/<\/html>\s*$/);
  });

  it("includes server metadata in the header section", async () => {
    const out = path.join(tmpDir, "files.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain("test-server");
    expect(html).toContain("10.0.0.1");
    expect(html).toContain("/uploads");
  });

  it("renders one row per entry with filename and path visible", async () => {
    const out = path.join(tmpDir, "files.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain("doc.pdf");
    expect(html).toContain("scan.pdf");
    // Should contain both as table cells
    const rowMatches = html.match(/<tr[^>]*>/g) || [];
    // Header row + 2 data rows = at least 3 <tr>
    expect(rowMatches.length).toBeGreaterThanOrEqual(3);
  });

  it("escapes HTML-special characters in entry data", async () => {
    const out = path.join(tmpDir, "files.html");
    const tricky = [{
      ...sampleEntries[0],
      filename: "<script>alert(1)</script>.pdf",
      path: "evil&friends/<x>.pdf",
    }];
    await writeHtml({ sourceHeader: sampleHeader, entries: tricky, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    // The literal script tag must not appear in the rendered output
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("evil&amp;friends");
  });

  it("includes summary counts (total files, by category)", async () => {
    const out = path.join(tmpDir, "files.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain("Total files");
    expect(html).toMatch(/2/);
  });

  it("uses human-readable column headers in <th> elements", async () => {
    const out = path.join(tmpDir, "labels.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain("File name");
    expect(html).toContain("Needs remediation");
    expect(html).toContain("PDF: page count");
    expect(html).not.toContain("<th data-col=\"filename\">filename</th>");
  });

  it("renders boolean true as Yes and false as No in table cells", async () => {
    const out = path.join(tmpDir, "booleans.html");
    const entries = [{
      ...sampleEntries[0],
      remediable: true,
      introspection: { kind: "pdf", pageCount: 3, hasTextLayer: true, isImageOnly: false, hasTags: false, hasFormFields: false, hasSignatures: false, encrypted: false },
    }];
    await writeHtml({ sourceHeader: sampleHeader, entries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain("<td>Yes</td>");
    expect(html).toContain("<td>No</td>");
    expect(html).not.toMatch(/<td>true<\/td>/);
    expect(html).not.toMatch(/<td>false<\/td>/);
  });

  it("flags image-only PDFs visually (e.g. row class or badge)", async () => {
    const out = path.join(tmpDir, "files.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    // We expect SOME visual indicator of image-only — class name, badge, or symbol
    // The test just checks that "image-only" appears as a string somewhere meaningful
    expect(html).toMatch(/image[- ]only/i);
  });

  it("includes inline CSS (no external stylesheets)", async () => {
    const out = path.join(tmpDir, "files.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain("<style");
    expect(html).not.toMatch(/<link[^>]*rel=["']stylesheet/);
  });

  it("includes a search input for filtering rows", async () => {
    const out = path.join(tmpDir, "files.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toMatch(/<input[^>]*type=["']search["']/i);
  });

  it("sets <title> to site name when siteName is present in header", async () => {
    const headerWithSite = {
      ...sampleHeader,
      metadata: { ...sampleHeader.metadata, siteName: "DVFR" },
    };
    const out = path.join(tmpDir, "title-site.html");
    await writeHtml({ sourceHeader: headerWithSite, entries: sampleEntries, sources: [headerWithSite], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain("<title>filecap audit — DVFR</title>");
  });

  it("sets <title> to server name when siteName is absent", async () => {
    const out = path.join(tmpDir, "title-server.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain("<title>filecap audit — test-server</title>");
  });

  it("includes Website column header in the table", async () => {
    const out = path.join(tmpDir, "website-col.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain("Website");
  });

  it("shows Website in the summary meta-grid when siteName is set", async () => {
    const headerWithSite = {
      ...sampleHeader,
      metadata: { ...sampleHeader.metadata, siteName: "DVFR" },
    };
    const out = path.join(tmpDir, "site-meta.html");
    await writeHtml({ sourceHeader: headerWithSite, entries: sampleEntries, sources: [headerWithSite], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain("Website:");
    expect(html).toContain("DVFR");
  });
});
