import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";
import { writeXlsx, writeXlsxMultiSheet } from "../src/report/xlsx.js";

const baseHeader = {
  schemaVersion: 1,
  kind: "filecap-inventory-header",
  metadata: {
    serverName: "strapi-prod-01",
    serverIp: "10.42.7.18",
    scannedPath: "/var/strapi/uploads",
    publicUrlBase: "https://cdn.example.com/uploads",
  },
};

const pdfEntry = {
  path: "report.pdf",
  absolutePath: "/var/strapi/uploads/report.pdf",
  filename: "report.pdf",
  extension: "pdf",
  category: "pdf",
  remediable: true,
  sizeBytes: 12345,
  modifiedAt: "2026-01-15T10:00:00.000Z",
  sha256: "deadbeef".repeat(8),
  flags: [],
  introspection: { kind: "pdf", pageCount: 42 },
};

const docxEntry = {
  path: "policy.docx",
  absolutePath: "/var/strapi/uploads/policy.docx",
  filename: "policy.docx",
  extension: "docx",
  category: "office-document",
  remediable: true,
  sizeBytes: 56789,
  modifiedAt: "2026-02-10T08:30:00.000Z",
  sha256: "ab".repeat(32),
  flags: [],
};

let tmpDir;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-xlsx-"));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function load(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb;
}

