import { describe, it, expect } from "vitest";
import { writeSummary } from "../src/report/summary.js";

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
    expect(text).toContain("filecap audit summary");
    expect(text).toContain("Server:           prod-01 (10.0.0.1)");
    expect(text).toContain("Source location:  /var/uploads");
    expect(text).toContain("The numbers");
    expect(text).toContain("Total files:                6");
    expect(text).toContain("Files needing remediation:");
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
});
