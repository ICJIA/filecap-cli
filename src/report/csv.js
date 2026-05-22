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
  // v1.8.0-beta.5: Referenced sits immediately next to Public URL so the
  // file's own URL and the pages that link to it can be read side-by-side
  // without horizontal scrolling. (Earlier 1.8.0 betas had it as column 15.)
  // Cell value:
  //   undefined references → "" (cross-ref step not run yet)
  //   empty references     → "No" (file is orphaned, no known referrers)
  //   one or more refs     → page URLs joined by newlines (one URL per line
  //                          within a single multi-line CSV cell; Excel and
  //                          Google Sheets auto-hyperlink each URL on open).
  //                          Refs whose pageUrl couldn't be resolved render
  //                          as the literal "(no page URL)" so the cell's
  //                          line count matches the reference count and
  //                          unresolved refs don't silently collide with the
  //                          "" / "not run" state.
  { name: "referenced",   label: "Page References" },
  // v1.9.0+: the per-PDF audit column. Slot 6 (immediately after Page
  // References) so the file's referrers and its audit report sit side by
  // side. v1.19.0: the column no longer prints the numeric score / letter
  // grade — the audit.icjia.app scoring heuristic is still being refined,
  // so the cell links to the report instead of asserting a grade — and
  // the column is labelled "Audit Report" (it points at a report).
  //
  // Cell value semantics (CSV):
  //   undefined audit               → "" (audits step not run)
  //   audit.skipped (e.g. no URL)   → "" (we tried but couldn't)
  //   audit.error                   → "Unavailable"
  //   audited PDF with a report     → the audit.icjia.app report URL
  //                                    (Excel + Sheets auto-hyperlink it)
  //   non-PDF entries               → "" (audits step doesn't touch them)
  { name: "auditScore",   label: "Audit Report" },
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
  if (!Array.isArray(refs)) return "";
  if (refs.length === 0) return "No";
  // 1.8.0-beta.5: emit one line per reference. When a reference lacks a
  // pageUrl (no contentTypeRoute match, missing slug, unsafe scheme), write
  // the literal "(no page URL)" so the line count matches the reference
  // count and unresolved refs are visible instead of silently dropped.
  return refs
    .map((r) => (r?.pageUrl ? r.pageUrl : "(no page URL)"))
    .join("\n");
}

// 1.9.0: format the audit.icjia.app audit into a CSV cell.
// 1.19.0: the numeric score + letter grade are no longer written into the
// cell — the audit.icjia.app scoring heuristic is still being refined, so
// the spreadsheet links to the report rather than stating a grade. The
// cell holds only the report URL (Excel + Sheets auto-hyperlink it on
// open); the score lives in that report.
//   "<reportUrl>"   — audited PDF that has a report
//   "Unavailable"   — audit.error set
//   ""              — undefined / skipped / not a PDF / audited but no report
function formatAuditScore(audit) {
  if (!audit || typeof audit !== "object") return "";
  if (audit.skipped) return "";
  if (audit.error) return "Unavailable";
  if (typeof audit.score !== "number") return "";
  if (typeof audit.reportUrl === "string" && audit.reportUrl.length > 0) {
    return audit.reportUrl;
  }
  return "";
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
  let pathPrefix;
  if (isConsolidated) {
    const src = sourceMap.get(entry.serverName);
    base = src?.publicUrlBase ?? "";
    // v1.9.0: pathPrefix is populated by web-rollup from sites.json for
    // sites where the repo's public directory deploys to a non-root URL
    // path (old Vue 2 ARI Summit sites). Strapi + Nuxt sites leave it
    // unset and the URL building is unaffected.
    pathPrefix = src?.pathPrefix ?? "";
  } else {
    base = sourceHeader.metadata?.publicUrlBase ?? "";
    pathPrefix = sourceHeader.metadata?.pathPrefix ?? "";
  }
  if (base) {
    const cleanBase = base.replace(/\/+$/, "");
    const cleanPath = (entry.path ?? "").replace(/^\/+/, "");
    const cleanPrefix = pathPrefix
      ? "/" + String(pathPrefix).replace(/^\/+|\/+$/g, "")
      : "";
    // v1.12.2: percent-encode each path segment so filenames with spaces
    // (common on the pre-CMS sites) produce valid URLs.
    const encodedPath = cleanPath.split("/").map(encodeURIComponent).join("/");
    return `${cleanBase}${cleanPrefix}/${encodedPath}`;
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
  const auditScore = formatAuditScore(entry.audit);

  return [
    serverName,
    siteName,
    serverIp,
    publicUrl,
    referenced,
    auditScore,
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
