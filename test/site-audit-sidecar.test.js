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

// v1.39.0: the fixed/new trend is computed ONLY over pages scored in BOTH
// runs. A page entering or leaving the sample is coverage change, reported
// as trend.coverageChanged — never as fake fixed/new counts.
describe("buildSidecar trend vs coverage (v1.39.0)", () => {
  const agg = (pagesByUrl) => ({
    score: 90, grade: "A",
    outstanding: { total: 1, bySeverity: { critical: 0, serious: 1, moderate: 0, minor: 0 }, byWcag: { A: 0, AA: 1, AAA: 0, bestPractice: 0 }, needsReview: 0 },
    pages: Object.keys(pagesByUrl).map((url) => ({ url, score: 90, grade: "A", violationCount: 0, bySeverity: {}, needsReview: 0, reportUrl: null })),
  });
  const build = ({ pages, byPage, prior }) => buildSidecar({
    siteName: "x", auditedAt: "2026-07-01T00:00:00Z", endpoint: "e",
    coverage: { pagesInSet: Object.keys(pages).length, scored: Object.keys(pages).length, errored: 0, capped: 0 },
    aggregate: agg(pages),
    issueKeys: Object.values(byPage).flat().sort(),
    issueKeysByPage: byPage,
    prior,
  });
  const priorOf = (pages, byPage) => ({
    auditedAt: "2026-06-01T00:00:00Z", score: 85,
    issueKeys: Object.values(byPage).flat().sort(),
    issueKeysByPage: byPage,
    pages: Object.keys(pages).map((url) => ({ url })),
    scoreHistory: [{ date: "2026-06-01T00:00:00Z", score: 85, outstandingTotal: 3 }],
  });

  it("a page leaving the scored set is coverage change, not remediation", () => {
    const prior = priorOf(
      { "https://x.com/a": 1, "https://x.com/b": 1 },
      { "https://x.com/a": ["kA1"], "https://x.com/b": ["kB1", "kB2"] },
    );
    const s = build({
      pages: { "https://x.com/a": 1 },
      byPage: { "https://x.com/a": ["kA1"] },
      prior,
    });
    expect(s.trend.fixed).toBe(0); // kB1/kB2 left the sample — NOT fixed
    expect(s.trend.new).toBe(0);
    expect(s.trend.stillOpen).toBe(1);
    expect(s.trend.coverageChanged).toEqual({ added: 0, removed: 1 });
  });

  it("a page entering the scored set is coverage change, not new issues", () => {
    const prior = priorOf(
      { "https://x.com/a": 1 },
      { "https://x.com/a": ["kA1"] },
    );
    const s = build({
      pages: { "https://x.com/a": 1, "https://x.com/b": 1 },
      byPage: { "https://x.com/a": ["kA1"], "https://x.com/b": ["kB1"] },
      prior,
    });
    expect(s.trend.new).toBe(0); // kB1 entered the sample — NOT new
    expect(s.trend.fixed).toBe(0);
    expect(s.trend.stillOpen).toBe(1);
    expect(s.trend.coverageChanged).toEqual({ added: 1, removed: 0 });
  });

  it("a genuine fix on a common page counts as fixed", () => {
    const prior = priorOf(
      { "https://x.com/a": 1, "https://x.com/b": 1 },
      { "https://x.com/a": ["kA1", "kA2"], "https://x.com/b": ["kB1"] },
    );
    const s = build({
      pages: { "https://x.com/a": 1, "https://x.com/b": 1 },
      byPage: { "https://x.com/a": ["kA2"], "https://x.com/b": ["kB1"] },
      prior,
    });
    expect(s.trend.fixed).toBe(1);
    expect(s.trend.new).toBe(0);
    expect(s.trend.stillOpen).toBe(2);
    expect(s.trend.coverageChanged).toEqual({ added: 0, removed: 0 });
  });

  it("legacy prior (flat keys only) with identical coverage still diffs", () => {
    const prior = {
      auditedAt: "2026-06-01T00:00:00Z", score: 85,
      issueKeys: ["kA1", "kOld"],
      pages: [{ url: "https://x.com/a" }],
      scoreHistory: [],
    };
    const s = build({
      pages: { "https://x.com/a": 1 },
      byPage: { "https://x.com/a": ["kA1", "kNew"] },
      prior,
    });
    expect(s.trend.fixed).toBe(1);
    expect(s.trend.new).toBe(1);
    expect(s.trend.stillOpen).toBe(1);
    expect(s.trend.coverageChanged).toEqual({ added: 0, removed: 0 });
  });

  it("legacy prior with a coverage shift suppresses the trend instead of faking counts", () => {
    const prior = {
      auditedAt: "2026-06-01T00:00:00Z", score: 85,
      issueKeys: ["kA1", "kB1"], // unattributable to pages
      pages: [{ url: "https://x.com/a" }, { url: "https://x.com/b" }],
      scoreHistory: [],
    };
    const s = build({
      pages: { "https://x.com/a": 1 },
      byPage: { "https://x.com/a": ["kA1"] },
      prior,
    });
    expect(s.trend).toBeNull();
  });

  it("stores issueKeysByPage so the next run can restrict its diff", () => {
    const s = build({
      pages: { "https://x.com/a": 1 },
      byPage: { "https://x.com/a": ["kA1"] },
      prior: null,
    });
    expect(s.issueKeysByPage).toEqual({ "https://x.com/a": ["kA1"] });
  });

  it("normalizes URL variants (trailing slash / case) when intersecting", () => {
    const prior = priorOf(
      { "https://x.com/About/": 1 },
      { "https://x.com/About/": ["kA1"] },
    );
    const s = build({
      pages: { "https://x.com/about": 1 },
      byPage: { "https://x.com/about": ["kA1"] },
      prior,
    });
    expect(s.trend.coverageChanged).toEqual({ added: 0, removed: 0 });
    expect(s.trend.stillOpen).toBe(1);
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
