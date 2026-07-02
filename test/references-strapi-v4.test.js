import { describe, it, expect } from "vitest";
import {
  extractEntryUrls,
  introspectContentTypes,
  fetchAllEntries,
} from "../src/references/strapi-v4.js";

// --- extractEntryUrls (v4) ---
//
// Strapi v4 nests every content field under `entry.attributes` and wraps
// media references in a typed envelope: `{ data: { id, attributes: { url } } }`
// for single media, `{ data: [{ id, attributes: { url } }] }` for list media.
// The v4 extractor unwraps both.

describe("extractEntryUrls (v4)", () => {
  it("returns [] for an entry with no extractable fields", () => {
    const entry = {
      id: 1,
      attributes: { title: "x", slug: "x" },
    };
    const classified = [
      { kind: "other", fieldName: "title" },
      { kind: "other", fieldName: "slug" },
    ];
    expect(extractEntryUrls(entry, classified, "https://x.com")).toEqual([]);
  });

  it("returns [] when entry has no attributes envelope", () => {
    // Defensive: v4 always nests in attributes, but an empty fixture or
    // malformed payload should not throw.
    const entry = { id: 1 };
    const classified = [{ kind: "body-string", fieldName: "body" }];
    expect(extractEntryUrls(entry, classified, "https://x.com")).toEqual([]);
  });

  it("extracts file URLs from a body markdown field under attributes", () => {
    const entry = {
      id: 1,
      attributes: {
        body: "[Annual report](https://r3.icjia-api.cloud/uploads/report.pdf)",
      },
    };
    const classified = [{ kind: "body-string", fieldName: "body" }];
    expect(
      extractEntryUrls(entry, classified, "https://r3.icjia-api.cloud"),
    ).toEqual(["https://r3.icjia-api.cloud/uploads/report.pdf"]);
  });

  it("captures a url-string field's value under attributes (canonicalized)", () => {
    const entry = {
      id: 1,
      attributes: {
        fileURL:
          "https://archive.icjia-api.cloud/files/icjia/foo.pdf#page=2",
      },
    };
    const classified = [{ kind: "url-string", fieldName: "fileURL" }];
    expect(
      extractEntryUrls(entry, classified, "https://dvfr.icjia-api.cloud"),
    ).toEqual(["https://archive.icjia-api.cloud/files/icjia/foo.pdf"]);
  });

  // v1.39.0 (B7) — url-string values must pass the audited-extension gate.
  it("filters url-string values through the audited-extension gate (v4)", () => {
    const entry = {
      id: 1,
      attributes: {
        articleUrl: "https://icjia.illinois.gov/articles/some-page",
        fileURL: "https://archive.icjia-api.cloud/uploads/report.pdf",
      },
    };
    const classified = [
      { kind: "url-string", fieldName: "articleUrl" },
      { kind: "url-string", fieldName: "fileURL" },
    ];
    expect(
      extractEntryUrls(entry, classified, "https://dvfr.icjia-api.cloud"),
    ).toEqual(["https://archive.icjia-api.cloud/uploads/report.pdf"]);
  });

  it("extracts a single upload-file from data.attributes.url", () => {
    // v4 single-media envelope (populated)
    const entry = {
      id: 1,
      attributes: {
        splash: {
          data: {
            id: 7,
            attributes: { url: "/uploads/hero.png", name: "hero" },
          },
        },
      },
    };
    const classified = [{ kind: "upload-file", fieldName: "splash" }];
    expect(
      extractEntryUrls(entry, classified, "https://dvfr.icjia-api.cloud"),
    ).toEqual(["https://dvfr.icjia-api.cloud/uploads/hero.png"]);
  });

  it("handles an empty single upload-file (data: null) gracefully", () => {
    const entry = {
      id: 1,
      attributes: { splash: { data: null } },
    };
    const classified = [{ kind: "upload-file", fieldName: "splash" }];
    expect(
      extractEntryUrls(entry, classified, "https://dvfr.icjia-api.cloud"),
    ).toEqual([]);
  });

  it("extracts list upload-files from data[].attributes.url", () => {
    const entry = {
      id: 1,
      attributes: {
        attachments: {
          data: [
            {
              id: 8,
              attributes: { url: "/uploads/minutes-a.pdf", ext: ".pdf" },
            },
            {
              id: 9,
              attributes: { url: "/uploads/minutes-b.pdf", ext: ".pdf" },
            },
          ],
        },
      },
    };
    const classified = [{ kind: "upload-file-list", fieldName: "attachments" }];
    expect(
      extractEntryUrls(entry, classified, "https://dvfr.icjia-api.cloud"),
    ).toEqual([
      "https://dvfr.icjia-api.cloud/uploads/minutes-a.pdf",
      "https://dvfr.icjia-api.cloud/uploads/minutes-b.pdf",
    ]);
  });

  it("handles an empty list upload-file (data: null OR data: []) gracefully", () => {
    // Observed in the infonet probe: empty list media comes back as `data: null`
    // not `data: []`. Both shapes must be safe.
    const nullForm = {
      id: 1,
      attributes: { attachments: { data: null } },
    };
    const emptyArrayForm = {
      id: 2,
      attributes: { attachments: { data: [] } },
    };
    const classified = [{ kind: "upload-file-list", fieldName: "attachments" }];
    expect(
      extractEntryUrls(nullForm, classified, "https://dvfr.icjia-api.cloud"),
    ).toEqual([]);
    expect(
      extractEntryUrls(emptyArrayForm, classified, "https://dvfr.icjia-api.cloud"),
    ).toEqual([]);
  });

  it("dedupes URLs across body + attachments (v4 grants-style case)", () => {
    const entry = {
      id: 1,
      attributes: {
        body: "See [the NOFO](https://x.com/nofo.pdf).",
        attachments: {
          data: [{ id: 1, attributes: { url: "https://x.com/nofo.pdf" } }],
        },
      },
    };
    const classified = [
      { kind: "body-string", fieldName: "body" },
      { kind: "upload-file-list", fieldName: "attachments" },
    ];
    const out = extractEntryUrls(
      entry,
      classified,
      "https://dvfr.icjia-api.cloud",
    );
    expect(out).toEqual(["https://x.com/nofo.pdf"]);
  });

  it("resolves relative /uploads/ URLs to absolute against restApiBase", () => {
    const entry = {
      id: 1,
      attributes: {
        attachments: {
          data: [
            { id: 1, attributes: { url: "/uploads/relative.pdf" } },
            { id: 2, attributes: { url: "https://other.host/absolute.pdf" } },
          ],
        },
      },
    };
    const classified = [{ kind: "upload-file-list", fieldName: "attachments" }];
    expect(
      extractEntryUrls(entry, classified, "https://dvfr.icjia-api.cloud"),
    ).toEqual([
      "https://dvfr.icjia-api.cloud/uploads/relative.pdf",
      "https://other.host/absolute.pdf",
    ]);
  });

  it("ignores relation fields under attributes (enumerated separately)", () => {
    const entry = {
      id: 1,
      attributes: {
        tags: { data: [{ id: 5, attributes: { name: "tag" } }] },
      },
    };
    const classified = [{ kind: "relation", fieldName: "tags" }];
    expect(
      extractEntryUrls(entry, classified, "https://dvfr.icjia-api.cloud"),
    ).toEqual([]);
  });

  // v1.29.0 — components under attributes. v4 media inside a component uses
  // the data/attributes envelope; the walker peels it by shape.
  it("collects files nested in a component under attributes", () => {
    const entry = {
      id: 1,
      attributes: {
        download: {
          id: 3,
          title: "Annual report",
          file: {
            data: {
              id: 9,
              attributes: {
                url: "/uploads/annual_report.pdf",
                mime: "application/pdf",
                name: "annual_report.pdf",
              },
            },
          },
        },
      },
    };
    const classified = [{ kind: "component", fieldName: "download" }];
    expect(extractEntryUrls(entry, classified, "https://dvfr.icjia-api.cloud")).toEqual([
      "https://dvfr.icjia-api.cloud/uploads/annual_report.pdf",
    ]);
  });

  it("collects files from a component list / dynamic zone under attributes", () => {
    const entry = {
      id: 2,
      attributes: {
        sections: [
          {
            __component: "shared.download-block",
            file: { data: { id: 1, attributes: { url: "/uploads/a.pdf", ext: ".pdf" } } },
          },
          {
            __component: "shared.rich-text",
            body: "See [the form](https://dvfr.icjia-api.cloud/uploads/b.docx).",
          },
        ],
      },
    };
    const classified = [{ kind: "component-list", fieldName: "sections" }];
    expect(extractEntryUrls(entry, classified, "https://dvfr.icjia-api.cloud")).toEqual([
      "https://dvfr.icjia-api.cloud/uploads/a.pdf",
      "https://dvfr.icjia-api.cloud/uploads/b.docx",
    ]);
  });

  it("resolves root-relative links in v4 body fields against restApiBase (v1.29.0)", () => {
    const entry = {
      id: 3,
      attributes: { body: "Download [here](/uploads/guide.pdf)." },
    };
    const classified = [{ kind: "body-string", fieldName: "body" }];
    expect(extractEntryUrls(entry, classified, "https://dvfr.icjia-api.cloud")).toEqual([
      "https://dvfr.icjia-api.cloud/uploads/guide.pdf",
    ]);
  });
});

