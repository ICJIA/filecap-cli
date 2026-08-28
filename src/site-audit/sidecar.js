import fs from "node:fs";
import path from "node:path";
import { diffIssueSets } from "./issue-keys.js";
import { normPageUrl } from "../report/pages.js";

export const SIDECAR_SCHEMA = 1;
const HISTORY_CAP = 24;

export function readPriorSidecar(sidecarPath) {
  try {
    const obj = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Union of the per-page key arrays whose (normalized) page URL is in urlSet.
function keysForUrls(byPage, urlSet) {
  const keys = new Set();
  for (const [url, arr] of Object.entries(byPage)) {
    if (!urlSet.has(normPageUrl(url))) continue;
    for (const k of arr ?? []) keys.add(k);
  }
  return [...keys];
}

// v1.39.0: the fixed/new diff is computed ONLY over pages scored in BOTH
// runs. Before, the whole issue-key sets were diffed, so a page leaving the
// scored sample counted all its issues as "fixed" and a page entering
// counted them all as "new" — coverage change masquerading as remediation.
// Coverage shifts are reported separately as trend.coverageChanged.
function computeTrend({ prior, aggregate, issueKeys, issueKeysByPage }) {
  if (!prior) return null;
  const priorByPage = isPlainObject(prior.issueKeysByPage) ? prior.issueKeysByPage : null;
  const priorFlat = Array.isArray(prior.issueKeys) ? prior.issueKeys : null;
  if (!priorByPage && !priorFlat) return null;
  const vsDate = prior.auditedAt ?? null;

  if (!Array.isArray(prior.pages)) {
    // Defensive: a prior with no pages[] (filecap never writes one, but the
    // file is operator-visible) — coverage is unknowable, keep the legacy
    // whole-set diff.
    const priorKeys = priorFlat ?? Object.values(priorByPage).flat();
    const { fixed, introduced, stillOpen } = diffIssueSets(priorKeys, issueKeys);
    return { vsDate, fixed, new: introduced, stillOpen };
  }

  const currUrls = new Set((aggregate.pages ?? []).map((p) => normPageUrl(p?.url)));
  const priorUrls = new Set(prior.pages.map((p) => normPageUrl(p?.url)));
  const common = new Set([...currUrls].filter((u) => priorUrls.has(u)));
  const coverageChanged = {
    added: currUrls.size - common.size,
    removed: priorUrls.size - common.size,
  };
  const coverageSame = coverageChanged.added === 0 && coverageChanged.removed === 0;

  let priorKeys;
  if (priorByPage) {
    priorKeys = keysForUrls(priorByPage, common);
  } else if (coverageSame) {
    // Legacy prior (pre-1.39, flat keys only): identical page sets make the
    // whole set equal to the restricted set.
    priorKeys = priorFlat;
  } else {
    // Legacy prior + coverage shift: flat keys can't be attributed to
    // pages, so restricted counts are uncomputable. Suppress the trend
    // (renders as "no trend yet") rather than report fake fixed/new.
    // One-release transitional: sidecars written from v1.39.0 on carry
    // issueKeysByPage.
    return null;
  }

  let currKeys;
  if (isPlainObject(issueKeysByPage)) {
    currKeys = keysForUrls(issueKeysByPage, common);
  } else if (coverageSame) {
    currKeys = issueKeys;
  } else {
    return null;
  }

  const { fixed, introduced, stillOpen } = diffIssueSets(priorKeys, currKeys);
  return { vsDate, fixed, new: introduced, stillOpen, coverageChanged };
}

export function buildSidecar({ siteName, auditedAt, endpoint, coverage, aggregate, issueKeys, issueKeysByPage = null, prior = null, sitemapCoverage = null }) {
  const trend = computeTrend({ prior, aggregate, issueKeys, issueKeysByPage });
  const history = Array.isArray(prior?.scoreHistory) ? prior.scoreHistory.slice() : [];
  history.push({ date: auditedAt, score: aggregate.score, outstandingTotal: aggregate.outstanding.total });

  return {
    schema: SIDECAR_SCHEMA,
    siteName,
    auditedAt,
    endpoint,
    coverage,
    score: aggregate.score,
    grade: aggregate.grade,
    outstanding: aggregate.outstanding,
    trend,
    issueKeys,
    // v1.39.0: per-page keys let the NEXT run diff only pages scored in
    // both runs. Omitted when the caller doesn't supply the map.
    ...(isPlainObject(issueKeysByPage) ? { issueKeysByPage } : {}),
    // v1.68.0 — which live pages the site's sitemap.xml omits, already
    // classified (retired / noindex / broken absences are not findings).
    ...(isPlainObject(sitemapCoverage) ? { sitemapCoverage } : {}),
    scoreHistory: history.slice(-HISTORY_CAP),
    pages: aggregate.pages,
  };
}

export function writeSidecar(sidecarPath, sidecar) {
  fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
  const tmp = `${sidecarPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(sidecar, null, 2));
  fs.renameSync(tmp, sidecarPath);
}
