// CSV emitter for the orphaned-files report.
// Columns: Site | Path | Filename | Type | Size | Modified | Days old |
//          Status | Confidence % | Replaced by | Replaced on | Days between |
//          Reasons | Group size | Public URL

import { csvCell } from "./format.js";

const HEADER = [
  "Site",
  "Path",
  "Filename",
  "Type",
  "Size (bytes)",
  "Modified",
  "Days old",
  "Status",
  "Confidence %",
  "Replaced by",
  "Replaced on",
  "Days between",
  "Reasons",
  "Group size",
  "Public URL",
];

// v1.39.0: cells go through the shared format.js csvCell (imported above) —
// the local re-implementation lacked the formula-injection apostrophe guard.

function buildPublicUrl(entry, source) {
  if (!entry || !source) return "";
  const base = source.publicUrlBase ?? "";
  if (!base) return "";
  const prefix = source.pathPrefix ? `/${source.pathPrefix.replace(/^\/+|\/+$/g, "")}` : "";
  const path = (entry.path ?? entry.filename ?? "").replace(/^\/+/, "");
  // v1.39.0: percent-encode each segment (mirrors csv.js buildPublicUrl) so
  // filenames with spaces/# produce valid URLs.
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${base.replace(/\/+$/, "")}${prefix}/${encodedPath}`;
}

export function writeOrphansCsv({ orphans, sources = [] }) {
  const sourcesByServer = new Map();
  for (const s of sources) {
    if (s.serverName) sourcesByServer.set(s.serverName, s);
  }
  const lines = [HEADER.map(csvCell).join(",")];
  for (const o of orphans) {
    const e = o.entry;
    const serverName = e.serverName ?? "";
    const source = sourcesByServer.get(serverName);
    const siteLabel = source?.siteName ?? serverName ?? "";
    const cells = [
      siteLabel,
      e.path ?? "",
      e.filename ?? "",
      e.extension ?? "",
      e.sizeBytes ?? "",
      e.modifiedAt ?? "",
      o.daysOld ?? "",
      o.status,
      o.replaceabilityConfidence,
      o.replacedBy ?? "",
      o.replacedOn ?? "",
      o.daysBetween ?? "",
      (o.reasons ?? []).join("|"),
      o.groupSize,
      buildPublicUrl(e, source),
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}
