// v1.40.0 — the ONE HTML-safety module. Before this file the identical escape
// function lived under five names in five generators (`he`, `htmlEscape` ×2,
// `esc` ×2) and the URL gate existed twice with different normalization
// behavior — five places a security fix had to land. Every generator now
// imports from here (alias the name locally if it keeps diffs smaller).

/**
 * Escape a value for safe insertion into HTML text or a QUOTED attribute.
 * null/undefined render as "" so template literals stay clean.
 * @param {*} s
 * @returns {string}
 */
export function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Gate for every `<a href="…">` emit site: returns the ORIGINAL string only
 * when it parses cleanly as http(s), else null — so a hostile value in
 * sites.json or scanned data (`javascript:alert(1)`) can only ever render as
 * inert text, never a clickable anchor. Callers emit a <span> on null.
 * (2026-05-13 audit finding #2.)
 * @param {*} url
 * @returns {string|null}
 */
export function safeUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return String(url);
  } catch {
    return null;
  }
}

/**
 * Same gate, but returns the NORMALIZED `URL.toString()` form — spaces and
 * special characters percent-encoded. The orphans page links raw server
 * filenames and needs the encoded form to actually resolve (v1.39.0).
 * Strings only: a non-string here is a caller bug, not a URL.
 * @param {*} s
 * @returns {string|null}
 */
export function safeUrlNormalized(s) {
  if (typeof s !== "string") return null;
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  } catch {
    /* fall through */
  }
  return null;
}

// Small clipboard-outline icon for the meta-grid copy buttons — one copy for
// the fleet index and the detail pages (was duplicated byte-for-byte).
export const COPY_ICON_SVG = '<svg class="meta-copy-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4.25" y="3.25" width="8.5" height="10.5" rx="1.25"/><path d="M10.75 3.25V2.75a1 1 0 0 0-1-1h-2.5a1 1 0 0 0-1 1v0.5"/></svg>';

/**
 * A value with a copy-to-clipboard button, as used in the tech-details /
 * meta grids. `displayHtml`, when given, must already be escaped by the
 * caller; `value` is escaped here for the data-copy attribute.
 * @param {string} value        raw value to copy
 * @param {string|null} displayHtml  pre-escaped display markup (defaults to escaped value)
 * @param {string} [label]      accessible label ("Copy <label> to clipboard")
 * @returns {string}
 */
export function copyableValue(value, displayHtml, label) {
  if (value === undefined || value === null || value === "") return "<span></span>";
  const display = displayHtml ?? escapeHtml(value);
  return `<span class="meta-value">${display}<button type="button" class="meta-copy" data-copy="${escapeHtml(value)}" aria-label="Copy ${escapeHtml(label || "value")} to clipboard" title="Copy to clipboard">${COPY_ICON_SVG}<span class="meta-copy-feedback" aria-hidden="true">Copied</span></button></span>`;
}
