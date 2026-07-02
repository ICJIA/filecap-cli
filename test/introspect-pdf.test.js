import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { introspectPdf, parsePdfDate } from "../src/introspect/pdf.js";
import { pdfIntrospectionSchema } from "../src/schema/inventory.js";

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-pdf-intro-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function writePdf(filePath, builder) {
  const pdfDoc = await PDFDocument.create();
  await builder(pdfDoc);
  const bytes = await pdfDoc.save();
  await fs.writeFile(filePath, bytes);
}

describe("introspectPdf", () => {
  it("introspects a born-digital PDF with text", async () => {
    const file = path.join(tmpRoot, "born-digital.pdf");
    await writePdf(file, async (doc) => {
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const page = doc.addPage([600, 400]);
      page.drawText("Hello, accessibility audit.", {
        x: 50,
        y: 350,
        size: 16,
        font,
        color: rgb(0, 0, 0),
      });
      doc.setProducer("filecap-test-pdf-lib");
      doc.setCreator("filecap-test");
    });

    const result = await introspectPdf(file);
    expect(() => pdfIntrospectionSchema.parse(result)).not.toThrow();
    expect(result.kind).toBe("pdf");
    expect(result.pageCount).toBe(1);
    expect(result.hasTextLayer).toBe(true);
    expect(result.isImageOnly).toBe(false);
    expect(result.hasFormFields).toBe(false);
    expect(result.hasSignatures).toBe(false);
    expect(result.encrypted).toBe(false);
    expect(result.producer).toMatch(/filecap-test-pdf-lib/);
    expect(result.creator).toBe("filecap-test");
  });

  it("flags an image-only PDF", async () => {
    const file = path.join(tmpRoot, "image-only.pdf");
    await writePdf(file, async (doc) => {
      const page = doc.addPage([600, 400]);
      // 1x1 transparent PNG
      const pngBytes = Buffer.from(
        "89504E470D0A1A0A0000000D49484452000000010000000108020000009007770D" +
          "0000000C49444154789C636060600000000A0001AE61F11D0000000049454E44AE426082",
        "hex",
      );
      const image = await doc.embedPng(pngBytes);
      page.drawImage(image, { x: 0, y: 0, width: 600, height: 400 });
      // No drawText calls — page has only the image.
    });

    const result = await introspectPdf(file);
    expect(() => pdfIntrospectionSchema.parse(result)).not.toThrow();
    expect(result.pageCount).toBe(1);
    expect(result.hasTextLayer).toBe(false);
    expect(result.isImageOnly).toBe(true);
  });

  it("flags a PDF with form fields", async () => {
    const file = path.join(tmpRoot, "form.pdf");
    await writePdf(file, async (doc) => {
      const page = doc.addPage([600, 400]);
      const form = doc.getForm();
      const textField = form.createTextField("name");
      textField.addToPage(page, { x: 50, y: 50, width: 200, height: 30 });
    });

    const result = await introspectPdf(file);
    expect(() => pdfIntrospectionSchema.parse(result)).not.toThrow();
    expect(result.hasFormFields).toBe(true);
  });

  it("extracts title, author, subject, keywords from PDF metadata", async () => {
    const file = path.join(tmpRoot, "metadata.pdf");
    await writePdf(file, async (doc) => {
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const page = doc.addPage([600, 400]);
      page.drawText("Document text.", { x: 50, y: 350, size: 14, font, color: rgb(0, 0, 0) });
      doc.setTitle("Audit Report 2024");
      doc.setAuthor("Jane Smith");
      doc.setSubject("Accessibility Review");
      doc.setKeywords(["accessibility", "WCAG"]);
    });

    const result = await introspectPdf(file);
    expect(() => pdfIntrospectionSchema.parse(result)).not.toThrow();
    expect(result.title).toBe("Audit Report 2024");
    expect(result.author).toBe("Jane Smith");
    expect(result.subject).toBe("Accessibility Review");
    expect(result.keywords).toMatch(/accessibility/);
  });

  it("returns null for missing title/author and a non-negative approxWordCount", async () => {
    const file = path.join(tmpRoot, "no-meta.pdf");
    await writePdf(file, async (doc) => {
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const page = doc.addPage([600, 400]);
      page.drawText("Hello world this is a test sentence.", { x: 50, y: 350, size: 14, font, color: rgb(0, 0, 0) });
    });

    const result = await introspectPdf(file);
    expect(() => pdfIntrospectionSchema.parse(result)).not.toThrow();
    expect(result.title).toBeNull();
    expect(result.author).toBeNull();
    expect(result.subject).toBeNull();
    expect(result.keywords).toBeNull();
    expect(typeof result.approxWordCount).toBe("number");
    expect(result.approxWordCount).toBeGreaterThanOrEqual(0);
  });

  it("throws on a malformed PDF", async () => {
    const file = path.join(tmpRoot, "garbage.pdf");
    await fs.writeFile(file, "not a pdf at all, just bytes");
    await expect(introspectPdf(file)).rejects.toThrow();
  });

  // v1.39.0 (F2): pdfjs logs warnings via console.log at its default
  // verbosity; in NDJSON-to-stdout pipelines that chatter corrupts the
  // stream. verbosity is pinned to errors-only (VerbosityLevel.ERRORS = 0).
  it("suppresses pdfjs warning chatter (verbosity pinned to errors-only)", async () => {
    const file = path.join(tmpRoot, "corrupt-xref.pdf");
    // Corrupt the startxref offset: pdfjs recovers by indexing all objects,
    // which at default verbosity prints "Warning: Indexing all PDF objects".
    await writePdf(file, async (doc) => {
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const page = doc.addPage([300, 200]);
      page.drawText("x", { x: 10, y: 10, size: 8, font });
    });
    const raw = await fs.readFile(file);
    const corrupted = raw
      .toString("latin1")
      .replace(/startxref\n\d+/, "startxref\n999999");
    await fs.writeFile(file, Buffer.from(corrupted, "latin1"));

    const logs = [];
    const origLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(" "));
    };
    try {
      const result = await introspectPdf(file);
      expect(result.pageCount).toBe(1);
    } finally {
      console.log = origLog;
    }
    const warnings = logs.filter((l) => l.startsWith("Warning:"));
    expect(warnings).toEqual([]);
  });

  // v1.39.0 (F5): both date fields are consistent ISO 8601 UTC (or null).
  it("emits ISO 8601 UTC for both creationDate and modificationDate", async () => {
    const file = path.join(tmpRoot, "dates.pdf");
    const created = new Date("2024-03-05T10:20:30.000Z");
    const modified = new Date("2025-02-07T16:16:07.000Z");
    await writePdf(file, async (doc) => {
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const page = doc.addPage([300, 200]);
      page.drawText("dated", { x: 10, y: 10, size: 8, font });
      doc.setCreationDate(created);
      doc.setModificationDate(modified);
    });

    const result = await introspectPdf(file);
    expect(() => pdfIntrospectionSchema.parse(result)).not.toThrow();
    expect(result.creationDate).toBe(created.toISOString());
    expect(result.modificationDate).toBe(modified.toISOString());
  });
});

