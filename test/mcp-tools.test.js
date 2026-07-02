import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

// v1.39.0 (F6): the allowlist previously gated ONLY filecap_scan's directory
// — every other path-typed argument (scan output, rollup inputs/output,
// report input/outputDir, web_rollup output, query inventory) bypassed it.
describe("dispatchTool — allowlist covers every path argument (F6)", () => {
  let savedEnv;
  let fs;
  let nodePath;
  let os;
  let allowedRoot;

  beforeEach(async () => {
    savedEnv = process.env.FILECAP_MCP_ALLOWED_PATHS;
    fs = await import("node:fs/promises");
    nodePath = await import("node:path");
    os = await import("node:os");
    allowedRoot = await fs.mkdtemp(nodePath.join(os.tmpdir(), "fc-gate-"));
    process.env.FILECAP_MCP_ALLOWED_PATHS = allowedRoot;
  });

  afterEach(async () => {
    if (savedEnv !== undefined) {
      process.env.FILECAP_MCP_ALLOWED_PATHS = savedEnv;
    } else {
      delete process.env.FILECAP_MCP_ALLOWED_PATHS;
    }
    await fs.rm(allowedRoot, { recursive: true, force: true });
  });

  it("blocks a scan whose output path is outside allowed paths", async () => {
    const result = await dispatchTool("filecap_scan", {
      directory: allowedRoot,
      output: nodePath.join(os.tmpdir(), "outside-gate.ndjson"),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not in allowed paths/i);
  });

  it("a trailing-slash allowed root still allows the root directory itself", async () => {
    process.env.FILECAP_MCP_ALLOWED_PATHS = `${allowedRoot}/`;
    const outPath = nodePath.join(allowedRoot, "scan.ndjson");
    const result = await dispatchTool("filecap_scan", {
      directory: allowedRoot,
      output: outPath,
      hash: false,
      introspect: false,
    });
    expect(result.isError).toBeFalsy();
  });

  it("blocks rollup when an input path is outside allowed paths", async () => {
    const result = await dispatchTool("filecap_rollup", {
      inputs: [nodePath.join(os.tmpdir(), "outside.ndjson")],
      output: nodePath.join(allowedRoot, "consolidated.ndjson"),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not in allowed paths/i);
  });

  it("blocks report when outputDir is outside allowed paths", async () => {
    const result = await dispatchTool("filecap_report", {
      input: nodePath.join(allowedRoot, "inv.ndjson"),
      outputDir: nodePath.join(os.tmpdir(), "outside-report"),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not in allowed paths/i);
  });

  it("blocks web_rollup when output is outside allowed paths", async () => {
    const result = await dispatchTool("filecap_web_rollup", {
      output: nodePath.join(os.tmpdir(), "outside-bundle"),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not in allowed paths/i);
  });

  // v1.39.0 audit fix (blue-F new finding 1): sitesFile is path-typed
  // ("Override saved-sites JSON path") but the web_rollup gate only checked
  // args.output — a gated MCP client could point the bundle build at an
  // arbitrary readable JSON as the site roster.
  it("blocks web_rollup when sitesFile is outside allowed paths", async () => {
    const result = await dispatchTool("filecap_web_rollup", {
      output: nodePath.join(allowedRoot, "bundle"),
      sitesFile: nodePath.join(os.tmpdir(), "outside-sites.json"),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not in allowed paths/i);
  });

  // Control pin for the fix above: an in-allowlist sitesFile must still get
  // through the gate (the run then fails on the missing file itself, proving
  // runWebRollup was reached, not blocked).
  it("web_rollup with sitesFile inside the allowlist passes the gate", async () => {
    const result = await dispatchTool("filecap_web_rollup", {
      output: nodePath.join(allowedRoot, "bundle"),
      sitesFile: nodePath.join(allowedRoot, "no-such-sites.json"),
    });
    expect(result.content[0].text).not.toMatch(/not in allowed paths/i);
    expect(result.content[0].text).toMatch(/cannot read sites file/i);
  });

  it("blocks query_inventory when the inventory path is outside allowed paths", async () => {
    const result = await dispatchTool("filecap_query_inventory", {
      inventory: nodePath.join(os.tmpdir(), "outside.ndjson"),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not in allowed paths/i);
  });
});

describe("dispatchTool — result payloads (F6)", () => {
  it("scan result carries the absolute outputPath alongside exitCode", async () => {
    const fs = await import("node:fs/promises");
    const nodePath = await import("node:path");
    const os = await import("node:os");
    const tmpRoot = await fs.mkdtemp(nodePath.join(os.tmpdir(), "fc-outpath-"));
    await fs.writeFile(nodePath.join(tmpRoot, "x.txt"), "hi");
    const outPath = nodePath.join(tmpRoot, "scan.ndjson");

    const result = await dispatchTool("filecap_scan", {
      directory: tmpRoot,
      output: outPath,
      hash: false,
      introspect: false,
    });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.exitCode).toBe(0);
    expect(payload.outputPath).toBe(nodePath.resolve(outPath));

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("sets isError when the scan payload carries an error (exitCode 2)", async () => {
    const nodePath = await import("node:path");
    const os = await import("node:os");
    const missingDir = nodePath.join(os.tmpdir(), "fc-no-such-dir-ever");
    const result = await dispatchTool("filecap_scan", {
      directory: missingDir,
      output: nodePath.join(os.tmpdir(), "never-written.ndjson"),
    });
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.exitCode).toBe(2);
    expect(payload.error).toMatch(/cannot read/i);
  });

  it("sets isError when the query inventory file is missing", async () => {
    const nodePath = await import("node:path");
    const os = await import("node:os");
    const result = await dispatchTool("filecap_query_inventory", {
      inventory: nodePath.join(os.tmpdir(), "fc-missing-inventory.ndjson"),
    });
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toMatch(/cannot read/i);
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
