// Orphaned-files audit: detect files with no inbound references, then
// fuzzy-match them against referenced ("live") siblings to identify likely
// upgrade-replaced revisions vs. truly-orphan content.
//
// Inputs to classifyOrphans: cross-ref inventory entries with `references[]`
// populated (i.e. after `filecap cross-references` has run). Entries without
// a `references` field are treated as not-yet-resolved and skipped.
//
// Fuzzy match strategy (deterministic, no Levenshtein):
//   1. Strip Strapi v3 upload-file hash suffix: `_[a-f0-9]{10}` immediately
//      before the extension. Strapi adds this 10-char hex on every typed
//      UploadFile upload — re-uploads of the same logical file always
//      produce a new hash but a stable name prefix.
//   2. Strip explicit version markers: `_vN`, `-vN`, ` (N)`, ` copy [N]`.
//      Bare `_NN` is NOT stripped because of fiscal-year ambiguity
//      (`JAG_FFY_22` would collapse with `JAG_FFY_12` and produce false
//      revision matches).
//   3. Lowercase + collapse whitespace.
//   4. Group by `(normalized stem, extension)` pair.
//
// Within each group, files with `references.length > 0` are "live" and the
// rest are orphans. For each orphan, pick the most-recently-modified live
// sibling as the "replacement" and compute a 0-95% confidence that the
// orphan is an upgrade-replaced revision (older copy that's safe to delete).
//
// Confidence factors:
//   base 70 → +20 for time gap ≥30d → +5 for hash-only difference
//   capped at 95, floored at 0 (newer-than-live or no-live-sibling).

const VERSION_RE_PATTERNS = [
  /[ _-][vV]\d+$/, //  _v2 / -V3
  / \(\d+\)$/, // " (1)"
  / copy(?: \d+)?$/, // " copy", " copy 2"
];

export function normalizeStem(filename) {
  if (typeof filename !== "string") {
    return { stem: "", extension: "", stripped: {} };
  }
  // Split extension: last "." in the basename. No extension → ext = "".
  const lastDot = filename.lastIndexOf(".");
  let stemRaw = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  const extension = lastDot > 0 ? filename.slice(lastDot + 1).toLowerCase() : "";

  const stripped = {};

  // Strip Strapi hash(es) before extension. In practice, sometimes a file
  // already had a hash baked into its filename (someone copied a Strapi-
  // hashed filename into a new "NEW_..." name, then re-uploaded — the new
  // upload appends a second hash). Strip consecutive trailing hashes
  // until no more match.
  const hashes = [];
  while (true) {
    const m = stemRaw.match(/_(?<hash>[a-f0-9]{10})$/);
    if (!m || !m.groups) break;
    hashes.unshift(m.groups.hash);
    stemRaw = stemRaw.slice(0, m.index);
  }
  if (hashes.length > 0) {
    stripped.hash = hashes[hashes.length - 1];
    if (hashes.length > 1) stripped.priorHashes = hashes.slice(0, -1);
  }

  // Strip explicit version suffixes (one pass each, since they can stack:
  // e.g. "Report_v2_5b025d2897" → strip hash → "Report_v2" → strip _v2).
  for (const pat of VERSION_RE_PATTERNS) {
    const m = stemRaw.match(pat);
    if (m) {
      stripped.version = m[0];
      stemRaw = stemRaw.slice(0, m.index);
    }
  }

  const normalized = stemRaw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  return { stem: normalized, extension, stripped };
}

export function groupByStem(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const filename = entry?.filename ?? entry?.path ?? "";
    const { stem, extension } = normalizeStem(filename);
    const key = `${stem}.${extension}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return groups;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDate(s) {
  if (typeof s !== "string" || s.length === 0) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isResolved(entry) {
  return Array.isArray(entry?.references);
}

function isLive(entry) {
  return isResolved(entry) && entry.references.length > 0;
}

function pickReplacement(orphan, liveSiblings) {
  if (liveSiblings.length === 0) return null;
  // Most-recently-modified live sibling. Stable tie-breaker: filename asc.
  const sorted = [...liveSiblings].sort((a, b) => {
    const ad = parseDate(a.modifiedAt)?.getTime() ?? 0;
    const bd = parseDate(b.modifiedAt)?.getTime() ?? 0;
    if (bd !== ad) return bd - ad;
    return (a.filename ?? "").localeCompare(b.filename ?? "");
  });
  return sorted[0];
}

function computeConfidence({ replacement, daysBetween, reasons }) {
  if (!replacement) return 0;
  if (reasons.includes("newer-than-live")) return 0;
  let score = 70;
  if (daysBetween !== null && daysBetween >= 30) score += 20;
  if (reasons.includes("strapi-hash-variant")) score += 5;
  if (reasons.includes("same-batch")) score -= 25;
  return Math.max(0, Math.min(95, score));
}

export function classifyOrphans(entries, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const nowMs = now.getTime();

  // Skip not-yet-resolved entries entirely (references undefined or null).
  const resolvable = entries.filter(isResolved);

  const groups = groupByStem(resolvable);
  const out = [];

  for (const [, group] of groups) {
    const live = group.filter(isLive);
    const orphans = group.filter((e) => !isLive(e));
    if (orphans.length === 0) continue;

    for (const orphan of orphans) {
      const replacement = pickReplacement(orphan, live);

      const orphanDate = parseDate(orphan.modifiedAt);
      const liveDate = replacement ? parseDate(replacement.modifiedAt) : null;
      const daysOld =
        orphanDate !== null
          ? Math.floor((nowMs - orphanDate.getTime()) / MS_PER_DAY)
          : null;
      const daysBetween =
        orphanDate !== null && liveDate !== null
          ? Math.floor((liveDate.getTime() - orphanDate.getTime()) / MS_PER_DAY)
          : null;

      const reasons = [];
      const status = replacement ? "stale-revision" : "truly-unreferenced";

      if (replacement) {
        // Was the orphan and the live file just a Strapi-hash apart?
        const oNorm = normalizeStem(orphan.filename ?? "");
        const lNorm = normalizeStem(replacement.filename ?? "");
        if (
          oNorm.stripped.hash &&
          lNorm.stripped.hash &&
          oNorm.stripped.hash !== lNorm.stripped.hash &&
          oNorm.stem === lNorm.stem &&
          oNorm.extension === lNorm.extension
        ) {
          reasons.push("strapi-hash-variant");
        }
        if (daysBetween !== null && daysBetween < 0) {
          reasons.push("newer-than-live");
        } else if (
          daysBetween !== null &&
          Math.abs(daysBetween) <= 7
        ) {
          reasons.push("same-batch");
        }
      }
      if (daysOld !== null && daysOld > 365) {
        reasons.push("older-than-1yr");
      }

      const replaceabilityConfidence = computeConfidence({
        orphan,
        replacement,
        daysBetween,
        reasons,
      });

      out.push({
        entry: orphan,
        status,
        replacedBy: replacement?.filename ?? null,
        replacedOn: replacement?.modifiedAt ?? null,
        daysBetween,
        daysOld,
        groupSize: group.length,
        reasons,
        replaceabilityConfidence,
      });
    }
  }

  return out;
}
