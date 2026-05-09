# filecap Phase 6 — CSV Reporter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@icjia/filecap@0.6.0` — replace the `filecap report` stub with a working command that consumes an inventory NDJSON (single-instance OR consolidated) and emits the vendor handoff package: `files.csv`, `SUMMARY.txt`, plus four flagged-list `.txt` files.

**Architecture:** Stream the input NDJSON line-by-line via `readline` (works on both single-instance and consolidated inputs because both share the kind-discriminated header/entry/footer shape). The orchestrator dispatches lines to per-output writers — `files.csv`, `SUMMARY.txt`, `largest_files.txt`, `flagged_filenames.txt`, `duplicate_hashes.txt`, `pdf_image_only.txt`. Output directory defaults to `./filecap-report-<timestamp>/`. No new deps.

**Tech Stack:** Node 20+, ESM. Reuses Phase 5's NDJSON streaming machinery and existing schemas.

**Out of scope for Phase 6:** MCP server (Phase 7), Strapi awareness (Phase 8). Vendor-fill columns explicitly omitted (per design doc section 12 row 6).

**CSV column spec** (per design doc section 5, 32 columns, stable order, every column always present even if empty):

1. `serverName` 2. `serverIp` 3. `hostname` 4. `scannedPath` 5. `relativePath` 6. `absolutePath` 7. `filename` 8. `extension` 9. `category` 10. `remediable` 11. `sizeBytes` 12. `sizeHuman` 13. `modifiedAt` 14. `sha256` 15. `documentLanguage` 16. `pdfPageCount` 17. `pdfHasTextLayer` 18. `pdfIsImageOnly` 19. `pdfHasTags` 20. `pdfHasFormFields` 21. `pdfHasSignatures` 22. `pdfEncrypted` 23. `pdfProducer` 24. `pdfCreator` 25. `pdfCreationDate` 26. `docxHasHeadings` 27. `docxAltTextCoverage` 28. `docxTableCount` 29. `docxImageCount` 30. `xlsxSheetCount` 31. `xlsxHasMergedCells` 32. `flags` (pipe-separated)

For consolidated input, `serverName` is per-entry (already on the entry); for single-instance input, all entries get the header's `serverName`. `serverIp` and `hostname` come from the header (single-instance) or from `metadata.sources[]` matched on `serverName` (consolidated).

---

## File Structure

```
filecap-cli/
├── src/
│   ├── commands/
│   │   └── report.js                     ← create
│   ├── report/
│   │   ├── csv.js                        ← create (32-column writer)
│   │   ├── summary.js                    ← create (SUMMARY.txt)
│   │   ├── flagged.js                    ← create (4 .txt files)
│   │   └── format.js                     ← create (sizeHuman, csv-cell escape)
│   └── index.js                          ← modify (re-exports)
├── bin/
│   └── filecap.js                        ← modify (replace report stub)
├── test/
│   ├── report-csv.test.js                ← create
│   ├── report-summary.test.js            ← create
│   ├── report-flagged.test.js            ← create
│   ├── report.test.js                    ← create (E2E CLI)
│   └── ...
├── README.md
├── CHANGELOG.md
└── package.json + lockfile
```

---

## Task 1 — Format helpers

**Files:** Create `src/report/format.js`, `test/report-format.test.js`

- [ ] **Step 1.1: Tests**

```js
import { describe, it, expect } from "vitest";
import { humanizeBytes, csvCell } from "../src/report/format.js";

describe("humanizeBytes", () => {
  it("formats common sizes", () => {
    expect(humanizeBytes(0)).toBe("0 B");
    expect(humanizeBytes(512)).toBe("512 B");
    expect(humanizeBytes(1024)).toBe("1.0 KB");
    expect(humanizeBytes(1536)).toBe("1.5 KB");
    expect(humanizeBytes(1024 * 1024)).toBe("1.0 MB");
    expect(humanizeBytes(4827193)).toBe("4.6 MB");
    expect(humanizeBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
    expect(humanizeBytes(1024 * 1024 * 1024 * 1024)).toBe("1.0 TB");
  });
});

describe("csvCell", () => {
  it("returns the value as-is when it has no special chars", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(true)).toBe("true");
  });

  it("returns empty string for null/undefined", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes and escapes values with commas, quotes, or newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });
});
```

- [ ] **Step 1.2: Implementation**

```js
const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function humanizeBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`;
}

