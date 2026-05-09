# filecap Phase 7 — MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@icjia/filecap@1.0.0` — replace the `filecap mcp` stub with a working stdio MCP server that exposes `scan`, `rollup`, `report`, and a read-only `query_inventory` tool. AI agents (Claude Desktop, Claude Code, etc.) can call filecap's capabilities during conversational audits.

**Architecture:** stdio MCP server using `@modelcontextprotocol/sdk`. Each tool is a thin wrapper that calls the existing `runScan` / `runRollup` / `runReport` functions and returns structured results. The `query_inventory` tool is new — it stream-reads a consolidated NDJSON, filters by a small set of criteria (size, extension, flags, isImageOnly), sorts, and returns up to `limit` matching entries.

**Tech Stack:** Node 20+, ESM. New runtime dep: `@modelcontextprotocol/sdk`. Reuses Phase 1–6 commands directly.

**Out of scope for Phase 7:** Streaming progress updates over MCP (would require notifications support — defer), MCP resources or prompts (not needed for audit use case), bidirectional tool composition (an MCP client can chain tools itself).

---

## File Structure

```
filecap-cli/
├── src/
│   ├── commands/
│   │   └── mcp.js                        ← create (stdio server entry point)
│   ├── mcp/
│   │   ├── tools.js                      ← create (tool definitions + dispatcher)
│   │   └── query.js                      ← create (query_inventory implementation)
│   └── index.js                          ← modify (re-exports)
├── bin/
│   └── filecap.js                        ← modify (wire mcp subcommand)
├── test/
│   ├── mcp-query.test.js                 ← create
│   ├── mcp-tools.test.js                 ← create
│   └── mcp.test.js                       ← create (E2E via the CLI subprocess)
├── README.md                             ← modify (Phase 7 status, MCP example config)
├── CHANGELOG.md                          ← modify ([1.0.0] entry)
└── package.json + lockfile
```

---

## Task 1 — Bootstrap @modelcontextprotocol/sdk

**Files:** Modify `package.json`, regenerate `package-lock.json`

- [ ] **Step 1.1: Install the dep**

```bash
cd /Volumes/satechi/webdev/filecap-cli
npm install @modelcontextprotocol/sdk@^1
```

- [ ] **Step 1.2: Verify import works**

```bash
node -e "import('@modelcontextprotocol/sdk/server/index.js').then(m => console.log('Server:', typeof m.Server === 'function'))"
```

Expected: `Server: true`.

- [ ] **Step 1.3: Run tests + commit**

```bash
npm test                # 147 still passing
git add package.json package-lock.json
git commit -m "chore(deps): add @modelcontextprotocol/sdk for Phase 7 MCP server"
```

---

## Task 2 — Query helper (read-only inventory queries)

**Files:** Create `src/mcp/query.js`, `test/mcp-query.test.js`

The `queryInventory` function streams a consolidated or single-instance NDJSON and returns entries matching the supplied filters.

- [ ] **Step 2.1: Tests**

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { queryInventory } from "../src/mcp/query.js";

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-mcp-query-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function ndjson(entries, kind = "filecap-inventory") {
  const lines = [];
  lines.push(JSON.stringify({
    schemaVersion: 1,
    kind: `${kind}-header`,
    metadata: { serverName: "test", hostname: "x", serverIp: "10.0.0.1", scannedPath: "/u", scannedAt: "2024-01-01T00:00:00.000Z", filecapVersion: "0.6.0", nodeVersion: "v20", options: { introspect: false, hash: true, maxIntrospectMb: 200, concurrency: 4 } },
  }));
  for (const e of entries) lines.push(JSON.stringify(e));
  lines.push(JSON.stringify({ kind: `${kind}-footer`, stats: { fileCount: entries.length, totalBytes: 0, scanDurationMs: 0, introspectionFailures: 0, permissionDenials: 0 } }));
  return lines.join("\n") + "\n";
}

