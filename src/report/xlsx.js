import ExcelJS from "exceljs";
import { CSV_COLUMNS, buildRow } from "./csv.js";

/**
 * Write a single-sheet XLSX workbook from a parsed inventory.
 *
 * The header row uses CSV_COLUMNS labels, is frozen and bold, and the data
 * area gets autofilter dropdowns. Page Count cells are real numbers so
 * Excel can SUM/sort/filter numerically. SHA-256 is stored as a plain
 * string (no `="..."` text-formula wrapper — that was a CSV-only hack to
 * keep Excel from interpreting long hashes as scientific notation; in
 * XLSX we can declare the cell type and the problem disappears).
 *
 * @param {object} args
 * @param {object} args.sourceHeader - the inventory's header object
 * @param {Array}  args.entries      - the inventory's entries
 * @param {Array|null} args.sources  - sources[] array (consolidated mode); null for single
 * @param {string} args.outputPath   - absolute path to write the .xlsx
 * @param {string} [args.sheetName]  - tab name (default "Inventory")
 * @returns {Promise<void>}
 */
export async function writeXlsx({ sourceHeader, entries, sources, outputPath, sheetName = "Inventory" }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "filecap";
  const sheet = wb.addWorksheet(safeSheetName(sheetName));
  writeSheetContents({ sheet, sourceHeader, entries, sources });
  await wb.xlsx.writeFile(outputPath);
}

/**
 * Write a multi-sheet XLSX workbook, one tab per bucket. Use this for the
 * fleet master spreadsheet (audit.xlsx with PDFs / DOCX / XLSX / PPTX /
 * Legacy Office tabs) and the per-site spreadsheets (<site>.xlsx with the
 * same tab structure scoped to one site).
 *
 * Empty buckets are skipped so the workbook only contains tabs that hold
 * data — vendors don't have to click through empty sheets.
 *
 * v1.29.0 — a sheet config may instead carry the writeXlsxFromRows shape
 * ({ name, columns, rows }) so one workbook can mix inventory-entry tabs
 * with plain rows tabs (the per-site Pages tab). Rows-based sheets with
 * zero rows are skipped like empty buckets.
 *
 * @param {object} args
 * @param {string} args.outputPath
 * @param {Array<object>} args.sheets - one entry per tab:
 *   { name, sourceHeader, entries, sources, totals? }  (inventory entries)
 *   { name, columns, rows }                            (plain rows)
 *   totals.pageCount = true appends a bottom SUM row over the Page Count column.
 * @returns {Promise<void>}
 */
export async function writeXlsxMultiSheet({ outputPath, sheets }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "filecap";
  for (const s of sheets) {
    if (Array.isArray(s.columns)) {
      if (!s.rows || s.rows.length === 0) continue;
      const ws = wb.addWorksheet(safeSheetName(s.name));
      writeRowsSheet(ws, s.columns, s.rows);
      continue;
    }
    if (!s.entries || s.entries.length === 0) continue;
    const ws = wb.addWorksheet(safeSheetName(s.name));
    writeSheetContents({
      sheet: ws,
      sourceHeader: s.sourceHeader,
      entries: s.entries,
      sources: s.sources,
      totals: s.totals,
    });
  }
  await wb.xlsx.writeFile(outputPath);
}

/**
 * Generic single-sheet XLSX writer for reports that don't fit the CSV_COLUMNS
 * shape — duplicates, orphans, audit errors. Takes a plain columns array
 * `[{ key, label, type? }]` and an array of row objects (`row[col.key]`).
 *
 * @param {object} args
 * @param {string} args.outputPath
 * @param {string} [args.sheetName]
 * @param {Array<{ key: string, label: string, type?: "string"|"number"|"date" }>} args.columns
 * @param {Array<object>} args.rows
 * @returns {Promise<void>}
 */
export async function writeXlsxFromRows({ outputPath, sheetName = "Sheet1", columns, rows }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "filecap";
  const sheet = wb.addWorksheet(safeSheetName(sheetName));
  writeRowsSheet(sheet, columns, rows);
  await wb.xlsx.writeFile(outputPath);
}

/**
 * Multi-sheet variant of writeXlsxFromRows — one tab per
 * `{ sheetName, columns, rows }` entry. Used by the /sites roster workbook
 * (a "Content sites" tab + a "Tooling sites" tab). Unlike writeXlsxMultiSheet
 * (which is inventory/entry shaped), this takes the same plain
 * `columns`/`rows` shape as writeXlsxFromRows. Sheets with no rows still get a
 * header-only tab so the workbook structure is predictable.
 *
 * @param {object} args
 * @param {string} args.outputPath
 * @param {Array<{ sheetName: string, columns: Array, rows: Array }>} args.sheets
 * @returns {Promise<void>}
 */
