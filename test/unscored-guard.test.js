import { describe, it, expect } from "vitest";
import {
  findUnscoredSites,
  unscoredGuardDecision,
  formatUnscoredWarning,
} from "../src/web/unscored-guard.js";

// Shape a siteResults entry the way runWebRollup builds it.
function sr(name, { pdfs = 0, scored = 0, errored = 0, siteName = null } = {}) {
  return {
    site: { name, siteName: siteName ?? name },
    summary: {
      auditedPdfCount: scored,
      auditErrorCount: errored,
      auditPending: Math.max(0, pdfs - scored - errored),
    },
  };
}

describe("findUnscoredSites", () => {
  it("flags a site with PDFs and zero scores", () => {
    const out = findUnscoredSites([sr("agency", { pdfs: 918, scored: 0 })]);
    expect(out).toEqual([{ name: "agency", label: "agency", pdfs: 918 }]);
  });

  it("does not flag a site with no PDFs at all", () => {
    expect(findUnscoredSites([sr("static-site", { pdfs: 0 })])).toEqual([]);
  });

  it("does not flag a site where at least one PDF scored", () => {
    // A partial score is normal — new files land between audit runs.
    expect(findUnscoredSites([sr("dvfr", { pdfs: 68, scored: 1 })])).toEqual([]);
  });

  it("flags a site whose PDFs all ERRORED — an errored PDF carries no grade", () => {
    const out = findUnscoredSites([sr("r3", { pdfs: 10, scored: 0, errored: 10 })]);
    expect(out).toHaveLength(1);
    expect(out[0].pdfs).toBe(10);
  });

  it("prefers the friendly siteName for the label", () => {
    const out = findUnscoredSites([
      sr("icjia-agency-prod", { pdfs: 5, scored: 0, siteName: "ICJIA agency" }),
    ]);
    expect(out[0].label).toBe("ICJIA agency");
    expect(out[0].name).toBe("icjia-agency-prod");
  });

  it("returns every degraded site, skipping the healthy ones", () => {
    const out = findUnscoredSites([
      sr("a", { pdfs: 10, scored: 10 }),
      sr("b", { pdfs: 20, scored: 0 }),
      sr("c", { pdfs: 0 }),
      sr("d", { pdfs: 7, scored: 0 }),
    ]);
    expect(out.map((s) => s.name)).toEqual(["b", "d"]);
  });

  it("tolerates a missing or malformed summary", () => {
    expect(findUnscoredSites([{ site: { name: "x" } }])).toEqual([]);
    expect(findUnscoredSites([])).toEqual([]);
  });
});

describe("unscoredGuardDecision", () => {
  const one = [{ name: "agency", label: "ICJIA agency", pdfs: 918 }];

  it("is silent when nothing is degraded", () => {
    const d = unscoredGuardDecision({ unscored: [], deploy: true, allowUnscored: false });
    expect(d).toEqual({ level: "none", block: false });
  });

  it("warns but does not block a build-only run", () => {
    const d = unscoredGuardDecision({ unscored: one, deploy: false, allowUnscored: false });
    expect(d.level).toBe("warn");
    expect(d.block).toBe(false);
  });

  it("BLOCKS a deploy when a site has no PDF scores", () => {
    const d = unscoredGuardDecision({ unscored: one, deploy: true, allowUnscored: false });
    expect(d.level).toBe("block");
    expect(d.block).toBe(true);
  });

  it("downgrades to a warning when --allow-unscored is passed", () => {
    const d = unscoredGuardDecision({ unscored: one, deploy: true, allowUnscored: true });
    expect(d.level).toBe("warn");
    expect(d.block).toBe(false);
  });
});

describe("formatUnscoredWarning", () => {
  it("names each site with its PDF count and says what to do", () => {
    const msg = formatUnscoredWarning([
      { name: "icjia-agency-prod", label: "ICJIA agency", pdfs: 918 },
      { name: "dvfr-strapi-prod", label: "DVFR", pdfs: 68 },
    ]);
    expect(msg).toContain("2 site(s)");
    expect(msg).toContain("ICJIA agency");
    expect(msg).toContain("918");
    expect(msg).toContain("DVFR");
    expect(msg).toContain("filecap audits");
  });
});
