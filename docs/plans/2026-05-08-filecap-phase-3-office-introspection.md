# filecap Phase 3 — Office Introspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@icjia/filecap@0.3.0` — DOCX and XLSX introspection per design doc section 7, plus a "presence flag" stub for legacy `.doc/.ppt/.xls`. Each Office entry in NDJSON gains a typed `introspection` block carrying format-specific accessibility signals.

**Architecture:** Per-format introspection modules under `src/introspect/`: `docx.js` (unzip + XML parse via jszip + fast-xml-parser), `xlsx.js` (via exceljs), and `office-legacy.js` (extension-only marker). The Phase 2 dispatcher gains routes for the new extensions. The schema's `introspection` field becomes a Zod discriminated union over `kind` (`pdf` | `docx` | `xlsx` | `office-legacy`).

**Tech Stack:** Node 20+, ESM. New runtime deps: `jszip`, `fast-xml-parser`, `exceljs`. New devDep: `docx` (for synthesizing test fixtures).

**Out of scope for Phase 3:** PPTX (deferred), filename pattern flagging (Phase 4), rollup (Phase 5), report (Phase 6).

---

## File Structure

```
icjia-fleet-audit/
├── package.json                          ← modify (add deps; bump to 0.3.0 in Task 11)
├── package-lock.json                     ← regenerated
├── src/
│   ├── introspect/
│   │   ├── pdf.js                        (existing)
│   │   ├── docx.js                       ← create
│   │   ├── xlsx.js                       ← create
│   │   ├── office-legacy.js              ← create (extension-only marker)
│   │   └── index.js                      ← modify (route docx/xlsx/doc/ppt/xls)
│   ├── schema/
│   │   └── inventory.js                  ← modify (add docx/xlsx/office-legacy schemas; discriminated union)
│   └── index.js                          ← modify (re-export new schemas/modules)
├── test/
│   ├── introspect-docx.test.js           ← create
│   ├── introspect-xlsx.test.js           ← create
│   ├── introspect-dispatch.test.js       ← modify (add docx/xlsx routing tests)
│   ├── scan.test.js                      ← modify (add Office E2E tests)
│   └── schema.test.js                    ← modify (add docx/xlsx schema tests)
├── README.md                             ← modify (Phase 3 status, examples, troubleshooting)
└── CHANGELOG.md                          ← modify (add [0.3.0] entry)
```

---

## Task 1 — Bootstrap deps

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1.1: Install runtime + dev deps**

```bash
cd /Volumes/satechi/webdev/icjia-fleet-audit
npm install jszip@^3 fast-xml-parser@^4 exceljs@^4
npm install --save-dev docx@^9
```

Expected: `package.json` gains 3 entries under `dependencies` and 1 under `devDependencies`. No errors.

- [ ] **Step 1.2: Verify imports**

```bash
node -e "
import('jszip').then(m => console.log('jszip ok:', typeof m.default === 'function'));
import('fast-xml-parser').then(m => console.log('fxp ok:', typeof m.XMLParser === 'function'));
import('exceljs').then(m => console.log('exceljs ok:', typeof m.default.Workbook === 'function'));
import('docx').then(m => console.log('docx ok:', typeof m.Document === 'function'));
"
```

Expected: 4 lines all ending in `ok: true`.

- [ ] **Step 1.3: Confirm tests pass**

```bash
npm test
```

Expected: 73 tests still passing.

- [ ] **Step 1.4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add jszip, fast-xml-parser, exceljs (runtime) and docx (dev) for Phase 3"
```

---

## Task 2 — Schema: discriminated union for introspection

**Files:**
- Modify: `src/schema/inventory.js`
- Modify: `test/schema.test.js`

- [ ] **Step 2.1: Write the failing tests**

Append to `test/schema.test.js` inside the existing `describe("inventory schemas", ...)` block, before its closing `});`:

```js
  it("validates an entry with docx introspection", () => {
    const entry = {
      path: "report.docx",
      absolutePath: "/uploads/report.docx",
      filename: "report.docx",
      extension: "docx",
      category: "office-document",
      remediable: true,
      sizeBytes: 50000,
      modifiedAt: "2024-01-01T00:00:00.000Z",
      sha256: "",
      flags: [],
      introspection: {
        kind: "docx",
        hasHeadings: true,
        imageCount: 3,
        altTextCoverage: 0.667,
        tableCount: 2,
        tablesHaveHeaders: true,
        hyperlinkCount: 5,
        vagueLinkCount: 1,
        documentLanguage: "en-US",
      },
    };
    expect(() => entrySchema.parse(entry)).not.toThrow();
  });

  it("validates an entry with xlsx introspection", () => {
    const entry = {
      path: "data.xlsx",
      absolutePath: "/uploads/data.xlsx",
      filename: "data.xlsx",
      extension: "xlsx",
      category: "spreadsheet",
      remediable: true,
      sizeBytes: 25000,
      modifiedAt: "2024-01-01T00:00:00.000Z",
      sha256: "",
      flags: [],
      introspection: {
        kind: "xlsx",
        sheetCount: 3,
        sheetNames: ["Summary", "Details", "Sheet3"],
        defaultSheetNameCount: 1,
        hasHeaderRows: true,
        mergedCellCount: 4,
        hasCharts: false,
        hasImages: true,
      },
    };
    expect(() => entrySchema.parse(entry)).not.toThrow();
  });

  it("validates an entry with office-legacy introspection", () => {
    const entry = {
      path: "old.doc",
      absolutePath: "/uploads/old.doc",
      filename: "old.doc",
      extension: "doc",
      category: "office-document",
      remediable: true,
      sizeBytes: 1024,
      modifiedAt: "2024-01-01T00:00:00.000Z",
      sha256: "",
      flags: [],
      introspection: {
        kind: "office-legacy",
        format: "doc",
      },
    };
    expect(() => entrySchema.parse(entry)).not.toThrow();
  });

  it("rejects an introspection block with an unknown kind", () => {
    const entry = {
      path: "x.pdf",
      absolutePath: "/uploads/x.pdf",
      filename: "x.pdf",
      extension: "pdf",
      category: "pdf",
      remediable: true,
      sizeBytes: 1024,
      modifiedAt: "2024-01-01T00:00:00.000Z",
      sha256: "",
      flags: [],
      introspection: {
        kind: "unknown-format",
      },
    };
    expect(() => entrySchema.parse(entry)).toThrow();
  });
