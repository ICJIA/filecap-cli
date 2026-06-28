import { describe, it, expect } from "vitest";
import {
  A11Y_BANDS,
  MIN_SCORED_PDFS,
  A11Y_SCORE_EXCLUDE_SLUGS,
  bandForScore,
  summarizeFileA11y,
  fileA11yCoverageText,
  fileA11yGaugeHtml,
  fileA11yTrendChipHtml,
} from "../src/report/accessibility-band.js";

describe("constants", () => {
  it("excludes the long-term archive site by slug", () => {
    expect(A11Y_SCORE_EXCLUDE_SLUGS).toContain("archive-prod");
  });

  it("requires at least 5 scored PDFs for a meaningful average", () => {
    expect(MIN_SCORED_PDFS).toBe(5);
  });

  it("defines three ordered bands far/partial/closer", () => {
    expect(A11Y_BANDS.map((b) => b.key)).toEqual(["closer", "partial", "far"]);
  });
});

describe("bandForScore", () => {
  it("maps >= 80 to 'closer to accessible' (green)", () => {
    expect(bandForScore(80).key).toBe("closer");
    expect(bandForScore(100).key).toBe("closer");
    expect(bandForScore(80).color).toBe("green");
  });

  it("maps 60-79 to 'partial progress' (yellow)", () => {
    expect(bandForScore(79).key).toBe("partial");
    expect(bandForScore(60).key).toBe("partial");
    expect(bandForScore(60).color).toBe("yellow");
  });

  it("maps < 60 to 'far from accessible' (red)", () => {
    expect(bandForScore(59).key).toBe("far");
    expect(bandForScore(0).key).toBe("far");
    expect(bandForScore(28).color).toBe("red");
  });

  it("carries a human label on each band", () => {
    expect(bandForScore(85).label).toMatch(/closer to accessible/i);
    expect(bandForScore(70).label).toMatch(/partial/i);
    expect(bandForScore(40).label).toMatch(/far from accessible/i);
  });

  it("returns null for a missing or non-numeric score", () => {
    expect(bandForScore(null)).toBeNull();
    expect(bandForScore(undefined)).toBeNull();
    expect(bandForScore(NaN)).toBeNull();
  });
});

describe("summarizeFileA11y", () => {
  it("averages scored PDFs and assigns a band", () => {
    const r = summarizeFileA11y({
      auditScoreSum: 350,
      auditedPdfCount: 5,
      auditErrorCount: 1,
      auditPending: 2,
      remediable: 20,
      siteSlug: "dvfr-strapi-prod",
    });
    expect(r.excluded).toBe(false);
    expect(r.scored).toBe(5);
    expect(r.pdfs).toBe(8); // 5 scored + 1 error + 2 pending
    expect(r.avg).toBe(70);
    expect(r.enoughData).toBe(true);
    expect(r.band.key).toBe("partial");
    expect(r.remediable).toBe(20);
    expect(r.office).toBe(12); // 20 remediable - 8 PDFs (5 scored + 1 err + 2 pending)
  });

  it("derives the non-PDF (office) remediable count as remediable minus PDFs", () => {
    const r = summarizeFileA11y({
      auditScoreSum: 300, auditedPdfCount: 5, remediable: 11, siteSlug: "x",
    });
    expect(r.office).toBe(6); // 11 remediable - 5 PDFs
  });

  it("never reports a negative office count", () => {
    const r = summarizeFileA11y({
      auditScoreSum: 300, auditedPdfCount: 5, remediable: 0, siteSlug: "x",
    });
    expect(r.office).toBe(0);
  });

  it("rounds the average to the nearest whole number", () => {
    const r = summarizeFileA11y({
      auditScoreSum: 199,
      auditedPdfCount: 3,
      remediable: 3,
      siteSlug: "x",
    });
    expect(r.avg).toBe(66); // 199/3 = 66.33
  });

  it("applies the 80 boundary inclusively (avg 80 = closer)", () => {
    const r = summarizeFileA11y({
      auditScoreSum: 480,
      auditedPdfCount: 6,
      remediable: 6,
      siteSlug: "x",
    });
    expect(r.avg).toBe(80);
    expect(r.band.key).toBe("closer");
  });

  it("suppresses the band when fewer than 5 PDFs are scored", () => {
    const r = summarizeFileA11y({
      auditScoreSum: 240,
      auditedPdfCount: 4,
      remediable: 10,
      siteSlug: "x",
    });
    expect(r.scored).toBe(4);
    expect(r.enoughData).toBe(false);
    expect(r.band).toBeNull();
    expect(r.avg).toBe(60); // avg still computed for the "n/N" caption context
  });

  it("handles a site with zero scored PDFs", () => {
    const r = summarizeFileA11y({
      auditScoreSum: 0,
      auditedPdfCount: 0,
      auditPending: 21,
      remediable: 21,
      siteSlug: "ari-summit-2019-git",
    });
    expect(r.scored).toBe(0);
    expect(r.avg).toBeNull();
    expect(r.band).toBeNull();
    expect(r.enoughData).toBe(false);
    expect(r.pdfs).toBe(21);
  });

  it("marks the archive site excluded and never assigns a band", () => {
    const r = summarizeFileA11y({
      auditScoreSum: 33572,
      auditedPdfCount: 1199,
      remediable: 1429,
      siteSlug: "archive-prod",
    });
    expect(r.excluded).toBe(true);
    expect(r.band).toBeNull();
    expect(r.remediable).toBe(1429); // count still surfaced for the archive note
  });

  it("treats missing optional counts as zero", () => {
    const r = summarizeFileA11y({
      auditScoreSum: 455,
      auditedPdfCount: 7,
      siteSlug: "x",
    });
    expect(r.pdfs).toBe(7);
    expect(r.remediable).toBe(0);
    expect(r.avg).toBe(65);
  });
});

