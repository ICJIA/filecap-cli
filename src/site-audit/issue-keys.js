import { createHash } from "node:crypto";
import { normPageUrl } from "../report/pages.js";

// Stable identity for one accessibility issue occurrence: (normalized page URL,
// axe rule id, the element's CSS-selector target). Normalizing the URL keeps the
// key stable across trailing-slash / case variants so a page's issues don't all
// read as "fixed + new" between runs.
export function issueKey(pageUrl, ruleId, nodeTarget) {
  const target = Array.isArray(nodeTarget) ? nodeTarget.join(" ") : String(nodeTarget ?? "");
  return createHash("sha1")
    .update(`${normPageUrl(pageUrl)}|${ruleId ?? ""}|${target}`)
    .digest("hex");
}

// Deduped, sorted set of issue keys across every scored page.
// scoredPages: [{ pageUrl, violations: [{ id, nodes: [{ target }] }] }]
export function collectIssueKeys(scoredPages) {
  const keys = new Set();
  for (const page of scoredPages ?? []) {
    for (const v of page?.violations ?? []) {
      const nodes = Array.isArray(v?.nodes) && v.nodes.length ? v.nodes : [{ target: [] }];
      for (const n of nodes) keys.add(issueKey(page?.pageUrl, v?.id, n?.target));
    }
  }
  return [...keys].sort();
}

// v1.39.0: the same keys grouped by normalized page URL. Stored in the
// sidecar so the NEXT run can restrict its fixed/new diff to pages scored in
// both runs — a page entering/leaving the sample must not masquerade as
// remediation. Pages with zero violations get no entry (the scored-URL set
// comes from the sidecar's pages[], not from this map).
export function collectIssueKeysByPage(scoredPages) {
  const byPage = new Map();
  for (const page of scoredPages ?? []) {
    const url = normPageUrl(page?.pageUrl);
    for (const v of page?.violations ?? []) {
      const nodes = Array.isArray(v?.nodes) && v.nodes.length ? v.nodes : [{ target: [] }];
      for (const n of nodes) {
        if (!byPage.has(url)) byPage.set(url, new Set());
        byPage.get(url).add(issueKey(page?.pageUrl, v?.id, n?.target));
      }
    }
  }
  const out = {};
  for (const [url, keys] of byPage) out[url] = [...keys].sort();
  return out;
}

// Diff two issue-key sets into fixed / introduced / still-open counts.
export function diffIssueSets(prevKeys, currKeys) {
  const prev = new Set(prevKeys ?? []);
  const curr = new Set(currKeys ?? []);
  let fixed = 0;
  let stillOpen = 0;
  for (const k of prev) (curr.has(k) ? stillOpen++ : fixed++);
  let introduced = 0;
  for (const k of curr) if (!prev.has(k)) introduced++;
  return { fixed, introduced, stillOpen };
}