```

ALSO update the import at the top of `test/schema.test.js` to add the new schemas:

```js
import {
  headerSchema,
  entrySchema,
  footerSchema,
  isCompleteInventory,
  pdfIntrospectionSchema,
  docxIntrospectionSchema,
  xlsxIntrospectionSchema,
  legacyOfficeIntrospectionSchema,
  SCHEMA_VERSION,
} from "../src/schema/inventory.js";
```

- [ ] **Step 2.2: Run tests, verify failure**

```bash
npx vitest run test/schema.test.js
```

Expected: 4 new tests fail (schemas not yet exported, entry's `introspection` field doesn't accept the new shapes).

- [ ] **Step 2.3: Implement the schema additions in `src/schema/inventory.js`**

Read `src/schema/inventory.js` first. Currently it has `pdfIntrospectionSchema` and `entrySchema` with `introspection: pdfIntrospectionSchema.optional()`.

Add three new schemas AFTER `pdfIntrospectionSchema` and BEFORE `entrySchema`:

```js
export const docxIntrospectionSchema = z.object({
  kind: z.literal("docx"),
  hasHeadings: z.boolean(),
  imageCount: z.number().int().nonnegative(),
  altTextCoverage: z.number().min(0).max(1).optional(),
  tableCount: z.number().int().nonnegative(),
  tablesHaveHeaders: z.boolean().optional(),
  hyperlinkCount: z.number().int().nonnegative(),
  vagueLinkCount: z.number().int().nonnegative(),
  documentLanguage: z.string().optional(),
});

export const xlsxIntrospectionSchema = z.object({
  kind: z.literal("xlsx"),
  sheetCount: z.number().int().nonnegative(),
  sheetNames: z.array(z.string()),
  defaultSheetNameCount: z.number().int().nonnegative(),
  hasHeaderRows: z.boolean(),
  mergedCellCount: z.number().int().nonnegative(),
  hasCharts: z.boolean(),
  hasImages: z.boolean(),
});

export const legacyOfficeIntrospectionSchema = z.object({
  kind: z.literal("office-legacy"),
  format: z.enum(["doc", "ppt", "xls"]),
});
```

Then change `entrySchema`'s `introspection` field from `pdfIntrospectionSchema.optional()` to a discriminated union. Replace:

```js
  introspection: pdfIntrospectionSchema.optional(),
```

with:

```js
  introspection: z
    .discriminatedUnion("kind", [
      pdfIntrospectionSchema,
      docxIntrospectionSchema,
      xlsxIntrospectionSchema,
      legacyOfficeIntrospectionSchema,
    ])
    .optional(),
```

- [ ] **Step 2.4: Run tests**

```bash
npx vitest run test/schema.test.js
```

Expected: 22 schema tests passing (18 prior + 4 new).

```bash
npx vitest run
```

Expected: 77 total tests passing (73 prior + 4 new).

- [ ] **Step 2.5: Lint**

```bash
npx eslint src/schema/inventory.js test/schema.test.js
```

Expected: clean.

- [ ] **Step 2.6: Commit**

```bash
git add src/schema/inventory.js test/schema.test.js
git commit -m "feat(schema): add docx/xlsx/office-legacy introspection schemas + discriminated union"
```

---

## Task 3 — DOCX introspection module

**Files:**
- Create: `src/introspect/docx.js`
- Create: `test/introspect-docx.test.js`

- [ ] **Step 3.1: Write the failing tests**

Create `test/introspect-docx.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  ImageRun,
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
```

- [ ] **Step 3.2: Run tests, verify failure**

```bash
npx vitest run test/introspect-docx.test.js
```

Expected: 5 tests fail with module-resolution error.

- [ ] **Step 3.3: Implement `src/introspect/docx.js`**

Create the file:

```js
import fs from "node:fs/promises";

const VAGUE_LINK_PATTERNS = [
  /^click here$/i,
  /^click$/i,
  /^here$/i,
  /^read more$/i,
  /^more$/i,
  /^learn more$/i,
  /^this$/i,
  /^link$/i,
];

/**
 * Introspect a DOCX file. DOCX is a zip of XML; we read word/document.xml,
 * word/styles.xml, and the relationships file directly.
 *
 * Throws on parse failure (malformed zip, missing required parts, etc.).
 *
 * @param {string} filePath
 * @returns {Promise<object>} introspection block per docxIntrospectionSchema
 */
