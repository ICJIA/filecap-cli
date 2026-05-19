import { describe, it, expect } from "vitest";
import {
  buildReverseIndex,
  entryCanonicalUrl,
  resolveEntryReferences,
  buildAliasMap,
} from "../src/references/cross-resolver.js";

const sampleSidecarRecords = [
  {
    siteName: "icjia-agency-prod",
    contentType: "grant",
    entryId: 217,
    slug: "2020-casa",
    pageUrl: "https://icjia.illinois.gov/grants/funding/2020-casa/",
    referencedFiles: [
      "https://archive.icjia-api.cloud/files/icjia/gata/materials/funding/2020-casa/CASANOFO.pdf",
      "https://archive.icjia-api.cloud/files/icjia/gata/materials/funding/2020-casa/CASANOFOZip.zip",
      "https://archive.icjia-api.cloud/files/icjia/gata/materials/funding/2020-casa/NOFOQ&A.pdf",
    ],
  },
  {
    siteName: "icjia-agency-prod",
    contentType: "publication",
    entryId: 4784,
    slug: "2025-ifvcc-strategic-plan-summary",
    pageUrl:
      "https://icjia.illinois.gov/researchhub/articles/2025-ifvcc-strategic-plan-summary/",
    referencedFiles: [
      "https://researchhub.icjia-api.cloud/uploads/2025%20IFVCC%20Strategic%20Plan%20Summary_04242026_Final-260424T14563773.pdf",
    ],
  },
  {
    // Two different content entries reference the SAME PDF — both should
    // surface as separate refs on that PDF's row.
    siteName: "icjia-agency-prod",
    contentType: "post",
    entryId: 102,
    slug: "casa-grant-announcement",
    pageUrl:
      "https://icjia.illinois.gov/news/casa-grant-announcement/",
    referencedFiles: [
      "https://archive.icjia-api.cloud/files/icjia/gata/materials/funding/2020-casa/CASANOFO.pdf",
    ],
  },
];

describe("buildReverseIndex", () => {
  it("returns an empty map for no sidecar records", () => {
    expect(buildReverseIndex([]).size).toBe(0);
  });

  it("maps each referenced file URL to its referrer record(s)", () => {
    const idx = buildReverseIndex(sampleSidecarRecords);
    const casanofo = idx.get(
      "https://archive.icjia-api.cloud/files/icjia/gata/materials/funding/2020-casa/CASANOFO.pdf",
    );
    expect(casanofo).toBeDefined();
    expect(casanofo.length).toBe(2);
    const refSites = casanofo.map((r) => r.contentType).sort();
    expect(refSites).toEqual(["grant", "post"]);
  });

  it("captures all referrer metadata (siteName, contentType, entryId, pageUrl)", () => {
    const idx = buildReverseIndex(sampleSidecarRecords);
    const pub = idx.get(
      "https://researchhub.icjia-api.cloud/uploads/2025%20IFVCC%20Strategic%20Plan%20Summary_04242026_Final-260424T14563773.pdf",
    );
    expect(pub).toEqual([
      {
        siteName: "icjia-agency-prod",
        contentType: "publication",
        entryId: 4784,
        pageUrl:
          "https://icjia.illinois.gov/researchhub/articles/2025-ifvcc-strategic-plan-summary/",
      },
    ]);
  });

  it("canonicalizes URLs before indexing so trailing slashes/case differences collapse to one key", () => {
    const records = [
      {
        siteName: "x",
        contentType: "page",
        entryId: 1,
        pageUrl: "https://x.com/a/",
        referencedFiles: ["https://X.com/foo.pdf/"], // weird capitalization + trailing slash
      },
    ];
    const idx = buildReverseIndex(records);
    // Lowercase host + stripped trailing slash → "https://x.com/foo.pdf"
    expect(idx.has("https://x.com/foo.pdf")).toBe(true);
  });
});

describe("entryCanonicalUrl", () => {
  it("builds a canonical URL from publicUrlBase + entry.path", () => {
    const entry = { path: "icjia/gata/materials/funding/2020-casa/CASANOFO.pdf" };
    expect(
      entryCanonicalUrl(entry, "https://archive.icjia-api.cloud/files"),
    ).toBe(
      "https://archive.icjia-api.cloud/files/icjia/gata/materials/funding/2020-casa/CASANOFO.pdf",
    );
  });

  it("handles trailing slash on base and leading slash on path", () => {
    const entry = { path: "/foo.pdf" };
    expect(entryCanonicalUrl(entry, "https://x.com/uploads/")).toBe(
      "https://x.com/uploads/foo.pdf",
    );
  });

  it("returns null when publicUrlBase is missing", () => {
    expect(entryCanonicalUrl({ path: "foo.pdf" }, "")).toBeNull();
    expect(entryCanonicalUrl({ path: "foo.pdf" }, null)).toBeNull();
  });

  it("returns null when entry.path is missing", () => {
    expect(entryCanonicalUrl({}, "https://x.com/")).toBeNull();
  });
});

