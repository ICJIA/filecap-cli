import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config/load.js";

describe("loadConfig", () => {
  let tmpDir;
  let cfgPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "filecap-config-"));
    cfgPath = path.join(tmpDir, "config.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty object when config file is absent", () => {
    expect(loadConfig({ configPath: cfgPath })).toEqual({});
  });

  it("reads a minimal valid config", () => {
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ webRollup: { autoDeploy: true } }),
    );
    const cfg = loadConfig({ configPath: cfgPath });
    expect(cfg.webRollup?.autoDeploy).toBe(true);
  });

  it("reads autoDeploy and deploySite together", () => {
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        version: 1,
        webRollup: { autoDeploy: true, deploySite: "abc-123" },
      }),
    );
    const cfg = loadConfig({ configPath: cfgPath });
    expect(cfg.webRollup?.autoDeploy).toBe(true);
    expect(cfg.webRollup?.deploySite).toBe("abc-123");
  });

  it("tolerates a config with no webRollup section", () => {
    fs.writeFileSync(cfgPath, JSON.stringify({ version: 1 }));
    expect(loadConfig({ configPath: cfgPath })).toEqual({ version: 1 });
  });

  it("throws on invalid JSON", () => {
    fs.writeFileSync(cfgPath, "{ not json");
    expect(() => loadConfig({ configPath: cfgPath })).toThrow(/Invalid JSON/);
  });

  it("throws on unexpected top-level field", () => {
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ webRollup: { autoDeploy: true }, surprise: 1 }),
    );
    expect(() => loadConfig({ configPath: cfgPath })).toThrow(
      /Invalid filecap config/,
    );
  });

  it("throws on unexpected webRollup field (catches typos)", () => {
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ webRollup: { autodeploy: true } }), // wrong case
    );
    expect(() => loadConfig({ configPath: cfgPath })).toThrow(
      /Invalid filecap config/,
    );
  });

  it("throws on wrong type for autoDeploy", () => {
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ webRollup: { autoDeploy: "yes" } }),
    );
    expect(() => loadConfig({ configPath: cfgPath })).toThrow(
      /Invalid filecap config/,
    );
  });
});
