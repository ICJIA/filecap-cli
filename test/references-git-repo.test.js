import { describe, it, expect } from "vitest";
import {
  deriveContentUrl,
  extractMarkdownEntries,
} from "../src/references/git-repo.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// --- deriveContentUrl ---
//
// Nuxt Content (Nuxt 2 + 3) maps content/<rest>.md → /<rest>; index.md is
// the root /. Subdirectories nest. Files under directories starting with
// "_" are hidden in Nuxt Content; we still emit a record with pageUrl null
// so the references are captured but no deployed URL is claimed.

describe("deriveContentUrl", () => {
  it("maps content/index.md to the site root /", () => {
    expect(deriveContentUrl("content/index.md", "https://vpp.illinois.gov"))
      .toBe("https://vpp.illinois.gov/");
  });

  it("maps content/foo.md to /foo", () => {
    expect(deriveContentUrl("content/contact.md", "https://vpp.illinois.gov"))
      .toBe("https://vpp.illinois.gov/contact");
  });

  it("maps content/foo/bar.md to /foo/bar", () => {
    expect(deriveContentUrl("content/plan/overview.md", "https://vpp.illinois.gov"))
      .toBe("https://vpp.illinois.gov/plan/overview");
  });

  it("maps content/legal/index.md to /legal", () => {
    expect(deriveContentUrl("content/legal/index.md", "https://vpp.illinois.gov"))
      .toBe("https://vpp.illinois.gov/legal");
  });

  it("trims trailing slash on site frontend URL", () => {
    expect(deriveContentUrl("content/foo.md", "https://vpp.illinois.gov/"))
      .toBe("https://vpp.illinois.gov/foo");
  });

  it("returns null for files under a _hidden directory", () => {
    expect(deriveContentUrl("content/_drafts/foo.md", "https://vpp.illinois.gov"))
      .toBeNull();
  });

  it("returns null when not a markdown file", () => {
    expect(deriveContentUrl("content/foo.vue", "https://vpp.illinois.gov"))
      .toBeNull();
  });

  it("returns null when path is outside content/", () => {
    expect(deriveContentUrl("docs/foo.md", "https://vpp.illinois.gov"))
      .toBeNull();
  });

  it("handles backslash-separated paths (Windows-style) by normalising", () => {
    expect(deriveContentUrl("content\\plan\\overview.md", "https://vpp.illinois.gov"))
      .toBe("https://vpp.illinois.gov/plan/overview");
  });

  // v1.29.0 — Astro layout (SFS): content lives under src/content/, and the
  // "pages" collection routes to the site root (src/pages/[slug].astro does
  // getCollection("pages")). Other collections keep their segment.
  describe("Astro src/content/ support (v1.29.0)", () => {
    it("maps src/content/pages/about.md to /about (pages collection → root)", () => {
      expect(deriveContentUrl("src/content/pages/about.md", "https://sfs.icjia.illinois.gov"))
        .toBe("https://sfs.icjia.illinois.gov/about");
    });

    it("maps src/content/pages/index.md to the site root /", () => {
      expect(deriveContentUrl("src/content/pages/index.md", "https://sfs.icjia.illinois.gov"))
        .toBe("https://sfs.icjia.illinois.gov/");
    });

    it("keeps non-pages collection segments (src/content/docs/setup.md → /docs/setup)", () => {
      expect(deriveContentUrl("src/content/docs/setup.md", "https://sfs.icjia.illinois.gov"))
        .toBe("https://sfs.icjia.illinois.gov/docs/setup");
    });

    it("does NOT strip a pages/ segment under the Nuxt content/ root", () => {
      expect(deriveContentUrl("content/pages/foo.md", "https://vpp.illinois.gov"))
        .toBe("https://vpp.illinois.gov/pages/foo");
    });
  });
});

// --- extractMarkdownEntries ---
//
// Given a local repo directory, walk content/ for markdown, extract file URLs
// from each, return one record per file with referencedFiles. Designed to
// run against a real (small) directory tree — we set up a tmpdir per test.