describe("writeXlsx (single sheet)", () => {
  it("writes a parseable xlsx file with one sheet", async () => {
    const out = path.join(tmpDir, "out.xlsx");
    await writeXlsx({ sourceHeader: baseHeader, entries: [pdfEntry], sources: null, outputPath: out });
    const wb = await load(out);
    expect(wb.worksheets.length).toBe(1);
  });

  it("header row uses the human-readable CSV_COLUMNS labels", async () => {
    const out = path.join(tmpDir, "labels.xlsx");
    await writeXlsx({ sourceHeader: baseHeader, entries: [pdfEntry], sources: null, outputPath: out });
    const wb = await load(out);
    const sheet = wb.worksheets[0];
    const headerRow = sheet.getRow(1);
    const labels = [];
    headerRow.eachCell((cell) => labels.push(cell.value));
    expect(labels).toContain("Page Count");
    expect(labels).toContain("File name");
    expect(labels).toContain("Public URL");
  });

  it("stores Page Count as a real number for PDFs", async () => {
    const out = path.join(tmpDir, "pages.xlsx");
    await writeXlsx({ sourceHeader: baseHeader, entries: [pdfEntry], sources: null, outputPath: out });
    const wb = await load(out);
    const sheet = wb.worksheets[0];
    const header = sheet.getRow(1);
    let pageCol = -1;
    header.eachCell((cell, col) => { if (cell.value === "Page Count") pageCol = col; });
    expect(pageCol).toBeGreaterThan(0);
    const cell = sheet.getRow(2).getCell(pageCol);
    expect(typeof cell.value).toBe("number");
    expect(cell.value).toBe(42);
  });

  it("leaves Page Count blank for non-PDFs", async () => {
    const out = path.join(tmpDir, "pages-blank.xlsx");
    await writeXlsx({ sourceHeader: baseHeader, entries: [docxEntry], sources: null, outputPath: out });
    const wb = await load(out);
    const sheet = wb.worksheets[0];
    const header = sheet.getRow(1);
    let pageCol = -1;
    header.eachCell((cell, col) => { if (cell.value === "Page Count") pageCol = col; });
    const cell = sheet.getRow(2).getCell(pageCol);
    expect(cell.value === null || cell.value === undefined || cell.value === "").toBe(true);
  });

  it("freezes the header row and sets autofilter", async () => {
    const out = path.join(tmpDir, "filter.xlsx");
    await writeXlsx({ sourceHeader: baseHeader, entries: [pdfEntry, docxEntry], sources: null, outputPath: out });
    const wb = await load(out);
    const sheet = wb.worksheets[0];
    expect(sheet.views?.[0]?.state).toBe("frozen");
    expect(sheet.views?.[0]?.ySplit).toBe(1);
    expect(sheet.autoFilter).toBeTruthy();
  });

  it("uses the provided sheet name", async () => {
    const out = path.join(tmpDir, "named.xlsx");
    await writeXlsx({ sourceHeader: baseHeader, entries: [pdfEntry], sources: null, outputPath: out, sheetName: "PDFs" });
    const wb = await load(out);
    expect(wb.worksheets[0].name).toBe("PDFs");
  });

  it("stores SHA-256 as a plain string (no =\"...\" excel-formula wrapper)", async () => {
    const out = path.join(tmpDir, "sha.xlsx");
    await writeXlsx({ sourceHeader: baseHeader, entries: [pdfEntry], sources: null, outputPath: out });
    const wb = await load(out);
    const sheet = wb.worksheets[0];
    const header = sheet.getRow(1);
    let shaCol = -1;
    header.eachCell((cell, col) => { if (cell.value === "Content hash (SHA-256)") shaCol = col; });
    const cell = sheet.getRow(2).getCell(shaCol);
    expect(typeof cell.value).toBe("string");
    expect(cell.value).toBe(pdfEntry.sha256);
    expect(cell.value).not.toMatch(/^="/);
  });
});

describe("writeXlsx column order, sort, and hyperlinks (v1.20.0)", () => {
  it("orders columns: Date published, File name, Page Count, Public URL, Page References, ...", async () => {
    const out = path.join(tmpDir, "order.xlsx");
    await writeXlsx({ sourceHeader: baseHeader, entries: [pdfEntry], sources: null, outputPath: out });
    const wb = await load(out);
    const headerRow = wb.worksheets[0].getRow(1);
    const labels = [];
    headerRow.eachCell((cell) => labels.push(cell.value));
    expect(labels[0]).toBe("Date published");
    expect(labels[1]).toBe("File name");
    expect(labels[2]).toBe("Page Count");
    expect(labels[3]).toBe("Public URL");
    expect(labels[4]).toBe("Page References");
  });

  it("sorts rows by Date published descending (newest first)", async () => {
    const e2024 = { ...pdfEntry, path: "a.pdf", filename: "a.pdf", modifiedAt: "2024-01-01T00:00:00.000Z" };
    const e2026 = { ...pdfEntry, path: "b.pdf", filename: "b.pdf", modifiedAt: "2026-02-15T00:00:00.000Z" };
    const e2025 = { ...pdfEntry, path: "c.pdf", filename: "c.pdf", modifiedAt: "2025-06-01T00:00:00.000Z" };
    const out = path.join(tmpDir, "sort.xlsx");
    await writeXlsx({ sourceHeader: baseHeader, entries: [e2024, e2026, e2025], sources: null, outputPath: out });
    const wb = await load(out);
    const sheet = wb.worksheets[0];
    // File name is column 2 in the new order; rows 2..4 should be newest first
    expect(sheet.getRow(2).getCell(2).value).toBe("b.pdf"); // 2026
    expect(sheet.getRow(3).getCell(2).value).toBe("c.pdf"); // 2025
    expect(sheet.getRow(4).getCell(2).value).toBe("a.pdf"); // 2024
  });

  it("places Page Count in column C (3rd) so vendors see it without scrolling", async () => {
    const out = path.join(tmpDir, "pages-col-c.xlsx");
    await writeXlsx({ sourceHeader: baseHeader, entries: [pdfEntry], sources: null, outputPath: out });
    const wb = await load(out);
    const sheet = wb.worksheets[0];
    expect(sheet.getRow(1).getCell(3).value).toBe("Page Count");
    expect(sheet.getRow(2).getCell(3).value).toBe(42);
  });

  it("makes the Public URL cell a clickable hyperlink", async () => {
    const out = path.join(tmpDir, "linkify.xlsx");
    await writeXlsx({ sourceHeader: baseHeader, entries: [pdfEntry], sources: null, outputPath: out });
    const wb = await load(out);
    const sheet = wb.worksheets[0];
    const urlCell = sheet.getRow(2).getCell(4); // Public URL is col 4
    expect(urlCell.value).toMatchObject({ hyperlink: expect.stringMatching(/^https?:\/\//) });
    expect(urlCell.value.text).toMatch(/^https?:\/\//);
  });

  // v1.42.1 — the Audit Report cell holds the audit.icjia.app report URL; a
  // plain string is NOT clickable in a real .xlsx (Excel only auto-links as
  // you type, not on open), so it must be a hyperlink cell like Public URL.
  // v1.43.0 — Audit Report moved from col 9 to col 11 (Score + Grade sit
  // between Remediation Score and the report link).
  it("makes the Audit Report cell a clickable hyperlink (v1.42.1)", async () => {
    const audited = { ...pdfEntry, audit: { score: 88, reportUrl: "https://audit.icjia.app/report/abc123" } };
    const out = path.join(tmpDir, "audit-link.xlsx");
    await writeXlsx({ sourceHeader: baseHeader, entries: [audited], sources: null, outputPath: out });
    const wb = await load(out);
    const sheet = wb.worksheets[0];
    expect(sheet.getRow(1).getCell(11).value).toBe("Audit Report");
    expect(sheet.getRow(2).getCell(11).value).toEqual({
      text: "https://audit.icjia.app/report/abc123",
      hyperlink: "https://audit.icjia.app/report/abc123",
    });
  });

  it("leaves a non-URL Audit Report value ('Unavailable') as plain text (v1.42.1)", async () => {
    const errored = { ...pdfEntry, audit: { error: "http 422" } };
    const out = path.join(tmpDir, "audit-unavailable.xlsx");
    await writeXlsx({ sourceHeader: baseHeader, entries: [errored], sources: null, outputPath: out });
    const wb = await load(out);
    expect(wb.worksheets[0].getRow(2).getCell(11).value).toBe("Unavailable");
  });

  // v1.43.0 — sortable per-file score columns. The combined "B/88" string
  // can't sort numerically in Excel, so the number and the letter each get
  // their own column: "Score (0-100)" as a REAL numeric cell and "Grade" as
  // a plain letter. v1.54.0 widened scoring to docx/xlsx/pptx — unscoreable
  // rows (legacy Office, ODF, RTF), errored rows, and pending rows stay
  // blank so Excel pushes them to the bottom of either sort direction.
  describe("sortable Score + Grade columns (v1.43.0)", () => {
    const scored = { ...pdfEntry, audit: { score: 88, grade: "B", reportUrl: "https://audit.icjia.app/report/abc123" } };

    it("orders the columns: Remediation Score, Score (0-100), Grade, Audit Report", async () => {
      const out = path.join(tmpDir, "score-cols.xlsx");
      await writeXlsx({ sourceHeader: baseHeader, entries: [scored], sources: null, outputPath: out });
      const wb = await load(out);
      const header = wb.worksheets[0].getRow(1);
      expect(header.getCell(8).value).toBe("Remediation Score");
      expect(header.getCell(9).value).toBe("Score (0-100)");
      expect(header.getCell(10).value).toBe("Grade");
      expect(header.getCell(11).value).toBe("Audit Report");
    });

    it("writes the score as a real number and the grade as its letter", async () => {
      const out = path.join(tmpDir, "score-num.xlsx");
      await writeXlsx({ sourceHeader: baseHeader, entries: [scored], sources: null, outputPath: out });
      const wb = await load(out);
      const row = wb.worksheets[0].getRow(2);
      expect(row.getCell(9).value).toBe(88);
      expect(typeof row.getCell(9).value).toBe("number");
      expect(row.getCell(10).value).toBe("B");
    });

    it("fills Score and Grade for scored Office files, blank for legacy", async () => {
      const scoredDocx = { ...docxEntry, audit: { score: 79, grade: "C" } };
      const legacyXls = {
        ...docxEntry,
        path: "old.xls",
        filename: "old.xls",
        extension: "xls",
        category: "legacy-office",
        sha256: "cd".repeat(32),
        modifiedAt: "2026-01-01T00:00:00.000Z", // older than scoredDocx — sorts to row 3
      };
      const out = path.join(tmpDir, "score-office.xlsx");
      await writeXlsx({ sourceHeader: baseHeader, entries: [scoredDocx, legacyXls], sources: null, outputPath: out });
      const wb = await load(out);
      const sheet = wb.worksheets[0];
      expect(sheet.getRow(2).getCell(9).value).toBe(79);
      expect(sheet.getRow(2).getCell(10).value).toBe("C");
      expect(sheet.getRow(3).getCell(9).value).toBeNull();
      expect(sheet.getRow(3).getCell(10).value).toBeNull();
    });
  });

  it("Total SUM row uses the new Page Count column position (C)", async () => {
    const out = path.join(tmpDir, "sum-c.xlsx");
    const entries = [
      { ...pdfEntry, introspection: { kind: "pdf", pageCount: 10 } },
      { ...pdfEntry, path: "b.pdf", filename: "b.pdf", introspection: { kind: "pdf", pageCount: 20 } },
    ];
    await writeXlsx({ sourceHeader: baseHeader, entries, sources: null, outputPath: out, sheetName: "PDFs" });
    // Use writeXlsxMultiSheet path to exercise totals — single-sheet writeXlsx
    // doesn't take totals; reuse same logic by routing through the multi-sheet helper
    const outMulti = path.join(tmpDir, "sum-c-multi.xlsx");
    await writeXlsxMultiSheet({
      outputPath: outMulti,
      sheets: [{ name: "PDFs", sourceHeader: baseHeader, entries, sources: null, totals: { pageCount: true } }],
    });
    const wb = await load(outMulti);
    const sheet = wb.worksheets[0];
    const totalRow = sheet.getRow(4); // header + 2 data + 1 total
    expect(totalRow.getCell(1).value).toBe("TOTAL");
    const sumCell = totalRow.getCell(3); // Page Count is col C
    const resolved = typeof sumCell.value === "object" ? sumCell.value.result : sumCell.value;
    expect(resolved).toBe(30);
    expect(sumCell.value.formula).toMatch(/^SUM\(C2:C\d+\)$/);
  });
});

describe("writeXlsxMultiSheet", () => {
  it("writes one sheet per bucket and uses provided sheet names", async () => {
    const out = path.join(tmpDir, "multi.xlsx");
    await writeXlsxMultiSheet({
      outputPath: out,
      sheets: [
        { name: "PDFs", sourceHeader: baseHeader, entries: [pdfEntry], sources: null },
        { name: "DOCX", sourceHeader: baseHeader, entries: [docxEntry], sources: null },
      ],
    });
    const wb = await load(out);
    expect(wb.worksheets.length).toBe(2);
    expect(wb.worksheets[0].name).toBe("PDFs");
    expect(wb.worksheets[1].name).toBe("DOCX");
  });

  it("skips sheets with zero entries", async () => {
    const out = path.join(tmpDir, "skip-empty.xlsx");
    await writeXlsxMultiSheet({
      outputPath: out,
      sheets: [
        { name: "PDFs", sourceHeader: baseHeader, entries: [pdfEntry], sources: null },
        { name: "Empty bucket", sourceHeader: baseHeader, entries: [], sources: null },
      ],
    });
    const wb = await load(out);
    expect(wb.worksheets.length).toBe(1);
    expect(wb.worksheets[0].name).toBe("PDFs");
  });

  it("appends a SUM total row when sheet has totals: { pageCount: true } and entries contain PDFs", async () => {
    const out = path.join(tmpDir, "totals.xlsx");
    const entries = [
      { ...pdfEntry, introspection: { kind: "pdf", pageCount: 10 } },
      { ...pdfEntry, path: "b.pdf", filename: "b.pdf", introspection: { kind: "pdf", pageCount: 20 } },
      { ...pdfEntry, path: "c.pdf", filename: "c.pdf", introspection: { kind: "pdf", pageCount: 30 } },
    ];
    await writeXlsxMultiSheet({
      outputPath: out,
      sheets: [
        { name: "PDFs", sourceHeader: baseHeader, entries, sources: null, totals: { pageCount: true } },
      ],
    });
    const wb = await load(out);
    const sheet = wb.worksheets[0];
    const totalRow = sheet.getRow(2 + entries.length); // header + N data rows + total row
    let pageCol = -1;
    sheet.getRow(1).eachCell((cell, col) => { if (cell.value === "Page Count") pageCol = col; });
    const totalCell = totalRow.getCell(pageCol);
    // exceljs may resolve the formula or store it; either way the result equals 60.
    const value = typeof totalCell.value === "object" ? totalCell.value.result : totalCell.value;
    expect(value).toBe(60);
  });

  // v1.29.0 — a sheet config may instead carry { name, columns, rows } (the
  // writeXlsxFromRows shape) so one workbook can mix entry-based file tabs
  // with a rows-based Pages tab.
  it("v1.29.0 — mixes entry-based sheets with rows-based sheets in one workbook", async () => {
    const out = path.join(tmpDir, "mixed.xlsx");
    await writeXlsxMultiSheet({
      outputPath: out,
      sheets: [
        { name: "PDFs", sourceHeader: baseHeader, entries: [pdfEntry], sources: null },
        {
          name: "Pages",
          columns: [
            { key: "pageUrl", label: "Page", type: "url" },
            { key: "files", label: "Files" },
          ],
          rows: [{ pageUrl: "https://x.gov/about", files: "report.pdf" }],
        },
      ],
    });
    const wb = await load(out);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["PDFs", "Pages"]);
    const pages = wb.worksheets[1];
    expect(pages.getRow(1).values.slice(1)).toEqual(["Page", "Files"]);
    const urlCell = pages.getRow(2).getCell(1);
    expect(urlCell.value).toEqual({ text: "https://x.gov/about", hyperlink: "https://x.gov/about" });
    expect(pages.getRow(2).getCell(2).value).toBe("report.pdf");
  });

  it("v1.29.0 — skips rows-based sheets with zero rows", async () => {
    const out = path.join(tmpDir, "mixed-empty.xlsx");
    await writeXlsxMultiSheet({
      outputPath: out,
      sheets: [
        { name: "PDFs", sourceHeader: baseHeader, entries: [pdfEntry], sources: null },
        { name: "Pages", columns: [{ key: "a", label: "A" }], rows: [] },
      ],
    });
    const wb = await load(out);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["PDFs"]);
  });
});
