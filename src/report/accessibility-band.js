// File-accessibility banding — the single source of truth for the directional
// "how far from accessible are this site's files" gauge shown on the homepage
// card, the per-site detail-page header, and (via bandForScore) the per-file
// Remediation Score cells. Keeping the thresholds + the low-data guard + the
// archive exclusion in one pure module means those three surfaces can never
// drift apart.
//
// Scope note: the per-file numeric score is the audit.icjia.app document
// score (0-100, higher = more accessible) and covers every machine-scoreable
// document — PDFs plus modern Office (docx/xlsx/pptx). Legacy Office
// binaries and ODF/RTF are counted as remediable but cannot be
// machine-scored, so the average is over scored documents — callers surface
// the unscoreable count beside it. This is a directional gauge, NOT a
// fleet-wide compliance grade.

import { escapeHtml } from "../util/html.js";

// Bands ordered high → low so bandForScore() can return the first match.
// `color` is an abstract token ("green"/"yellow"/"red"); each surface maps it
// to its own CSS class.
export const A11Y_BANDS = [
  { key: "closer", label: "Closer to accessible", min: 80, color: "green" },
  { key: "partial", label: "Partial progress", min: 60, color: "yellow" },
  { key: "far", label: "Far from accessible", min: 0, color: "red" },
];

// An average over a handful of documents is noise — below this many scored
// documents we show a "not enough data yet" caption instead of a band.
export const MIN_SCORED_DOCS = 5;

// Site slugs whose file-accessibility score is suppressed (no card gauge, no
// fleet-average contribution). Kept as the mechanism; currently empty.
//
// History: archive-prod sat here from v1.36.0 ("intentional ADA Title II
// exceptions, will always score abysmally"), was removed from the roster
// entirely on 2026-08-12, then re-added WITH full scoring on 2026-08-16
// (v1.45.0) — the archive still serves live files that may need remediation,
// so its scores count like any other site's.
export const A11Y_SCORE_EXCLUDE_SLUGS = [];

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
 * @param {number} [args.auditScoreSum]   sum of scored-document scores
 * @param {number} [args.auditedDocCount] documents with a numeric score
 * @param {number} [args.auditErrorCount] documents that failed to score
 * @param {number} [args.auditPending]    documents not yet scored
 * @param {number} [args.unscoreable]     remediable files that can't be machine-scored (legacy Office, ODF/RTF)
 * @param {number} [args.remediable]      total remediable files (PDF + Office)
 * @param {string} [args.siteSlug]        site `name` slug (for archive exclusion)
 * @returns {{excluded:boolean, avg:number|null, scored:number, docs:number,
 *   remediable:number, unscoreable:number, band:object|null, enoughData:boolean}}
 */
export function summarizeFileA11y({
  auditScoreSum = 0,
  auditedDocCount = 0,
  auditErrorCount = 0,
  auditPending = 0,
  unscoreable = 0,
  remediable = 0,
  siteSlug = "",
} = {}) {
  const scored = auditedDocCount;
  const docs = scored + auditErrorCount + auditPending;
  // v1.39.0: clamp a rounded-up 100 to 99 unless every scored document
  // really is a 100 (sum === scored × 100).
  let avg = scored > 0 ? Math.round(auditScoreSum / scored) : null;
  if (avg === 100 && auditScoreSum < scored * 100) avg = 99;
  const excluded = A11Y_SCORE_EXCLUDE_SLUGS.includes(siteSlug);
  const enoughData = scored >= MIN_SCORED_DOCS;
  const band = !excluded && enoughData && avg !== null ? bandForScore(avg) : null;
  return { excluded, avg, scored, docs, remediable, unscoreable, band, enoughData };
}

/**
 * One-line coverage caption for the average: how many remediable files actually
 * carry a score, how many are legacy Office (unscoreable), and the explicit
 * "remediable files only, not all files" scope. Shared by the homepage card and
 * the detail-page banner so both read identically. Plain text — callers escape.
 * @param {{scored:number, remediable:number, unscoreable:number}} a
 * @returns {string}
 */
export function fileA11yCoverageText(a) {
  const parts = [
    `${a.scored.toLocaleString()} of ${a.remediable.toLocaleString()} remediable files scored`,
  ];
  if (a.unscoreable > 0) {
    parts.push(
      `${a.unscoreable.toLocaleString()} legacy Office ${a.unscoreable === 1 ? "file" : "files"} can't be machine-scored (re-save as .docx/.xlsx/.pptx to score them)`,
    );
  }
  return `${parts.join(" · ")} — remediable files only, not all files.`;
}

/**
 * Caption for the thin-data state (fewer than MIN_SCORED_DOCS scored). The old
 * "(1 / 1)" ratio read like a bug — all documents scored, yet "not enough" — so
 * this spells out the reason: the site simply has too few documents for a
 * stable average. Shared by the homepage card and the detail-page banner.
 * Plain text.
 * @param {{scored:number, docs:number}} a - summarizeFileA11y() result
 * @returns {string}
 */
export function fileA11yThinDataText(a) {
  if (!a.docs) return "No scoreable documents on this site.";
  const tail = `too few for a reliable score (needs ${MIN_SCORED_DOCS}).`;
  if (a.scored >= a.docs) {
    return `Only ${a.docs.toLocaleString()} document${a.docs === 1 ? "" : "s"} on this site — ${tail}`;
  }
  return `Only ${a.scored.toLocaleString()} of ${a.docs.toLocaleString()} documents scored so far — ${tail}`;
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
