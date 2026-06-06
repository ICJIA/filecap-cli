import { describe, it, expect } from "vitest";
import { renderCard, generateIndexHtml, renderToolCard, renderToolingSection, renderStatusDot } from "../src/web/index-page.js";

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

  // v1.19.0 — the site URL under the card title is a real link to the live
  // site, opened in a new tab. Pre-v1.19.0 it was a non-link <span> and
  // clicks fell through to the card's stretched-link (the detail report).
  it("renders the site URL as a real link that opens the live site in a new tab", () => {
    const html = renderCard(baseSr);
    expect(html).toMatch(
      /<p class="site-url"><a href="https:\/\/dvfr\.illinois\.gov\/" target="_blank" rel="noopener noreferrer">https:\/\/dvfr\.illinois\.gov\/<\/a><\/p>/,
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

  it("renders a tech-grid with Website, Hostname, URL — no IP, no Path (v1.21.2)", () => {
    const html = renderCard(sr);
    expect(html).toContain('<div class="tech-grid">');
    expect(html).toMatch(/<span class="tech-label">Website:<\/span>/);
    expect(html).toMatch(/<span class="tech-label">Hostname:<\/span>/);
    expect(html).toMatch(/<span class="tech-label">URL:<\/span>/);
    expect(html).not.toMatch(/<span class="tech-label">IP:<\/span>/);
    expect(html).not.toMatch(/<span class="tech-label">Path:<\/span>/);
    // the origin IP + Forge scanned path must not leak anywhere on the card
    expect(html).not.toContain("192.241.146.85");
    expect(html).not.toContain("/home/forge/");
  });

  it("emits three copy buttons inside tech-details (Website, Hostname, URL)", () => {
    const html = renderCard(sr);
    const techStart = html.indexOf('<details class="tech-details">');
    const techEnd = html.indexOf('</details>', techStart);
    expect(techStart).toBeGreaterThan(-1);
    expect(techEnd).toBeGreaterThan(techStart);
    const techBlock = html.slice(techStart, techEnd);
    const buttons = techBlock.match(/<button[^>]*class="meta-copy"/g) || [];
    expect(buttons.length).toBe(3);
  });

  it("each copy button carries the raw value in data-copy", () => {
    const html = renderCard(sr);
    expect(html).toMatch(/<button[^>]*class="meta-copy"[^>]*data-copy="DVFR"/);
    expect(html).toMatch(/<button[^>]*class="meta-copy"[^>]*data-copy="dvfr\.example\.com"/);
    expect(html).toMatch(/<button[^>]*class="meta-copy"[^>]*data-copy="https:\/\/dvfr\.illinois\.gov\/"/);
  });

  it("hides the Hostname row when it equals the IP (v1.21.2)", () => {
    const srHostEqIp = {
      ...sr,
      site: { ...sr.site, host: "192.241.146.85" },
      header: { metadata: { serverIp: "192.241.146.85", hostname: "192.241.146.85" } },
    };
    const html = renderCard(srHostEqIp);
    expect(html).not.toMatch(/<span class="tech-label">Hostname:<\/span>/);
    const techStart = html.indexOf('<details class="tech-details">');
    const techEnd = html.indexOf('</details>', techStart);
    const techBlock = html.slice(techStart, techEnd);
    const buttons = techBlock.match(/<button[^>]*class="meta-copy"/g) || [];
    expect(buttons.length).toBe(2); // Website + URL only
  });

  it("the URL row renders a clickable <a target=_blank> alongside the copy button", () => {
    const html = renderCard(sr);
    expect(html).toMatch(/<span class="tech-label">URL:<\/span><span class="meta-value"><a href="https:\/\/dvfr\.illinois\.gov\/" target="_blank" rel="noopener noreferrer">https:\/\/dvfr\.illinois\.gov\/<\/a><button[^>]*class="meta-copy"[^>]*data-copy="https:\/\/dvfr\.illinois\.gov\/"/);
  });

  it("omits the Hostname row when no hostname recorded (Website + URL only)", () => {
    const srNoHostname = {
      ...sr,
      site: { ...sr.site, host: "" },
      header: { metadata: { ...sr.header.metadata, hostname: "" } },
    };
    const html = renderCard(srNoHostname);
    expect(html).not.toMatch(/<span class="tech-label">Hostname:<\/span>/);
    const techStart = html.indexOf('<details class="tech-details">');
    const techEnd = html.indexOf('</details>', techStart);
    const techBlock = html.slice(techStart, techEnd);
    const buttons = techBlock.match(/<button[^>]*class="meta-copy"/g) || [];
    expect(buttons.length).toBe(2);
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

  // v1.19.0 — the site-url link joins the pointer-events:auto allowlist and
  // is lifted above the stretched-link overlay so its click opens the live
  // site instead of falling through to the detail report.
  it("re-enables pointer-events on the site-url link and lifts it above the overlay", () => {
    expect(html).toMatch(/\.site-card \.site-url a,[\s\S]{0,80}\{\s*pointer-events:\s*auto/);
    expect(html).toMatch(/\.site-card \.site-url a \{[^}]*z-index:\s*2/);
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

describe("index page accessibility (v1.x)", () => {
  it("includes a favicon link so the page does not 404 on /favicon.ico", () => {
    const html = generateIndexHtml({ siteResults: [], password: null });
    expect(html).toMatch(/<link[^>]*rel="icon"/);
  });

  it("marks the LLM-context download names as headings (axe heading-markup)", () => {
    // axe DevTools' advanced/heading-markup rule flagged the .llm-context-file-name
    // labels as heading-like but unmarked. Each is the title of its download card,
    // a level-3 heading under the section's <h2 id="llm-context-heading">.
    const html = generateIndexHtml({
      siteResults: [],
      password: null,
      llmContext: {
        ndjsonFilename: "audit-fleet.ndjson",
        ndjsonByteCount: 1234,
        contextMdFilename: "audit-fleet-context.md",
        contextMdByteCount: 567,
      },
    });
    const nameSpans = html.match(/<span class="llm-context-file-name"[^>]*>/g) || [];
    expect(nameSpans).toHaveLength(2);
    for (const span of nameSpans) {
      expect(span).toMatch(/role="heading"/);
      expect(span).toMatch(/aria-level="\d"/);
    }
  });

  it("footer links to the /accessibility page", () => {
    const html = generateIndexHtml({ siteResults: [], password: null });
    expect(html).toMatch(/<a href="accessibility\.html"[^>]*>Accessibility<\/a>/);
  });
});

describe("index page file-errors section", () => {
  it("links to the file-errors report when fileErrors is provided", () => {
    const html = generateIndexHtml({
      siteResults: [],
      password: null,
      fileErrors: {
        htmlFilename: "audit-file-errors.html",
        csvFilename: "audit-file-errors.csv",
        errorCount: 3,
        siteCount: 5,
        sitesWithErrors: 2,
      },
    });
    expect(html).toMatch(/<a href="audit-file-errors\.html"[^>]*>/);
    expect(html).toContain("audit-file-errors.csv");
  });
});

describe("index page — PDF scoring panel removed (v1.19.0)", () => {
  // The fleet "PDF accessibility scoring" band (average grade / score /
  // PDFs-audited counts) was removed in v1.19.0: the audit.icjia.app
  // scoring heuristic is still being refined, so the fleet index no longer
  // surfaces an aggregate grade.
  const auditedSr = {
    ...baseSr,
    summary: {
      ...baseSr.summary,
      auditedPdfCount: 40, auditScoreSum: 3000, auditErrorCount: 2, auditPending: 1,
    },
  };
  const html = generateIndexHtml({ siteResults: [auditedSr], password: null });

  it("does not render the PDF accessibility scoring band", () => {
    expect(html).not.toContain('aria-label="PDF accessibility scoring summary"');
    expect(html).not.toContain("PDFs audited");
    expect(html).not.toContain("Accessibility scores come from");
  });
});

describe("renderToolCard (v1.21.0)", () => {
  const tool = {
    name: "squish", siteName: "Squish", siteFullName: "Squish — image compression",
    siteUrl: "https://squish.icjia.app", image: "assets/og/squish.png",
    description: "Bulk image compression", stack: "Nuxt 3",
  };
  it("renders title, URL, description, stack, Tooling badge and og image", () => {
    const html = renderToolCard(tool);
    expect(html).toContain("Squish — image compression");
    expect(html).toContain("squish.icjia.app");
    expect(html).toContain("Bulk image compression");
    expect(html).toContain("Nuxt 3");
    expect(html).toContain(">Tooling<");
    expect(html).toContain('src="assets/og/squish.png"');
    expect(html).toContain('target="_blank"');
  });
  it("uses the ICJIA-logo fallback when there is no image", () => {
    expect(renderToolCard({ ...tool, image: null })).toContain("card-img-fallback");
  });
});

describe("renderToolingSection (v1.21.0)", () => {
  it("returns an empty string when there are no tools", () => {
    expect(renderToolingSection([])).toBe("");
    expect(renderToolingSection(undefined)).toBe("");
  });
  it("renders a banded section with a card per tool", () => {
    const html = renderToolingSection([
      { name: "a", siteFullName: "Tool A", siteUrl: "https://a.example" },
      { name: "b", siteFullName: "Tool B", siteUrl: "https://b.example" },
    ]);
    expect(html).toContain("Tooling sites");
    expect(html).toContain("Tool A");
    expect(html).toContain("Tool B");
  });
});

describe("generateIndexHtml tooling band + /sites nav (v1.21.0)", () => {
  it("includes the tooling band when tools are provided", () => {
    const html = generateIndexHtml({
      siteResults: [],
      tools: [{ name: "squish", siteFullName: "Squish", siteUrl: "https://squish.icjia.app" }],
    });
    expect(html).toContain("Squish");
    expect(html).toContain("Tooling sites");
  });
  it("renders the /sites link in the top nav + footer", () => {
    const html = generateIndexHtml({ siteResults: [] });
    expect(html).toContain('href="sites.html"');
  });
  it("omits the Agency tooling headline when no tools are provided", () => {
    const html = generateIndexHtml({ siteResults: [] });
    expect(html).not.toContain("Agency tooling");
  });
});

describe("renderStatusDot (v1.21.2)", () => {
  it("renders a solid live dot with an aria-label", () => {
    const html = renderStatusDot("live");
    expect(html).toContain("status-dot status-live");
    expect(html).toMatch(/aria-label="Live[^"]*"/);
  });
  it("renders a down dot with an aria-label", () => {
    const html = renderStatusDot("down");
    expect(html).toContain("status-dot status-down");
    expect(html).toMatch(/aria-label="Down[^"]*"/);
  });
  it("renders nothing for an unknown / null status", () => {
    expect(renderStatusDot(null)).toBe("");
    expect(renderStatusDot("unknown")).toBe("");
  });
});

describe("renderToolCard status dot (v1.21.2)", () => {
  const tool = { name: "squish", siteFullName: "Squish", siteUrl: "https://squish.icjia.app", status: "live" };
  it("shows the dot only when showStatus is set (on /sites, not the home band)", () => {
    expect(renderToolCard(tool, { showStatus: true })).toContain("status-dot status-live");
    expect(renderToolCard(tool)).not.toContain("status-dot");
  });
});
