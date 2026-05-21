# /accessibility Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `/accessibility` page to the filecap web-rollup bundle — a current-status panel plus a chronological log of accessibility checks — linked from every page's footer.

**Architecture:** A committed data file (`accessibility-log.js`) holds the log entries and current status. A pure generator (`accessibility-page.js`) renders them into a self-contained dark-themed HTML page. `web-rollup` writes it as `accessibility.html` (Netlify serves it at `/accessibility`) and injects the password gate after generation, exactly as it does for the orphans report. Full design: `docs/superpowers/specs/2026-05-21-accessibility-page-design.md`.

**Tech Stack:** Node ESM, vitest, template-literal HTML generation (same pattern as `src/report/orphans-html.js`).

---

## File Structure

- `src/web/accessibility-log.js` (new) — data only: `currentStatus` object + `accessibilityLog` array.
- `src/web/accessibility-page.js` (new) — `generateAccessibilityPage({ currentStatus, log })` → HTML string. One responsibility: render.
- `src/commands/web-rollup.js` (modify) — render + write + gate `accessibility.html`.
- `src/web/index-page.js` (modify) — footer "Accessibility" link.
- `src/report/html.js` (modify) — footer "Accessibility" link.
- `src/report/orphans-html.js` (modify) — top-nav "Accessibility" link (this page has no footer).
- `test/accessibility-page.test.js` (new) — generator unit tests.
- `test/web-rollup.test.js` (modify) — assert `accessibility.html` is emitted.

---

### Task 1: Accessibility log data file

**Files:**
- Create: `src/web/accessibility-log.js`

Data file only — no logic, so no test (the generator tests exercise it). The three seed entries are this session's verified desktop history; the mobile entry is prepended in Task 7 after the mobile audits run.

- [ ] **Step 1: Create `src/web/accessibility-log.js`**

```js
// Accessibility audit log — data for the /accessibility page.
//
// A hand-maintained, chronological record of accessibility checks run against
// the deployed fleet-audit bundle. Appended to whenever accessibility work is
// done. The /accessibility page renders this; see src/web/accessibility-page.js.
//
// Two sources of checks:
//   "browser" — axe DevTools runs performed by hand in a browser
//   "backend" — axecap / Lighthouse / contrastcap runs from the tooling

/** Current verified accessibility standing — shown in the page's status panel. */
export const currentStatus = {
  asOf: "2026-05-20",
  lighthouse: 100,
  axeCore: "0 violations (WCAG A + AA)",
  axeDevTools: "0 serious — pending live re-verification",
  viewports: "desktop",
};

/**
 * Chronological log of accessibility checks, NEWEST FIRST. The page renders the
 * array in order and does not re-sort.
 *
 * Entry shape: { date, source, tool, scope, viewport, status, result, notes? }
 *   date     ISO date "YYYY-MM-DD"
 *   source   "browser" | "backend"
 *   tool     human-readable tool name
 *   scope    which page(s) were checked
 *   viewport "desktop" | "mobile" | "desktop + mobile"
 *   status   "pass" | "found" | "fixed"  — drives the result colour
 *   result   short result text
 *   notes    optional, e.g. the version it shipped in
 */
export const accessibilityLog = [
  {
    date: "2026-05-20",
    source: "backend",
    tool: "contrastcap + axe-core + Lighthouse",
    scope: "fleet index, per-site reports",
    viewport: "desktop",
    status: "pass",
    result: "Contrast failures cleared; 0 axe-core violations; Lighthouse 100.",
    notes: "v1.15.2",
  },
  {
    date: "2026-05-20",
    source: "browser",
    tool: "axe DevTools extension (advanced ruleset)",
    scope: "live fleet index + SPAC per-site report",
    viewport: "desktop",
    status: "fixed",
    result: "28 serious on the index + 1 on a per-site report (text-contrast, heading-markup). Fixed in v1.15.2.",
  },
  {
    date: "2026-05-20",
    source: "backend",
    tool: "axe-core + Lighthouse",
    scope: "fleet index, per-site reports, orphans report",
    viewport: "desktop",
    status: "fixed",
    result: "Lighthouse accessibility raised from an 88-93 baseline to 100; 0 axe-core violations.",
    notes: "v1.15.1",
  },
];
```

- [ ] **Step 2: Commit** — `git add src/web/accessibility-log.js && git commit -m "feat: accessibility log data for the /accessibility page"`

---

