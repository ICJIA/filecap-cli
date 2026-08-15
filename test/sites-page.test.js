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

  it("shows a scanned site's hostname (distinct from IP); drops IP + path (v1.21.2)", () => {
    const html = generateSitesHtml({ contentRoster: [scannedEntry], tools: [] });
    expect(html).toContain("cms-01");        // hostname (!= IP) shown
    expect(html).not.toContain("10.0.0.1");  // origin IP dropped
    expect(html).not.toContain("/uploads");  // scanned path dropped
  });

  describe("content-sites lede vs audited count (v1.40.0)", () => {
    const roster3 = [scannedEntry, { ...scannedEntry, site: { ...scannedEntry.site, name: "b-prod", siteName: "B" } }, { ...scannedEntry, site: { ...scannedEntry.site, name: "c-prod", siteName: "C" } }];

    it("distinguishes directory size from the audited count instead of over-claiming", () => {
      const html = generateSitesHtml({ contentRoster: roster3, tools: [], auditedCount: 2 });
      expect(html).toContain("The 3 ICJIA content sites &mdash; 2 of them under file accessibility audit.");
      expect(html).not.toContain("3 ICJIA websites under accessibility audit");
    });

    it("says 'all' when every directory site is audited", () => {
      const html = generateSitesHtml({ contentRoster: roster3, tools: [], auditedCount: 3 });
      expect(html).toContain("The 3 ICJIA content sites, all under file accessibility audit.");
    });

    it("makes no audited-count claim when the count is not provided", () => {
      const html = generateSitesHtml({ contentRoster: roster3, tools: [] });
      expect(html).toContain("The 3 ICJIA content sites.");
      expect(html).not.toContain("under file accessibility audit");
      expect(html).not.toContain("websites under accessibility audit");
    });
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
    expect(withX).toContain("All content and tooling sites");
    const without = generateSitesHtml({ contentRoster: [scannedEntry], tools: [] });
    expect(without).not.toContain("All content and tooling sites");
    expect(body(without)).not.toContain("roster-download-btn");
  });

  it("v1.28.0 — renders all three workbook download buttons when filenames are provided", () => {
    const html = generateSitesHtml({
      contentRoster: [scannedEntry],
      tools: [tool],
      sitesListXlsx: "sites-list.xlsx",
      contentSitesXlsx: "sites-list-content.xlsx",
      toolingSitesXlsx: "sites-list-tools.xlsx",
    });
    expect(html).toContain('href="sites-list.xlsx"');
    expect(html).toContain("All content and tooling sites");
    expect(html).toContain('href="sites-list-content.xlsx"');
    expect(html).toContain("Content sites only");
    expect(html).toContain('href="sites-list-tools.xlsx"');
    expect(html).toContain("Tooling sites only");
  });

  it("v1.28.0 — omits the content-only / tooling-only buttons when their filenames are absent", () => {
    const html = generateSitesHtml({ contentRoster: [scannedEntry], tools: [], sitesListXlsx: "sites-list.xlsx" });
    expect(html).toContain("All content and tooling sites");
    expect(html).not.toContain("Content sites only");
    expect(html).not.toContain("Tooling sites only");
  });

  // v1.42.0 — per-card file-audit workbook download. The card click still goes
  // to the live site; the button is an additive download for <slug>.xlsx.
  describe("per-card file-audit download (v1.42.0)", () => {
    const auditedEntry = { ...scannedEntry, csvFile: "dvfr.xlsx" };

    it("renders an icon download button when the entry has a workbook", () => {
      const html = generateSitesHtml({ contentRoster: [auditedEntry], tools: [] });
      expect(html).toContain('class="roster-card-dl"');
      expect(html).toContain('href="dvfr.xlsx" download');
      expect(html).toContain("File audit (.xlsx)");
      expect(html).toContain('aria-label="Download the file audit spreadsheet for Domestic Violence Fatality Review (XLSX)"');
    });

    it("keeps the card's stretched link pointed at the live site", () => {
      const html = generateSitesHtml({ contentRoster: [auditedEntry], tools: [] });
      expect(html).toContain('href="https://dvfr.illinois.gov"');
    });

    it("renders no download button for entries without a workbook (unscanned / tooling)", () => {
      const html = generateSitesHtml({ contentRoster: [unscannedEntry], tools: [tool] });
      expect(body(html)).not.toContain("roster-card-dl");
    });
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

  // v1.39.0 (E10) — roster-card image alt text escaped exactly once (the
  // caller used to pass a pre-escaped name into renderCardImage, which
  // escapes internally → double escape).
  it("escapes the roster card image alt exactly once (v1.39.0)", () => {
    const gnarly = {
      ...scannedEntry,
      site: { ...scannedEntry.site, siteFullName: "Theft & Insurance <Council>" },
    };
    const html = generateSitesHtml({ contentRoster: [gnarly], tools: [] });
    expect(html).toContain('alt="Theft &amp; Insurance &lt;Council&gt;"');
    expect(html).not.toContain("&amp;amp;");
    expect(html).not.toContain("&amp;lt;");
  });

  it("escapes the roster fallback tile aria-label exactly once (v1.39.0)", () => {
    const gnarly = {
      ...unscannedEntry,
      site: { ...unscannedEntry.site, siteFullName: "A & B <C>" },
    };
    const html = generateSitesHtml({ contentRoster: [gnarly], tools: [] });
    expect(html).toContain('aria-label="A &amp; B &lt;C&gt;"');
    expect(html).not.toContain("&amp;amp;");
  });
});

describe("meta description (v1.40.0)", () => {
  it("ships a description for the site directory", () => {
    const html = generateSitesHtml({ contentRoster: [], tools: [] });
    expect(html).toMatch(/<meta name="description" content="[^"]{40,}"/);
  });
});
