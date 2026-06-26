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
});
