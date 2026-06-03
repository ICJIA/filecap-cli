import { describe, it, expect } from "vitest";
import { estimateRemediablePages, PAGE_ESTIMATES } from "../src/web/page-estimate.js";

describe("estimateRemediablePages", () => {
  it("returns 0 when nothing is remediable", () => {
    expect(estimateRemediablePages({})).toBe(0);
  });

  it("returns measured PDF pages when only PDFs are present", () => {
    expect(estimateRemediablePages({ pdfPagesMeasured: 1234 })).toBe(1234);
  });

  it("adds estimated DOCX pages on top of measured PDF pages", () => {
    const got = estimateRemediablePages({ pdfPagesMeasured: 100, docxCount: 10 });
    expect(got).toBe(100 + 10 * PAGE_ESTIMATES.docx);
  });

  it("adds estimated PPTX slides", () => {
    expect(estimateRemediablePages({ pptxCount: 17 })).toBe(17 * PAGE_ESTIMATES.pptx);
  });

  it("counts XLSX as one logical page each", () => {
    expect(estimateRemediablePages({ xlsxCount: 777 })).toBe(777 * PAGE_ESTIMATES.xlsx);
    expect(PAGE_ESTIMATES.xlsx).toBe(1);
  });

  it("estimates legacy Office formats", () => {
    expect(estimateRemediablePages({ legacyOfficeCount: 4 })).toBe(4 * PAGE_ESTIMATES.legacyOffice);
  });

  it("matches the fleet-as-of-2026-05-22 figure", () => {
    // Measured PDF pages from audit-fleet.ndjson 2026-05-22:
    //   pdfPagesMeasured = 88211, docx = 421, pptx = 17, xlsx = 777, legacy = 0
    //   → 88211 + 421*7 + 17*20 + 777*1 = 88211 + 2947 + 340 + 777 = 92275
    const got = estimateRemediablePages({
      pdfPagesMeasured: 88211,
      docxCount: 421,
      pptxCount: 17,
      xlsxCount: 777,
    });
    expect(got).toBe(92275);
  });

  it("ignores unknown fields without crashing", () => {
    expect(estimateRemediablePages({ pdfPagesMeasured: 50, somethingUnrelated: 999 })).toBe(50);
  });
});

describe("PAGE_ESTIMATES", () => {
  it("documents the per-format averages and is frozen", () => {
    expect(PAGE_ESTIMATES.docx).toBeGreaterThan(0);
    expect(PAGE_ESTIMATES.pptx).toBeGreaterThan(0);
    expect(PAGE_ESTIMATES.xlsx).toBeGreaterThan(0);
    expect(PAGE_ESTIMATES.legacyOffice).toBeGreaterThan(0);
    expect(Object.isFrozen(PAGE_ESTIMATES)).toBe(true);
  });
});
