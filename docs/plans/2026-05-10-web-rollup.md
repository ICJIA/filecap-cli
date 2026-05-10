# Web rollup: static-site bundle for fleet snapshot publishing

**Goal:** Add a `filecap web-rollup` subcommand that bundles the most recent scans of every saved site into a single self-contained static-site directory, ready for manual upload to Netlify or any static host. Includes per-site HTML reports, downloadable CSVs, an index page with fleet-wide and per-site totals, an optional client-side password gate, and a `robots.txt` blocking indexing.

**Status:** PLANNED — not yet implemented. User-confirmed scope.

---

## Decisions (user-confirmed)

| Question | Decision |
|---|---|
| Missing-scan behavior | Skip with warning. Don't abort the rollup. |
| Password input | `--password <pw>` flag, with interactive prompt fallback when omitted |
| Per-site file naming | `<nickname>-<scan-timestamp>.html` and `.csv` (e.g., `dvfr-20260509-160504Z.html`) |

## Out of scope for V1

- Auto-running scans before the rollup (audit separately, then rollup)
- Auto-deploying to Netlify (document the manual flow)
- Snapshot-to-snapshot diffs
- Per-site authentication (single shared password only)
- Trend graphs / charts (text counts only on the index)

---

## File structure produced

```
~/filecap-audits/_web-rollup/2026-05-10T13-42-00Z/
├── index.html                              # landing page with fleet + per-site totals
├── robots.txt                              # User-agent: *  Disallow: /
├── assets/
│   └── style.css                           # shared styles (~4 KB)
├── dvfr-20260509-160504Z.html              # per-site report (existing audit-file-list.html, renamed)
├── dvfr-20260509-160504Z.csv               # per-site CSV (existing audit-file-list.csv, renamed)
├── i2i-20260510-093000Z.html
├── i2i-20260510-093000Z.csv
└── ...
```

Each site's HTML/CSV is the existing report output, just renamed and copied. The new generated artifact is `index.html` plus the optional password-gate JavaScript injected into every HTML file when `--password` is set.

---

## CLI surface

### New subcommand: `filecap web-rollup`

```
filecap web-rollup [options]

Options:
  --output, -o <dir>          Output directory
                              (default: ~/filecap-audits/_web-rollup/<UTC-timestamp>/)
  --password <pw>             Enable client-side password gate; embeds SHA-256 of pw
                              (omit for no password; or omit and answer interactive prompt)
  --title <title>             Title shown on the index page
                              (default: "filecap audit fleet snapshot")
  --include-site <name>...    Only bundle sites with these nicknames (repeatable)
  --exclude-site <name>...    Skip sites with these nicknames (repeatable)
  --sites-file <path>         Override saved-sites JSON path
                              (default: ~/.filecap/sites.json or $FILECAP_SITES_FILE)
```

Behavior:

1. Read `sites.json` (or `--sites-file`).
2. For each site, locate its most recent scan at `~/filecap-audits/<host>/latest/inventory.ndjson`.
3. If missing: print yellow warning, skip site, continue with others.
4. For each present site:
   a. Run `runReport` against the existing inventory to produce CSV + HTML in a temp dir.
   b. Read the scan timestamp from the inventory header's `metadata.scannedAt`.
   c. Format timestamp as `YYYYMMDD-HHMMSSZ` (matching the existing run-dir convention).
   d. Copy CSV and HTML into the output dir, renamed to `<nickname>-<timestamp>.{csv,html}`.
   e. Inject password-gate JS into the HTML if `--password` was set.
5. Generate `index.html` with the per-site cards and fleet totals.
6. Generate `robots.txt`.
7. Print final hint with the output dir path and Netlify deploy commands.

### Menu integration in audit-remote.sh

New menu option:
```
    w  →  build web rollup from latest scans
```

Selecting `w`:
1. Prompt: "Enable client-side password gate? (Enter to skip, or paste a password): " (input hidden)
2. If password provided: pass via `--password`
3. Run `filecap web-rollup`
4. After completion, offer to `xopen` the output dir's `index.html`

---

## Index page design

