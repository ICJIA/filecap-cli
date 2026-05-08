# filecap Phase 5 — Multi-Server Rollup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@icjia/filecap@0.5.0` — replace the `filecap rollup` stub with a working command that merges multiple per-server NDJSON inventories into a consolidated NDJSON. Content-duplicate detection via SHA-256 with `duplicateOf` linking, cross-instance stats in the footer.

**Architecture:** Pure-JS streaming using Node's built-in `readline`. Read each input NDJSON line-by-line, collect all entries, group by SHA-256, designate canonical (oldest `modifiedAt`, alphabetical tiebreaker on `serverName`), then stream-write the consolidated header → entries (with `duplicateOf` set on non-canonical) → footer. No new deps.

**Tech Stack:** Node 20+, ESM. Reuses Phase 1's NDJSON streaming machinery and existing Zod schemas.

**Out of scope for Phase 5:** Report (Phase 6), MCP (Phase 7), Strapi (Phase 8). Rollup is purely an inventory-to-inventory transformation.

---

## File Structure

```
filecap-cli/
├── src/
│   ├── commands/
│   │   └── rollup.js                     ← create
│   ├── rollup/
│   │   ├── merge.js                      ← create (core merge logic)
│   │   └── canonical.js                  ← create (oldest-mtime canonical pick)
│   ├── schema/
│   │   └── inventory.js                  ← modify (consolidated schemas)
│   └── index.js                          ← modify (re-exports)
├── bin/
│   └── filecap.js                        ← modify (replace rollup stub)
├── test/
│   ├── rollup-canonical.test.js          ← create
│   ├── rollup-merge.test.js              ← create
│   ├── rollup.test.js                    ← create (E2E CLI)
│   └── schema.test.js                    ← modify (consolidated schemas)
├── README.md                             ← modify (Phase 5 status, examples)
└── CHANGELOG.md                          ← modify ([0.5.0] entry)
```

---

## Task 1 — Schemas for consolidated NDJSON

**Files:**
- Modify: `src/schema/inventory.js`
- Modify: `test/schema.test.js`

- [ ] **Step 1.1: Write failing tests in `test/schema.test.js`**

Append INSIDE the existing `describe("inventory schemas", ...)` block, BEFORE its closing `});`:

```js
  it("validates a consolidated header with sources array", () => {
    const header = {
      schemaVersion: 1,
      kind: "filecap-consolidated-header",
      metadata: {
        consolidatedAt: "2026-05-08T15:00:00.000Z",
        filecapVersion: "0.5.0",
        nodeVersion: "v20.11.1",
        sources: [
          {
            serverName: "strapi-prod-01",
            hostname: "strapi-prod-01.icjia.local",
            serverIp: "10.42.7.18",
            scannedPath: "/var/strapi/uploads",
            scannedAt: "2026-05-08T14:23:11.000Z",
            filecapVersion: "0.4.0",
            nodeVersion: "v20.11.1",
            options: {
              introspect: true,
              hash: true,
              maxIntrospectMb: 200,
              concurrency: 4,
            },
            stats: {
              fileCount: 100,
              totalBytes: 1024000,
              scanDurationMs: 5000,
              introspectionFailures: 0,
              permissionDenials: 0,
            },
          },
        ],
      },
    };
    expect(() => consolidatedHeaderSchema.parse(header)).not.toThrow();
  });

  it("validates a consolidated entry with serverName and duplicateOf null", () => {
    const entry = {
      path: "case.pdf",
      absolutePath: "/var/strapi/uploads/case.pdf",
      filename: "case.pdf",
      extension: "pdf",
      category: "pdf",
      remediable: true,
      sizeBytes: 1024,
      modifiedAt: "2024-01-01T00:00:00.000Z",
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      flags: [],
      serverName: "strapi-prod-01",
      duplicateOf: null,
    };
    expect(() => consolidatedEntrySchema.parse(entry)).not.toThrow();
  });

  it("validates a consolidated entry with duplicateOf set", () => {
    const entry = {
      path: "case-copy.pdf",
      absolutePath: "/var/strapi/uploads/archive/case-copy.pdf",
      filename: "case-copy.pdf",
      extension: "pdf",
      category: "pdf",
      remediable: true,
      sizeBytes: 1024,
      modifiedAt: "2024-08-01T00:00:00.000Z",
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      flags: [],
      serverName: "strapi-prod-02",
      duplicateOf: {
        serverName: "strapi-prod-01",
        path: "case.pdf",
      },
    };
    expect(() => consolidatedEntrySchema.parse(entry)).not.toThrow();
  });

  it("validates a consolidated footer with cross-instance stats", () => {
    const footer = {
      kind: "filecap-consolidated-footer",
      stats: {
        fileCount: 1500,
        totalBytes: 1500000000,
        consolidationDurationMs: 200,
        totalUniqueHashes: 1200,
        totalDuplicateGroups: 50,
        bytesSavedIfDeduped: 100000000,
      },
    };
    expect(() => consolidatedFooterSchema.parse(footer)).not.toThrow();
  });

  it("rejects a consolidated entry without serverName", () => {
    const entry = {
      path: "case.pdf",
      absolutePath: "/x/case.pdf",
      filename: "case.pdf",
      extension: "pdf",
      category: "pdf",
      remediable: true,
      sizeBytes: 1024,
      modifiedAt: "2024-01-01T00:00:00.000Z",
      sha256: "",
      flags: [],
      duplicateOf: null,
    };
    expect(() => consolidatedEntrySchema.parse(entry)).toThrow();
  });
```

