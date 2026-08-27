import { describe, it, expect } from "vitest";
import { writeCsv, CSV_COLUMNS, buildRow } from "../src/report/csv.js";

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

  it("fourth column is publicUrl with label Public URL (promoted in v1.7.2)", () => {
    expect(CSV_COLUMNS[3].name).toBe("publicUrl");
    expect(CSV_COLUMNS[3].label).toBe("Public URL");
  });

  // 1.8.0-beta.5: Referenced column moved to position 5 (immediately after
  // Public URL) so managers can see "where the file lives" and "where it's
  // referenced from" side-by-side. modifiedAt slid to position 6.
  it("fifth column is referenced with label Referenced", () => {
    expect(CSV_COLUMNS[4].name).toBe("referenced");
    expect(CSV_COLUMNS[4].label).toBe("Page References");
  });

  // 1.9.0: Audit Score column from audit.icjia.app slotted at position 6
  // (after Page References). 1.10.2 merged the separate Audit Report column
  // into Audit Score itself (score chip + report link, multi-line CSV cell)
  // — modifiedAt slid back to position 7.
  it("sixth column is auditScore with label Audit Report (v1.19.0 rename)", () => {
    expect(CSV_COLUMNS[5].name).toBe("auditScore");
    expect(CSV_COLUMNS[5].label).toBe("Audit Report");
  });

  it("seventh column is modifiedAt with label Date published", () => {
    expect(CSV_COLUMNS[6].name).toBe("modifiedAt");
    expect(CSV_COLUMNS[6].label).toBe("Date published");
  });

  it("modifiedAt column label is 'Date published' not 'Last modified'", () => {
    const col = CSV_COLUMNS.find((c) => c.name === "modifiedAt");
    expect(col).toBeDefined();
    expect(col.label).toBe("Date published");
    expect(col.label).not.toBe("Last modified");
  });

  it("does not include the remediable column (dropped in 1.4.1)", () => {
    const names = CSV_COLUMNS.map((c) => c.name);
    expect(names).not.toContain("remediable");
  });

  it("does not include format-specific introspection columns (dropped in 1.4.x)", () => {
    const names = CSV_COLUMNS.map((c) => c.name);
    // PDF introspection columns dropped in 1.4.1 — note: pageCount is back
    // as of 1.20.0 because vendors quote remediation per page. Other PDF
    // introspection fields remain in the inventory NDJSON only.
    expect(names).not.toContain("hasTextLayer");
    expect(names).not.toContain("isImageOnly");
    expect(names).not.toContain("hasTags");
    expect(names).not.toContain("hasFormFields");
    expect(names).not.toContain("encrypted");
    expect(names).not.toContain("documentLanguage");
    expect(names).not.toContain("officeLegacyFormat");
    // DOCX/XLSX dropped in 1.4.0
    expect(names).not.toContain("docxHasHeadings");
    expect(names).not.toContain("docxImageCount");
    expect(names).not.toContain("docxAltTextCoverage");
    expect(names).not.toContain("docxTableCount");
    expect(names).not.toContain("docxTablesHaveHeaders");
    expect(names).not.toContain("docxVagueLinkCount");
    expect(names).not.toContain("xlsxSheetCount");
  });

  it("does not include dropped metadata columns", () => {
    const names = CSV_COLUMNS.map((c) => c.name);
    expect(names).not.toContain("pdfTitle");
    expect(names).not.toContain("pdfAuthor");
    expect(names).not.toContain("textLayerCoverage");
    expect(names).not.toContain("hasOutline");
    expect(names).not.toContain("hasSignatures");
    expect(names).not.toContain("isLinearized");
    expect(names).not.toContain("docxTitle");
    expect(names).not.toContain("docxAuthor");
    expect(names).not.toContain("docxHeadingLevelsUsed");
    expect(names).not.toContain("xlsxSheetNames");
    expect(names).not.toContain("xlsxTotalCells");
    expect(names).not.toContain("auditLink");  // 1.9.0 uses auditScore + auditReport instead
    // v1.43.0 — auditGrade is BACK as its own sortable column (management
    // asked to sort by the bare letter), reversing the 1.9.0 fold-into-
    // auditScore decision, so it is no longer asserted absent here.
    expect(names).toContain("auditGrade");
    expect(names).toContain("auditScoreNum");
    expect(names).not.toContain("flags");
    // 1.9.0 NOTE: auditScore + auditReport ARE present (added for the
    // audit.icjia.app integration). See the position assertions above.
  });
});

