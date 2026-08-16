import { describe, it, expect } from "vitest";
import {
  foldSearchText,
  squashSearchText,
  editDistanceLe,
  buildHaystack,
  runSearch,
  highlightRanges,
  suggestSiteTerms,
  searchMatchClientSource,
} from "../src/web/search-match.js";

// The /search page matcher. People searching know FRAGMENTS, not filenames:
// "dvfr report" must find DVFR's annual report even though "dvfr" appears
// only in the site's name, and "anual report" (typo) must still land. The
// matcher is tiered — filename substring > site/path substring > separator-
// blind ("squashed") > typo-tolerant — so exact hits always outrank fuzzy.

// ── fixture records ───────────────────────────────────────────────────────────

const RECORDS = [
  { // r0 — Strapi upload hash on the name, DVFR site
    filename: "DVFR_Annual_Report_2023_a1b2c3d4e5.pdf",
    path: "2023/DVFR_Annual_Report_2023_a1b2c3d4e5.pdf",
    siteLabel: "DVFR",
    siteFull: "Domestic Violence Fatality Review",
  },
  { // r1 — same site, biennial not annual
    filename: "biennial-report-2021.pdf",
    path: "biennial-report-2021.pdf",
    siteLabel: "DVFR",
    siteFull: "Domestic Violence Fatality Review",
  },
  { // r2 — different site entirely
    filename: "budget_fy24.xlsx",
    path: "finance/budget_fy24.xlsx",
    siteLabel: "ICJIA",
    siteFull: "Illinois Criminal Justice Information Authority",
  },
  { // r3 — DVFR site but no "report" anywhere
    filename: "Fatality_Review_Summary.pdf",
    path: "Fatality_Review_Summary.pdf",
    siteLabel: "DVFR",
    siteFull: "Domestic Violence Fatality Review",
  },
  { // r4 — "annual" in the name on another site
    filename: "annual_picnic_photo.jpg",
    path: "img/annual_picnic_photo.jpg",
    siteLabel: "R3",
    siteFull: "Restore Reinvest Renew",
  },
  { // r5 — Strapi hash directly before the extension (the common upload shape)
    filename: "minutes_9f8e7d6c5b.pdf",
    path: "minutes_9f8e7d6c5b.pdf",
    siteLabel: "ICJIA",
    siteFull: "Illinois Criminal Justice Information Authority",
  },
];

const HAYS = RECORDS.map((r) => buildHaystack(r));

/** Run a query and return the matched record indices in rank order. */
function hits(query) {
  return runSearch(HAYS, query).map((m) => m.i);
}

// ── foldSearchText ────────────────────────────────────────────────────────────

describe("foldSearchText", () => {
  it("lowercases and folds separator runs to single spaces", () => {
    expect(foldSearchText("DVFR_Annual-Report.2023.pdf")).toBe("dvfr annual report 2023 pdf");
  });

  it("folds parentheses, commas, slashes, and whitespace runs", () => {
    expect(foldSearchText("Report (FINAL),  v2/copy")).toBe("report final v2 copy");
  });

  it("returns empty string for nullish input", () => {
    expect(foldSearchText(null)).toBe("");
    expect(foldSearchText(undefined)).toBe("");
  });
});

// ── squashSearchText ──────────────────────────────────────────────────────────

describe("squashSearchText", () => {
  it("keeps only lowercase alphanumerics", () => {
    expect(squashSearchText("DVFR_Annual Report-2023.pdf")).toBe("dvfrannualreport2023pdf");
  });
});

// ── editDistanceLe ────────────────────────────────────────────────────────────

describe("editDistanceLe", () => {
  it("accepts a single missing letter", () => {
    expect(editDistanceLe("anual", "annual", 1)).toBe(true);
  });

  it("accepts an adjacent transposition as one edit", () => {
    expect(editDistanceLe("annaul", "annual", 1)).toBe(true);
  });

  it("accepts a single substitution", () => {
    expect(editDistanceLe("deport", "report", 1)).toBe(true);
  });

  it("rejects when distance exceeds the bound", () => {
    expect(editDistanceLe("cat", "dog", 2)).toBe(false);
  });

  it("bails early on a length gap larger than the bound", () => {
    expect(editDistanceLe("a", "abcdef", 1)).toBe(false);
  });
});

