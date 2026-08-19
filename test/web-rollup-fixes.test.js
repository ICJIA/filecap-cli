// v1.39.0 review fixes — Package E (web-rollup + bundle renderers).
// Covers: E1 deploy-failure exit, E2 a11y-history relocation/migration,
// E3 site-audit sidecar new path, E4 config description precedence,
// E5 duplicates over all entries, E6 sites.json base/pathPrefix in per-site
// sheets, E7 legacy-office in computeSiteSummary, E8 csvFile only when a
// workbook was written.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";
import {
  runWebRollup,
  deployOutcomeToExit,
  loadA11yHistory,
  loadSiteAudit,
} from "../src/commands/web-rollup.js";

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-web-rollup-fixes-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Write an inventory NDJSON with arbitrary entries. */
async function writeInv(filePath, { serverName, scannedAt = "2026-06-20T12:00:00.000Z", publicUrlBase, entries }) {
  const lines = [JSON.stringify({
    schemaVersion: 1,
    kind: "filecap-inventory-header",
    metadata: {
      serverName,
      hostname: `${serverName}.example.com`,
      serverIp: "10.0.0.9",
      scannedPath: "/uploads",
      scannedAt,
      ...(publicUrlBase ? { publicUrlBase } : {}),
      filecapVersion: "1.1.1",
      nodeVersion: "v20.18.0",
      options: { hash: true, introspect: false, maxIntrospectMb: 200, concurrency: 4 },
    },
  })];
  for (const e of entries) lines.push(JSON.stringify(e));
  lines.push(JSON.stringify({ kind: "filecap-inventory-footer", entryCount: entries.length, scannedAt }));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, lines.join("\n") + "\n", "utf8");
}

const pdfEntry = (i, score) => ({
  path: `f${i}.pdf`, absolutePath: `/uploads/f${i}.pdf`, filename: `f${i}.pdf`,
  extension: "pdf", category: "pdf", remediable: true, sizeBytes: 100 + i,
  modifiedAt: "2024-01-01T00:00:00.000Z", sha256: `hash-${i}`, flags: [],
  ...(typeof score === "number"
    ? { audit: { audited: true, cached: false, checkedAt: "2026-06-20T12:00:00.000Z", score, grade: "B" } }
    : {}),
});

async function writeSites(sites) {
  const sitesFile = path.join(tmpDir, "sites.json");
  await fs.writeFile(sitesFile, JSON.stringify({ version: 1, sites }));
  return sitesFile;
}

function captureStderr() {
  const orig = process.stderr.write.bind(process.stderr);
  let out = "";
  process.stderr.write = (s) => { out += s; return true; };
  return { restore: () => { process.stderr.write = orig; }, text: () => out };
}

// ── E1: deploy failures must fail the run ──────────────────────────────────────

