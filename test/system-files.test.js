import { describe, it, expect } from "vitest";
import { isSystemFile } from "../src/scanner/system-files.js";

// v1.47.0 — invisible / system-specific files (.gitkeep, .DS_Store,
// .env.sample, Thumbs.db…) are repo/OS plumbing, not content anyone
// uploaded. They are excluded from every bundle surface — counts, pages,
// workbooks, the NDJSON, the search index — at inventory-read time, so
// cached scans don't need re-running. The 2026-08-16 fleet carried 25:
// 14 .DS_Store, 9 .gitkeep, 2 .gitignore.

describe("isSystemFile", () => {
  it("treats any dotfile as a system file", () => {
    for (const name of [".gitkeep", ".gitignore", ".env.sample", ".DS_Store", ".htaccess", ".nojekyll"]) {
      expect(isSystemFile(name), name).toBe(true);
    }
  });

  it("catches the non-dot OS droppings by name, any case", () => {
    expect(isSystemFile("Thumbs.db")).toBe(true);
    expect(isSystemFile("thumbs.db")).toBe(true);
    expect(isSystemFile("Desktop.ini")).toBe(true);
  });

  it("leaves real content alone", () => {
    for (const name of ["report.pdf", "Annual Report 2023.pdf", "data.env.sample.pdf", "gitkeep.txt", "1.pdf"]) {
      expect(isSystemFile(name), name).toBe(false);
    }
  });

  it("is safe on empty and nullish input", () => {
    expect(isSystemFile("")).toBe(false);
    expect(isSystemFile(null)).toBe(false);
    expect(isSystemFile(undefined)).toBe(false);
  });
});