function entry(filename, sizeBytes, opts = {}) {
  return {
    path: filename,
    absolutePath: `/u/${filename}`,
    filename,
    extension: filename.split(".").pop(),
    category: opts.category ?? "pdf",
    remediable: opts.remediable ?? true,
    sizeBytes,
    modifiedAt: opts.modifiedAt ?? "2024-01-01T00:00:00.000Z",
    sha256: opts.sha256 ?? "",
    flags: opts.flags ?? [],
    ...(opts.introspection ? { introspection: opts.introspection } : {}),
  };
}

describe("queryInventory", () => {
  it("returns all entries when no filters given (up to limit)", async () => {
    const file = path.join(tmpRoot, "in.ndjson");
    await fs.writeFile(file, ndjson([entry("a.pdf", 100), entry("b.pdf", 200)]));
    const result = await queryInventory({ inventory: file, filters: {} });
    expect(result.matched.length).toBe(2);
    expect(result.totalEntries).toBe(2);
  });

  it("filters by minSizeBytes", async () => {
    const file = path.join(tmpRoot, "in.ndjson");
    await fs.writeFile(file, ndjson([entry("small.pdf", 100), entry("big.pdf", 1_000_000)]));
    const result = await queryInventory({ inventory: file, filters: { minSizeBytes: 1000 } });
    expect(result.matched.map((e) => e.filename)).toEqual(["big.pdf"]);
  });

  it("filters by extension", async () => {
    const file = path.join(tmpRoot, "in.ndjson");
    await fs.writeFile(file, ndjson([entry("a.pdf", 1), entry("b.docx", 1), entry("c.pdf", 1)]));
    const result = await queryInventory({ inventory: file, filters: { extension: "pdf" } });
    expect(result.matched.length).toBe(2);
    for (const e of result.matched) expect(e.extension).toBe("pdf");
  });

  it("filters by category", async () => {
    const file = path.join(tmpRoot, "in.ndjson");
    await fs.writeFile(file, ndjson([
      entry("a.pdf", 1, { category: "pdf" }),
      entry("b.png", 1, { category: "image" }),
    ]));
    const result = await queryInventory({ inventory: file, filters: { category: "image" } });
    expect(result.matched.map((e) => e.filename)).toEqual(["b.png"]);
  });

  it("filters by includeFlags (must contain all listed flags)", async () => {
    const file = path.join(tmpRoot, "in.ndjson");
    await fs.writeFile(file, ndjson([
      entry("Scan_001.pdf", 1, { flags: ["scanned-name-pattern"] }),
      entry("résumé.pdf", 1, { flags: ["filename-non-ascii"] }),
      entry("Scan résumé.pdf", 1, { flags: ["scanned-name-pattern", "filename-has-spaces", "filename-non-ascii"] }),
      entry("ok.pdf", 1, { flags: [] }),
    ]));
    const result = await queryInventory({
      inventory: file,
      filters: { includeFlags: ["scanned-name-pattern", "filename-non-ascii"] },
    });
    expect(result.matched.map((e) => e.filename)).toEqual(["Scan résumé.pdf"]);
  });

  it("filters by isImageOnly via introspection", async () => {
    const file = path.join(tmpRoot, "in.ndjson");
    await fs.writeFile(file, ndjson([
      entry("scan.pdf", 1, { introspection: { kind: "pdf", pageCount: 1, hasTextLayer: false, isImageOnly: true, hasTags: false, hasFormFields: false, hasSignatures: false, encrypted: false } }),
      entry("born.pdf", 1, { introspection: { kind: "pdf", pageCount: 1, hasTextLayer: true, isImageOnly: false, hasTags: false, hasFormFields: false, hasSignatures: false, encrypted: false } }),
    ]));
    const result = await queryInventory({ inventory: file, filters: { isImageOnly: true } });
    expect(result.matched.map((e) => e.filename)).toEqual(["scan.pdf"]);
  });

  it("respects limit", async () => {
    const file = path.join(tmpRoot, "in.ndjson");
    const entries = Array.from({ length: 100 }, (_, i) => entry(`f${i}.pdf`, i));
    await fs.writeFile(file, ndjson(entries));
    const result = await queryInventory({ inventory: file, filters: {}, limit: 10 });
    expect(result.matched.length).toBe(10);
    expect(result.totalEntries).toBe(100);
  });

  it("sorts by sizeBytes desc when sortBy: size", async () => {
    const file = path.join(tmpRoot, "in.ndjson");
    await fs.writeFile(file, ndjson([entry("small.pdf", 10), entry("big.pdf", 1000), entry("medium.pdf", 100)]));
    const result = await queryInventory({ inventory: file, filters: {}, sortBy: "size" });
    expect(result.matched.map((e) => e.filename)).toEqual(["big.pdf", "medium.pdf", "small.pdf"]);
  });

  it("returns exitCode 2 on missing input", async () => {
    const result = await queryInventory({ inventory: path.join(tmpRoot, "nope.ndjson"), filters: {} });
    expect(result.error).toBeTruthy();
  });
});
```

- [ ] **Step 2.2: Implement `src/mcp/query.js`**

```js
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";

