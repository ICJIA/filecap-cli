import { describe, it, expect } from "vitest";
import { computeHash, injectPasswordGate } from "../src/web/password-gate.js";

// v1.40.0 — first tests for the gate module. The module's own docstring is
// clear that this is "ward off the curious" security (unsalted SHA-256,
// crackable offline; the real gate is Netlify Site Password) — these tests
// pin that the plaintext never reaches the page and the injection is sound.

describe("computeHash", () => {
  it("returns lowercase sha256 hex", () => {
    expect(computeHash("Password1")).toMatch(/^[0-9a-f]{64}$/);
    // known vector
    expect(computeHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("injectPasswordGate", () => {
  const page = `<!doctype html><html><head><title>t</title></head><body class="x"><main id="main">hello</main></body></html>`;

  it("embeds only the hash — never the plaintext", () => {
    const hash = computeHash("SuperSecret9");
    const out = injectPasswordGate(page, hash);
    expect(out).toContain(`const expected = "${hash}"`);
    expect(out).not.toContain("SuperSecret9");
  });

  it("injects immediately after the opening <body> tag, preserving attributes and content", () => {
    const out = injectPasswordGate(page, computeHash("x"));
    expect(out).toMatch(/<body class="x"><script>/);
    expect(out).toContain('<main id="main">hello</main>');
  });

  it("gates via sessionStorage so same-session navigation does not re-prompt", () => {
    const out = injectPasswordGate(page, computeHash("x"));
    expect(out).toContain('sessionStorage.getItem("fc-pw")');
    expect(out).toContain('sessionStorage.setItem("fc-pw", h)');
  });

  it("adds exactly one well-formed gate script (hash is hex-only, so no premature </script> risk)", () => {
    const out = injectPasswordGate(page, computeHash("x"));
    const opens = (out.match(/<script>/g) || []).length;
    const closes = (out.match(/<\/script>/g) || []).length;
    expect(opens).toBe(1);
    expect(closes).toBe(1);
    expect(out.indexOf("</script>")).toBeLessThan(out.indexOf("<main"));
  });
});
