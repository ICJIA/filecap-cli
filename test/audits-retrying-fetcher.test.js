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
