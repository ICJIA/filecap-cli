import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { runReferences } from "../src/commands/references.js";

// v1.29.0 — orchestrator-level integration test. The unit suites cover each
// adapter; this exercises the threading the SPAC bug hid: discovered
// content-type names reach the classifier (so components are walked, not
// skipped as relations) and the walked component files land in the sidecar.
//
// The fetcher simulates a Strapi v3 backend shaped like SPAC's
// (verified live 2026-06-11): publications carry their PDF inside
// mediaMaterial.file, meetings inside meetingMaterial[].file[].

const SCHEMA_RESPONSE = {
  data: {
    __schema: {
      queryType: {
        fields: [
          { name: "publication" },
          { name: "publications" },
          { name: "publicationsConnection" },
          { name: "meeting" },
          { name: "meetings" },
          { name: "meetingsConnection" },
          { name: "tag" },
          { name: "tags" },
          { name: "tagsConnection" },
        ],
      },
    },
  },
};

const TYPE_FIELDS = {
  Publication: [
    { name: "title", type: { name: null, kind: "NON_NULL", ofType: { name: "String", kind: "SCALAR" } } },
    { name: "slug", type: { name: null, kind: "NON_NULL", ofType: { name: "String", kind: "SCALAR" } } },
    { name: "mediaMaterial", type: { name: "GroupMediaMaterial", kind: "OBJECT", ofType: null } },
    { name: "tags", type: { name: null, kind: "LIST", ofType: { name: "Tag", kind: "OBJECT" } } },
  ],
  Meeting: [
    { name: "slug", type: { name: null, kind: "NON_NULL", ofType: { name: "String", kind: "SCALAR" } } },
    { name: "content", type: { name: "String", kind: "SCALAR", ofType: null } },
    { name: "meetingMaterial", type: { name: null, kind: "LIST", ofType: { name: "GroupMeetingMaterial", kind: "OBJECT" } } },
  ],
  Tag: [
    { name: "slug", type: { name: null, kind: "NON_NULL", ofType: { name: "String", kind: "SCALAR" } } },
  ],
};

const PUBLICATIONS = [
  {
    id: "p1",
    slug: "projections-2019",
    title: "2019 Projections",
    mediaMaterial: {
      _id: "m1",
      file: {
        name: "2019_Projection.pdf",
        ext: ".pdf",
        mime: "application/pdf",
        url: "/uploads/2019_Projection.pdf",
      },
    },
    // A tag with its own embedded media-like noise must NOT be collected —
    // tags are relations (enumerated separately).
    tags: [{ id: "t1", slug: "prison", file: { url: "/uploads/tag-noise.pdf", ext: ".pdf" } }],
  },
];

const MEETINGS = [
  {
    id: "m9",
    slug: "sept-2017",
    content: "Materials below. External: https://www.justice.gov/file.pdf",
    meetingMaterial: [
      { name: "Agenda", file: [{ url: "/uploads/sept agenda.pdf", ext: ".pdf" }] },
      { name: "Minutes", file: [{ url: "/uploads/sept minutes.pdf", ext: ".pdf" }] },
    ],
  },
];

function fakeFetcher(url, init) {
  if (init?.body) {
    const { query } = JSON.parse(init.body);
    if (query.includes("__schema")) return Promise.resolve(SCHEMA_RESPONSE);
    const m = query.match(/__type\(name: "(\w+)"\)/);
    return Promise.resolve({ data: { __type: { fields: TYPE_FIELDS[m[1]] ?? [] } } });
  }
  if (url.includes("/publications")) {
    return Promise.resolve(url.includes("_start=0") ? PUBLICATIONS : []);
  }
  if (url.includes("/meetings")) {
    return Promise.resolve(url.includes("_start=0") ? MEETINGS : []);
  }
  if (url.includes("/tags")) return Promise.resolve([]);
  return Promise.resolve([]);
}

