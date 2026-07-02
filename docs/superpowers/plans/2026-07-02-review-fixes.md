# Review Fixes (v1.39.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for every JS behavior change. Each work package below is executed by ONE agent that owns its file set exclusively.

**Goal:** Fix all ~30 verified findings from the 2026-07-02 full-app review: two data-loss paths, three false-success paths, the false-orphan cluster in references, scoring correctness, and a set of report/bundle functionality gaps.

**Architecture:** Six work packages (A–F) with strictly disjoint file ownership so they can run in parallel. Cross-package contracts are pinned in the "Interface Contracts" section — both sides implement to the contract, neither side edits the other's files.

**Tech Stack:** Node ≥20 ESM, vitest, zod, bash/expect. No new dependencies (jszip, exceljs, p-limit already present).

## Global Constraints (every package)

- TDD for every JS change: write the failing test first, watch it fail (`npx vitest run test/<file>`), implement minimally, watch it pass.
- Finish by running the FULL suite: `npx vitest run` — must end with zero failures (baseline: 73 files / 1,041 tests pass).
- Do NOT touch: `package.json`, `package-lock.json`, `CHANGELOG.md`, `README.md`, `docs/`, or any file owned by another package.
- Do NOT run `git commit`, `git push`, `netlify`, or any networked command. Any `web-rollup` invocation must set `FILECAP_NO_DEPLOY=1`.
- Backward compatibility with on-disk data is mandatory: cached inventories, sidecars, `~/.filecap/*.json` caches, and existing `~/filecap-audits/<site>/runs|latest|mirror` layouts must keep working. When changing a path or shape, add a read fallback for the old location/shape.
- Match existing code style (ESM, semicolons, 2-space indent, small focused helpers, explanatory comments only for non-obvious constraints, versioned comments like `// v1.39.0:` where the file already uses that convention).
- Shell scripts: `bash -n <script>` must pass; keep lines short (user preference: no long lines, no trailing-backslash continuations).

## Interface Contracts (cross-package; both sides implement, neither crosses ownership)

