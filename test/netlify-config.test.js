import { describe, it, expect } from "vitest";
import {
  generateNetlifyToml,
  generateNetlifyHeaders,
  generateNetlifyRedirects,
} from "../src/web/netlify-config.js";

// v1.40.0 — this module emits every security header the deployed bundle has.
// It had zero tests: a silent regression here would drop the CSP / clickjack /
// sniffing protections from the live site with nothing failing.

// The one CSP. `connect-src 'self'` is load-bearing: the uptime widget works
// only because its function is same-origin at /.netlify/functions/uptime.
const CSP =
  "default-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; upgrade-insecure-requests";

describe("generateNetlifyHeaders (_headers — the copy manual deploys actually honor)", () => {
  const out = generateNetlifyHeaders();

  it("applies to every path", () => {
    expect(out).toMatch(/^\/\*$/m);
  });

  it("emits the full security-header set", () => {
    expect(out).toContain("X-Robots-Tag: noindex, nofollow");
    expect(out).toContain("X-Frame-Options: DENY");
    expect(out).toContain("X-Content-Type-Options: nosniff");
    expect(out).toContain("Referrer-Policy: no-referrer");
    expect(out).toContain(`Content-Security-Policy: ${CSP}`);
  });
});

describe("generateNetlifyToml", () => {
  const toml = generateNetlifyToml();

  it("keeps its CSP byte-identical to the _headers copy (they must never drift)", () => {
    expect(toml).toContain(`Content-Security-Policy = "${CSP}"`);
  });

  it("forces spreadsheet downloads instead of in-browser rendering", () => {
    expect(toml).toMatch(/\/\*\.xlsx[\s\S]*?Content-Disposition = "attachment"/);
  });
});

describe("the two copies stay in sync", () => {
  it("every header name in _headers also appears in netlify.toml", () => {
    const headers = generateNetlifyHeaders();
    const toml = generateNetlifyToml();
    const names = [...headers.matchAll(/^ {2}([A-Za-z-]+):/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThanOrEqual(5);
    for (const name of names) {
      expect(toml, `${name} missing from netlify.toml`).toContain(name);
    }
  });
});

describe("generateNetlifyRedirects", () => {
  it("aliases lowercase and extension-less variants of each report", () => {
    const out = generateNetlifyRedirects([
      { htmlFile: "DVFR-20260702-1200Z.html" },
    ]);
    expect(out).toContain("/DVFR-20260702-1200Z.html");
    expect(out).toContain("/dvfr-20260702-1200z");
  });

  // v1.50.1 — the canonical URL is fleet.icjia.app. Netlify serves the old
  // *.netlify.app hostname directly (observed 2026-08-17: password page,
  // no redirect), so without this rule old bookmarks stay on the old host
  // forever. Must be the FIRST rule — Netlify's _redirects is first-match —
  // and force (301!) so it fires even though every file exists at the old
  // host too.
  it("force-301s the old netlify.app host to the canonical fleet.icjia.app domain, as the first rule", () => {
    const out = generateNetlifyRedirects([{ htmlFile: "DVFR-20260702-1200Z.html" }]);
    const rules = out.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    expect(rules[0]).toBe(
      "https://icjia-fleet-audit.netlify.app/* https://fleet.icjia.app/:splat 301!",
    );
    // The per-report aliases still follow.
    expect(out).toContain("/DVFR-20260702-1200Z.html");
  });
});
