import { describe, it, expect } from "vitest";
import {
  categorize,
  isRemediable,
  REMEDIABLE_CATEGORIES,
  SCOREABLE_EXTENSIONS,
  isScoreable,
  isUnscoreableDocument,
} from "../src/scanner/category.js";

describe("categorize", () => {
  it("buckets PDFs as 'pdf'", () => {
    expect(categorize("pdf")).toBe("pdf");
  });

  it("buckets DOCX (and rtf/odt) as 'office-document'", () => {
    expect(categorize("docx")).toBe("office-document");
    expect(categorize("rtf")).toBe("office-document");
    expect(categorize("odt")).toBe("office-document");
  });

  it("buckets XLSX/ODS as 'spreadsheet'", () => {
    expect(categorize("xlsx")).toBe("spreadsheet");
    expect(categorize("ods")).toBe("spreadsheet");
  });

  it("buckets PPTX/ODP as 'presentation'", () => {
    expect(categorize("pptx")).toBe("presentation");
    expect(categorize("odp")).toBe("presentation");
  });

  // v1.39.0 — legacy binary Office formats get their own category so the
  // reports can price conversion + remediation separately. Old cached
  // inventories still carry .doc as "office-document" etc.; consumers accept
  // both categorizations.
  it("buckets legacy .doc/.xls/.ppt as 'legacy-office'", () => {
    expect(categorize("doc")).toBe("legacy-office");
    expect(categorize("xls")).toBe("legacy-office");
    expect(categorize("ppt")).toBe("legacy-office");
  });

  it("buckets common image extensions as 'image'", () => {
    expect(categorize("png")).toBe("image");
    expect(categorize("jpg")).toBe("image");
    expect(categorize("jpeg")).toBe("image");
    expect(categorize("gif")).toBe("image");
    expect(categorize("svg")).toBe("image");
    expect(categorize("webp")).toBe("image");
  });

  it("buckets archives as 'archive'", () => {
    expect(categorize("zip")).toBe("archive");
    expect(categorize("tar")).toBe("archive");
    expect(categorize("gz")).toBe("archive");
    expect(categorize("7z")).toBe("archive");
  });

  it("buckets text formats as 'text'", () => {
    expect(categorize("txt")).toBe("text");
    expect(categorize("md")).toBe("text");
    expect(categorize("csv")).toBe("text");
    expect(categorize("json")).toBe("text");
  });

  it("buckets web formats as 'web'", () => {
    expect(categorize("html")).toBe("web");
    expect(categorize("htm")).toBe("web");
  });

  it("buckets audio/video as 'audio-video'", () => {
    expect(categorize("mp3")).toBe("audio-video");
    expect(categorize("mp4")).toBe("audio-video");
    expect(categorize("mov")).toBe("audio-video");
  });

  it("falls back to 'other' for unknown extensions", () => {
    expect(categorize("xyz")).toBe("other");
    expect(categorize("")).toBe("other");
  });

  it("is case-insensitive", () => {
    expect(categorize("PDF")).toBe("pdf");
    expect(categorize("Docx")).toBe("office-document");
  });
});

describe("isRemediable", () => {
  it("returns true for pdf/office/spreadsheet/presentation/legacy-office", () => {
    expect(isRemediable("pdf")).toBe(true);
    expect(isRemediable("office-document")).toBe(true);
    expect(isRemediable("spreadsheet")).toBe(true);
    expect(isRemediable("presentation")).toBe(true);
    expect(isRemediable("legacy-office")).toBe(true);
  });

  it("returns false for everything else", () => {
    expect(isRemediable("image")).toBe(false);
    expect(isRemediable("archive")).toBe(false);
    expect(isRemediable("text")).toBe(false);
    expect(isRemediable("web")).toBe(false);
    expect(isRemediable("audio-video")).toBe(false);
    expect(isRemediable("other")).toBe(false);
  });
});

describe("REMEDIABLE_CATEGORIES is the single canonical set (v1.40.0)", () => {
  it("exports exactly the five real categories — no phantom office-legacy synonym", async () => {
    const { REMEDIABLE_CATEGORIES } = await import("../src/scanner/category.js");
    expect([...REMEDIABLE_CATEGORIES].sort()).toEqual(
      ["legacy-office", "office-document", "pdf", "presentation", "spreadsheet"],
    );
  });
});

describe("isScoreable / isUnscoreableDocument (v1.54.0)", () => {
  it("scores pdf, docx, xlsx, pptx by extension", () => {
    for (const extension of ["pdf", "docx", "xlsx", "pptx", "PDF", "DocX"]) {
      expect(isScoreable({ extension, category: categorize(extension) })).toBe(true);
    }
  });

  it("does not score legacy binaries, ODF, rtf, or non-documents", () => {
    for (const extension of ["doc", "xls", "ppt", "rtf", "odt", "ods", "odp", "jpg", "html", ""]) {
      expect(isScoreable({ extension, category: categorize(extension) })).toBe(false);
    }
  });

  it("tolerates pre-v1.39.0 category drift — a .doc filed under office-document is still unscoreable", () => {
    expect(isScoreable({ extension: "doc", category: "office-document" })).toBe(false);
    expect(isUnscoreableDocument({ extension: "doc", category: "office-document" })).toBe(true);
  });

  it("isUnscoreableDocument = remediable but not machine-scoreable", () => {
    expect(isUnscoreableDocument({ extension: "xls", category: "legacy-office" })).toBe(true);
    expect(isUnscoreableDocument({ extension: "rtf", category: "office-document" })).toBe(true);
    expect(isUnscoreableDocument({ extension: "odp", category: "presentation" })).toBe(true);
    expect(isUnscoreableDocument({ extension: "docx", category: "office-document" })).toBe(false);
    expect(isUnscoreableDocument({ extension: "pdf", category: "pdf" })).toBe(false);
    expect(isUnscoreableDocument({ extension: "jpg", category: "image" })).toBe(false);
  });

  it("SCOREABLE_EXTENSIONS is exactly the four OOXML-era formats", () => {
    expect([...SCOREABLE_EXTENSIONS].sort()).toEqual(["docx", "pdf", "pptx", "xlsx"]);
  });
});
