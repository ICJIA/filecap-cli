import { describe, it, expect } from "vitest";
import { isPageUrl, filterPageUrls } from "../src/site-audit/page-url-filter.js";

describe("isPageUrl", () => {
  it("accepts a directory-style URL", () => {
    expect(isPageUrl("https://x.gov/about/meetings/")).toBe(true);
    expect(isPageUrl("https://x.gov/")).toBe(true);
    expect(isPageUrl("https://x.gov")).toBe(true);
  });

  it("accepts an extensionless slug", () => {
    expect(isPageUrl("https://x.gov/news/ari-10-years")).toBe(true);
    expect(isPageUrl("https://x.gov/about/meetings/regular-oversight/m-2026-3")).toBe(true);
  });

  it("accepts explicit web-page extensions", () => {
    for (const ext of ["html", "htm", "php", "asp", "aspx", "jsp", "cfm", "shtml", "xhtml"]) {
      expect(isPageUrl(`https://x.gov/page.${ext}`), ext).toBe(true);
    }
  });

  it("is case-insensitive about the extension", () => {
    expect(isPageUrl("https://x.gov/Page.HTML")).toBe(true);
    expect(isPageUrl("https://x.gov/Report.PDF")).toBe(false);
  });

  // The archive's sitemap lists the files themselves, so the page-accessibility
  // scorer was pointing a headless browser at PDFs and JPEGs. Those come back
  // 504 "Page navigation timed out" at best, and a meaningless axe score at
  // worst — and the documents are already scored by the `audits` stage.
  it("rejects documents, images, archives and data files", () => {
    const files = [
      "report.pdf", "sheet.xlsx", "old.xls", "doc.docx", "legacy.doc",
      "deck.pptx", "brochure.pub", "notes.md", "readme.mdown", "data.csv",
      "photo.jpg", "photo.jpeg", "scan.jfif", "logo.png", "anim.gif",
      "bundle.zip", "archive.bz2", "payload.json", "notes.txt", "sheet.ods",
      "text.odt", "mail.msg",
    ];
    for (const f of files) {
      expect(isPageUrl(`https://x.gov/files/${f}`), f).toBe(false);
    }
  });

  it("rejects dotfiles that got published (.DS_Store, .gitignore)", () => {
    expect(isPageUrl("https://x.gov/files/.DS_Store")).toBe(false);
    expect(isPageUrl("https://x.gov/files/.gitignore")).toBe(false);
  });

  it("decodes percent-encoding before reading the extension", () => {
    // Real archive URL: .../fvccBROCHURE%209-17-14.pub
    expect(isPageUrl("https://x.gov/files/fvccBROCHURE%209-17-14.pub")).toBe(false);
    expect(isPageUrl("https://x.gov/files/My%20Report.pdf")).toBe(false);
  });

  it("ignores query strings and fragments when reading the extension", () => {
    expect(isPageUrl("https://x.gov/report.pdf?v=2")).toBe(false);
    expect(isPageUrl("https://x.gov/about?tab=report.pdf")).toBe(true);
    expect(isPageUrl("https://x.gov/about#report.pdf")).toBe(true);
  });

  it("keeps a dotted path segment that is not the last one", () => {
    expect(isPageUrl("https://x.gov/v1.2/overview")).toBe(true);
  });

  it("returns false for junk input rather than throwing", () => {
    expect(isPageUrl("")).toBe(false);
    expect(isPageUrl(null)).toBe(false);
    expect(isPageUrl("not a url")).toBe(false);
  });
});

describe("filterPageUrls", () => {
  it("splits a list into pages and dropped files, preserving order", () => {
    const { pages, dropped } = filterPageUrls([
      "https://x.gov/",
      "https://x.gov/files/a.pdf",
      "https://x.gov/about",
      "https://x.gov/files/b.jpg",
      "https://x.gov/contact.html",
    ]);
    expect(pages).toEqual([
      "https://x.gov/",
      "https://x.gov/about",
      "https://x.gov/contact.html",
    ]);
    expect(dropped).toHaveLength(2);
  });

  it("handles an empty or non-array input", () => {
    expect(filterPageUrls([])).toEqual({ pages: [], dropped: [] });
    expect(filterPageUrls(null)).toEqual({ pages: [], dropped: [] });
  });
});
