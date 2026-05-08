export { runScan } from "./commands/scan.js";
export {
  headerSchema,
  entrySchema,
  footerSchema,
  pdfIntrospectionSchema,
  docxIntrospectionSchema,
  xlsxIntrospectionSchema,
  legacyOfficeIntrospectionSchema,
  isCompleteInventory,
  SCHEMA_VERSION,
} from "./schema/inventory.js";
export { introspect } from "./introspect/index.js";
export { introspectPdf } from "./introspect/pdf.js";
export { introspectDocx } from "./introspect/docx.js";
export { introspectXlsx } from "./introspect/xlsx.js";
export { introspectLegacyOffice } from "./introspect/office-legacy.js";
export { computeFilenameFlags } from "./flag/filename.js";
export { FILECAP_VERSION } from "./version.js";
