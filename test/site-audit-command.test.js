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

  // v1.39.0: a 200 response with no numeric score used to be cached as a
  // success and silently dropped from the scored set (neither scored nor
  // errored). It now counts as errored and never enters the page cache.
  it("counts a 200-without-score as errored and does not cache it", async () => {
    const good = fakeFetcher({ "https://demo.test/": 95 });
    const fetcher = async (endpoint, init) => {
      const { url } = JSON.parse(init.body);
      if (url === "https://demo.test/broken") {
        return { url, axe: {}, reportUrl: "https://audit.icjia.app/page-report/x", cached: false };
      }
      return good(endpoint, init);
    };
    const res = await runSiteAudit({
      siteName: "demo", sitesFile, auditsBase, pageCachePath: cachePath,
      fetcher,
      fetchSitemap: async () => ["https://demo.test/", "https://demo.test/broken"],
      log: () => {},
    });
    expect(res.scored).toBe(1);
    expect(res.errored).toBe(1);
    const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    expect(cache["https://demo.test/broken"]).toBeUndefined();
    expect(cache["https://demo.test/"]).toBeDefined();
  });

  // v1.39.0 (Interface Contract 2): the sidecar's canonical home is
  // <auditsBase>/<slug>/site-audit.json — sibling of latest/, so run purges
  // can never delete it. The prior sidecar is read new-path-first with a
  // one-release fallback to the old latest/site-audit.json.
  it("writes the sidecar to <auditsBase>/<slug>/site-audit.json (outside latest/)", async () => {
    const res = await runSiteAudit({
      siteName: "demo", sitesFile, auditsBase, pageCachePath: cachePath,
      fetcher: fakeFetcher({}),
      fetchSitemap: async () => ["https://demo.test/"],
      log: () => {},
    });
    expect(res.sidecarPath).toBe(path.join(auditsBase, "demo", "site-audit.json"));
    expect(fs.existsSync(res.sidecarPath)).toBe(true);
    expect(fs.existsSync(path.join(auditsBase, "demo", "latest", "site-audit.json"))).toBe(false);
  });

  it("falls back to latest/site-audit.json for the prior when the new path is absent", async () => {
    const latestDir = path.join(auditsBase, "demo", "latest");
    fs.mkdirSync(latestDir, { recursive: true });
    const legacyPath = path.join(latestDir, "site-audit.json");
    const prior = {
      schema: 1, siteName: "demo", auditedAt: "2026-06-01T00:00:00Z",
      score: 80, issueKeys: ["stale-key"],
      scoreHistory: [{ date: "2026-06-01T00:00:00Z", score: 80, outstandingTotal: 1 }],
      pages: [{ url: "https://demo.test/" }, { url: "https://demo.test/about" }],
    };
    fs.writeFileSync(legacyPath, JSON.stringify(prior));
    const res = await runSiteAudit({
      siteName: "demo", sitesFile, auditsBase, pageCachePath: cachePath,
      fetcher: fakeFetcher({ "https://demo.test/": 100, "https://demo.test/about": 80 }),
      fetchSitemap: async () => ["https://demo.test/", "https://demo.test/about"],
      log: () => {},
    });
    const sidecar = JSON.parse(fs.readFileSync(res.sidecarPath, "utf8"));
    expect(sidecar.trend).not.toBeNull();
    expect(sidecar.trend.vsDate).toBe("2026-06-01T00:00:00Z");
    expect(sidecar.scoreHistory).toHaveLength(2);
    // legacy file untouched, new canonical file written alongside latest/
    expect(fs.existsSync(legacyPath)).toBe(true);
    expect(res.sidecarPath).toBe(path.join(auditsBase, "demo", "site-audit.json"));
  });

  // v1.39.0 post-audit fix (red-1 R5): after the first post-fix scan repoints
  // latest/, the only existing prior sidecar lives in runs/<ts>Z/ — found by
  // neither the canonical nor the latest/ path, so trend/scoreHistory would
  // reset once and the purge would then delete the stranded copy for good.
  // Mirror E2's runs-scavenging: newest *Z first, read-only.
  it("falls back to the newest runs/<ts>Z/site-audit.json when canonical and latest/ both miss", async () => {
    const mkPrior = (auditedAt, score) => JSON.stringify({
      schema: 1, siteName: "demo", auditedAt, score, issueKeys: [],
      scoreHistory: [{ date: auditedAt, score, outstandingTotal: 0 }],
      pages: [{ url: "https://demo.test/" }],
    });
    const oldRun = path.join(auditsBase, "demo", "runs", "20260501-000000Z");
    const newRun = path.join(auditsBase, "demo", "runs", "20260601-000000Z");
    fs.mkdirSync(oldRun, { recursive: true });
    fs.mkdirSync(newRun, { recursive: true });
    fs.writeFileSync(path.join(oldRun, "site-audit.json"), mkPrior("2026-05-01T00:00:00Z", 60));
    fs.writeFileSync(path.join(newRun, "site-audit.json"), mkPrior("2026-06-01T00:00:00Z", 80));
    const res = await runSiteAudit({
      siteName: "demo", sitesFile, auditsBase, pageCachePath: cachePath,
      fetcher: fakeFetcher({}),
      fetchSitemap: async () => ["https://demo.test/"],
      log: () => {},
    });
    const sidecar = JSON.parse(fs.readFileSync(res.sidecarPath, "utf8"));
    // The NEWEST stranded prior wins; trend + scoreHistory carry forward.
    expect(sidecar.trend).not.toBeNull();
    expect(sidecar.trend.vsDate).toBe("2026-06-01T00:00:00Z");
    expect(sidecar.scoreHistory).toHaveLength(2);
    expect(sidecar.scoreHistory[0].score).toBe(80);
    // Read-only fallback: the stranded copies are untouched; the fresh
    // sidecar lands at the canonical path.
    expect(fs.existsSync(path.join(newRun, "site-audit.json"))).toBe(true);
    expect(fs.existsSync(path.join(oldRun, "site-audit.json"))).toBe(true);
    expect(res.sidecarPath).toBe(path.join(auditsBase, "demo", "site-audit.json"));
  });

  it("runs/ scavenging is a LAST resort — a latest/ prior still wins over runs/ copies", async () => {
    const mkPrior = (auditedAt) => JSON.stringify({
      schema: 1, siteName: "demo", auditedAt, score: 70, issueKeys: [],
      scoreHistory: [{ date: auditedAt, score: 70, outstandingTotal: 0 }],
      pages: [{ url: "https://demo.test/" }],
    });
    const latestDir = path.join(auditsBase, "demo", "latest");
    const runDir = path.join(auditsBase, "demo", "runs", "20260620-000000Z");
    fs.mkdirSync(latestDir, { recursive: true });
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(latestDir, "site-audit.json"), mkPrior("2026-06-10T00:00:00Z"));
    fs.writeFileSync(path.join(runDir, "site-audit.json"), mkPrior("2026-06-20T00:00:00Z"));
    const res = await runSiteAudit({
      siteName: "demo", sitesFile, auditsBase, pageCachePath: cachePath,
      fetcher: fakeFetcher({}),
      fetchSitemap: async () => ["https://demo.test/"],
      log: () => {},
    });
    const sidecar = JSON.parse(fs.readFileSync(res.sidecarPath, "utf8"));
    expect(sidecar.trend.vsDate).toBe("2026-06-10T00:00:00Z");
  });

  it("prefers the new-path prior over a stale latest/ copy", async () => {
    const siteDir = path.join(auditsBase, "demo");
    fs.mkdirSync(path.join(siteDir, "latest"), { recursive: true });
    const mkPrior = (auditedAt) => JSON.stringify({
      schema: 1, siteName: "demo", auditedAt, score: 70, issueKeys: [],
      scoreHistory: [{ date: auditedAt, score: 70, outstandingTotal: 0 }],
      pages: [{ url: "https://demo.test/" }],
    });
    fs.writeFileSync(path.join(siteDir, "site-audit.json"), mkPrior("2026-06-20T00:00:00Z"));
    fs.writeFileSync(path.join(siteDir, "latest", "site-audit.json"), mkPrior("2026-06-01T00:00:00Z"));
    const res = await runSiteAudit({
      siteName: "demo", sitesFile, auditsBase, pageCachePath: cachePath,
      fetcher: fakeFetcher({}),
      fetchSitemap: async () => ["https://demo.test/"],
      log: () => {},
    });
    const sidecar = JSON.parse(fs.readFileSync(res.sidecarPath, "utf8"));
    expect(sidecar.trend.vsDate).toBe("2026-06-20T00:00:00Z");
  });

  // v1.39.0: end-to-end — a page dropping out of the scored set between runs
  // shows up as coverageChanged, never as "fixed" issues.
  it("second run: a dropped page's issues are coverage change, not fixes", async () => {
    const fetcher = fakeFetcher({ "https://demo.test/": 100, "https://demo.test/about": 80 });
    await runSiteAudit({
      siteName: "demo", sitesFile, auditsBase, pageCachePath: cachePath,
      fetcher,
      fetchSitemap: async () => ["https://demo.test/", "https://demo.test/about"],
      log: () => {},
    });
    const res2 = await runSiteAudit({
      siteName: "demo", sitesFile, auditsBase, pageCachePath: cachePath,
      fetcher,
      fetchSitemap: async () => ["https://demo.test/"], // /about left the set
      log: () => {},
    });
    const sidecar = JSON.parse(fs.readFileSync(res2.sidecarPath, "utf8"));
    expect(sidecar.trend).not.toBeNull();
    expect(sidecar.trend.fixed).toBe(0); // /about's violation is NOT "fixed"
    expect(sidecar.trend.new).toBe(0);
    expect(sidecar.trend.coverageChanged).toEqual({ added: 0, removed: 1 });
    expect(sidecar.issueKeysByPage).toEqual({});
  });

  it("errors cleanly for an unknown site", async () => {
    const res = await runSiteAudit({ siteName: "ghost", sitesFile, auditsBase, pageCachePath: cachePath, fetcher: fakeFetcher({}), fetchSitemap: async () => [], log: () => {} });
    expect(res.error).toMatch(/not found/);
  });
});

