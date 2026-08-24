// Structured logging for the pipeline (v1.63.0).
//
// Modeled on the file-accessibility-audit repo's errorLog/auditLog services,
// adapted to this build-time tool's NDJSON+CSV idiom. Goals:
//   - Rich, debuggable error records: timestamp, level, scope, message, and a
//     free-form `context` (site, url, file, httpStatus, code, error+stack, …) —
//     "as much data as possible".
//   - A per-run artefact managers/auditors can read: `errors-<runId>.ndjson`
//     (everything) plus `errors-<runId>.csv` (a readable subset). These are
//     written LOCALLY under ~/filecap-audits/_runs/ — NEVER inside the deployed
//     bundle, so they can't reintroduce the origin-infra exposure FC-2026-033
//     stripped.
//   - No secret ever reaches a log. Every record is passed through `redact`:
//     secret-named keys (authorization/password/token/…) and bearer/JWT strings
//     become "[redacted]" before the record is stored or printed.
//
// The console sink and the clock are injectable so the whole thing is unit
// tested without touching stderr, the filesystem, or the wall clock.

import path from "node:path";
import fsPromises from "node:fs/promises";
import { csvCell } from "../report/format.js";

export const REDACTED = "[redacted]";

// Keys whose VALUE is a secret regardless of content.
const SECRET_KEY = /^(authorization|password|passwd|token|bearer|secret|api[_-]?key|apikey|cookie|set-cookie|jwt|client[_-]?secret)$/i;
// Secret SHAPES that can appear inside an otherwise-ordinary string value.
const BEARER_IN_STRING = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const JWT_IN_STRING = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9._-]{6,}/g;

/**
 * Deep-copy a value with every secret removed. Objects and arrays recurse;
 * a key matching SECRET_KEY has its value replaced wholesale; string values
 * have embedded bearer tokens / JWTs scrubbed; Error instances become
 * `{ name, message, stack, code }` (so a stack is captured for debugging while
 * staying JSON-serializable). The input is never mutated.
 *
 * @param {*} value
 * @returns {*}
 */
export function redact(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message),
      stack: scrubString(value.stack),
      ...(value.code !== undefined ? { code: value.code } : {}),
    };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? REDACTED : redact(v);
    }
    return out;
  }
  if (typeof value === "string") return scrubString(value);
  return value;
}

function scrubString(s) {
  if (typeof s !== "string") return s;
  return s.replace(BEARER_IN_STRING, REDACTED).replace(JWT_IN_STRING, REDACTED);
}

/**
 * ISO-8601 UTC timestamp with the milliseconds trimmed (matches the reference
 * repo's error-log timestamp format).
 * @param {Date|number|string} date
 * @returns {string}
 */
export function isoSeconds(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Render one record as a human-readable console line:
 *   `<ts> [<level>] [<scope>] <message> <context-json>`
 * @param {object} rec
 * @returns {string}
 */
export function formatConsoleLine(rec) {
  const scope = rec.scope ? ` [${rec.scope}]` : "";
  const hasCtx = rec.context && Object.keys(rec.context).length > 0;
  const ctx = hasCtx ? ` ${JSON.stringify(rec.context)}` : "";
  return `${rec.ts} [${rec.level}]${scope} ${rec.message}${ctx}`;
}

export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Create a logger. Every call records a structured entry (retained in
 * `.records`) AND, when the level clears `minLevel`, prints a human line to
 * `sink`. `child(scope)` returns a logger that writes into the SAME record
 * store, so one run accumulates a single error log across subsystems.
 *
 * @param {object} [opts]
 * @param {string} [opts.scope]
 * @param {"debug"|"info"|"warn"|"error"} [opts.minLevel]
 * @param {(line: string) => void} [opts.sink]  console sink (default stderr)
 * @param {() => Date} [opts.clock]
 * @param {object[]} [opts.records]  shared store (used by child loggers)
 * @param {object} [opts.base]  context fields merged into every record (e.g.
 *   `{ site }`); a per-call context key overrides the base value.
 * @returns {object}
 */
export function createLogger({
  scope = "",
  minLevel = "info",
  sink = (line) => process.stderr.write(line + "\n"),
  clock = () => new Date(),
  records = [],
  base = {},
} = {}) {
  function emit(level, message, context = {}) {
    const rec = {
      ts: isoSeconds(clock()),
      level,
      scope,
      message: scrubString(String(message ?? "")),
      context: redact({ ...base, ...(context ?? {}) }),
    };
    records.push(rec);
    if (LEVELS[level] >= (LEVELS[minLevel] ?? LEVELS.info)) sink(formatConsoleLine(rec));
    return rec;
  }
  return {
    records,
    scope,
    error: (message, context) => emit("error", message, context),
    warn: (message, context) => emit("warn", message, context),
    info: (message, context) => emit("info", message, context),
    debug: (message, context) => emit("debug", message, context),
    child: (childScope, childBase) =>
      createLogger({ scope: childScope, minLevel, sink, clock, records, base: { ...base, ...(childBase ?? {}) } }),
  };
}

// Columns for the manager/auditor-facing CSV. The NDJSON carries everything
// (including stack traces and the full context); the CSV is the readable
// subset. Values are drawn from the record's top level first, then context.
const CSV_COLUMNS = ["ts", "level", "scope", "event", "site", "url", "httpStatus", "code", "message"];

/**
 * Serialize error records to CSV, defusing spreadsheet formula injection via
 * the shared `csvCell` guard (a filename/message beginning `= + - @` can't run
 * when the auditor opens the file in Excel).
 * @param {object[]} records
 * @returns {string}
 */
export function errorLogToCsv(records) {
  const header = CSV_COLUMNS.join(",");
  const rows = (records ?? []).map((r) =>
    CSV_COLUMNS.map((col) => {
      const v = r?.[col] !== undefined ? r[col] : r?.context?.[col];
      return csvCell(v === null || v === undefined ? "" : String(v));
    }).join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

/**
 * Write a run's error log to `dir` as `errors-<runId>.ndjson` (full records)
 * and `errors-<runId>.csv` (readable subset). Only error/warn records are
 * written by default — the artefact is a failure report. Returns the paths and
 * count, or null when there is nothing to report.
 *
 * @param {object[]} records
 * @param {object} opts
 * @param {string} opts.dir
 * @param {string} opts.runId
 * @param {object} [opts.fs]  fs/promises seam (mkdir, writeFile)
 * @param {boolean} [opts.onlyErrors=true]
 * @returns {Promise<{ndjsonPath:string, csvPath:string, count:number}|null>}
 */
export async function writeErrorLog(records, { dir, runId, fs = fsPromises, onlyErrors = true }) {
  const relevant = (records ?? []).filter((r) =>
    onlyErrors ? r.level === "error" || r.level === "warn" : true,
  );
  if (relevant.length === 0) return null;
  await fs.mkdir(dir, { recursive: true });
  const ndjsonPath = path.join(dir, `errors-${runId}.ndjson`);
  const csvPath = path.join(dir, `errors-${runId}.csv`);
  await fs.writeFile(ndjsonPath, relevant.map((r) => JSON.stringify(r)).join("\n") + "\n");
  await fs.writeFile(csvPath, errorLogToCsv(relevant));
  return { ndjsonPath, csvPath, count: relevant.length };
}
