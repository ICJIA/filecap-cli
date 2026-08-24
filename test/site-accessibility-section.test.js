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

  // v1.59.1 — the WCAG-level card explains itself. ARI case: 3 issues in
  // the severity card but Level A/AA both 0 read as a contradiction until
  // you know all 3 are AAA/best-practice items outside the AA target.
  describe("self-explanatory WCAG card (v1.59.1)", () => {
    const ariShaped = {
      score: 99, grade: "A",
      coverage: { pagesInSet: 500, scored: 500 },
      outstanding: {
        total: 3,
        bySeverity: { critical: 0, serious: 1, moderate: 1, minor: 1 },
        byWcag: { A: 0, AA: 0, AAA: 0, bestPractice: 3 },
        needsReview: 500,
      },
      pages: [],
    };

    it("reconciles the two cards when A and AA are 0 but issues exist", () => {
      const html = renderSiteAccessibilitySection(ariShaped);
      expect(html).toContain('<p class="sa-wcag-note">');
      expect(html).toContain("All 3 outstanding issues are AAA / best-practice items");
      expect(html).toContain("none count against the WCAG 2.1 AA compliance target");
      expect(html).toContain("The severity card counts these same 3 issues");
    });

    it("uses singular phrasing for one issue", () => {
      const one = {
        ...ariShaped,
        outstanding: {
          total: 1,
          bySeverity: { critical: 0, serious: 1, moderate: 0, minor: 0 },
          byWcag: { A: 0, AA: 0, AAA: 0, bestPractice: 1 },
          needsReview: 2,
        },
      };
      const html = renderSiteAccessibilitySection(one);
      expect(html).toContain("The one outstanding issue is an AAA / best-practice item");
      expect(html).toContain("it does not count against the WCAG 2.1 AA compliance target");
      expect(html).toContain("The severity card counts this same issue");
    });

    it("renders no note when A or AA issues exist, or when nothing is outstanding", () => {
      // sidecar fixture: A 9 / AA 28 — the counts speak for themselves.
      expect(renderSiteAccessibilitySection(sidecar)).not.toContain("sa-wcag-note");
      const clean = {
        ...ariShaped,
        outstanding: { total: 0, bySeverity: { critical: 0, serious: 0, moderate: 0, minor: 0 }, byWcag: { A: 0, AA: 0, AAA: 0, bestPractice: 0 }, needsReview: 0 },
      };
      expect(renderSiteAccessibilitySection(clean)).not.toContain("sa-wcag-note");
    });

    it("clarifies that needs-review items are not violations", () => {
      const html = renderSiteAccessibilitySection(ariShaped);
      expect(html).toContain("Needs review (manual): 500");
      expect(html).toContain("checks a human must confirm; not counted as violations");
    });
  });

  // v1.59.2 — the severity card explains itself too: each level carries a
  // plain-language gloss, and a footer note says severity = user impact
  // (axe's rating), independent of WCAG conformance level.
  describe("self-explanatory severity card (v1.59.2)", () => {
    it("glosses all four severity levels in plain language", () => {
      const html = renderSiteAccessibilitySection(sidecar);
      expect(html).toContain("blocks some users entirely");
      expect(html).toContain("a major barrier, hard to work around");
      expect(html).toContain("frustrating, but usable with effort");
      expect(html).toContain("an annoyance");
      const glosses = html.match(/class="sa-sev-gloss"/g) || [];
      expect(glosses.length).toBe(4);
    });

    it("explains that severity is user impact, independent of WCAG level", () => {
      const html = renderSiteAccessibilitySection(sidecar);
      expect(html).toContain('<p class="sa-sev-note">');
      expect(html).toContain("how badly an issue affects a person who encounters it");
      expect(html).toContain("independent of WCAG level");
      expect(html).toContain("Outstanding by WCAG level");
    });
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

// FC-2026-043 (2026-08-24 audit): the per-page score is interpolated into a
// table cell; a non-numeric score from a malformed sidecar must be escaped,
// not rendered as live HTML.
describe("renderSiteAccessibilitySection — per-page score escaping (FC-2026-043)", () => {
  it("escapes a non-numeric per-page score instead of emitting raw HTML", () => {
    const html = renderSiteAccessibilitySection({
      score: 90,
      grade: "A",
      coverage: { pagesInSet: 1, scored: 1 },
      pages: [{ url: "https://x/a", score: "<img src=x onerror=alert(1)>", grade: "A", violationCount: 0, needsReview: 0 }],
    });
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
