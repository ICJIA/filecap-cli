import fs from "node:fs/promises";

// pdfjs-dist v4 ships a legacy build for non-browser environments. The default
// build references DOM globals via worker URLs that don't resolve in Node.
const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
const { getDocument } = pdfjsLib;

/**
 * Introspect a PDF file and return its accessibility-relevant metadata.
 *
 * Throws if pdfjs-dist cannot parse the file (corrupt, encrypted-without-password,
 * truncated, etc.). The caller (the introspection dispatcher) catches and converts
 * to "omit introspection key" per the empty-on-failure rule.
 *
 * @param {string} filePath
 * @returns {Promise<object>} the `introspection` block per pdfIntrospectionSchema
 */
export async function introspectPdf(filePath) {
  const data = await fs.readFile(filePath);
  const uint8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const loadingTask = getDocument({
    data: uint8,
    disableFontFace: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
  });

  const doc = await loadingTask.promise;
  try {
    const pageCount = doc.numPages;

    let pagesWithText = 0;
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      if (textContent.items.length > 0) pagesWithText++;
      page.cleanup();
    }
    const hasTextLayer = pagesWithText > 0;
    const textLayerCoverage = pageCount > 0 ? pagesWithText / pageCount : 0;
    const isImageOnly = pageCount > 0 && pagesWithText === 0;

    let hasTags = false;
    try {
      const markInfo = await doc.getMarkInfo();
      hasTags = !!(markInfo && markInfo.Marked);
    } catch {
      hasTags = false;
    }

    let hasFormFields = false;
    let hasSignatures = false;
    try {
      const fieldObjects = await doc.getFieldObjects();
      if (fieldObjects && Object.keys(fieldObjects).length > 0) {
        hasFormFields = true;
        for (const fieldArr of Object.values(fieldObjects)) {
          for (const f of fieldArr) {
            if (f.type === "signature") {
              hasSignatures = true;
              break;
            }
          }
          if (hasSignatures) break;
        }
      }
    } catch {
      // fieldObjects access failed; leave both false.
    }

    let hasOutline = false;
    try {
      const outline = await doc.getOutline();
      hasOutline = !!(outline && outline.length > 0);
    } catch {
      hasOutline = false;
    }

    const encrypted = !!(doc._pdfInfo && doc._pdfInfo.encrypted);
    const isLinearized =
      doc._pdfInfo && typeof doc._pdfInfo.IsLinearized === "boolean"
        ? doc._pdfInfo.IsLinearized
        : undefined;

    let producer;
    let creator;
    let creationDateRaw;
    let pdfVersion;
    let documentLanguage;
    try {
      const metadata = await doc.getMetadata();
      const info = metadata.info ?? {};
      producer = info.Producer || undefined;
      creator = info.Creator || undefined;
      creationDateRaw = info.CreationDate || undefined;
      pdfVersion = info.PDFFormatVersion || undefined;
      documentLanguage = info.Language || undefined;
    } catch {
      // Metadata read failed — leave the optional fields undefined.
    }

    const result = {
      kind: "pdf",
      pageCount,
      hasTextLayer,
      isImageOnly,
      hasTags,
      hasFormFields,
      hasSignatures,
      encrypted,
    };
    if (pageCount > 0) result.textLayerCoverage = textLayerCoverage;
    if (typeof hasOutline === "boolean") result.hasOutline = hasOutline;
    if (typeof isLinearized === "boolean") result.isLinearized = isLinearized;
    if (pdfVersion) result.pdfVersion = pdfVersion;
    if (documentLanguage) result.documentLanguage = documentLanguage;
    if (producer) result.producer = producer;
    if (creator) result.creator = creator;
    if (creationDateRaw) {
      const parsed = parsePdfDate(creationDateRaw);
      if (parsed) result.creationDate = parsed;
    }

    return result;
  } finally {
    await doc.destroy();
  }
}

/**
 * Convert PDF "D:YYYYMMDDHHmmSSOHH'mm" format to ISO 8601 UTC.
 * Returns undefined if the input doesn't parse.
 */
function parsePdfDate(s) {
  if (typeof s !== "string") return undefined;
  const raw = s.startsWith("D:") ? s.slice(2) : s;
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return undefined;
  const [, y, mo, d, h = "00", mi = "00", se = "00"] = m;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}.000Z`);
  if (isNaN(date.getTime())) return undefined;
  return date.toISOString();
}
