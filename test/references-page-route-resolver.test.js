import { describe, it, expect } from "vitest";
import { resolvePageUrl } from "../src/references/page-route-resolver.js";

// v3 entries are flat; v4 nests everything under `attributes`.
const v3 = (fields) => ({ id: 1, ...fields });
const v4 = (fields) => ({ id: 1, attributes: { ...fields } });

describe("resolvePageUrl — flat string routes (pre-1.65 form)", () => {
  const base = "https://icjia.illinois.gov";

  it("fills :slug from a v3 entry", () => {
    expect(
      resolvePageUrl({
        contentType: "post",
        entry: v3({ slug: "ari-10-years" }),
        siteFrontendUrl: base,
        contentTypeRoutes: { post: "/adultredeploy/news/:slug/" },
      }),
    ).toBe("https://icjia.illinois.gov/adultredeploy/news/ari-10-years/");
  });

  it("fills :slug from a v4 entry's attributes", () => {
    expect(
      resolvePageUrl({
        contentType: "post",
        entry: v4({ slug: "hello" }),
        isV4: true,
        siteFrontendUrl: base,
        contentTypeRoutes: { post: "/news/:slug" },
      }),
    ).toBe("https://icjia.illinois.gov/news/hello");
  });

  it("returns null when the content type has no route", () => {
    expect(
      resolvePageUrl({
        contentType: "policy",
        entry: v3({ slug: "conflict-of-interest" }),
        siteFrontendUrl: base,
        contentTypeRoutes: { post: "/news/:slug/" },
      }),
    ).toBeNull();
  });

  it("returns null when the entry has no slug", () => {
    expect(
      resolvePageUrl({
        contentType: "post",
        entry: v3({ slug: null }),
        siteFrontendUrl: base,
        contentTypeRoutes: { post: "/news/:slug/" },
      }),
    ).toBeNull();
  });

  it("returns null when no frontend base is configured", () => {
    expect(
      resolvePageUrl({
        contentType: "post",
        entry: v3({ slug: "x" }),
        siteFrontendUrl: "",
        contentTypeRoutes: { post: "/news/:slug/" },
      }),
    ).toBeNull();
  });

  it("percent-encodes the slug and strips a trailing slash from the base", () => {
    expect(
      resolvePageUrl({
        contentType: "post",
        entry: v3({ slug: "a b/c" }),
        siteFrontendUrl: "https://x.gov///",
        contentTypeRoutes: { post: "/news/:slug/" },
      }),
    ).toBe("https://x.gov/news/a%20b%2Fc/");
  });
});