describe("CSV_COLUMNS pageCount (v1.20.0)", () => {
  it("includes a pageCount column", () => {
    const names = CSV_COLUMNS.map((c) => c.name);
    expect(names).toContain("pageCount");
  });

  it("places pageCount immediately after filename", () => {
    const fi = colIndex("filename");
    const pi = colIndex("pageCount");
    expect(fi).toBeGreaterThanOrEqual(0);
    expect(pi).toBe(fi + 1);
  });

  it("pageCount column label is 'Page Count'", () => {
    const col = CSV_COLUMNS.find((c) => c.name === "pageCount");
    expect(col.label).toBe("Page Count");
  });
});

describe("writeCsv pageCount cell", () => {
  it("emits the introspected page count for PDFs", () => {
    const entry = {
      ...baseEntry,
      introspection: { kind: "pdf", pageCount: 42 },
    };
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [entry], sources: null });
    const rows = csv.trim().split("\n");
    const header = rows[0].split(",");
    const data = rows[1].split(",");
    const idx = header.findIndex((h) => h === "Page Count");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(data[idx]).toBe("42");
  });

  it("emits an empty cell when the entry is not a PDF", () => {
    const entry = {
      ...baseEntry,
      category: "office-document",
      extension: "docx",
      filename: "case.docx",
      path: "case.docx",
      introspection: { kind: "docx", paragraphCount: 200 },
    };
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [entry], sources: null });
    const rows = csv.trim().split("\n");
    const header = rows[0].split(",");
    const data = rows[1].split(",");
    const idx = header.findIndex((h) => h === "Page Count");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(data[idx]).toBe("");
  });

  it("emits an empty cell when a PDF has no introspection data", () => {
    const entry = { ...baseEntry };
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [entry], sources: null });
    const rows = csv.trim().split("\n");
    const header = rows[0].split(",");
    const data = rows[1].split(",");
    const idx = header.findIndex((h) => h === "Page Count");
    expect(data[idx]).toBe("");
  });
});