/**
 * Query a consolidated or single-instance NDJSON for matching entries.
 *
 * Filters supported:
 *   - minSizeBytes / maxSizeBytes: size range in bytes
 *   - extension: lowercase string match (e.g., "pdf")
 *   - category: exact category-bucket match
 *   - includeFlags: array of flag strings; entry must contain ALL listed
 *   - excludeFlags: array of flag strings; entry must contain NONE listed
 *   - isImageOnly: boolean; matches entries where introspection.kind === "pdf" AND introspection.isImageOnly === <value>
 *   - serverName: exact match against entry.serverName (consolidated input)
 *
 * @param {object} args
 * @param {string} args.inventory - path to NDJSON
 * @param {object} args.filters
 * @param {number} [args.limit=50]
 * @param {"size"|"modifiedAt"|null} [args.sortBy=null]
 * @returns {Promise<{matched: object[], totalEntries: number, error?: string}>}
 */
export async function queryInventory({ inventory, filters = {}, limit = 50, sortBy = null }) {
  let stream;
  try {
    await fs.access(inventory);
    stream = createReadStream(inventory, { encoding: "utf8" });
  } catch (err) {
    return { matched: [], totalEntries: 0, error: `cannot read ${inventory}: ${err.message}` };
  }

  const all = [];
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed.kind && parsed.kind.includes("header")) continue;
    if (parsed.kind && parsed.kind.includes("footer")) continue;
    all.push(parsed);
  }

  const matched = all.filter((e) => entryMatches(e, filters));

  if (sortBy === "size") {
    matched.sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
  } else if (sortBy === "modifiedAt") {
    matched.sort((a, b) => (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""));
  }

  return {
    matched: matched.slice(0, limit),
    totalEntries: all.length,
  };
}

function entryMatches(entry, filters) {
  if (filters.minSizeBytes !== undefined && entry.sizeBytes < filters.minSizeBytes) return false;
  if (filters.maxSizeBytes !== undefined && entry.sizeBytes > filters.maxSizeBytes) return false;
  if (filters.extension && entry.extension !== filters.extension) return false;
  if (filters.category && entry.category !== filters.category) return false;
  if (filters.serverName && entry.serverName !== filters.serverName) return false;
  if (filters.includeFlags) {
    const flags = entry.flags ?? [];
    for (const f of filters.includeFlags) {
      if (!flags.includes(f)) return false;
    }
  }
  if (filters.excludeFlags) {
    const flags = entry.flags ?? [];
    for (const f of filters.excludeFlags) {
      if (flags.includes(f)) return false;
    }
  }
  if (filters.isImageOnly !== undefined) {
    if (entry.introspection?.kind !== "pdf") return false;
    if (entry.introspection.isImageOnly !== filters.isImageOnly) return false;
  }
  return true;
}
```

- [ ] **Step 2.3: Run + lint + commit**

```bash
npx vitest run test/mcp-query.test.js
npx vitest run                  # 156 total (147 + 9)
npx eslint src/mcp/query.js test/mcp-query.test.js
git add src/mcp/query.js test/mcp-query.test.js
git commit -m "feat(mcp): add queryInventory helper for filterable inventory reads"
```

---

## Task 3 — MCP tool definitions

**Files:** Create `src/mcp/tools.js`, `test/mcp-tools.test.js`

This task defines the four MCP tools (scan, rollup, report, query_inventory) as tool descriptors plus a dispatcher that runs them by name.

- [ ] **Step 3.1: Tests**

```js
import { describe, it, expect } from "vitest";
import { TOOL_DEFINITIONS, dispatchTool } from "../src/mcp/tools.js";