describe("runSiteAudit — per-site maxNewPages from sites.json", () => {
  it("uses the site's configured maxNewPages when no explicit cap is passed", async () => {
    fs.writeFileSync(sitesFile, JSON.stringify({ sites: [{ name: "demo", siteUrl: "https://demo.test/", maxNewPages: 1 }] }));
    const res = await runSiteAudit({
      siteName: "demo", sitesFile, auditsBase, pageCachePath: cachePath,
      fetcher: fakeFetcher({}),
      fetchSitemap: async () => ["https://demo.test/", "https://demo.test/about"],
      log: () => {},
    });
    expect(res.scored).toBe(1);
    expect(res.capped).toBe(1);
  });

  it("lets an explicit maxNewPages override the site's configured value", async () => {
    fs.writeFileSync(sitesFile, JSON.stringify({ sites: [{ name: "demo", siteUrl: "https://demo.test/", maxNewPages: 1 }] }));
    const res = await runSiteAudit({
      siteName: "demo", sitesFile, auditsBase, pageCachePath: cachePath, maxNewPages: 5,
      fetcher: fakeFetcher({}),
      fetchSitemap: async () => ["https://demo.test/", "https://demo.test/about"],
      log: () => {},
    });
    expect(res.capped).toBe(0);
  });
});