Update the existing import at the top of `test/schema.test.js`:

```js
import {
  headerSchema,
  entrySchema,
  footerSchema,
  isCompleteInventory,
  pdfIntrospectionSchema,
  docxIntrospectionSchema,
  xlsxIntrospectionSchema,
  legacyOfficeIntrospectionSchema,
  consolidatedHeaderSchema,
  consolidatedEntrySchema,
  consolidatedFooterSchema,
  SCHEMA_VERSION,
} from "../src/schema/inventory.js";
```

- [ ] **Step 1.2: Run tests, verify failure**

```bash
cd /Volumes/satechi/webdev/filecap-cli
npx vitest run test/schema.test.js
```

Expected: 5 new tests fail.

- [ ] **Step 1.3: Implement schemas in `src/schema/inventory.js`**

Read `src/schema/inventory.js` first. After the existing `headerSchema` definition (and BEFORE `categoryEnum`), add the source-block schema and consolidated header:

```js
const sourceBlockSchema = z.object({
  serverName: z.string(),
  hostname: z.string(),
  serverIp: z.string(),
  scannedPath: z.string(),
  scannedAt: isoDate,
  filecapVersion: z.string(),
  nodeVersion: z.string(),
  options: optionsSchema,
  stats: z.object({
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    scanDurationMs: z.number().int().nonnegative(),
    introspectionFailures: z.number().int().nonnegative(),
    permissionDenials: z.number().int().nonnegative(),
  }),
});

export const consolidatedHeaderSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  kind: z.literal("filecap-consolidated-header"),
  metadata: z.object({
    consolidatedAt: isoDate,
    filecapVersion: z.string(),
    nodeVersion: z.string(),
    sources: z.array(sourceBlockSchema),
  }),
});
```

After `entrySchema`, add the consolidated entry schema:

```js
export const consolidatedEntrySchema = entrySchema.extend({
  serverName: z.string(),
  duplicateOf: z
    .object({
      serverName: z.string(),
      path: z.string(),
    })
    .nullable(),
});
```

After `footerSchema`, add the consolidated footer schema:

```js
export const consolidatedFooterSchema = z.object({
  kind: z.literal("filecap-consolidated-footer"),
  stats: z.object({
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    consolidationDurationMs: z.number().int().nonnegative(),
    totalUniqueHashes: z.number().int().nonnegative(),
    totalDuplicateGroups: z.number().int().nonnegative(),
    bytesSavedIfDeduped: z.number().int().nonnegative(),
  }),
});
```

- [ ] **Step 1.4: Run tests**

```bash
npx vitest run test/schema.test.js
```

Expected: 27 schema tests passing (22 prior + 5 new).

```bash
npx vitest run
```

Expected: 116 total tests passing (111 prior + 5 new).

- [ ] **Step 1.5: Lint**

```bash
npx eslint src/schema/inventory.js test/schema.test.js
```

Expected: clean.

- [ ] **Step 1.6: Commit**

```bash
git add src/schema/inventory.js test/schema.test.js
git commit -m "feat(schema): add consolidated header/entry/footer schemas for rollup"
```

---

## Task 2 — Canonical-pick helper

**Files:**
- Create: `src/rollup/canonical.js`
- Create: `test/rollup-canonical.test.js`

This task implements the rule for picking the canonical entry among content-duplicates: oldest `modifiedAt` wins; ties broken alphabetically by `serverName`.

- [ ] **Step 2.1: Write failing tests in `test/rollup-canonical.test.js`**

Create the test file:

```js
import { describe, it, expect } from "vitest";
import { pickCanonical } from "../src/rollup/canonical.js";

function entry(serverName, path, modifiedAt) {
  return { serverName, path, modifiedAt };
}

describe("pickCanonical", () => {
  it("returns the only entry when given a single entry", () => {
    const e = entry("a", "x.pdf", "2024-01-01T00:00:00.000Z");
    expect(pickCanonical([e])).toBe(e);
  });

  it("picks the oldest modifiedAt when entries differ in time", () => {
    const older = entry("b", "x.pdf", "2024-01-01T00:00:00.000Z");
    const newer = entry("a", "x.pdf", "2024-08-01T00:00:00.000Z");
    expect(pickCanonical([newer, older])).toBe(older);
    expect(pickCanonical([older, newer])).toBe(older);
  });

  it("breaks ties alphabetically by serverName when modifiedAt matches", () => {
    const ts = "2024-01-01T00:00:00.000Z";
    const a = entry("alpha", "x.pdf", ts);
    const b = entry("bravo", "x.pdf", ts);
    expect(pickCanonical([b, a])).toBe(a);
    expect(pickCanonical([a, b])).toBe(a);
  });

  it("handles three-way ties on modifiedAt", () => {
    const ts = "2024-01-01T00:00:00.000Z";
    const a = entry("alpha", "x.pdf", ts);
    const b = entry("bravo", "x.pdf", ts);
    const c = entry("charlie", "x.pdf", ts);
    expect(pickCanonical([c, a, b])).toBe(a);
  });

  it("throws on an empty input array", () => {
    expect(() => pickCanonical([])).toThrow();
  });
});
```

