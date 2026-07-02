import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runScan } from "../src/commands/scan.js";
import { footerSchema } from "../src/schema/inventory.js";

// v1.39.0 (F1): mid-scan races. A file that vanishes between the walk's stat
// and the hash read must be skipped silently (like the stat-time ENOENT path),
// and NO task failure may ever surface as a process-level unhandled rejection
// — the task promises sit in inFlight[] long before Promise.all attaches.
const hashBehavior = vi.hoisted(() => ({ impl: null }));

vi.mock("../src/scanner/hash.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    hashFile: (filePath) =>
      hashBehavior.impl
        ? hashBehavior.impl(filePath, actual.hashFile)
        : actual.hashFile(filePath),
  };
});

function codedError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

let tmpRoot;
let outDir;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-scan-race-"));
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-scan-race-out-"));
});

afterEach(async () => {
  hashBehavior.impl = null;
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.rm(outDir, { recursive: true, force: true });
});

async function readNdjson(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

describe("runScan mid-scan races (F1)", () => {
  it("skips a file that vanishes between stat and hash (ENOENT) and still writes the footer", async () => {
    await fs.writeFile(path.join(tmpRoot, "stays.txt"), "still here");
    await fs.writeFile(path.join(tmpRoot, "vanishes.txt"), "gone soon");
    hashBehavior.impl = (filePath, realHash) => {
      if (filePath.endsWith("vanishes.txt")) {
        throw codedError("ENOENT", "ENOENT: no such file or directory");
      }
      return realHash(filePath);
    };

    const outPath = path.join(outDir, "race.ndjson");
    const result = await runScan({
      directory: tmpRoot,
      output: outPath,
      hash: true,
      concurrency: 4,
      progress: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();

    const lines = await readNdjson(outPath);
    const footer = lines[lines.length - 1];
    expect(() => footerSchema.parse(footer)).not.toThrow();
    expect(footer.stats.fileCount).toBe(1);
    const filenames = lines.slice(1, -1).map((e) => e.filename);
    expect(filenames).toEqual(["stays.txt"]);
  });

  it("counts EACCES at hash time as a permission denial (existing behavior)", async () => {
    await fs.writeFile(path.join(tmpRoot, "stays.txt"), "still here");
    await fs.writeFile(path.join(tmpRoot, "locked.txt"), "no read");
    hashBehavior.impl = (filePath, realHash) => {
      if (filePath.endsWith("locked.txt")) {
        throw codedError("EACCES", "EACCES: permission denied");
      }
      return realHash(filePath);
    };

    const outPath = path.join(outDir, "eacces.ndjson");
    const result = await runScan({
      directory: tmpRoot,
      output: outPath,
      hash: true,
      concurrency: 4,
      progress: false,
    });
    expect(result.exitCode).toBe(3);

    const lines = await readNdjson(outPath);
    const footer = lines[lines.length - 1];
    expect(footer.stats.permissionDenials).toBeGreaterThanOrEqual(1);
    const filenames = lines.slice(1, -1).map((e) => e.filename);
    expect(filenames).toEqual(["stays.txt"]);
  });

  it("captures an unexpected task error as exitCode 1 without an unhandled rejection", async () => {
    // Enough files that the walk is still running when the task rejects —
    // the window where a rejected inFlight promise has no handler attached.
    for (let i = 0; i < 8; i++) {
      await fs.writeFile(path.join(tmpRoot, `file-${i}.txt`), `content ${i}`);
    }
    await fs.writeFile(path.join(tmpRoot, "bad.txt"), "io error incoming");
    hashBehavior.impl = (filePath, realHash) => {
      if (filePath.endsWith("bad.txt")) {
        throw codedError("EIO", "EIO: disk exploded");
      }
      return realHash(filePath);
    };

    const unhandled = [];
    const onUnhandled = (reason) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const outPath = path.join(outDir, "task-error.ndjson");
      const result = await runScan({
        directory: tmpRoot,
        output: outPath,
        hash: true,
        concurrency: 4,
        progress: false,
      });
      expect(result.exitCode).toBe(1);
      expect(result.error).toMatch(/disk exploded/);
      // Let any pending rejection-detection ticks flush before asserting.
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
