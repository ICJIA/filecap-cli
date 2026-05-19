import { describe, it, expect } from "vitest";
import { fetchPageAuditScore } from "../src/audits/page-scorer.js";

// 1.10.0: page-scorer posts to audit.icjia.app's /api/audit-url-page,
// returns { score, grade, violationCount, bySeverity, reportUrl,
// reportId, reportExpiresAt, pageTitle, audited, cached }. Mirror of
// fetchAuditScore but for HTML pages (axe-core via Puppeteer on the
// server side) instead of PDFs.

const okResponse = {
  url: "https://icjia.illinois.gov/news/meetings/foo/",
  pageTitle: "ICJIA — Authority Board Meeting · April 9, 2026",
  audited: "2026-05-19T17:32:11.000Z",
  axe: {
    score: 87,
    grade: "B",
    violationCount: 5,
    bySeverity: { critical: 0, serious: 2, moderate: 2, minor: 1 },
  },
  reportId: "abc123",
  reportUrl: "https://audit.icjia.app/page-report/abc123",
  reportExpiresAt: "2027-05-19T17:32:11.000Z",
  cached: false,
};

describe("fetchPageAuditScore", () => {
  it("POSTs to /api/audit-url-page with the page URL in the body", async () => {
    const calls = [];
    const fetcher = async (url, init) => {
      calls.push({ url, method: init?.method, body: JSON.parse(init.body), headers: init.headers ?? {} });
      return okResponse;
    };
    await fetchPageAuditScore({
      pageUrl: "https://icjia.illinois.gov/news/meetings/foo/",
      auditEndpoint: "https://audit.icjia.app/api/audit-url-page",
      fetcher,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://audit.icjia.app/api/audit-url-page");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({ url: "https://icjia.illinois.gov/news/meetings/foo/" });
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
  });

  it("returns the score, grade, reportUrl + meta from the response", async () => {
    const fetcher = async () => okResponse;
    const result = await fetchPageAuditScore({
      pageUrl: "https://x.com/page/",
      auditEndpoint: "https://audit.icjia.app/api/audit-url-page",
      fetcher,
    });
    expect(result).toEqual({
      score: 87,
      grade: "B",
      violationCount: 5,
      bySeverity: { critical: 0, serious: 2, moderate: 2, minor: 1 },
      reportUrl: "https://audit.icjia.app/page-report/abc123",
      reportId: "abc123",
      reportExpiresAt: "2027-05-19T17:32:11.000Z",
      pageTitle: "ICJIA — Authority Board Meeting · April 9, 2026",
      audited: "2026-05-19T17:32:11.000Z",
      cached: false,
    });
  });

  it("attaches Bearer token when provided (forward-compat with auth-on mode)", async () => {
    const calls = [];
    const fetcher = async (url, init) => {
      calls.push({ headers: init.headers });
      return okResponse;
    };
    await fetchPageAuditScore({
      pageUrl: "https://x.com/page/",
      auditEndpoint: "https://audit.icjia.app/api/audit-url-page",
      bearerToken: "fap_abc123",
      fetcher,
    });
    expect(calls[0].headers.Authorization).toBe("Bearer fap_abc123");
  });

  it("omits Authorization header when no token supplied (anonymous)", async () => {
    const calls = [];
    const fetcher = async (url, init) => {
      calls.push({ headers: init.headers ?? {} });
      return okResponse;
    };
    await fetchPageAuditScore({
      pageUrl: "https://x.com/page/",
      auditEndpoint: "https://audit.icjia.app/api/audit-url-page",
      fetcher,
    });
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("rejects non-http(s) URLs (defensive — server also enforces)", async () => {
    const fetcher = async () => { throw new Error("should not be called"); };
    await expect(
      fetchPageAuditScore({
        pageUrl: "file:///etc/passwd",
        auditEndpoint: "https://audit.icjia.app/api/audit-url-page",
        fetcher,
      }),
    ).rejects.toThrow(/http\(s\)/);
  });

  it("rejects a missing or empty pageUrl", async () => {
    const fetcher = async () => okResponse;
    await expect(
      fetchPageAuditScore({
        pageUrl: "",
        auditEndpoint: "https://audit.icjia.app/api/audit-url-page",
        fetcher,
      }),
    ).rejects.toThrow(/pageUrl/);
  });

  it("returns null on 5xx so the caller can mark 'unscored' without failing the run", async () => {
    const fetcher = async () => {
      throw new Error("HTTP 503 Service Unavailable for https://audit.icjia.app/api/audit-url-page");
    };
    const result = await fetchPageAuditScore({
      pageUrl: "https://x.com/page/",
      auditEndpoint: "https://audit.icjia.app/api/audit-url-page",
      fetcher,
    });
    expect(result).toBeNull();
  });

  it("returns null on 504 (page render timed out — slow page) so the run keeps moving", async () => {
    const fetcher = async () => {
      throw new Error("HTTP 504 Gateway Timeout for https://audit.icjia.app/api/audit-url-page");
    };
    const result = await fetchPageAuditScore({
      pageUrl: "https://x.com/page/",
      auditEndpoint: "https://audit.icjia.app/api/audit-url-page",
      fetcher,
    });
    expect(result).toBeNull();
  });

  it("surfaces 4xx errors so misconfiguration doesn't silently fail", async () => {
    const fetcher = async () => {
      throw new Error("HTTP 400 Bad Request for https://audit.icjia.app/api/audit-url-page");
    };
    await expect(
      fetchPageAuditScore({
        pageUrl: "https://x.com/page/",
        auditEndpoint: "https://audit.icjia.app/api/audit-url-page",
        fetcher,
      }),
    ).rejects.toThrow(/HTTP 400/);
  });

  it("passes force=true to the server when requested (skip server-side dedup)", async () => {
    const calls = [];
    const fetcher = async (url, init) => {
      calls.push({ body: JSON.parse(init.body) });
      return okResponse;
    };
    await fetchPageAuditScore({
      pageUrl: "https://x.com/page/",
      auditEndpoint: "https://audit.icjia.app/api/audit-url-page",
      force: true,
      fetcher,
    });
    expect(calls[0].body).toEqual({
      url: "https://x.com/page/",
      force: true,
    });
  });
});