describe("deploy failures fail the run (v1.39.0 E1)", () => {
  let savedNoDeploy;
  beforeEach(() => {
    savedNoDeploy = process.env.FILECAP_NO_DEPLOY;
    delete process.env.FILECAP_NO_DEPLOY;
  });
  afterEach(() => {
    if (savedNoDeploy === undefined) delete process.env.FILECAP_NO_DEPLOY;
    else process.env.FILECAP_NO_DEPLOY = savedNoDeploy;
  });

  // spawn-compatible stub: fires `error` or `close` on the next tick.
  function fakeSpawn({ code = 0, error = null } = {}, calls = []) {
    return (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      const handlers = {};
      const child = { on(evt, cb) { handlers[evt] = cb; return child; } };
      setImmediate(() => {
        if (error) handlers.error?.(error);
        else handlers.close?.(code);
      });
      return child;
    };
  }

  // Defense-in-depth: this repo may be netlify-linked on a dev machine. Every
  // deploy-flagged test passes a bogus --site so that even a regression in the
  // _netlifySpawn injection could never reach the real linked site.
  const BOGUS_SITE = "filecap-test-invalid-site-never-deploys";

  async function fixture() {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    // v1.41.0 — the PDF carries a score so these deploy-outcome tests exercise
    // a HEALTHY bundle. An unscored inventory now trips the unscored-guard and
    // returns exit 3 before the deploy is ever attempted (by design); that path
    // has its own coverage below.
    await writeInv(path.join(auditsBase, "dvfr", "latest", "inventory.ndjson"), {
      serverName: "dvfr", entries: [pdfEntry(0, 80)],
    });
    const sitesFile = await writeSites([
      { name: "dvfr", siteName: "DVFR", host: "10.0.0.1", user: "forge", remotePath: "/uploads" },
    ]);
    return { sitesFile, auditsBase, outputDir: path.join(tmpDir, "out") };
  }

  it("deployOutcomeToExit: requested+failed→1, requested+ok→0, skipped→0", () => {
    expect(deployOutcomeToExit({ requested: true, ok: false })).toBe(1);
    expect(deployOutcomeToExit({ requested: true, ok: true })).toBe(0);
    expect(deployOutcomeToExit({ requested: false, ok: false })).toBe(0);
    expect(deployOutcomeToExit({ requested: false, ok: true })).toBe(0);
  });

  it("netlify exiting non-zero → exitCode 1 with the FAILED stderr line", async () => {
    const { sitesFile, auditsBase, outputDir } = await fixture();
    const cap = captureStderr();
    let result;
    try {
      result = await runWebRollup({
        output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true,
        deploy: true, deploySite: BOGUS_SITE, _netlifySpawn: fakeSpawn({ code: 1 }),
      });
    } finally {
      cap.restore();
    }
    expect(result.exitCode).toBe(1);
    expect(cap.text()).toContain(`bundle written to ${outputDir} but deploy FAILED — production not updated`);
    // The bundle itself was still written.
    expect((await fs.stat(path.join(outputDir, "index.html"))).isFile()).toBe(true);
  });

  it("missing netlify CLI (ENOENT) → exitCode 1 + install hint", async () => {
    const { sitesFile, auditsBase, outputDir } = await fixture();
    const enoent = Object.assign(new Error("spawn netlify ENOENT"), { code: "ENOENT" });
    const cap = captureStderr();
    let result;
    try {
      result = await runWebRollup({
        output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true,
        deploy: true, deploySite: BOGUS_SITE, _netlifySpawn: fakeSpawn({ error: enoent }),
      });
    } finally {
      cap.restore();
    }
    expect(result.exitCode).toBe(1);
    expect(cap.text()).toContain("npm install -g netlify-cli");
    expect(cap.text()).toContain("deploy FAILED — production not updated");
  });

  it("successful deploy keeps exitCode 0", async () => {
    const { sitesFile, auditsBase, outputDir } = await fixture();
    const cap = captureStderr();
    let result;
    try {
      result = await runWebRollup({
        output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true,
        deploy: true, deploySite: BOGUS_SITE, _netlifySpawn: fakeSpawn({ code: 0 }),
      });
    } finally {
      cap.restore();
    }
    expect(result.exitCode).toBe(0);
  });

  it("FILECAP_NO_DEPLOY=1 skips the deploy (never spawns) and stays exit 0", async () => {
    const { sitesFile, auditsBase, outputDir } = await fixture();
    process.env.FILECAP_NO_DEPLOY = "1";
    const calls = [];
    const cap = captureStderr();
    let result;
    try {
      result = await runWebRollup({
        output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true,
        deploy: true, deploySite: BOGUS_SITE, _netlifySpawn: fakeSpawn({ code: 1 }, calls),
      });
    } finally {
      cap.restore();
    }
    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(0);
    expect(cap.text()).toContain("FILECAP_NO_DEPLOY=1");
  });

  // ── v1.41.0 — unscored-inventory deploy guard ───────────────────────────────
  // Regression cover for the 2026-07-27 incident: the audits stage died, every
  // inventory lost its PDF scores, and nothing stood between that and a push to
  // production. An unscored PDF here stands in for "Stage 3.5 never ran".

  async function unscoredFixture() {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    await writeInv(path.join(auditsBase, "dvfr", "latest", "inventory.ndjson"), {
      serverName: "dvfr", entries: [pdfEntry(0)], // no score
    });
    const sitesFile = await writeSites([
      { name: "dvfr", siteName: "DVFR", host: "10.0.0.1", user: "forge", remotePath: "/uploads" },
    ]);
    return { sitesFile, auditsBase, outputDir: path.join(tmpDir, "out-unscored") };
  }

  it("refuses to deploy an unscored bundle: exit 3, netlify never spawned", async () => {
    const { sitesFile, auditsBase, outputDir } = await unscoredFixture();
    const calls = [];
    const cap = captureStderr();
    let result;
    try {
      result = await runWebRollup({
        output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true,
        deploy: true, deploySite: BOGUS_SITE, _netlifySpawn: fakeSpawn({ code: 0 }, calls),
      });
    } finally {
      cap.restore();
    }
    expect(result.exitCode).toBe(3);
    expect(calls).toHaveLength(0);
    expect(cap.text()).toContain("REFUSING to deploy");
    expect(cap.text()).toContain("DVFR");
    // The bundle is still written — that is how you diagnose the failure.
    expect((await fs.stat(path.join(outputDir, "index.html"))).isFile()).toBe(true);
  });

  it("--allow-unscored lets the deploy through (still warns)", async () => {
    const { sitesFile, auditsBase, outputDir } = await unscoredFixture();
    const calls = [];
    const cap = captureStderr();
    let result;
    try {
      result = await runWebRollup({
        output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true,
        allowUnscored: true,
        deploy: true, deploySite: BOGUS_SITE, _netlifySpawn: fakeSpawn({ code: 0 }, calls),
      });
    } finally {
      cap.restore();
    }
    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    expect(cap.text()).toContain("0 scored");
  });

  it("a build-only run warns but succeeds", async () => {
    const { sitesFile, auditsBase, outputDir } = await unscoredFixture();
    const cap = captureStderr();
    let result;
    try {
      result = await runWebRollup({
        output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true, deploy: false,
      });
    } finally {
      cap.restore();
    }
    expect(result.exitCode).toBe(0);
    expect(cap.text()).toContain("NO accessibility scores");
    expect(cap.text()).not.toContain("REFUSING to deploy");
  });

  it("FILECAP_NO_DEPLOY=1 downgrades the guard to a warning, not exit 3", async () => {
    const { sitesFile, auditsBase, outputDir } = await unscoredFixture();
    process.env.FILECAP_NO_DEPLOY = "1";
    const calls = [];
    const cap = captureStderr();
    let result;
    try {
      result = await runWebRollup({
        output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true,
        deploy: true, deploySite: BOGUS_SITE, _netlifySpawn: fakeSpawn({ code: 0 }, calls),
      });
    } finally {
      cap.restore();
    }
    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(0);
    expect(cap.text()).toContain("NO accessibility scores");
  });
});

