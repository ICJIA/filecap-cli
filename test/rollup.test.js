import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

let tmpRoot;
let outDir;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-rollup-cli-"));
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-rollup-cli-out-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.rm(outDir, { recursive: true, force: true });
});

function runCli(args, cwd) {
  const cliPath = fileURLToPath(new URL("../bin/filecap.js", import.meta.url));
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (d) => stdout.push(d));
    child.stderr.on("data", (d) => stderr.push(d));
    child.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function inv(serverName, entries) {
  const lines = [];
  lines.push(JSON.stringify({
    schemaVersion: 1,
    kind: "filecap-inventory-header",
    metadata: {
      serverName,
      hostname: `${serverName}.local`,
      serverIp: "10.0.0.1",
      scannedPath: "/uploads",
      scannedAt: "2024-01-01T00:00:00.000Z",
      filecapVersion: "0.4.0",
      nodeVersion: "v20.11.1",
      options: { introspect: false, hash: true, maxIntrospectMb: 200, concurrency: 4 },
    },
  }));
  for (const e of entries) lines.push(JSON.stringify(e));
  lines.push(JSON.stringify({
    kind: "filecap-inventory-footer",
    stats: {
      fileCount: entries.length,
      totalBytes: entries.reduce((s, e) => s + (e.sizeBytes ?? 0), 0),
      scanDurationMs: 1,
      introspectionFailures: 0,
      permissionDenials: 0,
    },
  }));
  return lines.join("\n") + "\n";
}

function entry(filename, hash, modifiedAt = "2024-01-01T00:00:00.000Z") {
  return {
    path: filename,
    absolutePath: `/uploads/${filename}`,
    filename,
    extension: filename.split(".").pop(),
    category: "pdf",
    remediable: true,
    sizeBytes: 1024,
    modifiedAt,
    sha256: hash,
    flags: [],
  };
}

describe("filecap rollup CLI", () => {
  it("merges three per-server inventories with intentional duplicates", async () => {
    const a = path.join(tmpRoot, "a.ndjson");
    const b = path.join(tmpRoot, "b.ndjson");
    const c = path.join(tmpRoot, "c.ndjson");
    await fs.writeFile(a, inv("server-a", [
      entry("doc1.pdf", "shared", "2024-01-01T00:00:00.000Z"),
      entry("uniq-a.pdf", "ha"),
    ]));
    await fs.writeFile(b, inv("server-b", [
      entry("doc1-copy.pdf", "shared", "2024-08-01T00:00:00.000Z"),
      entry("uniq-b.pdf", "hb"),
    ]));
    await fs.writeFile(c, inv("server-c", [
      entry("uniq-c.pdf", "hc"),
    ]));

    const out = path.join(outDir, "consolidated.ndjson");
    const result = await runCli(["rollup", a, b, c, "-o", out], outDir);
    expect(result.code).toBe(0);

    const text = await fs.readFile(out, "utf8");
    const lines = text.split("\n").filter(Boolean).map(JSON.parse);
    expect(lines[0].kind).toBe("filecap-consolidated-header");
    expect(lines[lines.length - 1].kind).toBe("filecap-consolidated-footer");
    const footer = lines[lines.length - 1];
    expect(footer.stats.fileCount).toBe(5);
    expect(footer.stats.totalUniqueHashes).toBe(4);
    expect(footer.stats.totalDuplicateGroups).toBe(1);
    expect(footer.stats.bytesSavedIfDeduped).toBe(1024);

    const entries = lines.slice(1, -1);
    const dup = entries.find((e) => e.serverName === "server-b" && e.filename === "doc1-copy.pdf");
    expect(dup.duplicateOf).toEqual({ serverName: "server-a", path: "doc1.pdf" });
  });

  it("returns exit 1 with --strict on a partial inventory", async () => {
    const partial = path.join(tmpRoot, "partial.ndjson");
    await fs.writeFile(partial, JSON.stringify({
      schemaVersion: 1,
      kind: "filecap-inventory-header",
      metadata: {
        serverName: "x",
        hostname: "x.local",
        serverIp: "10.0.0.1",
        scannedPath: "/u",
        scannedAt: "2024-01-01T00:00:00.000Z",
        filecapVersion: "0.4.0",
        nodeVersion: "v20.11.1",
        options: { introspect: false, hash: true, maxIntrospectMb: 200, concurrency: 4 },
      },
    }) + "\n" + JSON.stringify(entry("a.pdf", "h")) + "\n");

    const out = path.join(outDir, "out.ndjson");
    const result = await runCli(["rollup", partial, "-o", out, "--strict"], outDir);
    expect(result.code).toBe(1);
  });
});
