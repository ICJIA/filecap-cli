#!/usr/bin/env node
import { Command } from "commander";
import { runScan } from "../src/commands/scan.js";
import { runRollup } from "../src/commands/rollup.js";
import { runReport } from "../src/commands/report.js";
import { runMcp } from "../src/commands/mcp.js";
import { getHostname } from "../src/util/server-id.js";
import { FILECAP_VERSION } from "../src/version.js";

const program = new Command();

program
  .name("filecap")
  .description("File inventory CLI for accessibility audit scoping")
  .version(FILECAP_VERSION);

function commaList(value) {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function positiveInt(value, label) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${label} must be a positive integer, got ${value}`);
  }
  return n;
}

program
  .command("scan <directory>")
  .description("Walk a directory and produce an NDJSON inventory")
  .option(
    "-o, --output <path>",
    "output path",
    `filecap-${getHostname()}.ndjson`,
  )
  .option("-s, --server-name <name>", "override server identifier in metadata")
  .option("--server-ip <ip>", "override server IP in metadata")
  .option("--no-hash", "skip SHA-256 hashing")
  .option("--no-introspect", "skip PDF/Office introspection (filesystem stats only)")
  .option(
    "--max-introspect-mb <n>",
    "skip introspection for files larger than this (MB)",
    (v) => positiveInt(v, "--max-introspect-mb"),
    200,
  )
  .option("--include-ext <list>", "comma-separated extensions to include", commaList)
  .option("--exclude-ext <list>", "comma-separated extensions to exclude", commaList)
  .option(
    "--concurrency <n>",
    "parallel hashing workers",
    (v) => positiveInt(v, "--concurrency"),
    4,
  )
  .option("--progress", "emit progress to stderr", false)
  .option("--quiet", "suppress non-error output", false)
  .action(async (directory, opts) => {
    try {
      const result = await runScan({
        directory,
        output: opts.output,
        hash: opts.hash,
        concurrency: opts.concurrency,
        progress: opts.progress,
        serverName: opts.serverName,
        serverIp: opts.serverIp,
        includeExt: opts.includeExt,
        excludeExt: opts.excludeExt,
        introspect: opts.introspect,
        maxIntrospectMb: opts.maxIntrospectMb,
      });
      if (result.error) {
        process.stderr.write(`${result.error}\n`);
      }
      process.exit(result.exitCode);
    } catch (err) {
      process.stderr.write(`filecap: ${err.message}\n`);
      process.exit(1);
    }
  });

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

program
  .command("report <inventory>")
  .description("Generate vendor handoff package (CSV + summary + flagged lists) from an inventory NDJSON")
  .option("-o, --output <dir>", "output directory", `./filecap-report-${Date.now()}/`)
  .option("--html", "also write a self-contained sortable HTML report (files.html)", false)
  .action(async (inventory, opts) => {
    try {
      const result = await runReport({ input: inventory, outputDir: opts.output, html: opts.html });
      if (result.error) process.stderr.write(`${result.error}\n`);
      process.exit(result.exitCode);
    } catch (err) {
      process.stderr.write(`filecap: ${err.message}\n`);
      process.exit(1);
    }
  });

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

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`filecap: ${err.message}\n`);
  process.exit(1);
});