export function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
```

- [ ] **Step 1.3: Run + lint + commit**

```bash
npx vitest run test/report-format.test.js
npx vitest run                  # 132 total (128 + 4)
npx eslint src/report/format.js test/report-format.test.js
git add src/report/format.js test/report-format.test.js
git commit -m "feat(report): add humanizeBytes and csvCell helpers"
```

---

## Task 2 — CSV writer

**Files:** Create `src/report/csv.js`, `test/report-csv.test.js`

The CSV writer accepts an inventory parsed object (the result of streaming through the input NDJSON and collecting header + entries) and produces a CSV string with 32 columns per the spec.

- [ ] **Step 2.1: Tests**

```js
import { describe, it, expect } from "vitest";
import { writeCsv, CSV_COLUMNS } from "../src/report/csv.js";

const baseHeader = {
  schemaVersion: 1,
  kind: "filecap-inventory-header",
  metadata: {
    serverName: "strapi-prod-01",
    hostname: "strapi-prod-01.icjia.local",
    serverIp: "10.42.7.18",
    scannedPath: "/var/strapi/uploads",
    scannedAt: "2024-01-01T00:00:00.000Z",
    filecapVersion: "0.5.0",
    nodeVersion: "v20.11.1",
    options: { introspect: true, hash: true, maxIntrospectMb: 200, concurrency: 4 },
  },
};

const baseEntry = {
  path: "case.pdf",
  absolutePath: "/var/strapi/uploads/case.pdf",
  filename: "case.pdf",
  extension: "pdf",
  category: "pdf",
  remediable: true,
  sizeBytes: 4827193,
  modifiedAt: "2024-03-12T09:14:22.000Z",
  sha256: "abc123",
  flags: [],
};

describe("CSV_COLUMNS", () => {
  it("declares 32 columns in stable order", () => {
    expect(CSV_COLUMNS.length).toBe(32);
    expect(CSV_COLUMNS[0]).toBe("serverName");
    expect(CSV_COLUMNS[CSV_COLUMNS.length - 1]).toBe("flags");
  });
});

describe("writeCsv (single-instance input)", () => {
  it("emits a header row + one row per entry", () => {
    const csv = writeCsv({
      sourceHeader: baseHeader,
      entries: [baseEntry],
      sources: null, // single-instance
    });
    const lines = csv.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
  });

  it("populates introspection-derived columns from PDF entries", () => {
    const entry = {
      ...baseEntry,
      introspection: {
        kind: "pdf",
        pageCount: 47,
        hasTextLayer: true,
        isImageOnly: false,
        hasTags: false,
        hasFormFields: false,
        hasSignatures: false,
        encrypted: false,
        producer: "Microsoft Word",
        creator: "Word",
        creationDate: "2024-01-01T00:00:00.000Z",
        documentLanguage: "en-US",
      },
    };
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [entry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    // pdfPageCount column should be 47, pdfHasTextLayer "true", documentLanguage "en-US"
    expect(cells[CSV_COLUMNS.indexOf("pdfPageCount")]).toBe("47");
    expect(cells[CSV_COLUMNS.indexOf("pdfHasTextLayer")]).toBe("true");
    expect(cells[CSV_COLUMNS.indexOf("documentLanguage")]).toBe("en-US");
    expect(cells[CSV_COLUMNS.indexOf("pdfProducer")]).toBe("Microsoft Word");
  });

  it("emits empty cells for missing introspection fields", () => {
    // Entry without introspection — only filesystem columns populated
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [baseEntry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[CSV_COLUMNS.indexOf("pdfPageCount")]).toBe("");
    expect(cells[CSV_COLUMNS.indexOf("pdfHasTextLayer")]).toBe("");
  });

  it("joins flags with pipe", () => {
    const entry = { ...baseEntry, flags: ["scanned-name-pattern", "filename-has-spaces"] };
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [entry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[CSV_COLUMNS.indexOf("flags")]).toBe("scanned-name-pattern|filename-has-spaces");
  });

  it("emits sizeHuman for human-readable sizes", () => {
    const csv = writeCsv({ sourceHeader: baseHeader, entries: [baseEntry], sources: null });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[CSV_COLUMNS.indexOf("sizeHuman")]).toBe("4.6 MB");
  });
});

describe("writeCsv (consolidated input)", () => {
  it("uses per-entry serverName and looks up serverIp/hostname from sources", () => {
    const consolidatedHeader = {
      schemaVersion: 1,
      kind: "filecap-consolidated-header",
      metadata: {
        consolidatedAt: "2024-01-01T00:00:00.000Z",
        filecapVersion: "0.5.0",
        nodeVersion: "v20.11.1",
        sources: [
          {
            ...baseHeader.metadata,
            stats: { fileCount: 1, totalBytes: 0, scanDurationMs: 0, introspectionFailures: 0, permissionDenials: 0 },
          },
        ],
      },
    };
    const entry = { ...baseEntry, serverName: "strapi-prod-01", duplicateOf: null };
    const csv = writeCsv({
      sourceHeader: consolidatedHeader,
      entries: [entry],
      sources: consolidatedHeader.metadata.sources,
    });
    const dataLine = csv.trim().split("\n")[1];
    const cells = dataLine.split(",");
    expect(cells[CSV_COLUMNS.indexOf("serverName")]).toBe("strapi-prod-01");
    expect(cells[CSV_COLUMNS.indexOf("serverIp")]).toBe("10.42.7.18");
    expect(cells[CSV_COLUMNS.indexOf("hostname")]).toBe("strapi-prod-01.icjia.local");
  });
});
```

- [ ] **Step 2.2: Implementation**

```js
import { humanizeBytes, csvCell } from "./format.js";

