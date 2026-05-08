import { describe, it, expect } from "vitest";
import { pickCanonical } from "../src/rollup/canonical.js";

function entry(serverName, path, modifiedAt) {
  return { serverName, path, modifiedAt };
}

describe("pickCanonical", () => {
  it("returns the only entry when given a single entry", () => {
    const e = entry("a", "x.pdf", "2024-01-01T00:00:00.000Z");
    expect(pickCanonical([e])).toBe(e);
  });

  it("picks the oldest modifiedAt when entries differ in time", () => {
    const older = entry("b", "x.pdf", "2024-01-01T00:00:00.000Z");
    const newer = entry("a", "x.pdf", "2024-08-01T00:00:00.000Z");
    expect(pickCanonical([newer, older])).toBe(older);
    expect(pickCanonical([older, newer])).toBe(older);
  });

  it("breaks ties alphabetically by serverName when modifiedAt matches", () => {
    const ts = "2024-01-01T00:00:00.000Z";
    const a = entry("alpha", "x.pdf", ts);
    const b = entry("bravo", "x.pdf", ts);
    expect(pickCanonical([b, a])).toBe(a);
    expect(pickCanonical([a, b])).toBe(a);
  });

  it("handles three-way ties on modifiedAt", () => {
    const ts = "2024-01-01T00:00:00.000Z";
    const a = entry("alpha", "x.pdf", ts);
    const b = entry("bravo", "x.pdf", ts);
    const c = entry("charlie", "x.pdf", ts);
    expect(pickCanonical([c, a, b])).toBe(a);
  });

  it("throws on an empty input array", () => {
    expect(() => pickCanonical([])).toThrow();
  });
});
