// Unscored-inventory guard (v1.41.0).
//
// WHY THIS EXISTS
//   web-rollup picks the most-augmented inventory it can find per site:
//     inventory.audited.ndjson → inventory.cross-ref.ndjson → inventory.ndjson
//   That chain is a silent fallback. When the `filecap audits` stage (Stage
//   3.5) dies partway — as it did on 2026-07-27, killed mid-run — the scan
//   stage has ALREADY repointed latest/ at a fresh run dir with no audit
//   data. The next rollup then happily builds a bundle in which every PDF
//   reads as unscored, and (with webRollup.autoDeploy) pushes it over a
//   perfectly good live report. The only signal was the numbers looking wrong.
//
//   So: detect the degraded state, say so loudly, and refuse to DEPLOY it.
//   Building is still allowed — a local bundle is how you diagnose the
//   problem — and --allow-unscored is the escape hatch for the case where
//   publishing a scoreless report really is what you want.
//
// Pure module: plain data in, plain data + strings out. No I/O.

/**
 * A document "carries a grade" only when it has a numeric score. Both the
 * pending documents (never sent to the audit API) and the errored ones (sent,
 * no score back) render as blank Remediation Score cells, so both count as
 * unscored.
 *
 * @param {object} summary - computeSiteSummary() result
 * @returns {{docs: number, scored: number}}
 */
function docTally(summary) {
  const scored = Number(summary?.auditedDocCount) || 0;
  const errored = Number(summary?.auditErrorCount) || 0;
  const pending = Number(summary?.auditPending) || 0;
  return { docs: scored + errored + pending, scored };
}

/**
 * Find sites that have scoreable documents but not one single graded
 * document between them.
 *
 * A PARTIAL score is deliberately not flagged: files land between audit runs,
 * so "68 documents, 61 scored" is the normal steady state. Zero-of-many is
 * the signature of a stage that never ran.
 *
 * @param {Array<{site: object, summary: object}>} siteResults
 * @returns {Array<{name: string, label: string, docs: number}>}
 */
export function findUnscoredSites(siteResults) {
  const out = [];
  for (const sr of siteResults ?? []) {
    const { docs, scored } = docTally(sr?.summary);
    if (docs > 0 && scored === 0) {
      const name = sr?.site?.name ?? "(unnamed)";
      out.push({ name, label: sr?.site?.siteName ?? name, docs });
    }
  }
  return out;
}

/**
 * What to do about it. Blocking is reserved for an actual deploy — a
 * build-only run just warns, because that is the diagnostic path.
 *
 * @param {object} args
 * @param {Array<object>} args.unscored     - findUnscoredSites() result
 * @param {boolean} args.deploy             - is this run going to push to Netlify?
 * @param {boolean} args.allowUnscored      - operator override
 * @returns {{level: "none"|"warn"|"block", block: boolean}}
 */
export function unscoredGuardDecision({ unscored, deploy, allowUnscored }) {
  if (!unscored || unscored.length === 0) return { level: "none", block: false };
  if (deploy && !allowUnscored) return { level: "block", block: true };
  return { level: "warn", block: false };
}

/**
 * Operator-facing explanation. Names every degraded site so the fix is
 * copy-pasteable, and says which stage to re-run.
 *
 * @param {Array<{name: string, label: string, docs: number}>} unscored
 * @returns {string}
 */
export function formatUnscoredWarning(unscored) {
  const width = Math.max(...unscored.map((u) => u.label.length), 0);
  const lines = unscored.map(
    (u) => `    ${u.label.padEnd(width)}  ${String(u.docs).padStart(5)} documents, 0 scored`,
  );
  return [
    `${unscored.length} site(s) have scoreable documents but NO accessibility scores:`,
    ...lines,
    "  The `filecap audits` stage did not produce inventory.audited.ndjson for",
    "  these sites, so every document will render with a blank Remediation Score.",
    "  Re-run:  ./run-full-audit.sh   (or `filecap audits` per site)",
  ].join("\n");
}
