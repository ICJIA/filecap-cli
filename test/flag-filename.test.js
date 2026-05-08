import { describe, it, expect } from "vitest";
import { computeFilenameFlags } from "../src/flag/filename.js";

describe("computeFilenameFlags", () => {
  it("returns an empty array for a clean descriptive filename", () => {
    expect(computeFilenameFlags("annual-report-2024.pdf")).toEqual([]);
  });

  it("flags Scan_NNN patterns", () => {
    expect(computeFilenameFlags("Scan_001.pdf")).toContain("scanned-name-pattern");
    expect(computeFilenameFlags("Scan001.pdf")).toContain("scanned-name-pattern");
    expect(computeFilenameFlags("scan_42.pdf")).toContain("scanned-name-pattern");
  });

  it("flags IMG_NNN patterns", () => {
    expect(computeFilenameFlags("IMG_4567.pdf")).toContain("scanned-name-pattern");
    expect(computeFilenameFlags("IMG4567.jpg")).toContain("scanned-name-pattern");
    expect(computeFilenameFlags("img_001.png")).toContain("scanned-name-pattern");
  });

  it("flags Document\\d+ patterns", () => {
    expect(computeFilenameFlags("Document1.docx")).toContain("scanned-name-pattern");
    expect(computeFilenameFlags("Document42.pdf")).toContain("scanned-name-pattern");
  });

  it("flags Untitled patterns", () => {
    expect(computeFilenameFlags("Untitled.docx")).toContain("scanned-name-pattern");
    expect(computeFilenameFlags("Untitled-1.pdf")).toContain("scanned-name-pattern");
    expect(computeFilenameFlags("untitled.txt")).toContain("scanned-name-pattern");
  });

  it("flags all-digit basenames", () => {
    expect(computeFilenameFlags("12345.pdf")).toContain("scanned-name-pattern");
    expect(computeFilenameFlags("00000001.tiff")).toContain("scanned-name-pattern");
  });

  it("flags common printer/fax/Word defaults", () => {
    expect(computeFilenameFlags("DOC001.pdf")).toContain("scanned-name-pattern");
    expect(computeFilenameFlags("FAX-2024-04-12.pdf")).toContain("scanned-name-pattern");
    expect(computeFilenameFlags("Microsoft Word - draft.pdf")).toContain("scanned-name-pattern");
  });

  it("flags filenames with spaces", () => {
    expect(computeFilenameFlags("annual report.pdf")).toContain("filename-has-spaces");
    expect(computeFilenameFlags("a b c.txt")).toContain("filename-has-spaces");
  });

  it("flags filenames with non-ASCII characters", () => {
    expect(computeFilenameFlags("résumé.pdf")).toContain("filename-non-ascii");
    expect(computeFilenameFlags("文件.docx")).toContain("filename-non-ascii");
  });

  it("flags filenames over 200 characters", () => {
    const longName = "a".repeat(205) + ".pdf";
    expect(computeFilenameFlags(longName)).toContain("filename-long");
  });

  it("does not flag filenames at exactly 200 characters", () => {
    const at200 = "a".repeat(196) + ".pdf"; // 196 + 4 = 200
    expect(computeFilenameFlags(at200)).not.toContain("filename-long");
  });

  it("returns multiple flags when multiple conditions match", () => {
    const flags = computeFilenameFlags("Scan 001 résumé.pdf");
    expect(flags).toContain("scanned-name-pattern");
    expect(flags).toContain("filename-has-spaces");
    expect(flags).toContain("filename-non-ascii");
  });

  it("returns flags in stable order (alphabetical)", () => {
    const flags = computeFilenameFlags("Scan 001 résumé.pdf");
    const sorted = [...flags].sort();
    expect(flags).toEqual(sorted);
  });

  it("handles edge cases without throwing", () => {
    expect(computeFilenameFlags("")).toEqual([]);
    expect(computeFilenameFlags(".pdf")).toEqual([]);
    expect(computeFilenameFlags("a")).toEqual([]);
  });
});