describe("resolvePageUrl — multi-segment routes (v1.65.0)", () => {
  const base = "https://icjia.illinois.gov";
  // ARI's real shape: meetings live under a committee segment derived from
  // the entry's `category` field, which does not match the URL segment
  // verbatim (category "regular" renders as "regular-oversight").
  const ariMeeting = {
    route: "/adultredeploy/about/meetings/:category/:slug",
    segments: {
      category: {
        regular: "regular-oversight",
        outreach: "outreach",
        performance: "performance",
        siteSelection: "site-selection",
        adHoc: "ad-hoc",
      },
    },
  };

  it("resolves a mapped category segment", () => {
    expect(
      resolvePageUrl({
        contentType: "meeting",
        entry: v3({ slug: "ariob-meeting-2026-3", category: "regular" }),
        siteFrontendUrl: base,
        contentTypeRoutes: { meeting: ariMeeting },
      }),
    ).toBe(
      "https://icjia.illinois.gov/adultredeploy/about/meetings/regular-oversight/ariob-meeting-2026-3",
    );
  });

  it("resolves a camelCase category through the segment map", () => {
    expect(
      resolvePageUrl({
        contentType: "meeting",
        entry: v3({ slug: "ari-ssc-meeting-01142021", category: "siteSelection" }),
        siteFrontendUrl: base,
        contentTypeRoutes: { meeting: ariMeeting },
      }),
    ).toBe(
      "https://icjia.illinois.gov/adultredeploy/about/meetings/site-selection/ari-ssc-meeting-01142021",
    );
  });

  it("uses the raw field value when no segment map entry exists", () => {
    expect(
      resolvePageUrl({
        contentType: "resource",
        entry: v3({ slug: "annual-report-2018", category: "annual-report" }),
        siteFrontendUrl: base,
        contentTypeRoutes: { resource: { route: "/adultredeploy/resources/:category/:slug" } },
      }),
    ).toBe(
      "https://icjia.illinois.gov/adultredeploy/resources/annual-report/annual-report-2018",
    );
  });

  it("reads segment fields from a v4 entry's attributes", () => {
    expect(
      resolvePageUrl({
        contentType: "meeting",
        entry: v4({ slug: "m1", category: "regular" }),
        isV4: true,
        siteFrontendUrl: base,
        contentTypeRoutes: { meeting: ariMeeting },
      }),
    ).toBe("https://icjia.illinois.gov/adultredeploy/about/meetings/regular-oversight/m1");
  });

  it("returns null — never a broken URL — when a segment field is missing", () => {
    expect(
      resolvePageUrl({
        contentType: "meeting",
        entry: v3({ slug: "orphan-meeting" }),
        siteFrontendUrl: base,
        contentTypeRoutes: { meeting: ariMeeting },
      }),
    ).toBeNull();
  });

  it("returns null when a segment field is present but empty", () => {
    expect(
      resolvePageUrl({
        contentType: "meeting",
        entry: v3({ slug: "m", category: "" }),
        siteFrontendUrl: base,
        contentTypeRoutes: { meeting: ariMeeting },
      }),
    ).toBeNull();
  });

  it("accepts the object form with no extra tokens (equivalent to the string form)", () => {
    expect(
      resolvePageUrl({
        contentType: "page",
        entry: v3({ slug: "overview" }),
        siteFrontendUrl: base,
        contentTypeRoutes: { page: { route: "/adultredeploy/about/:slug/" } },
      }),
    ).toBe("https://icjia.illinois.gov/adultredeploy/about/overview/");
  });

  it("reads a nested segment field via dotted path (v3 relation)", () => {
    expect(
      resolvePageUrl({
        contentType: "meeting",
        entry: v3({ slug: "m", committee: { slug: "outreach" } }),
        siteFrontendUrl: base,
        contentTypeRoutes: {
          meeting: { route: "/meetings/:committee.slug/:slug" },
        },
      }),
    ).toBe("https://icjia.illinois.gov/meetings/outreach/m");
  });

  it("percent-encodes a segment value that contains a slash", () => {
    expect(
      resolvePageUrl({
        contentType: "x",
        entry: v3({ slug: "s", category: "a/b" }),
        siteFrontendUrl: base,
        contentTypeRoutes: { x: { route: "/:category/:slug" } },
      }),
    ).toBe("https://icjia.illinois.gov/a%2Fb/s");
  });

  it("returns null for a malformed route object", () => {
    expect(
      resolvePageUrl({
        contentType: "x",
        entry: v3({ slug: "s" }),
        siteFrontendUrl: base,
        contentTypeRoutes: { x: { segments: {} } },
      }),
    ).toBeNull();
  });

  it("returns null for junk input rather than throwing", () => {
    expect(resolvePageUrl({})).toBeNull();
    expect(
      resolvePageUrl({ contentType: "x", entry: null, siteFrontendUrl: base, contentTypeRoutes: { x: "/:slug" } }),
    ).toBeNull();
  });
});

// v1.65.0 — Strapi v3 has no draft/publish system; ARI and the other v3 sites
// use a plain `isPublished` boolean that the front end honours by not
// rendering a route at all. Resolving a URL for an unpublished entry produces
// a confident link to a 404. (v4 needs no equivalent: its REST API already
// omits drafts unless publicationState=preview is asked for.)
describe("resolvePageUrl — unpublished v3 entries", () => {
  const base = "https://icjia.illinois.gov";
  const routes = { biography: "/adultredeploy/about/biographies/:slug" };

  it("returns null for an entry flagged isPublished:false", () => {
    expect(
      resolvePageUrl({
        contentType: "biography",
        entry: v3({ slug: "craig-findley", isPublished: false }),
        siteFrontendUrl: base,
        contentTypeRoutes: routes,
      }),
    ).toBeNull();
  });

  it("resolves normally when isPublished is true", () => {
    expect(
      resolvePageUrl({
        contentType: "biography",
        entry: v3({ slug: "emily-cole", isPublished: true }),
        siteFrontendUrl: base,
        contentTypeRoutes: routes,
      }),
    ).toBe("https://icjia.illinois.gov/adultredeploy/about/biographies/emily-cole");
  });

  it("resolves normally when the entry has no isPublished field at all", () => {
    expect(
      resolvePageUrl({
        contentType: "biography",
        entry: v3({ slug: "emily-cole" }),
        siteFrontendUrl: base,
        contentTypeRoutes: routes,
      }),
    ).toBe("https://icjia.illinois.gov/adultredeploy/about/biographies/emily-cole");
  });

  it("only treats an explicit false as unpublished, not a falsy near-miss", () => {
    for (const v of [0, "", "false", null, undefined]) {
      expect(
        resolvePageUrl({
          contentType: "biography",
          entry: v3({ slug: "s", isPublished: v }),
          siteFrontendUrl: base,
          contentTypeRoutes: routes,
        }),
      ).toBe("https://icjia.illinois.gov/adultredeploy/about/biographies/s");
    }
  });

  it("honours isPublished:false inside a v4 entry's attributes too", () => {
    expect(
      resolvePageUrl({
        contentType: "biography",
        entry: v4({ slug: "s", isPublished: false }),
        isV4: true,
        siteFrontendUrl: base,
        contentTypeRoutes: routes,
      }),
    ).toBeNull();
  });
});