describe("TOOL_DEFINITIONS", () => {
  it("exports four tools with names and JSON schemas", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name).sort();
    expect(names).toEqual(["filecap_query_inventory", "filecap_report", "filecap_rollup", "filecap_scan"]);
    for (const t of TOOL_DEFINITIONS) {
      expect(t.description).toBeTruthy();
      expect(t.inputSchema).toBeTruthy();
      expect(t.inputSchema.type).toBe("object");
    }
  });
});

describe("dispatchTool", () => {
  it("rejects unknown tool names", async () => {
    const result = await dispatchTool("not_a_real_tool", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/unknown tool/i);
  });

  it("dispatches filecap_scan and returns a structured response", async () => {
    // We test against a tmp dir to avoid a real long scan
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-mcp-tools-"));
    await fs.writeFile(path.join(tmpRoot, "x.txt"), "hi");
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-mcp-tools-out-"));
    const outPath = path.join(outDir, "scan.ndjson");

    const result = await dispatchTool("filecap_scan", {
      directory: tmpRoot,
      output: outPath,
      hash: false,
      introspect: false,
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].type).toBe("text");
    // Output should mention success and the output path
    expect(result.content[0].text).toMatch(/exitCode/);

    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 3.2: Implement `src/mcp/tools.js`**

```js
import { runScan } from "../commands/scan.js";
import { runRollup } from "../commands/rollup.js";
import { runReport } from "../commands/report.js";
import { queryInventory } from "./query.js";

export const TOOL_DEFINITIONS = [
  {
    name: "filecap_scan",
    description:
      "Walk a directory tree and produce an NDJSON inventory. Returns the path to the written inventory file.",
    inputSchema: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Absolute path to scan" },
        output: { type: "string", description: "Output NDJSON path" },
        hash: { type: "boolean", description: "Compute SHA-256 (default true)" },
        introspect: { type: "boolean", description: "Run PDF/Office introspection (default false)" },
        maxIntrospectMb: { type: "number", description: "Skip introspection above this size in MB (default 200)" },
        concurrency: { type: "number", description: "Parallel workers (default 4)" },
        includeExt: { type: "array", items: { type: "string" }, description: "Extensions to include" },
        excludeExt: { type: "array", items: { type: "string" }, description: "Extensions to exclude" },
      },
      required: ["directory", "output"],
    },
  },
  {
    name: "filecap_rollup",
    description:
      "Merge multiple per-server inventory NDJSONs into a consolidated inventory with content-duplicate detection.",
    inputSchema: {
      type: "object",
      properties: {
        inputs: { type: "array", items: { type: "string" }, description: "Paths to per-server NDJSON files" },
        output: { type: "string", description: "Consolidated NDJSON output path" },
        strict: { type: "boolean", description: "Fail on schema mismatch / missing footer" },
      },
      required: ["inputs", "output"],
    },
  },
  {
    name: "filecap_report",
    description:
      "Generate the vendor handoff package (CSV + summary + flagged-list .txt files) from an inventory NDJSON.",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string", description: "Inventory NDJSON path" },
        outputDir: { type: "string", description: "Output directory" },
      },
      required: ["input", "outputDir"],
    },
  },
  {
    name: "filecap_query_inventory",
    description:
      "Filter and sort entries in a consolidated or single-instance NDJSON. Useful for queries like 'show every PDF over 100 MB on prod-02' or 'list image-only PDFs across all servers'.",
    inputSchema: {
      type: "object",
      properties: {
        inventory: { type: "string", description: "Path to inventory NDJSON" },
        filters: {
          type: "object",
          properties: {
            minSizeBytes: { type: "number" },
            maxSizeBytes: { type: "number" },
            extension: { type: "string", description: "Lowercase, no leading dot" },
            category: { type: "string", description: "pdf, office-document, spreadsheet, presentation, image, archive, text, web, audio-video, other" },
            serverName: { type: "string" },
            includeFlags: { type: "array", items: { type: "string" } },
            excludeFlags: { type: "array", items: { type: "string" } },
            isImageOnly: { type: "boolean" },
          },
        },
        limit: { type: "number", description: "Max results (default 50)" },
        sortBy: { type: "string", enum: ["size", "modifiedAt"] },
      },
      required: ["inventory"],
    },
  },
];

/**
 * Dispatch a tool by name with arguments, returning an MCP-shaped result.
 *
 * @returns {Promise<{content: Array<{type: string, text: string}>, isError?: boolean}>}
 */
export async function dispatchTool(name, args) {
  try {
    if (name === "filecap_scan") {
      const result = await runScan({
        directory: args.directory,
        output: args.output,
        hash: args.hash ?? true,
        concurrency: args.concurrency ?? 4,
        progress: false,
        introspect: args.introspect ?? false,
        maxIntrospectMb: args.maxIntrospectMb ?? 200,
        includeExt: args.includeExt,
        excludeExt: args.excludeExt,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    if (name === "filecap_rollup") {
      const result = await runRollup({
        inputs: args.inputs,
        output: args.output,
        strict: args.strict ?? false,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    if (name === "filecap_report") {
      const result = await runReport({
        input: args.input,
        outputDir: args.outputDir,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    if (name === "filecap_query_inventory") {
      const result = await queryInventory({
        inventory: args.inventory,
        filters: args.filters ?? {},
        limit: args.limit ?? 50,
        sortBy: args.sortBy ?? null,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    return {
      isError: true,
      content: [{ type: "text", text: `unknown tool: ${name}` }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${err.message}` }],
    };
  }
}
```

- [ ] **Step 3.3: Run + lint + commit**

```bash
npx vitest run test/mcp-tools.test.js
npx vitest run                  # 158 total (156 + 2)
npx eslint src/mcp/tools.js test/mcp-tools.test.js
git add src/mcp/tools.js test/mcp-tools.test.js
git commit -m "feat(mcp): define four tools (scan, rollup, report, query) with JSON schemas + dispatcher"
```

---

## Task 4 — MCP server entry point + CLI wiring

**Files:** Create `src/commands/mcp.js`, modify `bin/filecap.js`, create `test/mcp.test.js` (E2E)

- [ ] **Step 4.1: Implement `src/commands/mcp.js`**

```js
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TOOL_DEFINITIONS, dispatchTool } from "../mcp/tools.js";
import { FILECAP_VERSION } from "../version.js";

