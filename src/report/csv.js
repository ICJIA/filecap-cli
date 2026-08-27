import { csvCell, boolToYesNo, safeAbsolutePath } from "./format.js";
import { isScoreable, isUnscoreableDocument } from "../scanner/category.js";

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
  // v1.9.0+: the per-document audit column. Slot 6 (immediately after Page
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
  //   audited document with a report → the audit.icjia.app report URL
  //                                    (v1.42.1: the XLSX writer turns it
  //                                    into a real hyperlink cell — plain
  //                                    strings are NOT clickable in .xlsx)
  //   unscoreable/non-document entries → "" (audits step doesn't touch them)
  { name: "auditScore",   label: "Audit Report" },
  { name: "modifiedAt",   label: "Date published" },
  { name: "scannedPath",  label: "Source folder on server" },
  { name: "path",         label: "File location (relative to source folder)" },
  { name: "absolutePath", label: "Full file path on server" },
  { name: "filename",     label: "File name" },
  // v1.20.0 — page count is back. Vendors quote remediation per page, so
  // the spreadsheet needs the number. PDFs get the measured pdfjs count;
  // other formats leave the cell blank (no page count extracted by scan).
  // Dropped in 1.4.1 on the "open it in Acrobat to see" argument; restored
  // here because procurement workflows can't open 3,500+ PDFs by hand.
  { name: "pageCount",    label: "Page Count" },
  { name: "extension",    label: "File extension" },
  { name: "category",     label: "File type" },
  { name: "sizeBytes",    label: "Size (bytes)" },
  { name: "sha256",       label: "Content hash (SHA-256)" },
  { name: "duplicateOf",  label: "Duplicate of" },
  // v1.34.0 — per-file Remediation Score: the audit.icjia.app letter grade
  // and numeric score rendered together as "B/88". Distinct from the
  // "Audit Report" column (which links the shared report): management asked
  // for the grade itself to be readable in the row without opening the
  // report. Empty for unscoreable formats, skips, pendings (errors say
  // "Not scored"). Appended here (before the csvOnly action columns)
  // so it reaches HTML + XLSX while leaving every existing column index
  // unchanged; display position is set per-format (HTML_TABLE_COLUMNS,
  // XLSX_COLUMN_ORDER).
  { name: "remediationScore", label: "Remediation Score" },
  // v1.43.0 — the combined "B/88" cell above reads well but SORTS as text
  // (Excel puts "B/100" before "B/9"), so the number and the letter each
  // get a machine-sortable column of their own. Score is a real number
  // (0-100); Grade is the bare letter (A-F). Both are blank for unscoreable
  // formats, errors, and pending audits — blanks sort to the bottom in Excel, so
  // "sort ascending by Score" surfaces the least accessible files first.
  // Same placement rationale as remediationScore: before the csvOnly
  // action columns; display position per-format (XLSX_COLUMN_ORDER).
  { name: "auditScoreNum", label: "Score (0-100)" },
  { name: "auditGrade",    label: "Grade" },
  // v1.7.16: the CSV-only "action" column that staff fills in. The HTML
  // table view skips it (filtered by `csvOnly`) because the web view is
  // informational — the actionable artefact is the workbook.
  //
  // v1.66.0: the sibling `Delete?` column was REMOVED. Nothing published on
  // a state website can actually be deleted — records-retention policy — so
  // a column inviting "mark this for deletion" offered an outcome that was
  // never on the table, and reviewers read it as a fourth choice competing
  // with the three real ones. The three real outcomes (archive, remediate,
  // as-is) are all recorded here, in Notes. Nothing ever consumed
  // deleteFlag: the "delete-processor" its old comment anticipated was
  // never built.
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
// v1.54.0: takes only entry.audit, so this was already format-agnostic —
// a scored docx/xlsx/pptx with a report URL renders exactly like a PDF's.
//   "<reportUrl>"   — audited document that has a report
//   "Unavailable"   — audit.error set
//   ""              — undefined / skipped / not scoreable / audited but no report
// v1.20.0: Page Count cell. PDFs get the integer measured by pdfjs during
// scan (entry.introspection.pageCount). Non-PDFs and PDFs whose introspection
// failed leave the cell empty. The value is returned as a real number so the
// XLSX writer can store it as numeric (SUM/sort/filter); CSV cell formatting
// stringifies via csvCell() naturally.
export function formatPageCount(entry) {
  if (!entry || entry.category !== "pdf") return "";
  const pc = entry.introspection?.pageCount;
  return typeof pc === "number" && pc >= 0 ? pc : "";
}

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

// v1.54.0: format the Remediation Score cell from a full entry.
//   Scoreable (pdf/docx/xlsx/pptx), scored → "B/88"   (grade/score)
//   Scoreable, audit error               → "Not scored"  (e.g. 413, corrupt)
//   Legacy Office / ODF / RTF            → "N/A (legacy format)"  (convert to
//     .docx/.xlsx/.pptx to make it scoreable — the audit service refuses
//     pre-2007 binary formats because they can't carry the accessibility
//     structures it checks)
//   Scoreable pending/skipped, or not a document → ""  (no final state)
export function formatRemediationScore(entry) {
  if (!entry || typeof entry !== "object") return "";
  if (isUnscoreableDocument(entry)) return "N/A (legacy format)";
  if (!isScoreable(entry)) return "";
  const audit = entry.audit;
  if (!audit || typeof audit !== "object") return "";
  const hasGrade = typeof audit.grade === "string" && audit.grade.length > 0;
  const hasScore = typeof audit.score === "number";
  if (hasGrade && hasScore) return `${audit.grade}/${audit.score}`;
  if (audit.error) return "Not scored";
  return "";
}

// v1.43.0 — the sortable split of the cell above; v1.54.0 widened to every
// scoreable document. Any non-score state is a blank cell so Excel's sort
// never chokes on prose.
export function formatAuditScoreNum(entry) {
  if (!entry || typeof entry !== "object" || !isScoreable(entry)) return "";
  const score = entry.audit?.score;
  return typeof score === "number" ? score : "";
}

export function formatAuditGrade(entry) {
  if (!entry || typeof entry !== "object" || !isScoreable(entry)) return "";
  const grade = entry.audit?.grade;
  return typeof grade === "string" && grade.length > 0 ? grade : "";
}

export function buildPublicUrl({ entry, sourceHeader, sourceMap, isConsolidated }) {
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

export function buildRow({ entry, sourceHeader, sourceMap, isConsolidated }) {
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
  const remediationScore = formatRemediationScore(entry);
  const auditScoreNum = formatAuditScoreNum(entry); // v1.43.0
  const auditGrade = formatAuditGrade(entry);       // v1.43.0
  const pageCount = formatPageCount(entry);

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
    // FC-2026-035: keep only a git GitHub URL; blank a Strapi/Forge server path.
    safeAbsolutePath(entry.absolutePath),
    entry.filename,
    pageCount,
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
    remediationScore,
    auditScoreNum, // v1.43.0
    auditGrade,    // v1.43.0
    // v1.7.16 csvOnly column. The label stays aligned with the CSV_COLUMNS
    // entry; the default comes from the column descriptor so a future column
    // addition just needs the descriptor update.
    CSV_COLUMNS.find((c) => c.name === "notes")?.defaultValue ?? "",
  ];
}

// Re-export for consumers that previously used the boolean helper
export { boolToYesNo };
