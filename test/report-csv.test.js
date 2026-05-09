import { describe, it, expect } from "vitest";
import { writeCsv, CSV_COLUMNS } from "../src/report/csv.js";

const baseHeader = {
  schemaVersion: 1,
  kind: "filecap-inventory-header",
  metadata: {
    serverName: "strapi-prod-01",
    hostname: "strapi-prod-01.icjia.local",
    serverIp: "10.42.7.18",
    scannedPath: "/var/strapi/uploads",
    scannedAt: "2024-01-01T00:00:00.000Z",
    filecapVersion: "0.5.0",
    nodeVersion: "v20.11.1",
    options: { introspect: true, hash: true, maxIntrospectMb: 200, concurrency: 4 },
  },
};

const baseEntry = {
  path: "case.pdf",
  absolutePath: "/var/strapi/uploads/case.pdf",
  filename: "case.pdf",
  extension: "pdf",
  category: "pdf",
  remediable: true,
  sizeBytes: 4827193,
  modifiedAt: "2024-03-12T09:14:22.000Z",
  sha256: "abc123",
  flags: [],
};

function colIndex(name) {
  return CSV_COLUMNS.findIndex((c) => c.name === name);
}

describe("CSV_COLUMNS", () => {
  it("declares columns as objects with name and label fields", () => {
    expect(CSV_COLUMNS.length).toBeGreaterThan(0);
    for (const col of CSV_COLUMNS) {
      expect(typeof col.name).toBe("string");
      expect(typeof col.label).toBe("string");
      expect(col.label.length).toBeGreaterThan(0);
    }
  });

  it("first column is serverName with label Server", () => {
    expect(CSV_COLUMNS[0].name).toBe("serverName");
    expect(CSV_COLUMNS[0].label).toBe("Server");
  });

  it("second column is siteName with label Website", () => {
    expect(CSV_COLUMNS[1].name).toBe("siteName");
    expect(CSV_COLUMNS[1].label).toBe("Website");
  });

  it("includes new metadata columns for PDF, DOCX, XLSX", () => {
    const names = CSV_COLUMNS.map((c) => c.name);
    expect(names).toContain("pdfTitle");
    expect(names).toContain("pdfAuthor");
    expect(names).toContain("pdfApproxWordCount");
    expect(names).toContain("docxTitle");
    expect(names).toContain("docxAuthor");
    expect(names).toContain("docxHeadingLevelsUsed");
    expect(names).toContain("xlsxTitle");
    expect(names).toContain("xlsxAuthor");
    expect(names).toContain("xlsxTotalCells");
  });
});

describe("writeCsv header row uses human-readable labels", () => {
  it("first row contains labels, not raw column names", () => {
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [], sources: null });
    const headerRow = csv.trim().split("\n")[0];
    expect(headerRow).toContain("Server");
    expect(headerRow).toContain("File name");
    expect(headerRow).toContain("Needs remediation");
    expect(headerRow).toContain("PDF: page count");
    expect(headerRow).not.toBe(CSV_COLUMNS.map((c) => c.name).join(","));
  });
});

