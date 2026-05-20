import { describe, it, expect } from "vitest";
import { renderCard, generateIndexHtml } from "../src/web/index-page.js";

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

  describe("access chip (v1.7.6)", () => {
    // v1.7.33: chip labels collapsed to a single plain-English phrase
    // ("For bulk file access") across all three site types — the CSS
    // class (access-strapi / access-github / access-server) still
    // carries the per-type visual distinction.
    it("renders a Strapi-CMS chip when accessKind is 'strapi'", () => {
      const sr = { ...baseSr, site: { ...baseSr.site, accessKind: "strapi" } };
      const html = renderCard(sr);
      expect(html).toMatch(/class="access-chip access-strapi"/);
      expect(html).toContain("For bulk file access");
    });

    it("renders a GitHub chip when accessKind is 'github'", () => {
      const sr = { ...baseSr, site: { ...baseSr.site, accessKind: "github" } };
      const html = renderCard(sr);
      expect(html).toMatch(/class="access-chip access-github"/);
      expect(html).toContain("For bulk file access");
    });

    it("renders a Server chip when accessKind is 'server'", () => {
      const sr = { ...baseSr, site: { ...baseSr.site, accessKind: "server" } };
      const html = renderCard(sr);
      expect(html).toMatch(/class="access-chip access-server"/);
      expect(html).toContain("For bulk file access");
    });

    it("omits the chip entirely when accessKind is missing", () => {
      const sr = { ...baseSr, site: { ...baseSr.site, accessKind: undefined } };
      const html = renderCard(sr);
      expect(html).not.toMatch(/class="access-chip/);
    });

    it("omits the chip when accessKind is an unrecognized value", () => {
      const sr = { ...baseSr, site: { ...baseSr.site, accessKind: "ftp" } };
      const html = renderCard(sr);
      expect(html).not.toMatch(/class="access-chip/);
    });
  });
});