// ── E2: a11y-history relocation + migration + atomic write ─────────────────────

describe("a11y-history relocation + migration (v1.39.0 E2)", () => {
  const P = (at, avg) => ({ at, avg, scored: 5, pdfs: 5, remediable: 5, band: "partial" });

  async function fixtureWithScores() {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    await writeInv(path.join(auditsBase, "dvfr", "latest", "inventory.ndjson"), {
      serverName: "dvfr",
      entries: [0, 1, 2, 3, 4].map((i) => pdfEntry(i, 80)),
    });
    const sitesFile = await writeSites([
      { name: "dvfr", siteName: "DVFR", host: "10.0.0.1", user: "forge", remotePath: "/uploads" },
    ]);
    return { sitesFile, auditsBase, outputDir: path.join(tmpDir, "out") };
  }

  it("writes the series to <base>/<slug>/a11y-history.json (not latest/), with no tmp file left", async () => {
    const { sitesFile, auditsBase, outputDir } = await fixtureWithScores();
    const result = await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });
    expect(result.exitCode).toBe(0);
    const hist = JSON.parse(await fs.readFile(path.join(auditsBase, "dvfr", "a11y-history.json"), "utf8"));
    expect(Array.isArray(hist)).toBe(true);
    expect(hist).toHaveLength(1);
    expect(hist[0].avg).toBe(80);
    // no leftover temp file, and no new write into latest/
    const siteFiles = await fs.readdir(path.join(auditsBase, "dvfr"));
    expect(siteFiles.filter((f) => f.includes(".tmp"))).toEqual([]);
    const latestFiles = await fs.readdir(path.join(auditsBase, "dvfr", "latest"));
    expect(latestFiles).not.toContain("a11y-history.json");
  });

  it("migrates + dedupes points from latest/ AND runs/*Z into the new path, sorted ascending", async () => {
    const { sitesFile, auditsBase, outputDir } = await fixtureWithScores();
    const latestPt = P("2026-06-01T12:00:00.000Z", 70);
    const runPts = [P("2026-05-20T12:00:00.000Z", 60), P("2026-06-01T12:00:00.000Z", 70)];
    await fs.writeFile(path.join(auditsBase, "dvfr", "latest", "a11y-history.json"), JSON.stringify([latestPt]));
    const runDir = path.join(auditsBase, "dvfr", "runs", "20260520-120000Z");
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, "a11y-history.json"), JSON.stringify(runPts));

    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });

    const hist = JSON.parse(await fs.readFile(path.join(auditsBase, "dvfr", "a11y-history.json"), "utf8"));
    // 2 migrated (deduped by `at`) + 1 new appended point
    expect(hist).toHaveLength(3);
    expect(hist.map((p) => p.avg)).toEqual([60, 70, 80]);
    expect(hist.map((p) => p.at)).toEqual([...hist.map((p) => p.at)].sort());
  });

  it("trend survives a scan: chip is computed against the orphaned runs/ point", async () => {
    const { sitesFile, auditsBase, outputDir } = await fixtureWithScores();
    // Simulates latest/ having been repointed by a fresh scan: the history
    // lives ONLY in the previous run dir.
    const runDir = path.join(auditsBase, "dvfr", "runs", "20260601-120000Z");
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(
      path.join(runDir, "a11y-history.json"),
      JSON.stringify([P("2026-06-01T12:00:00.000Z", 70)]),
    );

    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });

    const indexHtml = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(indexHtml).toMatch(/a11y-trend-up[^>]*>▲ 10 since/);
  });

  it("a corrupt new-path file is sidelined (not clobbered) with a WARN; old points recovered", async () => {
    const { sitesFile, auditsBase, outputDir } = await fixtureWithScores();
    const garbage = "{{{ not json";
    await fs.writeFile(path.join(auditsBase, "dvfr", "a11y-history.json"), garbage);
    await fs.writeFile(
      path.join(auditsBase, "dvfr", "latest", "a11y-history.json"),
      JSON.stringify([P("2026-06-01T12:00:00.000Z", 70)]),
    );

    const cap = captureStderr();
    try {
      await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });
    } finally {
      cap.restore();
    }

    const siteFiles = await fs.readdir(path.join(auditsBase, "dvfr"));
    const sidelined = siteFiles.find((f) => /^a11y-history\.json\.corrupt-/.test(f));
    expect(sidelined).toBeTruthy();
    expect(await fs.readFile(path.join(auditsBase, "dvfr", sidelined), "utf8")).toBe(garbage);
    expect(cap.text()).toMatch(/WARN.*corrupt/i);

    const hist = JSON.parse(await fs.readFile(path.join(auditsBase, "dvfr", "a11y-history.json"), "utf8"));
    expect(hist.map((p) => p.avg)).toEqual([70, 80]);
  });

  it("an existing new-path file is authoritative — runs/ copies are not re-merged", async () => {
    const { sitesFile, auditsBase, outputDir } = await fixtureWithScores();
    await fs.writeFile(
      path.join(auditsBase, "dvfr", "a11y-history.json"),
      JSON.stringify([P("2026-06-01T12:00:00.000Z", 70)]),
    );
    const runDir = path.join(auditsBase, "dvfr", "runs", "20260101-000000Z");
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, "a11y-history.json"), JSON.stringify([P("2026-01-01T12:00:00.000Z", 40)]));

    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });

    const hist = JSON.parse(await fs.readFile(path.join(auditsBase, "dvfr", "a11y-history.json"), "utf8"));
    expect(hist.map((p) => p.avg)).toEqual([70, 80]);
  });

  it("loadA11yHistory (unit): merges old locations only when the new path is missing", async () => {
    const base = path.join(tmpDir, "audits-unit");
    await fs.mkdir(path.join(base, "s1", "latest"), { recursive: true });
    await fs.mkdir(path.join(base, "s1", "runs", "20260101-000000Z"), { recursive: true });
    await fs.writeFile(path.join(base, "s1", "latest", "a11y-history.json"), JSON.stringify([P("2026-02-01T12:00:00.000Z", 50)]));
    await fs.writeFile(
      path.join(base, "s1", "runs", "20260101-000000Z", "a11y-history.json"),
      JSON.stringify([P("2026-01-01T12:00:00.000Z", 40), P("2026-02-01T12:00:00.000Z", 50)]),
    );
    const { histPath, history } = await loadA11yHistory(base, "s1");
    expect(histPath).toBe(path.join(base, "s1", "a11y-history.json"));
    expect(history.map((p) => p.avg)).toEqual([40, 50]);
  });
});

