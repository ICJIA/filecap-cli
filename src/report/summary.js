import { humanizeBytes } from "./format.js";

/**
 * Build a SUMMARY.txt content from a parsed inventory.
 *
 * @param {object} args
 * @param {Array} args.entries
 * @param {Array|null} args.sources
 * @returns {string} multi-line text
 */
export function writeSummary({ entries, sources }) {
  const lines = [];
  lines.push("filecap inventory summary");
  lines.push("=========================");
  lines.push("");
  lines.push(`Total files: ${entries.length}`);
  const totalBytes = entries.reduce((s, e) => s + (e.sizeBytes ?? 0), 0);
  lines.push(`Total bytes: ${totalBytes} (${humanizeBytes(totalBytes)})`);
  lines.push("");

  // By category
  const byCategory = new Map();
  for (const e of entries) {
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1);
  }
  lines.push("By category:");
  const sortedCats = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  for (const [cat, n] of sortedCats) {
    lines.push(`  ${cat}: ${n}`);
  }
  lines.push("");

  // Remediable count
  const remediableCount = entries.filter((e) => e.remediable).length;
  lines.push(`Remediable: ${remediableCount} of ${entries.length}`);
  lines.push("");

  // Image-only PDFs
  const imageOnlyPdfs = entries.filter(
    (e) => e.introspection?.kind === "pdf" && e.introspection.isImageOnly === true,
  ).length;
  lines.push(`image-only PDFs: ${imageOnlyPdfs}`);

  if (sources && sources.length > 0) {
    lines.push("");
    lines.push(`Sources: ${sources.length}`);
    for (const s of sources) {
      lines.push(`  ${s.serverName}: ${s.stats.fileCount} files, ${humanizeBytes(s.stats.totalBytes)}`);
    }
  }

  return lines.join("\n") + "\n";
}