export async function introspectDocx(filePath) {
  const { default: JSZip } = await import("jszip");
  const { XMLParser } = await import("fast-xml-parser");

  const data = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(data);

  const documentXml = zip.file("word/document.xml");
  if (!documentXml) {
    throw new Error("DOCX missing word/document.xml");
  }
  const documentText = await documentXml.async("string");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    parseTagValue: false,
    isArray: () => false,
    preserveOrder: false,
    removeNSPrefix: false,
  });
  const docTree = parser.parse(documentText);

  // Recursively collect all element nodes by tag name from the parsed tree.
  // The XMLParser returns a nested object/array structure where each node
  // can have child elements as keyed properties, attributes prefixed with
  // "@_", and text under "#text".
  function collectByTag(node, tagName, out = []) {
    if (node === null || typeof node !== "object") return out;
    if (Array.isArray(node)) {
      for (const item of node) collectByTag(item, tagName, out);
      return out;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === tagName) {
        if (Array.isArray(value)) {
          for (const v of value) out.push(v);
        } else {
          out.push(value);
        }
      }
      if (typeof value === "object" && value !== null) {
        collectByTag(value, tagName, out);
      }
    }
    return out;
  }

  // Headings: any paragraph with a pStyle pointing at Heading*
  const paragraphs = collectByTag(docTree, "w:p");
  let hasHeadings = false;
  for (const p of paragraphs) {
    const ppr = p?.["w:pPr"];
    const pStyle = ppr?.["w:pStyle"];
    const styleVal = pStyle?.["@_w:val"] || "";
    if (/^Heading[1-9]/i.test(styleVal) || /^heading[1-9]/i.test(styleVal)) {
      hasHeadings = true;
      break;
    }
  }

  // Image count: w:drawing elements (each represents one inline/floating image)
  const drawings = collectByTag(docTree, "w:drawing");
  const imageCount = drawings.length;

  // Alt text coverage: count drawings that contain a docPr with a non-empty
  // descr attribute. Schema rule: undefined when imageCount is 0; otherwise
  // a fraction in [0, 1].
  let imagesWithAlt = 0;
  for (const drawing of drawings) {
    const docPrs = collectByTag(drawing, "wp:docPr");
    for (const docPr of docPrs) {
      const descr = docPr?.["@_descr"] || "";
      if (descr.trim().length > 0) {
        imagesWithAlt++;
        break;
      }
    }
  }
  const altTextCoverage = imageCount > 0 ? imagesWithAlt / imageCount : undefined;

  // Tables
  const tables = collectByTag(docTree, "w:tbl");
  const tableCount = tables.length;
  // tablesHaveHeaders: heuristic. A table has a header row if it contains
  // any tblHeader element under tblPr or under any row's trPr.
  let tablesHaveHeaders;
  if (tableCount > 0) {
    let withHeaders = 0;
    for (const tbl of tables) {
      const headerHints = collectByTag(tbl, "w:tblHeader");
      if (headerHints.length > 0) withHeaders++;
    }
    tablesHaveHeaders = withHeaders > 0;
  }

  // Hyperlinks: w:hyperlink elements OR external relationship references
  const hyperlinks = collectByTag(docTree, "w:hyperlink");
  const hyperlinkCount = hyperlinks.length;
  // Vague link text detection: collect the text content of each hyperlink
  // and match against VAGUE_LINK_PATTERNS.
  let vagueLinkCount = 0;
  for (const link of hyperlinks) {
    const texts = collectByTag(link, "w:t");
    const combined = texts
      .map((t) => (typeof t === "string" ? t : t?.["#text"] ?? ""))
      .join("")
      .trim();
    if (combined.length === 0) continue;
    if (VAGUE_LINK_PATTERNS.some((re) => re.test(combined))) {
      vagueLinkCount++;
    }
  }

  // Document language: read from word/styles.xml or word/document.xml's
  // sectPr. Try styles.xml first.
  let documentLanguage;
  const stylesXml = zip.file("word/styles.xml");
  if (stylesXml) {
    const stylesText = await stylesXml.async("string");
    const stylesTree = parser.parse(stylesText);
    const langs = collectByTag(stylesTree, "w:lang");
    for (const lang of langs) {
      const val = lang?.["@_w:val"] || "";
      if (val) {
        documentLanguage = val;
        break;
      }
    }
  }
  if (!documentLanguage) {
    // Fall back to scanning the document body for any w:lang
    const langs = collectByTag(docTree, "w:lang");
    for (const lang of langs) {
      const val = lang?.["@_w:val"] || "";
      if (val) {
        documentLanguage = val;
        break;
      }
    }
  }

  const result = {
    kind: "docx",
    hasHeadings,
    imageCount,
    tableCount,
    hyperlinkCount,
    vagueLinkCount,
  };
  if (altTextCoverage !== undefined) result.altTextCoverage = altTextCoverage;
  if (tablesHaveHeaders !== undefined) result.tablesHaveHeaders = tablesHaveHeaders;
  if (documentLanguage) result.documentLanguage = documentLanguage;

  return result;
}
```

- [ ] **Step 3.4: Run tests**

```bash
npx vitest run test/introspect-docx.test.js
```

Expected: 5 tests pass.

If any test fails because the `docx` library's output XML structure differs slightly from what the parser walks, examine the failing assertion and adjust the `collectByTag` traversal or XML key access. The contract is: the test's expected behavior is fixed; the implementation must achieve it.

- [ ] **Step 3.5: Run full suite**

```bash
npx vitest run
```

Expected: 82 tests passing (77 prior + 5 new).

- [ ] **Step 3.6: Lint**

```bash
npx eslint src/introspect/docx.js test/introspect-docx.test.js
```

Expected: clean.

- [ ] **Step 3.7: Commit**

```bash
git add src/introspect/docx.js test/introspect-docx.test.js
git commit -m "feat(introspect): add DOCX introspection via jszip + fast-xml-parser"
```

---

## Task 4 — XLSX introspection module

**Files:**
- Create: `src/introspect/xlsx.js`
- Create: `test/introspect-xlsx.test.js`

- [ ] **Step 4.1: Write the failing tests**

Create `test/introspect-xlsx.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";
import { introspectXlsx } from "../src/introspect/xlsx.js";
import { xlsxIntrospectionSchema } from "../src/schema/inventory.js";

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-xlsx-intro-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("introspectXlsx", () => {
  it("introspects a basic XLSX with multiple sheets", async () => {
    const file = path.join(tmpRoot, "basic.xlsx");
    const wb = new ExcelJS.Workbook();
    const summary = wb.addWorksheet("Summary");
    summary.addRow(["Header A", "Header B", "Header C"]);
    summary.addRow([1, 2, 3]);
    summary.addRow([4, 5, 6]);
    // Make the header row bold to mark it as a header
    summary.getRow(1).font = { bold: true };

    wb.addWorksheet("Details");
    wb.addWorksheet("Sheet3"); // default name
    await wb.xlsx.writeFile(file);

    const result = await introspectXlsx(file);
    expect(() => xlsxIntrospectionSchema.parse(result)).not.toThrow();
    expect(result.kind).toBe("xlsx");
    expect(result.sheetCount).toBe(3);
    expect(result.sheetNames).toEqual(["Summary", "Details", "Sheet3"]);
    expect(result.defaultSheetNameCount).toBe(1);
    expect(result.hasHeaderRows).toBe(true);
    expect(result.mergedCellCount).toBe(0);
  });

  it("counts merged cells across all sheets", async () => {
    const file = path.join(tmpRoot, "merged.xlsx");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Data");
    ws.addRow(["A", "B", "C"]);
    ws.addRow([1, 2, 3]);
    ws.addRow([4, 5, 6]);
    ws.mergeCells("A1:B1");
    ws.mergeCells("A3:C3");
    await wb.xlsx.writeFile(file);

    const result = await introspectXlsx(file);
    expect(result.mergedCellCount).toBe(2);
  });

  it("flags default sheet names like Sheet1, Sheet2", async () => {
    const file = path.join(tmpRoot, "default-names.xlsx");
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Sheet1");
    wb.addWorksheet("Sheet2");
    wb.addWorksheet("Reports");
    await wb.xlsx.writeFile(file);

    const result = await introspectXlsx(file);
    expect(result.defaultSheetNameCount).toBe(2);
  });

  it("returns hasHeaderRows: false when no sheet has a styled first row", async () => {
    const file = path.join(tmpRoot, "no-headers.xlsx");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Plain");
    ws.addRow([1, 2, 3]);
    ws.addRow([4, 5, 6]);
    await wb.xlsx.writeFile(file);

    const result = await introspectXlsx(file);
    expect(result.hasHeaderRows).toBe(false);
  });

  it("throws on a malformed XLSX", async () => {
    const file = path.join(tmpRoot, "garbage.xlsx");
    await fs.writeFile(file, "not an xlsx");
    await expect(introspectXlsx(file)).rejects.toThrow();
  });
});
```

- [ ] **Step 4.2: Run tests, verify failure**

```bash
npx vitest run test/introspect-xlsx.test.js
```

Expected: 5 tests fail.

- [ ] **Step 4.3: Implement `src/introspect/xlsx.js`**

```js
import ExcelJS from "exceljs";

