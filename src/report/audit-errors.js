// Audit-error collection + categorisation for the fleet "File errors" report.
//
// After the audits step some PDFs carry `entry.audit.error` instead of a score
// (audit.icjia.app could not fetch or process the file). Scans from v1.17.0+
// also carry a `content-type-mismatch` flag (the extension says one format, the
// bytes say another). This module gathers both into a per-site list with a
// plain-English likely reason — the input to audit-file-errors.html and .csv.

import { csvCell, publicUrlFor } from "./format.js";

const MB = 1024 * 1024;

// audit.icjia.app's per-file analysis cap (its ANALYSIS.MAX_FILE_SIZE_MB,
// 25 since that repo's v1.70.0). Files over it come back as HTTP 413. Quoted
// in the too-large reasons below; update if the server cap changes.
const AUDIT_SIZE_CAP_MB = 25;

// The public-URL builder (v1.7.40 precedence: base+pathPrefix+per-segment
// encoding, absolutePath tree→blob fallback) lives in format.js as
// `publicUrlFor` since the v1.39.0 post-audit pass — shared with the live
// orphan emitters so every fleet artifact encodes links the same way.

/**
 * Categorise why an entry counts as an error.
 *
 * @param {object} entry - an inventory entry
 * @returns {{kind:string, reason:string}|null} null when the entry has no error
 */
export function categorizeAuditError(entry) {
  if (!entry || typeof entry !== "object") return null;
  const ext = String(entry.extension || "file");
  const auditErr =
    entry.audit && typeof entry.audit === "object" ? entry.audit.error : null;

  if (auditErr) {
    const err = String(auditErr);
    if (/\b422\b|unprocessable/i.test(err)) {
      return {
        kind: "not-a-pdf",
        reason:
          "The audit service rejected it as not a valid PDF — the file is most likely not actually a PDF (for example, an HTML page or another format saved with a .pdf name).",
      };
    }
    if (/\b413\b|payload too large/i.test(err)) {
      // v1.50.0 — a 413 is a verdict, not an outage. The scan already
      // introspected the file locally, so the reason can say what the audit
      // would have found: an image-only scan with no text layer scores 0 on
      // audit.icjia.app's model regardless of anything else, and the fix is
      // OCR + tagging (or the source document), never a bigger audit. Only
      // claim "scan" on explicit introspection evidence.
      const sizeMb = entry.sizeBytes ? Math.round(entry.sizeBytes / MB) : 0;
      const sizeLabel = sizeMb >= 1 ? `${sizeMb} MB` : "of unknown size";
      const intro = entry.introspection ?? {};
      const base = `This file is ${sizeLabel} — over the audit service's ${AUDIT_SIZE_CAP_MB} MB limit — so it was not audited.`;
      if (intro.isImageOnly === true || intro.hasTextLayer === false) {
        return {
          kind: "too-large",
          reason: `${base} Its own metadata shows an image-only scan with no text layer: assistive technology cannot read it as-is, and an audit would score it 0. Remediation means OCR + tagging, or recreating the document from its source — not a bigger audit.`,
        };
      }
      if (intro.hasTextLayer === true) {
        return {
          kind: "too-large",
          reason: `${base} It does carry a text layer; to get it graded, split it into parts under ${AUDIT_SIZE_CAP_MB} MB and audit each part, or run Acrobat's accessibility checker on it locally.`,
        };
      }
      return {
        kind: "too-large",
        reason: `${base} To get it graded, split it into parts under ${AUDIT_SIZE_CAP_MB} MB and audit each part.`,
      };
    }
    if (/server-unavailable|\b5\d\d\b|unavailable|timeout|timed out/i.test(err)) {
      const sizeMb = entry.sizeBytes ? Math.round(entry.sizeBytes / MB) : 0;
      const sizeNote =
        sizeMb >= 1 ? ` (this file is ${sizeMb} MB; large PDFs can time out)` : "";
      return {
        kind: "audit-unavailable",
        reason: `The audit service could not process this file${sizeNote}. Transient outages also cause this — re-running the audit will retry it.`,
      };
    }
    return { kind: "audit-error", reason: `The audit service returned an error: ${err}` };
  }

  if (Array.isArray(entry.flags) && entry.flags.includes("content-type-mismatch")) {
    return {
      kind: "content-mismatch",
      reason: `The file's content does not match its .${ext} extension — it is mislabeled or possibly corrupt.`,
    };
  }

  return null;
}

/**
 * Gather audit errors across the fleet, grouped by site.
 *
 * @param {Array<{entry:object,serverName:string,siteName:string,publicUrlBase:string}>} items
 * @returns {Array<{siteName:string,serverName:string,errors:Array}>} one group
 *          per site — sites with errors first (most errors first), then clean
 *          sites alphabetically. Clean sites carry an empty `errors` array so
 *          the report can state "no file errors" for them explicitly.
 */
export function collectAuditErrors(items) {
  const bySite = new Map();
  for (const it of items ?? []) {
    const siteName = it.siteName || it.serverName || "(unknown)";
    if (!bySite.has(siteName)) {
      bySite.set(siteName, { siteName, serverName: it.serverName || "", errors: [] });
    }
    const cat = categorizeAuditError(it.entry);
    if (!cat) continue;
    const e = it.entry;
    bySite.get(siteName).errors.push({
      filename: e.filename ?? e.path ?? "",
      path: e.path ?? "",
      extension: String(e.extension || ""),
      category: String(e.category || ""),
      sizeBytes: e.sizeBytes ?? 0,
      publicUrl: publicUrlFor(e, it.publicUrlBase, it.pathPrefix),
      error: e.audit?.error ?? (cat.kind === "content-mismatch" ? "content-type-mismatch" : ""),
      kind: cat.kind,
      reason: cat.reason,
    });
  }
  const groups = [...bySite.values()];
  groups.sort((a, b) => {
    if (a.errors.length !== b.errors.length) return b.errors.length - a.errors.length;
    return a.siteName.localeCompare(b.siteName);
  });
  for (const g of groups) {
    g.errors.sort((a, b) => a.filename.localeCompare(b.filename));
  }
  return groups;
}

/**
 * Write the fleet-wide audit-file-errors CSV — one row per errored file.
 *
 * @param {Array} groups - output of collectAuditErrors
 * @returns {string} CSV text
 */
export function writeAuditErrorsCsv(groups) {
  // v1.39.0: shared format.js csvCell — gains the formula-injection
  // apostrophe guard and \r quoting the local re-implementation lacked.
  const cell = csvCell;
  const header = ["Website", "File", "File type", "Size (bytes)", "Public URL", "Error", "Likely reason"];
  const lines = [header.map(cell).join(",")];
  for (const g of groups ?? []) {
    for (const e of g.errors) {
      lines.push(
        [g.siteName, e.filename, e.extension, e.sizeBytes, e.publicUrl, e.error, e.reason]
          .map(cell)
          .join(","),
      );
    }
  }
  return lines.join("\n") + "\n";
}
