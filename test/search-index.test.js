import { describe, it, expect } from "vitest";
import { buildSearchIndex, SEARCH_INDEX_FILENAME } from "../src/web/search-index.js";

// The rollup-time emitter for search-index.json — the compact dataset the
// /search page fetches. Rows are positional arrays (documented in the
// module) with site + category folded out to lookup tables, because 8,787
// records × repeated JSON keys is pure wire-weight.

function fixture() {
  const siteResults = [
    {
      site: { name: "dvfr", siteName: "DVFR", siteFullName: "Domestic Violence Fatality Review" },
      htmlFile: "dvfr-20260816-125634Z.html",
    },
    {
      site: { name: "ari", siteName: "ARI", siteFullName: null },
      htmlFile: "ari-20260816-130046Z.html",
    },
  ];
  const allEntries = [
    {
      entry: {
        filename: "Annual Report 2023.pdf",
        path: "2023/Annual Report 2023.pdf",
        category: "pdf",
        sizeBytes: 2048,
        modifiedAt: "2024-03-05T10:00:00.000Z",
        audit: { audited: true, score: 72, grade: "C", reportUrl: "https://audit.icjia.app/report/a64a84ac" },
      },
      serverName: "dvfr",
      siteName: "DVFR",
      publicUrlBase: "https://dvfr.icjia-api.cloud/uploads",
      pathPrefix: null,
    },
    {
      entry: {
        filename: "brochure.pdf",
        path: "static/brochure.pdf",
        absolutePath: "https://github.com/ICJIA/ari/tree/main/static/brochure.pdf",
        category: "pdf",
        sizeBytes: 512,
        modifiedAt: "2019-01-02T00:00:00.000Z",
      },
      serverName: "ari",
      siteName: "ARI",
      publicUrlBase: "https://ari.example.com",
      pathPrefix: "static",
    },
    {
      entry: {
        filename: "logo.png",
        path: "logo.png",
        category: "image",
        sizeBytes: 100,
        modifiedAt: "2020-06-07T00:00:00.000Z",
      },
      serverName: "dvfr",
      siteName: "DVFR",
      publicUrlBase: "https://dvfr.icjia-api.cloud/uploads",
      pathPrefix: null,
    },
  ];
  return { allEntries, siteResults };
}

describe("buildSearchIndex", () => {
  it("exports the artifact filename the rollup and the page agree on", () => {
    expect(SEARCH_INDEX_FILENAME).toBe("search-index.json");
  });

  it("maps siteResults into the sites lookup table", () => {
    const idx = buildSearchIndex({ ...fixture(), generatedAt: "2026-08-16T00:00:00.000Z" });
    expect(idx.generatedAt).toBe("2026-08-16T00:00:00.000Z");
    expect(idx.sites).toEqual([
      { label: "DVFR", full: "Domestic Violence Fatality Review", slug: "dvfr", detail: "dvfr-20260816-125634Z.html" },
      { label: "ARI", full: "", slug: "ari", detail: "ari-20260816-130046Z.html" },
    ]);
  });

  it("emits one positional row per entry with an encoded public URL", () => {
    const idx = buildSearchIndex(fixture());
    const row = idx.rows.find((r) => r[0] === "Annual Report 2023.pdf");
    expect(row).toEqual([
      "Annual Report 2023.pdf",
      "2023/Annual Report 2023.pdf",
      0, // sites[0] = DVFR
      idx.categories.indexOf("pdf"),
      2048,
      "2024-03-05",
      72,
      "C",
      "https://dvfr.icjia-api.cloud/uploads/2023/Annual%20Report%202023.pdf",
      "https://audit.icjia.app/report/a64a84ac",
    ]);
  });

  it("leaves the per-file audit report URL null when the file has none", () => {
    const idx = buildSearchIndex(fixture());
    const row = idx.rows.find((r) => r[0] === "logo.png");
    expect(row[9]).toBeNull();
  });

  it("prefers the GitHub blob URL for git-type entries", () => {
    const idx = buildSearchIndex(fixture());
    const row = idx.rows.find((r) => r[0] === "brochure.pdf");
    expect(row[8]).toBe("https://github.com/ICJIA/ari/blob/main/static/brochure.pdf");
  });

  it("leaves score and grade null for unaudited files", () => {
    const idx = buildSearchIndex(fixture());
    const row = idx.rows.find((r) => r[0] === "logo.png");
    expect(row[6]).toBeNull();
    expect(row[7]).toBeNull();
  });

  it("carries an Office file's score, grade, and report link into the row", () => {
    const fx = fixture();
    fx.allEntries.push({
      entry: {
        filename: "memo.docx",
        path: "files/memo.docx",
        category: "office-document",
        sizeBytes: 25260,
        modifiedAt: "2023-12-08",
        audit: { score: 79, grade: "C", reportUrl: "https://audit.icjia.app/report/abc123" },
      },
      serverName: "dvfr",
      siteName: "DVFR",
      publicUrlBase: "https://dvfr.icjia-api.cloud/uploads",
      pathPrefix: null,
    });
    const idx = buildSearchIndex(fx);
    const row = idx.rows.find((r) => r[0] === "memo.docx");
    expect(row[6]).toBe(79);
    expect(row[7]).toBe("C");
    expect(row[9]).toBe("https://audit.icjia.app/report/abc123");
  });

  it("sorts rows by filename, case-insensitively", () => {
    const idx = buildSearchIndex(fixture());
    const names = idx.rows.map((r) => r[0].toLowerCase());
    expect(names).toEqual([...names].sort());
  });

  it("lists categories in canonical order without duplicates", () => {
    const idx = buildSearchIndex(fixture());
    expect(idx.categories).toEqual(["pdf", "image"]);
  });

  it("skips entries whose serverName has no siteResult", () => {
    const fx = fixture();
    fx.allEntries.push({
      entry: { filename: "ghost.pdf", path: "ghost.pdf", category: "pdf", sizeBytes: 1, modifiedAt: "" },
      serverName: "not-a-site",
      siteName: "Ghost",
      publicUrlBase: "",
      pathPrefix: null,
    });
    const idx = buildSearchIndex(fx);
    expect(idx.rows.some((r) => r[0] === "ghost.pdf")).toBe(false);
  });
});