export async function writeXlsxRowsMultiSheet({ outputPath, sheets }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "filecap";
  for (const s of sheets) {
    const ws = wb.addWorksheet(safeSheetName(s.sheetName ?? "Sheet"));
    writeRowsSheet(ws, s.columns, s.rows ?? []);
  }
  await wb.xlsx.writeFile(outputPath);
}

// Shared body for the plain columns/rows writers above. One sheet: bold frozen
// header, optional URL-typed hyperlink cells, autofilter, autofit widths.
function writeRowsSheet(sheet, columns, rows) {
  sheet.getRow(1).values = columns.map((c) => c.label);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  rows.forEach((row, i) => {
    const dataRow = sheet.getRow(2 + i);
    columns.forEach((col, j) => {
      const raw = row[col.key];
      const cell = dataRow.getCell(j + 1);
      if (col.type === "url" && typeof raw === "string" && /^https?:\/\//i.test(raw)) {
        // v1.20.0 — explicit URL columns become clickable hyperlinks.
        cell.value = { text: raw, hyperlink: raw };
        cell.font = HYPERLINK_FONT;
      } else {
        cell.value = normalizeCellValue(raw, col.type);
      }
    });
  });
  const lastDataRow = Math.max(1, rows.length + 1);
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to:   { row: lastDataRow, column: columns.length },
  };
  for (let c = 1; c <= columns.length; c++) {
    const col = sheet.getColumn(c);
    let max = String(columns[c - 1].label).length;
    for (let r = 2; r <= lastDataRow; r++) {
      const v = sheet.getRow(r).getCell(c).value;
      // URL cells hold a { text, hyperlink } object — size by the visible text.
      let s = "";
      if (v === null || v === undefined) s = "";
      else if (typeof v === "object" && typeof v.text === "string") s = v.text;
      else s = String(v);
      if (s.length > max) max = s.length;
    }
    col.width = Math.min(60, Math.max(10, max + 2));
  }
}

