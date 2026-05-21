// Audit-error collection + categorisation for the fleet "File errors" report.
//
// After the audits step some PDFs carry `entry.audit.error` instead of a score
// (audit.icjia.app could not fetch or process the file). Scans from v1.17.0+
// also carry a `content-type-mismatch` flag (the extension says one format, the
// bytes say another). This module gathers both into a per-site list with a
// plain-English likely reason — the input to audit-file-errors.html and .csv.

const MB = 1024 * 1024;

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
 * Build the public URL for an entry — mirrors the per-row logic used elsewhere
 * in the rollup (publicUrlBase + path, or an absolute GitHub URL).
 */
function publicUrlFor(entry, publicUrlBase) {
  const ap = String(entry?.absolutePath ?? "");
  if (/^https?:\/\//i.test(ap)) return ap.replace("/tree/", "/blob/");
  const base = String(publicUrlBase ?? "").replace(/\/+$/, "");
  const p = String(entry?.path ?? entry?.filename ?? "").replace(/^\/+/, "");
  return base && p ? `${base}/${p}` : "";
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
      publicUrl: publicUrlFor(e, it.publicUrlBase),
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
  const cell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
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
