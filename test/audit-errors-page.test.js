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