- [ ] **Step 2.2: Run, verify failure**

```bash
npx vitest run test/rollup-canonical.test.js
```

Expected: 5 tests fail.

- [ ] **Step 2.3: Implement `src/rollup/canonical.js`**

Create the file:

```js
/**
 * Pick the canonical entry from a list of content-duplicate entries.
 * The canonical entry is the one with the oldest `modifiedAt`. Ties are
 * broken alphabetically by `serverName`.
 *
 * @param {Array<{serverName: string, modifiedAt: string}>} entries
 * @returns {object} the canonical entry (a reference to one of the inputs)
 */
export function pickCanonical(entries) {
  if (!entries || entries.length === 0) {
    throw new Error("pickCanonical: input must contain at least one entry");
  }
  let canonical = entries[0];
  for (let i = 1; i < entries.length; i++) {
    const e = entries[i];
    if (e.modifiedAt < canonical.modifiedAt) {
      canonical = e;
    } else if (e.modifiedAt === canonical.modifiedAt && e.serverName < canonical.serverName) {
      canonical = e;
    }
  }
  return canonical;
}
```

- [ ] **Step 2.4: Run tests**

```bash
npx vitest run test/rollup-canonical.test.js
```

Expected: 5 passing.

```bash
npx vitest run
```

Expected: 121 total (116 + 5).

- [ ] **Step 2.5: Lint**

```bash
npx eslint src/rollup/canonical.js test/rollup-canonical.test.js
```

Expected: clean.

- [ ] **Step 2.6: Commit**

```bash
git add src/rollup/canonical.js test/rollup-canonical.test.js
git commit -m "feat(rollup): add canonical-entry picker (oldest mtime, alpha tiebreaker)"
```

---

## Task 3 — Rollup core merge module

**Files:**
- Create: `src/rollup/merge.js`
- Create: `test/rollup-merge.test.js`

- [ ] **Step 3.1: Write failing tests**

