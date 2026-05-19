import { describe, it, expect } from "vitest";
import {
  extractEntryUrls,
  introspectContentTypes,
  introspectTypeFields,
  fetchAllEntries,
} from "../src/references/strapi-v3.js";

// --- extractEntryUrls (pure) ---

describe("extractEntryUrls", () => {
  it("returns [] for an entry with no extractable fields", () => {
    const entry = { id: 1, title: "x", slug: "x" };
    const classified = [
      { kind: "other", fieldName: "id" },
      { kind: "other", fieldName: "title" },
      { kind: "other", fieldName: "slug" },
    ];
    expect(extractEntryUrls(entry, classified, "https://x.com")).toEqual([]);
  });

  it("captures a url-string field's value (canonicalized)", () => {
    const entry = {
      id: 1,
      fileURL:
        "https://researchhub.icjia-api.cloud/uploads/Foo%20Report.pdf#page=2",
    };
    const classified = [{ kind: "url-string", fieldName: "fileURL" }];
    expect(
      extractEntryUrls(entry, classified, "https://agency.icjia-api.cloud"),
    ).toEqual([
      "https://researchhub.icjia-api.cloud/uploads/Foo%20Report.pdf",
    ]);
  });

  it("ignores null/missing url-string field values", () => {
    const entry = { id: 1, fileURL: null, articleURL: undefined };
    const classified = [
      { kind: "url-string", fieldName: "fileURL" },
      { kind: "url-string", fieldName: "articleURL" },
    ];
    expect(
      extractEntryUrls(entry, classified, "https://agency.icjia-api.cloud"),
    ).toEqual([]);
  });

  it("extracts file URLs from a body markdown field", () => {
    const entry = {
      id: 1,
      body: "[A](https://x.com/a.pdf) and [B](https://x.com/b.docx)",
    };
    const classified = [{ kind: "body-string", fieldName: "body" }];
    expect(
      extractEntryUrls(entry, classified, "https://agency.icjia-api.cloud"),
    ).toEqual(["https://x.com/a.pdf", "https://x.com/b.docx"]);
  });

  it("dedupes URLs that appear in both body and attachments (grants case)", () => {
    const entry = {
      id: 1,
      body: "See [the NOFO](https://x.com/nofo.pdf).",
      attachments: [{ url: "https://x.com/nofo.pdf" }],
    };
    const classified = [
      { kind: "body-string", fieldName: "body" },
      { kind: "upload-file-list", fieldName: "attachments" },
    ];
    const out = extractEntryUrls(
      entry,
      classified,
      "https://agency.icjia-api.cloud",
    );
    expect(out).toEqual(["https://x.com/nofo.pdf"]);
  });

  it("extracts the .url from a single UploadFile field (splash)", () => {
    const entry = {
      id: 1,
      splash: { url: "https://x.com/hero.jpg", name: "hero" },
    };
    const classified = [{ kind: "upload-file", fieldName: "splash" }];
    // Note: extractor does not filter by extension — that's a separate concern.
    // Here jpg is captured because it's a typed media reference. The HTML/CSV
    // layers + domain filter will decide what to surface.
    expect(
      extractEntryUrls(entry, classified, "https://agency.icjia-api.cloud"),
    ).toEqual(["https://x.com/hero.jpg"]);
  });

  it("resolves relative Strapi /uploads/... URLs against restApiBase", () => {
    const entry = {
      id: 1,
      attachments: [
        { url: "/uploads/relative.pdf" },
        { url: "https://other.host/absolute.pdf" },
      ],
    };
    const classified = [
      { kind: "upload-file-list", fieldName: "attachments" },
    ];
    expect(
      extractEntryUrls(entry, classified, "https://agency.icjia-api.cloud"),
    ).toEqual([
      "https://agency.icjia-api.cloud/uploads/relative.pdf",
      "https://other.host/absolute.pdf",
    ]);
  });

  it("handles the real grant body content (verified probe case)", () => {
    const entry = {
      id: 217,
      slug: "2020-casa",
      body: `[LINK TO NOFO](https://archive.icjia-api.cloud/files/icjia/gata/materials/funding/2020-casa/CASANOFO.pdf) {.text-center}

[DOWNLOAD ZIP](https://archive.icjia-api.cloud/files/icjia/gata/materials/funding/2020-casa/CASANOFOZip.zip)

Questions posted [here](https://archive.icjia-api.cloud/files/icjia/gata/materials/funding/2020-casa/NOFOQ&A.pdf).
`,
      attachments: [],
    };
    const classified = [
      { kind: "body-string", fieldName: "body" },
      { kind: "upload-file-list", fieldName: "attachments" },
      { kind: "other", fieldName: "slug" },
    ];
    expect(
      extractEntryUrls(entry, classified, "https://agency.icjia-api.cloud"),
    ).toEqual([
      "https://archive.icjia-api.cloud/files/icjia/gata/materials/funding/2020-casa/CASANOFO.pdf",
      "https://archive.icjia-api.cloud/files/icjia/gata/materials/funding/2020-casa/CASANOFOZip.zip",
      "https://archive.icjia-api.cloud/files/icjia/gata/materials/funding/2020-casa/NOFOQ&A.pdf",
    ]);
  });

  it("ignores relation fields (they're enumerated separately)", () => {
    const entry = {
      id: 1,
      tags: [{ id: 5, name: "tag" }],
      events: [{ id: 9 }],
    };
    const classified = [
      { kind: "relation", fieldName: "tags" },
      { kind: "relation", fieldName: "events" },
    ];
    expect(
      extractEntryUrls(entry, classified, "https://agency.icjia-api.cloud"),
    ).toEqual([]);
  });
});

