import { describe, it, expect } from "vitest";
import { writeSummary, buildAuditScopeBlock } from "../src/report/summary.js";

const singleHeader = {
  schemaVersion: 1,
  kind: "filecap-inventory-header",
  metadata: {
    serverName: "prod-01",
    hostname: "prod-01.example.com",
    serverIp: "10.0.0.1",
    scannedPath: "/var/uploads",
    scannedAt: "2026-05-09T12:00:00.000Z",
    filecapVersion: "1.0.2",
    nodeVersion: "v20.18.0",
    options: { introspect: true, hash: true, maxIntrospectMb: 200, concurrency: 4 },
  },
};

const makeEntries = () => [
  {
    category: "pdf",
    remediable: true,
    sizeBytes: 1000,
    sha256: "aaa",
    flags: ["scanned-name-pattern"],
    introspection: { kind: "pdf", isImageOnly: true, pageCount: 1, hasTextLayer: false, hasTags: false, hasFormFields: false, hasSignatures: false, encrypted: false },
  },
  {
    category: "pdf",
    remediable: true,
    sizeBytes: 2000,
    sha256: "bbb",
    flags: [],
    introspection: { kind: "pdf", pageCount: 5, hasTextLayer: true, isImageOnly: false, hasTags: true, hasFormFields: false, hasSignatures: false, encrypted: false },
  },
  {
    category: "office-document",
    remediable: true,
    sizeBytes: 1500,
    sha256: "ccc",
    flags: [],
    introspection: { kind: "docx", hasHeadings: false, imageCount: 2, tableCount: 1, hyperlinkCount: 3, vagueLinkCount: 1, altTextCoverage: 0.5, tablesHaveHeaders: false, wordCount: 500, paragraphCount: 10, headingLevelsUsed: [] },
  },
  {
    category: "spreadsheet",
    remediable: true,
    sizeBytes: 800,
    sha256: "ddd",
    flags: [],
    introspection: { kind: "xlsx", sheetCount: 2, sheetNames: ["Sheet1", "Data"], defaultSheetNameCount: 1, hasHeaderRows: true, mergedCellCount: 0, hasCharts: false, hasImages: false },
  },
  {
    category: "image",
    remediable: false,
    sizeBytes: 500,
    sha256: "eee",
    flags: [],
  },
  {
    category: "office-document",
    remediable: true,
    sizeBytes: 3000,
    sha256: "fff",
    flags: [],
    introspection: { kind: "office-legacy", format: "doc" },
  },
];

describe("writeSummary — single-server", () => {
  it("contains all required sections", () => {
    const text = writeSummary({ entries: makeEntries(), sources: null, header: singleHeader });
    expect(text).toContain("ICJIA Fleet Audit Assessment — audit summary");
    expect(text).toContain("Server:           prod-01 (10.0.0.1)");
    expect(text).toContain("Source location:  /var/uploads");
    expect(text).toContain("The numbers");
    expect(text).toContain("Total files:                6");
    expect(text).toContain("Files that may need remediation:");
    expect(text).toContain("PDFs (2 files)");
    expect(text).toContain("Word documents");
    expect(text).toContain("Excel files");
    expect(text).toContain("Legacy Office files");
    expect(text).toContain("By file type");
    expect(text).toContain("Filename quality");
    expect(text).toContain("Largest files");
    expect(text).toContain("What this means");
  });

  it("empty categories say None in this audit", () => {
    const entries = [
      { category: "image", remediable: false, sizeBytes: 100, sha256: "x", flags: [] },
    ];
    const text = writeSummary({ entries, sources: null, header: singleHeader });
    expect(text).toContain("PDFs (0 files)");
    expect(text).toMatch(/None in this audit/);
  });

  it("What this means bullets adapt to the data", () => {
    const text = writeSummary({ entries: makeEntries(), sources: null, header: singleHeader });
    expect(text).toMatch(/image-only.*OCR/);
    expect(text).toMatch(/No PDFs are tagged|lack structural tags/);
    expect(text).toMatch(/heading styles/);
    expect(text).toMatch(/vague hyperlink/);
    expect(text).toMatch(/legacy Office/i);
  });
});

