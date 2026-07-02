// v1.39.0 — D9/D10 coverage for src/report/audit-errors.js:
//   - publicUrlFor precedence (publicUrlBase beats an https absolutePath),
//     per-segment percent-encoding, and the optional pathPrefix insert
//     (Interface Contract 4, consumer side).
//   - writeAuditErrorsCsv routes cells through the shared csvCell helper so
//     formula-leading cells get the apostrophe guard.
import { describe, it, expect } from "vitest";
import { collectAuditErrors, writeAuditErrorsCsv } from "../src/report/audit-errors.js";

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