const DEFAULT_SHEET_NAME_RE = /^Sheet\d+$/i;

/**
 * Introspect an XLSX file via exceljs.
 *
 * @param {string} filePath
 * @returns {Promise<object>} introspection block per xlsxIntrospectionSchema
 */
export async function introspectXlsx(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const sheetNames = wb.worksheets.map((ws) => ws.name);
  const sheetCount = wb.worksheets.length;
  const defaultSheetNameCount = sheetNames.filter((n) =>
    DEFAULT_SHEET_NAME_RE.test(n),
  ).length;

  let hasHeaderRows = false;
  let mergedCellCount = 0;
  let hasCharts = false;
  let hasImages = false;

  for (const ws of wb.worksheets) {
    // Header-row heuristic: row 1 has at least one cell with bold font.
    if (!hasHeaderRows) {
      const row1 = ws.getRow(1);
      if (row1 && row1.cellCount > 0) {
        let row1HasBold = false;
        row1.eachCell({ includeEmpty: false }, (cell) => {
          if (cell.font && cell.font.bold) row1HasBold = true;
        });
        if (row1HasBold) hasHeaderRows = true;
      }
    }
    // Merged cells: ws.model.merges is an array of merge ranges.
    if (Array.isArray(ws.model?.merges)) {
      mergedCellCount += ws.model.merges.length;
    }
    // Images: the workbook holds them; we test once globally below. But we
    // also check the worksheet's images for completeness.
    if (Array.isArray(ws.getImages?.()) && ws.getImages().length > 0) {
      hasImages = true;
    }
  }

  // Charts: exceljs exposes them via worksheet model details. Without a stable
  // public API, we conservatively check for any worksheet with a chart in
  // model.charts (some exceljs versions populate this).
  for (const ws of wb.worksheets) {
    const charts = ws.model?.charts;
    if (Array.isArray(charts) && charts.length > 0) {
      hasCharts = true;
      break;
    }
  }

  return {
    kind: "xlsx",
    sheetCount,
    sheetNames,
    defaultSheetNameCount,
    hasHeaderRows,
    mergedCellCount,
    hasCharts,
    hasImages,
  };
}
```

- [ ] **Step 4.4: Run tests**

```bash
npx vitest run test/introspect-xlsx.test.js
```

Expected: 5 tests pass.

- [ ] **Step 4.5: Run full suite**

```bash
npx vitest run
```

Expected: 87 tests passing (82 prior + 5 new).

- [ ] **Step 4.6: Lint**

```bash
npx eslint src/introspect/xlsx.js test/introspect-xlsx.test.js
```

Expected: clean.

- [ ] **Step 4.7: Commit**

```bash
git add src/introspect/xlsx.js test/introspect-xlsx.test.js
git commit -m "feat(introspect): add XLSX introspection via exceljs"
```

---

## Task 5 — Office legacy stub

**Files:**
- Create: `src/introspect/office-legacy.js`

This is the simplest module in Phase 3. Legacy formats (.doc, .ppt, .xls) are flagged by extension only — no parsing.

- [ ] **Step 5.1: Implement `src/introspect/office-legacy.js`**

```js
/**
 * "Introspect" a legacy Office binary (DOC, PPT, XLS). These older formats
 * are too costly to parse without heavy native dependencies; we just flag
 * their presence and the specific format. Vendors will use Acrobat / Office
 * to inspect manually.
 *
 * @param {string} extension - lowercased extension, no dot
 * @returns {object} introspection block per legacyOfficeIntrospectionSchema
 */
export function introspectLegacyOffice(extension) {
  if (extension !== "doc" && extension !== "ppt" && extension !== "xls") {
    throw new Error(`introspectLegacyOffice: unsupported extension "${extension}"`);
  }
  return {
    kind: "office-legacy",
    format: extension,
  };
}
```

This is synchronous — no file I/O needed since we only emit a marker.

- [ ] **Step 5.2: Quick sanity check via Node**

```bash
cd /Volumes/satechi/webdev/icjia-fleet-audit
node -e "
import('./src/introspect/office-legacy.js').then(m => {
  console.log(m.introspectLegacyOffice('doc'));
  console.log(m.introspectLegacyOffice('ppt'));
  console.log(m.introspectLegacyOffice('xls'));
  try { m.introspectLegacyOffice('docx'); } catch (e) { console.log('rejected docx:', e.message); }
});
"
```

Expected:

```
{ kind: 'office-legacy', format: 'doc' }
{ kind: 'office-legacy', format: 'ppt' }
{ kind: 'office-legacy', format: 'xls' }
rejected docx: introspectLegacyOffice: unsupported extension "docx"
```

- [ ] **Step 5.3: Run full suite**

```bash
npm test
```

Expected: 87 tests still passing.

- [ ] **Step 5.4: Lint**

```bash
npx eslint src/introspect/office-legacy.js
```

Expected: clean.

- [ ] **Step 5.5: Commit**

```bash
git add src/introspect/office-legacy.js
git commit -m "feat(introspect): add legacy Office (.doc/.ppt/.xls) presence-flag stub"
```

---

## Task 6 — Update dispatcher

**Files:**
- Modify: `src/introspect/index.js`
- Modify: `test/introspect-dispatch.test.js`

- [ ] **Step 6.1: Write failing tests**

Append to `test/introspect-dispatch.test.js` (inside the existing `describe("introspect dispatcher", ...)` block, before its closing `});`):

```js
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
```

- [ ] **Step 6.2: Run tests, verify failure**

```bash
npx vitest run test/introspect-dispatch.test.js
```

Expected: 4 new tests fail.

- [ ] **Step 6.3: Update `src/introspect/index.js`**

Read the current file first. It currently routes only `pdf`. Replace its body with:

```js
import { introspectPdf } from "./pdf.js";
import { introspectDocx } from "./docx.js";
import { introspectXlsx } from "./xlsx.js";
import { introspectLegacyOffice } from "./office-legacy.js";

