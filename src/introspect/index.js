import { introspectPdf } from "./pdf.js";

/**
 * Dispatch a file to its appropriate introspector based on extension.
 * Returns the introspection block on success, or null when:
 *   - the extension isn't introspectable (Phase 2: anything except pdf)
 *   - the file exceeds maxIntrospectMb (avoid pathological parse cost)
 *
 * Throws when introspection itself fails (corrupt PDF, etc.). The caller
 * (the scan orchestrator) catches and omits the introspection key from the
 * entry, per the empty-on-failure rule.
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

  // Phase 3 will add: docx, xlsx, doc, ppt, xls.
  return null;
}
