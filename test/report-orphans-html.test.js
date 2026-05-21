import { describe, it, expect } from "vitest";
import { writeOrphansHtml } from "../src/report/orphans-html.js";

const sources = [
  {
    serverName: "icjia-agency-prod",
    siteName: "ICJIA",
    publicUrlBase: "https://agency.icjia-api.cloud",
  },
];
const siteTotals = new Map([["icjia-agency-prod", 100]]);

function orphan(over = {}) {
  return {
    entry: {
      filename: "Plan_a1b2c3d4e5.pdf",
      path: "uploads/Plan_a1b2c3d4e5.pdf",
      serverName: "icjia-agency-prod",
      extension: "pdf",
      sizeBytes: 12345,
      modifiedAt: "2021-01-01T00:00:00.000Z",
    },
    status: "stale-revision",
    replacedBy: "Plan_f6789abcde.pdf",
    replacedOn: "2026-04-01T00:00:00.000Z",
    daysBetween: 1916,
    daysOld: 1965,
    groupSize: 2,
    reasons: ["strapi-hash-variant", "older-than-1yr"],
    replaceabilityConfidence: 95,
    ...over,
  };
}

describe("writeOrphansHtml", () => {
  it("produces a valid HTML document", () => {
    const html = writeOrphansHtml({ orphans: [orphan()], sources, siteTotals });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toMatch(/<\/html>\s*$/);
  });

  it("links to the /accessibility page from the top nav", () => {
    const html = writeOrphansHtml({ orphans: [orphan()], sources, siteTotals });
    expect(html).toMatch(/<a href="accessibility\.html"[^>]*>Accessibility<\/a>/);
  });

  it("renders a table row per orphan with its filename", () => {
    const html = writeOrphansHtml({
      orphans: [orphan(), orphan({ entry: { filename: "Memo_b2c3d4e5f6.pdf", path: "uploads/Memo_b2c3d4e5f6.pdf", serverName: "icjia-agency-prod", extension: "pdf", sizeBytes: 10, modifiedAt: "2022-01-01T00:00:00.000Z" } })],
      sources,
      siteTotals,
    });
    expect(html).toContain("Plan_a1b2c3d4e5.pdf");
    expect(html).toContain("Memo_b2c3d4e5f6.pdf");
  });

  it("includes the lifecycle explainer", () => {
    const html = writeOrphansHtml({ orphans: [orphan()], sources, siteTotals });
    expect(html).toContain("Why orphan files exist");
    expect(html).toMatch(/<table class="lifecycle-table">/);
  });

  it("includes a paginator with prev/next, page-size selector, and page info", () => {
    const html = writeOrphansHtml({ orphans: [orphan()], sources, siteTotals });
    expect(html).toMatch(/<nav class="paginator"/);
    expect(html).toContain('id="page-info"');
    expect(html).toContain('id="pag-prev"');
    expect(html).toContain('id="pag-next"');
    expect(html).toContain('id="page-size"');
  });

  it("escapes HTML-special characters in an orphan filename", () => {
    const html = writeOrphansHtml({
      orphans: [orphan({ entry: { filename: "<script>alert(1)</script>.pdf", path: "uploads/x.pdf", serverName: "icjia-agency-prod", extension: "pdf", sizeBytes: 1, modifiedAt: "2021-01-01T00:00:00.000Z" } })],
      sources,
      siteTotals,
    });
    expect(html).not.toContain("<script>alert(1)</script>.pdf");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;.pdf");
  });

  it("includes the per-site orphan-rate breakdown", () => {
    const html = writeOrphansHtml({ orphans: [orphan()], sources, siteTotals });
    expect(html).toContain("Where are orphans concentrated?");
    expect(html).toContain("ICJIA");
  });

  it("scopes the paginator script to the orphan table by id, not a bare querySelector('table')", () => {
    // The explainer's lifecycle-table and the per-site breakdown table both
    // appear before the orphan table — a bare document.querySelector('table')
    // would grab the explainer table. The orphan table carries an id so the
    // paginator script targets the right table.
    const html = writeOrphansHtml({ orphans: [orphan()], sources, siteTotals });
    expect(html).toMatch(/<table id="orphan-table">/);
    expect(html).toContain("getElementById('orphan-table')");
    expect(html).not.toContain("document.querySelector('table')");
  });

  it("includes a favicon <link> right after the <title> (no /favicon.ico 404)", () => {
    const html = writeOrphansHtml({ orphans: [orphan()], sources, siteTotals });
    expect(html).toContain(
      "<link rel=\"icon\" href=\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%230d1117'/><path d='M12 9L12 23L23 16Z' fill='%23ffb000'/></svg>\">",
    );
    // It must sit inside <head>, immediately after the closing </title>.
    expect(html).toMatch(/<\/title>\s*<link rel="icon"/);
  });

  it("wraps the page body in exactly one <main> landmark", () => {
    const html = writeOrphansHtml({ orphans: [orphan()], sources, siteTotals });
    expect((html.match(/<main>/g) ?? []).length).toBe(1);
    expect((html.match(/<\/main>/g) ?? []).length).toBe(1);
    // <main> opens right after <body>; </main> closes before </body> (the
    // trailing <script> may sit between </main> and </body>).
    expect(html).toMatch(/<body>\s*<main>/);
    expect(html.indexOf("</main>")).toBeLessThan(html.indexOf("</body>"));
    // The page content (h1, table) lives inside the landmark.
    expect(html.indexOf("<main>")).toBeLessThan(html.indexOf("<h1>"));
    expect(html.indexOf('<table id="orphan-table">')).toBeLessThan(
      html.indexOf("</main>"),
    );
  });
});
