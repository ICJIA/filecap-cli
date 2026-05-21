import { describe, it, expect } from "vitest";
import { computeContentFlags, SIGNATURE_EXTENSIONS } from "../src/flag/content.js";

const buf = (...bytes) => Buffer.from(bytes);
const PDF = buf(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37); // %PDF-1.7
const ZIP = buf(0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0); // PK.. (docx/xlsx/pptx)
const PNG = buf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
// The real-world case that prompted this: an HTML document uploaded with a
// .pdf extension — six leading newlines, then <!DOCTYPE.
const HTML = Buffer.from("\n\n\n\n\n\n<!DOCTYPE html>");

describe("computeContentFlags", () => {
  it("returns [] for a real PDF under a .pdf extension", () => {
    expect(computeContentFlags("pdf", PDF)).toEqual([]);
  });

  it("flags HTML content served under a .pdf extension", () => {
    expect(computeContentFlags("pdf", HTML)).toEqual(["content-type-mismatch"]);
  });

  it("returns [] for a real .docx (zip magic)", () => {
    expect(computeContentFlags("docx", ZIP)).toEqual([]);
    expect(computeContentFlags("xlsx", ZIP)).toEqual([]);
    expect(computeContentFlags("pptx", ZIP)).toEqual([]);
  });

  it("flags a .docx whose content is not a zip", () => {
    expect(computeContentFlags("docx", HTML)).toEqual(["content-type-mismatch"]);
  });

  it("returns [] for a real PNG and flags a fake one", () => {
    expect(computeContentFlags("png", PNG)).toEqual([]);
    expect(computeContentFlags("png", HTML)).toEqual(["content-type-mismatch"]);
  });

  it("returns [] for an extension with no known signature", () => {
    expect(computeContentFlags("txt", HTML)).toEqual([]);
    expect(computeContentFlags("html", HTML)).toEqual([]);
    expect(computeContentFlags("", HTML)).toEqual([]);
  });

  it("is case-insensitive on the extension", () => {
    expect(computeContentFlags("PDF", HTML)).toEqual(["content-type-mismatch"]);
  });

  it("flags a file too short to contain the signature", () => {
    expect(computeContentFlags("pdf", buf(0x25, 0x50))).toEqual(["content-type-mismatch"]);
  });

  it("returns [] when the header could not be read (null)", () => {
    expect(computeContentFlags("pdf", null)).toEqual([]);
  });

  it("SIGNATURE_EXTENSIONS lists the checked extensions", () => {
    expect(SIGNATURE_EXTENSIONS.has("pdf")).toBe(true);
    expect(SIGNATURE_EXTENSIONS.has("docx")).toBe(true);
    expect(SIGNATURE_EXTENSIONS.has("png")).toBe(true);
    expect(SIGNATURE_EXTENSIONS.has("txt")).toBe(false);
  });
});
