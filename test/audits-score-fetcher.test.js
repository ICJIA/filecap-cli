import { describe, it, expect } from "vitest";
import { fetchAuditScore } from "../src/audits/score-fetcher.js";

// 1.9.0: score-fetcher posts to audit.icjia.app's /api/audit-url with the
// PDF's public URL, returns { score, grade, reportUrl, reportExpiresAt,
// pageCount, audited, cached }. Bearer token is optional (audit.icjia.app
// runs anonymous by default). The fetcher is injection-friendly so tests
// can simulate the HTTP layer without going to the network.

const okResponse = {
  filename: "report.pdf",
  pageCount: 12,
  audited: "2026-05-19T15:32:11.000Z",
  strict: { score: 49, grade: "F" },
  practical: { score: 49, grade: "F" },
  reportId: "abc123",
  reportUrl: "https://audit.icjia.app/report/abc123",
  reportExpiresAt: "2027-05-19T15:32:11.000Z",
  cached: false,
};

describe("fetchAuditScore", () => {
  it("POSTs to /api/audit-url with the file's URL in the body", async () => {
    const calls = [];
    const fetcher = async (url, init) => {
      calls.push({ url, method: init?.method, body: JSON.parse(init.body), headers: init.headers ?? {} });
      return okResponse;
    };
    await fetchAuditScore({
      pdfUrl: "https://archive.icjia.cloud/files/foo.pdf",
      auditEndpoint: "https://audit.icjia.app/api/audit-url",
      fetcher,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://audit.icjia.app/api/audit-url");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({ url: "https://archive.icjia.cloud/files/foo.pdf" });
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
  });

  it("returns the strict score, grade, reportUrl + meta from the response", async () => {
    const fetcher = async () => okResponse;
    const result = await fetchAuditScore({
      pdfUrl: "https://x.com/a.pdf",
      auditEndpoint: "https://audit.icjia.app/api/audit-url",
      fetcher,
    });
    expect(result).toEqual({
      score: 49,
      grade: "F",
      reportUrl: "https://audit.icjia.app/report/abc123",
      reportId: "abc123",
      reportExpiresAt: "2027-05-19T15:32:11.000Z",
      pageCount: 12,
      audited: "2026-05-19T15:32:11.000Z",
      cached: false,
    });
  });

  it("attaches Bearer token when one is provided (forward-compat with auth-on mode)", async () => {
    const calls = [];
    const fetcher = async (url, init) => {
      calls.push({ headers: init.headers });
      return okResponse;
    };
    await fetchAuditScore({
      pdfUrl: "https://x.com/a.pdf",
      auditEndpoint: "https://audit.icjia.app/api/audit-url",
      bearerToken: "fap_abc123",
      fetcher,
    });
    expect(calls[0].headers.Authorization).toBe("Bearer fap_abc123");
  });

  it("omits Authorization header when no token is supplied (anonymous mode)", async () => {
    const calls = [];
    const fetcher = async (url, init) => {
      calls.push({ headers: init.headers ?? {} });
      return okResponse;
    };
    await fetchAuditScore({
      pdfUrl: "https://x.com/a.pdf",
      auditEndpoint: "https://audit.icjia.app/api/audit-url",
      fetcher,
    });
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("rejects URLs whose scheme is not http(s) (defensive — server also enforces)", async () => {
    const fetcher = async () => {
      throw new Error("should not be called");
    };
    await expect(
      fetchAuditScore({
        pdfUrl: "file:///etc/passwd",
        auditEndpoint: "https://audit.icjia.app/api/audit-url",
        fetcher,
      }),
    ).rejects.toThrow(/http\(s\)/);
  });

  it("rejects a missing or empty pdfUrl", async () => {
    const fetcher = async () => okResponse;
    await expect(
      fetchAuditScore({
        pdfUrl: "",
        auditEndpoint: "https://audit.icjia.app/api/audit-url",
        fetcher,
      }),
    ).rejects.toThrow(/pdfUrl/);
  });

  it("returns null on 5xx errors so the caller can mark the entry as 'unscored' without failing the run", async () => {
    const fetcher = async () => {
      throw new Error("HTTP 503 Service Unavailable for https://audit.icjia.app/api/audit-url");
    };
    const result = await fetchAuditScore({
      pdfUrl: "https://x.com/a.pdf",
      auditEndpoint: "https://audit.icjia.app/api/audit-url",
      fetcher,
    });
    expect(result).toBeNull();
  });

  it("surfaces 4xx errors with a clear message (so misconfiguration doesn't silently fail)", async () => {
    const fetcher = async () => {
      throw new Error("HTTP 400 Bad Request for https://audit.icjia.app/api/audit-url");
    };
    await expect(
      fetchAuditScore({
        pdfUrl: "https://x.com/a.pdf",
        auditEndpoint: "https://audit.icjia.app/api/audit-url",
        fetcher,
      }),
    ).rejects.toThrow(/HTTP 400/);
  });

  it("rethrows a 4xx error even when its appended third-party body text mentions an HTTP 5xx code (regex must anchor to the message start)", async () => {
    const fetcher = async () => {
      throw new Error(
        "HTTP 422 Unprocessable Entity for https://x — upstream said HTTP 502",
      );
    };
    await expect(
      fetchAuditScore({
        pdfUrl: "https://x.com/a.pdf",
        auditEndpoint: "https://audit.icjia.app/api/audit-url",
        fetcher,
      }),
    ).rejects.toThrow(/HTTP 422/);
  });

  it("passes force=true through to the server when requested (skips server-side dedup)", async () => {
    const calls = [];
    const fetcher = async (url, init) => {
      calls.push({ body: JSON.parse(init.body) });
      return okResponse;
    };
    await fetchAuditScore({
      pdfUrl: "https://x.com/a.pdf",
      auditEndpoint: "https://audit.icjia.app/api/audit-url",
      force: true,
      fetcher,
    });
    expect(calls[0].body).toEqual({
      url: "https://x.com/a.pdf",
      force: true,
    });
  });

  it("handles a response with a null score (server couldn't compute) by returning null score + null grade", async () => {
    const fetcher = async () => ({
      ...okResponse,
      strict: { score: null, grade: null },
    });
    const result = await fetchAuditScore({
      pdfUrl: "https://x.com/a.pdf",
      auditEndpoint: "https://audit.icjia.app/api/audit-url",
      fetcher,
    });
    expect(result.score).toBeNull();
    expect(result.grade).toBeNull();
    expect(result.reportUrl).toBe(okResponse.reportUrl);
  });
});

describe("fetchAuditScore — redirect guard (FC-2026-040)", () => {
  it("sends redirect:manual so the audit token can't be forwarded on a redirect", async () => {
    let seen = null;
    const fetcher = async (_url, init) => { seen = init; return { strict: { score: 90, grade: "A" }, reportUrl: "https://r/x" }; };
    await fetchAuditScore({ pdfUrl: "https://x/a.pdf", auditEndpoint: "https://audit.icjia.app/api/audit-url", bearerToken: "tok", fetcher });
    expect(seen.redirect).toBe("manual");
  });
});
