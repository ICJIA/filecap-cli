export { runScan } from "./commands/scan.js";
export { runRollup } from "./commands/rollup.js";
export { runReport } from "./commands/report.js";
export {
  headerSchema,
  entrySchema,
  footerSchema,
  pdfIntrospectionSchema,
  docxIntrospectionSchema,
  xlsxIntrospectionSchema,
  legacyOfficeIntrospectionSchema,
  consolidatedHeaderSchema,
  consolidatedEntrySchema,
  consolidatedFooterSchema,
  isCompleteInventory,
  SCHEMA_VERSION,
} from "./schema/inventory.js";
export { introspect } from "./introspect/index.js";
export { introspectPdf } from "./introspect/pdf.js";
export { introspectDocx } from "./introspect/docx.js";
export { introspectXlsx } from "./introspect/xlsx.js";
export { introspectLegacyOffice } from "./introspect/office-legacy.js";
export { computeFilenameFlags } from "./flag/filename.js";
export { rollupInventories } from "./rollup/merge.js";
export { pickCanonical } from "./rollup/canonical.js";
export { writeCsv, CSV_COLUMNS } from "./report/csv.js";
export { writeSummary } from "./report/summary.js";
export {
  writeLargestFiles,
  writeFlaggedFilenames,
  writeDuplicateHashes,
  writePdfImageOnly,
} from "./report/flagged.js";
export { humanizeBytes, csvCell } from "./report/format.js";
export { FILECAP_VERSION } from "./version.js";
