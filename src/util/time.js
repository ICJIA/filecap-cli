// 1.7.37 — Centralised time-formatting helpers. Every user-visible
// timestamp in the bundle is displayed in Chicago time (America/Chicago,
// DST-aware) so ICJIA managers, auditors, and remediation vendors don't
// have to mentally convert from UTC. Raw NDJSON timestamps remain ISO
// 8601 UTC (that's the on-disk wire format); these helpers convert at
// the rendering layer only.
//
// All three helpers explicitly emit "Chicago time" as the trailing
// label so the timezone is unambiguous to non-technical readers — no
// CDT/CST abbreviations to decode.

const CHICAGO = "America/Chicago";

/**
 * "May 13, 16:05 Chicago time" — compact date + 24-hour time used in
 * the cross-server duplicates "Newest → oldest" column.
 */
export function fmtChicagoDateTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const datePart = new Intl.DateTimeFormat("en-US", {
      timeZone: CHICAGO,
      month: "short",
      day: "numeric",
    }).format(d);
    const timePart = new Intl.DateTimeFormat("en-US", {
      timeZone: CHICAGO,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
    return `${datePart}, ${timePart} Chicago time`;
  } catch {
    return "";
  }
}

/**
 * "May 13, 2026" — date-only display used in "Last audit:" captions
 * and the sticky-nav last-audit chip on per-site detail pages.
 */
export function fmtChicagoDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-US", {
      timeZone: CHICAGO,
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(d);
  } catch {
    return "";
  }
}

/**
 * "2026-05-13 12:03 Chicago time" — wire format for the page footer
 * "Generated …" stamp and the meta-grid "Scanned at:" row. Uses
 * ISO-like YYYY-MM-DD ordering so timestamps sort lexically.
 */
export function fmtChicagoGeneratedAt(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  try {
    // en-CA emits YYYY-MM-DD ordering by default.
    const datePart = new Intl.DateTimeFormat("en-CA", {
      timeZone: CHICAGO,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    const timePart = new Intl.DateTimeFormat("en-US", {
      timeZone: CHICAGO,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
    return `${datePart} ${timePart} Chicago time`;
  } catch {
    return "";
  }
}
