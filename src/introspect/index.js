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
