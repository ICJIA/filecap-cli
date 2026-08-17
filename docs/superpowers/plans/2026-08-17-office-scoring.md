# Office Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score `.docx`/`.xlsx`/`.pptx` files through audit.icjia.app, blend those scores into every site/fleet file-accessibility average, and give legacy Office files an honest "can't be machine-scored" verdict.

**Architecture:** One canonical `isScoreable(entry)` gate in the scanner's category module replaces the audits command's PDF-only filter and every PDF-gated formatter/tally. The two aggregation tallies (web-rollup's `computeSiteSummary`, html.js's detail-page tally) widen to all scoreable documents and grow an `unscoreableCount`; the band module renames its PDF-labeled fields to document-labeled ones in the same atomic task as all its consumers. Rendering layers (search index/page, audit-report links, XLSX hyperlinks) are verified format-agnostic and are not touched.

**Tech Stack:** Node ≥20 ESM, Commander CLI, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-17-office-scoring-design.md`

## Global Constraints

- Repo lives on `/Volumes/satechi` — use Read/Glob/Grep tools for file content, never `cat`/`head`/`find` (they stall). Bash is fine for git/npm/node.
- User's shell is zsh: never emit a bare `===` word in shell commands.
- Test runner: `npx vitest run <file>` per task, `npx vitest run` (full, ~1,535 tests) before the release task.
- Commit messages: descriptive, NO AI co-author trailers, no Claude-Session lines.
- House copy rule: every number a manager can see must reconcile across surfaces; exception language included.
- Historical What's New entries and the tests pinning them are UNTOUCHED.
- Scoreable = extension `pdf|docx|xlsx|pptx` (Decision 3 in the spec). `.rtf/.odt/.ods/.odp` and legacy `.doc/.xls/.ppt` are remediable-but-unscoreable.
- Bands (≥80/≥60/else) and the min-5 threshold value are unchanged.

---

### Task 1: Canonical scoreable gate in the category module

**Files:**
- Modify: `src/scanner/category.js` (append after `isRemediable`, line 84)
- Test: `test/category.test.js` (append a new describe block)

**Interfaces:**
- Consumes: existing `REMEDIABLE_CATEGORIES`, `isRemediable(category)` in the same file.
- Produces: `SCOREABLE_EXTENSIONS: Set<string>`, `isScoreable(entry: {extension?: string}) => boolean`, `isUnscoreableDocument(entry: {extension?: string, category?: string}) => boolean`. Tasks 2, 5, 6 import all three from `../scanner/category.js` (path relative to their own dirs).

- [ ] **Step 1: Write the failing tests**

Append to `test/category.test.js` (imports at the top of the file gain the three new names):

```js
import {
  categorize,
  isRemediable,
  REMEDIABLE_CATEGORIES,
  SCOREABLE_EXTENSIONS,
  isScoreable,
  isUnscoreableDocument,
} from "../src/scanner/category.js";