// ── E3: loadSiteAudit reads the relocated sidecar ───────────────────────────────

describe("loadSiteAudit new-path-first (v1.39.0 E3)", () => {
  async function mkSite(slug) {
    const base = path.join(tmpDir, "audits-sa");
    await fs.mkdir(path.join(base, slug, "latest"), { recursive: true });
    return base;
  }

  it("reads <base>/<slug>/site-audit.json when present", async () => {
    const base = await mkSite("s1");
    await fs.writeFile(
      path.join(base, "s1", "site-audit.json"),
      JSON.stringify({ score: 91, pages: [{ url: "https://x.example.gov/a", score: 90 }] }),
    );
    const { siteAudit, pageScores } = loadSiteAudit(base, "s1");
    expect(siteAudit?.score).toBe(91);
    expect(pageScores?.size).toBe(1);
  });

  it("falls back to <base>/<slug>/latest/site-audit.json", async () => {
    const base = await mkSite("s2");
    await fs.writeFile(path.join(base, "s2", "latest", "site-audit.json"), JSON.stringify({ score: 77, pages: [] }));
    const { siteAudit } = loadSiteAudit(base, "s2");
    expect(siteAudit?.score).toBe(77);
  });

  it("prefers the new path when both exist", async () => {
    const base = await mkSite("s3");
    await fs.writeFile(path.join(base, "s3", "site-audit.json"), JSON.stringify({ score: 91, pages: [] }));
    await fs.writeFile(path.join(base, "s3", "latest", "site-audit.json"), JSON.stringify({ score: 77, pages: [] }));
    const { siteAudit } = loadSiteAudit(base, "s3");
    expect(siteAudit?.score).toBe(91);
  });

  it("a corrupt new-path file falls back to the old path; neither → nulls", async () => {
    const base = await mkSite("s4");
    await fs.writeFile(path.join(base, "s4", "site-audit.json"), "not json");
    await fs.writeFile(path.join(base, "s4", "latest", "site-audit.json"), JSON.stringify({ score: 77, pages: [] }));
    expect(loadSiteAudit(base, "s4").siteAudit?.score).toBe(77);

    const base2 = await mkSite("s5");
    expect(loadSiteAudit(base2, "s5")).toEqual({ siteAudit: null, pageScores: null });
  });
});