function normalizeCellValue(v, type) {
  if (v === null || v === undefined || v === "") return null;
  if (type === "number") {
    if (typeof v === "number") return v;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return v;
}

// ── internals ────────────────────────────────────────────────────────────────

// v1.20.0 — XLSX column order is intentionally DIFFERENT from CSV_COLUMNS.
// Managers and vendors skim the leftmost few columns; what they care about
// (newest first) is date, filename, page count, the file's public URL, and
// where it's linked from. Everything else slides right. CSV stays in its
// historical column order — only XLSX presents this manager-friendly view.
export const XLSX_COLUMN_ORDER = [
  "modifiedAt",     // Date published (rows are also pre-sorted by this DESC)
  "filename",
  "pageCount",
  "publicUrl",      // hyperlinked
  "referenced",     // hyperlinked (first URL)
  "category",
  "sizeBytes",
  "auditScore",
  "siteName",
  "serverName",
  "extension",
  "duplicateOf",
  "path",
  "absolutePath",
  "sha256",
  "deleteFlag",
  "notes",
];

// Build the index map once (XLSX position → CSV_COLUMNS source position).
// Verified at module load so a typo in XLSX_COLUMN_ORDER throws early.
const XLSX_COLUMNS = XLSX_COLUMN_ORDER.map((name) => {
  const c = CSV_COLUMNS.find((x) => x.name === name);
  if (!c) throw new Error(`XLSX_COLUMN_ORDER references unknown column: ${name}`);
  return c;
});
const XLSX_SOURCE_IDX = XLSX_COLUMN_ORDER.map((name) =>
  CSV_COLUMNS.findIndex((x) => x.name === name),
);
const XLSX_COL_BY_NAME = new Map(XLSX_COLUMN_ORDER.map((n, i) => [n, i + 1])); // 1-indexed

const HYPERLINK_FONT = { color: { argb: "FF0563C1" }, underline: "single" };

function writeSheetContents({ sheet, sourceHeader, entries, sources, totals }) {
  const isConsolidated = sourceHeader.kind === "filecap-consolidated-header";
  const sourceMap = new Map();
  if (isConsolidated && sources) {
    for (const s of sources) sourceMap.set(s.serverName, s);
  }

  // Header row — labels in XLSX_COLUMN_ORDER, not CSV_COLUMNS order.
  sheet.getRow(1).values = XLSX_COLUMNS.map((c) => c.label);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  // v1.20.0 — pre-sort rows by Date published descending (newest first). ISO
  // 8601 sorts lexicographically. Missing/empty modifiedAt sorts last.
  const sorted = [...entries].sort((a, b) => {
    const ma = a?.modifiedAt || "";
    const mb = b?.modifiedAt || "";
    if (!ma && !mb) return 0;
    if (!ma) return 1;
    if (!mb) return -1;
    return mb.localeCompare(ma);
  });

  // Source-row index lookups
  const SHA_IDX = CSV_COLUMNS.findIndex((c) => c.name === "sha256");
  const PAGE_COUNT_IDX = CSV_COLUMNS.findIndex((c) => c.name === "pageCount");
  const PUBLIC_URL_COL = XLSX_COL_BY_NAME.get("publicUrl");
  const REFERENCED_COL = XLSX_COL_BY_NAME.get("referenced");

  let lastDataRow = 1;
  sorted.forEach((entry, i) => {
    const csvRow = buildRow({ entry, sourceHeader, sourceMap, isConsolidated });

    // SHA-256: strip the CSV-only `="<hash>"` excel-formula wrapper.
    if (SHA_IDX >= 0) {
      const v = csvRow[SHA_IDX];
      if (typeof v === "string") {
        const m = v.match(/^="([^"]*)"$/);
        if (m) csvRow[SHA_IDX] = m[1];
      }
    }

    // Page Count: empty string → null so exceljs leaves the cell blank.
    if (PAGE_COUNT_IDX >= 0 && csvRow[PAGE_COUNT_IDX] === "") {
      csvRow[PAGE_COUNT_IDX] = null;
    }

    // Reproject CSV row → XLSX order.
    const xlsxRow = XLSX_SOURCE_IDX.map((srcIdx) => csvRow[srcIdx]);
    const dataRow = sheet.getRow(2 + i);
    dataRow.values = xlsxRow;
    lastDataRow = 2 + i;

    // Linkify Public URL — the cell becomes a clickable hyperlink that
    // opens the file's public URL. Skip when the cell is empty.
    if (PUBLIC_URL_COL) {
      const cell = dataRow.getCell(PUBLIC_URL_COL);
      const v = typeof cell.value === "string" ? cell.value : "";
      if (/^https?:\/\//i.test(v)) {
        cell.value = { text: v, hyperlink: v };
        cell.font = HYPERLINK_FONT;
      }
    }

    // Linkify Page References — when the cell contains URLs (newline-
    // joined), the cell's hyperlink target is the FIRST URL but the
    // display still shows all of them so a manager can copy any of them.
    // The cell wraps so multi-URL lists are readable.
    if (REFERENCED_COL) {
      const cell = dataRow.getCell(REFERENCED_COL);
      const v = typeof cell.value === "string" ? cell.value : "";
      if (/^https?:\/\//i.test(v)) {
        const firstUrl = v.split("\n").find((s) => /^https?:\/\//i.test(s)) || v;
        cell.value = { text: v, hyperlink: firstUrl };
        cell.font = HYPERLINK_FONT;
        cell.alignment = { vertical: "top", wrapText: true };
      }
    }
  });

  // Bottom SUM total row over the Page Count column. Only when explicitly
  // requested (PDF sheet) AND the sheet has data.
  if (totals?.pageCount && sorted.length > 0) {
    const pageCol1 = XLSX_COL_BY_NAME.get("pageCount");
    const totalRowNum = lastDataRow + 1;
    const totalRow = sheet.getRow(totalRowNum);
    totalRow.getCell(1).value = "TOTAL";
    totalRow.getCell(1).font = { bold: true };
    const colLetter = excelColLetter(pageCol1);
    const formula = `SUM(${colLetter}2:${colLetter}${lastDataRow})`;
    const result = sorted.reduce((s, e) => {
      const pc = e?.introspection?.pageCount;
      return s + (typeof pc === "number" && pc >= 0 ? pc : 0);
    }, 0);
    totalRow.getCell(pageCol1).value = { formula, result };
    totalRow.getCell(pageCol1).font = { bold: true };
  }

  // Autofilter over header + data rows only (excludes any TOTAL row so the
  // dropdown uniques stay clean).
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to:   { row: Math.max(lastDataRow, 1), column: XLSX_COLUMNS.length },
  };

  // Column widths — approximate autofit from observed content length.
  for (let c = 1; c <= XLSX_COLUMNS.length; c++) {
    const col = sheet.getColumn(c);
    let maxLen = String(XLSX_COLUMNS[c - 1].label).length;
    for (let r = 2; r <= lastDataRow; r++) {
      const v = sheet.getRow(r).getCell(c).value;
      if (v === null || v === undefined) continue;
      let s = "";
      if (typeof v === "object" && v !== null) {
        if (v.formula) s = String(v.result ?? "");
        else if (v.text) s = String(v.text);
        else s = "";
      } else {
        s = String(v);
      }
      // Long multi-line referenced URLs would blow out the width — clamp
      // by considering only the first line's length for sizing purposes.
      const sized = s.includes("\n") ? s.split("\n")[0] : s;
      if (sized.length > maxLen) maxLen = sized.length;
    }
    col.width = Math.min(60, Math.max(10, maxLen + 2));
  }
}

function safeSheetName(name) {
  // Excel sheet name limits: max 31 chars; cannot contain : \ / ? * [ ]
  return String(name).replace(/[:\\/?*[\]]/g, "_").slice(0, 31);
}

function excelColLetter(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
