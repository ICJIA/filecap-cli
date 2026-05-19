import { describe, expect, it } from "vitest";
import {
  normalizeStem,
  groupByStem,
  classifyOrphans,
} from "../src/report/orphans.js";

describe("normalizeStem", () => {
  it("strips Strapi 10-char hex hash before extension", () => {
    expect(normalizeStem("JAG_FFY_22_5b025d2897.xls")).toEqual({
      stem: "jag_ffy_22",
      extension: "xls",
      stripped: { hash: "5b025d2897" },
    });
  });

  it("recognizes Strapi hash on .pdf", () => {
    expect(normalizeStem("Illinois_JAG_Strategic_Plan_bddaa83079.pdf")).toEqual(
      {
        stem: "illinois_jag_strategic_plan",
        extension: "pdf",
        stripped: { hash: "bddaa83079" },
      },
    );
  });

  it("leaves non-hash trailing digits alone (fiscal-year ambiguity)", () => {
    expect(normalizeStem("JAG_FFY_22.xls")).toEqual({
      stem: "jag_ffy_22",
      extension: "xls",
      stripped: {},
    });
  });

  it("does not treat a 9-char hex run as a Strapi hash", () => {
    expect(normalizeStem("Foo_abcdef012.pdf").stem).toBe("foo_abcdef012");
  });

  it("does not treat 11+ hex chars as a Strapi hash", () => {
    expect(normalizeStem("Foo_abcdef01234.pdf").stem).toBe("foo_abcdef01234");
  });

  it("strips _v\\d+ version suffix", () => {
    expect(normalizeStem("Report_v2.pdf").stem).toBe("report");
    expect(normalizeStem("Report_V12.pdf").stem).toBe("report");
  });

  it("strips -v\\d+ version suffix", () => {
    expect(normalizeStem("plan-v3.docx").stem).toBe("plan");
  });

  it("strips trailing parenthesized number", () => {
    expect(normalizeStem("Notes (1).pdf").stem).toBe("notes");
    expect(normalizeStem("Notes (12).pdf").stem).toBe("notes");
  });

  it("strips macOS copy suffix", () => {
    expect(normalizeStem("Memo copy.pdf").stem).toBe("memo");
    expect(normalizeStem("Memo copy 2.pdf").stem).toBe("memo");
  });

  it("strips multiple consecutive trailing Strapi hashes", () => {
    const r = normalizeStem(
      "Traffic_Data_Agenda_NEW_07_24_24_df57bde328_5bb02ff5b1.pdf",
    );
    expect(r.stem).toBe("traffic_data_agenda_new_07_24_24");
    expect(r.stripped.hash).toBe("5bb02ff5b1");
    expect(r.stripped.priorHashes).toEqual(["df57bde328"]);
  });

  it("strips Strapi hash AND a version marker", () => {
    expect(normalizeStem("Report_v2_5b025d2897.pdf").stem).toBe("report");
  });

  it("lowercases + collapses whitespace", () => {
    expect(normalizeStem("  My  Report  .pdf").stem).toBe("my report");
  });

  it("handles filename with no extension", () => {
    expect(normalizeStem("README").extension).toBe("");
    expect(normalizeStem("README").stem).toBe("readme");
  });

  it("uses the final dot as the extension delimiter", () => {
    expect(normalizeStem("file.name.with.dots.pdf").extension).toBe("pdf");
    expect(normalizeStem("file.name.with.dots.pdf").stem).toBe(
      "file.name.with.dots",
    );
  });
});

describe("groupByStem", () => {
  it("groups files by normalized stem + extension", () => {
    const entries = [
      { filename: "JAG_FFY_22_5b025d2897.xls", references: [] },
      { filename: "JAG_FFY_22_abc1234567.xls", references: [] },
      { filename: "JAG_FFY_12_8a2e0458ec.xls", references: [] },
    ];
    const groups = groupByStem(entries);
    expect(groups.size).toBe(2);
    expect(groups.get("jag_ffy_22.xls")).toHaveLength(2);
    expect(groups.get("jag_ffy_12.xls")).toHaveLength(1);
  });

  it("keeps .xls and .xlsx in distinct groups", () => {
    const entries = [
      { filename: "Report_abc1234567.xls", references: [] },
      { filename: "Report_def4567890.xlsx", references: [] },
    ];
    const groups = groupByStem(entries);
    expect(groups.size).toBe(2);
  });
});

