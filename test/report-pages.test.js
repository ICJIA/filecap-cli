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
