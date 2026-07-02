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

  // v1.39.0 (B7) — url-string fields carry page links (articleURL) as well
  // as file links; only audited file URLs may enter referencedFiles, or a
  // page link becomes a phantom "referenced file" key.
  it("filters url-string values through the audited-extension gate", () => {
    const entry = {
      id: 1,
      articleURL: "https://icjia.illinois.gov/articles/some-page",
      fileURL: "https://researchhub.icjia-api.cloud/uploads/report.pdf",
    };
    const classified = [
      { kind: "url-string", fieldName: "articleURL" },
      { kind: "url-string", fieldName: "fileURL" },
    ];
    expect(
      extractEntryUrls(entry, classified, "https://agency.icjia-api.cloud"),
    ).toEqual(["https://researchhub.icjia-api.cloud/uploads/report.pdf"]);
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

  // v1.29.0 — components. SPAC's publication PDFs live in
  // mediaMaterial.file.url; meetings carry agenda/materials/minutes in
  // meetingMaterial[].file[].url. Both shapes verified against the live
  // spac.icjia-api.cloud API 2026-06-11.
  it("collects files nested in a single component (SPAC publication shape)", () => {
    const entry = {
      id: 1,
      slug: "projections-2019",
      mediaMaterial: {
        _id: "m1",
        name: "2019 Projections",
        file: {
          name: "2019_Baseline_IDOC_Population_Projection_FINAL.pdf",
          ext: ".pdf",
          mime: "application/pdf",
          url: "/uploads/2019_Baseline_IDOC_Population_Projection_FINAL-20191029T21514462.pdf",
        },
      },
    };
    const classified = [{ kind: "component", fieldName: "mediaMaterial" }];
    expect(extractEntryUrls(entry, classified, "https://spac.icjia-api.cloud")).toEqual([
      "https://spac.icjia-api.cloud/uploads/2019_Baseline_IDOC_Population_Projection_FINAL-20191029T21514462.pdf",
    ]);
  });

  it("collects files from a repeatable component list (SPAC meeting shape)", () => {
    const entry = {
      id: 2,
      slug: "sept-2017",
      meetingMaterial: [
        { name: "Agenda", file: [{ url: "/uploads/09 15 17 Agenda.pdf", ext: ".pdf" }] },
        { name: "Minutes", file: [{ url: "/uploads/09 15 17 Minutes.pdf", ext: ".pdf" }] },
      ],
    };
    const classified = [{ kind: "component-list", fieldName: "meetingMaterial" }];
    expect(extractEntryUrls(entry, classified, "https://spac.icjia-api.cloud")).toEqual([
      "https://spac.icjia-api.cloud/uploads/09%2015%2017%20Agenda.pdf",
      "https://spac.icjia-api.cloud/uploads/09%2015%2017%20Minutes.pdf",
    ]);
  });

  it("resolves root-relative links in body fields against restApiBase (v1.29.0)", () => {
    const entry = {
      id: 3,
      body: "Download [the form](/uploads/intake_form.docx) before the meeting.",
    };
    const classified = [{ kind: "body-string", fieldName: "body" }];
    expect(extractEntryUrls(entry, classified, "https://spac.icjia-api.cloud")).toEqual([
      "https://spac.icjia-api.cloud/uploads/intake_form.docx",
    ]);
  });
});

// --- introspectContentTypes ---

