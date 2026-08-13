import { describe, it, expect } from "vitest";
import { aggregateSite, gradeForScore } from "../src/site-audit/aggregate.js";

const pageA = {
  pageUrl: "https://x.com/a", score: 100, grade: "A", violationCount: 0,
  bySeverity: { critical: 0, serious: 0, moderate: 0, minor: 0 },
  violations: [], incomplete: [{ id: "color-contrast" }], reportUrl: "r/a",
};
const pageB = {
  pageUrl: "https://x.com/b", score: 80, grade: "B", violationCount: 2,
  bySeverity: { critical: 0, serious: 1, moderate: 1, minor: 0 },
  violations: [
    { id: "color-contrast", tags: ["wcag2aa"], nodes: [{ target: ["h1"] }] },
    { id: "image-alt", tags: ["wcag2a"], nodes: [{ target: ["img"] }] },
  ],
  incomplete: [], reportUrl: "r/b",
};

describe("gradeForScore", () => {
  it("uses fixed bands mirroring the endpoint", () => {
    expect(gradeForScore(95)).toBe("A");
    expect(gradeForScore(85)).toBe("B");
    expect(gradeForScore(59)).toBe("F");
    expect(gradeForScore(null)).toBe(null);
  });
});

describe("aggregateSite", () => {
  it("averages page scores and rolls up the breakdown", () => {
    const out = aggregateSite([pageA, pageB]);
    expect(out.score).toBe(90); // mean(100, 80)
    expect(out.grade).toBe("A");
    expect(out.outstanding.total).toBe(2);
    expect(out.outstanding.bySeverity).toEqual({ critical: 0, serious: 1, moderate: 1, minor: 0 });
    expect(out.outstanding.byWcag).toEqual({ A: 1, AA: 1, AAA: 0, bestPractice: 0 });
    expect(out.outstanding.needsReview).toBe(1);
    expect(out.pages).toHaveLength(2);
    expect(out.pages[1]).toMatchObject({ url: "https://x.com/b", score: 80, reportUrl: "r/b" });
  });
  it("returns null score for zero scored pages", () => {
    const out = aggregateSite([]);
    expect(out.score).toBe(null);
    expect(out.grade).toBe(null);
    expect(out.outstanding.total).toBe(0);
  });

  // ── v1.41.0 — no false perfect ────────────────────────────────────────────
  // summarizeFileA11y() has clamped a rounded-up 100 to 99 since v1.39.0
  // ("showing 100 for a set that still contains a failing PDF is a false
  // perfect"). The SITE score never got the same guard, and the first real
  // fleet-wide site-audit run exposed it: infonet averaged 99.6218 across 156
  // pages with 19 outstanding violations and rendered as a flat 100 (A) —
  // directly above the "19 outstanding issues" breakdown on the same page.
  const perfect = (url) => ({
    pageUrl: url, score: 100, grade: "A", violationCount: 0,
    bySeverity: { critical: 0, serious: 0, moderate: 0, minor: 0 },
    violations: [], incomplete: [],
  });

  it("clamps a rounded-up 100 to 99 when any page scored below 100", () => {
    // 155 × 100 + 1 × 98 → 99.987 → rounds to 100. It is not 100.
    const pages = [...Array(155)].map((_, i) => perfect(`https://x.com/${i}`));
    pages.push({
      ...perfect("https://x.com/low"), score: 98, violationCount: 1,
      bySeverity: { critical: 0, serious: 0, moderate: 1, minor: 0 },
      violations: [{ id: "landmark", tags: ["wcag2a"], nodes: [{ target: ["div"] }] }],
    });
    const out = aggregateSite(pages);
    expect(out.score).toBe(99);
    expect(out.grade).toBe("A");
  });

  it("clamps to 99 when outstanding violations exist even if every page rounded to 100", () => {
    // Per-page rounding can hide a violation inside a 100. The outstanding
    // tally is the direct signal, so it independently blocks a perfect score.
    const pages = [
      perfect("https://x.com/a"),
      {
        ...perfect("https://x.com/b"), violationCount: 1,
        bySeverity: { critical: 0, serious: 0, moderate: 0, minor: 1 },
        violations: [{ id: "region", tags: ["best-practice"], nodes: [{ target: ["main"] }] }],
      },
    ];
    const out = aggregateSite(pages);
    expect(out.outstanding.total).toBe(1);
    expect(out.score).toBe(99);
  });

  it("leaves a genuine 100 alone", () => {
    // dvfr/i2i/r3 really are clean — verified against an independent axe run.
    const out = aggregateSite([perfect("https://x.com/a"), perfect("https://x.com/b")]);
    expect(out.score).toBe(100);
    expect(out.grade).toBe("A");
    expect(out.outstanding.total).toBe(0);
  });

  it("does not touch scores that were never going to round to 100", () => {
    const out = aggregateSite([{ ...perfect("https://x.com/a"), score: 90 }]);
    expect(out.score).toBe(90);
  });
  it("counts nodes in byWcag, not violations, when nodeCount is present", () => {
    const pageC = {
      pageUrl: "https://x.com/c", score: 70, grade: "C", violationCount: 1,
      bySeverity: { critical: 0, serious: 4, moderate: 0, minor: 0 },
      violations: [{ id: "foo", tags: ["wcag2aa"], nodeCount: 4, nodes: [
        { target: [".a"] }, { target: [".b"] }, { target: [".c"] }, { target: [".d"] },
      ] }],
      incomplete: [], reportUrl: "r/c",
    };
    const out = aggregateSite([pageC]);
    expect(out.outstanding.byWcag.AA).toBe(4);
    expect(out.outstanding.byWcag.A).toBe(0);
    expect(Object.values(out.outstanding.byWcag).reduce((a, b) => a + b, 0)).toBe(out.outstanding.total);
  });
});
