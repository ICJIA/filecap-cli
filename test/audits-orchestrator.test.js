import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAudits } from "../src/commands/audits.js";

// 1.9.0: the audits orchestrator walks an inventory NDJSON, scores every
// scoreable document (pdf/docx/xlsx/pptx) entry via the score-fetcher (with the local cache short-circuiting
// fresh hashes), writes inventory.audited.ndjson with entry.audit
// populated. Legacy Office (.doc/.xls/.ppt), ODF/RTF, and non-document entries pass through unchanged. Behavior under test:
//   - PDF/OOXML entries get audit data attached
//   - Cache hits skip the HTTP call
//   - Cache misses call the fetcher and persist the result
//   - Legacy Office (.doc/.xls/.ppt), ODF/RTF, and non-document entries are emitted unchanged with no
//     entry.audit field
//   - Header / footer lines pass through unchanged
//   - Force refresh option skips the cache (re-audits everything)
//   - Network errors on a single document don't fail the whole run

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

  it("scores docx/xlsx/pptx alongside PDFs; legacy and non-documents pass through unscored", async () => {
    writeInventory(invPath, [
      pdfEntry(),
      xlsxEntry(),
      xlsxEntry({ path: "memo.docx", filename: "memo.docx", extension: "docx", category: "office-document", sha256: "ddd4444444444444444444444444444444444444444444444444444444444444", publicUrl: "https://icjia-api.cloud/uploads/memo.docx" }),
      xlsxEntry({ path: "deck.pptx", filename: "deck.pptx", extension: "pptx", category: "presentation", sha256: "eee5555555555555555555555555555555555555555555555555555555555555", publicUrl: "https://icjia-api.cloud/uploads/deck.pptx" }),
      xlsxEntry({ path: "old.xls", filename: "old.xls", extension: "xls", category: "legacy-office", sha256: "fff6666666666666666666666666666666666666666666666666666666666666", publicUrl: "https://icjia-api.cloud/uploads/old.xls" }),
      xlsxEntry({ path: "notes.rtf", filename: "notes.rtf", extension: "rtf", category: "office-document", sha256: "abc7777777777777777777777777777777777777777777777777777777777777", publicUrl: "https://icjia-api.cloud/uploads/notes.rtf" }),
      xlsxEntry({ path: "logo.jpg", filename: "logo.jpg", extension: "jpg", category: "image", sha256: "abc8888888888888888888888888888888888888888888888888888888888888", publicUrl: "https://icjia-api.cloud/uploads/logo.jpg" }),
    ]);
    const urls = [];
    const fetcher = async (url, init) => {
      urls.push(JSON.parse(init.body).url);
      return { strict: { score: 80, grade: "B" }, reportUrl: "https://r/", reportId: "r", reportExpiresAt: "2027-01-01T00:00:00Z", pageCount: 1, audited: "2026-08-17T00:00:00Z", cached: false };
    };
    await runAudits({
      inventoryPath: invPath,
      outputPath: outPath,
      cachePath,
      auditEndpoint: "https://audit.icjia.app/api/audit-url",
      fetcher,
      log: () => {},
    });
    // pdf + xlsx + docx + pptx are sent; xls/rtf/jpg never are.
    expect(urls).toHaveLength(4);
    expect(urls.some((u) => u.endsWith("old.xls"))).toBe(false);
    expect(urls.some((u) => u.endsWith("notes.rtf"))).toBe(false);
    const records = readNdjson(outPath);
    // records[0] header, [1..7] entries, [8] footer.
    for (const i of [1, 2, 3, 4]) expect(records[i].audit?.score).toBe(80);
    for (const i of [5, 6, 7]) expect(records[i].audit).toBeUndefined();
  });

  it("records an Office audit error exactly like a PDF one", async () => {
    writeInventory(invPath, [xlsxEntry()]);
    const fetcher = async () => {
      throw new Error("HTTP 422 Unprocessable Entity for https://icjia-api.cloud/uploads/data.xlsx — The fetched Excel file could not be read.");
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
    expect(records[1].audit.error).toMatch(/HTTP 422/);
    expect(records[1].audit.score).toBeUndefined();
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

  // v1.39.0: a 200 response with no numeric score (endpoint answered but the
  // analyzer produced nothing) used to be recorded — and CACHED — as a
  // success with score:null, poisoning the cache for a full TTL. It is now
  // an error entry, counted as failed, and never written to the cache.
  it("records an error (not a cached success) when a 200 response carries no numeric score", async () => {
    writeInventory(invPath, [pdfEntry()]);
    const fetcher = async () => ({ strict: {}, reportUrl: "https://r/", reportId: "r", cached: false });
    const res = await runAudits({
      inventoryPath: invPath,
      outputPath: outPath,
      cachePath,
      auditEndpoint: "https://audit.icjia.app/api/audit-url",
      fetcher,
      log: () => {},
    });
    const records = readNdjson(outPath);
    expect(records[1].audit.error).toBe("no score in response");
    expect(records[1].audit.score).toBeUndefined();
    expect(res.errors).toBe(1);
    expect(res.audited).toBe(0);
    const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    expect(cache[pdfEntry().sha256]).toBeUndefined();
  });

  it("treats a poisoned cache entry (score: null) as a miss and re-fetches", async () => {
    writeInventory(invPath, [pdfEntry()]);
    fs.writeFileSync(cachePath, JSON.stringify({
      [pdfEntry().sha256]: {
        score: null,
        grade: null,
        reportUrl: "https://r/poisoned",
        checkedAt: new Date().toISOString(), // fresh — only the score is bad
      },
    }));
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return { strict: { score: 85, grade: "B" }, reportUrl: "https://r/new", reportId: "new", reportExpiresAt: "2027-01-01T00:00:00Z", pageCount: 1, audited: "2026-05-19T00:00:00Z", cached: false };
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
    expect(records[1].audit.score).toBe(85);
    const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    expect(cache[pdfEntry().sha256].score).toBe(85);
  });

  it("page-audit 200 without a numeric score → ref.pageAudit.error, not cached", async () => {
    const docEntry = {
      path: "doc.docx",
      filename: "doc.docx",
      extension: "docx",
      category: "office-document",
      sizeBytes: 5000,
      publicUrl: "https://icjia-api.cloud/uploads/doc.docx",
      references: [{ pageUrl: "https://icjia.gov/page", contentType: "text/html" }],
    };
    writeInventory(invPath, [docEntry]);
    const pageCachePath = path.join(tmpDir, "page-audit-cache.json");
    const fetcher = async () => ({
      axe: {}, // 200 but the axe run produced no score
      reportUrl: "https://audit.icjia.app/page-report/abc",
      cached: false,
    });
    const res = await runAudits({
      inventoryPath: invPath,
      outputPath: outPath,
      cachePath,
      pageCachePath,
      fetcher,
      log: () => {},
    });
    const records = readNdjson(outPath);
    expect(records[1].references[0].pageAudit.error).toBe("no score in response");
    expect(records[1].references[0].pageAudit.score).toBeUndefined();
    expect(res.pagesErrors).toBe(1);
    expect(res.pagesAudited).toBe(0);
    const pageCache = JSON.parse(fs.readFileSync(pageCachePath, "utf8"));
    expect(pageCache["https://icjia.gov/page"]).toBeUndefined();
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

  // v1.39.0: the summary line's ternary was inverted — when EVERY PDF was
  // served from the local cache (pdfsToAudit.length === 0) it printed
  // "0 from cache" instead of the actual cache-served count.
  it("logs the real cache-served count when every PDF comes from the local cache", async () => {
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
    const logs = [];
    await runAudits({
      inventoryPath: invPath,
      outputPath: outPath,
      cachePath,
      auditEndpoint: "https://audit.icjia.app/api/audit-url",
      fetcher: async () => { throw new Error("no HTTP expected"); },
      log: (line) => { logs.push(String(line)); },
    });
    const summary = logs.find((l) => l.includes("from cache"));
    expect(summary).toBeDefined();
    expect(summary).toMatch(/1 from cache/);
    expect(summary).not.toMatch(/\b0 from cache/);
  });

  it("page-audit pass preserves violations and incomplete arrays on ref.pageAudit (Fix 1)", async () => {
    // Non-PDF entry with a reference — only the page-audit pass fires.
    const docEntry = {
      path: "doc.docx",
      filename: "doc.docx",
      extension: "docx",
      category: "office-document",
      sizeBytes: 5000,
      publicUrl: "https://icjia-api.cloud/uploads/doc.docx",
      references: [{ pageUrl: "https://icjia.gov/page", contentType: "text/html" }],
    };
    writeInventory(invPath, [docEntry]);

    const mockViolations = [{ id: "color-contrast", impact: "serious", tags: ["wcag2aa"], nodes: [{ target: ["button"] }] }];
    const mockIncomplete = [{ id: "label", impact: "critical", tags: ["wcag2a"], nodes: [{ target: ["input"] }] }];
    const pageCachePath = path.join(tmpDir, "page-audit-cache.json");
    const fetcher = async () => ({
      axe: {
        score: 80,
        grade: "B",
        violationCount: 1,
        bySeverity: { critical: 0, serious: 1, moderate: 0, minor: 0 },
        violations: mockViolations,
        incomplete: mockIncomplete,
      },
      reportUrl: "https://audit.icjia.app/page-report/abc",
      reportId: "abc",
      reportExpiresAt: "2027-01-01T00:00:00Z",
      pageTitle: "ICJIA",
      audited: "2026-06-01T00:00:00Z",
      cached: false,
    });

    await runAudits({
      inventoryPath: invPath,
      outputPath: outPath,
      cachePath,
      pageCachePath,
      fetcher,
      log: () => {},
    });

    const records = readNdjson(outPath);
    // records[0] = header, [1] = docEntry, [2] = footer
    const entry = records[1];
    expect(Array.isArray(entry.references)).toBe(true);
    const pageAudit = entry.references[0].pageAudit;
    expect(pageAudit).toBeDefined();
    expect(Array.isArray(pageAudit.violations)).toBe(true);
    expect(pageAudit.violations.length).toBeGreaterThan(0);
    expect(Array.isArray(pageAudit.incomplete)).toBe(true);
    expect(pageAudit.incomplete.length).toBeGreaterThan(0);
  });
});
