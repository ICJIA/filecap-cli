# Web rollup: static-site bundle for fleet snapshot publishing

**Goal:** Add a `filecap web-rollup` subcommand that bundles the most recent scans of every saved site into a single self-contained static-site directory, ready for manual upload to Netlify or any static host. Includes per-site HTML reports, downloadable CSVs, an index page with fleet-wide and per-site totals, an optional client-side password gate, and a `robots.txt` blocking indexing.

**Visual design:** Modern, sleek, **dark mode by default** for both the index page and every per-site HTML report. Card-based layout on the index for at-a-glance scanning. Aim: hand a non-technical manager the URL and they immediately understand what they're looking at and how to drill in.

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

## Visual design — dark mode + sleek

### Design system

Adopted across BOTH the index page AND every per-site HTML report (the existing `src/report/html.js` template gets reskinned to match — single visual language everywhere).

**Color palette:**

```
Background base:        #0a0a0a    (near-black, easier on eyes than pure black)
Background elevated:    #161616    (cards, sticky headers)
Background sunken:      #050505    (table rows on hover, code blocks)
Border subtle:          #2a2a2a
Border strong:          #404040

Text primary:           #e5e5e5    (high-contrast, readable)
Text secondary:         #999999    (metadata, captions)
Text muted:             #666666    (timestamps, footer)

Accent:                 #60a5fa    (links, action buttons — sky blue, holds up well on dark)
Accent hover:           #93c5fd    (slightly lighter on hover)

Success:                #4ade80    (green for "all good" indicators)
Warning amber:          #fbbf24    (remediation-needed accents)
Reference gray:         #71717a    (non-remediable indicators)
Danger:                 #f87171    (rare; for actual errors)
```

**Typography:**
- Stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`
- Monospace (for IPs, paths, hashes): `"SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace`
- Body: 14-15 px, line-height 1.6
- Big stat numbers: 2.5–3.5 em, weight 700
- Headings: weight 600, tightened letter-spacing on H1

**Spacing & rhythm:**
- 8 px base grid (everything multiples of 8)
- Cards: 1.5 em internal padding, 1.5 em gap between cards
- Generous whitespace — managers scanning the page should feel calm, not cramped

**Microinteractions:**
- Hover transitions: 150 ms ease-out on buttons and links
- Subtle elevation on card hover (`box-shadow: 0 4px 16px rgba(0,0,0,0.4)`, slight `transform: translateY(-1px)`)
- Sortable column headers: subtle ▲/▼ indicator that pulses on click

**Print styles** (`@media print`):
- Force light mode: white background, black text
- Hide nav/buttons/search box
- Tables expand to full width
- Page breaks before each major section

### Index page layout

```
┌─────────────────────────────────────────────────────────┐
│  Header bar (sticky):                                   │
│    [filecap]                Generated 2026-05-10 13:42  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰  │
│  ▰  Fleet snapshot — 7 sites                        ▰  │
│  ▰                                                  ▰  │
│  ▰   1,247                  892                     ▰  │
│  ▰  total files          need work                  ▰  │
│  ▰                                                  ▰  │
│  ▰  Across 7 servers · 2.3 GB · last scan 2026-05-09▰  │
│  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰  │
│                                                         │
│  By type across the fleet                               │
│    PDFs           487    (39%)                          │
│    Word docs      201    (16%)                          │
│    Excel          45     (4%)                           │
│    Images         512    (41%)                          │
│    Other          2                                     │
│                                                         │
│  Sites                                                  │
│  ┌──────────────────────┐  ┌──────────────────────┐     │
│  │ DVFR                 │  │ i2i                  │     │
│  │ dvfr.icjia-api.cloud │  │ i2i.icjia-api.cloud  │     │
│  │ 203.0.113.10       │  │ 10.0.0.5             │     │
│  │                      │  │                      │     │
│  │     102              │  │      245             │     │
│  │  total files         │  │   total files        │     │
│  │                      │  │                      │     │
│  │ ▍ 69 need remediate  │  │ ▍ 178 need remediate │     │
│  │   63 PDFs · 6 Office │  │   142 PDFs · 11 Off. │     │
│  │   32 images          │  │   92 images          │     │
│  │                      │  │                      │     │
│  │ Scanned May 9, 16:05 │  │ Scanned May 9, 09:30 │     │
│  │                      │  │                      │     │
│  │ ┌─────────┐ ┌──────┐ │  │ ┌─────────┐ ┌──────┐ │     │
│  │ │View HTML│ │ CSV  │ │  │ │View HTML│ │ CSV  │ │     │
│  │ └─────────┘ └──────┘ │  │ └─────────┘ └──────┘ │     │
│  └──────────────────────┘  └──────────────────────┘     │
│  ┌──────────────────────┐  ...                          │
│  │ VPP                  │                               │
│  │ ...                  │                               │
│  └──────────────────────┘                               │
│                                                         │
│  Footer:                                                │
│    Generated by @icjia/filecap · GitHub link            │
│    Manager-facing data only · For internal use          │
└─────────────────────────────────────────────────────────┘
```