// ── runSearch ─────────────────────────────────────────────────────────────────

describe("runSearch", () => {
  it("matches a site-name fragment plus a filename fragment ('dvfr report')", () => {
    // "dvfr" lives in r1's SITE name, not its filename — the whole point.
    expect(hits("dvfr report")).toEqual([0, 1]);
  });

  it("ranks a filename hit above a site-name-only hit", () => {
    const ranked = runSearch(HAYS, "dvfr report");
    expect(ranked[0].i).toBe(0); // "dvfr" in r0's filename outranks r1's site-only hit
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("tolerates a typo in one term ('anual report')", () => {
    expect(hits("anual report")).toEqual([0]);
  });

  it("matches with separators omitted ('annualreport')", () => {
    expect(hits("annualreport")).toContain(0);
  });

  it("matches across the Strapi upload hash ('minutespdf')", () => {
    // squashed raw name is "minutes9f8e7d6c5bpdf" — only the hash-stripped
    // variant makes "minutespdf" a contiguous run in the squash tier.
    expect(hits("minutespdf")).toContain(5);
  });

  it("finds a typo'd single term ('buget')", () => {
    expect(hits("buget")).toEqual([2]);
  });

  it("ANDs terms: every term must match somewhere", () => {
    expect(hits("dvfr budget")).toEqual([]);
  });

  it("matches short terms as substrings only ('r3')", () => {
    expect(hits("r3")).toContain(4);
  });

  it("does not fuzz terms shorter than 4 chars", () => {
    expect(hits("rx")).toEqual([]);
  });

  it("returns empty for an empty or whitespace query", () => {
    expect(runSearch(HAYS, "")).toEqual([]);
    expect(runSearch(HAYS, "   ")).toEqual([]);
  });

  it("ranks results deterministically (score desc, then index asc)", () => {
    const ranked = runSearch(HAYS, "review");
    const scores = ranked.map((m) => m.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});

// ── match explanations (v1.47.0) ─────────────────────────────────────────────
// "Is it a DVFR report, or just a report ON DVFR?" Every match carries a
// per-term `why` so the page can say which: src "name" (in the filename),
// "site" (the site's name), "path" (the folder), "squash" (separators
// removed), or "fuzzy" (close-enough spelling, with the word it matched).

describe("runSearch match explanations", () => {
  function whyFor(query, i) {
    const m = runSearch(HAYS, query).find((x) => x.i === i);
    return m ? m.why : null;
  }

  it("labels a filename hit as src 'name'", () => {
    expect(whyFor("dvfr report", 0)).toEqual([
      { term: "dvfr", src: "name" },
      { term: "report", src: "name" },
    ]);
  });

  it("labels a site-name-only hit as src 'site'", () => {
    // r1's filename has no "dvfr" — the term landed on the site's name.
    expect(whyFor("dvfr report", 1)).toEqual([
      { term: "dvfr", src: "site" },
      { term: "report", src: "name" },
    ]);
  });

  it("labels a folder-path hit as src 'path'", () => {
    // "finance" appears only in r2's path, never its filename or site.
    expect(whyFor("finance budget", 2)).toEqual([
      { term: "finance", src: "path" },
      { term: "budget", src: "name" },
    ]);
  });

  it("labels a separator-blind hit as src 'squash'", () => {
    expect(whyFor("annualreport", 0)).toEqual([
      { term: "annualreport", src: "squash" },
    ]);
  });

  it("labels a typo hit as src 'fuzzy' and names the matched word", () => {
    expect(whyFor("anual report", 0)).toEqual([
      { term: "anual", src: "fuzzy", word: "annual" },
      { term: "report", src: "name" },
    ]);
  });
});

// ── fuzzy blast-radius taming (v1.48.0) ──────────────────────────────────────
// A typo'd SITE nickname used to pull that site's entire inventory ("svfr"
// → all 109 DVFR files). Typo tolerance now applies to FILENAME words only;
// a near-miss on a site's name becomes a "Did you mean?" suggestion instead
// of a silent flood. Near-misses on folder-path words match nothing.

describe("fuzzy tier scope", () => {
  it("no longer matches records via a typo'd site name", () => {
    // "svfr" ≈ "dvfr": r0 has dvfr in its FILENAME (stays); r1/r3 are DVFR
    // files whose names lack it (used to match via the site word — gone).
    expect(hits("svfr")).toEqual([0]);
  });

  it("still matches typos against filename words", () => {
    expect(hits("buget")).toEqual([2]);
  });

  it("no longer matches records via a typo'd folder-path word", () => {
    // "finanse" ≈ r2's path dir "finance" (never its filename or site).
    expect(hits("finanse")).toEqual([]);
  });
});

describe("suggestSiteTerms", () => {
  const SITES = ["DVFR", "Domestic Violence Fatality Review", "ICJIA", "R3", "Restore Reinvest Renew"];

  it("suggests the site word a term nearly spells", () => {
    expect(suggestSiteTerms(SITES, "svfr")).toEqual([{ term: "svfr", word: "dvfr" }]);
  });

  it("suggests only for the misspelled term of a multi-word query", () => {
    expect(suggestSiteTerms(SITES, "svfr report")).toEqual([{ term: "svfr", word: "dvfr" }]);
  });

  it("stays quiet for exact and substring hits", () => {
    expect(suggestSiteTerms(SITES, "dvfr")).toEqual([]);
    expect(suggestSiteTerms(SITES, "dvf")).toEqual([]); // substring of dvfr
    expect(suggestSiteTerms(SITES, "domesti")).toEqual([]); // substring of domestic
  });

  it("allows two edits only on longer terms", () => {
    expect(suggestSiteTerms(SITES, "domestik")).toEqual([{ term: "domestik", word: "domestic" }]);
    expect(suggestSiteTerms(SITES, "dvxx")).toEqual([]); // 2 edits on a 4-char term
  });

  it("caps the suggestions at two", () => {
    const out = suggestSiteTerms(SITES, "svfr icjja restor");
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it("returns nothing for an empty query", () => {
    expect(suggestSiteTerms(SITES, "")).toEqual([]);
  });
});

// ── highlightRanges ───────────────────────────────────────────────────────────
// Maps name-matched terms back onto the RAW filename for <mark> rendering.

describe("highlightRanges", () => {
  it("finds every case-insensitive occurrence of each term", () => {
    expect(highlightRanges("DVFR_Annual_Report_2023.pdf", ["dvfr", "report"]))
      .toEqual([[0, 4], [12, 18]]);
  });

  it("merges overlapping and adjacent term ranges", () => {
    expect(highlightRanges("annual_report.pdf", ["annual", "nual"]))
      .toEqual([[0, 6]]);
  });

  it("returns no range for terms absent from the raw name", () => {
    expect(highlightRanges("biennial-report.pdf", ["dvfr", "report"]))
      .toEqual([[9, 15]]);
  });

  it("handles empty inputs", () => {
    expect(highlightRanges("", ["x"])).toEqual([]);
    expect(highlightRanges("file.pdf", [])).toEqual([]);
  });
});

// ── client embedding ──────────────────────────────────────────────────────────

describe("searchMatchClientSource", () => {
  it("emits every matcher function for the inline <script>", () => {
    const src = searchMatchClientSource();
    for (const name of ["foldSearchText", "squashSearchText", "editDistanceLe", "buildHaystack", "runSearch"]) {
      expect(src).toContain(`function ${name}`);
    }
  });

  it("is self-contained (no module syntax that would break inline)", () => {
    const src = searchMatchClientSource();
    expect(src).not.toMatch(/\bimport\b/);
    expect(src).not.toMatch(/\bexport\b/);
    expect(src).not.toMatch(/\brequire\(/);
  });
});