describe("writeSummary — siteName", () => {
  it("shows 'Website: DVFR' at top when siteName is set in single-server header", () => {
    const headerWithSite = {
      ...singleHeader,
      metadata: { ...singleHeader.metadata, siteName: "DVFR" },
    };
    const text = writeSummary({ entries: makeEntries(), sources: null, header: headerWithSite });
    expect(text).toContain("Website:          DVFR");
    // Website line should appear before Server line
    const websiteIdx = text.indexOf("Website:");
    const serverIdx = text.indexOf("Server:");
    expect(websiteIdx).toBeLessThan(serverIdx);
  });

  it("omits Website line when siteName is not set", () => {
    const text = writeSummary({ entries: makeEntries(), sources: null, header: singleHeader });
    expect(text).not.toContain("Website:");
  });
});

describe("writeSummary — fleet consolidated", () => {
  it("contains per-server breakdown section", () => {
    const consolidatedHeader = {
      schemaVersion: 1,
      kind: "filecap-consolidated-header",
      metadata: {
        consolidatedAt: "2026-05-09T12:00:00.000Z",
        filecapVersion: "1.0.2",
        nodeVersion: "v20.18.0",
        sources: [
          {
            serverName: "srv-a",
            hostname: "srv-a.example.com",
            serverIp: "10.0.0.1",
            scannedPath: "/uploads",
            scannedAt: "2026-05-09T12:00:00.000Z",
            filecapVersion: "1.0.2",
            nodeVersion: "v20.18.0",
            options: { introspect: true, hash: true, maxIntrospectMb: 200, concurrency: 4 },
            stats: { fileCount: 2, totalBytes: 3000, scanDurationMs: 100, introspectionFailures: 0, permissionDenials: 0 },
          },
          {
            serverName: "srv-b",
            hostname: "srv-b.example.com",
            serverIp: "10.0.0.2",
            scannedPath: "/var/www",
            scannedAt: "2026-05-09T12:01:00.000Z",
            filecapVersion: "1.0.2",
            nodeVersion: "v20.18.0",
            options: { introspect: true, hash: true, maxIntrospectMb: 200, concurrency: 4 },
            stats: { fileCount: 1, totalBytes: 1000, scanDurationMs: 50, introspectionFailures: 0, permissionDenials: 0 },
          },
        ],
      },
    };

    const entries = [
      { serverName: "srv-a", category: "pdf", remediable: true, sizeBytes: 1000, sha256: "p1", flags: [], introspection: { kind: "pdf", pageCount: 2, hasTextLayer: true, isImageOnly: false, hasTags: false, hasFormFields: false, hasSignatures: false, encrypted: false } },
      { serverName: "srv-a", category: "pdf", remediable: true, sizeBytes: 2000, sha256: "p2", flags: [], introspection: { kind: "pdf", pageCount: 1, hasTextLayer: false, isImageOnly: true, hasTags: false, hasFormFields: false, hasSignatures: false, encrypted: false } },
      { serverName: "srv-b", category: "image", remediable: false, sizeBytes: 1000, sha256: "i1", flags: [] },
    ];

    const text = writeSummary({
      entries,
      sources: consolidatedHeader.metadata.sources,
      header: consolidatedHeader,
    });

    expect(text).toContain("Per-server breakdown");
    expect(text).toContain("Fleet totals");
    expect(text).toContain("srv-a");
    expect(text).toContain("srv-b");
    expect(text).toContain("Servers audited:  2");
  });

  it("per-server breakdown has Site column header", () => {
    const consolidatedHeader = {
      schemaVersion: 1,
      kind: "filecap-consolidated-header",
      metadata: {
        consolidatedAt: "2026-05-09T12:00:00.000Z",
        filecapVersion: "1.0.3",
        nodeVersion: "v20.18.0",
        sources: [
          {
            siteName: "DVFR",
            serverName: "srv-a",
            hostname: "srv-a.example.com",
            serverIp: "10.0.0.1",
            scannedPath: "/uploads",
            scannedAt: "2026-05-09T12:00:00.000Z",
            filecapVersion: "1.0.3",
            nodeVersion: "v20.18.0",
            options: { introspect: true, hash: true, maxIntrospectMb: 200, concurrency: 4 },
            stats: { fileCount: 1, totalBytes: 1000, scanDurationMs: 50, introspectionFailures: 0, permissionDenials: 0 },
          },
          {
            serverName: "srv-b",
            hostname: "srv-b.example.com",
            serverIp: "10.0.0.2",
            scannedPath: "/var/www",
            scannedAt: "2026-05-09T12:01:00.000Z",
            filecapVersion: "1.0.3",
            nodeVersion: "v20.18.0",
            options: { introspect: true, hash: true, maxIntrospectMb: 200, concurrency: 4 },
            stats: { fileCount: 1, totalBytes: 1000, scanDurationMs: 50, introspectionFailures: 0, permissionDenials: 0 },
          },
        ],
      },
    };
    const entries = [
      { serverName: "srv-a", category: "pdf", remediable: true, sizeBytes: 1000, sha256: "p1", flags: [] },
      { serverName: "srv-b", category: "image", remediable: false, sizeBytes: 1000, sha256: "i1", flags: [] },
    ];
    const text = writeSummary({ entries, sources: consolidatedHeader.metadata.sources, header: consolidatedHeader });
    expect(text).toContain("Site");
    expect(text).toContain("DVFR");
  });
});

