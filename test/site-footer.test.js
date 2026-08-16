import { describe, it, expect } from "vitest";
import { renderSiteFooter, siteFooterCss } from "../src/web/site-footer.js";
import { FILECAP_VERSION } from "../src/version.js";

describe("renderSiteFooter", () => {
  it("links 'the audit administrator' to a mailto instead of a dead-end phrase (v1.40.0)", () => {
    const html = renderSiteFooter();
    expect(html).toContain('href="mailto:christopher.schweda@illinois.gov"');
    expect(html).toMatch(/<a [^>]*mailto:[^>]*>the audit administrator<\/a>/);
    // the old unlinked phrasing must be gone
    expect(html).not.toMatch(/contact the audit administrator\.<\/span>/);
  });

  it("stamps the current version", () => {
    expect(renderSiteFooter()).toContain(`v${FILECAP_VERSION}`);
  });

  it("shows the generated-at stamp only when provided", () => {
    expect(renderSiteFooter({ generatedAt: "Jul 27, 2026" })).toContain("Generated Jul 27, 2026");
    expect(renderSiteFooter()).not.toContain("site-footer-date");
  });

  it("points Source + CHANGELOG at the renamed icjia-fleet-audit repo", () => {
    const html = renderSiteFooter();
    expect(html).toContain("https://github.com/ICJIA/icjia-fleet-audit");
    expect(html).toContain("https://github.com/ICJIA/icjia-fleet-audit/blob/main/CHANGELOG.md");
    expect(html).not.toContain("filecap-cli");
  });

  // v1.44.0 — the footer status bar links to the What's New archive on every
  // page (it's the durable route to updates once the home banner is dismissed).
  it("links to the What's New archive", () => {
    expect(renderSiteFooter()).toMatch(/<a href="whats-new\.html">What's New<\/a>/);
  });
});

describe("siteFooterCss", () => {
  it("pins the bar on desktop but returns it to normal flow on phones (v1.40.0)", () => {
    const css = siteFooterCss();
    expect(css).toContain("position: sticky;");
    // ≤700px: the pinned bar ate ~9% of a phone viewport and overlapped the
    // hero on load — small screens get a normal in-flow footer instead.
    // [^@]* keeps the match inside the 700px block (can't drift into @media print).
    expect(css).toMatch(/@media \(max-width: 700px\)[^@]*position: static;/);
  });

  it("keeps the print stylesheet static", () => {
    expect(siteFooterCss()).toMatch(/@media print[\s\S]*?position: static;/);
  });

  it("guards main against the flex min-content trap (v1.40.0)", () => {
    // body becomes a column flexbox here, so every page's <main> is a flex
    // item; without these, one wide grid/table inflates main past the phone
    // viewport and mobile browsers expand the layout viewport (clipped H1 bug).
    expect(siteFooterCss()).toMatch(/body > main \{[^}]*min-width: 0/);
    expect(siteFooterCss()).toMatch(/body > main \{[^}]*width: 100%/);
  });
});
