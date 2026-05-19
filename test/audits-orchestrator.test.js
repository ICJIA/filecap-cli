import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAudits } from "../src/commands/audits.js";

// 1.9.0: the audits orchestrator walks an inventory NDJSON, scores every
// PDF entry via the score-fetcher (with the local cache short-circuiting
// fresh hashes), writes inventory.audited.ndjson with entry.audit
// populated. Non-PDF entries pass through unchanged. Behavior under test:
//   - PDF entries get audit data attached
//   - Cache hits skip the HTTP call
//   - Cache misses call the fetcher and persist the result
//   - Non-PDF entries (docx, xlsx, image) are emitted unchanged with no
//     entry.audit field
//   - Header / footer lines pass through unchanged
//   - Force refresh option skips the cache (re-audits everything)
//   - Network errors on a single PDF don't fail the whole run

const baseHeader = {
  schemaVersion: 1,
  kind: "filecap-inventory-header",
  metadata: { serverName: "icjia-agency-prod", scannedAt: "2026-05-17T20:34:56Z" },
};
const baseFooter = { kind: "filecap-inventory-footer", entryCount: 3 };

const pdfEntry = (overrides = {}) => ({
  path: "report.pdf",
  filename: "report.pdf",
  extension: "pdf",
  category: "pdf",
  sizeBytes: 12345,
  sha256: "aaa1111111111111111111111111111111111111111111111111111111111111",
  publicUrl: "https://icjia-api.cloud/uploads/report.pdf",
  ...overrides,
});

const xlsxEntry = (overrides = {}) => ({
  path: "data.xlsx",
  filename: "data.xlsx",
  extension: "xlsx",
  category: "spreadsheet",
  sizeBytes: 22222,
  sha256: "bbb2222222222222222222222222222222222222222222222222222222222222",
  publicUrl: "https://icjia-api.cloud/uploads/data.xlsx",
  ...overrides,
});

function writeInventory(filepath, entries) {
  const lines = [JSON.stringify(baseHeader), ...entries.map((e) => JSON.stringify(e)), JSON.stringify(baseFooter)];
  fs.writeFileSync(filepath, lines.join("\n") + "\n");
}

