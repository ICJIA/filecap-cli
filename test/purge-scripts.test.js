// v1.39.0 post-audit fix (red-4 MED-1): the A1 purge logic — the single
// highest-stakes shell fix (data loss on revert) — had no durable automated
// test; verification was an ephemeral scratch probe. This wrapper runs
// test/shell/purge-fixture-probe.sh, which marker-extracts the per-site
// purge loop out of run-full-audit.sh AND run-site-update.sh and executes it
// against a fixture tree, so reverting or breaking the purge rules in either
// script turns the suite red. (Red-proven against the pre-fix HEAD copies:
// the extracted HEAD loop deletes the latest-target run and purges dangling-
// latest sites without a WARN — 6 probe assertions fail, exit 1.)
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROBE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "shell",
  "purge-fixture-probe.sh",
);

function bashAvailable() {
  try {
    return spawnSync("bash", ["-c", "exit 0"], { timeout: 10000 }).status === 0;
  } catch {
    return false;
  }
}

describe("A1 purge rules (run-full-audit.sh + run-site-update.sh shell probe)", () => {
  const hasBash = bashAvailable();
  if (!hasBash) {
    console.warn(
      "[purge-scripts.test] bash not available on this system — skipping the A1 purge probe",
    );
  }

  it.skipIf(!hasBash)(
    "keeps the latest-target + newest run, purges older runs, skips dangling-latest sites with a WARN, spares mirror/",
    () => {
      const res = spawnSync("bash", [PROBE], { encoding: "utf8", timeout: 120000 });
      if (res.status !== 0) {
        // Surface the probe's own assertion output in the failure report.
        console.error(res.stdout ?? "");
        console.error(res.stderr ?? "");
      }
      expect(res.stdout).toContain("purge-fixture-probe: all assertions passed");
      expect(res.status).toBe(0);
    },
  );
});
