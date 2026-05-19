#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runScan } from "../src/commands/scan.js";
import { runRollup } from "../src/commands/rollup.js";
import { runReport } from "../src/commands/report.js";
import { runMcp } from "../src/commands/mcp.js";
import { runWebRollup } from "../src/commands/web-rollup.js";
import { runReferences } from "../src/commands/references.js";
import { runCrossReferences } from "../src/commands/cross-references.js";
import { runAudits } from "../src/commands/audits.js";
import { loadConfig } from "../src/config/load.js";
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
  .command("web-rollup")
  .description("Bundle the most recent scans of every saved site into a static-site directory for manual upload to Netlify or any static host")
  .option("-o, --output <dir>", "Output directory")
  .option("--password <pw>", "Embed SHA-256 of this password in a client-side gate")
  .option("--no-client-gate", "Skip the client-side password gate (use Netlify dashboard Site Password instead)")
  .option("--deploy", "After building the bundle, run `netlify deploy --prod` to push to Netlify")
  .option("--deploy-site <site-id>", "Pass --site <id> to netlify deploy (for non-linked sites)")
  .option("--title <title>", "Title shown on the index page", "filecap fleet audit snapshot")
  .option("--include-site <name...>", "Only bundle these site nicknames")
  .option("--exclude-site <name...>", "Skip these site nicknames")
  .option("--sites-file <path>", "Override saved-sites JSON path")
  .action(async (opts) => {
    const output = opts.output ?? path.join(
      os.homedir(),
      "filecap-audits",
      "_web-rollup",
      new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z",
    );
    const password = opts.password ?? null;
    // Commander sets opts.clientGate = false when --no-client-gate is passed
    const noClientGate = opts.clientGate === false;

    if (noClientGate && password !== null) {
      process.stderr.write("WARN: --password is ignored when --no-client-gate is set.\n");
    }

    let config;
    try {
      config = loadConfig();
    } catch (err) {
      process.stderr.write(`filecap web-rollup error: ${err.message}\n`);
      process.exit(1);
    }
    const wrCfg = config.webRollup ?? {};
    const deploy = opts.deploy ?? wrCfg.autoDeploy ?? false;
    const deploySite = opts.deploySite ?? wrCfg.deploySite ?? null;

    try {
      const result = await runWebRollup({
        output,
        password,
        noClientGate,
        deploy,
        deploySite,
        title: opts.title,
        includeSite: opts.includeSite ?? [],
        excludeSite: opts.excludeSite ?? [],
        sitesFile: opts.sitesFile ?? null,
      });
      if (result.exitCode !== 0) {
        process.stderr.write(`web-rollup error: ${result.error}\n`);
        process.exit(result.exitCode);
      }
      const s = result.summary;
      process.stderr.write(`Bundled ${s.sitesIncluded} site(s) (${s.sitesSkipped} skipped) → ${s.outputDir}\n`);
      process.stderr.write(`Open ${path.join(s.outputDir, "index.html")} to preview\n`);
      if (noClientGate) {
        process.stderr.write(
          "Note: Bundle has NO embedded password gate. Use your Netlify Pro plan's Site Password feature in the dashboard for server-side protection.\n",
        );
      }
    } catch (err) {
      process.stderr.write(`filecap web-rollup error: ${err.message}\n`);
      process.exit(1);
    }
  });

program
  .command("references <siteName>")
  .description(
    "Discover per-entry file references for one site (v1.8.0). Reads the site's references.* config from sites.json (graphqlEndpoint, restApiBase, contentTypeRoutes) and writes an NDJSON sidecar with one record per content entry.",
  )
  .requiredOption(
    "-o, --output <path>",
    "output path for the references sidecar NDJSON",
  )
  .action(async (siteName, opts) => {
    try {
      const sitesPath =
        process.env.FILECAP_SITES_FILE
        ?? path.join(os.homedir(), ".filecap", "sites.json");
      const raw = fs.readFileSync(sitesPath, "utf8");
      const sitesJson = JSON.parse(raw);
      const siteConfig = (sitesJson?.sites ?? []).find(
        (s) => s.name === siteName,
      );
      if (!siteConfig) {
        process.stderr.write(`filecap references: site "${siteName}" not found in ${sitesPath}\n`);
        process.exit(1);
      }
      await runReferences({
        siteConfig,
        sitesJson,
        outputPath: opts.output,
      });
    } catch (err) {
      process.stderr.write(`filecap references error: ${err.message}\n`);
      process.exit(1);
    }
  });

