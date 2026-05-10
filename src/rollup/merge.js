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
  const allEntries = [];

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

    const sourceStats = {
      fileCount: entries.length,
      totalBytes: entries.reduce((sum, e) => sum + (e.sizeBytes ?? 0), 0),
      scanDurationMs: 0,
      introspectionFailures: 0,
      permissionDenials: 0,
    };
    const sourceEntry = { ...header.metadata, stats: sourceStats };
    // siteName and publicUrlBase are already spread from header.metadata
    // if present; ensure they're only included when non-empty strings (schema allows optional).
    if (!sourceEntry.siteName) {
      delete sourceEntry.siteName;
    }
    if (!sourceEntry.publicUrlBase) {
      delete sourceEntry.publicUrlBase;
    }
    sources.push(sourceEntry);

    const sourceServerName = header.metadata.serverName;
    for (const entry of entries) {
      allEntries.push({ entry, sourceServerName });
    }
  }

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

  const canonicalKeyByHash = new Map();
  let totalDuplicateGroups = 0;
  let bytesSavedIfDeduped = 0;
  for (const [hash, list] of groupsByHash) {
    if (list.length > 1) {
      const canonical = pickCanonical(list);
      canonicalKeyByHash.set(hash, `${canonical.serverName}::${canonical.path}`);
      totalDuplicateGroups++;
      bytesSavedIfDeduped += (list.length - 1) * canonical.sizeBytes;
    } else {
      canonicalKeyByHash.set(hash, `${list[0].serverName}::${list[0].path}`);
    }
  }

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
