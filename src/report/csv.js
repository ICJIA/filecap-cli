import { csvCell, boolToYesNo } from "./format.js";

export const CSV_COLUMNS = [
  { name: "serverName",               label: "Server" },
  { name: "siteName",                 label: "Website" },
  { name: "serverIp",                 label: "Server IP" },
  { name: "modifiedAt",               label: "Date published" },
  { name: "remediable",               label: "Remediation needed?" },
  { name: "scannedPath",              label: "Source folder on server" },
  { name: "path",                     label: "File location (relative to source folder)" },
  { name: "absolutePath",             label: "Full file path on server" },
  { name: "publicUrl",                label: "Public URL" },
  { name: "filename",                 label: "File name" },
  { name: "extension",                label: "File extension" },
  { name: "category",                 label: "File type" },
  { name: "sizeBytes",                label: "Size (bytes)" },
  { name: "sha256",                   label: "Content hash (SHA-256)" },
  { name: "duplicateOf",              label: "Duplicate of" },
  { name: "pageCount",                label: "PDF: page count" },
  { name: "hasTextLayer",             label: "PDF: has searchable text" },
  { name: "isImageOnly",              label: "PDF: image-only (needs OCR)" },
  { name: "hasTags",                  label: "PDF: structurally tagged" },
  { name: "hasFormFields",            label: "PDF: has form fields" },
  { name: "encrypted",                label: "PDF: encrypted" },
  { name: "documentLanguage",         label: "Document language" },
  // DOCX and XLSX-specific introspection columns (heading-style coverage, alt
  // text, merged cells, etc.) were removed in 1.4.0. Remediators have tools
  // (Word, Excel, Adobe Acrobat) that surface those properties directly; the
  // CSV / HTML deliverable focuses on the fields they need to *find* and *price*
  // each file: filename, path, type, server, size, duplicate marker, public URL.
  // The underlying NDJSON still carries the full introspection for any future
  // tooling that needs it (e.g., MCP query_inventory, custom reports).
  { name: "officeLegacyFormat",       label: "Legacy Office format" },
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

  const lines = [CSV_COLUMNS.map((c) => csvCell(c.label)).join(",")];
  for (const entry of entries) {
    const row = buildRow({ entry, sourceHeader, sourceMap, isConsolidated });
    lines.push(row.map((v) => csvCell(formatValue(v))).join(","));
  }
  return lines.join("\n") + "\n";
}

function formatValue(v) {
  if (v === true) return "Yes";
  if (v === false) return "No";
  return v;
}

function formatRemediable(remediable) {
  if (remediable === true) return "Yes — needs accessibility audit";
  if (remediable === false) return "No — reference file (image, placeholder, etc.)";
  return "";
}

function buildPublicUrl({ entry, sourceHeader, sourceMap, isConsolidated }) {
  let base;
  if (isConsolidated) {
    const src = sourceMap.get(entry.serverName);
    base = src?.publicUrlBase ?? "";
  } else {
    base = sourceHeader.metadata?.publicUrlBase ?? "";
  }
  if (!base) return "";
  const cleanBase = base.replace(/\/+$/, "");
  const cleanPath = (entry.path ?? "").replace(/^\/+/, "");
  return `${cleanBase}/${cleanPath}`;
}

function buildRow({ entry, sourceHeader, sourceMap, isConsolidated }) {
  let serverName, siteName, serverIp, scannedPath;
  if (isConsolidated) {
    serverName = entry.serverName;
    const src = sourceMap.get(entry.serverName);
    siteName = src?.siteName ?? "";
    serverIp = src?.serverIp ?? "";
    scannedPath = src?.scannedPath ?? "";
  } else {
    const m = sourceHeader.metadata;
    serverName = m.serverName;
    siteName = m.siteName ?? "";
    serverIp = m.serverIp;
    scannedPath = m.scannedPath;
  }

  const publicUrl = buildPublicUrl({ entry, sourceHeader, sourceMap, isConsolidated });

  const intro = entry.introspection ?? null;
  const isPdf = intro?.kind === "pdf";
  const isDocx = intro?.kind === "docx";
  const isXlsx = intro?.kind === "xlsx";
  const isLegacy = intro?.kind === "office-legacy";

  const duplicateOf = entry.duplicateOf
    ? `${entry.duplicateOf.serverName}:${entry.duplicateOf.path}`
    : "";

  return [
    serverName,
    siteName,
    serverIp,
    entry.modifiedAt,
    formatRemediable(entry.remediable),
    scannedPath,
    entry.path,
    entry.absolutePath,
    publicUrl,
    entry.filename,
    entry.extension,
    entry.category,
    entry.sizeBytes,
    (() => {
      const hash = entry.sha256 ?? "";
      if (!hash) return "";
      // Wrap in Excel text-formula syntax so Excel does NOT auto-convert to scientific notation.
      // The cell renders as the literal hash string in Excel, Numbers, Google Sheets, and any
      // tool that follows CSV escaping rules.
      return `="${hash}"`;
    })(),
    duplicateOf,
    // PDF
    isPdf ? intro.pageCount : "",
    isPdf ? intro.hasTextLayer : "",
    isPdf ? intro.isImageOnly : "",
    isPdf ? intro.hasTags : "",
    isPdf ? intro.hasFormFields : "",
    isPdf ? intro.encrypted : "",
    intro?.documentLanguage ?? "",
    // DOCX
    isDocx ? intro.hasHeadings : "",
    isDocx ? intro.imageCount : "",
    isDocx ? (intro.altTextCoverage ?? "") : "",
    isDocx ? intro.tableCount : "",
    isDocx ? (intro.tablesHaveHeaders ?? "") : "",
    isDocx ? intro.vagueLinkCount : "",
    // XLSX
    isXlsx ? intro.sheetCount : "",
    // Legacy
    isLegacy ? intro.format : "",
  ];
}

// Re-export for consumers that previously used the boolean helper
export { boolToYesNo };
