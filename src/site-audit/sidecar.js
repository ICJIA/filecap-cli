import fs from "node:fs";
import path from "node:path";
import { diffIssueSets } from "./issue-keys.js";

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

export function buildSidecar({ siteName, auditedAt, endpoint, coverage, aggregate, issueKeys, prior = null }) {
  let trend = null;
  if (prior && Array.isArray(prior.issueKeys)) {
    const { fixed, introduced, stillOpen } = diffIssueSets(prior.issueKeys, issueKeys);
    trend = { vsDate: prior.auditedAt ?? null, fixed, new: introduced, stillOpen };
  }
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
