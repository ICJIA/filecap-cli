import { describe, it, expect } from "vitest";
import { wcagLevelForTags } from "../src/site-audit/wcag.js";

describe("wcagLevelForTags", () => {
  it("maps AA tags to AA", () => {
    expect(wcagLevelForTags(["cat.color", "wcag2aa", "wcag143"])).toBe("AA");
  });
  it("maps level-A tags to A (most basic level present wins)", () => {
    expect(wcagLevelForTags(["wcag2a", "wcag111"])).toBe("A");
    expect(wcagLevelForTags(["wcag2a", "wcag2aa"])).toBe("A");
  });
  it("recognises 2.1 / 2.2 variants", () => {
    expect(wcagLevelForTags(["wcag21aa"])).toBe("AA");
    expect(wcagLevelForTags(["wcag22a"])).toBe("A");
    expect(wcagLevelForTags(["wcag2aaa"])).toBe("AAA");
  });
  it("falls back to best-practice with no success-criterion tag", () => {
    expect(wcagLevelForTags(["cat.semantics", "best-practice"])).toBe("best-practice");
    expect(wcagLevelForTags([])).toBe("best-practice");
    expect(wcagLevelForTags(undefined)).toBe("best-practice");
  });
});
