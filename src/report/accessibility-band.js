// File-accessibility banding — the single source of truth for the directional
// "how far from accessible are this site's files" gauge shown on the homepage
// card, the per-site detail-page header, and (via bandForScore) the per-file
// Remediation Score cells. Keeping the thresholds + the low-data guard + the
// archive exclusion in one pure module means those three surfaces can never
// drift apart.
//
// Scope note: the only per-file numeric score that exists is the PDF audit
// score (audit.icjia.app, 0-100, higher = more accessible). Office files are
// counted as remediable but never scored, so the average is a *PDF* average —
// callers label it as such. This is a directional gauge, NOT a fleet-wide
// compliance grade (no fleet aggregate is derived here).

import { escapeHtml } from "../util/html.js";

// Bands ordered high → low so bandForScore() can return the first match.
// `color` is an abstract token ("green"/"yellow"/"red"); each surface maps it
// to its own CSS class.
export const A11Y_BANDS = [
  { key: "closer", label: "Closer to accessible", min: 80, color: "green" },
  { key: "partial", label: "Partial progress", min: 60, color: "yellow" },
  { key: "far", label: "Far from accessible", min: 0, color: "red" },
];

// An average over a handful of PDFs is noise — below this many scored PDFs we
// show a "not enough data yet" caption instead of a band.
export const MIN_SCORED_PDFS = 5;

// The long-term archive is exempt: many of its files are intentional ADA Title
// II exceptions, so it will always score abysmally. Hardcoded by site slug.
//
// 2026-08-12: archive-prod was removed from the roster entirely (archived files
// don't need remediation, so the site is out of audit scope), which makes this
// entry inert today. Kept as the mechanism — and because the per-file
// Remediation Score cells still band by score — so the exemption is already in
// place if the archive is ever re-added.
export const A11Y_SCORE_EXCLUDE_SLUGS = ["archive-prod"];

/**
 * Map a 0-100 score to its band. Returns null for a missing/non-numeric score
 * (e.g. an unscored file) so callers can render those unstyled.
 * @param {number|null|undefined} score
 * @returns {{key:string,label:string,min:number,color:string}|null}
 */
export function bandForScore(score) {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  for (const band of A11Y_BANDS) {
    if (score >= band.min) return band;
  }
  return A11Y_BANDS[A11Y_BANDS.length - 1];
}

/**
 * Summarize a site's file-accessibility posture from the per-site audit tallies
 * (the same fields computeSiteSummary() produces). Pure — takes plain numbers.
 *
 * @param {object} args
 * @param {number} [args.auditScoreSum]   sum of scored-PDF scores
 * @param {number} [args.auditedPdfCount] count of PDFs with a numeric score
 * @param {number} [args.auditErrorCount] PDFs that failed to score
 * @param {number} [args.auditPending]    PDFs not yet scored
 * @param {number} [args.remediable]      total remediable files (PDF + Office)
 * @param {string} [args.siteSlug]        site `name` slug (for archive exclusion)
 * @returns {{excluded:boolean, avg:number|null, scored:number, pdfs:number,
 *   remediable:number, band:object|null, enoughData:boolean}}
 */
export function summarizeFileA11y({
  auditScoreSum = 0,
  auditedPdfCount = 0,
  auditErrorCount = 0,
  auditPending = 0,
  remediable = 0,
  siteSlug = "",
} = {}) {
  const scored = auditedPdfCount;
  const pdfs = scored + auditErrorCount + auditPending;
  // v1.39.0: clamp a rounded-up 100 to 99 unless every scored PDF really is
  // a 100 (sum === scored × 100). 19×100 + 1×95 averages 99.75, and showing
  // "100" for a set that still contains a failing PDF is a false perfect.
  let avg = scored > 0 ? Math.round(auditScoreSum / scored) : null;
  if (avg === 100 && auditScoreSum < scored * 100) avg = 99;
  const excluded = A11Y_SCORE_EXCLUDE_SLUGS.includes(siteSlug);
  const enoughData = scored >= MIN_SCORED_PDFS;
  // Non-PDF remediable files (Office: docx/xlsx/pptx/legacy) — counted as
  // remediable but never scored, so the average can't cover them. Surfaced so
  // the UI can say "X of Y scored; Z non-PDF files have no score".
  const office = Math.max(0, remediable - pdfs);
  // band is suppressed for excluded sites and for thin data even though `avg`
  // may be computable — surfaces branch on `excluded`/`enoughData` for those.
  const band = !excluded && enoughData && avg !== null ? bandForScore(avg) : null;
  return { excluded, avg, scored, pdfs, remediable, office, band, enoughData };
}

