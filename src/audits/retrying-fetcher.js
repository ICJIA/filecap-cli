// Retrying JSON fetcher — a drop-in replacement for the plain
// fetch-and-parse helper used by the PDF and page scorers. It exists for a
// single reason: audit.icjia.app enforces a 100-request/min per-IP limit,
// and a fleet run that scores a large batch of cold (never-cached) files
// sails past it. The endpoint then answers 429 Too Many Requests. The plain
// fetcher threw on the first 429, so every request over the ceiling became a
// permanent "error" entry for that run (a single archive content drop
// produced 987 such 429s).
//
// This wrapper sits at the HTTP layer — where the Response status and the
// Retry-After header are still visible — and waits the limiter out:
//   - 429 (rate limit) and transient 5xx (502/503/504) are retried.
//   - When the server sends Retry-After (seconds), we honor it exactly;
//     otherwise we fall back to capped exponential backoff.
//   - Any other non-2xx (404, 400, 401, …) throws immediately — those are
//     real, non-transient problems the operator needs to see.
//   - After maxRetries the last HTTP error is thrown, so a genuinely stuck
//     endpoint still surfaces instead of looping forever.
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
  if (raw == null) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return null;
}

function backoffMs({ attempt, baseDelayMs, maxDelayMs }) {
  return Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
}

export function createRetryingJsonFetcher({
  fetchImpl = globalThis.fetch,
  maxRetries = 5,
  baseDelayMs = 1000,
  maxDelayMs = 60000,
  sleep = defaultSleep,
  log = () => {},
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("createRetryingJsonFetcher: fetchImpl must be a function");
  }
  return async function retryingJsonFetcher(url, init) {
    let attempt = 0;
    while (true) {
      const response = await fetchImpl(url, init);
      if (response.ok) return response.json();

      const retryable = RETRYABLE_STATUSES.has(response.status);
      if (!retryable || attempt >= maxRetries) {
        throw new Error(
          `HTTP ${response.status} ${response.statusText} for ${url}`,
        );
      }

      const afterHeader = retryAfterMs(response);
      const delay =
        afterHeader != null
          ? Math.min(maxDelayMs, afterHeader)
          : backoffMs({ attempt, baseDelayMs, maxDelayMs });
      attempt++;
      log(
        `[audits] HTTP ${response.status} from ${url}; backing off ${delay}ms ` +
          `(retry ${attempt}/${maxRetries})`,
      );
      await sleep(delay);
    }
  };
}
