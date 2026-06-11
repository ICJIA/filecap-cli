import { describe, it, expect } from "vitest";
import { extractFileUrls } from "../src/references/extract-urls.js";

describe("extractFileUrls", () => {
  it("returns an empty array for empty input", () => {
    expect(extractFileUrls("")).toEqual([]);
    expect(extractFileUrls(null)).toEqual([]);
    expect(extractFileUrls(undefined)).toEqual([]);
  });

  it("extracts a single PDF URL from a markdown link", () => {
    const md = "Download [the NOFO](https://example.com/foo.pdf) here.";
    expect(extractFileUrls(md)).toEqual(["https://example.com/foo.pdf"]);
  });

  it("extracts a bare URL embedded in prose", () => {
    const text = "Visit https://x.com/r.pdf for the report.";
    expect(extractFileUrls(text)).toEqual(["https://x.com/r.pdf"]);
  });

  it("captures multiple distinct URLs", () => {
    const md = `
[A](https://a.com/one.pdf)
[B](https://b.com/two.docx)
[C](https://c.com/three.zip)
`;
    expect(extractFileUrls(md)).toEqual([
      "https://a.com/one.pdf",
      "https://b.com/two.docx",
      "https://c.com/three.zip",
    ]);
  });

  it("recognizes all supported extensions case-insensitively", () => {
    const text = `
https://x.com/a.pdf
https://x.com/b.doc
https://x.com/c.docx
https://x.com/d.xls
https://x.com/e.xlsx
https://x.com/f.ppt
https://x.com/g.pptx
https://x.com/h.zip
https://x.com/i.PDF
https://x.com/j.DocX
`;
    const urls = extractFileUrls(text);
    expect(urls.length).toBe(10);
    expect(urls).toContain("https://x.com/i.PDF");
    expect(urls).toContain("https://x.com/j.DocX");
  });

  it("preserves a trailing query string on the URL", () => {
    const text = "https://x.com/foo.pdf?v=2&token=abc and more text";
    expect(extractFileUrls(text)).toEqual(["https://x.com/foo.pdf?v=2&token=abc"]);
  });

  it("does not include trailing punctuation outside the URL", () => {
    expect(extractFileUrls("Visit https://x.com/foo.pdf. Today.")).toEqual([
      "https://x.com/foo.pdf",
    ]);
    expect(extractFileUrls("Visit https://x.com/foo.pdf, today.")).toEqual([
      "https://x.com/foo.pdf",
    ]);
    expect(extractFileUrls("(https://x.com/foo.pdf)")).toEqual([
      "https://x.com/foo.pdf",
    ]);
  });

  it("captures Strapi URL-encoded filenames intact", () => {
    const url =
      "https://archive.icjia-api.cloud/files/icjia/pdf/compiler/Authority%20Endorses%20Proposed%20CHRI%20Act.pdf";
    expect(extractFileUrls(`See ${url} for details.`)).toEqual([url]);
  });

  it("captures URLs containing ampersand in the path (e.g. NOFOQ&A.pdf)", () => {
    const url =
      "https://archive.icjia-api.cloud/files/icjia/gata/materials/funding/2020-casa/NOFOQ&A.pdf";
    expect(extractFileUrls(`Q&A: ${url}`)).toEqual([url]);
  });

  it("ignores non-file URLs (youtube, mailto, qualtrics)", () => {
    const text = `
Watch https://www.youtube.com/watch?v=abc
Email cja@illinois.gov
Survey https://icjia.az1.qualtrics.com/jfe/form/SV_0iBJNliJ
`;
    expect(extractFileUrls(text)).toEqual([]);
  });

  it("deduplicates repeated URLs within the same input", () => {
    const text = `
First [link](https://x.com/foo.pdf), then again https://x.com/foo.pdf.
And a third time: [download](https://x.com/foo.pdf).
`;
    expect(extractFileUrls(text)).toEqual(["https://x.com/foo.pdf"]);
  });

  // v1.29.0 — root-relative links. Markdown/CMS bodies on the fleet's own
  // sites link their files as "/files/x.pdf" or "/uploads/x.pdf"; with a
  // baseUrl those now resolve to absolute URLs. Without baseUrl the
  // behavior is unchanged (absolute-only).
  describe("root-relative extraction with { baseUrl }", () => {
    it("resolves a root-relative markdown link against baseUrl", () => {
      const md = "Get [the plan](/files/Full_Report_Plan_2025.pdf) today.";
      expect(extractFileUrls(md, { baseUrl: "https://vpp.icjia.illinois.gov" })).toEqual([
        "https://vpp.icjia.illinois.gov/files/Full_Report_Plan_2025.pdf",
      ]);
    });

    it("ignores root-relative links when no baseUrl is given", () => {
      const md = "Get [the plan](/files/plan.pdf) today.";
      expect(extractFileUrls(md)).toEqual([]);
    });

    it("mixes absolute and relative matches, absolute first", () => {
      const md = `[A](https://a.com/one.pdf) and [B](/uploads/two.docx)`;
      expect(extractFileUrls(md, { baseUrl: "https://api.example.gov" })).toEqual([
        "https://a.com/one.pdf",
        "https://api.example.gov/uploads/two.docx",
      ]);
    });

    it("does not re-extract the path of an absolute URL as a relative link", () => {
      const md = "See https://store.samhsa.gov/sites/default/files/sma17-5047.pdf now.";
      expect(extractFileUrls(md, { baseUrl: "https://vpp.icjia.illinois.gov" })).toEqual([
        "https://store.samhsa.gov/sites/default/files/sma17-5047.pdf",
      ]);
    });

    it("does not treat bare relative paths (no leading slash) as links", () => {
      const md = "See files/local.pdf or ../up.pdf for details.";
      expect(extractFileUrls(md, { baseUrl: "https://x.gov" })).toEqual([]);
    });

    it("resolves href-style root-relative links in HTML bodies", () => {
      const html = `<a href="/uploads/report final.pdf">report</a>`;
      // Spaces survive extraction inside href quotes? No — quotes terminate
      // the match at the space; regex extraction of spaced filenames is out
      // of scope (media-field URLs carry those, not body text).
      expect(extractFileUrls(`<a href="/uploads/report.pdf">r</a>`, { baseUrl: "https://x.gov" })).toEqual([
        "https://x.gov/uploads/report.pdf",
      ]);
      expect(extractFileUrls(html, { baseUrl: "https://x.gov" })).toEqual([]);
    });

    it("dedupes a relative link that resolves to an already-extracted absolute URL", () => {
      const md = "[A](https://x.gov/uploads/a.pdf) [B](/uploads/a.pdf)";
      expect(extractFileUrls(md, { baseUrl: "https://x.gov" })).toEqual([
        "https://x.gov/uploads/a.pdf",
      ]);
    });

    it("preserves query strings on relative links", () => {
      const md = "[v2](/uploads/a.pdf?v=2)";
      expect(extractFileUrls(md, { baseUrl: "https://x.gov" })).toEqual([
        "https://x.gov/uploads/a.pdf?v=2",
      ]);
    });

    it("a baseUrl with a path keeps only the origin for root-relative resolution", () => {
      const md = "[r](/uploads/a.pdf)";
      expect(extractFileUrls(md, { baseUrl: "https://x.gov/uploads" })).toEqual([
        "https://x.gov/uploads/a.pdf",
      ]);
    });
  });

  it("handles real grant-body content (verified probe case)", () => {
    const body = `[LINK TO NOFO](https://archive.icjia-api.cloud/files/icjia/gata/materials/funding/2020-casa/CASANOFO.pdf) {.text-center .nofo-link}

[DOWNLOAD ZIP FILE OF ALL REQUIRED APPLICATION DOCUMENTS](https://archive.icjia-api.cloud/files/icjia/gata/materials/funding/2020-casa/CASANOFOZip.zip) {.text-center .zip-link}

Questions and responses are posted [here](https://archive.icjia-api.cloud/files/icjia/gata/materials/funding/2020-casa/NOFOQ&A.pdf).
`;
    expect(extractFileUrls(body)).toEqual([
      "https://archive.icjia-api.cloud/files/icjia/gata/materials/funding/2020-casa/CASANOFO.pdf",
      "https://archive.icjia-api.cloud/files/icjia/gata/materials/funding/2020-casa/CASANOFOZip.zip",
      "https://archive.icjia-api.cloud/files/icjia/gata/materials/funding/2020-casa/NOFOQ&A.pdf",
    ]);
  });
});
