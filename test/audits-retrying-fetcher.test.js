import { describe, it, expect } from "vitest";
import { createRetryingJsonFetcher } from "../src/audits/retrying-fetcher.js";

// 1.34.0: audit.icjia.app enforces a 100-req/min per-IP limit. When a fleet
// run scores a big batch of cold (never-cached) PDFs it blows past that
// ceiling and the endpoint returns 429 Too Many Requests. The base fetcher
// threw on the first 429, so every request past the limit was recorded as a
// permanent error (archive: 987 such errors after a content drop). This
// retrying wrapper sits at the HTTP layer (sees status + Retry-After) and is
// shared by both the PDF and page scorers, so a 429/transient-5xx is waited
// out and retried instead of failing the entry.

// Build a minimal Response-like object the fetcher understands.
function resp({ ok = false, status = 200, statusText = "", retryAfter, json = {} }) {
  return {
    ok,
    status,
    statusText,
    headers: {
      get: (name) =>
        String(name).toLowerCase() === "retry-after" ? retryAfter ?? null : null,
    },
    json: async () => json,
  };
}

describe("createRetryingJsonFetcher", () => {
  it("returns parsed JSON on a 2xx response without sleeping", async () => {
    const sleeps = [];
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return resp({ ok: true, status: 200, json: { strict: { score: 91, grade: "A" } } });
    };
    const fetcher = createRetryingJsonFetcher({
      fetchImpl,
      sleep: (ms) => { sleeps.push(ms); },
    });

    const out = await fetcher("https://audit.icjia.app/api/audit-url", { method: "POST" });

    expect(out).toEqual({ strict: { score: 91, grade: "A" } });
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("retries a 429 and returns JSON once the endpoint recovers", async () => {
    const sleeps = [];
    const seq = [
      resp({ status: 429, statusText: "Too Many Requests" }),
      resp({ status: 429, statusText: "Too Many Requests" }),
      resp({ ok: true, status: 200, json: { ok: true } }),
    ];
    let i = 0;
    const fetchImpl = async () => seq[i++];
    const fetcher = createRetryingJsonFetcher({
      fetchImpl,
      sleep: (ms) => { sleeps.push(ms); },
    });

    const out = await fetcher("https://audit.icjia.app/api/audit-url", {});

    expect(out).toEqual({ ok: true });
    expect(i).toBe(3); // 2 failures + 1 success
    expect(sleeps).toHaveLength(2);
  });

  it("honors a numeric Retry-After header (seconds → ms)", async () => {
    const sleeps = [];
    const seq = [
      resp({ status: 429, statusText: "Too Many Requests", retryAfter: "30" }),
      resp({ ok: true, status: 200, json: {} }),
    ];
    let i = 0;
    const fetcher = createRetryingJsonFetcher({
      fetchImpl: async () => seq[i++],
      sleep: (ms) => { sleeps.push(ms); },
      maxDelayMs: 120000,
    });

    await fetcher("https://x", {});

    expect(sleeps).toEqual([30000]);
  });

  it("uses exponential backoff when no Retry-After header is present", async () => {
    const sleeps = [];
    const seq = [
      resp({ status: 429, statusText: "Too Many Requests" }),
      resp({ status: 429, statusText: "Too Many Requests" }),
      resp({ ok: true, status: 200, json: {} }),
    ];
    let i = 0;
    const fetcher = createRetryingJsonFetcher({
      fetchImpl: async () => seq[i++],
      sleep: (ms) => { sleeps.push(ms); },
      baseDelayMs: 1000,
      maxDelayMs: 60000,
    });

    await fetcher("https://x", {});

    expect(sleeps).toEqual([1000, 2000]);
  });

  it("retries transient 503s as well", async () => {
    const sleeps = [];
    const seq = [
      resp({ status: 503, statusText: "Service Unavailable" }),
      resp({ ok: true, status: 200, json: { recovered: true } }),
    ];
    let i = 0;
    const out = await createRetryingJsonFetcher({
      fetchImpl: async () => seq[i++],
      sleep: (ms) => { sleeps.push(ms); },
    })("https://x", {});

    expect(out).toEqual({ recovered: true });
    expect(sleeps).toHaveLength(1);
  });

  it("throws immediately on a non-retryable 4xx (e.g. 404) without sleeping", async () => {
    const sleeps = [];
    let calls = 0;
    const fetcher = createRetryingJsonFetcher({
      fetchImpl: async () => { calls++; return resp({ status: 404, statusText: "Not Found" }); },
      sleep: (ms) => { sleeps.push(ms); },
    });

    await expect(fetcher("https://x/missing.pdf", {})).rejects.toThrow(/HTTP 404 Not Found/);
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  // v1.39.0: a rejected fetch (DNS failure, ECONNRESET, ETIMEDOUT, undici
  // "fetch failed") used to propagate on the FIRST throw, so one network
  // blip became a permanent error entry while HTTP 429/5xx got 6 retries.
  // Any rejection is treated as transient and retried with the same backoff.
  it("retries network-level fetch rejections and succeeds once the network recovers", async () => {
    const sleeps = [];
    const logs = [];
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (calls <= 2) throw new TypeError("fetch failed");
      return resp({ ok: true, status: 200, json: { recovered: true } });
    };
    const fetcher = createRetryingJsonFetcher({
      fetchImpl,
      sleep: (ms) => { sleeps.push(ms); },
      log: (line) => { logs.push(line); },
    });

    const out = await fetcher("https://audit.icjia.app/api/audit-url", {});

    expect(out).toEqual({ recovered: true });
    expect(calls).toBe(3); // 2 rejections + 1 success
    expect(sleeps).toHaveLength(2);
    expect(logs[0]).toMatch(/network error \(fetch failed\) from https:\/\/audit\.icjia\.app\/api\/audit-url; backing off/);
  });

  it("rethrows the last network error after maxRetries rejections", async () => {
    const sleeps = [];
    let calls = 0;
    const fetcher = createRetryingJsonFetcher({
      fetchImpl: async () => { calls++; throw new Error("getaddrinfo EAI_AGAIN audit.icjia.app"); },
      sleep: (ms) => { sleeps.push(ms); },
      maxRetries: 2,
    });

    await expect(fetcher("https://audit.icjia.app/api/audit-url", {})).rejects.toThrow(
      /EAI_AGAIN/,
    );
    expect(calls).toBe(3); // 1 initial + 2 retries = maxRetries+1
    expect(sleeps).toHaveLength(2);
  });

  it("gives up after maxRetries on a persistent 429 and throws the HTTP error", async () => {
    const sleeps = [];
    let calls = 0;
    const fetcher = createRetryingJsonFetcher({
      fetchImpl: async () => { calls++; return resp({ status: 429, statusText: "Too Many Requests" }); },
      sleep: (ms) => { sleeps.push(ms); },
      maxRetries: 2,
    });

    await expect(fetcher("https://audit.icjia.app/api/audit-url", {})).rejects.toThrow(
      /HTTP 429 Too Many Requests/,
    );
    expect(calls).toBe(3); // 1 initial + 2 retries
    expect(sleeps).toHaveLength(2);
  });
});

// ── v1.41.0 — Retry-After must outlast the rate-limit window ──────────────────
// audit.icjia.app's real policy is `500;w=3600` — 500 requests per HOUR, not
// the 100/min this module was written against. On 2026-08-12 a cold grading
// batch exhausted the hourly budget; the server answered `retry-after: 820`
// and the fetcher clamped that to maxDelayMs (60s), retried into the same
// closed window six times, then threw — turning a "come back in 14 minutes"
// into a permanent per-PDF error. Six 60s retries can never outlast a window
// up to an hour, so a server-directed wait needs BOTH its own ceiling and its
// own budget, separate from transient-error backoff.

describe("Retry-After honors the server's window (v1.41.0)", () => {
  it("sleeps the FULL Retry-After, not maxDelayMs", async () => {
    const sleeps = [];
    const seq = [
      resp({ status: 429, statusText: "Too Many Requests", retryAfter: "820" }),
      resp({ ok: true, status: 200, json: { strict: { score: 77 } } }),
    ];
    const fetcher = createRetryingJsonFetcher({
      fetchImpl: async () => seq.shift(),
      sleep: (ms) => { sleeps.push(ms); },
      maxDelayMs: 60000, // deliberately smaller than the Retry-After
    });

    await expect(fetcher("https://audit.icjia.app/api/audit-url", {})).resolves.toEqual({
      strict: { score: 77 },
    });
    expect(sleeps).toEqual([820000]); // NOT 60000
  });

  it("still bounds a pathological Retry-After at maxRetryAfterMs", async () => {
    const sleeps = [];
    const seq = [
      resp({ status: 429, retryAfter: "86400" }), // a full day
      resp({ ok: true, status: 200, json: {} }),
    ];
    const fetcher = createRetryingJsonFetcher({
      fetchImpl: async () => seq.shift(),
      sleep: (ms) => { sleeps.push(ms); },
      maxRetryAfterMs: 900000,
    });

    await fetcher("https://audit.icjia.app/api/audit-url", {});
    expect(sleeps).toEqual([900000]);
  });

  it("server-directed waits draw on their own budget, not maxRetries", async () => {
    // maxRetries is 2, but four Retry-After waits still succeed: waiting out a
    // limiter is compliance, not a symptom of a stuck endpoint.
    const sleeps = [];
    const seq = [
      resp({ status: 429, retryAfter: "600" }),
      resp({ status: 429, retryAfter: "600" }),
      resp({ status: 429, retryAfter: "600" }),
      resp({ status: 429, retryAfter: "600" }),
      resp({ ok: true, status: 200, json: { ok: true } }),
    ];
    const fetcher = createRetryingJsonFetcher({
      fetchImpl: async () => seq.shift(),
      sleep: (ms) => { sleeps.push(ms); },
      maxRetries: 2,
      maxRateLimitWaits: 6,
    });

    await expect(fetcher("https://audit.icjia.app/api/audit-url", {})).resolves.toEqual({ ok: true });
    expect(sleeps).toEqual([600000, 600000, 600000, 600000]);
  });

  it("gives up once maxRateLimitWaits is exhausted", async () => {
    const sleeps = [];
    let calls = 0;
    const fetcher = createRetryingJsonFetcher({
      fetchImpl: async () => { calls++; return resp({ status: 429, statusText: "Too Many Requests", retryAfter: "600" }); },
      sleep: (ms) => { sleeps.push(ms); },
      maxRateLimitWaits: 3,
    });

    await expect(fetcher("https://audit.icjia.app/api/audit-url", {})).rejects.toThrow(
      /HTTP 429/,
    );
    expect(calls).toBe(4); // 1 initial + 3 server-directed waits
    expect(sleeps).toHaveLength(3);
  });

  it("a 429 WITHOUT Retry-After still uses the transient-error budget", async () => {
    // No header means no server guidance — that is ordinary backoff, and it
    // must not consume the rate-limit budget or wait window-length.
    const sleeps = [];
    let calls = 0;
    const fetcher = createRetryingJsonFetcher({
      fetchImpl: async () => { calls++; return resp({ status: 429, statusText: "Too Many Requests" }); },
      sleep: (ms) => { sleeps.push(ms); },
      maxRetries: 2,
      maxRateLimitWaits: 99,
    });

    await expect(fetcher("https://audit.icjia.app/api/audit-url", {})).rejects.toThrow(/HTTP 429/);
    expect(calls).toBe(3); // bounded by maxRetries, not maxRateLimitWaits
  });

  it("a 503 with Retry-After is also honored in full", async () => {
    const sleeps = [];
    const seq = [
      resp({ status: 503, statusText: "Service Unavailable", retryAfter: "300" }),
      resp({ ok: true, status: 200, json: {} }),
    ];
    const fetcher = createRetryingJsonFetcher({
      fetchImpl: async () => seq.shift(),
      sleep: (ms) => { sleeps.push(ms); },
      maxDelayMs: 60000,
    });

    await fetcher("https://audit.icjia.app/api/audit-url", {});
    expect(sleeps).toEqual([300000]);
  });
});
