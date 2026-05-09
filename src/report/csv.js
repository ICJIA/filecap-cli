import { humanizeBytes, csvCell } from "./format.js";

export const CSV_COLUMNS = [
  "serverName",
  "serverIp",
  "hostname",
  "scannedPath",
  "relativePath",
  "absolutePath",
  "filename",
  "extension",
  "category",
  "remediable",
  "sizeBytes",
  "sizeHuman",
  "modifiedAt",
  "sha256",
  "documentLanguage",
  "pdfPageCount",
  "pdfHasTextLayer",
  "pdfIsImageOnly",
  "pdfHasTags",
  "pdfHasFormFields",
  "pdfHasSignatures",
  "pdfEncrypted",
  "pdfProducer",
  "pdfCreator",
  "pdfCreationDate",
  "docxHasHeadings",
  "docxAltTextCoverage",
  "docxTableCount",
  "docxImageCount",
  "xlsxSheetCount",
  "xlsxHasMergedCells",
  "flags",
];

/**
 * Build a CSV string from a parsed inventory.
 *
 * @param {object} args
 * @param {object} args.sourceHeader - the inventory's header object
 * @param {Array} args.entries - the inventory's entries
 * @param {Array|null} args.sources - sources[] array (consolidated only); null for single-instance
 * @returns {string} CSV content (header row + N data rows, LF-terminated)
 */
export function writeCsv({ sourceHeader, entries, sources }) {
  const isConsolidated = sourceHeader.kind === "filecap-consolidated-header";
  const sourceMap = new Map();
  if (isConsolidated && sources) {
    for (const s of sources) {
      sourceMap.set(s.serverName, s);
    }
  }

  const lines = [CSV_COLUMNS.join(",")];
  for (const entry of entries) {
    const row = buildRow({ entry, sourceHeader, sourceMap, isConsolidated });
    lines.push(row.map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

function buildRow({ entry, sourceHeader, sourceMap, isConsolidated }) {
  let serverName, serverIp, hostname, scannedPath;
  if (isConsolidated) {
    serverName = entry.serverName;
    const src = sourceMap.get(entry.serverName);
    serverIp = src?.serverIp ?? "";
    hostname = src?.hostname ?? "";
    scannedPath = src?.scannedPath ?? "";
  } else {
    const m = sourceHeader.metadata;
    serverName = m.serverName;
    serverIp = m.serverIp;
    hostname = m.hostname;
    scannedPath = m.scannedPath;
  }

  const intro = entry.introspection ?? null;
  const isPdf = intro?.kind === "pdf";
  const isDocx = intro?.kind === "docx";
  const isXlsx = intro?.kind === "xlsx";

  return [
    serverName,
    serverIp,
    hostname,
    scannedPath,
    entry.path,
    entry.absolutePath,
    entry.filename,
    entry.extension,
    entry.category,
    entry.remediable,
    entry.sizeBytes,
    humanizeBytes(entry.sizeBytes),
    entry.modifiedAt,
    entry.sha256 ?? "",
    intro?.documentLanguage ?? "",
    // PDF
    isPdf ? intro.pageCount : "",
    isPdf ? intro.hasTextLayer : "",
    isPdf ? intro.isImageOnly : "",
    isPdf ? intro.hasTags : "",
    isPdf ? intro.hasFormFields : "",
    isPdf ? intro.hasSignatures : "",
    isPdf ? intro.encrypted : "",
    isPdf ? (intro.producer ?? "") : "",
    isPdf ? (intro.creator ?? "") : "",
    isPdf ? (intro.creationDate ?? "") : "",
    // DOCX
    isDocx ? intro.hasHeadings : "",
    isDocx ? (intro.altTextCoverage ?? "") : "",
    isDocx ? intro.tableCount : "",
    isDocx ? intro.imageCount : "",
    // XLSX
    isXlsx ? intro.sheetCount : "",
    isXlsx ? (intro.mergedCellCount > 0) : "",
    // Flags
    (entry.flags ?? []).join("|"),
  ];
}
