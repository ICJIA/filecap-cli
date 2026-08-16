import { describe, it, expect } from "vitest";
import { generateSearchHtml } from "../src/web/search-page.js";
import { SEARCH_INDEX_FILENAME } from "../src/web/search-index.js";

// The /search page shell. The matcher and the xlsx builder have their own
// suites — this one pins the page contract: the input, the chips, the
// results region, the embedded client sources, and the bundle wiring
// (fetching search-index.json, nav, footer, noindex).

function page(overrides = {}) {
  return generateSearchHtml({
    generatedAt: "August 16, 2026, 8:21 AM CDT",
    totalFiles: 8787,
    siteCount: 12,
    ...overrides,
  });
}

describe("generateSearchHtml", () => {
  it("is a full standalone document", () => {
    const html = page();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('name="robots" content="noindex, nofollow"');
    expect(html).toMatch(/<title>Search[^<]*<\/title>/);
  });

  it("renders the search input and the live results regions", () => {
    const html = page();
    expect(html).toContain('id="search-input"');
    expect(html).toContain('type="search"');
    expect(html).toContain('id="category-chips"');
    expect(html).toContain('id="search-results"');
    expect(html).toContain('aria-live="polite"');
  });

  it("fetches the search index artifact by its shared name", () => {
    expect(page()).toContain(SEARCH_INDEX_FILENAME);
  });

  it("embeds the tested matcher and workbook sources inline", () => {
    const html = page();
    expect(html).toContain("function runSearch");
    expect(html).toContain("function buildHaystack");
    expect(html).toContain("function buildSearchWorkbook");
    expect(html).toContain("function xlsxDownloadName");
  });

  it("offers the results download button", () => {
    expect(page()).toContain('id="download-xlsx"');
  });

  it("advertises the fleet totals in the lede", () => {
    const html = page();
    expect(html).toContain("8,787");
    expect(html).toContain("12");
  });

  it("carries the standard nav and footer", () => {
    const html = page();
    expect(html).toContain('href="index.html"');
    expect(html).toContain('href="sites.html"');
    expect(html).toContain("site-footer");
  });

  it("builds absolute audit-report URLs from the deployed bundle URL", () => {
    expect(page()).toContain("https://icjia-fleet-audit.netlify.app");
  });

  it("threads the generated-at stamp", () => {
    expect(page()).toContain("August 16, 2026, 8:21 AM CDT");
  });
});
