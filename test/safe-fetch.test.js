import { describe, it, expect } from "vitest";
import {
  isBlockedAddress,
  isBlockedHost,
  assertSafeUrl,
  safeFetch,
} from "../src/util/safe-fetch.js";

describe("isBlockedAddress", () => {
  it("blocks IPv4 loopback (127.0.0.0/8)", () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("127.9.9.9")).toBe(true);
  });

  it("blocks the cloud metadata address and the rest of link-local (169.254.0.0/16)", () => {
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
    expect(isBlockedAddress("169.254.0.1")).toBe(true);
  });

  it("blocks RFC1918 private ranges", () => {
    expect(isBlockedAddress("10.0.0.5")).toBe(true);
    expect(isBlockedAddress("172.16.0.1")).toBe(true);
    expect(isBlockedAddress("172.31.255.255")).toBe(true);
    expect(isBlockedAddress("192.168.1.1")).toBe(true);
  });

  it("blocks 0.0.0.0/8 and CGNAT 100.64.0.0/10", () => {
    expect(isBlockedAddress("0.0.0.0")).toBe(true);
    expect(isBlockedAddress("100.64.0.1")).toBe(true);
  });

  it("blocks IPv6 loopback, unspecified, ULA, and link-local", () => {
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("::")).toBe(true);
    expect(isBlockedAddress("fd00::1")).toBe(true);
    expect(isBlockedAddress("fe80::1")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 that wraps a private address", () => {
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:169.254.169.254")).toBe(true);
  });

  it("allows genuine public addresses", () => {
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
    expect(isBlockedAddress("172.15.0.1")).toBe(false); // just below 172.16/12
    expect(isBlockedAddress("172.32.0.1")).toBe(false); // just above
  });
});

describe("isBlockedHost", () => {
  it("blocks localhost and its subdomains and .local names", () => {
    expect(isBlockedHost("localhost")).toBe(true);
    expect(isBlockedHost("db.localhost")).toBe(true);
    expect(isBlockedHost("printer.local")).toBe(true);
  });

  it("blocks a literal private/metadata IP given as the host", () => {
    expect(isBlockedHost("169.254.169.254")).toBe(true);
    expect(isBlockedHost("127.0.0.1")).toBe(true);
  });

  it("allows ordinary public hostnames (resolution is not this function's job)", () => {
    expect(isBlockedHost("icjia.illinois.gov")).toBe(false);
    expect(isBlockedHost("example.com")).toBe(false);
  });
});

describe("assertSafeUrl", () => {
  it("throws on a non-http(s) scheme", () => {
    expect(() => assertSafeUrl("file:///etc/passwd")).toThrow(/blocked/i);
    expect(() => assertSafeUrl("gopher://x/")).toThrow(/blocked/i);
  });

  it("throws on a private/metadata host", () => {
    expect(() => assertSafeUrl("http://169.254.169.254/latest/meta-data/")).toThrow(/blocked/i);
    expect(() => assertSafeUrl("http://127.0.0.1:6379/")).toThrow(/blocked/i);
  });

  it("returns the parsed URL for a safe public target", () => {
    const u = assertSafeUrl("https://icjia.illinois.gov/sitemap.xml");
    expect(u.hostname).toBe("icjia.illinois.gov");
  });
});

describe("safeFetch", () => {
  it("refuses a blocked host without ever calling fetchImpl", async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return { ok: true };
    };
    await expect(
      safeFetch("http://169.254.169.254/latest/meta-data/", { fetchImpl }),
    ).rejects.toThrow(/blocked/i);
    expect(called).toBe(false);
  });

  it("fetches a safe host with redirect set to manual so undici cannot auto-chase into a private IP", async () => {
    let seenInit = null;
    const fetchImpl = async (_url, init) => {
      seenInit = init;
      return { ok: true, status: 200 };
    };
    const res = await safeFetch("https://icjia.illinois.gov/sitemap.xml", { fetchImpl });
    expect(res.ok).toBe(true);
    expect(seenInit.redirect).toBe("manual");
  });

  it("issues exactly one request and does not follow a 3xx redirect itself", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return { ok: false, status: 302, headers: { get: () => "http://169.254.169.254/" } };
    };
    const res = await safeFetch("https://public.example/sitemap.xml", { fetchImpl });
    expect(calls).toBe(1);
    expect(res.status).toBe(302);
  });
});
