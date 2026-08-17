// Per-site file-accessibility history — a time series of the average scored-document
// score, so improvement can be tracked ("since last audit") and graphed later.
// Persisted by web-rollup to the purge-safe <auditsBase>/<slug>/a11y-history.json
// (sibling of latest/ since v1.39.0); the logic here is pure (web-rollup does
// the I/O and stamps each point's `at`).

/**
 * Append a measurement to the history, but only when it differs from the last
 * recorded point (avg / scored / remediable) — so repeated rebuilds with the
 * same numbers don't pad the series with duplicates. Returns a NEW array.
 * @param {Array<object>} history
 * @param {{at:string, avg:number, scored:number, remediable:number}} point
 * @returns {Array<object>}
 */
export function appendA11yPoint(history, point) {
  const arr = Array.isArray(history) ? history.slice() : [];
  const last = arr[arr.length - 1];
  const changed =
    !last ||
    last.avg !== point.avg ||
    last.scored !== point.scored ||
    last.remediable !== point.remediable;
  if (changed) arr.push(point);
  return arr;
}

/**
 * Trend of the latest point vs the immediately preceding one. Null for a
 * baseline (fewer than 2 points). dir: "up" = score improved (higher is more
 * accessible), "down" = declined, "flat" = unchanged. sinceAt is the previous
 * point's timestamp (what the current value is being compared against).
 * @param {Array<{at:string, avg:number, scored?:number}>} history
 * @returns {{delta:number, dir:"up"|"down"|"flat", sinceAt:string}|null}
 */
export function a11yTrend(history) {
  const arr = Array.isArray(history) ? history : [];
  if (arr.length < 2) return null;
  const cur = arr[arr.length - 1];
  const prev = arr[arr.length - 2];
  // v1.39.0 sampling-shift suppression: when the scored-document sample differs
  // by more than 20% of the larger side between the two points, the avg
  // delta mostly measures WHICH PDFs got scored, not remediation — showing
  // it as an improvement/decline chip would mislead. Suppress the chip
  // (null, same as a baseline). Points without a numeric `scored` (never
  // written by filecap) fail the NaN comparison and behave as before.
  if (
    Math.abs(cur.scored - prev.scored) >
    0.2 * Math.max(cur.scored, prev.scored)
  ) {
    return null;
  }
  const delta = cur.avg - prev.avg;
  const dir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return { delta, dir, sinceAt: prev.at };
}