1. **`legacy-office` category** — D makes `categorize()` emit `"legacy-office"` for `doc`, `xls`, `ppt` and adds it to the schema `categoryEnum` + `REMEDIABLE_CATEGORIES` in `src/scanner/category.js`. E adds `"legacy-office"` to `REMEDIABLE_CATS` in `computeSiteSummary` (`src/commands/web-rollup.js:853`) and makes `remediablePageCounts.legacyOfficeCount` count `category === "legacy-office"` (keeping the `office-legacy` synonym accepted wherever it already is). Cached inventories still carry old categories; all consumers must keep accepting both old and new categorization (old data: .doc as `office-document` etc. — that stays valid).
2. **`site-audit.json` location** — new canonical path is `<auditsBase>/<slug>/site-audit.json` (sibling of `latest`, purge-safe). C changes the writer (`src/commands/site-audit.js`) to write there and to read the PRIOR sidecar from the new path first, falling back to `<slug>/latest/site-audit.json`. E changes the reader (`loadSiteAudit` in web-rollup.js) to read new-path-first with the same fallback.
3. **`a11y-history.json` location** — new canonical path is `<auditsBase>/<slug>/a11y-history.json` (sibling of `latest`). E owns this move entirely (web-rollup.js), including one-time migration: merge points found at the old `latest/a11y-history.json` AND any `runs/*Z/a11y-history.json`, dedupe by `at`, sort ascending, write to the new path atomically (tmp + rename).
4. **`collectAuditErrors` items gain `pathPrefix`** — D makes `publicUrlFor` (`src/report/audit-errors.js`) consume optional `item.pathPrefix` (insert between base and path), prefer `publicUrlBase` over an https `absolutePath` (matching csv.js `buildPublicUrl` v1.7.40 precedence), and percent-encode path segments. E adds `pathPrefix: site.pathPrefix ?? sitesEntry?.pathPrefix` to the items it passes at the call site in web-rollup.js.
5. **`runReport` gains `publicUrlBaseOverride`** — D adds an optional `publicUrlBaseOverride` option to `runReport` (`src/commands/report.js`); when set, it is injected into the header metadata exactly like the existing `pathPrefix` injection at report.js:118, so `buildPublicUrl` in csv.js picks it up for the HTML/XLSX rows. E passes the sites.json-resolved base at its `runReport` call site and into the per-site sheet configs' `sourceHeader` metadata.
6. **`siteResults[].csvFile` may be null** — E sets `csvFile: null` when no per-site workbook was written and renders the download button/link only when non-null (index-page.js + html.js csvHref is D's file — D must tolerate `csvHref: null` by omitting the button).

---

## Package A — Shell orchestration

**Files (exclusive ownership):** `run-full-audit.sh`, `run-site-update.sh`, `run-site-scores.sh`, `examples/audit-fleet-auto.sh`, `examples/audit-fleet.sh`, `examples/audit-remote.sh`.
No vitest coverage exists for shell; verification = `bash -n` on every changed script, plus the targeted manual probes listed per task. Do not restructure the scripts; make minimal surgical changes.

### A1. Purge must never delete the `latest` target (run-full-audit.sh:152-161, run-site-update.sh:300-309)
Current: keeps lexically-newest `runs/*Z`; a leftover partial run dir (created by a failed/killed scan, since audit-remote.sh repoints `latest` only on success) becomes "newest" and the purge `rm -rf`s the good run `latest` points to.
Fix (same logic in both scripts): resolve `keep` as the physical target of `<site>/latest` when it exists and resolves inside `runs/` (`keep=$(cd "$runs_dir/.." && readlink latest)` → normalize to absolute); ALSO always keep the lexically newest dir (belt and suspenders — normally the same dir). Delete only dirs that are neither. If `latest` is dangling, print a WARN naming the site and delete nothing for that site.
Verify: create a sandbox tree (`site/runs/20260101-000000Z`, `site/runs/20260102-000000Z`, `latest -> runs/20260101-000000Z`), run the extracted purge loop (copy it into a scratch script with AUDITS_BASE pointed at the sandbox), confirm the OLDER dir latest points to survives, the newer orphan dir also survives (it is "newest"), and a third even-older dir is deleted. Then repeat with dangling latest → nothing deleted, WARN printed.

### A2. run-site-update.sh full mode: temp roster must end in `.json` (run-site-update.sh:191)
Current: `mktemp -t filecap-update.XXXXXX` on macOS yields `filecap-update.XXXXXX.<rand>` (verified), which fails audit-fleet.sh:398's `[[ "$INPUT_FILE" == *.json ]]` gate → CSV branch → guaranteed "scan failed". Fix: create the temp file then `mv "$tmp" "$tmp.json"` (and use/rm the `.json` name), or `tmp="$(mktemp -d)/sites.json"`. Keep it POSIX-mac-safe.
Verify: `t=$(<the new code>); [[ "$t" == *.json ]]` in a scratch run; confirm cleanup removes it.

### A3. expect blocks must fail on signal-killed children (run-site-update.sh:213-214, examples/audit-fleet-auto.sh — same `exit [lindex $result 3]` pattern)
Current: for a signal-killed spawn, `wait` returns `{pid spawnid 0 0 CHILDKILLED SIG...}` → element 3 is 0 → exit 0 → the run continues over stale data.
Fix in each expect block: after `catch wait result`, if `[llength $result] > 4 && [lindex $result 4] eq "CHILDKILLED"` exit 143; if `[lindex $result 2] == -1` (OS error) exit 1; else `exit [lindex $result 3]`.
Verify: scratch expect script spawning `bash -c 'kill -KILL $$'` exits nonzero; spawning `bash -c 'exit 7'` exits 7; spawning `true` exits 0.

### A4. Concurrency guard in run-site-update.sh (whole file)
Add the same pre-flight run-full-audit.sh:91-95 uses (`pgrep -fl 'audit-fleet|audit-remote'` → die with a clear message) before any stage runs, and additionally refuse when another `run-full-audit.sh` or `run-site-update.sh` process is running (`pgrep -fl 'run-full-audit|run-site-update'` excluding self via `$$`/name filtering — careful: pgrep -f matches own invocation; filter out own PID).
Verify: run `bash -c 'sleep 60' &` disguised? Simpler: temporarily run `sleep 300` renamed via `bash -c 'exec -a audit-fleet-probe sleep 5' &` is unreliable on macOS — instead verify by starting `./run-site-update.sh --dry-run <site>` while a `tail -f /dev/null` process named to match is running is overkill: just assert the guard code path with a unit-style scratch: source the guard function with a stubbed pgrep. Keep verification pragmatic; document what was checked.

### A5. `--scores-only` path can still trigger a scan without pre-flight (run-site-update.sh:93-96 vs 157-167)
Fix: perform the `command -v expect` / `[ -f "$AUDIT_FLEET_PATH" ]` checks at the moment FULL_TARGETS becomes non-empty (i.e., before calling `scan_targets`), regardless of mode — not only in the `SCORES_ONLY -eq 0` branch.

### A6. SITES_JSON must steer the whole pipeline (run-site-update.sh, run-site-scores.sh, run-full-audit.sh)
Current: `SITES_JSON` steers roster + resolve-site, but child `filecap` invocations read `FILECAP_SITES_FILE ?? ~/.filecap/sites.json`.
Fix: near the top of each script, after SITES_JSON is resolved: `export FILECAP_SITES_FILE="$SITES_JSON"`.
Verify: grep each script for the export; confirm `bin/filecap.js` reads `FILECAP_SITES_FILE` (it does — do not change bin/, it's Package F's file).

### A7. jq pre-flight in run-full-audit.sh (:85-87)
Add `command -v jq >/dev/null 2>&1 || die "jq is required (brew install jq)"` next to the existing expect/netlify checks.

### A8. audit-remote.sh: failed runs must not leave an armed partial run dir
Current: `THIS_RUN_DIR` is created at start (:1017); `latest` repoints only on success (:1317); `set -euo pipefail` with no trap → any failure leaves the partial dir (the A1 hazard's fuel).
Fix: add a cleanup trap after THIS_RUN_DIR is created: on EXIT with nonzero status (or on ERR), `rm -rf "$THIS_RUN_DIR"` and print one WARN line saying the partial run dir was removed. Make sure the success path disarms the trap (set a `RUN_OK=1` flag before the final exit; trap checks it). Do NOT remove anything else (mirror/ must be untouched — it is rsync's cache and lives outside runs/).
Verify: scratch run of a copy of the trap logic: simulate failure mid-script → dir removed; success path → dir kept.

**Package A report contract:** list every script changed, the exact verification commands run and their output, and any behavior notes for the operator (e.g., new WARN lines).

---

## Package B — References pipeline (false-orphan cluster)

**Files (exclusive ownership):** `src/references/*.js`, `src/commands/references.js`, `src/commands/cross-references.js`, `test/references-*.test.js`, `test/cross-references*.test.js` (create if missing). The costliest failure mode is a referenced file reported as an orphan; every fix biases toward "referenced".

### B1. Fail loudly instead of degrading to empty references
- `strapi-v3.js:39` and `strapi-v4.js:52` (and the analogous `__type` fetches at v3:92 / v4 equivalent): if the GraphQL response contains a non-empty `errors` array, or `data` is null/absent → THROW with the first error message (do not `?? []`).
- `src/commands/references.js`: after content-type discovery, `0 content types` for a strapi site → hard error (nonzero exit), message naming the site and suggesting token/introspection causes. After extraction, if EVERY content type's REST fetch failed (`failedTypes === attemptedTypes && attemptedTypes > 0`) → hard error. Partial failures stay WARN-and-continue but the summary line must state `N/M types failed`.
- Keep the existing "Skipping incomplete strapi entry" placeholder behavior for sites with no strapi config (community-engagement) — that is intentional and must not become an error.
Tests: GraphQL errors-array → adapter throws; discovery returning `[]` → runReferences exits nonzero; all-types-fail → nonzero; one-type-fails → zero exit + WARN summary.

### B2. `entryCanonicalUrl` must percent-encode the file path (`cross-resolver.js:98-100`)
Fix: split `entry.path` on `/`, `encodeURIComponent` each segment, rejoin, then `canonicalizeUrl(base + "/" + encodedPath)`. But do NOT double-encode already-encoded inventory paths — inventory `path` comes from the filesystem (raw bytes, never pre-encoded), so straight encodeURIComponent per segment is correct.
Tests (live-data shapes): `Sheet#Info1V1-2025.pdf` under base `https://ari.icjia-api.cloud/uploads` → key ends with `Sheet%23Info1V1-2025.pdf` (extension preserved); `report (Final).pdf` → `report%20(Final).pdf`-style key ( `(` `)` are safe in URL paths — assert whatever encodeURIComponent yields, key must round-trip via `new URL` unchanged); `a?b.pdf` → `%3F` in key, no query created.

### B3. Canonicalization: strip query strings + normalize percent-encoding case (`url-canonical.js`)
Fix `canonicalizeUrl`: set `parsed.search = ""` (uploads/files never vary by query; the reference side carries cache-busters like `?v=2`), and uppercase all `%xx` hex digits in the serialized path. Keep host lowercasing/hash-stripping as-is. Reference-side keys are recanonicalized at index-build time each run, so old sidecars converge automatically.
Tests: `…/report.pdf?v=2` → no query in key and equals the key for `…/report.pdf`; `…/a%2fb.pdf` → `…/a%2Fb.pdf`; existing tests still pass.

### B4. Content-type discovery: irregular plurals + v4 single types
- Add an irregular-pairs map (person/people, quiz/quizzes, analysis/analyses, criterion/criteria, index/indices, matrix/matrices, syllabus/syllabi, curriculum/curricula) AND general rules for `-is→-es` (analysis→analyses), `-z→-zzes` (quiz→quizzes), `-us→-i`.
- After pairing, WARN listing every unpaired singular/plural candidate so silent drops become visible: `[references] WARN: could not pair GraphQL types: quiz, analysis — their entries will not be fetched`.
- v4 single types: a queryType field with no plural partner whose name equals a known content-type pattern should be fetched as a single-entry REST call (`/api/<kebab(name)>?populate=…`, response `data` is an object not array — normalize to `[data]`). If distinguishing single types from junk fields is not reliably possible from introspection alone, at minimum they must appear in the WARN list above. Implement the fetch if the existing code structure makes it clean; otherwise the WARN is the floor and note it in the report.
Tests: pairing table cases above; WARN emitted for unpairable; (if implemented) single-type fetch normalizes object→array.

### B5. Field classifier: match `url`/`link` field names (`field-classifier.js:30`)
Fix: `const URL_SUFFIX_RE = /(?:url|link)$/i;` — matches `url`, `link`, `fileURL`, `pdfLink`, `permalink`. Guard against absurd false positives is unnecessary (values are still filtered by domain-filter + extension downstream after B7).
Tests: `url`, `link`, `URL`, `articleUrl`, `permalink` → url-string; `blank`, `unlinked` → NOT url-string (regex must not match mid-word without suffix — `unlinked` ends in `ed`, fine; add case `uplink`? it ends in `link` and WOULD match — acceptable; do not contort).

### B6. `extract-urls.js` regex gaps
Fix both patterns (absolute `FILE_URL_RE` and the relative/href one) to: (a) allow `(` `)` `[` `]` inside the URL path; (b) anchor the audited extension at a real boundary — extension must be followed by end, whitespace, quote, `<`, `>`, `#`, or `?`-query (so `report.pdfx` does not match and `report.doc.pdf` matches the FULL `.pdf` URL, not a truncated `.doc` one); (c) strip common trailing punctuation (`.,;:!` and unbalanced `)` when the URL contains no `(`) after matching — mirror how markdown autolinkers do it. Keep the extension whitelist as-is (pdf/docx?/xlsx?/pptx?/zip) — widening it is out of scope (image refs handled structurally elsewhere).
Tests: `report(1).pdf` in body text and in `href="…"` both extracted whole; `report (Final).pdf` in href extracted whole; `report.doc.pdf` → the `.pdf` URL; `my.docs/report.pdf` → full URL; `report.pdfx` → no match; `(see https://h.com/a.pdf)` → `https://h.com/a.pdf` without the trailing `)`; existing fixture tests still pass.

### B7. `url-string` values must pass the file-extension filter before entering `referencedFiles` (strapi-v3.js:151, strapi-v4.js:187)
Fix: run url-string candidates through the same audited-extension check FILE_URL_RE enforces (share a helper, e.g. export `isAuditedFileUrl(url)` from extract-urls.js). Page URLs (article links) are thereby excluded from referencedFiles.
Tests: url-string value `https://…/articles/some-page` → not added; `https://…/uploads/report.pdf` → added.

### B8. Unresolvable base → omit `references` (cross-resolver.js:103-107, commands/cross-references.js)
Fix: when `entryCanonicalUrl` returns null (no/empty publicUrlBase), return the entry WITHOUT a `references` field (absent = "not resolved", which orphans.js already treats as skip) instead of `references: []`.
Tests: entry with empty base → result has no `references` key; entry with base → `references: []` when no referrers (unchanged).

### B9. Pagination correctness (strapi-v3.js:117, strapi-v4.js:145)
- v4: use `meta.pagination` from the response when present (`page < pageCount` → continue); fall back to stop-on-EMPTY page (not short page) when meta is absent.
- v3 (`_start/_limit`): stop only on an EMPTY page.
Tests: simulated server with maxLimit 50 returning 250 records in 50-record pages (with and without v4 meta) → all 250 fetched; empty first page → no infinite loop; existing tests pass.

### B10. Introspection depth for LIST(NON_NULL(T)) (strapi-v3.js:30-31 + shared query in v4)
Fix: request one more `ofType` level in the `__type` query (`ofType { name kind ofType { name kind } }`) and unwrap NON_NULL inside LIST in the classifier's type-walk.
Tests: classifier given `LIST → NON_NULL → OBJECT(UploadFile)` → upload-file-list; `NON_NULL → LIST → NON_NULL → component` → component-list.

### B11. v4 nested component populate (component-walk.js / references.js populate builder)
Known limitation: `populate[dz][populate]=*` reaches one level. Deeper requires knowing sub-component field names, which introspection does not currently provide. DO NOT guess-deepen the params (risk of 400s). Add: (a) a precise comment at the populate builder documenting the depth limit; (b) a WARN at extraction time when component-walk encounters a component-typed value whose media envelope is present but unpopulated (`data === undefined` vs `data: null` distinction, if detectable) so operators can see potential misses. If not detectable, comment only, and say so in the report.

**Package B report contract:** per finding: test file/name added, before/after behavior, plus a one-paragraph note on any finding deliberately narrowed (B4 single types, B11) and why.

---

## Package C — Audits & scoring

**Files (exclusive ownership):** `src/audits/*.js`, `src/commands/audits.js`, `src/commands/site-audit.js`, `src/site-audit/*.js`, `src/report/a11y-history.js`, `test/audits-*.test.js`, `test/site-audit*.test.js`, `test/a11y-history*.test.js` (create if missing), `test/retrying-fetcher*.test.js`.

### C1. Retry network-level fetch errors (retrying-fetcher.js:61)
Fix: wrap `await fetchImpl(url, init)` in try/catch inside the loop. A thrown fetch error (TypeError "fetch failed", ECONNRESET, ETIMEDOUT, EAI_AGAIN — treat ANY rejection as transient) retries with the same backoff, up to maxRetries; after maxRetries rethrow the last error. Log line mirrors the HTTP one: `[audits] network error (…) from ${url}; backing off …`.
Tests: fetchImpl rejecting twice then resolving → success with 3 calls; rejecting maxRetries+1 times → throws, call count = maxRetries+1; existing 429/5xx tests unchanged.

### C2. A 200 response without a numeric score is an ERROR, not a cached success
- PDF path (`audits.js` ~:219): if `result.score` is not a finite number → set `entry.audit = { error: "no score in response" }`, count as failed, do NOT write to cache.
- Page path (`site-audit.js` ~:92-113 and the shared page cache in `audits.js` page pass): same rule — do not cache, increment `errored`.
- Cache hydration hardening (`audits.js:169-178`, `cache.js`): a cache entry lacking a finite `score` is treated as a miss (re-fetch), so previously-poisoned caches self-heal.
Tests: scorer returning `{score: null}` → error entry, cache file unchanged, errored count incremented; poisoned cache entry `{score: null, checkedAt: now}` → treated as miss.

### C3. Sidecar trend must not conflate coverage changes with remediation (sidecar.js:20, site-audit.js:117)
Fix: compute the trend diff ONLY over pages scored in BOTH runs. The sidecar's `pages[]` already records per-page results; store/derive `scoredUrls` per run; `commonPages = intersection(prior.pages, current.pages)` (by normalized URL); collect issue keys per side restricted to commonPages; diff those. Report `coverageChanged: {added: n, removed: m}` alongside, so the report can say "N pages entered/left the sample" instead of fake fixed/new counts.
Tests: page leaves the scored set between runs → its issues appear in NEITHER fixed nor new, `coverageChanged.removed === 1`; genuine fix on a common page → counted fixed.

### C4. Trend delta sample guard (a11y-history.js:39)
Fix: `a11yTrend` returns null (no chip) when the two compared points' `scored` counts differ by more than 20% of the larger (`Math.abs(cur.scored - prev.scored) > 0.2 * Math.max(cur.scored, prev.scored)`), with a code comment explaining sampling-shift suppression. Equal-or-close samples behave as today.
Tests: scored 40→12 with avg 62→65 → null; scored 40→41 avg 62→65 → `{delta: 3, dir: "up"}`; boundary exactly 20% → chip shown.

### C5. "from cache" log ternary (audits.js:355)
Fix the inverted ternary: when `pdfsToAudit.length === 0`, everything served from local cache → print the actual cache-served count (records with `audit.cached` or total scored), not "0".
Test: assert log line via injected log fn in the orchestrator test.

### C6. `site-audit.json` moves out of `runs/` (Interface Contract 2 — writer side)
Fix in `src/commands/site-audit.js`: write the sidecar to `<auditsBase>/<slug>/site-audit.json` (atomic tmp+rename — keep/reuse the existing atomic write if present); read the PRIOR sidecar from the new path, falling back to `<slug>/latest/site-audit.json` (one release of fallback). Do not delete the old file.
Tests: writer places file at new path; prior-read falls back to latest/ when new path absent.

**Package C report contract:** per finding: test names, and explicitly confirm the page-audit-cache and audit-cache on-disk formats remain readable (no shape change).

---

## Package D — Report layer + category/schema

**Files (exclusive ownership):** `src/report/*.js` EXCEPT `a11y-history.js`; `src/commands/report.js`; `src/commands/rollup.js`; `src/rollup/*.js`; `src/scanner/category.js`; `src/schema/inventory.js`; `test/report-*.test.js`, `test/rollup-merge.test.js`, `test/schema.test.js`, `test/scan.test.js` ONLY if category changes require expectation updates (coordinate: scan.test.js is shared with F — restrict edits to category-expectation lines; F has been told the same).

### D1. Client-side sort comparator (html.js:2439-2448)
Fix the embedded `sortBy`: numeric compare ONLY when BOTH values are fully numeric (`/^-?\d+(\.\d+)?$/.test(String(v))` or typeof number); ISO-date-looking strings (`/^\d{4}-\d{2}-\d{2}/`) and everything else use `String(av).localeCompare(String(bv))` (lexicographic order IS chronological for ISO timestamps).
Tests: extend the existing embedded-script tests (report-html.test.js drives the sort script — follow its existing pattern): dates `2025-01-02, 2025-11-30, 2025-06-15` sort correctly both directions; filenames `2023_Annual.pdf` vs `2023_Budget.pdf` sort lexicographically; numeric size column still sorts numerically.

### D2. `legacy-office` category produced (Interface Contract 1 — producer side)
- `src/scanner/category.js`: map `doc`, `xls`, `ppt` → `"legacy-office"`; add `"legacy-office"` to `REMEDIABLE_CATEGORIES`. `rtf`/`odt` stay `office-document`; `ods` stays `spreadsheet`; `odp` stays `presentation`.
- `src/schema/inventory.js`: add `"legacy-office"` to the category enum.
- Verify consumers in this package now light up: summary.js scope box, html.js hero tooltip legacy line, csv.js by-type row. Fix `summary.js:385`'s introspection-kind-based count and the category-based count to agree (they now both count the same files for NEW scans; for OLD cached inventories the category-based counts remain 0 — acceptable and must not crash).
Tests: `categorize("doc") === "legacy-office"`, `isRemediable("legacy-office") === true`; schema accepts an entry with the new category; summary scope box counts 2 for two .ppt entries.

### D3. Orphans confidence sort (orphans-html.js:164 vs 416)
Fix: emit `data-confidence` on the confidence `<td>` (keep the `<tr>` attribute for the filter logic if it uses it), so the sort script's existing `dataset.confidence` read works numerically.
Tests: extend orphans-html test to render rows at 100/85/20/0 and assert the sort script orders them 0,20,85,100 ascending (follow the existing embedded-script test pattern; if none exists for orphans, add one mirroring report-html.test.js's approach).

### D4. File-table search must cover path and server (html.js:2200 placeholder vs HTML_TABLE_COLUMNS projection)
Fix: include `path` (and `serverName` when the report is consolidated) in the SEARCHABLE data without adding visible columns — append them to the embedded per-row values array the search scans (rowData), or build the search haystack from projection + path + serverName. Placeholder text stays accurate.
Tests: search "uploads/2019" matches a row whose path contains it while its filename does not; search by serverName matches on consolidated report.

### D5. Download button honesty in standalone reports (html.js:2118, report.js:150)
Fix: label follows the href — when `csvHref` ends in `.xlsx` → "Download spreadsheet (XLSX)", when `.csv` → "Download CSV". Tolerate `csvHref: null` (omit the button) per Interface Contract 6.
Tests: writeHtml with csv href renders CSV label; with xlsx renders XLSX label; with null renders no download link.

### D6. Premature 100 (accessibility-band.js:69)
Fix in `summarizeFileA11y`: compute `avg = Math.round(sum/scored)` but clamp: if rounded === 100 and `sum < scored * 100` (not every PDF is 100) → 99. Band/gauge stay derived from the same clamped value (they already consume `avg`).
Tests: 19×100 + 1×95 → avg 99; 20×100 → 100; thresholds at 79.5 → 80 band unchanged.

### D7. merge.js `::` split (merge.js:173)
Fix: split on the FIRST `::` only: `const i = canonicalKey.indexOf("::"); const canonicalServerName = canonicalKey.slice(0, i); const canonicalPath = canonicalKey.slice(i + 2);`
Test: duplicate group with path `docs/a::b.pdf` → `duplicateOf.path === "docs/a::b.pdf"`.

### D8. Average pages per PDF divisor (summary.js:307-308)
Fix: divide by the count of PDFs WITH introspected pageCount and relabel the line "Average pages per PDF (measured)" — also print `(N of M PDFs measured)` when N < M.
Test: 10 PDFs, 5 introspected totalling 100 → "20.0" and "(5 of 10 PDFs measured)".

### D9. csvCell formula-injection guards (orphans-csv.js:24-31, audit-errors.js:115-118)
Fix: route both through the shared `format.js` csv cell helper (import it) instead of local re-implementations, gaining the `CSV_FORMULA_LEADING_CHARS` apostrophe guard and `\r` handling.
Tests: cell `=cmd|'/c calc'!A1` gets a leading apostrophe in both writers' output.

### D10. `publicUrlFor` precedence/encoding/pathPrefix (audit-errors.js:58-64) — Interface Contract 4 consumer side
Fix: precedence = `publicUrlBase` (+ optional `item.pathPrefix` inserted) + per-segment-encoded `entry.path`; only fall back to an https `absolutePath` (with `/tree/`→`/blob/`) when no base exists. Same segment-encoding fix in `orphans-csv.js:33-40`.
Tests: item with base + pathPrefix `/static` + path `docs/a b.pdf` → `<base>/static/docs/a%20b.pdf`; no base + https absolutePath → GitHub-rewritten URL.

### D11. Placeholder columns must not pretend to sort (html.js:390-394 + the header wiring)
Fix: mark the "Page References" and "Audit Report" columns non-sortable (no cursor/arrow/click handler) — their row values are `""` placeholders by design.
Tests: rendered table header for those two columns lacks the sortable affordance class/handler attribute; other headers keep it.

### D12. `runReport` gains `publicUrlBaseOverride` (Interface Contract 5 — consumer side)
Implement exactly as the contract states (inject into header metadata like pathPrefix at report.js:118). Tests: runReport with override → rendered public URLs use the override base.

**Package D report contract:** per finding: test names; note explicitly that D2 changes `categorize()` for doc/xls/ppt and which existing tests were updated to the new expectation (each such update must be listed).

---

## Package E — web-rollup + bundle renderers

**Files (exclusive ownership):** `src/commands/web-rollup.js`, `src/web/*.js`, `test/web-rollup*.test.js`, `test/index-page.test.js`, `test/sites-page*.test.js` (create if missing).

### E1. Deploy failures must fail the run (web-rollup.js:2150-2181 + exit path ~:2095-2104)
Fix: `runNetlifyDeploy` resolves `{ok: boolean, reason?: string}`. Non-zero exit / spawn error → `ok: false`. Missing CLI (ENOENT) → `ok: false, reason: "netlify-cli-missing"` (still print install hint). When a deploy was REQUESTED (autoDeploy && !FILECAP_NO_DEPLOY) and `ok === false`, `runWebRollup` returns exitCode 1 with a clear final stderr line `web-rollup: bundle written to <dir> but deploy FAILED — production not updated`. Bundle-writing success + deploy-skip stays exit 0.
Tests: stub spawn via injected runner if the code structure allows; otherwise unit-test the new decision function (extract `deployOutcomeToExit({requested, ok})`) — the extraction is acceptable minimalism.

### E2. a11y-history relocation + migration + atomic write (Interface Contract 3)
Fix in web-rollup.js (~:1073-1090): `histPath = <auditsBase>/<slug>/a11y-history.json`. Read: if new path missing, gather old `latest/a11y-history.json` + every `runs/*Z/a11y-history.json`, merge all points, dedupe by `at`, sort ascending — use that as the starting series and write it to the new path. Write: tmp file + rename (same dir). A corrupt existing file: do NOT silently reset — move it aside to `a11y-history.json.corrupt-<ts>` with a WARN and start from whatever old-location points can be recovered.
The consolidated bundle copy keyed by slug keeps its current shape.
Tests: migration merges+dedupes points from latest/ and runs/ dirs (temp fixture tree); corrupt file → sidelined not clobbered; trend (`a11yTrend`) sees the migrated series (delta computed across the old orphaned point — this is the fix that makes trends survive scans).

### E3. `loadSiteAudit` reads the new sidecar path (Interface Contract 2 — reader side)
New-path-first (`<slug>/site-audit.json`), fallback `<slug>/latest/site-audit.json`. Test with fixture tree.

### E4. Config `description` wins over scraped og:description (web-rollup.js:1450, 1475 and the content-site equivalent)
Fix `enrichOg`: add `configDescription` param mirroring `configImage`; final `description = configDescription || scrapedDescription || ""`. Apply to both tools and content sites. The gated fleet-audit tool card gets its curated description back.
Tests: config description set + scrape returns other → config wins; config empty + scrape 401 → ""; config empty + scrape ok → scraped.

### E5. Duplicates over ALL entries (web-rollup.js:1692-1693)
Fix: pass unfiltered `allEntries` to `findCrossServerDuplicates`. Confirm downstream rendering handles non-remediable groups (the index page already has the Remediable/Reference/All filter — it was built for this data). Watch memory: allEntries is the full fleet; findCrossServerDuplicates groups by hash/normalized name — it already iterates everything once; fine.
Tests: two identical .png entries on different servers → duplicate group present with `isReference`-style classification the renderer expects (inspect renderer's filter attribute logic in index-page.js to assert the right category flag lands in `duplicateGroups`).

### E6. publicUrlBase/pathPrefix pass-down (Interface Contracts 4+5 — producer side)
At the `runReport` call site pass `publicUrlBaseOverride` (sites.json-resolved base); build `perSiteSheetConfigs`' `sourceHeader` with metadata that includes the override base AND `pathPrefix` (reuse the existing `pagesHeader` pattern at :1247 for ALL per-site sheets); add `pathPrefix` to `collectAuditErrors` items.
Tests: per-site sheet rows and detail-page URLs use the sites.json base when it differs from the cached header's.

### E7. `legacy-office` in computeSiteSummary (Interface Contract 1 — consumer side)
Add `"legacy-office"` to REMEDIABLE_CATS (:853); count it into `remediablePageCounts.legacyOfficeCount` (:917 area) alongside the existing `office-legacy` synonym acceptance.
Tests: entry with `category: "legacy-office"` counts as remediable, legacyOfficeCount 1, page estimate uses ×5.

### E8. csvFile only when workbook written (web-rollup.js:1189, 1294-96, 1367) + conditional render (index-page.js:842)
Fix: `csvFile: null` when `perSiteSheetConfigs.length === 0`; index card renders the download link only when set. (html.js side is D's — contract 6 says it tolerates null.)
Tests: site with zero sheets → card has no download anchor; normal site unchanged.

### E9. Card tooltip pointer-events (index-css.js:744-751)
Add `.site-card .nums .lbl-sub` to the pointer-events re-enable list. Test: INDEX_CSS string contains the selector in the auto block (string-level assertion consistent with existing css tests).

### E10. Double-escaped alt (index-page.js:600-602 + callers :729/:819, renderToolCard :630/:636, sites-page.js:44/50)
Fix: `renderCardImage` escapes internally (keep), callers pass the RAW name (stop pre-escaping just for this arg — keep `fullName` escaped for its other uses; pass `sr.site?.siteFullName || …` raw into renderCardImage). Same for sites-page + tool cards.
Tests: name `Theft & Insurance <Council>` renders `alt="Theft &amp; Insurance &lt;Council&gt;"` exactly once-escaped.

### E11. Orphans blurb plurals + number formatting (index-page.js:148)
Fix: `toLocaleString()` + singular/plural ("1 file … looks like" / "2 files … look like"). Test: counts 1 and 2 render correct copy.

### E12. SSR sort order matches the pressed "Most recently added" button (index-page.js:1029-1036 vs :1287)
Fix: server-render `cardsHtml` in the same "added" order the client script produces on load (the client sorts by the card's added-index/data attribute — replicate that ordering server-side), so no-JS/HTML state agrees with `aria-pressed`. Keep the alphabetical comparator available for the client's A→Z button.
Tests: generated HTML card order equals the added-order for a 3-site fixture where alphabetical ≠ added order.

### E13. Uptime freshness label (uptime-client.js:57)
Fix: keep the server's `checkedAtMs` for the "checked …" label; store a separate `fetchedAtMs` for the 6h TTL gate. Cache shape change is client-local (localStorage) — tolerate old cached objects (missing fetchedAtMs → treat as stale).
Tests: client script string contains the split fields (match the existing uptime-client test style — string/regex assertions on the emitted JS).

**Package E report contract:** per finding: test names; explicitly confirm no page renders differently for sites with no new data (nulls tolerated everywhere).

---

## Package F — Core scan / CLI / introspection / MCP

**Files (exclusive ownership):** `src/commands/scan.js`, `bin/filecap.js`, `src/config/secrets.js`, `src/introspect/*.js`, `src/mcp/*.js`, `src/util/*.js`, `test/scan.test.js` (except category-expectation lines D may touch — restrict your edits to behavior you change), `test/introspect-*.test.js`, `test/mcp-*.test.js`, `test/secrets*.test.js` (create if missing), `test/quiet*.test.js` (create if needed).

### F1. Mid-scan file vanish must not abort/crash (scan.js:128-141, 158-169, 194)
Fix: (a) in the hash task, treat ENOENT like the stat path — skip the file silently (`return`), mirroring scan.js:118's documented intent; (b) make queued tasks never produce unhandled rejections: wrap the task body so unexpected errors are captured into a `firstTaskError` variable (first one wins) and the task resolves; after `await Promise.all(inFlight)`, if `firstTaskError` → throw it (clean exitCode-1 path, no truncated-footer crash). Also guard the `readHeader`/flag section the same way ENOENT-wise (readHeader already returns null on failure — verify).
Tests: hash-time ENOENT → file skipped, scan completes with footer, exit 0; hash-time EACCES → permissionDenials++ (existing behavior); injected unexpected error in one task → runScan returns `{exitCode: 1, error}` WITHOUT process-level unhandled rejection (assert via process.on capture in the test or by the promise resolving normally).

### F2. `--quiet` honored (bin/filecap.js:68, scan.js, util/progress.js)
Fix: plumb `quiet` into `runScan`; when set, the progress reporter emits nothing and INFO-level log lines are suppressed (errors/warnings still print). Separately, set pdfjs verbosity to errors-only unconditionally in `introspect/pdf.js` (`getDocument({ …, verbosity: 0 })` — pdfjs `VerbosityLevel.ERRORS = 0`) so warning chatter never pollutes NDJSON pipelines.
Tests: runScan with quiet + injected reporter/log → no tick/info output; without quiet → unchanged.

### F3. Secrets clobber guard (secrets.js:167-171)
Fix: `persistSiteToken` on an unparseable existing secrets.json must THROW (`Cannot parse ~/.filecap/secrets.json — fix or remove it before saving new tokens`) instead of silently starting fresh. (The comment already promises warning-not-clobbering; throwing is the safe interpretation since a warn-and-clobber still loses every other site's tokens.)
Tests: existing file with invalid JSON → persistSiteToken throws, file unchanged on disk; valid file → token merged (existing behavior).

### F4. `hasCharts` real detection (introspect/xlsx.js:64)
Fix: exceljs never surfaces charts. Detect via the raw zip: open the file with jszip (already a dependency) and set `hasCharts = zip entries match /^xl\/charts\/chart\d+\.xml$/` (also accept `xl/charts/chartEx*.xml`). Do this in the same read pass (the file is already read into a buffer for exceljs — reuse the buffer).
Tests: construct a minimal zip fixture in-test with a `xl/charts/chart1.xml` entry (jszip generate) + minimal workbook parts so the exceljs load still succeeds — if exceljs refuses the minimal fixture, split detection into a helper `zipHasCharts(buffer)` and unit-test THAT with a plain zip, keeping the introspector wiring test lighter.

### F5. PDF dates (introspect/pdf.js:148-154, 182-185)
Fix `parsePdfDate`: capture the `O±HH'mm'` timezone suffix; produce the true UTC instant (`Z` suffix only when the offset is known or explicitly `Z`; when NO offset is present, per PDF spec treat as local-unknown — emit the naive timestamp WITHOUT `Z` and document in a comment). Apply the SAME parser to `modificationDate` so both fields are consistent ISO (or null).
Tests: `D:20260101120000-06'00` → `2026-01-01T18:00:00.000Z`; `D:20260101120000Z` → `…T12:00:00.000Z`; `D:20260101120000` (no offset) → `2026-01-01T12:00:00` (no Z); modificationDate now ISO for the same inputs; schema still validates (check inventory.js expectations — those fields are plain strings, fine — do not edit schema, it is D's file; if the schema constrains the format, coordinate via report instead of editing).

### F6. MCP path gate + response fixes (mcp/tools.js)
Fix: (a) apply `checkAllowedPath` to EVERY path-typed argument across all tools (scan directory+output, rollup inputs[]+output, report input+outputDir, web_rollup output, query inventory path) when `FILECAP_MCP_ALLOWED_PATHS` is set; (b) trailing-slash root normalization (`root.replace(/\/+$/,"")` before compare so `/srv/www/` allows `/srv/www`); (c) `filecap_scan` result includes `outputPath` (absolute) alongside exitCode; (d) results whose payload carries `error` (scan exitCode 2, query missing-file) are returned with `isError: true`.
Tests: extend test/mcp-tools.test.js: allowed-paths blocks disallowed output; trailing-slash root allows root itself; scan result carries outputPath; error payloads set isError.

**Package F report contract:** per finding: test names; call out any observable output-format changes (scan NDJSON is unchanged EXCEPT pdf date fields — say so explicitly).

---

## Execution & verification (controller-owned, not for package agents)

1. Dispatch A–F in parallel (disjoint files). No commits by agents.
2. Controller integration pass: full vitest, `npx eslint src test bin`, `bash -n` all scripts, full `git diff` review, local `FILECAP_NO_DEPLOY=1 node bin/filecap.js web-rollup --output <scratch>` smoke build, `./run-site-update.sh --dry-run <site>`.
3. Red/blue verification audit (user-requested): blue team verifies each original finding is fixed (finding-by-finding, with the original evidence lines); red team adversarially reviews the full diff for regressions/new bugs. Fix + re-verify.
4. Finalize: version 1.39.0, CHANGELOG entry in the release commit, truthful /accessibility log entries (axe run on rebuilt pages), single commit on main, NO AI co-author trailer, no push unless asked, NO deploy (references fixes warrant a stage 2–3.5 re-run first).
