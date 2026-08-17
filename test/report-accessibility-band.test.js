import { describe, it, expect } from "vitest";
import {
  A11Y_BANDS,
  MIN_SCORED_DOCS,
  A11Y_SCORE_EXCLUDE_SLUGS,
  bandForScore,
  summarizeFileA11y,
  fileA11yCoverageText,
  fileA11yThinDataText,
  fileA11yGaugeHtml,
  fileA11yTrendChipHtml,
} from "../src/report/accessibility-band.js";

describe("constants", () => {
  // v1.45.0 — archive-prod is back in the roster AND in scoring: its files
  // are live and may need remediation, so its scores count toward the site
  // gauge and the fleet average. The exclusion mechanism stays (empty list).
  it("excludes no sites — the archive is back in scoring (v1.45.0)", () => {
    expect(A11Y_SCORE_EXCLUDE_SLUGS).toEqual([]);
  });

  it("archive-prod summarizes like any other site (not excluded)", () => {
    const s = summarizeFileA11y({ auditScoreSum: 400, auditedDocCount: 10, remediable: 12, siteSlug: "archive-prod" });
    expect(s.excluded).toBe(false);
    expect(s.avg).toBe(40);
    expect(s.band?.key).toBe("far");
  });

  it("requires at least 5 scored documents for a meaningful average", () => {
    expect(MIN_SCORED_DOCS).toBe(5);
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
  it("averages scored documents and assigns a band", () => {
    const r = summarizeFileA11y({
      auditScoreSum: 350,
      auditedDocCount: 5,
      auditErrorCount: 1,
      auditPending: 2,
      unscoreable: 12,
      remediable: 20,
      siteSlug: "dvfr-strapi-prod",
    });
    expect(r.excluded).toBe(false);
    expect(r.scored).toBe(5);
    expect(r.docs).toBe(8); // 5 scored + 1 error + 2 pending
    expect(r.avg).toBe(70);
    expect(r.enoughData).toBe(true);
    expect(r.band.key).toBe("partial");
    expect(r.remediable).toBe(20);
    expect(r.unscoreable).toBe(12); // passed straight through, no longer derived
  });

  it("carries the explicit unscoreable count through (no more derived office subtraction)", () => {
    const r = summarizeFileA11y({ auditScoreSum: 400, auditedDocCount: 5, unscoreable: 748, remediable: 4628 });
    expect(r.unscoreable).toBe(748);
    expect(r.scored).toBe(5);
  });

  it("rounds the average to the nearest whole number", () => {
    const r = summarizeFileA11y({
      auditScoreSum: 199,
      auditedDocCount: 3,
      remediable: 3,
      siteSlug: "x",
    });
    expect(r.avg).toBe(66); // 199/3 = 66.33
  });

  // v1.39.0 — a 100 must mean every scored PDF is a 100, not a rounding
  // artifact (19×100 + 1×95 rounds to 100 and used to display a perfect
  // score with a failing PDF in the set).
  it("clamps a rounded-up 100 to 99 when not every PDF scored 100", () => {
    const r = summarizeFileA11y({
      auditScoreSum: 19 * 100 + 95, // = 1995, /20 = 99.75 → rounds to 100
      auditedDocCount: 20,
      remediable: 20,
      siteSlug: "x",
    });
    expect(r.avg).toBe(99);
    expect(r.band.key).toBe("closer"); // band derives from the clamped value
  });

  it("still reports 100 when every scored PDF is a 100", () => {
    const r = summarizeFileA11y({
      auditScoreSum: 20 * 100,
      auditedDocCount: 20,
      remediable: 20,
      siteSlug: "x",
    });
    expect(r.avg).toBe(100);
  });

  it("does not disturb ordinary rounding at band thresholds (79.5 → 80)", () => {
    const r = summarizeFileA11y({
      auditScoreSum: 159, // /2 = 79.5 → rounds to 80
      auditedDocCount: 2,
      auditPending: 3,
      remediable: 5,
      siteSlug: "x",
    });
    expect(r.avg).toBe(80);
  });

  it("applies the 80 boundary inclusively (avg 80 = closer)", () => {
    const r = summarizeFileA11y({
      auditScoreSum: 480,
      auditedDocCount: 6,
      remediable: 6,
      siteSlug: "x",
    });
    expect(r.avg).toBe(80);
    expect(r.band.key).toBe("closer");
  });

  it("suppresses the band when fewer than 5 PDFs are scored", () => {
    const r = summarizeFileA11y({
      auditScoreSum: 240,
      auditedDocCount: 4,
      remediable: 10,
      siteSlug: "x",
    });
    expect(r.scored).toBe(4);
    expect(r.enoughData).toBe(false);
    expect(r.band).toBeNull();
    expect(r.avg).toBe(60); // avg still computed for the "n/N" caption context
  });

  it("handles a site with zero scored documents", () => {
    const r = summarizeFileA11y({
      auditScoreSum: 0,
      auditedDocCount: 0,
      auditPending: 21,
      remediable: 21,
      siteSlug: "ari-summit-2019-git",
    });
    expect(r.scored).toBe(0);
    expect(r.avg).toBeNull();
    expect(r.band).toBeNull();
    expect(r.enoughData).toBe(false);
    expect(r.docs).toBe(21);
  });

  // v1.45.0 — was "marks the archive site excluded and never assigns a band":
  // the archive is back in scoring, so the same realistic numbers now band
  // like any other site (avg 28 → far from accessible).
  it("bands the archive site like any other now that it is back in scoring (v1.45.0)", () => {
    const r = summarizeFileA11y({
      auditScoreSum: 33572,
      auditedDocCount: 1199,
      remediable: 1429,
      siteSlug: "archive-prod",
    });
    expect(r.excluded).toBe(false);
    expect(r.avg).toBe(28);
    expect(r.band?.key).toBe("far");
    expect(r.remediable).toBe(1429);
  });

  it("treats missing optional counts as zero", () => {
    const r = summarizeFileA11y({
      auditScoreSum: 455,
      auditedDocCount: 7,
      siteSlug: "x",
    });
    expect(r.docs).toBe(7);
    expect(r.remediable).toBe(0);
    expect(r.avg).toBe(65);
  });
});

describe("fileA11yCoverageText", () => {
  it("names the legacy files and the conversion fix in the coverage caption", () => {
    const text = fileA11yCoverageText({ scored: 3854, remediable: 4628, unscoreable: 748 });
    expect(text).toBe(
      "3,854 of 4,628 remediable files scored · 748 legacy Office files can't be machine-scored (re-save as .docx/.xlsx/.pptx to score them) — remediable files only, not all files.",
    );
  });

  it("singularizes the legacy clause", () => {
    const text = fileA11yCoverageText({ scored: 5, remediable: 6, unscoreable: 1 });
    expect(text).toContain("1 legacy Office file can't be machine-scored");
  });

  it("omits the legacy clause when there are none", () => {
    const text = fileA11yCoverageText({ scored: 5, remediable: 5, unscoreable: 0 });
    expect(text).toBe("5 of 5 remediable files scored — remediable files only, not all files.");
  });
});

describe("fileA11yGaugeHtml", () => {
  it("renders a gauge track with the marker at the rounded score and a labelled aria", () => {
    const a = summarizeFileA11y({
      auditScoreSum: 350, auditedDocCount: 5, remediable: 10, siteSlug: "x",
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

describe("fileA11yThinDataText", () => {
  it("explains thin data in document terms", () => {
    expect(fileA11yThinDataText({ scored: 0, docs: 0 })).toBe("No scoreable documents on this site.");
    expect(fileA11yThinDataText({ scored: 1, docs: 1 })).toBe("Only 1 document on this site — too few for a reliable score (needs 5).");
    expect(fileA11yThinDataText({ scored: 1, docs: 3 })).toBe("Only 1 of 3 documents scored so far — too few for a reliable score (needs 5).");
  });

  it("stays in sync with MIN_SCORED_DOCS", () => {
    expect(fileA11yThinDataText({ scored: 1, docs: 1 })).toContain(`needs ${MIN_SCORED_DOCS}`);
  });
});

describe("band module escapes its own interpolations (v1.40.0)", () => {
  it("renders hostile sinceText inert in the trend chip", () => {
    const html = fileA11yTrendChipHtml({ delta: 2, dir: "up", sinceText: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    const flat = fileA11yTrendChipHtml({ delta: 0, dir: "flat", sinceText: "<b>x</b>" });
    expect(flat).not.toContain("<b>");
  });

  it("escapes the band label inside the gauge aria-label", () => {
    const html = fileA11yGaugeHtml({ avg: 50, band: { label: '"><script>alert(1)</script>' } });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
});
