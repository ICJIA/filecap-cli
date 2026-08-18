// test/site-accessibility-section.test.js
import { describe, it, expect } from "vitest";
import { renderSiteAccessibilitySection } from "../src/report/site-accessibility-section.js";

const sidecar = {
  score: 94, grade: "A",
  coverage: { pagesInSet: 412, scored: 150, errored: 2, capped: 260 },
  outstanding: { total: 37, bySeverity: { critical: 0, serious: 4, moderate: 18, minor: 15 }, byWcag: { A: 9, AA: 28, AAA: 0, bestPractice: 4 }, needsReview: 11 },
  trend: { vsDate: "2026-06-12T00:00:00Z", fixed: 12, new: 5, stillOpen: 32 },
  pages: [{ url: "https://x.com/a", score: 96, grade: "A", violationCount: 1, bySeverity: { serious: 0 }, needsReview: 1, reportUrl: "https://audit.icjia.app/page-report/a" }],
};

describe("renderSiteAccessibilitySection", () => {
  it("renders score, coverage, severity + WCAG breakdown, trend, and the independence note", () => {
    const html = renderSiteAccessibilitySection(sidecar);
    expect(html).toContain("Website accessibility");
    expect(html).toContain("94");
    expect(html).toContain("150"); // scored of pagesInSet
    expect(html).toContain("28"); // AA count
    expect(html).toContain("12"); // fixed
    expect(html).toMatch(/independent|not.*files|separate/i);
    expect(html).toContain("audit.icjia.app/page-report/a");
  });
  it("returns empty string for an unscored site", () => {
    expect(renderSiteAccessibilitySection(null)).toBe("");
    expect(renderSiteAccessibilitySection({ score: null })).toBe("");
  });

  // v1.56.0 — the section leads with a blue "website" scope lockup so it
  // cannot be mistaken for the orange file-accessibility banner above it.
  it("leads with the website scope lockup (globe icon + web-pages subtitle)", () => {
    const html = renderSiteAccessibilitySection(sidecar);
    // v1.57.0 — the lockup carries the infographic size (scope-head-lg).
    expect(html).toContain('class="scope-head scope-head-website scope-head-lg"');
    expect(html).toContain('<h2 id="sa-heading">Website accessibility</h2>');
    expect(html).toContain("not the files it publishes");
    expect(html).not.toContain("scope-head-files");
  });
  it("suppresses the report link when reportUrl uses a non-http(s) scheme (Fix 2)", () => {
    const maliciousSidecar = {
      score: 80, grade: "B",
      coverage: { pagesInSet: 10, scored: 5 },
      outstanding: { total: 2, bySeverity: {}, byWcag: {}, needsReview: 0 },
      pages: [{ url: "https://x.com/page", score: 75, grade: "C", violationCount: 2, needsReview: 0, reportUrl: "javascript:alert(1)" }],
    };
    const html = renderSiteAccessibilitySection(maliciousSidecar);
    expect(html).not.toContain('href="javascript:');
    // The row itself should still render (URL and score present).
    expect(html).toContain("https://x.com/page");
    expect(html).toContain("75");
  });
});
