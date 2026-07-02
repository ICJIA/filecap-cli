// Classify a GraphQL field descriptor from Strapi v3 __type introspection into
// one of the buckets the references extractor uses:
//
//   - url-string         : scalar String, name ends in URL/Url/Link
//                          → read value directly as a candidate URL
//   - body-string        : scalar String, name is body/summary/description/
//                          content/searchMeta → run extractFileUrls() over value
//   - upload-file        : single UploadFile OBJECT → collect .url
//   - upload-file-list   : LIST of UploadFile → iterate, collect each .url
//   - component          : single embedded component (v3 "Group*", modern
//                          "Component*", dynamic-zone UNION) → recursively
//                          walk the VALUE for nested upload files + body text
//   - component-list     : LIST of the above → walk each item
//   - relation           : LIST or single OBJECT of another content type
//                          → skip (that type is enumerated independently)
//   - other              : scalars we don't extract from (Date, Boolean, ID,
//                          enums, non-URL/non-body Strings like slug, title)
//
// The classifier strips NON_NULL wrappers before inspecting the inner type.
//
// v1.29.0 — component awareness. Strapi components embed their data INSIDE
// the parent entry (they're not separately-enumerated content types), so the
// old "any unknown OBJECT is a relation → skip" rule silently dropped every
// file they carry. SPAC alone lost ~450 page→file links this way (each
// publication's PDF lives in mediaMaterial.file, each meeting's agenda/
// materials/minutes in meetingMaterial[].file[]). Callers that pass the
// discovered content-type names get component classification; callers that
// don't (legacy shape) keep the old behavior.

// v1.39.0 (B5) — case-insensitive so bare `url`/`link` and lowercase-suffix
// names (articleUrl, permalink, pdfLink) classify as url-string. Odd matches
// like `uplink` are accepted: values are filtered by domain + audited file
// extension downstream, so a non-file value never reaches referencedFiles.
const URL_SUFFIX_RE = /(?:url|link)$/i;
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

// v4 relation envelopes: XxxEntityResponse / XxxRelationResponseCollection.
const V4_RELATION_ENVELOPE_RE = /(?:EntityResponse|RelationResponseCollection)$/;

// System/admin object types that are neither content types nor components.
// Walking them would risk attributing an admin avatar or similar to the page.
const SYSTEM_OBJECT_RE = /^(?:Admin|UsersPermissions|I18N)/;

function unwrapNonNull(type) {
  if (type && type.kind === "NON_NULL") return type.ofType ?? null;
  return type;
}

// Decide relation vs component vs other for a non-upload OBJECT/INTERFACE/
// UNION type, given the (optional) set of discovered content-type names.
function classifyObjectLike(typeName, kind, contentTypeNames) {
  if (typeof typeName === "string" && SYSTEM_OBJECT_RE.test(typeName)) {
    return "other";
  }
  // Legacy call shape (no content-type names provided): preserve the old
  // behavior — every non-upload object is a relation.
  if (!(contentTypeNames instanceof Set)) return "relation";
  if (kind === "UNION") return "component"; // dynamic zone
  if (typeof typeName === "string") {
    if (contentTypeNames.has(typeName)) return "relation";
    if (V4_RELATION_ENVELOPE_RE.test(typeName)) return "relation";
  }
  return "component";
}

export function classifyField(field, options = {}) {
  const contentTypeNames = options.contentTypeNames;
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
    if (
      listInner.kind === "OBJECT" ||
      listInner.kind === "INTERFACE" ||
      listInner.kind === "UNION"
    ) {
      const kind = classifyObjectLike(listInner.name, listInner.kind, contentTypeNames);
      return { kind: kind === "component" ? "component-list" : kind, fieldName };
    }
    return { kind: "other", fieldName };
  }

  if (inner.kind === "OBJECT" || inner.kind === "INTERFACE" || inner.kind === "UNION") {
    if (UPLOAD_FILE_SINGLE_TYPES.has(inner.name)) {
      return { kind: "upload-file", fieldName };
    }
    if (UPLOAD_FILE_LIST_TYPES.has(inner.name)) {
      return { kind: "upload-file-list", fieldName };
    }
    return {
      kind: classifyObjectLike(inner.name, inner.kind, contentTypeNames),
      fieldName,
    };
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
