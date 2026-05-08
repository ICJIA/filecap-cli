import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";
import { introspectXlsx } from "../src/introspect/xlsx.js";
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

  it("throws on a malformed XLSX", async () => {
    const file = path.join(tmpRoot, "garbage.xlsx");
    await fs.writeFile(file, "not an xlsx");
    await expect(introspectXlsx(file)).rejects.toThrow();
  });
});
