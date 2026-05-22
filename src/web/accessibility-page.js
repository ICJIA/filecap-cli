// HTML emitter for the /accessibility page.
//
// Renders the bundle's current accessibility standing plus a chronological log
// of accessibility checks. Data comes from src/web/accessibility-log.js. Dark
// theme, consistent with the fleet index and the per-site reports.

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
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 1100px; margin: 0 auto; padding: 24px; color: #c9d1d9; background: #0d1117; }
  a { color: #4dabf7; text-decoration: underline; }
  a:hover { color: #74c0fc; }
  h1 { margin: 8px 0 4px; color: #f0f3f6; }
  h2 { margin: 32px 0 12px; color: #f0f3f6; font-size: 1.15rem; }
  .ax-back { font-size: 0.9rem; }
  .ax-intro { color: #9aa5b1; max-width: 70ch; line-height: 1.55; }
  .ax-status { margin: 20px 0 8px; border: 1px solid #21262d; border-radius: 10px; background: #161b22; padding: 18px 22px; }
  .ax-status h2 { margin: 0 0 14px; font-size: 1rem; }
  .ax-status-grid { display: flex; flex-wrap: wrap; gap: 14px 32px; }
  .ax-stat { min-width: 150px; }
  .ax-stat-val { font-size: 1.5rem; font-weight: 800; color: #3fb950; }
  .ax-stat-val.pending { color: #d29922; font-size: 1rem; font-weight: 700; }
  .ax-stat-val.text { color: #c9d1d9; font-size: 1rem; font-weight: 700; }
  .ax-stat-label { font-size: 0.78rem; color: #9aa5b1; text-transform: uppercase; letter-spacing: 0.4px; margin-top: 2px; }
  .ax-asof { margin-top: 14px; font-size: 0.82rem; color: #9aa5b1; }
  table.ax-log { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 0.86rem; }
  table.ax-log th, table.ax-log td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #21262d; vertical-align: top; }
  table.ax-log th { color: #f0f3f6; background: #161b22; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.4px; }
  table.ax-log td { color: #c9d1d9; }
  .ax-date { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .ax-src { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; }
  .ax-src-browser { background: #1f2a37; color: #93c5fd; }
  .ax-src-backend { background: #20342a; color: #84d99b; }
  .ax-vp { display: inline-block; margin-left: 6px; font-size: 0.72rem; color: #9aa5b1; }
  .ax-result { font-weight: 600; }
  .ax-status-pass { color: #56d364; }
  .ax-status-found { color: #e3b341; }
  .ax-status-fixed { color: #79c0ff; }
  .site-footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #21262d; font-size: 0.85rem; color: #9aa5b1; }
  .site-footer a { color: #9aa5b1; text-decoration: underline; }
  .site-footer a:hover { color: #c9d1d9; }
`;

function statusPanel(s) {
  const cs = s || {};
  const dtPending = /pending/i.test(String(cs.axeDevTools || ""));
  return `<section class="ax-status" aria-label="Current accessibility standing">
    <h2>Current standing</h2>
    <div class="ax-status-grid">
      <div class="ax-stat">
        <div class="ax-stat-val">${htmlEscape(cs.lighthouse)}</div>
        <div class="ax-stat-label">Lighthouse accessibility</div>
      </div>
      <div class="ax-stat">
        <div class="ax-stat-val">${htmlEscape(cs.axeCore)}</div>
        <div class="ax-stat-label">axe-core</div>
      </div>
      <div class="ax-stat">
        <div class="ax-stat-val${dtPending ? " pending" : ""}">${htmlEscape(cs.axeDevTools)}</div>
        <div class="ax-stat-label">axe DevTools</div>
      </div>
      <div class="ax-stat">
        <div class="ax-stat-val text">${htmlEscape(cs.viewports)}</div>
        <div class="ax-stat-label">Viewports audited</div>
      </div>
    </div>
    <div class="ax-asof">Verified as of ${htmlEscape(cs.asOf)}.</div>
  </section>`;
}

function logRow(e) {
  const entry = e || {};
  const src = entry.source === "browser" ? "browser" : "backend";
  const srcLabel = src === "browser" ? "browser" : "backend build";
  const status = ["pass", "found", "fixed"].includes(entry.status) ? entry.status : "pass";
  const vp = entry.viewport ? ` <span class="ax-vp">${htmlEscape(entry.viewport)}</span>` : "";
  const notes = entry.notes ? ` (${htmlEscape(entry.notes)})` : "";
  return `<tr>
    <td class="ax-date">${htmlEscape(entry.date)}</td>
    <td><span class="ax-src ax-src-${src}">${srcLabel}</span></td>
    <td>${htmlEscape(entry.tool)}</td>
    <td>${htmlEscape(entry.scope)}${vp}</td>
    <td><span class="ax-result ax-status-${status}">${htmlEscape(entry.result)}</span>${notes}</td>
  </tr>`;
}

/**
 * Render the /accessibility page.
 *
 * @param {object} args
 * @param {object} args.currentStatus - the verified standing for the status panel
 * @param {Array}  args.log           - accessibility-log entries, newest first
 * @returns {string} a complete HTML document
 */
export function generateAccessibilityPage({ currentStatus, log = [] }) {
  const rows = (Array.isArray(log) ? log : []).map(logRow).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Accessibility — ICJIA Fleet Audit</title>
  ${FAVICON}
  <style>${STYLES}</style>
</head>
<body>
<main>
  <p class="ax-back"><a href="index.html">&larr; Back to fleet index</a></p>
  <h1>Accessibility</h1>
  <p class="ax-intro">filecap audits other sites' accessibility — so the audit bundle holds itself to the same standard. This page shows its current accessibility standing and a running log of every check, from both browser (axe DevTools) and backend-build (axe-core, Lighthouse, contrastcap) tools.</p>
  ${statusPanel(currentStatus)}
  <h2>Audit log</h2>
  <table class="ax-log">
    <thead><tr>
      <th>Date</th><th>Source</th><th>Tool</th><th>Scope</th><th>Result</th>
    </tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</main>
<footer class="site-footer">
  <span>Generated by filecap — accessibility audit log</span>
  &nbsp;·&nbsp;
  <a href="https://github.com/ICJIA/filecap-cli" target="_blank" rel="noopener noreferrer">filecap on GitHub</a>
  &nbsp;·&nbsp;
  <a href="index.html">Fleet index</a>
</footer>
</body>
</html>
`;
}
