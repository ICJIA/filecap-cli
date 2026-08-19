import { describe, it, expect } from "vitest";
import { renderCard, generateIndexHtml, renderToolCard, renderStatusDot, renderScorecards } from "../src/web/index-page.js";
import { INDEX_CSS } from "../src/web/index-css.js";

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

  it("renders the og:description as a card-desc paragraph when present", () => {
    const html = renderCard({ ...baseSr, description: "Statewide fatality review resource." });
    expect(html).toMatch(/<p class="card-desc">Statewide fatality review resource\.<\/p>/);
  });

  it("omits the description paragraph when there is no og:description", () => {
    expect(renderCard({ ...baseSr, description: "" })).not.toContain("card-desc");
    expect(renderCard(baseSr)).not.toContain("card-desc");
  });

  it("escapes HTML in the og:description", () => {
    const html = renderCard({ ...baseSr, description: "A & B <em>x</em>" });
    expect(html).toContain("A &amp; B &lt;em&gt;x&lt;/em&gt;");
  });

  // v1.26.0 — the home-page content (audit) card now carries the same og:image
  // thumbnail the /sites roster card does, using the identical renderCardImage
  // algorithm (downloaded og:image → ICJIA-logo tile fallback).
  it("renders the og:image card thumbnail when web-rollup propagates one", () => {
    const html = renderCard({ ...baseSr, image: "assets/og/dvfr.png" });
    expect(html).toContain('<div class="card-img">');
    expect(html).toContain('src="assets/og/dvfr.png"');
    expect(html).toContain('alt="Domestic Violence Fatality Review"');
  });

  it("falls back to the ICJIA-logo tile when no card image is available", () => {
    expect(renderCard(baseSr)).toContain("card-img-fallback");
    expect(renderCard({ ...baseSr, image: null })).toContain("card-img-fallback");
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

  it("renders a plain-English 'may need audit' label in the audit tile", () => {
    const html = renderCard(baseSr);
    expect(html).toMatch(/need audit/i);
  });

  it("zero-files edge case renders 0/0 tiles", () => {
    const sr = { ...baseSr, summary: { totalFiles: 0, remediable: 0, totalBytes: 0, byCategory: {} } };
    const html = renderCard(sr);
    expect(html).toMatch(/<span class="num">0<\/span>/);
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

describe("access modal keeps the native <dialog> pattern (v1.40.0 pin)", () => {
  // showModal() supplies the focus trap, Escape handling, implicit
  // role=dialog/aria-modal, backdrop inertness, AND focus restore to the
  // trigger. A div-based "modal" would need all of that reimplemented —
  // these assertions keep anyone from quietly downgrading the pattern.
  it("renders access modals as <dialog> with a labelled title", () => {
    const html = generateIndexHtml({ siteResults: [], password: null });
    expect(html).toMatch(/<dialog class="access-modal[^"]*" id="access-modal-github" aria-labelledby="access-modal-github-title">/);
    expect(html).toContain('<form method="dialog"');
  });

  it("opens via native showModal()", () => {
    const html = generateIndexHtml({ siteResults: [], password: null });
    expect(html).toContain("dlg.showModal()");
  });
});

describe("renderCard thin-data file-accessibility caption (v1.40.0)", () => {
  it("explains WHY there is no score instead of a bare (n / N) ratio", () => {
    const sr = {
      ...baseSr,
      summary: { ...baseSr.summary, byCategory: { pdf: 1 }, remediable: 1, auditScoreSum: 90, auditedDocCount: 1 },
    };
    const html = renderCard(sr);
    expect(html).toContain("Only 1 document on this site — too few for a reliable score (needs 5).");
    expect(html).not.toContain("Not enough scored PDFs yet");
  });
});

// v1.54.0 regression cover: unscoreableCount flows summary → renderCard's own
// summarizeFileA11y({unscoreable}) call → fileA11yCoverageText — a chain that
// fails SILENTLY (renders 0 unscoreable, no error) if a key along the way is
// dropped or misspelled. Five scored documents clear MIN_SCORED_DOCS so the
// card takes the banded branch (the thin-data branch above never renders the
// coverage clause at all).
describe("renderCard file-accessibility coverage clause names legacy Office (v1.54.0)", () => {
  it("surfaces the unscoreable count once the site has a full score band", () => {
    const sr = {
      ...baseSr,
      summary: {
        ...baseSr.summary,
        remediable: 7,
        auditScoreSum: 400,
        auditedDocCount: 5,
        unscoreableCount: 2,
      },
    };
    const html = renderCard(sr);
    expect(html).toContain("legacy Office");
    expect(html).toContain("re-save as .docx/.xlsx/.pptx");
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
        serverIp: "203.0.113.10",
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
    expect(html).not.toContain("203.0.113.10");
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
      site: { ...sr.site, host: "203.0.113.10" },
      header: { metadata: { serverIp: "203.0.113.10", hostname: "203.0.113.10" } },
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

  it("the audit-tool link includes an external-link SVG icon and the 'File Audit Tool' label (renamed v1.44.0)", () => {
    expect(html).toMatch(/<a class="audit-tool-link"[^>]*href="https:\/\/audit\.icjia\.app"[\s\S]{0,800}<span>File Audit Tool<\/span>/);
  });

  it("the navbar also has an 'Accessibility FAQs' button linked to accessibility.icjia.app (v1.7.28)", () => {
    expect(html).toMatch(/<a class="audit-tool-link"[^>]*href="https:\/\/accessibility\.icjia\.app"[\s\S]{0,800}<span>Accessibility FAQs<\/span>/);
  });

  it("uses rel=\"noopener noreferrer\" to prevent the target page from accessing window.opener", () => {
    expect(html).toMatch(/<a class="audit-tool-link"[^>]*rel="noopener noreferrer"/);
  });
});

// v1.44.0 — What's New: dismissible banner (newest entry) + nav link + rename.
describe("index page What's New (v1.44.0)", () => {
  const html = generateIndexHtml({ siteResults: [], password: null });

  it("carries the What's New banner with a dismiss button", () => {
    expect(html).toContain('data-announcement-id="');
    expect(html).toMatch(/<button[^>]*aria-label="Dismiss announcement"/);
    expect(html).toContain("fleet-audit:dismissed-whats-new");
  });

  it("links to whats-new.html from the header nav", () => {
    expect(html).toMatch(/<a class="audit-tool-link[^"]*" href="whats-new\.html"[\s\S]{0,600}What's New/);
  });

  it("renames the audit-tool nav label to 'File Audit Tool'", () => {
    expect(html).toContain("<span>File Audit Tool</span>");
    expect(html).not.toContain("PDF Audit Tool");
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

  // v1.55.0 — the paginator renders at both ends of the duplicates table.
  it("renders a bottom paginator with -b ids after the duplicates table", () => {
    expect(html).toContain('id="dup-pag-prev-b"');
    expect(html).toContain('id="dup-pag-next-b"');
    expect(html).toContain('id="dup-page-size-b"');
    expect(html).toContain('<span class="pag-info" id="dup-page-info-b"></span>');
    const tableIdx = html.indexOf('<table class="dup-table">');
    expect(tableIdx).toBeGreaterThan(-1);
    expect(html.indexOf('id="dup-pag-prev-b"')).toBeGreaterThan(tableIdx);
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
    expect(html).toMatch(/<a href="accessibility\.html"[^>]*>Accessibility log<\/a>/);
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

  // Office-scoring follow-on: the non-zero blurb used to say "non-PDF files
  // saved with a .pdf name, or large PDFs that timed out" — PDF-specific
  // wording that no longer fits now docx/xlsx/pptx are scored too.
  it("uses format-aware wording in the non-zero blurb, not PDF-specific", () => {
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
    expect(html).toContain(
      "3 files across 2 sites could not be audited — most are files saved with the wrong extension, or large documents that timed out.",
    );
    expect(html).not.toMatch(/non-PDF files saved with a \.pdf name/);
    expect(html).not.toMatch(/large PDFs that timed out/);
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
      auditedDocCount: 40, auditScoreSum: 3000, auditErrorCount: 2, auditPending: 1,
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

describe("generateIndexHtml — tooling lives only on /sites (v1.27.0)", () => {
  it("never renders a tooling band on the landing page, even if tools are passed", () => {
    const html = generateIndexHtml({
      siteResults: [],
      tools: [{ name: "squish", siteFullName: "Squish", siteUrl: "https://squish.icjia.app" }],
    });
    expect(html).not.toContain("Agency tooling");
    expect(html).not.toContain("Tooling sites");
    expect(html).not.toContain("Squish");
  });
  it("renders the /sites link in the top nav + footer", () => {
    const html = generateIndexHtml({ siteResults: [] });
    expect(html).toContain('href="sites.html"');
  });
});

describe("renderStatusDot (v1.21.2)", () => {
  it("renders the live status line with the visible 'Site live' label", () => {
    const html = renderStatusDot("live");
    expect(html).toContain("status-dot status-live");
    expect(html).toContain("Site live");
  });
  it("renders the unreachable status line with the visible label", () => {
    const html = renderStatusDot("down");
    expect(html).toContain("status-dot status-down");
    expect(html).toContain("Site unreachable");
  });
  it("renders nothing for an unknown / null status", () => {
    expect(renderStatusDot(null)).toBe("");
    expect(renderStatusDot("unknown")).toBe("");
  });
});

describe("renderToolCard status dot (v1.21.2)", () => {
  const tool = { name: "squish", siteFullName: "Squish", siteUrl: "https://squish.icjia.app", status: "live" };
  it("shows the dot only when showStatus is set", () => {
    expect(renderToolCard(tool, { showStatus: true })).toContain("status-dot status-live");
    expect(renderToolCard(tool)).not.toContain("status-dot");
  });
});

describe("renderCard status dot (v1.21.3)", () => {
  const sr = {
    site: { name: "x", siteName: "X", siteFullName: "Site X", siteUrl: "https://x.gov" },
    summary: { totalFiles: 1, remediable: 0, totalBytes: 1, byCategory: {} },
    htmlFile: "x.html", csvFile: "x.xlsx", scannedAt: "2026-05-01T00:00:00.000Z",
    header: { metadata: {} },
  };
  it("renders the live dot on the fleet card when sr.status is live", () => {
    expect(renderCard({ ...sr, status: "live" })).toContain("status-dot status-live");
  });
  it("renders the down dot when sr.status is down", () => {
    expect(renderCard({ ...sr, status: "down" })).toContain("status-dot status-down");
  });
  it("renders no dot when status is absent", () => {
    expect(renderCard(sr)).not.toContain("status-dot");
  });
});

// v1.39.0 (E8) — a site whose rollup wrote no per-site workbook carries
// csvFile: null; the card must not render a dead download link.
describe("renderCard download link only when a workbook exists (v1.39.0)", () => {
  it("omits the download anchor when csvFile is null", () => {
    const html = renderCard({ ...baseSr, csvFile: null });
    expect(html).not.toContain("btn-secondary");
    expect(html).not.toContain("Download spreadsheet");
  });

  it("keeps the download anchor for a normal site (csvFile set)", () => {
    const html = renderCard(baseSr);
    expect(html).toMatch(
      /<a href="dvfr-2026\.csv" class="btn btn-secondary" download>Download spreadsheet<\/a>/,
    );
  });
});

// v1.39.0 (E9) — the audit tile's "≈ N document pages" sub-label carries a
// title tooltip; pointer-events must be re-enabled on it or the tooltip
// never shows (every card descendant is pointer-events:none by default).
describe("index CSS re-enables pointer-events on the pages tooltip label (v1.39.0)", () => {
  it("includes .site-card .nums .lbl-sub in the pointer-events:auto block", () => {
    expect(INDEX_CSS).toMatch(
      /\.site-card \.nums \.lbl-sub[^}]*\{[^}]*pointer-events:\s*auto/,
    );
  });
});

// v1.39.0 (E10) — card image alt text must be escaped exactly once.
// Callers used to pass a pre-escaped name into renderCardImage (which
// escapes internally), double-escaping & < > in alt attributes.
describe("card image alt text is escaped exactly once (v1.39.0)", () => {
  const gnarly = "Theft & Insurance <Council>";
  const once = "Theft &amp; Insurance &lt;Council&gt;";
  const twice = "Theft &amp;amp; Insurance &amp;lt;Council&amp;gt;";

  it("renderCard passes the raw name to renderCardImage", () => {
    const html = renderCard({
      ...baseSr,
      image: "assets/og/x.png",
      site: { ...baseSr.site, siteFullName: gnarly },
    });
    expect(html).toContain(`alt="${once}"`);
    expect(html).not.toContain(twice);
  });

  it("renderCard fallback tile aria-label is once-escaped too", () => {
    const html = renderCard({
      ...baseSr,
      image: null,
      site: { ...baseSr.site, siteFullName: gnarly },
    });
    expect(html).toContain(`aria-label="${once}"`);
    expect(html).not.toContain(twice);
  });

  it("renderToolCard passes the raw name to renderCardImage", () => {
    const html = renderToolCard({
      name: "x", siteName: "X", siteFullName: gnarly,
      siteUrl: "https://x.example.gov", image: "assets/og/x.png",
    });
    expect(html).toContain(`alt="${once}"`);
    expect(html).not.toContain(twice);
  });
});

// v1.39.0 (E11) — orphans blurb: locale-formatted numbers + correct
// singular/plural verbs.
describe("orphans section blurb pluralization (v1.39.0)", () => {
  const orphansMeta = (n, stale, truly) => ({
    csvFilename: "audit-orphaned-files.xlsx",
    htmlFilename: "audit-orphaned-files.html",
    orphanCount: n,
    staleRevisionCount: stale,
    trulyUnreferencedCount: truly,
    csvByteCount: 100,
    htmlByteCount: 100,
  });

  it("singular copy for count 1", () => {
    const html = generateIndexHtml({ siteResults: [], password: null, orphans: orphansMeta(1, 1, 1) });
    expect(html).toContain("1 file on the fleet had no detectable references");
    expect(html).toContain("1 looks like");
    expect(html).toContain("1 is truly unreferenced");
  });

  it("plural copy for count 2 and thousands separators for large counts", () => {
    const html = generateIndexHtml({ siteResults: [], password: null, orphans: orphansMeta(2, 2, 2) });
    expect(html).toContain("2 files on the fleet had no detectable references");
    expect(html).toContain("2 look like");
    expect(html).toContain("2 are truly unreferenced");

    const big = generateIndexHtml({ siteResults: [], password: null, orphans: orphansMeta(1234, 1000, 234) });
    expect(big).toContain("1,234 files on the fleet had no detectable references");
    expect(big).toContain("1,000 look like");
    expect(big).toContain("234 are truly unreferenced");
  });
});

// v1.39.0 (E12) — the server-rendered card order must match the sort button
// that ships pressed ("Most recently added" = highest sites.json index
// first), so the no-JS page agrees with aria-pressed.
describe("SSR card order matches the pressed 'Most recently added' button (v1.39.0)", () => {
  const mkSr = (name, fullName) => ({
    site: { name, siteName: name.toUpperCase(), siteFullName: fullName },
    summary: { totalFiles: 1, remediable: 0, totalBytes: 1, byCategory: {} },
    htmlFile: `${name}.html`,
    csvFile: `${name}.xlsx`,
    scannedAt: "2026-05-01T00:00:00.000Z",
    header: { metadata: {} },
  });

  it("renders cards in reverse declaration order (added), not alphabetical", () => {
    // Declaration order: Zebra, Alpha, Mango. Added order → Mango, Alpha, Zebra.
    // Alphabetical would be Alpha, Mango, Zebra — different from both, so the
    // assertion distinguishes the modes.
    const html = generateIndexHtml({
      siteResults: [mkSr("zebra", "Zebra Site"), mkSr("alpha", "Alpha Site"), mkSr("mango", "Mango Site")],
      password: null,
    });
    const posMango = html.indexOf("Mango Site");
    const posAlpha = html.indexOf("Alpha Site");
    const posZebra = html.indexOf("Zebra Site");
    expect(posMango).toBeGreaterThan(-1);
    expect(posAlpha).toBeGreaterThan(posMango);
    expect(posZebra).toBeGreaterThan(posAlpha);
  });

  it("still stamps data-sort-added with the declaration index for the client sorter", () => {
    const html = generateIndexHtml({
      siteResults: [mkSr("zebra", "Zebra Site"), mkSr("alpha", "Alpha Site")],
      password: null,
    });
    expect(html).toMatch(/data-sort-az="zebra site"[^>]*data-sort-added="0"/);
    expect(html).toMatch(/data-sort-az="alpha site"[^>]*data-sort-added="1"/);
  });
});

describe("renderScorecards", () => {
  const summary = { auditScoreSum: 340, auditedDocCount: 5 }; // avg 68 → D
  const siteAudit = { score: 94, grade: "A", coverage: { scored: 150, pagesInSet: 412 } };

  it("renders both donuts with scores, grades, coverage, and the separation note", () => {
    const html = renderScorecards(summary, siteAudit);
    expect(html).toContain("File accessibility");
    expect(html).toContain("Website accessibility");
    expect(html).toContain(">68<");                       // file score value
    expect(html).toContain(">94<");                       // site score value
    expect(html).toContain("5 scored documents");         // file coverage
    expect(html).toContain("150 / 412 pages scored");     // site coverage
    expect(html).toContain("grade-d");                    // 68 → D band class
    expect(html).toContain("grade-a");                    // 94 → A band class
    expect(html).toMatch(/don.t correlate|separate measures/i);
    expect(html).toContain("documents");
    expect(html).toContain("web pages");
  });

  it("placeholders the file side when no documents are scored", () => {
    const html = renderScorecards({ auditedDocCount: 0 }, siteAudit);
    expect(html).toContain("No documents scored yet");
    expect(html).toContain(">94<"); // site still scored
  });

  it("placeholders the site side when there is no site audit", () => {
    const html = renderScorecards(summary, null);
    expect(html).toContain("Site not scored yet");
    expect(html).toContain(">68<"); // file still scored
  });

  it("placeholders both when neither is scored", () => {
    const html = renderScorecards({ auditedDocCount: 0 }, null);
    expect(html).toContain("No documents scored yet");
    expect(html).toContain("Site not scored yet");
  });
});

describe("meta description (v1.40.0)", () => {
  it("ships a description for the fleet index", () => {
    const html = generateIndexHtml({ siteResults: [], password: null });
    expect(html).toMatch(/<meta name="description" content="[^"]{40,}"/);
  });
});

describe("explains the widened scoring scope in the scores-by-site section", () => {
  it("explains the widened scoring scope in the scores-by-site section", () => {
    const html = generateIndexHtml({
      siteResults: [],
      password: null,
      scoresBySite: { filename: "scores-by-site.xlsx", siteCount: 10, byteCount: 100000 },
    });
    expect(html).toContain("Scores cover every machine-scoreable document");
    expect(html).toContain("re-saved in a modern format");
    expect(html).not.toContain("Scores cover PDFs only");
  });
});
