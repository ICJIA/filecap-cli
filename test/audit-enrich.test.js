import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runAuditEnrich } from "../src/commands/audit-enrich.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeHeader() {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "filecap-inventory-header",
    metadata: {
      serverName: "test-server",
      hostname: "test.local",
      serverIp: "10.0.0.1",
      scannedPath: "/uploads",
      scannedAt: "2026-05-09T12:00:00.000Z",
      filecapVersion: "1.0.6",
      nodeVersion: "v20.18.0",
      options: { introspect: true, hash: true, maxIntrospectMb: 200, concurrency: 4 },
    },
  });
}

function makeEntry(overrides = {}) {
  return JSON.stringify({
    path: "doc.pdf",
    absolutePath: "/uploads/doc.pdf",
    filename: "doc.pdf",
    extension: "pdf",
    category: "pdf",
    remediable: true,
    sizeBytes: 1024,
    modifiedAt: "2024-01-01T00:00:00.000Z",
    sha256: "c44f71aabbccddeeff00112233445566aabbccddeeff00112233445566778899",
    flags: [],
    ...overrides,
  });
}

function makeFooter() {
  return JSON.stringify({
    kind: "filecap-inventory-footer",
    stats: { fileCount: 1, totalBytes: 1024, scanDurationMs: 100, introspectionFailures: 0, permissionDenials: 0 },
  });
}

function makeNdjson(lines) {
  return lines.join("\n") + "\n";
}

function makeApiResponse(overrides = {}) {
  return {
    summary: { total: 1, analyzed: 1, failed: 0, skipped: 0 },
    results: [
      {
        sha256: "c44f71aabbccddeeff00112233445566aabbccddeeff00112233445566778899",
        path: "doc.pdf",
        overallScore: 84,
        grade: "B",
        reportId: "f06b5abc05c1f280a4975a1c0c95ce8d",
        reportUrl: "/api/reports/f06b5abc05c1f280a4975a1c0c95ce8d",
      },
    ],
    ...overrides,
  };
}

function mockFetchOk(body) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function mockFetchError(status, statusText, text) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
    text: () => Promise.resolve(text),
    json: () => Promise.reject(new Error("bad json")),
  });
}

