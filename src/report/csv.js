import { csvCell, boolToYesNo } from "./format.js";

export const CSV_COLUMNS = [
  { name: "serverName",            label: "Server" },
  { name: "siteName",              label: "Website" },
  { name: "serverIp",              label: "Server IP" },
  { name: "scannedPath",           label: "Source folder on server" },
  { name: "path",                  label: "File location (relative to source folder)" },
  { name: "absolutePath",          label: "Full file path on server" },
  { name: "publicUrl",             label: "Public URL" },
  { name: "filename",              label: "File name" },
  { name: "extension",             label: "File extension" },
  { name: "category",              label: "File type" },
  { name: "remediable",            label: "Needs remediation" },
  { name: "sizeBytes",             label: "Size (bytes)" },
  { name: "modifiedAt",            label: "Last modified" },
  { name: "sha256",                label: "Content hash (SHA-256)" },
  { name: "duplicateOf",           label: "Duplicate of" },
  { name: "flags",                 label: "File-name flags" },
  { name: "pageCount",             label: "PDF: page count" },
  { name: "hasTextLayer",          label: "PDF: has searchable text" },
  { name: "textLayerCoverage",     label: "PDF: text coverage (fraction)" },
  { name: "isImageOnly",           label: "PDF: image-only (needs OCR)" },
  { name: "hasTags",               label: "PDF: structurally tagged" },
  { name: "hasOutline",            label: "PDF: has bookmarks/outline" },
  { name: "hasFormFields",         label: "PDF: has form fields" },
  { name: "hasSignatures",         label: "PDF: digitally signed" },
  { name: "encrypted",             label: "PDF: encrypted" },
  { name: "isLinearized",          label: "PDF: web-optimized (linearized)" },
  { name: "pdfVersion",            label: "PDF version" },
  { name: "documentLanguage",      label: "Document language" },
  { name: "producer",              label: "PDF producer" },
  { name: "creator",               label: "PDF creator" },
  { name: "creationDate",          label: "Created" },
  { name: "pdfTitle",              label: "PDF: title" },
  { name: "pdfAuthor",             label: "PDF: author" },
  { name: "pdfSubject",            label: "PDF: subject" },
  { name: "pdfKeywords",           label: "PDF: keywords" },
  { name: "pdfModificationDate",   label: "PDF: modified date" },
  { name: "pdfApproxWordCount",    label: "PDF: approximate word count" },
  { name: "docxHasHeadings",       label: "DOCX: has headings" },
  { name: "docxImageCount",        label: "DOCX: image count" },
  { name: "docxAltTextCoverage",   label: "DOCX: alt-text coverage (fraction)" },
  { name: "docxTableCount",        label: "DOCX: table count" },
  { name: "docxTablesHaveHeaders", label: "DOCX: tables have header rows" },
  { name: "docxHyperlinkCount",    label: "DOCX: hyperlink count" },
  { name: "docxVagueLinkCount",    label: "DOCX: vague hyperlinks (\"click here\")" },
  { name: "docxTitle",             label: "DOCX: title" },
  { name: "docxAuthor",            label: "DOCX: author" },
  { name: "docxLastModifiedBy",    label: "DOCX: last modified by" },
  { name: "docxWordCount",         label: "DOCX: word count" },
  { name: "docxParagraphCount",    label: "DOCX: paragraph count" },
  { name: "docxHeadingLevelsUsed", label: "DOCX: heading levels used" },
  { name: "xlsxSheetCount",        label: "XLSX: sheet count" },
  { name: "xlsxSheetNames",        label: "XLSX: sheet names" },
  { name: "xlsxDefaultSheetNameCount", label: "XLSX: default sheet names (Sheet1, Sheet2, …)" },
  { name: "xlsxHasHeaderRows",     label: "XLSX: has header rows" },
  { name: "xlsxMergedCellCount",   label: "XLSX: merged cell count" },
  { name: "xlsxHasCharts",         label: "XLSX: has charts" },
  { name: "xlsxHasImages",         label: "XLSX: has embedded images" },
  { name: "xlsxTitle",             label: "XLSX: title" },
  { name: "xlsxAuthor",            label: "XLSX: author" },
  { name: "xlsxTotalCells",        label: "XLSX: total cells" },
  { name: "officeLegacyFormat",    label: "Legacy Office format" },
  { name: "auditLink",             label: "Audit Link" },
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

  // Resolve audit link pattern
  let auditLink = "";
  {
    let pattern;
    if (isConsolidated) {
      const src = sourceMap.get(entry.serverName);
      pattern = src?.auditLinkPattern ?? "";
    } else {
      pattern = sourceHeader.metadata?.auditLinkPattern ?? "";
    }
    if (pattern) {
      auditLink = expandAuditLinkTemplate(pattern, entry, sourceHeader, sourceMap);
    }
  }

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
    scannedPath,
    entry.path,
    entry.absolutePath,
    publicUrl,
    entry.filename,
    entry.extension,
    entry.category,
    entry.remediable,
    entry.sizeBytes,
    entry.modifiedAt,
    (() => {
      const hash = entry.sha256 ?? "";
      if (!hash) return "";
      // Wrap in Excel text-formula syntax so Excel does NOT auto-convert to scientific notation.
      // The cell renders as the literal hash string in Excel, Numbers, Google Sheets, and any
      // tool that follows CSV escaping rules.
      return `="${hash}"`;
    })(),
    duplicateOf,
    (entry.flags ?? []).join("|"),
    // PDF
    isPdf ? intro.pageCount : "",
    isPdf ? intro.hasTextLayer : "",
    isPdf ? (intro.textLayerCoverage ?? "") : "",
    isPdf ? intro.isImageOnly : "",
    isPdf ? intro.hasTags : "",
    isPdf ? (intro.hasOutline ?? "") : "",
    isPdf ? intro.hasFormFields : "",
    isPdf ? intro.hasSignatures : "",
    isPdf ? intro.encrypted : "",
    isPdf ? (intro.isLinearized ?? "") : "",
    isPdf ? (intro.pdfVersion ?? "") : "",
    intro?.documentLanguage ?? "",
    isPdf ? (intro.producer ?? "") : "",
    isPdf ? (intro.creator ?? "") : "",
    isPdf ? (intro.creationDate ?? "") : "",
    isPdf ? (intro.title ?? "") : "",
    isPdf ? (intro.author ?? "") : "",
    isPdf ? (intro.subject ?? "") : "",
    isPdf ? (intro.keywords ?? "") : "",
    isPdf ? (intro.modificationDate ?? "") : "",
    isPdf ? (intro.approxWordCount ?? "") : "",
    // DOCX
    isDocx ? intro.hasHeadings : "",
    isDocx ? intro.imageCount : "",
    isDocx ? (intro.altTextCoverage ?? "") : "",
    isDocx ? intro.tableCount : "",
    isDocx ? (intro.tablesHaveHeaders ?? "") : "",
    isDocx ? intro.hyperlinkCount : "",
    isDocx ? intro.vagueLinkCount : "",
    isDocx ? (intro.title ?? "") : "",
    isDocx ? (intro.author ?? "") : "",
    isDocx ? (intro.lastModifiedBy ?? "") : "",
    isDocx ? (intro.wordCount ?? "") : "",
    isDocx ? (intro.paragraphCount ?? "") : "",
    isDocx ? (intro.headingLevelsUsed ?? []).join("|") : "",
    // XLSX
    isXlsx ? intro.sheetCount : "",
    isXlsx ? intro.sheetNames.join("|") : "",
    isXlsx ? intro.defaultSheetNameCount : "",
    isXlsx ? intro.hasHeaderRows : "",
    isXlsx ? intro.mergedCellCount : "",
    isXlsx ? intro.hasCharts : "",
    isXlsx ? intro.hasImages : "",
    isXlsx ? (intro.title ?? "") : "",
    isXlsx ? (intro.author ?? "") : "",
    isXlsx ? (intro.totalCells ?? "") : "",
    // Legacy
    isLegacy ? intro.format : "",
    // Audit link
    auditLink,
  ];
}

