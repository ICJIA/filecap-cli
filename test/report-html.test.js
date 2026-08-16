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

  it("includes the server name in the header (IP + scanned path scrubbed — v1.21.2)", async () => {
    const out = path.join(tmpDir, "files.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain("test-server");
    // origin server IP is no longer surfaced anywhere in the report
    expect(html).not.toContain("10.0.0.1");
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

  it("includes summary counts (total inventoried, by category)", async () => {
    const out = path.join(tmpDir, "files.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    // v1.33.0: the four-card summary bar was consolidated — the total now
    // lives once in the breakdown disclosure, and the category list stays.
    expect(html).toContain("Total inventoried:");
    expect(html).toContain("By category");
    expect(html).toMatch(/2/);
  });

  it("renders the trimmed 7-column manager HTML table with human-readable headers", async () => {
    const out = path.join(tmpDir, "labels.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    // v1.20.0: 7 columns — Pages added between File name and File type
    // because vendors quote remediation per page. v1.12.0 used 6.
    expect(html).toContain('<th data-col="filename" scope="col" aria-sort="none"><button type="button" class="th-sort-btn">File name</button></th>');
    expect(html).toContain('<th data-col="pageCount" scope="col" aria-sort="none"><button type="button" class="th-sort-btn">Pages</button></th>');
    expect(html).toContain('<th data-col="category" scope="col" aria-sort="none"><button type="button" class="th-sort-btn">File type</button></th>');
    // v1.39.0: the two placeholder columns carry data-nosort (their row
    // values are "" by design, so they never actually sorted).
    expect(html).toContain('<th data-col="auditScore" scope="col" data-nosort>Audit Report</th>');
    expect(html).toContain('<th data-col="referenced" scope="col" data-nosort>Page References</th>');
    expect(html).toContain('<th data-col="duplicateOf" scope="col" aria-sort="none"><button type="button" class="th-sort-btn">Duplicate of</button></th>');
    expect(html).toContain('<th data-col="modifiedAt" scope="col" aria-sort="none"><button type="button" class="th-sort-btn">Date published</button></th>');
    // Forensic columns are CSV-only — not rendered as HTML table columns.
    for (const col of ["serverName", "serverIp", "publicUrl", "scannedPath", "path", "absolutePath", "extension", "sizeBytes", "sha256"]) {
      expect(html).not.toMatch(new RegExp('<th data-col="' + col + '"'));
    }
    // v1.34.0: eight header cells (was 7) — added Remediation Score.
    const theadMatch = html.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/);
    expect(theadMatch).not.toBeNull();
    expect((theadMatch[1].match(/<th /g) || []).length).toBe(8);
  });

  // v1.19.0 — the file table's Audit Report cell renders only an "Open
  // report" link; the grade chip + numeric score were removed because the
  // audit.icjia.app scoring heuristic is still being refined.
  it("renders the Audit Report cell as an 'Open report' link with no grade chip or score", async () => {
    const out = path.join(tmpDir, "auditcell.html");
    const entries = [{ ...sampleEntries[0], audit: { score: 84, grade: "B", reportUrl: "https://audit.icjia.app/report/abc123" } }];
    await writeHtml({ sourceHeader: sampleHeader, entries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toMatch(/<a class="audit-report-link" href="https:\/\/audit\.icjia\.app\/report\/abc123"[^>]*>Open report<\/a>/);
    expect(html).not.toMatch(/<span class="audit-grade audit-grade-b"/);
    expect(html).not.toContain('<span class="audit-score-num">(84)</span>');
  });

  it("renders the Audit Report cell as 'Unavailable' when the audit errored", async () => {
    const out = path.join(tmpDir, "auditerr.html");
    const entries = [{ ...sampleEntries[0], audit: { error: "HTTP 422" } }];
    await writeHtml({ sourceHeader: sampleHeader, entries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain("Unavailable");
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
    expect(html).toContain("<title>ICJIA Fleet Audit Assessment — DVFR</title>");
  });

  it("sets <title> to server name when siteName is absent", async () => {
    const out = path.join(tmpDir, "title-server.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain("<title>ICJIA Fleet Audit Assessment — test-server</title>");
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
    expect(html).toContain('<th data-col="siteName" scope="col" aria-sort="none"><button type="button" class="th-sort-btn">Website</button></th>');
    const theadMatch = html.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/);
    expect(theadMatch).not.toBeNull();
    // v1.20.0: Website + Filename + Pages + 5 other manager columns = 8.
    // v1.34.0: + Remediation Score = 9.
    expect((theadMatch[1].match(/<th /g) || []).length).toBe(9);
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

  // v1.39.0 — new scans categorize .doc/.xls/.ppt as "legacy-office"; the
  // report renders them with a human label, a filter chip, and counts them
  // into the remediable hero/tooltip numbers.
  it("renders legacy-office entries with a Legacy Office chip and label", async () => {
    const out = path.join(tmpDir, "legacy-chip.html");
    const entries = [
      { ...sampleEntries[0], sha256: "l1", path: "old.ppt", filename: "old.ppt", extension: "ppt", category: "legacy-office", introspection: { kind: "office-legacy", format: "ppt" } },
      { ...sampleEntries[0], sha256: "l2", path: "old2.ppt", filename: "old2.ppt", extension: "ppt", category: "legacy-office", introspection: { kind: "office-legacy", format: "ppt" } },
    ];
    await writeHtml({ sourceHeader: sampleHeader, entries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    // Type filter chip with the human label + count
    expect(html).toMatch(/<button class="chip" data-category="legacy-office">Legacy Office \(2\)<\/button>/);
    // Category cell uses the label, not the raw slug
    expect(html).toContain("<td>Legacy Office</td>");
    // Both files count as remediable in the primary filter bar
    expect(html).toMatch(/data-filter="remediable">Remediable only \(2\)/);
    // Hero tooltip's legacy line carries the count
    expect(html).toMatch(/legacy Office×\d+ \(2\)/);
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

  it("ships row values once — no filecap-data blob; sort/search project from the DOM (v1.40.0)", async () => {
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
    // v1.40.0 — the 481KB-per-big-page values blob is gone; the client
    // projects sort/search values from the rendered cells + data-search.
    expect(html).not.toMatch(/id="filecap-data"/);
    expect(html).toContain("td.dataset.num || td.textContent.trim()");
    expect(html).toContain("row.dataset.search");
  });

  // v1.39.0 (D1) — the embedded sort comparator must only compare
  // numerically when BOTH values are fully numeric. parseFloat("2025-06-15")
  // is 2025, so every same-year ISO date (and "2023_Budget.pdf"-style
  // filename) used to compare as equal and never actually sort. These tests
  // extract and execute the shipped script text.
  describe("embedded sort comparator (v1.39.0)", () => {
    async function extractSorter() {
      const out = path.join(tmpDir, "sortfn.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      const m = html.match(/pairs\.sort\(function \(a, b\) \{\n([\s\S]*?)\n {4}\}\);/);
      expect(m).not.toBeNull();
      const cmp = new Function("a", "b", "colIdx", "asc", m[1]);
      return (values, asc) =>
        values
          .map((v) => ({ vals: [v] }))
          .sort((a, b) => cmp(a, b, 0, asc))
          .map((p) => p.vals[0]);
    }

    it("sorts ISO dates chronologically in both directions", async () => {
      const sortVals = await extractSorter();
      const dates = ["2025-01-02T00:00:00.000Z", "2025-11-30T00:00:00.000Z", "2025-06-15T00:00:00.000Z"];
      expect(sortVals(dates, true)).toEqual([
        "2025-01-02T00:00:00.000Z",
        "2025-06-15T00:00:00.000Z",
        "2025-11-30T00:00:00.000Z",
      ]);
      expect(sortVals(dates, false)).toEqual([
        "2025-11-30T00:00:00.000Z",
        "2025-06-15T00:00:00.000Z",
        "2025-01-02T00:00:00.000Z",
      ]);
    });

    it("sorts filenames with a shared numeric prefix lexicographically", async () => {
      const sortVals = await extractSorter();
      expect(sortVals(["2023_Budget.pdf", "2023_Annual.pdf"], true)).toEqual([
        "2023_Annual.pdf",
        "2023_Budget.pdf",
      ]);
    });

    it("still sorts a fully numeric column numerically", async () => {
      const sortVals = await extractSorter();
      expect(sortVals([3, 12, 5], true)).toEqual([3, 5, 12]);
      expect(sortVals(["3", "12", "5"], true)).toEqual(["3", "5", "12"]);
    });

    it("tolerates null/empty cells (sorted before non-empty strings)", async () => {
      const sortVals = await extractSorter();
      expect(sortVals([null, "2025-06-15", ""], true)).toEqual([null, "", "2025-06-15"]);
    });
  });

  // v1.39.0 (D11) — the Page References and Audit Report columns render
  // their cells directly; their embedded row values are "" placeholders, so
  // clicking their headers could never sort anything. They must not offer
  // the sortable affordance.
  describe("client-side remediable set is generated from the canonical one (v1.40.0)", () => {
    it("emits the scanner's REMEDIABLE_CATEGORIES as JSON — no hand-kept copy", async () => {
      const out = path.join(tmpDir, "remediable-cats.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toContain('const REMEDIABLE_CATS = ["pdf","office-document","spreadsheet","presentation","legacy-office"];');
    });
  });

  describe("table sort keyboard accessibility + live status (v1.40.0)", () => {
    it("wraps sortable headers in real buttons and tracks aria-sort", async () => {
      const out = path.join(tmpDir, "sort-a11y.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toContain('class="th-sort-btn"');
      expect(html).toContain('setAttribute("aria-sort"');
      // the ::after sort arrows must still key off the th classes
      expect(html).toContain("thead th.sort-asc::after");
    });

    it("announces filter/pagination changes via polite live regions", async () => {
      const out = path.join(tmpDir, "live-status.html");
      // references on an entry make the Page view (and its paginator) render too
      const entries = [{
        ...sampleEntries[0],
        references: [{ siteName: "test-server", contentType: "meeting", entryId: 1, pageUrl: "https://example.org/p1/" }],
      }];
      await writeHtml({ sourceHeader: sampleHeader, entries, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toContain('<span class="pag-info" id="page-info" role="status" aria-live="polite">');
      expect(html).toContain('<span class="pag-info" id="pv-page-info" role="status" aria-live="polite">');
    });

    it("gives the header buttons a keyboard focus style", async () => {
      const out = path.join(tmpDir, "sort-focus.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toMatch(/\.th-sort-btn:focus-visible \{[^}]*outline/);
    });
  });

  describe("website-accessibility section wiring (v1.40.0)", () => {
    const siteAudit = {
      score: 82, grade: "B",
      coverage: { scored: 40, pagesInSet: 44, capped: 2, errored: 2 },
      outstanding: { total: 9, bySeverity: { critical: 1, serious: 3, moderate: 4, minor: 1 }, byWcag: { A: 2, AA: 5, AAA: 1, bestPractice: 1 }, needsReview: 6 },
      trend: { fixed: 4, new: 1, stillOpen: 8 },
      pages: [{ url: "https://example.org/a", score: 61, grade: "D", violationCount: 5, needsReview: 2, reportUrl: "https://audit.icjia.app/r/1" }],
    };

    it("renders the SiteImprove-depth section when site-audit data exists", async () => {
      const out = path.join(tmpDir, "sa-yes.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out, siteAudit });
      const html = await fs.readFile(out, "utf8");
      expect(html).toContain('<h2 id="sa-heading">Website accessibility</h2>');
      expect(html).toContain("This is the website&#39;s score &mdash; not its documents&#39;.".replace("&mdash;", "—"));
      expect(html).toMatch(/<span class="sa-num">82<\/span><span class="sa-grade">B<\/span>/);
      expect(html).toContain("Scored <strong>40</strong> of 44 pages (2 not yet reached this run), 2 errored.");
      expect(html).toContain("<strong>4 fixed</strong>");
      expect(html).toContain("https://example.org/a");
    });

    it("renders nothing when the site has no site-audit data", async () => {
      const out = path.join(tmpDir, "sa-no.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).not.toContain("Website accessibility");
    });
  });

  describe("thin-data file-accessibility banner caption (v1.40.0)", () => {
    it("explains WHY there is no score instead of a bare (n / N) ratio", async () => {
      const out = path.join(tmpDir, "thin-a11y.html");
      const entries = [
        { ...sampleEntries[0], audit: { score: 88, grade: "B" } },
        sampleEntries[1],
      ];
      await writeHtml({ sourceHeader: sampleHeader, entries, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toContain("Only 1 of 2 PDFs scored so far — too few for a reliable score (needs 5).");
      expect(html).not.toContain("Not enough scored PDFs yet");
    });
  });

  describe("placeholder columns are not sortable (v1.39.0)", () => {
    it("marks Page References and Audit Report headers data-nosort; others stay sortable", async () => {
      const out = path.join(tmpDir, "nosort.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toContain('<th data-col="referenced" scope="col" data-nosort>Page References</th>');
      expect(html).toContain('<th data-col="auditScore" scope="col" data-nosort>Audit Report</th>');
      expect(html).toContain('<th data-col="filename" scope="col" aria-sort="none"><button type="button" class="th-sort-btn">File name</button></th>');
      expect(html).toContain('<th data-col="modifiedAt" scope="col" aria-sort="none"><button type="button" class="th-sort-btn">Date published</button></th>');
    });

    it("skips wiring a click handler for data-nosort headers", async () => {
      const out = path.join(tmpDir, "nosort-script.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toContain('if (th.hasAttribute("data-nosort")) return;');
    });

    it("removes the pointer cursor from non-sortable headers", async () => {
      const out = path.join(tmpDir, "nosort-css.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toContain("thead th[data-nosort] { cursor: default; }");
    });
  });

  // v1.39.0 (D4) — the search box promises "Filter by filename, path,
  // server…" but the embedded row data was projected onto the visible
  // columns only, which exclude path and serverName. The searchable arrays
  // now carry path (and serverName on consolidated reports) as trailing
  // hidden values. These tests run the shipped search predicate over the
  // shipped embedded data.
  describe("file-table search haystack (v1.39.0)", () => {
    it("matches on path segments that are not part of the filename", async () => {
      const out = path.join(tmpDir, "search-path.html");
      const entries = [
        { ...sampleEntries[0], path: "uploads/2019/report-x.pdf", filename: "report-x.pdf" },
        { ...sampleEntries[1] },
      ];
      await writeHtml({ sourceHeader: sampleHeader, entries, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      // v1.40.0 — the haystack extras ride the row itself now: data-search
      // carries path (and serverName on consolidated reports), the client
      // projection appends row.dataset.search, and the predicate is unchanged.
      expect(html).toMatch(/<tr[^>]*data-search="[^"]*uploads\/2019\/report-x\.pdf[^"]*"/);
      expect(html).toContain("if (row.dataset.search) vals.push(row.dataset.search);");
      expect(html).toContain("String(v).toLowerCase().indexOf(q) >= 0");
    });

    it("matches on serverName in a consolidated report", async () => {
      const consolidatedHeader = {
        schemaVersion: 1,
        kind: "filecap-consolidated-header",
        metadata: { consolidatedAt: "2026-05-09T12:00:00.000Z", sources: [] },
      };
      const sources = [
        { serverName: "srv-alpha-01", metadata: { ...sampleHeader.metadata, serverName: "srv-alpha-01", siteName: "Alpha" } },
        { serverName: "srv-beta-02", metadata: { ...sampleHeader.metadata, serverName: "srv-beta-02", siteName: "Beta" } },
      ];
      const entries = [
        { ...sampleEntries[0], serverName: "srv-alpha-01" },
        { ...sampleEntries[1], serverName: "srv-beta-02" },
      ];
      const out = path.join(tmpDir, "search-server.html");
      await writeHtml({ sourceHeader: consolidatedHeader, entries, sources, outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toMatch(/<tr[^>]*data-search="[^"]*srv-alpha-01[^"]*"/);
    });

    it("escapes hostile path values inside data-search", async () => {
      const out = path.join(tmpDir, "search-hostile.html");
      const entries = [{ ...sampleEntries[0], path: 'up"loads/<img src=x>/a.pdf' }];
      await writeHtml({ sourceHeader: sampleHeader, entries, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toContain("data-search=\"up&quot;loads/&lt;img src=x&gt;/a.pdf\"");
    });

    it("keeps the placeholder text accurate", async () => {
      const out = path.join(tmpDir, "search-placeholder.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toContain('placeholder="Filter by filename, path, server…"');
    });
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
    expect(html).toContain('<th data-col="modifiedAt" scope="col" aria-sort="none"><button type="button" class="th-sort-btn">Date published</button></th>');
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

  it("a malicious hostname cannot inject — hostname no longer rendered (FC-2026-008 / v1.21.2)", async () => {
    const xssPayload = "<img src=x onerror=alert(1)>";
    const headerWithXss = {
      ...sampleHeader,
      metadata: { ...sampleHeader.metadata, hostname: xssPayload },
    };
    const out = path.join(tmpDir, "xss-hostname.html");
    await writeHtml({ sourceHeader: headerWithXss, entries: [], sources: [headerWithXss], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    // v1.21.2 — hostname is no longer surfaced, so the raw payload can't appear
    // and the injection vector is removed entirely.
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
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
    expect(html).toMatch(/<h1[^>]*>ICJIA inventory report<\/h1>/);
  });

  it("renders the work-first dp-hero block (headline count + proportion ring + metaline)", async () => {
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
    // v1.33.0: the hero leads with the actionable workload — the remediable
    // count (sampleEntries has 2 remediable PDFs) — not a total-files tile.
    expect(html).toMatch(/<span class="dp-headline-num">2<\/span>/);
    expect(html).toContain("files may need audit work");
    // The big two-up tiles + large donut are gone.
    expect(html).not.toContain('class="dp-tile dp-total"');
    expect(html).not.toContain('class="dp-donut"');
    // A small proportion ring carries the percentage (2 of 2 remediable -> 100%)
    expect(html).toMatch(/<div class="dp-ring" style="--pct:100%/);
    expect(html).toMatch(/<div class="dp-ring-pct">100%/);
    // The inventory totals collapse to a single quiet metaline.
    expect(html).toMatch(/<p class="dp-metaline">/);
    // The full title appears in the h1
    expect(html).toMatch(/<h1[^>]*>Domestic Violence Fatality Review<\/h1>/);
  });

  describe("v1.33.0 density redesign", () => {
    it("collapses the file-type breakdown into a Breakdown <details> (closed by default)", async () => {
      const out = path.join(tmpDir, "breakdown.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: null, outputPath: out });
      const html = await fs.readFile(out, "utf8");
      // The two stat cards now live inside a collapsed disclosure, not stacked
      // open above the table.
      expect(html).toMatch(/<details class="dp-disclosure dp-breakdown">/);
      // Closed on load — the opening tag carries no `open` attribute.
      expect(html).not.toMatch(/<details class="dp-disclosure dp-breakdown"[^>]*\bopen\b/);
      // All the data is still present, one click away.
      expect(html).toContain('class="stat-card remediable"');
      expect(html).toContain("By category");
    });

    it("moves site metadata into a collapsed Site details <details>", async () => {
      const out = path.join(tmpDir, "sitedetails.html");
      const header = { ...sampleHeader, metadata: { ...sampleHeader.metadata, siteName: "DVFR" } };
      await writeHtml({ sourceHeader: header, entries: sampleEntries, sources: null, outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toMatch(/<details class="dp-disclosure dp-sitedetails">/);
      // The meta-grid (with the Website row) is retained inside it.
      expect(html).toContain('<div class="meta-grid">');
      expect(html).toContain("Website:");
    });

    it("collapses the row-marker legend into a <details> with a summary", async () => {
      const out = path.join(tmpDir, "legend.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: null, outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toMatch(/<details class="row-marker-legend"/);
      expect(html).toMatch(/<summary class="row-marker-summary">/);
      // The 3-column key itself is unchanged inside the disclosure.
      expect(html).toMatch(/<table class="row-marker-table">/);
      // The old always-open <aside> + <h3> wrapper is gone.
      expect(html).not.toMatch(/<aside class="row-marker-legend"/);
    });

    it("drops the always-on four-card summary bar and the audit-total line", async () => {
      const out = path.join(tmpDir, "nosummary.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: null, outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).not.toContain('class="summary-bar"');
      expect(html).not.toContain('<div class="audit-total">');
    });

    it("puts the File/Page view toggle beside one shared inventory heading", async () => {
      const out = path.join(tmpDir, "invheader.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: null, outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toMatch(/<div class="inv-header">/);
      expect(html).toMatch(/<h2 id="dp-inv-heading">File inventory<\/h2>/);
      // The toggle JS swaps that single heading instead of two competing h2s.
      expect(html).toContain('document.getElementById("dp-inv-heading")');
    });
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

  // v1.39.0 (D5) — the download button's label follows the href instead of
  // always claiming XLSX (standalone reports link the sibling .csv).
  describe("download button honesty (v1.39.0)", () => {
    it("labels a .csv href 'Download CSV'", async () => {
      const out = path.join(tmpDir, "dl-csv.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: null, outputPath: out, csvHref: "audit-file-list.csv" });
      const html = await fs.readFile(out, "utf8");
      expect(html).toContain("Download CSV");
      expect(html).not.toContain("Download spreadsheet (XLSX)");
    });

    it("labels an .xlsx href 'Download spreadsheet (XLSX)'", async () => {
      const out = path.join(tmpDir, "dl-xlsx.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: null, outputPath: out, csvHref: "audit.xlsx" });
      const html = await fs.readFile(out, "utf8");
      expect(html).toContain("Download spreadsheet (XLSX)");
      expect(html).not.toContain("Download CSV");
    });

    it("omits the download button entirely when csvHref is null (Interface Contract 6)", async () => {
      const out = path.join(tmpDir, "dl-null.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: null, outputPath: out, csvHref: null });
      const html = await fs.readFile(out, "utf8");
      // The CSS class definitions remain in the stylesheet; the rendered
      // anchor/block must not.
      expect(html).not.toContain('<a class="report-csv-link"');
      expect(html).not.toContain('<div class="report-csv-block">');
      expect(html).not.toContain("Download CSV");
      expect(html).not.toContain("Download spreadsheet (XLSX)");
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
      // v1.44.0 — label renamed "ICJIA PDF Audit Tool" → "File Audit Tool".
      expect(html).toMatch(/<a class="audit-tool-link" href="https:\/\/audit\.icjia\.app"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>[\s\S]{0,800}<span>File Audit Tool<\/span>/);
      expect(html).not.toContain("PDF Audit Tool");
      // v1.7.28: detail-page sticky bar also carries the FAQ button.
      expect(html).toMatch(/<a class="audit-tool-link" href="https:\/\/accessibility\.icjia\.app"[\s\S]{0,800}<span>ICJIA Accessibility FAQs<\/span>/);
    });

    // v1.44.0 — bundle pages carry a What's New button in the sticky bar; a
    // standalone report (no backHref → not part of a bundle) must not grow a
    // nav button to a page that does not exist next to it. (The shared footer
    // links whats-new.html unconditionally — same as its existing Home/Sites
    // links, which also assume the bundle.)
    it("shows the What's New nav button only when part of a bundle (backHref set)", async () => {
      const inBundle = path.join(tmpDir, "bundled.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: null, outputPath: inBundle, backHref: "index.html" });
      expect(await fs.readFile(inBundle, "utf8")).toContain('class="audit-tool-link nav-whats-new"');

      const standalone = path.join(tmpDir, "standalone.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: null, outputPath: standalone });
      expect(await fs.readFile(standalone, "utf8")).not.toContain('class="audit-tool-link nav-whats-new"');
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
    it("renders a .meta-copy button next to the copyable meta-grid rows (Scanned at + Public URL)", async () => {
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
      // v1.21.2 — IP/Hostname/Scanned-path rows removed; only Scanned at +
      // Public URL remain copyable.
      const buttons = html.match(/<button[^>]*class="meta-copy"/g) || [];
      expect(buttons.length).toBe(2);
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
      // v1.21.2 — IP + scanned path are no longer copyable; the scanned-at
      // timestamp still carries its raw value in a copy button.
      expect(html).not.toMatch(/data-copy="10\.0\.0\.1"/);
      expect(html).toMatch(/<button[^>]*class="meta-copy"[^>]*data-copy="[^"]+"/);
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

    it("page rows show the page URL as the link text", async () => {
      const out = path.join(tmpDir, "pagerow.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: entriesWithPages, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      // The first column links to the page and shows the URL itself as the
      // link text — not the CMS <title>, which is often the generic site
      // name and renders identically on every row.
      expect(html).toMatch(
        /<a href="https:\/\/icjia\.illinois\.gov\/news\/meetings\/m1\/"[^>]*>https:\/\/icjia\.illinois\.gov\/news\/meetings\/m1\/<\/a>/,
      );
      expect(html).not.toContain("Meeting One");
      // v1.20.x: the Page Audit Score column was removed — its "Open report"
      // links 404'd — so the page table no longer renders that header or the
      // per-page grade chip.
      expect(html).not.toContain("Page Audit Score");
    });

    it("shows the static-site empty-state when no entry has references", async () => {
      const out = path.join(tmpDir, "pageempty.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toMatch(/<div id="page-view"/);
      expect(html).toContain("Page view needs CMS reference data");
    });

    it("merges sitemap-only URLs into the page table as extra rows (1.14.0)", async () => {
      const out = path.join(tmpDir, "pagesitemap.html");
      await writeHtml({
        sourceHeader: sampleHeader,
        entries: entriesWithPages,
        sources: [sampleHeader],
        outputPath: out,
        sitemapUrls: [
          "https://icjia.illinois.gov/news/meetings/m1/",
          "https://icjia.illinois.gov/about/standalone/",
        ],
      });
      const html = await fs.readFile(out, "utf8");
      expect(html).toContain('href="https://icjia.illinois.gov/about/standalone/"');
      const bodyMatch = html.match(/<tbody id="page-body">([\s\S]*?)<\/tbody>/);
      // 2 derived pages (m1, g1) + 1 sitemap-only (standalone); m1 de-dupes
      expect((bodyMatch[1].match(/<tr>/g) || []).length).toBe(3);
    });

    it("merges CMS pages into the page table as fromCms rows with content type (1.14.x)", async () => {
      const out = path.join(tmpDir, "pagecms.html");
      await writeHtml({
        sourceHeader: sampleHeader,
        entries: entriesWithPages,
        sources: [sampleHeader],
        outputPath: out,
        cmsPages: [
          { pageUrl: "https://icjia.illinois.gov/news/meetings/m1/", contentType: "meeting" },
          { pageUrl: "https://icjia.illinois.gov/policies/p1/", contentType: "policy" },
        ],
      });
      const html = await fs.readFile(out, "utf8");
      expect(html).toContain('href="https://icjia.illinois.gov/policies/p1/"');
      expect(html).toContain('class="page-cms-tag"');
      expect(html).toContain("<td>policy</td>");
      const bodyMatch = html.match(/<tbody id="page-body">([\s\S]*?)<\/tbody>/);
      // 2 derived (m1, g1) + 1 cms-only (p1); m1 de-dupes against the derived page
      expect((bodyMatch[1].match(/<tr>/g) || []).length).toBe(3);
    });
  });

  describe("accessibility structure (v1.x)", () => {
    it("includes a favicon link so the page does not 404 on /favicon.ico", async () => {
      const out = path.join(tmpDir, "favicon.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toMatch(/<link[^>]*rel="icon"/);
    });

    it("wraps the report body in exactly one <main> landmark", async () => {
      const out = path.join(tmpDir, "main.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect((html.match(/<main\b/g) || []).length).toBe(1);
      expect(html).toContain("</main>");
    });

    it("the report footer links to the /accessibility page", async () => {
      const out = path.join(tmpDir, "axfooter.html");
      await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
      const html = await fs.readFile(out, "utf8");
      expect(html).toMatch(/<a href="accessibility\.html"[^>]*>Accessibility<\/a>/);
    });
  });
});

describe("meta description (v1.40.0)", () => {
  it("ships a description naming the site on detail pages", async () => {
    const os = await import("node:os");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-meta-"));
    const out = path.join(dir, "meta.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out, siteFullName: "Example Site" });
    const html = await fs.readFile(out, "utf8");
    expect(html).toMatch(/<meta name="description" content="[^"]*Example Site[^"]*"/);
  });
});
