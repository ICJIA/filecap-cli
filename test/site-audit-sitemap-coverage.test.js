import { describe, it, expect } from "vitest";
import {
  classifyCandidate,
  findSitemapOmissions,
} from "../src/site-audit/sitemap-coverage.js";

// A probe returns what one HTTP request saw: the status, where a redirect
// pointed, and whether the delivered page asked not to be indexed.
const probeFor = (map) => async (url) => map[url] ?? { status: 200, indexable: true };

describe("classifyCandidate", () => {
  it("calls a 3xx retired — the site deliberately moved it", () => {
    expect(classifyCandidate({ status: 301, location: "/councils/" }).verdict).toBe("retired");
    expect(classifyCandidate({ status: 308 }).verdict).toBe("retired");
  });

  it("calls a noindex page deliberate, even at 200", () => {
    expect(classifyCandidate({ status: 200, indexable: false }).verdict).toBe("noindex");
  });

  it("calls a 4xx/5xx broken", () => {
    expect(classifyCandidate({ status: 404 }).verdict).toBe("broken");
    expect(classifyCandidate({ status: 500 }).verdict).toBe("broken");
  });

  it("calls an indexable 200 a genuine omission", () => {
    expect(classifyCandidate({ status: 200, indexable: true }).verdict).toBe("omission");
  });

  it("treats an unreachable probe as unknown, never as an omission", () => {
    expect(classifyCandidate({ status: null, error: "timeout" }).verdict).toBe("unknown");
  });

  it("carries the observed status through so a finding is checkable", () => {
    const c = classifyCandidate({ status: 301, location: "/x/" });
    expect(c.status).toBe(301);
    expect(c.location).toBe("/x/");
  });
});

describe("findSitemapOmissions", () => {
  const sitemap = ["https://x.gov/", "https://x.gov/about/"];

  it("probes only CMS pages missing from the sitemap", async () => {
    const probed = [];
    const probe = async (u) => { probed.push(u); return { status: 200, indexable: true }; };
    await findSitemapOmissions({
      sitemapUrls: sitemap,
      cmsPageUrls: ["https://x.gov/", "https://x.gov/about/", "https://x.gov/new/"],
      probe,
    });
    expect(probed).toEqual(["https://x.gov/new/"]);
  });

  it("ignores trailing-slash differences when matching against the sitemap", async () => {
    const probed = [];
    const probe = async (u) => { probed.push(u); return { status: 200, indexable: true }; };
    const r = await findSitemapOmissions({
      sitemapUrls: ["https://x.gov/about"],
      cmsPageUrls: ["https://x.gov/about/"],
      probe,
    });
    expect(probed).toEqual([]);
    expect(r.omissions).toEqual([]);
  });

  // The three real cases from the 2026-08-27 fleet review. Only the last is a
  // finding; the first two were reported as gaps by hand and were not.
  it("separates retired, noindex and genuine omissions", async () => {
    const r = await findSitemapOmissions({
      sitemapUrls: sitemap,
      cmsPageUrls: [
        "https://x.gov/counties/marshall/", // retired -> 301
        "https://x.gov/tabs/dv/",           // deliberate noindex
        "https://x.gov/datasets/a/",        // genuine omission
        "https://x.gov/news/gone/",         // broken
      ],
      probe: probeFor({
        "https://x.gov/counties/marshall/": { status: 301, location: "https://x.gov/councils/" },
        "https://x.gov/tabs/dv/": { status: 200, indexable: false },
        "https://x.gov/datasets/a/": { status: 200, indexable: true },
        "https://x.gov/news/gone/": { status: 404 },
      }),
    });
    expect(r.omissions.map((o) => o.url)).toEqual(["https://x.gov/datasets/a/"]);
    expect(r.retired.map((o) => o.url)).toEqual(["https://x.gov/counties/marshall/"]);
    expect(r.noindex.map((o) => o.url)).toEqual(["https://x.gov/tabs/dv/"]);
    expect(r.broken.map((o) => o.url)).toEqual(["https://x.gov/news/gone/"]);
    expect(r.probed).toBe(4);
  });

  it("caps how many URLs it probes and says how many it skipped", async () => {
    const cms = Array.from({ length: 50 }, (_, i) => `https://x.gov/p${i}/`);
    const r = await findSitemapOmissions({
      sitemapUrls: [],
      cmsPageUrls: cms,
      probe: probeFor({}),
      maxProbes: 10,
    });
    expect(r.probed).toBe(10);
    expect(r.skipped).toBe(40);
  });

  it("returns empty results when nothing is missing", async () => {
    const r = await findSitemapOmissions({
      sitemapUrls: sitemap,
      cmsPageUrls: sitemap,
      probe: probeFor({}),
    });
    expect(r.omissions).toEqual([]);
    expect(r.probed).toBe(0);
    expect(r.skipped).toBe(0);
  });

  it("survives a probe that throws — the URL becomes unknown, not a finding", async () => {
    const r = await findSitemapOmissions({
      sitemapUrls: [],
      cmsPageUrls: ["https://x.gov/boom/"],
      probe: async () => { throw new Error("ECONNRESET"); },
    });
    expect(r.omissions).toEqual([]);
    expect(r.unknown).toHaveLength(1);
    expect(r.unknown[0].error).toMatch(/ECONNRESET/);
  });

  it("tolerates junk input", async () => {
    const r = await findSitemapOmissions({ probe: probeFor({}) });
    expect(r.omissions).toEqual([]);
    expect(r.probed).toBe(0);
  });
});
