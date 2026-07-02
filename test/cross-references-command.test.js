import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runCrossReferences } from "../src/commands/cross-references.js";

// v1.39.0 (B8) — command-level coverage for the resolver contract: entries
// whose public URL cannot be built (no publicUrlBase anywhere) must pass
// through WITHOUT a references field (orphans.js treats absent = not
// resolved = skip), instead of references: [] (= "confirmed orphan").

async function writeLines(filepath, lines) {
  await fs.writeFile(filepath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

function makeSidecarRecord(fileUrl) {
  return {
    siteName: "icjia-agency-prod",
    contentType: "grant",
    entryId: 1,
    slug: "g",
    pageUrl: "https://icjia.illinois.gov/grants/g/",
    referencedFiles: [fileUrl],
  };
}

describe("runCrossReferences (B8: unresolvable base)", () => {
  it("passes entries through without a references field when the header has no publicUrlBase", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-xref-"));
    const sidecarPath = path.join(tmp, "refs.ndjson");
    const inventoryPath = path.join(tmp, "inventory.ndjson");
    const outputPath = path.join(tmp, "out.ndjson");
    await writeLines(sidecarPath, [
      makeSidecarRecord("https://x.com/files/a.pdf"),
    ]);
    await writeLines(inventoryPath, [
      { kind: "filecap-inventory-header", metadata: {} }, // no publicUrlBase
      { path: "a.pdf", filename: "a.pdf" },
      { kind: "filecap-inventory-footer" },
    ]);

    const result = await runCrossReferences({
      inventoryPath,
      sidecarPaths: [sidecarPath],
      sitesJson: { sites: [] },
      outputPath,
      log: () => {},
    });

    const lines = (await fs.readFile(outputPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const entry = lines.find((l) => l.filename === "a.pdf");
    expect(entry).toBeDefined();
    expect("references" in entry).toBe(false);
    expect(result.matchedCount).toBe(0);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("still attaches references (or []) when the base resolves", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-xref-"));
    const sidecarPath = path.join(tmp, "refs.ndjson");
    const inventoryPath = path.join(tmp, "inventory.ndjson");
    const outputPath = path.join(tmp, "out.ndjson");
    await writeLines(sidecarPath, [
      makeSidecarRecord("https://x.com/files/a.pdf"),
    ]);
    await writeLines(inventoryPath, [
      {
        kind: "filecap-inventory-header",
        metadata: { publicUrlBase: "https://x.com/files" },
      },
      { path: "a.pdf", filename: "a.pdf" },
      { path: "orphan.pdf", filename: "orphan.pdf" },
      { kind: "filecap-inventory-footer" },
    ]);

    const result = await runCrossReferences({
      inventoryPath,
      sidecarPaths: [sidecarPath],
      sitesJson: { sites: [] },
      outputPath,
      log: () => {},
    });

    const lines = (await fs.readFile(outputPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const matched = lines.find((l) => l.filename === "a.pdf");
    const orphan = lines.find((l) => l.filename === "orphan.pdf");
    expect(matched.references.length).toBe(1);
    expect(matched.references[0].pageUrl).toBe(
      "https://icjia.illinois.gov/grants/g/",
    );
    expect(orphan.references).toEqual([]);
    expect(result.matchedCount).toBe(1);
    expect(result.augmentedCount).toBe(2);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("consolidated inventory: a source without publicUrlBase yields no references field for its entries", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-xref-"));
    const sidecarPath = path.join(tmp, "refs.ndjson");
    const inventoryPath = path.join(tmp, "inventory.ndjson");
    const outputPath = path.join(tmp, "out.ndjson");
    await writeLines(sidecarPath, [
      makeSidecarRecord("https://a.com/files/a.pdf"),
    ]);
    await writeLines(inventoryPath, [
      {
        kind: "filecap-consolidated-header",
        metadata: {
          sources: [
            { serverName: "site-a", publicUrlBase: "https://a.com/files" },
            { serverName: "site-b", publicUrlBase: "" },
          ],
        },
      },
      { serverName: "site-a", path: "a.pdf", filename: "a.pdf" },
      { serverName: "site-b", path: "b.pdf", filename: "b.pdf" },
      { kind: "filecap-consolidated-footer" },
    ]);

    await runCrossReferences({
      inventoryPath,
      sidecarPaths: [sidecarPath],
      sitesJson: { sites: [] },
      outputPath,
      log: () => {},
    });

    const lines = (await fs.readFile(outputPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const a = lines.find((l) => l.filename === "a.pdf");
    const b = lines.find((l) => l.filename === "b.pdf");
    expect(a.references.length).toBe(1);
    expect("references" in b).toBe(false);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
