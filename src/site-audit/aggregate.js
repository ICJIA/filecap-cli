import { wcagLevelForTags } from "./wcag.js";

// Fixed grade bands mirroring audit.icjia.app's per-page bands, so a site's
// averaged grade stays consistent with the per-page grades in the table.
export function gradeForScore(score) {
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

// Aggregate the SUCCESSFULLY-scored pages into the headline score, the
// outstanding-issue breakdown, and per-page rows. Errored / capped pages are
// not passed here (the caller tracks them as coverage), so they never drag the
// mean toward zero.
export function aggregateSite(scoredPages) {
  const pages = Array.isArray(scoredPages) ? scoredPages : [];
  const bySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const byWcag = { A: 0, AA: 0, AAA: 0, bestPractice: 0 };
  let needsReview = 0;
  let scoreSum = 0;
  let scoredCount = 0;

  const pageRows = pages.map((p) => {
    if (typeof p?.score === "number") { scoreSum += p.score; scoredCount++; }
    for (const sev of Object.keys(bySeverity)) bySeverity[sev] += p?.bySeverity?.[sev] ?? 0;
    for (const v of p?.violations ?? []) {
      const level = wcagLevelForTags(v?.tags);
      if (level === "best-practice") byWcag.bestPractice++;
      else byWcag[level]++;
    }
    const pageNeedsReview = (p?.incomplete ?? []).length;
    needsReview += pageNeedsReview;
    return {
      url: p?.pageUrl ?? "",
      score: typeof p?.score === "number" ? p.score : null,
      grade: p?.grade ?? gradeForScore(p?.score),
      violationCount: typeof p?.violationCount === "number" ? p.violationCount : (p?.violations?.length ?? 0),
      bySeverity: { critical: 0, serious: 0, moderate: 0, minor: 0, ...(p?.bySeverity ?? {}) },
      needsReview: pageNeedsReview,
      reportUrl: p?.reportUrl ?? null,
    };
  });

  const total = bySeverity.critical + bySeverity.serious + bySeverity.moderate + bySeverity.minor;
  const score = scoredCount ? Math.round(scoreSum / scoredCount) : null;
  return {
    score,
    grade: gradeForScore(score),
    outstanding: { total, bySeverity, byWcag, needsReview },
    pages: pageRows,
  };
}
