import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { introspectPdf } from "../src/introspect/pdf.js";
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
});