// ── E4: config description wins over the scraped og:description ────────────────

describe("config description precedence (v1.39.0 E4)", () => {
  async function fixture({ description }) {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    await writeInv(path.join(auditsBase, "dvfr", "latest", "inventory.ndjson"), {
      serverName: "dvfr", entries: [pdfEntry(0)],
    });
    const sitesFile = path.join(tmpDir, "sites.json");
    await fs.writeFile(sitesFile, JSON.stringify({
      version: 1,
      sites: [{
        name: "dvfr", siteName: "DVFR", siteUrl: "https://dvfr.example.gov",
        host: "10.0.0.1", user: "forge", remotePath: "/uploads",
        ...(description ? { description } : {}),
      }],
      tools: [{
        name: "fleet-tool", siteName: "Fleet", siteUrl: "https://fleet.example.gov",
        ...(description ? { description: "Curated tool description." } : {}),
      }],
    }));
    return { sitesFile, auditsBase, outputDir: path.join(tmpDir, "out") };
  }

  it("config description wins over a scraped og:description (sites + tools)", async () => {
    const { sitesFile, auditsBase, outputDir } = await fixture({ description: "Curated site description." });
    const _ogFetch = async () => ({ image: null, title: "T", description: "Scraped description.", reachable: true });
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, _ogFetch, _imageFetch: async () => null });
    const sitesHtml = await fs.readFile(path.join(outputDir, "sites.html"), "utf8");
    expect(sitesHtml).toContain("Curated site description.");
    expect(sitesHtml).toContain("Curated tool description.");
    expect(sitesHtml).not.toContain("Scraped description.");
    const indexHtml = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(indexHtml).toContain("Curated site description.");
  });

  it("falls back to the scraped og:description when no config description", async () => {
    const { sitesFile, auditsBase, outputDir } = await fixture({ description: null });
    const _ogFetch = async () => ({ image: null, title: "T", description: "Scraped description.", reachable: true });
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, _ogFetch, _imageFetch: async () => null });
    const sitesHtml = await fs.readFile(path.join(outputDir, "sites.html"), "utf8");
    expect(sitesHtml).toContain("Scraped description.");
  });

  it("no config description + failed scrape → empty description (no card-desc)", async () => {
    const { sitesFile, auditsBase, outputDir } = await fixture({ description: null });
    const _ogFetch = async () => ({ image: null, title: null, description: null, reachable: false });
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, _ogFetch, _imageFetch: async () => null });
    const indexHtml = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    // No rendered description paragraph (the class name still exists as a
    // CSS selector in the shared stylesheet, so match the element).
    expect(indexHtml).not.toMatch(/<p class="card-desc">/);
  });

  it("config description survives noOg (gated sites keep their curated copy)", async () => {
    const { sitesFile, auditsBase, outputDir } = await fixture({ description: "Curated site description." });
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });
    const sitesHtml = await fs.readFile(path.join(outputDir, "sites.html"), "utf8");
    expect(sitesHtml).toContain("Curated site description.");
    expect(sitesHtml).toContain("Curated tool description.");
  });
});

// ── E5: duplicate detection over ALL entries (reference files included) ─────────

describe("duplicates over all entries (v1.39.0 E5)", () => {
  it("a reference-side (.png) cross-server duplicate reaches the rendered table + workbook", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    const logo = {
      path: "logo.png", absolutePath: "/uploads/logo.png", filename: "logo.png",
      extension: "png", category: "image", remediable: false, sizeBytes: 10,
      modifiedAt: "2024-01-01T00:00:00.000Z", sha256: "img-hash", flags: [],
    };
    for (const sn of ["dvfr", "r3"]) {
      await writeInv(path.join(auditsBase, sn, "latest", "inventory.ndjson"), {
        serverName: sn, entries: [pdfEntry(0), logo],
      });
    }
    const sitesFile = await writeSites([
      { name: "dvfr", siteName: "DVFR", host: "10.0.0.1", user: "forge", remotePath: "/uploads" },
      { name: "r3", siteName: "R3", host: "10.0.0.2", user: "forge", remotePath: "/uploads" },
    ]);
    const outputDir = path.join(tmpDir, "out");
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });

    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    // The .png group row carries the reference side attribute the filter reads.
    expect(html).toMatch(/<tr data-dup-side="reference">\s*<td title="logo\.png">/);
    // The remediable group (doc f0.pdf) is still classified remediable.
    expect(html).toMatch(/<tr data-dup-side="remediable">\s*<td title="f0\.pdf">/);
    // The "Reference only" chip counts the png group.
    expect(html).toMatch(/data-dup-filter="reference"[^>]*>Reference only <span class="dup-filter-count">1<\/span>/);

    // The per-occurrence workbook now includes the reference-side rows too.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(outputDir, "audit-file-duplicates.xlsx"));
    const sheet = wb.getWorksheet("Duplicates");
    let sawPng = false;
    sheet.eachRow((row) => {
      if (row.values.some((v) => v === "logo.png")) sawPng = true;
    });
    expect(sawPng).toBe(true);
  });
});

