import { describe, it, expect } from "vitest";
import { createPageProbe, readsAsNoindex } from "../src/site-audit/page-probe.js";

const res = ({ status = 200, headers = {}, body = "" }) => ({
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => body,
});

describe("readsAsNoindex", () => {
  it("detects the robots meta tag", () => {
    expect(readsAsNoindex('<meta name="robots" content="noindex, nofollow">', null)).toBe(true);
    expect(readsAsNoindex('<META NAME=ROBOTS CONTENT="NOINDEX">', null)).toBe(true);
  });

  it("detects the X-Robots-Tag header", () => {
    expect(readsAsNoindex("", "noindex, nofollow")).toBe(true);
  });

  it("does not fire on an indexable page", () => {
    expect(readsAsNoindex('<meta name="robots" content="index, follow">', null)).toBe(false);
    expect(readsAsNoindex("<html><body>hi</body></html>", null)).toBe(false);
  });

  it("does not fire on the word noindex in ordinary content", () => {
    expect(readsAsNoindex("<p>We discussed noindex at the meeting.</p>", null)).toBe(false);
  });
});

describe("createPageProbe", () => {
  it("does NOT follow redirects — the whole point of the check", async () => {
    let seenInit;
    const probe = createPageProbe({
      fetchImpl: async (_u, init) => { seenInit = init; return res({ status: 301, headers: { location: "/councils/" } }); },
    });
    const r = await probe("https://x.gov/counties/marshall/");
    expect(seenInit.redirect).toBe("manual");
    expect(r.status).toBe(301);
    expect(r.location).toBe("/councils/");
  });

  it("reports an indexable 200", async () => {
    const probe = createPageProbe({
      fetchImpl: async () => res({ status: 200, body: "<html><body>real content</body></html>" }),
    });
    expect(await probe("https://x.gov/a/")).toMatchObject({ status: 200, indexable: true });
  });

  it("reports a noindex 200 as not indexable", async () => {
    const probe = createPageProbe({
      fetchImpl: async () => res({ status: 200, body: '<meta name="robots" content="noindex">' }),
    });
    expect(await probe("https://x.gov/tabs/dv/")).toMatchObject({ status: 200, indexable: false });
  });

  it("honours X-Robots-Tag without reading the body", async () => {
    const probe = createPageProbe({
      fetchImpl: async () => res({ status: 200, headers: { "x-robots-tag": "noindex" } }),
    });
    expect(await probe("https://x.gov/a/")).toMatchObject({ indexable: false });
  });

  it("reports a 404 without needing a body", async () => {
    const probe = createPageProbe({ fetchImpl: async () => res({ status: 404 }) });
    expect(await probe("https://x.gov/gone/")).toMatchObject({ status: 404 });
  });

  it("surfaces a network failure as a null status, not a verdict", async () => {
    const probe = createPageProbe({ fetchImpl: async () => { throw new Error("ETIMEDOUT"); } });
    const r = await probe("https://x.gov/a/");
    expect(r.status).toBeNull();
    expect(r.error).toMatch(/ETIMEDOUT/);
  });
});