describe("isScoreable / isUnscoreableDocument (v1.54.0)", () => {
  it("scores pdf, docx, xlsx, pptx by extension", () => {
    for (const extension of ["pdf", "docx", "xlsx", "pptx", "PDF", "DocX"]) {
      expect(isScoreable({ extension, category: categorize(extension) })).toBe(true);
    }
  });

  it("does not score legacy binaries, ODF, rtf, or non-documents", () => {
    for (const extension of ["doc", "xls", "ppt", "rtf", "odt", "ods", "odp", "jpg", "html", ""]) {
      expect(isScoreable({ extension, category: categorize(extension) })).toBe(false);
    }
  });

  it("tolerates pre-v1.39.0 category drift — a .doc filed under office-document is still unscoreable", () => {
    expect(isScoreable({ extension: "doc", category: "office-document" })).toBe(false);
    expect(isUnscoreableDocument({ extension: "doc", category: "office-document" })).toBe(true);
  });

  it("isUnscoreableDocument = remediable but not machine-scoreable", () => {
    expect(isUnscoreableDocument({ extension: "xls", category: "legacy-office" })).toBe(true);
    expect(isUnscoreableDocument({ extension: "rtf", category: "office-document" })).toBe(true);
    expect(isUnscoreableDocument({ extension: "odp", category: "presentation" })).toBe(true);
    expect(isUnscoreableDocument({ extension: "docx", category: "office-document" })).toBe(false);
    expect(isUnscoreableDocument({ extension: "pdf", category: "pdf" })).toBe(false);
    expect(isUnscoreableDocument({ extension: "jpg", category: "image" })).toBe(false);
  });

  it("SCOREABLE_EXTENSIONS is exactly the four OOXML-era formats", () => {
    expect([...SCOREABLE_EXTENSIONS].sort()).toEqual(["docx", "pdf", "pptx", "xlsx"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/category.test.js`
Expected: FAIL — `SCOREABLE_EXTENSIONS` is not exported.

- [ ] **Step 3: Implement**

Append to `src/scanner/category.js` after `isRemediable`:

```js
// v1.54.0 — THE canonical scoring gate, the REMEDIABLE_CATEGORIES lesson
// applied to scoring. audit.icjia.app scores PDFs and modern OOXML Office
// files (docx/xlsx/pptx); legacy binaries (.doc/.xls/.ppt) and ODF/RTF are
// remediable but cannot be machine-scored (confirmed live 2026-08-17: the
// service 422s them with "re-save in a modern format" guidance).
//
// Extension-based on purpose: `office-document` also holds .rtf/.odt,
// `spreadsheet` holds .ods, `presentation` holds .odp, and pre-v1.39.0
// cached inventories can still carry .doc under the modern slugs — category
// alone would send unsupported formats to the API.
export const SCOREABLE_EXTENSIONS = new Set(["pdf", "docx", "xlsx", "pptx"]);

export function isScoreable(entry) {
  return SCOREABLE_EXTENSIONS.has((entry?.extension ?? "").toLowerCase());
}

// Remediable but not machine-scoreable: legacy Office plus ODF/RTF. Named
// for the tallies — these files get an honest "N/A (legacy format)" verdict
// and a conversion nudge instead of API calls.
export function isUnscoreableDocument(entry) {
  return isRemediable(entry?.category) && !isScoreable(entry);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/category.test.js`
Expected: PASS (all, including the pre-existing describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/scanner/category.js test/category.test.js
git commit -m "feat: canonical isScoreable / isUnscoreableDocument gate (pdf+docx+xlsx+pptx)"
```

---

### Task 2: Audits command scores OOXML documents

**Files:**
- Modify: `src/commands/audits.js` (lines 1–13 header, 38–43 gate, 152–157 comment, 184–187 log, 370–376 log)
- Modify: `bin/filecap.js` (lines 287–289, 311 help strings)
- Test: `test/audits-orchestrator.test.js`

**Interfaces:**
- Consumes: `isScoreable` from `../scanner/category.js` (Task 1).
- Produces: `runAudits` now attaches `entry.audit` to every scoreable entry with a resolvable URL — same 8-field shape (`score, grade, reportUrl, reportId, reportExpiresAt, audited, checkedAt, cached`), same sha256 cache. Legacy/ODF/RTF and non-documents pass through with NO `audit` field (Tasks 5–6 detect them via the category helpers, not via a new NDJSON field).

- [ ] **Step 1: Rewrite the pass-through test as the new contract**

In `test/audits-orchestrator.test.js`, replace the whole test `"does NOT score xlsx/docx/pptx/image entries — they pass through with no audit field"` (lines 154–178) with:

```js
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
```

Also update the header comment block (lines 7–18 of the test file): change "scores every PDF entry" to "scores every scoreable document (pdf/docx/xlsx/pptx)" and the bullet "Non-PDF entries (docx, xlsx, image) are emitted unchanged" to "Legacy Office (.doc/.xls/.ppt), ODF/RTF, and non-document entries are emitted unchanged with no entry.audit field".

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/audits-orchestrator.test.js`
Expected: FAIL — `expect(urls).toHaveLength(4)` receives 1 (only the PDF is sent).

- [ ] **Step 3: Implement in `src/commands/audits.js`**

1. Add to the existing imports from `../audits/cache.js` region:

```js
import { isScoreable } from "../scanner/category.js";
```

2. Delete the local gate (lines 38–43):

```js
// PDF is the only category we score. The others have native checkers in
// their authoring tools (Word, Excel, PowerPoint) — duplicating that work
// here adds noise without value.
function isScoreableEntry(entry) {
  return entry && entry.extension === "pdf" && entry.category === "pdf";
}
```

and replace its one call site (line 157) `if (!isScoreableEntry(entry)) continue;` with `if (!isScoreable(entry)) continue;`.

3. Rename the working variable `pdfsToAudit` (declared line 154, used 181, 185, 191) to `docsToAudit`, and reword the two logs:

- Line 184–187 becomes:

```js
  log(
    `[audits] ${records.length} records total; ${docsToAudit.length} documents to audit ` +
      `(others cached or not machine-scoreable)`,
  );
```

- Line 370–376's `(PDFs: ...)` segment becomes `(documents: ${auditedCount} freshly audited, ...)` — only the word changes.

4. Rewrite the module header (lines 1–13): "walks an inventory NDJSON and scores every machine-scoreable document (PDF + modern Office: docx/xlsx/pptx) via audit.icjia.app… Legacy Office binaries (.doc/.xls/.ppt), ODF/RTF, images, and other file types pass through unchanged — legacy formats can't carry the accessibility structures the audit checks (the service refuses them), so the reports mark them for conversion instead."

5. Comment above the loop (lines 152–153): "Identify the documents we need to actually call the endpoint for."

6. `bin/filecap.js` line 287–289: replace "Score every PDF in an inventory… Only PDFs are scored — docx/xlsx/pptx/image files pass through unchanged." with "Score every machine-scoreable document (PDF, Word .docx, Excel .xlsx, PowerPoint .pptx) in an inventory via audit.icjia.app. Legacy Office binaries (.doc/.xls/.ppt) and other file types pass through unchanged." Line 311: "re-audit every PDF" → "re-audit every document".

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/audits-orchestrator.test.js test/category.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/audits.js bin/filecap.js test/audits-orchestrator.test.js
git commit -m "feat: audits command scores docx/xlsx/pptx via the canonical isScoreable gate"
```

---

### Task 3: Fetcher surfaces the API's own error text

**Files:**
- Modify: `src/audits/retrying-fetcher.js` (throw site, lines 139–143)
- Test: `test/audits-retrying-fetcher.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: thrown non-retryable HTTP errors now read `HTTP <status> <statusText> for <url> — <body.error>` when the response body is JSON with a string `error` field; unchanged otherwise. Task 4's categorizer regexes (`\b422\b`, `\b413\b`, `\b5\d\d\b`) still match because the status stays first.

- [ ] **Step 1: Write the failing tests**

Append to the top-level describe in `test/audits-retrying-fetcher.test.js` (match the file's existing mock style — it builds fetchers returning Response-like objects; use the same helper the existing 4xx test uses. The Response-like mock must include a `json()` method):

```js
  it("appends the JSON body's error text to a non-retryable HTTP error", async () => {
    const fetcher = createRetryingJsonFetcher({ maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1, log: () => {} });
    const fetchImpl = async () => ({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      headers: { get: () => null },
      json: async () => ({ error: "The fetched Excel file could not be read.", details: "corrupt" }),
    });
    await expect(fetcher("https://audit.example/api", {}, fetchImpl)).rejects.toThrow(
      "HTTP 422 Unprocessable Entity for https://audit.example/api — The fetched Excel file could not be read.",
    );
  });

  it("throws the plain status line when the error body is not JSON", async () => {
    const fetcher = createRetryingJsonFetcher({ maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1, log: () => {} });
    const fetchImpl = async () => ({
      ok: false,
      status: 413,
      statusText: "Payload Too Large",
      headers: { get: () => null },
      json: async () => { throw new Error("not json"); },
    });
    await expect(fetcher("https://audit.example/api", {}, fetchImpl)).rejects.toThrow(
      "HTTP 413 Payload Too Large for https://audit.example/api",
    );
  });
```

NOTE for the implementer: open `test/audits-retrying-fetcher.test.js` first and copy its ACTUAL invocation pattern — if the factory takes the fetch impl at construction (e.g. `createRetryingJsonFetcher({ fetchImpl })`) rather than per-call, adapt these two tests to that pattern; the assertions stay identical.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/audits-retrying-fetcher.test.js`
Expected: the two new tests FAIL (message lacks the appended error text) — existing tests still pass.

- [ ] **Step 3: Implement**

In `src/audits/retrying-fetcher.js`, replace lines 139–143:

```js
      if (!retryable || exhausted) {
        throw new Error(
          `HTTP ${response.status} ${response.statusText} for ${url}`,
        );
      }
```

with:

```js
      if (!retryable || exhausted) {
        // v1.54.0 — the API's JSON error bodies say WHY ("legacy format…",
        // "could not be read…"). With Office formats in play a bare 422 is
        // ambiguous, so surface the reason; the status stays first so the
        // categorizer's \b4xx\b regexes keep matching. Best-effort: a
        // non-JSON body (proxy HTML, empty) keeps the plain status line.
        let detail = "";
        try {
          const body = await response.json();
          if (typeof body?.error === "string" && body.error.length > 0) {
            detail = ` — ${body.error}`;
          }
        } catch {
          // body unreadable — keep the plain status line
        }
        throw new Error(
          `HTTP ${response.status} ${response.statusText} for ${url}${detail}`,
        );
      }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/audits-retrying-fetcher.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audits/retrying-fetcher.js test/audits-retrying-fetcher.test.js
git commit -m "feat: surface the audit API's JSON error reason in thrown HTTP errors"
```

---

### Task 4: Format-aware error taxonomy and error-page copy

**Files:**
- Modify: `src/report/audit-errors.js` (categorizer, lines 29–92; module header lines 1–7)
- Modify: `src/report/audit-errors-page.js` (intro lede, line 111)
- Modify: `src/web/index-page.js` (file-errors blurb, line 158)
- Test: `test/report-audit-errors.test.js`, `test/audit-errors-page.test.js`, `test/index-page.test.js`

**Interfaces:**
- Consumes: `entry.category` / `entry.extension` (already on every entry).
- Produces: `categorizeAuditError` kinds — existing `not-a-pdf` (PDF-only now), new `invalid-document` (non-PDF 422), existing `too-large` (reason text branches by category), existing `audit-unavailable` / `audit-error` / `content-mismatch`. No consumer branches on the new kind (html.js checks only `too-large`), so it is additive.

- [ ] **Step 1: Write the failing tests**

In `test/report-audit-errors.test.js`, add to the categorizer describe (mirror the file's existing entry-fixture style at lines 82–140):

```js
  it("categorizes a docx 422 as invalid-document with Word wording", () => {
    const cat = categorizeAuditError({
      extension: "docx",
      category: "office-document",
      audit: { error: "HTTP 422 Unprocessable Entity for https://x/m.docx — The fetched Word document could not be read." },
    });
    expect(cat.kind).toBe("invalid-document");
    expect(cat.reason).toMatch(/not a valid Word/);
    expect(cat.reason).toMatch(/corrupt or mislabeled/);
    expect(cat.reason).not.toMatch(/not a valid PDF/);
  });

  it("keeps the PDF wording for a pdf 422", () => {
    const cat = categorizeAuditError({
      extension: "pdf",
      category: "pdf",
      audit: { error: "HTTP 422 Unprocessable Entity for https://x/f.pdf" },
    });
    expect(cat.kind).toBe("not-a-pdf");
    expect(cat.reason).toMatch(/not a valid PDF/);
  });

  it("gives an oversized xlsx the size verdict without PDF-specific advice", () => {
    const cat = categorizeAuditError({
      extension: "xlsx",
      category: "spreadsheet",
      sizeBytes: 30 * 1024 * 1024,
      audit: { error: "HTTP 413 Payload Too Large for https://x/big.xlsx" },
    });
    expect(cat.kind).toBe("too-large");
    expect(cat.reason).toMatch(/29 MB — over the audit service's 25 MB limit/);
    expect(cat.reason).toMatch(/Reduce its size/);
    expect(cat.reason).not.toMatch(/text layer|OCR|split it into parts/);
  });

  it("says documents, not PDFs, in the timeout note", () => {
    const cat = categorizeAuditError({
      extension: "pptx",
      category: "presentation",
      sizeBytes: 8 * 1024 * 1024,
      audit: { error: "HTTP 504 Gateway Timeout for https://x/deck.pptx" },
    });
    expect(cat.kind).toBe("audit-unavailable");
    expect(cat.reason).toMatch(/large or complex documents can time out/);
  });
```

In `test/audit-errors-page.test.js`, update the lede assertion (grep the file for "not actually a PDF" and adjust that test) to expect the new sentence given in Step 3.

In `test/index-page.test.js`, grep for "saved with a .pdf name" and update that assertion to the new blurb from Step 3.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/report-audit-errors.test.js test/audit-errors-page.test.js test/index-page.test.js`
Expected: new/changed assertions FAIL.

- [ ] **Step 3: Implement**

1. `src/report/audit-errors.js` — add a label helper above `categorizeAuditError` and rework two branches:

```js
// Human name for a scoreable non-PDF format, for error prose.
const FORMAT_LABELS = {
  "office-document": "Word (.docx)",
  spreadsheet: "Excel (.xlsx)",
  presentation: "PowerPoint (.pptx)",
};
```

Replace the 422 branch (lines 37–43):

```js
    if (/\b422\b|unprocessable/i.test(err)) {
      if (entry.category === "pdf") {
        return {
          kind: "not-a-pdf",
          reason:
            "The audit service rejected it as not a valid PDF — the file is most likely not actually a PDF (for example, an HTML page or another format saved with a .pdf name).",
        };
      }
      const label = FORMAT_LABELS[entry.category] ?? `.${ext}`;
      return {
        kind: "invalid-document",
        reason: `The audit service rejected it as not a valid ${label} file — it is most likely corrupt, or another format saved with a .${ext} name.`,
      };
    }
```

In the 413 branch, wrap the two introspection-aware returns (lines 55–66) in `if (entry.category === "pdf") { … }` and change the final fallthrough (lines 67–70) to:

```js
      if (entry.category === "pdf") {
        return {
          kind: "too-large",
          reason: `${base} To get it graded, split it into parts under ${AUDIT_SIZE_CAP_MB} MB and audit each part.`,
        };
      }
      return {
        kind: "too-large",
        reason: `${base} Reduce its size (large embedded images and media are the usual cause) to get it scored.`,
      };
```

In the unavailable branch (line 75), change `large PDFs can time out` to `large or complex documents can time out`.

Module header (lines 1–7): "some PDFs carry" → "some documents carry".

2. `src/report/audit-errors-page.js:111` — replace the lede sentence with:

```
Files the accessibility audit could not score, or whose content does not match their extension. A 422 means the file is not what its extension claims — a fake or corrupt PDF, Word, Excel, or PowerPoint file; "could not process" usually means a very large or complex document timed out — re-running the audit retries it.
```

3. `src/web/index-page.js:158` — replace the non-zero blurb string with:

```js
      : `${he(n)} file${n === 1 ? "" : "s"} across ${he(withErrors)} site${withErrors === 1 ? "" : "s"} could not be audited — most are files saved with the wrong extension, or large documents that timed out.`;
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/report-audit-errors.test.js test/audit-errors-page.test.js test/index-page.test.js test/report-html.test.js`
Expected: PASS (report-html's too-large chip test still passes — PDF branches unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/report/audit-errors.js src/report/audit-errors-page.js src/web/index-page.js test/report-audit-errors.test.js test/audit-errors-page.test.js test/index-page.test.js
git commit -m "feat: format-aware audit-error taxonomy (invalid-document kind, Office too-large/timeout wording)"
```

---

### Task 5: Blend the averages — tallies, band module, guard, scores-by-site (one atomic rename)

This is the largest task; it must land as ONE commit because the band module's field renames and every consumer move together (aliases would leave lying names in a shipped commit).

**Files:**
- Modify: `src/report/accessibility-band.js` (whole summarize/coverage/thin-data section)
- Modify: `src/commands/web-rollup.js` (tally lines 1001–1043; a11y-history call ~1183–1191; unscored-guard consumer; `audit-fleet-context.md` shape doc lines 730–738)
- Modify: `src/report/html.js` (tally lines 483–517; banner head line 453; comments 448–451)
- Modify: `src/web/unscored-guard.js` (whole tally/copy)
- Modify: `src/web/index-page.js` (renderScorecards lines 632–653; renderFileA11y head line 685; comment 678–683)
- Modify: `src/report/scores-by-site.js` (columns + builder)
- Test: `test/report-accessibility-band.test.js`, `test/unscored-guard.test.js`, `test/scores-by-site.test.js`, `test/index-page.test.js`, `test/report-html.test.js`, `test/web-rollup*.test.js`

**Interfaces:**
- Consumes: `isScoreable`, `isUnscoreableDocument` (Task 1).
- Produces (the new contracts every later task and test relies on):
  - `computeSiteSummary` summary fields: `auditedDocCount` (was `auditedPdfCount`), `auditScoreSum`, `auditErrorCount`, `auditPending` (all three now span every scoreable document), NEW `unscoreableCount` (legacy + ODF/RTF), everything else unchanged (`remediablePageCounts` still counts by category, `pdfPagesMeasured` still PDF-only).
  - `summarizeFileA11y({auditScoreSum, auditedDocCount, auditErrorCount, auditPending, unscoreable, remediable, siteSlug})` returns `{excluded, avg, scored, docs, remediable, unscoreable, band, enoughData}` (was `pdfs`/`office`). Export `MIN_SCORED_DOCS` (value 5) replacing `MIN_SCORED_PDFS`.
  - `findUnscoredSites` returns `[{name, label, docs}]` (was `pdfs`).
  - `SCORES_BY_SITE_COLUMNS` keys: `site, remediable, scoreable, scored, pctScored, avgScore, a, b, c, d, f, unscoreable` with labels `Website, Remediable files, Documents scoreable, Documents scored, % scored, Avg score, A, B, C, D, F, Legacy Office (not scoreable)`.

- [ ] **Step 1: Update the band-module tests to the new contract**

In `test/report-accessibility-band.test.js`:
- Change the import/assertion `MIN_SCORED_PDFS` → `MIN_SCORED_DOCS` (still `toBe(5)`).
- Everywhere a fixture passes `auditedPdfCount:` rename the key to `auditedDocCount:`; results `r.pdfs` → `r.docs`.
- Replace the derived-office test (lines ~90–94, "derives the non-PDF (office) remediable count as remediable minus PDFs") with:

```js
  it("carries the explicit unscoreable count through (no more derived office subtraction)", () => {
    const r = summarizeFileA11y({ auditScoreSum: 400, auditedDocCount: 5, unscoreable: 748, remediable: 4628 });
    expect(r.unscoreable).toBe(748);
    expect(r.scored).toBe(5);
  });
```

- Coverage-text assertions: replace the `/non-PDF/` expectations with the new copy:

```js
  it("names the legacy files and the conversion fix in the coverage caption", () => {
    const text = fileA11yCoverageText({ scored: 3854, remediable: 4628, unscoreable: 748 });
    expect(text).toBe(
      "3,854 of 4,628 remediable files scored · 748 legacy Office files can't be machine-scored (re-save as .docx/.xlsx/.pptx to score them) — remediable files only, not all files.",
    );
  });

  it("singularizes the legacy clause", () => {
    const text = fileA11yCoverageText({ scored: 5, remediable: 6, unscoreable: 1 });
    expect(text).toContain("1 legacy Office file can't be machine-scored");
  });

  it("omits the legacy clause when there are none", () => {
    const text = fileA11yCoverageText({ scored: 5, remediable: 5, unscoreable: 0 });
    expect(text).toBe("5 of 5 remediable files scored — remediable files only, not all files.");
  });
```

- Thin-data assertions: "PDF"/"PDFs" wording → "document"/"documents":

```js
  it("explains thin data in document terms", () => {
    expect(fileA11yThinDataText({ scored: 0, docs: 0 })).toBe("No scoreable documents on this site.");
    expect(fileA11yThinDataText({ scored: 1, docs: 1 })).toBe("Only 1 document on this site — too few for a reliable score (needs 5).");
    expect(fileA11yThinDataText({ scored: 1, docs: 3 })).toBe("Only 1 of 3 documents scored so far — too few for a reliable score (needs 5).");
  });
```

(Keep the 100→99 clamp and band-suppression tests as-is apart from the key renames.)

- [ ] **Step 2: Update guard + scores-by-site tests**

`test/unscored-guard.test.js`: in the `sr()` helper rename `auditedPdfCount` → `auditedDocCount`; expected objects `pdfs:` → `docs:` (e.g. `{ name: "agency", label: "agency", docs: 918 }`); `formatUnscoredWarning` fixtures pass `docs:` and the assertions change `"918 PDFs, 0 scored"`-style expectations to `"918 documents, 0 scored"`, `"have PDFs but NO"` to `"have scoreable documents but NO"`, and the test names' "PDFs" wording accordingly.

`test/scores-by-site.test.js`: fixtures rename `auditedPdfCount` → `auditedDocCount` and add `unscoreableCount` where the old test summed `remediablePageCounts` (`expect(a.office).toBe(15)` becomes `expect(a.unscoreable).toBe(<fixture's unscoreableCount>)`); the column-key list assertion (line ~74) becomes `["site","remediable","scoreable","scored","pctScored","avgScore","a","b","c","d","f","unscoreable"]`; `rows[0].office` references → `rows[0].unscoreable`.

`test/index-page.test.js`: `"5 scored PDFs"` → `"5 scored documents"`, `"No PDFs scored yet"` → `"No documents scored yet"` (two places), plus any fixture keys `auditedPdfCount` → `auditedDocCount`.

`test/report-html.test.js`: fixture keys renamed the same way; the thin-data assertion `"Only 1 of 2 PDFs scored so far — too few for a reliable score (needs 5)."` → `"Only 1 of 2 documents scored so far — too few for a reliable score (needs 5)."`.

`test/web-rollup*.test.js` (`web-rollup.test.js`, `web-rollup-fixes.test.js`, `web-rollup-contract.test.js`, `web-rollup-helpers.test.js`, `web-rollup-search.test.js`): grep each for `auditedPdfCount` and rename to `auditedDocCount`; in `web-rollup-fixes.test.js` the guard-warning string assertions change "PDFs" → "documents"; the contract test's summary-shape list adds `unscoreableCount`.

- [ ] **Step 3: Run to verify failures**

Run: `npx vitest run test/report-accessibility-band.test.js test/unscored-guard.test.js test/scores-by-site.test.js`
Expected: FAIL on every renamed field/string.

- [ ] **Step 4: Implement the band module**

`src/report/accessibility-band.js`:
- Line 27: `export const MIN_SCORED_DOCS = 5;` with comment "An average over a handful of documents is noise — below this many scored documents we show a 'not enough data yet' caption instead of a band." (Delete `MIN_SCORED_PDFS`; a grep for it must come back empty repo-wide at the end of this task.)
- Rewrite the scope note (lines 8–12): "Scope note: the per-file numeric score is the audit.icjia.app document score (0-100, higher = more accessible) and covers every machine-scoreable document — PDFs plus modern Office (docx/xlsx/pptx). Legacy Office binaries and ODF/RTF are counted as remediable but cannot be machine-scored, so the average is over scored documents — callers surface the unscoreable count beside it. This is a directional gauge, NOT a fleet-wide compliance grade."
- `summarizeFileA11y` becomes:

```js
export function summarizeFileA11y({
  auditScoreSum = 0,
  auditedDocCount = 0,
  auditErrorCount = 0,
  auditPending = 0,
  unscoreable = 0,
  remediable = 0,
  siteSlug = "",
} = {}) {
  const scored = auditedDocCount;
  const docs = scored + auditErrorCount + auditPending;
  // v1.39.0: clamp a rounded-up 100 to 99 unless every scored document
  // really is a 100 (sum === scored × 100).
  let avg = scored > 0 ? Math.round(auditScoreSum / scored) : null;
  if (avg === 100 && auditScoreSum < scored * 100) avg = 99;
  const excluded = A11Y_SCORE_EXCLUDE_SLUGS.includes(siteSlug);
  const enoughData = scored >= MIN_SCORED_DOCS;
  const band = !excluded && enoughData && avg !== null ? bandForScore(avg) : null;
  return { excluded, avg, scored, docs, remediable, unscoreable, band, enoughData };
}
```

(JSDoc updated to match: `auditedDocCount` "documents with a numeric score", `unscoreable` "remediable files that can't be machine-scored (legacy Office, ODF/RTF)".)
- `fileA11yCoverageText`:

```js
export function fileA11yCoverageText(a) {
  const parts = [
    `${a.scored.toLocaleString()} of ${a.remediable.toLocaleString()} remediable files scored`,
  ];
  if (a.unscoreable > 0) {
    parts.push(
      `${a.unscoreable.toLocaleString()} legacy Office ${a.unscoreable === 1 ? "file" : "files"} can't be machine-scored (re-save as .docx/.xlsx/.pptx to score them)`,
    );
  }
  return `${parts.join(" · ")} — remediable files only, not all files.`;
}
```

- `fileA11yThinDataText`:

```js
export function fileA11yThinDataText(a) {
  if (!a.docs) return "No scoreable documents on this site.";
  const tail = `too few for a reliable score (needs ${MIN_SCORED_DOCS}).`;
  if (a.scored >= a.docs) {
    return `Only ${a.docs.toLocaleString()} document${a.docs === 1 ? "" : "s"} on this site — ${tail}`;
  }
  return `Only ${a.scored.toLocaleString()} of ${a.docs.toLocaleString()} documents scored so far — ${tail}`;
}
```

- [ ] **Step 5: Implement the web-rollup tally**

`src/commands/web-rollup.js` — import `isScoreable, isUnscoreableDocument` from `../scanner/category.js` (extend the file's existing category import). Declare `let unscoreableCount = 0;` beside the other counters (find `auditedPdfCount` declarations near the loop head) and rename those counters `auditedPdfCount` → `auditedDocCount` throughout the function. Replace lines 1001–1030 with (note the audit tally and the per-category counters are now INDEPENDENT ifs — a scoreable docx must both enter the audit tally and still increment `docxCount` for the page-estimate/type-bucket machinery):

```js
    // v1.54.0 audit stats — every machine-scoreable document (PDF + modern
    // Office) is scored by the audits step; legacy Office / ODF / RTF are
    // counted as unscoreable so the coverage caption can say so.
    if (isScoreable(obj)) {
      const audit = obj.audit;
      if (audit && typeof audit === "object") {
        if (typeof audit.score === "number") {
          auditedDocCount++;
          auditScoreSum += audit.score;
          const gr = typeof audit.grade === "string" ? audit.grade.toUpperCase() : null;
          if (gr && byGrade[gr] !== undefined) byGrade[gr]++;
        } else if (audit.error) {
          auditErrorCount++;
        } else {
          // skipped (no public URL, etc.) — counted as pending so the
          // operator knows there's something to investigate.
          auditPending++;
        }
      } else {
        auditPending++;
      }
    } else if (isUnscoreableDocument(obj)) {
      unscoreableCount++;
    }
    if (cat === "pdf") {
      const pc = obj.introspection?.pageCount;
      if (typeof pc === "number" && pc >= 0) pdfPagesMeasured += pc;
    } else if (cat === "office-document") {
      docxCount++;
    } else if (cat === "presentation") {
      pptxCount++;
    } else if (cat === "spreadsheet") {
      xlsxCount++;
    } else if (cat === "legacy-office") {
      legacyOfficeCount++;
    }
  }
```

Return object gains `unscoreableCount` and carries the renamed `auditedDocCount`. Then chase every consumer INSIDE web-rollup.js: the a11y-history pre-pass call (~1183–1191) passes `auditedDocCount: summary.auditedDocCount, unscoreable: summary.unscoreableCount`; the `summarizeFileA11y` call site(s) likewise; the `audit-fleet-context.md` doc strings at 730–738 change "object on PDFs that went through the audit step" to "object on machine-scoreable documents (PDF/docx/xlsx/pptx) that went through the audit step" and "`__auditUrl` … (PDFs only; v1.9.0+)" to "(scoreable documents; PDFs-only before v1.54.0)". Run `grep -n "auditedPdfCount" src/commands/web-rollup.js` — must return nothing.

- [ ] **Step 6: Implement the html.js tally + banner**

`src/report/html.js` — import `isScoreable, isUnscoreableDocument` from `../scanner/category.js`. In the writeHtml tally (483–517): rename `auditedPdfCount` → `auditedDocCount`, add `let unscoreableCount = 0;`, and replace the `if (cat === "pdf") { … }` audit block with the same independent-ifs shape as Step 5 (audit tally under `isScoreable(entry)`, `else if (isUnscoreableDocument(entry)) unscoreableCount++;`). Update the comment (483–485): "per-file document audit tally… Every machine-scoreable document (PDF + modern Office) carries a numeric score when audited; legacy Office is remediable but unscoreable." Pass `unscoreable: unscoreableCount, auditedDocCount` into its `summarizeFileA11y` call. Banner head (453): `File accessibility <small>(documents)</small>`; comment 448–451 "(PDFs)" → "(documents)" and "scored-PDF audit reports" → "scored documents".

- [ ] **Step 7: Implement guard, index-page, scores-by-site**

`src/web/unscored-guard.js`:

```js
function docTally(summary) {
  const scored = Number(summary?.auditedDocCount) || 0;
  const errored = Number(summary?.auditErrorCount) || 0;
  const pending = Number(summary?.auditPending) || 0;
  return { docs: scored + errored + pending, scored };
}

export function findUnscoredSites(siteResults) {
  const out = [];
  for (const sr of siteResults ?? []) {
    const { docs, scored } = docTally(sr?.summary);
    if (docs > 0 && scored === 0) {
      const name = sr?.site?.name ?? "(unnamed)";
      out.push({ name, label: sr?.site?.siteName ?? name, docs });
    }
  }
  return out;
}
```

`formatUnscoredWarning` lines: `` `    ${u.label.padEnd(width)}  ${String(u.docs).padStart(5)} documents, 0 scored` `` and header `` `${unscored.length} site(s) have scoreable documents but NO accessibility scores:` ``; body line "so every PDF will render" → "so every document will render". JSDoc "A PDF carries a grade" → "A document carries a grade". Grep web-rollup.js for `.pdfs` uses of the guard result and rename to `.docs`.

`src/web/index-page.js` renderScorecards (632–653):

```js
export function renderScorecards(summary, siteAudit) {
  const auditedDocCount = summary?.auditedDocCount ?? 0;
  const fileScore = auditedDocCount > 0
    ? Math.round((summary?.auditScoreSum ?? 0) / auditedDocCount)
    : null;
  const fileCov = auditedDocCount > 0
    ? `avg of ${auditedDocCount.toLocaleString()} scored document${auditedDocCount === 1 ? "" : "s"}`
    : "";
```

and the donut call: `empty: "No documents scored yet"`. Comment block 627–634: "File score = average score of the site's SCORED documents (PDF + modern Office; legacy Office can't be machine-scored)". renderFileA11y head (685): `File accessibility <small>(documents)</small>`; comment 678–683 updated the same way.

`src/report/scores-by-site.js` — full column list:

```js
export const SCORES_BY_SITE_COLUMNS = [
  { key: "site", label: "Website" },
  { key: "remediable", label: "Remediable files", type: "number" },
  { key: "scoreable", label: "Documents scoreable", type: "number" },
  { key: "scored", label: "Documents scored", type: "number" },
  { key: "pctScored", label: "% scored", type: "number" },
  { key: "avgScore", label: "Avg score", type: "number" },
  { key: "a", label: "A", type: "number" },
  { key: "b", label: "B", type: "number" },
  { key: "c", label: "C", type: "number" },
  { key: "d", label: "D", type: "number" },
  { key: "f", label: "F", type: "number" },
  { key: "unscoreable", label: "Legacy Office (not scoreable)", type: "number" },
];
```

Delete `officeCount()`. In the row builder: `const scored = s.auditedDocCount ?? 0;` `const scoreable = scored + (s.auditErrorCount ?? 0) + (s.auditPending ?? 0);` `const unscoreable = s.unscoreableCount ?? 0;` — rename the `pdfs` totals/row fields to `scoreable` and `office` to `unscoreable` throughout, including the TOTAL row. Module header: "roll-up of document accessibility scoring".

- [ ] **Step 8: Full-suite run**

Run: `npx vitest run`
Expected: PASS (~1,540). Grep-check before committing:

```bash
grep -rn "auditedPdfCount\|MIN_SCORED_PDFS" src/ test/ | grep -v "docs/"
```
Expected: no hits.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: blend Office scores into site/fleet averages — auditedDocCount + unscoreableCount through band, tallies, guard, scores-by-site"
```

---

### Task 6: Per-file score cells — legacy verdict, Office scores in workbooks

**Files:**
- Modify: `src/report/csv.js` (lines 175–221 formatters + comment blocks 33–49, 66–85, 186–192)
- Test: `test/report-remediation-score.test.js`, `test/report-csv.test.js`, `test/report-xlsx.test.js`

**Interfaces:**
- Consumes: `isScoreable`, `isUnscoreableDocument` from `../scanner/category.js`.
- Produces: `formatRemediationScore(entry)` → `"B/88"` (scored, any format) / `"Not scored"` (scoreable with `audit.error`) / `"N/A (legacy format)"` (unscoreable document) / `""` (pending, skipped, non-remediable). `formatAuditScoreNum` / `formatAuditGrade` return values for any scoreable entry, `""` otherwise. `formatPageCount` unchanged (PDF-only, measured pages).

- [ ] **Step 1: Update the tests to the new contract**

`test/report-remediation-score.test.js` — the docx/xlsx/pptx cases split in two:

```js
  it("formats a scored docx like a scored PDF", () => {
    expect(formatRemediationScore({ category: "office-document", extension: "docx", audit: { score: 79, grade: "C" } })).toBe("C/79");
  });

  it("marks an errored xlsx Not scored", () => {
    expect(formatRemediationScore({ category: "spreadsheet", extension: "xlsx", audit: { error: "HTTP 413 Payload Too Large for https://x" } })).toBe("Not scored");
  });

  it("gives legacy Office and ODF/RTF the legacy-format verdict", () => {
    expect(formatRemediationScore({ category: "legacy-office", extension: "xls" })).toBe("N/A (legacy format)");
    expect(formatRemediationScore({ category: "office-document", extension: "rtf" })).toBe("N/A (legacy format)");
  });

  it("leaves a pending docx blank (no final state to report)", () => {
    expect(formatRemediationScore({ category: "office-document", extension: "docx" })).toBe("");
  });
```

Replace every existing `"N/A (Office)"` expectation accordingly (a modern-format fixture WITHOUT an audit is now `""`; legacy fixtures are `"N/A (legacy format)"`). For the numeric split: existing docx/xlsx cases asserting `""` from `formatAuditScoreNum`/`formatAuditGrade` now assert the score/grade when the fixture carries an audit, `""` when it doesn't. `test/report-xlsx.test.js`'s "leaves Score and Grade blank for Office files" test becomes "fills Score and Grade for scored Office files, blank for legacy" with a scored-docx fixture (score 79 → cell 79) and a legacy-xls fixture (blank). `test/report-csv.test.js`: same fixture-driven updates where it renders these columns.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/report-remediation-score.test.js test/report-csv.test.js test/report-xlsx.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement in `src/report/csv.js`**

Add import: `import { isScoreable, isUnscoreableDocument } from "../scanner/category.js";`. Delete the `OFFICE_CATEGORIES` set (lines 175–184). Replace the three formatters:

```js
// v1.54.0: format the Remediation Score cell from a full entry.
//   Scoreable (pdf/docx/xlsx/pptx), scored → "B/88"   (grade/score)
//   Scoreable, audit error               → "Not scored"  (e.g. 413, corrupt)
//   Legacy Office / ODF / RTF            → "N/A (legacy format)"  (convert to
//     .docx/.xlsx/.pptx to make it scoreable — the audit service refuses
//     pre-2007 binary formats because they can't carry the accessibility
//     structures it checks)
//   Scoreable pending/skipped, or not a document → ""  (no final state)
export function formatRemediationScore(entry) {
  if (!entry || typeof entry !== "object") return "";
  if (isUnscoreableDocument(entry)) return "N/A (legacy format)";
  if (!isScoreable(entry)) return "";
  const audit = entry.audit;
  if (!audit || typeof audit !== "object") return "";
  const hasGrade = typeof audit.grade === "string" && audit.grade.length > 0;
  const hasScore = typeof audit.score === "number";
  if (hasGrade && hasScore) return `${audit.grade}/${audit.score}`;
  if (audit.error) return "Not scored";
  return "";
}

// v1.43.0 — the sortable split of the cell above; v1.54.0 widened to every
// scoreable document. Any non-score state is a blank cell so Excel's sort
// never chokes on prose.
export function formatAuditScoreNum(entry) {
  if (!entry || typeof entry !== "object" || !isScoreable(entry)) return "";
  const score = entry.audit?.score;
  return typeof score === "number" ? score : "";
}

export function formatAuditGrade(entry) {
  if (!entry || typeof entry !== "object" || !isScoreable(entry)) return "";
  const grade = entry.audit?.grade;
  return typeof grade === "string" && grade.length > 0 ? grade : "";
}
```

Update the column comment blocks: line 33–49 "the per-PDF audit column… non-PDF entries → \"\"" becomes "the per-document audit column… unscoreable/non-document entries → \"\""; 66–75 "Empty for non-PDFs, skips, and errors" → "Empty for unscoreable formats, skips, pendings (errors say \"Not scored\")"; 76–85 "blank for non-PDFs" → "blank for unscoreable formats".

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/report-remediation-score.test.js test/report-csv.test.js test/report-xlsx.test.js test/report-html.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/report/csv.js test/report-remediation-score.test.js test/report-csv.test.js test/report-xlsx.test.js
git commit -m "feat: workbook score cells cover Office — N/A (legacy format) verdict, scored docx/xlsx/pptx fill Score/Grade"
```

---

### Task 7: Remaining user-facing copy

**Files:**
- Modify: `src/web/index-page.js` (lines 120–121 flagship section; 391 search blurb; 1060 nav title is OUT OF SCOPE per spec)
- Modify: `src/report/html.js` (comment lines 185–204 about non-PDF cells)
- Test: `test/index-page.test.js`

**Interfaces:** none new — copy only. The spec's copy inventory (§6) is the checklist; items already handled: donut caption/empty/card heads (Task 5), error blurbs (Task 4).

- [ ] **Step 1: Write the failing assertions**

In `test/index-page.test.js` add:

```js
  it("explains the widened scoring scope in the scores-by-site section", () => {
    const html = page(); // use the file's existing generate helper name
    expect(html).toContain("Scores cover every machine-scoreable document");
    expect(html).toContain("re-saved in a modern format");
    expect(html).not.toContain("Scores cover PDFs only");
  });
```

(Adapt `page()` to however this test file builds index HTML — it has an existing helper; reuse it.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/index-page.test.js`
Expected: the new test FAILS.

- [ ] **Step 3: Implement**

`src/web/index-page.js:120–121` — heading and paragraph become:

```js
    <h2>Scores by site — document accessibility coverage at a glance</h2>
    <p>A one-row-per-site summary workbook: how many remediable files each site has, how many documents were scored, the average score, and the A–F grade distribution, with a fleet TOTAL row. Use it to see which sites carry the most accessibility risk without opening the full file list. Scores cover every machine-scoreable document — PDFs plus modern Word, Excel, and PowerPoint files (.docx/.xlsx/.pptx). Legacy Office files (.doc/.xls/.ppt) can't be machine-scored until they're re-saved in a modern format, so they appear with "N/A (legacy format)" instead of a score.</p>
```

`:391` search blurb: "Have a PDF and want to know where it lives?" → "Have a file and want to know where it lives?" (rest unchanged — it already says "its accessibility score").

`src/report/html.js:185–204` comments: "only PDF audits get an 'Open report' link" → "every scored document gets an 'Open report' link (the page-report viewer stays scoped out)"; "Non-PDF entries, missing audits, and audited PDFs with no report URL render an empty cell" → "Unscored entries, missing audits, and audited documents with no report URL render an empty cell".

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/index-page.test.js test/report-html.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/index-page.js src/report/html.js test/index-page.test.js
git commit -m "feat: document-scoring copy — flagship scores-by-site section explains modern vs legacy Office"
```

---

### Task 8: Search-index Office coverage test (existing gap)

**Files:**
- Test: `test/search-index.test.js` only — the code path is already format-agnostic.

- [ ] **Step 1: Write the test (it should pass immediately — it pins, not drives)**

Mirror the file's existing fixture style (entries at lines 25/40/130) and add:

```js
  it("carries an Office file's score, grade, and report link into the row", () => {
    const rows = buildRowsHoweverThisFileDoesIt([
      {
        filename: "memo.docx",
        path: "files/memo.docx",
        category: "office-document",
        extension: "docx",
        sizeBytes: 25260,
        modified: "2023-12-08",
        publicUrl: "https://i2i.icjia-api.cloud/uploads/memo.docx",
        audit: { score: 79, grade: "C", reportUrl: "https://audit.icjia.app/report/abc123" },
      },
    ]);
    const row = rows[0];
    expect(row[6]).toBe(79);
    expect(row[7]).toBe("C");
    expect(row[9]).toBe("https://audit.icjia.app/report/abc123");
  });
```

IMPLEMENTER NOTE: `buildRowsHoweverThisFileDoesIt` is a stand-in name — open `test/search-index.test.js`, copy exactly how its existing tests invoke `buildSearchIndex` (including the `{allEntries, siteResults}` wrapper and how rows are extracted), and use that. The three positional assertions are the contract.

- [ ] **Step 2: Run — expect immediate PASS (this is a pin)**

Run: `npx vitest run test/search-index.test.js`
Expected: PASS. If it FAILS, the format-agnostic claim was wrong — STOP and investigate `src/web/search-index.js:65-82` before proceeding.

- [ ] **Step 3: Commit**

```bash
git add test/search-index.test.js
git commit -m "test: pin Office score/grade/report-link flow through the search index"
```

---

### Task 9: Release v1.54.0 — score run, reconcile, What's New, deploy

This task is operator-facing release procedure, not TDD. Prerequisites: Tasks 1–8 merged, full suite green.

- [ ] **Step 1: Full suite + grep sweep**

```bash
npx vitest run
grep -rn "N/A (Office)\|only PDFs are scored\|Scores cover PDFs only\|auditedPdfCount\|MIN_SCORED_PDFS" src/ bin/ | grep -v docs/
```
Expected: suite PASS; grep returns nothing.

- [ ] **Step 2: Score run (~674 fresh calls, needs the token)**

Confirm `FILECAP_AUDIT_TOKEN` is configured the way `run-full-audit.sh` supplies it (check `~/.filecap/config.json` / the script's env handling — the audit-api-rate-tiers note: without the token this crawls). Then loop every site the way `run-site-update.sh --scores-only` does (its exact command, line 326):

```bash
for site in $(ls ~/filecap-audits/ | grep -v "^_"); do
  d="$HOME/filecap-audits/$site/latest"
  inv="$d/inventory.cross-ref.ndjson"; [ -f "$inv" ] || inv="$d/inventory.ndjson"
  [ -f "$inv" ] || continue
  node bin/filecap.js audits "$inv" -o "$d/inventory.audited.ndjson" || echo "AUDITS FAILED: $site"
done
```

Expected: each site logs "N documents to audit"; PDFs come from cache; ~674 Office files fetch fresh. Expect exactly 2 × HTTP 413 (the >25MB xlsx + pptx) and possibly a few 422 corrupt files — these become "Too large" / "Not scored" verdicts, not failures.

- [ ] **Step 3: Rebuild locally WITHOUT deploying and reconcile**

Build only (no deploy): run `node bin/filecap.js web-rollup --help` first to confirm the build-only flag name (the deploy is config-driven via `autoDeploy`; use the flag that suppresses it — `--no-deploy` if offered; otherwise temporarily set `webRollup.autoDeploy=false` in `~/.filecap/config.json`, and restore it after Step 4). Then against the new bundle dir `~/filecap-audits/_web-rollup/<new-ts>/`:

```bash
python3 - <<'EOF'
import json, glob, collections
bundle = sorted(glob.glob("/Users/cschweda/filecap-audits/_web-rollup/*/search-index.json"))[-1]
data = json.load(open(bundle))
scored = collections.Counter(); ssum = collections.Counter()
for r in data["rows"]:
    ext = r[0].lower().rsplit(".",1)[-1]
    if isinstance(r[6], (int,float)):
        k = "pdf" if ext=="pdf" else "office"
        scored[k]+=1; ssum[k]+=r[6]
tot = scored["pdf"]+scored["office"]
print(bundle)
print("scored PDFs:", scored["pdf"], "avg", round(ssum["pdf"]/max(scored["pdf"],1)))
print("scored Office:", scored["office"], "avg", round(ssum["office"]/max(scored["office"],1)))
print("scored total:", tot, "blended avg", round((ssum["pdf"]+ssum["office"])/max(tot,1)))
EOF
```

Reconcile these against the built pages (serve the bundle dir locally): the index hero + each site card's "avg of N scored documents", the detail-page banners, scores-by-site.xlsx TOTAL row, the audit-errors page (should show the 2 too-large Office files with the Task 4 wording), and the /search page (a docx result now carries Score/Grade/View report). Every count that appears in two places must match — fix before proceeding.

- [ ] **Step 4: What's New + CHANGELOG + version, using the measured numbers**

Prepend to `WHATS_NEW` in `src/web/whats-new.js` (fill the UPPERCASE slots from Step 3's output — every number must match the deployed surfaces):

```js
  {
    id: "office-files-scored-2026-08-17",
    badge: "Scope change",
    text: "Word, Excel, and PowerPoint files are now scored. Until today, only PDFs received an accessibility score; the OFFICE_SCORED modern Office documents (.docx, .xlsx, .pptx) on the fleet now go through the same File Audit Tool check and carry the same 0–100 score, letter grade, and shareable audit report as PDFs — on the search page, the site pages, and in every spreadsheet download. Because the average now covers TOTAL_SCORED scored documents instead of PDF_SCORED PDFs, site and fleet numbers moved with it: the fleet-wide average went from OLD_AVG to NEW_AVG — the files didn't change overnight; the measurement now covers more of them. One honest exception: LEGACY_COUNT older Office files in legacy formats (.doc and .xls) can't be machine-scored — those formats can't carry the accessibility information the audit checks — so they're marked \"N/A (legacy format)\" until they're re-saved in a modern format.",
    linkText: "See scores on the search page",
    linkHref: "search.html",
    date: "August 17, 2026",
  },
```

Update `test/whats-new.test.js`'s "leads with" test: `expect(e.id).toContain("office-files-scored")`, keep `2026-08-17` + `linkHref` assertions, and demote the previous leader into a history pin (same pattern as the v1.52.0 release did). CHANGELOG entry `## [1.54.0]` summarizing Tasks 1–8 (Added: Office scoring + blend; Changed: labels/columns/copy; the legacy verdict). `package.json` → `1.54.0`. Run `npx vitest run` — PASS required.

- [ ] **Step 5: Commit, tag, push, deploy, verify live**

```bash
git add -A
git commit -m "feat: score Office documents (docx/xlsx/pptx) and blend them into fleet averages (v1.54.0)"   # body: summarize + measured movement
git tag v1.54.0 && git push origin main v1.54.0
node bin/filecap.js web-rollup    # with autoDeploy restored — this deploy publishes the reconciled numbers
```

Live verify at https://fleet.icjia.app in Chrome (rendered DOM, not HTML diffs): search a known docx (e.g. "cohort spotlight") → Score/Grade/View report present; a site card shows "avg of N scored documents"; What's New banner leads with the scope-change entry; audit-errors page shows the two oversized Office files with the new wording. Update the project memory (fleet numbers + v1.54.0) per the standing pattern.

---

## Self-review notes (run after drafting — resolved inline)

- Spec coverage: gate (T1), audits (T2), fetcher/taxonomy (T3/T4), blend + guard + workbook columns (T5), cells (T6), copy (T7), search-index pin (T8), release/reconcile/What's New (T9). Out-of-scope list honored (nav titles, page-estimate, historical entries untouched).
- Two deliberate implementer-adapts-the-harness notes (T3 fetcher invocation pattern, T8 builder helper) — the assertions are fixed; only the file-local plumbing is discovered on site. Everything else is verbatim.
- Type consistency: `auditedDocCount` / `unscoreableCount` / `docs` / `unscoreable` / `scoreable` names match across T5's module, consumers, and tests; `isScoreable`/`isUnscoreableDocument` signatures identical in T1/T2/T5/T6.
