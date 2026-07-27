import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { generateIndexHtml } from "../src/web/index-page.js";
import { generateSitesHtml } from "../src/web/sites-page.js";
import { generateAccessibilityPage } from "../src/web/accessibility-page.js";
import { writeHtml } from "../src/report/html.js";
import { writeOrphansHtml } from "../src/report/orphans-html.js";
import { generateAuditErrorsPage } from "../src/report/audit-errors-page.js";
import { siteFooterCss } from "../src/web/site-footer.js";

// v1.40.0 — WCAG 2.4.1 Bypass Blocks. Every page gets a skip link as the FIRST
// focusable element, targeting the <main id="main"> landmark. A keyboard user
// on the fleet index otherwise tabs through the whole header on every page.
const SKIP = /<body[^>]*>\s*<a class="skip-link" href="#main">Skip to content<\/a>/;
const MAIN = /<main id="main"[^>]*>/;

function expectSkip(html, label) {
  expect(html, `${label}: skip link first in body`).toMatch(SKIP);
  expect(html, `${label}: main#main target`).toMatch(MAIN);
}

describe("skip-to-content link on every generated page (v1.40.0)", () => {
  it("fleet index", () => {
    expectSkip(generateIndexHtml({ siteResults: [], password: null }), "index");
  });

  it("site directory", () => {
    expectSkip(generateSitesHtml({ contentRoster: [], tools: [] }), "sites");
  });

  it("accessibility log page", () => {
    const status = { asOf: "2026-07-27", lighthouse: 100, axeCore: "0", axeDevTools: "0", viewports: "desktop" };
    expectSkip(generateAccessibilityPage({ currentStatus: status, log: [] }), "accessibility");
  });

  it("per-site detail page", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-skip-"));
    const out = path.join(dir, "detail.html");
    const header = {
      kind: "filecap-header", schemaVersion: 1,
      metadata: { serverName: "x", hostname: "h", scannedPath: "/p", scannedAt: "2026-01-01T00:00:00.000Z" },
    };
    await writeHtml({ sourceHeader: header, entries: [], sources: [header], outputPath: out });
    expectSkip(await fs.readFile(out, "utf8"), "detail");
  });

  it("orphaned-files page", () => {
    expectSkip(writeOrphansHtml({ orphans: [], sources: [], siteTotals: new Map() }), "orphans");
  });

  it("file-errors page", () => {
    expectSkip(generateAuditErrorsPage({ groups: [] }), "errors");
  });

  it("shared CSS hides the link until keyboard focus", () => {
    const css = siteFooterCss();
    expect(css).toMatch(/\.skip-link \{[^}]*position: absolute/);
    expect(css).toMatch(/\.skip-link:focus/);
  });
});
