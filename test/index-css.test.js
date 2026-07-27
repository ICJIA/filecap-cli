import { describe, it, expect } from "vitest";
import { INDEX_CSS } from "../src/web/index-css.js";

// v1.40.0 — mobile-overflow regression guards. At a real 390px viewport the
// layout viewport expanded to 477px (clipping the hero H1 mid-word) because
// several grids carried min-content floors wider than a phone: any track spec
// like `minmax(360px, 1fr)` or bare `1fr` (= minmax(auto, 1fr)) refuses to
// shrink below its floor, main (a column-flexbox item via the shared footer
// CSS) then grows to fit, and mobile browsers widen the whole layout viewport.
describe("INDEX_CSS mobile-width safety (v1.40.0)", () => {
  it("lets the explainer grids collapse below 360px", () => {
    expect(INDEX_CSS).not.toMatch(/minmax\(360px, 1fr\)/);
    const occurrences = INDEX_CSS.match(/minmax\(min\(360px, 100%\), 1fr\)/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2); // .explanation-grid + .by-type-grid
  });

  it("lets the card stat tiles shrink below their label width", () => {
    expect(INDEX_CSS).toMatch(/\.site-card \.nums \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  });

  it("keeps the two-across site grid free of min-content floors", () => {
    expect(INDEX_CSS).toMatch(/\.site-grid \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(INDEX_CSS).toMatch(/@media \(max-width: 820px\) \{\s*\.site-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  });
});

describe("INDEX_CSS sort-button contrast (v1.40.0)", () => {
  it("keeps white text ≥4.5:1 on the active button's hover state", () => {
    // #2c7eff was 3.83:1 against white — under the WCAG AA floor.
    expect(INDEX_CSS).not.toContain("#2c7eff");
    expect(INDEX_CSS).toContain("#2563eb"); // 5.17:1 with white
  });

  it("darkens (not lightens) the active glyph pill so the ★ stays ≥4.5:1", () => {
    // rgba(255,255,255,0.18) over #1f6feb blended to #4789ee → 3.45:1 with white.
    expect(INDEX_CSS).toMatch(/\.sort-btn\[aria-pressed="true"\] \.sort-btn-glyph \{[^}]*rgba\(0, ?0, ?0, ?0\.25\)/);
  });
});
