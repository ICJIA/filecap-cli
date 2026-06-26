import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSidecar, readPriorSidecar, writeSidecar, SIDECAR_SCHEMA } from "../src/site-audit/sidecar.js";

const aggregate = {
  score: 90, grade: "A",
  outstanding: { total: 2, bySeverity: { critical: 0, serious: 1, moderate: 1, minor: 0 }, byWcag: { A: 1, AA: 1, AAA: 0, bestPractice: 0 }, needsReview: 1 },
  pages: [{ url: "https://x.com/a", score: 90, grade: "A", violationCount: 2, bySeverity: {}, needsReview: 1, reportUrl: "r" }],
};

describe("buildSidecar", () => {
  it("first run: no trend, history length 1", () => {
    const s = buildSidecar({
      siteName: "x", auditedAt: "2026-06-26T00:00:00Z", endpoint: "e",
      coverage: { pagesInSet: 1, scored: 1, errored: 0, capped: 0 },
      aggregate, issueKeys: ["k1", "k2"], prior: null,
    });
    expect(s.schema).toBe(SIDECAR_SCHEMA);
    expect(s.score).toBe(90);
    expect(s.trend).toBe(null);
    expect(s.issueKeys).toEqual(["k1", "k2"]);
    expect(s.scoreHistory).toHaveLength(1);
  });

  it("second run: diffs prior issueKeys and grows history", () => {
    const prior = {
      auditedAt: "2026-06-12T00:00:00Z", score: 80,
      issueKeys: ["k1", "k9"], outstanding: { total: 2 },
      scoreHistory: [{ date: "2026-06-12T00:00:00Z", score: 80, outstandingTotal: 2 }],
    };
    const s = buildSidecar({
      siteName: "x", auditedAt: "2026-06-26T00:00:00Z", endpoint: "e",
      coverage: { pagesInSet: 1, scored: 1, errored: 0, capped: 0 },
      aggregate, issueKeys: ["k1", "k2"], prior,
    });
    expect(s.trend).toEqual({ vsDate: "2026-06-12T00:00:00Z", fixed: 1, new: 1, stillOpen: 1 });
    expect(s.scoreHistory).toHaveLength(2);
  });
});

describe("readPriorSidecar", () => {
  it("returns null for a missing or corrupt file", () => {
    expect(readPriorSidecar(path.join(os.tmpdir(), "nope-site-audit.json"))).toBe(null);
  });
  it("round-trips a written sidecar", () => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fc-sc-")), "site-audit.json");
    const s = buildSidecar({ siteName: "x", auditedAt: "t", endpoint: "e", coverage: {}, aggregate, issueKeys: [], prior: null });
    writeSidecar(p, s);
    expect(readPriorSidecar(p)).toEqual(s);
  });
});
