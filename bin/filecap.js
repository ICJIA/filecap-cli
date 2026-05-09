#!/usr/bin/env node
import { Command } from "commander";
import { runScan } from "../src/commands/scan.js";
import { runRollup } from "../src/commands/rollup.js";
import { runReport } from "../src/commands/report.js";
import { runMcp } from "../src/commands/mcp.js";
import { runAuditEnrich } from "../src/commands/audit-enrich.js";
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
  .option("--site-name <name>", "Optional human-friendly website nickname (e.g., DVFR, i2i, vpp). Different from --server-name (the operational identifier).")
  .option("--public-url-base <url>", "Base URL where uploaded files are publicly served (e.g., https://example.com/uploads). Added to the CSV and HTML reports as a clickable Public URL column.")
  .option("--audit-link-pattern <template>", "URL template with placeholders ({publicUrl}, {sha256}, {filename}, {path}, {serverIp}, {siteName}) for an external audit service. Rendered as a clickable 'View audit' column in the HTML report.")
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
        siteName: opts.siteName,
        publicUrlBase: opts.publicUrlBase,
        auditLinkPattern: opts.auditLinkPattern,
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
  .command("audit-enrich <inventory>")
  .description("Enrich an inventory NDJSON with audit.icjia.app scores via the bulk-from-inventory endpoint")
  .option("-o, --output <path>", "Write enriched NDJSON here (default: rewrite input in place)")
  .option("--api-base <url>", "Audit service base URL", "https://audit.icjia.app")
  .option("--auth-token <token>", "Bearer token (default: $FILECAP_AUDIT_TOKEN)")
  .option("--verbose", "Print per-file progress to stderr")
  .action(async (inventory, opts) => {
    const authToken = opts.authToken ?? process.env.FILECAP_AUDIT_TOKEN ?? "";
    const result = await runAuditEnrich({
      input: inventory,
      output: opts.output ?? inventory,
      apiBase: opts.apiBase,
      authToken,
      verbose: opts.verbose ?? false,
    });
    if (result.exitCode !== 0) {
      process.stderr.write(`audit-enrich error: ${result.error}\n`);
      process.exit(result.exitCode);
    }
    const s = result.summary;
    process.stderr.write(`Enriched ${s.enrichedEntries} of ${s.manifestResults} results (${s.analyzed} analyzed, ${s.failed} failed of ${s.total} submitted)\n`);
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
