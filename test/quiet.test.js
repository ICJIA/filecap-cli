import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runScan } from "../src/commands/scan.js";

// v1.39.0 (F2): the CLI has advertised --quiet since 1.0 but never honored it.
// quiet suppresses the progress reporter (ticks + final summary); errors and
// warnings still print (bin writes result.error regardless).

let tmpRoot;
let outDir;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-quiet-"));
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-quiet-out-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.rm(outDir, { recursive: true, force: true });
});

function collectorStream() {
  return {
    data: [],
    write(chunk) {
      this.data.push(String(chunk));
      return true;
    },
  };
}

describe("runScan --quiet (F2)", () => {
  it("suppresses progress ticks and the final summary when quiet is set", async () => {
    await fs.writeFile(path.join(tmpRoot, "a.txt"), "x");
    await fs.writeFile(path.join(tmpRoot, "b.txt"), "y");
    const stream = collectorStream();

    const result = await runScan({
      directory: tmpRoot,
      output: path.join(outDir, "quiet.ndjson"),
      hash: false,
      concurrency: 4,
      progress: true,
      quiet: true,
      progressStream: stream,
    });
    expect(result.exitCode).toBe(0);
    expect(stream.data).toEqual([]);
  });

  it("emits progress output to the injected stream when quiet is not set", async () => {
    await fs.writeFile(path.join(tmpRoot, "a.txt"), "x");
    const stream = collectorStream();

    const result = await runScan({
      directory: tmpRoot,
      output: path.join(outDir, "loud.ndjson"),
      hash: false,
      concurrency: 4,
      progress: true,
      progressStream: stream,
    });
    expect(result.exitCode).toBe(0);
    const all = stream.data.join("");
    expect(all).toContain("a.txt");
    expect(all).toContain("done —");
  });
});

function runCli(args, cwd) {
  const cliPath = fileURLToPath(new URL("../bin/filecap.js", import.meta.url));
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (d) => stdout.push(d));
    child.stderr.on("data", (d) => stderr.push(d));
    child.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

describe("filecap scan --quiet CLI plumbing (F2)", () => {
  it("--progress --quiet emits no progress lines on stderr", async () => {
    await fs.writeFile(path.join(tmpRoot, "a.txt"), "x");
    const outPath = path.join(outDir, "cli-quiet.ndjson");
    const result = await runCli(
      ["scan", tmpRoot, "-o", outPath, "--no-hash", "--progress", "--quiet"],
      outDir,
    );
    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("done —");
    expect(result.stderr).not.toContain("a.txt");
  });

  it("--progress without --quiet emits progress lines on stderr (unchanged)", async () => {
    await fs.writeFile(path.join(tmpRoot, "a.txt"), "x");
    const outPath = path.join(outDir, "cli-loud.ndjson");
    const result = await runCli(
      ["scan", tmpRoot, "-o", outPath, "--no-hash", "--progress"],
      outDir,
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("done —");
  });
});
