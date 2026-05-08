import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  TextRun,
  ExternalHyperlink,
} from "docx";
import { introspectDocx } from "../src/introspect/docx.js";
import { docxIntrospectionSchema } from "../src/schema/inventory.js";

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-docx-intro-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function writeDocx(filePath, doc) {
  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(filePath, buffer);
}

describe("introspectDocx", () => {
  it("introspects a DOCX with headings", async () => {
    const file = path.join(tmpRoot, "headings.docx");
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: "Title", heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ text: "Subtitle", heading: HeadingLevel.HEADING_2 }),
            new Paragraph({ text: "Body text content here." }),
          ],
        },
      ],
    });
    await writeDocx(file, doc);

    const result = await introspectDocx(file);
    expect(() => docxIntrospectionSchema.parse(result)).not.toThrow();
    expect(result.kind).toBe("docx");
    expect(result.hasHeadings).toBe(true);
    expect(result.imageCount).toBe(0);
    expect(result.tableCount).toBe(0);
    expect(result.hyperlinkCount).toBe(0);
  });

  it("introspects a DOCX with no headings", async () => {
    const file = path.join(tmpRoot, "no-headings.docx");
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: "Just plain body text with no headings." }),
            new Paragraph({ text: "Another plain paragraph." }),
          ],
        },
      ],
    });
    await writeDocx(file, doc);

    const result = await introspectDocx(file);
    expect(result.hasHeadings).toBe(false);
  });

  it("counts tables in a DOCX", async () => {
    const file = path.join(tmpRoot, "tables.docx");
    const makeRow = (text) =>
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph(text)] }),
          new TableCell({ children: [new Paragraph(text + "-2")] }),
        ],
      });
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: "Document with tables." }),
            new Table({ rows: [makeRow("a"), makeRow("b")] }),
            new Table({ rows: [makeRow("c"), makeRow("d")] }),
          ],
        },
      ],
    });
    await writeDocx(file, doc);

    const result = await introspectDocx(file);
    expect(result.tableCount).toBe(2);
  });

  it("counts hyperlinks and detects vague link text", async () => {
    const file = path.join(tmpRoot, "links.docx");
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              children: [
                new ExternalHyperlink({
                  link: "https://example.com",
                  children: [new TextRun({ text: "Real descriptive link", style: "Hyperlink" })],
                }),
              ],
            }),
            new Paragraph({
              children: [
                new ExternalHyperlink({
                  link: "https://example.com/click",
                  children: [new TextRun({ text: "click here", style: "Hyperlink" })],
                }),
              ],
            }),
            new Paragraph({
              children: [
                new ExternalHyperlink({
                  link: "https://example.com/more",
                  children: [new TextRun({ text: "Read more", style: "Hyperlink" })],
                }),
              ],
            }),
          ],
        },
      ],
    });
    await writeDocx(file, doc);

    const result = await introspectDocx(file);
    expect(result.hyperlinkCount).toBe(3);
    expect(result.vagueLinkCount).toBe(2); // "click here" + "Read more"
  });

  it("throws on a malformed DOCX", async () => {
    const file = path.join(tmpRoot, "garbage.docx");
    await fs.writeFile(file, "this is not a real docx file");
    await expect(introspectDocx(file)).rejects.toThrow();
  });
});
