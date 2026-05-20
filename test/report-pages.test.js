import { describe, it, expect } from "vitest";
import { buildPageList } from "../src/report/pages.js";

function fileEntry(p, references) {
  return { path: p, filename: p.split("/").pop(), category: "pdf", references };
}
function ref(pageUrl, over = {}) {
  const { pageAudit: paOver, ...rest } = over;
  return {
    siteName: "icjia-agency-prod",
    contentType: "meeting",
    entryId: 1,
    pageUrl,
    pageAudit: { score: 92, grade: "A", pageTitle: "A Meeting Page", ...paOver },
    ...rest,
  };
}

describe("buildPageList", () => {
  it("returns an empty list when no entry has references", () => {
    expect(buildPageList([fileEntry("a.pdf", []), fileEntry("b.pdf", undefined)])).toEqual([]);
    expect(buildPageList([])).toEqual([]);
    expect(buildPageList(undefined)).toEqual([]);
  });

  it("groups files by the page that references them", () => {
    const pages = buildPageList([
      fileEntry("a.pdf", [ref("https://x/page-1/")]),
      fileEntry("b.pdf", [ref("https://x/page-1/")]),
      fileEntry("c.pdf", [ref("https://x/page-2/")]),
    ]);
    expect(pages).toHaveLength(2);
    const p1 = pages.find((p) => p.pageUrl === "https://x/page-1/");
    expect(p1.files.map((f) => f.path).sort()).toEqual(["a.pdf", "b.pdf"]);
  });

  it("carries the page title, content type, and audit from the reference", () => {
    const [page] = buildPageList([fileEntry("a.pdf", [ref("https://x/p/")])]);
    expect(page.pageTitle).toBe("A Meeting Page");
    expect(page.contentType).toBe("meeting");
    expect(page.pageAudit.grade).toBe("A");
  });

  it("lists a file under every page that references it", () => {
    const pages = buildPageList([
      fileEntry("shared.pdf", [ref("https://x/p1/"), ref("https://x/p2/")]),
    ]);
    expect(pages).toHaveLength(2);
    expect(pages.every((p) => p.files.length === 1)).toBe(true);
  });

  it("de-duplicates a file repeated in one page's references", () => {
    const pages = buildPageList([
      fileEntry("a.pdf", [ref("https://x/p/"), ref("https://x/p/")]),
    ]);
    expect(pages).toHaveLength(1);
    expect(pages[0].files).toHaveLength(1);
  });

  it("skips references with no pageUrl", () => {
    const pages = buildPageList([
      fileEntry("a.pdf", [ref("https://x/p/"), { contentType: "grant", pageUrl: null }]),
    ]);
    expect(pages).toHaveLength(1);
  });
});

describe("buildPageList — sitemap merge (1.14.0)", () => {
  it("works with no sitemap argument (back-compat)", () => {
    expect(buildPageList([fileEntry("a.pdf", [ref("https://x/p/")])])).toHaveLength(1);
  });

  it("adds sitemap URLs that aren't already derived pages, as thin rows", () => {
    const entries = [fileEntry("a.pdf", [ref("https://x/has-files/")])];
    const pages = buildPageList(entries, [
      "https://x/has-files/",
      "https://x/no-files/",
      "https://x/about/",
    ]);
    expect(pages).toHaveLength(3);
    const thin = pages.find((p) => p.pageUrl === "https://x/no-files/");
    expect(thin.fromSitemap).toBe(true);
    expect(thin.files).toEqual([]);
    expect(thin.pageAudit).toBeNull();
  });

  it("does not duplicate a sitemap URL matching a derived page (trailing-slash + case insensitive)", () => {
    const entries = [fileEntry("a.pdf", [ref("https://x/Page-1/")])];
    const pages = buildPageList(entries, ["https://x/page-1", "https://x/page-1/"]);
    expect(pages).toHaveLength(1);
    expect(pages[0].fromSitemap).toBeUndefined();
  });
});
