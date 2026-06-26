// test/site-audit-command.test.js
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSiteAudit } from "../src/commands/site-audit.js";

let tmp, sitesFile, auditsBase, cachePath;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-sa-"));
  sitesFile = path.join(tmp, "sites.json");
  auditsBase = path.join(tmp, "audits");
  cachePath = path.join(tmp, "page-cache.json");
  fs.writeFileSync(sitesFile, JSON.stringify({ sites: [{ name: "demo", siteUrl: "https://demo.test/" }] }));
});

function fakeFetcher(scoreByUrl) {
  return async (_endpoint, init) => {
    const { url } = JSON.parse(init.body);
    const score = scoreByUrl[url] ?? 100;
    return {
      url, pageTitle: "T", audited: "2026-06-26T00:00:00Z",
      axe: {
        score, grade: score >= 90 ? "A" : "B", violationCount: score >= 90 ? 0 : 1,
        bySeverity: { critical: 0, serious: score >= 90 ? 0 : 1, moderate: 0, minor: 0 },
        violations: score >= 90 ? [] : [{ id: "color-contrast", impact: "serious", tags: ["wcag2aa"], nodes: [{ target: ["h1"] }] }],
        incomplete: [],
      },
      reportId: "r", reportUrl: `https://audit.icjia.app/page-report/${score}`, cached: false,
    };
  };
}

describe("runSiteAudit", () => {
  it("scores the page set and writes a sidecar", async () => {
    const res = await runSiteAudit({
      siteName: "demo", sitesFile, auditsBase, pageCachePath: cachePath,
      fetcher: fakeFetcher({ "https://demo.test/": 100, "https://demo.test/about": 80 }),
      fetchSitemap: async () => ["https://demo.test/", "https://demo.test/about"],
      log: () => {},
    });
    expect(res.scored).toBe(2);
    expect(res.score).toBe(90);
    const sidecar = JSON.parse(fs.readFileSync(res.sidecarPath, "utf8"));
    expect(sidecar.coverage).toEqual({ pagesInSet: 2, scored: 2, errored: 0, capped: 0 });
    expect(sidecar.outstanding.bySeverity.serious).toBe(1);
    expect(sidecar.outstanding.byWcag.AA).toBe(1);
  });

  it("caps new pages per run", async () => {
    const res = await runSiteAudit({
      siteName: "demo", sitesFile, auditsBase, pageCachePath: cachePath, maxNewPages: 1,
      fetcher: fakeFetcher({}),
      fetchSitemap: async () => ["https://demo.test/", "https://demo.test/about"],
      log: () => {},
    });
    expect(res.scored).toBe(1);
    expect(res.capped).toBe(1);
  });

  it("errors cleanly for an unknown site", async () => {
    const res = await runSiteAudit({ siteName: "ghost", sitesFile, auditsBase, pageCachePath: cachePath, fetcher: fakeFetcher({}), fetchSitemap: async () => [], log: () => {} });
    expect(res.error).toMatch(/not found/);
  });
});