describe("classifyOrphans", () => {
  const NOW = new Date("2026-05-19T18:00:00.000Z");

  it("returns nothing for a fully-referenced fleet", () => {
    const entries = [
      {
        filename: "JAG_FFY_22_5b025d2897.xls",
        modifiedAt: "2026-04-13T00:00:00.000Z",
        references: [{ pageUrl: "https://x" }],
      },
      {
        filename: "JAG_FFY_12_8a2e0458ec.xls",
        modifiedAt: "2021-08-30T00:00:00.000Z",
        references: [{ pageUrl: "https://y" }],
      },
    ];
    expect(classifyOrphans(entries, { now: NOW })).toEqual([]);
  });

  it("classifies a singleton no-refs file as truly-unreferenced", () => {
    const entries = [
      {
        filename: "Lonely.pdf",
        modifiedAt: "2026-05-01T00:00:00.000Z",
        references: [],
      },
    ];
    const result = classifyOrphans(entries, { now: NOW });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("truly-unreferenced");
    expect(result[0].replacedBy).toBeNull();
  });

  it("classifies one orphan as stale-revision when group has a live sibling", () => {
    const entries = [
      {
        filename: "Plan_a1b2c3d4e5.pdf",
        modifiedAt: "2021-01-01T00:00:00.000Z",
        references: [],
      },
      {
        filename: "Plan_f6789abcde.pdf",
        modifiedAt: "2026-04-01T00:00:00.000Z",
        references: [{ pageUrl: "https://x" }],
      },
    ];
    const result = classifyOrphans(entries, { now: NOW });
    expect(result).toHaveLength(1);
    expect(result[0].entry.filename).toBe("Plan_a1b2c3d4e5.pdf");
    expect(result[0].status).toBe("stale-revision");
    expect(result[0].replacedBy).toBe("Plan_f6789abcde.pdf");
    expect(result[0].replacedOn).toBe("2026-04-01T00:00:00.000Z");
    expect(result[0].daysBetween).toBe(1916);
  });

  it("computes a 70-95% confidence that a stale-revision is upgrade-replaced", () => {
    const entries = [
      {
        filename: "Plan_a1b2c3d4e5.pdf",
        modifiedAt: "2021-01-01T00:00:00.000Z",
        references: [],
      },
      {
        filename: "Plan_f6789abcde.pdf",
        modifiedAt: "2026-04-01T00:00:00.000Z",
        references: [{ pageUrl: "https://x" }],
      },
    ];
    const result = classifyOrphans(entries, { now: NOW });
    expect(result[0].replaceabilityConfidence).toBeGreaterThanOrEqual(85);
    expect(result[0].replaceabilityConfidence).toBeLessThanOrEqual(95);
  });

  it("zero confidence when orphan is newer than the referenced sibling", () => {
    const entries = [
      {
        filename: "Plan_1234567890.pdf",
        modifiedAt: "2026-04-01T00:00:00.000Z",
        references: [],
      },
      {
        filename: "Plan_fedcba9876.pdf",
        modifiedAt: "2021-01-01T00:00:00.000Z",
        references: [{ pageUrl: "https://x" }],
      },
    ];
    const result = classifyOrphans(entries, { now: NOW });
    expect(result[0].replaceabilityConfidence).toBe(0);
  });

  it("zero confidence for truly-unreferenced (no upgrade scenario)", () => {
    const entries = [
      { filename: "Lonely.pdf", modifiedAt: "2020-01-01T00:00:00.000Z", references: [] },
    ];
    const result = classifyOrphans(entries, { now: NOW });
    expect(result[0].replaceabilityConfidence).toBe(0);
  });

  it("lowers confidence for same-batch (within 7 days) candidates", () => {
    const sameDay = [
      {
        filename: "Batch_a1b2c3d4e5.pdf",
        modifiedAt: "2026-05-15T10:00:00.000Z",
        references: [],
      },
      {
        filename: "Batch_f6789abcde.pdf",
        modifiedAt: "2026-05-15T11:00:00.000Z",
        references: [{ pageUrl: "https://x" }],
      },
    ];
    const distant = [
      {
        filename: "Plan_a1b2c3d4e5.pdf",
        modifiedAt: "2021-01-01T00:00:00.000Z",
        references: [],
      },
      {
        filename: "Plan_f6789abcde.pdf",
        modifiedAt: "2026-04-01T00:00:00.000Z",
        references: [{ pageUrl: "https://x" }],
      },
    ];
    const sameBatch = classifyOrphans(sameDay, { now: NOW });
    const distantPair = classifyOrphans(distant, { now: NOW });
    expect(sameBatch[0].replaceabilityConfidence).toBeLessThan(
      distantPair[0].replaceabilityConfidence,
    );
  });

  it("flags anomaly when orphan is newer than the referenced sibling", () => {
    const entries = [
      {
        filename: "Plan_1234567890.pdf",
        modifiedAt: "2026-04-01T00:00:00.000Z",
        references: [],
      },
      {
        filename: "Plan_fedcba9876.pdf",
        modifiedAt: "2021-01-01T00:00:00.000Z",
        references: [{ pageUrl: "https://x" }],
      },
    ];
    const result = classifyOrphans(entries, { now: NOW });
    expect(result).toHaveLength(1);
    expect(result[0].reasons).toContain("newer-than-live");
  });

  it("flags older-than-1-year orphans", () => {
    const entries = [
      {
        filename: "Old.pdf",
        modifiedAt: "2020-01-01T00:00:00.000Z",
        references: [],
      },
    ];
    const result = classifyOrphans(entries, { now: NOW });
    expect(result[0].reasons).toContain("older-than-1yr");
    expect(result[0].daysOld).toBeGreaterThan(365);
  });

  it("includes group-siblings count", () => {
    const entries = [
      { filename: "X_a1b2c3d4e5.pdf", modifiedAt: "2020-01-01T00:00:00.000Z", references: [] },
      { filename: "X_b2c3d4e5f6.pdf", modifiedAt: "2021-01-01T00:00:00.000Z", references: [] },
      { filename: "X_c3d4e5f6a7.pdf", modifiedAt: "2026-01-01T00:00:00.000Z", references: [{ pageUrl: "https://x" }] },
    ];
    const result = classifyOrphans(entries, { now: NOW });
    expect(result).toHaveLength(2);
    expect(result[0].groupSize).toBe(3);
    expect(result[1].groupSize).toBe(3);
    expect(result.every((r) => r.replacedBy === "X_c3d4e5f6a7.pdf")).toBe(true);
  });

  it("handles same-day siblings as batch-upload reason", () => {
    const entries = [
      {
        filename: "BatchA_a1b2c3d4e5.pdf",
        modifiedAt: "2026-05-15T10:00:00.000Z",
        references: [],
      },
      {
        filename: "BatchA_b2c3d4e5f6.pdf",
        modifiedAt: "2026-05-15T11:00:00.000Z",
        references: [{ pageUrl: "https://x" }],
      },
    ];
    const result = classifyOrphans(entries, { now: NOW });
    expect(result[0].reasons).toContain("same-batch");
  });

  it("ignores entries without references field (un-resolved)", () => {
    const entries = [
      { filename: "Unknown.pdf", modifiedAt: "2026-01-01T00:00:00.000Z" },
    ];
    expect(classifyOrphans(entries, { now: NOW })).toEqual([]);
  });

  it("treats references: null as not-yet-resolved (skips, does not flag)", () => {
    const entries = [
      {
        filename: "Pending.pdf",
        modifiedAt: "2026-01-01T00:00:00.000Z",
        references: null,
      },
    ];
    expect(classifyOrphans(entries, { now: NOW })).toEqual([]);
  });
});
