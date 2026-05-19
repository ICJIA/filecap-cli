import { describe, it, expect } from "vitest";
import {
  buildFleetDomainSet,
  isFleetUrl,
} from "../src/references/domain-filter.js";

const fixtureSitesJson = {
  version: 1,
  sites: [
    {
      name: "icjia-agency-prod",
      publicUrlBase: "https://agency.icjia-api.cloud/uploads",
      siteUrl: "https://icjia.illinois.gov/",
    },
    {
      name: "researchhub-prod",
      publicUrlBase: "https://researchhub.icjia-api.cloud/uploads",
      siteUrl: "https://icjia.illinois.gov/researchhub/",
    },
    {
      name: "archive-prod",
      publicUrlBase: "https://archive.icjia.cloud/files",
      siteUrl: "https://archive.icjia.cloud/",
      domainAliases: ["archive.icjia-api.cloud"],
    },
    {
      name: "vpp-git",
      publicUrlBase: "https://vpp.icjia.illinois.gov",
      siteUrl: "https://vpp.illinois.gov/",
    },
  ],
};

describe("buildFleetDomainSet", () => {
  it("returns an empty set for sites.json with no sites", () => {
    const set = buildFleetDomainSet({ version: 1, sites: [] });
    expect(set.size).toBe(0);
  });

  it("collects hostnames from publicUrlBase and siteUrl across all sites", () => {
    const set = buildFleetDomainSet(fixtureSitesJson);
    expect(set.has("agency.icjia-api.cloud")).toBe(true);
    expect(set.has("icjia.illinois.gov")).toBe(true);
    expect(set.has("researchhub.icjia-api.cloud")).toBe(true);
    expect(set.has("archive.icjia.cloud")).toBe(true);
    expect(set.has("vpp.icjia.illinois.gov")).toBe(true);
    expect(set.has("vpp.illinois.gov")).toBe(true);
  });

  it("includes domainAliases when declared on a site", () => {
    const set = buildFleetDomainSet(fixtureSitesJson);
    expect(set.has("archive.icjia-api.cloud")).toBe(true);
  });

  it("normalizes hostnames to lowercase", () => {
    const sj = {
      version: 1,
      sites: [
        {
          name: "x",
          publicUrlBase: "https://EXAMPLE.com/uploads",
          siteUrl: "https://EXAMPLE.com/",
        },
      ],
    };
    const set = buildFleetDomainSet(sj);
    expect(set.has("example.com")).toBe(true);
    expect(set.has("EXAMPLE.com")).toBe(false);
  });

  it("skips malformed URL fields without throwing", () => {
    const sj = {
      version: 1,
      sites: [
        { name: "ok", publicUrlBase: "https://x.com/" },
        { name: "bad", publicUrlBase: "not-a-url" },
        { name: "missing", siteUrl: "" },
      ],
    };
    const set = buildFleetDomainSet(sj);
    expect(set.has("x.com")).toBe(true);
    expect(set.size).toBe(1);
  });
});

describe("isFleetUrl", () => {
  const set = buildFleetDomainSet(fixtureSitesJson);

  it("returns true for URLs whose host is in the fleet set", () => {
    expect(
      isFleetUrl("https://agency.icjia-api.cloud/uploads/foo.pdf", set),
    ).toBe(true);
    expect(
      isFleetUrl(
        "https://archive.icjia-api.cloud/files/icjia/foo.pdf",
        set,
      ),
    ).toBe(true);
    expect(
      isFleetUrl(
        "https://researchhub.icjia-api.cloud/uploads/report.pdf",
        set,
      ),
    ).toBe(true);
    expect(
      isFleetUrl(
        "https://icjia.illinois.gov/grants/funding/2020-casa/",
        set,
      ),
    ).toBe(true);
  });

  it("returns false for URLs not in the fleet set", () => {
    expect(isFleetUrl("https://www.justice.gov/foo.pdf", set)).toBe(false);
    expect(isFleetUrl("https://www.youtube.com/watch?v=abc", set)).toBe(false);
    expect(
      isFleetUrl("https://icjia.az1.qualtrics.com/jfe/form/X", set),
    ).toBe(false);
    expect(isFleetUrl("https://bjapmt.ojp.gov/foo.pdf", set)).toBe(false);
  });

  it("returns false for invalid or non-absolute URLs", () => {
    expect(isFleetUrl("/uploads/foo.pdf", set)).toBe(false);
    expect(isFleetUrl("not-a-url", set)).toBe(false);
    expect(isFleetUrl("", set)).toBe(false);
    expect(isFleetUrl(null, set)).toBe(false);
  });

  it("matches host case-insensitively", () => {
    expect(
      isFleetUrl("https://AGENCY.icjia-api.CLOUD/uploads/foo.pdf", set),
    ).toBe(true);
  });

  it("does not match unrelated subdomains that share a parent domain", () => {
    // someone.icjia-api.cloud is NOT in the fleet (only specific subdomains are)
    expect(
      isFleetUrl(
        "https://malicious-impostor.icjia-api.cloud/foo.pdf",
        set,
      ),
    ).toBe(false);
  });
});