function expandAuditLinkTemplate(pattern, entry, header, sourceMap) {
  let publicUrl = "";
  let urlBase, siteName, serverIp;
  const isConsolidated = header.kind === "filecap-consolidated-header";
  if (isConsolidated) {
    const src = sourceMap.get(entry.serverName);
    urlBase = src?.publicUrlBase;
    siteName = src?.siteName;
    serverIp = src?.serverIp;
  } else {
    urlBase = header.metadata?.publicUrlBase;
    siteName = header.metadata?.siteName;
    serverIp = header.metadata?.serverIp;
  }
  if (urlBase) {
    const cleanBase = urlBase.replace(/\/+$/, "");
    const cleanPath = (entry.path ?? "").replace(/^\/+/, "");
    publicUrl = `${cleanBase}/${cleanPath}`;
  }

  return pattern
    .replace(/\{publicUrl\}/g, encodeURIComponent(publicUrl))
    .replace(/\{sha256\}/g, encodeURIComponent(entry.sha256 ?? ""))
    .replace(/\{filename\}/g, encodeURIComponent(entry.filename ?? ""))
    .replace(/\{path\}/g, encodeURIComponent(entry.path ?? ""))
    .replace(/\{serverIp\}/g, encodeURIComponent(serverIp ?? ""))
    .replace(/\{siteName\}/g, encodeURIComponent(siteName ?? ""));
}

// Re-export for consumers that previously used the boolean helper
export { boolToYesNo };
