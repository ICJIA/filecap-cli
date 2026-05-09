import { humanizeBytes } from "./format.js";

const FILENAME_FLAG_PREFIX = "filename-";

export function writeLargestFiles({ entries, limit = 50 }) {
  const sorted = [...entries].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
  const top = sorted.slice(0, limit);
  const lines = ["Largest files (top " + limit + " by size)", "================================"];
  for (const e of top) {
    lines.push(`${humanizeBytes(e.sizeBytes ?? 0).padStart(10)}  ${e.path ?? e.filename ?? ""}`);
  }
  return lines.join("\n") + "\n";
}

export function writeFlaggedFilenames({ entries }) {
  const flagged = entries.filter((e) => {
    const flags = e.flags ?? [];
    return flags.includes("scanned-name-pattern") || flags.some((f) => f.startsWith(FILENAME_FLAG_PREFIX));
  });
  const lines = ["Files with flagged names", "========================"];
  for (const e of flagged) {
    lines.push(`${(e.flags ?? []).join("|").padEnd(40)}  ${e.path ?? e.filename ?? ""}`);
  }
  return lines.join("\n") + "\n";
}

export function writeDuplicateHashes({ entries }) {
  const groups = new Map();
  for (const e of entries) {
    const h = e.sha256;
    if (!h) continue;
    if (!groups.has(h)) groups.set(h, []);
    groups.get(h).push(e);
  }
  const lines = ["Duplicate-hash groups (content-identical files)", "================================================"];
  for (const [hash, group] of groups) {
    if (group.length < 2) continue;
    lines.push(`${hash}`);
    for (const e of group) {
      const where = e.serverName ? `${e.serverName}:${e.path}` : e.path;
      lines.push(`    ${where}`);
    }
  }
  return lines.join("\n") + "\n";
}

export function writePdfImageOnly({ entries }) {
  const filtered = entries.filter(
    (e) => e.introspection?.kind === "pdf" && e.introspection.isImageOnly === true,
  );
  const lines = ["Image-only PDFs (top remediation cost driver)", "============================================="];
  for (const e of filtered) {
    lines.push(`${humanizeBytes(e.sizeBytes ?? 0).padStart(10)}  ${e.path ?? e.filename ?? ""}`);
  }
  return lines.join("\n") + "\n";
}
