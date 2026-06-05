import { describe, it, expect } from "vitest";
import { generateSitesHtml } from "../src/web/sites-page.js";

const scannedEntry = {
  site: {
    name: "dvfr", siteName: "DVFR", siteFullName: "Domestic Violence Fatality Review",
    siteUrl: "https://dvfr.illinois.gov", host: "10.0.0.1",
  },
  header: { metadata: { serverIp: "10.0.0.1", hostname: "cms-01", scannedPath: "/uploads" } },
  accessKind: "strapi",
  image: "assets/og/dvfr.png",
  description: "Statewide fatality review.",
};

const unscannedEntry = {
  site: { name: "newsite", siteName: "New", siteFullName: "Brand New Site", siteUrl: "https://new.example.gov" },
  header: null,
  accessKind: "github",
  image: null,
  description: "",
};

const tool = {
  name: "squish", siteName: "Squish", siteFullName: "Squish — image compression",
  siteUrl: "https://squish.icjia.app", image: "assets/og/squish.png",
  description: "Bulk image compression", stack: "Nuxt 3",
};

// Everything after the <style> block is the rendered page body — used to assert
// that audit numbers never leak into the visible page (the reused INDEX_CSS has
// "may need audit" in a comment, which is invisible).
const body = (html) => html.slice(html.indexOf("</style>"));

describe("generateSitesHtml", () => {
  it("renders a roster card per content site with title, URL, description, og image", () => {
    const html = generateSitesHtml({ contentRoster: [scannedEntry], tools: [], sitesListXlsx: "sites-list.xlsx" });
    expect(html).toContain("Domestic Violence Fatality Review");
    expect(html).toContain("dvfr.illinois.gov");
    expect(html).toContain("Statewide fatality review.");
    expect(html).toContain('src="assets/og/dvfr.png"');
  });

  it("includes a scanned site's tech details (IP / hostname / path)", () => {
    const html = generateSitesHtml({ contentRoster: [scannedEntry], tools: [] });
    expect(html).toContain("10.0.0.1");
    expect(html).toContain("cms-01");
    expect(html).toContain("/uploads");
  });

  it("renders no audit numbers in the page body (no donut / 'may need audit' / total files)", () => {
    const b = body(generateSitesHtml({ contentRoster: [scannedEntry], tools: [tool] }));
    expect(b).not.toContain("may need audit");
    expect(b).not.toContain('class="donut"');
    expect(b).not.toContain("total files");
  });

  it("uses the ICJIA-logo fallback when a site has no og image", () => {
    const html = generateSitesHtml({ contentRoster: [unscannedEntry], tools: [] });
    expect(html).toContain("card-img-fallback");
  });

  it("an unscanned site shows no IP / scanned-path rows", () => {
    const html = generateSitesHtml({ contentRoster: [unscannedEntry], tools: [] });
    expect(html).not.toContain(">IP:<");
    expect(html).not.toContain(">Path:<");
  });

  it("renders a Tooling sites section with badge + stack", () => {
    const html = generateSitesHtml({ contentRoster: [scannedEntry], tools: [tool] });
    expect(html).toContain(">Tooling sites<");
    expect(html).toContain(">Tooling<");
    expect(html).toContain("Squish — image compression");
    expect(html).toContain("Nuxt 3");
  });

  it("omits the Tooling sites section when there are no tools", () => {
    const html = generateSitesHtml({ contentRoster: [scannedEntry], tools: [] });
    expect(html).not.toContain(">Tooling sites<");
  });

  it("leads with bold count-first hero stats", () => {
    const html = generateSitesHtml({ contentRoster: [scannedEntry, unscannedEntry], tools: [tool] });
    expect(html).toContain('<span class="n">2</span><span class="l">content sites</span>');
    expect(html).toContain('<span class="n">1</span><span class="l">tooling site</span>');
  });

  it("shows the XLSX download when provided and omits it otherwise", () => {
    const withX = generateSitesHtml({ contentRoster: [scannedEntry], tools: [], sitesListXlsx: "sites-list.xlsx" });
    expect(withX).toContain('href="sites-list.xlsx"');
    expect(withX).toContain("Download sites list");
    const without = generateSitesHtml({ contentRoster: [scannedEntry], tools: [] });
    expect(without).not.toContain("Download sites list");
  });

  it("relabels access chips by kind (Strapi CMS / GitHub)", () => {
    const html = generateSitesHtml({ contentRoster: [scannedEntry, unscannedEntry], tools: [] });
    expect(html).toContain("Strapi CMS");
    expect(html).toContain(">GitHub<");
  });

  it("provides nav back to the fleet snapshot (top + footer)", () => {
    const html = generateSitesHtml({ contentRoster: [scannedEntry], tools: [] });
    expect(html).toContain('href="index.html"');
    expect(html).toContain('href="accessibility.html"');
  });

  it("reuses the home page stylesheet (INDEX_CSS)", () => {
    const html = generateSitesHtml({ contentRoster: [scannedEntry], tools: [] });
    expect(html).toContain(".site-card {");
  });
});