describe("writeCsv boolean rendering", () => {
  it("renders boolean true as Yes and false as No", () => {
    const entry = {
      ...baseEntry,
      remediable: true,
      introspection: {
        kind: "pdf",
        pageCount: 5,
        hasTextLayer: true,
        isImageOnly: false,
        hasTags: false,
        hasFormFields: false,
        hasSignatures: false,
        encrypted: false,
      },
    };
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [entry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");

    expect(cells[colIndex("remediable")]).toBe("Yes");
    expect(cells[colIndex("hasTextLayer")]).toBe("Yes");
    expect(cells[colIndex("isImageOnly")]).toBe("No");
  });

  it("renders empty string for missing introspection fields", () => {
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [baseEntry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[colIndex("pageCount")]).toBe("");
    expect(cells[colIndex("hasTextLayer")]).toBe("");
  });
});

describe("writeCsv (single-instance input)", () => {
  it("emits a header row + one row per entry", () => {
    const csv = writeCsv({
      sourceHeader: baseHeader,
      entries: [baseEntry],
      sources: null,
    });
    const lines = csv.trim().split("\n");
    expect(lines.length).toBe(2);
  });

  it("populates introspection-derived columns from PDF entries", () => {
    const entry = {
      ...baseEntry,
      introspection: {
        kind: "pdf",
        pageCount: 47,
        hasTextLayer: true,
        isImageOnly: false,
        hasTags: false,
        hasFormFields: false,
        hasSignatures: false,
        encrypted: false,
        producer: "Microsoft Word",
        creator: "Word",
        creationDate: "2024-01-01T00:00:00.000Z",
        title: "Policy Doc",
        author: "Jane Smith",
        approxWordCount: 1500,
      },
    };
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [entry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[colIndex("pageCount")]).toBe("47");
    expect(cells[colIndex("pdfTitle")]).toBe("Policy Doc");
    expect(cells[colIndex("pdfAuthor")]).toBe("Jane Smith");
    expect(cells[colIndex("pdfApproxWordCount")]).toBe("1500");
  });

  it("joins flags with pipe", () => {
    const entry = { ...baseEntry, flags: ["scanned-name-pattern", "filename-has-spaces"] };
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [entry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[colIndex("flags")]).toBe("scanned-name-pattern|filename-has-spaces");
  });
});

describe("writeCsv siteName column", () => {
  it("renders Website column as empty for a source without siteName", () => {
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [baseEntry], sources: null });
    const headerRow = csv.trim().split("\n")[0];
    expect(headerRow).toContain("Website");
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[colIndex("siteName")]).toBe("");
  });

  it("renders Website column with siteName from single-instance header", () => {
    const headerWithSite = {
      ...baseHeader,
      metadata: { ...baseHeader.metadata, siteName: "DVFR" },
    };
    const csv = writeCsv({ sourceHeader: headerWithSite, entries: [baseEntry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[colIndex("siteName")]).toBe("DVFR");
  });

  it("renders Website column from source's siteName in consolidated inventory", () => {
    const consolidatedHeader = {
      schemaVersion: 1,
      kind: "filecap-consolidated-header",
      metadata: {
        consolidatedAt: "2024-01-01T00:00:00.000Z",
        filecapVersion: "1.0.3",
        nodeVersion: "v20.11.1",
        sources: [
          {
            siteName: "DVFR",
            ...baseHeader.metadata,
            stats: { fileCount: 1, totalBytes: 0, scanDurationMs: 0, introspectionFailures: 0, permissionDenials: 0 },
          },
        ],
      },
    };
    const entry = { ...baseEntry, serverName: "strapi-prod-01", duplicateOf: null };
    const csv = writeCsv({
      sourceHeader: consolidatedHeader,
      entries: [entry],
      sources: consolidatedHeader.metadata.sources,
    });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[colIndex("siteName")]).toBe("DVFR");
  });
});

describe("writeCsv (consolidated input)", () => {
  it("uses per-entry serverName and looks up serverIp from sources", () => {
    const consolidatedHeader = {
      schemaVersion: 1,
      kind: "filecap-consolidated-header",
      metadata: {
        consolidatedAt: "2024-01-01T00:00:00.000Z",
        filecapVersion: "0.5.0",
        nodeVersion: "v20.11.1",
        sources: [
          {
            ...baseHeader.metadata,
            stats: { fileCount: 1, totalBytes: 0, scanDurationMs: 0, introspectionFailures: 0, permissionDenials: 0 },
          },
        ],
      },
    };
    const entry = { ...baseEntry, serverName: "strapi-prod-01", duplicateOf: null };
    const csv = writeCsv({
      sourceHeader: consolidatedHeader,
      entries: [entry],
      sources: consolidatedHeader.metadata.sources,
    });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[colIndex("serverName")]).toBe("strapi-prod-01");
    expect(cells[colIndex("serverIp")]).toBe("10.42.7.18");
  });
});
