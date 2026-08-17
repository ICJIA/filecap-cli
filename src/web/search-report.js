// v1.51.0 — the /search page's custom-report store.
//
// A visitor builds a custom report by selecting results — from any number of
// different searches — and adding them to a running list that survives
// leaving and returning to the page. Lifetime is the browser SESSION only:
// the page glue persists the report in sessionStorage (per-tab, cleared when
// the tab closes), and offers keep-or-clear on return. Everything decidable
// lives here as pure functions; the page owns only the get/setItem calls and
// the DOM.
//
// Every function is pure and self-contained (no imports, no closures):
// searchReportClientSource() embeds them verbatim into search.html's inline
// <script> — same .toString() pattern as search-xlsx.js — so the unit-tested
// functions ARE the shipped ones.

/** sessionStorage key for the report envelope (page-side constant). */
export const SEARCH_REPORT_STORAGE_KEY = "fleet-audit:custom-report";

/**
 * Stable identity for a report row: the file's public URL when the scan
 * resolved one, else a composite of the fields that make a listing unique.
 * Rows found again by a different search are the SAME row.
 */
function srRowKey(row) {
  var r = row || {};
  if (r.fileUrl) return String(r.fileUrl);
  return [r.site, r.filename, r.sizeBytes, r.modified]
    .map(function (v) { return String(v === null || v === undefined ? "" : v); })
    .join("\\u0000");
}

/**
 * Merge incoming rows into an existing report: existing order preserved, new
 * rows appended in the order given, duplicates (already in the report, or
 * repeated within the batch) skipped — the first-found row keeps its
 * provenance (`query`, `matchedOn`). A row cap keeps the report inside
 * sessionStorage's ~5 MB budget.
 *
 * @param {Array<object>} existing - current report rows
 * @param {Array<object>} incoming - rows to add
 * @param {number} [max=5000]      - total-row cap
 * @returns {{rows: Array<object>, added: number, duplicates: number, dropped: number}}
 */
function srAddRows(existing, incoming, max) {
  var cap = typeof max === "number" && max > 0 ? max : 5000;
  var rows = (existing || []).slice();
  var seen = {};
  for (var i = 0; i < rows.length; i++) seen[" " + srRowKey(rows[i])] = true;
  var added = 0;
  var duplicates = 0;
  var dropped = 0;
  var inc = incoming || [];
  for (var j = 0; j < inc.length; j++) {
    var key = " " + srRowKey(inc[j]);
    if (seen[key]) { duplicates++; continue; }
    if (rows.length >= cap) { dropped++; continue; }
    seen[key] = true;
    rows.push(inc[j]);
    added++;
  }
  return { rows: rows, added: added, duplicates: duplicates, dropped: dropped };
}

/** Remove the row whose srRowKey matches `key`. Returns a new array. */
function srRemoveRow(rows, key) {
  var out = [];
  var list = rows || [];
  for (var i = 0; i < list.length; i++) {
    if (srRowKey(list[i]) !== key) out.push(list[i]);
  }
  return out;
}

/** The stored envelope: versioned so a future shape change can't misread. */
function srSerializeReport(rows) {
  return JSON.stringify({ v: 1, rows: rows || [] });
}

/**
 * Read a report back from stored text. Anything unreadable — null, garbage
 * JSON, an unknown envelope version, malformed rows — degrades to an empty
 * report rather than a broken page.
 */
function srParseStored(text) {
  if (!text) return [];
  var parsed;
  try { parsed = JSON.parse(text); } catch (e) { return []; }
  if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.rows)) return [];
  var out = [];
  for (var i = 0; i < parsed.rows.length; i++) {
    var r = parsed.rows[i];
    if (r && typeof r === "object" && typeof r.filename === "string") out.push(r);
  }
  return out;
}

/** Filename for the report download: custom-report-20260817.xlsx */
function srReportXlsxName(dateIso) {
  var date = String(dateIso === null || dateIso === undefined ? "" : dateIso)
    .slice(0, 10)
    .replace(/-/g, "");
  return "custom-report-" + date + ".xlsx";
}

export { srRowKey, srAddRows, srRemoveRow, srSerializeReport, srParseStored, srReportXlsxName };

/**
 * The report store as inline-<script> source, embedded verbatim into
 * search.html so the tested functions are exactly what the browser runs.
 */
export function searchReportClientSource() {
  return [srRowKey, srAddRows, srRemoveRow, srSerializeReport, srParseStored, srReportXlsxName]
    .map(function (fn) { return fn.toString(); })
    .join("\n");
}
