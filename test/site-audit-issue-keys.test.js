import { describe, it, expect } from "vitest";
import { issueKey, collectIssueKeys, diffIssueSets } from "../src/site-audit/issue-keys.js";

describe("issueKey", () => {
  it("is deterministic and stable across trailing-slash / case URL variants", () => {
    const a = issueKey("https://x.com/About/", "color-contrast", ["main h1"]);
    const b = issueKey("https://x.com/about", "color-contrast", ["main h1"]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
  });
  it("differs by rule and by target", () => {
    const base = issueKey("https://x.com/p", "image-alt", ["img.logo"]);
    expect(base).not.toBe(issueKey("https://x.com/p", "color-contrast", ["img.logo"]));
    expect(base).not.toBe(issueKey("https://x.com/p", "image-alt", ["img.hero"]));
  });
});

describe("collectIssueKeys", () => {
  it("yields one deduped sorted key per (page, rule, node)", () => {
    const pages = [
      { pageUrl: "https://x.com/a", violations: [
        { id: "image-alt", nodes: [{ target: ["img.logo"] }, { target: ["img.hero"] }] },
      ] },
      { pageUrl: "https://x.com/b", violations: [
        { id: "image-alt", nodes: [{ target: ["img.logo"] }] },
      ] },
    ];
    const keys = collectIssueKeys(pages);
    expect(keys).toHaveLength(3);
    expect([...keys]).toEqual([...keys].sort());
  });
  it("handles a violation with no nodes without throwing", () => {
    const keys = collectIssueKeys([{ pageUrl: "https://x.com/a", violations: [{ id: "region", nodes: [] }] }]);
    expect(keys).toHaveLength(1);
  });
});

describe("diffIssueSets", () => {
  it("computes fixed / introduced / stillOpen", () => {
    const prev = ["k1", "k2", "k3"];
    const curr = ["k2", "k3", "k4", "k5"];
    expect(diffIssueSets(prev, curr)).toEqual({ fixed: 1, introduced: 2, stillOpen: 2 });
  });
  it("treats a null prior as all-introduced", () => {
    expect(diffIssueSets(null, ["k1", "k2"])).toEqual({ fixed: 0, introduced: 2, stillOpen: 0 });
  });
});
