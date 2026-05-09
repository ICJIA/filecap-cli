import { describe, it, expect } from "vitest";
import { humanizeBytes, csvCell } from "../src/report/format.js";

describe("humanizeBytes", () => {
  it("formats common sizes", () => {
    expect(humanizeBytes(0)).toBe("0 B");
    expect(humanizeBytes(512)).toBe("512 B");
    expect(humanizeBytes(1024)).toBe("1.0 KB");
    expect(humanizeBytes(1536)).toBe("1.5 KB");
    expect(humanizeBytes(1024 * 1024)).toBe("1.0 MB");
    expect(humanizeBytes(4827193)).toBe("4.6 MB");
    expect(humanizeBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
    expect(humanizeBytes(1024 * 1024 * 1024 * 1024)).toBe("1.0 TB");
  });
});

describe("csvCell", () => {
  it("returns the value as-is when it has no special chars", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(true)).toBe("true");
  });

  it("returns empty string for null/undefined", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes and escapes values with commas, quotes, or newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });
});
