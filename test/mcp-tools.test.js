import { describe, it, expect, afterEach } from "vitest";
import { TOOL_DEFINITIONS, dispatchTool } from "../src/mcp/tools.js";

describe("dispatchTool — filecap_scan path allowlist", () => {
  const savedEnvHolder = {};

  afterEach(() => {
    if (savedEnvHolder.val !== undefined) {
      process.env.FILECAP_MCP_ALLOWED_PATHS = savedEnvHolder.val;
    } else {
      delete process.env.FILECAP_MCP_ALLOWED_PATHS;
    }
    savedEnvHolder.val = undefined;
  });

  it("allows scan when FILECAP_MCP_ALLOWED_PATHS is not set", async () => {
    savedEnvHolder.val = process.env.FILECAP_MCP_ALLOWED_PATHS;
    delete process.env.FILECAP_MCP_ALLOWED_PATHS;
    const fs = await import("node:fs/promises");
    const nodePath = await import("node:path");
    const os = await import("node:os");
    const tmpRoot = await fs.mkdtemp(nodePath.join(os.tmpdir(), "fc-allow-"));
    const outPath = nodePath.join(tmpRoot, "scan.ndjson");
    const result = await dispatchTool("filecap_scan", { directory: tmpRoot, output: outPath });
    expect(result.isError).toBeFalsy();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("rejects scan outside allowed paths when FILECAP_MCP_ALLOWED_PATHS is set", async () => {
    savedEnvHolder.val = process.env.FILECAP_MCP_ALLOWED_PATHS;
    const nodePath = await import("node:path");
    const os = await import("node:os");
    const allowed = nodePath.join(os.tmpdir(), "fc-allowed-dir");
    process.env.FILECAP_MCP_ALLOWED_PATHS = allowed;
    const result = await dispatchTool("filecap_scan", {
      directory: os.homedir(),
      output: "/tmp/should-not-exist.ndjson",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not in allowed paths/i);
  });

  it("allows scan inside an allowed path (subdirectory)", async () => {
    savedEnvHolder.val = process.env.FILECAP_MCP_ALLOWED_PATHS;
    const fs = await import("node:fs/promises");
    const nodePath = await import("node:path");
    const os = await import("node:os");
    const allowedRoot = await fs.mkdtemp(nodePath.join(os.tmpdir(), "fc-allowed-root-"));
    const subDir = nodePath.join(allowedRoot, "sub");
    await fs.mkdir(subDir);
    const outPath = nodePath.join(allowedRoot, "scan.ndjson");
    process.env.FILECAP_MCP_ALLOWED_PATHS = allowedRoot;
    const result = await dispatchTool("filecap_scan", { directory: subDir, output: outPath });
    expect(result.isError).toBeFalsy();
    await fs.rm(allowedRoot, { recursive: true, force: true });
  });
});

describe("TOOL_DEFINITIONS", () => {
  it("exports five tools with names and JSON schemas", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name).sort();
    expect(names).toEqual(["filecap_query_inventory", "filecap_report", "filecap_rollup", "filecap_scan", "filecap_web_rollup"]);
    for (const t of TOOL_DEFINITIONS) {
      expect(t.description).toBeTruthy();
      expect(t.inputSchema).toBeTruthy();
      expect(t.inputSchema.type).toBe("object");
    }
  });
});

describe("dispatchTool", () => {
  it("rejects unknown tool names", async () => {
    const result = await dispatchTool("not_a_real_tool", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/unknown tool/i);
  });

  it("dispatches filecap_scan and returns a structured response", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-mcp-tools-"));
    await fs.writeFile(path.join(tmpRoot, "x.txt"), "hi");
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-mcp-tools-out-"));
    const outPath = path.join(outDir, "scan.ndjson");

    const result = await dispatchTool("filecap_scan", {
      directory: tmpRoot,
      output: outPath,
      hash: false,
      introspect: false,
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toMatch(/exitCode/);

    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
  });
});