Create `test/rollup-merge.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rollupInventories } from "../src/rollup/merge.js";
import {
  consolidatedHeaderSchema,
  consolidatedEntrySchema,
  consolidatedFooterSchema,
} from "../src/schema/inventory.js";

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-rollup-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function inventoryHeader(serverName, scannedAt = "2024-01-01T00:00:00.000Z") {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "filecap-inventory-header",
    metadata: {
      serverName,
      hostname: `${serverName}.local`,
      serverIp: "10.0.0.1",
      scannedPath: "/uploads",
      scannedAt,
      filecapVersion: "0.4.0",
      nodeVersion: "v20.11.1",
      options: { introspect: false, hash: true, maxIntrospectMb: 200, concurrency: 4 },
    },
  });
}

function inventoryEntry(filename, sha256, modifiedAt = "2024-01-01T00:00:00.000Z") {
  return JSON.stringify({
    path: filename,
    absolutePath: `/uploads/${filename}`,
    filename,
    extension: filename.includes(".") ? filename.split(".").pop() : "",
    category: "pdf",
    remediable: true,
    sizeBytes: 1024,
    modifiedAt,
    sha256,
    flags: [],
  });
}

function inventoryFooter(fileCount, totalBytes) {
  return JSON.stringify({
    kind: "filecap-inventory-footer",
    stats: {
      fileCount,
      totalBytes,
      scanDurationMs: 100,
      introspectionFailures: 0,
      permissionDenials: 0,
    },
  });
}

async function writeNdjson(filePath, lines) {
  await fs.writeFile(filePath, lines.join("\n") + "\n");
}

async function readNdjson(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

describe("rollupInventories", () => {
  it("merges two single-instance inventories with no duplicates", async () => {
    const inA = path.join(tmpRoot, "a.ndjson");
    const inB = path.join(tmpRoot, "b.ndjson");
    const out = path.join(tmpRoot, "consolidated.ndjson");
    await writeNdjson(inA, [
      inventoryHeader("server-a"),
      inventoryEntry("file1.pdf", "hash-1"),
      inventoryFooter(1, 1024),
    ]);
    await writeNdjson(inB, [
      inventoryHeader("server-b"),
      inventoryEntry("file2.pdf", "hash-2"),
      inventoryFooter(1, 1024),
    ]);

    const result = await rollupInventories([inA, inB], out, { strict: false });
    expect(result.exitCode).toBe(0);

    const lines = await readNdjson(out);
    expect(lines).toHaveLength(4); // header + 2 entries + footer
    expect(() => consolidatedHeaderSchema.parse(lines[0])).not.toThrow();
    expect(() => consolidatedEntrySchema.parse(lines[1])).not.toThrow();
    expect(() => consolidatedEntrySchema.parse(lines[2])).not.toThrow();
    expect(() => consolidatedFooterSchema.parse(lines[3])).not.toThrow();

    expect(lines[0].metadata.sources).toHaveLength(2);
    expect(lines[3].stats.fileCount).toBe(2);
    expect(lines[3].stats.totalDuplicateGroups).toBe(0);
    expect(lines[3].stats.bytesSavedIfDeduped).toBe(0);

    // Both entries should have duplicateOf: null since each hash is unique.
    const entries = lines.slice(1, -1);
    for (const e of entries) {
      expect(e.duplicateOf).toBe(null);
    }
  });

  it("links content-duplicates via duplicateOf with oldest-mtime canonical", async () => {
    const inA = path.join(tmpRoot, "a.ndjson");
    const inB = path.join(tmpRoot, "b.ndjson");
    const out = path.join(tmpRoot, "consolidated.ndjson");
    await writeNdjson(inA, [
      inventoryHeader("server-a"),
      inventoryEntry("doc.pdf", "shared-hash", "2024-01-01T00:00:00.000Z"),
      inventoryFooter(1, 1024),
    ]);
    await writeNdjson(inB, [
      inventoryHeader("server-b"),
      // Same hash, newer mtime — should be marked as duplicate
      inventoryEntry("doc-copy.pdf", "shared-hash", "2024-08-01T00:00:00.000Z"),
      inventoryFooter(1, 1024),
    ]);

    await rollupInventories([inA, inB], out, { strict: false });
    const lines = await readNdjson(out);
    const entries = lines.slice(1, -1);
    expect(entries).toHaveLength(2);

    const canonical = entries.find((e) => e.serverName === "server-a");
    const dupe = entries.find((e) => e.serverName === "server-b");
    expect(canonical.duplicateOf).toBe(null);
    expect(dupe.duplicateOf).toEqual({ serverName: "server-a", path: "doc.pdf" });

    expect(lines[3].stats.totalDuplicateGroups).toBe(1);
    expect(lines[3].stats.bytesSavedIfDeduped).toBe(1024); // one extra copy of 1024 bytes
  });

  it("counts totalUniqueHashes correctly", async () => {
    const inA = path.join(tmpRoot, "a.ndjson");
    const out = path.join(tmpRoot, "out.ndjson");
    await writeNdjson(inA, [
      inventoryHeader("server-a"),
      inventoryEntry("a.pdf", "h1"),
      inventoryEntry("b.pdf", "h2"),
      inventoryEntry("c.pdf", "h1"), // duplicate of a.pdf
      inventoryFooter(3, 3072),
    ]);

    await rollupInventories([inA], out, { strict: false });
    const lines = await readNdjson(out);
    const footer = lines[lines.length - 1];
    expect(footer.stats.fileCount).toBe(3);
    expect(footer.stats.totalUniqueHashes).toBe(2);
    expect(footer.stats.totalDuplicateGroups).toBe(1);
  });

  it("warns and skips an inventory missing its footer when --strict is off", async () => {
    const inA = path.join(tmpRoot, "a.ndjson");
    const inB = path.join(tmpRoot, "b.ndjson"); // partial — no footer
    const out = path.join(tmpRoot, "out.ndjson");
    await writeNdjson(inA, [
      inventoryHeader("server-a"),
      inventoryEntry("a.pdf", "h1"),
      inventoryFooter(1, 1024),
    ]);
    await writeNdjson(inB, [
      inventoryHeader("server-b"),
      inventoryEntry("b.pdf", "h2"),
      // no footer line
    ]);

    const result = await rollupInventories([inA, inB], out, { strict: false });
    expect(result.exitCode).toBe(0);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some((w) => w.includes("partial"))).toBe(true);
    // Still includes the partial server's entries
    const lines = await readNdjson(out);
    const entries = lines.slice(1, -1);
    expect(entries.some((e) => e.serverName === "server-b")).toBe(true);
  });

  it("rejects an inventory missing its footer when --strict is on", async () => {
    const inA = path.join(tmpRoot, "a.ndjson");
    await writeNdjson(inA, [
      inventoryHeader("server-a"),
      inventoryEntry("a.pdf", "h1"),
      // no footer
    ]);
    const out = path.join(tmpRoot, "out.ndjson");

    const result = await rollupInventories([inA], out, { strict: true });
    expect(result.exitCode).toBe(1);
  });
});
```

- [ ] **Step 3.2: Run, verify failure**

```bash
npx vitest run test/rollup-merge.test.js
```

Expected: 5 tests fail with module-resolution error.

- [ ] **Step 3.3: Implement `src/rollup/merge.js`**

Create the file:

