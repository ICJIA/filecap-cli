import { describe, it, expect } from "vitest";
import { buildScoresBySiteRows, SCORES_BY_SITE_COLUMNS } from "../src/report/scores-by-site.js";

// v1.34.1: a manager-facing "scores by site" summary — one row per site with
// document score coverage + the A–F grade distribution, plus a fleet TOTAL row.
// Built from the per-site summaries computeSiteSummary already produces.

function summary({
  remediable = 0, scored = 0, errors = 0, pending = 0, scoreSum = 0,
  grades = {}, unscoreableCount = 0,
} = {}) {
  return {
    remediable,
    auditedDocCount: scored,
    auditErrorCount: errors,
    auditPending: pending,
    auditScoreSum: scoreSum,
    byGrade: { A: 0, B: 0, C: 0, D: 0, F: 0, ...grades },
    unscoreableCount,
  };
}

describe("buildScoresBySiteRows", () => {
  it("builds a per-site row with document totals, % scored, avg, and grade distribution", () => {
    const rows = buildScoresBySiteRows([
      {
        siteName: "Archive",
        summary: summary({
          remediable: 100, scored: 80, errors: 5, pending: 0,
          scoreSum: 80 * 40, grades: { F: 70, D: 10 }, unscoreableCount: 15,
        }),
      },
    ]);
    const a = rows[0];
    expect(a.site).toBe("Archive");
    expect(a.remediable).toBe(100);
    expect(a.scoreable).toBe(85); // 80 scored + 5 error + 0 pending
    expect(a.scored).toBe(80);
    expect(a.pctScored).toBe(94); // 80/85
    expect(a.avgScore).toBe(40); // 3200/80
    expect(a.f).toBe(70);
    expect(a.d).toBe(10);
    expect(a.unscoreable).toBe(15);
  });

  it("sorts sites by remediable count descending and appends a fleet TOTAL row", () => {
    const rows = buildScoresBySiteRows([
      { siteName: "Small", summary: summary({ remediable: 10, scored: 5, scoreSum: 5 * 60, grades: { A: 5 } }) },
      { siteName: "Big", summary: summary({ remediable: 200, scored: 100, scoreSum: 100 * 30, grades: { F: 100 } }) },
    ]);
    expect(rows.map((r) => r.site)).toEqual(["Big", "Small", "TOTAL (fleet)"]);
    const total = rows[rows.length - 1];
    expect(total.remediable).toBe(210);
    expect(total.scored).toBe(105);
    expect(total.a).toBe(5);
    expect(total.f).toBe(100);
    // weighted avg = (300 + 3000) / 105 = 31.4 → 31
    expect(total.avgScore).toBe(31);
  });

  it("handles a site with no scored documents without dividing by zero", () => {
    const rows = buildScoresBySiteRows([
      { siteName: "NoScores", summary: summary({ remediable: 5, scored: 0, unscoreableCount: 5 }) },
    ]);
    expect(rows[0].pctScored).toBe(0);
    expect(rows[0].avgScore).toBeNull();
    expect(rows[0].unscoreable).toBe(5);
  });

  it("exposes a column definition whose keys match the row shape", () => {
    const keys = SCORES_BY_SITE_COLUMNS.map((c) => c.key);
    expect(keys).toEqual(["site", "remediable", "scoreable", "scored", "pctScored", "avgScore", "a", "b", "c", "d", "f", "unscoreable"]);
  });
});
