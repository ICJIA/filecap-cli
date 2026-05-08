#!/usr/bin/env node
import { Command } from "commander";
import { runScan } from "../src/commands/scan.js";
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
  .command("rollup")
  .description("(Phase 5 — not yet implemented in v0.1.0)")
  .action(() => {
    process.stderr.write("filecap rollup is not implemented in v0.1.0 (Phase 5).\n");
    process.exit(1);
  });

program
  .command("report")
  .description("(Phase 6 — not yet implemented in v0.1.0)")
  .action(() => {
    process.stderr.write("filecap report is not implemented in v0.1.0 (Phase 6).\n");
    process.exit(1);
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`filecap: ${err.message}\n`);
  process.exit(1);
});