### Task 2: Page generator

**Files:**
- Create: `src/web/accessibility-page.js`
- Test: `test/accessibility-page.test.js`

`generateAccessibilityPage({ currentStatus, log })` returns a complete `<!doctype html>` string. Dark theme matching `index-page.js`: body background `#0d1117`, text `#c9d1d9`, muted text `#9aa5b1` (≥4.5:1 — never `#788391`), accent `#4dabf7`, links **underlined** (WCAG 1.4.1). Page structure inside one `<main>`:

1. `<p><a href="index.html">&larr; Back to fleet index</a></p>`
2. `<h1>Accessibility</h1>` + one intro `<p>`
3. Current-status panel — `<section class="ax-status">` rendering `currentStatus`
4. `<h2>Audit log</h2>` + `<table class="ax-log">` (columns: Date, Source, Tool, Scope, Result), one `<tr>` per `log` entry in array order
5. `<footer class="site-footer">` — links to filecap on GitHub, CHANGELOG, fleet index

Password gating is **not** done here — `web-rollup` injects the gate after generation (Task 5), like the orphans report.

- [ ] **Step 1: Write the failing test file** `test/accessibility-page.test.js`

```js
import { describe, it, expect } from "vitest";
import { generateAccessibilityPage } from "../src/web/accessibility-page.js";

const sampleStatus = {
  asOf: "2026-05-20",
  lighthouse: 100,
  axeCore: "0 violations (WCAG A + AA)",
  axeDevTools: "0 serious",
  viewports: "desktop + mobile",
};
const sampleLog = [
  { date: "2026-05-20", source: "backend", tool: "axe-core", scope: "fleet index", viewport: "desktop", status: "pass", result: "0 violations" },
  { date: "2026-05-19", source: "browser", tool: "axe DevTools", scope: "live index", viewport: "desktop", status: "found", result: "3 serious found" },
];

describe("generateAccessibilityPage", () => {
  it("returns a complete HTML document with one <main> and a favicon", () => {
    const html = generateAccessibilityPage({ currentStatus: sampleStatus, log: sampleLog });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toMatch(/<link[^>]*rel="icon"/);
    expect((html.match(/<main\b/g) || []).length).toBe(1);
    expect(html).toContain("</main>");
  });

  it("renders the current-status panel values", () => {
    const html = generateAccessibilityPage({ currentStatus: sampleStatus, log: sampleLog });
    expect(html).toContain("100");
    expect(html).toContain("0 violations (WCAG A + AA)");
    expect(html).toContain("desktop + mobile");
    expect(html).toContain("2026-05-20");
  });

  it("renders one log table row per entry, in array order", () => {
    const html = generateAccessibilityPage({ currentStatus: sampleStatus, log: sampleLog });
    const body = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
    expect(body).not.toBeNull();
    expect((body[1].match(/<tr>/g) || []).length).toBe(2);
    // newest entry (2026-05-20) appears before the older one
    expect(body[1].indexOf("2026-05-20")).toBeLessThan(body[1].indexOf("2026-05-19"));
  });

  it("tags each row with its source and status", () => {
    const html = generateAccessibilityPage({ currentStatus: sampleStatus, log: sampleLog });
    expect(html).toMatch(/ax-src-backend/);
    expect(html).toMatch(/ax-src-browser/);
    expect(html).toMatch(/ax-status-pass/);
    expect(html).toMatch(/ax-status-found/);
  });

  it("escapes HTML in entry text", () => {
    const html = generateAccessibilityPage({
      currentStatus: sampleStatus,
      log: [{ date: "2026-05-20", source: "backend", tool: "x <b>", scope: "y", viewport: "desktop", status: "pass", result: "z & w" }],
    });
    expect(html).toContain("x &lt;b&gt;");
    expect(html).toContain("z &amp; w");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/accessibility-page.test.js`
Expected: FAIL — `generateAccessibilityPage` is not defined / module not found.

- [ ] **Step 3: Implement `src/web/accessibility-page.js`**