describe("resolveEntryReferences", () => {
  const idx = buildReverseIndex(sampleSidecarRecords);

  it("populates entry.references[] with matching referrers", () => {
    const entry = {
      path: "icjia/gata/materials/funding/2020-casa/CASANOFO.pdf",
      filename: "CASANOFO.pdf",
    };
    const resolved = resolveEntryReferences(
      entry,
      "https://archive.icjia-api.cloud/files",
      idx,
    );
    expect(resolved.references).toBeDefined();
    expect(resolved.references.length).toBe(2);
    expect(resolved.references[0].pageUrl).toBe(
      "https://icjia.illinois.gov/grants/funding/2020-casa/",
    );
    expect(resolved.references[1].pageUrl).toBe(
      "https://icjia.illinois.gov/news/casa-grant-announcement/",
    );
  });

  it("sets entry.references = [] when no referrers exist (orphaned file)", () => {
    const entry = { path: "orphan.pdf", filename: "orphan.pdf" };
    const resolved = resolveEntryReferences(
      entry,
      "https://archive.icjia-api.cloud/files",
      idx,
    );
    expect(resolved.references).toEqual([]);
  });

  it("does not mutate the input entry — returns a new object", () => {
    const entry = { path: "foo.pdf" };
    const resolved = resolveEntryReferences(
      entry,
      "https://x.com/",
      new Map(),
    );
    expect(resolved).not.toBe(entry);
    expect(entry.references).toBeUndefined();
  });
});

describe("buildAliasMap", () => {
  it("returns an empty map when no site declares domainAliases", () => {
    const sitesJson = {
      sites: [
        { name: "a", publicUrlBase: "https://a.com/" },
        { name: "b", publicUrlBase: "https://b.com/" },
      ],
    };
    expect(buildAliasMap(sitesJson).size).toBe(0);
  });

  it("maps each alias host → the site's publicUrlBase host (primary)", () => {
    const sitesJson = {
      sites: [
        {
          name: "archive-prod",
          publicUrlBase: "https://archive.icjia.cloud/files",
          domainAliases: ["archive.icjia-api.cloud"],
        },
      ],
    };
    const map = buildAliasMap(sitesJson);
    expect(map.get("archive.icjia-api.cloud")).toBe("archive.icjia.cloud");
  });

  it("normalizes alias and primary hosts to lowercase", () => {
    const sitesJson = {
      sites: [
        {
          name: "x",
          publicUrlBase: "https://EXAMPLE.com/files",
          domainAliases: ["BACKEND.example.com"],
        },
      ],
    };
    const map = buildAliasMap(sitesJson);
    expect(map.get("backend.example.com")).toBe("example.com");
  });
});

describe("alias-aware cross-site matching (v1.8.0)", () => {
  // Real-world scenario: icjia.illinois.gov content references files at
  // archive.icjia-api.cloud (the backend host), but the archive's inventory
  // lives under archive.icjia.cloud (the public host). The two hosts serve
  // the same files. Cross-resolver must collapse them to one canonical key.
  const sidecarRecords = [
    {
      siteName: "icjia-agency-prod",
      contentType: "grant",
      entryId: 217,
      slug: "2020-casa",
      pageUrl: "https://icjia.illinois.gov/grants/funding/2020-casa/",
      referencedFiles: [
        "https://archive.icjia-api.cloud/files/icjia/gata/materials/funding/2020-casa/CASANOFO.pdf",
      ],
    },
  ];
  const aliasMap = new Map([
    ["archive.icjia-api.cloud", "archive.icjia.cloud"],
  ]);

  it("indexes alias URLs under the primary host so archive-inventory entries match", () => {
    const idx = buildReverseIndex(sidecarRecords, aliasMap);
    // Lookup using the archive's primary host (what entryCanonicalUrl will
    // produce when given publicUrlBase = "https://archive.icjia.cloud/files")
    const refs = idx.get(
      "https://archive.icjia.cloud/files/icjia/gata/materials/funding/2020-casa/CASANOFO.pdf",
    );
    expect(refs).toBeDefined();
    expect(refs.length).toBe(1);
    expect(refs[0].pageUrl).toBe(
      "https://icjia.illinois.gov/grants/funding/2020-casa/",
    );
  });

  it("resolveEntryReferences finds the alias-rewritten URL when looking up an archive entry", () => {
    const idx = buildReverseIndex(sidecarRecords, aliasMap);
    const entry = {
      path: "icjia/gata/materials/funding/2020-casa/CASANOFO.pdf",
    };
    const resolved = resolveEntryReferences(
      entry,
      "https://archive.icjia.cloud/files",
      idx,
    );
    expect(resolved.references.length).toBe(1);
  });
});
