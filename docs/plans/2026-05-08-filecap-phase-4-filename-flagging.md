# filecap Phase 4 — Filename Flagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@icjia/filecap@0.4.0` — populate the `flags[]` array on every entry with filename-based heuristic flags per design doc section 9 Phase 4. Vendors and remediators filter and sort the inventory CSV by these flags during triage.

**Architecture:** Pure-function `computeFilenameFlags(filename)` in `src/flag/filename.js` runs against every file's basename. The orchestrator already builds entries with `flags: []` — Phase 4 swaps the empty array for the function call. No new deps, no schema changes, no dispatcher changes. The flag taxonomy is documented in the README and applied uniformly regardless of file type.

**Tech Stack:** Node 20+, ESM. No new dependencies — Phase 4 is pure regex matching.

**Out of scope for Phase 4:** Size-based flags (deferred), introspection-derived flags (e.g., `image-only-pdf`; could be a Phase 4.5 stretch), filesystem-metadata flags (e.g., world-writable). Phase 4 is strictly filename pattern matching.

**Flag taxonomy added in Phase 4:**

| Flag | When applied |
|---|---|
| `scanned-name-pattern` | Filename matches scanner/photo/default-output naming: `Scan_*`, `IMG_*`, `Document\d+`, `Untitled*`, all-digit names, common printer/fax defaults |
| `filename-has-spaces` | Basename contains whitespace |
| `filename-non-ascii` | Basename contains characters outside the ASCII printable range |
| `filename-long` | Basename exceeds 200 characters |

---

## File Structure

```
filecap-cli/
├── src/
│   ├── flag/
│   │   └── filename.js                   ← create
│   ├── commands/
│   │   └── scan.js                       ← modify (call computeFilenameFlags)
│   └── index.js                          ← modify (re-export)
├── test/
│   ├── flag-filename.test.js             ← create
│   └── scan.test.js                      ← modify (assert flags populate)
├── README.md                             ← modify (Phase 4 status, flag taxonomy)
├── CHANGELOG.md                          ← modify ([0.4.0] entry)
└── package.json + package-lock.json      ← modify (bump 0.3.0 → 0.4.0 in Task 7)
```

---

## Task 1 — Filename flagging module

**Files:**
- Create: `src/flag/filename.js`
- Create: `test/flag-filename.test.js`

- [ ] **Step 1.1: Write the failing tests**

Create `test/flag-filename.test.js`:

```js
import { describe, it, expect } from "vitest";
import { computeFilenameFlags } from "../src/flag/filename.js";

describe("computeFilenameFlags", () => {
  it("returns an empty array for a clean descriptive filename", () => {
    expect(computeFilenameFlags("annual-report-2024.pdf")).toEqual([]);
  });

  it("flags Scan_NNN patterns", () => {
    expect(computeFilenameFlags("Scan_001.pdf")).toContain("scanned-name-pattern");
    expect(computeFilenameFlags("Scan001.pdf")).toContain("scanned-name-pattern");
    expect(computeFilenameFlags("scan_42.pdf")).toContain("scanned-name-pattern");
  });

  it("flags IMG_NNN patterns", () => {
    expect(computeFilenameFlags("IMG_4567.pdf")).toContain("scanned-name-pattern");
    expect(computeFilenameFlags("IMG4567.jpg")).toContain("scanned-name-pattern");
    expect(computeFilenameFlags("img_001.png")).toContain("scanned-name-pattern");
  });

  it("flags Document\\d+ patterns", () => {
    expect(computeFilenameFlags("Document1.docx")).toContain("scanned-name-pattern");
    expect(computeFilenameFlags("Document42.pdf")).toContain("scanned-name-pattern");
  });

  it("flags Untitled patterns", () => {
    expect(computeFilenameFlags("Untitled.docx")).toContain("scanned-name-pattern");
    expect(computeFilenameFlags("Untitled-1.pdf")).toContain("scanned-name-pattern");
    expect(computeFilenameFlags("untitled.txt")).toContain("scanned-name-pattern");
  });

  it("flags all-digit basenames", () => {
    expect(computeFilenameFlags("12345.pdf")).toContain("scanned-name-pattern");
    expect(computeFilenameFlags("00000001.tiff")).toContain("scanned-name-pattern");
  });

  it("flags common printer/fax/Word defaults", () => {
    expect(computeFilenameFlags("DOC001.pdf")).toContain("scanned-name-pattern");
    expect(computeFilenameFlags("FAX-2024-04-12.pdf")).toContain("scanned-name-pattern");
    expect(computeFilenameFlags("Microsoft Word - draft.pdf")).toContain("scanned-name-pattern");
  });

  it("flags filenames with spaces", () => {
    expect(computeFilenameFlags("annual report.pdf")).toContain("filename-has-spaces");
    expect(computeFilenameFlags("a b c.txt")).toContain("filename-has-spaces");
  });

  it("flags filenames with non-ASCII characters", () => {
    expect(computeFilenameFlags("résumé.pdf")).toContain("filename-non-ascii");
    expect(computeFilenameFlags("文件.docx")).toContain("filename-non-ascii");
  });

  it("flags filenames over 200 characters", () => {
    const longName = "a".repeat(205) + ".pdf";
    expect(computeFilenameFlags(longName)).toContain("filename-long");
  });

  it("does not flag filenames at exactly 200 characters", () => {
    // Boundary: 200 is acceptable; 201+ is flagged.
    const at200 = "a".repeat(196) + ".pdf"; // 196 + 4 = 200
    expect(computeFilenameFlags(at200)).not.toContain("filename-long");
  });

  it("returns multiple flags when multiple conditions match", () => {
    const flags = computeFilenameFlags("Scan 001 résumé.pdf");
    expect(flags).toContain("scanned-name-pattern");
    expect(flags).toContain("filename-has-spaces");
    expect(flags).toContain("filename-non-ascii");
  });

  it("returns flags in stable order (alphabetical)", () => {
    const flags = computeFilenameFlags("Scan 001 résumé.pdf");
    const sorted = [...flags].sort();
    expect(flags).toEqual(sorted);
  });

  it("handles edge cases without throwing", () => {
    expect(computeFilenameFlags("")).toEqual([]);
    expect(computeFilenameFlags(".pdf")).toEqual([]);
    expect(computeFilenameFlags("a")).toEqual([]);
  });
});
```

