import { describe, it, expect } from "vitest";
import {
  createRetryingJsonFetcher,
  formatThrottleSummary,
} from "../src/audits/retrying-fetcher.js";

// ---------------------------------------------------------------------------
// Throttle accounting: a run that spends its wall-clock parked on 429s must say
// so, rather than presenting as a slow or broken audit server (2026-08-12).
// ---------------------------------------------------------------------------

function jsonResponse(body = { ok: true }) {
  return { ok: true, status: 200, json: async () => body };
}

function rateLimited({ retryAfter = "1" } = {}) {
  return {
    ok: false,
    status: 429,
    statusText: "Too Many Requests",
    headers: { get: (h) => (h.toLowerCase() === "retry-after" ? retryAfter : null) },
  };
}

describe("throttle stats", () => {
  it("counts requests and records nothing when the run is never throttled", async () => {
    const fetcher = createRetryingJsonFetcher({
      fetchImpl: async () => jsonResponse(),
      sleep: async () => {},
    });
    await fetcher("https://audit.icjia.app/api/audit-url", {});
    await fetcher("https://audit.icjia.app/api/audit-url", {});

    expect(fetcher.stats.requests).toBe(2);
    expect(fetcher.stats.rateLimited).toBe(0);
    expect(fetcher.stats.throttleMs).toBe(0);
    expect(formatThrottleSummary(fetcher.stats)).toBeNull();
  });

  it("accumulates 429 count and total wait across retries", async () => {
    let calls = 0;
    const fetcher = createRetryingJsonFetcher({
      // Two 429s telling us to wait 2s each, then success.
      fetchImpl: async () => {
        calls++;
        return calls <= 2 ? rateLimited({ retryAfter: "2" }) : jsonResponse();
      },
      sleep: async () => {},
    });
    await fetcher("https://audit.icjia.app/api/audit-url", {});

    expect(fetcher.stats.requests).toBe(3);
    expect(fetcher.stats.rateLimited).toBe(2);
    expect(fetcher.stats.serverDirectedWaits).toBe(2);
    expect(fetcher.stats.throttleMs).toBe(4000);
  });

  it("does not count a transient 503 as rate limiting", async () => {
    let calls = 0;
    const fetcher = createRetryingJsonFetcher({
      fetchImpl: async () => {
        calls++;
        return calls === 1
          ? { ok: false, status: 503, statusText: "Unavailable", headers: { get: () => null } }
          : jsonResponse();
      },
      sleep: async () => {},
      baseDelayMs: 1,
    });
    await fetcher("https://audit.icjia.app/api/audit-url", {});

    expect(fetcher.stats.rateLimited).toBe(0);
    expect(fetcher.stats.transientRetries).toBe(1);
  });
});

describe("formatThrottleSummary", () => {
  const throttled = { requests: 100, rateLimited: 40, throttleMs: 600_000 };

  it("names the anonymous ceiling and how to raise it", () => {
    const line = formatThrottleSummary(throttled, { authenticated: false });
    expect(line).toContain("rate-limited 40 time(s)");
    expect(line).toContain("across 100 request(s)");
    expect(line).toContain("ANONYMOUS");
    expect(line).toContain("500/hour");
    expect(line).toContain("AUDIT_ICJIA_TOKEN");
  });

  it("names the privileged ceiling and omits the token hint when authenticated", () => {
    const line = formatThrottleSummary(throttled, { authenticated: true });
    expect(line).toContain("privileged tier");
    expect(line).toContain("5000/hour");
    expect(line).not.toContain("AUDIT_ICJIA_TOKEN");
  });

  it("reports the wait in both seconds and minutes", () => {
    const line = formatThrottleSummary(throttled, { authenticated: true });
    expect(line).toContain("~600s");
    expect(line).toContain("10.0 min");
  });

  it("returns null for missing stats (an injected test fetcher carries none)", () => {
    expect(formatThrottleSummary(undefined)).toBeNull();
    expect(formatThrottleSummary(null)).toBeNull();
  });
});
