import { describe, it, expect } from "vitest";
import { generateAuditErrorsPage } from "../src/report/audit-errors-page.js";

const groups = [
  {
    siteName: "Beta",
    serverName: "beta",
    errors: [
      {
        filename: "bad.pdf",
        extension: "pdf",
        sizeBytes: 1234,
        publicUrl: "https://beta.example.com/bad.pdf",
        error: "HTTP 422 x",
        kind: "not-a-pdf",
        reason: "Not a valid PDF — likely HTML.",
      },
    ],
  },
  { siteName: "Alpha", serverName: "alpha", errors: [] },
];

describe("generateAuditErrorsPage", () => {
  it("returns a complete HTML document with one <main> and a favicon", () => {
    const html = generateAuditErrorsPage({ groups });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toMatch(/<link[^>]*rel="icon"/);
    expect((html.match(/<main\b/g) || []).length).toBe(1);
    expect(html).toContain("</main>");
  });

  it("lists every site, with a table for sites that have errors", () => {
    const html = generateAuditErrorsPage({ groups });
    expect(html).toContain("Beta");
    expect(html).toContain("Alpha");
    expect(html).toContain("bad.pdf");
    expect(html).toContain("Not a valid PDF — likely HTML.");
  });

  it("states 'no file errors' for a clean site", () => {
    const html = generateAuditErrorsPage({ groups });
    expect(html).toMatch(/no file errors/i);
  });

  it("links each errored file to its public URL", () => {
    const html = generateAuditErrorsPage({ groups });
    expect(html).toContain('href="https://beta.example.com/bad.pdf"');
  });

  it("summarises the fleet error total", () => {
    const html = generateAuditErrorsPage({ groups });
    expect(html).toMatch(/1 errored file/i);
  });

  it("handles a fully-clean fleet", () => {
    const html = generateAuditErrorsPage({
      groups: [{ siteName: "Alpha", serverName: "alpha", errors: [] }],
    });
    expect(html).toMatch(/no file errors/i);
  });

  it("escapes HTML in file names and reasons", () => {
    const html = generateAuditErrorsPage({
      groups: [
        {
          siteName: "X",
          serverName: "x",
          errors: [
            {
              filename: "a<b>.pdf",
              extension: "pdf",
              sizeBytes: 1,
              publicUrl: "",
              error: "e",
              kind: "audit-error",
              reason: "r & r",
            },
          ],
        },
      ],
    });
    expect(html).toContain("a&lt;b&gt;.pdf");
    expect(html).toContain("r &amp; r");
  });
});

describe("meta description (v1.40.0)", () => {
  it("ships a description for the file-errors page", () => {
    const html = generateAuditErrorsPage({ groups: [] });
    expect(html).toMatch(/<meta name="description" content="[^"]{40,}"/);
  });
});

// Office-scoring follow-on: the intro lede used to say a 422 means "not
// actually a PDF" and a timeout means "a very large PDF timed out" — both
// PDF-specific. Now that docx/xlsx/pptx are scored too, the lede must not
// imply PDF is the only format that can 422 or time out.
describe("intro lede — format-aware 422/timeout wording", () => {
  it("attributes a 422 to any scoreable format, not just PDF", () => {
    const html = generateAuditErrorsPage({ groups: [] });
    expect(html).toContain(
      "A 422 means the file is not what its extension claims — a fake or corrupt PDF, Word, Excel, or PowerPoint file",
    );
    expect(html).not.toMatch(/not actually a PDF/);
  });

  it("keeps the 'every site is listed' sentence — orthogonal to format wording", () => {
    const html = generateAuditErrorsPage({ groups: [] });
    expect(html).toContain("Every site is listed");
  });

  it("says 'large or complex document', not 'large PDF', for the timeout note", () => {
    const html = generateAuditErrorsPage({ groups: [] });
    expect(html).toContain(
      '"could not process" usually means a very large or complex document timed out — re-running the audit retries it.',
    );
    expect(html).not.toMatch(/a very large PDF timed out/);
  });
});
