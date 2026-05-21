import { describe, it, expect } from "vitest";
import { categorizeAuditError, collectAuditErrors } from "../src/report/audit-errors.js";

describe("categorizeAuditError", () => {
  it("flags an HTTP 422 as not a valid PDF", () => {
    const r = categorizeAuditError({
      extension: "pdf",
      audit: { error: "HTTP 422 Unprocessable Entity for https://audit.icjia.app/api/audit-url" },
    });
    expect(r.kind).toBe("not-a-pdf");
    expect(r.reason).toMatch(/not a valid PDF/i);
  });

  it("flags server-unavailable as a retryable audit failure", () => {
    const r = categorizeAuditError({
      extension: "pdf",
      sizeBytes: 60000000,
      audit: { error: "server-unavailable" },
    });
    expect(r.kind).toBe("audit-unavailable");
    expect(r.reason).toMatch(/retry/i);
  });

  it("flags a content-type-mismatch scan flag", () => {
    const r = categorizeAuditError({ extension: "png", flags: ["content-type-mismatch"] });
    expect(r.kind).toBe("content-mismatch");
    expect(r.reason).toMatch(/does not match|mislabel/i);
  });

  it("returns null for an entry with no error", () => {
    expect(categorizeAuditError({ extension: "pdf", audit: { score: 90 } })).toBeNull();
    expect(categorizeAuditError({ extension: "pdf", flags: [] })).toBeNull();
    expect(categorizeAuditError({ extension: "pdf" })).toBeNull();
  });
});

describe("collectAuditErrors", () => {
  const item = (siteName, filename, over = {}) => ({
    siteName,
    serverName: siteName.toLowerCase(),
    publicUrlBase: `https://${siteName.toLowerCase()}.example.com/uploads`,
    entry: { filename, path: filename, extension: "pdf", category: "pdf", sizeBytes: 1000, ...over },
  });

  it("groups errors by site — error sites first, and lists clean sites too", () => {
    const items = [
      item("Alpha", "good.pdf", { audit: { score: 90 } }),
      item("Beta", "bad1.pdf", { audit: { error: "HTTP 422 x" } }),
      item("Beta", "bad2.pdf", { audit: { error: "server-unavailable" } }),
      item("Gamma", "ok.pdf", { audit: { score: 80 } }),
    ];
    const groups = collectAuditErrors(items);
    expect(groups.map((g) => g.siteName)).toEqual(["Beta", "Alpha", "Gamma"]);
    expect(groups[0].errors).toHaveLength(2);
    expect(groups[1].errors).toHaveLength(0);
    expect(groups[2].errors).toHaveLength(0);
  });

  it("builds a public URL and a reason for each errored file", () => {
    const [g] = collectAuditErrors([item("Beta", "bad.pdf", { audit: { error: "HTTP 422 x" } })]);
    expect(g.errors[0].publicUrl).toBe("https://beta.example.com/uploads/bad.pdf");
    expect(g.errors[0].reason).toBeTruthy();
    expect(g.errors[0].extension).toBe("pdf");
  });
});