// ── buildAuditScopeBlock ─────────────────────────────────────────────────────

// 5 remediable (3 pdf + 2 office-doc), 3 non-remediable (2 image + 1 other)
// Intentionally no spreadsheet, presentation, or legacy-office entries
// so those rows must still appear with count 0 (zero-row suppression check)
const scopeEntries = [
  // remediable
  { category: "pdf", remediable: true, sizeBytes: 100 },
  { category: "pdf", remediable: true, sizeBytes: 200 },
  { category: "pdf", remediable: true, sizeBytes: 300 },
  { category: "office-document", remediable: true, sizeBytes: 150 },
  { category: "office-document", remediable: true, sizeBytes: 250 },
  // non-remediable
  { category: "image", remediable: false, sizeBytes: 80 },
  { category: "image", remediable: false, sizeBytes: 90 },
  { category: "other", remediable: false, sizeBytes: 10 },
];

describe("buildAuditScopeBlock", () => {
  it("shows the correct remediable count in AUDIT SCOPE heading", () => {
    const text = buildAuditScopeBlock(scopeEntries);
    // 3 pdf + 2 office-doc = 5
    expect(text).toMatch(/AUDIT SCOPE.*5/);
  });

  it("shows the correct non-remediable count in OTHER FILES heading", () => {
    const text = buildAuditScopeBlock(scopeEntries);
    // 2 image + 1 other = 3
    expect(text).toMatch(/OTHER FILES.*3/);
  });

  it("remediable + non-remediable equals total entries", () => {
    const text = buildAuditScopeBlock(scopeEntries);
    // Extract count from "Total that may need work:" line (v1.7.8 softened)
    const needingMatch = text.match(/Total that may need work:\s+(\d+)/);
    const nonRemMatch  = text.match(/Total non-remediation:\s+(\d+)/);
    expect(needingMatch).not.toBeNull();
    expect(nonRemMatch).not.toBeNull();
    const needing = parseInt(needingMatch[1], 10);
    const nonRem  = parseInt(nonRemMatch[1], 10);
    expect(needing + nonRem).toBe(scopeEntries.length);
  });

  it("contains the THIS IS THE AUDIT WORKLOAD annotation", () => {
    const text = buildAuditScopeBlock(scopeEntries);
    expect(text).toContain("← THIS IS THE AUDIT WORKLOAD");
  });

  it("shows zero counts for categories with no entries (zero rows are never omitted)", () => {
    const text = buildAuditScopeBlock(scopeEntries);
    // No presentations or legacy-office in scopeEntries — rows must still appear with 0
    expect(text).toMatch(/PowerPoint.*0/);
    expect(text).toMatch(/Legacy Office.*0/);
    expect(text).toMatch(/Excel files.*0/);
    // Text files also absent — still shown
    expect(text).toMatch(/Text files.*0/);
  });

  it("writeSummary includes AUDIT SCOPE block before the per-server breakdown", () => {
    const text = writeSummary({ entries: scopeEntries, sources: null, header: singleHeader });
    expect(text).toContain("AUDIT SCOPE");
    expect(text).toContain("OTHER FILES");
    expect(text).toContain("← THIS IS THE AUDIT WORKLOAD");
    const scopeIdx = text.indexOf("AUDIT SCOPE");
    const numbersIdx = text.indexOf("The numbers");
    expect(scopeIdx).toBeLessThan(numbersIdx);
  });

  // v1.39.0 — new scans categorize .doc/.xls/.ppt as "legacy-office", so the
  // scope box's Legacy Office row (category-based) finally lights up and
  // agrees with the introspection-kind-based Legacy Office section.
  it("counts legacy-office entries in the Legacy Office scope row and the remediable total", () => {
    const entries = [
      { category: "legacy-office", remediable: true, sizeBytes: 100, sha256: "l1", flags: [], introspection: { kind: "office-legacy", format: "ppt" } },
      { category: "legacy-office", remediable: true, sizeBytes: 200, sha256: "l2", flags: [], introspection: { kind: "office-legacy", format: "ppt" } },
    ];
    const text = buildAuditScopeBlock(entries);
    expect(text).toMatch(/Legacy Office \(\.doc\/\.xls\)\s+2/);
    expect(text).toMatch(/Total that may need work:\s+2/);
  });

  it("agrees between the category-based scope count and the kind-based Legacy Office section for new scans", () => {
    const entries = [
      { category: "legacy-office", remediable: true, sizeBytes: 100, sha256: "l1", flags: [], introspection: { kind: "office-legacy", format: "doc" } },
      { category: "legacy-office", remediable: true, sizeBytes: 200, sha256: "l2", flags: [], introspection: { kind: "office-legacy", format: "xls" } },
    ];
    const text = writeSummary({ entries, sources: null, header: singleHeader });
    // Scope box (category-based) and the detail section (kind-based) both say 2.
    expect(text).toMatch(/Legacy Office \(\.doc\/\.xls\)\s+2/);
    expect(text).toContain("Legacy Office files (2 files)");
    // The By-file-type breakdown lists the new category too.
    expect(text).toMatch(/legacy-office:\s+2 files/);
  });
});