// --- introspectContentTypes ---

describe("introspectContentTypes", () => {
  it("returns content-type names from a Strapi v3 __schema response", async () => {
    // Mirror of the actual /graphql introspection result observed in the
    // verification probe against agency.icjia-api.cloud.
    const fetcher = async () => ({
      data: {
        __schema: {
          queryType: {
            fields: [
              { name: "grant" },
              { name: "grants" },
              { name: "grantsConnection" },
              { name: "publication" },
              { name: "publications" },
              { name: "publicationsConnection" },
              { name: "post" },
              { name: "posts" },
              { name: "postsConnection" },
              { name: "files" },
              { name: "filesConnection" },
              { name: "role" },
              { name: "roles" },
              { name: "user" },
              { name: "users" },
              { name: "me" },
            ],
          },
        },
      },
    });
    const types = await introspectContentTypes(
      "https://agency.icjia-api.cloud/graphql",
      fetcher,
    );
    expect(types).toEqual(["grant", "publication", "post"]);
  });
});

// --- introspectTypeFields ---

describe("introspectTypeFields", () => {
  it("returns classified fields for a content type", async () => {
    const fetcher = async () => ({
      data: {
        __type: {
          fields: [
            { name: "id", type: { name: null, kind: "NON_NULL", ofType: { name: "ID", kind: "SCALAR" } } },
            { name: "title", type: { name: null, kind: "NON_NULL", ofType: { name: "String", kind: "SCALAR" } } },
            { name: "body", type: { name: "String", kind: "SCALAR", ofType: null } },
            { name: "fileURL", type: { name: "String", kind: "SCALAR", ofType: null } },
            { name: "attachments", type: { name: null, kind: "LIST", ofType: { name: "UploadFile", kind: "OBJECT" } } },
            { name: "tags", type: { name: null, kind: "LIST", ofType: { name: "Tag", kind: "OBJECT" } } },
          ],
        },
      },
    });
    const fields = await introspectTypeFields(
      "https://agency.icjia-api.cloud/graphql",
      "Grant",
      fetcher,
    );
    expect(fields).toEqual([
      { kind: "other", fieldName: "id" },
      { kind: "other", fieldName: "title" },
      { kind: "body-string", fieldName: "body" },
      { kind: "url-string", fieldName: "fileURL" },
      { kind: "upload-file-list", fieldName: "attachments" },
      { kind: "relation", fieldName: "tags" },
    ]);
  });
});

// --- fetchAllEntries ---

describe("fetchAllEntries", () => {
  it("paginates and accumulates entries until the API returns an empty page", async () => {
    const pages = [
      [{ id: 1 }, { id: 2 }],
      [{ id: 3 }, { id: 4 }],
      [{ id: 5 }],
      [],
    ];
    const calls = [];
    let i = 0;
    const fetcher = async (url) => {
      calls.push(url);
      return pages[i++] ?? [];
    };
    const entries = await fetchAllEntries(
      "https://agency.icjia-api.cloud",
      "grants",
      fetcher,
      { limit: 2 },
    );
    expect(entries).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
      { id: 5 },
    ]);
    // Confirm pagination params were applied
    expect(calls[0]).toContain("_limit=2");
    expect(calls[0]).toContain("_start=0");
    expect(calls[1]).toContain("_start=2");
    expect(calls[2]).toContain("_start=4");
  });

  it("stops paginating when a page returns fewer entries than the limit", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      // Single-page response shorter than limit signals end of data
      return [{ id: 1 }, { id: 2 }];
    };
    const entries = await fetchAllEntries(
      "https://x.com",
      "things",
      fetcher,
      { limit: 100 },
    );
    expect(entries).toEqual([{ id: 1 }, { id: 2 }]);
    expect(calls).toBe(1);
  });
});
