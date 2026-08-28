import { describe, it, expect } from "vitest";
import { siteEntrySchema, toolEntrySchema } from "../src/commands/web-rollup.js";

// FC-2026-030 (1.8.0-beta.3): the `references.graphqlEndpoint` and
// `references.restApiBase` fields must be http(s) URLs. Anything else is
// rejected at schema load time so a malicious or accidentally-misconfigured
// sites.json bundle can't redirect the references command at file://,
// javascript:, or bare-host SSRF targets.

const validRefs = (overrides = {}) => ({
  strategy: "strapi-v4",
  graphqlEndpoint: "https://api.example.com/graphql",
  restApiBase: "https://api.example.com",
  ...overrides,
});

const validSite = (refsOverrides = {}) => ({
  name: "test-site",
  publicUrlBase: "https://api.example.com/uploads",
  references: validRefs(refsOverrides),
});

describe("siteEntrySchema references endpoint URL validation (FC-2026-030)", () => {
  it("accepts https:// for graphqlEndpoint + restApiBase", () => {
    expect(() => siteEntrySchema.parse(validSite())).not.toThrow();
  });

  it("accepts http:// for graphqlEndpoint + restApiBase (legacy / internal)", () => {
    expect(() => siteEntrySchema.parse(validSite({
      graphqlEndpoint: "http://internal-strapi.local/graphql",
      restApiBase: "http://internal-strapi.local",
    }))).not.toThrow();
  });

  it("rejects file:// in graphqlEndpoint", () => {
    expect(() => siteEntrySchema.parse(validSite({
      graphqlEndpoint: "file:///etc/passwd",
    }))).toThrow(/graphqlEndpoint/);
  });

  it("rejects javascript: in graphqlEndpoint", () => {
    expect(() => siteEntrySchema.parse(validSite({
      graphqlEndpoint: "javascript:alert(1)",
    }))).toThrow(/graphqlEndpoint/);
  });

  it("rejects bare host (no scheme) in graphqlEndpoint", () => {
    expect(() => siteEntrySchema.parse(validSite({
      graphqlEndpoint: "localhost:8080/graphql",
    }))).toThrow(/graphqlEndpoint/);
  });

  it("rejects file:// in restApiBase", () => {
    expect(() => siteEntrySchema.parse(validSite({
      restApiBase: "file:///",
    }))).toThrow(/restApiBase/);
  });

  it("rejects ws:// (non-http(s)) in restApiBase", () => {
    expect(() => siteEntrySchema.parse(validSite({
      restApiBase: "ws://api.example.com",
    }))).toThrow(/restApiBase/);
  });

  it("rejects malformed URL in graphqlEndpoint", () => {
    expect(() => siteEntrySchema.parse(validSite({
      graphqlEndpoint: "not a url at all",
    }))).toThrow(/graphqlEndpoint/);
  });

  it("accepts a fully-valid v3 references block too", () => {
    expect(() =>
      siteEntrySchema.parse(validSite({ strategy: "strapi-v3" })),
    ).not.toThrow();
  });
});

describe("siteEntrySchema v1.21.0 — optional description + image", () => {
  it("accepts optional description and image overrides", () => {
    expect(() => siteEntrySchema.parse({ name: "s", description: "A site.", image: "https://x/og.png" })).not.toThrow();
  });
});

describe("toolEntrySchema (v1.21.0)", () => {
  const valid = (o = {}) => ({ name: "squish", siteUrl: "https://squish.icjia.app", ...o });

  it("accepts a minimal tool (name + http siteUrl)", () => {
    expect(() => toolEntrySchema.parse(valid())).not.toThrow();
  });
  it("accepts optional siteName / siteFullName / description / stack / image", () => {
    expect(() => toolEntrySchema.parse(valid({
      siteName: "Squish", siteFullName: "Squish — image compression",
      description: "Bulk image compression", stack: "Nuxt 3", image: "https://x/og.png",
    }))).not.toThrow();
  });
  it("requires siteUrl", () => {
    expect(() => toolEntrySchema.parse({ name: "squish" })).toThrow();
  });
  it("rejects a non-http(s) siteUrl", () => {
    expect(() => toolEntrySchema.parse(valid({ siteUrl: "ftp://x" }))).toThrow(/siteUrl/);
  });
  it("rejects a bad name slug", () => {
    expect(() => toolEntrySchema.parse(valid({ name: "Bad Name" }))).toThrow(/slug/);
  });
  it("rejects unknown keys (strict)", () => {
    expect(() => toolEntrySchema.parse(valid({ bogus: 1 }))).toThrow();
  });
});

