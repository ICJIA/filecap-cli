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
