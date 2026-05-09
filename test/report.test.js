import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

let tmpRoot;
let outDir;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-report-cli-"));
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-report-cli-out-"));
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
      resolve({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
}

function inventoryHeader() {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "filecap-inventory-header",
    metadata: {
      serverName: "test-server",
      hostname: "test-server.local",
      serverIp: "10.0.0.1",
      scannedPath: "/uploads",
      scannedAt: "2024-01-01T00:00:00.000Z",
      filecapVersion: "0.5.0",
      nodeVersion: "v20.11.1",
      options: { introspect: false, hash: true, maxIntrospectMb: 200, concurrency: 4 },
    },
  });
}

describe("filecap report CLI", () => {
  it("generates the full report directory from a single-instance inventory", async () => {
    const ndjson = path.join(tmpRoot, "in.ndjson");
    await fs.writeFile(ndjson, [
      inventoryHeader(),
      JSON.stringify({
        path: "Scan_001.pdf",
        absolutePath: "/uploads/Scan_001.pdf",
        filename: "Scan_001.pdf",
        extension: "pdf",
        category: "pdf",
        remediable: true,
        sizeBytes: 1024,
        modifiedAt: "2024-01-01T00:00:00.000Z",
        sha256: "h1",
        flags: ["scanned-name-pattern"],
      }),
      JSON.stringify({
        path: "ok.pdf",
        absolutePath: "/uploads/ok.pdf",
        filename: "ok.pdf",
        extension: "pdf",
        category: "pdf",
        remediable: true,
        sizeBytes: 2048,
        modifiedAt: "2024-01-01T00:00:00.000Z",
        sha256: "h2",
        flags: [],
      }),
      JSON.stringify({
        kind: "filecap-inventory-footer",
        stats: { fileCount: 2, totalBytes: 3072, scanDurationMs: 1, introspectionFailures: 0, permissionDenials: 0 },
      }),
    ].join("\n") + "\n");

    const reportDir = path.join(outDir, "report");
    const result = await runCli(["report", ndjson, "-o", reportDir], outDir);
    expect(result.code).toBe(0);

    for (const f of ["files.csv", "SUMMARY.txt", "largest_files.txt", "flagged_filenames.txt", "duplicate_hashes.txt", "pdf_image_only.txt"]) {
      const stat = await fs.stat(path.join(reportDir, f));
      expect(stat.isFile()).toBe(true);
    }

    const csv = await fs.readFile(path.join(reportDir, "files.csv"), "utf8");
    expect(csv.split("\n")[0]).toContain("Server");
    expect(csv).toContain("Scan_001.pdf");
    expect(csv).toContain("ok.pdf");

    const flagged = await fs.readFile(path.join(reportDir, "flagged_filenames.txt"), "utf8");
    expect(flagged).toContain("Scan_001.pdf");
    expect(flagged).not.toContain("ok.pdf");
  });

  it("returns exit code 2 when input file does not exist", async () => {
    const result = await runCli(["report", path.join(tmpRoot, "no-such.ndjson"), "-o", path.join(outDir, "x")], outDir);
    expect(result.code).toBe(2);
  });
});