export const CSV_COLUMNS = [
  "serverName",
  "serverIp",
  "hostname",
  "scannedPath",
  "relativePath",
  "absolutePath",
  "filename",
  "extension",
  "category",
  "remediable",
  "sizeBytes",
  "sizeHuman",
  "modifiedAt",
  "sha256",
  "documentLanguage",
  "pdfPageCount",
  "pdfHasTextLayer",
  "pdfIsImageOnly",
  "pdfHasTags",
  "pdfHasFormFields",
  "pdfHasSignatures",
  "pdfEncrypted",
  "pdfProducer",
  "pdfCreator",
  "pdfCreationDate",
  "docxHasHeadings",
  "docxAltTextCoverage",
  "docxTableCount",
  "docxImageCount",
  "xlsxSheetCount",
  "xlsxHasMergedCells",
  "flags",
];

/**
 * Build a CSV string from a parsed inventory.
 *
 * @param {object} args
 * @param {object} args.sourceHeader - the inventory's header object
 * @param {Array} args.entries - the inventory's entries
 * @param {Array|null} args.sources - sources[] array (consolidated only); null for single-instance
 * @returns {string} CSV content (header row + N data rows, LF-terminated)
 */
export function writeCsv({ sourceHeader, entries, sources }) {
  const isConsolidated = sourceHeader.kind === "filecap-consolidated-header";
  const sourceMap = new Map();
  if (isConsolidated && sources) {
    for (const s of sources) {
      sourceMap.set(s.serverName, s);
    }
  }

  const lines = [CSV_COLUMNS.join(",")];
  for (const entry of entries) {
    const row = buildRow({ entry, sourceHeader, sourceMap, isConsolidated });
    lines.push(row.map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

function buildRow({ entry, sourceHeader, sourceMap, isConsolidated }) {
  // Server identity
  let serverName, serverIp, hostname, scannedPath;
  if (isConsolidated) {
    serverName = entry.serverName;
    const src = sourceMap.get(entry.serverName);
    serverIp = src?.serverIp ?? "";
    hostname = src?.hostname ?? "";
    scannedPath = src?.scannedPath ?? "";
  } else {
    const m = sourceHeader.metadata;
    serverName = m.serverName;
    serverIp = m.serverIp;
    hostname = m.hostname;
    scannedPath = m.scannedPath;
  }

  // Introspection extraction (kind-keyed; absent fields → empty)
  const intro = entry.introspection ?? null;
  const isPdf = intro?.kind === "pdf";
  const isDocx = intro?.kind === "docx";
  const isXlsx = intro?.kind === "xlsx";

  return [
    serverName,
    serverIp,
    hostname,
    scannedPath,
    entry.path,
    entry.absolutePath,
    entry.filename,
    entry.extension,
    entry.category,
    entry.remediable,
    entry.sizeBytes,
    humanizeBytes(entry.sizeBytes),
    entry.modifiedAt,
    entry.sha256 ?? "",
    intro?.documentLanguage ?? "",
    // PDF
    isPdf ? intro.pageCount : "",
    isPdf ? intro.hasTextLayer : "",
    isPdf ? intro.isImageOnly : "",
    isPdf ? intro.hasTags : "",
    isPdf ? intro.hasFormFields : "",
    isPdf ? intro.hasSignatures : "",
    isPdf ? intro.encrypted : "",
    isPdf ? (intro.producer ?? "") : "",
    isPdf ? (intro.creator ?? "") : "",
    isPdf ? (intro.creationDate ?? "") : "",
    // DOCX
    isDocx ? intro.hasHeadings : "",
    isDocx ? (intro.altTextCoverage ?? "") : "",
    isDocx ? intro.tableCount : "",
    isDocx ? intro.imageCount : "",
    // XLSX
    isXlsx ? intro.sheetCount : "",
    isXlsx ? (intro.mergedCellCount > 0) : "",
    // Flags
    (entry.flags ?? []).join("|"),
  ];
}
```

- [ ] **Step 2.3: Run + lint + commit**

```bash
npx vitest run test/report-csv.test.js
npx vitest run                  # 138 total (132 + 6)
npx eslint src/report/csv.js test/report-csv.test.js
git add src/report/csv.js test/report-csv.test.js
git commit -m "feat(report): add 32-column CSV writer for vendor handoff"
```

---

## Task 3 — Summary writer

**Files:** Create `src/report/summary.js`, `test/report-summary.test.js`

`SUMMARY.txt` is a human-readable plain-text breakdown: file counts by category, total bytes, image-only PDF count, etc.

- [ ] **Step 3.1: Tests**

```js
import { describe, it, expect } from "vitest";
import { writeSummary } from "../src/report/summary.js";

describe("writeSummary", () => {
  it("emits top-level numbers and category breakdown", () => {
    const entries = [
      { category: "pdf", remediable: true, sizeBytes: 1000, introspection: { kind: "pdf", isImageOnly: true, hasTextLayer: false, isImageOnly: true, pageCount: 1, hasTags: false, hasFormFields: false, hasSignatures: false, encrypted: false } },
      { category: "pdf", remediable: true, sizeBytes: 2000, introspection: { kind: "pdf", pageCount: 1, hasTextLayer: true, isImageOnly: false, hasTags: false, hasFormFields: false, hasSignatures: false, encrypted: false } },
      { category: "image", remediable: false, sizeBytes: 500 },
      { category: "office-document", remediable: true, sizeBytes: 1500 },
    ];
    const text = writeSummary({ entries, sources: null });
    expect(text).toContain("Total files: 4");
    expect(text).toContain("Total bytes: 5000");
    expect(text).toContain("pdf: 2");
    expect(text).toContain("image-only PDFs: 1");
    expect(text).toContain("Remediable: 3");
  });

  it("includes consolidated stats when sources are provided", () => {
    const entries = [];
    const sources = [
      { serverName: "a", stats: { fileCount: 100, totalBytes: 1000, scanDurationMs: 0, introspectionFailures: 0, permissionDenials: 0 } },
      { serverName: "b", stats: { fileCount: 200, totalBytes: 2000, scanDurationMs: 0, introspectionFailures: 0, permissionDenials: 0 } },
    ];
    const text = writeSummary({ entries, sources });
    expect(text).toContain("Sources: 2");
    expect(text).toContain("a:");
    expect(text).toContain("b:");
  });
});
```

- [ ] **Step 3.2: Implementation**

```js
import { humanizeBytes } from "./format.js";

/**
 * Build a SUMMARY.txt content from a parsed inventory.
 *
 * @param {object} args
 * @param {Array} args.entries
 * @param {Array|null} args.sources
 * @returns {string} multi-line text
 */
export function writeSummary({ entries, sources }) {
  const lines = [];
  lines.push("filecap inventory summary");
  lines.push("=========================");
  lines.push("");
  lines.push(`Total files: ${entries.length}`);
  const totalBytes = entries.reduce((s, e) => s + (e.sizeBytes ?? 0), 0);
  lines.push(`Total bytes: ${totalBytes} (${humanizeBytes(totalBytes)})`);
  lines.push("");

  // By category
  const byCategory = new Map();
  for (const e of entries) {
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1);
  }
  lines.push("By category:");
  const sortedCats = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  for (const [cat, n] of sortedCats) {
    lines.push(`  ${cat}: ${n}`);
  }
  lines.push("");

  // Remediable count
  const remediableCount = entries.filter((e) => e.remediable).length;
  lines.push(`Remediable: ${remediableCount} of ${entries.length}`);
  lines.push("");

  // Image-only PDFs (high-cost-driver flag)
  const imageOnlyPdfs = entries.filter(
    (e) => e.introspection?.kind === "pdf" && e.introspection.isImageOnly === true,
  ).length;
  lines.push(`image-only PDFs: ${imageOnlyPdfs}`);

  // Sources (consolidated only)
  if (sources && sources.length > 0) {
    lines.push("");
    lines.push(`Sources: ${sources.length}`);
    for (const s of sources) {
      lines.push(`  ${s.serverName}: ${s.stats.fileCount} files, ${humanizeBytes(s.stats.totalBytes)}`);
    }
  }

  return lines.join("\n") + "\n";
}
```

- [ ] **Step 3.3: Run + lint + commit**

```bash
npx vitest run test/report-summary.test.js
npx vitest run                  # 140 total (138 + 2)
npx eslint src/report/summary.js test/report-summary.test.js
git add src/report/summary.js test/report-summary.test.js
git commit -m "feat(report): add SUMMARY.txt writer with category breakdown"
```

---

## Task 4 — Flagged-list writers

**Files:** Create `src/report/flagged.js`, `test/report-flagged.test.js`

Four small writers that filter/sort entries and emit plain text.

- [ ] **Step 4.1: Tests**

```js
import { describe, it, expect } from "vitest";
import {
  writeLargestFiles,
  writeFlaggedFilenames,
  writeDuplicateHashes,
  writePdfImageOnly,
} from "../src/report/flagged.js";

describe("writeLargestFiles", () => {
  it("emits top-50 largest by sizeBytes (desc)", () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({
      sizeBytes: i * 1000,
      path: `f${i}.pdf`,
      filename: `f${i}.pdf`,
    }));
    const text = writeLargestFiles({ entries });
    const lines = text.trim().split("\n");
    // Top 50 + maybe a header line
    expect(lines.length).toBeGreaterThan(40);
    // Largest first
    expect(text).toContain("f59.pdf");
  });
});