program
  .command("cross-references <inventory>")
  .description(
    "Resolve cross-site references: read per-site sidecars, build the fleet-wide URL → referrers index, and write an augmented inventory with entry.references[] populated.",
  )
  .requiredOption(
    "-s, --sidecar <path>",
    "path to a references sidecar NDJSON (repeatable)",
    (value, prev) => (prev ? [...prev, value] : [value]),
  )
  .requiredOption(
    "-o, --output <path>",
    "output path for the augmented inventory NDJSON",
  )
  .option(
    "--public-url-base <url>",
    "override the inventory's publicUrlBase (rarely needed; usually read from the header metadata)",
  )
  .action(async (inventory, opts) => {
    try {
      const sitesPath =
        process.env.FILECAP_SITES_FILE
        ?? path.join(os.homedir(), ".filecap", "sites.json");
      let sitesJson = { sites: [] };
      try {
        sitesJson = JSON.parse(fs.readFileSync(sitesPath, "utf8"));
      } catch {
        // sites.json is optional for cross-references (the alias map just
        // ends up empty), but log so the operator knows.
        process.stderr.write(
          `filecap cross-references: no sites.json at ${sitesPath} — domain aliases disabled\n`,
        );
      }
      await runCrossReferences({
        inventoryPath: inventory,
        sidecarPaths: Array.isArray(opts.sidecar) ? opts.sidecar : [opts.sidecar],
        sitesJson,
        outputPath: opts.output,
        publicUrlBaseOverride: opts.publicUrlBase,
      });
    } catch (err) {
      process.stderr.write(`filecap cross-references error: ${err.message}\n`);
      process.exit(1);
    }
  });

program
  .command("audits <inventory>")
  .description(
    "Score every PDF in an inventory via audit.icjia.app's /api/audit-url endpoint. Writes an augmented NDJSON with entry.audit populated for each PDF (score, grade, reportUrl). Only PDFs are scored — docx/xlsx/pptx/image files pass through unchanged. Caches by SHA-256 (default 30-day TTL) so subsequent runs short-circuit on unchanged files.",
  )
  .requiredOption(
    "-o, --output <path>",
    "output path for the augmented inventory NDJSON (convention: inventory.audited.ndjson)",
  )
  .option(
    "--audit-endpoint <url>",
    "override the audit.icjia.app endpoint (default https://audit.icjia.app/api/audit-url)",
  )
  .option(
    "--concurrency <n>",
    "max parallel audit requests (default 2 — respects the server's 2-at-a-time pdfAnalyzer semaphore)",
    (v) => parseInt(v, 10),
  )
  .option(
    "--ttl-days <n>",
    "cache TTL in days (default 30) — entries older than this re-audit",
    (v) => parseInt(v, 10),
  )
  .option(
    "--force",
    "ignore the cache and re-audit every PDF (also sends force=true to the server)",
  )
  .option(
    "--cache-path <path>",
    "override the audit-cache.json location (default ~/.filecap/audit-cache.json)",
  )
  .action(async (inventory, opts) => {
    try {
      // 1.8.0-era bearer-token in secrets.json: if present under
      // credentials.audit-icjia-app.bearerToken, send it as Authorization
      // Bearer. With audit.icjia.app currently running anonymous (auth
      // off), no token is needed — but this stays forward-compatible.
      let bearerToken;
      try {
        const secretsPath = path.join(os.homedir(), ".filecap", "secrets.json");
        const s = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
        bearerToken = s?.credentials?.["audit-icjia-app"]?.bearerToken;
      } catch {
        // Secrets file missing or malformed — fine in anonymous mode.
      }
      // v1.9.0-alpha.2: read pathPrefix from sites.json so old Vue 2 ARI
      // Summit sites get the right URL (/static/foo.pdf instead of
      // /foo.pdf). Match the inventory header's serverName against
      // sites[].name. Strapi + Nuxt sites leave pathPrefix unset.
      let pathPrefix = "";
      try {
        const sitesPath = process.env.FILECAP_SITES_FILE
          ?? path.join(os.homedir(), ".filecap", "sites.json");
        const sitesJson = JSON.parse(fs.readFileSync(sitesPath, "utf8"));
        // Cheap header probe: grab the inventory's first non-empty line.
        const invText = fs.readFileSync(inventory, "utf8");
        const firstLine = invText.split("\n").find((l) => l.trim().length > 0);
        if (firstLine) {
          const header = JSON.parse(firstLine);
          const serverName = header?.metadata?.serverName;
          if (typeof serverName === "string") {
            const site = (sitesJson.sites ?? []).find((s) => s.name === serverName);
            if (site?.pathPrefix) pathPrefix = site.pathPrefix;
          }
        }
      } catch {
        // No sites.json or malformed — proceed with empty pathPrefix.
      }
      await runAudits({
        inventoryPath: inventory,
        outputPath: opts.output,
        auditEndpoint: opts.auditEndpoint,
        concurrency: opts.concurrency ?? 2,
        ttlDays: opts.ttlDays ?? 30,
        force: opts.force === true,
        cachePath: opts.cachePath,
        bearerToken,
        pathPrefix,
      });
    } catch (err) {
      process.stderr.write(`filecap audits error: ${err.message}\n`);
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