Write the generator so all five tests pass. Required pieces:
- A local `htmlEscape(s)` helper (copy the one from `orphans-html.js` lines 8-16).
- The favicon `<link>` — the exact inline-SVG string used across the bundle (`orphans-html.js` line 462).
- A `<style>` block — dark theme per the palette above. Classes: `.ax-status` (the panel — bordered card, `#161b22` background), `.ax-status` value/label pairs, `table.ax-log`, `.ax-src` chip with `.ax-src-browser` / `.ax-src-backend` variants, `.ax-result` with `.ax-status-pass` (green `#3fb950`) / `.ax-status-found` (amber `#d29922`) / `.ax-status-fixed` (blue `#4dabf7`), `.site-footer`. All text ≥4.5:1; all links `text-decoration: underline`.
- A `statusPanel(currentStatus)` function → the `<section class="ax-status">` markup.
- A `logRow(entry)` function → one `<tr>`: `<td>${date}</td>`, `<td><span class="ax-src ax-src-${source}">${source === "browser" ? "browser" : "backend build"}</span></td>`, `<td>${tool}</td>`, `<td>${scope} <span class="ax-vp">${viewport}</span></td>`, `<td><span class="ax-result ax-status-${status}">${result}</span></td>`. Escape every interpolated value.
- `generateAccessibilityPage({ currentStatus, log })` assembles the document: doctype, head (charset, `<title>Accessibility — ICJIA Fleet Audit</title>`, favicon, style), `<body><main>` with the back link, `<h1>`, intro `<p>`, `statusPanel(...)`, `<h2>Audit log</h2>`, the `<table class="ax-log">` with a `<thead>` and `<tbody>` of `log.map(logRow).join("\n")`, `</main>`, `<footer class="site-footer">`, `</body></html>`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/accessibility-page.test.js`
Expected: PASS — 5/5.

- [ ] **Step 5: Run the full suite** — `npx vitest run` — expected: all green (721 + 5 new = 726).

- [ ] **Step 6: Commit** — `git add src/web/accessibility-page.js test/accessibility-page.test.js && git commit -m "feat: /accessibility page generator"`

---

### Task 3: web-rollup wiring

**Files:**
- Modify: `src/commands/web-rollup.js` (imports near line 16; new write step after the index write at line 1214)
- Test: `test/web-rollup.test.js`

- [ ] **Step 1: Write the failing test** — add to `test/web-rollup.test.js`, inside the existing describe that runs `runWebRollup` against a fixture. Assert the bundle now contains `accessibility.html`:

```js
it("emits an accessibility.html page into the bundle", async () => {
  // (use the same fixture setup as the neighbouring web-rollup tests)
  const res = await runWebRollup({ output: outDir, _auditsBase: auditsBase, noClientGate: true, sitesFile });
  expect(res.exitCode).toBe(0);
  const exists = await fs.stat(path.join(outDir, "accessibility.html")).then(() => true).catch(() => false);
  expect(exists).toBe(true);
});
```

Match the variable names (`outDir`, `auditsBase`, `sitesFile`) to whatever the existing web-rollup tests use — read the file first and copy the neighbouring test's setup exactly.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/web-rollup.test.js`
Expected: FAIL — `accessibility.html` does not exist.

- [ ] **Step 3: Implement the wiring**

In `src/commands/web-rollup.js`:
- Add to the import block (~line 16, beside `generateIndexHtml`):
  ```js
  import { generateAccessibilityPage } from "../web/accessibility-page.js";
  import { currentStatus, accessibilityLog } from "../web/accessibility-log.js";
  ```