- [ ] **Step 1.2: Run tests, verify failure**

```bash
cd /Volumes/satechi/webdev/filecap-cli
npx vitest run test/flag-filename.test.js
```

Expected: All tests fail with module-resolution error.

- [ ] **Step 1.3: Implement `src/flag/filename.js`**

Create `src/flag/filename.js` (the directory `src/flag/` does NOT exist yet — your file creation will create it):

```js
/**
 * Filename-based heuristic flags. Pure function, runs on every entry's
 * basename to populate the `flags[]` array. Output flags are returned
 * sorted alphabetically for stable CSV output.
 *
 * Flag values produced:
 *   - "scanned-name-pattern": filename matches scanner/photo/default-output
 *     conventions (Scan_*, IMG_*, Document\d+, Untitled*, all-digit, DOC\d+,
 *     FAX*, "Microsoft Word - *")
 *   - "filename-has-spaces": basename contains whitespace
 *   - "filename-non-ascii": basename contains non-ASCII characters
 *   - "filename-long": basename exceeds 200 characters
 */

const SCANNED_NAME_PATTERNS = [
  /^Scan[_ ]?\d/i,                    // Scan_001, Scan001, Scan 001, scan_42
  /^IMG[_ ]?\d/i,                     // IMG_4567, IMG4567, img_001
  /^Document\d+/i,                    // Document1, Document42
  /^Untitled/i,                       // Untitled, Untitled-1, untitled
  /^DOC\d+/i,                         // DOC001 (printer defaults)
  /^FAX[-_ ]?/i,                      // FAX-2024-04-12, FAX_001
  /^Microsoft Word - /,               // Word's "Save As PDF" default
];

const ALL_DIGITS = /^\d+$/;
const HAS_SPACES = /\s/;
const NON_ASCII = /[^\x20-\x7E]/;     // anything outside printable ASCII
const LONG_THRESHOLD = 200;

export function computeFilenameFlags(filename) {
  if (!filename) return [];

  // basename without extension for pattern checks against the meaningful part
  const lastDot = filename.lastIndexOf(".");
  const stem = lastDot > 0 ? filename.slice(0, lastDot) : filename;

  const flags = new Set();

  if (stem.length === 0) return [];

  if (
    SCANNED_NAME_PATTERNS.some((re) => re.test(stem)) ||
    ALL_DIGITS.test(stem)
  ) {
    flags.add("scanned-name-pattern");
  }
  if (HAS_SPACES.test(filename)) {
    flags.add("filename-has-spaces");
  }
  if (NON_ASCII.test(filename)) {
    flags.add("filename-non-ascii");
  }
  if (filename.length > LONG_THRESHOLD) {
    flags.add("filename-long");
  }

  return [...flags].sort();
}
```

