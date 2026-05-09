import { describe, it, expect } from "vitest";
import {
  writeLargestFiles,
  writeFlaggedFilenames,
  writeDuplicateHashes,
  writePdfImageOnly,
} from "../src/report/flagged.js";

describe("writeLargestFiles", () => {
  it("emits top-50 largest by sizeBytes (desc)", () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({
      sizeBytes: i * 1000,
      path: `f${i}.pdf`,
      filename: `f${i}.pdf`,
    }));
    const text = writeLargestFiles({ entries });
    const lines = text.trim().split("\n");
    expect(lines.length).toBeGreaterThan(40);
    expect(text).toContain("f59.pdf");
  });
});

describe("writeFlaggedFilenames", () => {
  it("lists entries whose flags include scanned-name-pattern or filename-* flags", () => {
    const entries = [
      { filename: "Scan_001.pdf", flags: ["scanned-name-pattern"] },
      { filename: "ok.pdf", flags: [] },
      { filename: "résumé.pdf", flags: ["filename-non-ascii"] },
    ];
    const text = writeFlaggedFilenames({ entries });
    expect(text).toContain("Scan_001.pdf");
    expect(text).toContain("résumé.pdf");
    expect(text).not.toContain("ok.pdf");
  });
});

describe("writeDuplicateHashes", () => {
  it("groups entries by sha256 and lists groups with >1 member", () => {
    const entries = [
      { sha256: "h1", filename: "a.pdf", serverName: "s1", path: "a.pdf" },
      { sha256: "h1", filename: "a-copy.pdf", serverName: "s2", path: "a-copy.pdf" },
      { sha256: "h2", filename: "b.pdf", serverName: "s1", path: "b.pdf" },
    ];
    const text = writeDuplicateHashes({ entries });
    expect(text).toContain("h1");
    expect(text).toContain("a.pdf");
    expect(text).toContain("a-copy.pdf");
    expect(text).not.toContain("h2");
  });
});

describe("writePdfImageOnly", () => {
  it("lists PDFs with isImageOnly === true", () => {
    const entries = [
      { filename: "scan.pdf", introspection: { kind: "pdf", isImageOnly: true } },
      { filename: "born.pdf", introspection: { kind: "pdf", isImageOnly: false } },
      { filename: "no-intro.pdf" },
    ];
    const text = writePdfImageOnly({ entries });
    expect(text).toContain("scan.pdf");
    expect(text).not.toContain("born.pdf");
  });
});
