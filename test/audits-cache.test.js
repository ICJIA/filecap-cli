import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadAuditCache, saveAuditCache, isCacheEntryFresh } from "../src/audits/cache.js";

// 1.9.0: the audit cache lives at ~/.filecap/audit-cache.json and is keyed
// by SHA-256 of the PDF's content (already in filecap's scan inventory).
// Entries carry score/grade/reportUrl plus a checkedAt timestamp for TTL
// management. The cache doubles the audit.icjia.app server-side dedup —
// even cached responses count against the rate limit, so a local skip is
// strictly better than calling the endpoint just to get back cached=true.

describe("loadAuditCache", () => {
  let tmpDir;
  let cachePath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "filecap-audit-cache-"));
    cachePath = path.join(tmpDir, "audit-cache.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty object when file is absent", () => {
    expect(loadAuditCache({ cachePath })).toEqual({});
  });

  it("reads a valid cache file", () => {
    const cache = {
      "e3014a0f9567a7a5188f1e408e7c0981155661a9a4c0740ebe4e0580624b4935": {
        score: 49,
        grade: "F",
        reportUrl: "https://audit.icjia.app/report/abc123",
        reportExpiresAt: "2027-05-18T15:32:11.000Z",
        audited: "2026-05-18T15:32:11.000Z",
        checkedAt: "2026-05-18T15:32:11.000Z",
      },
    };
    fs.writeFileSync(cachePath, JSON.stringify(cache));
    expect(loadAuditCache({ cachePath })).toEqual(cache);
  });

  it("returns empty object on parse error (corrupt cache shouldn't fail the run)", () => {
    fs.writeFileSync(cachePath, "{ not-json");
    expect(loadAuditCache({ cachePath })).toEqual({});
  });
});

describe("saveAuditCache", () => {
  let tmpDir;
  let cachePath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "filecap-audit-cache-"));
    cachePath = path.join(tmpDir, "audit-cache.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes the cache atomically (tmp + rename)", () => {
    const cache = {
      "abc": { score: 90, grade: "A", reportUrl: "https://x.com/r", checkedAt: "2026-01-01T00:00:00Z" },
    };
    saveAuditCache({ cachePath, cache });
    const reloaded = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    expect(reloaded).toEqual(cache);
  });

  it("creates the directory if it doesn't exist", () => {
    const deeperPath = path.join(tmpDir, "subdir", "audit-cache.json");
    saveAuditCache({ cachePath: deeperPath, cache: { x: { score: 1 } } });
    expect(fs.existsSync(deeperPath)).toBe(true);
  });

  it("writes with mode 0600 (cache may contain operator identifying data)", () => {
    saveAuditCache({ cachePath, cache: { x: { score: 1 } } });
    const stat = fs.statSync(cachePath);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

describe("isCacheEntryFresh", () => {
  // Default TTL is 30 days. An entry is fresh when checkedAt is within
  // (now - TTL). Tunable via the ttlDays option.

  it("returns true when checkedAt is within the TTL window", () => {
    const now = new Date("2026-05-19T12:00:00Z");
    const entry = { score: 90, checkedAt: "2026-05-10T12:00:00Z" }; // 9 days ago
    expect(isCacheEntryFresh(entry, { now, ttlDays: 30 })).toBe(true);
  });

  it("returns false when checkedAt is past the TTL window", () => {
    const now = new Date("2026-05-19T12:00:00Z");
    const entry = { score: 90, checkedAt: "2026-04-01T12:00:00Z" }; // 48 days ago
    expect(isCacheEntryFresh(entry, { now, ttlDays: 30 })).toBe(false);
  });

  it("returns false when the entry has no checkedAt timestamp", () => {
    expect(isCacheEntryFresh({ score: 90 }, { ttlDays: 30 })).toBe(false);
  });

  it("returns false when checkedAt is unparseable", () => {
    expect(isCacheEntryFresh({ score: 90, checkedAt: "not a date" }, { ttlDays: 30 })).toBe(false);
  });

  it("returns false for null/undefined entry", () => {
    expect(isCacheEntryFresh(null, { ttlDays: 30 })).toBe(false);
    expect(isCacheEntryFresh(undefined, { ttlDays: 30 })).toBe(false);
  });

  it("uses 30 days as the default TTL when ttlDays not specified", () => {
    const now = new Date("2026-05-19T12:00:00Z");
    const recent = { score: 90, checkedAt: "2026-05-10T12:00:00Z" };
    const stale = { score: 90, checkedAt: "2026-03-01T12:00:00Z" };
    expect(isCacheEntryFresh(recent, { now })).toBe(true);
    expect(isCacheEntryFresh(stale, { now })).toBe(false);
  });
});
