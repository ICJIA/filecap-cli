import { z } from "zod";

export const SCHEMA_VERSION = 1;

const isoDate = z.string().datetime({ offset: false });

const optionsSchema = z.object({
  introspect: z.boolean(),
  hash: z.boolean(),
  maxIntrospectMb: z.number().int().nonnegative(),
  concurrency: z.number().int().positive(),
});

export const headerSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  kind: z.literal("filecap-inventory-header"),
  metadata: z.object({
    serverName: z.string(),
    hostname: z.string(),
    serverIp: z.string(),
    scannedPath: z.string(),
    scannedAt: isoDate,
    filecapVersion: z.string(),
    nodeVersion: z.string(),
    options: optionsSchema,
  }),
});

const categoryEnum = z.enum([
  "pdf",
  "office-document",
  "spreadsheet",
  "presentation",
  "image",
  "archive",
  "text",
  "web",
  "audio-video",
  "other",
]);

export const pdfIntrospectionSchema = z.object({
  kind: z.literal("pdf"),
  pageCount: z.number().int().nonnegative(),
  hasTextLayer: z.boolean(),
  textLayerCoverage: z.number().min(0).max(1).optional(),
  isImageOnly: z.boolean(),
  hasOutline: z.boolean().optional(),
  hasTags: z.boolean(),
  hasFormFields: z.boolean(),
  hasSignatures: z.boolean(),
  encrypted: z.boolean(),
  isLinearized: z.boolean().optional(),
  pdfVersion: z.string().optional(),
  documentLanguage: z.string().optional(),
  producer: z.string().optional(),
  creator: z.string().optional(),
  creationDate: isoDate.optional(),
});

export const docxIntrospectionSchema = z.object({
  kind: z.literal("docx"),
  hasHeadings: z.boolean(),
  imageCount: z.number().int().nonnegative(),
  altTextCoverage: z.number().min(0).max(1).optional(),
  tableCount: z.number().int().nonnegative(),
  tablesHaveHeaders: z.boolean().optional(),
  hyperlinkCount: z.number().int().nonnegative(),
  vagueLinkCount: z.number().int().nonnegative(),
  documentLanguage: z.string().optional(),
});

export const xlsxIntrospectionSchema = z.object({
  kind: z.literal("xlsx"),
  sheetCount: z.number().int().nonnegative(),
  sheetNames: z.array(z.string()),
  defaultSheetNameCount: z.number().int().nonnegative(),
  hasHeaderRows: z.boolean(),
  mergedCellCount: z.number().int().nonnegative(),
  hasCharts: z.boolean(),
  hasImages: z.boolean(),
});

export const legacyOfficeIntrospectionSchema = z.object({
  kind: z.literal("office-legacy"),
  format: z.enum(["doc", "ppt", "xls"]),
});

export const entrySchema = z.object({
  path: z.string(),
  absolutePath: z.string(),
  filename: z.string(),
  extension: z.string(),
  category: categoryEnum,
  remediable: z.boolean(),
  sizeBytes: z.number().int().nonnegative(),
  modifiedAt: isoDate,
  sha256: z.string(),
  flags: z.array(z.string()),
  introspection: z
    .discriminatedUnion("kind", [
      pdfIntrospectionSchema,
      docxIntrospectionSchema,
      xlsxIntrospectionSchema,
      legacyOfficeIntrospectionSchema,
    ])
    .optional(),
});

export const footerSchema = z.object({
  kind: z.literal("filecap-inventory-footer"),
  stats: z.object({
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    scanDurationMs: z.number().int().nonnegative(),
    introspectionFailures: z.number().int().nonnegative(),
    permissionDenials: z.number().int().nonnegative(),
  }),
});

/**
 * Returns true if the NDJSON text represents a complete inventory (last
 * non-empty line is a footer). Used by downstream consumers (Phase 5 rollup,
 * Phase 6 report) to detect interrupted scans.
 *
 * Accepts both single-instance footers (`filecap-inventory-footer`) and
 * consolidated footers (`filecap-consolidated-footer`).
 */
export function isCompleteInventory(text) {
  const lines = text.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return false;
  let lastLine;
  try {
    lastLine = JSON.parse(lines[lines.length - 1]);
  } catch {
    return false;
  }
  return (
    lastLine.kind === "filecap-inventory-footer" ||
    lastLine.kind === "filecap-consolidated-footer"
  );
}
