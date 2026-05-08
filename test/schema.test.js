import { describe, it, expect } from "vitest";
import {
  headerSchema,
  entrySchema,
  footerSchema,
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
});
