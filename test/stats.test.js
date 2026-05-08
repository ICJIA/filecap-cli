import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { extractStats } from "../src/scanner/stats.js";

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-stats-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("extractStats", () => {
  it("returns size, mtime, and lowercase extension for a file", async () => {
    const file = path.join(tmpRoot, "Sample.PDF");
    await fs.writeFile(file, "hello");
    const stats = await extractStats(file);
    expect(stats.sizeBytes).toBe(5);
    expect(stats.extension).toBe("pdf");
    expect(stats.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns empty extension when the filename has none", async () => {
    const file = path.join(tmpRoot, "README");
    await fs.writeFile(file, "x");
    const stats = await extractStats(file);
    expect(stats.extension).toBe("");
  });

  it("strips the leading dot from the extension", async () => {
    const file = path.join(tmpRoot, "doc.docx");
    await fs.writeFile(file, "x");
    const stats = await extractStats(file);
    expect(stats.extension).toBe("docx");
  });

  it("emits modifiedAt as ISO 8601 UTC with milliseconds and trailing Z", async () => {
    const file = path.join(tmpRoot, "x.txt");
    await fs.writeFile(file, "x");
    const stats = await extractStats(file);
    expect(stats.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