const LEGACY_OFFICE_EXTENSIONS = new Set(["doc", "ppt", "xls"]);

/**
 * Dispatch a file to its appropriate introspector based on extension.
 * Returns the introspection block on success, or null when:
 *   - the extension isn't introspectable in this version (e.g., pptx, deferred)
 *   - the file exceeds maxIntrospectMb
 *
 * Throws when introspection itself fails (corrupt file, parse exception).
 * The caller (the scan orchestrator) catches and omits the introspection
 * key from the entry per the empty-on-failure rule.
 *
 * @param {object} opts
 * @param {string} opts.filePath
 * @param {string} opts.extension - lowercased, no leading dot
 * @param {number} opts.sizeBytes
 * @param {number} opts.maxIntrospectMb
 * @returns {Promise<object | null>}
 */
export async function introspect({ filePath, extension, sizeBytes, maxIntrospectMb }) {
  const sizeMb = sizeBytes / (1024 * 1024);
  if (sizeMb > maxIntrospectMb) return null;

  if (extension === "pdf") {
    return introspectPdf(filePath);
  }
  if (extension === "docx") {
    return introspectDocx(filePath);
  }
  if (extension === "xlsx") {
    return introspectXlsx(filePath);
  }
  if (LEGACY_OFFICE_EXTENSIONS.has(extension)) {
    return introspectLegacyOffice(extension);
  }

  // Future phases: pptx, odt, ods, odp, etc.
  return null;
}
```

- [ ] **Step 6.4: Run tests**

```bash
npx vitest run test/introspect-dispatch.test.js
```

Expected: 8 dispatcher tests pass (4 prior + 4 new).

```bash
npx vitest run
```

Expected: 91 tests passing (87 prior + 4 new).

- [ ] **Step 6.5: Lint**

```bash
npx eslint src/introspect/index.js test/introspect-dispatch.test.js
```

Expected: clean.

- [ ] **Step 6.6: Commit**

```bash
git add src/introspect/index.js test/introspect-dispatch.test.js
git commit -m "feat(introspect): dispatcher routes docx, xlsx, doc/ppt/xls"
```

---

## Task 7 — Office E2E CLI integration tests

**Files:**
- Modify: `test/scan.test.js` (append two new tests inside the existing `describe("filecap CLI end-to-end", ...)` block)

- [ ] **Step 7.1: Append the tests**

Inside the existing `describe("filecap CLI end-to-end", ...)` block in `test/scan.test.js`, before its closing `});`, append:

```js
  it("introspects DOCX via the CLI", async () => {
    const { Document, Packer, Paragraph, HeadingLevel } = await import("docx");
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: "Title", heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ text: "Body content." }),
          ],
        },
      ],
    });
    await fs.writeFile(path.join(tmpRoot, "e2e.docx"), await Packer.toBuffer(doc));

    const outPath = path.join(outDir, "docx-e2e.ndjson");
    const result = await runCli(
      ["scan", tmpRoot, "-o", outPath, "--no-hash"],
      outDir,
    );
    expect(result.code).toBe(0);
    const text = await fs.readFile(outPath, "utf8");
    const lines = text.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l));
    const docxEntry = lines.find((l) => l.filename === "e2e.docx");
    expect(docxEntry).toBeDefined();
    expect(docxEntry.introspection).toBeDefined();
    expect(docxEntry.introspection.kind).toBe("docx");
    expect(docxEntry.introspection.hasHeadings).toBe(true);
  });

  it("introspects XLSX via the CLI", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("DataSheet");
    ws.addRow(["Header1", "Header2"]);
    ws.getRow(1).font = { bold: true };
    ws.addRow([1, 2]);
    await wb.xlsx.writeFile(path.join(tmpRoot, "e2e.xlsx"));

    const outPath = path.join(outDir, "xlsx-e2e.ndjson");
    const result = await runCli(
      ["scan", tmpRoot, "-o", outPath, "--no-hash"],
      outDir,
    );
    expect(result.code).toBe(0);
    const text = await fs.readFile(outPath, "utf8");
    const lines = text.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l));
    const xlsxEntry = lines.find((l) => l.filename === "e2e.xlsx");
    expect(xlsxEntry).toBeDefined();
    expect(xlsxEntry.introspection).toBeDefined();
    expect(xlsxEntry.introspection.kind).toBe("xlsx");
    expect(xlsxEntry.introspection.sheetCount).toBe(1);
    expect(xlsxEntry.introspection.hasHeaderRows).toBe(true);
  });