// ── E6: sites.json publicUrlBase + pathPrefix drive per-site sheet URLs ─────────

describe("per-site sheet URLs use the sites.json-resolved base (v1.39.0 E6)", () => {
  it("PDFs tab Public URL = sites.json base + pathPrefix + encoded path (not the stale cached base)", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    await writeInv(path.join(auditsBase, "ari", "latest", "inventory.ndjson"), {
      serverName: "ari",
      publicUrlBase: "https://old.example.gov/uploads", // stale cached header value
      entries: [{
        path: "docs/a b.pdf", absolutePath: "/uploads/docs/a b.pdf", filename: "a b.pdf",
        extension: "pdf", category: "pdf", remediable: true, sizeBytes: 10,
        modifiedAt: "2024-01-01T00:00:00.000Z", sha256: "h1", flags: [],
      }],
    });
    const sitesFile = await writeSites([{
      name: "ari", siteName: "ARI", host: "10.0.0.1", user: "forge", remotePath: "/uploads",
      publicUrlBase: "https://files.example.gov", pathPrefix: "static",
    }]);
    const outputDir = path.join(tmpDir, "out");
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });

    const files = await fs.readdir(outputDir);
    const wbName = files.find((f) => /^ari-.*\.xlsx$/.test(f));
    expect(wbName).toBeTruthy();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(outputDir, wbName));
    const sheet = wb.getWorksheet("PDFs");
    expect(sheet).toBeTruthy();
    const headerRow = sheet.getRow(1).values.slice(1).map((v) => (v && v.text) ? v.text : v);
    const urlCol = headerRow.indexOf("Public URL") + 1;
    expect(urlCol).toBeGreaterThan(0);
    const cell = sheet.getRow(2).getCell(urlCol).value;
    const url = cell && cell.hyperlink ? cell.hyperlink : String(cell ?? "");
    expect(url).toBe("https://files.example.gov/static/docs/a%20b.pdf");
  });
});

// ── E7: legacy-office in computeSiteSummary ─────────────────────────────────────

