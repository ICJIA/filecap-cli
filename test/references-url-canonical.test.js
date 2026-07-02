import { describe, it, expect } from "vitest";
import { canonicalizeUrl } from "../src/references/url-canonical.js";

describe("canonicalizeUrl", () => {
  it("returns a basic https URL unchanged", () => {
    expect(canonicalizeUrl("https://example.com/foo/bar.pdf")).toBe(
      "https://example.com/foo/bar.pdf",
    );
  });

  it("lowercases the hostname", () => {
    expect(canonicalizeUrl("https://EXAMPLE.com/foo.pdf")).toBe(
      "https://example.com/foo.pdf",
    );
    expect(canonicalizeUrl("https://Agency.ICJIA-API.cloud/uploads/x.pdf")).toBe(
      "https://agency.icjia-api.cloud/uploads/x.pdf",
    );
  });

  it("strips trailing slash on non-root paths", () => {
    expect(canonicalizeUrl("https://x.com/foo/")).toBe("https://x.com/foo");
    expect(canonicalizeUrl("https://x.com/foo/bar/")).toBe(
      "https://x.com/foo/bar",
    );
  });

  it("preserves the root slash", () => {
    expect(canonicalizeUrl("https://x.com/")).toBe("https://x.com/");
  });

  it("drops the fragment", () => {
    expect(canonicalizeUrl("https://x.com/foo.pdf#page=5")).toBe(
      "https://x.com/foo.pdf",
    );
  });

  // v1.39.0 (B3) — query strings are stripped: uploads/files never vary by
  // query, and the reference side carries cache-busters ("?v=2") that made
  // the same file produce two different keys (false orphan).
  it("strips the query string so cache-busted references match the bare key", () => {
    expect(canonicalizeUrl("https://x.com/foo.pdf?v=2")).toBe(
      "https://x.com/foo.pdf",
    );
    expect(canonicalizeUrl("https://x.com/foo.pdf?v=2")).toBe(
      canonicalizeUrl("https://x.com/foo.pdf"),
    );
    expect(canonicalizeUrl("https://x.com/foo.pdf?v=2&token=abc")).toBe(
      "https://x.com/foo.pdf",
    );
  });

  // v1.39.0 (B3) — percent-encoding hex case is normalized to uppercase so
  // "%2f" and "%2F" collapse to one key.
  it("uppercases percent-encoding hex digits in the path", () => {
    expect(canonicalizeUrl("https://x.com/a%2fb.pdf")).toBe(
      "https://x.com/a%2Fb.pdf",
    );
    expect(canonicalizeUrl("https://x.com/a%2fb.pdf")).toBe(
      canonicalizeUrl("https://x.com/a%2Fb.pdf"),
    );
    // Mixed-case hex in a real-shaped upload path
    expect(
      canonicalizeUrl("https://archive.icjia-api.cloud/files/a%3fb%20c.pdf"),
    ).toBe("https://archive.icjia-api.cloud/files/a%3Fb%20c.pdf");
  });

  it("preserves percent-encoded path segments verbatim", () => {
    expect(
      canonicalizeUrl(
        "https://archive.icjia-api.cloud/files/icjia/pdf/compiler/Authority%20Endorses%20Proposed%20CHRI%20Act.pdf",
      ),
    ).toBe(
      "https://archive.icjia-api.cloud/files/icjia/pdf/compiler/Authority%20Endorses%20Proposed%20CHRI%20Act.pdf",
    );
  });

  it("returns null for non-absolute URLs", () => {
    expect(canonicalizeUrl("/uploads/foo.pdf")).toBeNull();
    expect(canonicalizeUrl("foo.pdf")).toBeNull();
    expect(canonicalizeUrl("")).toBeNull();
  });

  it("returns null for malformed inputs", () => {
    expect(canonicalizeUrl("not a url")).toBeNull();
    expect(canonicalizeUrl(null)).toBeNull();
    expect(canonicalizeUrl(undefined)).toBeNull();
  });

  it("is idempotent — re-canonicalizing a canonical URL returns the same value", () => {
    const inputs = [
      "https://example.com/foo/bar.pdf",
      "https://x.com/",
      "https://x.com/foo.pdf?v=2",
    ];
    for (const u of inputs) {
      expect(canonicalizeUrl(canonicalizeUrl(u))).toBe(canonicalizeUrl(u));
    }
  });
});