describe("renderCard tech-details (v1.7.8 expanded with copy buttons)", () => {
  const sr = {
    site: {
      name: "dvfr-strapi-prod",
      siteName: "DVFR",
      siteFullName: "Domestic Violence Fatality Review",
      siteUrl: "https://dvfr.illinois.gov/",
      host: "1.2.3.4",
    },
    summary: { totalFiles: 10, remediable: 5, totalBytes: 1000, byCategory: { pdf: 5 } },
    htmlFile: "dvfr-2026.html",
    csvFile: "dvfr-2026.csv",
    scannedAt: "2026-05-11T14:00:00.000Z",
    header: {
      metadata: {
        serverIp: "192.241.146.85",
        hostname: "dvfr.example.com",
        scannedPath: "/home/forge/dvfr.icjia-api.cloud/dvfr-api/public/uploads",
      },
    },
  };

  it("renders a tech-grid with all five label/value pairs", () => {
    const html = renderCard(sr);
    expect(html).toContain('<div class="tech-grid">');
    expect(html).toMatch(/<span class="tech-label">Website:<\/span>/);
    expect(html).toMatch(/<span class="tech-label">IP:<\/span>/);
    expect(html).toMatch(/<span class="tech-label">Hostname:<\/span>/);
    expect(html).toMatch(/<span class="tech-label">Path:<\/span>/);
    expect(html).toMatch(/<span class="tech-label">URL:<\/span>/);
  });

  it("emits exactly five copy buttons inside tech-details, one per row", () => {
    const html = renderCard(sr);
    const techStart = html.indexOf('<details class="tech-details">');
    const techEnd = html.indexOf('</details>', techStart);
    expect(techStart).toBeGreaterThan(-1);
    expect(techEnd).toBeGreaterThan(techStart);
    const techBlock = html.slice(techStart, techEnd);
    const buttons = techBlock.match(/<button[^>]*class="meta-copy"/g) || [];
    expect(buttons.length).toBe(5);
  });

  it("each copy button carries the raw value in data-copy", () => {
    const html = renderCard(sr);
    expect(html).toMatch(/<button[^>]*class="meta-copy"[^>]*data-copy="DVFR"/);
    expect(html).toMatch(/<button[^>]*class="meta-copy"[^>]*data-copy="192\.241\.146\.85"/);
    expect(html).toMatch(/<button[^>]*class="meta-copy"[^>]*data-copy="dvfr\.example\.com"/);
    expect(html).toMatch(/<button[^>]*class="meta-copy"[^>]*data-copy="\/home\/forge\/dvfr\.icjia-api\.cloud\/dvfr-api\/public\/uploads"/);
    expect(html).toMatch(/<button[^>]*class="meta-copy"[^>]*data-copy="https:\/\/dvfr\.illinois\.gov\/"/);
  });

  it("the URL row renders a clickable <a target=_blank> alongside the copy button", () => {
    const html = renderCard(sr);
    expect(html).toMatch(/<span class="tech-label">URL:<\/span><span class="meta-value"><a href="https:\/\/dvfr\.illinois\.gov\/" target="_blank" rel="noopener noreferrer">https:\/\/dvfr\.illinois\.gov\/<\/a><button[^>]*class="meta-copy"[^>]*data-copy="https:\/\/dvfr\.illinois\.gov\/"/);
  });

  it("omits rows whose value is empty (e.g. no hostname recorded)", () => {
    const srNoHostname = {
      ...sr,
      site: { ...sr.site, host: "" },
      header: { metadata: { ...sr.header.metadata, hostname: "" } },
    };
    const html = renderCard(srNoHostname);
    expect(html).not.toMatch(/<span class="tech-label">Hostname:<\/span>/);
    // Should still have 4 buttons (Website, IP, Path, URL)
    const techStart = html.indexOf('<details class="tech-details">');
    const techEnd = html.indexOf('</details>', techStart);
    const techBlock = html.slice(techStart, techEnd);
    const buttons = techBlock.match(/<button[^>]*class="meta-copy"/g) || [];
    expect(buttons.length).toBe(4);
  });

  it("omits the entire tech-details section when no fields populated", () => {
    const srEmpty = {
      ...sr,
      site: { name: "x", siteName: "", host: "" },
      header: { metadata: {} },
    };
    const html = renderCard(srEmpty);
    expect(html).not.toContain('<details class="tech-details">');
  });
});

describe("renderCard last-audit caption (v1.7.16)", () => {
  it("renders 'Last audit: <date>' beneath the card actions when scannedAt is set", () => {
    const sr = {
      site: { name: "x", siteName: "DVFR", host: "1.2.3.4" },
      summary: { totalFiles: 10, remediable: 5, totalBytes: 1000, byCategory: { pdf: 5 } },
      htmlFile: "x.html",
      csvFile: "x.csv",
      scannedAt: "2026-05-11T14:00:00.000Z",
      header: { metadata: {} },
    };
    const html = renderCard(sr);
    expect(html).toMatch(/<p class="csv-last-audit">Last audit: <strong>May 11, 2026<\/strong><\/p>/);
  });

  it("omits the caption when scannedAt is missing", () => {
    const sr = {
      site: { name: "x", siteName: "DVFR" },
      summary: { totalFiles: 10, remediable: 5, totalBytes: 1000, byCategory: { pdf: 5 } },
      htmlFile: "x.html",
      csvFile: "x.csv",
      scannedAt: null,
      header: { metadata: {} },
    };
    const html = renderCard(sr);
    expect(html).not.toMatch(/class="csv-last-audit"/);
  });
});

describe("index page audit-tool button (v1.7.16)", () => {
  const html = generateIndexHtml({ siteResults: [], password: null });

  it("renders an audit.icjia.app link in the site-header right zone", () => {
    expect(html).toMatch(/<a class="audit-tool-link" href="https:\/\/audit\.icjia\.app"[^>]*target="_blank"[^>]*>/);
  });

  it("the audit-tool link includes an external-link SVG icon and the 'ICJIA PDF Audit Tool' label", () => {
    expect(html).toMatch(/<a class="audit-tool-link"[^>]*href="https:\/\/audit\.icjia\.app"[\s\S]{0,800}<span>ICJIA PDF Audit Tool<\/span>/);
  });

  it("the navbar also has an 'ICJIA Accessibility FAQs' button linked to accessibility.icjia.app (v1.7.28)", () => {
    expect(html).toMatch(/<a class="audit-tool-link"[^>]*href="https:\/\/accessibility\.icjia\.app"[\s\S]{0,800}<span>ICJIA Accessibility FAQs<\/span>/);
  });

  it("uses rel=\"noopener noreferrer\" to prevent the target page from accessing window.opener", () => {
    expect(html).toMatch(/<a class="audit-tool-link"[^>]*rel="noopener noreferrer"/);
  });
});

