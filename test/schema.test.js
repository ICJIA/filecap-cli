import { describe, it, expect } from "vitest";
import {
  headerSchema,
  entrySchema,
  footerSchema,
  isCompleteInventory,
  pdfIntrospectionSchema,
  SCHEMA_VERSION,
} from "../src/schema/inventory.js";

describe("inventory schemas", () => {
  it("exports SCHEMA_VERSION = 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("validates a well-formed header", () => {
    const header = {
      schemaVersion: 1,
      kind: "filecap-inventory-header",
      metadata: {
        serverName: "strapi-prod-01",
        hostname: "strapi-prod-01.icjia.local",
        serverIp: "10.42.7.18",
        scannedPath: "/var/strapi/uploads",
        scannedAt: "2026-05-08T14:23:11.000Z",
        filecapVersion: "0.1.0",
        nodeVersion: "v20.11.1",
        options: {
          introspect: false,
          hash: true,
          maxIntrospectMb: 200,
          concurrency: 4,
        },
      },
    };
    expect(() => headerSchema.parse(header)).not.toThrow();
  });

  it("rejects a header with the wrong kind", () => {
    const bad = {
      schemaVersion: 1,
      kind: "wrong-kind",
      metadata: {},
    };
    expect(() => headerSchema.parse(bad)).toThrow();
  });

  it("validates a minimal file entry", () => {
    const entry = {
      path: "case.pdf",
      absolutePath: "/var/strapi/uploads/case.pdf",
      filename: "case.pdf",
      extension: "pdf",
      category: "pdf",
      remediable: true,
      sizeBytes: 1024,
      modifiedAt: "2024-01-01T00:00:00.000Z",
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      flags: [],
    };
    expect(() => entrySchema.parse(entry)).not.toThrow();
  });

  it("allows entry without sha256 (when --no-hash)", () => {
    const entry = {
      path: "case.pdf",
      absolutePath: "/var/strapi/uploads/case.pdf",
      filename: "case.pdf",
      extension: "pdf",
      category: "pdf",
      remediable: true,
      sizeBytes: 1024,
      modifiedAt: "2024-01-01T00:00:00.000Z",
      sha256: "",
      flags: [],
    };
    expect(() => entrySchema.parse(entry)).not.toThrow();
  });

  it("validates a footer", () => {
    const footer = {
      kind: "filecap-inventory-footer",
      stats: {
        fileCount: 100,
        totalBytes: 1024000,
        scanDurationMs: 5000,
        introspectionFailures: 0,
        permissionDenials: 0,
      },
    };
    expect(() => footerSchema.parse(footer)).not.toThrow();
  });

  it("rejects a footer with negative stats", () => {
    const bad = {
      kind: "filecap-inventory-footer",
      stats: {
        fileCount: -1,
        totalBytes: 0,
        scanDurationMs: 0,
        introspectionFailures: 0,
        permissionDenials: 0,
      },
    };
    expect(() => footerSchema.parse(bad)).toThrow();
  });

  it("validates an entry that includes a pdf introspection block", () => {
    const entry = {
      path: "case.pdf",
      absolutePath: "/var/strapi/uploads/case.pdf",
      filename: "case.pdf",
      extension: "pdf",
      category: "pdf",
      remediable: true,
      sizeBytes: 1024,
      modifiedAt: "2024-01-01T00:00:00.000Z",
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      flags: [],
      introspection: {
        kind: "pdf",
        pageCount: 47,
        hasTextLayer: true,
        textLayerCoverage: 0.94,
        isImageOnly: false,
        hasOutline: false,
        hasTags: false,
        hasFormFields: false,
        hasSignatures: false,
        encrypted: false,
        documentLanguage: "en-US",
        producer: "Microsoft Word",
        creator: "Microsoft Word",
        creationDate: "2024-01-01T00:00:00.000Z",
        pdfVersion: "1.6",
      },
    };
    expect(() => entrySchema.parse(entry)).not.toThrow();
  });

  it("rejects an introspection block with the wrong kind", () => {
    const entry = {
      path: "case.pdf",
      absolutePath: "/var/strapi/uploads/case.pdf",
      filename: "case.pdf",
      extension: "pdf",
      category: "pdf",
      remediable: true,
      sizeBytes: 1024,
      modifiedAt: "2024-01-01T00:00:00.000Z",
      sha256: "",
      flags: [],
      introspection: {
        kind: "wrong-kind",
        pageCount: 1,
      },
    };
    expect(() => entrySchema.parse(entry)).toThrow();
  });

  it("allows introspection.textLayerCoverage to be undefined when isImageOnly is true", () => {
    // For image-only PDFs we may not bother computing coverage.
    const entry = {
      path: "scan.pdf",
      absolutePath: "/var/strapi/uploads/scan.pdf",
      filename: "scan.pdf",
      extension: "pdf",
      category: "pdf",
      remediable: true,
      sizeBytes: 1024,
      modifiedAt: "2024-01-01T00:00:00.000Z",
      sha256: "",
      flags: [],
      introspection: {
        kind: "pdf",
        pageCount: 1,
        hasTextLayer: false,
        isImageOnly: true,
        hasTags: false,
        hasFormFields: false,
        hasSignatures: false,
        encrypted: false,
      },
    };
    expect(() => entrySchema.parse(entry)).not.toThrow();
  });

  it("pdfIntrospectionSchema parses a minimal valid block directly", () => {
    const intro = {
      kind: "pdf",
      pageCount: 1,
      hasTextLayer: true,
      isImageOnly: false,
      hasTags: false,
      hasFormFields: false,
      hasSignatures: false,
      encrypted: false,
    };
    expect(() => pdfIntrospectionSchema.parse(intro)).not.toThrow();
  });

  it("pdfIntrospectionSchema rejects textLayerCoverage outside [0,1]", () => {
    const intro = {
      kind: "pdf",
      pageCount: 1,
      hasTextLayer: true,
      textLayerCoverage: 1.5,
      isImageOnly: false,
      hasTags: false,
      hasFormFields: false,
      hasSignatures: false,
      encrypted: false,
    };
    expect(() => pdfIntrospectionSchema.parse(intro)).toThrow();
  });
});

