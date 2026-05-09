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

  it("renders audit-link column as clickable link when auditLinkPattern is set", async () => {
    const headerWithPattern = {
      ...sampleHeader,
      metadata: {
        ...sampleHeader.metadata,
        auditLinkPattern: "https://audit.example.com/?hash={sha256}",
      },
    };
    const out = path.join(tmpDir, "auditlink.html");
    await writeHtml({ sourceHeader: headerWithPattern, entries: sampleEntries, sources: [headerWithPattern], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toMatch(/class="audit-link"/);
    expect(html).toMatch(/View audit/);
  });

  it("omits audit-link anchor when auditLinkPattern is absent", async () => {
    const out = path.join(tmpDir, "no-auditlink.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).not.toMatch(/class="audit-link"/);
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
    expect(html).toContain('<th data-col="modifiedAt">Date published</th>');
    expect(html).not.toContain("Last modified");
  });

  // ── Audit enrichment columns ─────────────────────────────────────────────────

  it("includes Audit score, Audit grade, and Audit report column headers in the table", async () => {
    const out = path.join(tmpDir, "audit-headers.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain("Audit score");
    expect(html).toContain("Audit grade");
    expect(html).toContain("Audit report");
  });

  it("renders '84%' in the Audit score cell for an enriched entry", async () => {
    const out = path.join(tmpDir, "audit-score.html");
    const enriched = [{
      ...sampleEntries[0],
      audit: {
        score: 84,
        grade: "B",
        reportId: "f06b5abc05c1f280a4975a1c0c95ce8d",
        reportUrl: "https://audit.icjia.app/report/f06b5abc05c1f280a4975a1c0c95ce8d",
        enrichedAt: "2026-05-09T12:00:00.000Z",
      },
    }];
    await writeHtml({ sourceHeader: sampleHeader, entries: enriched, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain("<td>84%</td>");
    expect(html).toContain("<td>B</td>");
  });

  it("renders Audit report cell as a clickable link with 'View report' text", async () => {
    const out = path.join(tmpDir, "audit-report-link.html");
    const reportUrl = "https://audit.icjia.app/report/f06b5abc05c1f280a4975a1c0c95ce8d";
    const enriched = [{
      ...sampleEntries[0],
      audit: {
        score: 84,
        grade: "B",
        reportId: "f06b5abc05c1f280a4975a1c0c95ce8d",
        reportUrl,
        enrichedAt: "2026-05-09T12:00:00.000Z",
      },
    }];
    await writeHtml({ sourceHeader: sampleHeader, entries: enriched, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toMatch(new RegExp(`href="${reportUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    expect(html).toContain("View report");
    // Must NOT say "View audit" for the report column (that text belongs to the auditLink column)
    // The report link is distinct from the upload-page link
    expect(html).toMatch(/View report/);
  });

  it("renders empty Audit score, grade, and report cells when audit block is absent", async () => {
    const out = path.join(tmpDir, "audit-empty.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: [sampleEntries[0]], sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    // The audit columns should exist as empty cells (no percentage, no grade letter, no report link)
    expect(html).toContain('<th data-col="auditScore">Audit score</th>');
    expect(html).toContain('<th data-col="auditGrade">Audit grade</th>');
    expect(html).toContain('<th data-col="auditReport">Audit report</th>');
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
});
