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
