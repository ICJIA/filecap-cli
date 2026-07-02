// v1.39.0 — D9/D10 coverage for src/report/orphans-csv.js: the writer routes
// cells through the shared format.js csvCell (formula-injection apostrophe
// guard) and percent-encodes public-URL path segments.
import { describe, it, expect } from "vitest";
import { writeOrphansCsv } from "../src/report/orphans-csv.js";

const sources = [
  {
    serverName: "icjia-agency-prod",
    siteName: "ICJIA",
    publicUrlBase: "https://agency.icjia-api.cloud",
  },
];

function orphan(entryOver = {}, over = {}) {
  return {
    entry: {
      filename: "Plan_a1b2c3d4e5.pdf",
      path: "uploads/Plan_a1b2c3d4e5.pdf",
      serverName: "icjia-agency-prod",
      extension: "pdf",
      sizeBytes: 12345,
      modifiedAt: "2021-01-01T00:00:00.000Z",
      ...entryOver,
    },
    status: "stale-revision",
    replacedBy: "Plan_f6789abcde.pdf",
    replacedOn: "2026-04-01T00:00:00.000Z",
    daysBetween: 1916,
    daysOld: 1965,
    groupSize: 2,
    reasons: ["strapi-hash-variant"],
    replaceabilityConfidence: 95,
    ...over,
  };
}

describe("writeOrphansCsv", () => {
  it("writes a header row plus one row per orphan", () => {
    const csv = writeOrphansCsv({ orphans: [orphan()], sources });
    const lines = csv.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Confidence %");
    expect(lines[1]).toContain("Plan_a1b2c3d4e5.pdf");
  });

  it("prefixes formula-leading cells with an apostrophe (shared csvCell guard)", () => {
    const csv = writeOrphansCsv({
      orphans: [orphan({ filename: "=cmd|'/c calc'!A1", path: "=cmd|'/c calc'!A1" })],
      sources,
    });
    const dataLine = csv.split("\n")[1];
    expect(dataLine).toContain("'=cmd|'/c calc'!A1");
    expect(dataLine).not.toMatch(/(^|,)=cmd/);
  });

  it("percent-encodes public-URL path segments (spaces, #) without eating slashes", () => {
    const csv = writeOrphansCsv({
      orphans: [orphan({ path: "uploads/Sheet#Info V1.pdf", filename: "Sheet#Info V1.pdf" })],
      sources,
    });
    expect(csv).toContain("https://agency.icjia-api.cloud/uploads/Sheet%23Info%20V1.pdf");
  });

  it("applies the source pathPrefix between base and encoded path", () => {
    const csv = writeOrphansCsv({
      orphans: [orphan({ path: "docs/a b.pdf" })],
      sources: [{ ...sources[0], pathPrefix: "/static" }],
    });
    expect(csv).toContain("https://agency.icjia-api.cloud/static/docs/a%20b.pdf");
  });
});
