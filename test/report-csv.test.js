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

describe("CSV_COLUMNS", () => {
  it("declares 32 columns in stable order", () => {
    expect(CSV_COLUMNS.length).toBe(32);
    expect(CSV_COLUMNS[0]).toBe("serverName");
    expect(CSV_COLUMNS[CSV_COLUMNS.length - 1]).toBe("flags");
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
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
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
        documentLanguage: "en-US",
      },
    };
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [entry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[CSV_COLUMNS.indexOf("pdfPageCount")]).toBe("47");
    expect(cells[CSV_COLUMNS.indexOf("pdfHasTextLayer")]).toBe("true");
    expect(cells[CSV_COLUMNS.indexOf("documentLanguage")]).toBe("en-US");
    expect(cells[CSV_COLUMNS.indexOf("pdfProducer")]).toBe("Microsoft Word");
  });

  it("emits empty cells for missing introspection fields", () => {
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [baseEntry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[CSV_COLUMNS.indexOf("pdfPageCount")]).toBe("");
    expect(cells[CSV_COLUMNS.indexOf("pdfHasTextLayer")]).toBe("");
  });

  it("joins flags with pipe", () => {
    const entry = { ...baseEntry, flags: ["scanned-name-pattern", "filename-has-spaces"] };
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [entry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[CSV_COLUMNS.indexOf("flags")]).toBe("scanned-name-pattern|filename-has-spaces");
  });

  it("emits sizeHuman for human-readable sizes", () => {
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [baseEntry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[CSV_COLUMNS.indexOf("sizeHuman")]).toBe("4.6 MB");
  });
});

describe("writeCsv (consolidated input)", () => {
  it("uses per-entry serverName and looks up serverIp/hostname from sources", () => {
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
    expect(cells[CSV_COLUMNS.indexOf("serverName")]).toBe("strapi-prod-01");
    expect(cells[CSV_COLUMNS.indexOf("serverIp")]).toBe("10.42.7.18");
    expect(cells[CSV_COLUMNS.indexOf("hostname")]).toBe("strapi-prod-01.icjia.local");
  });
});
