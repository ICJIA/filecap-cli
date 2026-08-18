import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { PLAUSIBLE_SNIPPET, plausibleSanitizePath } from "../src/web/analytics.js";
import { generateNetlifyToml, generateNetlifyHeaders } from "../src/web/netlify-config.js";
import { runWebRollup } from "../src/commands/web-rollup.js";
import { writeHtml } from "../src/report/html.js";

// v1.60.0 — Plausible visit tracking on the deployed bundle. Loaded in
// MANUAL mode (script.manual.js) so the recorded URL is ours to sanitize:
// id-bearing paths like /page-audit/<uuid> or /page-report/<id> must reach
// the analytics as the bare /page-audit or /page-report, never as distinct
// per-id pages. The strict CSP must allowlist the script origin
// (script-src) AND its event endpoint (connect-src) or the tag ships dead.
// Standalone vendor reports (writeHtml without backHref) are emailed and
// opened offline — they must never carry the tag or phone home.

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-analytics-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── minimal fixtures (same shapes as web-rollup.test.js / report-html.test.js) ──

const sampleHeader = {
  schemaVersion: 1,
  kind: "filecap-inventory-header",
  metadata: {
    serverName: "test-server",
    hostname: "test.example.com",
    serverIp: "10.0.0.1",
    scannedPath: "/uploads",
    scannedAt: "2026-05-09T12:00:00.000Z",
    filecapVersion: "1.0.2",
    nodeVersion: "v20.18.0",
    options: { hash: true, introspect: true, maxIntrospectMb: 200, concurrency: 4 },
  },
};

const sampleEntries = [
  {
    path: "doc.pdf",
    absolutePath: "/uploads/doc.pdf",
    filename: "doc.pdf",
    extension: "pdf",
    category: "pdf",
    remediable: true,
    sizeBytes: 1024,
    modifiedAt: "2024-01-01T00:00:00.000Z",
    sha256: "a1b2",
    flags: [],
  },
];

async function writeInventory(filePath) {
  const header = JSON.stringify(sampleHeader);
  const entry = JSON.stringify(sampleEntries[0]);
  const footer = JSON.stringify({
    kind: "filecap-inventory-footer",
    entryCount: 1,
    scannedAt: "2026-05-09T12:00:00.000Z",
  });
  await fs.writeFile(filePath, [header, entry, footer].join("\n") + "\n", "utf8");
}

