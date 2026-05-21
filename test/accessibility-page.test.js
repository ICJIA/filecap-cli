import { describe, it, expect } from "vitest";
import { generateAccessibilityPage } from "../src/web/accessibility-page.js";

const sampleStatus = {
  asOf: "2026-05-20",
  lighthouse: 100,
  axeCore: "0 violations (WCAG A + AA)",
  axeDevTools: "0 serious",
  viewports: "desktop + mobile",
};
const sampleLog = [
  { date: "2026-05-20", source: "backend", tool: "axe-core", scope: "fleet index", viewport: "desktop", status: "pass", result: "0 violations" },
  { date: "2026-05-19", source: "browser", tool: "axe DevTools", scope: "live index", viewport: "desktop", status: "found", result: "3 serious found" },
];

describe("generateAccessibilityPage", () => {
  it("returns a complete HTML document with one <main> and a favicon", () => {
    const html = generateAccessibilityPage({ currentStatus: sampleStatus, log: sampleLog });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toMatch(/<link[^>]*rel="icon"/);
    expect((html.match(/<main\b/g) || []).length).toBe(1);
    expect(html).toContain("</main>");
  });

  it("renders the current-status panel values", () => {
    const html = generateAccessibilityPage({ currentStatus: sampleStatus, log: sampleLog });
    expect(html).toContain("100");
    expect(html).toContain("0 violations (WCAG A + AA)");
    expect(html).toContain("desktop + mobile");
    expect(html).toContain("2026-05-20");
  });

  it("renders one log table row per entry, in array order", () => {
    const html = generateAccessibilityPage({ currentStatus: sampleStatus, log: sampleLog });
    const body = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
    expect(body).not.toBeNull();
    expect((body[1].match(/<tr>/g) || []).length).toBe(2);
    expect(body[1].indexOf("2026-05-20")).toBeLessThan(body[1].indexOf("2026-05-19"));
  });

  it("tags each row with its source and status", () => {
    const html = generateAccessibilityPage({ currentStatus: sampleStatus, log: sampleLog });
    expect(html).toMatch(/ax-src-backend/);
    expect(html).toMatch(/ax-src-browser/);
    expect(html).toMatch(/ax-status-pass/);
    expect(html).toMatch(/ax-status-found/);
  });

  it("escapes HTML in entry text", () => {
    const html = generateAccessibilityPage({
      currentStatus: sampleStatus,
      log: [{ date: "2026-05-20", source: "backend", tool: "x <b>", scope: "y", viewport: "desktop", status: "pass", result: "z & w" }],
    });
    expect(html).toContain("x &lt;b&gt;");
    expect(html).toContain("z &amp; w");
  });
});
