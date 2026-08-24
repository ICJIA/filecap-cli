import { describe, it, expect } from "vitest";
import {
  parseSitemapXml,
  scopeSitemapUrlsToSite,
  fetchSitemapUrls,
} from "../src/references/sitemap.js";

describe("parseSitemapXml", () => {
  it("extracts page URLs from a <urlset>", () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>https://x/a/</loc></url>
      <url><loc>https://x/b/</loc></url>
    </urlset>`;
    expect(parseSitemapXml(xml).pageUrls).toEqual(["https://x/a/", "https://x/b/"]);
  });

  it("handles a single-URL urlset (parser yields an object, not an array)", () => {
    const xml = `<urlset><url><loc>https://x/only/</loc></url></urlset>`;
    expect(parseSitemapXml(xml).pageUrls).toEqual(["https://x/only/"]);
  });

  it("extracts sub-sitemaps from a <sitemapindex>", () => {
    const xml = `<sitemapindex>
      <sitemap><loc>https://x/sitemap-1.xml</loc></sitemap>
      <sitemap><loc>https://x/sitemap-2.xml</loc></sitemap>
    </sitemapindex>`;
    expect(parseSitemapXml(xml).subSitemaps).toEqual([
      "https://x/sitemap-1.xml",
      "https://x/sitemap-2.xml",
    ]);
  });

  it("returns empty arrays for malformed or empty input", () => {
    expect(parseSitemapXml("not xml at all")).toEqual({ pageUrls: [], subSitemaps: [] });
    expect(parseSitemapXml("")).toEqual({ pageUrls: [], subSitemaps: [] });
    expect(parseSitemapXml(null)).toEqual({ pageUrls: [], subSitemaps: [] });
  });
});

describe("scopeSitemapUrlsToSite", () => {
  it("keeps every URL when the site sits at the domain root", () => {
    const urls = ["https://x.gov/a", "https://x.gov/b/c"];
    expect(scopeSitemapUrlsToSite(urls, "https://x.gov/")).toEqual(urls);
  });

  it("keeps only the URLs under the site's path prefix", () => {
    const urls = [
      "https://icjia.illinois.gov/researchhub",
      "https://icjia.illinois.gov/researchhub/articles/foo",
      "https://icjia.illinois.gov/news/bar",
      "https://icjia.illinois.gov/researchhubextra",
    ];
    expect(
      scopeSitemapUrlsToSite(urls, "https://icjia.illinois.gov/researchhub/"),
    ).toEqual([
      "https://icjia.illinois.gov/researchhub",
      "https://icjia.illinois.gov/researchhub/articles/foo",
    ]);
  });

  it("keeps every URL when siteUrl yields no usable path", () => {
    const urls = ["https://x.gov/a", "https://x.gov/b"];
    expect(scopeSitemapUrlsToSite(urls, null)).toEqual(urls);
    expect(scopeSitemapUrlsToSite(urls, "not a url")).toEqual(urls);
  });
});

describe("fetchSitemapUrls — SSRF guard", () => {
  // A malicious/compromised fleet site can return a <sitemapindex> whose
  // sub-sitemap <loc> points at an internal address; the recursive fetch must
  // refuse it rather than probe cloud metadata / a local service.
  it("does not fetch a sub-sitemap <loc> that targets a private/metadata address", async () => {
    const requested = [];
    const responses = {
      "https://site.gov/sitemap.xml": `<sitemapindex>
        <sitemap><loc>https://site.gov/sub-1.xml</loc></sitemap>
        <sitemap><loc>http://169.254.169.254/latest/meta-data/</loc></sitemap>
      </sitemapindex>`,
      "https://site.gov/sub-1.xml": `<urlset><url><loc>https://site.gov/a</loc></url></urlset>`,
    };
    const fetchImpl = async (url) => {
      requested.push(url);
      const body = responses[url];
      if (body === undefined) return { ok: false, text: async () => "" };
      return { ok: true, text: async () => body };
    };

    const urls = await fetchSitemapUrls("https://site.gov/sitemap.xml", 0, { fetchImpl });

    expect(urls).toContain("https://site.gov/a");
    expect(requested).toContain("https://site.gov/sub-1.xml");
    expect(requested).not.toContain("http://169.254.169.254/latest/meta-data/");
  });
});
