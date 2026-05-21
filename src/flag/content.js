/**
 * Content-signature flags. Detect files whose extension implies a format whose
 * magic bytes the content doesn't match — e.g. an HTML document saved with a
 * `.pdf` extension. Surfaces mislabeled files directly in the inventory's
 * `flags[]`, rather than letting the audit step be the first to notice (a
 * "PDF" that's actually HTML fails audit.icjia.app's `%PDF-` check with a 422).
 *
 * Flag value produced:
 *   - "content-type-mismatch": the extension has a known magic-byte signature
 *     and the file's leading bytes do not match it.
 *
 * Only formats with reliable, fixed leading signatures are checked. Extensions
 * with no entry here are never flagged. Legacy Office (.doc/.xls/.ppt) is
 * deliberately omitted — RTF-as-.doc and other valid variants would false-positive.
 */

// Magic-byte signatures by lowercase extension. Each value is a list of
// acceptable leading-byte sequences (a format may permit more than one).
const SIGNATURES = {
  pdf: [[0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
  // OOXML formats are ZIP containers — every real .docx/.xlsx/.pptx starts PK.
  docx: [[0x50, 0x4b]],
  xlsx: [[0x50, 0x4b]],
  pptx: [[0x50, 0x4b]],
  png: [[0x89, 0x50, 0x4e, 0x47]],
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  gif: [[0x47, 0x49, 0x46, 0x38]], // GIF8
};

/** Extensions this module checks — a scanner can skip the header read for others. */
export const SIGNATURE_EXTENSIONS = new Set(Object.keys(SIGNATURES));

/** How many leading bytes a caller should read to cover the longest signature. */
export const HEADER_BYTES = 8;

/**
 * @param {string} extension - lowercase file extension, no leading dot
 * @param {Buffer|Uint8Array|null} header - the file's leading bytes, or null if
 *        the content could not be read
 * @returns {string[]} ["content-type-mismatch"] or []
 */
export function computeContentFlags(extension, header) {
  const sigs = SIGNATURES[String(extension || "").toLowerCase()];
  if (!sigs) return []; // extension has no known signature — never flag
  if (!header) return []; // content unreadable — don't guess
  const matched = sigs.some((sig) => sig.every((b, i) => header[i] === b));
  return matched ? [] : ["content-type-mismatch"];
}
