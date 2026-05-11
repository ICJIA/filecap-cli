import { describe, it, expect } from "vitest";
import { renderCard } from "../src/web/index-page.js";

const baseSr = {
  site: {
    name: "dvfr-strapi-prod",
    siteName: "DVFR",
    siteFullName: "Domestic Violence Fatality Review",
    siteUrl: "https://dvfr.illinois.gov/",
    host: "1.2.3.4",
  },
  summary: {
    totalFiles: 102, remediable: 69, totalBytes: 38_000_000,
    byCategory: { pdf: 63, "office-document": 6, image: 33 },
  },
  htmlFile: "dvfr-2026.html",
  csvFile: "dvfr-2026.csv",
  scannedAt: "2026-05-11T14:00:00.000Z",
  header: { metadata: { serverIp: "1.2.3.4" } },
};

describe("renderCard", () => {
  it("uses siteFullName as the card title when provided", () => {
    const html = renderCard(baseSr);
    expect(html).toContain("Domestic Violence Fatality Review");
  });

  it("renders the nickname as a small uppercase label", () => {
    const html = renderCard(baseSr);
    expect(html).toMatch(/class="[^"]*\bnickname\b[^"]*"[^>]*>DVFR</);
  });

  it("falls back to siteName when siteFullName is missing", () => {
    const sr = { ...baseSr, site: { ...baseSr.site, siteFullName: undefined } };
    const html = renderCard(sr);
    expect(html).toContain(">DVFR<");
  });

  it("renders both total and audit numbers in two-up tiles", () => {
    const html = renderCard(baseSr);
    expect(html).toMatch(/<span class="num">102<\/span>/);
    expect(html).toMatch(/<span class="num">69<\/span>/);
  });

  it("emits a donut element with inline --pct custom property", () => {
    const html = renderCard(baseSr);
    // 69/102 = 67.6%
    expect(html).toMatch(/class="donut"[^>]*style="--pct:67\.6%/);
  });

  it("renders a plain-English donut caption", () => {
    const html = renderCard(baseSr);
    expect(html).toMatch(/need audit/i);
  });

  it("zero-files edge case renders 0/0 tiles and 0% donut", () => {
    const sr = { ...baseSr, summary: { totalFiles: 0, remediable: 0, totalBytes: 0, byCategory: {} } };
    const html = renderCard(sr);
    expect(html).toMatch(/<span class="num">0<\/span>/);
    expect(html).toMatch(/--pct:0%/);
  });
});
