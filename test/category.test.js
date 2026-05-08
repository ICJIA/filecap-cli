import { describe, it, expect } from "vitest";
import { categorize, isRemediable } from "../src/scanner/category.js";

describe("categorize", () => {
  it("buckets PDFs as 'pdf'", () => {
    expect(categorize("pdf")).toBe("pdf");
  });

  it("buckets DOCX/DOC as 'office-document'", () => {
    expect(categorize("docx")).toBe("office-document");
    expect(categorize("doc")).toBe("office-document");
  });

  it("buckets XLSX/XLS as 'spreadsheet'", () => {
    expect(categorize("xlsx")).toBe("spreadsheet");
    expect(categorize("xls")).toBe("spreadsheet");
  });

  it("buckets PPTX/PPT as 'presentation'", () => {
    expect(categorize("pptx")).toBe("presentation");
    expect(categorize("ppt")).toBe("presentation");
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
  it("returns true for pdf/office/spreadsheet/presentation", () => {
    expect(isRemediable("pdf")).toBe(true);
    expect(isRemediable("office-document")).toBe(true);
    expect(isRemediable("spreadsheet")).toBe(true);
    expect(isRemediable("presentation")).toBe(true);
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
