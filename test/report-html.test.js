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
    expect(html).toContain("File location (relative to source folder)");
    expect(html).toContain("Public URL");
    expect(html).not.toContain("<th data-col=\"filename\">filename</th>");
    // Format-specific introspection columns dropped in 1.4.x
    expect(html).not.toContain("Remediation needed?");
    expect(html).not.toContain("PDF: page count");
    expect(html).not.toContain("DOCX:");
    expect(html).not.toContain("XLSX:");
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
    // v1.7.3: th now contains the label plus a column-resize handle span,
    // so the assertion checks the open-tag + label, not the entire <th>...</th>.
    expect(html).toMatch(/<th data-col="modifiedAt">Date published<span class="col-resize-handle"/);
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

  it("emits a <colgroup> with one <col> per CSV column for table-layout: fixed (v1.7.3 column resize)", async () => {
    const outputPath = path.join(tmpDir, "out.html");
    await writeHtml({
      sourceHeader: sampleHeader,
      entries: sampleEntries,
      sources: null,
      outputPath,
    });
    const html = await fs.readFile(outputPath, "utf8");
    expect(html).toMatch(/<colgroup>/);
    // sanity-check three cols at expected positions
    expect(html).toMatch(/<col data-col="serverName" style="width:140px">/);
    expect(html).toMatch(/<col data-col="publicUrl" style="width:300px">/);
    expect(html).toMatch(/<col data-col="filename" style="width:220px">/);
  });

  it("renders a column-resize handle inside every <th> (v1.7.3 column resize)", async () => {
    const outputPath = path.join(tmpDir, "out.html");
    await writeHtml({
      sourceHeader: sampleHeader,
      entries: sampleEntries,
      sources: null,
      outputPath,
    });
    const html = await fs.readFile(outputPath, "utf8");
    // every th has the handle; there are 14 CSV_COLUMNS so there must be 14 handles
    const handles = html.match(/<span class="col-resize-handle"/g) || [];
    expect(handles.length).toBe(14);
  });
});