async function buildBundle() {
  const auditsBase = path.join(tmpDir, "filecap-audits");
  // Two sites on purpose — one plain slug, one hyphenated+numbered (the
  // research-hub-1-0 shape) — so the sanitizer drift-guard below proves
  // the timestamp-strip rule is generic across slug shapes.
  for (const slug of ["dvfr", "research-hub-1-0"]) {
    const latestDir = path.join(auditsBase, slug, "latest");
    await fs.mkdir(latestDir, { recursive: true });
    await writeInventory(path.join(latestDir, "inventory.ndjson"));
  }

  const sitesFile = path.join(tmpDir, "sites.json");
  await fs.writeFile(
    sitesFile,
    JSON.stringify({
      version: 1,
      sites: [
        { name: "dvfr", siteName: "DVFR", host: "203.0.113.10", user: "forge", remotePath: "/uploads" },
        { name: "research-hub-1-0", siteName: "Research Hub 1.0", host: "203.0.113.11", user: "forge", remotePath: "/uploads" },
      ],
    }),
  );

  const outputDir = path.join(tmpDir, "output");
  const result = await runWebRollup({ output: outputDir, sitesFile, _auditsBase: auditsBase });
  expect(result.exitCode).toBe(0);
  return outputDir;
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe("plausibleSanitizePath", () => {
  it("collapses /page-audit/<id> to /page-audit", () => {
    expect(plausibleSanitizePath("/page-audit/0000-1111-1111-1111")).toBe("/page-audit");
    expect(plausibleSanitizePath("/page-audit/deep/nested/id")).toBe("/page-audit");
    expect(plausibleSanitizePath("/page-audit/")).toBe("/page-audit");
  });

  it("collapses /page-report/<id> to /page-report", () => {
    expect(plausibleSanitizePath("/page-report/0da0d165fc2139a06906e0396c684376")).toBe("/page-report");
    expect(plausibleSanitizePath("/page-report/")).toBe("/page-report");
  });

  // v1.60.1 — per-site report pages carry the scan timestamp in their URL
  // (/sfs-20260818-004852z), so every rollup would fragment that site's
  // stats into a new "page". Only the site slug matters for visit counts.
  it("strips the scan timestamp from per-site report paths", () => {
    expect(plausibleSanitizePath("/sfs-20260818-004852z")).toBe("/sfs");
    expect(plausibleSanitizePath("/dvfr-20260818-004356Z")).toBe("/dvfr");
    expect(plausibleSanitizePath("/dvfr-20260818-004356z.html")).toBe("/dvfr");
    expect(plausibleSanitizePath("/dvfr-20260818-004356z/")).toBe("/dvfr");
    // slugs may themselves contain hyphens and digits
    expect(plausibleSanitizePath("/research-hub-1-0-20260818-004831z")).toBe("/research-hub-1-0");
  });

  it("leaves every other path untouched", () => {
    expect(plausibleSanitizePath("/")).toBe("/");
    expect(plausibleSanitizePath("/sites")).toBe("/sites");
    expect(plausibleSanitizePath("/whats-new")).toBe("/whats-new");
    expect(plausibleSanitizePath("/audit-pdfs")).toBe("/audit-pdfs");
    expect(plausibleSanitizePath("/audit-orphaned-files")).toBe("/audit-orphaned-files");
    expect(plausibleSanitizePath("/page-audit")).toBe("/page-audit");
    expect(plausibleSanitizePath("/page-report")).toBe("/page-report");
    // prefix boundary: only the exact segment collapses
    expect(plausibleSanitizePath("/page-auditx/foo")).toBe("/page-auditx/foo");
    // timestamp shape must match exactly — a stray date-ish suffix survives
    expect(plausibleSanitizePath("/report-2026-plan")).toBe("/report-2026-plan");
  });
});

describe("PLAUSIBLE_SNIPPET", () => {
  it("loads the MANUAL extension for fleet.icjia.app — never the auto script", () => {
    expect(PLAUSIBLE_SNIPPET).toContain(
      '<script defer data-domain="fleet.icjia.app" src="https://plausible.icjia.cloud/js/script.manual.js"></script>',
    );
    // the auto script records raw URLs (ids and all) — pin it out
    expect(PLAUSIBLE_SNIPPET).not.toContain("/js/script.js");
  });

  it("sends one pageview with the sanitized URL, sanitizer embedded verbatim", () => {
    expect(PLAUSIBLE_SNIPPET).toContain('window.plausible("pageview",{u:location.origin+sanitize(location.pathname)})');
    // .toString() embed: the unit-tested function above IS the shipped code
    expect(PLAUSIBLE_SNIPPET).toContain(plausibleSanitizePath.toString());
  });

  it("inline bootstrap compiles (template-literal cooking guard)", () => {
    const inline = PLAUSIBLE_SNIPPET.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(inline, "snippet should carry an inline <script> bootstrap").toBeTruthy();
    expect(() => new vm.Script(inline)).not.toThrow();
  });
});

describe("CSP allowlists Plausible", () => {
  // Both emitted configs (netlify.toml for CLI deploys, _headers for drag-drop)
  // must stay in lock-step — a script-src without the matching connect-src
  // loads the tracker but silently drops every event POST.
  it("netlify.toml: script-src and connect-src carry the Plausible origin", () => {
    const toml = generateNetlifyToml();
    expect(toml).toContain("script-src 'self' 'unsafe-inline' https://plausible.icjia.cloud");
    expect(toml).toContain("connect-src 'self' https://plausible.icjia.cloud");
  });

  it("_headers: script-src and connect-src carry the Plausible origin", () => {
    const headers = generateNetlifyHeaders();
    expect(headers).toContain("script-src 'self' 'unsafe-inline' https://plausible.icjia.cloud");
    expect(headers).toContain("connect-src 'self' https://plausible.icjia.cloud");
  });
});

describe("bundle pages carry the snippet", () => {
  it("every emitted .html page carries the tag exactly once", async () => {
    const outputDir = await buildBundle();
    const htmlFiles = (await fs.readdir(outputDir)).filter((f) => f.endsWith(".html"));
    // Guard against a vacuous loop: the bundle always has at least the index,
    // /sites, /search, What's New, accessibility, a per-site page, and a
    // by-type page.
    expect(htmlFiles.length).toBeGreaterThanOrEqual(6);
    for (const f of htmlFiles) {
      const html = await fs.readFile(path.join(outputDir, f), "utf8");
      const count = html.split(PLAUSIBLE_SNIPPET).length - 1;
      expect(count, `${f} should carry the Plausible tag exactly once`).toBe(1);
      // In the <head>, not body-appended.
      expect(html.indexOf(PLAUSIBLE_SNIPPET), `${f}: tag should sit in <head>`).toBeLessThan(
        html.indexOf("</head>"),
      );
    }
  });
});

describe("sanitizer matches the emitted per-site filename format (drift guard)", () => {
  // Ties plausibleSanitizePath to what web-rollup ACTUALLY names the
  // per-site pages. If either side changes shape — a new timestamp format,
  // a new slug rule — this goes red instead of analytics silently
  // fragmenting into per-rollup pages again. Applies to every site slug,
  // hyphenated/numbered ones included.
  it("every emitted per-site page path collapses to its bare site slug", async () => {
    const outputDir = await buildBundle();
    const perSite = (await fs.readdir(outputDir)).filter((f) => /-\d{8}-\d{6}Z\.html$/i.test(f));
    expect(perSite.length).toBe(2);
    const collapsed = perSite
      .map((f) => plausibleSanitizePath("/" + f.replace(/\.html$/i, "").toLowerCase()))
      .sort();
    expect(collapsed).toEqual(["/dvfr", "/research-hub-1-0"]);
  });
});

describe("standalone reports never phone home", () => {
  it("writeHtml without backHref (vendor-emailed report) has no Plausible tag", async () => {
    const out = path.join(tmpDir, "standalone.html");
    await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
    const html = await fs.readFile(out, "utf8");
    expect(html).not.toContain("plausible.icjia.cloud");
  });

  it("writeHtml with backHref (bundled page) carries the tag", async () => {
    const out = path.join(tmpDir, "bundled.html");
    await writeHtml({
      sourceHeader: sampleHeader,
      entries: sampleEntries,
      sources: [sampleHeader],
      outputPath: out,
      backHref: "index.html",
    });
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain(PLAUSIBLE_SNIPPET);
  });
});
