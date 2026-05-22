import { describe, it, expect } from "vitest";
import { computeHash, injectPasswordGate } from "../src/web/password-gate.js";
import { generateRobotsTxt } from "../src/web/robots.js";
import { darkModeCss, DESIGN_TOKENS } from "../src/web/styles.js";
import { generateNetlifyToml } from "../src/web/netlify-config.js";

describe("computeHash", () => {
  it("returns a 64-character lowercase hex string", () => {
    const h = computeHash("test");
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  it("matches the known SHA-256 of 'hello'", () => {
    const h = computeHash("hello");
    // SHA-256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(h).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("different passwords produce different hashes", () => {
    expect(computeHash("abc")).not.toBe(computeHash("xyz"));
  });

  it("is deterministic for the same input", () => {
    expect(computeHash("filecap!")).toBe(computeHash("filecap!"));
  });
});

describe("injectPasswordGate", () => {
  const dummyHash = "a".repeat(64);

  it("injects the script right after the <body> tag", () => {
    const html = "<!DOCTYPE html><html><body><p>hello</p></body></html>";
    const out = injectPasswordGate(html, dummyHash);
    // Script must appear between <body> and <p>
    const bodyIdx = out.indexOf("<body>");
    const scriptIdx = out.indexOf("<script>");
    const pIdx = out.indexOf("<p>hello</p>");
    expect(bodyIdx).toBeGreaterThanOrEqual(0);
    expect(scriptIdx).toBeGreaterThan(bodyIdx);
    expect(pIdx).toBeGreaterThan(scriptIdx);
  });

  it("embeds the hex hash inside the script", () => {
    const html = "<html><body></body></html>";
    const out = injectPasswordGate(html, dummyHash);
    expect(out).toContain(dummyHash);
  });

  it("preserves existing body attributes", () => {
    const html = `<html><body class="dark" data-x="1"><p>hi</p></body></html>`;
    const out = injectPasswordGate(html, dummyHash);
    expect(out).toMatch(/<body class="dark" data-x="1"><script>/);
  });

  it("is case-insensitive on <BODY> tag", () => {
    const html = "<HTML><BODY><p>hi</p></BODY></HTML>";
    const out = injectPasswordGate(html, dummyHash);
    expect(out).toContain("<script>");
  });

  it("leaves the rest of the document intact", () => {
    const html = "<html><head><title>t</title></head><body><p>keep</p></body></html>";
    const out = injectPasswordGate(html, dummyHash);
    expect(out).toContain("<title>t</title>");
    expect(out).toContain("<p>keep</p>");
  });
});

describe("generateRobotsTxt", () => {
  it("returns User-agent: * with Disallow: /", () => {
    const txt = generateRobotsTxt();
    expect(txt).toContain("User-agent: *");
    expect(txt).toContain("Disallow: /");
  });

  it("is a non-empty string", () => {
    expect(typeof generateRobotsTxt()).toBe("string");
    expect(generateRobotsTxt().length).toBeGreaterThan(0);
  });
});

describe("darkModeCss", () => {
  it("returns a non-empty string", () => {
    const css = darkModeCss();
    expect(typeof css).toBe("string");
    expect(css.length).toBeGreaterThan(0);
  });

  it("includes CSS custom property declarations", () => {
    const css = darkModeCss();
    expect(css).toContain("--fc-bg-base");
    expect(css).toContain("--fc-accent");
  });
});

describe("DESIGN_TOKENS", () => {
  it("exports bgBase, bgElevated, accent tokens", () => {
    expect(DESIGN_TOKENS.bgBase).toBe("#0d1117");
    expect(DESIGN_TOKENS.bgElevated).toBe("#161b22");
    expect(DESIGN_TOKENS.accent).toBe("#60a5fa");
  });
});

describe("generateNetlifyToml", () => {
  it("returns a non-empty string", () => {
    const toml = generateNetlifyToml();
    expect(typeof toml).toBe("string");
    expect(toml.length).toBeGreaterThan(0);
  });

  it("sets publish dir to '.'", () => {
    const toml = generateNetlifyToml();
    expect(toml).toContain('publish = "."');
  });

  it("has CSV cache-control rule with max-age=3600", () => {
    const toml = generateNetlifyToml();
    expect(toml).toContain('for = "/*.csv"');
    expect(toml).toContain("max-age=3600");
  });

  it("has CSV Content-Disposition: attachment rule", () => {
    const toml = generateNetlifyToml();
    expect(toml).toContain('Content-Disposition = "attachment"');
  });

  it("has HTML cache-control rule with max-age=300", () => {
    const toml = generateNetlifyToml();
    expect(toml).toContain('for = "/*.html"');
    expect(toml).toContain("max-age=300");
  });

  it("has X-Robots-Tag noindex on all files via the /* block (v1.19.0)", () => {
    const toml = generateNetlifyToml();
    expect(toml).toContain('X-Robots-Tag = "noindex, nofollow"');
    // v1.19.0 — the directive lives in the /* catch-all (not just /*.html)
    // so the CSVs and the consolidated NDJSON are noindex too.
    const catchAll = toml.slice(toml.indexOf('for = "/*"'));
    expect(catchAll).toContain('X-Robots-Tag = "noindex, nofollow"');
  });

  it("has security headers on all pages", () => {
    const toml = generateNetlifyToml();
    expect(toml).toContain('X-Frame-Options = "DENY"');
    expect(toml).toContain('X-Content-Type-Options = "nosniff"');
    expect(toml).toContain('Referrer-Policy = "no-referrer"');
  });
});