function readNdjson(filepath) {
  return fs
    .readFileSync(filepath, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

describe("runAudits", () => {
  let tmpDir, invPath, outPath, cachePath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "filecap-audits-test-"));
    invPath = path.join(tmpDir, "inventory.ndjson");
    outPath = path.join(tmpDir, "inventory.audited.ndjson");
    cachePath = path.join(tmpDir, "audit-cache.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scores every PDF entry and writes entry.audit on each", async () => {
    writeInventory(invPath, [pdfEntry(), pdfEntry({ sha256: "ccc3333333333333333333333333333333333333333333333333333333333333" })]);
    const mockResult = { score: 75, grade: "C", reportUrl: "https://r/abc", reportId: "abc", reportExpiresAt: "2027-01-01T00:00:00Z", pageCount: 4, audited: "2026-05-19T00:00:00Z", cached: false };
    const calls = [];
    const fetcher = async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body.url);
      return { strict: { score: mockResult.score, grade: mockResult.grade }, practical: {}, reportUrl: mockResult.reportUrl, reportId: mockResult.reportId, reportExpiresAt: mockResult.reportExpiresAt, pageCount: mockResult.pageCount, audited: mockResult.audited, cached: false };
    };
    await runAudits({
      inventoryPath: invPath,
      outputPath: outPath,
      cachePath,
      auditEndpoint: "https://audit.icjia.app/api/audit-url",
      fetcher,
      log: () => {},
    });
    const records = readNdjson(outPath);
    expect(records).toHaveLength(4); // header + 2 entries + footer
    expect(records[1].audit.score).toBe(75);
    expect(records[1].audit.grade).toBe("C");
    expect(records[2].audit.score).toBe(75);
    expect(calls).toHaveLength(2);
  });

  it("skips the HTTP call when the cache has a fresh entry for the sha256", async () => {
    writeInventory(invPath, [pdfEntry()]);
    fs.writeFileSync(cachePath, JSON.stringify({
      [pdfEntry().sha256]: {
        score: 90,
        grade: "A",
        reportUrl: "https://r/cached",
        reportId: "cached",
        reportExpiresAt: "2027-01-01T00:00:00Z",
        audited: "2026-05-15T00:00:00Z",
        checkedAt: new Date().toISOString(),
      },
    }));
    let calls = 0;
    const fetcher = async () => { calls++; return {}; };
    await runAudits({
      inventoryPath: invPath,
      outputPath: outPath,
      cachePath,
      auditEndpoint: "https://audit.icjia.app/api/audit-url",
      fetcher,
      log: () => {},
    });
    expect(calls).toBe(0);
    const records = readNdjson(outPath);
    expect(records[1].audit.score).toBe(90);
    expect(records[1].audit.grade).toBe("A");
  });

  it("calls the fetcher when the cache entry is stale (>30 days)", async () => {
    writeInventory(invPath, [pdfEntry()]);
    const oldDate = new Date(); oldDate.setDate(oldDate.getDate() - 60);
    fs.writeFileSync(cachePath, JSON.stringify({
      [pdfEntry().sha256]: { score: 90, grade: "A", reportUrl: "https://r/old", checkedAt: oldDate.toISOString() },
    }));
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return { strict: { score: 60, grade: "D" }, reportUrl: "https://r/new", reportId: "new", reportExpiresAt: "2027-01-01T00:00:00Z", pageCount: 2, audited: "2026-05-19T00:00:00Z", cached: false };
    };
    await runAudits({
      inventoryPath: invPath,
      outputPath: outPath,
      cachePath,
      auditEndpoint: "https://audit.icjia.app/api/audit-url",
      fetcher,
      log: () => {},
    });
    expect(calls).toBe(1);
    const records = readNdjson(outPath);
    expect(records[1].audit.score).toBe(60);
  });

  it("does NOT score xlsx/docx/pptx/image entries — they pass through with no audit field", async () => {
    writeInventory(invPath, [pdfEntry(), xlsxEntry(), { ...xlsxEntry({ extension: "docx", category: "office-document" }) }, { ...xlsxEntry({ extension: "pptx", category: "presentation" }) }, { ...xlsxEntry({ extension: "jpg", category: "image" }) }]);
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return { strict: { score: 80, grade: "B" }, reportUrl: "https://r/", reportId: "r", reportExpiresAt: "2027-01-01T00:00:00Z", pageCount: 1, audited: "2026-05-19T00:00:00Z", cached: false };
    };
    await runAudits({
      inventoryPath: invPath,
      outputPath: outPath,
      cachePath,
      auditEndpoint: "https://audit.icjia.app/api/audit-url",
      fetcher,
      log: () => {},
    });
    // Only the PDF should be scored.
    expect(calls).toBe(1);
    const records = readNdjson(outPath);
    // records[0] = header, [1..5] = entries, [6] = footer
    expect(records[1].extension).toBe("pdf");
    expect(records[1].audit).toBeDefined();
    for (let i = 2; i <= 5; i++) {
      expect(records[i].audit).toBeUndefined();
    }
  });

  it("preserves the inventory header and footer unchanged", async () => {
    writeInventory(invPath, [pdfEntry()]);
    const fetcher = async () => ({ strict: { score: 50, grade: "F" }, reportUrl: "https://r/", reportId: "r", reportExpiresAt: "2027-01-01T00:00:00Z", pageCount: 1, audited: "2026-05-19T00:00:00Z", cached: false });
    await runAudits({
      inventoryPath: invPath,
      outputPath: outPath,
      cachePath,
      auditEndpoint: "https://audit.icjia.app/api/audit-url",
      fetcher,
      log: () => {},
    });
    const records = readNdjson(outPath);
    expect(records[0]).toEqual(baseHeader);
    expect(records[records.length - 1]).toEqual(baseFooter);
  });

  it("records error info (not score) when the fetcher throws on a 4xx", async () => {
    writeInventory(invPath, [pdfEntry()]);
    const fetcher = async () => {
      throw new Error("HTTP 400 Bad Request for https://audit.icjia.app/api/audit-url");
    };
    await runAudits({
      inventoryPath: invPath,
      outputPath: outPath,
      cachePath,
      auditEndpoint: "https://audit.icjia.app/api/audit-url",
      fetcher,
      log: () => {},
    });
    const records = readNdjson(outPath);
    expect(records[1].audit.error).toMatch(/HTTP 400/);
    expect(records[1].audit.score).toBeUndefined();
  });

  it("records audit.skipped when the entry has no publicUrl", async () => {
    writeInventory(invPath, [pdfEntry({ publicUrl: undefined })]);
    const fetcher = async () => ({ strict: { score: 1, grade: "F" }, reportUrl: "https://r/", reportId: "r", reportExpiresAt: "2027-01-01T00:00:00Z", pageCount: 1, audited: "2026-05-19T00:00:00Z", cached: false });
    await runAudits({
      inventoryPath: invPath,
      outputPath: outPath,
      cachePath,
      auditEndpoint: "https://audit.icjia.app/api/audit-url",
      fetcher,
      log: () => {},
    });
    const records = readNdjson(outPath);
    expect(records[1].audit.skipped).toBe("no-public-url");
  });

  it("persists fresh results to the cache so subsequent runs can short-circuit", async () => {
    writeInventory(invPath, [pdfEntry()]);
    const fetcher = async () => ({ strict: { score: 70, grade: "C" }, reportUrl: "https://r/", reportId: "r", reportExpiresAt: "2027-01-01T00:00:00Z", pageCount: 1, audited: "2026-05-19T00:00:00Z", cached: false });
    await runAudits({
      inventoryPath: invPath,
      outputPath: outPath,
      cachePath,
      auditEndpoint: "https://audit.icjia.app/api/audit-url",
      fetcher,
      log: () => {},
    });
    expect(fs.existsSync(cachePath)).toBe(true);
    const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const hash = pdfEntry().sha256;
    expect(cache[hash]).toBeDefined();
    expect(cache[hash].score).toBe(70);
    expect(cache[hash].grade).toBe("C");
    expect(cache[hash].checkedAt).toBeDefined();
  });
});
