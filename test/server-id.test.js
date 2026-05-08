import { describe, it, expect } from "vitest";
import { getHostname, getFirstIPv4 } from "../src/util/server-id.js";

describe("getHostname", () => {
  it("returns a non-empty string", () => {
    const hostname = getHostname();
    expect(hostname).toBeTypeOf("string");
    expect(hostname.length).toBeGreaterThan(0);
  });
});

describe("getFirstIPv4", () => {
  it("returns either an IPv4 string or empty string when no non-loopback interface exists", () => {
    const ip = getFirstIPv4();
    expect(ip).toBeTypeOf("string");
    if (ip !== "") {
      // Basic IPv4 shape check; we don't assert specific bytes since
      // it's host-dependent.
      expect(ip).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
    }
  });

  it("never returns a loopback address", () => {
    const ip = getFirstIPv4();
    expect(ip).not.toBe("127.0.0.1");
  });
});
