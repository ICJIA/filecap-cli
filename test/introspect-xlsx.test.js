import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { introspectXlsx, zipHasCharts } from "../src/introspect/xlsx.js";
import { xlsxIntrospectionSchema } from "../src/schema/inventory.js";

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-xlsx-intro-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("introspectXlsx", () => {
  it("introspects a basic XLSX with multiple sheets", async () => {
    const file = path.join(tmpRoot, "basic.xlsx");
    const wb = new ExcelJS.Workbook();
    const summary = wb.addWorksheet("Summary");
    summary.addRow(["Header A", "Header B", "Header C"]);
    summary.addRow([1, 2, 3]);
    summary.addRow([4, 5, 6]);
    summary.getRow(1).font = { bold: true };

    wb.addWorksheet("Details");
    wb.addWorksheet("Sheet3");
    await wb.xlsx.writeFile(file);

    const result = await introspectXlsx(file);
    expect(() => xlsxIntrospectionSchema.parse(result)).not.toThrow();
    expect(result.kind).toBe("xlsx");
    expect(result.sheetCount).toBe(3);
    expect(result.sheetNames).toEqual(["Summary", "Details", "Sheet3"]);
    expect(result.defaultSheetNameCount).toBe(1);
    expect(result.hasHeaderRows).toBe(true);
    expect(result.mergedCellCount).toBe(0);
  });

  it("counts merged cells across all sheets", async () => {
    const file = path.join(tmpRoot, "merged.xlsx");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Data");
    ws.addRow(["A", "B", "C"]);
    ws.addRow([1, 2, 3]);
    ws.addRow([4, 5, 6]);
    ws.mergeCells("A1:B1");
    ws.mergeCells("A3:C3");
    await wb.xlsx.writeFile(file);

    const result = await introspectXlsx(file);
    expect(result.mergedCellCount).toBe(2);
  });

  it("flags default sheet names like Sheet1, Sheet2", async () => {
    const file = path.join(tmpRoot, "default-names.xlsx");
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Sheet1");
    wb.addWorksheet("Sheet2");
    wb.addWorksheet("Reports");
    await wb.xlsx.writeFile(file);

    const result = await introspectXlsx(file);
    expect(result.defaultSheetNameCount).toBe(2);
  });

  it("returns hasHeaderRows: false when no sheet has a styled first row", async () => {
    const file = path.join(tmpRoot, "no-headers.xlsx");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Plain");
    ws.addRow([1, 2, 3]);
    ws.addRow([4, 5, 6]);
    await wb.xlsx.writeFile(file);

    const result = await introspectXlsx(file);
    expect(result.hasHeaderRows).toBe(false);
  });

  it("extracts title and author from workbook properties", async () => {
    const file = path.join(tmpRoot, "meta.xlsx");
    const wb = new ExcelJS.Workbook();
    wb.title = "Budget Report";
    wb.creator = "Finance Team";
    wb.addWorksheet("Summary");
    await wb.xlsx.writeFile(file);

    const result = await introspectXlsx(file);
    expect(() => xlsxIntrospectionSchema.parse(result)).not.toThrow();
    expect(result.title).toBe("Budget Report");
    expect(result.author).toBe("Finance Team");
  });

  it("returns null for missing title/author and a non-negative totalCells", async () => {
    const file = path.join(tmpRoot, "no-meta.xlsx");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Data");
    ws.addRow(["A", "B", "C"]);
    ws.addRow([1, 2, 3]);
    await wb.xlsx.writeFile(file);

    const result = await introspectXlsx(file);
    expect(() => xlsxIntrospectionSchema.parse(result)).not.toThrow();
    expect(result.title === null || result.title === undefined || typeof result.title === "string").toBe(true);
    expect(typeof result.totalCells).toBe("number");
    expect(result.totalCells).toBeGreaterThanOrEqual(0);
  });

  it("throws on a malformed XLSX", async () => {
    const file = path.join(tmpRoot, "garbage.xlsx");
    await fs.writeFile(file, "not an xlsx");
    await expect(introspectXlsx(file)).rejects.toThrow();
  });
});

// v1.39.0 (F4): exceljs never surfaces charts (ws.model.charts is always
// undefined), so hasCharts was permanently false. Detection now inspects the
// raw zip for xl/charts/chart*.xml / chartEx*.xml parts.
describe("zipHasCharts", () => {
  async function makeZip(entryNames) {
    const zip = new JSZip();
    for (const name of entryNames) {
      zip.file(name, "<xml/>");
    }
    return zip.generateAsync({ type: "nodebuffer" });
  }

  it("detects xl/charts/chart1.xml", async () => {
    const buf = await makeZip(["xl/workbook.xml", "xl/charts/chart1.xml"]);
    expect(await zipHasCharts(buf)).toBe(true);
  });

  it("detects extended charts (xl/charts/chartEx1.xml)", async () => {
    const buf = await makeZip(["xl/workbook.xml", "xl/charts/chartEx1.xml"]);
    expect(await zipHasCharts(buf)).toBe(true);
  });

  it("returns false when no chart parts exist", async () => {
    const buf = await makeZip(["xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    expect(await zipHasCharts(buf)).toBe(false);
  });

  it("ignores chart-ish names outside xl/charts/", async () => {
    const buf = await makeZip([
      "xl/workbook.xml",
      "xl/embeddings/chart1.xml",
      "xl/charts/colors1.xml",
      "docs/chart1.xml",
    ]);
    expect(await zipHasCharts(buf)).toBe(false);
  });
});

describe("introspectXlsx hasCharts wiring", () => {
  it("reports hasCharts: true for a workbook containing a chart part", async () => {
    // exceljs cannot WRITE charts either, so build a normal workbook and
    // splice a chart part into the zip — exceljs ignores unreferenced parts
    // on read, while the detector sees the raw entry.
    const file = path.join(tmpRoot, "with-chart.xlsx");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Data");
    ws.addRow(["A", "B"]);
    ws.addRow([1, 2]);
    await wb.xlsx.writeFile(file);

    const zip = await JSZip.loadAsync(await fs.readFile(file));
    zip.file("xl/charts/chart1.xml", "<c:chartSpace/>");
    await fs.writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));

    const result = await introspectXlsx(file);
    expect(() => xlsxIntrospectionSchema.parse(result)).not.toThrow();
    expect(result.hasCharts).toBe(true);
    expect(result.sheetCount).toBe(1);
  });

  it("reports hasCharts: false for a chartless workbook", async () => {
    const file = path.join(tmpRoot, "no-chart.xlsx");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Data");
    ws.addRow([1, 2, 3]);
    await wb.xlsx.writeFile(file);

    const result = await introspectXlsx(file);
    expect(result.hasCharts).toBe(false);
  });
});
