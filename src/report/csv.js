import { csvCell, boolToYesNo } from "./format.js";

// CSV / HTML deliverable columns. Keeps only what a remediator needs to find
// and price each file. All format-specific introspection (PDF page count,
// image-only/OCR flag, DOCX heading coverage, XLSX sheet count, document
// language, legacy Office format hint, etc.) was dropped in 1.4.0/1.4.1 —
// remediators open the file in Adobe Acrobat / Word / Excel and see the same
// properties directly. The full introspection is still carried in the NDJSON
// inventory for tooling that wants it (MCP query_inventory, custom reports).
// v1.7.2: Public URL promoted from column 8 → column 4 so it's visible without
// horizontal scrolling. Managers and remediators open the URL more often than
// any other column, so it belongs near the front of the row.
export const CSV_COLUMNS = [
  { name: "serverName",   label: "Server" },
  { name: "siteName",     label: "Website" },
  { name: "serverIp",     label: "Server IP" },
  { name: "publicUrl",    label: "Public URL" },
  { name: "modifiedAt",   label: "Date published" },
  { name: "scannedPath",  label: "Source folder on server" },
  { name: "path",         label: "File location (relative to source folder)" },
  { name: "absolutePath", label: "Full file path on server" },
  { name: "filename",     label: "File name" },
  { name: "extension",    label: "File extension" },
  { name: "category",     label: "File type" },
  { name: "sizeBytes",    label: "Size (bytes)" },
  { name: "sha256",       label: "Content hash (SHA-256)" },
  { name: "duplicateOf",  label: "Duplicate of" },
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

  const duplicateOf = entry.duplicateOf
    ? `${entry.duplicateOf.serverName}:${entry.duplicateOf.path}`
    : "";

  return [
    serverName,
    siteName,
    serverIp,
    publicUrl,
    entry.modifiedAt,
    scannedPath,
    entry.path,
    entry.absolutePath,
    entry.filename,
    entry.extension,
    entry.category,
    entry.sizeBytes,
    (() => {
      const hash = entry.sha256 ?? "";
      if (!hash) return "";
      // Wrap in Excel text-formula syntax so Excel does NOT auto-convert to
      // scientific notation. The cell renders as the literal hash string in
      // Excel, Numbers, Google Sheets, and any tool that follows CSV escaping.
      return `="${hash}"`;
    })(),
    duplicateOf,
  ];
}

// Re-export for consumers that previously used the boolean helper
export { boolToYesNo };
