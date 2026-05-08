import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { walk } from "../scanner/walk.js";
import { extractStats } from "../scanner/stats.js";
import { hashFile } from "../scanner/hash.js";
import { categorize, isRemediable } from "../scanner/category.js";
import { createLimiter } from "../util/concurrency.js";
import { Progress } from "../util/progress.js";
import { getHostname, getFirstIPv4 } from "../util/server-id.js";
import { headerSchema, entrySchema, footerSchema, SCHEMA_VERSION } from "../schema/inventory.js";
import { FILECAP_VERSION } from "../version.js";
import { introspect } from "../introspect/index.js";

export async function runScan({
  directory,
  output,
  hash,
  concurrency,
  progress,
  serverName,
  serverIp,
  includeExt,
  excludeExt,
  introspect: introspectEnabled = false,
  maxIntrospectMb = 200,
}) {
  const absoluteRoot = path.resolve(directory);

  try {
    const stat = await fs.stat(absoluteRoot);
    if (!stat.isDirectory()) {
      return { exitCode: 2, error: `${absoluteRoot} is not a directory` };
    }
  } catch {
    return { exitCode: 2, error: `cannot read ${absoluteRoot}` };
  }

  const startedAt = Date.now();

  // Output target: "-" means stdout (Unix convention); anything else is a file path.
  // The SSH-piped workflow uses `filecap scan <dir> -o -` to stream NDJSON back to
  // the local machine. When writing to stdout, we use process.stdout directly so
  // the NDJSON appears on stdout while progress lines go to stderr (separated streams).
  const writeStream = output === "-" ? process.stdout : createWriteStream(output, { encoding: "utf8" });
  let streamClosedNormally = false;

  try {
    function writeLine(obj) {
      return new Promise((resolve, reject) => {
        const ok = writeStream.write(`${JSON.stringify(obj)}\n`, (err) =>
          err ? reject(err) : resolve(),
        );
        if (!ok) writeStream.once("drain", resolve);
      });
    }

    const header = {
      schemaVersion: SCHEMA_VERSION,
      kind: "filecap-inventory-header",
      metadata: {
        serverName: serverName || getHostname(),
        hostname: getHostname(),
        serverIp: serverIp || getFirstIPv4(),
        scannedPath: absoluteRoot,
        scannedAt: new Date().toISOString(),
        filecapVersion: FILECAP_VERSION,
        nodeVersion: process.version,
        options: {
          introspect: introspectEnabled,
          hash,
          maxIntrospectMb,
          concurrency,
        },
      },
    };
    headerSchema.parse(header);
    await writeLine(header);

    const stats = {
      fileCount: 0,
      totalBytes: 0,
      introspectionFailures: 0,
      permissionDenials: 0,
    };

    const reporter = new Progress({ enabled: progress });
    const limit = createLimiter(concurrency);
    const inFlight = [];
    const includeSet = includeExt ? new Set(includeExt.map((e) => e.toLowerCase())) : null;
    const excludeSet = excludeExt ? new Set(excludeExt.map((e) => e.toLowerCase())) : null;

    for await (const item of walk(absoluteRoot)) {
      if (item.kind === "error") {
        if (item.code === "EACCES" || item.code === "EPERM") {
          stats.permissionDenials++;
        }
        continue;
      }

      const filePath = item.path;
      let fileStats;
      try {
        fileStats = await extractStats(filePath);
      } catch (err) {
        if (err.code === "ENOENT") continue; // file vanished mid-scan — skip silently
        if (err.code === "EACCES" || err.code === "EPERM") {
          stats.permissionDenials++;
          continue;
        }
        throw err;
      }
      if (includeSet && !includeSet.has(fileStats.extension)) continue;
      if (excludeSet && excludeSet.has(fileStats.extension)) continue;

      const task = limit(async () => {
        let sha256 = "";
        if (hash) {
          try {
            sha256 = await hashFile(filePath);
          } catch (err) {
            if (err.code === "EACCES" || err.code === "EPERM") {
              stats.permissionDenials++;
              return;
            }
            throw err;
          }
        }

        const category = categorize(fileStats.extension);
        let introspectionResult;
        if (introspectEnabled && isRemediable(category)) {
          try {
            introspectionResult = await introspect({
              filePath,
              extension: fileStats.extension,
              sizeBytes: fileStats.sizeBytes,
              maxIntrospectMb,
            });
          } catch {
            // Empty-on-failure rule: omit the introspection key entirely.
            introspectionResult = undefined;
            stats.introspectionFailures++;
          }
        }
        const entry = {
          path: path.relative(absoluteRoot, filePath),
          absolutePath: filePath,
          filename: path.basename(filePath),
          extension: fileStats.extension,
          category,
          remediable: isRemediable(category),
          sizeBytes: fileStats.sizeBytes,
          modifiedAt: fileStats.modifiedAt,
          sha256,
          flags: [],
        };
        if (introspectionResult !== null && introspectionResult !== undefined) {
          entry.introspection = introspectionResult;
        }
        entrySchema.parse(entry);
        await writeLine(entry);
        stats.fileCount++;
        stats.totalBytes += fileStats.sizeBytes;
        reporter.tick(entry.path);
      });
      inFlight.push(task);
    }

    await Promise.all(inFlight);

    const footer = {
      kind: "filecap-inventory-footer",
      stats: {
        fileCount: stats.fileCount,
        totalBytes: stats.totalBytes,
        scanDurationMs: Date.now() - startedAt,
        introspectionFailures: stats.introspectionFailures,
        permissionDenials: stats.permissionDenials,
      },
    };
    footerSchema.parse(footer);
    await writeLine(footer);

    // Close the file stream so the OS flushes to disk. Do NOT call .end() on
    // process.stdout — closing stdout would prevent any further output (including
    // the progress reporter's final summary line).
    if (output !== "-") {
      await new Promise((resolve, reject) => {
        writeStream.end((err) => (err ? reject(err) : resolve()));
      });
    }
    streamClosedNormally = true;

    reporter.end(`${stats.fileCount} entries, ${stats.totalBytes} bytes`);

    return { exitCode: stats.permissionDenials > 0 ? 3 : 0 };
  } catch (err) {
    return { exitCode: 1, error: err.message };
  } finally {
    if (!streamClosedNormally && output !== "-") {
      writeStream.destroy();
    }
  }
}
