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
  // v1.8.0: Referenced column. Lists the page URLs that link to this file —
  // computed by the references step + cross-references resolver. The
  // inflection point for managers' delete-or-keep decisions. Cell value:
  //   undefined references → "" (cross-ref step not run yet)
  //   empty references     → "No" (file is orphaned, no known referrers)
  //   one or more refs     → page URLs joined by newlines (one URL per line
  //                          within a single multi-line CSV cell; Excel and
  //                          Google Sheets auto-hyperlink each URL on open).
  { name: "referenced",   label: "Referenced" },
  // v1.7.16: CSV-only "action" columns that staff fills in. The HTML
  // table view skips these (filtered by `csvOnly`) because the web view is
  // informational — the actionable artefact is the CSV.
  //
  // v1.7.28: Delete? defaults to EMPTY instead of "No". CSV cannot carry
  // data validation (no real Yes/No dropdown), and asking staff to set up
  // validation manually in Excel/Sheets adds friction. Empty default lets
  // staff type whatever feels natural — `X`, `YES`, `Y`, `delete`, ✔ — and
  // the (future) delete-processor will treat any non-empty, non-"no" value
  // as "flag for removal." More permissive, less prescriptive.
  { name: "deleteFlag",   label: "Delete?", csvOnly: true, defaultValue: "" },
  { name: "notes",        label: "Notes",   csvOnly: true, defaultValue: "" },
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

function formatReferenced(refs) {
  if (refs == null) return "";
  if (!Array.isArray(refs)) return "";
  if (refs.length === 0) return "No";
  return refs.map((r) => r.pageUrl ?? "").filter(Boolean).join("\n");
}

function buildPublicUrl({ entry, sourceHeader, sourceMap, isConsolidated }) {
  // v1.7.40 — Always build the Public URL from publicUrlBase + entry.path
  // so every link lands on the deployed public site, regardless of site
  // type. For git-type sites this supersedes the v1.7.20 behaviour, which
  // returned a github.com/<owner>/<repo>/blob/<branch>/<rel> URL written
  // to entry.absolutePath by the audit-static.sh path-rewrite step. The
  // GitHub URL was reliable for finding the file content but only worked
  // for users with repo access — broken for anonymous public-website
  // viewers (and for any future private repo). The audited files DO live
  // in the deploy at <publicUrlBase>/<rel>, so the deployed-site URL is
  // the right destination for end users.
  //
  // Trade-off accepted 2026-05-17: some Nuxt static-site deploys have an
  // SPA `_redirects` catch-all that returns the homepage HTML at HTTP 200
  // for any path that doesn't match a deployed asset. If a file ever fell
  // out of the deploy, the link would silently land on the homepage
  // instead of a 404. In practice the audited files are always in the
  // deploy (the audit reads the repo's public/ directory, which is what
  // ships), so this is theoretical. A homepage landing also remains a
  // better failure mode for non-repo viewers than a broken GitHub link.
  //
  // Strapi and remote-server entries are unaffected — their absolutePath
  // is a /home/forge/... filesystem path, never https://, so the
  // publicUrlBase + path shape has always been their URL and stays so.
  let base;
  if (isConsolidated) {
    const src = sourceMap.get(entry.serverName);
    base = src?.publicUrlBase ?? "";
  } else {
    base = sourceHeader.metadata?.publicUrlBase ?? "";
  }
  if (base) {
    const cleanBase = base.replace(/\/+$/, "");
    const cleanPath = (entry.path ?? "").replace(/^\/+/, "");
    return `${cleanBase}/${cleanPath}`;
  }
  // Defensive fallback for legacy inventories missing publicUrlBase but
  // carrying an https:// absolutePath from an older audit-static.sh run.
  const ap = String(entry.absolutePath ?? "");
  if (/^https?:\/\//i.test(ap)) {
    return ap.replace("/tree/", "/blob/");
  }
  return "";
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

  const referenced = formatReferenced(entry.references);

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
    referenced,
    // v1.7.16 csvOnly columns. The labels stay aligned with CSV_COLUMNS
    // entries; defaults come from the column descriptor so a future column
    // addition just needs the descriptor update. v1.7.28: deleteFlag
    // default flipped from "No" → "" (see CSV_COLUMNS comment above).
    CSV_COLUMNS.find((c) => c.name === "deleteFlag")?.defaultValue ?? "",
    CSV_COLUMNS.find((c) => c.name === "notes")?.defaultValue ?? "",
  ];
}

// Re-export for consumers that previously used the boolean helper
export { boolToYesNo };
