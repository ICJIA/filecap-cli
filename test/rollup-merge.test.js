import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rollupInventories } from "../src/rollup/merge.js";
import {
  consolidatedHeaderSchema,
  consolidatedEntrySchema,
  consolidatedFooterSchema,
} from "../src/schema/inventory.js";

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-rollup-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function inventoryHeader(serverName, scannedAt = "2024-01-01T00:00:00.000Z") {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "filecap-inventory-header",
    metadata: {
      serverName,
      hostname: `${serverName}.local`,
      serverIp: "10.0.0.1",
      scannedPath: "/uploads",
      scannedAt,
      filecapVersion: "0.4.0",
      nodeVersion: "v20.11.1",
      options: { introspect: false, hash: true, maxIntrospectMb: 200, concurrency: 4 },
    },
  });
}

function inventoryEntry(filename, sha256, modifiedAt = "2024-01-01T00:00:00.000Z") {
  return JSON.stringify({
    path: filename,
    absolutePath: `/uploads/${filename}`,
    filename,
    extension: filename.includes(".") ? filename.split(".").pop() : "",
    category: "pdf",
    remediable: true,
    sizeBytes: 1024,
    modifiedAt,
    sha256,
    flags: [],
  });
}

function inventoryFooter(fileCount, totalBytes) {
  return JSON.stringify({
    kind: "filecap-inventory-footer",
    stats: {
      fileCount,
      totalBytes,
      scanDurationMs: 100,
      introspectionFailures: 0,
      permissionDenials: 0,
    },
  });
}

async function writeNdjson(filePath, lines) {
  await fs.writeFile(filePath, lines.join("\n") + "\n");
}

async function readNdjson(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

describe("rollupInventories", () => {
  it("merges two single-instance inventories with no duplicates", async () => {
    const inA = path.join(tmpRoot, "a.ndjson");
    const inB = path.join(tmpRoot, "b.ndjson");
    const out = path.join(tmpRoot, "consolidated.ndjson");
    await writeNdjson(inA, [
      inventoryHeader("server-a"),
      inventoryEntry("file1.pdf", "hash-1"),
      inventoryFooter(1, 1024),
    ]);
    await writeNdjson(inB, [
      inventoryHeader("server-b"),
      inventoryEntry("file2.pdf", "hash-2"),
      inventoryFooter(1, 1024),
    ]);

    const result = await rollupInventories([inA, inB], out, { strict: false });
    expect(result.exitCode).toBe(0);

    const lines = await readNdjson(out);
    expect(lines).toHaveLength(4); // header + 2 entries + footer
    expect(() => consolidatedHeaderSchema.parse(lines[0])).not.toThrow();
    expect(() => consolidatedEntrySchema.parse(lines[1])).not.toThrow();
    expect(() => consolidatedEntrySchema.parse(lines[2])).not.toThrow();
    expect(() => consolidatedFooterSchema.parse(lines[3])).not.toThrow();

    expect(lines[0].metadata.sources).toHaveLength(2);
    expect(lines[3].stats.fileCount).toBe(2);
    expect(lines[3].stats.totalDuplicateGroups).toBe(0);
    expect(lines[3].stats.bytesSavedIfDeduped).toBe(0);

    const entries = lines.slice(1, -1);
    for (const e of entries) {
      expect(e.duplicateOf).toBe(null);
    }
  });

  it("links content-duplicates via duplicateOf with oldest-mtime canonical", async () => {
    const inA = path.join(tmpRoot, "a.ndjson");
    const inB = path.join(tmpRoot, "b.ndjson");
    const out = path.join(tmpRoot, "consolidated.ndjson");
    await writeNdjson(inA, [
      inventoryHeader("server-a"),
      inventoryEntry("doc.pdf", "shared-hash", "2024-01-01T00:00:00.000Z"),
      inventoryFooter(1, 1024),
    ]);
    await writeNdjson(inB, [
      inventoryHeader("server-b"),
      inventoryEntry("doc-copy.pdf", "shared-hash", "2024-08-01T00:00:00.000Z"),
      inventoryFooter(1, 1024),
    ]);

    await rollupInventories([inA, inB], out, { strict: false });
    const lines = await readNdjson(out);
    const entries = lines.slice(1, -1);
    expect(entries).toHaveLength(2);

    const canonical = entries.find((e) => e.serverName === "server-a");
    const dupe = entries.find((e) => e.serverName === "server-b");
    expect(canonical.duplicateOf).toBe(null);
    expect(dupe.duplicateOf).toEqual({ serverName: "server-a", path: "doc.pdf" });

    expect(lines[3].stats.totalDuplicateGroups).toBe(1);
    expect(lines[3].stats.bytesSavedIfDeduped).toBe(1024);
  });

  it("counts totalUniqueHashes correctly", async () => {
    const inA = path.join(tmpRoot, "a.ndjson");
    const out = path.join(tmpRoot, "out.ndjson");
    await writeNdjson(inA, [
      inventoryHeader("server-a"),
      inventoryEntry("a.pdf", "h1"),
      inventoryEntry("b.pdf", "h2"),
      inventoryEntry("c.pdf", "h1"),
      inventoryFooter(3, 3072),
    ]);

    await rollupInventories([inA], out, { strict: false });
    const lines = await readNdjson(out);
    const footer = lines[lines.length - 1];
    expect(footer.stats.fileCount).toBe(3);
    expect(footer.stats.totalUniqueHashes).toBe(2);
    expect(footer.stats.totalDuplicateGroups).toBe(1);
  });

  it("warns and skips an inventory missing its footer when --strict is off", async () => {
    const inA = path.join(tmpRoot, "a.ndjson");
    const inB = path.join(tmpRoot, "b.ndjson");
    const out = path.join(tmpRoot, "out.ndjson");
    await writeNdjson(inA, [
      inventoryHeader("server-a"),
      inventoryEntry("a.pdf", "h1"),
      inventoryFooter(1, 1024),
    ]);
    await writeNdjson(inB, [
      inventoryHeader("server-b"),
      inventoryEntry("b.pdf", "h2"),
    ]);

    const result = await rollupInventories([inA, inB], out, { strict: false });
    expect(result.exitCode).toBe(0);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some((w) => w.includes("partial"))).toBe(true);
    const lines = await readNdjson(out);
    const entries = lines.slice(1, -1);
    expect(entries.some((e) => e.serverName === "server-b")).toBe(true);
  });

  it("rejects an inventory missing its footer when --strict is on", async () => {
    const inA = path.join(tmpRoot, "a.ndjson");
    await writeNdjson(inA, [
      inventoryHeader("server-a"),
      inventoryEntry("a.pdf", "h1"),
    ]);
    const out = path.join(tmpRoot, "out.ndjson");

    const result = await rollupInventories([inA], out, { strict: true });
    expect(result.exitCode).toBe(1);
  });
});