Pure HTML + inline CSS. No JavaScript framework. ~12 KB rendered.

### Layout

```
┌──────────────────────────────────────────────────────┐
│  filecap audit fleet snapshot                        │
│  Generated 2026-05-10T13:42Z from 7 sites            │
├──────────────────────────────────────────────────────┤
│                                                      │
│      Fleet total:  1,247 files                       │
│      Need remediation:  892 files (71%)              │
│      Reference files:  355 files                     │
│                                                      │
├──────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────┐    │
│  │ DVFR                                         │    │
│  │ 192.241.146.85                               │    │
│  │ Scanned 2026-05-09 16:05 UTC                 │    │
│  │                                              │    │
│  │ 102 files · 38.1 MB                          │    │
│  │ 69 need remediation                          │    │
│  │   • 63 PDFs · 6 Office docs                  │    │
│  │                                              │    │
│  │   [View HTML report]  [Download CSV]         │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │ i2i                                          │    │
│  │ ...                                          │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
├──────────────────────────────────────────────────────┤
│  Generated by @icjia/filecap                         │
│  https://github.com/ICJIA/filecap-cli                │
└──────────────────────────────────────────────────────┘
```

### Per-card data

For each site, the card shows:
- Website nickname (large)
- Server IP / hostname (smaller)
- Scan timestamp (human-readable; "Scanned 2026-05-09 16:05 UTC")
- File count + total bytes (humanized)
- Remediable count + percentage
- One-line type breakdown ("63 PDFs · 6 Office docs · 32 images")
- Two buttons:
  - "View HTML report" → opens `<nickname>-<timestamp>.html` in same tab
  - "Download CSV" → triggers download of `<nickname>-<timestamp>.csv`

### Fleet totals

Across all included sites: total files, total remediable, total bytes, by-category breakdown, count of duplicate files (using SHA-256), bytes saved if deduped.

### CSS notes

- System font stack: `-apple-system, system-ui, sans-serif`
- Cards: `display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 1em;`
- Manager-friendly colors: amber (`#fef3c7`) for remediation totals, gray (`#f3f4f6`) for reference, blue (`#2563eb`) for action buttons
- Print stylesheet: hides the gate prompt and download buttons; useful for circulating the index as a PDF

---

## Password gate

Pure client-side, hash-based. Not real security — just "ward off the curious," as user stated.

### Build-time

When `--password "icjia60605!!"` is passed:
1. Compute SHA-256 of the password as a hex string.
2. Inject this preamble into every HTML file in the bundle (index + per-site reports), wrapped in a `<script>` block at the top of `<body>`:

```js
(async function () {
  "use strict";
  const expected = "<embedded-sha256-hex>";
  const stored = sessionStorage.getItem("fc-pw");
  async function sha(s) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  if (stored === expected) return;
  while (true) {
    const pw = prompt("Password:");
    if (pw === null) {
      document.body.innerHTML = "<p style=\"font-family:sans-serif;padding:2em\">Authentication cancelled.</p>";
      return;
    }
    const h = await sha(pw);
    if (h === expected) {
      sessionStorage.setItem("fc-pw", h);
      return;
    }
    alert("Incorrect password.");
  }
})();
```

### Runtime

User visits any page, sees a `prompt()` for password. Correct entry → page renders. Stored in `sessionStorage` so navigation between pages doesn't re-prompt within the same session.

### Documented caveats

