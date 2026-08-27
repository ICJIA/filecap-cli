import { describe, it, expect } from "vitest";
import { pageRoute } from "../src/report/page-route.js";

const ARI = "https://icjia.illinois.gov/adultredeploy/";

describe("pageRoute", () => {
  it("returns the site-relative parent path of a detail page", () => {
    expect(
      pageRoute(
        "https://icjia.illinois.gov/adultredeploy/about/meetings/regular-oversight/ariob-meeting-2026-3",
        ARI,
      ),
    ).toBe("/about/meetings/regular-oversight/");
  });

  it("collapses a flat detail page to its one-segment route", () => {
    expect(pageRoute("https://icjia.illinois.gov/adultredeploy/news/ari-10-years", ARI)).toBe(
      "/news/",
    );
  });

  it("treats a section index as living in its parent route", () => {
    expect(pageRoute("https://icjia.illinois.gov/adultredeploy/about/meetings", ARI)).toBe(
      "/about/",
    );
  });

  it("maps the site root to /", () => {
    expect(pageRoute("https://icjia.illinois.gov/adultredeploy", ARI)).toBe("/");
    expect(pageRoute("https://icjia.illinois.gov/adultredeploy/", ARI)).toBe("/");
  });

  it("maps a top-level page to /", () => {
    expect(pageRoute("https://icjia.illinois.gov/adultredeploy/grants", ARI)).toBe("/");
  });

  it("ignores a trailing slash on the page URL", () => {
    expect(pageRoute("https://icjia.illinois.gov/adultredeploy/about/craig-findley/", ARI)).toBe(
      "/about/",
    );
  });

  it("matches the site prefix case-insensitively", () => {
    expect(pageRoute("https://icjia.illinois.gov/AdultRedeploy/About/Staff", ARI)).toBe("/About/");
  });

  it("handles a root-hosted site (no path prefix)", () => {
    const site = "https://dvfr.illinois.gov/";
    expect(pageRoute("https://dvfr.illinois.gov/meetings/2026-q1", site)).toBe("/meetings/");
    expect(pageRoute("https://dvfr.illinois.gov/about", site)).toBe("/");
    expect(pageRoute("https://dvfr.illinois.gov/", site)).toBe("/");
  });

  it("keeps the full path when the URL sits outside the site prefix", () => {
    expect(pageRoute("https://icjia.illinois.gov/researchhub/articles/x", ARI)).toBe(
      "/researchhub/articles/",
    );
  });

  it("does not treat a prefix that is only a partial segment match as a prefix", () => {
    expect(pageRoute("https://icjia.illinois.gov/adultredeployXX/news/a", ARI)).toBe(
      "/adultredeployXX/news/",
    );
  });

  it("ignores query strings and fragments", () => {
    expect(
      pageRoute("https://icjia.illinois.gov/adultredeploy/news/a-post?x=1#top", ARI),
    ).toBe("/news/");
  });

  it("works with no siteUrl given", () => {
    expect(pageRoute("https://x.gov/a/b/c")).toBe("/a/b/");
  });

  it("returns an empty string for junk input rather than throwing", () => {
    expect(pageRoute("")).toBe("");
    expect(pageRoute(null)).toBe("");
    expect(pageRoute("not a url")).toBe("");
    expect(pageRoute(undefined, ARI)).toBe("");
  });

  it("tolerates an unparseable siteUrl by skipping prefix stripping", () => {
    expect(pageRoute("https://x.gov/a/b", "nonsense")).toBe("/a/");
  });
});
