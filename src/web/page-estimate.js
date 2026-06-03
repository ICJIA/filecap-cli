/**
 * Average pages used to estimate remediation workload for non-PDF formats
 * whose page count is not extracted during scan. PDFs always use the
 * measured pdfjs `introspection.pageCount` — never an estimate.
 *
 * Rationale (May 2026): vendors quote per page, so a hero number that
 * advertises only measured PDF pages undersells the workload by ~4%.
 * The averages below are intentionally conservative — DOCX skew low,
 * PPTX matches typical agency decks, XLSX counts as one workbook (the
 * remediation unit), legacy Office splits the difference.
 */
export const PAGE_ESTIMATES = Object.freeze({
  docx: 7,
  pptx: 20,
  xlsx: 1,
  legacyOffice: 5,
});

/**
 * Inclusive page-count estimate for one site (or the fleet).
 *
 * Pure function — does not read the inventory or do any I/O. Callers
 * stream the inventory once, tally per-category counts plus measured
 * PDF pages, and pass the totals here.
 *
 * @param {object} counts
 * @param {number} [counts.pdfPagesMeasured=0] - sum of introspection.pageCount for PDFs
 * @param {number} [counts.docxCount=0]        - office-document category file count
 * @param {number} [counts.pptxCount=0]        - presentation category file count
 * @param {number} [counts.xlsxCount=0]        - spreadsheet category file count
 * @param {number} [counts.legacyOfficeCount=0] - legacy-office category file count
 * @returns {number} estimated total remediation pages
 */
export function estimateRemediablePages({
  pdfPagesMeasured = 0,
  docxCount = 0,
  pptxCount = 0,
  xlsxCount = 0,
  legacyOfficeCount = 0,
} = {}) {
  return (
    pdfPagesMeasured
    + docxCount * PAGE_ESTIMATES.docx
    + pptxCount * PAGE_ESTIMATES.pptx
    + xlsxCount * PAGE_ESTIMATES.xlsx
    + legacyOfficeCount * PAGE_ESTIMATES.legacyOffice
  );
}
