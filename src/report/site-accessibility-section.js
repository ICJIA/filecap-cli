// src/report/site-accessibility-section.js
// Detail-page "Website accessibility" section — the SiteImprove-style depth:
// score + grade, coverage, outstanding issues by severity AND WCAG level,
// needs-review, fixed/new trend, and a per-page table. Opens with the blunt
// statement that this is the SITE's score, independent of the file/PDF scores.

import { escapeHtml as esc, safeUrl as safeHttpUrl } from "../util/html.js";

export function renderSiteAccessibilitySection(siteAudit) {
  if (!siteAudit || typeof siteAudit.score !== "number") return "";
  const cov = siteAudit.coverage ?? {};
  const out = siteAudit.outstanding ?? {};
  const sev = out.bySeverity ?? {};
  const wcag = out.byWcag ?? {};
  const trend = siteAudit.trend;
  const pages = Array.isArray(siteAudit.pages) ? siteAudit.pages : [];

  const trendHtml = trend
    ? `<p class="sa-trend">Since the previous run: <strong>${(trend.fixed ?? 0).toLocaleString()} fixed</strong>, <strong>${(trend.new ?? 0).toLocaleString()} new</strong>, ${(trend.stillOpen ?? 0).toLocaleString()} still open.</p>`
    : `<p class="sa-trend">First run — no trend yet.</p>`;

  const pageRows = pages
    .slice()
    .sort((a, b) => (a.score ?? 101) - (b.score ?? 101))
    .map((p) => {
      const safeUrl = p.reportUrl ? safeHttpUrl(p.reportUrl) : null;
      const link = safeUrl
        ? `<a href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">report &rarr;</a>`
        : "";
      return `<tr><td>${esc(p.url)}</td><td>${p.score ?? "—"}</td><td>${esc(p.grade ?? "")}</td><td>${(p.violationCount ?? 0).toLocaleString()}</td><td>${(p.needsReview ?? 0).toLocaleString()}</td><td>${link}</td></tr>`;
    })
    .join("");

  return `<section class="site-accessibility" aria-labelledby="sa-heading">
  <div class="scope-head scope-head-website">
    <span class="scope-head-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><path d="M1.5 8h13"/><path d="M8 1.5c1.9 1.8 2.9 4 2.9 6.5S9.9 12.7 8 14.5C6.1 12.7 5.1 10.5 5.1 8S6.1 3.3 8 1.5z"/></svg></span>
    <div class="scope-head-text">
      <h2 id="sa-heading">Website accessibility</h2>
      <span class="scope-head-sub">Scores this site&#39;s web pages &mdash; not the files it publishes</span>
    </div>
  </div>
  <p class="sa-independence"><strong>This is the website&#39;s score — not its documents&#39;.</strong> It measures the accessibility of this site&#39;s <strong>web pages</strong> and says nothing about the <strong>files</strong> it publishes. The PDFs and Office documents are audited separately and may score far worse — or better. The two are measured independently and <strong>do not correlate</strong>.</p>
  <div class="sa-headline">
    <div class="sa-score"><span class="sa-num">${siteAudit.score}</span><span class="sa-grade">${esc(siteAudit.grade ?? "")}</span></div>
    <p class="sa-coverage">Scored <strong>${(cov.scored ?? 0).toLocaleString()}</strong> of ${(cov.pagesInSet ?? 0).toLocaleString()} pages${cov.capped ? ` (${cov.capped.toLocaleString()} not yet reached this run)` : ""}${cov.errored ? `, ${cov.errored.toLocaleString()} errored` : ""}.</p>
  </div>
  ${trendHtml}
  <div class="sa-breakdown">
    <div class="sa-card"><h3>Outstanding by severity</h3><ul>
      <li>Critical: <strong>${(sev.critical ?? 0).toLocaleString()}</strong></li>
      <li>Serious: <strong>${(sev.serious ?? 0).toLocaleString()}</strong></li>
      <li>Moderate: <strong>${(sev.moderate ?? 0).toLocaleString()}</strong></li>
      <li>Minor: <strong>${(sev.minor ?? 0).toLocaleString()}</strong></li>
    </ul></div>
    <div class="sa-card"><h3>Outstanding by WCAG level</h3><ul>
      <li>Level A: <strong>${(wcag.A ?? 0).toLocaleString()}</strong></li>
      <li>Level AA: <strong>${(wcag.AA ?? 0).toLocaleString()}</strong></li>
      <li class="sa-muted">AAA / best-practice: ${((wcag.AAA ?? 0) + (wcag.bestPractice ?? 0)).toLocaleString()} (outside the AA compliance target)</li>
      <li class="sa-muted">Needs review (manual): ${(out.needsReview ?? 0).toLocaleString()}</li>
    </ul></div>
  </div>
  <details class="sa-pages"><summary>Per-page scores (${pages.length.toLocaleString()})</summary>
    <table><thead><tr><th>Page</th><th>Score</th><th>Grade</th><th>Issues</th><th>Review</th><th></th></tr></thead><tbody>${pageRows}</tbody></table>
  </details>
</section>`;
}