// v1.68.0 — the sitemap-completeness check, wired into the command.
describe("runSiteAudit — sitemap completeness (v1.68.0)", () => {
  // A CMS sidecar naming three pages the sitemap does not list.
  function writeCmsSidecar(urls) {
    const dir = path.join(auditsBase, "demo", "latest");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "references-sidecar.ndjson"),
      urls.map((u, i) => JSON.stringify({
        siteName: "demo", contentType: "page", entryId: i, slug: `s${i}`,
        pageUrl: u, referencedFiles: [],
      })).join("\n") + "\n",
    );
  }

  it("reports only the indexable 200 — not the retired, noindex or broken ones", async () => {
    writeCmsSidecar([
      "https://demo.test/",              // in the sitemap
      "https://demo.test/retired/",      // 301 — deliberate
      "https://demo.test/dupe/",         // 200 noindex — deliberate
      "https://demo.test/gone/",         // 404 — a different problem
      "https://demo.test/real/",         // 200 indexable — the finding
    ]);
    const probes = [];
    const res = await runSiteAudit({
      siteName: "demo", sitesFile, auditsBase, pageCachePath: cachePath,
      fetcher: fakeFetcher({}),
      fetchSitemap: async () => ["https://demo.test/"],
      pageProbe: async (u) => {
        probes.push(u);
        if (u.includes("/retired/")) return { status: 301, location: "https://demo.test/" };
        if (u.includes("/dupe/")) return { status: 200, indexable: false };
        if (u.includes("/gone/")) return { status: 404 };
        return { status: 200, indexable: true };
      },
      log: () => {},
    });

    const sidecar = JSON.parse(fs.readFileSync(res.sidecarPath, "utf8"));
    expect(sidecar.sitemapCoverage.counts).toMatchObject({
      omission: 1, retired: 1, noindex: 1, broken: 1, probed: 4,
    });
    expect(sidecar.sitemapCoverage.omissions).toEqual([
      { url: "https://demo.test/real/", status: 200 },
    ]);
    // The page already in the sitemap is never probed.
    expect(probes).not.toContain("https://demo.test/");
  });

  it("can be turned off", async () => {
    writeCmsSidecar(["https://demo.test/never-probed/"]);
    let called = false;
    const res = await runSiteAudit({
      siteName: "demo", sitesFile, auditsBase, pageCachePath: cachePath,
      checkSitemap: false,
      fetcher: fakeFetcher({}),
      fetchSitemap: async () => ["https://demo.test/"],
      pageProbe: async () => { called = true; return { status: 200, indexable: true }; },
      log: () => {},
    });
    expect(called).toBe(false);
    const sidecar = JSON.parse(fs.readFileSync(res.sidecarPath, "utf8"));
    expect(sidecar.sitemapCoverage).toBeUndefined();
  });

  it("a failing probe never fails the run", async () => {
    writeCmsSidecar(["https://demo.test/boom/"]);
    const res = await runSiteAudit({
      siteName: "demo", sitesFile, auditsBase, pageCachePath: cachePath,
      fetcher: fakeFetcher({}),
      fetchSitemap: async () => ["https://demo.test/"],
      pageProbe: async () => { throw new Error("ECONNRESET"); },
      log: () => {},
    });
    expect(res.score).toBeTypeOf("number");
    const sidecar = JSON.parse(fs.readFileSync(res.sidecarPath, "utf8"));
    expect(sidecar.sitemapCoverage.counts.unknown).toBe(1);
    expect(sidecar.sitemapCoverage.counts.omission).toBe(0);
  });
});
