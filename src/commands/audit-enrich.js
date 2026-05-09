import fs from "node:fs/promises";

/**
 * Enriches an inventory NDJSON with per-file audit scores from
 * audit.icjia.app's /api/bulk-from-inventory endpoint.
 *
 * @param {object} args
 * @param {string} args.input - Path to existing inventory NDJSON
 * @param {string} args.output - Path to write enriched NDJSON (can equal input for in-place)
 * @param {string} args.apiBase - e.g. "https://audit.icjia.app"
 * @param {string} args.authToken - Bearer token; pulled from FILECAP_AUDIT_TOKEN env var by caller
 * @param {boolean} [args.verbose=false] - Print per-file progress
 * @returns {Promise<{exitCode: number, summary: object, error?: string}>}
 */
export async function runAuditEnrich({ input, output, apiBase, authToken, verbose = false }) {
  // 1. Read inventory NDJSON entirely (we need to send it as a single body and rewrite it)
  let raw;
  try {
    raw = await fs.readFile(input, "utf8");
  } catch (err) {
    return { exitCode: 2, error: `cannot read ${input}: ${err.message}`, summary: null };
  }

  // 2. Sanity-check it's NDJSON with a header
  const firstLine = raw.split("\n", 1)[0];
  let header;
  try {
    header = JSON.parse(firstLine);
  } catch {
    return { exitCode: 2, error: "input is not valid NDJSON (could not parse first line)", summary: null };
  }
  if (!header.kind?.endsWith("-header")) {
    return { exitCode: 2, error: "input does not start with a valid filecap header", summary: null };
  }

  // 3. POST to bulk endpoint
  const url = `${apiBase.replace(/\/+$/, "")}/api/bulk-from-inventory`;
  if (verbose) process.stderr.write(`POST ${url}\n`);

  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: raw,
    });
  } catch (err) {
    return { exitCode: 1, error: `network error calling ${url}: ${err.message}`, summary: null };
  }

  if (!resp.ok) {
    const errText = await resp.text();
    return {
      exitCode: 1,
      error: `audit API returned ${resp.status} ${resp.statusText}: ${errText.slice(0, 500)}`,
      summary: null,
    };
  }

  let manifest;
  try {
    manifest = await resp.json();
  } catch (err) {
    return { exitCode: 1, error: `audit API response was not valid JSON: ${err.message}`, summary: null };
  }

  if (!manifest.results || !Array.isArray(manifest.results)) {
    return { exitCode: 1, error: "audit API response missing 'results' array", summary: null };
  }

  // 4. Build a lookup: sha256 OR path → audit data
  const auditByKey = new Map();
  for (const r of manifest.results) {
    if (r.error) continue; // skip failed entries
    if (r.overallScore === undefined || !r.reportId) continue;

    const auditData = {
      score: Math.round(r.overallScore),
      grade: r.grade,
      reportId: r.reportId,
      reportUrl: `${apiBase.replace(/\/+$/, "")}/report/${r.reportId}`, // user-facing URL
      enrichedAt: new Date().toISOString(),
    };
    if (r.sha256) auditByKey.set(`sha:${r.sha256}`, auditData);
    if (r.path) auditByKey.set(`path:${r.path}`, auditData);
  }

  // 5. Stream-rewrite the NDJSON, augmenting matching entries
  const lines = raw.split("\n");
  const outLines = [];
  let enrichedCount = 0;
  for (const line of lines) {
    if (!line.trim()) {
      outLines.push(line);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      outLines.push(line);
      continue;
    }
    if (parsed.kind && (parsed.kind.endsWith("-header") || parsed.kind.endsWith("-footer"))) {
      outLines.push(line);
      continue;
    }
    // Entry — try to find matching audit data
    const audit =
      auditByKey.get(`sha:${parsed.sha256 ?? ""}`) ??
      auditByKey.get(`path:${parsed.path ?? ""}`);
    if (audit) {
      parsed.audit = audit;
      enrichedCount++;
    }
    outLines.push(JSON.stringify(parsed));
  }

  // 6. Write output
  try {
    await fs.writeFile(output, outLines.join("\n"));
  } catch (err) {
    return { exitCode: 2, error: `cannot write ${output}: ${err.message}`, summary: null };
  }

  return {
    exitCode: 0,
    summary: {
      total: manifest.summary?.total ?? 0,
      analyzed: manifest.summary?.analyzed ?? 0,
      failed: manifest.summary?.failed ?? 0,
      enrichedEntries: enrichedCount,
      manifestResults: manifest.results.length,
    },
  };
}
