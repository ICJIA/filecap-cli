// Page-scorer — posts a referenced page URL to audit.icjia.app's
// /api/audit-url-page endpoint and returns a fleet-friendly normalised
// result.
//
// Companion to fetchAuditScore (which targets the PDF endpoint), built
// on the same response-shape conventions so the report layer can render
// PDF audits and page audits with the same chip pattern.
//
// audit.icjia.app's /api/audit-url-page renders the URL in headless
// Chromium, runs @axe-core/puppeteer against the live DOM, persists a
// shareable shared_reports row, and returns { axe: { score, grade,
// violationCount, bySeverity }, reportUrl, ... }.
//
// Error handling mirrors fetchAuditScore:
//   - 5xx + 504 (page-render timeout) return null so the orchestrator
//     can mark the page as unscored and continue the run.
//   - 4xx errors throw — usually means a misconfigured endpoint or a
//     URL the server's allowlist rejects.

// Normalise an axe violations[]/incomplete[] array down to the minimum filecap
// needs: rule id, impact, WCAG tags, and each node's CSS-selector target.
function normIssues(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((v) => ({
    id: typeof v?.id === "string" ? v.id : "",
    impact: typeof v?.impact === "string" ? v.impact : null,
    tags: Array.isArray(v?.tags) ? v.tags.filter((t) => typeof t === "string") : [],
    nodeCount: typeof v?.nodeCount === "number" ? v.nodeCount : (Array.isArray(v?.nodes) ? Math.max(1, v.nodes.length) : 1),
    nodes: Array.isArray(v?.nodes)
      ? v.nodes.map((n) => ({
          target:
            Array.isArray(n?.target)
              ? n.target
              : n?.target === null || n?.target === undefined
                ? []
                : [String(n.target)],
        }))
      : [],
  }));
}

export async function fetchPageAuditScore({
  pageUrl,
  auditEndpoint,
  bearerToken,
  force = false,
  fetcher,
}) {
  if (typeof pageUrl !== "string" || pageUrl.length === 0) {
    throw new Error("fetchPageAuditScore: pageUrl is required");
  }
  let parsed;
  try {
    parsed = new URL(pageUrl);
  } catch {
    throw new Error(
      `fetchPageAuditScore: pageUrl must be a valid URL (got ${JSON.stringify(pageUrl)})`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `fetchPageAuditScore: pageUrl must use http(s) scheme (got ${parsed.protocol})`,
    );
  }
  if (typeof auditEndpoint !== "string" || auditEndpoint.length === 0) {
    throw new Error("fetchPageAuditScore: auditEndpoint is required");
  }
  if (typeof fetcher !== "function") {
    throw new Error("fetchPageAuditScore: fetcher is required");
  }

  const body = { url: pageUrl };
  if (force) body.force = true;

  const headers = { "Content-Type": "application/json" };
  if (typeof bearerToken === "string" && bearerToken.length > 0) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  let response;
  try {
    response = await fetcher(auditEndpoint, {
      method: "POST",
      // FC-2026-040: same as the PDF scorer — don't follow a redirect off the
      // audit endpoint with the bearer token attached.
      redirect: "manual",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    // 5xx (server-side issue) and 504 (Puppeteer navigation timeout —
    // a slow / hung page) — return null so the orchestrator records
    // "unscored" and the fleet run keeps moving.
    if (/HTTP 5\d\d/.test(err.message)) {
      return null;
    }
    // 4xx and everything else: surface. 4xx usually means a disallowed
    // URL host, a bad request body, or a rate-limit hit — all things
    // the operator needs to see.
    throw err;
  }

  const axe = response?.axe ?? {};
  const bySeverity = axe.bySeverity ?? {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
  };
  return {
    score: typeof axe.score === "number" ? axe.score : null,
    grade: typeof axe.grade === "string" ? axe.grade : null,
    violationCount: typeof axe.violationCount === "number" ? axe.violationCount : 0,
    bySeverity,
    reportUrl: response?.reportUrl ?? null,
    reportId: response?.reportId ?? null,
    reportExpiresAt: response?.reportExpiresAt ?? null,
    pageTitle: response?.pageTitle ?? null,
    audited: response?.audited ?? null,
    cached: response?.cached === true,
    // v1.35.0 — per-rule detail when the enhanced endpoint provides it
    // (absent on the legacy endpoint → []). Drives the WCAG-level breakdown
    // and the issue-set fixed/new diff.
    violations: normIssues(axe.violations),
    incomplete: normIssues(axe.incomplete),
  };
}
