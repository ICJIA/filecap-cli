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
      const n = typeof v?.nodeCount === "number" && v.nodeCount > 0
        ? v.nodeCount
        : (Array.isArray(v?.nodes) ? Math.max(1, v.nodes.length) : 1);
      const level = wcagLevelForTags(v?.tags);
      if (level === "best-practice") byWcag.bestPractice += n;
      else byWcag[level] += n;
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
  let score = scoredCount ? Math.round(scoreSum / scoredCount) : null;
  // v1.41.0 — no false perfect. Mirrors the guard summarizeFileA11y() has had
  // since v1.39.0. A large mostly-clean site rounds up trivially: infonet
  // averaged 99.6218 over 156 pages with 19 outstanding violations and
  // rendered a flat "100 (A)" directly above its own "19 outstanding issues"
  // breakdown. Two independent signals block the perfect score — a page that
  // scored below 100, or any outstanding violation at all (per-page rounding
  // can hide one inside a 100).
  if (score === 100 && (scoreSum < scoredCount * 100 || total > 0)) score = 99;
  return {
    score,
    grade: gradeForScore(score),
    outstanding: { total, bySeverity, byWcag, needsReview },
    pages: pageRows,
  };
}
