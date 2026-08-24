// Score-fetcher — posts a single PDF URL to audit.icjia.app's /api/audit-url
// endpoint and returns a fleet-friendly normalised result.
//
// The endpoint at https://audit.icjia.app/api/audit-url is purpose-built for
// fleet automation per its own source comment: "Designed for fleet-audit
// automation: one call per PDF returns the strict / practical grades plus a
// stable reportUrl that can be embedded in the fleet inventory's HTML / CSV
// output."
//
// As of audit.icjia.app v1.21+, `practical` is an alias of `strict`. We
// return only the strict-profile pair (the WCAG + IITAA §E205.4 score) +
// the report URL + the cache flag from the server.
//
// Auth model:
//   - audit.icjia.app currently runs with AUTH.REQUIRE_LOGIN=false →
//     anonymous mode. No Authorization header is needed.
//   - If `bearerToken` is supplied, it's sent as `Authorization: Bearer
//     <token>` for forward-compat with the eventual auth-on mode (PATs of
//     the form fap_<32hex>).
//
// Error handling:
//   - 5xx errors return null so the orchestrator can mark the entry as
//     unscored and continue the fleet run (a hot pdfAnalyzer queue or a
//     transient outage shouldn't fail the whole audit).
//   - 4xx errors (client misconfiguration, URL not allowed, etc.) throw
//     so misconfiguration surfaces immediately.
//
// The fetcher signature accepts an `auditEndpoint` URL + a baseline JSON
// fetcher so tests can simulate the HTTP layer without going to the
// network. The orchestrator constructs the live fetcher around global
// fetch.

export async function fetchAuditScore({
  pdfUrl,
  auditEndpoint,
  bearerToken,
  force = false,
  fetcher,
}) {
  if (typeof pdfUrl !== "string" || pdfUrl.length === 0) {
    throw new Error("fetchAuditScore: pdfUrl is required");
  }
  let parsed;
  try {
    parsed = new URL(pdfUrl);
  } catch {
    throw new Error(`fetchAuditScore: pdfUrl must be a valid URL (got ${JSON.stringify(pdfUrl)})`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `fetchAuditScore: pdfUrl must use http(s) scheme (got ${parsed.protocol})`,
    );
  }
  if (typeof auditEndpoint !== "string" || auditEndpoint.length === 0) {
    throw new Error("fetchAuditScore: auditEndpoint is required");
  }
  if (typeof fetcher !== "function") {
    throw new Error("fetchAuditScore: fetcher is required");
  }

  const body = { url: pdfUrl };
  if (force) body.force = true;

  const headers = { "Content-Type": "application/json" };
  if (typeof bearerToken === "string" && bearerToken.length > 0) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  let response;
  try {
    response = await fetcher(auditEndpoint, {
      method: "POST",
      // FC-2026-040: don't follow a redirect off the audit endpoint — the
      // bearer token must not travel to another origin. audit.icjia.app does
      // not redirect; a 3xx surfaces as an error the run records.
      redirect: "manual",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    // 5xx: transient server-side issue, return null so the orchestrator
    // can record "unscored" and continue without failing the run.
    if (/^HTTP 5\d\d/.test(err.message)) {
      return null;
    }
    // 4xx and everything else: surface to caller. 4xx usually means the
    // operator misconfigured the endpoint URL, sent a disallowed PDF host,
    // or hit the rate limit — all things they need to know about.
    throw err;
  }

  // The strict profile is the primary scoring output. As of audit-icjia-app
  // v1.21, practical is just an alias of strict; we ignore it.
  const strict = response?.strict ?? {};
  return {
    score: typeof strict.score === "number" ? strict.score : null,
    grade: typeof strict.grade === "string" ? strict.grade : null,
    reportUrl: response?.reportUrl ?? null,
    reportId: response?.reportId ?? null,
    reportExpiresAt: response?.reportExpiresAt ?? null,
    pageCount: typeof response?.pageCount === "number" ? response.pageCount : null,
    audited: response?.audited ?? null,
    cached: response?.cached === true,
  };
}
