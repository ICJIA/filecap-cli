import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Contract test for logs.sh — the local log viewer, modeled on the
// file-accessibility-audit repo's logs.sh (subcommands + format flags +
// TTY-aware default), adapted to this repo's per-run error logs.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repoRoot, "logs.sh");

let logsDir;

const ROW_A = "2026-08-24T12:00:00Z,error,audits:site-a,audit-error,site-a,https://a.gov/x.pdf,,,failed alpha";
const ROW_B = "2026-08-24T13:00:00Z,error,audits:site-b,audit-error,site-b,https://b.gov/y.pdf,,,failed bravo";
const HEADER = "ts,level,scope,event,site,url,httpStatus,code,message";

beforeEach(() => {
  logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-logssh-"));
  fs.writeFileSync(path.join(logsDir, "errors-20260824-120000Z.csv"), `${HEADER}\n${ROW_A}\n`);
  fs.writeFileSync(path.join(logsDir, "errors-20260824-130000Z.csv"), `${HEADER}\n${ROW_B}\n`);
  fs.writeFileSync(path.join(logsDir, "errors-20260824-120000Z.ndjson"), "{}\n");
  fs.writeFileSync(path.join(logsDir, "full-audit-20260824-140000Z.log"), "line one\nline two\n");
});

afterEach(() => {
  fs.rmSync(logsDir, { recursive: true, force: true });
});

// Run logs.sh; returns { status, stdout, stderr }. Never throws on non-zero.
function run(args) {
  try {
    const stdout = execFileSync("bash", [script, ...args], {
      cwd: repoRoot,
      env: { ...process.env, LOGS_DIR: logsDir },
      encoding: "utf8",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

describe("logs.sh", () => {
  it("--help exits 0 and documents the subcommands", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/recent/);
    expect(r.stdout).toMatch(/list/);
  });

  it("`recent --csv` prints the header and every failure, newest run first", () => {
    const r = run(["recent", "--csv"]);
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split("\n");
    expect(lines[0]).toBe(HEADER);
    expect(r.stdout).toContain("x.pdf");
    expect(r.stdout).toContain("y.pdf");
    // 13:00 (bravo) is newer than 12:00 (alpha) → bravo comes first
    expect(r.stdout.indexOf("y.pdf")).toBeLessThan(r.stdout.indexOf("x.pdf"));
  });

  it("`run <runId> --csv` shows only that run's failures", () => {
    const r = run(["run", "20260824-120000Z", "--csv"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("x.pdf");
    expect(r.stdout).not.toContain("y.pdf");
  });

  it("`list` names the available log files", () => {
    const r = run(["list"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("errors-20260824-130000Z.csv");
    expect(r.stdout).toContain("full-audit-20260824-140000Z.log");
  });

  it("exits 1 and names the valid commands on an unknown command", () => {
    const r = run(["bogus"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/unknown command/i);
    expect(r.stderr).toMatch(/recent/);
  });

  it("exits 1 with a 'whole number' hint when recent's count is not an integer", () => {
    const r = run(["recent", "notanumber"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/whole number/i);
  });
});