describe("runReferences (strapi-v3, component-bearing schema)", () => {
  it("walks components into referencedFiles and keeps relations out", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-refs-cmd-"));
    const outputPath = path.join(tmp, "spac.refs.ndjson");
    const siteConfig = {
      name: "spac-prod",
      publicUrlBase: "https://spac.icjia-api.cloud/uploads",
      siteUrl: "https://spac.illinois.gov/",
      references: {
        strategy: "strapi-v3",
        graphqlEndpoint: "https://spac.icjia-api.cloud/graphql",
        restApiBase: "https://spac.icjia-api.cloud",
        siteFrontendUrl: "https://spac.illinois.gov",
        contentTypeRoutes: {
          publication: "/publications/:slug/",
          meeting: "/meetings/:slug/",
        },
      },
    };
    const sitesJson = { sites: [siteConfig] };

    await runReferences({
      siteConfig,
      sitesJson,
      outputPath,
      fetcher: fakeFetcher,
      log: () => {},
    });

    const lines = (await fs.readFile(outputPath, "utf8")).split("\n").filter(Boolean);
    const records = lines.map((l) => JSON.parse(l));
    const bySlug = Object.fromEntries(records.map((r) => [r.slug, r]));

    expect(bySlug["projections-2019"].pageUrl).toBe(
      "https://spac.illinois.gov/publications/projections-2019/",
    );
    expect(bySlug["projections-2019"].referencedFiles).toEqual([
      "https://spac.icjia-api.cloud/uploads/2019_Projection.pdf",
    ]);

    expect(bySlug["sept-2017"].referencedFiles).toEqual([
      "https://spac.icjia-api.cloud/uploads/sept%20agenda.pdf",
      "https://spac.icjia-api.cloud/uploads/sept%20minutes.pdf",
    ]);

    await fs.rm(tmp, { recursive: true, force: true });
  });
});

// v1.39.0 (B1) — fail loudly instead of degrading to an empty sidecar.
// An empty/failed extraction used to exit 0 and feed cross-references a
// sidecar with no records → every file on the site flagged an orphan.
describe("runReferences failure modes (B1)", () => {
  const baseSiteConfig = {
    name: "agency-prod",
    publicUrlBase: "https://agency.icjia-api.cloud/uploads",
    siteUrl: "https://icjia.illinois.gov/",
    references: {
      strategy: "strapi-v3",
      graphqlEndpoint: "https://agency.icjia-api.cloud/graphql",
      restApiBase: "https://agency.icjia-api.cloud",
      siteFrontendUrl: "https://icjia.illinois.gov",
      contentTypeRoutes: {},
    },
  };

  function schemaWith(fields) {
    return {
      data: { __schema: { queryType: { fields } } },
    };
  }

  async function runTo(tmpName, fetcher, log = () => {}) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), tmpName));
    const outputPath = path.join(tmp, "refs.ndjson");
    try {
      return await runReferences({
        siteConfig: baseSiteConfig,
        sitesJson: { sites: [baseSiteConfig] },
        outputPath,
        fetcher,
        log,
      });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }

  // v1.39.0 post-audit hardening (red-4 MED-2): the hard-error tests must
  // also pin that NO sidecar file was written before the throw. Today the
  // throw provably precedes the write, but a write-then-throw refactor would
  // keep a plain rejects.toThrow green while an empty sidecar clobbers the
  // good one — the original whole-site false-orphan failure, hiding behind
  // exit 1. Returns the error so callers can assert on its message.
  async function runToHardError(tmpName, fetcher, log = () => {}) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), tmpName));
    const outputPath = path.join(tmp, "refs.ndjson");
    try {
      await runReferences({
        siteConfig: baseSiteConfig,
        sitesJson: { sites: [baseSiteConfig] },
        outputPath,
        fetcher,
        log,
      });
      throw new Error("expected runReferences to reject, but it resolved");
    } catch (err) {
      expect(existsSync(outputPath)).toBe(false);
      return err;
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }

  it("hard-errors when discovery returns 0 content types, naming the site and likely causes — and writes no sidecar", async () => {
    const fetcher = async (url, init) => {
      if (init?.body) return schemaWith([{ name: "me" }]); // nothing pairable
      return [];
    };
    const err = await runToHardError("filecap-refs-b1-", fetcher);
    expect(err.message).toMatch(
      /agency-prod.*0 content types|0 content types.*agency-prod/s,
    );
    expect(err.message).toMatch(/token|introspection/i);
  });

  it("hard-errors when EVERY content type's fetch fails — and writes no sidecar", async () => {
    const fetcher = async (url, init) => {
      if (init?.body) {
        const { query } = JSON.parse(init.body);
        if (query.includes("__schema")) {
          return schemaWith([
            { name: "grant" },
            { name: "grants" },
            { name: "grantsConnection" },
            { name: "post" },
            { name: "posts" },
            { name: "postsConnection" },
          ]);
        }
        return { data: { __type: { fields: [{ name: "body", type: { name: "String", kind: "SCALAR", ofType: null } }] } } };
      }
      throw new Error("HTTP 403 Forbidden for " + url);
    };
    const err = await runToHardError("filecap-refs-b1-", fetcher);
    expect(err.message).toMatch(/all 2 content types failed/i);
  });

  it("continues on a partial failure and states N/M types failed in the summary", async () => {
    const logs = [];
    const fetcher = async (url, init) => {
      if (init?.body) {
        const { query } = JSON.parse(init.body);
        if (query.includes("__schema")) {
          return schemaWith([
            { name: "grant" },
            { name: "grants" },
            { name: "grantsConnection" },
            { name: "post" },
            { name: "posts" },
            { name: "postsConnection" },
          ]);
        }
        return { data: { __type: { fields: [{ name: "body", type: { name: "String", kind: "SCALAR", ofType: null } }] } } };
      }
      if (url.includes("/grants")) {
        throw new Error("HTTP 500 Internal Server Error for " + url);
      }
      if (url.includes("/posts")) {
        return url.includes("_start=0")
          ? [{ id: 1, body: "[a](https://agency.icjia-api.cloud/uploads/a.pdf)" }]
          : [];
      }
      return [];
    };
    const result = await runTo("filecap-refs-b1-", fetcher, (m) => logs.push(m));
    expect(result.entriesProcessed).toBe(1);
    const summary = logs.find((l) => l.includes("sidecar records"));
    expect(summary).toContain("1/2 types failed");
    expect(logs.some((l) => l.includes("WARN") && l.includes("grants"))).toBe(true);
  });
});

