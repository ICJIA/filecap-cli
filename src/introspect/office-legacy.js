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