```js
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import readline from "node:readline";
import { pickCanonical } from "./canonical.js";
import {
  consolidatedHeaderSchema,
  consolidatedEntrySchema,
  consolidatedFooterSchema,
  SCHEMA_VERSION,
} from "../schema/inventory.js";
import { FILECAP_VERSION } from "../version.js";

/**
 * Merge multiple per-server inventory NDJSON files into a single consolidated
 * NDJSON. Content-duplicate entries (sharing a SHA-256) get a `duplicateOf`
 * field pointing at the canonical entry (oldest mtime, alphabetical tiebreak).
 *
 * @param {string[]} inputPaths - paths to per-server NDJSON files
 * @param {string} outputPath - path for the consolidated NDJSON
 * @param {object} opts
 * @param {boolean} opts.strict - if true, schema mismatches and missing footers fail the rollup
 * @returns {Promise<{exitCode: number, warnings: string[], error?: string}>}
 */
export async function rollupInventories(inputPaths, outputPath, { strict = false } = {}) {
  const startedAt = Date.now();
  const warnings = [];
  const sources = [];
  const allEntries = []; // each: {entry, source, footerSeen}

  for (const inputPath of inputPaths) {
    let header;
    let footerSeen = false;
    const entries = [];

    let stream;
    try {
      await fs.access(inputPath);
      stream = createReadStream(inputPath, { encoding: "utf8" });
    } catch (err) {
      const msg = `cannot read ${inputPath}: ${err.message}`;
      if (strict) return { exitCode: 1, warnings, error: msg };
      warnings.push(msg);
      continue;
    }

    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let lineNum = 0;
    for await (const line of rl) {
      lineNum++;
      if (line.length === 0) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        const msg = `${inputPath}:${lineNum} malformed JSON`;
        if (strict) return { exitCode: 1, warnings, error: msg };
        warnings.push(msg);
        continue;
      }
      if (parsed.kind === "filecap-inventory-header") {
        header = parsed;
      } else if (parsed.kind === "filecap-inventory-footer") {
        footerSeen = true;
      } else {
        // It's an entry
        entries.push(parsed);
      }
    }

    if (!header) {
      const msg = `${inputPath} is missing a header — partial or malformed`;
      if (strict) return { exitCode: 1, warnings, error: msg };
      warnings.push(msg);
      continue;
    }
    if (!footerSeen) {
      const msg = `${inputPath} is missing a footer — partial or interrupted scan`;
      if (strict) return { exitCode: 1, warnings, error: msg };
      warnings.push(msg);
    }

    sources.push({
      ...header.metadata,
      stats: footerSeen ? undefined : undefined, // we rebuild stats below
    });
    // For the source-block schema we need the footer stats too. If footerSeen
    // is false we synthesize zeros so the schema validates.
    const sourceStats = {
      fileCount: entries.length,
      totalBytes: entries.reduce((sum, e) => sum + (e.sizeBytes ?? 0), 0),
      scanDurationMs: 0,
      introspectionFailures: 0,
      permissionDenials: 0,
    };
    sources[sources.length - 1].stats = sourceStats;

    const sourceServerName = header.metadata.serverName;
    for (const entry of entries) {
      allEntries.push({ entry, sourceServerName });
    }
  }

  // Group by SHA-256 (skip empty hashes — those came from --no-hash scans)
  const groupsByHash = new Map();
  for (const item of allEntries) {
    const hash = item.entry.sha256;
    if (!hash) continue;
    if (!groupsByHash.has(hash)) groupsByHash.set(hash, []);
    groupsByHash.get(hash).push({
      serverName: item.sourceServerName,
      path: item.entry.path,
      modifiedAt: item.entry.modifiedAt,
      sizeBytes: item.entry.sizeBytes,
    });
  }

  // For each duplicate group, pick canonical
  const canonicalKeyByHash = new Map(); // hash -> "serverName::path"
  let totalDuplicateGroups = 0;
  let bytesSavedIfDeduped = 0;
  for (const [hash, list] of groupsByHash) {
    if (list.length > 1) {
      const canonical = pickCanonical(list);
      canonicalKeyByHash.set(hash, `${canonical.serverName}::${canonical.path}`);
      totalDuplicateGroups++;
      // Bytes saved = (list.length - 1) copies × size of canonical
      bytesSavedIfDeduped += (list.length - 1) * canonical.sizeBytes;
    } else {
      canonicalKeyByHash.set(hash, `${list[0].serverName}::${list[0].path}`);
    }
  }

  // Now write the consolidated output
  const writeStream = createWriteStream(outputPath, { encoding: "utf8" });
  let streamClosedNormally = false;

  function writeLine(obj) {
    return new Promise((resolve, reject) => {
      const ok = writeStream.write(`${JSON.stringify(obj)}\n`, (err) =>
        err ? reject(err) : resolve(),
      );
      if (!ok) writeStream.once("drain", resolve);
    });
  }

  try {
    const consolidatedHeader = {
      schemaVersion: SCHEMA_VERSION,
      kind: "filecap-consolidated-header",
      metadata: {
        consolidatedAt: new Date().toISOString(),
        filecapVersion: FILECAP_VERSION,
        nodeVersion: process.version,
        sources,
      },
    };
    consolidatedHeaderSchema.parse(consolidatedHeader);
    await writeLine(consolidatedHeader);

    let fileCount = 0;
    let totalBytes = 0;

    for (const item of allEntries) {
      const entry = item.entry;
      const consolidatedEntry = {
        ...entry,
        serverName: item.sourceServerName,
        duplicateOf: null,
      };
      const hash = entry.sha256;
      if (hash) {
        const canonicalKey = canonicalKeyByHash.get(hash);
        const myKey = `${item.sourceServerName}::${entry.path}`;
        if (canonicalKey && canonicalKey !== myKey) {
          const [canonicalServerName, canonicalPath] = canonicalKey.split("::");
          consolidatedEntry.duplicateOf = {
            serverName: canonicalServerName,
            path: canonicalPath,
          };
        }
      }
      consolidatedEntrySchema.parse(consolidatedEntry);
      await writeLine(consolidatedEntry);
      fileCount++;
      totalBytes += entry.sizeBytes ?? 0;
    }

    const footer = {
      kind: "filecap-consolidated-footer",
      stats: {
        fileCount,
        totalBytes,
        consolidationDurationMs: Date.now() - startedAt,
        totalUniqueHashes: groupsByHash.size,
        totalDuplicateGroups,
        bytesSavedIfDeduped,
      },
    };
    consolidatedFooterSchema.parse(footer);
    await writeLine(footer);

    await new Promise((resolve, reject) => {
      writeStream.end((err) => (err ? reject(err) : resolve()));
    });
    streamClosedNormally = true;

    return { exitCode: 0, warnings };
  } catch (err) {
    return { exitCode: 1, warnings, error: err.message };
  } finally {
    if (!streamClosedNormally) {
      try {
        writeStream.destroy();
      } catch {
        // ignore
      }
    }
  }
}
```

