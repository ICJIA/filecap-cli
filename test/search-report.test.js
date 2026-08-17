import { describe, it, expect } from "vitest";
import {
  srRowKey,
  srAddRows,
  srRemoveRow,
  srSerializeReport,
  srParseStored,
  srReportXlsxName,
  SEARCH_REPORT_STORAGE_KEY,
  searchReportClientSource,
} from "../src/web/search-report.js";

// The /search page's custom-report store: a session-only report the visitor
// builds by selecting results across any number of searches. Pure functions
// embedded into search.html via .toString() (the search-xlsx.js pattern), so
// the add/dedupe/serialize logic the browser runs is exactly what these
// tests exercise. Persistence is sessionStorage — the page glue owns the
// get/setItem calls; everything testable lives here.

const A = {
  site: "DVFR",
  filename: "Annual Report 2023.pdf",
  category: "PDF",
  score: 82,
  grade: "B",
  sizeBytes: 2048,
  modified: "2024-03-05",
  fileUrl: "https://dvfr.icjia-api.cloud/uploads/2023/Annual%20Report%202023.pdf",
  reportUrl: "https://fleet.icjia.app/dvfr-20260816-125634Z.html",
  matchedOn: "annual: filename",
  query: "annual 2023",
};
const B = {
  ...A,
  filename: "Budget FY24.pdf",
  fileUrl: "https://dvfr.icjia-api.cloud/uploads/Budget%20FY24.pdf",
  query: "budget",
};
const C = {
  ...A,
  filename: "Minutes.docx",
  fileUrl: "https://icjia.icjia-api.cloud/uploads/Minutes.docx",
  query: "minutes",
};
// A row the scan never resolved to a public URL — identity must fall back
// to the row's own fields.
const NO_URL = { ...A, filename: "orphan.pdf", fileUrl: "", reportUrl: "" };

describe("srRowKey", () => {
  it("uses the file URL as the identity when present", () => {
    expect(srRowKey(A)).toBe(A.fileUrl);
  });

  it("falls back to site + filename + size + modified when there is no URL", () => {
    const key = srRowKey(NO_URL);
    expect(key).toContain("DVFR");
    expect(key).toContain("orphan.pdf");
    expect(key).not.toBe(srRowKey({ ...NO_URL, sizeBytes: 999 }));
  });
});

describe("srAddRows", () => {
  it("appends new rows and reports how many were added", () => {
    const out = srAddRows([A], [B, C]);
    expect(out.rows.map((r) => r.filename)).toEqual([
      "Annual Report 2023.pdf",
      "Budget FY24.pdf",
      "Minutes.docx",
    ]);
    expect(out.added).toBe(2);
    expect(out.duplicates).toBe(0);
    expect(out.dropped).toBe(0);
  });

  it("does not mutate the existing report array", () => {
    const existing = [A];
    srAddRows(existing, [B]);
    expect(existing).toHaveLength(1);
  });

  it("skips rows already in the report and counts them as duplicates", () => {
    const again = { ...A, query: "a totally different search" };
    const out = srAddRows([A], [again, B]);
    expect(out.rows).toHaveLength(2);
    expect(out.added).toBe(1);
    expect(out.duplicates).toBe(1);
    // first-found provenance wins — the original query stays
    expect(out.rows[0].query).toBe("annual 2023");
  });

  it("dedupes within the incoming batch itself", () => {
    const out = srAddRows([], [B, { ...B }]);
    expect(out.rows).toHaveLength(1);
    expect(out.added).toBe(1);
    expect(out.duplicates).toBe(1);
  });

  it("enforces the row cap and reports what was dropped", () => {
    const out = srAddRows([A], [B, C, NO_URL], 2);
    expect(out.rows).toHaveLength(2);
    expect(out.added).toBe(1);
    expect(out.dropped).toBe(2);
  });

  it("defaults the cap to 5000 rows", () => {
    const out = srAddRows([], [A]);
    expect(out.rows).toHaveLength(1);
    expect(out.dropped).toBe(0);
  });
});

describe("srRemoveRow", () => {
  it("removes the row with the given key and leaves the rest", () => {
    const out = srRemoveRow([A, B], srRowKey(A));
    expect(out.map((r) => r.filename)).toEqual(["Budget FY24.pdf"]);
  });

  it("returns a new array without mutating the input", () => {
    const rows = [A, B];
    const out = srRemoveRow(rows, srRowKey(B));
    expect(rows).toHaveLength(2);
    expect(out).toHaveLength(1);
  });
});

describe("srSerializeReport / srParseStored", () => {
  it("round-trips a report through the stored envelope", () => {
    const text = srSerializeReport([A, B]);
    expect(srParseStored(text)).toEqual([A, B]);
  });

  it("returns an empty report for null or empty storage", () => {
    expect(srParseStored(null)).toEqual([]);
    expect(srParseStored("")).toEqual([]);
  });

  it("returns an empty report for garbage JSON", () => {
    expect(srParseStored("{nope")).toEqual([]);
    expect(srParseStored('"just a string"')).toEqual([]);
  });

  it("returns an empty report for an unknown envelope version", () => {
    expect(srParseStored('{"v":99,"rows":[{"filename":"a.pdf"}]}')).toEqual([]);
  });

  it("drops malformed rows and keeps the valid ones", () => {
    const text = '{"v":1,"rows":[{"filename":"ok.pdf"},{"bogus":true},null,42]}';
    expect(srParseStored(text)).toEqual([{ filename: "ok.pdf" }]);
  });
});

describe("srReportXlsxName", () => {
  it("names the download custom-report-<date>.xlsx", () => {
    expect(srReportXlsxName("2026-08-17T13:00:00.000Z")).toBe("custom-report-20260817.xlsx");
  });
});

describe("SEARCH_REPORT_STORAGE_KEY", () => {
  it("uses the bundle's storage-key prefix", () => {
    expect(SEARCH_REPORT_STORAGE_KEY).toMatch(/^fleet-audit:/);
  });
});

describe("searchReportClientSource", () => {
  it("emits self-contained sources for the inline <script>", () => {
    const src = searchReportClientSource();
    expect(src).toContain("function srRowKey");
    expect(src).toContain("function srAddRows");
    expect(src).toContain("function srRemoveRow");
    expect(src).toContain("function srSerializeReport");
    expect(src).toContain("function srParseStored");
    expect(src).toContain("function srReportXlsxName");
    expect(src).not.toMatch(/\bimport\b/);
    expect(src).not.toMatch(/\bexport\b/);
  });
});
