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
});
