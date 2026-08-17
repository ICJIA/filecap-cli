import { describe, it, expect } from "vitest";
import { paginatorNav } from "../src/web/paginator-nav.js";

// v1.55.0 — one shared markup builder for every paginated table (report file
// view, report page view, index duplicates, orphans). Each table renders it
// twice: once above the table, once below (bottom copy = "-b" id suffix).

describe("paginatorNav", () => {
  it("emits the classic top paginator markup (ids, sizes, arrows)", () => {
    const html = paginatorNav();
    expect(html).toMatch(/^<nav class="paginator" aria-label="Table pagination">/);
    expect(html).toContain('id="page-info"');
    expect(html).toContain('id="page-size"');
    expect(html).toContain('id="pag-prev"');
    expect(html).toContain('id="pag-pages"');
    expect(html).toContain('id="pag-next"');
    expect(html).toContain('<option value="25" selected>25</option>');
    expect(html).toContain('<option value="50">50</option>');
    expect(html).toContain('<option value="100">100</option>');
    expect(html).toContain("Rows per page");
    expect(html).toContain("&larr; Prev");
    expect(html).toContain("Next &rarr;");
    expect(html).not.toContain("aria-live");
  });

  it("prefixes every id so multiple tables can coexist on one page", () => {
    const html = paginatorNav({ idPrefix: "dup-", ariaLabel: "Duplicate table pagination" });
    expect(html).toContain('aria-label="Duplicate table pagination"');
    expect(html).toContain('id="dup-page-info"');
    expect(html).toContain('id="dup-page-size"');
    expect(html).toContain('id="dup-pag-prev"');
    expect(html).toContain('id="dup-pag-pages"');
    expect(html).toContain('id="dup-pag-next"');
  });

  it("marks the info span as a polite live region only when asked", () => {
    expect(paginatorNav({ live: true }))
      .toContain('<span class="pag-info" id="page-info" role="status" aria-live="polite">');
    expect(paginatorNav()).toContain('<span class="pag-info" id="page-info">');
  });

  it("bottom copy: -b ids, paginator-bottom class, distinct aria-label, never live", () => {
    const html = paginatorNav({ live: true, bottom: true });
    expect(html).toMatch(/^<nav class="paginator paginator-bottom" aria-label="Table pagination \(bottom\)">/);
    expect(html).toContain('id="page-info-b"');
    expect(html).toContain('id="page-size-b"');
    expect(html).toContain('id="pag-prev-b"');
    expect(html).toContain('id="pag-pages-b"');
    expect(html).toContain('id="pag-next-b"');
    // A second live region would make screen readers announce every page
    // change twice — only the top copy announces.
    expect(html).not.toContain("aria-live");
  });
});