describe("legacy-office counts as remediable in computeSiteSummary (v1.39.0 E7)", () => {
  // v1.39.0 post-audit update (red-1 R1b, audit-red-contracts.md): the
  // original E7 fixture fed one entry with category "office-legacy" as a
  // "cached-inventory synonym". red-1 proved that string is a PHANTOM — no
  // scanner version ever emitted it as a *category* (old .doc files were
  // "office-document"; "office-legacy" exists only as an introspection
  // *kind*), so the synonym branches were removed and this fixture now uses
  // the real category for both entries. The phantom's non-counting is pinned
  // by the test below.
  it("counts 'legacy-office' entries in the tile, page estimate, and by-type row", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    await writeInv(path.join(auditsBase, "dvfr", "latest", "inventory.ndjson"), {
      serverName: "dvfr",
      entries: [
        {
          path: "old.doc", absolutePath: "/uploads/old.doc", filename: "old.doc",
          extension: "doc", category: "legacy-office", remediable: true, sizeBytes: 10,
          modifiedAt: "2024-01-01T00:00:00.000Z", sha256: "d1", flags: [],
        },
        {
          path: "old.xls", absolutePath: "/uploads/old.xls", filename: "old.xls",
          extension: "xls", category: "legacy-office", remediable: true, sizeBytes: 10,
          modifiedAt: "2024-01-01T00:00:00.000Z", sha256: "x1", flags: [],
        },
      ],
    });
    const sitesFile = await writeSites([
      { name: "dvfr", siteName: "DVFR", host: "10.0.0.1", user: "forge", remotePath: "/uploads" },
    ]);
    const outputDir = path.join(tmpDir, "out");
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });

    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    // Both legacy files count as remediable in the card's donut caption…
    expect(html).toContain("2 of 2 files");
    // …and both feed the ×5 legacy-office page estimate (2 × 5 = 10).
    expect(html).toContain("≈ 10 document pages");
    // The by-type table shows one merged Legacy Office row counting both.
    expect(html).toMatch(/Legacy Office \(\.doc, \.xls, \.ppt\)[\s\S]{0,400}?<td class="num">(<a[^>]*>)?2(<\/a>)?<\/td>/);
  });

  // v1.39.0 post-audit fix (red-1 R1b): "office-legacy" is a phantom category
  // — no scan (HEAD or current) ever emitted it, it is not in the schema
  // enum, and the "cached-inventory synonym" comments were false. An
  // out-of-schema entry claiming it must NOT count as remediable.
  it("an out-of-schema 'office-legacy' category does NOT count (phantom string)", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    await writeInv(path.join(auditsBase, "dvfr", "latest", "inventory.ndjson"), {
      serverName: "dvfr",
      entries: [
        pdfEntry(0),
        {
          path: "old.xls", absolutePath: "/uploads/old.xls", filename: "old.xls",
          extension: "xls", category: "office-legacy", remediable: true, sizeBytes: 10,
          modifiedAt: "2024-01-01T00:00:00.000Z", sha256: "x1", flags: [],
        },
      ],
    });
    const sitesFile = await writeSites([
      { name: "dvfr", siteName: "DVFR", host: "10.0.0.1", user: "forge", remotePath: "/uploads" },
    ]);
    const outputDir = path.join(tmpDir, "out");
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });

    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    // Only the pdf counts as remediable…
    expect(html).toContain("1 of 2 files");
    // …and the phantom contributes no ×5 page estimate.
    expect(html).not.toContain("≈ 5 document pages");
  });

  // v1.54.0 final-review gap: index-page.test.js and report-html.test.js both
  // pin the unscoreableCount -> coverage-clause WIRING, but each hands the
  // renderer an already-built summary/tally — neither exercises
  // computeSiteSummary()'s own NDJSON-parsing loop (the isUnscoreableDocument
  // branch at its heart). This test goes through the real path: a genuine
  // inventory file, the real computeSiteSummary(), and the rendered card.
  it("a lone legacy-office entry drives computeSiteSummary's unscoreableCount to exactly 1, through to the rendered card", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    await writeInv(path.join(auditsBase, "dvfr", "latest", "inventory.ndjson"), {
      serverName: "dvfr",
      entries: [
        // Five scored PDFs clear MIN_SCORED_DOCS so the card takes the banded
        // branch — the thin-data branch never renders the coverage clause
        // (and so never mentions the unscoreable count) at all.
        pdfEntry(0, 80), pdfEntry(1, 80), pdfEntry(2, 80), pdfEntry(3, 80), pdfEntry(4, 80),
        {
          path: "old.doc", absolutePath: "/uploads/old.doc", filename: "old.doc",
          extension: "doc", category: "legacy-office", remediable: true, sizeBytes: 10,
          modifiedAt: "2024-01-01T00:00:00.000Z", sha256: "d1", flags: [],
        },
      ],
    });
    const sitesFile = await writeSites([
      { name: "dvfr", siteName: "DVFR", host: "10.0.0.1", user: "forge", remotePath: "/uploads" },
    ]);
    const outputDir = path.join(tmpDir, "out");
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });

    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    // 5 scored of 6 remediable (5 pdf + 1 legacy-office) files.
    expect(html).toContain("5 of 6 remediable files scored");
    // Singular "file" only renders when unscoreableCount === 1 exactly (the
    // ternary in fileA11yCoverageText switches to "files" for any other
    // count) — "can't" is HTML-entity-escaped (&#39;) in the rendered card.
    expect(html).toContain("1 legacy Office file can");
    expect(html).toContain("be machine-scored (re-save as .docx/.xlsx/.pptx to score them)");
  });
});

// ── Audit fix (red-1 R1a/R1b): fleet-context markdown legacy-office row + enum ──

describe("fleet-context markdown legacy-office (v1.39.0 audit R1a/R1b)", () => {
  it("counts a legacy-office file in its own remediable row (not Other|reference) and documents the real enum", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    await writeInv(path.join(auditsBase, "dvfr", "latest", "inventory.ndjson"), {
      serverName: "dvfr",
      entries: [
        pdfEntry(0),
        {
          path: "old.doc", absolutePath: "/uploads/old.doc", filename: "old.doc",
          extension: "doc", category: "legacy-office", remediable: true, sizeBytes: 10,
          modifiedAt: "2024-01-01T00:00:00.000Z", sha256: "d1", flags: [],
        },
      ],
    });
    const sitesFile = await writeSites([
      { name: "dvfr", siteName: "DVFR", host: "10.0.0.1", user: "forge", remotePath: "/uploads" },
    ]);
    const outputDir = path.join(tmpDir, "out");
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });

    const md = await fs.readFile(path.join(outputDir, "audit-fleet-context.md"), "utf8");
    // R1a: the .doc lands in a first-class remediable row, not "Other|reference"…
    expect(md).toContain("| Legacy Office (.doc, .xls, .ppt) | 1 | remediable |");
    expect(md).toContain("| Other | 0 | reference |");
    // …and the scope numbers agree with the table (2 remediable, 0 reference).
    expect(md).toContain("**Files that may need accessibility remediation:** 2 (100%)");
    expect(md).toContain("**Reference files (images, text, archives, web pages, other):** 0 (0%)");
    // R1b: the documented category enum/remediable lines name the value the
    // NDJSON actually carries — the phantom "office-legacy" is gone from
    // both. (The introspection-KIND section legitimately keeps
    // `kind: "office-legacy"` — that string IS real as a kind.)
    const categoryLine = md.split("\n").find((l) => l.startsWith("- `category`"));
    expect(categoryLine).toBeTruthy();
    expect(categoryLine).toContain("`legacy-office`");
    expect(categoryLine).not.toContain("office-legacy");
    const remediableLine = md.split("\n").find((l) => l.startsWith("- `remediable`"));
    expect(remediableLine).toBeTruthy();
    expect(remediableLine).toContain("`legacy-office`");
    expect(remediableLine).not.toContain("office-legacy");
  });
});