- Immediately after `await fs.writeFile(path.join(output, "index.html"), indexHtml);` (line 1214), add:
  ```js
  // /accessibility page — current a11y standing + the chronological audit log.
  let accessibilityHtml = generateAccessibilityPage({ currentStatus, log: accessibilityLog });
  if (!noClientGate && password !== null) {
    accessibilityHtml = injectPasswordGate(accessibilityHtml, computeHash(password));
  }
  await fs.writeFile(path.join(output, "accessibility.html"), accessibilityHtml);
  ```
  (`injectPasswordGate` and `computeHash` are already imported.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/web-rollup.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/commands/web-rollup.js test/web-rollup.test.js && git commit -m "feat: web-rollup emits accessibility.html"`

---

### Task 4: Footer links on every page

**Files:**
- Modify: `src/web/index-page.js` (footer `site-footer-links` span, ~line 3184)
- Modify: `src/report/html.js` (`<footer>`, ~line 1959)
- Modify: `src/report/orphans-html.js` (top nav line, line 467)
- Test: `test/index-page.test.js`, `test/report-html.test.js`

The new link is always `<a href="accessibility.html">Accessibility</a>`. In each generator, read the surrounding markup first and match its existing link style (the index footer links and the report footer links keep their underline from the v1.15.1 a11y work).

- [ ] **Step 1: Write failing tests**

In `test/index-page.test.js`, in the `index page accessibility (v1.x)` describe:
```js
it("footer links to the /accessibility page", () => {
  const html = generateIndexHtml({ siteResults: [], password: null });
  expect(html).toMatch(/<a href="accessibility\.html"[^>]*>Accessibility<\/a>/);
});
```

In `test/report-html.test.js`, in the `accessibility structure (v1.x)` describe:
```js
it("the report footer links to the /accessibility page", async () => {
  const out = path.join(tmpDir, "axfooter.html");
  await writeHtml({ sourceHeader: sampleHeader, entries: sampleEntries, sources: [sampleHeader], outputPath: out });
  const html = await fs.readFile(out, "utf8");
  expect(html).toMatch(/<a href="accessibility\.html"[^>]*>Accessibility<\/a>/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/index-page.test.js test/report-html.test.js`
Expected: FAIL — both new tests (no `accessibility.html` link yet).

- [ ] **Step 3: Implement**

- `src/web/index-page.js` — in the `<span class="site-footer-links">` (~line 3184), add `<a href="accessibility.html">Accessibility</a>` alongside the existing GitHub / CHANGELOG links, matching their separator and markup.
- `src/report/html.js` — in the `<footer>` (~line 1959), add the same link, matching the footer's existing link markup.
- `src/report/orphans-html.js` — change the top nav line (line 467) from a lone back-link to also carry the accessibility link, e.g. `<p><a href="${htmlEscape(backHref)}">&larr; Back to fleet index</a> · <a href="accessibility.html">Accessibility</a></p>`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/index-page.test.js test/report-html.test.js`
Expected: PASS.

- [ ] **Step 5: Full suite** — `npx vitest run` — expected: all green (728).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: link the /accessibility page from every page footer"`

---

### Task 5: Mobile audits, finalize the data, version, deploy

**Files:**
- Modify: `src/web/accessibility-log.js` (prepend the mobile entry; update `currentStatus`)
- Modify: `package.json` (version → 1.16.0)
- Modify: `CHANGELOG.md` (new 1.16.0 entry)

- [ ] **Step 1: Build a no-deploy verification bundle**

Run: `FILECAP_NO_DEPLOY=1 node bin/filecap.js web-rollup --no-client-gate --output /tmp/filecap-v1160-audit`
Then serve it: `python3 -m http.server 8813 --directory /tmp/filecap-v1160-audit` (background).

- [ ] **Step 2: Audit `/accessibility` itself + run the mobile pass**

- contrastcap, axecap, lightcap (desktop) on `http://localhost:8813/accessibility.html` — the new page must itself be clean.
- axecap + lightcap with `viewport: mobile` on `http://localhost:8813/index.html` and a per-site report.

- [ ] **Step 3: Prepend the mobile entry + update `currentStatus`**

Prepend to `accessibilityLog` an entry dated today, `source: "backend"`, `tool: "axe-core + Lighthouse"`, `viewport: "mobile"`, with the real result from Step 2. Set `currentStatus.viewports = "desktop + mobile"` and `currentStatus.asOf` to today.

- [ ] **Step 4: Version + CHANGELOG**

`package.json` → `1.16.0`. Prepend a `## [1.16.0]` CHANGELOG entry under `### Added` describing the `/accessibility` page, the data file, the footer links; `### Tests` line with the new count.

- [ ] **Step 5: Full suite** — `npx vitest run` — expected: all green.

- [ ] **Step 6: Commit + push** — `git add -A && git commit -m "v1.16.0: /accessibility audit-log page" && git push`

- [ ] **Step 7: Deploy** — `node bin/filecap.js web-rollup --password 'Icjia60605!!'` (autoDeploy pushes to Netlify). Confirm "Deploy is live."

- [ ] **Step 8: Shut down the verification server** — `kill` the port-8813 process.

---

## Notes for the executor

- TDD is mandatory: every generator/wiring change gets its failing test first.
- The `accessibility-log.js` data file has no test of its own — it is data; the generator tests cover its consumption.
- Never weaken the v1.15.x a11y work: muted text stays `#9aa5b1` (not `#788391`), links stay underlined, one `<main>` per page, favicon present.
- After deploy, the standing practice applies: the next time accessibility work is done, append a log entry; and purge old `~/filecap-audits` runs.
