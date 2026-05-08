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
    if (/^Heading[1-9]/i.test(styleVal)) {
      hasHeadings = true;
      break;
    }
  }

  // Image count: w:drawing elements
  const drawings = collectByTag(docTree, "w:drawing");
  const imageCount = drawings.length;

  // Alt text coverage: count drawings that contain a docPr with a non-empty
  // descr attribute. Schema rule: undefined when imageCount is 0.
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
  let tablesHaveHeaders;
  if (tableCount > 0) {
    let withHeaders = 0;
    for (const tbl of tables) {
      const headerHints = collectByTag(tbl, "w:tblHeader");
      if (headerHints.length > 0) withHeaders++;
    }
    tablesHaveHeaders = withHeaders > 0;
  }

  // Hyperlinks
  const hyperlinks = collectByTag(docTree, "w:hyperlink");
  const hyperlinkCount = hyperlinks.length;
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

  // Document language: read from word/styles.xml first, then word/document.xml
  let documentLanguage;
  const stylesXml = zip.file("word/styles.xml");
  if (stylesXml) {
    try {
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
    } catch {
      // Best-effort: corrupt styles.xml falls through to the document.xml fallback below.
    }
  }
  if (!documentLanguage) {
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
