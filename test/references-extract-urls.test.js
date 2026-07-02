import { describe, it, expect } from "vitest";
import { extractFileUrls, isAuditedFileUrl } from "../src/references/extract-urls.js";

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
      // v1.39.0 (B6) — quoted href values extract whole, INCLUDING filenames
      // with spaces (the quotes delimit the URL exactly). Previously the
      // spaced form was dropped → false orphan for every spaced filename
      // linked from an HTML body.
      const html = `<a href="/uploads/report final.pdf">report</a>`;
      expect(extractFileUrls(`<a href="/uploads/report.pdf">r</a>`, { baseUrl: "https://x.gov" })).toEqual([
        "https://x.gov/uploads/report.pdf",
      ]);
      expect(extractFileUrls(html, { baseUrl: "https://x.gov" })).toEqual([
        "https://x.gov/uploads/report%20final.pdf",
      ]);
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

  // v1.39.0 (B6) — parens/brackets inside URL paths, a real boundary after
  // the audited extension, and autolinker-style trailing-punctuation
  // trimming. Each case below was a verified false-orphan producer.
  describe("parens/brackets in paths + extension boundary (v1.39.0)", () => {
    it("extracts report(1).pdf whole from body text", () => {
      expect(
        extractFileUrls("See https://x.com/uploads/report(1).pdf today."),
      ).toEqual(["https://x.com/uploads/report(1).pdf"]);
    });

    it("extracts report(1).pdf whole from an href attribute", () => {
      expect(
        extractFileUrls(`<a href="https://x.com/uploads/report(1).pdf">r</a>`),
      ).toEqual(["https://x.com/uploads/report(1).pdf"]);
    });

    it("extracts a spaced filename whole from a quoted href (report (Final).pdf)", () => {
      expect(
        extractFileUrls(
          `<a href="https://x.com/uploads/report (Final).pdf">r</a>`,
        ),
      ).toEqual(["https://x.com/uploads/report (Final).pdf"]);
    });

    it("extracts brackets in paths whole (report[2020].pdf)", () => {
      expect(extractFileUrls("Get https://x.com/report[2020].pdf now")).toEqual([
        "https://x.com/report[2020].pdf",
      ]);
    });

    it("report.doc.pdf matches the FULL .pdf URL, not a truncated .doc one", () => {
      expect(extractFileUrls("https://x.com/files/report.doc.pdf")).toEqual([
        "https://x.com/files/report.doc.pdf",
      ]);
    });

    it("a mid-URL pseudo-extension does not truncate (my.docs/report.pdf)", () => {
      expect(extractFileUrls("https://my.docs/report.pdf")).toEqual([
        "https://my.docs/report.pdf",
      ]);
    });

    it("report.pdfx does not match at all", () => {
      expect(extractFileUrls("https://x.com/report.pdfx")).toEqual([]);
      expect(extractFileUrls("https://x.com/report.pdfx more text")).toEqual([]);
    });

    it("strips an unbalanced trailing paren but keeps balanced ones", () => {
      expect(extractFileUrls("(see https://h.com/a.pdf)")).toEqual([
        "https://h.com/a.pdf",
      ]);
      expect(extractFileUrls("(see https://h.com/a(1).pdf)")).toEqual([
        "https://h.com/a(1).pdf",
      ]);
    });

    it("strips trailing prose punctuation .,;:! after the extension", () => {
      expect(extractFileUrls("https://x.com/a.pdf;")).toEqual(["https://x.com/a.pdf"]);
      expect(extractFileUrls("https://x.com/a.pdf:")).toEqual(["https://x.com/a.pdf"]);
      expect(extractFileUrls("Get https://x.com/a.pdf!")).toEqual(["https://x.com/a.pdf"]);
    });

    it("keeps a fragment after the extension (boundary char)", () => {
      expect(extractFileUrls("https://x.com/a.pdf#page=2 next")).toEqual([
        "https://x.com/a.pdf#page=2",
      ]);
    });

    it("root-relative links with parens extract whole too", () => {
      expect(
        extractFileUrls("[r](/uploads/report(1).pdf)", { baseUrl: "https://x.gov" }),
      ).toEqual(["https://x.gov/uploads/report(1).pdf"]);
    });
  });

  // v1.39.0 post-audit fixes (red-2 R-2) — two under-extraction regressions
  // the span-then-verify rewrite introduced vs the pre-1.39 extractor, both
  // probe-proven and both restoring the HEAD outcome:
  //   (a) comma/semicolon-joined URL lists glued into ONE unmatchable span
  //       (both references lost → false-orphan direction);
  //   (b) entity-encoded quoted hrefs ("…a.pdf&amp;v=1") extracted nothing.
  //       HEAD extracted "…/a.pdf" (B3's canonicalization strips only
  //       "?"-queries, so the extractor must emit the truncated file URL for
  //       the inventory key to be "a.pdf").
  describe("comma/semicolon-joined lists + entity-encoded hrefs (v1.39.0 audit)", () => {
    it("splits a comma-joined URL list into both file URLs", () => {
      expect(extractFileUrls("https://x.gov/a.pdf,https://x.gov/b.pdf")).toEqual([
        "https://x.gov/a.pdf",
        "https://x.gov/b.pdf",
      ]);
    });

    it("splits a semicolon-joined URL list into both file URLs", () => {
      expect(extractFileUrls("https://x.gov/a.pdf;https://x.gov/b.pdf")).toEqual([
        "https://x.gov/a.pdf",
        "https://x.gov/b.pdf",
      ]);
    });

    it("splits a three-URL comma list and keeps non-file pieces out", () => {
      expect(
        extractFileUrls("https://x.gov/page,https://x.gov/a.pdf,https://x.gov/b.docx"),
      ).toEqual(["https://x.gov/a.pdf", "https://x.gov/b.docx"]);
    });

    it("a comma NOT followed by a scheme stays inside the URL (legal path char)", () => {
      // Control pin: separators only break the span when a new scheme
      // follows — a comma inside a filename must NOT become a boundary
      // (that was the pre-B6 truncation bug).
      expect(extractFileUrls("https://x.gov/report,final.pdf next")).toEqual([
        "https://x.gov/report,final.pdf",
      ]);
    });

    it("decodes &amp; in a quoted href and truncates at the query-starting & (HEAD outcome)", () => {
      expect(extractFileUrls(`<a href="https://x.gov/a.pdf&amp;v=1">a</a>`)).toEqual([
        "https://x.gov/a.pdf",
      ]);
    });

    it("decodes the numeric &#38; form the same way", () => {
      expect(extractFileUrls(`<a href="https://x.gov/a.pdf&#38;v=1">a</a>`)).toEqual([
        "https://x.gov/a.pdf",
      ]);
    });

    it("decodes &#39; &quot; &lt; &gt; in quoted href values (chars carried verbatim)", () => {
      expect(
        extractFileUrls(`<a href="https://x.gov/files/a&#39;s report.pdf">a</a>`),
      ).toEqual(["https://x.gov/files/a's report.pdf"]);
    });

    it("a raw & in a quoted href path (NOFOQ&A.pdf) still extracts whole", () => {
      // Control pin: & only starts a query when it directly follows an
      // audited extension — a mid-name ampersand is a path character.
      expect(
        extractFileUrls(`<a href="https://x.gov/funding/NOFOQ&A.pdf">q</a>`),
      ).toEqual(["https://x.gov/funding/NOFOQ&A.pdf"]);
    });

    it("does NOT entity-decode bare text spans (quoted-attribute path only)", () => {
      // Control pin: outside a quoted attribute the raw text IS the URL —
      // ".pdf&amp;…" has no boundary after the extension, so no match.
      expect(extractFileUrls("see https://x.gov/a.pdf&amp;v=1 now")).toEqual([]);
    });

    it("an entity-encoded relative href resolves against baseUrl (truncated at &)", () => {
      expect(
        extractFileUrls(`<a href="/uploads/a.pdf&amp;v=1">a</a>`, { baseUrl: "https://x.gov" }),
      ).toEqual(["https://x.gov/uploads/a.pdf"]);
    });
  });

  // v1.39.0 (B7) — shared audited-extension gate for url-string field values.
  describe("isAuditedFileUrl", () => {
    it("accepts audited file URLs, with or without query/fragment", () => {
      expect(isAuditedFileUrl("https://x.com/uploads/report.pdf")).toBe(true);
      expect(isAuditedFileUrl("https://x.com/uploads/report.pdf?v=2")).toBe(true);
      expect(isAuditedFileUrl("https://x.com/uploads/report.PDF#page=1")).toBe(true);
      expect(isAuditedFileUrl("https://x.com/a.docx")).toBe(true);
      expect(isAuditedFileUrl("https://x.com/a.zip")).toBe(true);
      expect(isAuditedFileUrl("/uploads/report (Final).pdf")).toBe(true);
    });

    it("rejects page URLs and non-audited extensions", () => {
      expect(isAuditedFileUrl("https://x.com/articles/some-page")).toBe(false);
      expect(isAuditedFileUrl("https://x.com/report.pdfx")).toBe(false);
      expect(isAuditedFileUrl("https://x.com/a.jpg")).toBe(false);
      expect(isAuditedFileUrl("")).toBe(false);
      expect(isAuditedFileUrl(null)).toBe(false);
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