- [ ] **Step 3.4: Run tests**

```bash
npx vitest run test/rollup-merge.test.js
```

Expected: 5 tests pass.

```bash
npx vitest run
```

Expected: 126 tests passing (121 + 5).

- [ ] **Step 3.5: Lint**

```bash
npx eslint src/rollup/merge.js test/rollup-merge.test.js
```

Expected: clean.

- [ ] **Step 3.6: Commit**

```bash
git add src/rollup/merge.js test/rollup-merge.test.js
git commit -m "feat(rollup): add streaming merge with content-duplicate linking"
```

---

## Task 4 — Rollup CLI command

**Files:**
- Create: `src/commands/rollup.js`
- Modify: `bin/filecap.js`
- Create: `test/rollup.test.js` (CLI E2E)

- [ ] **Step 4.1: Create `src/commands/rollup.js`**

```js
import { rollupInventories } from "../rollup/merge.js";

/**
 * CLI-level wrapper for the rollup command. Translates Commander options to
 * the merge function's signature and emits warnings to stderr.
 */
export async function runRollup({ inputs, output, strict = false }) {
  const result = await rollupInventories(inputs, output, { strict });
  for (const w of result.warnings) {
    process.stderr.write(`warning: ${w}\n`);
  }
  if (result.error) {
    process.stderr.write(`${result.error}\n`);
  }
  return { exitCode: result.exitCode, error: result.error };
}
```

- [ ] **Step 4.2: Modify `bin/filecap.js`**

Read `bin/filecap.js`. Find the existing `rollup` stub:

```js
program
  .command("rollup")
  .description("(Phase 5 — not yet implemented in v0.1.0)")
  .action(() => {
    process.stderr.write("filecap rollup is not implemented in v0.1.0 (Phase 5).\n");
    process.exit(1);
  });
```

Replace it with:

```js
program
  .command("rollup <files...>")
  .description("Merge multiple single-instance inventories into a consolidated inventory")
  .option("-o, --output <path>", "output path", "consolidated.ndjson")
  .option("--strict", "fail on schema mismatch or missing footer", false)
  .action(async (files, opts) => {
    try {
      const result = await runRollup({
        inputs: files,
        output: opts.output,
        strict: opts.strict,
      });
      process.exit(result.exitCode);
    } catch (err) {
      process.stderr.write(`filecap: ${err.message}\n`);
      process.exit(1);
    }
  });
```

Add the import at the top of `bin/filecap.js`:

```js
import { runRollup } from "../src/commands/rollup.js";
```

- [ ] **Step 4.3: Create the CLI E2E test in `test/rollup.test.js`**

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

let tmpRoot;
let outDir;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-rollup-cli-"));
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-rollup-cli-out-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.rm(outDir, { recursive: true, force: true });
});

function runCli(args, cwd) {
  const cliPath = fileURLToPath(new URL("../bin/filecap.js", import.meta.url));
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (d) => stdout.push(d));
    child.stderr.on("data", (d) => stderr.push(d));
    child.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function inv(serverName, entries) {
  const lines = [];
  lines.push(JSON.stringify({
    schemaVersion: 1,
    kind: "filecap-inventory-header",
    metadata: {
      serverName,
      hostname: `${serverName}.local`,
      serverIp: "10.0.0.1",
      scannedPath: "/uploads",
      scannedAt: "2024-01-01T00:00:00.000Z",
      filecapVersion: "0.4.0",
      nodeVersion: "v20.11.1",
      options: { introspect: false, hash: true, maxIntrospectMb: 200, concurrency: 4 },
    },
  }));
  for (const e of entries) lines.push(JSON.stringify(e));
  lines.push(JSON.stringify({
    kind: "filecap-inventory-footer",
    stats: {
      fileCount: entries.length,
      totalBytes: entries.reduce((s, e) => s + (e.sizeBytes ?? 0), 0),
      scanDurationMs: 1,
      introspectionFailures: 0,
      permissionDenials: 0,
    },
  }));
  return lines.join("\n") + "\n";
}

function entry(filename, hash, modifiedAt = "2024-01-01T00:00:00.000Z") {
  return {
    path: filename,
    absolutePath: `/uploads/${filename}`,
    filename,
    extension: filename.split(".").pop(),
    category: "pdf",
    remediable: true,
    sizeBytes: 1024,
    modifiedAt,
    sha256: hash,
    flags: [],
  };
}

