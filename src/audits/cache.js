// Local SHA-256-keyed cache for audit scores.
//
// audit.icjia.app already dedups by SHA-256 server-side (returns cached=true
// without re-running the audit), but cached responses still go through the
// rate-limiter middleware before the cache lookup — meaning we'd still
// consume rate-limit budget on every cached hit. A local cache lets us
// skip the HTTP call entirely for files whose hash we've seen recently.
//
// Cache layout (~/.filecap/audit-cache.json):
//   {
//     "<sha256 hex>": {
//       "score": 49,
//       "grade": "F",
//       "reportUrl": "https://audit.icjia.app/report/<id>",
//       "reportId": "<id>",
//       "reportExpiresAt": "2027-05-18T...",
//       "audited": "2026-05-18T...",
//       "checkedAt": "2026-05-19T..." // when filecap last verified
//     },
//     ...
//   }
//
// File mode 0600 — the cache may carry operator-identifying audit metadata.
// Atomic write (tmp + rename) so concurrent runs don't corrupt the file.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_CACHE_PATH = path.join(
  os.homedir(),
  ".filecap",
  "audit-cache.json",
);

const DEFAULT_TTL_DAYS = 30;

export function loadAuditCache({ cachePath = DEFAULT_CACHE_PATH } = {}) {
  if (!fs.existsSync(cachePath)) return {};
  let raw;
  try {
    raw = fs.readFileSync(cachePath, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    // Defensive: only accept an object at top level. A corrupted file or
    // a partial write shouldn't fail the audits run — start fresh.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

export function saveAuditCache({ cachePath = DEFAULT_CACHE_PATH, cache }) {
  if (!cache || typeof cache !== "object") {
    throw new Error("saveAuditCache: cache must be an object");
  }
  const dir = path.dirname(cachePath);
  fs.mkdirSync(dir, { recursive: true });
  // Atomic write: write to a tmp file alongside, then rename. process.pid
  // suffix lets concurrent runs use distinct tmp files.
  const tmp = `${cachePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, cachePath);
  try { fs.chmodSync(cachePath, 0o600); } catch { /* best effort */ }
}

export function isCacheEntryFresh(entry, { now = new Date(), ttlDays = DEFAULT_TTL_DAYS } = {}) {
  if (!entry || typeof entry !== "object") return false;
  // v1.39.0: entries without a finite score are poisoned "successes" (a 200
  // whose analyzer produced no score used to be cached as {score: null}).
  // Treating them as misses makes previously-poisoned caches self-heal on
  // the next run instead of serving score-less hits for a full TTL.
  if (!Number.isFinite(entry.score)) return false;
  const checkedAt = entry.checkedAt;
  if (typeof checkedAt !== "string") return false;
  const checkedAtMs = Date.parse(checkedAt);
  if (!Number.isFinite(checkedAtMs)) return false;
  const ageMs = now.getTime() - checkedAtMs;
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  return ageMs >= 0 && ageMs < ttlMs;
}
