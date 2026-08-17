import { describe, it, expect } from "vitest";
import vm from "node:vm";
import { generateSearchHtml } from "../src/web/search-page.js";
import { SEARCH_INDEX_FILENAME } from "../src/web/search-index.js";
import { SEARCH_REPORT_STORAGE_KEY } from "../src/web/search-report.js";

// The /search page shell. The matcher and the xlsx builder have their own
// suites — this one pins the page contract: the input, the chips, the
// results region, the embedded client sources, and the bundle wiring
// (fetching search-index.json, nav, footer, noindex).

function page(overrides = {}) {
  return generateSearchHtml({
    generatedAt: "August 16, 2026, 8:21 AM CDT",
    totalFiles: 8762,
    siteCount: 12,
    remediableFiles: 4628,
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
    expect(html).toContain("8,762");
    expect(html).toContain("12");
  });

  // v1.47.1 — the total must be QUALIFIED against the remediation list
  // (v1.44.1 lesson: an unqualified count above other surfaces invites
  // "which is it?"). 8,762 = everything inventoried; 4,628 = the
  // remediation list. Both appear, reconciled in one sentence.
  it("qualifies the inventoried total against the remediation list", () => {
    const html = page();
    expect(html).toContain("4,628");
    expect(html).toContain("remediation list");
    expect(html).toMatch(/every file the scan sees/);
  });

  it("pluralizes the remediation-list phrasing", () => {
    expect(page({ remediableFiles: 1 })).toContain("1 document on the remediation list");
    expect(page()).toContain("4,628 documents on the remediation list");
  });

  it("carries the standard nav and footer", () => {
    const html = page();
    expect(html).toContain('href="index.html"');
    expect(html).toContain('href="sites.html"');
    expect(html).toContain("site-footer");
  });

  it("builds absolute audit-report URLs from the deployed bundle URL", () => {
    expect(page()).toContain("https://fleet.icjia.app");
  });

  it("threads the generated-at stamp", () => {
    expect(page()).toContain("August 16, 2026, 8:21 AM CDT");
  });

  // v1.47.0 — match transparency: matched fragments are <mark>ed inside the
  // filename, and a per-row note explains any term that landed elsewhere
  // ("dvfr" = the site's name), so "is it a DVFR report or just ON DVFR?"
  // is answerable at a glance.
  it("renders match highlights and per-row why notes", () => {
    const html = page();
    expect(html).toContain("search-mark");
    expect(html).toContain("search-why");
    expect(html).toContain("the site's name");
  });

  // v1.47.0 — each result links its file's shareable audit.icjia.app report
  // (row[9] in the index) in a new tab; blank when the file was never scored.
  it("links each result's per-file audit report in a new tab", () => {
    const html = page();
    expect(html).toContain("View report");
    expect(html).toContain("row[9]");
    expect(html).toContain("matchedOn");
  });

  // v1.48.0 — fuzzy taming: a near-miss on a site's name renders as a
  // clickable "Did you mean?" chip instead of silently flooding, and a
  // correction shared by every result is hoisted into the status line
  // once instead of stamped on every row.
  it("carries the Did-you-mean suggestion machinery", () => {
    const html = page();
    expect(html).toContain('id="did-you-mean"');
    expect(html).toContain("Did you mean");
    expect(html).toContain("function suggestSiteTerms");
  });

  it("hoists a uniform fuzzy correction into the status line", () => {
    expect(page()).toContain("hoistTerms");
  });

  // v1.49.0 — sortable results: clickable headers with aria-sort, default
  // audit-score-descending.
  it("renders sortable column headers defaulting to score-descending", () => {
    const html = page();
    expect(html).toContain("search-sort-btn");
    expect(html).toContain("aria-sort");
    expect(html).toContain('sortKey = "score"');
    expect(html).toContain('sortDir = "desc"');
    expect(html).toContain("function sortSearchMatches");
  });

  // v1.48.1 — regression pin. The generator emits the controller from a
  // template literal, where `\s` COOKS TO `s`: the shipped page split
  // queries on the letter s ("svfr" → ["", "vfr"]) and the Did-you-mean
  // swap produced "vfr". The emitted JS must carry the real \s regex.
  it("emits a real whitespace regex in the shipped token splitter", () => {
    const html = page();
    expect(html).toContain(String.raw`split(/\s+/)`);
    expect(html).not.toContain("split(/s+/)");
  });

  // v1.51.0 — custom reports: tick results (from any number of searches)
  // into a session-only report, view it in place, download it as its own
  // workbook. sessionStorage lifetime; keep-or-clear prompt on return.
  it("carries the custom-report bar, return banner, and report view shell", () => {
    const html = page();
    expect(html).toContain('id="report-bar"');
    expect(html).toContain('id="report-banner"');
    expect(html).toContain('id="report-view"');
    expect(html).toContain('id="report-status"');
  });

  it("offers add-selected and add-all-matches actions", () => {
    const html = page();
    expect(html).toContain('id="add-selected"');
    expect(html).toContain('id="add-all"');
  });

  it("renders a selection checkbox per result row with a select-all header", () => {
    const html = page();
    expect(html).toContain('"checkbox"');
    expect(html).toContain("Select all");
  });

  it("embeds the tested report-store source inline", () => {
    const html = page();
    expect(html).toContain("function srAddRows");
    expect(html).toContain("function srRemoveRow");
    expect(html).toContain("function srParseStored");
    expect(html).toContain("function srSerializeReport");
    expect(html).toContain("function srReportXlsxName");
  });

  it("persists the report in sessionStorage under the shared key", () => {
    const html = page();
    expect(html).toContain("sessionStorage");
    expect(html).toContain(SEARCH_REPORT_STORAGE_KEY);
  });

  it("asks keep-or-clear when returning with a report in progress", () => {
    const html = page();
    expect(html).toContain('id="report-banner-keep"');
    expect(html).toContain('id="report-banner-clear"');
    expect(html).toContain("Keep adding");
  });

  it("downloads the report as its own workbook with the found-by column", () => {
    const html = page();
    expect(html).toContain("queryColumn: true");
    expect(html).toContain("Custom report");
    expect(html).toContain("srReportXlsxName");
  });

  it("two-steps the Clear action instead of a blocking dialog", () => {
    const html = page();
    expect(html).toContain('id="report-clear"');
    expect(html).toContain('id="report-clear-yes"');
    expect(html).not.toContain("confirm(");
  });

  // The whole controller ships inside the generator's template literal,
  // where a stray backtick or cooked escape can silently corrupt the
  // emitted JS (the v1.48.1 class of bug). Parsing the inline script as
  // standalone JavaScript catches every syntax-level case of that.
  it("emits inline JS that parses as standalone JavaScript", () => {
    const html = page();
    const m = html.match(/<script>([\s\S]*)<\/script>/);
    expect(m).toBeTruthy();
    // Compile-only (never run): vm.Script throws on any syntax error.
    expect(() => new vm.Script(m[1])).not.toThrow();
  });
});