describe("filecap rollup CLI", () => {
  it("merges three per-server inventories with intentional duplicates", async () => {
    const a = path.join(tmpRoot, "a.ndjson");
    const b = path.join(tmpRoot, "b.ndjson");
    const c = path.join(tmpRoot, "c.ndjson");
    await fs.writeFile(a, inv("server-a", [
      entry("doc1.pdf", "shared", "2024-01-01T00:00:00.000Z"),
      entry("uniq-a.pdf", "ha"),
    ]));
    await fs.writeFile(b, inv("server-b", [
      entry("doc1-copy.pdf", "shared", "2024-08-01T00:00:00.000Z"),
      entry("uniq-b.pdf", "hb"),
    ]));
    await fs.writeFile(c, inv("server-c", [
      entry("uniq-c.pdf", "hc"),
    ]));

    const out = path.join(outDir, "consolidated.ndjson");
    const result = await runCli(["rollup", a, b, c, "-o", out], outDir);
    expect(result.code).toBe(0);

    const text = await fs.readFile(out, "utf8");
    const lines = text.split("\n").filter(Boolean).map(JSON.parse);
    expect(lines[0].kind).toBe("filecap-consolidated-header");
    expect(lines[lines.length - 1].kind).toBe("filecap-consolidated-footer");
    const footer = lines[lines.length - 1];
    expect(footer.stats.fileCount).toBe(5);
    expect(footer.stats.totalUniqueHashes).toBe(4);
    expect(footer.stats.totalDuplicateGroups).toBe(1);
    expect(footer.stats.bytesSavedIfDeduped).toBe(1024);

    const entries = lines.slice(1, -1);
    const dup = entries.find((e) => e.serverName === "server-b" && e.filename === "doc1-copy.pdf");
    expect(dup.duplicateOf).toEqual({ serverName: "server-a", path: "doc1.pdf" });
  });

  it("returns exit 1 with --strict on a partial inventory", async () => {
    const partial = path.join(tmpRoot, "partial.ndjson");
    // Header + entry, no footer
    await fs.writeFile(partial, JSON.stringify({
      schemaVersion: 1,
      kind: "filecap-inventory-header",
      metadata: {
        serverName: "x",
        hostname: "x.local",
        serverIp: "10.0.0.1",
        scannedPath: "/u",
        scannedAt: "2024-01-01T00:00:00.000Z",
        filecapVersion: "0.4.0",
        nodeVersion: "v20.11.1",
        options: { introspect: false, hash: true, maxIntrospectMb: 200, concurrency: 4 },
      },
    }) + "\n" + JSON.stringify(entry("a.pdf", "h")) + "\n");

    const out = path.join(outDir, "out.ndjson");
    const result = await runCli(["rollup", partial, "-o", out, "--strict"], outDir);
    expect(result.code).toBe(1);
  });
});
```

- [ ] **Step 4.4: Run tests**

```bash
npx vitest run test/rollup.test.js
```

Expected: 2 tests pass.

```bash
npx vitest run
```

Expected: 128 tests passing (126 + 2).

- [ ] **Step 4.5: Smoke test the CLI**

```bash
cd /Volumes/satechi/webdev/filecap-cli
./bin/filecap.js rollup --help
```

Expected: shows the rollup subcommand help with `<files...>` argument and `-o`/`--strict` flags.

- [ ] **Step 4.6: Lint**

```bash
npx eslint src/commands/rollup.js bin/filecap.js test/rollup.test.js
```

Expected: clean.

- [ ] **Step 4.7: Commit**

```bash
git add src/commands/rollup.js bin/filecap.js test/rollup.test.js
git commit -m "feat(cli): wire rollup subcommand to the merge module"
```

---

## Task 5 — Update src/index.js exports

**Files:**
- Modify: `src/index.js`

- [ ] **Step 5.1: Replace `src/index.js` content**

```js
export { runScan } from "./commands/scan.js";
export { runRollup } from "./commands/rollup.js";
export {
  headerSchema,
  entrySchema,
  footerSchema,
  pdfIntrospectionSchema,
  docxIntrospectionSchema,
  xlsxIntrospectionSchema,
  legacyOfficeIntrospectionSchema,
  consolidatedHeaderSchema,
  consolidatedEntrySchema,
  consolidatedFooterSchema,
  isCompleteInventory,
  SCHEMA_VERSION,
} from "./schema/inventory.js";
export { introspect } from "./introspect/index.js";
export { introspectPdf } from "./introspect/pdf.js";
export { introspectDocx } from "./introspect/docx.js";
export { introspectXlsx } from "./introspect/xlsx.js";
export { introspectLegacyOffice } from "./introspect/office-legacy.js";
export { computeFilenameFlags } from "./flag/filename.js";
export { rollupInventories } from "./rollup/merge.js";
export { pickCanonical } from "./rollup/canonical.js";
export { FILECAP_VERSION } from "./version.js";
```

New exports vs Phase 4: `runRollup`, `consolidatedHeaderSchema`, `consolidatedEntrySchema`, `consolidatedFooterSchema`, `rollupInventories`, `pickCanonical`.

- [ ] **Step 5.2: Verify**

```bash
node -e "import('./src/index.js').then(m => console.log('exports:', Object.keys(m).sort().length, 'total'))"
```

Expected: 22 exports.

- [ ] **Step 5.3: Tests + lint + commit**

```bash
npm test
npx eslint src/index.js
git add src/index.js
git commit -m "feat: re-export rollup machinery and consolidated schemas from package main"
```

Expected: 128 passing; lint clean.

---

## Task 6 — README expansion

**Files:**
- Modify: `README.md`

- [ ] **Step 6.1: Update Status**

Find the "Phase 4 shipped (v0.4.0)" paragraph and replace with:

```markdown
**Phase 5 shipped (v0.5.0).** Multi-server rollup is functional: `filecap rollup *.ndjson -o consolidated.ndjson` merges per-server inventories into one consolidated file with content-duplicate detection (entries sharing a SHA-256 get a `duplicateOf` link to the canonical entry — oldest `modifiedAt`, alphabetical tiebreaker on `serverName`). Phase 4's filename flagging, Phase 3's Office introspection, and Phase 2's PDF introspection all continue unchanged.
```

In the phase table, change Phase 4 from `**shipped**` to `shipped`, and Phase 5 from `planned` to `**shipped**`.

- [ ] **Step 6.2: Add a "Rollup workflow (Phase 5)" section**

Insert AFTER the existing `## Filename flags (Phase 4)` section (and BEFORE `## What filecap does not do`):