// ── Average pages per PDF (v1.39.0 divisor fix) ─────────────────────────────

describe("writeSummary — average pages per PDF", () => {
  const pdf = (over = {}) => ({
    category: "pdf",
    remediable: true,
    sizeBytes: 100,
    flags: [],
    ...over,
  });

  it("divides by the count of measured PDFs and says how many were measured", () => {
    // 10 PDFs, only 5 introspected with page counts totalling 100 pages.
    const measured = [20, 20, 20, 20, 20].map((n, i) =>
      pdf({ sha256: `m${i}`, introspection: { kind: "pdf", pageCount: n, hasTextLayer: true, isImageOnly: false, hasTags: false, hasFormFields: false, hasSignatures: false, encrypted: false } }));
    const unmeasured = [0, 1, 2, 3, 4].map((i) => pdf({ sha256: `u${i}` }));
    const text = writeSummary({ entries: [...measured, ...unmeasured], sources: null, header: singleHeader });
    // 100 pages / 5 measured = 20.0 (NOT 100 / 10 = 10.0), labelled honestly.
    expect(text).toMatch(/Average pages per PDF \(measured\):\s+20\.0 \(5 of 10 PDFs measured\)/);
    expect(text).not.toMatch(/:\s+10\.0/);
  });

  it("omits the coverage note when every PDF was measured", () => {
    const measured = [10, 30].map((n, i) =>
      pdf({ sha256: `m${i}`, introspection: { kind: "pdf", pageCount: n, hasTextLayer: true, isImageOnly: false, hasTags: false, hasFormFields: false, hasSignatures: false, encrypted: false } }));
    const text = writeSummary({ entries: measured, sources: null, header: singleHeader });
    expect(text).toMatch(/Average pages per PDF \(measured\):\s+20\.0\s*$/m);
    expect(text).not.toContain("PDFs measured)");
  });
});
