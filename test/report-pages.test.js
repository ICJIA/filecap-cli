import { describe, it, expect } from "vitest";
import { buildPageList, parseCmsPageList, parsePageRefFiles, attachCrossSiteFiles, normPageUrl } from "../src/report/pages.js";

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

  it("v1.31.0 — lists a shared file only under the first page that references it", () => {
    const pages = buildPageList([
      fileEntry("shared.pdf", [ref("https://x/p1/"), ref("https://x/p2/")]),
    ]);
    expect(pages).toHaveLength(2);
    const p1 = pages.find((p) => p.pageUrl === "https://x/p1/");
    const p2 = pages.find((p) => p.pageUrl === "https://x/p2/");
    expect(p1.files.map((f) => f.path)).toEqual(["shared.pdf"]);
    expect(p1.dupeFileCount).toBe(0);
    expect(p2.files).toEqual([]);
    expect(p2.dupeFileCount).toBe(1);
  });

  it("de-duplicates a file repeated in one page's references without counting it as elsewhere", () => {
    const pages = buildPageList([
      fileEntry("a.pdf", [ref("https://x/p/"), ref("https://x/p/")]),
    ]);
    expect(pages).toHaveLength(1);
    expect(pages[0].files).toHaveLength(1);
    expect(pages[0].dupeFileCount).toBe(0);
  });

  it("counts a repeat mention once per later page, even when that ref repeats", () => {
    const pages = buildPageList([
      fileEntry("a.pdf", [ref("https://x/p1/"), ref("https://x/p2/"), ref("https://x/p2/")]),
    ]);
    const p2 = pages.find((p) => p.pageUrl === "https://x/p2/");
    expect(p2.files).toEqual([]);
    expect(p2.dupeFileCount).toBe(1);
  });

  it("keeps same-path files from different servers distinct (consolidated inventories)", () => {
    const pages = buildPageList([
      { ...fileEntry("docs/a.pdf", [ref("https://x/p/")]), serverName: "server-1" },
      { ...fileEntry("docs/a.pdf", [ref("https://x/p/")]), serverName: "server-2" },
    ]);
    expect(pages).toHaveLength(1);
    expect(pages[0].files).toHaveLength(2);
    expect(pages[0].dupeFileCount).toBe(0);
  });

  it("thin cms/sitemap rows carry dupeFileCount 0", () => {
    const pages = buildPageList(
      [fileEntry("a.pdf", [ref("https://x/p/")])],
      ["https://x/from-sitemap/"],
      [{ pageUrl: "https://x/from-cms/", contentType: "post" }],
    );
    for (const p of pages) expect(p.dupeFileCount).toBe(0);
  });

  it("skips references with no pageUrl", () => {
    const pages = buildPageList([
      fileEntry("a.pdf", [ref("https://x/p/"), { contentType: "grant", pageUrl: null }]),
    ]);
    expect(pages).toHaveLength(1);
  });

  it("v1.29.0 — merges raw URL variants of the same page into one row", () => {
    // Two files referenced from the same page, one ref recorded with a
    // trailing slash and different case. Keying the inversion by raw URL
    // split the page into two rows, each showing only half its files.
    const pages = buildPageList([
      fileEntry("a.pdf", [ref("https://x/About/")]),
      fileEntry("b.pdf", [ref("https://x/about")]),
    ]);
    expect(pages).toHaveLength(1);
    expect(pages[0].files.map((f) => f.path).sort()).toEqual(["a.pdf", "b.pdf"]);
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

describe("parseCmsPageList", () => {
  it("parses sidecar NDJSON into {pageUrl, contentType}, skipping records with no pageUrl", () => {
    const ndjson = [
      JSON.stringify({ siteName: "s", contentType: "post", entryId: 1, pageUrl: "https://x/news/a/", referencedFiles: [] }),
      JSON.stringify({ siteName: "s", contentType: "grant", entryId: 2, pageUrl: null, referencedFiles: [] }),
      JSON.stringify({ siteName: "s", contentType: "page", entryId: 3, pageUrl: "https://x/about/", referencedFiles: [] }),
    ].join("\n");
    expect(parseCmsPageList(ndjson)).toEqual([
      { pageUrl: "https://x/news/a/", contentType: "post" },
      { pageUrl: "https://x/about/", contentType: "page" },
    ]);
  });

  it("returns an empty list for empty, blank, null, or unparseable input", () => {
    expect(parseCmsPageList("")).toEqual([]);
    expect(parseCmsPageList("   ")).toEqual([]);
    expect(parseCmsPageList(null)).toEqual([]);
    expect(parseCmsPageList("not json\n{ bad")).toEqual([]);
  });

  it("de-duplicates repeated page URLs (trailing slash + case insensitive)", () => {
    const ndjson = [
      JSON.stringify({ contentType: "post", pageUrl: "https://x/News/A/" }),
      JSON.stringify({ contentType: "post", pageUrl: "https://x/news/a" }),
    ].join("\n");
    expect(parseCmsPageList(ndjson)).toEqual([{ pageUrl: "https://x/News/A/", contentType: "post" }]);
  });
});

describe("buildPageList — CMS page merge (1.14.x)", () => {
  it("works with no cmsPages argument (back-compat)", () => {
    expect(buildPageList([fileEntry("a.pdf", [ref("https://x/p/")])], [])).toHaveLength(1);
  });

  it("adds CMS pages not already derived, as fromCms rows carrying content type", () => {
    const entries = [fileEntry("a.pdf", [ref("https://x/has-files/")])];
    const pages = buildPageList(entries, [], [
      { pageUrl: "https://x/has-files/", contentType: "meeting" },
      { pageUrl: "https://x/policy-1/", contentType: "policy" },
    ]);
    expect(pages).toHaveLength(2);
    const cms = pages.find((p) => p.pageUrl === "https://x/policy-1/");
    expect(cms.fromCms).toBe(true);
    expect(cms.contentType).toBe("policy");
    expect(cms.files).toEqual([]);
    expect(cms.pageAudit).toBeNull();
  });

  it("does not duplicate a CMS page that matches a file-linking page", () => {
    const entries = [fileEntry("a.pdf", [ref("https://x/derived/")])];
    const pages = buildPageList(entries, [], [
      { pageUrl: "https://x/derived/", contentType: "meeting" },
      { pageUrl: "https://x/cms-only/", contentType: "post" },
    ]);
    expect(pages).toHaveLength(2);
    expect(pages.find((p) => p.pageUrl === "https://x/derived/").fromCms).toBeUndefined();
    expect(pages.find((p) => p.pageUrl === "https://x/cms-only/").fromCms).toBe(true);
  });
});

describe("parsePageRefFiles", () => {
  it("returns an empty map for empty / non-string input", () => {
    expect(parsePageRefFiles("").size).toBe(0);
    expect(parsePageRefFiles(undefined).size).toBe(0);
    expect(parsePageRefFiles(null).size).toBe(0);
  });

  it("maps normalized page URL → its referenced file URLs", () => {
    const ndjson = [
      JSON.stringify({ pageUrl: "https://x/research", referencedFiles: ["https://cms/a.docx", "https://x/b.pdf"] }),
    ].join("\n");
    const m = parsePageRefFiles(ndjson);
    expect(m.get("https://x/research")).toEqual(["https://cms/a.docx", "https://x/b.pdf"]);
  });

  it("merges + dedupes files across records that share a normalized page URL", () => {
    const ndjson = [
      JSON.stringify({ pageUrl: "https://x/Research/", referencedFiles: ["https://cms/a.docx"] }),
      JSON.stringify({ pageUrl: "https://x/research", referencedFiles: ["https://cms/a.docx", "https://x/b.pdf"] }),
    ].join("\n");
    const m = parsePageRefFiles(ndjson);
    expect(m.get("https://x/research")).toEqual(["https://cms/a.docx", "https://x/b.pdf"]);
  });

  it("skips records with no pageUrl, no files, or malformed JSON", () => {
    const ndjson = [
      "{not json",
      JSON.stringify({ pageUrl: "", referencedFiles: ["https://cms/a.docx"] }),
      JSON.stringify({ pageUrl: "https://x/p", referencedFiles: [] }),
      JSON.stringify({ pageUrl: "https://x/q" }),
    ].join("\n");
    const m = parsePageRefFiles(ndjson);
    expect(m.size).toBe(0);
  });
});

describe("buildPageList with pageScores", () => {
  it("populates pageAudit for sitemap-only pages from the score map", () => {
    const scores = new Map([
      [normPageUrl("https://x.com/solo"), { score: 88, grade: "B", violationCount: 1, bySeverity: {}, reportUrl: "r" }],
    ]);
    const pages = buildPageList([], ["https://x.com/solo"], [], scores);
    const solo = pages.find((p) => p.pageUrl === "https://x.com/solo");
    expect(solo.pageAudit).toMatchObject({ score: 88, grade: "B", reportUrl: "r" });
  });
});

describe("attachCrossSiteFiles", () => {
  // resolver: maps known URLs to a fleet owner; null otherwise.
  const resolveFleetFile = (url) => {
    if (url === "https://sfs.icjia.illinois.gov/q.pdf")
      return { siteName: "sfs-git", siteLabel: "SFS", filename: "q.pdf", detailHref: "sfs-1.html" };
    if (url === "https://agency.cms/uploads/proto_abc.docx")
      return { siteName: "agency", siteLabel: "ICJIA agency", filename: "proto_abc.docx", detailHref: "icjia-1.html" };
    return null;
  };

  it("adds cross-site files, skips files owned by the current site", () => {
    const pages = [{ pageUrl: "https://sfs.icjia.illinois.gov/research", files: [] }];
    const pageRefFiles = new Map([[
      "https://sfs.icjia.illinois.gov/research",
      ["https://sfs.icjia.illinois.gov/q.pdf", "https://agency.cms/uploads/proto_abc.docx"],
    ]]);
    attachCrossSiteFiles(pages, { pageRefFiles, resolveFleetFile, currentSiteName: "sfs-git" });
    expect(pages[0].crossSiteFiles).toEqual([
      { filename: "proto_abc.docx", siteLabel: "ICJIA agency", detailHref: "icjia-1.html" },
    ]);
  });

  it("falls back to host-only (no link) for URLs inventoried nowhere", () => {
    const pages = [{ pageUrl: "https://x/p", files: [] }];
    const pageRefFiles = new Map([["https://x/p", ["https://other.gov/files/report.pdf"]]]);
    attachCrossSiteFiles(pages, { pageRefFiles, resolveFleetFile, currentSiteName: "x" });
    expect(pages[0].crossSiteFiles).toEqual([
      { filename: "report.pdf", siteLabel: "other.gov", detailHref: null },
    ]);
  });

  it("sets an empty array on pages with no linked files and is a no-op without inputs", () => {
    const pages = [{ pageUrl: "https://x/p", files: [] }];
    attachCrossSiteFiles(pages, { pageRefFiles: new Map(), resolveFleetFile, currentSiteName: "x" });
    expect(pages[0].crossSiteFiles).toEqual([]);
    const pages2 = [{ pageUrl: "https://x/p", files: [] }];
    attachCrossSiteFiles(pages2);
    expect(pages2[0].crossSiteFiles).toEqual([]);
  });
});
