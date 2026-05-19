// CSV emitter for the orphaned-files report.
// Columns: Site | Path | Filename | Type | Size | Modified | Days old |
//          Status | Confidence % | Replaced by | Replaced on | Days between |
//          Reasons | Group size | Public URL

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

function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildPublicUrl(entry, source) {
  if (!entry || !source) return "";
  const base = source.publicUrlBase ?? "";
  if (!base) return "";
  const prefix = source.pathPrefix ? `/${source.pathPrefix.replace(/^\/+|\/+$/g, "")}` : "";
  const path = (entry.path ?? entry.filename ?? "").replace(/^\/+/, "");
  return `${base.replace(/\/+$/, "")}${prefix}/${path}`;
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
