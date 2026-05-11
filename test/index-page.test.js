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

  it("falls back to siteName when siteFullName is an empty string", () => {
    const sr = { ...baseSr, site: { ...baseSr.site, siteFullName: "" } };
    const html = renderCard(sr);
    expect(html).toMatch(/<h3 class="full-name">DVFR<\/h3>/);
  });

  it("renders the total tile with the total-files number (not swapped)", () => {
    const html = renderCard(baseSr);
    expect(html).toMatch(/<div class="tile total"><span class="num">102<\/span>/);
  });

  it("renders the audit tile with the audit-needed number (not swapped)", () => {
    const html = renderCard(baseSr);
    expect(html).toMatch(/<div class="tile audit"><span class="num">69<\/span>/);
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

  it("makes the whole card clickable via a stretched-link <a> with aria-label", () => {
    const html = renderCard(baseSr);
    expect(html).toMatch(
      /<a class="card-stretched-link" href="dvfr-2026\.html" aria-label="View detailed report for Domestic Violence Fatality Review">/,
    );
  });

  it("renders the CSV-download button as a separate <a download> inside .actions", () => {
    const html = renderCard(baseSr);
    expect(html).toMatch(
      /<a href="dvfr-2026\.csv" class="btn btn-secondary" download>Download spreadsheet<\/a>/,
    );
  });
});