- [ ] **Step 1.4: Run tests**

```bash
npx vitest run test/flag-filename.test.js
```

Expected: All 14 tests pass.

If a test fails, examine which one. The pattern regexes might need adjustment — for example, `Scan_001` vs `Scan001` is handled by `[_ ]?` in the regex. If the implementer encounters issues with specific patterns, they can adjust the regex but must preserve the test contract (which patterns flag and which don't).

- [ ] **Step 1.5: Run full suite (no regression)**

```bash
npx vitest run
```

Expected: 108 tests passing (94 prior + 14 new).

- [ ] **Step 1.6: Lint**

```bash
npx eslint src/flag/filename.js test/flag-filename.test.js
```

Expected: clean.

- [ ] **Step 1.7: Commit**

```bash
git add src/flag/filename.js test/flag-filename.test.js
git commit -m "feat(flag): add filename heuristic flags (scanned, spaces, non-ASCII, long)"
```

---

## Task 2 — Wire filename flags into the scan orchestrator

**Files:**
- Modify: `src/commands/scan.js`
- Modify: `test/scan.test.js`

The orchestrator currently sets `flags: []` on every entry. Phase 4 replaces this with `flags: computeFilenameFlags(filename)`.

- [ ] **Step 2.1: Write failing tests in `test/scan.test.js`**

Append INSIDE the existing `describe("runScan", ...)` block, BEFORE its closing `});`:

```js
  it("populates flags for filenames matching scanner patterns", async () => {
    await fs.writeFile(path.join(tmpRoot, "Scan_001.pdf"), "x");
    await fs.writeFile(path.join(tmpRoot, "regular-name.pdf"), "x");

    const outPath = path.join(outDir, "scanflags.ndjson");
    await runScan({
      directory: tmpRoot,
      output: outPath,
      hash: false,
      concurrency: 4,
      progress: false,
      introspect: false,
      maxIntrospectMb: 200,
    });
    const lines = await readNdjson(outPath);
    const scanEntry = lines.find((l) => l.filename === "Scan_001.pdf");
    const cleanEntry = lines.find((l) => l.filename === "regular-name.pdf");
    expect(scanEntry.flags).toContain("scanned-name-pattern");
    expect(cleanEntry.flags).toEqual([]);
  });

  it("populates multiple flags for problematic filenames", async () => {
    const problematic = "Scan 001 résumé.pdf";
    await fs.writeFile(path.join(tmpRoot, problematic), "x");

    const outPath = path.join(outDir, "multiflags.ndjson");
    await runScan({
      directory: tmpRoot,
      output: outPath,
      hash: false,
      concurrency: 4,
      progress: false,
      introspect: false,
      maxIntrospectMb: 200,
    });
    const lines = await readNdjson(outPath);
    const entry = lines.find((l) => l.filename === problematic);
    expect(entry.flags).toContain("scanned-name-pattern");
    expect(entry.flags).toContain("filename-has-spaces");
    expect(entry.flags).toContain("filename-non-ascii");
  });
```

- [ ] **Step 2.2: Run tests, verify failure**

```bash
npx vitest run test/scan.test.js
```

Expected: 2 new tests fail because `runScan` still emits `flags: []` for all entries.

- [ ] **Step 2.3: Modify `src/commands/scan.js`**

Read `src/commands/scan.js` first. Add an import at the top (after the other `../` imports):

```js
import { computeFilenameFlags } from "../flag/filename.js";
```

Then find the entry construction block. Currently the entry has:

```js
        flags: [],
```

Replace with:

```js
        flags: computeFilenameFlags(path.basename(filePath)),
```

(`path` is already imported; `filePath` is in scope inside the limit callback.)

- [ ] **Step 2.4: Run tests**

```bash
npx vitest run test/scan.test.js
```

Expected: All scan tests pass (20 prior + 2 new = 22).

```bash
npx vitest run
```

Expected: 110 tests passing (108 prior + 2 new).

Wait — actually 14 (from Task 1) + 94 (Phase 3 baseline) = 108 after Task 1; +2 for Task 2 = 110.

- [ ] **Step 2.5: Lint**

```bash
npx eslint src/commands/scan.js test/scan.test.js
```

Expected: clean.

- [ ] **Step 2.6: Commit**

```bash
git add src/commands/scan.js test/scan.test.js
git commit -m "feat(scan): populate flags[] from computeFilenameFlags on every entry"
```

---

## Task 3 — Update src/index.js exports

**Files:**
- Modify: `src/index.js`

- [ ] **Step 3.1: Replace `src/index.js` content**

Read current `src/index.js`. Then replace its content entirely with:

```js
export { runScan } from "./commands/scan.js";
export {
  headerSchema,
  entrySchema,
  footerSchema,
  pdfIntrospectionSchema,
  docxIntrospectionSchema,
  xlsxIntrospectionSchema,
  legacyOfficeIntrospectionSchema,
  isCompleteInventory,
  SCHEMA_VERSION,
} from "./schema/inventory.js";
export { introspect } from "./introspect/index.js";
export { introspectPdf } from "./introspect/pdf.js";
export { introspectDocx } from "./introspect/docx.js";
export { introspectXlsx } from "./introspect/xlsx.js";
export { introspectLegacyOffice } from "./introspect/office-legacy.js";
export { computeFilenameFlags } from "./flag/filename.js";
export { FILECAP_VERSION } from "./version.js";
```

The new export vs Phase 3: `computeFilenameFlags`.

- [ ] **Step 3.2: Verify exports**

```bash
cd /Volumes/satechi/webdev/filecap-cli
node -e "import('./src/index.js').then(m => console.log('exports:', Object.keys(m).sort().join(',')))"
```

Expected: a comma-separated list with 17 exports including `computeFilenameFlags`.

- [ ] **Step 3.3: Run tests**

```bash
npm test
```

Expected: 110 tests passing.

- [ ] **Step 3.4: Lint**

```bash
npx eslint src/index.js
```

Expected: clean.

- [ ] **Step 3.5: Commit**

```bash
git add src/index.js
git commit -m "feat: re-export computeFilenameFlags from package main"
```

---

## Task 4 — CLI E2E test

**Files:**
- Modify: `test/scan.test.js` (append inside the existing `filecap CLI end-to-end` describe block)

- [ ] **Step 4.1: Append the test**

Inside the existing `describe("filecap CLI end-to-end", ...)` block in `test/scan.test.js`, BEFORE its closing `});`, append:

```js
  it("populates filename flags via the CLI", async () => {
    await fs.writeFile(path.join(tmpRoot, "Scan_001.pdf"), "x");
    await fs.writeFile(path.join(tmpRoot, "Untitled-1.docx"), "x");
    await fs.writeFile(path.join(tmpRoot, "spaced name.txt"), "x");
    await fs.writeFile(path.join(tmpRoot, "résumé.pdf"), "x");
    await fs.writeFile(path.join(tmpRoot, "ok.pdf"), "x");

    const outPath = path.join(outDir, "cli-flags.ndjson");
    const result = await runCli(
      ["scan", tmpRoot, "-o", outPath, "--no-hash", "--no-introspect"],
      outDir,
    );
    expect(result.code).toBe(0);
    const text = await fs.readFile(outPath, "utf8");
    const lines = text.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l));

    const scan = lines.find((l) => l.filename === "Scan_001.pdf");
    const untitled = lines.find((l) => l.filename === "Untitled-1.docx");
    const spaced = lines.find((l) => l.filename === "spaced name.txt");
    const resume = lines.find((l) => l.filename === "résumé.pdf");
    const ok = lines.find((l) => l.filename === "ok.pdf");

    expect(scan.flags).toContain("scanned-name-pattern");
    expect(untitled.flags).toContain("scanned-name-pattern");
    expect(spaced.flags).toContain("filename-has-spaces");
    expect(resume.flags).toContain("filename-non-ascii");
    expect(ok.flags).toEqual([]);
  });
```

- [ ] **Step 4.2: Run tests**

```bash
npx vitest run test/scan.test.js
```

Expected: All scan tests pass (the prior count + 1 new).

```bash
npx vitest run
```

Expected: 111 tests passing (110 prior + 1 new).

- [ ] **Step 4.3: Lint**

```bash
npx eslint test/scan.test.js
```

Expected: clean.

- [ ] **Step 4.4: Commit**

```bash
git add test/scan.test.js
git commit -m "test(scan): add CLI E2E test for filename flags"
```

---

## Task 5 — Expanded README

**Files:**
- Modify: `README.md`

- [ ] **Step 5.1: Update the Status section**

Read current README. The status section currently says "Phase 3 shipped (v0.3.0)" and the phase table marks Phase 3 as **shipped**, Phase 4 as next. Replace:

```markdown
**Phase 3 shipped (v0.3.0).** Office introspection is functional. Each Office entry now carries format-specific accessibility signals: DOCX (headings, image alt-text coverage, table headers, hyperlink anti-patterns, language); XLSX (sheet count, default-name detection, header rows, merged cells, charts, images); legacy `.doc/.ppt/.xls` flagged by extension. PDFs continue to carry the full Phase 2 introspection block.
```

with:

```markdown
**Phase 4 shipped (v0.4.0).** Filename-based heuristic flags now populate the `flags[]` array on every entry, surfacing scanned-original patterns (`Scan_*`, `IMG_*`, `Untitled*`, all-digit names), filenames with spaces, non-ASCII characters, or excessive length. Phase 3's Office introspection (DOCX, XLSX, legacy stubs) and Phase 2's PDF introspection both continue unchanged.
```

In the phase table, update Phase 3 and Phase 4 rows. Replace:

```markdown
| 3 | v0.3.0 | **shipped** | Office introspection (DOCX, XLSX, legacy flag) |
| 4 | v0.4.0 | next | Filename flagging |
```

with:

```markdown
| 3 | v0.3.0 | shipped | Office introspection (DOCX, XLSX, legacy flag) |
| 4 | v0.4.0 | **shipped** | Filename flagging |
```

- [ ] **Step 5.2: Add a "Filename flags (Phase 4)" section**

Find the existing `## What gets introspected (Phase 3)` section. Add a NEW section AFTER it (before `## What filecap does not do`):

```markdown
## Filename flags (Phase 4)

Every entry's `flags[]` array is populated with applicable filename-heuristic flags. Vendors filter and sort the inventory CSV by these flags during triage:

| Flag | When applied |
|---|---|
| `scanned-name-pattern` | Filename matches scanner / photo / default-output naming: `Scan_001.pdf`, `IMG_4567.jpg`, `Document1.docx`, `Untitled-1.pdf`, `12345.tiff`, `DOC001.pdf`, `FAX-2024-04-12.pdf`, `Microsoft Word - draft.pdf`, etc. Strong signal that the file is an unprocessed export from a scanner, phone camera, or default save-as. |
| `filename-has-spaces` | Basename contains whitespace. URL-encoded spaces (`%20`) are a common source of CMS friction and copy-paste bugs. |
| `filename-non-ASCII` | Basename contains characters outside the printable ASCII range (e.g., `résumé.pdf`, `文件.docx`). Web-server URL handling and some legacy systems still mishandle these. |
| `filename-long` | Basename exceeds 200 characters. Long names cause filesystem truncation and URL length issues. |

Flags are emitted as a sorted array; the CSV reporter (Phase 6) will join them with `|` for spreadsheet consumption.

A file with no triggered flags has `flags: []` (empty array).
```

(Note: I wrote `filename-non-ASCII` in the table; the actual flag value is `filename-non-ascii`. Use the lowercase form in the table to match.)

Actually correcting: use `filename-non-ascii` (lowercase) in the table.

- [ ] **Step 5.3: Run tests**

```bash
cd /Volumes/satechi/webdev/filecap-cli
npm test
```

Expected: 111 tests passing.

- [ ] **Step 5.4: Verify README structure**

```bash
grep -E "^## " README.md
```

Expected: section headers including "Status", "Quick start", "CLI reference", "Multi-server workflow", "NDJSON output format", "What gets introspected (Phase 3)", "Filename flags (Phase 4)", "What filecap does not do", "Troubleshooting", "License", "Related @icjia tools".

- [ ] **Step 5.5: Commit**

```bash
git add README.md
git commit -m "docs: add Phase 4 filename-flag taxonomy and update status"
```

---

## Task 6 — CHANGELOG [0.4.0] entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 6.1: Add the entry**

Read current `CHANGELOG.md`. Insert a new section ABOVE the existing `## [0.3.0]` section:

```markdown
## [0.4.0] — 2026-05-08

### Added

- **Filename heuristic flags.** Every entry's `flags[]` array is now populated with applicable flags from the Phase 4 taxonomy: `scanned-name-pattern` (Scan_*, IMG_*, Document\d+, Untitled*, all-digit, DOC\d+, FAX*, "Microsoft Word - *"), `filename-has-spaces`, `filename-non-ascii`, `filename-long` (>200 chars). Pure regex matching against the basename — no new runtime dependencies.
- New programmatic export from package main: `computeFilenameFlags(filename)`. Returns a sorted string array of applicable flags.

### Changed

- The orchestrator's entry construction switches `flags: []` to `flags: computeFilenameFlags(filename)`. Phase 1–3 entries had empty `flags[]` arrays; Phase 4 entries populate them. Backward-compatible at the schema level (still `z.array(z.string())`).

[0.4.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v0.4.0
```

(Inserted ABOVE the existing `## [0.3.0]` section.)

- [ ] **Step 6.2: Run tests**

```bash
npm test
```

Expected: 111 tests still passing.

- [ ] **Step 6.3: Verify structure**

```bash
grep -E "^## \[" CHANGELOG.md
```

Expected output (in this order):

```
## [0.4.0] — 2026-05-08
## [0.3.0] — 2026-05-08
## [0.2.0] — 2026-05-08
## [0.1.0] — 2026-05-08
```

- [ ] **Step 6.4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add [0.4.0] CHANGELOG entry"
```

---

## Task 7 — Bump version to 0.4.0

**Files:**
- Modify: `package.json`, `package-lock.json`

Lockstep convention: bump version BEFORE publishing.

- [ ] **Step 7.1: Edit `package.json`**

Change `"version": "0.3.0"` to `"version": "0.4.0"`.

- [ ] **Step 7.2: Sync `package-lock.json`**

```bash
cd /Volumes/satechi/webdev/filecap-cli
npm install --package-lock-only
```

- [ ] **Step 7.3: Verify CLI and module both report 0.4.0**

```bash
./bin/filecap.js --version
node -e "import('./src/index.js').then(m => console.log('FILECAP_VERSION:', m.FILECAP_VERSION))"
```

Expected: both print `0.4.0`.

- [ ] **Step 7.4: Run tests**

```bash
npm test
```

Expected: 111 passing.

- [ ] **Step 7.5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: bump version to 0.4.0"
```

---

## Task 8 — Publish v0.4.0

**Files:** None modified — this task drives the release script.

User-driven release.

- [ ] **Step 8.1: Pre-publish checklist**

```bash
cd /Volumes/satechi/webdev/filecap-cli
npm test
node -p "require('./package.json').version"
git status
git log --oneline | head -10
```

Confirm: 111 tests passing, version `0.4.0`, working tree clean.

- [ ] **Step 8.2: Push to origin**

```bash
git push origin main
```

- [ ] **Step 8.3: Run `./publish first`**

```bash
./publish first
```

The `first` mode publishes the current `package.json` version without re-bumping. It will:
- Verify branch / clean tree / sync / npm auth
- Run `npm test` (111 passing)
- Tag `v0.4.0` at HEAD
- `git push origin main` and `git push origin v0.4.0`
- `npm publish --access public`

You may need to authenticate via the device flow.

- [ ] **Step 8.4: Verify the published version**

```bash
sleep 30
npx --yes @icjia/filecap@0.4.0 --version
```

Expected: prints `0.4.0`.

```bash
mkdir /tmp/v040-smoke && cd /tmp/v040-smoke
touch "Scan_001.pdf" "regular.pdf" "spaced name.txt"
npx --yes @icjia/filecap@0.4.0 scan . -o smoke.ndjson --no-hash --no-introspect
echo "--- entries ---"
sed -n '2,$p' smoke.ndjson | head -5
cd /Volumes/satechi/webdev/filecap-cli
rm -rf /tmp/v040-smoke
```

Expected: each entry's `flags` field reflects the filename. `Scan_001.pdf` → `["scanned-name-pattern"]`, `spaced name.txt` → `["filename-has-spaces"]`, `regular.pdf` → `[]`.

---

## End of Phase 4

After Task 8: `@icjia/filecap@0.4.0` published; 111 tests passing; README, CHANGELOG, package.json all aligned at v0.4.0; filename flagging populates `flags[]` on every entry.

**Next phase:** Phase 5 — Multi-server rollup. The `filecap rollup` command (currently a stub) merges multiple per-server NDJSON inventories into a consolidated NDJSON, with content-duplicate detection via SHA-256. Per design doc section 5–6 and section 12 row 4 (canonical-row semantics: one row per physical copy with `duplicateOf` link).