describe("writeFlaggedFilenames", () => {
  it("lists entries whose flags include scanned-name-pattern or filename-* flags", () => {
    const entries = [
      { filename: "Scan_001.pdf", flags: ["scanned-name-pattern"] },
      { filename: "ok.pdf", flags: [] },
      { filename: "résumé.pdf", flags: ["filename-non-ascii"] },
    ];
    const text = writeFlaggedFilenames({ entries });
    expect(text).toContain("Scan_001.pdf");
    expect(text).toContain("résumé.pdf");
    expect(text).not.toContain("ok.pdf");
  });
});

describe("writeDuplicateHashes", () => {
  it("groups entries by sha256 and lists groups with >1 member", () => {
    const entries = [
      { sha256: "h1", filename: "a.pdf", serverName: "s1", path: "a.pdf" },
      { sha256: "h1", filename: "a-copy.pdf", serverName: "s2", path: "a-copy.pdf" },
      { sha256: "h2", filename: "b.pdf", serverName: "s1", path: "b.pdf" },
    ];
    const text = writeDuplicateHashes({ entries });
    expect(text).toContain("h1");
    expect(text).toContain("a.pdf");
    expect(text).toContain("a-copy.pdf");
    expect(text).not.toContain("h2"); // h2 appears only once → not a duplicate group
  });
});

