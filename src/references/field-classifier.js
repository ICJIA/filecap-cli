// Classify a GraphQL field descriptor from Strapi v3 __type introspection into
// one of the buckets the references extractor uses:
//
//   - url-string         : scalar String, name ends in URL/Url/Link
//                          → read value directly as a candidate URL
//   - body-string        : scalar String, name is body/summary/description/
//                          content/searchMeta → run extractFileUrls() over value
//   - upload-file        : single UploadFile OBJECT → collect .url
//   - upload-file-list   : LIST of UploadFile → iterate, collect each .url
//   - relation           : LIST or single OBJECT of another content type
//                          → skip (that type is enumerated independently)
//   - other              : scalars we don't extract from (Date, Boolean, ID,
//                          enums, non-URL/non-body Strings like slug, title)
//
// The classifier strips NON_NULL wrappers before inspecting the inner type.

const URL_SUFFIX_RE = /(?:URL|Url|Link)$/;
const BODY_FIELD_NAMES = new Set([
  "body",
  "summary",
  "description",
  "content",
  "searchMeta",
]);

// Strapi v4 wraps single-media references in `UploadFileEntityResponse` and
// list-media references in `UploadFileRelationResponseCollection`. Both are
// OBJECT kind at this level; the actual array-ness lives inside `.data`. We
// classify them by name as the same logical kinds the v3 extractor uses; the
// v4 extractor peels the envelope at extraction time.
const UPLOAD_FILE_SINGLE_TYPES = new Set([
  "UploadFile", // v3
  "UploadFileEntityResponse", // v4 single
]);
const UPLOAD_FILE_LIST_TYPES = new Set([
  "UploadFileRelationResponseCollection", // v4 list
]);

function unwrapNonNull(type) {
  if (type && type.kind === "NON_NULL") return type.ofType ?? null;
  return type;
}

export function classifyField(field) {
  const fieldName = field?.name;
  if (typeof fieldName !== "string") return { kind: "other", fieldName: null };
  const rawType = field?.type;
  if (!rawType) return { kind: "other", fieldName };

  const inner = unwrapNonNull(rawType);
  if (!inner) return { kind: "other", fieldName };

  if (inner.kind === "LIST") {
    const listInner = unwrapNonNull(inner.ofType);
    if (!listInner) return { kind: "other", fieldName };
    if (UPLOAD_FILE_SINGLE_TYPES.has(listInner.name)) {
      return { kind: "upload-file-list", fieldName };
    }
    if (listInner.kind === "OBJECT" || listInner.kind === "INTERFACE") {
      return { kind: "relation", fieldName };
    }
    return { kind: "other", fieldName };
  }

  if (inner.kind === "OBJECT" || inner.kind === "INTERFACE") {
    if (UPLOAD_FILE_SINGLE_TYPES.has(inner.name)) {
      return { kind: "upload-file", fieldName };
    }
    if (UPLOAD_FILE_LIST_TYPES.has(inner.name)) {
      return { kind: "upload-file-list", fieldName };
    }
    return { kind: "relation", fieldName };
  }

  if (inner.kind === "SCALAR" && inner.name === "String") {
    if (URL_SUFFIX_RE.test(fieldName)) {
      return { kind: "url-string", fieldName };
    }
    if (BODY_FIELD_NAMES.has(fieldName)) {
      return { kind: "body-string", fieldName };
    }
    return { kind: "other", fieldName };
  }

  return { kind: "other", fieldName };
}
