import { describe, it, expect } from "vitest";
import { normalizeHost, resolveSite } from "../src/config/resolve-site.js";

// Fixture mirroring the real fleet's shape — note the FOUR apps that share the
// flagship front-end host icjia.illinois.gov but each have a unique file-server
// host (publicUrlBase).
const SITES = [
  { name: "i2i-strapi-prod", siteName: "I2I", siteUrl: "https://i2i.illinois.gov", publicUrlBase: "https://i2i.icjia-api.cloud/uploads" },
  { name: "infonet-strapi-prod", siteName: "InfoNet", siteUrl: "https://infonet.icjia.illinois.gov", publicUrlBase: "https://infonet.icjia-api.cloud/uploads" },
  { name: "icjia-agency-prod", siteName: "Agency", siteUrl: "https://icjia.illinois.gov", publicUrlBase: "https://agency.icjia-api.cloud/uploads" },
  { name: "ilfvcc-api-prod", siteName: "ILFVCC", siteUrl: "https://icjia.illinois.gov", publicUrlBase: "https://ilfamilyviolence.icjia-api.cloud/uploads" },
  { name: "ari-api-prod", siteName: "ARI", siteUrl: "https://icjia.illinois.gov", publicUrlBase: "https://ari.icjia-api.cloud/uploads" },
  { name: "researchhub-prod", siteName: "ResearchHub", siteUrl: "https://icjia.illinois.gov", publicUrlBase: "https://researchhub.icjia-api.cloud/uploads" },
  { name: "archive-prod", siteName: "Archive", siteUrl: "https://archive.icjia.cloud/", publicUrlBase: "https://archive.icjia.cloud/files", domainAliases: ["archive.icjia-api.cloud"] },
];

describe("normalizeHost", () => {
  it("strips scheme, path, query, and trailing slash", () => {
    expect(normalizeHost("https://i2i.illinois.gov/some/path?x=1")).toBe("i2i.illinois.gov");
    expect(normalizeHost("https://archive.icjia.cloud/")).toBe("archive.icjia.cloud");
  });

  it("accepts a bare hostname", () => {
    expect(normalizeHost("i2i.illinois.gov")).toBe("i2i.illinois.gov");
  });

  it("drops a leading www. and a port, and lowercases", () => {
    expect(normalizeHost("WWW.I2I.Illinois.GOV")).toBe("i2i.illinois.gov");
    expect(normalizeHost("https://i2i.illinois.gov:8080/x")).toBe("i2i.illinois.gov");
  });

  it("returns empty string for missing/invalid input", () => {
    expect(normalizeHost("")).toBe("");
    expect(normalizeHost(null)).toBe("");
    expect(normalizeHost(undefined)).toBe("");
  });
});

describe("resolveSite", () => {
  it("matches a unique front-end URL host", () => {
    const r = resolveSite("i2i.illinois.gov", SITES);
    expect(r.status).toBe("match");
    expect(r.site.name).toBe("i2i-strapi-prod");
  });

  it("matches a full URL with scheme and path", () => {
    expect(resolveSite("https://infonet.icjia.illinois.gov/foo", SITES).site.name)
      .toBe("infonet-strapi-prod");
  });

  it("matches a unique file-server host (publicUrlBase)", () => {
    expect(resolveSite("agency.icjia-api.cloud", SITES).site.name).toBe("icjia-agency-prod");
    expect(resolveSite("ari.icjia-api.cloud", SITES).site.name).toBe("ari-api-prod");
  });

  it("matches the internal slug", () => {
    expect(resolveSite("i2i-strapi-prod", SITES).site.name).toBe("i2i-strapi-prod");
  });

  it("matches the nickname case-insensitively", () => {
    expect(resolveSite("infonet", SITES).site.name).toBe("infonet-strapi-prod");
    expect(resolveSite("ARI", SITES).site.name).toBe("ari-api-prod");
  });

  it("matches a domain alias", () => {
    expect(resolveSite("archive.icjia-api.cloud", SITES).site.name).toBe("archive-prod");
  });

  it("returns ambiguous for the shared icjia.illinois.gov front-end host", () => {
    const r = resolveSite("icjia.illinois.gov", SITES);
    expect(r.status).toBe("ambiguous");
    expect(r.sites.map((s) => s.name).sort()).toEqual(
      ["ari-api-prod", "icjia-agency-prod", "ilfvcc-api-prod", "researchhub-prod"],
    );
  });

  it("treats a site matched via two of its own fields as one match, not ambiguous", () => {
    // archive.icjia.cloud is BOTH the siteUrl host and the publicUrlBase host
    const r = resolveSite("archive.icjia.cloud", SITES);
    expect(r.status).toBe("match");
    expect(r.site.name).toBe("archive-prod");
  });

  it("returns none for an unknown query", () => {
    expect(resolveSite("nope.example.com", SITES).status).toBe("none");
    expect(resolveSite("", SITES).status).toBe("none");
  });
});
