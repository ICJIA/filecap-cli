import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  REDACTED,
  redact,
  isoSeconds,
  formatConsoleLine,
  createLogger,
  errorLogToCsv,
  writeErrorLog,
} from "../src/util/logger.js";

describe("redact", () => {
  it("replaces secret-named keys with the redaction marker", () => {
    const out = redact({ Authorization: "Bearer abc123", password: "hunter2", site: "sfs" });
    expect(out.Authorization).toBe(REDACTED);
    expect(out.password).toBe(REDACTED);
    expect(out.site).toBe("sfs");
  });

  it("redacts secrets nested in objects and arrays", () => {
    const out = redact({ headers: { authorization: "Bearer x" }, creds: [{ token: "t" }] });
    expect(out.headers.authorization).toBe(REDACTED);
    expect(out.creds[0].token).toBe(REDACTED);
  });

  it("scrubs bearer tokens and JWTs embedded in ordinary string values", () => {
    const out = redact({ note: "sent Authorization: Bearer eyJhbGciOiJIUzI1.foo.bar to strapi" });
    expect(out.note).not.toMatch(/eyJhbGci/);
    expect(out.note).toContain(REDACTED);
  });

  it("captures an Error as a serializable object with its stack, and never mutates the input", () => {
    const input = { err: new Error("boom") };
    const out = redact(input);
    expect(out.err.name).toBe("Error");
    expect(out.err.message).toBe("boom");
    expect(typeof out.err.stack).toBe("string");
    expect(input.err).toBeInstanceOf(Error); // input untouched
  });

  it("leaves non-secret primitives alone", () => {
    expect(redact({ n: 3, ok: true, s: "hello" })).toEqual({ n: 3, ok: true, s: "hello" });
  });
});

describe("isoSeconds", () => {
  it("formats an ISO-8601 UTC timestamp with no milliseconds", () => {
    expect(isoSeconds(new Date("2026-08-24T12:34:56.789Z"))).toBe("2026-08-24T12:34:56Z");
  });
});

describe("formatConsoleLine", () => {
  it("renders timestamp, level, scope, message, and context", () => {
    const line = formatConsoleLine({
      ts: "2026-08-24T12:00:00Z",
      level: "error",
      scope: "audits",
      message: "audit failed",
      context: { site: "sfs", httpStatus: 500 },
    });
    expect(line).toBe('2026-08-24T12:00:00Z [error] [audits] audit failed {"site":"sfs","httpStatus":500}');
  });
});

describe("createLogger", () => {
  it("collects every record but only prints at or above the minimum level", () => {
    const printed = [];
    const log = createLogger({
      scope: "audits",
      minLevel: "warn",
      sink: (s) => printed.push(s),
      clock: () => new Date("2026-08-24T00:00:00Z"),
    });
    log.info("quiet", { a: 1 });
    log.error("loud", { b: 2 });
    expect(log.records).toHaveLength(2); // both retained
    expect(printed).toHaveLength(1); // only the error printed
    expect(printed[0]).toContain("loud");
  });

  it("redacts secrets in the stored record's context", () => {
    const log = createLogger({ sink: () => {}, clock: () => new Date("2026-08-24T00:00:00Z") });
    log.error("login failed", { url: "https://cms/auth", password: "hunter2" });
    expect(log.records[0].context.password).toBe(REDACTED);
    expect(log.records[0].context.url).toBe("https://cms/auth");
  });

  it("merges a base context into every record, with per-call context winning on conflict", () => {
    const log = createLogger({
      sink: () => {},
      clock: () => new Date("2026-08-24T00:00:00Z"),
      base: { site: "sfs", env: "prod" },
    });
    log.error("boom", { url: "https://x", env: "override" });
    expect(log.records[0].context.site).toBe("sfs"); // from base
    expect(log.records[0].context.url).toBe("https://x"); // from call
    expect(log.records[0].context.env).toBe("override"); // call wins
  });

  it("shares the record store with child loggers so a run has one error log", () => {
    const log = createLogger({ scope: "run", sink: () => {}, clock: () => new Date("2026-08-24T00:00:00Z") });
    const child = log.child("references");
    child.error("boom");
    expect(log.records).toHaveLength(1);
    expect(log.records[0].scope).toBe("references");
  });
});

describe("errorLogToCsv", () => {
  it("emits a header plus one row per record, pulling fields from top level and context", () => {
    const csv = errorLogToCsv([
      { ts: "2026-08-24T12:00:00Z", level: "error", scope: "audits", message: "failed", context: { site: "sfs", url: "https://x/a.pdf", httpStatus: 500, code: "E1", event: "audit-failed" } },
    ]);
    const [header, row] = csv.trimEnd().split("\n");
    expect(header).toBe("ts,level,scope,event,site,url,httpStatus,code,message");
    expect(row).toBe("2026-08-24T12:00:00Z,error,audits,audit-failed,sfs,https://x/a.pdf,500,E1,failed");
  });

  it("neutralizes CSV formula injection in a message", () => {
    const csv = errorLogToCsv([{ ts: "t", level: "error", scope: "s", message: "=cmd|'/c calc'!A1", context: {} }]);
    expect(csv).toContain("'=cmd"); // leading = defused with an apostrophe
  });
});

describe("writeErrorLog", () => {
  it("writes an NDJSON + CSV error log locally and returns their paths and count", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fc-log-"));
    const records = [
      { ts: "2026-08-24T12:00:00Z", level: "error", scope: "audits", message: "failed", context: { site: "sfs" } },
      { ts: "2026-08-24T12:00:01Z", level: "info", scope: "audits", message: "ok", context: {} },
    ];
    const result = await writeErrorLog(records, { dir, runId: "20260824-120000Z" });
    expect(result.count).toBe(1); // only the error/warn record is written
    expect(result.ndjsonPath).toBe(path.join(dir, "errors-20260824-120000Z.ndjson"));
    const ndjson = await fs.readFile(result.ndjsonPath, "utf8");
    expect(ndjson.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(ndjson.trim()).message).toBe("failed");
    const csv = await fs.readFile(result.csvPath, "utf8");
    expect(csv.split("\n")[0]).toBe("ts,level,scope,event,site,url,httpStatus,code,message");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes nothing and returns null when there are no error/warn records", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fc-log-"));
    const result = await writeErrorLog([{ ts: "t", level: "info", scope: "s", message: "ok", context: {} }], {
      dir,
      runId: "r",
    });
    expect(result).toBeNull();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
