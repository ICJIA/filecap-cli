import { describe, it, expect } from "vitest";
import { probeReachability, generateUptimeFunction } from "../src/web/uptime-function.js";

describe("probeReachability", () => {
  it("returns 'live' when the server answers (any status, including a gated 401)", async () => {
    expect(await probeReachability("https://x", async () => ({ ok: true, status: 200 }), 1000)).toBe("live");
    expect(await probeReachability("https://x", async () => ({ ok: false, status: 401 }), 1000)).toBe("live");
  });

  it("returns 'down' on a network error / abort", async () => {
    expect(await probeReachability("https://x", async () => { throw new Error("ECONNREFUSED"); }, 1000)).toBe("down");
  });

  it("returns 'down' when the response is null/undefined", async () => {
    expect(await probeReachability("https://x", async () => null, 1000)).toBe("down");
  });
});

describe("generateUptimeFunction", () => {
  const targets = [
    { key: "dvfr-strapi-prod", url: "https://dvfr.icjia.illinois.gov" },
    { key: "squish", url: "https://squish.icjia.app" },
  ];
  const src = generateUptimeFunction(targets, { ttlSeconds: 21600 });

  it("bakes the targets in", () => {
    expect(src).toContain('"key":"dvfr-strapi-prod"');
    expect(src).toContain("https://dvfr.icjia.illinois.gov");
    expect(src).toContain('"key":"squish"');
  });

  it("sets a 6h browser + durable edge cache so the probes run at most ~once per window", () => {
    expect(src).toContain("cache-control");
    expect(src).toContain("max-age=21600");
    // the durable edge cache is the abuse cap — repeated hits don't re-run the probes
    expect(src).toContain("netlify-cdn-cache-control");
    expect(src).toContain("durable");
    expect(src).toContain("s-maxage=21600");
  });

  it("rejects non-GET (no method-based cache-busting / abuse path)", () => {
    expect(src).toContain('req.method !== "GET"');
    expect(src).toContain("405");
  });

  it("embeds the tested probe and is a Netlify v2 default-export handler", () => {
    expect(src).toContain("async function probeReachability");
    expect(src).toContain("export default async function");
    expect(src).toContain("new Response(");
  });

  it("defaults the per-site timeout (bounded work per invocation)", () => {
    expect(generateUptimeFunction(targets)).toContain("const TIMEOUT_MS = 8000;");
  });
});
