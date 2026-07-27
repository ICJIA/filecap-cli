import { describe, it, expect } from "vitest";
import { escapeHtml, safeUrl, safeUrlNormalized } from "../src/util/html.js";

// v1.40.0 — the one shared implementation. Before this module the same escape
// function lived under five names in five files (he / htmlEscape ×2 / esc ×2),
// and safeUrl existed twice with different normalization semantics.
describe("escapeHtml", () => {
  it("escapes all five HTML-special characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("renders a hostile filename inert", () => {
    expect(escapeHtml('<script>alert(1)</script>.pdf')).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;.pdf",
    );
  });

  it("returns empty string for null/undefined and stringifies everything else", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(0)).toBe("0");
    expect(escapeHtml(42)).toBe("42");
  });

  it("escapes ampersands first (no double-escaping)", () => {
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });
});

describe("safeUrl (returns the ORIGINAL string)", () => {
  it("passes http/https through untouched", () => {
    expect(safeUrl("https://example.org/a b")).toBe("https://example.org/a b");
    expect(safeUrl("http://example.org")).toBe("http://example.org");
  });

  it("rejects javascript:, data:, and unparseable values", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
    expect(safeUrl("")).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });
});

describe("safeUrlNormalized (returns URL.toString())", () => {
  it("normalizes — the orphans page depends on percent-encoding to resolve files", () => {
    expect(safeUrlNormalized("https://example.org/a b")).toBe("https://example.org/a%20b");
    expect(safeUrlNormalized("https://example.org")).toBe("https://example.org/");
  });

  it("accepts only strings and only http/https", () => {
    expect(safeUrlNormalized(["https://example.org"])).toBeNull();
    expect(safeUrlNormalized("ftp://example.org")).toBeNull();
    expect(safeUrlNormalized(null)).toBeNull();
  });
});