// ── setup / teardown ──────────────────────────────────────────────────────────

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-audit-enrich-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete globalThis.fetch;
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("runAuditEnrich", () => {
  it("returns exitCode 2 if input file does not exist", async () => {
    const result = await runAuditEnrich({
      input: path.join(tmpDir, "nonexistent.ndjson"),
      output: path.join(tmpDir, "out.ndjson"),
      apiBase: "https://audit.icjia.app",
      authToken: "tok",
    });
    expect(result.exitCode).toBe(2);
    expect(result.error).toMatch(/cannot read/);
    expect(result.summary).toBeNull();
  });

  it("returns exitCode 2 if input is not valid NDJSON", async () => {
    const input = path.join(tmpDir, "bad.ndjson");
    await fs.writeFile(input, "not json at all\n");
    const result = await runAuditEnrich({
      input,
      output: path.join(tmpDir, "out.ndjson"),
      apiBase: "https://audit.icjia.app",
      authToken: "tok",
    });
    expect(result.exitCode).toBe(2);
    expect(result.error).toMatch(/not valid NDJSON/);
  });

  it("returns exitCode 2 if first line does not have a valid filecap header kind", async () => {
    const input = path.join(tmpDir, "bad-header.ndjson");
    await fs.writeFile(input, `${JSON.stringify({ kind: "something-else", foo: 1 })}\n`);
    const result = await runAuditEnrich({
      input,
      output: path.join(tmpDir, "out.ndjson"),
      apiBase: "https://audit.icjia.app",
      authToken: "tok",
    });
    expect(result.exitCode).toBe(2);
    expect(result.error).toMatch(/valid filecap header/);
  });

  it("returns exitCode 1 if fetch throws a network error", async () => {
    const input = path.join(tmpDir, "inv.ndjson");
    await fs.writeFile(input, makeNdjson([makeHeader(), makeEntry(), makeFooter()]));

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await runAuditEnrich({
      input,
      output: path.join(tmpDir, "out.ndjson"),
      apiBase: "https://audit.icjia.app",
      authToken: "tok",
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toMatch(/network error/);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  it("returns exitCode 1 if response.ok is false", async () => {
    const input = path.join(tmpDir, "inv.ndjson");
    await fs.writeFile(input, makeNdjson([makeHeader(), makeEntry(), makeFooter()]));

    globalThis.fetch = mockFetchError(401, "Unauthorized", "invalid token");

    const result = await runAuditEnrich({
      input,
      output: path.join(tmpDir, "out.ndjson"),
      apiBase: "https://audit.icjia.app",
      authToken: "badtoken",
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toMatch(/401/);
    expect(result.error).toMatch(/Unauthorized/);
  });

  it("successfully merges audit data into matching entries by sha256", async () => {
    const input = path.join(tmpDir, "inv.ndjson");
    const output = path.join(tmpDir, "out.ndjson");
    await fs.writeFile(input, makeNdjson([makeHeader(), makeEntry(), makeFooter()]));

    globalThis.fetch = mockFetchOk(makeApiResponse());

    const result = await runAuditEnrich({
      input,
      output,
      apiBase: "https://audit.icjia.app",
      authToken: "tok",
    });

    expect(result.exitCode).toBe(0);
    expect(result.summary.enrichedEntries).toBe(1);

    const outLines = (await fs.readFile(output, "utf8")).split("\n").filter(Boolean);
    const entry = JSON.parse(outLines[1]);
    expect(entry.audit).toBeDefined();
    expect(entry.audit.score).toBe(84);
    expect(entry.audit.grade).toBe("B");
    expect(entry.audit.reportId).toBe("f06b5abc05c1f280a4975a1c0c95ce8d");
  });

  it("successfully merges audit data by path when sha256 is missing from result", async () => {
    const input = path.join(tmpDir, "inv.ndjson");
    const output = path.join(tmpDir, "out.ndjson");
    await fs.writeFile(input, makeNdjson([makeHeader(), makeEntry(), makeFooter()]));

    // Response has no sha256, only path
    const responseNoSha = makeApiResponse({
      results: [
        {
          path: "doc.pdf",
          overallScore: 72,
          grade: "C+",
          reportId: "aaaabbbbccccdddd11112222333344aa",
          reportUrl: "/api/reports/aaaabbbbccccdddd11112222333344aa",
        },
      ],
    });
    globalThis.fetch = mockFetchOk(responseNoSha);

    const result = await runAuditEnrich({
      input,
      output,
      apiBase: "https://audit.icjia.app",
      authToken: "tok",
    });

    expect(result.exitCode).toBe(0);
    const entry = JSON.parse((await fs.readFile(output, "utf8")).split("\n").filter(Boolean)[1]);
    expect(entry.audit.score).toBe(72);
    expect(entry.audit.grade).toBe("C+");
  });

  it("skips audit results with error fields", async () => {
    const input = path.join(tmpDir, "inv.ndjson");
    const output = path.join(tmpDir, "out.ndjson");
    await fs.writeFile(input, makeNdjson([makeHeader(), makeEntry(), makeFooter()]));

    const responseWithError = makeApiResponse({
      results: [
        {
          sha256: "c44f71aabbccddeeff00112233445566aabbccddeeff00112233445566778899",
          path: "doc.pdf",
          error: "file not accessible",
        },
      ],
    });
    globalThis.fetch = mockFetchOk(responseWithError);

    const result = await runAuditEnrich({
      input,
      output,
      apiBase: "https://audit.icjia.app",
      authToken: "tok",
    });

    expect(result.exitCode).toBe(0);
    expect(result.summary.enrichedEntries).toBe(0);
    const entry = JSON.parse((await fs.readFile(output, "utf8")).split("\n").filter(Boolean)[1]);
    expect(entry.audit).toBeUndefined();
  });

  it("constructs user-facing reportUrl as <apiBase>/report/<reportId> (NOT /api/reports/)", async () => {
    const input = path.join(tmpDir, "inv.ndjson");
    const output = path.join(tmpDir, "out.ndjson");
    await fs.writeFile(input, makeNdjson([makeHeader(), makeEntry(), makeFooter()]));

    globalThis.fetch = mockFetchOk(makeApiResponse());

    await runAuditEnrich({
      input,
      output,
      apiBase: "https://audit.icjia.app",
      authToken: "tok",
    });

    const entry = JSON.parse((await fs.readFile(output, "utf8")).split("\n").filter(Boolean)[1]);
    expect(entry.audit.reportUrl).toBe("https://audit.icjia.app/report/f06b5abc05c1f280a4975a1c0c95ce8d");
    expect(entry.audit.reportUrl).not.toContain("/api/reports/");
  });

  it("strips trailing slash from apiBase when constructing reportUrl", async () => {
    const input = path.join(tmpDir, "inv.ndjson");
    const output = path.join(tmpDir, "out.ndjson");
    await fs.writeFile(input, makeNdjson([makeHeader(), makeEntry(), makeFooter()]));

    globalThis.fetch = mockFetchOk(makeApiResponse());

    await runAuditEnrich({
      input,
      output,
      apiBase: "https://audit.icjia.app/",
      authToken: "tok",
    });

    const entry = JSON.parse((await fs.readFile(output, "utf8")).split("\n").filter(Boolean)[1]);
    expect(entry.audit.reportUrl).toBe("https://audit.icjia.app/report/f06b5abc05c1f280a4975a1c0c95ce8d");
  });

  it("uses authToken in Authorization header when provided", async () => {
    const input = path.join(tmpDir, "inv.ndjson");
    const output = path.join(tmpDir, "out.ndjson");
    await fs.writeFile(input, makeNdjson([makeHeader(), makeEntry(), makeFooter()]));

    const mockFetch = mockFetchOk(makeApiResponse());
    globalThis.fetch = mockFetch;

    await runAuditEnrich({
      input,
      output,
      apiBase: "https://audit.icjia.app",
      authToken: "fap_mytoken123",
    });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer fap_mytoken123");
  });

  it("omits Authorization header when authToken is empty", async () => {
    const input = path.join(tmpDir, "inv.ndjson");
    const output = path.join(tmpDir, "out.ndjson");
    await fs.writeFile(input, makeNdjson([makeHeader(), makeEntry(), makeFooter()]));

    const mockFetch = mockFetchOk(makeApiResponse());
    globalThis.fetch = mockFetch;

    await runAuditEnrich({
      input,
      output,
      apiBase: "https://audit.icjia.app",
      authToken: "",
    });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers.Authorization).toBeUndefined();
  });

  it("writes the entire NDJSON intact (header, footer, non-PDF entries) with only matched entries augmented", async () => {
    const xlsxEntry = JSON.stringify({
      path: "data.xlsx",
      absolutePath: "/uploads/data.xlsx",
      filename: "data.xlsx",
      extension: "xlsx",
      category: "spreadsheet",
      remediable: false,
      sizeBytes: 2048,
      modifiedAt: "2024-01-01T00:00:00.000Z",
      sha256: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      flags: [],
    });

    const input = path.join(tmpDir, "inv.ndjson");
    const output = path.join(tmpDir, "out.ndjson");
    await fs.writeFile(input, makeNdjson([makeHeader(), makeEntry(), xlsxEntry, makeFooter()]));

    globalThis.fetch = mockFetchOk(makeApiResponse());

    const result = await runAuditEnrich({
      input,
      output,
      apiBase: "https://audit.icjia.app",
      authToken: "tok",
    });

    expect(result.exitCode).toBe(0);
    const outText = await fs.readFile(output, "utf8");
    const outLines = outText.split("\n").filter(Boolean);

    expect(outLines).toHaveLength(4); // header + pdf entry + xlsx entry + footer

    const headerOut = JSON.parse(outLines[0]);
    expect(headerOut.kind).toBe("filecap-inventory-header");

    const footerOut = JSON.parse(outLines[3]);
    expect(footerOut.kind).toBe("filecap-inventory-footer");

    const pdfOut = JSON.parse(outLines[1]);
    expect(pdfOut.audit).toBeDefined();
    expect(pdfOut.audit.score).toBe(84);

    const xlsxOut = JSON.parse(outLines[2]);
    expect(xlsxOut.audit).toBeUndefined();
  });

  it("returns exitCode 1 if manifest is missing results array", async () => {
    const input = path.join(tmpDir, "inv.ndjson");
    await fs.writeFile(input, makeNdjson([makeHeader(), makeEntry(), makeFooter()]));

    globalThis.fetch = mockFetchOk({ summary: { total: 0 } }); // no results array

    const result = await runAuditEnrich({
      input,
      output: path.join(tmpDir, "out.ndjson"),
      apiBase: "https://audit.icjia.app",
      authToken: "tok",
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toMatch(/missing 'results' array/);
  });
});