The plan doc (and the README) will explicitly state:
- Anyone with DevTools, view-source, or a `curl` can read the embedded hash and the rendered HTML
- The CSV files are not gated by the JS prompt (they're served at direct URLs by the static host)
- For real protection, use Netlify's paid Visitor Access feature OR an HTTP-basic-auth function

The user's stated bar is "ward off the curious" — this meets that.

---

## robots.txt

```
User-agent: *
Disallow: /
```

Plus add `<meta name="robots" content="noindex, nofollow">` to every HTML page's `<head>` for belt-plus-suspenders.

---

## Implementation tasks

### File structure

```
src/
├── commands/
│   └── web-rollup.js              ← new orchestrator
├── web/
│   ├── index-page.js              ← index.html generator (HTML + summary stats)
│   ├── password-gate.js           ← password-gate JS template + injector
│   └── styles.js                  ← assets/style.css generator
├── ...
```

### Task 1: orchestrator + tests

`src/commands/web-rollup.js` — `runWebRollup({ output, password, title, includeSite, excludeSite, sitesFile })`:

1. Load sites.json (use existing `loadSavedSites` helper if it exists; else inline)
2. Filter by include/exclude
3. For each site: locate `~/filecap-audits/<host>/latest/inventory.ndjson`; warn-skip if absent
4. For each present site: run `runReport`, copy outputs, optionally inject password gate
5. Generate index.html and robots.txt
6. Return `{ exitCode, summary: { sitesIncluded, sitesSkipped, outputDir } }`

Tests in `test/web-rollup.test.js`:
- Skip-on-missing-scan emits warning
- Output directory created with correct file names
- Index page contains expected per-site cards
- Password gate JS is injected when `--password` is set
- Password gate JS is absent when `--password` is omitted
- `robots.txt` contains `User-agent: *  Disallow: /`

### Task 2: index page generator

`src/web/index-page.js` — `generateIndexHtml({ sites, password, title })`:

- Compute fleet totals (files, bytes, remediable, by-category, duplicates)
- Render per-site cards
- Embed shared CSS
- Inject password gate if requested

### Task 3: CLI wiring

`bin/filecap.js` — register `web-rollup` subcommand with the options listed above. Pass through to `runWebRollup`.

### Task 4: MCP tool

`src/mcp/tools.js` — add `filecap_web_rollup` tool descriptor mirroring the CLI options. AI agents can build the static bundle programmatically.

### Task 5: audit-remote.sh menu integration

Add `w → build web rollup from latest scans` option to the saved-sites menu. Prompts for password (`read -s` for hidden input), calls `npx --yes @icjia/filecap@latest web-rollup`. Offers `xopen` of resulting `index.html`.

### Task 6: README update

Add a new section: **Publishing a fleet snapshot to Netlify**. Cover:
- The web-rollup workflow end-to-end
- The output directory structure
- Three deployment paths (Netlify CLI, Netlify drag-and-drop, Git-connected Netlify site)
- Password caveats
- robots.txt note

### Task 7: CHANGELOG entry

`## [1.2.0] — <date>` (this is a feature add, not a fix; minor bump).

---

## Estimated effort

About 1 working day for the agent: ~6 hours of focused implementation + tests, plus README updates. ~400 LOC net (orchestrator + index template + tests).

---

## Deployment guidance (for inclusion in the README)

### Option A — Netlify drag-and-drop (zero setup)

1. Visit https://app.netlify.com/drop
2. Drag the entire output directory (e.g., `~/filecap-audits/_web-rollup/2026-05-10T13-42-00Z/`) onto the drop zone
3. Netlify gives you a randomly-named URL within seconds
4. Optionally rename the site in Netlify settings

### Option B — Netlify CLI (scriptable)

```bash
cd ~/filecap-audits/_web-rollup/2026-05-10T13-42-00Z
netlify deploy --prod --dir .
```

### Option C — Git-connected Netlify site (auto-deploy on push)

1. Create a `~/icjia-filecap-snapshots/` Git repo (private if you want)
2. After each web-rollup, `cp -r` the output into the repo, commit, push
3. Netlify watches the repo and deploys on every push
4. URL stays stable; auditors bookmark it once

---

## Open questions to revisit at implementation time

These don't block planning but will need decisions during the build:

1. **Index page sort order** — alphabetical by site nickname? By scan date (newest first)? By file count?
2. **Snapshot naming for the OUTPUT directory** — is `2026-05-10T13-42-00Z` too verbose? Could be just `2026-05-10` if we're sure no one will run it twice in a day.
3. **CSV column gating in the bundle** — should the public CSV strip any columns the public shouldn't see (file paths reveal server structure)? User said "everything is public" — so probably no gating, but worth a moment of thought.
4. **Versioning** — bump to 1.2.0 (minor) since this is a new feature. Confirm at implementation time.