// --- introspectContentTypes (v4) ---
//
// Strapi v4 doesn't have *Connection paginator fields like v3 — content
// types appear as plain singular+plural pairs in the queryType.

describe("introspectContentTypes (v4)", () => {
  it("returns {singular, plural} pairs and skips system/auth fields", async () => {
    // Mirrors the actual dvfr.icjia-api.cloud v4 schema observed during probe.
    const fetcher = async () => ({
      data: {
        __schema: {
          queryType: {
            fields: [
              { name: "uploadFile" },
              { name: "uploadFiles" },
              { name: "uploadFolder" },
              { name: "uploadFolders" },
              { name: "i18NLocale" },
              { name: "i18NLocales" },
              { name: "usersPermissionsRole" },
              { name: "usersPermissionsRoles" },
              { name: "usersPermissionsUser" },
              { name: "usersPermissionsUsers" },
              { name: "faq" },
              { name: "faqs" },
              { name: "meeting" },
              { name: "meetings" },
              { name: "page" },
              { name: "pages" },
              { name: "post" },
              { name: "posts" },
              { name: "publication" },
              { name: "publications" },
              { name: "me" },
            ],
          },
        },
      },
    });
    const types = await introspectContentTypes(
      "https://dvfr.icjia-api.cloud/graphql",
      fetcher,
    );
    expect(types).toEqual([
      { singular: "faq", plural: "faqs" },
      { singular: "meeting", plural: "meetings" },
      { singular: "page", plural: "pages" },
      { singular: "post", plural: "posts" },
      { singular: "publication", plural: "publications" },
    ]);
  });

  it("derives irregular plurals (biography → biographies) on i2i v4 schema", async () => {
    const fetcher = async () => ({
      data: {
        __schema: {
          queryType: {
            fields: [
              { name: "uploadFile" },
              { name: "uploadFiles" },
              { name: "biography" },
              { name: "biographies" },
              { name: "cohort" },
              { name: "cohorts" },
              { name: "page" },
              { name: "pages" },
              { name: "me" },
            ],
          },
        },
      },
    });
    const types = await introspectContentTypes("x", fetcher);
    expect(types).toEqual([
      { singular: "biography", plural: "biographies" },
      { singular: "cohort", plural: "cohorts" },
      { singular: "page", plural: "pages" },
    ]);
  });

  // v1.39.0 (B4) — a v4 singular with no plural partner is a SINGLE TYPE
  // (homepage, about, config): its content lives at /api/<name> and can
  // carry file links. Previously these were silently dropped (false
  // orphans); now they come back flagged singleType so the orchestrator
  // fetches them as single-entry REST calls.
  it("returns unpaired singulars as single-type entries (plural: null, singleType: true)", async () => {
    const fetcher = async () => ({
      data: {
        __schema: {
          queryType: {
            fields: [
              { name: "page" },
              { name: "pages" },
              { name: "config" }, // no `configs` — single type
              { name: "me" },
            ],
          },
        },
      },
    });
    const types = await introspectContentTypes("x", fetcher);
    expect(types).toEqual([
      { singular: "page", plural: "pages" },
      { singular: "config", plural: null, singleType: true },
    ]);
  });

  it("a plural-looking name iterated before its singular is still claimed by the pair, not a single type", async () => {
    // `faqs` appears before `faq` — pairing happens on the singular pass;
    // the singles post-pass must not mistake the already-claimed plural for
    // a single type.
    const fetcher = async () => ({
      data: {
        __schema: {
          queryType: {
            fields: [{ name: "faqs" }, { name: "faq" }],
          },
        },
      },
    });
    const types = await introspectContentTypes("x", fetcher);
    expect(types).toEqual([{ singular: "faq", plural: "faqs" }]);
  });

  // v1.39.0 (B4) — irregular plural pairing (forward direction).
  it("pairs irregular plurals: quiz/quizzes, analysis/analyses, person/people, matrix/matrices, index/indices, curriculum/curricula", async () => {
    const fetcher = async () => ({
      data: {
        __schema: {
          queryType: {
            fields: [
              { name: "quiz" },
              { name: "quizzes" },
              { name: "analysis" },
              { name: "analyses" },
              { name: "person" },
              { name: "people" },
              { name: "matrix" },
              { name: "matrices" },
              { name: "index" },
              { name: "indices" },
              { name: "curriculum" },
              { name: "curricula" },
              { name: "post" },
              { name: "posts" },
            ],
          },
        },
      },
    });
    const types = await introspectContentTypes("x", fetcher);
    expect(types).toEqual([
      { singular: "quiz", plural: "quizzes" },
      { singular: "analysis", plural: "analyses" },
      { singular: "person", plural: "people" },
      { singular: "matrix", plural: "matrices" },
      { singular: "index", plural: "indices" },
      { singular: "curriculum", plural: "curricula" },
      { singular: "post", plural: "posts" },
    ]);
  });

  it("strips the usersPermissions-prefixed auth types even if they look like singular/plural", async () => {
    // usersPermissionsRole/usersPermissionsRoles look like a valid s-form pair
    // but they're the Strapi v4 auth plugin's role table — skip.
    const fetcher = async () => ({
      data: {
        __schema: {
          queryType: {
            fields: [
              { name: "usersPermissionsRole" },
              { name: "usersPermissionsRoles" },
              { name: "post" },
              { name: "posts" },
            ],
          },
        },
      },
    });
    const types = await introspectContentTypes("x", fetcher);
    expect(types).toEqual([{ singular: "post", plural: "posts" }]);
  });

  // v1.39.0 (B1) — GraphQL errors / missing data must throw, not silently
  // discover zero types (which produced an empty sidecar → every file on
  // the site reported as an orphan).
  it("throws with the first error message on a non-empty errors array", async () => {
    const fetcher = async () => ({
      errors: [{ message: "Invalid token" }],
    });
    await expect(introspectContentTypes("x", fetcher)).rejects.toThrow(
      /Invalid token/,
    );
  });

  it("throws when the response has no data", async () => {
    await expect(
      introspectContentTypes("x", async () => ({ data: null })),
    ).rejects.toThrow(/no data/i);
  });
});

