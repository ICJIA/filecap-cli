import fs from "node:fs/promises";
import ExcelJS from "exceljs";
import JSZip from "jszip";

const DEFAULT_SHEET_NAME_RE = /^Sheet\d+$/i;

// Security note (FC-2026-013): exceljs and jszip both parse the XLSX zip
// in memory without extracting entries to disk, preventing zip-slip path
// traversal attacks from maliciously crafted XLSX files. Keep using the
// in-memory APIs (wb.xlsx.load / JSZip.loadAsync) — never an
// extract-to-disk API.

// v1.39.0 (F4): chart parts live at xl/charts/chart<N>.xml (classic) or
// xl/charts/chartEx<N>.xml (extended chart types, Excel 2016+).
const CHART_PART_RE = /^xl\/charts\/chart(?:Ex)?\d+\.xml$/;

/**
 * True when the raw XLSX zip contains at least one chart part. exceljs
 * never surfaces charts (ws.model.charts is always undefined), so this is
 * the only reliable detection. Exported for unit testing.
 *
 * @param {Buffer} buffer - the XLSX file contents
 * @returns {Promise<boolean>}
 */
export async function zipHasCharts(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files).some((name) => CHART_PART_RE.test(name));
}

/**
 * Introspect an XLSX file via exceljs.
 *
 * Throws on parse failure (corrupt file, non-XLSX content, etc.). The caller
 * (the introspection dispatcher) catches and converts to "omit introspection
 * key" per the empty-on-failure rule.
 *
 * @param {string} filePath
 * @returns {Promise<object>} introspection block per xlsxIntrospectionSchema
 */
export async function introspectXlsx(filePath) {
  // Single read pass: the buffer feeds both the exceljs parse and the
  // raw-zip chart detection.
  const buffer = await fs.readFile(filePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const sheetNames = wb.worksheets.map((ws) => ws.name);
  const sheetCount = wb.worksheets.length;
  const defaultSheetNameCount = sheetNames.filter((n) =>
    DEFAULT_SHEET_NAME_RE.test(n),
  ).length;

  let hasHeaderRows = false;
  let mergedCellCount = 0;
  let hasCharts = false;
  let hasImages = false;

  for (const ws of wb.worksheets) {
    // Header-row heuristic: row 1 has at least one cell with bold font.
    if (!hasHeaderRows) {
      const row1 = ws.getRow(1);
      if (row1 && row1.cellCount > 0) {
        let row1HasBold = false;
        row1.eachCell({ includeEmpty: false }, (cell) => {
          if (cell.font && cell.font.bold) row1HasBold = true;
        });
        if (row1HasBold) hasHeaderRows = true;
      }
    }
    // Merged cells: ws.model.merges is an array of merge ranges.
    if (Array.isArray(ws.model?.merges)) {
      mergedCellCount += ws.model.merges.length;
    }
    // Images
    try {
      const wsImages = ws.getImages?.();
      if (Array.isArray(wsImages) && wsImages.length > 0) {
        hasImages = true;
      }
    } catch {
      // ignore — getImages may not be available on all sheet variants
    }
  }

  // Charts: detect via the raw zip (see zipHasCharts). A detection hiccup
  // must not void the whole introspection — default to false, matching the
  // per-feature tolerance used for getImages above.
  try {
    hasCharts = await zipHasCharts(buffer);
  } catch {
    hasCharts = false;
  }

  const title = wb.title ? String(wb.title).trim() || null : null;
  const author = wb.creator ? String(wb.creator).trim() || null : null;

  let totalCells = 0;
  for (const ws of wb.worksheets) {
    const rows = ws.actualRowCount ?? ws.rowCount ?? 0;
    const cols = ws.actualColumnCount ?? ws.columnCount ?? 0;
    totalCells += rows * cols;
  }

  return {
    kind: "xlsx",
    sheetCount,
    sheetNames,
    defaultSheetNameCount,
    hasHeaderRows,
    mergedCellCount,
    hasCharts,
    hasImages,
    title,
    author,
    totalCells,
  };
}