// v1.39.0 (B4) — v4 single types end-to-end: an unpaired singular
// (homepage) is discovered as a single type, fetched at /api/homepage
// (object response normalized to one entry), and its body links land in
// the sidecar. Previously the whole type was silently dropped.
describe("runReferences (strapi-v4, single-type schema)", () => {
  const V4_SCHEMA_RESPONSE = {
    data: {
      __schema: {
        queryType: {
          fields: [
            { name: "uploadFile" },
            { name: "uploadFiles" },
            { name: "me" },
            { name: "post" },
            { name: "posts" },
            { name: "homepage" }, // single type — no plural partner
          ],
        },
      },
    },
  };
  const V4_TYPE_FIELDS = {
    Post: [
      { name: "slug", type: { name: "String", kind: "SCALAR", ofType: null } },
      { name: "body", type: { name: "String", kind: "SCALAR", ofType: null } },
    ],
    Homepage: [
      { name: "slug", type: { name: "String", kind: "SCALAR", ofType: null } },
      { name: "body", type: { name: "String", kind: "SCALAR", ofType: null } },
    ],
  };

  function v4Fetcher(url, init) {
    if (init?.body) {
      const { query } = JSON.parse(init.body);
      if (query.includes("__schema")) return Promise.resolve(V4_SCHEMA_RESPONSE);
      const m = query.match(/__type\(name: "(\w+)"\)/);
      return Promise.resolve({
        data: { __type: { fields: V4_TYPE_FIELDS[m[1]] ?? [] } },
      });
    }
    if (url.includes("/api/posts")) {
      const empty = !url.includes("pagination%5Bstart%5D=0");
      return Promise.resolve({
        data: empty
          ? []
          : [
              {
                id: 1,
                attributes: {
                  slug: "welcome",
                  body: "[a](https://dvfr.icjia-api.cloud/uploads/a.pdf)",
                },
              },
            ],
        meta: { pagination: { start: 0, limit: 100, total: 1 } },
      });
    }
    if (url.includes("/api/homepage")) {
      // single type: data is an OBJECT
      return Promise.resolve({
        data: {
          id: 7,
          attributes: {
            slug: "home",
            body: "Read [the plan](https://dvfr.icjia-api.cloud/uploads/plan.pdf).",
          },
        },
        meta: {},
      });
    }
    return Promise.resolve({ data: [], meta: {} });
  }

  it("fetches the single type and records its file references in the sidecar", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-refs-v4-"));
    const outputPath = path.join(tmp, "dvfr.refs.ndjson");
    const siteConfig = {
      name: "dvfr-prod",
      publicUrlBase: "https://dvfr.icjia-api.cloud/uploads",
      siteUrl: "https://dvfr.illinois.gov/",
      references: {
        strategy: "strapi-v4",
        graphqlEndpoint: "https://dvfr.icjia-api.cloud/graphql",
        restApiBase: "https://dvfr.icjia-api.cloud",
        siteFrontendUrl: "https://dvfr.illinois.gov",
        contentTypeRoutes: { post: "/posts/:slug/" },
      },
    };
    const sitesJson = { sites: [siteConfig] };

    await runReferences({
      siteConfig,
      sitesJson,
      outputPath,
      fetcher: v4Fetcher,
      log: () => {},
    });

    const records = (await fs.readFile(outputPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const home = records.find((r) => r.contentType === "homepage");
    expect(home).toBeDefined();
    expect(home.slug).toBe("home");
    expect(home.referencedFiles).toEqual([
      "https://dvfr.icjia-api.cloud/uploads/plan.pdf",
    ]);
    const post = records.find((r) => r.contentType === "post");
    expect(post.referencedFiles).toEqual([
      "https://dvfr.icjia-api.cloud/uploads/a.pdf",
    ]);

    await fs.rm(tmp, { recursive: true, force: true });
  });
});
