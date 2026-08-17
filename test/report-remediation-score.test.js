import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";
import { writeCsv, CSV_COLUMNS, formatRemediationScore } from "../src/report/csv.js";
import { writeHtml } from "../src/report/html.js";
import { writeXlsx } from "../src/report/xlsx.js";

// v1.34.0 — per-file Remediation Score column. Management wants the
// audit.icjia.app letter grade + numeric score surfaced directly in the
// deliverable spreadsheets (e.g. "B/88"), alongside the existing report
// link. The score already lives on entry.audit.{grade,score}; this column
// projects it into the CSV / HTML / XLSX. Reverses the v1.19.0 link-only
// decision for the per-file reports (per management request) — the prior
// concern was a *prominent aggregate* grade, not a per-row detail cell.

const header = {
  schemaVersion: 1,
  kind: "filecap-inventory-header",
  metadata: {
    serverName: "archive-prod",
    siteName: "Archive",
    serverIp: "203.0.113.12",
    scannedPath: "/home/forge/files",
    publicUrlBase: "https://archive.icjia.cloud/files",
  },
};

const scoredPdf = {
  path: "case.pdf",
  absolutePath: "/home/forge/files/case.pdf",
  filename: "case.pdf",
  extension: "pdf",
  category: "pdf",
  remediable: true,
  sizeBytes: 4827193,
  modifiedAt: "2026-03-12T09:14:22.000Z",
  sha256: "abc123",
  flags: [],
  introspection: { kind: "pdf", pageCount: 12 },
  audit: {
    score: 88,
    grade: "B",
    reportUrl: "https://audit.icjia.app/report/xyz",
    checkedAt: "2026-06-25T00:00:00.000Z",
    cached: false,
  },
};

const erroredPdf = {
  ...scoredPdf,
  path: "big.pdf",
  absolutePath: "/home/forge/files/big.pdf",
  filename: "big.pdf",
  sha256: "def456",
  audit: { error: "HTTP 413 Payload Too Large for https://archive.icjia.cloud/files/big.pdf" },
};

const docx = {
  path: "policy.docx",
  absolutePath: "/home/forge/files/policy.docx",
  filename: "policy.docx",
  extension: "docx",
  category: "office-document",
  remediable: true,
  sizeBytes: 56789,
  modifiedAt: "2026-02-10T08:30:00.000Z",
  sha256: "cab",
  flags: [],
};

let tmpDir;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-remscore-"));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("CSV_COLUMNS Remediation Score", () => {
  it("declares a remediationScore column labelled 'Remediation Score'", () => {
    const col = CSV_COLUMNS.find((c) => c.name === "remediationScore");
    expect(col).toBeTruthy();
    expect(col.label).toBe("Remediation Score");
    expect(col.csvOnly).toBeFalsy(); // must reach HTML + XLSX too
  });
});

describe("writeCsv Remediation Score column", () => {
  function cell(csv, _entry, _name) {
    const lines = csv.trim().split("\n");
    const headers = lines[0].split(",");
    const idx = headers.indexOf("Remediation Score");
    return { idx, value: lines[1].split(",")[idx] };
  }

  it("renders grade/score as 'B/88' for a scored PDF", () => {
    const csv = writeCsv({ sourceHeader: header, entries: [scoredPdf], sources: null });
    const { idx, value } = cell(csv, scoredPdf, "remediationScore");
    expect(idx).toBeGreaterThan(-1);
    expect(value).toBe("B/88");
  });

  it("labels an errored (e.g. oversized 413) PDF 'Not scored' instead of blank", () => {
    const csv = writeCsv({ sourceHeader: header, entries: [erroredPdf], sources: null });
    const { value } = cell(csv, erroredPdf, "remediationScore");
    expect(value).toBe("Not scored");
  });

  it("leaves the cell blank for a PDF still pending audit (no audit field yet)", () => {
    const pendingPdf = { ...scoredPdf, path: "pending.pdf", filename: "pending.pdf", sha256: "p1" };
    delete pendingPdf.audit;
    const csv = writeCsv({ sourceHeader: header, entries: [pendingPdf], sources: null });
    const { value } = cell(csv, pendingPdf, "remediationScore");
    expect(value).toBe("");
  });

  it("leaves the cell blank for a non-remediable reference file (e.g. image)", () => {
    const image = { ...docx, path: "logo.png", filename: "logo.png", extension: "png", category: "image", remediable: false, sha256: "i1" };
    const csv = writeCsv({ sourceHeader: header, entries: [image], sources: null });
    const { value } = cell(csv, image, "remediationScore");
    expect(value).toBe("");
  });
});

// v1.54.0 — formatRemediationScore widened to every scoreable document
// (pdf/docx/xlsx/pptx); legacy Office + ODF/RTF get an explicit
// "N/A (legacy format)" verdict instead of the old blanket "N/A (Office)".
// These exercise the formatter directly (not through writeCsv) since the
// per-format branching is the contract under test here.
describe("formatRemediationScore — per-format verdicts (v1.54.0)", () => {
  it("formats a scored docx like a scored PDF", () => {
    expect(formatRemediationScore({ category: "office-document", extension: "docx", audit: { score: 79, grade: "C" } })).toBe("C/79");
  });

  it("marks an errored xlsx Not scored", () => {
    expect(formatRemediationScore({ category: "spreadsheet", extension: "xlsx", audit: { error: "HTTP 413 Payload Too Large for https://x" } })).toBe("Not scored");
  });

  it("gives legacy Office and ODF/RTF the legacy-format verdict", () => {
    expect(formatRemediationScore({ category: "legacy-office", extension: "xls" })).toBe("N/A (legacy format)");
    expect(formatRemediationScore({ category: "office-document", extension: "rtf" })).toBe("N/A (legacy format)");
  });

  it("leaves a pending docx blank (no final state to report)", () => {
    expect(formatRemediationScore({ category: "office-document", extension: "docx" })).toBe("");
  });
});

describe("writeHtml Remediation Score column", () => {
  it("includes the column header and the B/88 cell value", async () => {
    const out = path.join(tmpDir, "report.html");
    await writeHtml({ sourceHeader: header, entries: [scoredPdf], sources: null, outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain("Remediation Score");
    expect(html).toContain("B/88");
  });
});

describe("writeXlsx Remediation Score column", () => {
  it("writes a 'Remediation Score' header with 'B/88' for a scored PDF", async () => {
    const out = path.join(tmpDir, "report.xlsx");
    await writeXlsx({ sourceHeader: header, entries: [scoredPdf], sources: null, outputPath: out });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    const sheet = wb.worksheets[0];
    let col = -1;
    sheet.getRow(1).eachCell((c, n) => { if (c.value === "Remediation Score") col = n; });
    expect(col).toBeGreaterThan(0);
    expect(sheet.getRow(2).getCell(col).value).toBe("B/88");
  });
});
