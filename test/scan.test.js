import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
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
