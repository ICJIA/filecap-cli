// v1.39.0 — cross-package contract obligations of web-rollup (Package E side).
// Uses delegating module spies so the assertions hold regardless of whether
// the other package's consumer change has landed yet:
//   Contract 4: collectAuditErrors items carry `pathPrefix`.
//   Contract 5: runReport is called with `publicUrlBaseOverride` (sites.json base).
//   Contract 6: runReport is called with `csvHref: null` when no per-site
//               workbook will be written.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const spied = vi.hoisted(() => ({ runReportCalls: [], collectCalls: [] }));

vi.mock("../src/commands/report.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runReport: async (opts) => {
      spied.runReportCalls.push(opts);
      return actual.runReport(opts);
    },
  };
});

vi.mock("../src/report/audit-errors.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    collectAuditErrors: (items) => {
      spied.collectCalls.push(items);
      return actual.collectAuditErrors(items);
    },
  };
});

import { runWebRollup } from "../src/commands/web-rollup.js";

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-web-rollup-contract-"));
  spied.runReportCalls.length = 0;
  spied.collectCalls.length = 0;
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeInv(filePath, { serverName, entries }) {
  const lines = [JSON.stringify({
    schemaVersion: 1,
    kind: "filecap-inventory-header",
    metadata: {
      serverName,
      scannedAt: "2026-06-20T12:00:00.000Z",
      publicUrlBase: "https://old.example.gov/uploads",
      filecapVersion: "1.1.1",
    },
  })];
  for (const e of entries) lines.push(JSON.stringify(e));
  lines.push(JSON.stringify({ kind: "filecap-inventory-footer", entryCount: entries.length }));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, lines.join("\n") + "\n", "utf8");
}

const pdfEntry = {
  path: "doc.pdf", absolutePath: "/uploads/doc.pdf", filename: "doc.pdf",
  extension: "pdf", category: "pdf", remediable: true, sizeBytes: 10,
  modifiedAt: "2024-01-01T00:00:00.000Z", sha256: "h1", flags: [],
};

const imageEntry = {
  path: "logo.png", absolutePath: "/uploads/logo.png", filename: "logo.png",
  extension: "png", category: "image", remediable: false, sizeBytes: 10,
  modifiedAt: "2024-01-01T00:00:00.000Z", sha256: "i1", flags: [],
};

describe("web-rollup cross-package contracts (v1.39.0 E6/E8)", () => {
  it("passes publicUrlBaseOverride (sites.json base) and pathPrefix to runReport", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    await writeInv(path.join(auditsBase, "ari", "latest", "inventory.ndjson"), {
      serverName: "ari", entries: [pdfEntry],
    });
    const sitesFile = path.join(tmpDir, "sites.json");
    await fs.writeFile(sitesFile, JSON.stringify({
      version: 1,
      sites: [{
        name: "ari", siteName: "ARI", host: "10.0.0.1", user: "forge", remotePath: "/uploads",
        publicUrlBase: "https://files.example.gov", pathPrefix: "static",
      }],
    }));
    await runWebRollup({ output: path.join(tmpDir, "out"), sitesFile, _auditsBase: auditsBase, noOg: true });

    expect(spied.runReportCalls).toHaveLength(1);
    expect(spied.runReportCalls[0].publicUrlBaseOverride).toBe("https://files.example.gov");
    expect(spied.runReportCalls[0].pathPrefix).toBe("static");
  });

  it("stamps pathPrefix onto the items handed to collectAuditErrors", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    await writeInv(path.join(auditsBase, "ari", "latest", "inventory.ndjson"), {
      serverName: "ari", entries: [pdfEntry],
    });
    const sitesFile = path.join(tmpDir, "sites.json");
    await fs.writeFile(sitesFile, JSON.stringify({
      version: 1,
      sites: [{
        name: "ari", siteName: "ARI", host: "10.0.0.1", user: "forge", remotePath: "/uploads",
        publicUrlBase: "https://files.example.gov", pathPrefix: "static",
      }],
    }));
    await runWebRollup({ output: path.join(tmpDir, "out"), sitesFile, _auditsBase: auditsBase, noOg: true });

    expect(spied.collectCalls).toHaveLength(1);
    const items = spied.collectCalls[0];
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.pathPrefix).toBe("static");
    }
  });

  it("passes csvHref: null to runReport when the site will get no workbook", async () => {
    const auditsBase = path.join(tmpDir, "filecap-audits");
    await writeInv(path.join(auditsBase, "imgs", "latest", "inventory.ndjson"), {
      serverName: "imgs", entries: [imageEntry],
    });
    const sitesFile = path.join(tmpDir, "sites.json");
    await fs.writeFile(sitesFile, JSON.stringify({
      version: 1,
      sites: [{ name: "imgs", siteName: "IMGS", host: "10.0.0.1", user: "forge", remotePath: "/uploads" }],
    }));
    await runWebRollup({ output: path.join(tmpDir, "out"), sitesFile, _auditsBase: auditsBase, noOg: true });

    expect(spied.runReportCalls).toHaveLength(1);
    expect(spied.runReportCalls[0].csvHref).toBeNull();
  });
});
