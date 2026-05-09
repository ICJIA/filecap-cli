import { describe, it, expect } from "vitest";
import { writeSummary } from "../src/report/summary.js";

describe("writeSummary", () => {
  it("emits top-level numbers and category breakdown", () => {
    const entries = [
      { category: "pdf", remediable: true, sizeBytes: 1000, introspection: { kind: "pdf", isImageOnly: true, pageCount: 1, hasTextLayer: false, hasTags: false, hasFormFields: false, hasSignatures: false, encrypted: false } },
      { category: "pdf", remediable: true, sizeBytes: 2000, introspection: { kind: "pdf", pageCount: 1, hasTextLayer: true, isImageOnly: false, hasTags: false, hasFormFields: false, hasSignatures: false, encrypted: false } },
      { category: "image", remediable: false, sizeBytes: 500 },
      { category: "office-document", remediable: true, sizeBytes: 1500 },
    ];
    const text = writeSummary({ entries, sources: null });
    expect(text).toContain("Total files: 4");
    expect(text).toContain("Total bytes: 5000");
    expect(text).toContain("pdf: 2");
    expect(text).toContain("image-only PDFs: 1");
    expect(text).toContain("Remediable: 3");
  });

  it("includes consolidated stats when sources are provided", () => {
    const entries = [];
    const sources = [
      { serverName: "a", stats: { fileCount: 100, totalBytes: 1000, scanDurationMs: 0, introspectionFailures: 0, permissionDenials: 0 } },
      { serverName: "b", stats: { fileCount: 200, totalBytes: 2000, scanDurationMs: 0, introspectionFailures: 0, permissionDenials: 0 } },
    ];
    const text = writeSummary({ entries, sources });
    expect(text).toContain("Sources: 2");
    expect(text).toContain("a:");
    expect(text).toContain("b:");
  });
});