describe("fileA11yCoverageText", () => {
  it("states scored-of-remediable coverage, the non-PDF gap, and the remediable-only scope", () => {
    const a = summarizeFileA11y({
      auditScoreSum: 4480, auditedPdfCount: 64, auditPending: 6, remediable: 70, siteSlug: "x",
    });
    // 64 scored, 70 remediable, 70 PDFs? no: pdfs = 64 + 6 = 70 → office = 0
    const a2 = summarizeFileA11y({
      auditScoreSum: 4480, auditedPdfCount: 64, auditPending: 0, remediable: 70, siteSlug: "x",
    });
    const txt = fileA11yCoverageText(a2);
    expect(txt).toMatch(/64 of 70 remediable files scored/);
    expect(txt).toMatch(/6 non-PDF/);
    expect(txt).toMatch(/remediable files only, not all files/i);
    void a;
  });

  it("omits the non-PDF clause when every remediable file is a PDF", () => {
    const a = summarizeFileA11y({
      auditScoreSum: 480, auditedPdfCount: 6, remediable: 6, siteSlug: "x",
    });
    const txt = fileA11yCoverageText(a);
    expect(txt).toMatch(/6 of 6 remediable files scored/);
    expect(txt).not.toMatch(/non-PDF/);
    expect(txt).toMatch(/remediable files only, not all files/i);
  });

  it("uses singular grammar for a single non-PDF file", () => {
    const a = summarizeFileA11y({
      auditScoreSum: 400, auditedPdfCount: 5, remediable: 6, siteSlug: "x",
    });
    const txt = fileA11yCoverageText(a);
    expect(txt).toMatch(/1 non-PDF file has no score/);
  });
});

describe("fileA11yGaugeHtml", () => {
  it("renders a gauge track with the marker at the rounded score and a labelled aria", () => {
    const a = summarizeFileA11y({
      auditScoreSum: 350, auditedPdfCount: 5, remediable: 10, siteSlug: "x",
    }); // avg 70 → partial
    const html = fileA11yGaugeHtml(a);
    expect(html).toMatch(/a11y-gauge-track/);
    expect(html).toMatch(/a11y-gauge-marker/);
    expect(html).toMatch(/left:\s*70%/);
    expect(html).toMatch(/aria-label="[^"]*70 of 100[^"]*partial progress/i);
  });

  it("clamps the marker between 0 and 100", () => {
    expect(fileA11yGaugeHtml({ avg: 0, band: { label: "Far from accessible" } })).toMatch(/left:\s*0%/);
    expect(fileA11yGaugeHtml({ avg: 100, band: { label: "Closer to accessible" } })).toMatch(/left:\s*100%/);
    expect(fileA11yGaugeHtml({ avg: 140, band: { label: "Closer to accessible" } })).toMatch(/left:\s*100%/);
  });
});

describe("fileA11yTrendChipHtml", () => {
  it("renders nothing for a baseline (no trend)", () => {
    expect(fileA11yTrendChipHtml(null)).toBe("");
  });

  it("renders an up arrow + magnitude + date for an improvement", () => {
    const html = fileA11yTrendChipHtml({ delta: 6, dir: "up", sinceText: "Jun 12" });
    expect(html).toMatch(/a11y-trend-up/);
    expect(html).toMatch(/▲/);
    expect(html).toMatch(/6 since Jun 12/);
  });

  it("renders a down arrow and the absolute magnitude for a decline", () => {
    const html = fileA11yTrendChipHtml({ delta: -4, dir: "down", sinceText: "Jun 12" });
    expect(html).toMatch(/a11y-trend-down/);
    expect(html).toMatch(/▼/);
    expect(html).toMatch(/4 since Jun 12/);
    expect(html).not.toMatch(/-4/);
  });

  it("says 'no change' when flat", () => {
    const html = fileA11yTrendChipHtml({ delta: 0, dir: "flat", sinceText: "Jun 12" });
    expect(html).toMatch(/a11y-trend-flat/);
    expect(html).toMatch(/no change since Jun 12/);
  });
});