// --- fetchAllEntries (v4) ---
//
// v4 REST returns `{ data: [...entries], meta: { pagination: { start, limit, total } } }`
// at /api/<plural>. Pagination uses bracket params; we URL-encode them so the
// brackets don't confuse intermediaries.

describe("fetchAllEntries (v4)", () => {
  it("paginates via /api/<plural> with bracket params and accumulates until done", async () => {
    const pages = [
      { data: [{ id: 1 }, { id: 2 }], meta: { pagination: { total: 5 } } },
      { data: [{ id: 3 }, { id: 4 }], meta: { pagination: { total: 5 } } },
      { data: [{ id: 5 }], meta: { pagination: { total: 5 } } },
    ];
    const calls = [];
    let i = 0;
    const fetcher = async (url) => {
      calls.push(url);
      return pages[i++] ?? { data: [], meta: { pagination: { total: 5 } } };
    };
    const entries = await fetchAllEntries(
      "https://dvfr.icjia-api.cloud",
      "posts",
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
    // Bracket params URL-encoded so brackets survive proxies/load balancers
    expect(calls[0]).toContain("/api/posts");
    expect(calls[0]).toContain("pagination%5Blimit%5D=2");
    expect(calls[0]).toContain("pagination%5Bstart%5D=0");
    expect(calls[1]).toContain("pagination%5Bstart%5D=2");
    expect(calls[2]).toContain("pagination%5Bstart%5D=4");
    // populate=* so media + relations come back in the response
    expect(calls[0]).toContain("populate=%2A");
  });

  it("v1.29.0 — deep-populates component fields so their nested media is present", async () => {
    // populate=* only populates ONE level: a component comes back without
    // its inner media. When the classifier found component fields, the
    // fetch must ask for populate[<field>][populate]=* per component (and
    // keep plain media fields populated too).
    const calls = [];
    const fetcher = async (url) => {
      calls.push(url);
      return { data: [], meta: { pagination: { total: 0 } } };
    };
    await fetchAllEntries("https://dvfr.icjia-api.cloud", "posts", fetcher, {
      limit: 10,
      componentFields: ["download", "sections"],
      mediaFields: ["splash"],
    });
    const url = calls[0];
    expect(url).toContain("populate%5Bdownload%5D%5Bpopulate%5D=%2A");
    expect(url).toContain("populate%5Bsections%5D%5Bpopulate%5D=%2A");
    expect(url).toContain("populate%5Bsplash%5D=%2A");
    expect(url).not.toContain("populate=%2A");
  });

  it("stops when response has fewer entries than the page limit", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return {
        data: [{ id: 1 }, { id: 2 }],
        meta: { pagination: { total: 2 } },
      };
    };
    const entries = await fetchAllEntries(
      "https://dvfr.icjia-api.cloud",
      "posts",
      fetcher,
      { limit: 100 },
    );
    expect(entries).toEqual([{ id: 1 }, { id: 2 }]);
    expect(calls).toBe(1);
  });

  it("stops when response data is empty", async () => {
    const fetcher = async () => ({
      data: [],
      meta: { pagination: { total: 0 } },
    });
    const entries = await fetchAllEntries(
      "https://dvfr.icjia-api.cloud",
      "posts",
      fetcher,
      { limit: 100 },
    );
    expect(entries).toEqual([]);
  });

  it("stops on an empty page even when meta is absent (no infinite loop)", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return { data: [] };
    };
    const entries = await fetchAllEntries(
      "https://dvfr.icjia-api.cloud",
      "posts",
      fetcher,
      { limit: 100 },
    );
    expect(entries).toEqual([]);
    expect(calls).toBe(1);
  });

  // v1.39.0 (B9) — Strapi v4's maxLimit caps the page size server-side: ask
  // for 100, get 50. A short page is NOT the end of the collection. With
  // meta.pagination present we trust total; without it we stop only on an
  // EMPTY page. Either way all 250 records must come back, with start
  // advancing by the records received.
  function cappedV4Fetcher({ total, cap, withMeta }) {
    const calls = [];
    const fetcher = async (url) => {
      calls.push(url);
      const u = new URL(url);
      const start = parseInt(u.searchParams.get("pagination[start]"), 10);
      const limit = Math.min(
        parseInt(u.searchParams.get("pagination[limit]"), 10),
        cap,
      );
      const data = [];
      for (let i = start; i < Math.min(start + limit, total); i++) {
        data.push({ id: i + 1 });
      }
      return withMeta
        ? { data, meta: { pagination: { start, limit, total } } }
        : { data };
    };
    return { fetcher, calls };
  }

  it("fetches all 250 records from a maxLimit-capped server (WITH v4 meta)", async () => {
    const { fetcher, calls } = cappedV4Fetcher({ total: 250, cap: 50, withMeta: true });
    const entries = await fetchAllEntries(
      "https://dvfr.icjia-api.cloud",
      "posts",
      fetcher,
      { limit: 100 },
    );
    expect(entries.length).toBe(250);
    expect(new Set(entries.map((e) => e.id)).size).toBe(250);
    // meta.total short-circuits the walk: no trailing empty-page request
    expect(calls.length).toBe(5);
  });

  it("fetches all 250 records from a maxLimit-capped server (WITHOUT meta — stop on empty)", async () => {
    const { fetcher, calls } = cappedV4Fetcher({ total: 250, cap: 50, withMeta: false });
    const entries = await fetchAllEntries(
      "https://dvfr.icjia-api.cloud",
      "posts",
      fetcher,
      { limit: 100 },
    );
    expect(entries.length).toBe(250);
    expect(calls.length).toBe(6); // 5 data pages + 1 empty terminator
  });

  it("honors page/pageCount-shaped meta (page < pageCount continues, last full page stops)", async () => {
    const pages = [
      { data: [{ id: 1 }, { id: 2 }], meta: { pagination: { page: 1, pageCount: 3 } } },
      { data: [{ id: 3 }, { id: 4 }], meta: { pagination: { page: 2, pageCount: 3 } } },
      { data: [{ id: 5 }, { id: 6 }], meta: { pagination: { page: 3, pageCount: 3 } } },
    ];
    let i = 0;
    const fetcher = async () => pages[i++] ?? { data: [] };
    const entries = await fetchAllEntries(
      "https://dvfr.icjia-api.cloud",
      "posts",
      fetcher,
      { limit: 2 },
    );
    expect(entries.length).toBe(6);
    // last page is FULL but meta says page === pageCount → no 4th request
    expect(i).toBe(3);
  });

  // Strapi v4 sets each content type's REST collection name via
  // `info.pluralName` in schema.json, which isn't deterministically derivable
  // from the GraphQL plural query name. Observed in the r3 v4 fleet:
  //   GraphQL plural        REST path that works
  //   weeklyFaqs             /api/weekly-faqs   (kebab-case wins)
  //   v2Weeklyfaqs           /api/v2Weeklyfaqs  (camelCase wins)
  // So on the first 404 we retry with the kebab-cased alternative before
  // surfacing the failure.
  it("falls back to kebab-case REST path on 404 (Strapi v4 pluralName quirk)", async () => {
    const calls = [];
    const fetcher = async (url) => {
      calls.push(url);
      if (url.includes("/api/weeklyFaqs")) {
        throw new Error("HTTP 404 Not Found for " + url);
      }
      return { data: [{ id: 99 }], meta: { pagination: { total: 1 } } };
    };
    const entries = await fetchAllEntries(
      "https://r3.icjia-api.cloud",
      "weeklyFaqs",
      fetcher,
      { limit: 100 },
    );
    expect(entries).toEqual([{ id: 99 }]);
    expect(calls[0]).toContain("/api/weeklyFaqs");
    expect(calls[1]).toContain("/api/weekly-faqs");
  });

  it("does not retry kebab-case when the plural has no camelCase boundaries", async () => {
    // For `posts` the kebab form is identical, so no second request should fire.
    const calls = [];
    const fetcher = async (url) => {
      calls.push(url);
      throw new Error("HTTP 404 Not Found for " + url);
    };
    await expect(
      fetchAllEntries("https://x.com", "posts", fetcher, { limit: 100 }),
    ).rejects.toThrow(/HTTP 404/);
    expect(calls.length).toBe(1);
  });

  // FC-2026-031 (1.8.0-beta.3): an outer page-count cap protects against
  // a runaway pagination loop. Mirror of the v3 guard.
  it("throws when pagination exceeds maxPages (FC-2026-031)", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return { data: [{ id: calls }], meta: { pagination: { total: 9999 } } };
    };
    await expect(
      fetchAllEntries("https://x.com", "posts", fetcher, {
        limit: 1,
        maxPages: 5,
      }),
    ).rejects.toThrow(/maxPages/);
    expect(calls).toBeLessThanOrEqual(6);
  });

  it("does not retry on non-404 errors (auth, server)", async () => {
    // 403 is the Public-role permissions case — kebab won't help, so don't waste a request
    const calls = [];
    const fetcher = async (url) => {
      calls.push(url);
      throw new Error("HTTP 403 Forbidden for " + url);
    };
    await expect(
      fetchAllEntries("https://x.com", "weeklyFaqs", fetcher, { limit: 100 }),
    ).rejects.toThrow(/HTTP 403/);
    expect(calls.length).toBe(1);
  });

  // v1.39.0 (B4) — single types answer /api/<name> with `data` as an OBJECT
  // (not an array). Normalize to [data] so the shared extraction loop works;
  // data: null (never published) yields no entries.
  it("normalizes a single-type object response to a one-entry array", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return {
        data: { id: 1, attributes: { title: "Home", slug: "home" } },
        meta: {},
      };
    };
    const entries = await fetchAllEntries(
      "https://dvfr.icjia-api.cloud",
      "homepage",
      fetcher,
      { limit: 100 },
    );
    expect(entries).toEqual([{ id: 1, attributes: { title: "Home", slug: "home" } }]);
    expect(calls).toBe(1); // an object response never paginates
  });

  it("single-type data: null (unpublished) yields no entries", async () => {
    const fetcher = async () => ({ data: null, meta: {} });
    const entries = await fetchAllEntries(
      "https://dvfr.icjia-api.cloud",
      "homepage",
      fetcher,
      { limit: 100 },
    );
    expect(entries).toEqual([]);
  });
});
