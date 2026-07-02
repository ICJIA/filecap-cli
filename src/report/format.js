const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function humanizeBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`;
}

// 1.7.36 — Cells whose first character is in this set will, when the CSV is
// opened in Excel / Sheets / Numbers, be evaluated as a formula. A filename
// like `=cmd|'/c calc'!A1.pdf` or `+SUM(1+1).pdf` is the classic vector.
// OWASP-recommended remediation: prefix matching cells with an apostrophe
// (`'`), which the spreadsheet apps treat as a text-mode marker and strip
// on display, so the cell shows the filename unchanged but doesn't
// evaluate. Fixes 2026-05-13 audit finding #1.
const CSV_FORMULA_LEADING_CHARS = /^[=+\-@\t\r]/;
// Deliberate Excel text-formula cells (the SHA-256 hash column wraps the
// hex hash as `="<hash>"` to keep Excel from rendering hex-looking-like-
// scientific-notation values incorrectly). When the WHOLE cell matches
// that exact shape — `=` + `"` + non-quote/newline chars + `"` — we
// trust it and skip the apostrophe prefix.
const TRUSTED_EXCEL_TEXT_FORMULA = /^="[^"\n]*"$/;

export function csvCell(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (CSV_FORMULA_LEADING_CHARS.test(s) && !TRUSTED_EXCEL_TEXT_FORMULA.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function boolToYesNo(v) {
  if (v === true) return "Yes";
  if (v === false) return "No";
  return v;
}

/**
 * Build the public URL for an inventory entry — v1.7.40 precedence:
 * publicUrlBase (+ optional pathPrefix) + the per-segment percent-encoded
 * entry path; an https absolutePath (an old audit-static.sh GitHub URL,
 * /tree/ rewritten to /blob/) is only a fallback for legacy inventories
 * with no base. Extracted from audit-errors.js (D10) in the v1.39.0
 * post-audit pass so the LIVE orphan emitters (orphans-html + the
 * web-rollup orphans XLSX) share the exact same encoding — red-1 R2 showed
 * they still emitted raw URLs where "#" truncates at the fragment.
 *
 * @param {object} entry
 * @param {string|null|undefined} publicUrlBase
 * @param {string|null|undefined} pathPrefix
 * @returns {string} URL, or "" when nothing usable exists
 */
export function publicUrlFor(entry, publicUrlBase, pathPrefix) {
  const base = String(publicUrlBase ?? "").replace(/\/+$/, "");
  const p = String(entry?.path ?? entry?.filename ?? "").replace(/^\/+/, "");
  if (base && p) {
    const prefix = pathPrefix
      ? "/" + String(pathPrefix).replace(/^\/+|\/+$/g, "")
      : "";
    const encodedPath = p.split("/").map(encodeURIComponent).join("/");
    return `${base}${prefix}/${encodedPath}`;
  }
  const ap = String(entry?.absolutePath ?? "");
  if (/^https?:\/\//i.test(ap)) return ap.replace("/tree/", "/blob/");
  return "";
}