describe("extractMarkdownEntries", () => {
  async function makeTempRepo(layout) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-gitrepo-test-"));
    for (const [relPath, content] of Object.entries(layout)) {
      const abs = path.join(tmp, relPath);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content);
    }
    return tmp;
  }

  it("extracts file URLs from markdown body content", async () => {
    const tmp = await makeTempRepo({
      "content/index.md": "Welcome.\n\n[Download](https://vpp.icjia.illinois.gov/files/welcome.pdf)\n",
      "content/contact.md": "Contact us at [our office](https://vpp.icjia.illinois.gov/files/contact-info.docx)\n",
    });
    const entries = await extractMarkdownEntries(tmp, "https://vpp.illinois.gov");
    expect(entries).toHaveLength(2);
    const byPath = Object.fromEntries(entries.map((e) => [e.slug, e]));
    expect(byPath["content/index.md"].referencedFiles).toEqual([
      "https://vpp.icjia.illinois.gov/files/welcome.pdf",
    ]);
    expect(byPath["content/index.md"].pageUrl).toBe("https://vpp.illinois.gov/");
    expect(byPath["content/contact.md"].referencedFiles).toEqual([
      "https://vpp.icjia.illinois.gov/files/contact-info.docx",
    ]);
    expect(byPath["content/contact.md"].pageUrl).toBe("https://vpp.illinois.gov/contact");
  });

  it("emits a record for files with no extractable URLs (empty referencedFiles)", async () => {
    const tmp = await makeTempRepo({
      "content/index.md": "Welcome. No files here.\n",
    });
    const entries = await extractMarkdownEntries(tmp, "https://vpp.illinois.gov");
    expect(entries).toHaveLength(1);
    expect(entries[0].referencedFiles).toEqual([]);
  });

  it("walks nested directories", async () => {
    const tmp = await makeTempRepo({
      "content/plan/overview.md": "See [doc](https://vpp.icjia.illinois.gov/files/plan-overview.pdf)\n",
      "content/legal/index.md": "[Privacy](https://vpp.icjia.illinois.gov/files/privacy.pdf)\n",
    });
    const entries = await extractMarkdownEntries(tmp, "https://vpp.illinois.gov");
    expect(entries).toHaveLength(2);
    const slugs = entries.map((e) => e.slug).sort();
    expect(slugs).toEqual(["content/legal/index.md", "content/plan/overview.md"]);
  });

  it("ignores non-markdown files in content/", async () => {
    const tmp = await makeTempRepo({
      "content/index.md": "[A](https://x.com/a.pdf)\n",
      "content/styles.css": "body { color: red; }",
      "content/data.json": '{"foo":"bar"}',
    });
    const entries = await extractMarkdownEntries(tmp, "https://vpp.illinois.gov");
    expect(entries).toHaveLength(1);
    expect(entries[0].slug).toBe("content/index.md");
  });

  it("returns empty array when there is no content/ directory", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-gitrepo-test-"));
    const entries = await extractMarkdownEntries(tmp, "https://vpp.illinois.gov");
    expect(entries).toEqual([]);
  });

  it("dedupes URLs that appear multiple times in one file", async () => {
    const tmp = await makeTempRepo({
      "content/index.md": "[a](https://x.com/foo.pdf) and [also](https://x.com/foo.pdf) plus [c](https://x.com/foo.pdf)",
    });
    const entries = await extractMarkdownEntries(tmp, "https://vpp.illinois.gov");
    expect(entries[0].referencedFiles).toEqual(["https://x.com/foo.pdf"]);
  });

  // v1.29.0 — the two extraction gaps that hid VPP's and SFS's files.
  it("resolves root-relative markdown links against the site frontend URL (VPP case)", async () => {
    const tmp = await makeTempRepo({
      "content/download.md":
        "Download [the full plan](/files/Full_Report_Statewide_Violence_Prevention_Plan_2025-2029.pdf) here.\n",
    });
    const entries = await extractMarkdownEntries(tmp, "https://vpp.icjia.illinois.gov");
    expect(entries[0].referencedFiles).toEqual([
      "https://vpp.icjia.illinois.gov/files/Full_Report_Statewide_Violence_Prevention_Plan_2025-2029.pdf",
    ]);
  });

  it("walks Astro's src/content/ when there is no top-level content/ (SFS case)", async () => {
    const tmp = await makeTempRepo({
      "src/content/pages/resources.md":
        "Use [the intake form](/QuickStart_PartOne_NavIntakeBIF.pdf) and [the protocol](https://agency.icjia-api.cloud/uploads/SFS_Evaluation_Protocol.docx).\n",
    });
    const entries = await extractMarkdownEntries(tmp, "https://sfs.icjia.illinois.gov");
    expect(entries).toHaveLength(1);
    expect(entries[0].slug).toBe("src/content/pages/resources.md");
    expect(entries[0].pageUrl).toBe("https://sfs.icjia.illinois.gov/resources");
    expect(entries[0].referencedFiles).toEqual([
      "https://agency.icjia-api.cloud/uploads/SFS_Evaluation_Protocol.docx",
      "https://sfs.icjia.illinois.gov/QuickStart_PartOne_NavIntakeBIF.pdf",
    ]);
  });

  it("walks BOTH roots when a repo has content/ and src/content/", async () => {
    const tmp = await makeTempRepo({
      "content/index.md": "[a](https://x.com/a.pdf)\n",
      "src/content/pages/b.md": "[b](https://x.com/b.pdf)\n",
    });
    const entries = await extractMarkdownEntries(tmp, "https://x.gov");
    const slugs = entries.map((e) => e.slug).sort();
    expect(slugs).toEqual(["content/index.md", "src/content/pages/b.md"]);
  });

  // v1.29.0 — page templates. SFS's only real file links live in
  // src/pages/research.astro hrefs (verified 2026-06-11); Astro and Nuxt
  // route page templates by file path, so the page URL is derivable the
  // same way as content markdown.
  describe("page templates (.astro / .vue)", () => {
    it("extracts hrefs from src/pages/*.astro with file-based routing (SFS case)", async () => {
      const tmp = await makeTempRepo({
        "src/pages/research.astro": `---
const title = "Research";
---
<a href="https://agency.icjia-api.cloud/uploads/SFS_Evaluation_Protocol.docx">protocol</a>
<a href="/QuickStart_PartOne_NavIntakeBIF.pdf" target="_blank">quickstart</a>
`,
      });
      const entries = await extractMarkdownEntries(tmp, "https://sfs.icjia.illinois.gov");
      expect(entries).toHaveLength(1);
      expect(entries[0].contentType).toBe("template");
      expect(entries[0].pageUrl).toBe("https://sfs.icjia.illinois.gov/research");
      expect(entries[0].referencedFiles).toEqual([
        "https://agency.icjia-api.cloud/uploads/SFS_Evaluation_Protocol.docx",
        "https://sfs.icjia.illinois.gov/QuickStart_PartOne_NavIntakeBIF.pdf",
      ]);
    });

    it("maps index templates to the root and skips dynamic-segment templates", async () => {
      const tmp = await makeTempRepo({
        "src/pages/index.astro": `<a href="/welcome.pdf">w</a>`,
        "src/pages/[slug].astro": `<a href="/never.pdf">n</a>`,
        "pages/about.vue": `<template><a href="/about.pdf">a</a></template>`,
      });
      const entries = await extractMarkdownEntries(tmp, "https://x.gov");
      const byUrl = Object.fromEntries(entries.map((e) => [e.pageUrl, e]));
      expect(byUrl["https://x.gov/"].referencedFiles).toEqual(["https://x.gov/welcome.pdf"]);
      expect(byUrl["https://x.gov/about"].referencedFiles).toEqual(["https://x.gov/about.pdf"]);
      expect(entries.some((e) => e.slug.includes("[slug]"))).toBe(false);
    });

    it("emits no template record when a template links no files", async () => {
      const tmp = await makeTempRepo({
        "src/pages/contact.astro": `<p>No downloads here.</p>`,
      });
      const entries = await extractMarkdownEntries(tmp, "https://x.gov");
      expect(entries).toEqual([]);
    });
  });
});