describe("writeCsv header row uses human-readable labels", () => {
  it("first row contains labels, not raw column names", () => {
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [], sources: null });
    const headerRow = csv.trim().split("\n")[0];
    expect(headerRow).toContain("Server");
    expect(headerRow).toContain("File name");
    expect(headerRow).toContain("File location (relative to source folder)");
    expect(headerRow).toContain("Public URL");
    expect(headerRow).not.toBe(CSV_COLUMNS.map((c) => c.name).join(","));
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

  it("does not include the flags column in CSV output", () => {
    const entry = { ...baseEntry, flags: ["scanned-name-pattern", "filename-has-spaces"] };
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [entry], sources: null });
    const headerRow = csv.split("\n")[0];
    expect(headerRow).not.toContain("File-name flags");
    expect(colIndex("flags")).toBe(-1);
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
  // The DOCX: vague-hyperlinks column (the only remaining label with embedded
  // quotes) was removed in 1.4.0 along with the rest of the DOCX/XLSX columns.
  // Header-label escaping is now exercised by quoteCsvField unit tests below
  // and by data-cell escaping tests above; no remaining column label requires
  // CSV escaping.

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

describe("CSV-only action column (v1.66.0 — Notes only)", () => {
  it("declares notes as the single csvOnly column, last in CSV_COLUMNS", () => {
    const last = CSV_COLUMNS[CSV_COLUMNS.length - 1];
    expect(last.name).toBe("notes");
    expect(last.label).toBe("Notes");
    expect(last.csvOnly).toBe(true);
    expect(last.defaultValue).toBe("");
    expect(CSV_COLUMNS.filter((c) => c.csvOnly)).toHaveLength(1);
  });

  // v1.66.0 — the Delete? column is gone. Nothing on a state website can
  // actually be deleted (records-retention policy), so a column inviting
  // "mark this for deletion" described an outcome that was never available.
  // The three real outcomes — archive, remediate, as-is — are all recorded
  // in Notes.
  it("no longer declares a deleteFlag column", () => {
    expect(CSV_COLUMNS.find((c) => c.name === "deleteFlag")).toBeUndefined();
    expect(CSV_COLUMNS.map((c) => c.label)).not.toContain("Delete?");
  });

  it("CSV header row carries Notes and not Delete?", () => {
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [], sources: null });
    const headerRow = csv.trim().split("\n")[0];
    expect(headerRow).toContain("Notes");
    expect(headerRow).not.toContain("Delete?");
    // 1.20.0: 19 columns (15 file-descriptor + Page References + Audit Score
    // + Delete? + Notes = 18, plus Page Count = 19).
    // 1.34.0: + Remediation Score = 20.  1.43.0: + Score (0-100) + Grade = 22.
    // 1.66.0: - Delete? = 21.
    expect(headerRow.split(",").length).toBe(21);
  });

  it("CSV data rows default Notes to an empty string", () => {
    const entry = {
      path: "doc.pdf",
      absolutePath: "/uploads/doc.pdf",
      filename: "doc.pdf",
      extension: "pdf",
      category: "pdf",
      modifiedAt: "2024-01-01T00:00:00.000Z",
      sizeBytes: 1024,
      sha256: "abc",
      flags: [],
    };
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [entry], sources: null });
    const dataRow = csv.trim().split("\n")[1];
    const cells = dataRow.split(",");
    expect(cells[colIndex("notes")]).toBe("");
  });
});

describe("writeCsv Audit Report column (v1.19.0 — report link only)", () => {
  // v1.19.0: the cell no longer prints "<grade> (<score>)" — the
  // audit.icjia.app scoring heuristic is still being refined, so the
  // spreadsheet links to the report instead of stating a grade.
  const auditEntry = (audit) => ({ ...baseEntry, audit });

  it("writes only the report URL — no letter grade, no numeric score", () => {
    const csv = writeCsv({
      sourceHeader: baseHeader,
      entries: [auditEntry({ score: 84, grade: "B", reportUrl: "https://audit.icjia.app/report/abc123" })],
      sources: null,
    });
    const cell = csv.trim().split("\n")[1].split(",")[colIndex("auditScore")];
    expect(cell).toBe("https://audit.icjia.app/report/abc123");
    expect(cell).not.toContain("84");
    expect(cell).not.toContain("B (");
  });

  it("writes an empty cell for an audited PDF that has no report URL", () => {
    const csv = writeCsv({
      sourceHeader: baseHeader,
      entries: [auditEntry({ score: 84, grade: "B" })],
      sources: null,
    });
    const cell = csv.trim().split("\n")[1].split(",")[colIndex("auditScore")];
    expect(cell).toBe("");
  });

  it("writes 'Unavailable' when the audit errored", () => {
    const csv = writeCsv({
      sourceHeader: baseHeader,
      entries: [auditEntry({ error: "HTTP 422" })],
      sources: null,
    });
    const cell = csv.trim().split("\n")[1].split(",")[colIndex("auditScore")];
    expect(cell).toBe("Unavailable");
  });
});

