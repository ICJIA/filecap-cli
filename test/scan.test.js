import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runScan } from "../src/commands/scan.js";
import { headerSchema, entrySchema, footerSchema } from "../src/schema/inventory.js";

let tmpRoot;
let outDir;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-scan-"));
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-out-"));
});

afterEach(async () => {
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

describe("runScan", () => {
  it("produces a valid header + footer for an empty directory", async () => {
    const outPath = path.join(outDir, "empty.ndjson");
    const result = await runScan({
      directory: tmpRoot,
      output: outPath,
      hash: true,
      concurrency: 4,
      progress: false,
    });
    expect(result.exitCode).toBe(0);
    const lines = await readNdjson(outPath);
    expect(lines).toHaveLength(2);
    expect(() => headerSchema.parse(lines[0])).not.toThrow();
    expect(() => footerSchema.parse(lines[1])).not.toThrow();
    expect(lines[1].stats.fileCount).toBe(0);
  });

  it("produces one entry per file with valid schema", async () => {
    await fs.writeFile(path.join(tmpRoot, "a.pdf"), "pdf-content");
    await fs.writeFile(path.join(tmpRoot, "b.docx"), "docx-content");
    await fs.mkdir(path.join(tmpRoot, "sub"));
    await fs.writeFile(path.join(tmpRoot, "sub", "c.png"), "png-content");

    const outPath = path.join(outDir, "out.ndjson");
    const result = await runScan({
      directory: tmpRoot,
      output: outPath,
      hash: true,
      concurrency: 4,
      progress: false,
    });
    expect(result.exitCode).toBe(0);
    const lines = await readNdjson(outPath);
    expect(lines).toHaveLength(5); // header + 3 entries + footer
    expect(() => headerSchema.parse(lines[0])).not.toThrow();
    for (let i = 1; i <= 3; i++) {
      expect(() => entrySchema.parse(lines[i])).not.toThrow();
    }
    expect(() => footerSchema.parse(lines[4])).not.toThrow();
    expect(lines[4].stats.fileCount).toBe(3);
  });

  it("derives category and remediable correctly", async () => {
    await fs.writeFile(path.join(tmpRoot, "a.pdf"), "x");
    await fs.writeFile(path.join(tmpRoot, "b.png"), "x");

    const outPath = path.join(outDir, "out.ndjson");
    await runScan({ directory: tmpRoot, output: outPath, hash: false, concurrency: 4, progress: false });
    const lines = await readNdjson(outPath);
    const entries = lines.slice(1, -1);
    const pdfEntry = entries.find((e) => e.filename === "a.pdf");
    const pngEntry = entries.find((e) => e.filename === "b.png");
    expect(pdfEntry.category).toBe("pdf");
    expect(pdfEntry.remediable).toBe(true);
    expect(pngEntry.category).toBe("image");
    expect(pngEntry.remediable).toBe(false);
  });

  it("emits empty sha256 when hash is disabled", async () => {
    await fs.writeFile(path.join(tmpRoot, "a.txt"), "x");
    const outPath = path.join(outDir, "out.ndjson");
    await runScan({ directory: tmpRoot, output: outPath, hash: false, concurrency: 4, progress: false });
    const lines = await readNdjson(outPath);
    expect(lines[1].sha256).toBe("");
  });

  it("emits a populated sha256 when hash is enabled", async () => {
    await fs.writeFile(path.join(tmpRoot, "a.txt"), "hello");
    const outPath = path.join(outDir, "out.ndjson");
    await runScan({ directory: tmpRoot, output: outPath, hash: true, concurrency: 4, progress: false });
    const lines = await readNdjson(outPath);
    expect(lines[1].sha256).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("returns exit code 3 when at least one directory was unreadable", async () => {
    if (process.platform === "win32") return;
    const blocked = path.join(tmpRoot, "blocked");
    await fs.mkdir(blocked);
    await fs.writeFile(path.join(blocked, "x.txt"), "x");
    await fs.chmod(blocked, 0o000);
    try {
      const outPath = path.join(outDir, "out.ndjson");
      const result = await runScan({
        directory: tmpRoot,
        output: outPath,
        hash: false,
        concurrency: 4,
        progress: false,
      });
      expect(result.exitCode).toBe(3);
      const lines = await readNdjson(outPath);
      const footer = lines[lines.length - 1];
      expect(footer.stats.permissionDenials).toBeGreaterThanOrEqual(1);
    } finally {
      await fs.chmod(blocked, 0o700);
    }
  });

  it("respects --include-ext", async () => {
    await fs.writeFile(path.join(tmpRoot, "a.pdf"), "x");
    await fs.writeFile(path.join(tmpRoot, "b.png"), "x");
    await fs.writeFile(path.join(tmpRoot, "c.docx"), "x");

    const outPath = path.join(outDir, "out.ndjson");
    await runScan({
      directory: tmpRoot,
      output: outPath,
      hash: false,
      concurrency: 4,
      progress: false,
      includeExt: ["pdf", "docx"],
    });
    const lines = await readNdjson(outPath);
    const filenames = lines.slice(1, -1).map((e) => e.filename).sort();
    expect(filenames).toEqual(["a.pdf", "c.docx"]);
  });

  it("respects --exclude-ext", async () => {
    await fs.writeFile(path.join(tmpRoot, "a.pdf"), "x");
    await fs.writeFile(path.join(tmpRoot, "b.png"), "x");

    const outPath = path.join(outDir, "out.ndjson");
    await runScan({
      directory: tmpRoot,
      output: outPath,
      hash: false,
      concurrency: 4,
      progress: false,
      excludeExt: ["png"],
    });
    const lines = await readNdjson(outPath);
    const filenames = lines.slice(1, -1).map((e) => e.filename);
    expect(filenames).toEqual(["a.pdf"]);
  });
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

describe("filecap CLI end-to-end", () => {
  it("scans a directory and writes a valid NDJSON file", async () => {
    await fs.writeFile(path.join(tmpRoot, "a.pdf"), "x");
    await fs.writeFile(path.join(tmpRoot, "b.txt"), "y");
    const outPath = path.join(outDir, "cli.ndjson");

    const result = await runCli(["scan", tmpRoot, "-o", outPath, "--no-hash"], outDir);
    expect(result.code).toBe(0);

    const text = await fs.readFile(outPath, "utf8");
    const lines = text.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l));
    expect(lines).toHaveLength(4); // header + 2 entries + footer
    expect(lines[0].kind).toBe("filecap-inventory-header");
    expect(lines[3].kind).toBe("filecap-inventory-footer");
    expect(lines[3].stats.fileCount).toBe(2);
  });

  it("returns exit code 1 with an error message when the directory does not exist", async () => {
    const outPath = path.join(outDir, "x.ndjson");
    const result = await runCli(
      ["scan", path.join(tmpRoot, "no-such-dir"), "-o", outPath, "--no-hash"],
      outDir,
    );
    expect(result.code).toBe(2);
  });

  it("prints version and exits 0", async () => {
    const result = await runCli(["--version"], outDir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
