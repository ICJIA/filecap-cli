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
});
