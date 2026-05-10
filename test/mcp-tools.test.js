import { describe, it, expect } from "vitest";
import { TOOL_DEFINITIONS, dispatchTool } from "../src/mcp/tools.js";

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