describe("writeCsv Referenced column", () => {
  // 1.8.0-beta.5: column moved next to Public URL so managers can read the
  // file's own URL and the list of pages that link to it side-by-side
  // without horizontal scrolling.
  it("declares a Referenced column immediately after Public URL", () => {
    const pubIdx = colIndex("publicUrl");
    const refIdx = colIndex("referenced");
    expect(refIdx).toBe(pubIdx + 1);
    expect(refIdx).toBeLessThan(colIndex("notes"));
  });

  it("uses the human label 'Page References'", () => {
    const col = CSV_COLUMNS.find((c) => c.name === "referenced");
    expect(col).toBeDefined();
    expect(col.label).toBe("Page References");
  });

  it("Referenced column is NOT csvOnly (it appears in the HTML view too)", () => {
    const col = CSV_COLUMNS.find((c) => c.name === "referenced");
    expect(col.csvOnly).not.toBe(true);
  });

  it("emits an empty Referenced cell when entry.references is undefined (cross-ref not run)", () => {
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [baseEntry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[colIndex("referenced")]).toBe("");
  });

  it("emits 'No' when entry.references is an empty array", () => {
    const entry = { ...baseEntry, references: [] };
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [entry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[colIndex("referenced")]).toBe("No");
  });

  it("emits a single page URL when references contains one item", () => {
    const entry = {
      ...baseEntry,
      references: [
        { pageUrl: "https://icjia.illinois.gov/grants/funding/2020-casa/" },
      ],
    };
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [entry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[colIndex("referenced")]).toBe(
      "https://icjia.illinois.gov/grants/funding/2020-casa/",
    );
  });

  // 1.8.0-beta.5: previously, references with a null pageUrl were silently
  // dropped from the CSV cell — a row whose references all lack page URLs
  // ended up with "" in the cell, which the column semantics define as
  // "cross-references not run yet." That collision hid real data. Now an
  // unresolved reference renders as the literal string "(no page URL)" so
  // the cell's line count matches the actual reference count.
  it("renders '(no page URL)' for references with a null pageUrl", () => {
    const entry = {
      ...baseEntry,
      references: [
        { pageUrl: "https://icjia.illinois.gov/grants/funding/2020-casa/" },
        { pageUrl: null, contentType: "form", entryId: 17 },
      ],
    };
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [entry], sources: null });
    const dataLine = csv.trim().split("\n").slice(1).join("\n");
    expect(dataLine).toContain("https://icjia.illinois.gov/grants/funding/2020-casa/");
    expect(dataLine).toContain("(no page URL)");
  });

  it("emits multi-line cell (newline-joined, double-quoted) when references contains multiple items", () => {
    const entry = {
      ...baseEntry,
      references: [
        { pageUrl: "https://icjia.illinois.gov/grants/funding/2020-casa/" },
        { pageUrl: "https://icjia.illinois.gov/news/foo/" },
      ],
    };
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [entry], sources: null });
    // Embedded newlines force the csvCell helper to wrap the cell in double quotes,
    // so the row no longer splits cleanly on plain commas. Find the Referenced cell
    // by scanning for its expected content directly.
    expect(csv).toContain(
      '"https://icjia.illinois.gov/grants/funding/2020-casa/\nhttps://icjia.illinois.gov/news/foo/"',
    );
  });
});

describe("buildRow — absolutePath redaction (FC-2026-035)", () => {
  const apIdx = CSV_COLUMNS.findIndex((c) => c.name === "absolutePath");
  const sourceHeader = { metadata: { serverName: "demo", siteName: "demo", serverIp: "", scannedPath: "", publicUrlBase: "https://demo.test/" } };
  it("blanks a Strapi/Forge filesystem absolutePath in the row", () => {
    const row = buildRow({ entry: { path: "x.pdf", filename: "x.pdf", absolutePath: "/home/forge/agency.icjia-api.cloud/agency-api/public/uploads/x.pdf" }, sourceHeader, isConsolidated: false });
    expect(row[apIdx]).toBe("");
  });
  it("keeps a git site's GitHub URL absolutePath in the row", () => {
    const gh = "https://github.com/ICJIA/icjia-sfs-2024/tree/main/public/a.pdf";
    const row = buildRow({ entry: { path: "a.pdf", filename: "a.pdf", absolutePath: gh }, sourceHeader, isConsolidated: false });
    expect(row[apIdx]).toBe(gh);
  });
});
