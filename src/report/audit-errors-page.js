// HTML emitter for the fleet "File errors" report.
//
// One dedicated page listing every file the audit step (or the scanner's
// content-type check) flagged as a problem, grouped by site. Sites with no
// errors are listed too, explicitly stated as clean. Data comes from
// collectAuditErrors() in ./audit-errors.js. Dark theme, consistent with the
// fleet index and the per-site reports.

import { humanizeBytes } from "./format.js";

function htmlEscape(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FAVICON = `<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%230d1117'/><path d='M12 9L12 23L23 16Z' fill='%23ffb000'/></svg>">`;

const STYLES = `
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 1180px; margin: 0 auto; padding: 24px; color: #c9d1d9; background: #0d1117; }
  a { color: #4dabf7; text-decoration: underline; }
  a:hover { color: #74c0fc; }
  h1 { margin: 8px 0 4px; color: #f0f3f6; }
  h2 { margin: 28px 0 10px; color: #f0f3f6; font-size: 1.1rem; }
  .fe-back { font-size: 0.9rem; }
  .fe-intro { color: #9aa5b1; max-width: 75ch; line-height: 1.55; }
  .fe-summary { margin: 16px 0 8px; padding: 14px 18px; border: 1px solid #21262d; border-radius: 10px; background: #161b22; font-size: 1rem; }
  .fe-summary.clean { color: #56d364; }
  .fe-summary.has-errors { color: #e3b341; }
  .fe-site { margin-top: 26px; }
  .fe-count { font-size: 0.8rem; color: #e3b341; font-weight: 600; }
  .fe-clean { color: #56d364; margin: 4px 0 0; }
  table.fe-table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 0.85rem; table-layout: fixed; }
  table.fe-table th, table.fe-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #21262d; vertical-align: top; overflow-wrap: anywhere; }
  table.fe-table th { color: #f0f3f6; background: #161b22; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.4px; }
  table.fe-table td { color: #c9d1d9; }
  table.fe-table th:nth-child(1), table.fe-table td:nth-child(1) { width: 26%; }
  table.fe-table th:nth-child(2), table.fe-table td:nth-child(2) { width: 7%; }
  table.fe-table th:nth-child(3), table.fe-table td:nth-child(3) { width: 9%; }
  table.fe-table th:nth-child(4), table.fe-table td:nth-child(4) { width: 22%; }
  table.fe-table th:nth-child(5), table.fe-table td:nth-child(5) { width: 36%; }
  .fe-err { color: #e3b341; font-family: ui-monospace, monospace; font-size: 0.8rem; }
  .site-footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #21262d; font-size: 0.85rem; color: #9aa5b1; }
  .site-footer a { color: #9aa5b1; text-decoration: underline; }
  .site-footer a:hover { color: #c9d1d9; }
`;

function errorRow(e) {
  const name = htmlEscape(e.filename);
  const fileCell = e.publicUrl
    ? `<a href="${htmlEscape(e.publicUrl)}" target="_blank" rel="noopener noreferrer">${name}</a>`
    : name;
  return `<tr>
    <td>${fileCell}</td>
    <td>${htmlEscape(e.extension || "—")}</td>
    <td>${htmlEscape(humanizeBytes(e.sizeBytes || 0))}</td>
    <td class="fe-err">${htmlEscape(e.error || "—")}</td>
    <td>${htmlEscape(e.reason || "")}</td>
  </tr>`;
}

function siteSection(g) {
  const heading = htmlEscape(g.siteName);
  if (!g.errors || g.errors.length === 0) {
    return `<section class="fe-site">
    <h2>${heading}</h2>
    <p class="fe-clean">&#10003; No file errors.</p>
  </section>`;
  }
  const n = g.errors.length;
  return `<section class="fe-site">
    <h2>${heading} <span class="fe-count">${n} error${n === 1 ? "" : "s"}</span></h2>
    <table class="fe-table">
      <thead><tr>
        <th>File</th><th>Type</th><th>Size</th><th>Error</th><th>Likely reason</th>
      </tr></thead>
      <tbody>
${g.errors.map(errorRow).join("\n")}
      </tbody>
    </table>
  </section>`;
}

/**
 * Render the fleet "File errors" page.
 *
 * @param {object} args
 * @param {Array} args.groups - output of collectAuditErrors()
 * @param {string} [args.backHref] - relative href for the back link
 * @returns {string} a complete HTML document
 */
export function generateAuditErrorsPage({ groups = [], backHref = "index.html" }) {
  const list = Array.isArray(groups) ? groups : [];
  const totalErrors = list.reduce((s, g) => s + (g.errors?.length || 0), 0);
  const sitesWithErrors = list.filter((g) => (g.errors?.length || 0) > 0).length;
  const sitePlural = list.length === 1 ? "" : "s";
  const summary =
    totalErrors === 0
      ? `<div class="fe-summary clean">&#10003; No file errors anywhere in the fleet — every one of the ${list.length} site${sitePlural} is clean.</div>`
      : `<div class="fe-summary has-errors">${totalErrors} errored file${totalErrors === 1 ? "" : "s"} across ${sitesWithErrors} of ${list.length} site${sitePlural}.</div>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>File errors — ICJIA Fleet Audit</title>
  ${FAVICON}
  <style>${STYLES}</style>
</head>
<body>
<main>
  <p class="fe-back"><a href="${htmlEscape(backHref)}">&larr; Back to fleet index</a></p>
  <h1>File errors</h1>
  <p class="fe-intro">Files the accessibility audit could not score, or whose content does not match their extension. A 422 means the file is not actually a PDF; "could not process" usually means a very large PDF timed out — re-running the audit retries it. Every site is listed; sites with no problems are marked clean.</p>
  ${summary}
  ${list.map(siteSection).join("\n")}
</main>
<footer class="site-footer">
  <span>Generated by filecap — fleet file-errors report</span>
  &nbsp;·&nbsp;
  <a href="${htmlEscape(backHref)}">Fleet index</a>
  &nbsp;·&nbsp;
  <a href="sites.html">Sites</a>
</footer>
</body>
</html>
`;
}
