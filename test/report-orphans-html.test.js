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

  // v1.39.0 — the sort script reads dataset.confidence off the CELL; the
  // attribute used to live only on the <tr>, so "Confidence %" sorted its
  // "NN%" text lexicographically (100 before 20). These tests execute the
  // shipped script's comparator over stub rows built from the rendered HTML.
  describe("confidence column sort (D3)", () => {
    // Minimal DOM-shaped stubs: one per <tr>, cells exposing .dataset and
    // .textContent the way the browser would.
    function stubRows(html) {
      const rowsHtml = html.match(/<tr data-status[\s\S]*?<\/tr>/g) ?? [];
      return rowsHtml.map((rh) => ({
        children: (rh.match(/<td[\s\S]*?<\/td>/g) ?? []).map((cellHtml) => {
          const dataset = {};
          for (const m of cellHtml.matchAll(/data-([a-z]+)="([^"]*)"/g)) {
            dataset[m[1]] = m[2];
          }
          return { dataset, textContent: cellHtml.replace(/<[^>]+>/g, "") };
        }),
      }));
    }

    function extractComparator(html) {
      const m = html.match(/rows\.sort\(\(a, b\) => \{([\s\S]*?)\}\);/);
      expect(m).not.toBeNull();
      return new Function("a", "b", "idx", "dir", m[1]);
    }

    const fourOrphans = [100, 85, 20, 0].map((conf, i) =>
      orphan({
        replaceabilityConfidence: conf,
        entry: {
          filename: `f${i}.pdf`,
          path: `uploads/f${i}.pdf`,
          serverName: "icjia-agency-prod",
          extension: "pdf",
          sizeBytes: 10 + i,
          modifiedAt: "2021-01-01T00:00:00.000Z",
        },
      }));

    it("emits data-confidence on the confidence <td> (and keeps the <tr> attribute)", () => {
      const html = writeOrphansHtml({ orphans: fourOrphans, sources, siteTotals });
      expect(html).toMatch(/<td class="confidence-cell conf-high" data-confidence="100">100%<\/td>/);
      expect(html).toMatch(/<tr data-status="stale-revision" data-confidence="100">/);
    });

    it("the shipped sort script orders confidence 0,20,85,100 ascending", () => {
      const html = writeOrphansHtml({ orphans: fourOrphans, sources, siteTotals });
      const cmp = extractComparator(html);
      const rows = stubRows(html);
      expect(rows).toHaveLength(4);
      // Column order: Site, Filename, Type, Size, Modified, Status,
      // Confidence %, Replaced by, Reasons → confidence is index 6.
      const CONF_IDX = 6;
      const sorted = rows.slice().sort((a, b) => cmp(a, b, CONF_IDX, "asc"));
      const confidences = sorted.map((r) => r.children[CONF_IDX].textContent.trim());
      expect(confidences).toEqual(["0%", "20%", "85%", "100%"]);
    });

    it("the size column still sorts numerically via data-bytes", () => {
      const html = writeOrphansHtml({ orphans: fourOrphans, sources, siteTotals });
      const cmp = extractComparator(html);
      const rows = stubRows(html);
      const SIZE_IDX = 3;
      const sorted = rows.slice().sort((a, b) => cmp(a, b, SIZE_IDX, "desc"));
      const bytes = sorted.map((r) => Number(r.children[SIZE_IDX].dataset.bytes));
      expect(bytes).toEqual([13, 12, 11, 10]);
    });
  });

  // v1.39.0 post-audit fix (red-1 R2): the LIVE orphan emitters still shipped
  // raw un-encoded public URLs (D10 fixed only the zero-caller CSV writer). A
  // real fleet filename like Sheet#Info1V1-2025.pdf produced an href whose
  // "#" truncates the request at the fragment. Same base(+pathPrefix)+
  // per-segment encoding as audit-errors.js publicUrlFor.
  describe("public-URL encoding (R2)", () => {
    it("percent-encodes # in the filename link (the live Sheet#Info1V1-2025.pdf trigger)", () => {
      const html = writeOrphansHtml({
        orphans: [orphan({
          entry: {
            filename: "Sheet#Info1V1-2025.pdf",
            path: "uploads/Sheet#Info1V1-2025.pdf",
            serverName: "icjia-agency-prod",
            extension: "pdf",
            sizeBytes: 1,
            modifiedAt: "2021-01-01T00:00:00.000Z",
          },
        })],
        sources,
        siteTotals,
      });
      expect(html).toContain(
        'href="https://agency.icjia-api.cloud/uploads/Sheet%23Info1V1-2025.pdf"',
      );
      expect(html).not.toContain(
        'href="https://agency.icjia-api.cloud/uploads/Sheet#Info1V1-2025.pdf"',
      );
    });

    it("composes pathPrefix and per-segment-encodes each path segment (pin)", () => {
      // Control pin: prefix composition + space encoding (spaces were already
      // normalized by the URL round-trip; the prefix rule must survive the
      // shared-helper swap).
      const html = writeOrphansHtml({
        orphans: [orphan({
          entry: {
            filename: "a b.pdf",
            path: "docs/a b.pdf",
            serverName: "px",
            extension: "pdf",
            sizeBytes: 1,
            modifiedAt: "2021-01-01T00:00:00.000Z",
          },
        })],
        sources: [{ serverName: "px", siteName: "PX", publicUrlBase: "https://files.example.gov/", pathPrefix: "static" }],
        siteTotals: new Map([["px", 1]]),
      });
      expect(html).toContain('href="https://files.example.gov/static/docs/a%20b.pdf"');
    });
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
