// Per-site file-accessibility history — a time series of the average scored-PDF
// score, so improvement can be tracked ("since last audit") and graphed later.
// Persisted by web-rollup to a purge-exempt latest/a11y-history.json; the logic
// here is pure (web-rollup does the I/O and stamps each point's `at`).

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
 * @param {Array<{at:string, avg:number}>} history
 * @returns {{delta:number, dir:"up"|"down"|"flat", sinceAt:string}|null}
 */
export function a11yTrend(history) {
  const arr = Array.isArray(history) ? history : [];
  if (arr.length < 2) return null;
  const cur = arr[arr.length - 1];
  const prev = arr[arr.length - 2];
  const delta = cur.avg - prev.avg;
  const dir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return { delta, dir, sinceAt: prev.at };
}
