import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
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