```

- [ ] **Step 7.2: Run tests**

```bash
npx vitest run test/scan.test.js
```

Expected: 18 scan tests pass (16 prior + 2 new).

```bash
npx vitest run
```

Expected: 93 tests passing (91 prior + 2 new).

- [ ] **Step 7.3: Lint**

```bash
npx eslint test/scan.test.js
```

Expected: clean.

- [ ] **Step 7.4: Commit**

```bash
git add test/scan.test.js
git commit -m "test(scan): add CLI E2E tests for DOCX and XLSX introspection"
```

---

## Task 8 — Update `src/index.js` exports

**Files:**
- Modify: `src/index.js`

- [ ] **Step 8.1: Replace `src/index.js` content**

Read current content first. Then replace entirely with:

```js
export { runScan } from "./commands/scan.js";
export {
  headerSchema,
  entrySchema,
  footerSchema,
  pdfIntrospectionSchema,
  docxIntrospectionSchema,
  xlsxIntrospectionSchema,
  legacyOfficeIntrospectionSchema,
  isCompleteInventory,
  SCHEMA_VERSION,
} from "./schema/inventory.js";
export { introspect } from "./introspect/index.js";
export { introspectPdf } from "./introspect/pdf.js";
export { introspectDocx } from "./introspect/docx.js";
export { introspectXlsx } from "./introspect/xlsx.js";
export { introspectLegacyOffice } from "./introspect/office-legacy.js";
export { FILECAP_VERSION } from "./version.js";
```

- [ ] **Step 8.2: Verify exports**

```bash
node -e "import('./src/index.js').then(m => console.log('exports:', Object.keys(m).sort()))"
```

Expected output (15 named exports):

```
exports: [
  'FILECAP_VERSION',
  'SCHEMA_VERSION',
  'docxIntrospectionSchema',
  'entrySchema',
  'footerSchema',
  'headerSchema',
  'introspect',
  'introspectDocx',
  'introspectLegacyOffice',
  'introspectPdf',
  'introspectXlsx',
  'isCompleteInventory',
  'legacyOfficeIntrospectionSchema',
  'pdfIntrospectionSchema',
  'runScan',
  'xlsxIntrospectionSchema'
]
```

(That's 16 — recount: FILECAP_VERSION, SCHEMA_VERSION, docx-schema, entry, footer, header, introspect, introspect-docx, introspect-legacy, introspect-pdf, introspect-xlsx, isCompleteInventory, legacy-schema, pdf-schema, runScan, xlsx-schema. 16 exports total.)

- [ ] **Step 8.3: Run tests**

```bash
npm test
```

Expected: 93 tests passing.

- [ ] **Step 8.4: Lint**

```bash
npx eslint src/index.js
```

Expected: clean.

- [ ] **Step 8.5: Commit**

```bash
git add src/index.js
git commit -m "feat: re-export docx/xlsx/office-legacy schemas + introspectors from package main"
```

---

## Task 9 — Expanded README

**Files:**
- Modify: `README.md`

- [ ] **Step 9.1: Replace README.md**

Read the current README first. Replace it entirely with the following (adapted from Phase 2's README with Phase 3 additions):

````markdown
# @icjia/filecap

**File inventory CLI for accessibility audit scoping.**

`filecap` walks a directory tree, introspects each file (PDFs, DOCX, XLSX), and produces a structured NDJSON inventory suitable for accessibility remediation scoping. The primary use case is generating per-server inventories of file stores (Strapi `/uploads` directories, general file servers) to hand to remediation vendors so they can produce a defensible, fixed-price quote on ADA Title II / WCAG 2.1 AA remediation work.

## Status

**Phase 3 shipped (v0.3.0).** Office introspection is functional. Each Office entry now carries format-specific accessibility signals: DOCX (headings, image alt-text coverage, table headers, hyperlink anti-patterns, language); XLSX (sheet count, default-name detection, header rows, merged cells, charts, images); legacy `.doc/.ppt/.xls` flagged by extension. PDFs continue to carry the full Phase 2 introspection block.

The full design specification lives at [`docs/filecap-design.md`](docs/filecap-design.md).

| Phase | Version | Status | Deliverable |
|---|---|---|---|
| 1 | v0.1.0 | shipped | Core scan — recursive walk, hashing, NDJSON output |
| 2 | v0.2.0 | shipped | PDF introspection (image-only, tags, producer, signatures, language) |
| 3 | v0.3.0 | **shipped** | Office introspection (DOCX, XLSX, legacy flag) |
| 4 | v0.4.0 | next | Filename flagging |
| 5 | v0.5.0 | planned | Multi-server rollup |
| 6 | v0.6.0 | planned | CSV reporter and summary artifacts |
| 7 | v1.0.0 | planned | MCP server entry point |
| 8 | vNext | deferred | Strapi-aware mode (separate package) |

## Quick start

```bash
npx --yes @icjia/filecap scan /var/strapi/uploads
# → writes filecap-<hostname>.ndjson in cwd
```

The output is line-delimited JSON: one header line, one line per file, one footer line.

## CLI reference

### `filecap scan <directory>`

| Flag | Default | Description |
|---|---|---|
| `-o, --output <path>` | `filecap-<hostname>.ndjson` | Output path (use `-` for stdout) |
| `-s, --server-name <name>` | `os.hostname()` | Override server identifier in metadata |
| `--server-ip <ip>` | auto-detected | Override server IP (defaults to first non-loopback IPv4) |
| `--no-hash` | (off) | Skip SHA-256 hashing (much faster, but no dedup) |
| `--no-introspect` | (off) | Skip PDF/Office introspection (filesystem stats only) |
| `--max-introspect-mb <n>` | `200` | Skip introspection for files larger than this |
| `--include-ext <list>` | (all) | Comma-separated extensions to include |
| `--exclude-ext <list>` | (none) | Comma-separated extensions to exclude |
| `--concurrency <n>` | `4` | Parallel introspection/hashing workers |
| `--progress` | (off) | Emit progress to stderr |

**Exit codes.** `0` success, `1` argument or runtime error, `2` directory not readable, `3` partial completion.

### `filecap rollup` and `filecap report`

Stubs printing "not implemented in v0.3.0". Phase 5 and Phase 6 respectively.

## Multi-server workflow

When scanning multiple servers from a single coordinator with SSH access:

```bash
ssh deploy@strapi-prod-01 "npx --yes @icjia/filecap scan /var/strapi/uploads -o -" \
  > ./inventories/strapi-prod-01.ndjson
