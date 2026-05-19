// `filecap cross-references` — fleet-wide reverse-index resolver.
//
// Reads every per-site sidecar (produced by `filecap references`) into one
// global URL → referrers map, then walks an inventory NDJSON and attaches
// entry.references[] to each entry by looking up its canonical Public URL
// in the map. The augmented inventory is what `web-rollup` then renders
// into the per-file Referenced column.

import fs from "node:fs/promises";
import path from "node:path";
import {
  buildReverseIndex,
  resolveEntryReferences,
  buildAliasMap,
} from "../references/cross-resolver.js";

async function loadSidecar(filepath) {
  const text = await fs.readFile(filepath, "utf8");
  const records = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch (err) {
      throw new Error(`failed to parse sidecar line in ${filepath}: ${err.message}`);
    }
  }
  return records;
}

export async function runCrossReferences({
  inventoryPath,
  sidecarPaths,
  sitesJson,
  outputPath,
  publicUrlBaseOverride,
  log = console.error,
}) {
  const allRecords = [];
  for (const p of sidecarPaths) {
    const records = await loadSidecar(p);
    log(`[cross-references] loaded ${records.length} records from ${p}`);
    for (const r of records) allRecords.push(r);
  }
  const aliasMap = buildAliasMap(sitesJson ?? { sites: [] });
  if (aliasMap.size > 0) {
    log(`[cross-references] alias map: ${aliasMap.size} alias hosts`);
  }
  const idx = buildReverseIndex(allRecords, aliasMap);
  log(`[cross-references] reverse-index has ${idx.size} distinct file URLs`);

  const text = await fs.readFile(inventoryPath, "utf8");
  const out = [];
  let publicUrlBase = publicUrlBaseOverride ?? "";
  let consolidatedSources = null;
  let serverNameToBase = null;
  let augmentedCount = 0;
  let matchedCount = 0;

  for (const line of text.split("\n")) {
    if (!line.trim()) {
      out.push(line);
      continue;
    }
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      out.push(line);
      continue;
    }
    if (obj.kind === "filecap-inventory-header") {
      if (!publicUrlBaseOverride) {
        publicUrlBase = obj.metadata?.publicUrlBase ?? "";
      }
      out.push(line);
    } else if (obj.kind === "filecap-consolidated-header") {
      // Consolidated inventories carry per-source publicUrlBase. Build a
      // serverName → base lookup so each entry resolves against the right
      // site's base URL.
      consolidatedSources = obj.metadata?.sources ?? [];
      serverNameToBase = new Map(
        consolidatedSources.map((s) => [s.serverName, s.publicUrlBase ?? ""]),
      );
      out.push(line);
    } else if (
      obj.kind === "filecap-inventory-footer" ||
      obj.kind === "filecap-consolidated-footer"
    ) {
      out.push(line);
    } else {
      // Treat as an entry. Pick the base: per-source for consolidated, header
      // base for single-instance.
      let base = publicUrlBase;
      if (serverNameToBase && obj.serverName) {
        base = serverNameToBase.get(obj.serverName) ?? base;
      }
      const resolved = resolveEntryReferences(obj, base, idx);
      augmentedCount++;
      if (resolved.references.length > 0) matchedCount++;
      out.push(JSON.stringify(resolved));
    }
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, out.join("\n"));
  log(
    `[cross-references] augmented ${augmentedCount} entries (${matchedCount} with references) → ${outputPath}`,
  );
  return { augmentedCount, matchedCount, outputPath };
}
