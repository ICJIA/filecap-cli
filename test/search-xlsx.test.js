import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  buildSearchWorkbook,
  xlsxDownloadName,
  searchXlsxClientSource,
} from "../src/web/search-xlsx.js";

// The /search page's "Download results (.xlsx)" builder. It runs in the
// BROWSER (embedded via .toString() like uptime-client.js), so it can't use
// ExcelJS — it writes a minimal OOXML workbook by hand. These tests are the
// Excel-validity proof: ExcelJS (the same library the server-side workbooks
// use) must read back every value, hyperlink, and view setting.

const ROWS = [
  {
    site: "DVFR",
    filename: "Annual Report 2023.pdf",
    category: "PDF",
    score: 72,
    grade: "C",
    sizeBytes: 2048,
    modified: "2024-03-05",
    fileUrl: "https://dvfr.icjia-api.cloud/uploads/2023/Annual%20Report%202023.pdf",
    reportUrl: "https://fleet.icjia.app/dvfr-20260816-125634Z.html",
    matchedOn: "dvfr: site name; report: filename",
  },
  {
    site: "ICJIA",
    filename: "Smith & Jones <memo>.docx",
    category: "Word (.docx)",
    score: null,
    grade: null,
    sizeBytes: 512,
    modified: "2020-01-01",
    fileUrl: "https://icjia.icjia-api.cloud/uploads/Smith%20%26%20Jones.docx",
    reportUrl: "",
  },
];

async function load(bytes) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes));
  return wb;
}

describe("buildSearchWorkbook", () => {
  it("produces a workbook ExcelJS can open, with the expected sheet", async () => {
    const bytes = buildSearchWorkbook(ROWS);
    expect(bytes).toBeInstanceOf(Uint8Array);
    const wb = await load(bytes);
    expect(wb.worksheets.length).toBe(1);
    expect(wb.worksheets[0].name).toBe("Search results");
  });

  it("writes the header row with the house column labels", async () => {
    const wb = await load(buildSearchWorkbook(ROWS));
    const sheet = wb.worksheets[0];
    const header = sheet.getRow(1).values.slice(1);
    expect(header).toEqual([
      "Website", "Filename", "Category", "Score (0-100)", "Grade",
      "Size (bytes)", "Date modified", "File URL", "Audit report", "Matched on",
    ]);
  });

  it("carries the per-row match explanation in the Matched on column", async () => {
    const wb = await load(buildSearchWorkbook(ROWS));
    const sheet = wb.worksheets[0];
    expect(sheet.getCell("J2").value).toBe("dvfr: site name; report: filename");
    expect(sheet.getCell("J3").value).toBeNull();
  });

  it("freezes the header row and applies an autofilter", async () => {
    const wb = await load(buildSearchWorkbook(ROWS));
    const sheet = wb.worksheets[0];
    expect(sheet.views[0].state).toBe("frozen");
    expect(sheet.views[0].ySplit).toBe(1);
    expect(sheet.autoFilter).toBeTruthy();
  });

  it("writes data cells with real types: text, numbers, and empty score cells", async () => {
    const wb = await load(buildSearchWorkbook(ROWS));
    const sheet = wb.worksheets[0];
    expect(sheet.getCell("A2").value).toBe("DVFR");
    expect(sheet.getCell("B2").value).toBe("Annual Report 2023.pdf");
    expect(sheet.getCell("D2").value).toBe(72);
    expect(sheet.getCell("F2").value).toBe(2048);
    expect(sheet.getCell("D3").value).toBeNull();
    expect(sheet.getCell("E3").value).toBeNull();
  });

  it("survives XML-hostile filenames", async () => {
    const wb = await load(buildSearchWorkbook(ROWS));
    expect(wb.worksheets[0].getCell("B3").value).toBe("Smith & Jones <memo>.docx");
  });

  it("emits the file URL as a real hyperlink cell", async () => {
    const wb = await load(buildSearchWorkbook(ROWS));
    const cell = wb.worksheets[0].getCell("H2");
    expect(cell.value?.hyperlink).toBe(ROWS[0].fileUrl);
    expect(cell.value?.text).toBe(ROWS[0].fileUrl);
  });

  it("links the audit report when present and leaves the cell plain when not", async () => {
    const wb = await load(buildSearchWorkbook(ROWS));
    const sheet = wb.worksheets[0];
    expect(sheet.getCell("I2").value?.hyperlink).toBe(ROWS[0].reportUrl);
    expect(sheet.getCell("I3").value?.hyperlink).toBeUndefined();
  });

  it("is deterministic — identical bytes for identical input", () => {
    const a = buildSearchWorkbook(ROWS);
    const b = buildSearchWorkbook(ROWS);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("handles zero result rows", async () => {
    const wb = await load(buildSearchWorkbook([]));
    expect(wb.worksheets[0].getRow(1).values.slice(1)[0]).toBe("Website");
  });
});

describe("xlsxDownloadName", () => {
  it("slugs the query into the filename with the date", () => {
    expect(xlsxDownloadName("Annual Report!", "2026-08-16T13:00:00.000Z"))
      .toBe("search-results-annual-report-20260816.xlsx");
  });

  it("falls back when the query slugs to nothing", () => {
    expect(xlsxDownloadName("???", "2026-08-16T13:00:00.000Z"))
      .toBe("search-results-20260816.xlsx");
  });
});

describe("searchXlsxClientSource", () => {
  it("emits self-contained sources for the inline <script>", () => {
    const src = searchXlsxClientSource();
    expect(src).toContain("function buildSearchWorkbook");
    expect(src).toContain("function xlsxDownloadName");
    expect(src).not.toMatch(/\bimport\b/);
    expect(src).not.toMatch(/\bexport\b/);
  });
});