describe("writePdfImageOnly", () => {
  it("lists PDFs with isImageOnly === true", () => {
    const entries = [
      { filename: "scan.pdf", introspection: { kind: "pdf", isImageOnly: true } },
      { filename: "born.pdf", introspection: { kind: "pdf", isImageOnly: false } },
      { filename: "no-intro.pdf" },
    ];
    const text = writePdfImageOnly({ entries });
    expect(text).toContain("scan.pdf");
    expect(text).not.toContain("born.pdf");
  });
});
```

- [ ] **Step 4.2: Implementation**

```js
import { humanizeBytes } from "./format.js";

const FILENAME_FLAG_PREFIX = "filename-";

export function writeLargestFiles({ entries, limit = 50 }) {
  const sorted = [...entries].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
  const top = sorted.slice(0, limit);
  const lines = ["Largest files (top " + limit + " by size)", "================================"];
  for (const e of top) {
    lines.push(`${humanizeBytes(e.sizeBytes ?? 0).padStart(10)}  ${e.path ?? e.filename ?? ""}`);
  }
  return lines.join("\n") + "\n";
}

export function writeFlaggedFilenames({ entries }) {
  const flagged = entries.filter((e) => {
    const flags = e.flags ?? [];
    return flags.includes("scanned-name-pattern") || flags.some((f) => f.startsWith(FILENAME_FLAG_PREFIX));
  });
  const lines = ["Files with flagged names", "========================"];
  for (const e of flagged) {
    lines.push(`${(e.flags ?? []).join("|").padEnd(40)}  ${e.path ?? e.filename ?? ""}`);
  }
  return lines.join("\n") + "\n";
}

export function writeDuplicateHashes({ entries }) {
  const groups = new Map();
  for (const e of entries) {
    const h = e.sha256;
    if (!h) continue;
    if (!groups.has(h)) groups.set(h, []);
    groups.get(h).push(e);
  }
  const lines = ["Duplicate-hash groups (content-identical files)", "================================================"];
  for (const [hash, group] of groups) {
    if (group.length < 2) continue;
    lines.push(`${hash}`);
    for (const e of group) {
      const where = e.serverName ? `${e.serverName}:${e.path}` : e.path;
      lines.push(`    ${where}`);
    }
  }
  return lines.join("\n") + "\n";
}

