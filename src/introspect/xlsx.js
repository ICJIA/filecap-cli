import ExcelJS from "exceljs";

const DEFAULT_SHEET_NAME_RE = /^Sheet\d+$/i;

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
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

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

  // Charts: exceljs surfaces them inconsistently. Check worksheet model.
  for (const ws of wb.worksheets) {
    const charts = ws.model?.charts;
    if (Array.isArray(charts) && charts.length > 0) {
      hasCharts = true;
      break;
    }
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