```

The `-o -` flag writes NDJSON to stdout, which SSH transports back. Compute (walk, hash, introspection) happens on the remote; only the inventory output crosses the network.

A sample bash orchestrator is in [`examples/multi-scan.sh`](examples/multi-scan.sh).

## NDJSON output format

Line-delimited JSON. First line: header (scan metadata). Last line: footer (summary stats). Lines in between: one per file.

**Example header:**

```json
{
  "schemaVersion": 1,
  "kind": "filecap-inventory-header",
  "metadata": {
    "serverName": "strapi-prod-01",
    "scannedPath": "/var/strapi/uploads",
    "scannedAt": "2026-05-08T14:23:11.000Z",
    "filecapVersion": "0.3.0",
    "options": { "introspect": true, "hash": true, "maxIntrospectMb": 200, "concurrency": 4 }
  }
}
```

**Example file entry (DOCX):**

```json
{
  "path": "2024/policies/handbook.docx",
  "filename": "handbook.docx",
  "extension": "docx",
  "category": "office-document",
  "remediable": true,
  "sizeBytes": 152340,
  "introspection": {
    "kind": "docx",
    "hasHeadings": true,
    "imageCount": 5,
    "altTextCoverage": 0.8,
    "tableCount": 3,
    "tablesHaveHeaders": true,
    "hyperlinkCount": 12,
    "vagueLinkCount": 2,
    "documentLanguage": "en-US"
  }
}
```

**Example file entry (XLSX):**

```json
{
  "path": "2024/data/budget.xlsx",
  "filename": "budget.xlsx",
  "extension": "xlsx",
  "category": "spreadsheet",
  "remediable": true,
  "sizeBytes": 48720,
  "introspection": {
    "kind": "xlsx",
    "sheetCount": 4,
    "sheetNames": ["Summary", "Q1", "Q2", "Sheet4"],
    "defaultSheetNameCount": 1,
    "hasHeaderRows": true,
    "mergedCellCount": 3,
    "hasCharts": true,
    "hasImages": false
  }
}
```

**Example file entry (legacy `.doc`):**

```json
{
  "path": "archive/2010-memo.doc",
  "filename": "2010-memo.doc",
  "extension": "doc",
  "category": "office-document",
  "remediable": true,
  "introspection": {
    "kind": "office-legacy",
    "format": "doc"
  }
}
```

The presence of `kind: "office-legacy"` is itself the signal: this file needs manual review with Office or an upgrade to a modern format before remediation.

## What gets introspected (Phase 3)

### PDF (Phase 2)

| Field | What it tells you |
|---|---|
| `pageCount`, `hasTextLayer`, `textLayerCoverage`, `isImageOnly` | Text vs. scanned content |
| `hasTags` | PDF structure tags (most important PDF a11y feature) |
| `hasFormFields`, `hasSignatures` | Specialized remediation requirements |
| `producer`, `creator` | Strong triage signal (born-digital vs. OCR'd from paper) |
| `documentLanguage`, `creationDate`, `pdfVersion` | Document metadata |
| `encrypted`, `isLinearized`, `hasOutline` | Structural state |

### DOCX (new in Phase 3)

| Field | What it tells you |
|---|---|
| `hasHeadings` | Document uses Word heading styles (essential for screen-reader navigation) |
| `imageCount`, `altTextCoverage` | Number of images and what fraction have alt text |
| `tableCount`, `tablesHaveHeaders` | Table count and whether any table has marked header rows |
| `hyperlinkCount`, `vagueLinkCount` | Total links and how many use ambiguous text ("click here", "read more") |
| `documentLanguage` | Declared language (WCAG 3.1.1) |

### XLSX (new in Phase 3)

| Field | What it tells you |
|---|---|
| `sheetCount`, `sheetNames` | Total sheets and their names |
| `defaultSheetNameCount` | Sheets named `Sheet1`/`Sheet2`/etc. (lazy naming → screen reader hostility) |
| `hasHeaderRows` | At least one sheet has a styled (bold) first row |
| `mergedCellCount` | Total merged cells across all sheets (accessibility anti-pattern) |
| `hasCharts`, `hasImages` | Embedded objects |

### Legacy `.doc/.ppt/.xls`

Flagged by extension only — `kind: "office-legacy"` with the specific format. These binary formats need Office or specialized tools to inspect.

When introspection fails (corrupt file, unsupported variant, parse exception), the `introspection` field is omitted from the entry. The file row still appears with full filesystem stats.

Files larger than `--max-introspect-mb` (default 200) skip introspection regardless of type.

## What filecap does not do

- Perform full WCAG conformance auditing (that's [audit.icjia.app](https://audit.icjia.app)'s job, per-file)
- Remediate, fix, or modify any files
- Track vendor remediation status (out of scope — NDJSON inventories are themselves the time-series record)
- Integrate with the Strapi API (deferred to Phase 8)
- Introspect PPTX (deferred to a future phase; Phase 3 only covers DOCX, XLSX, and legacy stubs)

## Troubleshooting

**Scan exits with code 3.** At least one directory was unreadable. The footer's `permissionDenials` count tells you how many.

**`introspection` field missing from a PDF / DOCX / XLSX entry.** filecap couldn't parse this file. Likely causes: malformed file, encrypted, exotic variant. The file still appears in the inventory; vendor's deeper tooling (Acrobat Pro, Office, qpdf) will surface the actual issue.

**Scans are slow on large directories.** Hashing dominates wall time. For triage scans, pass `--no-hash`. For Office-heavy stores, increase `--concurrency`. Skip introspection with `--no-introspect` for filesystem-only inventories.

## License

[MIT](LICENSE) © Illinois Criminal Justice Information Authority

## Related @icjia tools

- `@icjia/viewcap` — screenshot capture (MCP)
- `@icjia/lightcap` — Lighthouse audits (MCP)
- `@icjia/axecap` — axe-core accessibility audits (MCP)
- `@icjia/contrastcap` — color contrast auditing (MCP)
- `audit.icjia.app` — full WCAG conformance auditing (per-file)
````

(Use 3-backtick fences in the actual file. The 4-backtick wrapper above is just for delimiting in this prompt.)

- [ ] **Step 9.2: Run tests + verify**

```bash
npm test
head -20 README.md
wc -l README.md
```

Expected: 93 tests passing; README starts with the title; about 200-230 lines.

- [ ] **Step 9.3: Commit**

```bash
git add README.md
git commit -m "docs: expand README with Phase 3 DOCX/XLSX introspection"
```

---

## Task 10 — CHANGELOG [0.3.0] entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 10.1: Add the entry**

Read current CHANGELOG.md. Insert a new section ABOVE the existing `## [0.2.0]` section:

