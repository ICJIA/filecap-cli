// Retrying JSON fetcher — a drop-in replacement for the plain
// fetch-and-parse helper used by the PDF and page scorers. It exists for a
// single reason: audit.icjia.app rate-limits per IP, and a fleet run that
// scores a large batch of cold (never-cached) files sails past the ceiling.
// The endpoint then answers 429 Too Many Requests. The plain fetcher threw on
// the first 429, so every request over the ceiling became a permanent "error"
// entry for that run (a single archive content drop produced 987 such 429s).
//
// THE REAL POLICY (measured 2026-08-12): `ratelimit-policy: 500;w=3600` —
// 500 requests per HOUR, not the 100/min this module was originally written
// against. That difference matters enormously: an exhausted hourly budget
// answers `retry-after: 820` (or up to 3600), so a wait measured in MINUTES
// is the normal, expected path through a big cold batch — not an anomaly.
//
// This wrapper sits at the HTTP layer — where the Response status and the
// Retry-After header are still visible — and waits the limiter out:
//   - 429 (rate limit) and transient 5xx (502/503/504) are retried.
//   - v1.39.0: network-level fetch rejections (DNS, reset, timeout —
//     any rejection) are retried with the same backoff budget.
//   - When the server sends Retry-After (seconds), we honor it IN FULL, up
//     to maxRetryAfterMs. It is deliberately NOT clamped to maxDelayMs.
//   - A server-directed wait draws on its own budget (maxRateLimitWaits)
//     rather than maxRetries, because complying with a limiter is not
//     evidence of a stuck endpoint.
//   - A 429 with NO Retry-After header has no server guidance, so it falls
//     back to ordinary capped exponential backoff on the maxRetries budget.
//   - Any other non-2xx (404, 400, 401, …) throws immediately — those are
//     real, non-transient problems the operator needs to see.
//
// v1.41.0 — why the split budgets exist. Retry-After used to be clamped with
// `Math.min(maxDelayMs, afterHeader)`, i.e. 60s. Against a 500/hour policy
// that is pathological: the server says "come back in 820s", we come back in
// 60s into the same closed window, and six retries later (360s, still inside
// the window) we throw and mark the PDF permanently errored. The module's own
// docs already claimed we "honor it exactly" — the code just didn't. A cold
// 1,800-PDF grading run cannot finish inside one hourly window under ANY
// retry policy; it has to pace across several, and that is what this does.
//
// Honoring Retry-After is itself the throttle: once we trip the limit we
// pause until the server says the window has reset, which naturally paces
// the rest of the run under the cap. The shared httpFetcher means both the
// PDF scorer (fetchAuditScore) and the page scorer (fetchPageAuditScore)
// inherit this behavior with no change to either.

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Parse a Retry-After header value. The endpoint sends delta-seconds (the
// common form for 429); the HTTP-date form is ignored here (we fall back to
// backoff) to keep the delay deterministic and side-effect free.
function retryAfterMs(response) {
  const raw = response?.headers?.get?.("retry-after");
  if (raw === null || raw === undefined) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return null;
}

function backoffMs({ attempt, baseDelayMs, maxDelayMs }) {
  return Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
}

// A server-directed wait can legitimately be a whole rate-limit window. Cap
// it anyway so a malformed or hostile header can't park the run for a day;
// 15 min comfortably covers the observed 820s and any partial-hour reset.
const DEFAULT_MAX_RETRY_AFTER_MS = 15 * 60 * 1000;
// How many times one request may be told to come back later. 12 spans several
// hourly windows — enough for a cold fleet-sized batch to pace itself through
// without any single entry failing, while still bounding a wedged limiter.
const DEFAULT_MAX_RATE_LIMIT_WAITS = 12;

export function createRetryingJsonFetcher({
  fetchImpl = globalThis.fetch,
  maxRetries = 5,
  baseDelayMs = 1000,
  maxDelayMs = 60000,
  maxRetryAfterMs = DEFAULT_MAX_RETRY_AFTER_MS,
  maxRateLimitWaits = DEFAULT_MAX_RATE_LIMIT_WAITS,
  sleep = defaultSleep,
  log = () => {},
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("createRetryingJsonFetcher: fetchImpl must be a function");
  }
  // Throttle ledger for the end-of-run summary. Without it, a run that spent
  // most of its wall-clock parked on 429s is indistinguishable from a run
  // against a slow or broken server — which is exactly how the 2026-08-12
  // "audit server is offline" report started. Counted here because this is the
  // single choke point both scorers share.
  const stats = {
    requests: 0,
    rateLimited: 0,
    serverDirectedWaits: 0,
    transientRetries: 0,
    throttleMs: 0,
  };

  async function retryingJsonFetcher(url, init) {
    let attempt = 0;
    // Separate ledger for "the server told us when to come back". Kept apart
    // from `attempt` so a paced run can outlast a rate-limit window that is
    // far longer than the transient-error backoff budget.
    let rateLimitWaits = 0;
    while (true) {
      let response;
      try {
        stats.requests++;
        response = await fetchImpl(url, init);
      } catch (err) {
        // v1.39.0: a rejected fetch never produced a Response — DNS failure
        // (EAI_AGAIN), connection reset (ECONNRESET), timeout (ETIMEDOUT),
        // undici's generic TypeError "fetch failed". These are exactly as
        // transient as a 429/503, so ANY rejection retries with the same
        // backoff budget; after maxRetries the last error is rethrown.
        if (attempt >= maxRetries) throw err;
        const delay = backoffMs({ attempt, baseDelayMs, maxDelayMs });
        attempt++;
        log(
          `[audits] network error (${err?.message ?? err}) from ${url}; backing off ${delay}ms ` +
            `(retry ${attempt}/${maxRetries})`,
        );
        await sleep(delay);
        continue;
      }
      if (response.ok) return response.json();

      const retryable = RETRYABLE_STATUSES.has(response.status);
      const afterHeader = retryAfterMs(response);
      // Which budget applies depends on whether the SERVER set the pace. A
      // Retry-After is an instruction with a known end; a bare 429/5xx is a
      // guess, and guesses stay on the short transient-error budget.
      const serverDirected = retryable && afterHeader !== null;
      const exhausted = serverDirected
        ? rateLimitWaits >= maxRateLimitWaits
        : attempt >= maxRetries;
      if (!retryable || exhausted) {
        // v1.54.0 — the API's JSON error bodies say WHY ("legacy format…",
        // "could not be read…"). With Office formats in play a bare 422 is
        // ambiguous, so surface the reason; the status stays first so the
        // categorizer's \b4xx\b regexes keep matching. Best-effort: a
        // non-JSON body (proxy HTML, empty) keeps the plain status line.
        let detail = "";
        try {
          const body = await response.json();
          if (typeof body?.error === "string" && body.error.length > 0) {
            detail = ` — ${body.error}`;
          }
        } catch {
          // body unreadable — keep the plain status line
        }
        throw new Error(
          `HTTP ${response.status} ${response.statusText} for ${url}${detail}`,
        );
      }

      let delay;
      let progress;
      if (serverDirected) {
        delay = Math.min(maxRetryAfterMs, afterHeader);
        rateLimitWaits++;
        stats.serverDirectedWaits++;
        progress = `server-directed wait ${rateLimitWaits}/${maxRateLimitWaits}`;
      } else {
        delay = backoffMs({ attempt, baseDelayMs, maxDelayMs });
        attempt++;
        stats.transientRetries++;
        progress = `retry ${attempt}/${maxRetries}`;
      }
      if (response.status === 429) {
        stats.rateLimited++;
        stats.throttleMs += delay;
      }
      log(
        `[audits] HTTP ${response.status} from ${url}; backing off ${delay}ms (${progress})`,
      );
      await sleep(delay);
    }
  }

  // Exposed so the command layer can report throttling at end of run.
  retryingJsonFetcher.stats = stats;
  return retryingJsonFetcher;
}

/**
 * One-line human summary of a run's throttling, or null when nothing was
 * throttled. `authenticated` decides which tier's ceiling to name, so a run
 * that silently fell back to anonymous says so instead of looking like the
 * server misbehaved.
 */
export function formatThrottleSummary(stats, { authenticated = false } = {}) {
  if (!stats || stats.rateLimited === 0) return null;
  const seconds = Math.round(stats.throttleMs / 1000);
  const minutes = (seconds / 60).toFixed(1);
  const tier = authenticated
    ? "privileged tier (5000/hour, 1000/min)"
    : "ANONYMOUS tier (500/hour, 100/min)";
  const hint = authenticated
    ? ""
    : " Set AUDIT_ICJIA_TOKEN to run in the privileged tier — the anonymous ceiling is 10x lower.";
  return (
    `[audits] rate-limited ${stats.rateLimited} time(s) across ${stats.requests} request(s); ` +
    `waited ~${seconds}s (${minutes} min) in the ${tier}.${hint}`
  );
}
