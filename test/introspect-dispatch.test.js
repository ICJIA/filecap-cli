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
});
