import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { writeCsv } from "../report/csv.js";
import { writeSummary } from "../report/summary.js";
import {
  writeLargestFiles,
  writeFlaggedFilenames,
  writeDuplicateHashes,
  writePdfImageOnly,
} from "../report/flagged.js";
import { writeHtml } from "../report/html.js";

/**
 * Orchestrate the report generation: read the inventory NDJSON line-by-line,
 * collect header/entries/footer, then write all output artifacts.
 *
 * @param {object} args
 * @param {string} args.input - path to inventory NDJSON
 * @param {string} args.outputDir - directory to write reports into (created if missing)
 * @returns {Promise<{exitCode: number, error?: string}>}
 */
export async function runReport({ input, outputDir, html = false }) {
  let header;
  const entries = [];

  let stream;
  try {
    await fs.access(input);
    stream = createReadStream(input, { encoding: "utf8" });
  } catch (err) {
    return { exitCode: 2, error: `cannot read ${input}: ${err.message}` };
  }

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.length === 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed.kind === "filecap-inventory-header" || parsed.kind === "filecap-consolidated-header") {
      header = parsed;
    } else if (parsed.kind === "filecap-inventory-footer" || parsed.kind === "filecap-consolidated-footer") {
      // footer encountered; nothing to do here (we already collected what we need)
    } else {
      entries.push(parsed);
    }
  }

  if (!header) {
    return { exitCode: 2, error: `${input} is missing a header — partial or malformed` };
  }

  await fs.mkdir(outputDir, { recursive: true });

  const isConsolidated = header.kind === "filecap-consolidated-header";
  const sources = isConsolidated ? header.metadata.sources : null;

  const csv = writeCsv({ sourceHeader: header, entries, sources });
  await fs.writeFile(path.join(outputDir, "files.csv"), csv);

  const summary = writeSummary({ entries, sources });
  await fs.writeFile(path.join(outputDir, "SUMMARY.txt"), summary);

  await fs.writeFile(path.join(outputDir, "largest_files.txt"), writeLargestFiles({ entries }));
  await fs.writeFile(path.join(outputDir, "flagged_filenames.txt"), writeFlaggedFilenames({ entries }));
  await fs.writeFile(path.join(outputDir, "duplicate_hashes.txt"), writeDuplicateHashes({ entries }));
  await fs.writeFile(path.join(outputDir, "pdf_image_only.txt"), writePdfImageOnly({ entries }));

  if (html) {
    await writeHtml({
      sourceHeader: header,
      entries,
      sources,
      outputPath: path.join(outputDir, "files.html"),
    });
  }

  return { exitCode: 0 };
}