// ── Audit fix (red-1 R2): orphans XLSX public URLs must be encoded ─────────────
// D10 landed the base(+pathPrefix)+per-segment encoding in the zero-caller
// writeOrphansCsv; the LIVE audit-orphaned-files.xlsx emitter still shipped
// raw concatenated URLs (# truncates at the fragment, spaces are invalid).

describe("orphans XLSX public URLs are encoded (v1.39.0 audit R2)", () => {
  it("audit-orphaned-files.xlsx carries base+pathPrefix+per-segment-encoded URLs (# → %23)", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    await writeInv(path.join(auditsBase, "ari", "latest", "inventory.ndjson"), {
      serverName: "ari",
      entries: [{
        path: "docs/Sheet#Info1V1-2025.pdf",
        absolutePath: "/uploads/docs/Sheet#Info1V1-2025.pdf",
        filename: "Sheet#Info1V1-2025.pdf",
        extension: "pdf", category: "pdf", remediable: true, sizeBytes: 10,
        modifiedAt: "2024-01-01T00:00:00.000Z", sha256: "h1", flags: [],
        references: [], // resolved and unreferenced → orphan
      }],
    });
    const sitesFile = await writeSites([{
      name: "ari", siteName: "ARI", host: "10.0.0.1", user: "forge", remotePath: "/uploads",
      publicUrlBase: "https://files.example.gov", pathPrefix: "static",
    }]);
    const outputDir = path.join(tmpDir, "out");
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(outputDir, "audit-orphaned-files.xlsx"));
    const sheet = wb.getWorksheet("Orphaned files");
    expect(sheet).toBeTruthy();
    const headerRow = sheet.getRow(1).values.slice(1).map((v) => (v && v.text) ? v.text : v);
    const urlCol = headerRow.indexOf("Public URL") + 1;
    expect(urlCol).toBeGreaterThan(0);
    const cell = sheet.getRow(2).getCell(urlCol).value;
    const url = cell && cell.hyperlink ? cell.hyperlink : String(cell ?? "");
    expect(url).toBe("https://files.example.gov/static/docs/Sheet%23Info1V1-2025.pdf");
  });
});

// ── E8: csvFile only when a per-site workbook was actually written ──────────────

describe("csvFile only when a workbook was written (v1.39.0 E8)", () => {
  it("a site with zero sheets gets no <slug>.xlsx and no card download link", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    // image-only inventory → no remediable buckets, no pages → zero sheets
    await writeInv(path.join(auditsBase, "imgs", "latest", "inventory.ndjson"), {
      serverName: "imgs",
      entries: [{
        path: "logo.png", absolutePath: "/uploads/logo.png", filename: "logo.png",
        extension: "png", category: "image", remediable: false, sizeBytes: 10,
        modifiedAt: "2024-01-01T00:00:00.000Z", sha256: "i1", flags: [],
      }],
    });
    const sitesFile = await writeSites([
      { name: "imgs", siteName: "IMGS", host: "10.0.0.1", user: "forge", remotePath: "/uploads" },
    ]);
    const outputDir = path.join(tmpDir, "out");
    const result = await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });
    expect(result.exitCode).toBe(0);

    const files = await fs.readdir(outputDir);
    expect(files.some((f) => /^imgs-.*\.xlsx$/.test(f))).toBe(false);
    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(html).not.toContain("Download spreadsheet");
    // The detail-report button is still there.
    expect(html).toContain("View detailed report");
  });

  it("a normal site still gets its workbook + card download link", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    await writeInv(path.join(auditsBase, "dvfr", "latest", "inventory.ndjson"), {
      serverName: "dvfr", entries: [pdfEntry(0)],
    });
    const sitesFile = await writeSites([
      { name: "dvfr", siteName: "DVFR", host: "10.0.0.1", user: "forge", remotePath: "/uploads" },
    ]);
    const outputDir = path.join(tmpDir, "out");
    await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase, noOg: true });
    const files = await fs.readdir(outputDir);
    expect(files.some((f) => /^dvfr-.*\.xlsx$/.test(f))).toBe(true);
    const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
    expect(html).toContain("Download spreadsheet");
  });
});
