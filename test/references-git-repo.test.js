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
});