/**
 * One-line coverage caption for the average: how many remediable files actually
 * carry a score, how many are non-PDF (Office, unscoreable), and the explicit
 * "remediable files only, not all files" scope. Shared by the homepage card and
 * the detail-page banner so both read identically. Plain text — callers escape.
 * @param {{scored:number, remediable:number, office:number}} a
 * @returns {string}
 */
export function fileA11yCoverageText(a) {
  const parts = [
    `${a.scored.toLocaleString()} of ${a.remediable.toLocaleString()} remediable files scored`,
  ];
  if (a.office > 0) {
    parts.push(
      `${a.office.toLocaleString()} non-PDF ${a.office === 1 ? "file has" : "files have"} no score`,
    );
  }
  return `${parts.join(" · ")} — remediable files only, not all files.`;
}

/**
 * Caption for the thin-data state (fewer than MIN_SCORED_PDFS scored). The old
 * "(1 / 1)" ratio read like a bug — all PDFs scored, yet "not enough" — so this
 * spells out the reason: the site simply has too few PDFs for a stable average.
 * Shared by the homepage card and the detail-page banner. Plain text.
 * @param {{scored:number, pdfs:number}} a - summarizeFileA11y() result
 * @returns {string}
 */
export function fileA11yThinDataText(a) {
  if (!a.pdfs) return "No PDFs on this site to score.";
  const tail = `too few for a reliable score (needs ${MIN_SCORED_PDFS}).`;
  if (a.scored >= a.pdfs) {
    return `Only ${a.pdfs.toLocaleString()} PDF${a.pdfs === 1 ? "" : "s"} on this site — ${tail}`;
  }
  return `Only ${a.scored.toLocaleString()} of ${a.pdfs.toLocaleString()} PDFs scored so far — ${tail}`;
}

/**
 * Infographic gauge markup for the score: a fixed red→amber→green track (the
 * band thresholds as colored zones, painted in CSS) with a marker dropped at
 * the score, so a manager reads the far→closer position at a glance without
 * reading the number. Identical on the card and the detail page. `a` is a
 * summarizeFileA11y() result with a non-null band (callers render it only in
 * the scored state).
 * @param {{avg:number, band:{label:string}|null}} a
 * @returns {string}
 */
export function fileA11yGaugeHtml(a) {
  const pct = Math.max(0, Math.min(100, Math.round(a.avg)));
  const label = escapeHtml(a.band ? a.band.label : "");
  return `<div class="a11y-gauge" role="img" aria-label="Score ${pct} of 100 — ${label}">`
    + `<div class="a11y-gauge-track"><span class="a11y-gauge-marker" style="left:${pct}%"></span></div></div>`;
}

/**
 * "Since last audit" trend chip — ▲/▼ + the point change + the date being
 * compared against (e.g. "▲ 6 since Jun 12"), or "no change since …" when flat.
 * Returns "" for a baseline (no prior point). `trend` is a11yTrend()'s result
 * with `sinceAt` already formatted into `sinceText` by the caller (web-rollup).
 * @param {{delta:number, dir:"up"|"down"|"flat", sinceText:string}|null} trend
 * @returns {string}
 */
export function fileA11yTrendChipHtml(trend) {
  if (!trend) return "";
  const { delta, dir, sinceText } = trend;
  if (dir === "flat") {
    return `<span class="a11y-trend a11y-trend-flat">no change since ${escapeHtml(sinceText)}</span>`;
  }
  const arrow = dir === "up" ? "▲" : "▼";
  return `<span class="a11y-trend a11y-trend-${dir}">${arrow} ${Math.abs(delta)} since ${escapeHtml(sinceText)}</span>`;
}
