import { describe, it, expect } from "vitest";
import { classifyField } from "../src/references/field-classifier.js";

// Shorthand for building GraphQL __type field descriptors. The shape mirrors
// what Strapi v3 introspection returns, including NON_NULL wrappers.
const scalar = (name) => ({ name, kind: "SCALAR", ofType: null });
const obj = (name) => ({ name, kind: "OBJECT", ofType: null });
const enumType = (name) => ({ name, kind: "ENUM", ofType: null });
const nonNull = (inner) => ({ name: null, kind: "NON_NULL", ofType: inner });
const list = (inner) => ({ name: null, kind: "LIST", ofType: inner });

const field = (name, type) => ({ name, type });

describe("classifyField", () => {
  describe("URL string fields", () => {
    it("classifies fileURL as url-string", () => {
      expect(classifyField(field("fileURL", scalar("String")))).toEqual({
        kind: "url-string",
        fieldName: "fileURL",
      });
    });

    it("classifies articleURL, applicationURL, datasetURL as url-string", () => {
      expect(classifyField(field("articleURL", scalar("String"))).kind).toBe(
        "url-string",
      );
      expect(classifyField(field("applicationURL", scalar("String"))).kind).toBe(
        "url-string",
      );
      expect(classifyField(field("datasetURL", scalar("String"))).kind).toBe(
        "url-string",
      );
    });

    it("classifies fields ending in Url or Link", () => {
      expect(classifyField(field("downloadUrl", scalar("String"))).kind).toBe(
        "url-string",
      );
      expect(classifyField(field("externalLink", scalar("String"))).kind).toBe(
        "url-string",
      );
    });

    it("does NOT classify a non-string URL-named field as url-string", () => {
      // hypothetical: a relation field that happens to end in URL
      expect(
        classifyField(field("relatedURL", obj("RelatedThing"))).kind,
      ).not.toBe("url-string");
    });

    // v1.39.0 (B5) — the suffix match is case-insensitive and covers bare
    // "url"/"link" names. Fields literally named `url`, `link`, `permalink`
    // were silently classified "other" (their file links dropped → false
    // orphans). Values are still filtered by domain + audited extension
    // downstream, so loose matching here is safe.
    it("classifies bare url / link / URL field names as url-string", () => {
      expect(classifyField(field("url", scalar("String"))).kind).toBe("url-string");
      expect(classifyField(field("link", scalar("String"))).kind).toBe("url-string");
      expect(classifyField(field("URL", scalar("String"))).kind).toBe("url-string");
    });

    it("classifies lowercase-suffix names (articleUrl, permalink, pdfLink) as url-string", () => {
      expect(classifyField(field("articleUrl", scalar("String"))).kind).toBe("url-string");
      expect(classifyField(field("permalink", scalar("String"))).kind).toBe("url-string");
      expect(classifyField(field("pdfLink", scalar("String"))).kind).toBe("url-string");
    });

    it("does not match mid-word: blank / unlinked stay non-URL", () => {
      expect(classifyField(field("blank", scalar("String"))).kind).toBe("other");
      expect(classifyField(field("unlinked", scalar("String"))).kind).toBe("other");
    });

    it("uplink ends in 'link' and matches — accepted trade-off (filtered downstream)", () => {
      expect(classifyField(field("uplink", scalar("String"))).kind).toBe("url-string");
    });
  });

  describe("Body / markdown string fields", () => {
    it("classifies body as body-string", () => {
      expect(classifyField(field("body", scalar("String")))).toEqual({
        kind: "body-string",
        fieldName: "body",
      });
    });

    it("classifies summary, description, content, searchMeta as body-string", () => {
      expect(classifyField(field("summary", scalar("String"))).kind).toBe(
        "body-string",
      );
      expect(
        classifyField(field("description", scalar("String"))).kind,
      ).toBe("body-string");
      expect(classifyField(field("content", scalar("String"))).kind).toBe(
        "body-string",
      );
      expect(classifyField(field("searchMeta", scalar("String"))).kind).toBe(
        "body-string",
      );
    });

    it("body-style classification is case-sensitive on the field name (Strapi uses lowercase)", () => {
      // A field literally named "BODY" would not be classified as body-string —
      // Strapi fields are conventionally lowercase, so we don't risk false
      // positives by being loose with case.
      expect(classifyField(field("BODY", scalar("String"))).kind).toBe("other");
    });
  });

  describe("Upload file (typed media) fields", () => {
    it("classifies a single UploadFile field as upload-file", () => {
      expect(classifyField(field("splash", obj("UploadFile")))).toEqual({
        kind: "upload-file",
        fieldName: "splash",
      });
    });

    it("classifies a LIST of UploadFile as upload-file-list", () => {
      expect(
        classifyField(field("attachments", list(obj("UploadFile")))),
      ).toEqual({
        kind: "upload-file-list",
        fieldName: "attachments",
      });
    });

    // v1.39.0 (B10) — NON_NULL wrappers inside/around LIST are unwrapped:
    // [UploadFile!] and [UploadFile!]! are the Strapi v4 required-list forms.
    it("classifies LIST(NON_NULL(UploadFile)) as upload-file-list", () => {
      expect(
        classifyField(field("attachments", list(nonNull(obj("UploadFile"))))),
      ).toEqual({ kind: "upload-file-list", fieldName: "attachments" });
    });

    it("classifies NON_NULL(LIST(NON_NULL(component))) as component-list", () => {
      const opts = { contentTypeNames: new Set(["Post"]) };
      expect(
        classifyField(
          field("sections", nonNull(list(nonNull(obj("ComponentSharedBlock"))))),
          opts,
        ),
      ).toEqual({ kind: "component-list", fieldName: "sections" });
    });

    // Strapi v4 wraps single-media references in UploadFileEntityResponse and
    // list-media references in UploadFileRelationResponseCollection. The
    // GraphQL type is OBJECT (not LIST) at the outer level — the array-ness
    // lives one layer deeper inside `.data`. We classify by name so the
    // extractor can decide how to peel the envelope.
    it("classifies UploadFileEntityResponse as upload-file (v4 single)", () => {
      expect(
        classifyField(field("splash", obj("UploadFileEntityResponse"))),
      ).toEqual({ kind: "upload-file", fieldName: "splash" });
    });

    it("classifies UploadFileRelationResponseCollection as upload-file-list (v4 list)", () => {
      expect(
        classifyField(
          field("attachments", obj("UploadFileRelationResponseCollection")),
        ),
      ).toEqual({ kind: "upload-file-list", fieldName: "attachments" });
    });
  });

  describe("Relations to other content types", () => {
    it("classifies a LIST of a non-UploadFile object as relation", () => {
      expect(classifyField(field("tags", list(obj("Tag")))).kind).toBe(
        "relation",
      );
      expect(classifyField(field("events", list(obj("Event")))).kind).toBe(
        "relation",
      );
    });

    it("classifies a single OBJECT field (non-UploadFile) as relation", () => {
      expect(classifyField(field("post", obj("Post"))).kind).toBe("relation");
    });
  });

  describe("Other fields (dates, booleans, enums, IDs)", () => {
    it("classifies NON_NULL ID as other", () => {
      expect(classifyField(field("id", nonNull(scalar("ID")))).kind).toBe(
        "other",
      );
    });

    it("classifies DateTime, Date as other", () => {
      expect(
        classifyField(field("created_at", nonNull(scalar("DateTime")))).kind,
      ).toBe("other");
      expect(classifyField(field("start", scalar("Date"))).kind).toBe("other");
    });

    it("classifies Boolean as other", () => {
      expect(classifyField(field("legacy", scalar("Boolean"))).kind).toBe(
        "other",
      );
    });

    it("classifies enums as other", () => {
      expect(
        classifyField(field("category", enumType("ENUM_GRANT_CATEGORY"))).kind,
      ).toBe("other");
    });

    it("classifies NON_NULL String title as other (not body, not URL)", () => {
      expect(classifyField(field("title", nonNull(scalar("String")))).kind).toBe(
        "other",
      );
    });

    it("classifies slug as other", () => {
      expect(classifyField(field("slug", scalar("String"))).kind).toBe("other");
    });
  });

  describe("NON_NULL wrapping", () => {
    it("unwraps NON_NULL before classifying", () => {
      expect(
        classifyField(field("body", nonNull(scalar("String")))).kind,
      ).toBe("body-string");
      expect(
        classifyField(field("fileURL", nonNull(scalar("String")))).kind,
      ).toBe("url-string");
    });
  });

  describe("Robustness", () => {
    it("returns other for malformed or missing type info", () => {
      expect(classifyField({ name: "x", type: null }).kind).toBe("other");
      expect(classifyField({ name: "y" }).kind).toBe("other");
      expect(classifyField(null).kind).toBe("other");
      expect(classifyField(undefined).kind).toBe("other");
    });
  });

  // v1.29.0 — Strapi components (v3 "Group*", modern "Component*") embed
  // their data INSIDE the parent entry; they are not enumerated as content
  // types, so classifying them as relations silently dropped every file
  // they carry (SPAC's publication PDFs and meeting agendas/minutes all
  // live in components). With the discovered content-type names passed in,
  // any non-content-type object is a component to walk; without them
  // (legacy call shape) the old relation behavior is preserved.
  describe("components vs relations (v1.29.0, with contentTypeNames)", () => {
    const union = (name) => ({ name, kind: "UNION", ofType: null });
    const opts = { contentTypeNames: new Set(["Publication", "Tag", "Meeting"]) };

    it("classifies a known content-type OBJECT as relation", () => {
      expect(classifyField(field("post", obj("Publication")), opts).kind).toBe("relation");
      expect(classifyField(field("tags", list(obj("Tag"))), opts).kind).toBe("relation");
    });

    it("classifies a v3 Group* OBJECT as component", () => {
      expect(classifyField(field("mediaMaterial", obj("GroupMediaMaterial")), opts)).toEqual({
        kind: "component",
        fieldName: "mediaMaterial",
      });
    });

    it("classifies a LIST of v3 Group* as component-list", () => {
      expect(
        classifyField(field("meetingMaterial", list(obj("GroupMeetingMaterial"))), opts),
      ).toEqual({ kind: "component-list", fieldName: "meetingMaterial" });
    });

    it("classifies a modern Component* OBJECT as component", () => {
      expect(
        classifyField(field("hero", obj("ComponentSharedMediaBlock")), opts).kind,
      ).toBe("component");
    });

    it("classifies a dynamic-zone UNION as component-list", () => {
      expect(
        classifyField(field("zone", list(union("PageZoneDynamicZone"))), opts).kind,
      ).toBe("component-list");
      expect(classifyField(field("zone", union("PageZoneDynamicZone")), opts).kind).toBe(
        "component",
      );
    });

    it("still classifies v4 relation envelopes as relation", () => {
      expect(
        classifyField(field("author", obj("AuthorEntityResponse")), opts).kind,
      ).toBe("relation");
      expect(
        classifyField(field("tags", obj("TagRelationResponseCollection")), opts).kind,
      ).toBe("relation");
    });

    it("classifies system/admin objects as other, not component", () => {
      expect(classifyField(field("created_by", obj("AdminUser")), opts).kind).toBe("other");
      expect(
        classifyField(field("role", obj("UsersPermissionsRole")), opts).kind,
      ).toBe("other");
    });

    it("upload-file classification is unaffected by opts", () => {
      expect(classifyField(field("splash", obj("UploadFile")), opts).kind).toBe("upload-file");
      expect(
        classifyField(field("files", list(obj("UploadFile"))), opts).kind,
      ).toBe("upload-file-list");
    });

    it("without contentTypeNames, unknown OBJECTs stay relation (legacy shape)", () => {
      expect(classifyField(field("mediaMaterial", obj("GroupMediaMaterial"))).kind).toBe(
        "relation",
      );
    });
  });
});
