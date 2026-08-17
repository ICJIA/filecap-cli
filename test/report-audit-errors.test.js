// v1.39.0 — D9/D10 coverage for src/report/audit-errors.js:
//   - publicUrlFor precedence (publicUrlBase beats an https absolutePath),
//     per-segment percent-encoding, and the optional pathPrefix insert
//     (Interface Contract 4, consumer side).
//   - writeAuditErrorsCsv routes cells through the shared csvCell helper so
//     formula-leading cells get the apostrophe guard.
import { describe, it, expect } from "vitest";
import { categorizeAuditError, collectAuditErrors, writeAuditErrorsCsv } from "../src/report/audit-errors.js";

const erroredItem = (over = {}, entryOver = {}) => ({
  siteName: "Beta",
  serverName: "beta",
  publicUrlBase: "https://beta.example.com/uploads",
  ...over,
  entry: {
    filename: "bad.pdf",
    path: "bad.pdf",
    extension: "pdf",
    category: "pdf",
    sizeBytes: 1000,
    audit: { error: "HTTP 422 x" },
    ...entryOver,
  },
});

describe("publicUrlFor (via collectAuditErrors)", () => {
  it("prefers publicUrlBase over an https absolutePath (csv.js v1.7.40 precedence)", () => {
    const [g] = collectAuditErrors([
      erroredItem({}, {
        path: "docs/report.pdf",
        absolutePath: "https://github.com/ICJIA/site/tree/main/public/docs/report.pdf",
      }),
    ]);
    expect(g.errors[0].publicUrl).toBe("https://beta.example.com/uploads/docs/report.pdf");
  });

  it("inserts item.pathPrefix between base and path", () => {
    const [g] = collectAuditErrors([
      erroredItem({ pathPrefix: "/static" }, { path: "docs/a b.pdf" }),
    ]);
    expect(g.errors[0].publicUrl).toBe("https://beta.example.com/uploads/static/docs/a%20b.pdf");
  });

  it("percent-encodes each path segment (spaces, #) without eating slashes", () => {
    const [g] = collectAuditErrors([
      erroredItem({}, { path: "docs/Sheet#Info1V1-2025.pdf" }),
    ]);
    expect(g.errors[0].publicUrl).toBe("https://beta.example.com/uploads/docs/Sheet%23Info1V1-2025.pdf");
  });

  it("falls back to the https absolutePath (tree→blob) only when no base exists", () => {
    const [g] = collectAuditErrors([
      erroredItem({ publicUrlBase: "" }, {
        path: "docs/report.pdf",
        absolutePath: "https://github.com/ICJIA/site/tree/main/public/docs/report.pdf",
      }),
    ]);
    expect(g.errors[0].publicUrl).toBe("https://github.com/ICJIA/site/blob/main/public/docs/report.pdf");
  });
});

describe("writeAuditErrorsCsv formula-injection guard", () => {
  it("prefixes formula-leading cells with an apostrophe", () => {
    const groups = collectAuditErrors([
      erroredItem({}, { filename: "=cmd|'/c calc'!A1", path: "=cmd|'/c calc'!A1" }),
    ]);
    const csv = writeAuditErrorsCsv(groups);
    const dataLine = csv.split("\n")[1];
    expect(dataLine).toContain("'=cmd|'/c calc'!A1");
    expect(dataLine).not.toMatch(/(^|,)=cmd/);
  });

  it("quotes cells containing carriage returns", () => {
    const groups = collectAuditErrors([
      erroredItem({}, { filename: "odd\rname.pdf", path: "odd\rname.pdf" }),
    ]);
    const csv = writeAuditErrorsCsv(groups);
    expect(csv).toContain('"odd\rname.pdf"');
  });
});

// v1.50.0 — HTTP 413 categorization: oversized files get an honest,
// introspection-aware reason instead of falling through to the raw generic
// error line. The 2026-08-16 fleet rescore surfaced 13 of these — 11 archive
// scans from 1987–1998 at 25–92 MB, plus the two drone reports that
// audit.icjia.app's v1.70.0 cap deliberately keeps out — and the table showed
// "Unavailable" with a raw HTTP line in the tooltip, which reads as breakage
// rather than the verdict it is.
describe("categorizeAuditError: HTTP 413 (file exceeds the audit service's size cap)", () => {
  const err413 = "HTTP 413 Payload Too Large for https://audit.icjia.app/api/audit-url";

  it("categorizes a 413 image-only scan as too-large, with the scan verdict (would score 0)", () => {
    // The real 1998 Madison.pdf case: 34.7 MB PFU ScanSnap scan, no text layer.
    const cat = categorizeAuditError({
      extension: "pdf",
      category: "pdf",
      sizeBytes: 36346875,
      introspection: { kind: "pdf", isImageOnly: true, hasTextLayer: false, textLayerCoverage: 0, pageCount: 141 },
      audit: { error: err413 },
    });
    expect(cat.kind).toBe("too-large");
    expect(cat.reason).toContain("35 MB");
    expect(cat.reason).toContain("25 MB");
    expect(cat.reason).toMatch(/image-only scan/i);
    expect(cat.reason).toMatch(/score it 0/);
  });

  it("categorizes a 413 file WITH a text layer as too-large without claiming it is a scan", () => {
    // The real 59.7 MB drone-report case: 1,587 pages, 91% text-layer coverage.
    const cat = categorizeAuditError({
      extension: "pdf",
      category: "pdf",
      sizeBytes: 62599372,
      introspection: { kind: "pdf", isImageOnly: false, hasTextLayer: true, textLayerCoverage: 0.9, pageCount: 1587 },
      audit: { error: err413 },
    });
    expect(cat.kind).toBe("too-large");
    expect(cat.reason).toContain("60 MB");
    expect(cat.reason).toContain("25 MB");
    expect(cat.reason).not.toMatch(/image-only|scan/i);
    expect(cat.reason).toMatch(/split/i);
  });

  it("makes no scan claim when introspection is missing", () => {
    const cat = categorizeAuditError({
      extension: "pdf",
      category: "pdf",
      sizeBytes: 30 * 1024 * 1024,
      audit: { error: err413 },
    });
    expect(cat.kind).toBe("too-large");
    expect(cat.reason).not.toMatch(/image-only|scan/i);
  });

  it("leaves 422 and 5xx categorization untouched (the 413 branch does not swallow them)", () => {
    expect(categorizeAuditError({ extension: "pdf", audit: { error: "HTTP 422 x" } }).kind).toBe("not-a-pdf");
    expect(categorizeAuditError({ extension: "pdf", audit: { error: "HTTP 503 Service Unavailable" } }).kind).toBe(
      "audit-unavailable",
    );
  });
});
