import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runNetlifyDeploy } from "../src/commands/web-rollup.js";

// netlify-cli v26 runs a build before deploying unless --no-build is passed;
// without it, `netlify deploy` on a pre-built static bundle bails to its help
// text and nothing ships. The tool only ever deploys an already-built --dir,
// so the deploy must always pass --no-build.
describe("runNetlifyDeploy args", () => {
  let savedNoDeploy;

  beforeEach(() => {
    savedNoDeploy = process.env.FILECAP_NO_DEPLOY;
    delete process.env.FILECAP_NO_DEPLOY; // otherwise the deploy short-circuits
  });

  afterEach(() => {
    if (savedNoDeploy !== undefined) process.env.FILECAP_NO_DEPLOY = savedNoDeploy;
    else delete process.env.FILECAP_NO_DEPLOY;
  });

  function captureSpawn(rec) {
    return (cmd, args) => {
      rec.cmd = cmd;
      rec.args = args;
      const handlers = {};
      const child = { on: (ev, cb) => ((handlers[ev] = cb), child) };
      Promise.resolve().then(() => handlers.close && handlers.close(0));
      return child;
    };
  }

  it("passes --no-build (static bundle, no build step) alongside --prod and --dir", async () => {
    const rec = {};
    const result = await runNetlifyDeploy({
      output: "/tmp/fc-bundle",
      deploySite: "site-abc",
      _spawn: captureSpawn(rec),
    });
    expect(result.ok).toBe(true);
    expect(rec.cmd).toBe("netlify");
    expect(rec.args).toContain("--no-build");
    expect(rec.args).toContain("--prod");
    expect(rec.args.join(" ")).toContain("--dir /tmp/fc-bundle");
    expect(rec.args.join(" ")).toContain("--site site-abc");
  });
});
