// Scores-by-site summary — a manager-facing roll-up of document accessibility
// scoring, one row per site plus a fleet TOTAL row. Managers asking "give me
// the sites, all the files, and their scores" want this bird's-eye view, not
// just the 4,500-row master. It is a downloadable spreadsheet (not an on-page
// aggregate grade band — that display stays removed per the contested-scoring
// decision); the numbers here are per-site coverage + the A–F distribution.
//
// Input is the per-site `summary` objects computeSiteSummary() already
// produces, so this module is a pure transform with no I/O.

export const SCORES_BY_SITE_COLUMNS = [
  { key: "site", label: "Website" },
  { key: "remediable", label: "Remediable files", type: "number" },
  { key: "scoreable", label: "Documents scoreable", type: "number" },
  { key: "scored", label: "Documents scored", type: "number" },
  { key: "pctScored", label: "% scored", type: "number" },
  { key: "avgScore", label: "Avg score", type: "number" },
  { key: "a", label: "A", type: "number" },
  { key: "b", label: "B", type: "number" },
  { key: "c", label: "C", type: "number" },
  { key: "d", label: "D", type: "number" },
  { key: "f", label: "F", type: "number" },
  { key: "unscoreable", label: "Legacy Office (not scoreable)", type: "number" },
];

/**
 * @param {Array<{siteName: string, summary: object}>} sites
 * @returns {Array<object>} one row per site (sorted by remediable desc) plus a
 *   trailing fleet TOTAL row. avgScore is null when a site has no scored documents.
 */
export function buildScoresBySiteRows(sites) {
  const sorted = [...(sites ?? [])].sort(
    (a, b) => (b.summary?.remediable ?? 0) - (a.summary?.remediable ?? 0),
  );

  const totals = {
    remediable: 0, scoreable: 0, scored: 0, scoreSum: 0,
    a: 0, b: 0, c: 0, d: 0, f: 0, unscoreable: 0,
  };

  const rows = sorted.map(({ siteName, summary }) => {
    const s = summary ?? {};
    const g = s.byGrade ?? {};
    const scored = s.auditedDocCount ?? 0;
    const scoreable = scored + (s.auditErrorCount ?? 0) + (s.auditPending ?? 0);
    const scoreSum = s.auditScoreSum ?? 0;
    const unscoreable = s.unscoreableCount ?? 0;
    const remediable = s.remediable ?? 0;

    totals.remediable += remediable;
    totals.scoreable += scoreable;
    totals.scored += scored;
    totals.scoreSum += scoreSum;
    totals.a += g.A ?? 0;
    totals.b += g.B ?? 0;
    totals.c += g.C ?? 0;
    totals.d += g.D ?? 0;
    totals.f += g.F ?? 0;
    totals.unscoreable += unscoreable;

    return {
      site: siteName,
      remediable,
      scoreable,
      scored,
      pctScored: scoreable ? Math.round((100 * scored) / scoreable) : 0,
      avgScore: scored ? Math.round(scoreSum / scored) : null,
      a: g.A ?? 0,
      b: g.B ?? 0,
      c: g.C ?? 0,
      d: g.D ?? 0,
      f: g.F ?? 0,
      unscoreable,
    };
  });

  rows.push({
    site: "TOTAL (fleet)",
    remediable: totals.remediable,
    scoreable: totals.scoreable,
    scored: totals.scored,
    pctScored: totals.scoreable ? Math.round((100 * totals.scored) / totals.scoreable) : 0,
    avgScore: totals.scored ? Math.round(totals.scoreSum / totals.scored) : null,
    a: totals.a,
    b: totals.b,
    c: totals.c,
    d: totals.d,
    f: totals.f,
    unscoreable: totals.unscoreable,
  });

  return rows;
}