````markdown
## Rollup workflow (Phase 5)

After scanning N servers, merge the per-server NDJSONs into a consolidated inventory:

```bash
filecap rollup ./inventories/*.ndjson -o consolidated.ndjson
```

The consolidated NDJSON has the same line-delimited structure but with three differences from a single-instance inventory:

1. **Header.** `kind: "filecap-consolidated-header"` and `metadata.sources` is an array with one entry per source inventory (each carrying the original server identity, scan options, and stats).
2. **Entries.** Each entry gains `serverName: string` (which source it came from) and `duplicateOf: {serverName, path} | null`. Content-duplicates (identical SHA-256 across servers) get `duplicateOf` set to the canonical copy. The canonical entry has `duplicateOf: null`.
3. **Footer.** `kind: "filecap-consolidated-footer"` with cross-instance stats: `totalUniqueHashes`, `totalDuplicateGroups`, `bytesSavedIfDeduped` (bytes that could be reclaimed by deleting non-canonical duplicates).

**Flags:**

| Flag | Default | Description |
|---|---|---|
| `-o, --output <path>` | `consolidated.ndjson` | Output path |
| `--strict` | (off) | Fail on schema mismatch or missing footer in any input (default: warn and skip) |

**Why one row per physical copy?** Each duplicate entry in the consolidated CSV (Phase 6) represents real disk space someone has to decide to keep or delete. The `duplicateOf` link tells the consumer "this is the same content as `<serverName>:<path>`" so a vendor can group by hash for de-dup analysis OR filter to canonicals only for remediation work. Both views are one query away.
````

- [ ] **Step 6.3: Commit**

```bash
git add README.md
git commit -m "docs: add Phase 5 rollup workflow section and update status"
```

---

## Task 7 — CHANGELOG [0.5.0]

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 7.1: Insert entry above [0.4.0]**

```markdown
## [0.5.0] — 2026-05-08

### Added

- **Multi-server rollup.** New command `filecap rollup <files...>` merges per-server NDJSONs into a consolidated NDJSON with content-duplicate detection. Each entry in the output gets `serverName` (source) and `duplicateOf` (canonical copy reference, or null). Canonical entry: oldest `modifiedAt`; alphabetical tiebreaker on `serverName`.
- New consolidated NDJSON schemas: `consolidatedHeaderSchema` (with `metadata.sources` array of source inventory headers), `consolidatedEntrySchema` (entry + serverName + duplicateOf), `consolidatedFooterSchema` (with `totalUniqueHashes`, `totalDuplicateGroups`, `bytesSavedIfDeduped` cross-instance stats).
- `--strict` flag on `filecap rollup`: fails on schema mismatch or missing footer (default: warn and skip).
- New programmatic exports from package main: `runRollup`, `rollupInventories`, `pickCanonical`, plus the three consolidated schemas.

[0.5.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v0.5.0
```

- [ ] **Step 7.2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add [0.5.0] CHANGELOG entry"
```

---

## Task 8 — Bump version to 0.5.0

```bash
# Edit package.json: "version": "0.5.0"
npm install --package-lock-only
./bin/filecap.js --version    # expect 0.5.0
npm test                       # expect 128 passing
git add package.json package-lock.json
git commit -m "chore: bump version to 0.5.0"
```

---

## Task 9 — Publish v0.5.0

```bash
git push origin main
./publish first
# Will require an OTP from your authenticator if 2FA is on.
# If publish step fails with EOTP, run:
#   npm publish --access public --otp=<6-digit-code>
```

After publish:

```bash
sleep 30
npx --yes @icjia/filecap@0.5.0 --version
```

Expected: `0.5.0`.

---

## End of Phase 5

After Task 9: `@icjia/filecap@0.5.0` published; ~128 tests; rollup command working end-to-end. Phase 6 (`filecap report` — CSV + summary text) is the natural next step.