describe("isCompleteInventory", () => {
  it("returns true for a complete inventory (header + entries + footer)", () => {
    const text = [
      JSON.stringify({ kind: "filecap-inventory-header", schemaVersion: 1, metadata: {} }),
      JSON.stringify({ filename: "a.pdf", sizeBytes: 1 }),
      JSON.stringify({ kind: "filecap-inventory-footer", stats: {} }),
    ].join("\n");
    expect(isCompleteInventory(text)).toBe(true);
  });

  it("returns true for a consolidated footer", () => {
    const text = [
      JSON.stringify({ kind: "filecap-consolidated-header" }),
      JSON.stringify({ kind: "filecap-consolidated-footer", stats: {} }),
    ].join("\n");
    expect(isCompleteInventory(text)).toBe(true);
  });

  it("returns false when footer is missing (interrupted scan)", () => {
    const text = [
      JSON.stringify({ kind: "filecap-inventory-header", schemaVersion: 1, metadata: {} }),
      JSON.stringify({ filename: "a.pdf", sizeBytes: 1 }),
      JSON.stringify({ filename: "b.pdf", sizeBytes: 2 }),
      // no footer
    ].join("\n");
    expect(isCompleteInventory(text)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isCompleteInventory("")).toBe(false);
  });

  it("returns false when the last line is malformed JSON", () => {
    const text = [
      JSON.stringify({ kind: "filecap-inventory-header", schemaVersion: 1, metadata: {} }),
      "not-json-{{{",
    ].join("\n");
    expect(isCompleteInventory(text)).toBe(false);
  });

  it("ignores trailing empty lines", () => {
    const text = [
      JSON.stringify({ kind: "filecap-inventory-header", schemaVersion: 1, metadata: {} }),
      JSON.stringify({ kind: "filecap-inventory-footer", stats: {} }),
      "",
      "",
    ].join("\n");
    expect(isCompleteInventory(text)).toBe(true);
  });
});
