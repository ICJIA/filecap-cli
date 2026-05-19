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
  };
}