/**
 * Start an stdio MCP server that exposes filecap's commands as tools.
 * Returns a promise that resolves when the server connects to stdio.
 *
 * In normal CLI usage this never resolves — the server runs until the
 * MCP client disconnects (typically by closing stdin).
 */
export async function runMcp() {
  const server = new Server(
    { name: "filecap", version: FILECAP_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return dispatchTool(name, args ?? {});
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

- [ ] **Step 4.2: Modify `bin/filecap.js`**

Add the import:

```js
import { runMcp } from "../src/commands/mcp.js";
```

Replace the existing `mcp` stub (or wherever the unused stub is — there might not be one yet; add a new subcommand):

```js
program
  .command("mcp")
  .description("Run filecap as an stdio MCP server (for use with Claude Desktop, Claude Code, etc.)")
  .action(async () => {
    try {
      await runMcp();
    } catch (err) {
      process.stderr.write(`filecap mcp error: ${err.message}\n`);
      process.exit(1);
    }
  });
```

(If the existing CLI has a stub `mcp` subcommand from earlier phases, replace it; otherwise add this anywhere among the other subcommands.)

- [ ] **Step 4.3: E2E test in `test/mcp.test.js`**

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
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-mcp-cli-"));
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-mcp-cli-out-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.rm(outDir, { recursive: true, force: true });
});

/**
 * Helper: spawn the CLI in `mcp` mode, send one or more JSON-RPC requests
 * over stdin, collect stdout responses, then close. Returns parsed responses.
 */
async function runMcpRequests(requests) {
  const cliPath = fileURLToPath(new URL("../bin/filecap.js", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn("node", [cliPath, "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (d) => stdoutChunks.push(d));
    child.stderr.on("data", (d) => stderrChunks.push(d));
    child.on("error", reject);
    child.on("close", () => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const responses = stdout
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => {
          try { return JSON.parse(l); } catch { return null; }
        })
        .filter(Boolean);
      resolve({ responses, stderr: Buffer.concat(stderrChunks).toString("utf8") });
    });

    for (const req of requests) {
      child.stdin.write(JSON.stringify(req) + "\n");
    }
    // Allow a moment for processing, then close stdin to signal end-of-input.
    setTimeout(() => child.stdin.end(), 1000);
  });
}

describe("filecap mcp CLI", () => {
  it("responds to tools/list with the four tool definitions", async () => {
    const { responses } = await runMcpRequests([
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    ]);
    const listResponse = responses.find((r) => r.id === 1);
    expect(listResponse).toBeDefined();
    expect(listResponse.result.tools.length).toBe(4);
    const names = listResponse.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(["filecap_query_inventory", "filecap_report", "filecap_rollup", "filecap_scan"]);
  });

  it("runs filecap_scan via tools/call and returns the inventory result", async () => {
    await fs.writeFile(path.join(tmpRoot, "a.pdf"), "x");
    const outPath = path.join(outDir, "out.ndjson");

    const { responses } = await runMcpRequests([
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "filecap_scan",
          arguments: {
            directory: tmpRoot,
            output: outPath,
            hash: false,
            introspect: false,
          },
        },
      },
    ]);
    const callResponse = responses.find((r) => r.id === 2);
    expect(callResponse).toBeDefined();
    expect(callResponse.result.content[0].type).toBe("text");
    // The result text is JSON-serialized from runScan
    const inner = JSON.parse(callResponse.result.content[0].text);
    expect(inner.exitCode).toBe(0);
    // The output file exists with header + entry + footer
    const text = await fs.readFile(outPath, "utf8");
    const lines = text.split("\n").filter(Boolean);
    expect(lines.length).toBe(3);
  });
});
```

- [ ] **Step 4.4: Run + lint + commit**

```bash
npx vitest run test/mcp.test.js
npx vitest run                  # 160 total (158 + 2)
npx eslint src/commands/mcp.js bin/filecap.js test/mcp.test.js
git add src/commands/mcp.js bin/filecap.js test/mcp.test.js
git commit -m "feat(cli): wire mcp subcommand to stdio MCP server"
```

---

## Task 5 — Update `src/index.js` exports

Replace `src/index.js` to add the new MCP exports:

Add these export lines among the existing ones:

```js
export { runMcp } from "./commands/mcp.js";
export { TOOL_DEFINITIONS, dispatchTool } from "./mcp/tools.js";
export { queryInventory } from "./mcp/query.js";
```

Verify, run tests, lint, commit.

```bash
node -e "import('./src/index.js').then(m => console.log(Object.keys(m).length, 'exports'))"
# expect 37 (33 prior + 4 new)
npm test
git add src/index.js
git commit -m "feat: re-export MCP machinery from package main"
```

---

## Task 6 — README expansion

Update Status (Phase 7 shipped, Phase 6 → plain shipped, Phase 7 → **shipped**).

Add a new section "MCP server (Phase 7)" after "Report workflow (Phase 6)" and before "What filecap does not do":

````markdown
## MCP server (Phase 7)

filecap can run as an stdio MCP server, exposing its commands as tools that AI agents (Claude Desktop, Claude Code, etc.) can call during conversational audits:

```bash
filecap mcp
```

When invoked from an MCP client, the server exposes four tools:

| Tool | What it does |
|---|---|
| `filecap_scan` | Walk a directory, produce an NDJSON inventory at the specified path |
| `filecap_rollup` | Merge multiple per-server NDJSONs into a consolidated inventory |
| `filecap_report` | Generate vendor handoff package (CSV + summary + flagged lists) |
| `filecap_query_inventory` | Filter/sort entries in an existing NDJSON by size, extension, flags, isImageOnly, etc. |

### Claude Desktop config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your platform:

```json
{
  "mcpServers": {
    "filecap": {
      "command": "npx",
      "args": ["--yes", "@icjia/filecap@1.0.0", "mcp"]
    }
  }
}
```

After restarting Claude Desktop, you can ask things like:
- "Run filecap_scan on /var/strapi/uploads with introspection enabled, write to /tmp/strapi.ndjson"
- "Use filecap_query_inventory on /tmp/consolidated.ndjson to find PDFs over 100 MB on server strapi-prod-02"
- "Generate a report from /tmp/consolidated.ndjson into /tmp/report-2026-Q2/"

### Claude Code config

`.claude/mcp.json` in your project (or `~/.claude/mcp.json` for user-global):

```json
{
  "mcpServers": {
    "filecap": {
      "command": "npx",
      "args": ["--yes", "@icjia/filecap@1.0.0", "mcp"]
    }
  }
}
```

The four tools become available as `filecap_scan`, `filecap_rollup`, `filecap_report`, `filecap_query_inventory` in any Claude Code session in that project.
````

In the phase status table, change Phase 6 from `**shipped**` to `shipped`, and Phase 7 from `planned` to `**shipped**`.

Update the Status paragraph to reflect Phase 7.

Commit: `docs: add Phase 7 MCP server section and update status`.

---

## Task 7 — CHANGELOG [1.0.0]

```markdown
## [1.0.0] — 2026-05-09

