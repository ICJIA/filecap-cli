import fs from "node:fs/promises";

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
  // pdfjs-dist v4 ships a legacy build for non-browser environments. The
  // default build references DOM globals via worker URLs that don't resolve
  // in Node. Importing inside the function keeps load failures catchable at
  // the call site rather than at module-load time.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
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
    let approxWordCount = 0;
    for (let i = 1; i <= pageCount; i++) {
      try {
        const page = await doc.getPage(i);
        const textContent = await page.getTextContent();
        if (textContent.items.length > 0) pagesWithText++;
        const pageText = textContent.items.map((item) => item.str ?? "").join(" ");
        const words = pageText.trim().split(/\s+/).filter((w) => w.length > 0);
        approxWordCount += words.length;
        page.cleanup();
      } catch {
        // Count 0 for this page on failure; don't throw.
      }
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

    let encryptedDetected = false;
    let isLinearizedDetected;
    let producer;
    let creator;
    let creationDateRaw;
    let pdfVersion;
    let documentLanguage;
    let title;
    let author;
    let subject;
    let keywords;
    let modificationDateRaw;
    try {
      const metadata = await doc.getMetadata();
      const info = metadata.info ?? {};
      // pdfjs-dist v4 surfaces these via metadata.info, not via doc._pdfInfo.
      // EncryptFilterName is null on unencrypted PDFs and a non-empty string
      // (e.g., "Standard", "AES-256") when encrypted.
      encryptedDetected = !!info.EncryptFilterName;
      isLinearizedDetected =
        typeof info.IsLinearized === "boolean" ? info.IsLinearized : undefined;
      producer = info.Producer || undefined;
      creator = info.Creator || undefined;
      creationDateRaw = info.CreationDate || undefined;
      pdfVersion = info.PDFFormatVersion || undefined;
      documentLanguage = info.Language || undefined;
      title = sanitizePdfString(info.Title);
      author = sanitizePdfString(info.Author);
      subject = sanitizePdfString(info.Subject);
      keywords = sanitizePdfString(info.Keywords);
      modificationDateRaw = info.ModDate || undefined;
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
      encrypted: encryptedDetected,
    };
    if (pageCount > 0) result.textLayerCoverage = textLayerCoverage;
    if (typeof hasOutline === "boolean") result.hasOutline = hasOutline;
    if (typeof isLinearizedDetected === "boolean") result.isLinearized = isLinearizedDetected;
    if (pdfVersion) result.pdfVersion = pdfVersion;
    if (documentLanguage) result.documentLanguage = documentLanguage;
    if (producer) result.producer = producer;
    if (creator) result.creator = creator;
    if (creationDateRaw) {
      const parsed = parsePdfDate(creationDateRaw);
      if (parsed) result.creationDate = parsed;
    }
    result.title = title ?? null;
    result.author = author ?? null;
    result.subject = subject ?? null;
    result.keywords = keywords ?? null;
    if (modificationDateRaw) {
      result.modificationDate = modificationDateRaw.startsWith("D:")
        ? modificationDateRaw.slice(2)
        : modificationDateRaw;
    } else {
      result.modificationDate = null;
    }
    result.approxWordCount = approxWordCount;

    return result;
  } finally {
    await doc.destroy();
  }
}

/**
 * Trim a PDF info string and return null for empty/missing values.
 * Strips ASCII control characters that would corrupt CSV/HTML output.
 */
function sanitizePdfString(v) {
  if (v === null || v === undefined) return null;
  const s = String(v)
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim();
  return s.length > 0 ? s : null;
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
