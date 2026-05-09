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

  it("third column is serverIp with label Server IP", () => {
    expect(CSV_COLUMNS[2].name).toBe("serverIp");
    expect(CSV_COLUMNS[2].label).toBe("Server IP");
  });

  it("fourth column is modifiedAt with label Date published", () => {
    expect(CSV_COLUMNS[3].name).toBe("modifiedAt");
    expect(CSV_COLUMNS[3].label).toBe("Date published");
  });

  it("modifiedAt column label is 'Date published' not 'Last modified'", () => {
    const col = CSV_COLUMNS.find((c) => c.name === "modifiedAt");
    expect(col).toBeDefined();
    expect(col.label).toBe("Date published");
    expect(col.label).not.toBe("Last modified");
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

describe("writeCsv publicUrl column", () => {
  it("emits an empty Public URL when no publicUrlBase is set", () => {
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [baseEntry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[colIndex("publicUrl")]).toBe("");
  });

  it("builds a Public URL from header publicUrlBase + entry path", () => {
    const headerWithUrl = {
      ...baseHeader,
      metadata: { ...baseHeader.metadata, publicUrlBase: "https://example.com/uploads" },
    };
    const csv = writeCsv({ sourceHeader: headerWithUrl, entries: [baseEntry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[colIndex("publicUrl")]).toBe("https://example.com/uploads/case.pdf");
  });

  it("strips trailing slash from base and leading slash from path when building URL", () => {
    const headerWithUrl = {
      ...baseHeader,
      metadata: { ...baseHeader.metadata, publicUrlBase: "https://example.com/uploads/" },
    };
    const entryWithLeadingSlash = { ...baseEntry, path: "/case.pdf" };
    const csv = writeCsv({ sourceHeader: headerWithUrl, entries: [entryWithLeadingSlash], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[colIndex("publicUrl")]).toBe("https://example.com/uploads/case.pdf");
  });

  it("builds Public URL from consolidated source publicUrlBase", () => {
    const consolidatedHeader = {
      schemaVersion: 1,
      kind: "filecap-consolidated-header",
      metadata: {
        consolidatedAt: "2024-01-01T00:00:00.000Z",
        filecapVersion: "1.0.4",
        nodeVersion: "v20.11.1",
        sources: [
          {
            ...baseHeader.metadata,
            publicUrlBase: "https://prod.example.com/uploads",
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
    expect(cells[colIndex("publicUrl")]).toBe("https://prod.example.com/uploads/case.pdf");
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

describe("writeCsv header row escaping", () => {
  it("escapes header labels containing commas or quotes", () => {
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [], sources: null });
    const firstLine = csv.split("\n")[0];
    // DOCX: vague hyperlinks ("click here") — has quotes, needs escaping
    expect(firstLine).toContain('"DOCX: vague hyperlinks (""click here"")"');
    // XLSX: default sheet names (Sheet1, Sheet2, …) — has comma, needs quoting
    expect(firstLine).toContain('"XLSX: default sheet names (Sheet1, Sheet2, …)"');
  });

  it("leaves simple labels unquoted in the header", () => {
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [], sources: null });
    const firstLine = csv.split("\n")[0];
    // Simple labels without commas/quotes/newlines stay unquoted
    expect(firstLine).toMatch(/(^|,)Server(,|$)/);
    expect(firstLine).toMatch(/(^|,)Website(,|$)/);
  });
});

describe("writeCsv SHA-256 Excel text-formula wrapping", () => {
  it("wraps SHA-256 hash in Excel text-formula syntax to prevent scientific-notation auto-conversion", () => {
    const fullHash = "a".repeat(64);
    const entry = { ...baseEntry, sha256: fullHash };
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [entry], sources: null });
    // csvCell() wraps the ="<hash>" value in outer quotes and doubles inner quotes per RFC 4180.
    // Raw CSV cell form is: "=""<hash>"""
    // Excel parses "=""<hash>""" back to the formula ="<hash>" and evaluates it as the string.
    expect(csv).toContain(`"=""${fullHash}"""`);
  });

  it("returns empty string for missing SHA-256 hash", () => {
    const entry = { ...baseEntry, sha256: undefined };
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [entry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[colIndex("sha256")]).toBe("");
  });

  it("does not wrap other columns in Excel text-formula syntax", () => {
    const entry = { ...baseEntry, sha256: "deadbeef" };
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [entry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    // filename column should not be wrapped
    expect(cells[colIndex("filename")]).toBe("case.pdf");
    // extension column should not be wrapped
    expect(cells[colIndex("extension")]).toBe("pdf");
  });
});

describe("writeCsv auditLink column", () => {
  it("emits an empty Audit Link when no auditLinkPattern is set", () => {
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [baseEntry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[colIndex("auditLink")]).toBe("");
  });

  it("expands {sha256} placeholder in audit link pattern", () => {
    const headerWithPattern = {
      ...baseHeader,
      metadata: { ...baseHeader.metadata, auditLinkPattern: "https://audit.example.com/?hash={sha256}" },
    };
    const entry = { ...baseEntry, sha256: "deadbeef" };
    const csv = writeCsv({ sourceHeader: headerWithPattern, entries: [entry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[colIndex("auditLink")]).toBe("https://audit.example.com/?hash=deadbeef");
  });

  it("expands {publicUrl} placeholder using publicUrlBase + entry path", () => {
    const headerWithBoth = {
      ...baseHeader,
      metadata: {
        ...baseHeader.metadata,
        publicUrlBase: "https://cdn.example.com/uploads",
        auditLinkPattern: "https://audit.example.com/?url={publicUrl}",
      },
    };
    const csv = writeCsv({ sourceHeader: headerWithBoth, entries: [baseEntry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    const expected = "https://audit.example.com/?url=" + encodeURIComponent("https://cdn.example.com/uploads/case.pdf");
    expect(cells[colIndex("auditLink")]).toBe(expected);
  });

  it("emits empty string when pattern is set but publicUrlBase is absent and template uses only {publicUrl}", () => {
    const headerWithPatternOnly = {
      ...baseHeader,
      metadata: { ...baseHeader.metadata, auditLinkPattern: "https://audit.example.com/?url={publicUrl}" },
    };
    const csv = writeCsv({ sourceHeader: headerWithPatternOnly, entries: [baseEntry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    // publicUrl resolves to "", so encoded empty string — link is still returned (pattern is set)
    expect(cells[colIndex("auditLink")]).toContain("https://audit.example.com");
  });
});