### Added

- **MCP server.** New command `filecap mcp` runs an stdio MCP server exposing four tools (`filecap_scan`, `filecap_rollup`, `filecap_report`, `filecap_query_inventory`) for AI agents (Claude Desktop, Claude Code, etc.).
- New programmatic exports: `runMcp`, `TOOL_DEFINITIONS`, `dispatchTool`, `queryInventory`.
- Read-only `queryInventory` helper for filtering/sorting inventories programmatically without going through the MCP server.

### Changed

- Version bumped to **1.0.0** to mark feature-complete v0.x → v1.0 milestone. The v0.x line covered scan (Phase 1), PDF introspection (Phase 2), Office introspection (Phase 3), filename flagging (Phase 4), rollup (Phase 5), report (Phase 6), and now MCP server (Phase 7). The full inventory-to-handoff pipeline is functional end-to-end.

[1.0.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.0
```

Commit: `docs: add [1.0.0] CHANGELOG entry`.

---

## Task 8 — Bump version to 1.0.0

```bash
# Edit package.json: "version": "1.0.0"
npm install --package-lock-only
./bin/filecap.js --version    # expect 1.0.0
npm test                       # expect 160 passing
git add package.json package-lock.json
git commit -m "chore: bump version to 1.0.0"
```

---

## Task 9 — Publish v1.0.0

```bash
git push origin main
./publish first
# Will require an OTP from your authenticator.
# If publish step fails with EOTP, run:
#   npm publish --access public --otp=<6-digit-code>
```

After publish:

```bash
sleep 30
npx --yes @icjia/filecap@1.0.0 --version
```

Expected: `1.0.0`.

---

## End of Phase 7

After Task 9: `@icjia/filecap@1.0.0` published. ~160 tests. The full v0.x → v1.0 roadmap is shipped: scan, introspection (PDF + Office), filename flagging, rollup, report, MCP server. Phase 8 (Strapi-aware mode) lives in a separate package per the design doc and is out of scope for this repo.
