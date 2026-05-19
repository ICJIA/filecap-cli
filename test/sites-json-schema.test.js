import { describe, it, expect } from "vitest";
import { siteEntrySchema } from "../src/commands/web-rollup.js";

// FC-2026-030 (1.8.0-beta.3): the `references.graphqlEndpoint` and
// `references.restApiBase` fields must be http(s) URLs. Anything else is
// rejected at schema load time so a malicious or accidentally-misconfigured
// sites.json bundle can't redirect the references command at file://,
// javascript:, or bare-host SSRF targets.

const validRefs = (overrides = {}) => ({
  strategy: "strapi-v4",
  graphqlEndpoint: "https://api.example.com/graphql",
  restApiBase: "https://api.example.com",
  ...overrides,
});

const validSite = (refsOverrides = {}) => ({
  name: "test-site",
  publicUrlBase: "https://api.example.com/uploads",
  references: validRefs(refsOverrides),
});

describe("siteEntrySchema references endpoint URL validation (FC-2026-030)", () => {
  it("accepts https:// for graphqlEndpoint + restApiBase", () => {
    expect(() => siteEntrySchema.parse(validSite())).not.toThrow();
  });

  it("accepts http:// for graphqlEndpoint + restApiBase (legacy / internal)", () => {
    expect(() => siteEntrySchema.parse(validSite({
      graphqlEndpoint: "http://internal-strapi.local/graphql",
      restApiBase: "http://internal-strapi.local",
    }))).not.toThrow();
  });

  it("rejects file:// in graphqlEndpoint", () => {
    expect(() => siteEntrySchema.parse(validSite({
      graphqlEndpoint: "file:///etc/passwd",
    }))).toThrow(/graphqlEndpoint/);
  });

  it("rejects javascript: in graphqlEndpoint", () => {
    expect(() => siteEntrySchema.parse(validSite({
      graphqlEndpoint: "javascript:alert(1)",
    }))).toThrow(/graphqlEndpoint/);
  });

  it("rejects bare host (no scheme) in graphqlEndpoint", () => {
    expect(() => siteEntrySchema.parse(validSite({
      graphqlEndpoint: "localhost:8080/graphql",
    }))).toThrow(/graphqlEndpoint/);
  });

  it("rejects file:// in restApiBase", () => {
    expect(() => siteEntrySchema.parse(validSite({
      restApiBase: "file:///",
    }))).toThrow(/restApiBase/);
  });

  it("rejects ws:// (non-http(s)) in restApiBase", () => {
    expect(() => siteEntrySchema.parse(validSite({
      restApiBase: "ws://api.example.com",
    }))).toThrow(/restApiBase/);
  });

  it("rejects malformed URL in graphqlEndpoint", () => {
    expect(() => siteEntrySchema.parse(validSite({
      graphqlEndpoint: "not a url at all",
    }))).toThrow(/graphqlEndpoint/);
  });

  it("accepts a fully-valid v3 references block too", () => {
    expect(() =>
      siteEntrySchema.parse(validSite({ strategy: "strapi-v3" })),
    ).not.toThrow();
  });
});