// v1.39.0 (F5): parsePdfDate previously DROPPED the O±HH'mm' timezone
// suffix, shifting every offset-bearing timestamp by its local offset.
describe("parsePdfDate", () => {
  it("applies a negative UTC offset to produce the true instant", () => {
    expect(parsePdfDate("D:20260101120000-06'00")).toBe("2026-01-01T18:00:00.000Z");
  });

  it("applies a positive half-hour offset (spec form with trailing apostrophe)", () => {
    expect(parsePdfDate("D:20260101120000+05'30'")).toBe("2026-01-01T06:30:00.000Z");
  });

  it("applies an hour-only offset", () => {
    expect(parsePdfDate("D:20260101120000-06")).toBe("2026-01-01T18:00:00.000Z");
  });

  it("passes an explicit Z through unchanged", () => {
    expect(parsePdfDate("D:20260101120000Z")).toBe("2026-01-01T12:00:00.000Z");
  });

  // The plan asks for a naive no-Z timestamp here, but the inventory schema
  // (inventory.js: isoDate = z.string().datetime({ offset: false })) pins
  // creationDate to a Z-terminated UTC instant — a naive value would fail
  // entrySchema.parse and abort the scan. Keep the long-standing assume-UTC
  // reading for offset-less dates; see the parser comment.
  it("treats a missing offset as UTC (schema requires a Z-instant)", () => {
    expect(parsePdfDate("D:20260101120000")).toBe("2026-01-01T12:00:00.000Z");
  });

  it("accepts date-only values and a missing D: prefix", () => {
    expect(parsePdfDate("D:20260101")).toBe("2026-01-01T00:00:00.000Z");
    expect(parsePdfDate("20260101120000Z")).toBe("2026-01-01T12:00:00.000Z");
  });

  it("returns undefined for garbage and non-strings", () => {
    expect(parsePdfDate("not a date")).toBeUndefined();
    expect(parsePdfDate("D:99999999")).toBeUndefined();
    expect(parsePdfDate(undefined)).toBeUndefined();
    expect(parsePdfDate(null)).toBeUndefined();
  });
});