describe("introspectContentTypes", () => {
  it("returns {singular, plural} pairs for each content type", async () => {
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
    expect(types).toEqual([
      { singular: "grant", plural: "grants" },
      { singular: "publication", plural: "publications" },
      { singular: "post", plural: "posts" },
    ]);
  });

  it("derives irregular plurals from the schema (county → counties, policy → policies)", async () => {
    // ilfvcc-api-prod's real schema has county/counties/countiesConnection
    // and would silently skip it under naive +s pluralization.
    const fetcher = async () => ({
      data: {
        __schema: {
          queryType: {
            fields: [
              { name: "county" },
              { name: "counties" },
              { name: "countiesConnection" },
              { name: "policy" },
              { name: "policies" },
              { name: "policiesConnection" },
              { name: "post" },
              { name: "posts" },
              { name: "postsConnection" },
              { name: "role" },
              { name: "roles" },
            ],
          },
        },
      },
    });
    const types = await introspectContentTypes("x", fetcher);
    expect(types).toEqual([
      { singular: "county", plural: "counties" },
      { singular: "policy", plural: "policies" },
      { singular: "post", plural: "posts" },
    ]);
  });

  it("skips singletons (no plural form in schema) and home/me", async () => {
    const fetcher = async () => ({
      data: {
        __schema: {
          queryType: {
            fields: [
              { name: "home" },
              { name: "page" },
              { name: "pages" },
              { name: "pagesConnection" },
              { name: "me" },
            ],
          },
        },
      },
    });
    const types = await introspectContentTypes("x", fetcher);
    expect(types).toEqual([{ singular: "page", plural: "pages" }]);
  });

  // v1.39.0 (B4) — irregular plural forms beyond ies/es/s. Each pair below
  // was silently dropped by the old reverse rules (quizzes → "quizze"/
  // "quizz" never matched quiz, analyses → "analyse"/"analys" never matched
  // analysis), so every entry of those types vanished from the sidecar.
  it("pairs irregular plurals: quiz/quizzes, analysis/analyses, person/people, criterion/criteria, syllabus/syllabi", async () => {
    const mk = (singular, plural) => [
      { name: singular },
      { name: plural },
      { name: `${plural}Connection` },
    ];
    const fetcher = async () => ({
      data: {
        __schema: {
          queryType: {
            fields: [
              ...mk("quiz", "quizzes"),
              ...mk("analysis", "analyses"),
              ...mk("person", "people"),
              ...mk("criterion", "criteria"),
              ...mk("syllabus", "syllabi"),
              ...mk("grant", "grants"),
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
      { singular: "criterion", plural: "criteria" },
      { singular: "syllabus", plural: "syllabi" },
      { singular: "grant", plural: "grants" },
    ]);
  });

  // v1.39.0 (B4) — silent drops become visible: every queryType field that
  // is neither paired, a *Connection paginator, nor a known auth/plugin
  // field is WARNed by name.
  it("WARNs with every unpairable type name (foot/feet has no rule; home has no plural)", async () => {
    const fetcher = async () => ({
      data: {
        __schema: {
          queryType: {
            fields: [
              { name: "home" },
              { name: "foot" },
              { name: "feet" },
              { name: "feetConnection" },
              { name: "grant" },
              { name: "grants" },
              { name: "grantsConnection" },
              { name: "role" },
              { name: "roles" },
              { name: "me" },
            ],
          },
        },
      },
    });
    const logs = [];
    const types = await introspectContentTypes("x", fetcher, {
      log: (msg) => logs.push(msg),
    });
    expect(types).toEqual([{ singular: "grant", plural: "grants" }]);
    const warn = logs.find((l) => l.includes("could not pair GraphQL types"));
    expect(warn).toBeDefined();
    expect(warn).toContain("home");
    expect(warn).toContain("foot");
    expect(warn).toContain("feet");
    expect(warn).toContain("will not be fetched");
    // paired + auth/plugin names stay out of the WARN
    expect(warn).not.toContain("grant");
    expect(warn).not.toContain("role");
  });

  it("emits no WARN when every type pairs", async () => {
    const fetcher = async () => ({
      data: {
        __schema: {
          queryType: {
            fields: [
              { name: "grant" },
              { name: "grants" },
              { name: "grantsConnection" },
            ],
          },
        },
      },
    });
    const logs = [];
    await introspectContentTypes("x", fetcher, { log: (m) => logs.push(m) });
    expect(logs.filter((l) => l.includes("could not pair"))).toEqual([]);
  });

  // v1.39.0 (B1) — a GraphQL-level failure (errors array, null data) used
  // to degrade to `?? []` → zero content types → an EMPTY sidecar that
  // marked every file on the site an orphan. Fail loudly instead.
  it("throws with the first error message when the response carries a non-empty errors array", async () => {
    const fetcher = async () => ({
      errors: [{ message: "Forbidden access" }, { message: "second" }],
      data: null,
    });
    await expect(
      introspectContentTypes("https://x.com/graphql", fetcher),
    ).rejects.toThrow(/Forbidden access/);
  });

  it("throws when the response has no data at all", async () => {
    await expect(
      introspectContentTypes("https://x.com/graphql", async () => ({ data: null })),
    ).rejects.toThrow(/no data/i);
    await expect(
      introspectContentTypes("https://x.com/graphql", async () => ({})),
    ).rejects.toThrow(/no data/i);
  });
});

// --- introspectTypeFields ---

describe("introspectTypeFields", () => {
  // v1.39.0 (B1) — same fail-loudly contract as introspectContentTypes
  // (shared by the v4 adapter, which re-exports this function).
  it("throws on a non-empty errors array instead of classifying zero fields", async () => {
    const fetcher = async () => ({
      errors: [{ message: "Cannot query __type" }],
    });
    await expect(introspectTypeFields("x", "Grant", fetcher)).rejects.toThrow(
      /Cannot query __type/,
    );
  });

  it("throws when the __type response has no data", async () => {
    await expect(
      introspectTypeFields("x", "Grant", async () => ({ data: null })),
    ).rejects.toThrow(/no data/i);
  });
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

  // v1.39.0 (B10) — Strapi v4 required lists are typed [UploadFile!]! =
  // NON_NULL(LIST(NON_NULL(OBJECT))). The old __type query requested only
  // one ofType level, so a real server truncated the chain and the inner
  // OBJECT was invisible → classified "other" → every file in such a field
  // dropped. Simulate a real server: answer with EXACTLY the ofType depth
  // the query requests.
  it("requests enough ofType depth to see through NON_NULL(LIST(NON_NULL(OBJECT)))", async () => {
    const objT = (name) => ({ name, kind: "OBJECT", ofType: null });
    const nonNullT = (inner) => ({ name: null, kind: "NON_NULL", ofType: inner });
    const listT = (inner) => ({ name: null, kind: "LIST", ofType: inner });
    const FULL_TYPES = {
      attachments: nonNullT(listT(nonNullT(objT("UploadFile")))),
      sections: nonNullT(listT(nonNullT(objT("ComponentSharedBlock")))),
      splash: listT(nonNullT(objT("UploadFile"))),
    };
    // Serialize a type tree only as deep as the query's ofType nesting —
    // exactly what a GraphQL server does.
    const pruneToQueryDepth = (type, query) => {
      const depth = (query.match(/ofType/g) ?? []).length;
      const prune = (node, remaining) => {
        if (!node) return null;
        const out = { name: node.name ?? null, kind: node.kind };
        if (remaining > 0) out.ofType = node.ofType ? prune(node.ofType, remaining - 1) : null;
        return out;
      };
      return prune(type, depth);
    };
    const fetcher = async (url, init) => {
      const { query } = JSON.parse(init.body);
      return {
        data: {
          __type: {
            fields: Object.entries(FULL_TYPES).map(([name, type]) => ({
              name,
              type: pruneToQueryDepth(type, query),
            })),
          },
        },
      };
    };
    const fields = await introspectTypeFields("x", "Post", fetcher, {
      contentTypeNames: new Set(["Post"]),
    });
    expect(fields).toEqual([
      { kind: "upload-file-list", fieldName: "attachments" },
      { kind: "component-list", fieldName: "sections" },
      { kind: "upload-file-list", fieldName: "splash" },
    ]);
  });

  it("v1.29.0 — classifies Group*/Component* objects as components when contentTypeNames is passed", async () => {
    // SPAC's real Publication type: mediaMaterial is GroupMediaMaterial
    // (verified live 2026-06-11); tags stay a relation because Tag is a
    // discovered content type.
    const fetcher = async () => ({
      data: {
        __type: {
          fields: [
            { name: "mediaMaterial", type: { name: "GroupMediaMaterial", kind: "OBJECT", ofType: null } },
            { name: "meetingMaterial", type: { name: null, kind: "LIST", ofType: { name: "GroupMeetingMaterial", kind: "OBJECT" } } },
            { name: "tags", type: { name: null, kind: "LIST", ofType: { name: "Tag", kind: "OBJECT" } } },
          ],
        },
      },
    });
    const fields = await introspectTypeFields("x", "Publication", fetcher, {
      contentTypeNames: new Set(["Publication", "Tag", "Meeting"]),
    });
    expect(fields).toEqual([
      { kind: "component", fieldName: "mediaMaterial" },
      { kind: "component-list", fieldName: "meetingMaterial" },
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

  // FC-2026-031 (1.8.0-beta.3): an outer page-count cap protects against
  // a runaway pagination loop (misconfigured site, hostile fixture, bug in
  // Strapi's pagination total field). Default is generous (10k pages); the
  // test pins a tiny cap to exercise the guard.
  it("throws when pagination exceeds maxPages (FC-2026-031)", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      // Return a full page forever — without the cap this loop runs until OOM.
      return [{ id: calls }];
    };
    await expect(
      fetchAllEntries("https://x.com", "things", fetcher, {
        limit: 1,
        maxPages: 5,
      }),
    ).rejects.toThrow(/maxPages/);
    expect(calls).toBeLessThanOrEqual(6); // up to 5 pages then the throw
  });

  // v1.39.0 (B9) — a SHORT page no longer ends the walk: Strapi caps page
  // sizes server-side (maxLimit), so a short page can occur mid-stream.
  // Only an EMPTY page terminates. (This test previously pinned the buggy
  // stop-on-short-page behavior with a single call.)
  it("keeps paginating past a short page and stops on the first EMPTY page", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return calls === 1 ? [{ id: 1 }, { id: 2 }] : [];
    };
    const entries = await fetchAllEntries(
      "https://x.com",
      "things",
      fetcher,
      { limit: 100 },
    );
    expect(entries).toEqual([{ id: 1 }, { id: 2 }]);
    expect(calls).toBe(2);
  });

  // v1.39.0 (B9) — a server whose maxLimit (50) is below the requested
  // _limit (100) returns short pages for a 250-record collection. All 250
  // must be fetched: _start must advance by the records RECEIVED, not the
  // requested limit (advancing by 100 would silently skip half of them).
  it("fetches all records from a maxLimit-capped server (250 records in 50-record pages)", async () => {
    const TOTAL = 250;
    const CAP = 50;
    const calls = [];
    const fetcher = async (url) => {
      calls.push(url);
      const u = new URL(url);
      const start = parseInt(u.searchParams.get("_start"), 10);
      const limit = Math.min(parseInt(u.searchParams.get("_limit"), 10), CAP);
      const page = [];
      for (let i = start; i < Math.min(start + limit, TOTAL); i++) {
        page.push({ id: i + 1 });
      }
      return page;
    };
    const entries = await fetchAllEntries(
      "https://agency.icjia-api.cloud",
      "grants",
      fetcher,
      { limit: 100 },
    );
    expect(entries.length).toBe(TOTAL);
    expect(new Set(entries.map((e) => e.id)).size).toBe(TOTAL);
    expect(entries[0].id).toBe(1);
    expect(entries[TOTAL - 1].id).toBe(TOTAL);
  });
});
