import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { introspect } from "../src/introspect/index.js";

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-dispatch-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function writeBornDigitalPdf(filePath) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.addPage();
  page.drawText("hi", { x: 50, y: 50, size: 12, font });
  await fs.writeFile(filePath, await pdfDoc.save());
}

describe("introspect dispatcher", () => {
  it("returns null for unknown extensions", async () => {
    const file = path.join(tmpRoot, "x.png");
    await fs.writeFile(file, "x");
    const result = await introspect({
      filePath: file,
      extension: "png",
      sizeBytes: 1,
      maxIntrospectMb: 200,
    });
    expect(result).toBe(null);
  });

  it("routes pdf extensions to the PDF introspector", async () => {
    const file = path.join(tmpRoot, "x.pdf");
    await writeBornDigitalPdf(file);
    const stat = await fs.stat(file);
    const result = await introspect({
      filePath: file,
      extension: "pdf",
      sizeBytes: stat.size,
      maxIntrospectMb: 200,
    });
    expect(result).not.toBe(null);
    expect(result.kind).toBe("pdf");
    expect(result.pageCount).toBe(1);
  });

  it("returns null when the file exceeds maxIntrospectMb", async () => {
    const file = path.join(tmpRoot, "huge.pdf");
    await writeBornDigitalPdf(file);
    const result = await introspect({
      filePath: file,
      extension: "pdf",
      sizeBytes: 300 * 1024 * 1024, // claim 300 MB
      maxIntrospectMb: 200,
    });
    expect(result).toBe(null);
  });

  it("propagates pdf introspection failures (caller catches)", async () => {
    const file = path.join(tmpRoot, "bad.pdf");
    await fs.writeFile(file, "not a real pdf");
    await expect(
      introspect({
        filePath: file,
        extension: "pdf",
        sizeBytes: 14,
        maxIntrospectMb: 200,
      }),
    ).rejects.toThrow();
  });

  it("routes docx to the docx introspector", async () => {
    const { Document, Packer, Paragraph } = await import("docx");
    const docxFile = path.join(tmpRoot, "x.docx");
    const doc = new Document({
      sections: [{ children: [new Paragraph({ text: "hi" })] }],
    });
    await fs.writeFile(docxFile, await Packer.toBuffer(doc));

    const result = await introspect({
      filePath: docxFile,
      extension: "docx",
      sizeBytes: 1024,
      maxIntrospectMb: 200,
    });
    expect(result).not.toBe(null);
    expect(result.kind).toBe("docx");
  });

  it("routes xlsx to the xlsx introspector", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const xlsxFile = path.join(tmpRoot, "x.xlsx");
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Sheet1");
    await wb.xlsx.writeFile(xlsxFile);

    const result = await introspect({
      filePath: xlsxFile,
      extension: "xlsx",
      sizeBytes: 1024,
      maxIntrospectMb: 200,
    });
    expect(result).not.toBe(null);
    expect(result.kind).toBe("xlsx");
  });

  it("routes doc/ppt/xls to the legacy office stub", async () => {
    for (const ext of ["doc", "ppt", "xls"]) {
      const file = path.join(tmpRoot, `x.${ext}`);
      await fs.writeFile(file, "legacy bytes");
      const result = await introspect({
        filePath: file,
        extension: ext,
        sizeBytes: 12,
        maxIntrospectMb: 200,
      });
      expect(result).not.toBe(null);
      expect(result.kind).toBe("office-legacy");
      expect(result.format).toBe(ext);
    }
  });

  it("returns null for pptx (Phase 3 deferred)", async () => {
    const file = path.join(tmpRoot, "x.pptx");
    await fs.writeFile(file, "x");
    const result = await introspect({
      filePath: file,
      extension: "pptx",
      sizeBytes: 1,
      maxIntrospectMb: 200,
    });
    expect(result).toBe(null);
  });
});
