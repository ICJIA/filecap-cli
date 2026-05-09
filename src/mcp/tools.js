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
