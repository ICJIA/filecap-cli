import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

let tmpRoot;
let outDir;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-mcp-cli-"));
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-mcp-cli-out-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.rm(outDir, { recursive: true, force: true });
});

/**
 * Helper: spawn the CLI in `mcp` mode, send one or more JSON-RPC requests
 * over stdin (initialize + actual requests), collect stdout responses, then
 * close. Returns parsed responses.
 *
 * Note: the MCP SDK requires an initialize handshake before tool calls.
 */
async function runMcpRequests(requests) {
  const cliPath = fileURLToPath(new URL("../bin/filecap.js", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn("node", [cliPath, "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (d) => stdoutChunks.push(d));
    child.stderr.on("data", (d) => stderrChunks.push(d));
    child.on("error", reject);
    child.on("close", () => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const responses = stdout
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => {
          try { return JSON.parse(l); } catch { return null; }
        })
        .filter(Boolean);
      resolve({ responses, stderr: Buffer.concat(stderrChunks).toString("utf8") });
    });

    // MCP requires initialize handshake first
    const initRequest = {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    };
    child.stdin.write(JSON.stringify(initRequest) + "\n");
    // Then the initialized notification
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    for (const req of requests) {
      child.stdin.write(JSON.stringify(req) + "\n");
    }
    setTimeout(() => child.stdin.end(), 1500);
  });
}

describe("filecap mcp CLI", () => {
  it("responds to tools/list with the four tool definitions", async () => {
    const { responses } = await runMcpRequests([
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    ]);
    const listResponse = responses.find((r) => r.id === 1);
    expect(listResponse).toBeDefined();
    expect(listResponse.result.tools.length).toBe(4);
    const names = listResponse.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(["filecap_query_inventory", "filecap_report", "filecap_rollup", "filecap_scan"]);
  }, 15000);

  it("runs filecap_scan via tools/call and returns the inventory result", async () => {
    await fs.writeFile(path.join(tmpRoot, "a.pdf"), "x");
    const outPath = path.join(outDir, "out.ndjson");

    const { responses } = await runMcpRequests([
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "filecap_scan",
          arguments: {
            directory: tmpRoot,
            output: outPath,
            hash: false,
            introspect: false,
          },
        },
      },
    ]);
    const callResponse = responses.find((r) => r.id === 2);
    expect(callResponse).toBeDefined();
    expect(callResponse.result.content[0].type).toBe("text");
    const inner = JSON.parse(callResponse.result.content[0].text);
    expect(inner.exitCode).toBe(0);
    const text = await fs.readFile(outPath, "utf8");
    const lines = text.split("\n").filter(Boolean);
    expect(lines.length).toBe(3);
  }, 15000);
});
