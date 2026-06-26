import { describe, it, expect } from "vitest";
import { resolveSitePageSet } from "../src/site-audit/page-set.js";

describe("resolveSitePageSet", () => {
  it("unions sitemap + CMS pages, deduped by normalized URL", async () => {
    const fetchSitemap = async (url) =>
      url === "https://x.com/sitemap.xml" ? ["https://x.com/", "https://x.com/about"] : [];
    const cmsNdjson = [
      JSON.stringify({ pageUrl: "https://x.com/About/", contentType: "page" }), // dup of /about
      JSON.stringify({ pageUrl: "https://x.com/news", contentType: "article" }),
    ].join("\n");
    const { sitemapUrls, pageSet } = await resolveSitePageSet({
      site: { siteUrl: "https://x.com/" },
      cmsNdjson,
      fetchSitemap,
    });
    expect(sitemapUrls).toEqual(["https://x.com/", "https://x.com/about"]);
    expect(pageSet).toEqual(["https://x.com/", "https://x.com/about", "https://x.com/news"]);
  });

  it("returns an empty set when there is no sitemap and no CMS data", async () => {
    const { pageSet } = await resolveSitePageSet({
      site: { siteUrl: "https://x.com/" },
      cmsNdjson: "",
      fetchSitemap: async () => [],
    });
    expect(pageSet).toEqual([]);
  });
});
