import { describe, it, expect } from "vitest";
import { shouldRefresh, uptimeClientScript, UPTIME_TTL_MS } from "../src/web/uptime-client.js";

const H = 3600 * 1000;

// v1.39.0 (E13): the TTL gate reads `fetchedAtMs` (when THIS CLIENT last hit
// the function), not `checkedAtMs` (when the SERVER last probed — that value
// now only feeds the "checked …" label). These tests were updated from the
// old single-field cache shape with that split.
describe("shouldRefresh — the serverless budget gate", () => {
  it("refreshes when there is no cache at all", () => {
    expect(shouldRefresh(null, 0, 6 * H)).toBe(true);
    expect(shouldRefresh(undefined, 0, 6 * H)).toBe(true);
  });

  it("refreshes when the cached timestamp is missing or not a finite number", () => {
    expect(shouldRefresh({}, 0, 6 * H)).toBe(true);
    expect(shouldRefresh({ fetchedAtMs: "nope" }, 0, 6 * H)).toBe(true);
    expect(shouldRefresh({ fetchedAtMs: NaN }, 0, 6 * H)).toBe(true);
    expect(shouldRefresh({ fetchedAtMs: Infinity }, 0, 6 * H)).toBe(true);
  });

  it("treats a pre-v1.39.0 cache (checkedAtMs only, no fetchedAtMs) as stale", () => {
    expect(shouldRefresh({ checkedAtMs: 0 }, 1 * H, 6 * H)).toBe(true);
    expect(shouldRefresh({ checkedAtMs: 1 * H }, 1 * H, 6 * H)).toBe(true);
  });

  it("does NOT refresh inside the TTL window (no network call)", () => {
    expect(shouldRefresh({ fetchedAtMs: 0 }, 1 * H, 6 * H)).toBe(false);
    expect(shouldRefresh({ fetchedAtMs: 0 }, 5 * H + 59 * 60 * 1000, 6 * H)).toBe(false);
  });

  it("refreshes exactly at and after the TTL boundary", () => {
    expect(shouldRefresh({ fetchedAtMs: 0 }, 6 * H, 6 * H)).toBe(true);
    expect(shouldRefresh({ fetchedAtMs: 0 }, 7 * H, 6 * H)).toBe(true);
  });

  it("the gate ignores checkedAtMs entirely (a fresh server probe time cannot suppress the fetch)", () => {
    // Stale fetch, fresh-looking server timestamp → still refresh.
    expect(shouldRefresh({ fetchedAtMs: 0, checkedAtMs: 7 * H }, 7 * H, 6 * H)).toBe(true);
    // Fresh fetch, ancient server timestamp → no refresh.
    expect(shouldRefresh({ fetchedAtMs: 7 * H, checkedAtMs: 0 }, 7 * H + 1, 6 * H)).toBe(false);
  });
});

describe("budget guarantee — fetches are bounded to ~one per TTL no matter how often the page is viewed", () => {
  // Replays the exact client gate over a timeline of page loads, counting how
  // many would hit the function. This is the regression that protects against
  // accidentally going overbudget on serverless.
  function countFetches(loadTimesMs, ttlMs) {
    let cache = null;
    let fetches = 0;
    for (const now of loadTimesMs) {
      if (shouldRefresh(cache, now, ttlMs)) {
        fetches++;
        // v1.39.0: mirrors the client — fetchedAtMs is stamped locally at
        // fetch time; checkedAtMs is whatever the server reported.
        cache = { fetchedAtMs: now, checkedAtMs: now - H, sites: {} };
      }
    }
    return fetches;
  }

  it("100 loads within a single 6h window → exactly 1 fetch", () => {
    const loads = Array.from({ length: 100 }, (_, i) => i * 60 * 1000); // every minute
    expect(countFetches(loads, 6 * H)).toBe(1);
  });

  it("hourly loads across 13 hours → 3 fetches (at 0h, 6h, 12h)", () => {
    const loads = Array.from({ length: 14 }, (_, h) => h * H);
    expect(countFetches(loads, 6 * H)).toBe(3);
  });

  it("a full day of heavy viewing (one load/minute for 24h) stays at 4 fetches", () => {
    const loads = Array.from({ length: 24 * 60 }, (_, i) => i * 60 * 1000);
    expect(countFetches(loads, 6 * H)).toBe(4); // 0h, 6h, 12h, 18h
  });

  it("at 6h, a year of constant 1-minute polling can never exceed ~1,460 fetches", () => {
    const loads = Array.from({ length: 365 * 24 * 60 }, (_, i) => i * 60 * 1000);
    const fetches = countFetches(loads, 6 * H);
    expect(fetches).toBe(365 * 4); // 4/day, every day — far under any quota
  });
});

describe("uptimeClientScript", () => {
  it("defaults to a 6h TTL and the same-origin function endpoint", () => {
    expect(UPTIME_TTL_MS).toBe(6 * H);
    const s = uptimeClientScript();
    expect(s).toContain(String(6 * H));
    expect(s).toContain("/.netlify/functions/uptime");
  });

  it("embeds the tested shouldRefresh gate verbatim, BEFORE the single fetch", () => {
    const s = uptimeClientScript();
    expect(s).toContain("function shouldRefresh");
    // there is exactly ONE fetch in the whole script...
    expect((s.match(/fetch\(/g) || []).length).toBe(1);
    // ...and the gate's early-return precedes it, so an out-of-window load never fetches
    const gateAt = s.indexOf("shouldRefresh(cache,Date.now(),TTL))return");
    const fetchAt = s.indexOf("fetch(EP");
    expect(gateAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(gateAt);
  });

  it("is same-origin only — no cross-origin URL that would need a CSP change", () => {
    expect(uptimeClientScript()).not.toMatch(/https?:\/\//);
  });

  // v1.39.0 (E13) — the "checked …" label keeps the SERVER's probe time
  // (checkedAtMs, edge-cached responses report when the probe actually ran);
  // the client stamps its own fetchedAtMs solely for the 6h TTL gate.
  it("stamps fetchedAtMs for the TTL gate and never overwrites the server's checkedAtMs", () => {
    const s = uptimeClientScript();
    expect(s).toContain("data.fetchedAtMs=Date.now()");
    expect(s).not.toContain("data.checkedAtMs=Date.now()");
    // the label still reads the server-reported probe time
    expect(s).toContain("data.checkedAtMs?fmtChecked(data.checkedAtMs)");
  });
});
