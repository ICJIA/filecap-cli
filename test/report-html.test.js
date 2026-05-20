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
  });

  it("includes summary counts (total files, by category)", async () => {
    const out = path.join(tmpDir, "files.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain("Total files");
    expect(html).toMatch(/2/);
  });

  it("renders the trimmed 6-column manager HTML table with human-readable headers", async () => {
    const out = path.join(tmpDir, "labels.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    // v1.12.0: the HTML table shows only the six columns a manager acts on.
    expect(html).toContain('<th data-col="filename">File name</th>');
    expect(html).toContain('<th data-col="category">File type</th>');
    expect(html).toContain('<th data-col="auditScore">Audit Score</th>');
    expect(html).toContain('<th data-col="referenced">Page References</th>');
    expect(html).toContain('<th data-col="duplicateOf">Duplicate of</th>');
    expect(html).toContain('<th data-col="modifiedAt">Date published</th>');
    // Forensic columns are CSV-only — not rendered as HTML table columns.
    for (const col of ["serverName", "serverIp", "publicUrl", "scannedPath", "path", "absolutePath", "extension", "sizeBytes", "sha256"]) {
      expect(html).not.toMatch(new RegExp('<th data-col="' + col + '"'));
    }
    // Exactly six header cells in the inventory table.
    const theadMatch = html.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/);
    expect(theadMatch).not.toBeNull();
    expect((theadMatch[1].match(/<th /g) || []).length).toBe(6);
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

  it("omits the Website column from a single-site report table", async () => {
    const out = path.join(tmpDir, "website-col.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    // A single-site report is already scoped to one site — no Website column.
    expect(html).not.toMatch(/<th data-col="siteName"/);
  });

  it("prepends a Website column on a consolidated multi-site report", async () => {
    const consolidatedHeader = {
      schemaVersion: 1,
      kind: "filecap-consolidated-header",
      metadata: { consolidatedAt: "2026-05-09T12:00:00.000Z", sources: [] },
    };
    const sources = [
      { serverName: "test-server", metadata: { ...sampleHeader.metadata, siteName: "DVFR" } },
    ];
    const consolidatedEntries = sampleEntries.map((e) => ({ ...e, serverName: "test-server" }));
    const out = path.join(tmpDir, "consolidated-website.html");
    await writeHtml({ sourceHeader: consolidatedHeader, entries: consolidatedEntries, sources, outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain('<th data-col="siteName">Website</th>');
    const theadMatch = html.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/);
    expect(theadMatch).not.toBeNull();
    expect((theadMatch[1].match(/<th /g) || []).length).toBe(7);
  });

  it("renders Public URL as a clickable link when publicUrlBase is set in header", async () => {
    const headerWithUrl = {
      ...sampleHeader,
      metadata: { ...sampleHeader.metadata, publicUrlBase: "https://cdn.example.com/uploads" },
    };
    const out = path.join(tmpDir, "puburl.html");
    await writeHtml({ sourceHeader: headerWithUrl, entries: sampleEntries, sources: [headerWithUrl], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toMatch(/<a\s[^>]*href="https:\/\/cdn\.example\.com\/uploads\/doc\.pdf"/);
    expect(html).toContain('target="_blank"');
  });

  it("renders Public URL as plain empty cell when publicUrlBase is absent", async () => {
    const out = path.join(tmpDir, "no-puburl.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    // No link to cdn
    expect(html).not.toMatch(/href="https:\/\/cdn\.example\.com/);
  });

  it("wraps the table in a scrollable container with overflow-x: auto", async () => {
    const out = path.join(tmpDir, "scroll.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toMatch(/<div[^>]*class=["'][^"']*table-scroll[^"']*["']/i);
    expect(html).toMatch(/overflow-x:\s*auto/);
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

  // ── Category filter chips ────────────────────────────────────────────────────

  it("includes a filter bar with category chips", async () => {
    const out = path.join(tmpDir, "chips.html");
    const mixedEntries = [
      { ...sampleEntries[0], category: "pdf" },
      { ...sampleEntries[1], category: "image", filename: "photo.png", path: "photo.png", extension: "png" },
    ];
    await writeHtml({ sourceHeader: sampleHeader, entries: mixedEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain("filter-bar");
    expect(html).toContain('class="chip"');
    expect(html).toMatch(/data-category="pdf"/);
  });

  it("rows have data-category attribute matching their entry", async () => {
    const out = path.join(tmpDir, "row-cats.html");
    const mixedEntries = [
      { ...sampleEntries[0], category: "pdf" },
      { ...sampleEntries[1], category: "image", filename: "photo.png", path: "photo.png", extension: "png" },
    ];
    await writeHtml({ sourceHeader: sampleHeader, entries: mixedEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toMatch(/<tr[^>]*data-category="pdf"/);
    expect(html).toMatch(/<tr[^>]*data-category="image"/);
  });

  it("includes the All chip with total count", async () => {
    const out = path.join(tmpDir, "all-chip.html");
    const fiveEntries = [
      { ...sampleEntries[0], sha256: "h1", path: "a.pdf", filename: "a.pdf" },
      { ...sampleEntries[0], sha256: "h2", path: "b.pdf", filename: "b.pdf" },
      { ...sampleEntries[0], sha256: "h3", path: "c.pdf", filename: "c.pdf" },
      { ...sampleEntries[0], sha256: "h4", path: "d.pdf", filename: "d.pdf" },
      { ...sampleEntries[0], sha256: "h5", path: "e.pdf", filename: "e.pdf" },
    ];
    await writeHtml({ sourceHeader: sampleHeader, entries: fiveEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toMatch(/All \(5\)/);
  });

  it("counts each category correctly in chip labels", async () => {
    const out = path.join(tmpDir, "chip-counts.html");
    const threeAndTwo = [
      { ...sampleEntries[0], sha256: "p1", path: "a.pdf", filename: "a.pdf", category: "pdf" },
      { ...sampleEntries[0], sha256: "p2", path: "b.pdf", filename: "b.pdf", category: "pdf" },
      { ...sampleEntries[0], sha256: "p3", path: "c.pdf", filename: "c.pdf", category: "pdf" },
      { ...sampleEntries[1], sha256: "i1", path: "d.png", filename: "d.png", extension: "png", category: "image", introspection: undefined },
      { ...sampleEntries[1], sha256: "i2", path: "e.png", filename: "e.png", extension: "png", category: "image", introspection: undefined },
    ];
    await writeHtml({ sourceHeader: sampleHeader, entries: threeAndTwo, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toMatch(/PDF[^(]*\(3\)/i);
    expect(html).toMatch(/Image[^(]*\(2\)/i);
  });

  it("embeds entry data via <script type=application/json> so values containing single quotes do not break the IIFE", async () => {
    const out = path.join(tmpDir, "files.html");
    const trickyEntries = [
      {
        ...sampleEntries[0],
        introspection: {
          ...sampleEntries[0].introspection,
          modificationDate: "D:20250207081607-08'00'",
          producer: "Adobe Acrobat 'Pro' 21.0",
        },
      },
    ];
    await writeHtml({ sourceHeader: sampleHeader, entries: trickyEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toMatch(/<script[^>]*type="application\/json"[^>]*id="filecap-data"/i);
    expect(html).toMatch(/document\.getElementById\("filecap-data"\)\.textContent/);
    expect(html).not.toMatch(/JSON\.parse\('[^]*?-08'00'/);
  });

  it("includes the default-sort code path for modifiedAt column in the IIFE", async () => {
    const out = path.join(tmpDir, "default-sort.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    // The IIFE must contain the default-sort block keyed by the modifiedAt data-col attribute
    expect(html).toContain('th.dataset.col === "modifiedAt"');
    expect(html).toContain("dateColIdx");
  });

  it("renders <th data-col='modifiedAt'> with label 'Date published'", async () => {
    const out = path.join(tmpDir, "date-published-header.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    // v1.12.0: column-resize handles removed — the th is just label.
    expect(html).toContain('<th data-col="modifiedAt">Date published</th>');
    expect(html).not.toContain("Last modified");
  });

  // ── Section 3: two-row chip filter ──────────────────────────────────────────

  it("includes filter-bar-primary and filter-bar-secondary sections", async () => {
    const out = path.join(tmpDir, "two-row-chips.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain("filter-bar-primary");
    expect(html).toContain("filter-bar-secondary");
  });

  it("primary chips have data-filter attributes (remediable, reference, all)", async () => {
    const out = path.join(tmpDir, "primary-chips.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain('data-filter="remediable"');
    expect(html).toContain('data-filter="reference"');
    expect(html).toContain('data-filter="all"');
  });

  it("Remediable only primary chip has chip-active class on initial render", async () => {
    const out = path.join(tmpDir, "remediable-active.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toMatch(/data-filter="remediable"[^>]*class="chip chip-active"|class="chip chip-active"[^>]*data-filter="remediable"/);
  });

  // ── Section 2: two-stat summary box ─────────────────────────────────────────

  it("renders stat-card remediable and stat-card reference boxes", async () => {
    const out = path.join(tmpDir, "stat-cards.html");
    const mixedEntries = [
      { ...sampleEntries[0], category: "pdf", remediable: true },
      { ...sampleEntries[1], category: "image", filename: "photo.png", path: "photo.png", extension: "png", remediable: false, introspection: undefined },
    ];
    await writeHtml({ sourceHeader: sampleHeader, entries: mixedEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain('class="stat-card remediable"');
    expect(html).toContain('class="stat-card reference"');
  });

  it("stat-card remediable shows correct remediable count", async () => {
    const out = path.join(tmpDir, "stat-card-counts.html");
    const mixedEntries = [
      { ...sampleEntries[0], sha256: "p1", path: "a.pdf", filename: "a.pdf", category: "pdf", remediable: true },
      { ...sampleEntries[0], sha256: "p2", path: "b.pdf", filename: "b.pdf", category: "pdf", remediable: true },
      { ...sampleEntries[1], sha256: "i1", path: "c.png", filename: "c.png", extension: "png", category: "image", remediable: false, introspection: undefined },
    ];
    await writeHtml({ sourceHeader: sampleHeader, entries: mixedEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    // 2 remediable PDFs
    expect(html).toMatch(/class="stat-card remediable"[\s\S]*?class="stat-number">2</);
    // 1 reference image
    expect(html).toMatch(/class="stat-card reference"[\s\S]*?class="stat-number">1/);
  });

  it("stat-detail lists PDF count when PDFs are present", async () => {
    const out = path.join(tmpDir, "stat-detail-pdfs.html");
    const pdfEntries = [
      { ...sampleEntries[0], sha256: "p1", path: "a.pdf", filename: "a.pdf", category: "pdf", remediable: true },
      { ...sampleEntries[0], sha256: "p2", path: "b.pdf", filename: "b.pdf", category: "pdf", remediable: true },
    ];
    await writeHtml({ sourceHeader: sampleHeader, entries: pdfEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toMatch(/2 PDFs/);
  });

  // ── XSS regression suite (FC-2026-008) ──────────────────────────────────────

  it("escapes XSS payload in serverName metadata (FC-2026-008)", async () => {
    const xssPayload = "<script>alert(1)</script>";
    const headerWithXss = {
      ...sampleHeader,
      metadata: { ...sampleHeader.metadata, serverName: xssPayload },
    };
    const out = path.join(tmpDir, "xss-servername.html");
    await writeHtml({ sourceHeader: headerWithXss, entries: [], sources: [headerWithXss], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
    expect(html).toMatch(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  it("escapes XSS payload in siteName metadata (FC-2026-008)", async () => {
    const xssPayload = "<script>alert(1)</script>";
    const headerWithXss = {
      ...sampleHeader,
      metadata: { ...sampleHeader.metadata, siteName: xssPayload },
    };
    const out = path.join(tmpDir, "xss-sitename.html");
    await writeHtml({ sourceHeader: headerWithXss, entries: [], sources: [headerWithXss], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
    expect(html).toMatch(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  it("escapes XSS payload in hostname metadata (FC-2026-008)", async () => {
    const xssPayload = "<img src=x onerror=alert(1)>";
    const headerWithXss = {
      ...sampleHeader,
      metadata: { ...sampleHeader.metadata, hostname: xssPayload },
    };
    const out = path.join(tmpDir, "xss-hostname.html");
    await writeHtml({ sourceHeader: headerWithXss, entries: [], sources: [headerWithXss], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    // The angle brackets must be escaped so <img> tag cannot execute
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("escapes XSS payload in entry filename and path in HTML table cells (FC-2026-008)", async () => {
    // The payload starts with "> which closes any enclosing attribute/tag context.
    // htmlEscape() must prevent this from breaking out of the <td> context.
    const xssFilename = '"><img src=x onerror=alert(1)>.pdf';
    const xssEntry = {
      ...sampleEntries[0],
      path: xssFilename,
      absolutePath: "/uploads/" + xssFilename,
      filename: xssFilename,
    };
    const out = path.join(tmpDir, "xss-filename.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: [xssEntry], sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    // In the HTML table cells, angle brackets and quotes must be escaped.
    // The escaped form of the payload with both " and < escaped:
    expect(html).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;.pdf");
    // The raw payload must not appear outside of JSON data blocks.
    // Strip the JSON data block to check only the HTML markup context.
    const htmlWithoutJsonBlock = html.replace(
      /<script[^>]*type="application\/json"[^>]*>[\s\S]*?<\/script>/gi,
      ""
    );
    expect(htmlWithoutJsonBlock).not.toContain('"><img src=x onerror=alert(1)>');
  });

  it("uses siteFullName for the page title when provided", async () => {
    const outputPath = path.join(tmpDir, "out.html");
    await writeHtml({
      sourceHeader: sampleHeader,
      entries: sampleEntries,
      sources: null,
      outputPath,
      siteFullName: "Domestic Violence Fatality Review",
    });
    const html = await fs.readFile(outputPath, "utf8");
    expect(html).toContain("Domestic Violence Fatality Review");
  });

  it("falls back to siteName when siteFullName is not provided", async () => {
    const outputPath = path.join(tmpDir, "out.html");
    await writeHtml({
      sourceHeader: { ...sampleHeader, metadata: { ...sampleHeader.metadata, siteName: "DVFR" } },
      entries: sampleEntries,
      sources: null,
      outputPath,
    });
    const html = await fs.readFile(outputPath, "utf8");
    expect(html).toContain("DVFR");
  });

  it("falls back to literal title when both siteFullName and siteName are missing", async () => {
    const outputPath = path.join(tmpDir, "out.html");
    await writeHtml({
      sourceHeader: sampleHeader,  // no siteName in metadata
      entries: sampleEntries,
      sources: null,
      outputPath,
    });
    const html = await fs.readFile(outputPath, "utf8");
    expect(html).toMatch(/<h1[^>]*>filecap inventory report<\/h1>/);
  });

  it("renders the new dp-hero block with two-up tiles + donut row", async () => {
    const outputPath = path.join(tmpDir, "out.html");
    await writeHtml({
      sourceHeader: { ...sampleHeader, metadata: { ...sampleHeader.metadata, siteName: "DVFR" } },
      entries: sampleEntries,
      sources: null,
      outputPath,
      siteFullName: "Domestic Violence Fatality Review",
    });
    const html = await fs.readFile(outputPath, "utf8");
    // dp-hero container
    expect(html).toMatch(/<header class="dp-hero">/);
    // Two-up tiles (sampleEntries has 2 remediable entries -> 2 total / 2 audit -> 100%)
    expect(html).toMatch(/<div class="dp-tile dp-total"><span class="dp-num">2<\/span>/);
    expect(html).toMatch(/<div class="dp-tile dp-audit"><span class="dp-num">2<\/span>/);
    // Donut on its own row
    expect(html).toMatch(/<div class="dp-donut-row">\s*<div class="dp-donut"[^>]*style="--pct:100%/);
    // Plain-English caption
    expect(html).toMatch(/<p class="dp-donut-caption">/);
    // The full title appears in the h1
    expect(html).toMatch(/<h1[^>]*>Domestic Violence Fatality Review<\/h1>/);
  });

  it("no longer emits the inventory-table <colgroup> (column-resize removed in v1.12.0)", async () => {
    const outputPath = path.join(tmpDir, "out.html");
    await writeHtml({
      sourceHeader: sampleHeader,
      entries: sampleEntries,
      sources: null,
      outputPath,
    });
    const html = await fs.readFile(outputPath, "utf8");
    // The inventory table's per-column <col data-col="..."> group is gone.
    // (The row-marker legend table keeps its own layout colgroup.)
    expect(html).not.toMatch(/<col data-col=/);
  });

  it("no longer renders column-resize handles (removed in v1.12.0)", async () => {
    const outputPath = path.join(tmpDir, "out.html");
    await writeHtml({
      sourceHeader: sampleHeader,
      entries: sampleEntries,
      sources: null,
      outputPath,
    });
    const html = await fs.readFile(outputPath, "utf8");
    expect(html).not.toContain("col-resize-handle");
  });

  it("no longer embeds a click-and-drag pan handler (removed in v1.12.0)", async () => {
    // v1.12.0 trims the table to 6 columns + adds a paginator, so there is
    // nothing to pan — the finicky drag-to-pan handler is gone entirely.
    const outputPath = path.join(tmpDir, "out.html");
    await writeHtml({
      sourceHeader: sampleHeader,
      entries: sampleEntries,
      sources: null,
      outputPath,
    });
    const html = await fs.readFile(outputPath, "utf8");
    expect(html).not.toContain("scrollTop: wrap.scrollTop");
    expect(html).not.toContain("setPointerCapture");
    expect(html).not.toContain("is-panning");
  });

  it("includes a paginator with prev/next, page-size selector, and page info", async () => {
    const outputPath = path.join(tmpDir, "out.html");
    await writeHtml({
      sourceHeader: sampleHeader,
      entries: sampleEntries,
      sources: null,
      outputPath,
    });
    const html = await fs.readFile(outputPath, "utf8");
    expect(html).toMatch(/<nav class="paginator"/);
    expect(html).toContain('id="page-info"');
    expect(html).toContain('id="pag-prev"');
    expect(html).toContain('id="pag-next"');
    expect(html).toContain('id="page-size"');
  });

  it("links the File name cell to the file's public URL", async () => {
    const headerWithUrl = {
      ...sampleHeader,
      metadata: { ...sampleHeader.metadata, publicUrlBase: "https://cdn.example.com/uploads" },
    };
    const outputPath = path.join(tmpDir, "filename-link.html");
    await writeHtml({
      sourceHeader: headerWithUrl,
      entries: sampleEntries,
      sources: [headerWithUrl],
      outputPath,
    });
    const html = await fs.readFile(outputPath, "utf8");
    // The File name cell shows the filename text, linked to the file's URL.
    expect(html).toMatch(/<a href="https:\/\/cdn\.example\.com\/uploads\/doc\.pdf"[^>]*target="_blank"[^>]*>doc\.pdf<\/a>/);
  });

  it("applies the site pathPrefix and percent-encodes the File name link (v1.12.2)", async () => {
    // Git sites (old ARI Summit deploys) serve files under /static, and
    // their pre-CMS filenames can contain spaces. The link must include the
    // prefix and encode the space, or it lands on the SPA catch-all.
    const header = {
      ...sampleHeader,
      metadata: {
        ...sampleHeader.metadata,
        publicUrlBase: "https://ariallsites2017.icjia.cloud",
        pathPrefix: "/static",
      },
    };
    const entries = [{
      ...sampleEntries[0],
      path: "summit_documents/Agenda Final 2017.pdf",
      filename: "Agenda Final 2017.pdf",
    }];
    const outputPath = path.join(tmpDir, "pathprefix.html");
    await writeHtml({ sourceHeader: header, entries, sources: [header], outputPath });
    const html = await fs.readFile(outputPath, "utf8");
    expect(html).toContain('href="https://ariallsites2017.icjia.cloud/static/summit_documents/Agenda%20Final%202017.pdf"');
  });

  describe("access-method panel (v1.7.6)", () => {
    it("renders a Strapi-CMS access panel when accessKind is 'strapi'", async () => {
      const outputPath = path.join(tmpDir, "out.html");
      await writeHtml({
        sourceHeader: sampleHeader,
        entries: sampleEntries,
        sources: null,
        outputPath,
        accessKind: "strapi",
      });
      const html = await fs.readFile(outputPath, "utf8");
      expect(html).toMatch(/<section class="access-panel access-strapi"/);
      // v1.7.33: panel headline collapsed to "For bulk file access" — the
      // per-type detail (Strapi CMS / GitHub / Server) stays in the body
      // copy because a remediator visiting the panel still needs to know
      // what credential to ask for.
      expect(html).toContain("For bulk file access");
      expect(html).toContain("Strapi CMS instance on a remote Linux host");
      expect(html).toContain("OpenSSH public key");
      // v1.7.35: access-panel action line now points at Chris Schweda
      // directly with a mailto link (he's the sole access authorizer at
      // ICJIA).
      expect(html).toContain("christopher.schweda@illinois.gov");
    });

    it("renders a GitHub access panel when accessKind is 'github'", async () => {
      const outputPath = path.join(tmpDir, "out.html");
      await writeHtml({
        sourceHeader: sampleHeader,
        entries: sampleEntries,
        sources: null,
        outputPath,
        accessKind: "github",
      });
      const html = await fs.readFile(outputPath, "utf8");
      expect(html).toMatch(/<section class="access-panel access-github"/);
      expect(html).toContain("For bulk file access");
      expect(html).toContain("GitHub.com account");
      expect(html).toContain("ICJIA organization access");
      // v1.7.35: access-panel action line now points at Chris Schweda
      // directly with a mailto link (he's the sole access authorizer at
      // ICJIA).
      expect(html).toContain("christopher.schweda@illinois.gov");
    });

    it("renders a Server access panel when accessKind is 'server'", async () => {
      const outputPath = path.join(tmpDir, "out.html");
      await writeHtml({
        sourceHeader: sampleHeader,
        entries: sampleEntries,
        sources: null,
        outputPath,
        accessKind: "server",
      });
      const html = await fs.readFile(outputPath, "utf8");
      expect(html).toMatch(/<section class="access-panel access-server"/);
      expect(html).toContain("For bulk file access");
      expect(html).toContain("static directory on a remote Linux host");
      expect(html).toContain("OpenSSH public key");
      // v1.7.35: access-panel action line now points at Chris Schweda
      // directly with a mailto link (he's the sole access authorizer at
      // ICJIA).
      expect(html).toContain("christopher.schweda@illinois.gov");
    });

    it("omits the panel entirely when accessKind is null/undefined", async () => {
      const outputPath = path.join(tmpDir, "out.html");
      await writeHtml({
        sourceHeader: sampleHeader,
        entries: sampleEntries,
        sources: null,
        outputPath,
      });
      const html = await fs.readFile(outputPath, "utf8");
      expect(html).not.toMatch(/class="access-panel/);
      expect(html).not.toContain("How to access this site's files");
    });

    it("omits the panel when accessKind is an unrecognized value", async () => {
      const outputPath = path.join(tmpDir, "out.html");
      await writeHtml({
        sourceHeader: sampleHeader,
        entries: sampleEntries,
        sources: null,
        outputPath,
        accessKind: "ftp",
      });
      const html = await fs.readFile(outputPath, "utf8");
      expect(html).not.toMatch(/class="access-panel/);
    });

    it("places the access panel between the dp-hero and the meta-grid", async () => {
      const outputPath = path.join(tmpDir, "out.html");
      await writeHtml({
        sourceHeader: sampleHeader,
        entries: sampleEntries,
        sources: null,
        outputPath,
        accessKind: "strapi",
      });
      const html = await fs.readFile(outputPath, "utf8");
      const heroEnd = html.indexOf("</header>");
      const panelStart = html.indexOf('<section class="access-panel');
      const metaGrid = html.indexOf('<div class="meta-grid">');
      expect(heroEnd).toBeGreaterThan(-1);
      expect(panelStart).toBeGreaterThan(heroEnd);
      expect(metaGrid).toBeGreaterThan(panelStart);
    });
  });

  describe("row-marker legend table (v1.7.11)", () => {
    it("renders the legend as a 3-column <table> (Marker / What it means / What to do)", async () => {
      const outputPath = path.join(tmpDir, "out.html");
      await writeHtml({
        sourceHeader: sampleHeader,
        entries: sampleEntries,
        sources: null,
        outputPath,
      });
      const html = await fs.readFile(outputPath, "utf8");
      expect(html).toMatch(/<table class="row-marker-table">/);
      expect(html).toMatch(/<th[^>]*>Marker<\/th>/);
      expect(html).toMatch(/<th[^>]*>What it means<\/th>/);
      expect(html).toMatch(/<th[^>]*>What to do about it<\/th>/);
    });

    it("has exactly two body rows — one per marker (flagged + image-only)", async () => {
      const outputPath = path.join(tmpDir, "out.html");
      await writeHtml({
        sourceHeader: sampleHeader,
        entries: sampleEntries,
        sources: null,
        outputPath,
      });
      const html = await fs.readFile(outputPath, "utf8");
      // Each row carries a row-marker-swatch in its <th>.
      const swatchHits = html.match(/<span class="row-marker-swatch row-marker-(flagged|imageonly)"/g) || [];
      expect(swatchHits.length).toBe(2);
    });

    it("no longer emits the pre-v1.7.11 .row-marker-row flex paragraphs", async () => {
      const outputPath = path.join(tmpDir, "out.html");
      await writeHtml({
        sourceHeader: sampleHeader,
        entries: sampleEntries,
        sources: null,
        outputPath,
      });
      const html = await fs.readFile(outputPath, "utf8");
      expect(html).not.toMatch(/<p class="row-marker-row"/);
    });
  });

  describe("detail-page sticky bar (v1.7.16: audit-tool link + last-audit date)", () => {
    it("includes a visible 'Audit a PDF' button linking to audit.icjia.app", async () => {
      const outputPath = path.join(tmpDir, "out.html");
      await writeHtml({
        sourceHeader: sampleHeader,
        entries: sampleEntries,
        sources: null,
        outputPath,
        backHref: "index.html",
        csvHref: "site.csv",
      });
      const html = await fs.readFile(outputPath, "utf8");
      expect(html).toMatch(/<a class="audit-tool-link" href="https:\/\/audit\.icjia\.app"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>[\s\S]{0,800}<span>ICJIA PDF Audit Tool<\/span>/);
      // v1.7.28: detail-page sticky bar also carries the FAQ button.
      expect(html).toMatch(/<a class="audit-tool-link" href="https:\/\/accessibility\.icjia\.app"[\s\S]{0,800}<span>ICJIA Accessibility FAQs<\/span>/);
    });

    it("shows the per-site scannedAt date under the CSV download for single-site reports", async () => {
      const outputPath = path.join(tmpDir, "out.html");
      await writeHtml({
        sourceHeader: sampleHeader,
        entries: sampleEntries,
        sources: null,
        outputPath,
        csvHref: "site.csv",
      });
      const html = await fs.readFile(outputPath, "utf8");
      // sampleHeader.metadata.scannedAt is "2026-05-09T12:00:00.000Z" → "May 9, 2026"
      expect(html).toMatch(/<p class="report-csv-date">Last audit: <strong>May 9, 2026<\/strong><\/p>/);
    });
  });

  describe("HTML view excludes csvOnly columns (v1.7.16)", () => {
    it("does NOT render Delete? or Notes columns in the table — those are CSV-only", async () => {
      const outputPath = path.join(tmpDir, "out.html");
      await writeHtml({
        sourceHeader: sampleHeader,
        entries: sampleEntries,
        sources: null,
        outputPath,
      });
      const html = await fs.readFile(outputPath, "utf8");
      expect(html).not.toMatch(/<th[^>]*data-col="deleteFlag"/);
      expect(html).not.toMatch(/<th[^>]*data-col="notes"/);
      expect(html).not.toMatch(/<col data-col="deleteFlag"/);
      expect(html).not.toMatch(/<col data-col="notes"/);
    });
  });

  describe("meta-grid copy-to-clipboard (v1.7.7)", () => {
    it("renders a .meta-copy button next to IP, Hostname, Scanned path, Scanned at, and Public URL", async () => {
      const outputPath = path.join(tmpDir, "out.html");
      const headerWithUrl = {
        ...sampleHeader,
        metadata: { ...sampleHeader.metadata, siteName: "ILFVCC", publicUrlBase: "https://icjia.illinois.gov/ifvcc/" },
      };
      await writeHtml({
        sourceHeader: headerWithUrl,
        entries: sampleEntries,
        sources: null,
        outputPath,
      });
      const html = await fs.readFile(outputPath, "utf8");
      // Exactly 5 copy buttons — one per copyable meta-grid row.
      const buttons = html.match(/<button[^>]*class="meta-copy"/g) || [];
      expect(buttons.length).toBe(5);
    });

    it("the copy button carries the raw value in data-copy (not HTML-escaped display text)", async () => {
      const outputPath = path.join(tmpDir, "out.html");
      await writeHtml({
        sourceHeader: sampleHeader,
        entries: sampleEntries,
        sources: null,
        outputPath,
      });
      const html = await fs.readFile(outputPath, "utf8");
      // data-copy="10.0.0.1" should be the literal serverIp value.
      expect(html).toMatch(/<button[^>]*class="meta-copy"[^>]*data-copy="10\.0\.0\.1"/);
      // Scanned path /uploads
      expect(html).toMatch(/<button[^>]*class="meta-copy"[^>]*data-copy="\/uploads"/);
    });

    it("does NOT render copy buttons next to Website or Server (per user spec)", async () => {
      const outputPath = path.join(tmpDir, "out.html");
      const headerWithSite = {
        ...sampleHeader,
        metadata: { ...sampleHeader.metadata, siteName: "ILFVCC" },
      };
      await writeHtml({
        sourceHeader: headerWithSite,
        entries: sampleEntries,
        sources: null,
        outputPath,
      });
      const html = await fs.readFile(outputPath, "utf8");
      // The Website + Server rows are still rendered as plain <span>, not
      // wrapped in .meta-value with a copy button.
      expect(html).toMatch(/<span class="meta-label">Website:<\/span>\s+<span>ILFVCC<\/span>/);
      expect(html).toMatch(/<span class="meta-label">Server:<\/span>\s+<span>test-server<\/span>/);
    });

    it("uses copyableMetaCell wrapping so the Public URL stays a clickable <a> AND gets a copy button", async () => {
      const outputPath = path.join(tmpDir, "out.html");
      const headerWithUrl = {
        ...sampleHeader,
        metadata: { ...sampleHeader.metadata, publicUrlBase: "https://example.com/uploads" },
      };
      await writeHtml({
        sourceHeader: headerWithUrl,
        entries: sampleEntries,
        sources: null,
        outputPath,
      });
      const html = await fs.readFile(outputPath, "utf8");
      // The link is wrapped in a .meta-value flex container alongside the
      // copy button so both stay on the same row.
      expect(html).toMatch(/<span class="meta-value"><a href="https:\/\/example\.com\/uploads"[^>]*>https:\/\/example\.com\/uploads<\/a><button[^>]*class="meta-copy"[^>]*data-copy="https:\/\/example\.com\/uploads"/);
    });

    it("the clipboard handler IIFE is embedded in the inline <script>", async () => {
      const outputPath = path.join(tmpDir, "out.html");
      await writeHtml({
        sourceHeader: sampleHeader,
        entries: sampleEntries,
        sources: null,
        outputPath,
      });
      const html = await fs.readFile(outputPath, "utf8");
      expect(html).toContain("navigator.clipboard.writeText");
      expect(html).toContain(".meta-copy");
      // The fallback (execCommand copy) is also wired so the buttons still
      // work on file:// loads and very old browsers.
      expect(html).toContain("execCommand");
    });
  });

  describe("Referenced column (v1.8.0)", () => {
    it("includes a 'Referenced' column header", async () => {
      const out = path.join(tmpDir, "ref-header.html");
      await writeHtml({
        sourceHeader: sampleHeader,
        entries: sampleEntries,
        sources: null,
        outputPath: out,
      });
      const html = await fs.readFile(out, "utf8");
      expect(html).toContain(">Page References<");
    });

    it("renders 'No references found' muted chip when entry.references is an empty array", async () => {
      const out = path.join(tmpDir, "ref-empty.html");
      const entries = [{ ...sampleEntries[0], references: [] }];
      await writeHtml({
        sourceHeader: sampleHeader,
        entries,
        sources: null,
        outputPath: out,
      });
      const html = await fs.readFile(out, "utf8");
      expect(html).toContain("No references found");
    });

    it("renders an anchor with target=_blank for each reference", async () => {
      const out = path.join(tmpDir, "ref-anchors.html");
      const entries = [
        {
          ...sampleEntries[0],
          references: [
            {
              pageUrl: "https://icjia.illinois.gov/grants/funding/2020-casa/",
              anchorText: "LINK TO NOFO",
            },
            {
              pageUrl: "https://icjia.illinois.gov/news/something/",
              anchorText: "Press release",
            },
          ],
        },
      ];
      await writeHtml({
        sourceHeader: sampleHeader,
        entries,
        sources: null,
        outputPath: out,
      });
      const html = await fs.readFile(out, "utf8");
      expect(html).toContain(
        'href="https://icjia.illinois.gov/grants/funding/2020-casa/"',
      );
      expect(html).toContain(
        'href="https://icjia.illinois.gov/news/something/"',
      );
      const refAnchors = html.match(
        /<a[^>]*class="ref-link"[^>]*target="_blank"/g,
      );
      expect(refAnchors).not.toBeNull();
      expect(refAnchors.length).toBeGreaterThanOrEqual(2);
    });

    it("labels references as 'Page 1', 'Page 2', ... in order", async () => {
      const out = path.join(tmpDir, "ref-labels.html");
      const entries = [
        {
          ...sampleEntries[0],
          references: [
            { pageUrl: "https://icjia.illinois.gov/a/" },
            { pageUrl: "https://icjia.illinois.gov/b/" },
            { pageUrl: "https://icjia.illinois.gov/c/" },
          ],
        },
      ];
      await writeHtml({
        sourceHeader: sampleHeader,
        entries,
        sources: null,
        outputPath: out,
      });
      const html = await fs.readFile(out, "utf8");
      // Confirm the visible labels are Page 1 / 2 / 3, not the URL itself
      expect(html).toMatch(/>Page 1</);
      expect(html).toMatch(/>Page 2</);
      expect(html).toMatch(/>Page 3</);
    });

    it("puts the full URL in the anchor title attribute so hover reveals destination", async () => {
      const out = path.join(tmpDir, "ref-title.html");
      const entries = [
        {
          ...sampleEntries[0],
          references: [
            { pageUrl: "https://icjia.illinois.gov/grants/funding/2020-casa/" },
          ],
        },
      ];
      await writeHtml({
        sourceHeader: sampleHeader,
        entries,
        sources: null,
        outputPath: out,
      });
      const html = await fs.readFile(out, "utf8");
      expect(html).toContain(
        'title="https://icjia.illinois.gov/grants/funding/2020-casa/"',
      );
    });

    it("emits an empty Referenced cell when entry.references is undefined (cross-ref not run)", async () => {
      const out = path.join(tmpDir, "ref-undef.html");
      // sampleEntries[0] has no references field
      await writeHtml({
        sourceHeader: sampleHeader,
        entries: [sampleEntries[0]],
        sources: null,
        outputPath: out,
      });
      const html = await fs.readFile(out, "utf8");
      // The "No references found" chip should NOT appear (only for empty array)
      expect(html).not.toContain("No references found");
    });

    // 1.8.0-beta.5: references whose pageUrl couldn't be resolved (no
    // contentTypeRoutes mapping, missing slug, unsafe scheme) previously
    // rendered as a red "Page N" chip that looked like a broken link.
    // Replace with explicit "no page URL" text + a tooltip explaining why,
    // so it's obvious the reference exists but isn't clickable.
    it("renders unresolved references as 'no page URL' (not a fake Page N label)", async () => {
      const out = path.join(tmpDir, "ref-unresolved.html");
      const entries = [
        {
          ...sampleEntries[0],
          references: [
            { pageUrl: "https://icjia.illinois.gov/working/page/" },
            { pageUrl: null, siteName: "ilfvcc-api-prod", contentType: "form", entryId: 17 },
          ],
        },
      ];
      await writeHtml({
        sourceHeader: sampleHeader,
        entries,
        sources: null,
        outputPath: out,
      });
      const html = await fs.readFile(out, "utf8");
      // The unresolved chip says what it is, not "Page 2"
      expect(html).toContain("no page URL");
      // The working ref still uses the "Page 1" anchor label
      expect(html).toMatch(/>Page 1</);
      // The unresolved chip is NOT labelled "Page 2"
      const pageTwo = html.match(/>Page 2</);
      expect(pageTwo).toBeNull();
      // The chip carries an informative title attribute
      expect(html).toMatch(/title="[^"]*ilfvcc-api-prod[^"]*form[^"]*#17/);
    });
  });

  describe("Page view (v1.13.0)", () => {
    const refWithAudit = (pageUrl, title, grade, score) => ({
      siteName: "test-server",
      contentType: "meeting",
      entryId: 1,
      pageUrl,
      pageAudit: { score, grade, violationCount: 0, pageTitle: title, reportUrl: "https://audit.icjia.app/page-report/abc" },
    });
    const entriesWithPages = [
      { ...sampleEntries[0], path: "a.pdf", filename: "a.pdf", references: [refWithAudit("https://icjia.illinois.gov/news/meetings/m1/", "Meeting One", "A", 95)] },
      { ...sampleEntries[0], path: "b.pdf", filename: "b.pdf", references: [refWithAudit("https://icjia.illinois.gov/news/meetings/m1/", "Meeting One", "A", 95)] },
      { ...sampleEntries[0], path: "c.pdf", filename: "c.pdf", references: [refWithAudit("https://icjia.illinois.gov/grants/g1/", "Grant One", "D", 61)] },
    ];

    it("renders a File view / Page view toggle, File view active by default", async () => {
      const out = path.join(tmpDir, "toggle.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: entriesWithPages, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toMatch(/<div class="view-toggle"/);
      expect(html).toMatch(/data-view="file"[^>]*aria-pressed="true"/);
      expect(html).toMatch(/data-view="page"/);
    });

    it("renders a #page-view page table with one row per referenced page", async () => {
      const out = path.join(tmpDir, "pageview.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: entriesWithPages, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toMatch(/<div id="page-view"/);
      expect(html).toContain('<table id="page-table"');
      const bodyMatch = html.match(/<tbody id="page-body">([\s\S]*?)<\/tbody>/);
      expect(bodyMatch).not.toBeNull();
      expect((bodyMatch[1].match(/<tr>/g) || []).length).toBe(2);
    });

    it("page rows link to the live page and show the page audit grade", async () => {
      const out = path.join(tmpDir, "pagerow.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: entriesWithPages, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toContain('href="https://icjia.illinois.gov/news/meetings/m1/"');
      expect(html).toContain("Meeting One");
      expect(html).toMatch(/audit-grade audit-grade-a/);
    });

    it("shows the static-site empty-state when no entry has references", async () => {
      const out = path.join(tmpDir, "pageempty.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toMatch(/<div id="page-view"/);
      expect(html).toContain("Page view needs CMS reference data");
    });
  });
});
