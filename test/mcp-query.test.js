import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { queryInventory } from "../src/mcp/query.js";

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-mcp-query-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function ndjson(entries, kind = "filecap-inventory") {
  const lines = [];
  lines.push(JSON.stringify({
    schemaVersion: 1,
    kind: `${kind}-header`,
    metadata: { serverName: "test", hostname: "x", serverIp: "10.0.0.1", scannedPath: "/u", scannedAt: "2024-01-01T00:00:00.000Z", filecapVersion: "0.6.0", nodeVersion: "v20", options: { introspect: false, hash: true, maxIntrospectMb: 200, concurrency: 4 } },
  }));
  for (const e of entries) lines.push(JSON.stringify(e));
  lines.push(JSON.stringify({ kind: `${kind}-footer`, stats: { fileCount: entries.length, totalBytes: 0, scanDurationMs: 0, introspectionFailures: 0, permissionDenials: 0 } }));
  return lines.join("\n") + "\n";
}

function entry(filename, sizeBytes, opts = {}) {
  return {
    path: filename,
    absolutePath: `/u/${filename}`,
    filename,
    extension: filename.split(".").pop(),
    category: opts.category ?? "pdf",
    remediable: opts.remediable ?? true,
    sizeBytes,
    modifiedAt: opts.modifiedAt ?? "2024-01-01T00:00:00.000Z",
    sha256: opts.sha256 ?? "",
    flags: opts.flags ?? [],
    ...(opts.introspection ? { introspection: opts.introspection } : {}),
  };
}

describe("queryInventory", () => {
  it("returns all entries when no filters given (up to limit)", async () => {
    const file = path.join(tmpRoot, "in.ndjson");
    await fs.writeFile(file, ndjson([entry("a.pdf", 100), entry("b.pdf", 200)]));
    const result = await queryInventory({ inventory: file, filters: {} });
    expect(result.matched.length).toBe(2);
    expect(result.totalEntries).toBe(2);
  });

  it("filters by minSizeBytes", async () => {
    const file = path.join(tmpRoot, "in.ndjson");
    await fs.writeFile(file, ndjson([entry("small.pdf", 100), entry("big.pdf", 1_000_000)]));
    const result = await queryInventory({ inventory: file, filters: { minSizeBytes: 1000 } });
    expect(result.matched.map((e) => e.filename)).toEqual(["big.pdf"]);
  });

  it("filters by extension", async () => {
    const file = path.join(tmpRoot, "in.ndjson");
    await fs.writeFile(file, ndjson([entry("a.pdf", 1), entry("b.docx", 1), entry("c.pdf", 1)]));
    const result = await queryInventory({ inventory: file, filters: { extension: "pdf" } });
    expect(result.matched.length).toBe(2);
    for (const e of result.matched) expect(e.extension).toBe("pdf");
  });

  it("filters by category", async () => {
    const file = path.join(tmpRoot, "in.ndjson");
    await fs.writeFile(file, ndjson([
      entry("a.pdf", 1, { category: "pdf" }),
      entry("b.png", 1, { category: "image" }),
    ]));
    const result = await queryInventory({ inventory: file, filters: { category: "image" } });
    expect(result.matched.map((e) => e.filename)).toEqual(["b.png"]);
  });

  it("filters by includeFlags (must contain all listed flags)", async () => {
    const file = path.join(tmpRoot, "in.ndjson");
    await fs.writeFile(file, ndjson([
      entry("Scan_001.pdf", 1, { flags: ["scanned-name-pattern"] }),
      entry("résumé.pdf", 1, { flags: ["filename-non-ascii"] }),
      entry("Scan résumé.pdf", 1, { flags: ["scanned-name-pattern", "filename-has-spaces", "filename-non-ascii"] }),
      entry("ok.pdf", 1, { flags: [] }),
    ]));
    const result = await queryInventory({
      inventory: file,
      filters: { includeFlags: ["scanned-name-pattern", "filename-non-ascii"] },
    });
    expect(result.matched.map((e) => e.filename)).toEqual(["Scan résumé.pdf"]);
  });

  it("filters by isImageOnly via introspection", async () => {
    const file = path.join(tmpRoot, "in.ndjson");
    await fs.writeFile(file, ndjson([
      entry("scan.pdf", 1, { introspection: { kind: "pdf", pageCount: 1, hasTextLayer: false, isImageOnly: true, hasTags: false, hasFormFields: false, hasSignatures: false, encrypted: false } }),
      entry("born.pdf", 1, { introspection: { kind: "pdf", pageCount: 1, hasTextLayer: true, isImageOnly: false, hasTags: false, hasFormFields: false, hasSignatures: false, encrypted: false } }),
    ]));
    const result = await queryInventory({ inventory: file, filters: { isImageOnly: true } });
    expect(result.matched.map((e) => e.filename)).toEqual(["scan.pdf"]);
  });

  it("respects limit", async () => {
    const file = path.join(tmpRoot, "in.ndjson");
    const entries = Array.from({ length: 100 }, (_, i) => entry(`f${i}.pdf`, i));
    await fs.writeFile(file, ndjson(entries));
    const result = await queryInventory({ inventory: file, filters: {}, limit: 10 });
    expect(result.matched.length).toBe(10);
    expect(result.totalEntries).toBe(100);
  });

  it("sorts by sizeBytes desc when sortBy: size", async () => {
    const file = path.join(tmpRoot, "in.ndjson");
    await fs.writeFile(file, ndjson([entry("small.pdf", 10), entry("big.pdf", 1000), entry("medium.pdf", 100)]));
    const result = await queryInventory({ inventory: file, filters: {}, sortBy: "size" });
    expect(result.matched.map((e) => e.filename)).toEqual(["big.pdf", "medium.pdf", "small.pdf"]);
  });

  it("returns exitCode 2 on missing input", async () => {
    const result = await queryInventory({ inventory: path.join(tmpRoot, "nope.ndjson"), filters: {} });
    expect(result.error).toBeTruthy();
  });
});