### Per-card structure

```html
<article class="site-card">
  <header>
    <h3>DVFR</h3>
    <p class="hostname">dvfr.icjia-api.cloud</p>
    <p class="ip">203.0.113.10</p>
  </header>
  <div class="big-stat">
    <span class="number">102</span>
    <span class="label">total files</span>
  </div>
  <ul class="breakdown">
    <li class="remediable">▍ 69 need remediation</li>
    <li class="detail">63 PDFs · 6 Office docs</li>
    <li class="detail">32 images</li>
  </ul>
  <p class="scan-meta">Scanned May 9, 16:05 UTC · 38.1 MB</p>
  <div class="actions">
    <a href="dvfr-20260509-160504Z.html" class="btn btn-primary">View HTML report →</a>
    <a href="dvfr-20260509-160504Z.csv" class="btn btn-secondary" download>Download CSV</a>
  </div>
</article>
```

CSS:
```css
.site-card {
  background: #161616;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  padding: 1.5em;
  display: flex;
  flex-direction: column;
  gap: 1em;
  transition: border-color 150ms ease-out, transform 150ms ease-out;
}
.site-card:hover {
  border-color: #404040;
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
.site-card .big-stat .number {
  font-size: 3em;
  font-weight: 700;
  color: #e5e5e5;
  display: block;
}
.site-card .breakdown li.remediable {
  color: #fbbf24;
  font-weight: 500;
}
.site-card .btn-primary {
  background: #60a5fa;
  color: #0a0a0a;
}
```

### Card grid

```css
.site-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 1.5em;
}
@media (max-width: 480px) {
  .site-grid { grid-template-columns: 1fr; }
}
```

### Fleet totals box

The hero block at the top of the index uses a slightly elevated background (`#161616`) with a subtle gradient or border-glow accent. Two prominent numbers (total files, files-needing-work) side by side, large display weight. Manager looks at the page → sees the two numbers in 2 seconds → has the gist.

### Typography hierarchy on the index

- **H1** (page title): "Fleet snapshot — 7 sites"
- **H2** (section): "Sites", "By type across the fleet"
- **H3** (per-card): the website nickname (DVFR, i2i, etc.)
- **.big-stat .number**: the giant numeric (3 em, weight 700)
- **.label, .scan-meta**: muted gray for context

### Per-site HTML reports — same visual language

The existing `src/report/html.js` template gets reskinned to match this dark palette. Same colors, same typography, same card-based summary box at the top. The interactive table (sort, filter chips, search box) keeps its current functionality but with dark-mode styling:

- Table header sticky and dark (`#161616`)
- Even-row stripe `#0a0a0a`, odd-row stripe `#0c0c0c`
- Hover `#1a1a1a`
- Cell text `#e5e5e5`
- Public URL / Audit link cells: accent blue, underline on hover
- Filter chips: dark backgrounds, accent-blue active state
- Sort indicators ▲/▼: subtle but visible

**This means the existing `audit-file-list.html` that auditors get directly from `filecap report --html` ALSO becomes dark-mode by default.** That's a deliberate choice — single visual language everywhere — but worth flagging because vendors who've been using the light-mode version will see a change.

### Print styles

Both the index and per-site reports include a `@media print` block that:
- Inverts everything to white background, black text
- Hides the search box, filter chips, sort indicators, action buttons
- Forces page breaks before each `.site-card`
- Removes the password-gate prompt JS effect

Managers can print the index page or any per-site report cleanly without manual style overrides.

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
- Render per-site cards using the design-system spec above
- Embed shared dark-mode CSS (inline; ~6 KB; no external dependencies)
- Inject password gate if requested
- Include `@media print` overrides for clean printing

### Task 2b: dark-mode reskin of `src/report/html.js`

Touch the existing per-site report template:
- Replace the current light-mode color palette with the dark-mode design-system colors above
- Keep all interactive behavior (sort, filter chips, search, sticky header) — only colors and spacing change
- Update existing tests in `test/report-html.test.js` to expect the new colors (or relax assertions if they only checked structure)
- This is a visual-only change. The CSV is unaffected.

This task is what propagates the dark mode across both the bundle's per-site files AND every direct `filecap report --html` invocation.

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
