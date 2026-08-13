// v1.41.0 — wrapper for test/shell/skip-scan-probe.sh.
//
// SKIP_SCAN=1 is the pipeline's resume point: the audit stage paces against a
// 500-req/hour limiter for hours and is by far the likeliest stage to be
// interrupted, so recovering must not mean re-rsyncing every host and
// repointing every latest/. Both branches are silent when broken — a
// SKIP_SCAN=1 that still scans just wastes hours, but a DEFAULT run that
// skips the scan quietly builds every later bundle from stale inventories.
//
// The probe runs the real examples/audit-fleet-auto.sh against a fixture tree
// with a stub audit-fleet.sh that records whether it was invoked.
// (Red-proven against the pre-change HEAD copy: it ignores SKIP_SCAN=1 and
// scans anyway, so the first probe assertion fails.)
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROBE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "shell",
  "skip-scan-probe.sh",
);

function bashAvailable() {
  try {
    return spawnSync("bash", ["-c", "exit 0"], { timeout: 10000 }).status === 0;
  } catch {
    return false;
  }
}

describe("SKIP_SCAN resume point (audit-fleet-auto.sh shell probe)", () => {
  const hasBash = bashAvailable();
  if (!hasBash) {
    console.warn(
      "[skip-scan.test] bash not available on this system — skipping the SKIP_SCAN probe",
    );
  }

  it.skipIf(!hasBash)(
    "SKIP_SCAN=1 reuses existing scans and continues; unset or 0 still scans",
    () => {
      const res = spawnSync("bash", [PROBE], { encoding: "utf8", timeout: 120000 });
      if (res.status !== 0) {
        console.error(res.stdout ?? "");
        console.error(res.stderr ?? "");
      }
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("skip-scan probe passed");
    },
    130000,
  );
});