describe("index page CSS (v1.7.7 whole-card click fix)", () => {
  // The fix lives in the <style> block emitted by generateIndexHtml: it
  // pins pointer-events: none on every non-interactive descendant of
  // .site-card so the stretched-link catches every click on visible
  // content, then re-enables pointer-events on the action buttons + the
  // tech-details disclosure summary so those stay separately interactive.
  // Pre-v1.7.7 the same problem was attempted via z-index, which only
  // covered the small gaps between children — every text/tile/donut
  // captured the click and routed it to an element with no handler.
  const html = generateIndexHtml({ siteResults: [], password: null });

  it("emits pointer-events: none on every non-stretched-link descendant of .site-card", () => {
    // Single CSS rule that applies pointer-events: none to direct children
    // and (separately, via universal descendant) all of their descendants.
    expect(html).toMatch(/\.site-card > \*:not\(\.card-stretched-link\),\s*\.site-card > \*:not\(\.card-stretched-link\) \*\s*\{[^}]*pointer-events:\s*none/);
  });

  it("re-enables pointer-events on the action buttons + tech-details summary", () => {
    // v1.7.8 extended the allowlist to also include .tech-details .meta-copy
    // and .tech-details .meta-value a (the URL link inside tech-details), so
    // the regex matches the leading two selectors plus a flexible tail.
    expect(html).toMatch(/\.site-card \.actions \.btn,\s*\.site-card \.tech-details summary[\s\S]{0,200}\{\s*pointer-events:\s*auto/);
  });
});

describe("index page duplicates table (v1.12.1 paginator + trimmed columns)", () => {
  const dupGroups = [
    {
      normalizedFilename: "annual-report.pdf",
      isExactDuplicate: true,
      items: [
        { siteName: "DVFR", serverName: "dvfr-strapi-prod", publicUrl: "https://dvfr.illinois.gov/r/annual-report.pdf", modifiedAt: "2025-01-01T00:00:00.000Z", sizeBytes: 100 },
        { siteName: "ICJIA", serverName: "icjia-agency-prod", publicUrl: "https://icjia.illinois.gov/r/annual-report.pdf", modifiedAt: "2025-02-01T00:00:00.000Z", sizeBytes: 100 },
      ],
    },
  ];
  const html = generateIndexHtml({ siteResults: [], password: null, duplicateGroups: dupGroups });

  it("renders a paginator with prev/next, page-size selector, and page info", () => {
    expect(html).toMatch(/<nav class="paginator"/);
    expect(html).toContain('id="dup-page-info"');
    expect(html).toContain('id="dup-pag-prev"');
    expect(html).toContain('id="dup-pag-next"');
    expect(html).toContain('id="dup-page-size"');
  });

  it("trims the HTML table to essential columns (dates + size columns dropped)", () => {
    expect(html).toMatch(/<th[^>]*class="dup-col-filename"/);
    expect(html).toMatch(/<th[^>]*class="dup-col-match"/);
    expect(html).toMatch(/<th[^>]*class="dup-col-sites"/);
    expect(html).toMatch(/<th[^>]*class="dup-col-copies"/);
    expect(html).not.toMatch(/<th[^>]*class="dup-col-dates"/);
    expect(html).not.toMatch(/<th[^>]*class="dup-col-size"/);
  });

  it("no longer embeds the click-and-drag pan handler", () => {
    expect(html).not.toContain("is-panning");
    expect(html).not.toContain("setPointerCapture");
  });
});
