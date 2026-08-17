import { describe, it, expect } from "vitest";
import {
  findUnscoredSites,
  unscoredGuardDecision,
  formatUnscoredWarning,
} from "../src/web/unscored-guard.js";

// Shape a siteResults entry the way runWebRollup builds it.
function sr(name, { docs = 0, scored = 0, errored = 0, siteName = null } = {}) {
  return {
    site: { name, siteName: siteName ?? name },
    summary: {
      auditedDocCount: scored,
      auditErrorCount: errored,
      auditPending: Math.max(0, docs - scored - errored),
    },
  };
}

describe("findUnscoredSites", () => {
  it("flags a site with documents and zero scores", () => {
    const out = findUnscoredSites([sr("agency", { docs: 918, scored: 0 })]);
    expect(out).toEqual([{ name: "agency", label: "agency", docs: 918 }]);
  });

  it("does not flag a site with no documents at all", () => {
    expect(findUnscoredSites([sr("static-site", { docs: 0 })])).toEqual([]);
  });

  it("does not flag a site where at least one document scored", () => {
    // A partial score is normal — new files land between audit runs.
    expect(findUnscoredSites([sr("dvfr", { docs: 68, scored: 1 })])).toEqual([]);
  });

  it("flags a site whose documents all ERRORED — an errored document carries no grade", () => {
    const out = findUnscoredSites([sr("r3", { docs: 10, scored: 0, errored: 10 })]);
    expect(out).toHaveLength(1);
    expect(out[0].docs).toBe(10);
  });

  it("prefers the friendly siteName for the label", () => {
    const out = findUnscoredSites([
      sr("icjia-agency-prod", { docs: 5, scored: 0, siteName: "ICJIA agency" }),
    ]);
    expect(out[0].label).toBe("ICJIA agency");
    expect(out[0].name).toBe("icjia-agency-prod");
  });

  it("returns every degraded site, skipping the healthy ones", () => {
    const out = findUnscoredSites([
      sr("a", { docs: 10, scored: 10 }),
      sr("b", { docs: 20, scored: 0 }),
      sr("c", { docs: 0 }),
      sr("d", { docs: 7, scored: 0 }),
    ]);
    expect(out.map((s) => s.name)).toEqual(["b", "d"]);
  });

  it("tolerates a missing or malformed summary", () => {
    expect(findUnscoredSites([{ site: { name: "x" } }])).toEqual([]);
    expect(findUnscoredSites([])).toEqual([]);
  });
});

describe("unscoredGuardDecision", () => {
  const one = [{ name: "agency", label: "ICJIA agency", docs: 918 }];

  it("is silent when nothing is degraded", () => {
    const d = unscoredGuardDecision({ unscored: [], deploy: true, allowUnscored: false });
    expect(d).toEqual({ level: "none", block: false });
  });

  it("warns but does not block a build-only run", () => {
    const d = unscoredGuardDecision({ unscored: one, deploy: false, allowUnscored: false });
    expect(d.level).toBe("warn");
    expect(d.block).toBe(false);
  });

  it("BLOCKS a deploy when a site has no document scores", () => {
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
  it("names each site with its document count and says what to do", () => {
    const msg = formatUnscoredWarning([
      { name: "icjia-agency-prod", label: "ICJIA agency", docs: 918 },
      { name: "dvfr-strapi-prod", label: "DVFR", docs: 68 },
    ]);
    expect(msg).toContain("2 site(s)");
    expect(msg).toContain("ICJIA agency");
    expect(msg).toContain("918 documents, 0 scored");
    expect(msg).toContain("DVFR");
    expect(msg).toContain("have scoreable documents but NO");
    expect(msg).toContain("filecap audits");
  });
});
