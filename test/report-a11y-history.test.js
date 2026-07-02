import { describe, it, expect } from "vitest";
import { appendA11yPoint, a11yTrend } from "../src/report/a11y-history.js";

describe("appendA11yPoint", () => {
  it("records the first point", () => {
    const out = appendA11yPoint([], { at: "2026-06-01T00:00:00Z", avg: 61, scored: 40, remediable: 50 });
    expect(out).toHaveLength(1);
    expect(out[0].avg).toBe(61);
  });

  it("appends when the measurement changed", () => {
    const hist = [{ at: "A", avg: 61, scored: 40, remediable: 50 }];
    const out = appendA11yPoint(hist, { at: "B", avg: 67, scored: 42, remediable: 48 });
    expect(out).toHaveLength(2);
    expect(out[1].avg).toBe(67);
  });

  it("does NOT append when avg, scored, and remediable are unchanged (dedup)", () => {
    const hist = [{ at: "A", avg: 67, scored: 42, remediable: 48 }];
    const out = appendA11yPoint(hist, { at: "B", avg: 67, scored: 42, remediable: 48 });
    expect(out).toHaveLength(1);
    expect(out[0].at).toBe("A");
  });

  it("appends when only the remediable count changed (e.g. files moved to archive)", () => {
    const hist = [{ at: "A", avg: 67, scored: 42, remediable: 48 }];
    const out = appendA11yPoint(hist, { at: "B", avg: 67, scored: 42, remediable: 40 });
    expect(out).toHaveLength(2);
  });

  it("does not mutate the input array", () => {
    const hist = [{ at: "A", avg: 61, scored: 40, remediable: 50 }];
    appendA11yPoint(hist, { at: "B", avg: 67, scored: 42, remediable: 48 });
    expect(hist).toHaveLength(1);
  });
});

describe("a11yTrend", () => {
  it("returns null for a baseline (fewer than 2 points)", () => {
    expect(a11yTrend([])).toBeNull();
    expect(a11yTrend([{ at: "A", avg: 61 }])).toBeNull();
  });

  it("reports an improvement (higher score) as up, against the previous point's date", () => {
    const t = a11yTrend([{ at: "2026-06-01", avg: 61 }, { at: "2026-06-12", avg: 67 }]);
    expect(t).toEqual({ delta: 6, dir: "up", sinceAt: "2026-06-01" });
  });

  it("reports a decline as down", () => {
    const t = a11yTrend([{ at: "2026-06-01", avg: 70 }, { at: "2026-06-12", avg: 64 }]);
    expect(t.delta).toBe(-6);
    expect(t.dir).toBe("down");
  });

  it("reports an equal score as flat", () => {
    const t = a11yTrend([{ at: "A", avg: 70, remediable: 50 }, { at: "B", avg: 70, remediable: 40 }]);
    expect(t.dir).toBe("flat");
    expect(t.delta).toBe(0);
  });

  it("compares the latest point to the immediately preceding one", () => {
    const t = a11yTrend([{ at: "A", avg: 50 }, { at: "B", avg: 61 }, { at: "C", avg: 67 }]);
    expect(t.delta).toBe(6); // 67 vs 61, not vs 50
    expect(t.sinceAt).toBe("B");
  });

  // v1.39.0: when the scored-PDF sample shifts by more than 20% between the
  // two compared points, the delta measures the sampling change, not
  // remediation — suppress the chip (null) rather than mislead.
  it("returns null when the scored sample shrank by more than 20%", () => {
    const t = a11yTrend([
      { at: "A", avg: 62, scored: 40 },
      { at: "B", avg: 65, scored: 12 },
    ]);
    expect(t).toBeNull();
  });

  it("returns null when the scored sample grew by more than 20%", () => {
    const t = a11yTrend([
      { at: "A", avg: 62, scored: 12 },
      { at: "B", avg: 65, scored: 40 },
    ]);
    expect(t).toBeNull();
  });

  it("keeps the chip for a close sample (40 → 41 scored)", () => {
    const t = a11yTrend([
      { at: "A", avg: 62, scored: 40 },
      { at: "B", avg: 65, scored: 41 },
    ]);
    expect(t).toEqual({ delta: 3, dir: "up", sinceAt: "A" });
  });

  it("keeps the chip at exactly a 20% sample shift (boundary)", () => {
    const t = a11yTrend([
      { at: "A", avg: 62, scored: 50 },
      { at: "B", avg: 65, scored: 40 }, // |50-40| = 10 = 0.2 × 50 — not over
    ]);
    expect(t).toEqual({ delta: 3, dir: "up", sinceAt: "A" });
  });
});