export function writePdfImageOnly({ entries }) {
  const filtered = entries.filter(
    (e) => e.introspection?.kind === "pdf" && e.introspection.isImageOnly === true,
  );
  const lines = ["Image-only PDFs (top remediation cost driver)", "============================================="];
  for (const e of filtered) {
    lines.push(`${humanizeBytes(e.sizeBytes ?? 0).padStart(10)}  ${e.path ?? e.filename ?? ""}`);
  }
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4.3: Run + lint + commit**

```bash
npx vitest run test/report-flagged.test.js
npx vitest run                  # 144 total (140 + 4)
npx eslint src/report/flagged.js test/report-flagged.test.js
git add src/report/flagged.js test/report-flagged.test.js
git commit -m "feat(report): add flagged-list writers (largest, flagged-names, dupes, image-only)"
```

---

## Task 5 — Report orchestrator + CLI

**Files:** Create `src/commands/report.js`, modify `bin/filecap.js`, create `test/report.test.js`

The orchestrator: read input NDJSON line-by-line via readline, collect header + entries + footer, then call each writer and write the resulting strings to files in the output directory.

- [ ] **Step 5.1: Implement `src/commands/report.js`**

```js
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { writeCsv } from "../report/csv.js";
import { writeSummary } from "../report/summary.js";
import {
  writeLargestFiles,
  writeFlaggedFilenames,
  writeDuplicateHashes,
  writePdfImageOnly,
} from "../report/flagged.js";

/**
 * Orchestrate the report generation: read the inventory NDJSON line-by-line,
 * collect header/entries/footer, then write all output artifacts.
 *
 * @param {object} args
 * @param {string} args.input - path to inventory NDJSON
 * @param {string} args.outputDir - directory to write reports into (created if missing)
 * @returns {Promise<{exitCode: number, error?: string}>}
 */
export async function runReport({ input, outputDir }) {
  let header;
  let footer;
  const entries = [];

  let stream;
  try {
    await fs.access(input);
    stream = createReadStream(input, { encoding: "utf8" });
  } catch (err) {
    return { exitCode: 2, error: `cannot read ${input}: ${err.message}` };
  }

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.length === 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed.kind === "filecap-inventory-header" || parsed.kind === "filecap-consolidated-header") {
      header = parsed;
    } else if (parsed.kind === "filecap-inventory-footer" || parsed.kind === "filecap-consolidated-footer") {
      footer = parsed;
    } else {
      entries.push(parsed);
    }
  }

  if (!header) {
    return { exitCode: 2, error: `${input} is missing a header — partial or malformed` };
  }

  await fs.mkdir(outputDir, { recursive: true });

  const isConsolidated = header.kind === "filecap-consolidated-header";
  const sources = isConsolidated ? header.metadata.sources : null;

  const csv = writeCsv({ sourceHeader: header, entries, sources });
  await fs.writeFile(path.join(outputDir, "files.csv"), csv);

  const summary = writeSummary({ entries, sources });
  await fs.writeFile(path.join(outputDir, "SUMMARY.txt"), summary);

  await fs.writeFile(path.join(outputDir, "largest_files.txt"), writeLargestFiles({ entries }));
  await fs.writeFile(path.join(outputDir, "flagged_filenames.txt"), writeFlaggedFilenames({ entries }));
  await fs.writeFile(path.join(outputDir, "duplicate_hashes.txt"), writeDuplicateHashes({ entries }));
  await fs.writeFile(path.join(outputDir, "pdf_image_only.txt"), writePdfImageOnly({ entries }));

  return { exitCode: 0 };
}
```

- [ ] **Step 5.2: Modify `bin/filecap.js`**

Add import:

```js
import { runReport } from "../src/commands/report.js";
```

Replace the report stub:

```js
program
  .command("report")
  .description("(Phase 6 — not yet implemented in v0.1.0)")
  .action(() => {
    process.stderr.write("filecap report is not implemented in v0.1.0 (Phase 6).\n");
    process.exit(1);
  });
```

with:

```js
program
  .command("report <inventory>")
  .description("Generate vendor handoff package (CSV + summary + flagged lists) from an inventory NDJSON")
  .option("-o, --output <dir>", "output directory", `./filecap-report-${Date.now()}/`)
  .action(async (inventory, opts) => {
    try {
      const result = await runReport({ input: inventory, outputDir: opts.output });
      if (result.error) process.stderr.write(`${result.error}\n`);
      process.exit(result.exitCode);
    } catch (err) {
      process.stderr.write(`filecap: ${err.message}\n`);
      process.exit(1);
    }
  });
```

- [ ] **Step 5.3: CLI E2E test in `test/report.test.js`**

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

let tmpRoot;
let outDir;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-report-cli-"));
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-report-cli-out-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.rm(outDir, { recursive: true, force: true });
});

