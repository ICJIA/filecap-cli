import path from "node:path";
import os from "node:os";
import { runScan } from "../commands/scan.js";
import { runRollup } from "../commands/rollup.js";
import { runReport } from "../commands/report.js";
import { runWebRollup } from "../commands/web-rollup.js";
import { queryInventory } from "./query.js";

// v1.63.0 (2026-08-24 audit): default-deny. When FILECAP_MCP_ALLOWED_PATHS is
// unset the server confines all filesystem access to this base rather than
// exposing the whole disk. Operators who need to scan elsewhere set the env
// var explicitly.
const DEFAULT_ALLOWED_ROOT = path.join(os.homedir(), "filecap-audits");

/**
 * The list of allowed root directories: the colon-separated
 * FILECAP_MCP_ALLOWED_PATHS entries, or the default audits base when the env
 * var is unset or empty. Never returns an empty list — an empty allowlist
 * would mean "allow everything", the exact posture this default-deny closes.
 *
 * @returns {string[]}
 */
function allowedRoots() {
  const raw = process.env.FILECAP_MCP_ALLOWED_PATHS;
  const configured = (raw ?? "")
    .split(":")
    .map((s) => s.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : [DEFAULT_ALLOWED_ROOT];
}

/**
 * Check whether `p` is within one of the allowed roots. Returns null when the
 * path is permitted, or an error message string when it is blocked.
 *
 * @param {string} p - resolved absolute path to check
 * @returns {string|null}
 */
function checkAllowedPath(p) {
  const roots = allowedRoots();
  for (const rawRoot of roots) {
    // v1.39.0: strip trailing slashes so "/srv/www/" allows "/srv/www"
    // itself (path.resolve on the argument side never keeps a trailing /).
    const root = rawRoot.replace(/\/+$/, "") || "/";
    if (p === root || p.startsWith(root === "/" ? "/" : root + "/")) return null;
  }
  return `path "${p}" is not in allowed paths (${roots.join(", ")})`;
}

/**
 * v1.39.0: gate EVERY path-typed tool argument, not just scan's directory.
 * Skips null/undefined values (schema-level required checks handle those).
 *
 * @param {Array<string|undefined|null>} paths
 * @returns {string|null} first block message, or null when all pass
 */
function checkAllowedPaths(paths) {
  for (const p of paths) {
    if (p === undefined || p === null) continue;
    const blocked = checkAllowedPath(path.resolve(String(p)));
    if (blocked) return blocked;
  }
  return null;
}

/**
 * v1.40.0 / v1.63.0 — startup posture note. With FILECAP_MCP_ALLOWED_PATHS
 * unset the server confines all filesystem access to the default audits base
 * (default-deny, 2026-08-24 audit). That is a safe default, but it should not
 * be silent — an operator who expected to scan elsewhere needs to know why a
 * path was refused: runMcp() prints this to stderr at startup. Returns null
 * when an explicit allowlist is configured.
 * @returns {string|null}
 */
export function allowedPathsWarning() {
  const raw = process.env.FILECAP_MCP_ALLOWED_PATHS;
  if (raw && raw.split(":").map((s) => s.trim()).filter(Boolean).length > 0) return null;
  return (
    "filecap mcp: FILECAP_MCP_ALLOWED_PATHS is not set — filesystem access is " +
    `restricted to the default audits base ${DEFAULT_ALLOWED_ROOT} ` +
    "(scan/query read and report/web-rollup write only under it). " +
    "Set FILECAP_MCP_ALLOWED_PATHS=/path/one:/path/two to allow other locations."
  );
}

function blockedResult(message) {
  return { isError: true, content: [{ type: "text", text: `error: ${message}` }] };
}

/**
 * v1.39.0: payloads that carry an `error` field (scan exitCode 2, query on a
 * missing file, …) are real failures — mark them isError so MCP clients
 * don't read them as successes.
 */
function toResult(payload) {
  const result = {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
  if (payload && typeof payload === "object" && payload.error) {
    result.isError = true;
  }
  return result;
}

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
        html: { type: "boolean", description: "Also write a self-contained HTML report (default false)" },
      },
      required: ["input", "outputDir"],
    },
  },
  {
    name: "filecap_web_rollup",
    description:
      "Bundle the most recent scans of every saved site into a static-site directory ready for manual upload to Netlify or any static host. Output: a self-contained directory containing index.html (fleet overview), per-site HTML reports, downloadable CSVs, robots.txt blocking indexing, and an optional client-side password gate.",
    inputSchema: {
      type: "object",
      properties: {
        output: { type: "string", description: "Output directory" },
        password: { type: "string", description: "Plaintext password (hashed at build time, never stored)" },
        title: { type: "string", description: "Title for the index page" },
        includeSite: { type: "array", items: { type: "string" }, description: "Only bundle these site nicknames" },
        excludeSite: { type: "array", items: { type: "string" }, description: "Skip these site nicknames" },
        sitesFile: { type: "string", description: "Override saved-sites JSON path" },
      },
      required: ["output"],
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
      const blocked = checkAllowedPaths([args.directory ?? "", args.output]);
      if (blocked) return blockedResult(blocked);
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
      // v1.39.0: surface where the inventory landed (tool description
      // promises the written path). Omitted on failure — nothing usable
      // was written.
      const payload = result.error
        ? result
        : { ...result, outputPath: path.resolve(String(args.output ?? "")) };
      return toResult(payload);
    }
    if (name === "filecap_rollup") {
      const blocked = checkAllowedPaths([...(args.inputs ?? []), args.output]);
      if (blocked) return blockedResult(blocked);
      const result = await runRollup({
        inputs: args.inputs,
        output: args.output,
        strict: args.strict ?? false,
      });
      return toResult(result);
    }
    if (name === "filecap_report") {
      const blocked = checkAllowedPaths([args.input, args.outputDir]);
      if (blocked) return blockedResult(blocked);
      const result = await runReport({
        input: args.input,
        outputDir: args.outputDir,
        html: args.html ?? false,
      });
      return toResult(result);
    }
    if (name === "filecap_web_rollup") {
      // v1.39.0 audit fix (blue-F): sitesFile is path-typed too — gate it.
      // checkAllowedPaths skips null/undefined, so an omitted sitesFile
      // (the normal case) is unaffected.
      const blocked = checkAllowedPaths([args.output, args.sitesFile]);
      if (blocked) return blockedResult(blocked);
      const result = await runWebRollup({
        output: args.output,
        password: args.password ?? null,
        title: args.title ?? "ICJIA Fleet Audit Assessment",
        includeSite: args.includeSite ?? [],
        excludeSite: args.excludeSite ?? [],
        sitesFile: args.sitesFile ?? null,
      });
      return toResult(result);
    }
    if (name === "filecap_query_inventory") {
      const blocked = checkAllowedPaths([args.inventory]);
      if (blocked) return blockedResult(blocked);
      const result = await queryInventory({
        inventory: args.inventory,
        filters: args.filters ?? {},
        limit: args.limit ?? 50,
        sortBy: args.sortBy ?? null,
      });
      return toResult(result);
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