```markdown
## [0.3.0] — 2026-05-08

### Added

- **DOCX introspection** via `jszip` + `fast-xml-parser`. Each DOCX entry now carries: `hasHeadings`, `imageCount`, `altTextCoverage`, `tableCount`, `tablesHaveHeaders`, `hyperlinkCount`, `vagueLinkCount` (count of "click here" / "read more" anti-patterns), and `documentLanguage`.
- **XLSX introspection** via `exceljs`. Each XLSX entry now carries: `sheetCount`, `sheetNames`, `defaultSheetNameCount` (count of `Sheet1`/`Sheet2`/etc.), `hasHeaderRows`, `mergedCellCount`, `hasCharts`, `hasImages`.
- **Legacy Office presence flag.** `.doc`, `.ppt`, and `.xls` files now carry an `introspection` block with `kind: "office-legacy"` and the specific format. No deep parsing; the marker indicates the file needs manual review.
- **Discriminated-union schema.** `entrySchema.introspection` is now `z.discriminatedUnion("kind", [...])` over `pdf`, `docx`, `xlsx`, `office-legacy`. Each variant has its own typed shape.
- New schema exports: `docxIntrospectionSchema`, `xlsxIntrospectionSchema`, `legacyOfficeIntrospectionSchema`.
- New programmatic exports from package main: `introspectDocx`, `introspectXlsx`, `introspectLegacyOffice`.

### Known limitations

- PPTX is not introspected in Phase 3 — entries with `extension: "pptx"` get no introspection block. Deferred to a future phase.
- DOCX language detection reads `word/styles.xml` first; some documents place language declarations elsewhere (e.g., `word/document.xml` `sectPr`). Coverage is best-effort; rare DOCX variants may report no language even when one is declared.
- XLSX chart detection uses `worksheet.model.charts`, which is populated inconsistently across `exceljs` versions. False negatives are possible for files with charts.

[0.3.0]: https://github.com/ICJIA/icjia-fleet-audit/releases/tag/v0.3.0
```

(Inserted ABOVE `## [0.2.0]`.)

- [ ] **Step 10.2: Run tests**

```bash
npm test
```

Expected: 93 tests still passing.

- [ ] **Step 10.3: Verify CHANGELOG structure**

```bash
grep -E "^## \[" CHANGELOG.md
```

Expected:

```
## [0.3.0] — 2026-05-08
## [0.2.0] — 2026-05-08
## [0.1.0] — 2026-05-08
```

- [ ] **Step 10.4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add [0.3.0] CHANGELOG entry"
```

---

## Task 11 — Bump version to 0.3.0

**Files:**
- Modify: `package.json`, `package-lock.json`

This task implements the lockstep convention: bump version BEFORE publishing. The publish script (Task 12) will then ship at the current version without re-bumping.

- [ ] **Step 11.1: Edit `package.json`**

Change `"version": "0.2.0"` to `"version": "0.3.0"`.

- [ ] **Step 11.2: Sync `package-lock.json`**

```bash
cd /Volumes/satechi/webdev/icjia-fleet-audit
npm install --package-lock-only
```

Expected: `package-lock.json`'s top-level version field updates to `0.3.0`.

- [ ] **Step 11.3: Verify CLI and module both report 0.3.0**

```bash
./bin/filecap.js --version
node -e "import('./src/index.js').then(m => console.log('FILECAP_VERSION:', m.FILECAP_VERSION))"
```

Expected: both print `0.3.0`.

- [ ] **Step 11.4: Run tests**

```bash
npm test
```

Expected: 93 passing.

- [ ] **Step 11.5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: bump version to 0.3.0"
```

---

## Task 12 — Publish v0.3.0

**Files:** None modified — this task drives the release script.

This is the user-driven task. The implementer reports the prep is done; the user runs publish.

- [ ] **Step 12.1: Pre-publish checklist**

```bash
cd /Volumes/satechi/webdev/icjia-fleet-audit
npm test
node -p "require('./package.json').version"
git status
git log --oneline | head -15
```

Confirm: 93 tests passing, version `0.3.0` in package.json, working tree clean.

- [ ] **Step 12.2: Push to origin if needed**

```bash
git push origin main
```

This brings origin up to date with all Phase 3 commits before publish.

- [ ] **Step 12.3: Run `./publish first`**

```bash
./publish first
```

The `first` mode publishes the current `package.json` version without re-bumping (per the lockstep convention). It will:
- Verify branch / clean tree / sync / npm auth
- Run `npm test` (93 passing)
- Tag `v0.3.0` at HEAD
- `git push origin main` and `git push origin v0.3.0`
- `npm publish --access public`

You may need to authenticate via the device flow (browser).

- [ ] **Step 12.4: Verify the published version**

```bash
sleep 30   # let npm CDN settle
npx --yes @icjia/filecap@0.3.0 --version
```

Expected: prints `0.3.0`.

```bash
mkdir /tmp/v030-smoke && cd /tmp/v030-smoke
node -e "
import('docx').then(async ({Document, Packer, Paragraph, HeadingLevel}) => {
  const doc = new Document({ sections: [{ children: [
    new Paragraph({ text: 'Test Title', heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ text: 'body' })
  ]}]});
  const fs = await import('node:fs/promises');
  await fs.writeFile('sample.docx', await Packer.toBuffer(doc));
});
"
npx --yes @icjia/filecap@0.3.0 scan . -o smoke.ndjson --no-hash
cat smoke.ndjson | sed -n '2p' | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).introspection)"
cd /Volumes/satechi/webdev/icjia-fleet-audit
rm -rf /tmp/v030-smoke
```

Expected: prints an introspection object with `kind: 'docx'`, `hasHeadings: true`.

---

## End of Phase 3

After completing Task 12, the repository contains:

- `@icjia/filecap@0.3.0` published on npm and tagged `v0.3.0` on GitHub
- 93 tests passing covering all Phase 1, 2, and 3 surfaces
- README, CHANGELOG, package.json all aligned at v0.3.0 (lockstep convention preserved)
- DOCX, XLSX, and legacy Office formats introspected via the dispatcher

**Next phase:** Phase 4 — Filename flagging (scanned-original patterns, anti-patterns). Will populate the existing `flags[]` array on every entry. Gets its own implementation plan when ready.