function runCli(args, cwd) {
  const cliPath = fileURLToPath(new URL("../bin/filecap.js", import.meta.url));
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (d) => stdout.push(d));
    child.stderr.on("data", (d) => stderr.push(d));
    child.on("close", (code) => {
      resolve({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
}

function inventoryHeader() {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "filecap-inventory-header",
    metadata: {
      serverName: "test-server",
      hostname: "test-server.local",
      serverIp: "10.0.0.1",
      scannedPath: "/uploads",
      scannedAt: "2024-01-01T00:00:00.000Z",
      filecapVersion: "0.5.0",
      nodeVersion: "v20.11.1",
      options: { introspect: false, hash: true, maxIntrospectMb: 200, concurrency: 4 },
    },
  });
}

describe("filecap report CLI", () => {
  it("generates the full report directory from a single-instance inventory", async () => {
    const ndjson = path.join(tmpRoot, "in.ndjson");
    await fs.writeFile(ndjson, [
      inventoryHeader(),
      JSON.stringify({
        path: "Scan_001.pdf",
        absolutePath: "/uploads/Scan_001.pdf",
        filename: "Scan_001.pdf",
        extension: "pdf",
        category: "pdf",
        remediable: true,
        sizeBytes: 1024,
        modifiedAt: "2024-01-01T00:00:00.000Z",
        sha256: "h1",
        flags: ["scanned-name-pattern"],
      }),
      JSON.stringify({
        path: "ok.pdf",
        absolutePath: "/uploads/ok.pdf",
        filename: "ok.pdf",
        extension: "pdf",
        category: "pdf",
        remediable: true,
        sizeBytes: 2048,
        modifiedAt: "2024-01-01T00:00:00.000Z",
        sha256: "h2",
        flags: [],
      }),
      JSON.stringify({
        kind: "filecap-inventory-footer",
        stats: { fileCount: 2, totalBytes: 3072, scanDurationMs: 1, introspectionFailures: 0, permissionDenials: 0 },
      }),
    ].join("\n") + "\n");

    const reportDir = path.join(outDir, "report");
    const result = await runCli(["report", ndjson, "-o", reportDir], outDir);
    expect(result.code).toBe(0);

    // All expected output files exist
    for (const f of ["files.csv", "SUMMARY.txt", "largest_files.txt", "flagged_filenames.txt", "duplicate_hashes.txt", "pdf_image_only.txt"]) {
      const stat = await fs.stat(path.join(reportDir, f));
      expect(stat.isFile()).toBe(true);
    }

    const csv = await fs.readFile(path.join(reportDir, "files.csv"), "utf8");
    expect(csv.split("\n")[0]).toContain("serverName"); // header row
    expect(csv).toContain("Scan_001.pdf");
    expect(csv).toContain("ok.pdf");

    const summary = await fs.readFile(path.join(reportDir, "SUMMARY.txt"), "utf8");
    expect(summary).toContain("Total files: 2");

    const flagged = await fs.readFile(path.join(reportDir, "flagged_filenames.txt"), "utf8");
    expect(flagged).toContain("Scan_001.pdf");
    expect(flagged).not.toContain("ok.pdf");
  });

  it("returns exit code 2 when input file does not exist", async () => {
    const result = await runCli(["report", path.join(tmpRoot, "no-such.ndjson"), "-o", path.join(outDir, "x")], outDir);
    expect(result.code).toBe(2);
  });
});
```

- [ ] **Step 5.4: Run + lint + commit**

```bash
npx vitest run test/report.test.js
npx vitest run                  # 146 total (144 + 2)
npx eslint src/commands/report.js bin/filecap.js test/report.test.js
git add src/commands/report.js bin/filecap.js test/report.test.js
git commit -m "feat(cli): wire report subcommand with CSV + summary + flagged-list writers"
```

---

## Task 6 — Update `src/index.js` exports

Replace `src/index.js` with the additions for Phase 6:

```js
export { runScan } from "./commands/scan.js";
export { runRollup } from "./commands/rollup.js";
export { runReport } from "./commands/report.js";
export {
  headerSchema,
  entrySchema,
  footerSchema,
  pdfIntrospectionSchema,
  docxIntrospectionSchema,
  xlsxIntrospectionSchema,
  legacyOfficeIntrospectionSchema,
  consolidatedHeaderSchema,
  consolidatedEntrySchema,
  consolidatedFooterSchema,
  isCompleteInventory,
  SCHEMA_VERSION,
} from "./schema/inventory.js";
export { introspect } from "./introspect/index.js";
export { introspectPdf } from "./introspect/pdf.js";
export { introspectDocx } from "./introspect/docx.js";
export { introspectXlsx } from "./introspect/xlsx.js";
export { introspectLegacyOffice } from "./introspect/office-legacy.js";
export { computeFilenameFlags } from "./flag/filename.js";
export { rollupInventories } from "./rollup/merge.js";
export { pickCanonical } from "./rollup/canonical.js";
export { writeCsv, CSV_COLUMNS } from "./report/csv.js";
export { writeSummary } from "./report/summary.js";
export {
  writeLargestFiles,
  writeFlaggedFilenames,
  writeDuplicateHashes,
  writePdfImageOnly,
} from "./report/flagged.js";
export { humanizeBytes, csvCell } from "./report/format.js";
export { FILECAP_VERSION } from "./version.js";
```

(Adds: `runReport`, `writeCsv`, `CSV_COLUMNS`, `writeSummary`, `writeLargestFiles`, `writeFlaggedFilenames`, `writeDuplicateHashes`, `writePdfImageOnly`, `humanizeBytes`, `csvCell` — 10 new exports.)

```bash
node -e "import('./src/index.js').then(m => console.log(Object.keys(m).length, 'exports'))"
# expect 33
npm test                       # 146 passing
npx eslint src/index.js
git add src/index.js
git commit -m "feat: re-export report machinery from package main"
```

---

## Task 7 — README

Update Status (Phase 6 shipped, mark Phase 5 as plain `shipped`, Phase 6 as `**shipped**`). Add a "Report workflow (Phase 6)" section after "Rollup workflow (Phase 5)".

Section content:

````markdown
## Report workflow (Phase 6)

Generate the vendor handoff package from an inventory NDJSON (single-instance or consolidated):

```bash
filecap report consolidated.ndjson -o ./report-2026-Q2/
```

Output directory contents:

| File | Purpose |
|---|---|
| `files.csv` | One row per file, 32 columns (the work-order vendors actually consume). Filterable in Excel, Smartsheet, etc. |
| `SUMMARY.txt` | Top-level numbers: file counts by category, total bytes, image-only PDF count, remediable count, sources |
| `largest_files.txt` | Top 50 files by size (helps schedule the biggest remediation work) |
| `flagged_filenames.txt` | Files whose `flags[]` includes scanned-original or filename anti-patterns |
| `duplicate_hashes.txt` | Content-duplicate groups (entries sharing a SHA-256) — useful for de-dup analysis |
| `pdf_image_only.txt` | PDFs with `isImageOnly: true` — the headline cost driver in PDF remediation |

The CSV is pure inventory — there are NO vendor-fill columns. Vendors return remediated files; ICJIA re-scans and uses `filecap diff` (future phase) to detect changes. This division-of-labor decision is documented in the design doc and locks vendor workflow out of the inventory tool itself.

**CSV column order** (32 columns, stable):

`serverName, serverIp, hostname, scannedPath, relativePath, absolutePath, filename, extension, category, remediable, sizeBytes, sizeHuman, modifiedAt, sha256, documentLanguage, pdfPageCount, pdfHasTextLayer, pdfIsImageOnly, pdfHasTags, pdfHasFormFields, pdfHasSignatures, pdfEncrypted, pdfProducer, pdfCreator, pdfCreationDate, docxHasHeadings, docxAltTextCoverage, docxTableCount, docxImageCount, xlsxSheetCount, xlsxHasMergedCells, flags`

`flags` is pipe-separated (e.g., `scanned-name-pattern|filename-has-spaces`). Empty cells indicate the field doesn't apply to this file's type.
````

Commit: `docs: add Phase 6 report workflow section and update status`.

---

## Task 8 — CHANGELOG [0.6.0]

```markdown
## [0.6.0] — 2026-05-08

### Added

- **Report command.** `filecap report <inventory.ndjson> -o ./report/` consumes a single-instance OR consolidated inventory NDJSON and emits the vendor handoff package: `files.csv` (32-column work-order), `SUMMARY.txt`, `largest_files.txt`, `flagged_filenames.txt`, `duplicate_hashes.txt`, `pdf_image_only.txt`.
- 32-column CSV writer per design-doc spec, with stable column order, header row, and pipe-separated `flags` cell.
- New programmatic exports: `runReport`, `writeCsv`, `CSV_COLUMNS`, `writeSummary`, `writeLargestFiles`, `writeFlaggedFilenames`, `writeDuplicateHashes`, `writePdfImageOnly`, `humanizeBytes`, `csvCell`.

[0.6.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v0.6.0
```

Commit: `docs: add [0.6.0] CHANGELOG entry`.

---

## Task 9 — Bump version to 0.6.0

Edit `package.json`, run `npm install --package-lock-only`, verify, run tests, commit.

---

## Task 10 — Publish v0.6.0

Push origin, run `./publish first`, supply OTP when prompted.

---

## End of Phase 6

After Task 10: `@icjia/filecap@0.6.0` published; ~146 tests; report command working end-to-end. The core utility loop (scan → rollup → report) is now complete and ICJIA can run a full inventory-to-handoff pipeline. Phase 7 (MCP server) and Phase 8 (Strapi-aware mode) remain.
