// 1.7.37 — Centralised time-formatting helpers. Every user-visible
// timestamp in the bundle is displayed in Chicago time (America/Chicago,
// DST-aware) so ICJIA managers, auditors, and remediation vendors don't
// have to mentally convert from UTC. Raw NDJSON timestamps remain ISO
// 8601 UTC (that's the on-disk wire format); these helpers convert at
// the rendering layer only.
//
// 1.7.38 — Display format updated for clarity across mixed-timezone
// audiences. Remediation vendors are often in Eastern or Mountain time
// and need to know the exact offset to compute their local equivalent.
// Three signals on every timestamp:
//   - 12-hour clock with AM/PM (most familiar to US readers)
//   - CDT or CST abbreviation (Intl-derived; DST-aware automatically)
//   - "(Chicago time)" plain-English clarifier
// Example: "May 13, 1:21 PM CDT (Chicago time)".

const CHICAGO = "America/Chicago";

/**
 * Pull the time-zone short-name part ("CDT" / "CST") for a given
 * Date instance, evaluated in America/Chicago. DST handling is
 * automatic.
 */
function chicagoTzAbbr(d) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: CHICAGO,
      timeZoneName: "short",
    }).formatToParts(d);
    const tz = parts.find((p) => p.type === "timeZoneName");
    return tz?.value ?? "";
  } catch {
    return "";
  }
}

/**
 * "May 13, 1:21 PM CDT (Chicago time)" — compact date + 12-hour time
 * used in the cross-server duplicates "Newest → oldest" column and
 * any other compact context.
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
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
    const tz = chicagoTzAbbr(d);
    return `${datePart}, ${timePart} ${tz} (Chicago time)`;
  } catch {
    return "";
  }
}

/**
 * "May 13, 2026" — date-only display used in "Last audit:" captions
 * and the sticky-nav last-audit chip on per-site detail pages. No
 * time component; calendar day is evaluated in Chicago tz so the
 * date matches what an ICJIA reader would call "today."
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
 * "2026-05-13 1:21 PM CDT (Chicago time)" — wire format for the page
 * footer "Generated …" stamp and the meta-grid "Scanned at:" row.
 * Uses ISO-like YYYY-MM-DD ordering on the date so timestamps sort
 * lexically.
 */
export function fmtChicagoGeneratedAt(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  try {
    const datePart = new Intl.DateTimeFormat("en-CA", {
      timeZone: CHICAGO,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    const timePart = new Intl.DateTimeFormat("en-US", {
      timeZone: CHICAGO,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
    const tz = chicagoTzAbbr(d);
    return `${datePart} ${timePart} ${tz} (Chicago time)`;
  } catch {
    return "";
  }
}