describe("siteEntrySchema per-site page cap (maxNewPages)", () => {
  const base = { name: "test-site", publicUrlBase: "https://api.example.com/uploads" };
  it("accepts an optional positive-integer maxNewPages (and stays optional)", () => {
    expect(() => siteEntrySchema.parse({ ...base, maxNewPages: 150 })).not.toThrow();
    expect(() => siteEntrySchema.parse(base)).not.toThrow();
  });
  it("rejects a zero, negative, or fractional maxNewPages", () => {
    expect(() => siteEntrySchema.parse({ ...base, maxNewPages: 0 })).toThrow();
    expect(() => siteEntrySchema.parse({ ...base, maxNewPages: -10 })).toThrow();
    expect(() => siteEntrySchema.parse({ ...base, maxNewPages: 1.5 })).toThrow();
  });
});

// v1.69.0 — a roster entry can carry `excluded: true` (plus an optional
// human-readable `excludedReason`) to pull the site out of the published
// audit — fleet totals, hero score, Websites section, per-site report —
// while keeping the entry and its scan cache intact so the site can return
// by deleting one line. The /sites directory still lists it as unaudited.
describe("siteEntrySchema roster exclusion (v1.69.0 — excluded / excludedReason)", () => {
  const base = { name: "archive-prod", publicUrlBase: "https://archive.example.com/files" };

  it("accepts excluded: true with an excludedReason (both stay optional)", () => {
    expect(() => siteEntrySchema.parse({ ...base, excluded: true, excludedReason: "content in flux" })).not.toThrow();
    expect(() => siteEntrySchema.parse({ ...base, excluded: false })).not.toThrow();
    expect(() => siteEntrySchema.parse(base)).not.toThrow();
  });

  it("rejects a non-boolean excluded", () => {
    expect(() => siteEntrySchema.parse({ ...base, excluded: "yes" })).toThrow();
  });

  it("rejects a non-string excludedReason", () => {
    expect(() => siteEntrySchema.parse({ ...base, excludedReason: 7 })).toThrow();
  });
});

// v1.65.0 — contentTypeRoutes accepts a multi-segment object form alongside
// the flat string form, so a front end that nests detail pages under a
// category segment can be described accurately (ARI meetings).
describe("siteEntrySchema contentTypeRoutes (v1.65.0 multi-segment routes)", () => {
  it("accepts the flat string form", () => {
    expect(() => siteEntrySchema.parse(validSite({
      contentTypeRoutes: { post: "/news/:slug/" },
    }))).not.toThrow();
  });

  it("accepts the object form with a segments map", () => {
    expect(() => siteEntrySchema.parse(validSite({
      contentTypeRoutes: {
        meeting: {
          route: "/about/meetings/:category/:slug",
          segments: { category: { regular: "regular-oversight" } },
        },
      },
    }))).not.toThrow();
  });

  it("accepts the object form without segments", () => {
    expect(() => siteEntrySchema.parse(validSite({
      contentTypeRoutes: { resource: { route: "/resources/:category/:slug" } },
    }))).not.toThrow();
  });

  it("accepts both forms side by side", () => {
    expect(() => siteEntrySchema.parse(validSite({
      contentTypeRoutes: {
        post: "/news/:slug/",
        meeting: { route: "/about/meetings/:category/:slug" },
      },
    }))).not.toThrow();
  });

  it("rejects an object form missing `route`", () => {
    expect(() => siteEntrySchema.parse(validSite({
      contentTypeRoutes: { meeting: { segments: {} } },
    }))).toThrow();
  });

  it("rejects a non-string segment mapping value", () => {
    expect(() => siteEntrySchema.parse(validSite({
      contentTypeRoutes: {
        meeting: { route: "/m/:category/:slug", segments: { category: { regular: 7 } } },
      },
    }))).toThrow();
  });

  it("rejects an unknown key in the object form", () => {
    expect(() => siteEntrySchema.parse(validSite({
      contentTypeRoutes: { meeting: { route: "/m/:slug", bogus: true } },
    }))).toThrow();
  });
});
