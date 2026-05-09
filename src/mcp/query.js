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
