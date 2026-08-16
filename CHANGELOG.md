# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note — internal tool, npm package deprecated.** As of v1.13.0 the npm
> package `@icjia/filecap` is **deprecated**. `filecap` is internal ICJIA
> tooling — run it from the GitHub repository, not from npm. Releases are still
> tagged in git and documented below; they are no longer published to npm.

## [1.46.0] — 2026-08-16

### Added — fleet-wide /search page

- **`search.html` + `search-index.json`**: search every inventoried file
  across the fleet by full or partial filename, client-side, from one page.
  The rollup emits a compact positional-array index (`src/web/search-index.js`
  documents the row shape) next to the page; the 12MB `audit-fleet.ndjson`
  is untouched.
- **Fragment-friendly tiered matcher** (`src/web/search-match.js`): every
  query term must land (AND), ranked filename-substring > site/path
  substring > separator-blind ("annualreport") > typo-tolerant (bounded
  Damerau-Levenshtein, so "anual"/"buget" still hit). Terms match the SITE
  name too, so "dvfr report" finds reports on DVFR even when "DVFR" isn't
  in the filename. Strapi upload hashes are folded out of the match key.
- **Results workbook download** (`src/web/search-xlsx.js`): a hand-rolled
  browser-side OOXML writer (STORE-only zip, shared strings, bold frozen
  header, autofilter, real hyperlink cells for File URL + Audit report)
  builds `search-results-<query>-<date>.xlsx` from the current matches.
  ExcelJS round-trip tests pin Excel validity; both client modules ship via
  the uptime-client `.toString()` pattern — the tested code IS the shipped
  code.
- **Category + site filter chips** with live counts; results table caps at
  400 rendered rows (the workbook always carries every match); summary line
  answers "which sites carry it" at a glance.
- **Nav + footer wiring**: a Search link on the home page, /sites,
  What's New, every per-site report (bundle context only), and the shared
  footer. New What's New entry announces the page.

## [1.45.1] — 2026-08-16

### Added — What's New entry for the archive's return

- New leading What's New entry (banner + archive page) announcing the
  document archive's return to the audit, with the post-archive numbers
  reconciled in place: 8,787 files across 12 audited sites; 4,628 on the
  remediation list = 3,180 scored PDFs + 22 unscoreable PDFs + 1,426
  Office files; fleet average 69 → 54 because the archive's 1,209 scored
  PDFs average 28 — a scope change, not an overnight regression.

## [1.45.0] — 2026-08-16

### Changed — document archive back in the audit, with full scoring

- **`archive-prod` re-added to the roster** (removed 2026-08-13 on the
  premise that archived files aren't remediated). Reversed: the archive
  still serves **live** files that may need remediation, so it is back in
  audit scope — scanned, inventoried, scored, and listed in the workbooks
  like every other site. Its `archive.icjia.cloud` /
  `archive.icjia-api.cloud` domains rejoin the fleet whitelist, so other
  sites' pages show links to archived documents as cross-site references
  again.
- **`A11Y_SCORE_EXCLUDE_SLUGS` no longer lists `archive-prod`** — its
  file-accessibility gauge shows on its card and its PDF scores count
  toward the fleet average (the v1.36.0 exemption assumed the archive's
  low scores were intentional ADA Title II exceptions; with live files in
  need of remediation, suppressing them would understate the fleet's real
  posture). The exclusion mechanism itself stays, list now empty.
- Operational note (no code): stale pre-2026-08-15 entries were pruned
  from the local score caches so the archive's files and pages fetch fresh
  new-rubric scores on the next run instead of reusing old-rubric cache
  hits.

## [1.44.1] — 2026-08-16

### Fixed — What's New banner reconciles 1,971 vs 3,199

- **The scoring-update banner said "1,971 files" directly above the hero's
  "3,199 files may need audit"** — the first question an astute reader asks
  is "which is it?". The entry now says **1,971 scoreable PDFs** and
  reconciles the two counts in place: the 3,199-document remediation list
  additionally counts 1,217 Word/Excel/PowerPoint files (the tool scores
  PDFs only; Office files are checked with the Office apps' built-in
  accessibility checkers) plus 11 PDFs that couldn't be scored ("Not
  scored" in the spreadsheets). 1,971 + 1,217 + 11 = 3,199.
- The entry id is bumped (`…-rev2`), so visitors who dismissed the original
  wording see the corrected banner once.

## [1.44.0] — 2026-08-16

### Added — What's New system (banner + archive page)

- **A What's New system for the deployed bundle**, mirroring the
  file-accessibility-audit repo's announcements pattern
  (`src/web/whats-new.js`): a `WHATS_NEW` config array (newest first —
  PREPEND an entry to publish an update), a dismissible home-page banner
  showing only the newest entry (dismissal is permanent per entry `id`,
  stored in `localStorage`; bump the id to re-show), and a
  **`whats-new.html` archive page** listing every entry newest-first so a
  dismissed or superseded update stays reachable.
- First entry: the **August 15 scoring-rubric update** — every PDF re-scored
  fresh under the File Audit Tool's refined rubric (fleet average 64 → 69),
  with the caveat that ▲/▼ trend chips around that date mostly reflect the
  rubric change, not remediation.
- **"What's New" links in the chrome**: a green internal-nav button in the
  header of the home page, /sites, and every per-site detail page (bundle
  pages only — standalone reports don't grow a link to a page that isn't
  next to them), plus a link in the shared footer status bar on every page.

### Changed — nav label

- **"ICJIA PDF Audit Tool" → "File Audit Tool"** in the top nav of every
  page (title text now reads "score any PDF for accessibility").

## [1.43.0] — 2026-08-15

### Added — sortable per-file Score and Grade columns in every workbook

- **Two new columns in the inventory-shaped workbooks** (each scanned site's
  `<slug>-<ts>.xlsx`, `audit.xlsx`, `audit-file-list-master.xlsx`), placed
  between "Remediation Score" and "Audit Report": **"Score (0-100)"** — the
  audit.icjia.app numeric score as a REAL numeric cell — and **"Grade"** —
  the bare letter (A–F). The combined "B/88" cell sorts as text (Excel puts
  "B/100" before "B/9"); the new columns sort properly, so *sort ascending
  by Score* surfaces a site's least accessible files first.
- Unscored rows (Office files, errored and pending audits) leave both cells
  truly blank — Excel pushes blanks to the bottom of either sort direction,
  so they never pollute the ranking. The "N/A (Office)" / "Not scored"
  prose markers stay in "Remediation Score".
- The CSV output gains the same two columns (before the Delete?/Notes
  action columns), reversing the 1.9.0 decision that folded the grade into
  a combined cell.

## [1.42.1] — 2026-08-15

### Fixed — Audit Report links are now clickable in every workbook

- **The "Audit Report" column in the inventory-shaped workbooks (per-site
  `<slug>-<ts>.xlsx`, `audit.xlsx`, `audit-file-list-master.xlsx`) now writes
  the audit.icjia.app report URL as a real hyperlink cell** — click it in
  Excel/Numbers/Sheets and the report opens. The cell used to hold a plain
  string on the assumption that "Excel + Sheets auto-hyperlink it", which is
  only true while typing, not for strings in an opened .xlsx
  (`src/report/xlsx.js`). Non-URL values ("Unavailable", blank) stay plain
  text. The rows-based workbooks (orphans, file errors, Pages tab, site
  rosters) already declared their URL columns `type: "url"` and were
  clickable.

## [1.42.0] — 2026-08-15

### Added — per-site file-audit downloads on the /sites directory

- **Every audited site's roster card on `/sites` now carries a download pill
  for its file-audit workbook** — the same per-site `<slug>-<scan-ts>.xlsx`
  the home-page card offers. The card click still opens the live site; the
  pill sits at the card bottom, lifted above the stretched-link overlay the
  same way the home page's action buttons are, so its click downloads instead
  of navigating (`src/web/sites-page.js`; `.roster-card-dl` in
  `src/web/index-css.js`).
- Sites without a workbook — registered-but-unscanned sites and tooling
  apps — render no pill. The workbook filename rides along on the roster
  entry from `web-rollup` (`csvFile`, null when no workbook was written).

## [1.41.0] — 2026-08-12

An incident-response release. The 2026-07-27 fleet run was killed mid-Stage 3.5
and left no error in its transcript: the scan had already repointed every
site's `latest/` at a fresh run dir, the PDF-grading stage never produced a
single `inventory.audited.ndjson`, and nothing downstream noticed. The deployed
report silently went six weeks stale while the on-disk state sat one
`web-rollup` away from publishing a fleet report with every Remediation Score
blank. This release makes that state impossible to ship by accident, and makes
the run less likely to die in the first place.

Also removes the document archive from the audit roster.

### Added — privileged-tier credential + throttle visibility

- **`AUDIT_ICJIA_TOKEN` / `secrets.json` resolves the audit.icjia.app service
  token** (`src/config/audit-token.js`). audit.icjia.app runs two tiers:
  anonymous is 500/hour + 100/min per IP; the token raises that 10× to
  5,000/hour + 1,000/min. A fleet-sized pass exhausts the anonymous budget in
  minutes and spends the rest of the run honoring `Retry-After` — which from
  the outside is indistinguishable from the server being down. The token buys
  rate limit and the non-ICJIA URL allowlist bypass only; it never bypasses the
  SSRF/private-IP block, the upload size caps, or the concurrency semaphores.
- **The tier is announced at run start** (`describeAuditTier`) so a run that
  silently fell back to anonymous is visible immediately, rather than inferred
  from throttling an hour later.
- **End-of-run throttle summary** (`formatThrottleSummary`) reports requests,
  429s, server-directed waits and total time parked. Counted at the shared
  fetcher — the single choke point both scorers pass through.

### Fixed — Retry-After was clamped, turning rate limits into permanent errors

- **`retrying-fetcher` now honors `Retry-After` in full.** The module's own
  docs claimed it "honor[s] it exactly"; the code did
  `Math.min(maxDelayMs, afterHeader)` — 60s. audit.icjia.app's real policy is
  `ratelimit-policy: 500;w=3600` (**500/hour**, not the 100/min this module was
  written against), so an exhausted budget answers `retry-after: 820`. We slept
  60s, retried into the same closed window, and after six retries threw —
  marking that PDF permanently errored. Six 60s retries can never outlast a
  window up to an hour. Observed live on 2026-08-12: the agency site (918 PDFs)
  logged 18 × 429 in 24 lines with both workers stuck at retry 4/6.
- **Server-directed waits get their own budget** (`maxRateLimitWaits`,
  default 12) instead of drawing on `maxRetries`. Complying with a limiter is
  not evidence of a stuck endpoint, and a cold fleet-sized batch *must* pace
  across several hourly windows — ~1,800 PDFs cannot be graded inside one.
- **`maxRetryAfterMs`** (default 15 min) bounds a malformed or hostile header
  so the run still can't be parked indefinitely.
- A 429 *without* a `Retry-After` header has no server guidance and keeps the
  old exponential-backoff behavior on the `maxRetries` budget.

### Added — pipeline resume point

- **`SKIP_SCAN=1`** in `audit-fleet-auto.sh` reuses the scans already in
  `<AUDITS_BASE>/<site>/latest/` instead of re-rsyncing the fleet. The audit
  stage is network-bound for hours against the limiter and is by far the
  likeliest to be interrupted; without a resume point, recovering from that
  meant re-scanning every host and repointing every `latest/` for no benefit.

### Added — unscored-inventory deploy guard

- **`web-rollup` now refuses to deploy a bundle whose sites have no PDF
  grades** (`src/web/unscored-guard.js`, exit code 3). The inventory chain
  (`audited → cross-ref → raw`) is a silent fallback by design; when the
  audits stage does not run, that fallback quietly yields a scoreless report.
  The guard flags any site with PDFs but *zero* graded PDFs — a partial score
  is the normal steady state (files land between runs) and is not flagged.
  - build-only run → loud warning naming each degraded site and its PDF
    count, exit 0 (this is the diagnostic path)
  - real deploy → refuses, netlify never spawned, bundle still written
  - `FILECAP_NO_DEPLOY=1` → warning only; a deploy that was never going to
    happen must not fail the build
  - `--allow-unscored` → operator override, still warns

### Changed — run-full-audit.sh survivability

- **The pipeline runs under `caffeinate -i -m -s`.** A fleet run is mostly
  spent waiting on the network (rsync, then the audit API), so an idle machine
  will suspend in the middle of it — the most likely cause of the 07-27 abort.
  Falls back to a no-op `env` prefix where `caffeinate` is unavailable (bash
  3.2 cannot expand an empty array under `set -u`).
- **SIGINT / SIGTERM / SIGHUP now leave an `[ABORTED]` breadcrumb** naming the
  partial-state risk and the recovery step. SIGKILL still cannot be trapped —
  that is what the deploy guard backstops.

### Removed — document archive out of audit scope

- **`archive-prod` removed from the roster.** Files that land in the archive
  are archived, not remediated, so the site is out of audit scope: no scan, no
  card, no detail page, and it no longer contributes to fleet counts
  (−2,405 files, ~940 PDFs of grading work per run). Its cached scan data is
  left on disk untouched.
  - Consequence: `archive.icjia.cloud` / `archive.icjia-api.cloud` leave the
    fleet domain whitelist, so other sites' pages no longer surface links to
    archived documents as cross-site references.
  - `A11Y_SCORE_EXCLUDE_SLUGS` keeps its `archive-prod` entry — inert today,
    retained as the mechanism (and because per-file Remediation Score cells
    band by score regardless of site) should the archive ever return.

### Fixed — false-perfect website score

- **`aggregateSite` no longer reports a perfect 100 for a site with known
  violations.** `summarizeFileA11y()` has clamped a rounded-up 100 to 99 since
  v1.39.0 ("showing 100 for a set that still contains a failing PDF is a false
  perfect"); the SITE score never got the same guard. The first fleet-wide
  site-audit run exposed it immediately: infonet averaged 99.6218 over 156
  pages with **19 outstanding violations** and rendered a flat "100 (A)" —
  directly above its own "19 outstanding issues" breakdown. Two independent
  signals now block a perfect score: any page below 100, or any outstanding
  violation at all (per-page rounding can hide one inside a 100). Affected
  agency (100→99, 5 outstanding), ilfvcc (100→99, 2) and infonet (100→99, 19);
  dvfr / i2i / r3 / sfs / vpp are genuinely 100 and unchanged — independently
  confirmed against a direct axe-core run.

### Tests

- +43 (1,328 → 1,371, 89 → 93 files): `unscored-guard`, `audit-token`,
  `throttle-summary`, and `skip-scan` (a shell probe of both branches, in the
  style of the existing purge probe). `web-rollup-fixes` gains end-to-end cover
  for refuse-on-deploy, `--allow-unscored`, build-only warn, and the
  `FILECAP_NO_DEPLOY=1` downgrade; `site-audit-aggregate` covers the
  false-perfect clamp; `audits-retrying-fetcher` covers full-window
  `Retry-After` honoring and the split budgets. The v1.39.0 deploy-outcome
  fixture now carries a scored PDF so it exercises a healthy bundle.

### Operational note — 2026-08-12/13 fleet run

First complete fleet audit since 2026-07-02. Graded **1,966 of 1,981 PDFs
(99.2%)**, fleet average 64; the 15 failures are content errors (6 × HTTP 413
on PDFs ≥17.3 MB — the server's body cap sits between 14.3 and 17.3 MB;
8 × HTTP 422 on ~0.2 MB agency NOFO/Q&A documents; 1 server-unavailable), not
rate-limit casualties. Produced the first 11 `site-audit.json` sidecars this
fleet has ever had. Run took 8h07m on the anonymous tier — the motivation for
the token support above.

## [1.40.0] — 2026-07-27

A review-fix release: a full-app review (deployed bundle + source + repo
hygiene, run with Lighthouse/axe-core/contrastcap against a byte-identical
local copy of the production bundle) produced ~20 findings; all were fixed
test-first. Suite grew from 83 files / 1,259 tests to 89 files / 1,328.
Verified on the rebuilt bundle: Lighthouse accessibility 100 / performance
100, axe-core (WCAG A + AA) 0 violations on the fleet index, /sites,
/accessibility, a per-site detail page, and audit-pdfs; SEO 66 (up from 58,
noindex is intentional); mobile 390px layout-viewport overflow 0px (was 87px).

### Fixed — mobile layout

- **The phone layout no longer clips text.** At 390px the layout viewport
  expanded to 477px and every text block (including the hero H1 — "Fleet"
  rendered as "Fle") was cut at the screen edge. Three grid track specs
  carried min-content floors wider than a phone (`minmax(360px, 1fr)` on the
  explainer/by-type grids, bare `1fr` on the card stat tiles and site grid),
  and `<main>` — a column-flexbox item via the shared footer CSS — grew to
  match. Tracks now use `minmax(0/min(360px,100%), 1fr)` and `body > main`
  is pinned with `min-width: 0; width: 100%` (regression-tested in
  `test/index-css.test.js` + `test/site-footer.test.js`).
- **The sticky footer returns to normal flow on phones** (≤700px). It cost
  ~9% of a phone viewport and overlapped the hero on load; desktop keeps the
  documented sticky rationale.

### Fixed — accessibility (WCAG)

- **Skip-to-content link on every page** (2.4.1): first focusable element,
  targeting `<main id="main">`; visually hidden until keyboard focus.
- **Keyboard-sortable table headers** (2.1.1): sortable `<th>`s now wrap
  their label in a real `<button>` (Enter/Space work natively) and carry
  `aria-sort` state; non-sortable placeholders get `scope="col"` only.
- **Filter/pagination changes are announced** (4.1.3): both paginator
  status lines ("Showing 1–25 of N files") are `role="status"
  aria-live="polite"` regions.
- **Active sort-button contrast** (1.4.3): hover state darkened to #2563eb
  (5.17:1 with white; was 3.83:1) and the active glyph pill now darkens
  instead of lightening (was blending to 3.45:1).

### Fixed — product

- **The "Website accessibility" section now actually renders.** The
  SiteImprove-depth per-site section (page score + grade, severity and
  WCAG-level breakdowns, per-page table) was fully built and tested in
  v1.35.0-era work but never imported by the detail-page generator — the
  whole `site-audit` pipeline stage was invisible in the product. Wired
  end-to-end (web-rollup already passed the data; `writeHtml` now accepts
  and renders it) and restyled to the detail page's dark idiom. Note: it
  renders only for sites with a `site-audit.json` sidecar — none exist in
  the current cache, so run `filecap site-audit` (or the fleet script's
  score stage) to light it up.
- **Uptime chips no longer call an erroring origin "Site live"**: a 5xx
  response now counts as down (network error/timeout unchanged; 2xx/3xx/4xx
  still live — a gated 401 is an answering site).
- **Thin-data caption explains itself**: "Not enough scored PDFs yet (1 / 1)"
  read like a bug; it now says "Only 1 PDF on this site — too few for a
  reliable score (needs 5)." (shared `fileA11yThinDataText()` in the band
  module).
- **/sites no longer over-claims the audit's reach**: the content-sites lede
  distinguishes the directory size from the audited subset ("The 13 ICJIA
  content sites — 12 of them under file accessibility audit"), fed by the
  actual bundled-site count.
- **The footer's "contact the audit administrator" is now a mailto link**;
  every page gained a `<meta name="description">` (fleet SEO 58 → 66).

### Changed — page weight

- **The embedded row-values blob is gone** (May review P1, first half).
  Detail and by-type pages shipped every row's data twice: rendered `<tr>`s
  plus a JSON array for sort/search. The client now projects sort/search
  values from the rendered cells (`data-num` for numerics) plus a hidden
  per-row `data-search` attribute carrying path/serverName. audit-pdfs.html
  5,052→4,720 KB; the ICJIA detail page 4,116→3,832 KB; audit-images
  2,432→2,104 KB. (Second half — client-rendering rows from compact data,
  worth another ~60% on big pages — needs the Page-References cell builder
  ported to client JS plus a DOM test harness; deliberately deferred.)

### Security / repo hygiene

- **Origin IPs, SSH usernames, and real server paths scrubbed** from
  README, examples, docs, and test fixtures (TEST-NET placeholders;
  `docs/security/audit-2026-06-06.md` self-redacted with a note). The
  repo's own security doc said these must stay hidden behind Netlify —
  now the repo complies with it. Real values live only in
  `~/.filecap/sites.json`.
- **`filecap mcp` warns on startup when `FILECAP_MCP_ALLOWED_PATHS` is
  unset** — the default is unrestricted filesystem access and should never
  be silent.
- **New tests for the security surfaces that had none**: netlify-config
  (every header + CSP pinned, `_headers`/`netlify.toml` parity), the
  password gate (plaintext never embedded), the shared footer, INDEX_CSS
  regression guards.

### Internal

- **One HTML-safety module** (`src/util/html.js`): the identical escape
  function existed under five names in five files; `safeUrl` existed twice
  with different normalization. All generators now import the shared
  `escapeHtml`/`safeUrl`/`safeUrlNormalized`/`copyableValue`/`COPY_ICON_SVG`;
  `accessibility-band.js` now escapes its own interpolations (hostile-input
  tested) instead of trusting callers.
- **`REMEDIABLE_CATEGORIES` single-sourced** from `scanner/category.js` —
  the five copies had drifted (one still carried the phantom
  `office-legacy` synonym removed in v1.39.0); the detail page's client
  script array is now generated from the canonical set.
- Byte formatting unified on `humanizeBytes`; repo renamed
  `ICJIA/filecap-cli` → `ICJIA/icjia-fleet-audit` everywhere (package.json,
  emitted footers, README, docs); stray local scan NDJSON + stale 1.5.7
  tarball deleted from the working tree.

## [1.39.0] — 2026-07-02

A fix-all release: a full-application review (seven parallel domain reviewers)
found ~30 verified defects across every pipeline stage; all were fixed, then
verified by a ten-agent red/blue audit (six blue verifiers re-proving each fix
against pre-fix code, four red attackers hunting the diff for regressions,
contract breaks, old-data breakage, and weak tests). The audit's own findings
were fixed in a second round. Suite grew from 73 files / 1,041 tests to
83 files / 1,260. No deploy with this release — the reference-extraction fixes
change sidecar contents, so the bundle ships after the next full
references → cross-references → audits → web-rollup run.

### Fixed — data loss and false success

- **Purge could delete the newest audit.** Both purge loops (`run-full-audit.sh`,
  `run-site-update.sh`) picked "newest" by directory-name sort and ignored what
  `latest` actually pointed at; they now keep the `latest` target AND the newest
  run, and a dangling `latest` logs a WARN and skips purging instead of deleting
  blind. `audit-remote.sh`'s failure-cleanup trap could `rm -rf` a **completed**
  run when the end-of-run `latest` repoint failed — the trap now disarms the
  moment run content is complete, and a non-symlink `latest` is refused up front
  (never deleted). A committed fixture probe (`test/shell/purge-fixture-probe.sh`
  + vitest wrapper) turns the suite red if the purge logic regresses.
- **Deploy failures no longer look like success.** `web-rollup` used to resolve
  every Netlify outcome as success; a requested deploy that fails now exits 1
  with "bundle written … but deploy FAILED — production not updated"
  (`FILECAP_NO_DEPLOY=1` skip remains exit 0, missing CLI keeps the install hint).
- **Expired Strapi tokens no longer silently orphan a whole fleet.** GraphQL
  `errors`/null-`data` responses now throw instead of degrading to "no
  references"; `filecap references` exits 1 on zero discovered types or
  all-types-failed (partial failures WARN with a `(N/M types failed)` summary).
  The fleet script continues past a failing site but now falls back to the
  previous run's sidecar with a loud WARN — stale references beat false orphans.
  Hard-error paths are pinned to never write a sidecar.
- **Null/invalid audit scores are no longer cached as successes.** A score-less
  200 becomes an error entry and is retried next run; previously poisoned cache
  entries self-heal (verified against the real 6,942-entry cache: zero valid
  entries invalidated).
- **The file-accessibility history finally survives.** The per-site series was
  written through the `latest` symlink into the run dir, so every scan orphaned
  it and purge deleted it — that was why cards said "baseline recorded" but
  never showed a trend. The series now lives at the purge-safe
  `<site>/a11y-history.json`, a one-time migration rescues points stranded in
  old run dirs (verified against real data: all 11 sites' stranded June
  baselines recovered, trend chips render), writes are atomic, and a corrupt
  file is set aside as `.corrupt-<ts>` — never silently reset. The
  `site-audit.json` sidecar moved out of the purge blast radius the same way
  (`<site>/site-audit.json`, with fallback reads of the old locations and a
  `runs/*Z` rescue so score history carries forward).

### Fixed — references and cross-references

- URL extraction rewritten span-then-verify: parentheses/brackets in paths
  survive, extensions must sit at a real boundary (`report.pdfx` rejected,
  `report.doc.pdf` whole), quoted `href`/`src` values are extracted verbatim so
  spaced filenames survive, HTML entities in hrefs are decoded, and
  comma/semicolon-joined URL lists yield every URL instead of one glued
  unmatchable string.
- Canonical URL matching: file paths are percent-encoded per segment (`#`, `?`,
  spaces no longer truncate or miss), query strings are stripped, and `%xx` hex
  case is normalized — each previously produced false orphans for real fleet
  filenames.
- Strapi pagination is complete: v3 stops only on an empty page and advances by
  records received (server `maxLimit` caps no longer silently drop the tail);
  v4 trusts `meta.pagination` with an empty-page fallback.
- Strapi v4 collection names that don't pluralize cleanly (e.g. `analysis`) are
  now paired via a proper pluralizer, and unpaired non-system types are fetched
  as single types (`/api/<name>`, kebab-case retry) instead of skipped; v3 WARNs
  every unpairable name. Reference-bearing fields are matched by `/(?:url|link)$/i`
  instead of exact names, gated by an audited-file check so page URLs stay out.
- Unresolvable public-URL bases leave entries **without** a `references` key
  (unknown) instead of `[]` (orphan); the introspection query nests three
  `ofType` levels so wrapped media relations classify correctly.

### Fixed — reports and bundle

- Embedded table sorting: numeric compare only when both values are fully
  numeric — dates like "Jun 28, 2026" sort chronologically instead of as text;
  the orphans confidence column sorts 0→100 numerically and carries per-cell
  `data-confidence`; embedded search also matches path and server name; the two
  placeholder headers are marked `data-nosort` (no cursor inviting a dead click).
- Public URLs in audit-errors and orphans outputs (HTML **and** XLSX — the
  original fix had landed in a writer nothing calls) are built from the
  site's live base with per-segment encoding; `Sheet#Info…pdf`-style names now
  resolve. Per-site sheets and detail pages use the sites.json base instead of
  the possibly-stale base cached in old inventory headers.
- A rounded average of 100 displays as 99 unless every score is truly 100;
  "Average pages per PDF" divides by *measured* PDFs with an "(N of M measured)"
  note; duplicate keys containing `::` in paths round-trip; CSV cells share one
  formula-injection guard; sites without a workbook omit the download button
  end-to-end instead of linking a nonexistent file.
- Bundle renderers: curated og descriptions survive scrape failures; card
  alt/aria-label text is escaped exactly once; the orphans blurb pluralizes and
  formats counts; SSR card order matches the pressed "Most recently added"
  toggle; tile sub-label tooltips are hoverable again; uptime freshness is
  gated by a client-local timestamp (a stale server `checkedAtMs` no longer
  pins "checked …" forever); cross-server duplicate detection covers all
  entries, and reference-side groups are marked and counted.
- `legacy-office` category for binary `.doc`/`.xls`/`.ppt` end-to-end (scanner,
  schema, remediable sets, summary scope box, chips, fleet-context markdown
  table and documented enum) — these need conversion before remediation and now
  price separately. Old cached inventories keep their old categories and remain
  valid and remediable; counts populate as sites re-scan.

### Fixed — scan, CLI, MCP, shell

- A file vanishing mid-scan no longer crashes the inventory stream (footer
  still written); `--quiet` plus PDF-parser warnings can no longer corrupt
  NDJSON on stdout; an unparseable secrets file throws instead of silently
  wiping other sites' tokens; XLSX chart detection actually detects charts;
  PDF dates parse to real ISO UTC (offset-less values assume UTC by schema
  contract); transient network failures (DNS/reset/timeout) retry with the
  same backoff budget as 429/5xx, honoring `Retry-After`.
- MCP tools: every path-typed argument (including `web_rollup.sitesFile`) is
  gated by the path allowlist; error payloads return `isError`.
- Shell orchestration: temp rosters end in `.json` (audit-fleet's gate rejected
  the old names); expect wrappers map signal-killed children to exit 143 instead
  of 0; a concurrent-run guard refuses to double-run; prereq checks run in every
  mode; `jq` is checked before first use; `SITES_JSON` overrides are validated
  (must exist, must be `.json`), forwarded to the stage-1 scan, and exported as
  `FILECAP_SITES_FILE` so spawned filecap children read the same roster.

### Changed

- `filecap references` now fails loudly (exit 1) where it previously reported
  success with empty results — see the token-expiry fix above for fleet-run
  behavior.
- `audit-file-duplicates.xlsx` and the LLM-context duplicate count now include
  reference-side duplicate groups (previously only same-inventory groups).

### Known minor (pre-existing, documented during the audit)

- `runAudits` serializes an internal `__auditUrl` scratch field into audited
  inventories (harmless; slated for cleanup).
- Fresh detail-less page-audit cache entries can inflate "fixed" counts in the
  site-audit trend exactly as in prior releases.

## [1.38.0] — 2026-06-28

### Added

- **Infographic accessibility gauge** on each homepage card and per-site detail-page hero — a fixed red→amber→green track (the far / partial / closer band thresholds as zones) with a marker dropped at the site's score, so the position reads at a glance without reading the number. Shared `fileA11yGaugeHtml()` keeps the card and detail identical; the per-file score cells keep their matching tint.
- **File-accessibility history + "since last audit" trend.** `web-rollup` now records each site's average scored-PDF score into a **purge-exempt per-site time series** (`~/filecap-audits/<slug>/latest/a11y-history.json`, appended only when the number changes) and publishes a **consolidated `a11y-history.json`** into the bundle for future graphing. A SiteImprove-style trend chip on the card + detail hero shows the change vs the previous audit — **▲ N since <date>** (green, improved) · **▼ N** (red, declined) · *no change* — and is empty until a second data point exists (the first run sets each site's baseline). New pure `src/report/a11y-history.js` (`appendA11yPoint` / `a11yTrend`, unit-tested); the excluded archive and zero-scored sites record no point.

## [1.37.0] — 2026-06-28

### Added

- **`run-site-update.sh` — single-site (or few-site) refresh.** Re-scan + re-enrich just the site(s) you name and rebuild + deploy the fleet bundle, instead of re-running the whole fleet (`run-full-audit.sh`); every other site's numbers come straight from cache. Per named site: SSH re-scan → `references` → `cross-references` (against the fleet-wide sidecar index) → PDF `audits`, then one full-roster `web-rollup` + deploy + purge. Sites are named by **URL** (front-end or file-server), domain alias, slug, or nickname. Flags: `--scores-only` (skip the SSH scan; re-score PDFs only — for in-place fixes, prompting to do a full run first, default Y, if a site has no cached inventory), `--no-archive`, `--no-deploy`, `--no-purge`, `--dry-run` (resolve + print the plan, do nothing), `--help`.
- **Archive auto-prompt.** Because remediation moves "ADA Title II exception" PDFs into `archive.icjia.cloud`, updating a content site **prompts to also refresh the archive** (default Y) so its file count reflects the newly-archived files; the archive's accessibility score stays "N/A — archive" (it remains excluded from scoring). Skipped when the archive is named explicitly, `--no-archive` is passed, or in `--scores-only` mode.
- **`filecap resolve-site <query>` CLI + `src/config/resolve-site.js`.** Resolves a site URL / file-server host / domain alias / slug / nickname to its `sites.json` slug; prints the slug on a unique match, or lists the candidates and exits non-zero when a bare front-end host shared by several apps (e.g. `icjia.illinois.gov`, used by four) is ambiguous. Pure + unit-tested.

## [1.36.0] — 2026-06-28

### Added

- **Per-site file-accessibility indicator** on the fleet bundle's homepage cards and on each per-site detail-page hero — the average of a site's scored-PDF audit reports (`audit.icjia.app`, 0–100) shown with a plain-language band: `< 60` red "Far from accessible" · `60–79` amber "Partial progress" · `≥ 80` green "Closer to accessible" — so a reader can judge how much remediation work remains. Derived **only** from the files' own PDF audit scores (`auditScoreSum ÷ auditedPdfCount`), explicitly **not** the dormant website/page-accessibility score. Shared `src/report/accessibility-band.js` drives the card, the detail banner, and the per-file cells so they can't disagree.
- **Low-data guard + archive exclusion** — sites with fewer than 5 scored PDFs show "Not enough scored PDFs yet (n / N)" instead of a band, and the long-term archive (`archive-prod`) is excluded with a "Score N/A — long-term archive (many files are ADA Title II exceptions)" note, since it intentionally holds inaccessible files.
- **Coverage transparency** on the indicator — "X of Y remediable files scored · Z non-PDF files have no score — remediable files only, not all files" — making explicit that the average covers scored PDFs only, not Office files (remediable but unscored) and not the whole inventory.
- **Red/amber/green tint on each per-file Remediation Score cell** in the detail-page file table, using the same band thresholds, so a manager scanning the table sees at a glance which files are far from / closer to accessible. Unscored files render unstyled.

### Fixed

- **Page/file-table scroll cut-off on per-site detail pages** — the table sat in a `max-height: 75vh` pane that, now that rows are paginated, only created a nested vertical scroll region whose wheel got trapped at the bottom (`overscroll-behavior: contain`) while the sticky footer overlapped the last rows ("scrolling stops / rows cut off"). Removed the obsolete vertical cap so the document owns the scroll; horizontal scroll for wide tables is preserved.

## [1.35.2] — 2026-06-27

### Changed

- Rebranded the deployed bundle's user-facing label from "filecap fleet audit snapshot" to "ICJIA Fleet Audit Assessment" (header, page titles, og/meta, /sites directory, per-site detail pages) and removed the "filecap" brand from user-facing copy. The CLI, package (`@icjia/filecap`), repo, and internal identifiers are unchanged.

## [1.35.1] — 2026-06-27

### Changed

- **Hid the website-accessibility UI** — the fleet bundle is file-only again. The score donuts on each site card revert to the original "% may need audit" scope donut; the per-site "Website accessibility" section is removed from detail pages. The site-audit stage, `latest/site-audit.json` sidecar, and the `audit.icjia.app` detail endpoint remain fully in place (dormant) for later re-enable.
- **Relabeled the remediation page count as "document pages"** (e.g., "≈ 4,200 document pages") everywhere it appears in the fleet bundle — card tile sub-label, fleet-hero display, aria-labels, and tooltips — to remove any ambiguity with web pages. Tooltip text now opens with "pages inside the PDF/Office files — not web pages."

## [1.35.0] — 2026-06-26

### Added

- **Website accessibility score** — a per-site, SiteImprove-style accessibility score (0–100 + A–F grade) for each site's web pages, scored with axe via `audit.icjia.app/api/audit-url-page` and driven by the site's sitemap (∪ CMS pages), explicitly independent of the file/PDF scores. New `filecap site-audit <site>` stage (pipeline Stage 3.6) writes a purge-exempt `latest/site-audit.json` sidecar with the score, a severity + WCAG-level (A/AA) outstanding-issue breakdown, a needs-review count, and a true fixed/new issue-set trend vs. the previous run.
- Compact "Website accessibility" tile on each audit-bundle site card, and a full breakdown section (score, coverage, severity + WCAG split, fixed/new trend, per-page table) on each per-site detail page — each carrying copy that the website score does not reflect the site's files.
- `SKIP_SITE_AUDIT=1` opt-out in the fleet pipeline scripts.
- Each fleet-audit site card now shows a paired **File accessibility** vs **Website accessibility** score donut (grade-banded A–F), replacing the single "% may need audit" donut — making explicit that a site's document scores and its web-page score are independent and don't correlate. Each side shows "not scored yet" until data exists.

### Notes

- Requires `audit.icjia.app` to return `axe.violations[]` + `axe.incomplete[]` and to render SPAs before auditing; filecap degrades gracefully (severity-only, no trend) against an endpoint that doesn't yet.

## [1.34.1] — 2026-06-25

### Added

- **`scores-by-site.xlsx` — a manager bird's-eye summary.** The fleet bundle now ships a one-row-per-site workbook (linked from the landing page) with each site's remediable-file count, PDF score coverage (PDFs / scored / % scored / average score), the A–F grade distribution, and an "Office files (not scored)" count — plus a fleet TOTAL row. It answers "which sites are in the worst shape?" without opening the 4,500-row master. Built from the per-site stats `computeSiteSummary` already streams (now also tallying the grade distribution); it's a downloadable companion, deliberately **not** an on-page aggregate-grade band (that display stays removed).

### Changed

- **Non-scored Remediation Score cells now explain themselves instead of going blank.** A blank cell read as "missing data"; now Office files (DOCX/XLSX/PPTX/legacy) show **`N/A (Office)`** (they have native accessibility checkers in their authoring apps) and PDFs the scorer couldn't process show **`Not scored`** (e.g. the `413 Payload Too Large` oversized PDFs). Genuine pending PDFs and non-remediable reference files stay blank. Across the fleet master this turns ~1,464 confusing blanks into 1,392 `N/A (Office)` + 72 `Not scored`. `formatRemediationScore` now takes the full entry (it needs the category to tell an Office file from a not-yet-audited PDF).

### Docs

- README: the manager TL;DR now covers per-file scores + the scores-by-site summary, with a new **"Understanding the accessibility scores"** section (what `B/88` / `N/A (Office)` / `Not scored` mean, the PDF-only scope, the `413` size limit). Added the missing **`filecap audits`** CLI reference and corrected a second stale "16-column" deliverable description (it's 20).

### Notes

- 959 tests green (new: `test/scores-by-site.test.js`; expanded `test/report-remediation-score.test.js` for the label states). Ships via `node bin/filecap.js web-rollup` (no re-scan).

## [1.34.0] — 2026-06-25

### Added

- **Per-file `Remediation Score` column in the CSV / HTML / XLSX deliverables.** Every per-file report (and the per-file-type aggregate sheets) now carries a `Remediation Score` cell showing the audit.icjia.app letter grade and numeric score together as `B/88` (`grade/score`, read from `entry.audit`). It sits beside the existing **Audit Report** column — which links the shared report — so a manager can read the grade in the row without opening the report. PDFs only; non-PDFs, skipped files, and errored/oversized PDFs leave the cell blank. The data already lived in the inventory NDJSON; this surfaces it. Per management request — and note it is a per-row detail cell, distinct from the aggregate landing-page grade band removed in v1.19.0 (that stays removed).

### Fixed

- **PDF + page scoring now survives audit.icjia.app's rate limit.** The score fetcher gained a retry/backoff HTTP layer (`src/audits/retrying-fetcher.js`): `429 Too Many Requests` and transient `5xx` are retried, honoring the server's `Retry-After` header and falling back to capped exponential backoff. Previously the client threw on the first `429` and recorded a permanent error, so a large batch of cold (never-cached) files would blow past audit.icjia.app's 100-request/min per-IP ceiling and cascade into a wall of errors — a single archive content drop produced 987 such `429`s and starved two later sites of scores entirely. Both the PDF (`/api/audit-url`) and page (`/api/audit-url-page`) passes share the new fetcher. Re-auditing the affected sites through it recovered them cleanly: **archive 206 → 1199 scored, ari 13 → 295, researchhub 100 → 230**. Files that genuinely exceed the endpoint's upload limit return `413 Payload Too Large` and are correctly **not** retried (21 oversized archive PDFs remain unscoreable as-is).

### Notes

- 952 tests green, including new coverage for the backoff fetcher (`test/audits-retrying-fetcher.test.js`) and the score column (`test/report-remediation-score.test.js`). The report-layer change ships to the live bundle via `node bin/filecap.js web-rollup`; the scoring resilience applies to every subsequent `filecap audits` pass.

## [1.33.0] — 2026-06-17

### Changed

- **Per-site detail pages redesigned for lower visual density.** Several reviewers said the report was great but carried too much information up top, especially on the per-site detail pages. The page now leads with a single work-first hero — the count of files that may need audit work, the page-count effort, and the audit proportion (a small ring; the old large donut was mostly empty at the low percentages these audits typically show) — and demotes the inventory totals (file count, size, scan date) to one quiet metaline. The four stacked metric blocks that used to fill the first screen (two big hero tiles + donut, the two stat cards, the "Total inventoried" line, and the four-card summary bar) are consolidated: every number is retained, but the per-type/category detail now lives in a collapsed **"Breakdown by file type"** disclosure and the server/scan/public-URL metadata in a collapsed **"Site details"** disclosure. The always-open three-column row-marker legend above the table becomes a collapsed **"What do the colored row markers mean?"** disclosure, and the File view / Page view toggle moves up beside one shared heading that swaps between "File inventory" and "Pages on this site". Fewer boxes, one accent color, a clearer type scale — no data removed, only reorganized and restyled.

### Notes

- Template/CSS-only change to `src/report/html.js`; ships via `node bin/filecap.js web-rollup` (no re-scan). Fleet totals, the file inventory table, filters, search, sort, pagination, XLSX downloads, the access panel, and the Page view are all unchanged.

## [1.32.0] — 2026-06-16

### Added

- **Per-site Page view now surfaces CMS-hosted (cross-site) files.** When a page links a document served from another fleet site (for example the shared Strapi CMS at `agency.icjia-api.cloud/uploads`), that file now appears on the referring page's row in a muted "hosted on another site" group, linking to the owning site's report. Previously a git-repo site's Page view showed only files in its own repo, so CMS-hosted links (such as the Safe From the Start `/research` Evaluation Protocol DOCX) were invisible even though the association was already captured fleet-wide. The per-page **Files** count is unchanged (still local-inventory only); cross-site files are a separate group.
- XLSX per-site **Pages** tab gains a **"Files on other sites"** column mirroring the HTML group.

### Notes

- Rebuild-only change: ships via `node bin/filecap.js web-rollup` (no re-scan). Fleet file/page totals are unaffected.

## [1.31.1] — 2026-06-12

### Changed

- **SPAC removed from the audited fleet.** The `spac-prod` entry was dropped from the operator's `sites.json` roster (config, not code — backed up alongside the config for easy restoration), so the deployed bundle no longer contains its landing-page card, `/sites` roster card, per-site detail report, per-site workbook, og card image, or any of its rows on the by-type / orphaned-files / file-errors pages and in the fleet workbook. The one SPAC mention baked into code — the `/accessibility` log's 2026-05-20 browser-test entry ("live fleet index + SPAC per-site report") — is genericized to "a per-site report"; the archived research brief whose *filename* happens to contain "SPAC" is archive-server content and intentionally stays. Fleet totals now cover 12 bundled sites.

## [1.31.0] — 2026-06-12

### Changed

- **Each file is listed once in the Page view (and the XLSX Pages tab) — duplicate mentions removed.** A file linked from several pages used to appear under every one of them, so the same filename showed up again and again — on the archive report one PDF appeared under **seven** publication pages, on the agency report the state-seal image under **eleven** — which read as duplication and over-counted remediation work. The page inversion (`buildPageList`) now lists a file only under the **first** page that links it; a later page shows a muted **"+N files listed under other pages"** note (or just that note when all of its files are listed earlier) instead of repeating the chips, and the Page-view legend explains the rule. The per-site workbook's **Pages** sheet mirrors this with a new **"Files listed elsewhere"** numeric column, and its Source column still says `links files` for pages whose every file is listed elsewhere. The file view is unchanged — each file's row still shows **all** pages that reference it, so no page→file association is lost. The inversion also now server-qualifies its dedup key, so identical paths on two different servers (consolidated by-type pages) can no longer collide.
- *Underlying data note:* the repeated mentions were faithful to the live CMS — e.g. seven different archived ICJIA publications genuinely link the same `CAPS3.pdf` (a likely content-migration error on the live site, now easy to spot as a "+N listed under other pages" trail).

## [1.30.0] — 2026-06-12

### Added

- **Shared sticky footer on every bundle page.** The per-site detail pages end in tall HTML grids (meta grid, audit stats, file inventory); with nothing below them, a reader scrolling mid-grid couldn't tell whether the page continued or was cut off. Every page in the bundle — fleet index, `/sites`, `/accessibility`, per-site and by-type detail reports, the orphaned-files report, and the file-errors report — now closes with the same minimal bar the fleet index has always had (byline, generated date, Home · Sites · Accessibility · GitHub · CHANGELOG), pinned to the viewport bottom with `position: sticky` so it is always in view while scrolling and settles into normal flow at the end of the page (it never permanently covers the last grid rows). One source of truth in `src/web/site-footer.js` (markup + CSS, light-palette variant for the orphaned-files report); the body becomes a `min-height: 100vh` flex column so the bar pins even on short pages. The orphaned-files report — previously the only page with no footer at all — also gains the missing `viewport` meta tag.

### Changed

- **Footer content unified.** The fleet-index byline now includes the filecap version (`Generated by filecap v1.30.0`), and the detail/accessibility/file-errors pages drop their one-off footer wordings in favor of the shared bar. The centered-column pages (`/accessibility`, file errors, orphaned files) move their max-width from `body` to `main` so the footer can run full-bleed.
- **Accessibility re-verified after the footer rollout.** axe-core AA: 0 violations on all seven affected page templates (desktop, plus mobile on the fleet index and a per-site report); Lighthouse accessibility 100/100 on the fleet index (desktop + mobile) and a per-site report. Logged on `/accessibility` (backend entry, 2026-06-12) and `currentStatus.asOf` refreshed; the browser axe-DevTools pass remains pending live re-verification.

## [1.29.0] — 2026-06-11

### Fixed

- **The Page view's missing file associations — three reference-extraction gaps closed.** On several sites the detail report's Page view listed pages (from the sitemap/CMS) with **"No files"** even though those pages plainly link documents. The page→file inversion itself was fine; the references step never saw the files:
  1. **Strapi components were skipped entirely.** The field classifier treated every non-UploadFile object as a relation ("enumerated separately") — but components (v3 `Group*`, modern `Component*`, dynamic zones) embed their data *inside* the parent entry, so their files exist nowhere else. SPAC alone lost ~360 page→file links this way: every publication's PDF lives in `mediaMaterial.file`, every meeting's agenda/materials/minutes in `meetingMaterial[].file[]`. The classifier now receives the discovered content-type names and walks anything else (new `component-walk.js`, bounded recursive collection of upload-shaped objects + embedded text). SPAC's sidecar went from **25 → 252** pages with files (62 → 424 file refs). For Strapi v4, `populate=*` reaches one level only, so the fetcher now deep-populates classified component fields (`populate[<field>][populate]=*`).
  2. **Only absolute URLs were extracted from text.** Root-relative links (`/files/x.pdf`, `/uploads/x.pdf`) — the natural way same-site content links its own files — were invisible. `extractFileUrls` gains a `baseUrl` option (markdown resolves against the site frontend, Strapi bodies against the API host) with a guard so an absolute URL's path can't re-match as relative. VPP's `/download` page now links the statewide plan PDF it has always carried.
  3. **The git walker was Nuxt-only.** SFS is Astro — content at `src/content/pages/`, file links in `src/pages/research.astro` — so its sidecar was empty (0 records). The walker now understands `src/content/` (with the `pages` collection routing to the site root) **and** page templates (`src/pages/*.astro`, `pages/*.vue`, `app/pages/*.vue`) via file-based routing; dynamic `[slug]` templates are skipped, and template records are kept only when they carry fleet file refs.
- **Page rows split by URL variants.** The Page view's inversion keyed pages by raw `pageUrl`, so `/About/` and `/about` became two rows with half the files each; it now keys by the normalized URL (same rule the sitemap/CMS merge already used).

### Added

- **A "Pages" tab in every per-site XLSX download.** The per-site workbook (the "Download XLSX" on each detail report) now ends with a **Pages** sheet mirroring the HTML Page view: one row per page — hyperlinked page URL, content type, source (`links files` / `cms` / `sitemap`), file count, file names, and file URLs — file-linking pages first. `writeXlsxMultiSheet` accepts rows-based sheet configs (`{ name, columns, rows }`) so one workbook mixes inventory-entry tabs with plain-rows tabs.

## [1.28.0] — 2026-06-10

### Added

- **Content-only and tooling-only workbook downloads on `/sites`, and an Owner column in all three.** The `/sites` roster now offers three XLSX downloads instead of one: the existing combined workbook (relabeled **"All content and tooling sites (.xlsx)"**, still `sites-list.xlsx` with its Content sites + Tooling sites tabs), plus two new single-audience workbooks — **"Content sites only (.xlsx)"** (`sites-list-content.xlsx`) and **"Tooling sites only (.xlsx)"** (`sites-list-tools.xlsx`). Every sheet in all three workbooks gains an **Owner** column (between Nickname and Description), populated from a new optional `owner` string field on both `sites[]` and `tools[]` entries in `sites.json`; the column is blank for entries with no `owner` set. Like `description`, `owner` is pure presentation — it never enters audit logic. The three buttons share the existing `.roster-download-btn` styling in a wrapping flex row.

## [1.27.0] — 2026-06-08

### Changed

- **Tooling sites are no longer listed on the landing page (`index.html`).** The "Agency tooling" band — the row of ICJIA web-app cards (Squish, the markdown editor, etc.) — has been removed from the fleet snapshot. Tooling sites now appear **only** on the `/sites` roster, which keeps its dedicated "Tooling sites" section. The landing page is now strictly the audited content fleet plus the audit artifacts, matching the existing split where `/sites` is the full directory and `index.html` is the audit-focused snapshot (the same rationale that already keeps unscanned scaffolds off the home page, v1.25.5). `web-rollup` still enriches and ships the `tools[]` entries — their og images, live/down status, and the sites-list workbook's "Tooling sites" tab are unchanged; they are simply omitted from `index.html`. The now-orphaned `renderToolingSection` home-page helper and the unused `tools` parameter on `generateIndexHtml` were removed.

## [1.26.1] — 2026-06-07

### Changed

- **Roomier spacing between the two-across cards** on both the landing page (`index.html`) and the `/sites` roster. The shared `.site-grid` gutter went from a flat `22px` to `48px 40px` (48px between rows, 40px between the two columns) — roughly double — so the image-heavy cards have room to breathe and the grid no longer reads as dense. Because the grid lives in a `max-width: 1200px` container, the wider gap trims each card by only ~2% (≈589px → ≈580px); the change is almost entirely added whitespace. Both pages inline the same `INDEX_CSS` and use the one `.site-grid` rule, so a single change covers them together. Still two across; the ≤820px single-column breakpoint is unchanged.

## [1.26.0] — 2026-06-07

### Added

- **Card images on the landing-page content cards.** The home-page fleet cards (the donut / "may need audit" content cards) now carry the same header thumbnail as the `/sites` roster cards, using the **identical** image algorithm — a local `image` override screenshot if set, else the scraped `og:image`, else the ICJIA-logo tile (`renderCardImage`). The image is the exact same bundled `assets/og/<slug>` file referenced on `/sites`, so the two pages never diverge. With this, both the content cards **and** the tooling band on `index.html` show images, matching `/sites`. Managers landing on the snapshot now see each site's image without having to open the directory. Reverses the deliberate "audit content cards stay image-less for now" choice in the v1.21.0 `/sites` design.

### Changed

- **`web-rollup` now propagates the bundled `image` onto `siteResults`** alongside the live/down status (v1.21.3) and `og:description` (v1.24.0) it already carried, so the landing-page content cards resolve to the same thumbnail as the roster. No re-scan required — a `web-rollup` rebuild picks it up.

## [1.25.5] — 2026-06-07

### Added

- **ICJIA Community Engagement on the `/sites` roster (coming-soon).** Added `https://community-engagement.netlify.app/` as a content site so it shows on the `/sites` directory only. It is intentionally kept off the landing-page fleet snapshot because it is an unscanned scaffold — the backend-less entry is skipped by the scan's server-list parser, and `web-rollup` omits unscanned sites from `index.html` while still listing them on `/sites`. Its card image is a viewcap screenshot of the live scaffold with a bold, unmissable **COMING SOON / EARLY DRAFT — FULL SITE LAUNCHING SOON** hazard banner draped diagonally across it (`assets/og-overrides/community-engagement.png`), so a manager browsing the roster sees at a glance that the site is in development rather than broken.

### Fixed

- **WCAG 1.4.3 (AA) contrast on image-only PDF rows.** Filename links (`#60a5fa`) on the lighter first-column amber tint (`#4d3a0c`) of image-only / needs-OCR rows measured ~4.3:1 — under the 4.5:1 floor — on the Document Archive and ILFVCC detail reports. Links inside image-only rows are now brightened to `#93c5fd` (≥6:1 on the first column, ~7.5:1 on the rest).
- **WCAG 1.4.1 (A) use-of-color in the access panel.** The "Email Chris Schweda" contact link in each per-site report's access panel was set apart from the surrounding paragraph by colour alone; its underline is restored so it is distinguished by more than colour.
- Full axe-core + Lighthouse sweep across all 27 bundle pages (landing, `/sites`, 13 per-site reports, 11 by-file-type pages, `/accessibility`): **0 axe-core violations and Lighthouse accessibility 100** after the two fixes. Recorded on the deployed `/accessibility` log.

## [1.25.4] — 2026-06-07

### Changed

- **Replaced the placeholder og:image on the last two `icjia.illinois.gov` subpath cards** — Adult Redeploy Illinois (`/adultredeploy/`) and Illinois Family Violence Coordinating Council (`/ifvcc/`) inherited the main site's logo-on-blue og:image; both now use viewcap screenshots of their live pages (`assets/og-overrides/ari-api-prod.png`, `assets/og-overrides/ilfvcc-api-prod.png`). Every `/sites` card now shows a real per-site image.

## [1.25.3] — 2026-06-07

### Changed

- **Replaced the ICJIA Research Hub card image.** Like the agency card, the `/researchhub/` subpath inherited the main site's logo-on-blue og:image; swapped for a viewcap screenshot of the live Research Hub page (`assets/og-overrides/researchhub-prod.png`) via the local-file override.

## [1.25.2] — 2026-06-07

### Added

- **Card image for the ICJIA Staff Intranet `/sites` card** — a viewcap capture of its login page (`assets/og-overrides/intranet-api-prod.png`, via the v1.25.0 local-file override). With this, **every content site and tooling card carries its own image; none fall back to the default ICJIA tile.**

### Changed

- **Replaced the ICJIA agency card image** (`icjia.illinois.gov`). Its scraped `og:image` was just the ICJIA logo on a flat blue background; swapped for a viewcap screenshot of the live homepage (`assets/og-overrides/icjia-agency-prod.png`) via the local-file override, which wins over the scraped og:image.

## [1.25.1] — 2026-06-07

### Added

- **Card images for the Document Archive and SPAC `/sites` cards.** Both frontends expose no `og:image`, so each now uses a committed `/sites`-captured screenshot via the v1.25.0 local-file override (`assets/og-overrides/archive-prod.png`, `assets/og-overrides/spac-prod.png`, wired through `image` in local `~/.filecap/sites.json`). Only **ICJIA Staff Intranet** (`intranet-api-prod`) remains on the default ICJIA tile.

## [1.25.0] — 2026-06-07

### Added

- **Per-site image override (URL or local file) for cards whose `og:image` can't be fetched.** The `image` field on `sites[]` and `tools[]` is now a full image source, used in place of the scraped `og:image` when set: an **http(s) URL** is downloaded (point it at any reachable image — e.g. a GitHub README raw image — when the site's own `og:image` is unreachable) and a **local file path** is copied into the bundle (new — for images only available behind an auth wall). Local paths resolve against the sites.json dir, the package root, then cwd; absolute paths are used as-is. Precedence: `image` → scraped og:image → ICJIA-logo tile. Applies to the landing-page tooling band and the `/sites` roster.
- **The gated fleet-audit bundle now carries its own og:image.** Because it sits behind the Netlify visitor gate it can't fetch its own `og:image`, so its `tools[]` entry points `image` at a committed asset (`assets/og-overrides/icjia-fleet-audit.png`, a snapshot of its `/sites` directory) via the new local-file override. The bundle's `<head>` now emits `og:image` / `og:title` / `twitter:*` meta (absolute URL) on both the landing and `/sites` pages.

### Notes

- After this change, 3 content-site cards still fall back to the default ICJIA tile because their frontends expose no `og:image`: **ICJIA Document Archive**, **ICJIA Staff Intranet**, and **Sentencing Policy Advisory Council**. Set each one's `image` (URL or local file) to give it its own card.

### Tests

872 passing (+1 — a local-file `image` is copied into the bundle under `noOg` and the bundle emits the og:image/twitter meta; plus a no-self-image negative assertion).

## [1.24.1] — 2026-06-07

### Changed

- **More breathing room under the landing-page fleet-card description.** The `og:description` blurb added in v1.24.0 sat flush against the file-count tiles; it now carries a bottom margin so the description and the "Total files / May need audit" tiles aren't cramped. Scoped to the fleet cards (`.site-card:not(.tool-card):not(.roster-card)`, the only cards with the tiles) — the tooling band and `/sites` roster cards are unchanged.

## [1.24.0] — 2026-06-07

### Changed

- **Every site card now shows the site's own `og:description`.** Both the landing-page fleet cards and the `/sites` roster (content sites *and* the agency-tooling band) display the description fetched from each site's `og:description` meta tag, blank when the site doesn't expose one. The landing-page fleet cards previously carried no blurb at all; they now show the same description line `/sites` already had. Under the hood, `enrichOg` resolves the card description straight from `og:description` (the curated `sites.json` / `tools[]` description is no longer used for display), and the value is propagated onto `siteResults` alongside the live/down status so the fleet card can render it (HTML-escaped).
  - **Currently blank (no upstream `og:description`):** *ICJIA Document Archive*, *ICJIA Staff Intranet*, and *Sentencing Policy Advisory Council* (their frontends expose no `og:description`), plus *ICJIA Accessibility Fleet Audit* (the bundle sits behind the Netlify visitor gate, so its own meta can't be fetched). Add an `og:description` to those frontends to fill them in.
  - The downloadable `sites-list.xlsx` roster follows the same source — tooling rows now carry `og:description` rather than the curated text.

### Tests

871 passing (+3 — fleet-card `og:description` rendering, blank-when-absent, and HTML-escaping).

## [1.23.0] — 2026-06-07

### Added

- **One-command full audit: `run-full-audit.sh`.** A single repo-root entry point that runs the whole fleet pipeline end to end — pre-flight (`expect` / `netlify` login / `sites.json` / free disk) → scan every content site (SSH + rsync) → enrich (`references` → `cross-references` → per-PDF **and** per-page `audits`) → `web-rollup` (content sites + the tooling-site roster) → deploy to Netlify → purge old runs → a parsed summary (file/page totals + the live URL). It **wraps** the proven `examples/audit-fleet-auto.sh` rather than reimplementing the `expect`-driven SSH/rsync scan, so the heavy lifting is unchanged; the wrapper only adds friendly pre-flight, cleanup, and the summary. Flags: `--no-deploy` (build the bundle locally, don't push), `--no-purge` (keep old runs), `--help`. A full transcript is tee'd to `~/filecap-audits/_runs/full-audit-<UTC-timestamp>.log`. Documented in a new README section, **"One-command full audit"**.

### Removed

- **Stale `fleet-rescan-v1.20.0` workflow** (`.claude/workflows/fleet-rescan-v1.20.0.workflow.js`). It was a one-shot **post-mortem** hardcoded to re-read the 2026-06-02 run — it never actually re-scanned — and its rollup phase predated the v1.21–v1.22 UI (status pill, `/sites`, the on-demand uptime function), so running it would have produced stale results and risked reverting the UI. `run-full-audit.sh` replaces it as the canonical "run everything" entry point.

### Notes

- **Page-scoring resilience.** A full fleet run on 2026-06-06 showed elevated per-page audit errors on four sites (researchhub-prod, intranet-api-prod, ari-api-prod, spac-prod) caused by transient `audit.icjia.app` throttling under burst. Because audit errors are **never cached**, a serial re-run of `filecap audits` on those sites retried only the failures and cleared all of them (626 → 0). One residual on researchhub-prod is a single **structurally malformed PDF** (`VAP FINAL REPORT … with covers-220721T19491890.pdf`) that pdfjs introspection and the audit service both fail to parse — a content-side fix, tracked separately.

## [1.22.1] — 2026-06-06

### Changed

- **Status indicator moved to a compact upper-right corner pill** on every card (landing page + `/sites`), with cleaner spacing: a dot + "Site live" / "Site unreachable", plus a muted **"checked &lt;Chicago time&gt;"** line (time, no seconds) that the on-demand client fills. Replaces the centered status line.
- **Removed the footer "uptime checked" stamp** (folks won't see it down there) in favour of the per-card, at-a-glance "checked" time on the pill.
- **Added breathing room** between a tooling card's description and its "Open tool" button.

## [1.22.0] — 2026-06-06

### Added

- **On-demand uptime for the status indicators.** The live/unreachable dots are now refreshed from a server-side **Netlify Function** (`netlify/functions/uptime.mjs`) that probes the fleet (no CORS) and returns `{ checkedAtMs, sites }`; the page applies it to the dots and shows a "Uptime checked HH:MM" footer stamp. To protect the serverless budget, the page calls the function **only when its `localStorage` cache is older than 6 hours** — so 100 page-loads in a window = **1** call, and a year of constant polling = **4/day** — and the response also carries a durable edge-cache header so even direct hits run the probes ≤ ~once/6h. Same-origin, so the CSP (`connect-src 'self'`) and the password gate are unchanged. Tested: `shouldRefresh` plus a simulation that proves the fetch count is bounded, so a client regression can't silently blow the budget.

### Security

- **Adversarial review of the new uptime endpoint** (running log in the README § Security audit). No exploitable findings; two proactive hardenings:
  - **FC-2026-036 (Low) — redirect-SSRF.** The probe uses `redirect: "manual"`, so a compromised fleet site can't bounce it toward an internal / cloud-metadata IP.
  - **FC-2026-037 (Moderate) — cost / budget DoS.** A durable edge-cache header (`Netlify-CDN-Cache-Control: durable, s-maxage=21600`) + the unit-tested client gate + a GET-only guard + an 8s per-probe timeout bound invocations regardless of request volume.
  - Input-SSRF / XSS / code-injection: checked, clean (no caller-supplied target; `textContent` + live/down allow-list; `JSON.stringify`-serialized targets).

### Tests

868 passing (+19 — the uptime client cache gate, the budget simulation, and the function generator/probe).

## [1.21.5] — 2026-06-06

### Changed

- **The live/down status dot is now a labeled status line.** Each card (landing page + `/sites`) shows a visible **"Site live"** / **"Site unreachable"** label beside the dot, under the title, so the meaning no longer depends on colour (reinforces WCAG 1.4.1) and managers don't have to ask what the green dot means. The line flows in the card body — cards grow to fit it — instead of overlaying the corner. The dot itself stays a non-colour cue (solid green vs hollow red ring).

## [1.21.4] — 2026-06-06

### Security

- **2026-06-06 red/blue team audit** of the v1.21.x `/sites` + tooling line — detail in [`docs/security/audit-2026-06-06.md`](docs/security/audit-2026-06-06.md); appended to the running audit log in the README so it's visible that this bundle is regularly reviewed. Two findings fixed, one tracked residual, 0 CVEs, 849/849 tests green:
  - **FC-2026-033 (Low) — origin-server identity exposed in the gated bundle.** The cards + downloads surfaced the DigitalOcean **origin** IPs, Laravel-Forge scan paths, and internal hostnames — none of which are in the public Netlify frontends' DNS, so this was origin recon a gated roster doesn't need. **Fixed in v1.21.2** (stripped from cards / `sites-list.xlsx` / `audit.xlsx` columns / per-site reports / NDJSON header / `context.md`; verified 0 origin-IP + 0 `/home/forge` hits). Upgrades FC-2026-027 from *mitigated-by-gate* to *removed-at-source*.
  - **FC-2026-034 (Moderate) — no `Content-Security-Policy` header.** **Fixed here:** a strict CSP is emitted in `_headers` + `netlify.toml` — `default-src 'self'; frame-ancestors 'none'; object-src 'none'; script-src/style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; upgrade-insecure-requests`. Verified the bundle loads only `self` assets + a `data:` favicon, so the page renders unchanged while external script injection, framing, plugins, base-tag hijack, and outbound exfiltration are all blocked.
  - **FC-2026-035 (Note, open) — per-file `absolutePath`** still carries the Forge path for strapi files in `audit.xlsx` + `audit-fleet.ndjson` (git's `absolutePath` is the functional GitHub URL, so it can't be blanket-dropped). Deferred to a focused follow-up; behind the Site Password meanwhile.

### Tests

849 passing (+1 — a CSP-header assertion).

## [1.21.3] — 2026-06-06

### Added

- **Live/down status dot now on the landing-page cards too.** The indicator added to `/sites` in v1.21.2 is propagated onto the home page's per-site **fleet cards** and the **"Agency tooling"** band, so it's consistent everywhere a site card appears. Reachability is computed once during the rollup and stamped onto `siteResults` (and the tooling entries), so there's no extra fetch. a11y unchanged (the dot carries an `aria-label` and uses fill, not colour alone).

## [1.21.2] — 2026-06-06

### Added

- **Live/down status dot on the `/sites` cards.** A subtle indicator at the top-right of each content + tooling card showing whether the site responded at the last rollup — **solid green = live, hollow red ring = down** (the fill difference is a non-colour cue, so it satisfies WCAG 1.4.1; an `aria-label` carries the text). Derived for free from the existing OG fetch (`fetchOgMeta` now returns `reachable`); a gated `401` counts as live. The home-page tooling band is unchanged (the dot is `/sites`-only).

### Changed / Security

- **Trimmed the card "Technical details" to what a roster needs.** Dropped the **scanned filesystem Path** and the **server IP**; the **Hostname** row shows only when it's a real name *different from the IP* (for strapi sites the scan records the IP as the hostname, so the row was redundant). Shared block — affects the home cards and `/sites`.
- **Scrubbed origin-server identity from the downloads + reports.** `serverIp` and `scannedPath` (the Forge scan root, e.g. `/home/forge/<site>.icjia-api.cloud/…`) no longer ship in: the `sites-list.xlsx` roster (Hostname/IP/Scanned-path columns removed), the master / per-site / by-type `audit.xlsx` (columns dropped from the layout), the per-site report meta-grid + table cells, the `audit-fleet.ndjson` header sources, and `audit-fleet-context.md`. Rationale: the exposed IPs are the **DigitalOcean origin** servers (the public frontends are on Netlify, so these IPs aren't in public DNS), and one box hosts several sites — origin recon a gated manager roster doesn't need. **Residual (deliberately not in this pass):** the per-file `absolutePath` column still carries the server path for strapi files, and the per-site report keeps the now-empty Server-IP / Source-folder column *headers* — fully removing those is a column-schema change left for a focused follow-up.

### Tests

845 passing (+4). Updated the tech-details / report-meta-grid / og-meta assertions for the new shape; added status-dot tests (live / down / unknown + the `showStatus` gating).

## [1.21.1] — 2026-06-06

### Fixed

- **Card site-URL links now meet WCAG 2.5.8 (AA) target size.** An axecap (axe-core 4.11) + Lighthouse pass on the v1.21.0 bundle — desktop **and mobile** — surfaced exactly one accessibility finding: the small `.site-url` link under each card title (home page **and** the new `/sites` roster) was a sub-24 px tap target. Gave the link an `inline-block` ≥24 px box (padding). After the fix: **0 axe-core violations**; Lighthouse **accessibility 100** and **best-practices 100** on both viewports; **mobile performance 94–99**. SEO is intentionally low (the bundle is `noindex` + visitor-access gated) and out of scope for a protected internal tool. (`src/web/index-css.js`; the `/accessibility` log gains a timestamped entry.)

## [1.21.0] — 2026-06-05

### Added

- **`/sites` — a registered-site directory** for managers who want the roster, not the audit ("never mind the PDFs — how many sites do we have?"). Lists **every** site in `sites.json` (scanned or not) plus the agency's **tooling apps**, split into **Content sites** and **Tooling sites**. Each card shows an og:image thumbnail, title, live URL, a one-line description, and — for content sites — the same collapsed "Technical details" block as the home page, but **no per-file / per-page audit numbers**. Leads with a bold, count-first hero ("N content sites · M tooling sites", broken down by access kind). New `src/web/sites-page.js` (`generateSitesHtml`). Served at `/sites` via Netlify clean URLs (no redirect needed, same as `/accessibility`).
- **Tooling sites — a `tools[]` array in `sites.json`.** Active ICJIA web apps with no document files to audit (markdown editor, Squish, MetaPeek, Ipsumify, the QR generator, and the fleet-audit bundle itself). They never enter the scan/audit pipeline and never affect fleet counts. New strict `toolEntrySchema` (`name` slug + required http `siteUrl`; optional `siteName` / `siteFullName` / `description` / `stack` / `image`). A **"Tooling sites" band** also appears on the home page below the fleet cards.
- **OG metadata per site + tool** — `og:image` / `og:title` / `og:description` are fetched and shown on the roster/tooling cards. og:images are **downloaded into `assets/og/`** for a self-contained bundle; the card description defaults to the site's own `og:description` (a config `description` overrides). When a site has no og:image (e.g. an SPA), the card falls back to the **ICJIA logo** tile. New `src/references/og-meta.js` (`fetchOgMeta`, `fetchImageBytes`) — best-effort, concurrency-limited, fully injectable so tests never touch the network. New **`--no-og`** flag (and `noOg` option) skips fetching for offline / fast rebuilds.
- **`/sites` in the top nav and footer** of the home page (and the other generated pages' footers), and a "Home" link back from `/sites`.
- **`sites-list.xlsx`** — a one-click directory export on `/sites`: a two-sheet workbook (**Content sites** + **Tooling sites**) with names, descriptions, URLs, and the content sites' tech details. New `writeXlsxRowsMultiSheet` in `src/report/xlsx.js`.
- **Optional `description` + `image` on audit sites** (`siteEntrySchema`) so a content site can carry a hand-written one-liner / thumbnail override; both fall back to the fetched OG data.

### Changed

- **The home page's ~2,200-line inline stylesheet was extracted to `src/web/index-css.js`** (`INDEX_CSS`) so `/sites` reuses the *exact* same CSS with zero drift. The home page renders byte-for-byte identically; the new `/sites` / tooling / card-image rules are appended in that one file. Card primitives (`he`, `copyableValue`, `renderTechDetails`, `renderCardImage`, `renderToolCard`, the access-chip label map, the ICJIA logo) are now exported from `index-page.js` and shared by both pages; the per-card "Technical details" block is factored into `renderTechDetails()` used by both `renderCard` and the roster card.
- **Housekeeping:** removed three now-unused CSV imports (`writeCsv`, `writeOrphansCsv`, `writeAuditErrorsCsv`) and a dead `auditXlsxMeta` object in `web-rollup.js`, and tightened several `== null` checks to `===` so `eslint src test bin` is clean (`AbortController` added to the globals list alongside `fetch` / `AbortSignal`).

### Tests

840 passing (45 new this release). New `test/og-meta.test.js` (meta-tag parsing, entity decoding, OG + image fetch with stubbed network) and `test/sites-page.test.js` (roster cards carry title / URL / description / tech details and **omit** audit numbers; ICJIA-logo fallback; unscanned-site rows; tooling section; count-first hero; XLSX download; nav). Extended `sites-json-schema.test.js` (`tools[]` + optional `description` / `image`), `index-page.test.js` (tool card + tooling band + `/sites` nav), and `web-rollup.test.js` (writes `sites.html` + `sites-list.xlsx`, downloads og images, lists a registered-but-unscanned site, password-gates `sites.html`).

## [1.20.1] — 2026-06-03

### Changed

- **Page Audit Score column removed from the per-site detail pages' Page view.** The column showed each page's own A–F accessibility grade plus an "Open report" link to `audit.icjia.app/page-report/…`, but that per-page report route consistently 404s, so the link was an annoyance rather than a useful indicator. Removed the column (header + cell), the now-orphaned `buildPageAuditCell()` helper, and the supporting copy in the "Pages on this site" note and the File/Page-view toggle blurb; the `#page-table` layout rebalances from four columns to three (Page / Content type / Files). The per-page `pageAudit` data is still computed upstream in `src/report/pages.js` — it is simply no longer rendered, so the column is a one-line re-add if the report route is ever fixed. The File view's small per-page grade chip next to each linking page is unchanged. (`src/report/html.js`.)

### Tests

796 passing (no net change — `report-html.test.js`'s Page-view row test now asserts the "Page Audit Score" header is gone instead of asserting the grade chip renders).

## [1.20.0] — 2026-06-03

### Added

- **Page count surfaced as the procurement unit across the fleet.** Vendors quote per page, not per file, so the deployed bundle now leads with "≈ N potential pages" alongside the file count on the fleet hero, every per-site card, and every per-site detail page. A new **`Page Count` column** is back in the schema (slotted right after `File name` in the XLSX, and after `filename` in the CSV) — it was dropped in 1.4.1 on the "open it in Acrobat" argument; restored because procurement workflows can't open 3,500 PDFs by hand. PDFs carry the measured pdfjs page count; non-PDFs leave the cell blank. The PDFs sheet of the master workbook has a bottom **`TOTAL` row with a real `SUM` formula** over Page Count so a vendor opening the workbook sees the procurement unit (≈88,286 measured PDF pages as of 2026-06-02) without writing a formula.
- **Inclusive page estimate for non-PDF formats** so the hero doesn't undersell the workload. PDFs contribute their measured pdfjs page count; DOCX adds ×7 per file, PPTX ×20, XLSX ×1, legacy Office ×5 (averages chosen conservatively from real-world agency content). Fleet total currently **≈92,350 potential pages** across 4,759 remediable files. The per-format breakdown is exposed via a tooltip on every page-count cell. New `src/web/page-estimate.js` with `PAGE_ESTIMATES` and `estimateRemediablePages({pdfPagesMeasured, docxCount, pptxCount, xlsxCount, legacyOfficeCount})`.
- **"Potential workload" framing** to keep the page-count numbers from being read as a fixed commitment. The fleet hero says "potential pages (REMEDIATION WORKLOAD)". An amber callout below the hero leads with `SNAPSHOT AS OF [last fleet audit time]` and explicitly tells the reader that *both* the file counts and the page counts will change as staff remove files, edit content, update sites, or publish new material. Per-site detail pages echo the framing with a smaller amber strip under the donut. Tooltip language updated everywhere from "vendors typically quote per page" to "subject to change as files are added, edited, or removed."
- **Snapshot eyebrow keyed to the last fleet-audit time**, not the rollup-build time. Was previously using `generatedAt` (the moment `web-rollup` ran), which advanced on every rebuild even with no fresh scan. Now reads the most recent `sr.scannedAt` across `siteResults` and labels the timestamp explicitly as "— last fleet audit" so a manager can't mistake it for a rebuild date.
- **ICJIA logo in the top nav is now a smooth-scroll "back to top" link** (`<a href="#top">`). Hover dip + focus-visible outline; respects `prefers-reduced-motion: reduce` (falls back to instant scroll for users who've requested reduced motion).

### Changed

- **All downloadable reports flipped from CSV to XLSX.** New dep: `exceljs`. New module `src/report/xlsx.js` (`writeXlsx`, `writeXlsxMultiSheet`, `writeXlsxFromRows`).
  - The five per-type CSVs (`audit-pdfs.csv`, `audit-docx.csv`, `audit-xlsx.csv`, `audit-pptx.csv`, `audit-office-legacy.csv`) collapse into a **single multi-sheet `audit.xlsx`** with one tab per remediable file type. Empty buckets are skipped so the workbook only carries tabs that hold data.
  - **Per-site `<site>.xlsx` is also multi-sheet by remediable file type**, scoped to that site. Replaces the per-site CSV.
  - `audit-file-list-master.xlsx`, `audit-file-duplicates.xlsx`, `audit-orphaned-files.xlsx`, `audit-file-errors.xlsx` all converted.
  - **Manager-friendly XLSX column order** (CSV layout unchanged for any external consumers): Date published (pre-sorted desc, newest first) → File name → Page Count → Public URL (clickable hyperlink) → Page References (clickable hyperlink to first URL) → File type → Size → Audit Report → Website → Server → IP → ... the rest.
  - **`Public URL` is a clickable hyperlink in every XLSX** (master, per-site, per-type tabs, orphans, errors); the first URL in `Page References` is also hyperlinked. Cells use Excel's standard URL color (`#0563C1`, underlined).
- **Non-remediable rows dropped from every downloadable report.** Vendors quote against PDFs / DOCX / XLSX / PPTX / legacy Office only; images / text / archives / web / audio-video / other were just noise. They stay in the HTML tables (the chip filter handles the view); they no longer appear in any download. The per-bucket HTML pages for non-remediable types still exist and are still linked from the index by-type table, but their row counts are no longer clickable to a CSV.
- **"Download CSV" button text → "Download spreadsheet (XLSX)"** on every per-site / per-type detail page. Master-spreadsheet section header on the index reads "Master spreadsheet — every **remediable** file across every server" (the word *remediable* promoted into the heading so the filter is visible without reading the body copy).
- **Master-spreadsheet section visually separated** from the per-site card grid above it: 3.5 rem top margin, a top border, a 64 × 3 px amber accent strip pinned to the border, and a larger `h2` so the section reads as a deliberate new chapter rather than another card. The download button row gains a small left-margin bump to match.
- **LLM context (`audit-fleet-context.md`) schema description rewritten to match the NDJSON that's actually shipped.** Was 1.4-era; missed `remediable`, `references[]`, `audit`, `__auditUrl`, plus ~15 introspection fields the NDJSON carries. PDF intro list went from 9 → 21 fields (added `hasOutline`, `isLinearized`, `pdfVersion`, `approxWordCount`, the date / creator / title / subject fields). DOCX 6 → 13. XLSX 1 → 9. PPTX called out as "category `presentation`, no introspection yet." Sample LLM prompts updated with page-count queries and an `audit.score < 70` query. The "actionable files" callout switches from CSV to XLSX language.
- **Netlify `netlify.toml`** gains a `/*.xlsx` rule mirroring the existing `/*.csv` rule — `Content-Disposition: attachment` so browsers force-download instead of trying to render the workbook inline.

### Internal

- **`.claude/workflows/fleet-rescan-v1.20.0.workflow.js`** — saved workflow that orchestrates a top-to-bottom fleet rescan as pre-flight + scan/audit/references + verify + rollup + deploy + purge, each phase a separate agent so the run is resumable on failure.
- **`assets/fleet-pdf-pages-2026-05-22.{png,svg,md,py}`** — accessible page-count exhibit (SVG / PNG chart, accessible markdown text equivalent, Python generator) accompanying the v1.20.0 page-count rollout.

### Tests

796 passing (+30 — `page-estimate.test.js` × 9 covers the inclusive estimate; `report-xlsx.test.js` × 15 covers single-sheet / multi-sheet / from-rows + column order + sort + hyperlinks + the SUM total row; `report-csv.test.js` +6 for the Page Count column; `report-html.test.js` +1 / `web-rollup.test.js` updated for the layout shift).

## [1.19.1] — 2026-05-22

### Fixed

- **Security + `X-Robots-Tag` headers now actually reach the deployed bundle.** v1.19.0 set them in `netlify.toml` `[[headers]]`, but Netlify does **not** apply `netlify.toml` header blocks on a no-build manual `netlify deploy --dir` — only a `_headers` *file* (the same file-based mechanism as `_redirects`) is honored. `web-rollup` now also emits a `_headers` file putting `X-Robots-Tag: noindex, nofollow`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer` on `/*`, so they take effect on every file in the bundle. `robots.txt` (`Disallow: /`) was already live. New `generateNetlifyHeaders()` in `src/web/netlify-config.js`; `web-rollup` writes the file alongside `netlify.toml` and `_redirects`.

### Tests

766 passing (+2 — `generateNetlifyHeaders` content; the bundle emits a `_headers` file).

## [1.19.0] — 2026-05-22

### Changed

- **PDF accessibility scoring is no longer surfaced on the fleet index.** The "PDF accessibility scoring" band on the bundle's index page — average grade, average score, and the PDFs-audited / awaiting / error counts — has been removed. The audit.icjia.app scoring heuristic is still being refined, so a headline aggregate grade on the landing page over-states a number that is not settled yet. The per-PDF audit data is unchanged; it is simply no longer rolled up into a fleet-wide score. (`src/web/index-page.js` — the render and its supporting computation are removed; the `.fleet-audit-*` CSS is retained, clearly marked, so the band can be restored in one place if the heuristic stabilizes.)
- **The "Audit Score" column is renamed "Audit Report" and links to the report instead of printing a grade.** In both the per-site HTML tables and the CSV deliverables, the cell no longer renders a letter grade + numeric score (e.g. `B (84)`). The HTML cell is now just an "Open report" link; the CSV cell is just the audit.icjia.app report URL (Excel and Google Sheets auto-hyperlink it on open). The score still exists — it lives in the linked report — it is just no longer asserted inline while the scoring heuristic is being refined. The column header is relabeled **"Audit Report"** to match what the cell now contains. Errored audits still show "Unavailable"; non-PDFs and unaudited files are still blank. (`src/report/csv.js`, `src/report/html.js`.)
- **`X-Robots-Tag: noindex, nofollow` now covers every file in the bundle**, not only HTML pages. The header moved from the `/*.html` rule to the `/*` catch-all in the generated `netlify.toml`, so the CSV spreadsheets, the consolidated NDJSON, and the context `.md` are no-index too. `robots.txt` already `Disallow: /`s the whole bundle for well-behaved crawlers; this closes the gap for crawlers that honor the header but ignore robots.txt. (`src/web/netlify-config.js`.)

### Fixed

- **The site URL on each fleet-index card is now a working link.** Every site card shows the live-site URL under the site name; it looked like a link but was not — the whole card is a stretched-link to the detail report, and the URL text sat under that overlay with `pointer-events: none`, so clicking it opened the detail report instead of the site. The URL is now a real `<a target="_blank" rel="noopener noreferrer">` to the live site, lifted above the overlay and added to the card's `pointer-events: auto` allowlist. Every other surface of the card still opens the detail report. (`src/web/index-page.js`.)

### Internal

- **All ESLint errors cleared (21 → 0).** Pre-existing lint debt across `src/` and `test/` — `eqeqeq` (`==`/`!=` → `===`/`!==`), unused variables and imports, a `prefer-const`, and an undeclared `AbortSignal` global — was fixed so `npm run lint` passes clean.

### Tests

764 passing (+8 — the Audit Report cell renders link-only in CSV + HTML, the scoring band is absent from the index, the card site-URL link is a clickable new-tab anchor, and `X-Robots-Tag` covers the `/*` catch-all).

## [1.18.0] — 2026-05-21

### Added

- **Fleet "File errors" report.** A new `audit-file-errors.html` page — linked from the fleet index — lists every file the audit step could not score, **grouped by site**, with the file, its type, size, the raw error, a plain-English likely reason, and a link to the file. **Every site is listed**, so a site with no problems is explicitly marked clean. A companion `audit-file-errors.csv` carries the same data (Website · File · File type · Size · Public URL · Error · Likely reason). Reasons are categorized — a non-PDF saved with a `.pdf` name (HTTP 422), a large PDF that timed out (retryable), a `content-type-mismatch` from the scanner, etc. New `src/report/audit-errors.js` (`collectAuditErrors`, `categorizeAuditError`, `writeAuditErrorsCsv`) and `src/report/audit-errors-page.js` (`generateAuditErrorsPage`); `web-rollup` emits both files and the index links to them.

### Tests

756 passing (+15 — error collection/categorization, the page generator, and the web-rollup + index wiring).

## [1.17.0] — 2026-05-21

### Added

- **`filecap scan` flags mislabeled files.** A new `content-type-mismatch` flag marks files whose extension implies a format whose magic bytes the content doesn't match — e.g. an HTML document saved with a `.pdf` extension. The scanner reads the leading bytes of every file with a known signature (`pdf`, `docx`/`xlsx`/`pptx`, `png`, `jpg`/`jpeg`, `gif`) and records the mismatch directly in the inventory's `flags[]`. Previously these surfaced only downstream — a "PDF" that's actually HTML fails the audit step with an HTTP 422 from audit.icjia.app. New `src/flag/content.js` (`computeContentFlags`) and `src/scanner/header.js` (leading-byte reader); `src/commands/scan.js` merges the result into each entry's flags.

### Tests

741 passing (+11 — the content-signature check and a scan integration case).

## [1.16.0] — 2026-05-21

### Added

- **`/accessibility` page.** filecap audits other sites' accessibility, so the deployed fleet-audit bundle now holds itself to the same standard — and shows it. A new `/accessibility` page presents the bundle's current accessibility standing (Lighthouse 100, axe-core 0 violations, desktop + mobile) and a chronological, timestamped log of every accessibility check — from both the browser (axe DevTools, run by hand) and the backend build (axe-core, Lighthouse, contrastcap). The log is a committed data file (`src/web/accessibility-log.js`) appended to whenever accessibility work is done; the page generator is `src/web/accessibility-page.js`; `web-rollup` writes it as `accessibility.html` (Netlify serves it at `/accessibility`) and gates it like every other page. An **Accessibility** link is added to the footer of the fleet index, the per-site reports, and the by-type pages, plus the orphans report's top nav.
- The new page is itself accessibility-clean — contrastcap 0 failures, axe-core 0 violations, Lighthouse 100, on desktop and mobile.

### Tests

730 passing (+9 — the page generator, the web-rollup emit, and the three footer links).

## [1.15.3] — 2026-05-20

### Fixed

- **Page view table — readable columns and page URLs.** The per-site report's Page view had two layout problems. The table used `table-layout: auto`, so the file column (long, unbreakable filenames) claimed most of the width and the **Page** column collapsed to a sliver of vertically-wrapped text. And the first column showed each page's CMS `<title>` — which on many sites is the same generic site name for every page, so every row read identically. Now the table uses a fixed 4-column layout (the URL column gets 46%), the first column shows the page's own **URL** — the real per-page identifier — and long file-name chips wrap inside the Files column instead of overflowing it. `src/report/html.js`.

### Tests

721 passing — the Page-view row test now asserts the page URL is the link text.

## [1.15.2] — 2026-05-20

### Fixed

- **Accessibility — contrast and heading markup the open-source axe-core missed.** v1.15.1 reported Lighthouse 100 and 0 axe-core violations, but those run the *open-source* axe-core, which rounds contrast ratios and defers text-over-image to "needs review." Re-checking the deployed site with the **axe DevTools browser extension** (Deque's stricter `advanced/` ruleset) and **contrastcap** (pixel-sampling) surfaced real issues the "100" had hidden — 28 on the fleet index, 1 on each per-site report:
  - **Muted text contrast (WCAG 1.4.3 AA).** The index's secondary text — the per-site `scan-meta` lines and tech-details toggles — used `#788391`, which measures **4.41–4.47:1** on the dark card: just under the 4.5 minimum (open-source axe-core rounds it to a pass). Raised to `#9aa5b1`, ~7:1. 26 instances, in `src/web/index-page.js`.
  - **CSV-download button contrast (WCAG 1.4.3 AA).** The per-site reports' green "Download spreadsheet (CSV)" button used a gradient whose light end (`#2ea043`) gave white button text only ~3.9:1. Darkened the gradient to `#1f7a30 → #176127`, white text ≥5:1, in `src/report/html.js`.
  - **Heading markup (WCAG 1.3.1 A).** The index's two LLM-context download labels (`audit-fleet.ndjson`, `audit-fleet-context.md`) were styled as headings but not marked up as such. Each is now a `role="heading"` level-3 heading under the section's `<h2>`.
- Re-verified with contrastcap (the `#788391` and CSV-button failures are gone) and axe-core / Lighthouse (still 0 violations / 100). The contrastcap items that remain are pixel-sampling artifacts over the cards' decorative background-images plus one `aria-hidden` glyph — confirmed against screenshots, not WCAG failures.

### Tests

721 passing (+1 — the LLM-context heading-markup assertion).

## [1.15.1] — 2026-05-20

### Fixed

- **Accessibility — the generated reports now score 100.** A red/blue review (`docs/site-review-2026-05-20.md`) found the deployed site — an accessibility-audit tool — scoring only 88–93 on its own Lighthouse accessibility. Fixed across every report generator (`src/report/html.js` for the per-site + by-type reports, `src/web/index-page.js`, `src/report/orphans-html.js`):
  - **Color contrast (WCAG 1.4.3 AA)** — muted/secondary text (no-files chips, audit-source labels, footers, orphan-row hints) now clears ≥4.5:1.
  - **Use of color (WCAG 1.4.1 A)** — in-text and footer links are underlined, no longer distinguished by color alone.
  - **`<main>` landmark** — the per-site, by-type, and orphan reports now have one (the fleet index already did).
  - **Target size (WCAG 2.5.8)** — the meta-copy buttons and tech-details toggles are ≥24×24 px; the non-interactive site-card URL is now plain text instead of a stray link.
  - **Favicon** — every page declares an inline SVG favicon, ending the `/favicon.ico` 404 console error.
- Result: Lighthouse accessibility **100** and **0 axe-core (WCAG A/AA) violations** on the fleet index, per-site reports, and the orphans report.

### Tests

720 passing (+5 — favicon and `<main>`-landmark structural assertions across the report generators).

## [1.15.0] — 2026-05-20

### Added

- **Page view now lists every CMS page, not just the file-linking ones.** The Page view's page list came from two sources — the file→page inversion (pages that link ≥1 file) and the site's `sitemap.xml`. It now also merges the **CMS's own page list**: every content entry's page, taken from the references sidecar. `audit-fleet-auto.sh` retains that sidecar per site at `~/filecap-audits/<site>/latest/references-sidecar.ndjson`, and `web-rollup` reads it and merges it. CMS-derived pages that link no files render as thin rows tagged `cms` (parallel to the `sitemap` tag) and carry their content type. This completes the Page view for the **intranet** — an auth-walled site with no public sitemap, which now lists all ~270 of its CMS pages instead of only the file-linking ones. New export `parseCmsPageList` in `src/report/pages.js`; `buildPageList` gains a `cmsPages` argument.

### Tests

715 passing (+7 — CMS page-list parsing and the buildPageList / writeHtml merge).

## [1.14.2] — 2026-05-20

### Added

- **README banner.** A header image at the top of the README — an amber-on-ink, terminal-style `filecap-cli` wordmark with a soft phosphor glow and crop-mark framing. Source SVG at `assets/filecap-cli-banner.svg`, rendered to `assets/filecap-cli-banner.png`. Documentation only — no change to the CLI or its output.

## [1.14.1] — 2026-05-20

### Changed

- **Page view sitemap merge is now scoped to the site's own path.** A site whose front-end URL carries a path — e.g. Research Hub 1.0 at `icjia.illinois.gov/researchhub/` — shares the parent site's `sitemap.xml`. `web-rollup` now keeps only the sitemap URLs under the site's own path prefix, so Research Hub's Page view lists its own `/researchhub/` pages instead of all ~2,377 `icjia.illinois.gov` URLs. Sites at a domain root are unaffected (every URL kept). New helper `scopeSitemapUrlsToSite` in `src/references/sitemap.js`.

### Tests

708 passing (+3 — sitemap URL path-scoping).

## [1.14.0] — 2026-05-20

### Added

- **Complete page list in the Page view.** The Page view previously listed only pages that link to ≥1 file (the inversion of `references[]`). It now also merges in every URL from each site's `sitemap.xml`, so it's a *complete* list of the site's pages — including the static git sites, which until now had an empty Page view. Pages with no file links show as thin rows tagged **sitemap** (URL only — no audit score or attached files, since that data comes from the reference/audit pipeline). New module `src/references/sitemap.js` (`parseSitemapXml`, `fetchSitemapUrls`); `web-rollup` fetches each site's sitemap at bundle time and a missing/broken sitemap degrades gracefully to nothing.

### Changed

- **File / Page view toggle moved directly above the table.** It now sits between the File view's controls (filter chips, search box, row-marker legend) and the table itself, so the connection between the toggle and the table it controls is unmistakable for non-technical readers.

### Tests

705 passing (+8 — sitemap XML parsing, the page-list sitemap merge, and the `writeHtml` integration).

## [1.13.1] — 2026-05-20

### Changed

- **Removed the fleet-index "Cross-site reference coverage" band.** The summary strip that split the fleet into "have known referrers" vs. "have no known referrers — deletion candidates" is gone for now. It put a deletion frame on the audit, when the goal is for a manager to first see the *scope* of the website footprint; deletion candidates still surface naturally further down the page (the orphaned-files report, the per-site tables). The underlying per-file reference data is unchanged — only the index-page summary band was removed.

## [1.13.0] — 2026-05-20

### Added

- **Page view.** Each per-site report now has a **File view / Page view** toggle at the top — File view is the default. The Page view is the transpose of the file table: one row per page on the site, showing the page's own accessibility score and the files it links to. Columns — **Page** (title, linked to the live page), **Content type**, **Page Audit Score** (the page's A–F grade), **Files** (count + the documents the page links to). Sortable headers and the same 25/50/100 paginator as the file table. No new pipeline data is required — the page list is built by inverting each file's `references[]` (every reference already carries the page URL, title, content type, and `pageAudit`). New module `src/report/pages.js` (`buildPageList`).
- **Static-site empty-state.** Page mapping comes from CMS reference extraction, which exists only for the Strapi sites. On the static git sites (the ARI Summits, vpp, ilheals, sfs) the Page view shows a short plain-English explanation instead of an empty table.

### Tests

697 passing (+10 — `report-pages` for the page-list inverter, plus Page-view markup cases in `report-html`).

## [1.12.2] — 2026-05-20

### Fixed

- **Git-site file links were broken.** The per-site report's File name link (and the CSV Public URL) for the static git sites — the ARI Summits, vpp, ilheals, sfs — built `publicUrlBase + path` and **dropped the site's path prefix**. Those sites deploy files under `/static/…`, so the link was missing that segment and landed on the site's SPA catch-all (the homepage) instead of the file. `buildPublicUrl` (`html.js` + `csv.js`) now applies the site's `pathPrefix`, and `runReport` injects it from web-rollup (the scanned inventory header doesn't carry it). It also **percent-encodes each path segment**, so pre-CMS filenames containing spaces (e.g. `Agenda_ARI_AllSites_Summit _2017_FINAL.pdf`) produce valid `%20` URLs.
- **Cross-server duplicate detection missed space/underscore pairs.** `normalizeStrapiFilename` only stripped the Strapi upload hash — it didn't treat a space and an underscore as equivalent. A pre-CMS file `Some File.pdf` and its Strapi-sanitised twin `Some_File.pdf` were keyed differently and never grouped, so the duplicate was missed entirely. The normaliser now folds runs of spaces and underscores to a single underscore.

### Changed

- **Fleet-index default sort is now "Most recently added"** (was alphabetical) — newer sites lead, and the oldest (the ARI Summits) sit at the bottom.
- **HTML report tables default to 25 rows per page** (was 50).
- **"Coming soon" section refreshed** — it now previews the two upcoming features (the Page view and fuzzy search) instead of the already-shipped reference-discovery work.

### Tests

687 passing (+2 — pathPrefix + percent-encoding in the File name link, and space/underscore folding in `normalizeStrapiFilename`).

## [1.12.1] — 2026-05-20

### Changed

- **Orphaned-files report — paginated.** The orphan table (thousands of rows) is now paged (25 / 50 / 100 rows per page, default 50) with Prev / numbered / Next controls and a "Showing X–Y of N orphans" readout. The column sort and the filter box still work — they drive the matching set and the paginator shows the current slice.
- **Fleet-index duplicates table — paginated, column-trimmed, drag removed.** The cross-server duplicates table is paged the same way. Its HTML columns are trimmed to the four a manager acts on — **Filename**, **Match** (exact/variant), **Sites**, **Copies**; the "Newest → oldest" and "Total size" columns move to CSV-only (`audit-file-duplicates.csv` keeps the full per-occurrence detail). The click-and-drag pan handler is removed — a 4-column table fits without horizontal panning. The Remediable / Reference / All kind-filter is now JS-driven (was CSS `display:none` rules) so it composes with the paginator's row show/hide.

### Tests

684 passing (+9 — new `report-orphans-html` suite, plus duplicates-table paginator + trimmed-column cases in `index-page`).

## [1.12.0] — 2026-05-20

### Changed

- **HTML report table redesigned for managers.** The per-site / by-type inventory table now shows only the six columns a manager acts on — **File name** (linked to the file), **File type**, **Audit Score**, **Page References**, **Duplicate of**, **Date published**. Consolidated multi-site reports prepend a **Website** column so each row's site stays identifiable. The forensic columns (server, IP, source/relative/absolute paths, extension, size, content hash, public URL) are unchanged in the CSV — the CSV stays the full 18-column record; the HTML is now a focused projection of it.
- **Paginator replaces click-and-drag panning.** The table is paged (25 / 50 / 100 rows per page, default 50) with Prev / numbered / Next controls and a "Showing X–Y of N files" readout. Sorting, the filter chips, and search still work — they operate on the full matching set and the paginator shows the current slice. Diagnostic finding behind the change: the old click-and-drag pan handler occasionally swallowed a link click as the start of a drag, and a 16-column table forced horizontal panning to reach the Audit Score / Page References columns. A 6-column table fits without panning, so the drag handler — and the intermittent dead-click — are gone.
- **Column-resize and drag-to-pan handlers removed.** With a six-column table there is nothing to resize or pan; the `<colgroup>`, the per-`<th>` resize handles, and both pointer-drag handlers (~150 lines of client JS) are deleted. Native wheel / scrollbar / touch scrolling is unaffected.

### Added

- **Orphaned-files report — lifecycle explainer.** The `audit-orphaned-files.html` detail page now opens with a "Why orphan files exist (and why some rate is normal)" section: a five-row lifecycle table (stale Strapi revision, replaced agenda/attachment, deleted entry, manual version naming, genuinely-unlinked upload) with "what it looks like" + "disposition" columns, plus a confidence-tier action guide (≥85% safe-to-delete, 60–84% verify, 0–59% manual review). Gives a non-technical reader the context to read the orphan table without assuming every orphan is a mistake.

### Tests

675 passing — the `report-html` suite was updated for the trimmed 6-column table, the paginator markup, the File-name → public-URL link, and the consolidated-report Website column.

## [1.11.1] — 2026-05-19

### Changed

- **`normalizeStem` now strips consecutive trailing Strapi hashes**, not just one. Confirmed pattern on agency.icjia-api.cloud: re-uploading a file whose original name already ends in a Strapi hash produces a new file whose name ends in BOTH hashes (the old one becomes a stem-suffix, then Strapi appends a fresh hash). Example: `Traffic_Data_Agenda_NEW_07_24_24_df57bde328_5bb02ff5b1.pdf` → orphan revision of `Traffic_Data_Agenda_NEW_07_24_24_df57bde328.pdf`. Without multi-strip, the two would land in different fuzzy groups and the stale-revision detection misses. `stripped.priorHashes` exposes the inner hashes for forensic traceability.

## [1.11.0] — 2026-05-19

### Added

- **Orphaned-files report.** New `audit-orphaned-files.html` + `audit-orphaned-files.csv` sit alongside the existing master CSV in every fleet bundle. Lists every file with `references: []` after cross-reference resolution, fuzzy-matched against same-stem siblings to identify likely upgrade-replaced revisions vs. genuinely orphan content. Each row carries a 0-95% `replaceabilityConfidence` score (the likelihood the orphan is a stale older copy whose current version is still referenced).
- **Per-site orphan-rate breakdown** in the report — sortable table of every site's total resolved files, orphan count, orphan %, plus split between stale-revision and truly-unreferenced. Lets you spot which site is dragging the fleet-wide orphan rate (e.g. our intranet at 73% vs. 12% benchmark = extraction gap, not real orphans).
- **Fuzzy-match algorithm** in `src/report/orphans.js` — deterministic, no Levenshtein. Strips Strapi 10-char hex hash suffix (`_[a-f0-9]{10}` before extension), explicit version markers (`_vN`, `-vN`, ` (N)`, ` copy [N]`), then lowercase + collapse whitespace. Groups by `(normalized stem, extension)`. Confidence factors: base 70 → +20 for ≥30-day age gap vs. the referenced sibling → +5 for hash-only difference → −25 for same-batch (within 7 days). Capped at 95 (never claim certainty). Floored at 0 for newer-than-live anomalies or truly-orphan singletons.
- **Reason flags** per orphan: `strapi-hash-variant` (sibling is same name with different Strapi hash), `newer-than-live` (orphan is newer than the referenced sibling — anomaly worth investigating), `same-batch` (uploaded within 7 days of the referenced sibling), `older-than-1yr` (likely deprecated content).
- **Explainer block** at the top of the HTML report — five most-common reasons a file ends up orphan, plus how to use the report (sort by Confidence % desc; ≥85% is safe-to-delete; 0% needs human eyes).

### Tests

671 passing (+28 from new `report-orphans.test.js`).

## [1.10.2] — 2026-05-19

### Changed

- **`Referenced` column relabeled to `Page References`** in CSV + HTML. Same data; clearer manager-facing wording.
- **`Audit Score` + `Audit Report` columns merged into a single `Audit Score` column.** Matches the multi-line cell pattern of `Page References` — score chip + report link read as one signal, not two adjacent cells. HTML: grade chip, score in muted text, "Open report" anchor inline. CSV: grade and score on line 1, audit.icjia.app report URL on line 2 of the same multi-line cell.
- **Page-audit grade chips now carry an `axe-core` attribution** in tiny muted italic text after each chip. Hover tooltip explains: "Page accessibility graded by axe-core, run server-side via headless Chromium on audit.icjia.app". Distinguishes the page-grading methodology (axe-core) from the file-grading methodology (WCAG 2.1 AA + IITAA §E205.4 strict profile).

### Tests

643 passing (down 1 from 644 — the removed "seventh column is Audit Report" assertion, replaced with the merged-column expectations).

## [1.10.1] — 2026-05-19

### Changed

- `buildPageAuditChip` (in `src/report/html.js`) now renders the page-audit grade as a plain non-clickable `<span>` instead of an anchor to `audit.icjia.app/page-report/<id>`. The audit.icjia.app `/page-report/<id>` Nuxt viewer was scoped out of the 1.10.0 audit-tool release — the API persists the JSON but no Nuxt route serves it, so clicks landed on 404s. The chip itself is the whole intended signal next to each "Page N" anchor: the grade letter (A through F) answers the manager question "is that page accessible too?" inline. PDFs still get a separate clickable `Open report` link in the Audit Report column.
- The `reportUrl` field on `entry.references[].pageAudit` is still emitted by the audits step (no orchestrator change) so the data is available for any future viewer; it's just not exposed in the HTML chip.

## [1.10.0] — 2026-05-19

**Page accessibility scoring.** The third and final layer of the three-layer accessibility story manager-friendly audit reports tell — alongside the PDF audit (1.9.0) and the cross-site references (1.8.0):

- Layer 1 — **Is the file accessible?** (PDF audit, 1.9.0)
- Layer 2 — **Where on our site is it linked from?** (Cross-references, 1.8.0)
- Layer 3 — **Is that page itself accessible?** (this release)

### Added

- `filecap audits` now scores every URL in `entry.references[]` via audit.icjia.app's new **`POST /api/audit-url-page`** endpoint (headless Chromium + `@axe-core/puppeteer` + persisted as a shareable shared_reports row). Each reference object in the augmented inventory gets a `pageAudit = { score, grade, violationCount, bySeverity, reportUrl, reportId, reportExpiresAt, pageTitle, audited, checkedAt, cached }` field attached. ON by default; opt out with `--skip-pages`.

- **Page-grade chips in the HTML report.** Tiny parenthesised letter chip (`(B)`) rendered next to each `Page N` anchor in the Referenced column. Same colour register as the file-audit chips so the eye reads file accessibility + page accessibility as the same metric kind. Chip is itself a clickable anchor → audit.icjia.app/page-report/<id> for the per-violation deep-dive.

- **`src/audits/page-scorer.js`** — POST /api/audit-url-page wrapper, mirrors `score-fetcher.js`. Same error semantics (5xx + 504 → null for graceful skip; 4xx → throws).

- **Page cache at `~/.filecap/page-audit-cache.json`** — URL-keyed (pages don't have content hashes the way files do — same URL with rendered content vs SSR shell), separate file from the PDF cache. Default 14-day TTL (pages change more than file content). audit.icjia.app also dedups by `sha256(url)` server-side; the local cache lets us skip the HTTP round-trip entirely.

### Operator notes

- audit.icjia.app's `/api/audit-url-page` endpoint launches headless Chromium (~5–15 s per page render + axe analysis). On first deploy the audit.icjia.app server needs Chromium's runtime libraries installed:
  ```bash
  sudo apt install -y libatk1.0-0t64 libatk-bridge2.0-0t64 libcairo2 libcups2t64 libdbus-1-3 libdrm2 libexpat1 libfontconfig1 libgbm1 libglib2.0-0t64 libgtk-3-0t64 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libx11-6 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 libxkbcommon0 libatspi2.0-0t64 libasound2t64 fonts-liberation xdg-utils
  ```
- The audit-url-page endpoint reuses the existing `analyzeLimiter` rate-limit budget (default 35/hour; the fleet flow assumes the operator bumped this to 5000 already for the PDF pass). The `global` rate limiter (default 100/min per IP) also applies — if you see batches of `Unavailable` cells in the deployed bundle, bump it to 1000.
- audit-fleet-auto.sh's Stage 3.5 now runs page audits by default in addition to PDF audits. `SKIP_AUDITS=1` opts out of both. Use `--skip-pages` on a direct `filecap audits` call to score PDFs but skip pages.

### Verified

End-to-end on dvfr-strapi-prod: 62 PDFs audited (B/C/F grades), 32 unique pages audited (24 A, 8 B), every reference now carries both a file-audit grade and a page-audit grade. Sample meeting-minutes PDF row in the deployed report:
- File audit: **B (84)** — clickable to per-file violation list
- Referenced on: dvfr.illinois.gov/meetings/...may-21-2024/
- Page audit: **A (100)** 0 violations — clickable to per-issue page audit

### Tests

644 passing (same as 1.9.0; the 1.10.0 page-scorer + cache + orchestrator-extension test infrastructure was scaffolded in 1.9.0-alpha.1 with the preview flag off, and the orchestrator tests gate on `skipPages` so flipping the default doesn't break them).

[1.10.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.10.0

## [1.9.0] — 2026-05-19

**Stable.** Consolidates `1.9.0-alpha.1` + `1.9.0-alpha.2` into a single shipped release. PDF accessibility scoring is now live on the `latest` npm dist-tag so `audit-fleet-auto.sh` (which calls `@icjia/filecap@latest`) picks it up by default.

### Headline

For every PDF in a filecap fleet inventory: an **accessibility score (0–100, letter grade A–F) + a stable link to the per-file audit report** on audit.icjia.app. Two new columns on every CSV and HTML view:

- **`Audit Score`** at position 6 — coloured grade chip + numeric score
- **`Audit Report`** at position 7 — "Open report" anchor to audit.icjia.app/report/...

Non-PDF rows (docx, xlsx, pptx, image) render empty in these columns. Those formats have their own checkers inside their authoring tools.

### Pipeline

```
scan → references → cross-references → audits → web-rollup
                                       ^^^^^^ new
```

`filecap audits <inventory>` walks the augmented inventory, scores every PDF via `POST https://audit.icjia.app/api/audit-url`, writes `inventory.audited.ndjson` with `entry.audit = { score, grade, reportUrl, reportId, reportExpiresAt, audited, checkedAt, cached }` populated. `audit-fleet-auto.sh` runs it automatically as Stage 3.5 (between cross-references and web-rollup). `SKIP_AUDITS=1` opts out.

### Local cache

`~/.filecap/audit-cache.json` (mode 0600, atomic write, default 30-day TTL), keyed by SHA-256 of the PDF content. audit.icjia.app dedups server-side too, but cached responses still go through the rate-limiter middleware before the cache lookup — the local cache lets us skip the HTTP call entirely for recently-seen hashes. First full fleet pass is the only heavy one; subsequent refreshes hit cache for ~all unchanged PDFs.

### Bounded concurrency

Default 2 parallel requests — respects audit.icjia.app's `pdfAnalyzer` 2-at-a-time semaphore and the global 100-per-minute IP rate limit.

### Fleet-index accessibility band

New teal band on the deployed bundle's `index.html`, below the cross-site reference coverage band. Surfaces fleet-wide average grade + average score + count of audited PDFs + pending/error counts. Distinct from the amber audit-count hero and the blue references band so the eye reads each as its own metric.

### sites.json: `pathPrefix` field

Optional string per site entry. Set on the four ARI Summit 2017–2023 sites — old vue-cli (not Nuxt) builds where the repo's `static/` folder deploys to `/static/` on the URL (vue-cli preserves the directory segment; Nuxt collapses it). Strapi + Nuxt sites leave it unset. `filecap audits` reads sites.json, matches the inventory header's serverName against the site entry, and prepends `pathPrefix` to the URL it sends to audit.icjia.app. Master CSV's Public URL column also picks it up via the `consolidatedSources` plumbing.

### Auth-fetcher forward-compat

Sends `Authorization: Bearer <token>` when `credentials.audit-icjia-app.bearerToken` is set in `~/.filecap/secrets.json`. audit.icjia.app currently runs with `AUTH.REQUIRE_LOGIN=false` (anonymous), so no token is needed today; the code path is in place for when auth flips on.

### Operator notes

- audit.icjia.app's `RATE_LIMITS.analyze.max` defaults to **35 per hour** out-of-the-box. For a full fleet pass against ~2,200 PDFs, bump it to ~5000 in `audit.config.ts` once before the first run. Cache makes subsequent runs essentially free.
- Old Vue 2 git sites (ARI Summit 2017–2023) need `pathPrefix: "/static"` in sites.json for their PDFs to audit correctly; without it, the audit endpoint fetches the Netlify SPA catch-all HTML and returns 422. The four ari-summit entries in the ICJIA fleet bundle ship with this set.

### Preview behind a flag

A page-audit code path (target 1.10.0) is included in this release but **defaults to OFF** (`skipPages: true` on `runAudits`). When 1.10.0 ships, the default flips and `audit-fleet-auto.sh` will also score every URL in `entry.references[]` via audit.icjia.app's `/api/audit-url-page` (axe-core via Puppeteer) so each referenced page in the report carries an accessibility grade chip alongside the PDF score. The endpoint code is on the audit.icjia.app `feat/audit-url-page` PR; deployment + filecap-side wiring lands in 1.10.0.

### Tests

**644 passing** (up from 602 at 1.8.0; +42 across the score-fetcher, cache, orchestrator, page-scorer scaffolding, schema additions, and column-position assertions).

[1.9.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.9.0

## [1.9.0-alpha.2] — 2026-05-19

### Added

- **`pathPrefix` field on `sites.json` site entries** (optional string). Set on the four ARI Summit 2017–2023 sites, which are old Vue 2 (non-Nuxt) vue-cli builds where the repo's `static/` folder deploys to `/static/` on the URL — vue-cli preserves the directory segment, unlike Nuxt which collapses it. Strapi + Nuxt sites leave it unset.
- `filecap audits` reads `~/.filecap/sites.json`, matches the inventory header's serverName against the site's entry, and prepends `pathPrefix` to the URL it sends to audit.icjia.app. ARI Summit PDFs now audit correctly (previously got 422 because audit.icjia.app fetched the Netlify SPA catch-all HTML instead of the real PDF).
- Master CSV's Public URL column also picks up `pathPrefix` for consolidated rollups (via the existing `consolidatedSources` plumbing). Per-site report Public URL column behavior unchanged from 1.8.0 — that fix needs the inventory header to carry `pathPrefix`, which the scan step doesn't write today.

### Verified

- ari-summit-2018-git audits: 14 PDFs scored, 0 errors. Sample: `Bloomington State Rate Hotels.pdf` → **32 (F)**, stable report URL on audit.icjia.app.

### Tests

634 passing (same as alpha.1; this release only adds runtime config plumbing).

[1.9.0-alpha.2]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.9.0-alpha.2

## [1.9.0-alpha.1] — 2026-05-19

Phase 1.9.0 — PDF accessibility scoring via audit.icjia.app.

### Added

- **`filecap audits <inventory>` subcommand** — walks an inventory NDJSON, scores every PDF via `POST https://audit.icjia.app/api/audit-url`, writes an augmented `inventory.audited.ndjson` with `entry.audit = { score, grade, reportUrl, reportId, reportExpiresAt, audited, checkedAt, cached }` populated for each PDF. Non-PDF entries (docx, xlsx, pptx, image) pass through unchanged — they have their own remediation checkers inside Word / Excel / PowerPoint and aren't in scope for this scorer.

- **Local SHA-256-keyed cache** at `~/.filecap/audit-cache.json` (mode 0600, atomic write, default 30-day TTL). audit.icjia.app already dedups server-side by content hash, but cached responses still go through its rate-limiter middleware — the local cache lets us skip the HTTP call entirely for files whose hash we've seen recently. First full fleet pass is the only expensive one; subsequent refreshes hit cache for ~all unchanged files.

- **Bounded-concurrency request pool** (default 2 parallel requests) — respects audit.icjia.app's `pdfAnalyzer` 2-at-a-time semaphore and the global 100-per-minute IP rate limit.

- **Auth-fetcher forward-compat** — sends `Authorization: Bearer <token>` when `credentials.audit-icjia-app.bearerToken` is set in `~/.filecap/secrets.json`. audit.icjia.app currently runs with `AUTH.REQUIRE_LOGIN=false` (anonymous), so no token is needed today; the path is in place for when auth flips on.

- **`Audit Score` + `Audit Report` columns** in CSV + HTML, slotted at positions 6 + 7 (immediately after `Referenced`). HTML renders the score as a colour-coded grade chip (A green → F red) plus the numeric score in muted text; the report column is a "Open report" anchor opening the persisted audit.icjia.app report in a new tab. Errors render as a muted "Unavailable" chip. Non-PDF rows render empty cells.

- **Fleet-index accessibility band** on the deployed bundle's `index.html`. Sits below the cross-site reference coverage band, surfaces the fleet-wide average grade + score + count of audited PDFs + pending/error counts. Teal/green colour register distinguishes it from the amber audit-count hero and the blue references band.

- **`audit-fleet-auto.sh` stage 3.5** — the full-pipeline wrapper now runs `filecap audits` between cross-references and web-rollup. `SKIP_AUDITS=1` opts out.

- **Augmented-inventory chain in web-rollup** — loader now prefers `inventory.audited.ndjson` → `inventory.cross-ref.ndjson` → `inventory.ndjson` so partial-pipeline runs still produce a sensible bundle.

### Notes

- `audit.icjia.app`'s default `RATE_LIMITS.analyze.max` is **35 per hour**, well below what a first-time full fleet audit (~2,200 PDFs) needs. Bump it to ~5000/hour in `audit.config.ts` before the first big run; revert once the cache is warm if you want to tighten back down.
- Old Vue 2 non-Nuxt git sites (the ARI Summit 2017–2023 archive) deploy to Netlify with an SPA catch-all `_redirects` that returns HTML for unmatched URLs. audit.icjia.app's magic-bytes check correctly identifies this as not-a-PDF and returns 422 — the cell renders "Unavailable", which is the honest output. Strapi-hosted PDFs (the bulk of the fleet) audit cleanly.

### Tests

**634 passing** (up from 602 at 1.8.0; +32 across the score-fetcher, cache, orchestrator, and column-position assertions).

[1.9.0-alpha.1]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.9.0-alpha.1

## [1.8.0] — 2026-05-19

**Stable.** Consolidates the seven pre-releases (alpha.1 + beta.1–beta.6) into a single shipped release. No code changes vs `1.8.0-beta.6`; this entry is the stable summary. Pre-release notes below remain as the version-by-version history.

### Headline

A new **`Referenced` column** sits at CSV/HTML position 5 (immediately after `Public URL`) on every per-site report. For every PDF, Word doc, spreadsheet, or other audited file, the column lists the page URLs that link to it — the inflection point for the delete-vs-keep decision managers make on every audit. The column is populated by two new pipeline steps that slot between the existing `scan` and `web-rollup`:

```
scan (per server)            → per-server inventory NDJSON
↓
references <siteName>        → per-site references sidecar
                               (queries the site's CMS, extracts file URLs,
                                resolves deployed page URLs)
↓
cross-references <inventory> → augmented inventory with entry.references[]
                               populated (fleet-wide URL → referrers index,
                                with domain-alias resolution)
↓
web-rollup                   → Netlify bundle with the Referenced column live
```

### Capabilities

- **Strapi v3 adapter** — schema-driven content-type discovery via GraphQL introspection; field classification (URL string, body markdown, single UploadFile, list UploadFile, relation, other); REST pagination; irregular-plural detection via `*Connection` paginator; kebab-case REST path conversion for camelCase content types. Covers `icjia-agency-prod`, `spac-prod`, `researchhub-prod`, `ari-api-prod`, `ilfvcc-api-prod`, `intranet-api-prod`.
- **Strapi v4 adapter** — parallel module for the v4-shaped fleet (`dvfr-strapi-prod`, `r3-strapi-prod`, `i2i-strapi-prod`, `infonet-strapi-prod`). Handles the `/api/<plural>` REST path, `pagination[limit/start]` syntax, wrapping `{data: [{id, attributes: {…}}]}` envelope, and typed media wrappers `UploadFileEntityResponse` / `UploadFileRelationResponseCollection`. Includes a kebab-case fallback for sites where the per-content-type `pluralName` diverges from the GraphQL plural.
- **Git-repo adapter** — shallow-clones each `type:"git"` Nuxt static-site, walks `content/*.md`, extracts file URLs via regex, derives deployed page URLs from Nuxt Content routing convention (`content/<rest>.md → /<rest>`, `index.md → /`).
- **Bearer-token + auto-refresh login** — Strapi sites that gate content (the ICJIA intranet) can declare `credentials.<site>.bearerLogin = { url, identifier, password }` in `~/.filecap/secrets.json` (mode 0600). On a 401, the references command POSTs to `/auth/local`, captures the fresh JWT, persists it back to `credentials.<site>.bearerToken`, and retries. Falls back to a TTY paste-prompt when no `bearerLogin` is configured. Non-interactive runs fail loudly.
- **Cross-site reverse-index resolver** — reads every site's sidecar, builds a `Map<canonicalUrl, Array<{siteName, contentType, entryId, pageUrl}>>`, walks each scan inventory and attaches `entry.references[]` to every file via canonical-URL match. Domain-alias resolution collapses backend hosts onto canonical fronts (e.g. `archive.icjia-api.cloud` → `archive.icjia.cloud`) so cross-site references match correctly.
- **`Referenced` column in the report** — column 5 on CSV and HTML. Cell semantics: undefined → empty cell (cross-references not run); empty array → muted "No references found" chip; populated → anchor chips (HTML) or newline-joined URLs (CSV). Refs whose `pageUrl` couldn't be resolved render as a clearly-labeled `no page URL` non-link chip with a tooltip identifying the source (site / contentType / entryId).
- **Fleet-index coverage band** — new strip below the audit-count hero on `index.html` shows "X have known referrers (Y%) / Z have no known referrers — deletion candidates / N awaiting references run". The denominator excludes sites the references pipeline hasn't been run for, so the percentage isn't dragged down by sites we haven't extended to yet.
- **Vertical click-and-drag pan** — the table-pan handler now scrolls both axes simultaneously; touch panning was already native via `overflow:auto` + `touch-action:pan-x pan-y`.

### Coverage at ship

| Site | Entries | With cross-site references |
| --- | --- | --- |
| researchhub-prod | 428 | 358 (83%) |
| dvfr-strapi-prod | 107 | 65 (60%) |
| archive-prod | 1,889 | 941 (49%) |
| icjia-agency-prod | 3,170 | 1,416 (44%) |
| ilheals-git | 78 | 32 (41%) |
| intranet-api-prod | 708 | 193 (27%) |
| ari-api-prod | 555 | 152 (27%) |
| ilfvcc-api-prod | 420 | 112 (26%) |
| infonet-strapi-prod | 536 | 103 (19%) |
| spac-prod | 502 | 62 (12%) |
| i2i-strapi-prod | 393 | 50 (12%) |
| r3-strapi-prod | 338 | 20 (5%) |
| vpp-git | 54 | 0 (Vue templates, not yet walked) |
| sfs-git | 72 | 0 |
| ari-summit-2017/18/19/23-git | 158 | 0 |
| **Total** | **9,408** | **3,504 (37%)** |

### Security

Two red/blue team audits this release. Three findings, one Moderate + one Low + one Note. Both Moderate and Low fixed in-release:

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| FC-2026-030 | Moderate | `references.graphqlEndpoint` / `restApiBase` accepted any string (SSRF / MITM risk via crafted sites.json) | Fixed: Zod refinement rejects non-`http(s):` URLs at schema load |
| FC-2026-031 | Low | Pagination loops had no outer page-count cap (OOM risk on misbehaving sites) | Fixed: `maxPages` option, default 10,000 |
| FC-2026-032 | Note | Sidecar NDJSON files trusted under same-UID model | Accepted (documented) |

Full audit: [`docs/security/audit-2026-05-19.md`](docs/security/audit-2026-05-19.md).

### Tests

**602 passing** (up from 441 at v1.7.40). Coverage spans the six new `src/references/` modules (url-canonical, extract-urls, domain-filter, field-classifier, strapi-v3, strapi-v4, git-repo, cross-resolver, auth-fetcher), the extended `secrets.json` schema with credentials/bearerLogin, the new `Referenced` column in CSV+HTML, and the URL-scheme + maxPages security guards.

### sites.json schema additions

Three new optional fields per site entry:

```jsonc
{
  "name": "icjia-agency-prod",
  // ... existing fields ...
  "domainAliases": ["archive.icjia-api.cloud"],         // optional: extra fleet hosts
  "references": {                                       // optional: enables references step
    "strategy": "strapi-v3" | "strapi-v4" | "git-repo",
    "graphqlEndpoint": "https://api.example.com/graphql",  // strapi only
    "restApiBase":     "https://api.example.com",          // strapi only
    "siteFrontendUrl": "https://example.illinois.gov",
    "sitemapUrl":      "https://example.illinois.gov/sitemap.xml",
    "contentTypeRoutes": {
      "post":    "/news/:slug/",
      "grant":   "/grants/funding/:slug/",
      // ... per-content-type → deployed-route map
    }
  }
}
```

### Deferred to future releases

- Vue/HTML template walker for the 6 git Nuxt sites still at 0% coverage (their file references live in `.vue` templates, not `content/` markdown). Coverage gain likely modest since most file references on these sites point to external archives.
- PDF→PDF references (extract PDF body text via `pdfjs-dist`, regex over it, attach). Adds processing cost; uncommon enough that we deferred.
- `audit-fleet-auto.sh` integration so a single fleet refresh runs scan → references → cross-references → rollup → deploy in one command. Shipping alongside 1.8.0 stable as a small follow-up.

[1.8.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.8.0

## [1.8.0-beta.6] — 2026-05-19

Big batch — five user-requested items (A, B, C, D, E) shipped together:

### Added

- **Git-repo references adapter** (`src/references/git-repo.js`) for the 7 `type:"git"` Nuxt static sites: vpp, ilheals, sfs, ari-summits 2017–2023. Shallow-clones each repo, walks `content/*.md`, extracts file URLs via the same regex used by the Strapi adapters, derives the deployed page URL from Nuxt Content's default routing convention (`content/<rest>.md → /<rest>`, `index.md → /`). Strategy enum on `sites.json` references blocks now accepts `"git-repo"` alongside `"strapi-v3"` / `"strapi-v4"`; the orchestrator branches before the GraphQL dispatch. Tests cover the URL derivation rules (root, nested, `_hidden` directories, Windows-style backslashes) and the walker (markdown only, deduped URLs, missing-content dir tolerated). End-to-end fleet run: ilheals jumped from 0% to 41% coverage (32 of 78 files) via its content-markdown links to archive.icjia-api.cloud.

- **Bearer-token references with auto-refresh login** (`src/references/auth-fetcher.js` + extended `src/config/secrets.js`). Adds optional `credentials.<serverName>.bearerLogin = { url, identifier, password }` to `~/.filecap/secrets.json`. On a 401 the auth-fetcher POSTs identifier+password to the configured `/auth/local` endpoint, captures the fresh JWT from the response, persists it back to `credentials.<serverName>.bearerToken` (atomic write, mode 0600 enforced), and retries the failed request — no manual token-paste required. If `bearerLogin` isn't set and the operator is on a TTY, falls back to an interactive paste prompt. Non-interactive runs (CI) without credentials fail loudly with a clear "configure bearerLogin or re-run interactively" message. 403 is never retried (auth refusal, not expiry). Tests cover the full state matrix (8 cases). Tradeoff documented: storing the password forfeits JWT rotation; the file's mode-0600 + same-UID trust model already governs comparable secrets like `secrets.json`'s legacy `tokens` map.

- **Cross-site reference coverage band on the fleet index hero** (`src/web/index-page.js` + `src/commands/web-rollup.js`). New compact strip below the audit-count hero surfaces the manager-headline number: "X have known referrers (Y%) / Z have no known referrers — deletion candidates / N awaiting references run (git/intranet sites)". The denominator is `withRefs + withoutRefs` so the percentage isn't dragged down by sites whose references pipeline hasn't run; the explicit "awaiting" count tells the manager when that's happening. Blue accent register (distinct from the existing amber audit-count) so the eye reads it as supporting data, not as the primary metric.

### Changed

- **`contentTypeRoutes` fixes for 3 sites** (audited the other 8 Strapi sites' routes vs their sitemaps, same approach as icjia-agency-prod in beta.5):
  - `ilfvcc-api-prod`: corrected `council` route from `/ifvcc/councils/:slug/` → `/ifvcc/circuits/:slug/` (24 entries land on `/ifvcc/circuits/` per the sitemap).
  - `r3-strapi-prod`: added `resource` → `/resources/:slug` (4 entries).
  - `infonet-strapi-prod`: added `tab` → `/tabs/:slug` (6 entries).
  - 5 sites had no missing routes (spac, researchhub, ari, dvfr, i2i).
- **Intranet `references` block added to sites.json** with `requiresBearerToken: true` and `contentTypeRoutes` for the visible Vue SPA routes (post, biography, document, event, form, unit, page). The actual references run requires `credentials.intranet-api-prod.bearerLogin` in secrets.json — see the auto-refresh design above.

### Verified

- **"No references found" cases sampled and confirmed as legitimate orphans** (not extraction bugs). Concrete example: 4 PDFs in icjia-agency-prod with stem `ICJIA_Budget_Committee_Meeting_Agenda_040926_*` — only the `_da501c9b93` hash is attached to the meeting record; the other 3 are superseded versions left on the file server. Across icjia, 179 of 3,110 PDFs (5.7%) currently sit with no references — these are the audit's deletion candidates.
- Attachments capture verified for every Strapi content type that has an `attachments` field (grants 100%, publications 99.8%, meetings 99%, posts 91%, programs 92%; jobs 0% because they rarely populate attachments — matches user expectation).

### Tests

- **602 passing** (up from 579 at beta.5; +23 across the git-repo module, the auth-fetcher, the extended secrets schema, and the route-position assertions).

[1.8.0-beta.6]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.8.0-beta.6

## [1.8.0-beta.5] — 2026-05-19

### Changed

- **`Referenced` column moved to position 5 in the CSV/HTML report**, immediately after `Public URL`. Pre-beta.5 the column sat at position 15 (between `Duplicate of` and `Delete?`), forcing managers to scroll right to see "where is this file linked from?" — the question the column exists to answer. The two URLs that matter most for the delete-or-keep decision (the file's own URL and the list of pages that link to it) now sit side-by-side.

- **Unresolved-reference chips no longer pretend to be a `Page N` link.** When the cross-resolver finds a reference but the deployed page URL couldn't be computed (no `contentTypeRoutes` mapping for the entry's content type, missing slug, or unsafe scheme), the chip now reads `no page URL` (italic, non-link) with a `title` tooltip identifying the source (`Reference from <siteName> <contentType> #<entryId> — deployed page URL could not be resolved`). The red-styled `Page N` label that looked like a broken link is gone.

- **CSV cells for unresolved references render `(no page URL)` as a placeholder line** instead of silently dropping the reference. Previously a reference with `pageUrl: null` was filtered out of the cell, which made it impossible to distinguish "no references found" from "references exist but no page URLs." The cell's line count now matches the actual reference count.

### Routes added to `~/.filecap/sites.json` for `icjia-agency-prod`

Derived empirically from `icjia.illinois.gov/sitemap.xml`. Added or corrected five `contentTypeRoutes`:

| Content type | Route | Why it matters |
| --- | --- | --- |
| `meeting` | `/news/meetings/:slug/` | Meeting agendas + minutes carry legal hosting requirements; managers must see they're referenced before deleting |
| `program` | `/grants/programs/:slug/` | 60 of 65 programs have attachments |
| `job` | `/about/employment/:slug/` | (No job attachments in current fleet, but route enables future) |
| `unit` | `/about/units/:slug/` | Org-unit pages |
| `publication` | `/about/publications/:slug/` (corrected, was `/researchhub/articles/:slug/`) | 1,107 publications — the corrected route is the canonical /about/publications/ path, also mirrored at /researchhub/articles/ on the live site |

End-to-end re-run of the references step against `icjia-agency-prod` after the route additions resolved deployed page URLs for 2,127 of 2,198 sidecar records (97%). The 71 remaining unresolved records belong to admin content types (`tag`, `requiredForm`, `policy`, `rule`, `regulation`, `config`) that don't have user-facing pages.

The icjia per-site detail page in the bundle went from 884 red `Page N` chips down to 30 "no page URL" chips; working anchor count: 1,349.

### Verified attachments capture

The user-reinforced check: every Strapi content type with an `attachments` field is captured by the v3 extractor's `upload-file-list` path. Per-content-type tally on `icjia-agency-prod`:

| Content type | Entries | With attachments |
| --- | --- | --- |
| grant | 106 | 106 (100%) |
| publication | 1,107 | 1,105 (99.8%) |
| meeting | 285 | 281 (99%) |
| post (news) | 188 | 171 (91%) |
| program | 65 | 60 (92%) |
| job | 219 | 0 (rarely filled, per user expectation) |

[1.8.0-beta.5]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.8.0-beta.5

## [1.8.0-beta.4] — 2026-05-19

### Added

- **`web-rollup` now consumes the augmented inventory.** When `filecap cross-references` has been run for a site, it writes the augmented NDJSON to `<siteName>/latest/inventory.cross-ref.ndjson`. `web-rollup` previously read only `inventory.ndjson` (the raw scan output), so the populated `entry.references[]` was invisible in the bundle's CSV/HTML — managers saw an empty `Referenced` column. The loader now prefers the `.cross-ref.ndjson` companion when present and falls back to the raw inventory when absent.

### End-to-end fleet audit deployed

The full pipeline (`scan → references → cross-references → web-rollup --deploy`) ran against all 18 fleet sites and pushed the resulting bundle to https://icjia-fleet-audit.netlify.app:

| Site | Entries | With cross-site refs |
| --- | --- | --- |
| archive-prod | 1,849 | 909 (49%) |
| icjia-agency-prod | 3,110 | 1,379 (44%) |
| researchhub-prod | 315 | 250 (**79%**) |
| dvfr-strapi-prod | 102 | 61 (**60%**) |
| ari-api-prod | 553 | 150 (27%) |
| ilfvcc-api-prod | 420 | 112 (27%) |
| infonet-strapi-prod | 534 | 101 (19%) |
| spac-prod | 501 | 61 (12%) |
| i2i-strapi-prod | 393 | 50 (13%) |
| r3-strapi-prod | 337 | 19 (6%) |
| 7× git-type Nuxt sites | 362 | 0 (extractor TBD) |
| intranet-api-prod | 706 | 0 (bearer-token TBD) |
| **Total** | **9,484** | **3,092 (33%)** |

The Referenced column appears as column 15 of every per-site CSV (between `Duplicate of` and `Delete?`) and as anchor chips in the per-site HTML view. Of 9,398 master-CSV rows, 2,095 carry at least one referenced page URL.

[1.8.0-beta.4]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.8.0-beta.4

## [1.8.0-beta.3] — 2026-05-19

### Added

- **Vertical click-and-drag pan on report tables.** The pre-1.8.0 pan handler tracked only horizontal scroll (`scrollLeft`); mouse users with no scrollwheel access had no way to navigate the vertical content of a 75-vh-bounded file table. The handler now tracks both axes — `start.x` / `start.y` / `start.scrollLeft` / `start.scrollTop` — and pans both `wrap.scrollLeft` and `wrap.scrollTop` simultaneously. Threshold is `Math.hypot(dx, dy) ≥ 5px` so diagonal drags trip the gesture and a purely vertical drag pans the table down without first nudging horizontally. Touch panning was already handled natively via `overflow: auto` + `touch-action: pan-x pan-y` — unchanged. One new test pins the rendered-HTML assertion.

### Security

A fresh red/blue team pass against the 1.8.0 references code paths produced **three findings — one Moderate, one Low, one Note. Both Moderate / Low fixed in this release.** Full audit detail in [`docs/security/audit-2026-05-19.md`](docs/security/audit-2026-05-19.md).

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| FC-2026-030 | Moderate | `references.graphqlEndpoint` / `restApiBase` in sites.json accepted any string — no URL scheme validation. A malicious `sites.json` bundle could redirect `filecap references` at SSRF targets (loopback, link-local, cloud-metadata) or `http://` MITM-vulnerable endpoints. | **Fixed in 1.8.0-beta.3** — Zod refinement rejects non-`http:`/`https:` URLs (`file://`, `javascript:`, bare hosts, `ws://`, malformed strings) at schema load time. |
| FC-2026-031 | Low | `fetchAllEntries` paginators (v3 + v4) had no outer page-count cap. A misbehaving or hostile site that returned a full page indefinitely would loop until the operator's process OOM'd. | **Fixed in 1.8.0-beta.3** — both adapters accept `options.maxPages` (default 10,000 → 1M-entry ceiling at default `limit=100`); the loop throws if the cap is hit so the orchestrator logs a WARN and moves on. |
| FC-2026-032 | Note | Sidecar NDJSON inputs to `cross-references` trusted under the standard same-UID model — write access to the sidecar would let a local attacker inject false references. | Accepted (documented). Same threat model as `~/.filecap/secrets.json` and `sites.json`. |

Tests: **576 passing** (up from 565 at beta.2; +11 new across the URL-scheme validation, the maxPages cap, and the rendered-HTML vertical-pan assertion).

### Notes

- `siteEntrySchema` is now an exported binding from `src/commands/web-rollup.js` so the schema can be exercised in unit tests without round-tripping through a sites.json file.
- The audit doc replaces the previously-pointed-at-but-missing `docs/security/audit-2026-05-13.md` reference in the README; the 2026-05-13 per-finding detail now lives only in the README + CHANGELOG (one source of truth) and the new 2026-05-19 doc covers the 1.8.0 surface from scratch.

[1.8.0-beta.3]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.8.0-beta.3

## [1.8.0-beta.2] — 2026-05-19

### Added

- **Strapi v4 references adapter** (`src/references/strapi-v4.js`) extending the references pipeline to the four v4 sites in the fleet: dvfr-strapi-prod, r3-strapi-prod, i2i-strapi-prod, infonet-strapi-prod. Strapi v4 has a fundamentally different REST shape than v3 — `/api/<plural>` paths instead of `/<plural>`, `pagination[limit]=N&pagination[start]=N` query syntax instead of `_limit`/`_start`, and a wrapping `{data: [{id, attributes: {…}}]}` envelope around every entry, every relation, and every media item — so it required a parallel adapter rather than a tweak to the v3 module. With this release **9 of 9 (100%) of the Strapi sites in the audit fleet now contribute to the cross-site references index.**

- **Field classifier extended to recognize v4 typed-media envelopes.** Strapi v4 wraps single-media references in `UploadFileEntityResponse` (`{data: {id, attributes: {url}}}`) and list-media references in `UploadFileRelationResponseCollection` (`{data: [{id, attributes: {url}}, …]}`). The shared classifier maps both new GraphQL type names back to the existing `upload-file` / `upload-file-list` kinds, so the same field-classification logic serves both v3 and v4; the v4 extractor peels the `.data.attributes.url` wrapper at extraction time.

- **Kebab-case REST path fallback for Strapi v4** (`weeklyFaqs` → `/api/weekly-faqs` retry on 404). Strapi v4's REST `pluralName` is configured per content-type in `schema.json` and is not deterministically derivable from the GraphQL query name. Observed in the r3 fleet: `weeklyFaqs` 404s but `weekly-faqs` 200s, while sibling `v2Weeklyfaqs` works camelCase and 404s kebab. The v4 adapter now retries the very first request with the kebab-cased plural on 404 and pins whichever form works for subsequent paginated calls. 403 (Public-role permissions) is intentionally not retried — kebab won't change auth.

- **Per-site `references` blocks added to sites.json** for the four v4 sites (graphqlEndpoint, restApiBase, siteFrontendUrl, sitemapUrl, contentTypeRoutes). Routes derived empirically from each site's `sitemap.xml`:
  - **dvfr.illinois.gov**: 23 `/meetings/<slug>/`, 6 `/publications/<slug>/`, plus posts, pages, faq.
  - **r3.illinois.gov**: news, faqs, page routes flat-rooted (no trailing slash, matches deployed Nuxt).
  - **i2i.illinois.gov**: announcements, biographies, cohorts, graduations, spotlights, pages — all with trailing slashes.
  - **infonet.icjia.illinois.gov**: news, faqs, resources, pages.

### v4 fleet extraction this release

| Site | Content types | Records | With refs |
| --- | --- | --- | --- |
| dvfr-strapi-prod | 5 | 54 | 31 |
| r3-strapi-prod | 7 (1× 403 forms) | 21 | ~10 |
| i2i-strapi-prod | 7 (1× 403 forms) | 26 | ~12 |
| infonet-strapi-prod | 5 (1× 403 forms) | 173 | varies |
| **Total** | | **274** | |

The 403s on `forms` content types across r3/i2i/infonet are Public-role permission denials and don't affect user-visible references — `form` content rarely carries PDF attachments.

### Strategy dispatch in references command

`src/commands/references.js` now dispatches on `references.strategy` to either the v3 or v4 adapter via a small `STRATEGIES` map. Each adapter exposes the same four-function interface (`introspectContentTypes`, `introspectTypeFields`, `fetchAllEntries`, `extractEntryUrls`); `introspectTypeFields` is shared verbatim because the GraphQL `__type` introspection shape is identical between v3 and v4 (only the media envelope type names differ, and the classifier already understands both). Slug lookup is strategy-aware — v3 stores `entry.slug` flat, v4 nests it under `entry.attributes.slug`.

### Deferred to 1.8.0-beta.3 / stable

- **Bearer-token auth for intranet-api-prod** — the only remaining Strapi backend that needs auth to read content.
- **Git-repo extraction strategy** for the 7 `type:"git"` Nuxt static sites (vpp, ilheals, sfs, ari-summits 2017–2023).
- **README pipeline section** for the new `scan → references → cross-references → rollup` flow.

### Verification

- **564 tests passing** (up from 541 at beta.1; +23 new tests across v4 module, classifier extension, kebab fallback).
- All 4 v4 sites extract end-to-end with kebab-case REST path fallback for irregular pluralName configurations.

[1.8.0-beta.2]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.8.0-beta.2

## [1.8.0-beta.1] — 2026-05-19

### Added

- **Strapi-v3 references extraction extended to four more sites: spac-prod, researchhub-prod, ari-api-prod, ilfvcc-api-prod.** Combined with icjia-agency-prod (shipped in alpha.1) that's **5 of 9** Strapi sites in the audit fleet now contributing to the cross-site references index. The four added sites collectively emit ~1,300 sidecar records spanning publications, meetings, posts, biographies, councils, counties, events, programs, sections, articles, datasets, apps, and other content types.

- **Schema-driven plural detection** for content types with irregular English plurals (`county → counties`, `policy → policies`, `biography → biographies`). Previously the orchestrator naively appended `s` to the singular form, which 404'd on irregular plurals and silently dropped the content type. The new implementation derives each plural from the schema's `*Connection` paginator field (Strapi exposes `xs` + `xsConnection` for every content type, so the plural is always discoverable), then pairs it back to a singular by reversing common pluralization rules. This pickup recovered **102 county entries** on ilfvcc-api-prod and dozens of policies / biographies on icjia-agency-prod that prior versions silently dropped.

- **Kebab-case REST URL conversion** for camelCase content type names (e.g. `requiredForm` → `/required-forms`). Strapi v3's GraphQL keeps the field name camelCase but the REST endpoint kebab-cases it; without the conversion `requiredForms` 404'd. Fix recovered 21 RequiredForm entries on icjia-agency-prod.

- **Per-site `references` blocks added to sites.json** for spac-prod, researchhub-prod, ari-api-prod, ilfvcc-api-prod (graphqlEndpoint, restApiBase, siteFrontendUrl, sitemapUrl, contentTypeRoutes). Each site's `contentTypeRoutes` was derived empirically by sampling the site's own `sitemap.xml` and matching slug patterns to content-type counts:
  - **spac.illinois.gov**: 191 `/publications/<slug>`, 43 `/meetings/<slug>`, 29 `/news/<slug>`, 3 `/about/<slug>`
  - **icjia.illinois.gov/researchhub/**: 249 `/articles/<slug>`, 5 `/datasets/<slug>`, 5 `/apps/<slug>` (legacy Research Hub backend feeds the same `/researchhub/` paths icjia-agency-prod publishes to)
  - **icjia.illinois.gov/adultredeploy/**: 125 `/about/<slug>`, 69 `/news/<slug>`, 56 `/resources/<slug>`, 25 `/sites/<slug>` (ARI sub-path served by its own backend)
  - **icjia.illinois.gov/ifvcc/**: 101 `/news/<slug>`, 100 `/counties/<slug>`, 24 `/circuits/<slug>` (Family Violence Coordinating Council)

### Cross-site coverage from this release's fleet run

| Site | Entries augmented | With references | % |
| --- | --- | --- | --- |
| archive-prod | 1,849 | 909 | 49% |
| icjia-agency-prod | 3,110 | 1,379 | 44% |
| spac-prod | 501 | 61 | 12% |
| **researchhub-prod** | 315 | **250** | **79%** |
| ari-api-prod | 553 | 150 | 27% |
| ilfvcc-api-prod | 420 | 112 | 27% |
| **Total** | **6,748** | **2,861** | **42%** |

researchhub-prod's 79% reflects its role as a file storage backend for icjia.illinois.gov publications — nearly four out of five files there are linked from a content page elsewhere in the fleet. ari-api-prod and ilfvcc-api-prod's 27% rates suggest the audit is surfacing many orphaned PDFs in those backends that staff can review for deletion.

### Deferred to 1.8.0-beta.2 / beta.3

- **Strapi v4 adapter for dvfr, r3, i2i, infonet** — these backends are Strapi v4, which has a fundamentally different REST shape (`/api/<plural>` paths, `pagination[limit]` syntax, and a wrapping `{data: [{id, attributes: {…}}]}` envelope around every entry, every relation, and every media item). The existing `strapi-v3.js` will not work on them; a parallel `strapi-v4.js` module is required.
- **Bearer-token auth for intranet-api-prod** — extractor needs to inject `Authorization: Bearer <token>` reading from `~/.filecap/secrets.json` (the existing convention used by the scan step).
- **Git-repo extraction strategy** for the 7 type:"git" Nuxt static sites (vpp, ilheals, sfs, ari-summits 2017–2023). Same URL-regex approach over markdown files in the cloned `/content/` directory.

### Verification

- 541 tests passing (up from 539 at alpha.1). 2 new tests for irregular-plural detection.
- End-to-end fleet run verified — 6 inventories augmented with cross-site references, no errors mid-run other than the pre-existing 403s on Strapi auth-restricted content types (build/form/test entries that the Public role isn't permitted to read; these are intentional and don't carry user-visible references).

[1.8.0-beta.1]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.8.0-beta.1

## [1.8.0-alpha.1] — 2026-05-19

### Added

- **`Referenced` column on the per-file CSV and HTML reports.** Answers the single most frequent manager question — "Where is this PDF referenced on the site?" — without leaving the audit. Managers use the column as the inflection point for the delete-vs-keep decision: if a file has no known referrers, it can be removed; if it's linked from one or more live pages, the URL of each linking page surfaces directly in the cell. HTML view renders "Page 1, Page 2, …" anchor chips (URLs in hover-titles, opens in new tab). CSV view renders one full URL per line within a single multi-line cell so Excel/Google Sheets auto-hyperlink each row.
  - Cell semantics: `entry.references` undefined → empty cell (cross-references step not run); `[]` → muted "No references found" chip; populated → anchor chips. The empty-array state explicitly distinguishes "we looked and found none" from "we haven't looked yet."

- **`filecap references <siteName>` subcommand.** Per-site reference extractor. For Strapi v3 sites it introspects the GraphQL schema to discover every content type, classifies each type's fields automatically (URL-suffix strings, body-style markdown strings, and `UploadFile` typed media), then paginates through every published entry via REST and extracts the union of file URLs found in those fields. Writes an NDJSON sidecar with one record per content entry. Schema-driven, so new content types added to a Strapi site are picked up by introspection without code changes.

- **`filecap cross-references <inventory> --sidecar <path>` subcommand.** Fleet-wide reverse-index resolver. Reads every site's sidecar into one URL → referrers map and walks an inventory NDJSON to attach `entry.references[]` to each file via canonical-URL match. This is what makes the archive site's report useful: archive files don't know their own referrers, but pages on icjia.illinois.gov, dvfr.illinois.gov, etc. point at them, and the resolver back-links those pages onto the archive's rows.

- **Domain-alias resolution for the cross-site index.** Each site in sites.json can declare `domainAliases: ["backend.example.com"]` to cover alternate hosts that serve the same content as its `publicUrlBase`. The resolver collapses alias hosts onto the primary so a URL that appears as `archive.icjia-api.cloud/files/X.pdf` in CMS content matches the archive's inventory entry at `archive.icjia.cloud/files/X.pdf`. Without this, ~99% of archive-PDF references would silently fail to match because ICJIA's content overwhelmingly cites the backend host.

- **`references` block on sites.json site entries** (`strategy`, `graphqlEndpoint`, `restApiBase`, `siteFrontendUrl`, `sitemapUrl`, `contentTypeRoutes`). Configured for `icjia-agency-prod` in this release; the eight other Strapi sites in the fleet (dvfr, r3, i2i, ari, spac, infonet, intranet, ilfvcc, researchhub) are planned for v1.8.0-beta.

### Design notes & verification

- **Verified architecture, not speculative.** Before writing the extractor we probed `agency.icjia-api.cloud` against the live SPA at icjia.illinois.gov to confirm the approach. Two findings drove the design:
  - On a grant page (`2020-casa`), the rendered SPA's three file hrefs equalled exactly the three URLs extracted from the Strapi entry's `body` markdown via URL regex — perfect 1:1 match. Confirms body-field markdown extraction captures everything the rendered page links to.
  - On a publication page (`2025-ifvcc-strategic-plan-summary`), the rendered SPA had zero `<a href="…pdf">` anchors — the download is driven by a Vuetify `<button class="article-download">` whose target URL lives only in Vue component state and never reaches the DOM. The PDF URL was, however, present in the Strapi entry's `fileURL` field. Any rendered-page scraping approach would miss all 1,107 publications; the Strapi-API approach captures them. This was the deciding factor: Strapi data is strictly more complete than what the rendered SPA exposes.
- **Cross-site references are the rule, not the edge case.** Real-world numbers from this release's end-to-end run: 2,059 sidecar records emitted from icjia-agency-prod, joined against the archive inventory → **909 of 1,849 archive files** (49%) now show one or more referring pages on icjia.illinois.gov. Similar coverage on researchhub-prod (108 / 315, 34%) and icjia-agency-prod's own uploads (1,315 / 3,110, 42%).
- **Domain whitelist filtering.** Each extracted URL is dropped unless its host appears in the auto-derived fleet domain set (every `publicUrlBase` + `siteUrl` + `domainAliases` host across all sites in sites.json). Federal/state/partner-org and non-ICJIA links never make it into the Referenced column.
- **Pipeline placement.** New full pipeline is `scan → references (per site) → cross-references (fleet-wide) → web-rollup`. References and cross-references are re-runnable independently when CMS data changes or routing rules are updated; a GraphQL failure for one content type only loses that type, not the whole run.

### Module additions

New `src/references/` directory:

- `url-canonical.js` — host lowercasing, trailing-slash stripping, fragment dropping, idempotent canonicalization.
- `extract-urls.js` — URL regex extraction from markdown / HTML / plain text. Captures `.pdf`/`.docx`/`.xlsx`/`.pptx`/`.zip` URLs with optional query strings, stops at common terminators, dedupes.
- `field-classifier.js` — given a GraphQL `__type` field descriptor, returns `{kind: "url-string" | "body-string" | "upload-file" | "upload-file-list" | "relation" | "other"}`. Unwraps `NON_NULL` and `LIST` wrappers.
- `domain-filter.js` — `buildFleetDomainSet(sitesJson)` + `isFleetUrl(url, set)` for the whitelist filter.
- `strapi-v3.js` — Strapi v3 adapter: GraphQL introspection of content types and their fields, REST pagination, per-entry URL extraction via field-classifier dispatch.
- `cross-resolver.js` — `buildReverseIndex` + `entryCanonicalUrl` + `resolveEntryReferences` + `buildAliasMap`. Pure functions; the orchestrator command wires them up.

New commands:

- `src/commands/references.js` — per-site orchestrator. Loads site config, dispatches to strategy, writes NDJSON sidecar.
- `src/commands/cross-references.js` — fleet resolver orchestrator. Reads all sidecars + sites.json, builds the alias-aware reverse index, augments the inventory.

### Tests

- 82 new unit tests across the five new pure modules and the cross-resolver (url-canonical: 10, extract-urls: 12, domain-filter: 10, field-classifier: 19, strapi-v3: 13, cross-resolver: 16). Plus 8 new CSV-render tests + 5 new HTML-render tests + 5 new schema tests for the `entry.references[]` field. Total **539 tests passing** (up from 441 at v1.7.40).

### Scope and what's deferred

- **v1.8.0-alpha is icjia-agency-prod only.** The references block is configured for this single site so we can ship a working Referenced column for the most-critical site, prove the architecture end-to-end, and validate against real CMS content before extending.
- **v1.8.0-beta** will extend the Strapi-v3 strategy to the other nine Strapi sites and add a git-repo strategy for the seven `type: "git"` Nuxt static sites (vpp, ilheals, sfs, ari-summits).
- **v1.8.0** (stable) will add the index-page coverage stat ("X% of files have known references"), README docs for the new pipeline, and a Playwright-based verification harness for regression detection.

[1.8.0-alpha.1]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.8.0-alpha.1

## [1.7.40] — 2026-05-17

### Changed

- **Public URL column for git-type sites now points at the deployed public site instead of github.com.** Pre-v1.7.40 (since v1.7.20) every per-file Public URL on a Nuxt/git-hosted site (VPP, ILHEALS, ARI Summit 2017/2018/2019/2023, Safe From the Start) rendered as `https://github.com/<owner>/<repo>/blob/<branch>/<rel>`. That worked for ICJIA staff with repo access but was a dead link for anonymous public-website viewers and would break entirely if any of these repos became private. v1.7.40 changes the Public URL to `<publicUrlBase>/<rel>` — e.g. `https://sfs.icjia.illinois.gov/QuickStart_PartOne_NavIntakeBIF.pdf` instead of `https://github.com/ICJIA/icjia-sfs-2024/blob/main/public/QuickStart_PartOne_NavIntakeBIF.pdf`. The links now resolve for any viewer, regardless of repo access.
  - **Absolute Path column unchanged.** The CSV still carries the github.com source-tree URL in its dedicated `absolutePath` column for audit-trail and debug purposes, so technical reviewers can still jump to the file's source in the repo.
  - **Strapi and remote-server sites unaffected.** Their `absolutePath` is a `/home/forge/...` filesystem path (not `https://`), so the publicUrlBase + path shape has always been their Public URL and remains so. Verified end-to-end: DVFR Public URL still resolves through `https://dvfr.icjia-api.cloud/uploads/<file>`.
  - **No re-audit required.** The change is in the URL-building layer only; existing inventory NDJSON files already carry the right `publicUrlBase` in their headers and the right rel `path` per entry. A fresh `web-rollup` regenerates the bundle with the new URLs immediately.
  - **Trade-off considered.** Some Nuxt static-site deploys have an SPA `_redirects` catch-all that returns the homepage HTML at HTTP 200 for any path that doesn't match a deployed asset, so a missing file would silently land on the homepage rather than a 404. In practice the audited files always ship with the deploy (we read the same `public/` directory the build serves), so the catch-all rarely fires; when it does, a homepage landing is still a better failure mode for a non-repo viewer than a broken GitHub link.

[1.7.40]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.40

## [1.7.39] — 2026-05-17

### Added

- **Sort toolbar above the website grid on the fleet index page.** Three big, visible segmented buttons let viewers re-order the site cards without leaving the page:
  - **Alphabetical (default)** — A→Z by visible heading (`siteFullName`), matching the pre-1.7.39 default order.
  - **Most recently added** — sites in reverse `sites.json` declaration order, so the most recently added site (e.g. Safe From the Start, added 2026-05-17) appears first. Useful when scanning for the newest member of the fleet without hunting alphabetically.
  - **Most files first** — by total file count descending, so the biggest sites surface at the top. Useful when triaging remediation effort.
  - The chosen sort persists across reloads via `sessionStorage` (`filecap-site-sort`). Toolbar wraps on narrow viewports and stacks vertically on phones.
  - All reordering is client-side via inline JS that re-appends the existing `.site-card` DOM nodes in the new order — no network request, no full re-render. Each card carries `data-sort-az`, `data-sort-added`, and `data-sort-files` attributes so the reorder is purely attribute-driven.

[1.7.39]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.39

## [1.7.38] — 2026-05-13

### Changed

- **Timestamp format upgraded to 12-hour clock + DST-aware abbreviation + plain-English clarifier.** Pre-v1.7.38 every visible timestamp read like `2026-05-13 12:59 Chicago time` — accurate for Chicago readers but ambiguous for remediation vendors and auditors in Eastern or Mountain time who needed to compute the offset to their local time. The new format reads `2026-05-13 12:59 PM CDT (Chicago time)` and carries three signals on every stamp:
  - **12-hour clock with AM/PM** — most familiar to US readers.
  - **CDT or CST abbreviation** — automatic via `Intl.DateTimeFormat` `timeZoneName: "short"`, so daylight-saving transitions are handled without code changes.
  - **`(Chicago time)` plain-English clarifier** — non-technical readers don't need to decode CDT/CST.

  Applied everywhere the bundle prints a time: index-page footer `Generated …` stamp, per-site detail-page footer + meta-grid `Scanned at:`, cross-server duplicates `Newest → oldest` column. Date-only displays (`Last audit: May 13, 2026`) are unchanged — the calendar day is unambiguous and was already being evaluated in Chicago tz.
- Helper functions in `src/util/time.js` updated; the `Intl`-derived tz abbreviation lookup is centralised in a single private `chicagoTzAbbr(d)` helper so both display helpers stay in lock-step.

[1.7.38]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.38

## [1.7.37] — 2026-05-13

### Changed

- **All user-visible timestamps now display in Chicago time** (America/Chicago, DST-aware) with an explicit `Chicago time` trailing label. Pre-v1.7.37 the bundle stamped every visible time as UTC — accurate but a mental-arithmetic tax for ICJIA managers and remediation vendors in Central Time, all of whom think in Chicago hours. Three display sites updated across the bundle:
  - **Index page footer**: `Generated 2026-05-13 17:03 UTC` → `Generated 2026-05-13 12:03 Chicago time`.
  - **Per-site detail page footer + meta-grid `Scanned at:`**: same format treatment.
  - **Per-site sticky-bar `Last audit: <date>` chip** (and the matching caption beneath every CSV download button on the index): converts the underlying ISO timestamp through Chicago tz before extracting the calendar date, so the day matches what a Chicago reader would call "today" rather than a UTC day boundary.
  - **Cross-server duplicates "Newest → oldest" date column**: 24-hour display in Chicago time.
- Raw NDJSON wire format is unchanged — every header, footer, and entry timestamp remains ISO 8601 UTC on disk. The conversion happens at the rendering layer only.
- Implementation: new `src/util/time.js` module exports three helpers (`fmtChicagoDateTime`, `fmtChicagoDate`, `fmtChicagoGeneratedAt`) using `Intl.DateTimeFormat` with `timeZone: "America/Chicago"`. Both `src/web/index-page.js` and `src/report/html.js` consume the shared module so the timezone label is consistent across every page in the bundle.
- The bundle's per-site **filename slugs** (e.g. `r3-20260511-172410Z.html`) remain UTC-based so the same scan timestamp produces the same canonical filename regardless of who runs `web-rollup` or where; filenames aren't user-visible time displays.

[1.7.37]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.37

## [1.7.36] — 2026-05-13

### Security

Fixes five of the seven findings from the 2026-05-13 red/blue team re-audit ([full audit log in README](README.md#2026-05-13-redblue-team-re-audit-v1735)). Two findings remained "Open" after the audit because they're either deferred or already mitigated; this release closes the rest.

- **Finding #1 (Moderate) — CSV formula-injection through filenames.** `csvCell` in `src/report/format.js` now prefixes cells whose first character is in `{= + - @ \t \r}` with a single quote (`'`), the OWASP-recommended marker that spreadsheet apps treat as a text-mode prefix and strip on display. A filename like `=cmd|'/c calc'!A1.pdf` no longer evaluates as a formula when the audit CSV is opened in Excel / Sheets / Numbers. The deliberate `="<sha256-hash>"` text-formula cell is allow-listed via a strict whole-cell pattern match, so the hash column still renders correctly. Five new tests cover the attack vectors and the allow-listed pattern.
- **Finding #2 (Moderate) — `<a href>` URL-scheme validation.** New `safeUrl(url)` helper in `src/report/html.js` returns the URL only when its scheme is `http:` or `https:`. The publicUrl table cell and the meta-grid Public URL row both gate emission through `safeUrl()`; values with `javascript:`, `data:`, or other schemes now render as plain text (still visible, no longer clickable).
- **Finding #3 (Moderate) — `sites.json` `name` slug regex.** `siteEntrySchema.name` in `src/commands/web-rollup.js` now requires `/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i` (kebab-case slug, no leading/trailing hyphen). A malicious `name: "../../etc"` no longer passes validation, so the audits-directory path traversal is closed at the schema layer.
- **Finding #4 (Low) — `secrets.json` mode warning.** `loadSecrets()` in `src/config/secrets.js` now stats the file on load and emits a stderr warning when `(mode & 0o077) !== 0` (group- or world-readable). Doesn't refuse to load — workstations are usually single-user — but tells the operator to `chmod 600`.
- **Finding #6 (Low) — `autoDeploy` UX guard.** `runNetlifyDeploy()` in `src/commands/web-rollup.js` now prints a loud banner before invoking `netlify deploy --prod` (so operators see when `webRollup.autoDeploy: true` is about to push to production) and honours `FILECAP_NO_DEPLOY=1` as an opt-out for local builds / tests / quick regenerations.

Deferred (per audit recommendations):

- Finding #5 (Low) — Internal server paths in the bundle. Already mitigated by the Netlify Pro Site Password gate; redaction would be defense-in-depth only.
- Finding #7 (Informational) — Bundle artefact signing. TLS to Netlify covers the transit-layer threat; signing's operational cost (key management, vendor education) isn't justified for the current distribution model.

[1.7.36]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.36

## [1.7.35] — 2026-05-13

### Changed

- **Access-instructions copy now points readers at Chris Schweda directly** instead of a generic "Contact IDS at ICJIA" line. Chris is the sole authorizer for both SSH and GitHub access at ICJIA, so routing requests through him directly (rather than a team alias) is materially faster — a remediation vendor reading this audit shouldn't have to bounce through a queue when there's exactly one person who can grant the credential. Three places updated for consistency:
  - **Index-page modal CTA**: `<strong>Need access? Email <a href="mailto:christopher.schweda@illinois.gov">christopher.schweda@illinois.gov</a></strong> — Chris Schweda is the sole authorizer for SSH and GitHub access at ICJIA, so emailing him directly is the fastest path. He'll help with credentials, walkthroughs, and any question about getting these files in bulk.`
  - **Index-page modal step 1** (all three site types): the "ask ICJIA's IDS team" phrasing replaced with "Email Chris Schweda at ICJIA" + a note that Chris can also walk you through generating an SSH key if you don't have one.
  - **Per-site detail-page access panel**: the trailing `action` line now reads "Email Chris Schweda at <mailto:christopher.schweda@illinois.gov> — he's the sole authorizer for SSH and GitHub access at ICJIA, so emailing him directly is the fastest path." Renderer updated to emit the mailto link as raw HTML (the constant is hardcoded, no XSS surface).
- Tests updated to assert on `christopher.schweda@illinois.gov` rather than the old `"Contact IDS at ICJIA"` literal.

[1.7.35]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.35

## [1.7.34] — 2026-05-13

### Changed

- **"For bulk file access" chip is now a clickable button that opens a full instructions modal**, replacing the unreachable `title=` tooltip. Pre-v1.7.34 the chip used a native HTML tooltip, but the whole-card stretched-link's `pointer-events: none` cascade on every card descendant suppressed the chip's hover events, so the tooltip never fired in practice. v1.7.34 makes the chip a real `<button>` with `pointer-events: auto`, click-opens a native `<dialog>` carrying:
  - **Two plain-English paragraphs** explaining where the files live (Strapi-managed remote Linux host / ICJIA-owned GitHub repo / regular Linux server) and how someone copies them off in bulk (rsync over SSH, GitHub clone, or rsync over SSH respectively);
  - **A 3-step numbered list** of the actual workflow: who to contact, what tool to run, how the corrected files get back to the host;
  - **A direct contact line** — `Email cja.ids@illinois.gov for help with credentials, walkthroughs, or any question about getting these files in bulk.`

  Three dialogs total (one per access type) rendered once at the page footer; each chip targets the matching dialog by `data-access-modal` attr. Per-type accent color (cyan for Strapi, violet for GitHub, amber for Server) on the dialog's left border + the CTA block, so the modal visually echoes the chip the user clicked. Native `<dialog>` + `showModal()` handles focus trap + Escape-to-close; click on the backdrop closes the dialog too. Why this matters: "How do I access these files?" is the single most common question a manager has when looking at this audit, and it deserves a first-class answer that isn't gated behind a hover tooltip nobody can trigger.

- **Chip styled as a real button** (cursor: pointer, hover-brightness + subtle 1 px lift on hover, focus-visible outline) so it's discoverable as interactive instead of looking like a decorative label.

[1.7.34]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.34

## [1.7.33] — 2026-05-13

### Changed

- **Access-method chip labels collapsed to plain English across every site type.** Pre-v1.7.33, each per-site card carried a chip reading one of `Strapi CMS / SSH required`, `GitHub repo / access required`, or `Server / SSH required` — implementation jargon that leaked irrelevant detail to the non-technical audience the fleet index is written for. v1.7.33 replaces all three with the same plain-English phrase: **`For bulk file access`**. The per-site visual differentiation (cyan / violet / amber dot + border) is preserved via the CSS class on the chip (`access-strapi` / `access-github` / `access-server`), so the at-a-glance type-color signal still works for anyone who needs it. The per-site detail page's access panel uses the same new headline but **keeps the underlying specifics in the body copy** (Strapi rsync vs GitHub clone vs server rsync, SSH-key vs ICJIA-GitHub-org credential, "Contact IDS at ICJIA to request access") because a remediator who actually visits the panel does need that detail to ask for the right credential.
- **Chip tooltip updated** from `"<label> — see detail page for access steps"` to `"For bulk file access — open this site's report for the specific credentials and steps"`. Removes the double-use of `access` and reads cleanly as a single instruction.

[1.7.33]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.33

## [1.7.32] — 2026-05-13

### Security / privacy

- **`audit-fleet.ndjson` no longer carries `introspection.author` or `introspection.lastModifiedBy`.** The bundle's "Zero Personally Identifying Information (PII) in this audit" banner promises *"No names, addresses, phone numbers, or email addresses of individuals"* and *"not in any of the downloadable files."* That last clause wasn't strictly true: PDF and DOCX files commonly stamp the original author (and DOCX additionally stamps the last person who modified the document) into their metadata, filecap's introspection step extracted those into the inventory NDJSON, and `audit-fleet.ndjson` — published in the bundle for AI-context use — carried 983 such names across the fleet (e.g. "Stacey Smith" on an annual report, "Johnson, Crystal D." on meeting minutes). The names were already on the source documents, but aggregating them into a single queryable file across 9,000+ documents materially changed the exposure surface. New `stripPiiFromEntry(entry)` helper in `src/commands/web-rollup.js` drops both fields from every entry before the NDJSON is written; all other introspection (page count, image-only flag, heading coverage, OCR signals, file size, hash) is preserved because that's what makes the AI-context file useful. Verified: 9,096 entries in this bundle, **0 with author, 0 with lastModifiedBy**.

[1.7.32]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.32

## [1.7.31] — 2026-05-13

### Added

- **Case-insensitive + extension-less URL aliases for every per-site report.** Netlify is case-sensitive when serving static files, so `/r3-20260511-172410z` (lowercase `z`) didn't resolve to the canonical `/r3-20260511-172410Z.html` — a manager typing or pasting a URL with mangled casing hit a Netlify error page. `filecap web-rollup` now generates a `_redirects` file at the bundle root with three alias rules per per-site report:
  - `/<base-lowercase-z>` → `/<base>.html` (301)
  - `/<base-lowercase-z>.html` → `/<base>.html` (301)
  - `/<base>` → `/<base>.html` (301; ensures extension-less variants resolve even when the Netlify Pro password gate interacts oddly with Pretty URLs)

  17 sites → ~51 rules, all auto-emitted by the new exported `generateNetlifyRedirects(siteResults)` helper in `src/web/netlify-config.js`. Netlify reads `_redirects` from the publish root at deploy time, so no extra Netlify-dashboard configuration is needed.

[1.7.31]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.31

## [1.7.30] — 2026-05-13

### Added

- **New "Coming soon" section at the bottom of the fleet index** — a violet-accented section banner (mirroring the existing fleet/duplicates banner anatomy: eyebrow + clamped headline + lede + accent bar) surfacing in-development reference-discovery work to managers without making them dig through the repo. Lists four items currently being built on a side branch:
  - The **Referenced** + **Status** columns answering "where is this file linked from on the live site?" and "Active or Orphan?";
  - **Cross-site reference detection** that surfaces files inventoried on one ICJIA site but linked from another (e.g. archive PDFs cited on icjia.illinois.gov);
  - **SPA-page rendering** via a headless browser engine for sites where the curl-style crawler sees only an empty `<div id="app">` shell (i2i / spac / agency);
  - **Sitemap-validated reference URLs** so clicking a reference always lands on a real published page (no 404s from auto-constructed routes that the live frontend doesn't actually recognise).

  Each item is a `<li class="todo-item">` with a violet left-border, a short `<h3>` headline, and a one-paragraph explanation in plain manager-friendly English. Links out to the CHANGELOG so curious managers can track progress between releases. Visual register: violet (`#d2a8ff` → `#8957e5`) — a third color identity beyond the existing blue (fleet snapshot) and amber (duplicates) so the eye instantly registers the section as "upcoming, not current."

[1.7.30]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.30

## [1.7.29] — 2026-05-13

### Changed

- **Audit-tool button label** `ICJIA's PDF Audit Tool` → **`ICJIA PDF Audit Tool`**. Dropped the possessive `'s` to match the syntax of the adjacent **`ICJIA Accessibility FAQs`** button — both buttons now read as `ICJIA <thing>` for visual consistency.

- **Detail-page CSV download button is now green** instead of the same blue as the audit-tool buttons sitting next to it. Pre-v1.7.29 the sticky bar had three blue rectangles in a row (FAQ + PDF Audit + CSV download), and the CSV button — the one that's the *actionable* artefact for staff — blended in. New green gradient `#2ea043 → #238636` with a darker green border and a subtle hover lift. Color register: download / get / "take this artefact away" — distinct from the blue navbar register that says "navigate to an external tool." Focus outline updated to green `#3fb950` to match.

[1.7.29]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.29

## [1.7.28] — 2026-05-13

### Changed

- **CSV `Delete?` column defaults to empty instead of `"No"`.** CSV is plain text — it can't carry a Yes/No dropdown (data validation is an Excel/Sheets feature, not a CSV feature). Asking staff to set up validation manually adds friction. Empty default lets staff type whatever feels natural — `X`, `YES`, `Y`, `delete`, ✔ — and the (future) delete-processor will treat any non-empty, non-"no" value as "flag this file for removal." More permissive, less prescriptive. Master-CSV section blurb on the index updated: "Put `X`, `YES`, or anything non-blank in the Delete? cell for any file you want removed." Tests + LLM context.md updated.

- **Navbar button label** `Try ICJIA's PDF audit tool` → **`ICJIA's PDF Audit Tool`**. Dropped the verb (button labels generally read as the noun they point at) and Title-Cased "Audit Tool" so the brand reads cleanly.

- **New navbar button: `ICJIA Accessibility FAQs`** linking to `https://accessibility.icjia.app`. Sits to the left of the PDF Audit Tool button on every page (index navbar + per-site detail page sticky bar + per-file-type detail pages) so a manager or auditor reading the audit can pop over to the agency's accessibility FAQ in one click. Same visual treatment as the audit-tool button (filled-blue button with external-link / question-mark icon, `rel="noopener noreferrer"`, opens in a new tab).

- **Navbar fonts reduced for less crowding.** Index navbar brand: `1 rem → 0.88 rem`. Both navbar action buttons (FAQ + PDF Audit): `0.9 rem → 0.8 rem`, padding `0.5 rem 0.95 rem → 0.4 rem 0.8 rem`, border-radius `8 px → 7 px`, gap `0.5 rem → 0.45 rem`. Detail-page sticky bar back-link + CSV-link + audit-tool button all dropped to `0.8 rem` too so the whole bar reads as one consistent register. Net effect: visibly more horizontal whitespace in the navbar, two buttons + brand sit comfortably without crowding the page edge.

- **Top-section banner lede uses a dynamic site count.** Was `A complete scan of every file on every ICJIA-managed website`; now `A complete scan of every file on ICJIA's <N> sites` where `<N>` is the actual count of sites in the audit (currently 17). Managers can see at a glance exactly how big the fleet is without scrolling to the per-site cards.

[1.7.28]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.28

## [1.7.27] — 2026-05-13

### Fixed

- **Detail-page sticky bar buttons now top-align cleanly + render at identical heights.** Pre-v1.7.27 the right-side cluster (`.report-back-bar-right`) used `align-items: center` to center its children — but its two children were the `.audit-tool-link` button (single line, ~37 px tall) and the `.report-csv-block` column-wrapper (the CSV-link button + "Last audit: …" caption stacked, ~55 px tall total). Centering both meant the CSV-link button sat ~9 px higher than the audit-tool button, with the date caption hanging below. Switched the right-cluster to `align-items: flex-start` so both buttons line up on their top edges; the date caption still hangs below the CSV button without pushing it around. Also unified the two buttons' styling (`font-size: 0.88 rem`, `padding: 0.4 rem 0.9 rem`, `border-radius: 8 px`, `font-weight: 700`, `white-space: nowrap`) so they render at identical heights regardless of which one wraps text first.

### Changed

- **Sticky-bar fonts nudged down a hair.** Back link `0.95 rem → 0.88 rem`, CSV-link button `0.95 rem → 0.88 rem`, audit-tool button `0.9 rem → 0.88 rem`. All three now match at `0.88 rem`. Subtle change — keeps the bar from feeling shouty against the dense detail-page content below.

[1.7.27]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.27

## [1.7.26] — 2026-05-13

### Documentation

- **README Status table caught up to v1.7.25.** Added rows for v1.7.17 (duplicates info-only), v1.7.18 (N-times / Big O explainer), v1.7.19 (table filter + OMA-intentional callout), v1.7.20 (GitHub URLs for git-type sites + dynamic remediable hero counts), v1.7.21 ("For AI models" section), v1.7.22 (Cross-Server Duplicates section banner), v1.7.23 (top section banner + Zero PII banner), v1.7.24 (condensed explainer + "Try" button label), v1.7.25 (PII banner relocated, spelled out, and tightened). No code changes — this is a documentation-only release so the next npm registry view of the package shows the current Status table, and any reader landing on the GitHub repo's README sees an accurate version history.

[1.7.26]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.26

## [1.7.25] — 2026-05-13

### Changed

- **PII banner relocated** from the top of the page (right under the section banner, between it and the audit-numbers hero) to immediately above the "Websites in this audit" site grid. The audit numbers + donut are the most important above-the-fold content, so they get the top position; the privacy reassurance sits right where a viewer naturally starts asking "wait, what's actually IN these audits?" — at the threshold of seeing the per-site cards.
- **PII headline spelled out** from `Zero PII in this audit` to **`Zero Personally Identifying Information (PII) in this audit`**. The acronym was misreading as "PILL" at a glance, and non-technical staff who haven't seen the term wouldn't have known what it meant. The lede + footer now also spell out "personally identifying information" alongside their continued use of the shorter form.
- **Banner vertically tightened** by ~30%. Same content (eyebrow + title + lede + IN / NOT-IN columns + Intranet footnote) but every padding and margin pulled in, smaller icon column (42 px down from 56 px, 36 px icon down from 48 px), tighter list line-height + item gaps, slightly smaller h3s and lede font. Banner now measures ~360 px tall vs ~500 px before, with no information lost.

[1.7.25]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.25

## [1.7.24] — 2026-05-13

### Changed

- **Duplicates explainer compressed from five colored callouts into one cohesive block.** Pre-v1.7.24 the "Why are we showing you this?" area had five visually-distinct elements stacked vertically: the historical-context paragraph, a blue-bordered `dup-not-error` callout, a green-bordered `dup-intentional` (OMA / parallel-publishing) callout, the two-card exact/variant comparison, and an amber-bordered `dup-caveat` false-positives note. Every callout had its own background tint + colored left border, so the eye landed on the rainbow of boxes rather than the content. v1.7.24 consolidates into one unified container with the same single dark `#161b22` background as the rest of the section: three tight paragraphs (history → "not an error" + "intentional" merged → "use as cross-check"), the exact/variant kind-cards (still get their accent borders because they're the actually-useful visual comparison), and the false-positives caveat **collapsed into a `<details>` element** with a chevron-marked summary so the technical edge-case is still there but doesn't dominate the layout. Same information; less visual noise. Inline `<strong>` + `<em>` carry the emphasis where colored borders used to.

- **Navbar audit-tool button label updated** from `Use ICJIA's PDF audit tool` to `Try ICJIA's PDF audit tool`. "Try" is softer (suggestion to test the tool) vs "Use" (instruction to operate it). The link target, accessibility attributes, and visual styling are unchanged.

[1.7.24]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.24

## [1.7.23] — 2026-05-13

### Added

- **Top "Section · Fleet snapshot" banner** that mirrors the v1.7.22 "Cross-Server Duplicates" banner at the bottom of the page — same visual grammar (small uppercase eyebrow, large clamped headline, lede paragraph, accent bar) but with a **blue** gradient `#4dabf7 → #1f6feb` instead of amber so the two sections read as distinct major chapters at a glance. The page now opens with "ICJIA Accessibility Fleet Audit" as a 50 px h1, with a one-sentence framing lede and a small "Generated DATE · N websites" meta line. The pre-v1.7.23 `<h1>ICJIA accessibility fleet audit</h1>` inside the hero is removed (the new banner takes the h1 role); the existing fleet hero, site cards, by-file-type tables, master CSV section, and "For AI models" section all stay underneath as the section's content.

- **Prominent "Zero PII in this audit" reassurance banner** below the top section banner. ICJIA staff or partners landing on the deployed audit may worry "what's actually in this thing?" — particularly given the agency's law-enforcement and criminal-justice mandate. The new banner addresses that head-on: a 6 px green left border + 48 px shield-with-checkmark icon + bold "Zero PII in this audit" headline + a one-sentence lede stating "publicly-hosted documents, no personally identifiable information." Below the lede, two side-by-side scannable lists in tinted boxes — **What this audit does contain** (green left border): filenames, folder paths, file metadata, format-specific structure, the same public documents on the live sites — and **What this audit does not contain** (red left border): no SSNs / DOB / driver's licenses, no names / addresses / phone numbers, no case-file content, no personnel records, no credentials. Closes with a green-tinted footnote that the Intranet site contains ICJIA-internal materials (worksheets, bus schedules) but still **contains zero PII**. Stacks to a single column under 720 px viewport so the IN/NOT-IN lists stay readable on phones.

[1.7.23]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.23

## [1.7.22] — 2026-05-13

### Changed

- **Big "Cross-Server Duplicates" section banner** above the existing duplicates hero. The page has accumulated a lot of stacked content over v1.7.x (master CSV, by-file-type, For AI models, etc.), and managers were missing where the duplicates block started. New banner: 4.5 rem top margin with a thin divider line, a 72 × 5 px amber-gradient accent bar (echoes the section's existing notice-yellow color register), a `Section · Duplicates` eyebrow in amber, a 50 px-clamped "Cross-Server Duplicates" h2 in white, and a lede paragraph explaining what the section covers ("Files that appear on more than one ICJIA site — why that's almost always normal, when it's intentional, and why removing any single copy needs careful per-site reference checks before anything is deleted."). The pre-v1.7.22 small "CROSS-SERVER FILE MAP" eyebrow is removed since the new banner makes it redundant; the existing "131 files appear on more than one site" headline demoted from h2 to h3 (since the banner now carries the section's h2). Stacks gracefully under 720 px with reduced spacing.

[1.7.22]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.22

## [1.7.21] — 2026-05-13

### Added

- **"For AI models" section on the index page** with two new read-only companion files: `audit-fleet.ndjson` (consolidated, line-delimited JSON inventory with full per-file introspection — PDF page count, image-only flag, text-layer coverage, DOCX heading coverage, alt-text coverage, XLSX sheet count, etc.; everything the CSV strips for human readability) and `audit-fleet-context.md` (~7.5 kB narrative with summary stats, per-site breakdown, NDJSON schema doc, and sample LLM prompts). Both files sit next to the master CSV in the bundle, gated by the same Netlify Site Password. Intended use: someone running an AI tool (Claude, ChatGPT, Gemini, Copilot) uploads both files and asks questions about the fleet in plain English ("which PDFs across the fleet are image-only AND larger than 5 MB?"). Audience is non-technical and state-agency-policy on AI tool use is still evolving — the section is framed as **explicitly optional + forward-looking**: a manager who doesn't use AI tools can ignore it entirely. The page copy makes it explicit that the CSVs remain the actionable artefact (Delete? + Notes columns are still where deletion decisions get marked); these two files are read-only context for query-and-learn, not for editing. The companion `audit-fleet-context.md` carries the same disclaimer in its first section so an LLM ingesting it tells the user to use the CSV if they ask "should I edit this file?". Section markup includes a "How to use these (if you want to)" `<details>` block with the four steps a non-technical user needs (confirm with office, open AI tool, upload context.md first then NDJSON, ask in plain English) and an amber-tinted reminder that the CSV is still the actionable file. Implementation: new `buildFleetContextMarkdown()` helper in `src/commands/web-rollup.js` generates the markdown from the in-memory `allEntries` + `siteResults` + `duplicateGroups` data the rollup already collects (no new scan, no new fetch); `renderLlmContextSection()` in `src/web/index-page.js` slots the section between the master CSV section and the duplicates section. Whole feature adds ~6 MB to the bundle and is feature-flagged-off-by-omission — when `allEntries` is empty (no scans), neither file is generated and the section silently disappears from the index.

[1.7.21]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.21

## [1.7.20] — 2026-05-13

### Fixed

- **Git-type (static-site) entries now link to their GitHub source URL instead of the deployed Netlify URL.** The Netlify deploys of ARI Summit 2017 and 2018 (and possibly other static-site sites) have a `_redirects` SPA catch-all rule (`/*  /index.html  200`) that intercepts every file path that doesn't match a deployed asset and returns the homepage HTML at HTTP 200 — so the publicUrlBase + path URLs filecap was generating looked like working links but actually pointed at the site homepage instead of the file. The 2019 and 2023 sites happened to work because their build output exposed `/static/` at the URL root, but the 2017 and 2018 builds don't. Fix: `buildPublicUrl()` (in `src/report/csv.js`, `src/report/html.js`, and the duplicates path in `src/commands/web-rollup.js`) now checks whether `entry.absolutePath` starts with `https?://` — if so, it returns that (with `/tree/` rewritten to `/blob/` so GitHub serves the canonical file-view page). The audit-static.sh scan already stamps every git-type entry with a `https://github.com/<repo>/tree/<branch>/<path>` absolutePath, so this is a one-line distinction at URL-build time with no other plumbing changes. Strapi-type entries have absolutePath = a filesystem path (`/uploads/foo.pdf`), so the `https://` heuristic naturally distinguishes them. The private-repo case: GitHub returns the file page for authenticated ICJIA users (who view the audit via the password-gated Netlify site, so they're already authenticated); anonymous users get 404 from GitHub, but anonymous users don't have access to the audit either, so the access pattern lines up.

### Changed

- **Duplicates hero numbers now correspond to the active filter and default to remediable-only.** Pre-v1.7.20 the hero showed the full duplicate count (e.g. 430 files) including images / text / markdown / archives — which managers reading the page interpreted as "the audit team has 430 files to deal with." That number is correct but misleading: only the remediable-side subset (PDFs, Word, Excel, PowerPoint, legacy Office) actually affects accessibility audit scope. New default: hero shows the remediable count (131 in the current ICJIA fleet, with the 123 exact / 8 variant breakdown). A small amber-tinted "Counting only files that may need accessibility remediation" note sits directly under the headline explaining what the number includes and what it excludes. When the user clicks a different filter chip below the explainer, the hero numbers + tile labels + counting-note swap to match — three states (Remediable only / Reference only / All) with distinct counting-notes that explain what's being counted and why. Implementation: per-bucket stats embedded as a JSON dataset on the `.dup-hero` element + small extension to the v1.7.19 chip-click IIFE that swaps the `[data-dup-stat]` text content and the `.dup-counting-note` innerHTML on filter change.

[1.7.20]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.20

## [1.7.19] — 2026-05-13

### Added

- **Duplicates table is now filterable by Remediable / Reference / All, defaulting to "Remediable only."** Three pill chips above the table; click toggles visibility of rows tagged with `data-dup-side`. Default state matches where the manager/auditor attention belongs — remediable (PDF, DOCX, XLSX, PPTX, legacy Office) — and shows live row counts in each chip ("Remediable only 131", "Reference only 299", "All 430") so the user sees the proportions at a glance. Filter is pure CSS toggle via `[data-dup-active-filter]` on the wrapper element + a small IIFE for click handling.
- **"Some duplicates are intentional and required" callout in the duplicates explainer.** New green-tinted paragraph (parallel to the existing blue `dup-not-error` callout) covering the specific case where the same document is published on both a specialty site and the main ICJIA site for findability and Open Meetings Act compliance — e.g. a DVFR board agenda lives on dvfr.illinois.gov *and* on icjia.illinois.gov, because someone going to the DVFR site to look up "when is the next DVFR meeting?" shouldn't have to know to also visit the main agency site. Same logic applies to other site-owner requests where a document needs to live on multiple sites for findability. The callout sits between "a duplicate is not an error" and the exact/variant kind cards so a manager reading top-to-bottom sees the three framings (not an error → sometimes intentional → here's the table) in order before they hit the data.

[1.7.19]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.19

## [1.7.18] — 2026-05-13

### Changed

- **Plain-English explainer added beneath the "N-times the search surface" reason** in the v1.7.17 duplicates-info-only callout. Pre-v1.7.18 a manager landing on the page might bounce off the jargon ("N-times the search surface… what does that even mean?"). The new explainer unpacks both `N` and `Big O notation` in language a non-technical reader can use: `N` is "however many copies of this file exist"; `O(N)` is engineering shorthand for "the work scales linearly — 3 copies = 3× the reference-checking work, 5 copies = 5× the work." Contrasted with `O(1)` (constant work, doesn't apply here) so the manager has a concrete reference point. The explainer closes with an actionable budget ("5–15 minutes per copy for reference review") so the manager can translate the abstract growth-rate into a meeting-agenda commitment. Visually distinct (slightly lighter grey block with a left rule + monospaced `O(N)` / `O(1)` chips) so it reads as an aside rather than competing with the three numbered reasons it explains.

[1.7.18]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.18

## [1.7.17] — 2026-05-13

### Changed

- **Cross-server duplicates section on the index is now information-only — the CSV download button was removed.** Pre-v1.7.17 the section ended with a "Download `audit-file-duplicates.csv`" call-to-action. That implied "here's a worksheet, go act on this list," which isn't the right framing: duplicate removal is meaningfully trickier than removing a unique file, and surfacing the CSV as a primary affordance encouraged staff to start deleting without per-site reference checks. The on-page table stays — managers should still SEE that duplicates exist; they just shouldn't be invited to action them via spreadsheet. The CSV file itself is **still generated** server-side and accessible via direct URL if the audit lead needs it for offline analysis; v1.7.17 only pulled the in-page button.
- **New "For information only" callout above the duplicates table** explaining why duplicate removal is uniquely tricky, with the three concrete reasons in a numbered, visually distinct block:
  1. **N-times the search surface.** A unique file might be linked from one site's HTML. A file present on three servers might be linked from three sites' HTML — staff has to check all three before touching any copy.
  2. **"Wrong copy" risk.** SHA-256 equality only tells you the bytes match. It doesn't tell you which copy is the canonical one. If Site A links to it and Site B doesn't, the obvious move is "delete from B" — but if B was the original and A's link is the stale one, you just removed the wrong copy.
  3. **Asymmetric references.** Two copies can be linked from completely different contexts (one from a meeting-agendas page, the other from an annual-reports archive). Deleting either causes a 404 somewhere; neither is obviously safer than the other without looking.
  The callout closes with the reminder that site editors in their own CMS only see references on their own site, so they can't independently judge "safe to delete on my site." Treat the section as awareness, not action. Amber left-border + amber-tinted inner block keeps the visual register at "warning" without screaming.

[1.7.17]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.17

## [1.7.16] — 2026-05-13

### Added

- **Two staff-fill columns appended to every CSV the bundle emits — `Delete?` and `Notes`.** Per-site CSVs (`dvfr-…csv`), the master CSV (`audit-file-list-master.csv`), and every by-file-type CSV (`audit-pdfs.csv`, `audit-docx.csv`, …) now ship 16 columns instead of 14. `Delete?` defaults to `No` on every row; staff types `Yes` to flag a file for removal before the next audit. `Notes` is empty by default; free-text for whatever context the staff member wants to leave on a row. The intended workflow: download CSV → mark `Yes`-Delete on rows that should be removed + add notes → send the CSV back to the audit lead → lead deletes the flagged files on each source server, reads notes, and re-runs the audit. Implementation: new descriptor field `csvOnly: true` on the two columns in `CSV_COLUMNS`; the HTML view derives `HTML_COLUMNS = CSV_COLUMNS.filter(c => !c.csvOnly)` so the web table stays at 14 columns (still 14 `<col>` + 14 `<th>` + 14 `<td>` per row). CSV is plain text — the "dropdown" feel for `Delete?` needs Excel/Google-Sheets data validation set by the staff member (the column defaults to `No` so an unedited CSV behaves sensibly either way). 4 new tests pin the schema additions, the default values, the 16-column CSV header row, and the absence of the columns from the HTML view.
- **"Use ICJIA's PDF audit tool" button in every navbar — links to https://audit.icjia.app, opens in a new tab.** Visually prominent (filled blue button with external-link icon), sits in the right zone of the index-page `.site-header` and in the right side of every per-site detail page's `.report-back-bar`. Single-button label on mobile (icon only at < 600 px viewport so it doesn't crowd the back-link). Same affordance on the per-file-type detail pages too — every page in the bundle now has a one-click path to the PDF accessibility checker. Restores the audit.icjia.app integration that was removed in v1.1.0 (now wired as a visible link rather than embedded checks). 5 new tests cover the index navbar variant + the detail-page sticky-bar variant + the rel="noopener noreferrer" attribute + the "Use ICJIA's PDF audit tool" label + the inline SVG icon.
- **"Last audit: <date>" caption beneath every CSV download button** so staff can tell whether their downloaded copy is current vs the deployed version. Date format is `<Month> <Day>, <Year>` (e.g., `May 13, 2026`) — date-only because what matters is which day the scan ran, not the minute. Per-card CSV download caption pulls the per-site `scannedAt`; master-CSV section caption uses `consolidatedAt` (the moment the rollup was built); per-site detail page sticky bar pulls the per-site `scannedAt` again; per-file-type detail page sticky bar uses `consolidatedAt` (across-the-fleet view). Implementation: new exported helper `fmtAuditDate(iso)` in `index-page.js`; the consolidated branch of `writeHtml` resolves `meta.consolidatedAt`, the non-consolidated branch resolves `meta.scannedAt`. Master-CSV meta gains a new `lastAuditAt` field set at rollup time.

### Changed

- **README pass top-to-bottom — every claim now reflects the current version.** Stale spots that had accumulated since v1.4.x: "30-column CSV" was claimed in three places (now correctly 16; the 30-column reference dated to before the v1.4.x trim); test count was "408 tests" (now 434); the CSV column-order block listed Public URL at position 8 (v1.7.2 moved it to position 4); the Vendor TL;DR listed format-specific introspection columns (PDF page count, has-text-layer, DOCX heading coverage, XLSX sheet count, etc.) as CSV columns when they've been NDJSON-only since v1.4.0/1.4.1; the Status section + table only went through v1.7.8 (now extended through v1.7.16); the "Publishing a fleet snapshot → What's in the bundle" file tree only showed 2 sites + index + assets and was missing the master CSV, duplicates CSV, and all 9 per-file-type CSV+HTML pairs added in v1.5.0 / v1.5.1 / v1.7.14; the Manager TL;DR's "New in 1.7.x" block grew into a multi-version run-on paragraph through 1.7.8 (now rewritten as a single concise "current shape of the fleet rollup" paragraph). Manager-facing "needs/needing remediation" instances softened to "may need …" matching the v1.7.8 sweep that hit the live output but not the README copy.

[1.7.16]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.16

## [1.7.15] — 2026-05-12

### Added

- **ICJIA wordmark logo in the index-page navbar.** Inline SVG (~13 kB) from the agency's standard asset set (https://github.com/ICJIA/archived-website-page/blob/main/assets/icjia-logo.svg), sed-themed so every `rgb(100%, 100%, 100%)` fill becomes `currentColor` — the logo recolors via `.site-header .icjia-logo { color: … }`, so dark navbar → `#ffffff`, print mode → `#000000` without forking the markup. New `.site-header-left` flex container groups the 38 px-tall logo + the "filecap fleet audit snapshot" brand text with a thin vertical divider between them. Stacks the logo down to 32 px under 600 px viewport. Accessible name "Illinois Criminal Justice Information Authority" is set via `role="img"` + `aria-label` on the SVG; the wrapping `<span>` is `aria-hidden` so screen readers only see the label once.

### Changed

- **Index-page cards now sorted alphabetically by site title (siteFullName).** Pre-v1.7.15 cards rendered in sites.json declaration order — which matched how the audit team thought about the fleet but not how an outside viewer scans the page. Sort happens at render time in `generateIndexHtml` (`siteResults.sort((a, b) => aKey.localeCompare(bKey, undefined, { sensitivity: "base" }))`), falling back to `siteName` then `name` if `siteFullName` is missing. `sensitivity: "base"` handles mixed case + diacritics naturally on a real keyboard. New test pins the order against a fixture that declares sites in B-first / C-first order to prove the renderer is doing the work.
- **ARI Summit 2023 full name updated** in `~/.filecap/sites.json` from `Adult Redeploy All Sites Summit 2023` → `ARI All Sites Summit 2023` per user request. (The 2017/2018/2019 summits still spell out "Adult Redeploy" — flagged for follow-up if the renaming should propagate.)

[1.7.15]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.15

## [1.7.14] — 2026-05-12

### Added

- **Per-file-type detail pages with CSV downloads — click "PDFs" on the index and get every PDF across the fleet in one infographic-style page.** Every non-empty bucket in the index's "By file type" table now has two artefacts emitted next to the master CSV: `audit-<slug>.csv` (filtered master, same 14 columns, every row tagged with its source server) and `audit-<slug>.html` (per-site-style detail page — same dp-hero pattern with two-up tiles + donut + plain-English caption + sortable file table + row-marker legend + click-and-drag resizable columns + sticky back-link / CSV-download bar). The slug for each bucket is stable and readable: `audit-pdfs.csv`, `audit-docx.csv`, `audit-xlsx.csv`, `audit-pptx.csv`, `audit-office-legacy.csv`, `audit-images.csv`, `audit-text-files.csv`, `audit-archives.csv`, `audit-audio-video.csv`, `audit-web-files.csv`, `audit-other.csv` (and matching `.html` for each). Empty buckets are skipped — no zero-row CSV/HTML pairs on disk. On the index page, the by-type row's **label** now opens the detail page and the **count column** downloads just the CSV; both styled subtly (hover-only blue, dotted underline on the count) so the table still scans as a table. Implementation: new exported `TYPE_BUCKETS` constant in `src/commands/web-rollup.js` is the single source of truth (used by both the CSV writer and the index renderer). Each bucket has `keys` (so the legacy-office and legacy-office synonyms merge into one bucket), `side` ("remediable" / "reference"), `label`, and `slug`. The per-bucket HTML reuses `writeHtml` with a consolidated header — the `dp-hero` shows "Across the fleet" as the eyebrow and the bucket label as the H1, with the donut showing 100 % audit for remediable buckets and 0 % for reference. 5 new tests cover CSV emission, master/per-type schema parity, dp-hero structure, index linking, and the empty-bucket skip path. Total now 30 test files / 422 tests.

[1.7.14]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.14

## [1.7.13] — 2026-05-12

### Changed

- **Index-page hero redesigned around the audit count, not the total.** Pre-v1.7.13 the hero led with `<span class="fleet-total-headline">14,914</span>` in 96 px blue type, with `total files scanned across N websites` underneath. Managers were misreading that headline as *"the audit team has 14,914 files to remediate"* — but 14,914 is the *inventory* number; only ~74 % of those flagged for accessibility review, and the actual scope of work is the 11,097 remediable subset. The new hero is a two-column infographic — left column has the audit count in 105 px amber (`#ffa84d`, matching the per-card audit tile) with a small "Files that may need accessibility audit" eyebrow above it and `out of 9,096 files scanned across 17 ICJIA websites` as a secondary context line. Right column is a 200 × 200 px donut (same conic-gradient pattern as the per-site cards, just larger) with `54 %` + `may need audit` in the center and a phrase-bucket caption beneath (`About half may need audit` / `Two-thirds may need audit` / etc.) reusing the same caption logic as the cards so fleet view and per-site view share visual language. Stacks to a single column under 720 px. The split bar and equation row (`14,914 = 11,097 need audit + 3,817 don't`) are dropped — the new headline + donut convey the same information without the math-class framing that read as cold. 6 new tests pin the new markup (audit count as the headline, donut with `--pct` style, phrase caption, total in secondary line, no surviving pre-v1.7.13 classes, aria-label on the role=img hero). Print-mode CSS overrides updated to match the new class names.

[1.7.13]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.13

## [1.7.12] — 2026-05-12

### Fixed

- **Image-only PDF row tint now actually visible on the per-site detail page's file table — and applies across every cell, not just the first.** Hidden CSS-specificity bug present since the original v1.0.2 row-marker code: `tbody tr:nth-child(even/odd) { background: ... }` (selector specificity 0,1,2) outranked `tr.image-only { background: #111000 }` (0,1,1), so the row-level tint never won. Only `tr.image-only td:first-child` (also 0,1,2, plus later in source order) rendered — leaving a barely-perceptible marker on the leftmost column and nothing on the rest of the row. The result was that the "faint yellow row tint" legend entry described a marker that was essentially invisible against the dark `#0d1117` page background. Fixed by retargeting at `tbody tr.image-only td` (0,1,3, beats the striping) and bumping the color from a luminance-twin-of-page-bg `#111000` to a clearly-amber `#3a2c08` (with `#4d3a0c` on the first-cell marker stripe). Legend swatch (`.row-marker-imageonly`) updated to match the new color so the legend accurately mirrors what the row looks like. Text contrast on the new background remains ≥ 8 : 1 against the `#e5e5e5` foreground — comfortably above WCAG AA.

[1.7.12]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.12

## [1.7.11] — 2026-05-12

### Changed

- **Per-site detail page's row-marker legend redesigned as a proper 3-column table.** Pre-v1.7.11 the legend was two flex-row paragraphs (swatch + run-on text), and on a wide viewport the long descriptions broke awkwardly mid-clause — "...it" + "contains spaces, non-ASCII characters, exceeds 200 chars," + "or matches a default scanner output pattern like" + "Scan_20240115_001.pdf" + ". Often correlates..." on five visually-distinct lines that the eye had to reassemble. The new layout is a `<table class="row-marker-table">` with three columns — **Marker** (~26% width, holds the swatch + name), **What it means** (~37%, the definition), **What to do about it** (~37%, the remediator guidance) — with `<thead>` column labels and `border-bottom` row dividers so each marker reads as one self-contained row. The marker name (`Yellow vertical bar on the left edge of a row` / `Faint yellow row tint`) gets `white-space: nowrap` to stay on one line in the Marker column. A `@media (max-width: 700px)` rule collapses the table to a stacked layout so the cells don't squeeze each other on narrow viewports. Required overriding the global `table { table-layout: fixed; width: max-content }` (used by the file-inventory table for click-and-drag column resize) with `table-layout: auto; width: 100%` plus an explicit `<colgroup>` for the % widths. 3 new tests pin the table structure (3 header cells, 2 body rows with swatches, no surviving `.row-marker-row` paragraphs).

[1.7.11]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.11

## [1.7.10] — 2026-05-12

### Changed

- **Index-card donut grown from 130 × 130 px to 180 × 180 px (and the inner-hole inset from 14 to 22 px) so "MAY NEED AUDIT" comfortably fits inside the inner hole.** v1.7.9's `text-align: center` fix put the .pct flex item perfectly at the donut's geometric center (verified at exactly 0 px offset), but the small caption — at 113 px wide after v1.7.8's softening — was effectively the same width as the 102 px inner-hole diameter, so the text's edges touched the colored ring at the y-positions where the circular chord is narrower than the diameter. Result: even though the text was centered, it visually read as "off" because the caption was crowding the orange/blue ring at the corners. The new 180 × 180 donut yields a 136 px inner hole; "may need audit" sits ~10 px clear of the ring on each side and ~75 px clear around the percentage. Percentage glyph upsized in lock-step from 1.5 em to 1.7 em (matching the per-site detail page's `.dp-pct`). No other layout change on the card; the donut-row's caption column shrinks ~50 px to absorb the bump, which still leaves plenty of room for "Two-thirds may need audit · 69 of 102 files" on a single line at any sane viewport.

[1.7.10]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.10

## [1.7.9] — 2026-05-12

### Fixed

- **Donut percentage now stays centred inside the donut hole on every index-page card.** Side-effect of v1.7.8's softening of "need audit" → "may need audit": the longer caption widened the inner `.pct` box, but `.site-card .donut .pct` was a left-aligned column (no `text-align: center` rule). With "need audit" the percentage glyphs and the caption text happened to be near-equal width, so centering looked correct by coincidence; "may need audit" is two letters longer and broke the illusion (the percentage stuck to the left edge of a wider `.pct` box). Added `text-align: center` so both the percentage and the small caption properly centre inside the donut hole regardless of caption length. The sibling `.dp-hero .dp-donut .dp-pct` on the per-site detail page already had this rule from the start, which is why the detail-page donut was unaffected.

[1.7.9]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.9

## [1.7.8] — 2026-05-12

### Added

- **Expanded "Technical details" disclosure on every index-page card, with copy-to-clipboard buttons on every row.** The pre-v1.7.8 collapsed section showed only `hostname` and `ip` as two terse `<p>` lines. It now shows a five-row mini-grid mirroring the per-site detail page's meta-grid — **Website**, **IP**, **Hostname**, **Path**, **URL** — with a copy button on each so a remediator can grab any of these strings straight from the fleet index without first opening the detail page. The URL row keeps a clickable `<a target="_blank">` alongside the copy button so both intents (visit, paste) work in one place. Click feedback: the button widens, swaps the clipboard icon for a green "Copied" tag for 1.4 s, then snaps back. Implementation uses the same `navigator.clipboard.writeText` + `execCommand("copy")` fallback pair as v1.7.7's detail-page buttons; a small `COPY_ICON_SVG` + `copyableValue(...)` helper duplicate of the detail-page code lives in `src/web/index-page.js` so the two pages stay decoupled (a change to one doesn't risk regressing the other). pointer-events: auto is added for `.tech-details .meta-copy` and `.tech-details .meta-value a` so the copy buttons and URL link remain interactive even though the card-wide stretched-link covers them. The clipboard handler `stopPropagation`'s and `preventDefault`'s the click so the stretched-link never fires mid-copy. 6 new tests cover the five label/value rows, the data-copy raw values, the URL link's coexistence with the copy button, and the omit-when-empty fallback path.

### Changed

- **Gentler language throughout the rollup outputs: "needs/need remediation" → "may need remediation"; "need audit" → "may need audit".** The pre-v1.7.8 phrasing read as prescriptive ("Two-thirds need audit", "files need remediation", "Files needing remediation") — telling managers and remediators what *has* to happen. The new phrasing is accurate but soft: filecap surfaces files that *may* warrant a closer accessibility review, and the actual remediation decision is up to the audit team and the content owner. Touches every user-visible surface where the old wording appeared: the index-page card phrase buckets (`No files may need audit`, `A small share may need audit`, ..., `Nearly all may need audit`), the audit tile label, the donut caption, the "by-file-type" column headings (`Files that may need remediation` / `Files that may not need remediation`), the duplicates explainer ("Each variant **may need** its own remediation pass"), the per-site detail page's dp-hero (same phrase buckets), the stat-card label (`files may need remediation`), the row-color legend (`May need OCR before...`), the `audit-summary.txt` text deliverable (the `AUDIT SCOPE` label, the per-category captions, the per-server breakdown line, the totals row, the bullet point on image-only PDFs, the PDF detail line), and the `README.txt` template's "files that may need remediation" intro plus the renamed "What 'May need remediation' means" glossary entry. Phrasing in code comments was left alone — comments aren't manager-facing.

[1.7.8]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.8

## [1.7.7] — 2026-05-12

### Fixed

- **Whole-card click now works on every index-page card.** The v1.7.1 stretched-link pattern set the link at `z-index: 0` and the other card children at `z-index: 1`, which meant clicks on the visible content (full-name heading, total/audit tiles, donut percentage text, file-type chips, access chip) hit the children — none of which had a click handler — and the user saw nothing happen. Only the small padding gaps between children actually navigated to the detail page. Bumping the link's z-index introduces fresh landmines (it would cover the action buttons, which would need ever-higher escape hatches, and the donut's internal `.pct { position: relative; z-index: 1 }` would still escape on top of the link). Cleaner solution: pin `pointer-events: none` on every non-`.card-stretched-link` descendant of `.site-card` (parent + universal-descendant in one rule) so the click falls through to the stretched-link, then explicitly re-enable `pointer-events: auto` on the two action buttons (`.actions .btn`) and the disclosure summary (`.tech-details summary`) so those stay separately clickable. Two new tests pin the CSS rules so the regression can't slip in again.

### Added

- **Copy-to-clipboard buttons on the per-site detail-page meta-grid.** Designed for remediators who need to paste these values into a terminal or browser without text-selecting monospace strings by hand. Each of the five copy-worthy meta-grid rows — **IP**, **Hostname**, **Scanned path**, **Scanned at**, **Public URL** — gets a 24 × 22 px button on the right edge with a clipboard-outline SVG icon. The two short-identifier rows (**Website**, **Server**) intentionally don't get buttons per user spec. Click feedback: the button widens, swaps the icon for the word "Copied" in green for 1.4 s, then snaps back. Uses `navigator.clipboard.writeText` first, with a hidden-textarea + `document.execCommand("copy")` fallback for `file://` loads and very old browsers. Single delegated `document.addEventListener("click", …)` covers every button so the report can have as many copy targets as we add later without per-button wiring. New `copyableMetaCell(value, displayHtml, label)` helper in `src/report/html.js` keeps the markup terse; the wrapped Public URL row still renders its `<a target="_blank">` for one-click visit *and* shows the copy button on the same line. 5 new tests assert presence/absence of buttons on the right rows, the `data-copy` attribute carries the raw value, and the clipboard handler IIFE is embedded in the inline `<script>`.

[1.7.7]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.7

## [1.7.6] — 2026-05-12

### Added

- **Access-method chip on every index card + matching "How to access this site's files" panel on every per-site detail page.** Designed for non-technical managers and outside remediators who land on the rollup and don't yet know what kind of system each ICJIA site is, or what credentials they'd need to actually open a flagged file. Each site is auto-classified into one of three buckets from its existing `sites.json` config (no schema change required) — `strapi` (`publicUrlBase` ends in `/uploads`, ~10 ICJIA sites), `github` (`type: "git"`, 6 sites), or `server` (fallback for SSH-reachable static directories, e.g. the Archive's `/root/files`). The index card shows the chip in the card-head eyebrow position above the nickname, color-coded by category (cyan = Strapi, violet = GitHub, amber = bare server) with WCAG AA 4.5 : 1+ contrast on the card's dark background. The per-site detail page repeats the classification as a more prominent callout immediately below the dp-hero: eyebrow ("How to access this site's files"), heading ("Strapi CMS / SSH required" / "GitHub repo / access required" / "Server / SSH required"), a method paragraph ("Files are served by a Strapi CMS instance on a remote Linux host…" / "Files live in an ICJIA-owned GitHub repository…" / "Files are stored in a static directory on a remote Linux host…"), and a credential line ending with the SSH-key / GitHub-org-access requirement plus **"Contact IDS at ICJIA to request access."** Implementation lives in a new exported helper `deriveAccessKind(site)` in `src/commands/web-rollup.js` plus two parallel copy maps (`ACCESS_CHIP_LABEL` in `src/web/index-page.js` and `ACCESS_PANEL_COPY` in `src/report/html.js`) so a manager going index → detail sees consistent wording. 20 new tests (8 for `deriveAccessKind`, 5 chip variants in `renderCard`, 5 panel variants in `writeHtml`, 2 end-to-end plumbing tests through `runWebRollup`) — total now 30 test files / 395 tests.

[1.7.6]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.6

## [1.7.5] — 2026-05-11

### Documentation

- **README — "Wait, if it's password-protected, why can I still view-source on the gate page?" section** under Production deployment. Common observation from people who reach the gate page; the short answer is that what they're viewing the source of is Netlify's challenge page, not the underlying fleet rollup. The new section walks the reader through three `curl` commands they can run to verify that the actual inventory content (site names, file paths, public URLs, CSVs) is never served until they authenticate — including a grep against the 3.5 KB challenge body that returns zero matches for any fleet identifier, and a direct request for `audit-file-list-master.csv` that returns `HTTP 401` instead of the file. Also documents a known fallback design (custom Netlify Edge Function serving our own gate HTML from in-tree source for full auditability) that's intentionally not yet implemented; the section explains why and points readers at GitHub Issues if they need it.

[1.7.5]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.5

## [1.7.4] — 2026-05-11

### Documentation

- **README refresh for v1.7.x.** Manager TL;DR now mentions the v1.7.x infographic redesign (large cards, two-up colour-coded numbers, donut chart, plain-English captions, clickable cards, resizable detail-page columns, "Public URL" promoted to column 4) and points to `CHANGELOG.md` for the full release-by-release breakdown. Developer TL;DR is brought current: 30 test files / 375 tests; renderCard exported from `src/web/index-page.js`; `dp-hero` classes on per-site detail pages; CSS-only conic-gradient donut; `table-layout: fixed` + `<colgroup>` for resizable columns. Status section pinned to `v1.7.x shipped`, with a new row 18 in the phase-status table covering the visual redesign work (siteFullName plumbing, 2-col grid, donut, clickable cards, two-axis touch pan, column resize, big duplicates section). Schema docs now mention the optional `siteFullName` field. The `type: "git"` example was updated to the correct VPP domain (`vpp.icjia.illinois.gov`) and shows the full set of v1.7 fields (`siteFullName`, `siteUrl`, `publicUrlBase`). No code changes — this release exists so the npm registry's README mirrors the GitHub state.

[1.7.4]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.4

## [1.7.3] — 2026-05-11

### Added

- **Resizable columns on the per-site detail-page file table.** Click-and-drag the right edge of any column header to resize that column. Touch users can drag too — the 8 px hit zone uses pointer events with `touch-action: none` so the browser hands the drag to the resize logic instead of starting a horizontal pan. Implementation: each `<th>` gets a small absolutely-positioned `<span class="col-resize-handle">` on its right edge (subtle 2 px blue indicator on hover); the table emits a `<colgroup>` with one `<col data-col="…">` per CSV column carrying an initial width; JS pointermove updates the `<col>`'s style.width. Table is now `table-layout: fixed` so column widths are authoritative (was `auto`, which let cell content override `<col>` widths). The existing sort-on-click (header label area), filter-bar chips, sticky first column, and v1.7.2 two-axis touch panning of the table viewport all continue to work — the resize handle's `pointerdown` stops propagation so it doesn't trigger sort or pan, and the existing pan code's "bail on interactive child" selector was extended to also bail on `[data-resize-handle]`. Initial per-column widths are tuned to typical content: 90 px for File extension, 110 px for narrow text, 170 px for Date published, 220 px for filenames / paths, 300 px for Public URL and Full file path. Minimum after a drag is 60 px so a column can't be shrunk past readability.

[1.7.3]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.3

## [1.7.2] — 2026-05-11

### Changed

- **CSV column order — Public URL promoted from column 8 to column 4.** Managers and remediators open the public URL more often than any other column; under the old layout it was buried four columns deep, requiring horizontal scrolling on most viewports. The new order is: Server, Website, Server IP, **Public URL**, Date published, Source folder, File location, Full path, File name, … New v1.7.2 test pins `CSV_COLUMNS[3]` to `publicUrl`; the existing `colIndex("publicUrl")` lookups in the test suite already used dynamic indexing so they all kept working without further changes.
- **Per-site detail-page table now scrolls both axes with touch-pan support.** The `.table-wrap` rule used `overflow-x: auto` only, which combined with `max-height: 70vh` clipped vertical overflow rather than scrolling it; tables longer than the viewport pushed the page footer off-screen on iPad/iPhone. Switched to `overflow: auto` so both axes are scrollable, raised `max-height` to `75vh`, added `touch-action: pan-x pan-y` so iOS/Android handle native two-finger pan in both directions without delay, and `overscroll-behavior: contain` so the inner scroll doesn't bubble up to the page. `.table-scroll` (the wider container used by some non-file-table sections) got the same treatment.
- **`web-rollup` now honours `sites.json`'s `publicUrlBase` over the cached inventory header's value** for the master CSV. The old code spread `header.metadata` into `consolidatedSources` without overriding `publicUrlBase`, so a domain rename in `sites.json` was silently ignored on the next rollup unless the per-site inventory was re-scanned. The new code explicitly overrides `publicUrlBase` with `sitePublicUrlBase` (already computed earlier from `site.publicUrlBase ?? header.metadata?.publicUrlBase`) so the comment-promised "sites.json is authoritative" behaviour is actually enforced.

### Added

- **Big visual "duplicates" treatment on the fleet index.** The "Files that appear on more than one server" section is now an infographic-style banner — eyebrow label ("Cross-server file map"), 2.4 em weight-900 title with the actual filename count, and a 2-up tile pair showing exact-copy count (blue) and variant count (amber). Below the banner is a now-open-by-default explainer that leads with **"This is normal — not a webmaster error"** and explains the agency-history reason (Archive used to be the library; each program later got its own site and copies were pushed to each). The collapsible details block was replaced with a permanent panel because managers were scrolling past the small h2 and the collapsed details summary without realising what the section meant.
- **VPP `publicUrlBase` fixed** in `~/.filecap/sites.json` (`vpp.illinois.gov` → `vpp.icjia.illinois.gov`) so per-file links resolve to the live CMS. Re-scanned VPP so the cached inventory header carries the corrected domain forward.

### Fixed

- **Card CTA buttons now have explicit `position: relative; z-index: 2`** so the v1.7.1 stretched-link overlay can never accidentally swallow the "Download spreadsheet" click. The visual effect is the same — empty card areas still navigate to the detailed report — but the bottom buttons are guaranteed clickable independently. New v1.7.2 test asserts the download `<a>` is rendered as a separate element with the `download` attribute outside the stretched link.

[1.7.2]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.2

## [1.7.1] — 2026-05-11

### Fixed

- **Donut chart now renders.** The v1.7.0 CSS used `calc(var(--pct, 0) * 1%)` for the conic-gradient stop, but `--pct` is emitted with a `%` suffix (e.g. `--pct: 67.6%`) and CSS `calc()` cannot multiply two percentages — every browser silently rejected the property and `background-image` resolved to `none`, so the donut was invisible on every fleet-index card and every per-site detail page. Replaced both `calc(var(--pct, 0) * 1%)` references (one in `src/web/index-page.js`, one in `src/report/html.js`) with the direct `var(--pct, 0%)` percentage stop. The donut now renders correctly on the fleet index AND on every per-site detail page.

### Added

- **Whole-card clickability + hover lift on the fleet index.** Every site card is now itself a click target that navigates to the detailed report — a manager can click anywhere on the card body, not just on the small "View detailed report →" button. Implemented via the standard "stretched-link" pattern: an absolutely-positioned `<a class="card-stretched-link">` overlay covers the card area and inherits its border-radius; child interactive elements (`View detailed report` button, `Download spreadsheet` button, site-url link, technical-details disclosure) sit above the overlay at `z-index: 1` so they still work independently. On hover, the card translates up by 4 px, the shadow deepens, and the border tints to the accent blue — visually obvious affordance. `:focus-within` paints a 3 px accent-blue focus ring around the whole card for keyboard users. Honours `@media (prefers-reduced-motion: reduce)` to disable the lift animation for users who request reduced motion.
- **Empty-string `siteFullName` falls back to `siteName`** on the fleet index (matches the same treatment already applied to the detail-page H1 in v1.7.0 commit `01c1d4e`). Changed `siteFullName ?? siteName ?? site.name` (which only falls through on `null` / `undefined`) to `siteFullName || siteName || site.name` (which also falls through on `""`).

### Tests

- 3 net new tests in `test/index-page.test.js`: empty-string `siteFullName` fallback; tightened the previously-loose "two-up tiles" assertion into two separate tile-bound assertions so a future total/audit number swap actually fails (mirrors the equivalent dp-hero tightening in v1.7.0 commit `552f116`); new "stretched-link" markup assertion. 371/371 passing.

[1.7.1]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.1

## [1.7.0] — 2026-05-11

### Added

- **Optional `siteFullName` field in `~/.filecap/sites.json`.** Each site can now declare a verbose human name alongside its short nickname (`siteName`). The full name flows through `web-rollup → report → writeHtml` and is rendered as the card title on the fleet index and the H1 on the per-site detail page. Sites without `siteFullName` cleanly fall back to `siteName` — zero-config compatibility for existing fleets.
- **Manager-friendly card anatomy on the fleet index.** Each site card now leads with the full name (large, bold) and a small uppercase nickname above it (`#c0cdda`, weight 800 — comfortably above WCAG AA 2.1 contrast at small sizes). Below the title: a two-up "tile" pair — total files (blue, `#4dabf7`) and files needing audit (amber, `#ffa84d`) — with the numbers blown up to ~3.6em weight 900. Below the tiles, a CSS-only donut (conic-gradient + `::after` mask, no SVG/JS) shows the audit-share percentage in the centre, accompanied by a plain-English caption ("Two-thirds need audit · 69 of 102 files") so a manager grasps the share without reading a chart. A row of file-type chips (PDFs / Office / images) sits below the donut, with a meta strip ("38 MB · scanned May 11") and the large CTA pinned to the bottom of every card via `margin-top: auto`. Equal-height alignment across the row is guaranteed by reserving fixed vertical slots for every block.
- **Same hero pattern on the per-site detail page.** A new `.dp-hero` block at the top of each `<site>.html` mirrors the index card: nickname + big full name + two-up tiles + donut on its own row + plain-English caption. Numbers go a notch bigger here (~4em) because the page is wider than a card. The existing meta-grid, filter chips, row-marker legend, "image-only PDFs need OCR" chip, CSV download button, and file table all sit below — **unchanged**.
- **Donut chart is pure CSS** (`conic-gradient` ramp + `::after` mask). No SVG, no chart library, no JavaScript dependency. Renders identically online and offline.

### Changed

- **Card grid switches from 3-col to 2-col at desktop** (and collapses to 1-col below 820 px viewport). Each card gets significantly more horizontal room, which is what lets the hero numbers scale up and the donut sit on its own row.
- **`--fc-text-muted` token bumped from `#666666` to `#9aa5b1`** for WCAG AA 4.5:1 contrast against the card-gradient background. The legacy `#666666` was 3.0:1, below AA for normal text on `#18202b`.
- **Design tokens added to `src/web/styles.js`** for the new palette: `total` (#4dabf7), `audit` (#ffa84d), `totalTileBg`, `auditTileBg`, `nickname` (#c0cdda), `cardBgTop` / `cardBgBot`, `ctaBg`, `ctaFg`. Emitted as `--fc-*` CSS custom properties from `darkModeCss()`.
- **`renderCard` is now exported** from `src/web/index-page.js` so it can be unit-tested directly. Was previously a local helper. New test file `test/index-page.test.js` adds 7 cases covering the new anatomy.

[1.7.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.7.0

## [1.6.7] — 2026-05-11

### Added

- **`examples/audit-fleet-auto.sh`** — non-interactive wrapper around `audit-fleet.sh`. Drives the inner script under `expect` so the four interactive prompts that gate a fleet run (fleet-level "Proceed with audit of N server(s)?", per-server "Choice:" config-review, per-server "Continue anyway?" on URL HEAD failure, per-server "Proceed anyway?" on low local disk) all get auto-answered. The naive `echo y | ./audit-fleet.sh` pipeline doesn't work because the SSH calls in audit-fleet's pre-validation loop inherit (and drain) stdin, so `read` later sees EOF and `set -e` aborts silently before the prompt is reached; an `expect`-allocated pty side-steps that. Honours `SKIP_VERSION_CHECK` (defaults to 1) and `AUDIT_HTML` (defaults to 1). Same exit code as `audit-fleet.sh`. Requires `expect` (preinstalled on macOS; `apt install expect` on Debian).

### Changed

- **URL HEAD reachability check accepts HTTP 200–499 as "host reachable"** (in both `audit-fleet.sh` pre-validation and `audit-remote.sh` per-server check). Previously the check used `curl -fsSL --head`, which fails on any 4xx response and triggered an interactive "Continue anyway? [y/N]:" prompt for every Strapi-style site — those sites return **404 on the bare `/uploads`** because directory listing is disabled, even though the individual file URLs underneath are fine. The check now captures the HTTP code via `curl -sS -o /dev/null -w "%{http_code}"` and only treats 5xx, `000` (connection failure), or empty as a real reachability problem. The fleet pre-validation status column now shows the actual HTTP code (e.g. `404`, `200`) instead of `OK` / `FAILED`. Eight of ICJIA's existing fleet sites stopped throwing spurious prompts as a result.

[1.6.7]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.6.7

## [1.6.6] — 2026-05-11

### Security

- **Red/blue team re-audit covering 1.3.1 through 1.6.5** (full findings: `docs/security/audit-2026-05-11.md`). 5 new findings: 1 Moderate (fixed below), 4 Notes (accepted with documented mitigations). 0 production CVEs (`npm audit --omit=dev` clean). 356/356 tests green.
- **FC-2026-018 (Moderate) — fixed.** `audit-static.sh` was exposing the optional `FILECAP_GITHUB_TOKEN` PAT in `ps aux` argv for the ~10-second window of each `git clone` / `git remote set-url` call. The script previously inlined the token into the URL (`https://x-access-token:<TOKEN>@github.com/...`); on macOS and Linux, process arguments are world-readable, so any local user could see the token. The `gh CLI` auth path (the documented preferred option) was never affected. Fix: a new `git_with_auth` helper passes the PAT via the `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0=http.extraheader` / `GIT_CONFIG_VALUE_0` env-var triple instead — process environment is only readable by the same UID, so the token is no longer visible to other local users. Clone URL is always the clean `https://github.com/<owner>/<repo>.git`. Existing `.git/config` files with token-bearing URLs from earlier runs are scrubbed on the next invocation.
- **FC-2026-019 / 020 / 021 / 022 — Notes, accepted.** Master / duplicates CSV data-exposure surface (mitigated by Netlify Pro Site Password — verified HTTP 401 on every artifact), secrets.json same-UID readability (standard user-account trust boundary), audit-static.sh clone dir trust (same as Strapi mirrors), and new inline JS in HTML reports (reviewed for XSS — all handlers use class-list / dataset reads, no innerHTML or eval). Documented in the audit doc and README findings table.

[1.6.6]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.6.6

## [1.6.5] — 2026-05-11

### Added

- **"Image-only PDFs / need OCR (N)" filter chip on per-site detail pages.** Yellow-bordered chip in the primary filter bar. Conditionally rendered — only appears when the site has at least one image-only PDF in its inventory (no noise on sites that have none). Clicking it filters the table to just the rows where the PDF has no text layer; these are typically the most expensive remediation work because they need OCR before tagging is possible. Yellow accent matches the existing image-only row tint so the chip is visually tied to the rows it surfaces.

[1.6.5]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.6.5

## [1.6.4] — 2026-05-11

### Added

- **"What are the colored row markers?" legend on per-site detail pages**, rendered as an aside note immediately above the inventory table. Two visual swatches that mirror the actual table styling: a yellow-left-bordered swatch for flagged-filename rows (spaces / non-ASCII / overlong / scanner-default name patterns like `Scan_20240115_001.pdf`), and a faint-yellow-tinted swatch for image-only PDF rows (scanned, no text layer — needs OCR before remediation, typically the most expensive work). The legend is hard to miss but doesn't dominate — small font, dedicated card, sits between the filter chips and the table.

[1.6.4]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.6.4

## [1.6.3] — 2026-05-11

### Added

- **`siteUrl` field on sites.json entries — the front-end homepage URL** that visitors see (e.g. `https://dvfr.illinois.gov/`), distinct from `publicUrlBase` (the file-server URL like `https://dvfr.icjia-api.cloud/uploads` that backs per-file clickable links in the CSV/HTML reports). The bundle index site cards and per-site report meta-grid now display `siteUrl` as the "Public URL" link — manager clicks it and lands on the site's homepage, not the API server's uploads directory. Falls back to `publicUrlBase` (then NDJSON header's publicUrlBase) when `siteUrl` is omitted, so existing entries keep working unchanged.
- **Threading `siteUrl` through `runReport` → `writeHtml`** so per-site detail pages render the correct URL regardless of whether the NDJSON header carries the field. Standalone `filecap report` calls (no `siteUrl` arg) fall back to the inventory's metadata as before.

[1.6.3]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.6.3

## [1.6.2] — 2026-05-11

### Added

- **Strict mode in `audit-fleet.sh`: refuse to roll up a partial fleet.** When any per-site audit fails (SSH/clone/scan), the script now aborts before the consolidation + rollup step instead of quietly shipping a bundle that's missing sites. The auditor sees a clear "X of Y site(s) failed; refusing to roll up" error pointing at `failed_servers.txt` plus per-mode debugging hints (SSH, git, URL HEAD). Pass `--allow-partial` (or set `AUDIT_ALLOW_PARTIAL=1`) to opt out and ship a partial bundle anyway.

### Fixed

- **JSON loader bug shifting fields for `type:"git"` entries.** The TSV loader inside `audit-fleet.sh` used `IFS=$'\t'` for `read`, but bash collapses consecutive whitespace separators (tab is in bash's whitespace set), destroying the empty `user`/`host`/`remotePath` fields a git site has and shifting every subsequent field left by three positions. Result: `vpp-git` was parsed as `type=strapi`, `host=publicUrlBase`, and got routed through the SSH preflight where it failed with `UNREACHABLE`. Switched the separator to ASCII unit-separator (`\x1f`) — outside bash's whitespace set, so consecutive empties are preserved. Existing strapi-only `sites.json` files were unaffected because their entries always had all four fields populated.
- **`audit-static.sh` `git fetch`/`git clone` failing on the "update existing clone" path.** The script piped `git fetch` and `git clone` output through `| head -20`, which closed the pipe early and sent SIGPIPE back to git, making it return non-zero even on successful fetches/clones. Removed the truncation — output flows freely now and only real failures trigger the error branch.

### Changed

- **Site cards on the bundle index now show the site's URL** under the site name (small blue link), and the **per-site detail page meta-grid** has a new "Public URL:" row. Pulled from `sites.json publicUrlBase` first, falling back to the NDJSON header. (Frontend-vs-API URL distinction is a follow-up — currently using whatever `publicUrlBase` is set to.)

[1.6.2]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.6.2

## [1.6.1] — 2026-05-11

### Added

- **Public URL displayed in two places** for every site:
  - **Bundle index site card**: under the site name (h3), a small blue link showing the site's `publicUrlBase` (e.g. `https://dvfr.icjia-api.cloud/uploads`, `https://vpp.illinois.gov` for VPP-git). Clicking opens the actual site in a new tab. Hidden when the site has no `publicUrlBase` configured.
  - **Per-site detail page meta-grid**: a new "Public URL:" row alongside Server, IP, Hostname, Scanned path, Scanned at. Linked, same target/rel attrs as the index card. Skipped for consolidated reports (which already list the websites separately).

The data is pulled from `sites.json`'s `publicUrlBase` first (authoritative — the source of truth for what's deployed), falling back to the NDJSON header's `publicUrlBase` for inventories whose sites.json entry doesn't have it.

[1.6.1]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.6.1

## [1.6.0] — 2026-05-11

### Added

- **`type: "git"` site mode for self-contained static-site (Nuxt) repos.** Audits sites whose PDFs live inside a GitHub repo's `/public/` folder rather than on a CMS host. `sites.json` gets three new optional fields: `type` (enum `"strapi"` | `"git"`, defaults to `"strapi"`), `gitRepo` (the clone URL — required when type is `git`), and `publicPath` (the directory inside the repo to scan, defaults to `"public"`).
- **`examples/audit-static.sh`** — sibling to `audit-remote.sh`. Shallow-clones the repo to `~/filecap-audits/<name>/clone/` (or fetches + resets if already cloned), runs the existing `filecap scan` on the configured `publicPath`, and rewrites each entry's `absolutePath` to a GitHub source URL of the form `https://github.com/<owner>/<repo>/tree/<branch>/<publicPath>/<rel-path>` — clickable, portable, points at the source-of-truth. Default branch is detected from `git symbolic-ref refs/remotes/origin/HEAD`; falls back to `main`.
- **`audit-fleet.sh` branches on `type`** during both pre-validation and the per-site audit loop. Git-type entries get a `git ls-remote --exit-code` preflight (instead of SSH+du), then dispatch to `audit-static.sh`; strapi-type entries keep their existing SSH+rsync flow. Mixed sites.json (strapi + git side-by-side) works in a single fleet run; output drops into the same per-site directory layout (`runs/<ts>/inventory.ndjson` + `latest/` symlink), so `filecap web-rollup` picks up git-type entries unchanged.
- **Auth resolution chain for git operations**: (1) `gh auth status` (preferred — uses gh's credential helper transparently), (2) `FILECAP_GITHUB_TOKEN` env var (`x-access-token:<pat>` interpolation, never written to disk, scrubbed from `.git/config` after clone), (3) anonymous (public repos only). No PAT prompt, no SSH key requirement.

### Tests

- 6 new tests for the schema extension covering: accepts `type: "git"` + `gitRepo` + `publicPath`; accepts entries omitting `type` (defaults to strapi); rejects `type: "git"` without `gitRepo` (Zod refine); rejects unknown `type` value; accepts mixed strapi+git sites.json; `.strict()` still rejects unknown extra fields on git entries.

[1.6.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.6.0

## [1.5.8] — 2026-05-10

### Added

- **"Download spreadsheet (CSV)" button in the sticky top bar of every per-site detail page.** The HTML report shows the basics for at-a-glance review; the CSV is what people actually use for work. The button is rendered as a prominent blue primary action on the right side of the back-bar, paired with the "← Back to fleet index" link on the left — both critical actions visible together on every detail page without scrolling. `writeHtml` accepts a new `csvHref` parameter; `runReport` defaults it to `"audit-file-list.csv"` (the sibling file it just wrote) when omitted, so standalone single-site audits also get the button; `web-rollup` overrides with the renamed per-site CSV filename (`<slug>-<timestamp>.csv`).

[1.5.8]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.5.8

## [1.5.7] — 2026-05-10

### Added

- **"← Back to fleet index" sticky bar at the top of each per-site detail page** when the report is part of a web-rollup bundle. Always visible (`position: sticky`); link goes to `index.html` in the same directory. Standalone single-site audits don't render the bar (no `index.html` sibling to link to) — `runReport` only emits it when `backHref` is passed by `web-rollup`. Hidden in print stylesheet so paper output stays clean.
- **CHANGELOG link in both footers.** The per-site report footer (which already linked to GitHub) gained a CHANGELOG link; the bundle index footer gained both (GitHub + CHANGELOG). Both open in a new tab with `rel="noopener noreferrer"`.

### Changed

- **Wording: "audit fleet" → "fleet audit"** everywhere (index H1, brand bar, default title, MCP tool default, README docs). "Fleet audit" reads as the right noun phrase ("an audit of a fleet"); the prior order parsed awkwardly.

[1.5.7]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.5.7

## [1.5.6] — 2026-05-10

### Changed

- **Duplicates summary table now uses the same visual styling as the per-site report tables.** 12px tabular type, tight padding (`0.45rem 0.65rem` thead / `0.35rem 0.65rem` td), alternating row stripes (`#0c0c0c` / `#0d1117`), hover row (`#1a1a1a`), sticky thead, sticky first column, link color `#60a5fa`. Every data table in the app now looks the same.
- **Sites column (and every other column) auto-sizes to its content** — dropped per-column `min-width` rules that were forcing extra width. The "Sites" column was particularly weirdly wide before (~18ch min) because some rows had many comma-separated sites; now it shrinks to whatever the longest cell needs.
- Cells use `white-space: nowrap` + `max-width: 320px` + `text-overflow: ellipsis` (matching the per-site tables). Full text is in a `title=` tooltip on every clipped cell, so hover reveals the complete filename / site list / date range.

[1.5.6]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.5.6

## [1.5.5] — 2026-05-10

### Changed

- **Hero stat block rewritten as an infographic** instead of three side-by-side numbers. Three elements stacked vertically:
  1. **Big total** — single huge headline number (`clamp(3.5em, 9vw, 6em)`) above an uppercase "TOTAL FILES SCANNED ACROSS N WEBSITES" label, so a manager sees the headline before reading anything else.
  2. **Proportional split bar** — horizontal stacked bar with the remediable segment (orange gradient) sized by count and the reference segment (grey gradient) sized by count, each labeled with its absolute number, what-it-is, and percentage. The bar visually conveys the ratio at a glance — managers can see "most of the fleet needs audit work" without doing math. Has an `aria-label` describing both segments for screen-reader users. On viewports under 640px the segments stack vertically.
  3. **Arithmetic equation** — `14,914 total = 11,097 need accessibility audit + 3,817 don't`, in a low-key bordered box, so the number relationship is spelled out for managers who want to verify the math.

The old `.hero-stat-row` with three separate stat blocks is removed.

[1.5.5]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.5.5

## [1.5.4] — 2026-05-10

### Changed

- **Duplicates explainer rewritten to cover what to do with each kind.** Two new sub-sections now spell out the action for an audit lead:
  - **Exact (matching content hash):** fix accessibility once on the canonical copy, then push the corrected file to the other servers' CMSes under the same filename. Don't delete the duplicates — most are referenced by CMS entries on each site, and removing the file would break the page link. Goal: one corrected file appearing in N places.
  - **Variant (same filename, different content hash):** each variant is its own document and likely needs its own remediation pass. Open them in the per-site links to check whether they're truly distinct or one is canonical.
- **False-positive caveat added.** The cross-server matcher strips Strapi's 10-character hex suffix before comparing filenames, which can collide for unrelated files that happen to share a base pattern. The caveat explicitly calls out that `exact` matches are the high-confidence signal; `variant` matches are worth investigating but should be opened to confirm.

[1.5.4]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.5.4

## [1.5.3] — 2026-05-10

### Added

- **Headline "total files" stat in the hero**, alongside the existing "need accessibility audit" and "don't" blocks. Renders as a three-block row at the top of the index page so a manager can grab the headline number without reading the prose sentence below it. Coloured in the link-blue accent so it visually leads the row.
- **Clickable per-file site links in the duplicates summary table.** Each site name in the "Sites" column is now a link to that site's public URL for the file (opens in a new tab; the URL is also shown on hover via the `title` attribute). A manager or remediator can scan the table, spot a row that looks worth checking, and click straight through to the document on each server to compare them. Sites without a `publicUrlBase` configured fall back to plain text.

### Fixed

- **Duplicates table no longer pads to fill the wrapper.** Dropped `min-width: 100%` from the table and gave the scroll wrapper `width: fit-content; max-width: 100%`. On wide monitors the wrapper hugs the table (no blank space to the right of the last column); on narrow viewports the wrapper caps at 100% and horizontal scroll / drag-pan kicks in as before.

[1.5.3]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.5.3

## [1.5.2] — 2026-05-10

### Changed

- **Duplicates summary table styled to match the per-site report tables.** The 1.5.1 consolidated table read as squished — too-narrow columns, full filenames wrapping mid-word, no visual hierarchy. Now: per-column `min-width` (filename 28ch, sites 18ch, dates 24ch, …) so each column gets the space it needs and the table overflows horizontally rather than crushing; sticky first column (filename) stays anchored when you scroll right; sticky header row so column labels stay visible when you scroll down; row hover + alternating-row backgrounds; max-height with vertical scroll inside the wrapper. Same dark-palette treatment as the per-site report tables for visual consistency.
- **Click-and-drag horizontal pan on the duplicates table.** Mouse-drag horizontal pan with the same 5px-threshold / Pointer-Events / `setPointerCapture` pattern from the per-site reports (so single clicks still select text and hit links, drags pan smoothly even if the cursor leaves the wrapper). Touch panning was already native via `overflow-x: auto` with iOS momentum scroll preserved — that path is unchanged.

[1.5.2]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.5.2

## [1.5.1] — 2026-05-10

### Added

- **`audit-file-duplicates.csv`** — dedicated CSV of every cross-server duplicate occurrence, written into the bundle alongside the master CSV. Nine columns (Normalised filename, Match type, Group size, Website, Server, Date published, Size, Path, SHA-256 first 12), one row per occurrence so the audit lead can sort/filter/pivot in Excel — pivot by Website to see what each site has in common with Archive, or by Match type to focus on `variant` rows (same filename, different content) where content actually drifted. Download link added to the duplicates section on the index page.

### Changed

- **Duplicates table consolidated to one row per filename group** (was one row per file occurrence). For the ICJIA fleet that's 718 rows instead of ~1,800, and the per-page rendering drops the bundle's index.html from ~600 KB to ~270 KB. Columns: Filename, Match (exact / variant badge), Sites, Copies, Newest → oldest date, Total size. The detailed per-occurrence view lives in `audit-file-duplicates.csv` now.
- **Explainer copy** points readers toward `variant` rows (same filename, different content) as the more interesting cases — those are where someone updated a document on one site but not another. `exact` rows are usually intentional reposts.

### Removed

- **`.gitkeep` and `.gitignore` filtered out of the duplicates view.** These are placeholder/marker files that always exist as duplicates by design; including them was pure noise. Filter is case-insensitive and matches the exact filename only — files like `post-gitkeep-cleanup.pdf` still appear as duplicates if they actually exist on multiple servers.

[1.5.1]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.5.1

## [1.5.0] — 2026-05-10

### Added

- **Cross-server duplicates section on the bundle index page.** Detects files that appear under the same logical filename on more than one server (after stripping Strapi's appended 10-character hex hash, so `report_a1b2c3d4e5.pdf` on one site matches `report.pdf` on another). Each group is labeled either as an **exact copy** (same SHA-256) or a **same-name, different-content** variant (different SHA-256 — typically a file that was edited on one server but not the other). Within each group, items are sorted newest-first so the canonical version is at the top. Includes a manager-friendly explainer (collapsed by default) covering why duplicates exist (Archive's library legacy + per-program CMS migration) and that **a duplicate is not an error**, just something to examine. Section renders nothing when no cross-server duplicates exist.
- **Master spreadsheet — `audit-file-list-master.csv`.** A single CSV in the bundle root containing every file from every server in one row-per-file table. Same 14-column shape as the per-site CSVs; the leading `Server` column tells you which website each row came from. Auto-generated by `filecap web-rollup`; download link is added to the index page. For the 8-site ICJIA fleet that's a single 7 MB / ~15K-row spreadsheet a manager or vendor can open in Excel without juggling per-site files.
- **Site-name fallback in consolidated sources.** `web-rollup` now overlays the `siteName` from `sites.json` onto the consolidated metadata when building the master CSV — so the "Website" column populates correctly even for inventories scanned without `--site-name`.

[1.5.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.5.0

## [1.4.1] — 2026-05-10

### Fixed

- **Bug from 1.4.0: data rows had more cells than the header had labels.** When DOCX/XLSX columns were dropped from `CSV_COLUMNS`, the corresponding values in `buildRow()` / `buildRowValues()` were left in place. Result: per-site CSVs and HTML tables emitted 8 trailing cells without matching column headers, which Excel and the HTML table rendered as columns labeled `0`, `1`, `2`, … (the array indices) on the right edge. Both row-builders are now in sync with `CSV_COLUMNS`.

### Removed

- **PDF-specific introspection columns dropped from CSV / HTML.** Removed: `pageCount`, `hasTextLayer`, `isImageOnly`, `hasTags`, `hasFormFields`, `encrypted`, plus the format-agnostic `documentLanguage` and `officeLegacyFormat`. Same reasoning as the 1.4.0 DOCX/XLSX drop: remediators have Adobe Acrobat / Word / Excel and can read these properties directly from each file. The deliverable focuses on what's needed to *find* and *price* each file.
- **`Remediation needed?` column dropped.** Same reasoning — remediators classify files themselves once they can see the list. The `remediable` field is still on every entry in the underlying NDJSON (used by MCP `query_inventory`, the index-page stat cards, and the HTML report's category-filter chips). Only the per-row spreadsheet column is gone.

The CSV / HTML now has 14 columns total: Server, Website, Server IP, Date published, Source folder, File location, Full file path, Public URL, File name, File extension, File type, Size (bytes), Content hash (SHA-256), Duplicate of. Down from ~30 in 1.3.x.

[1.4.1]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.4.1

## [1.4.0] — 2026-05-10

### Removed

- **DOCX and XLSX introspection columns dropped from the CSV / HTML deliverable.** Removed: `docxHasHeadings`, `docxImageCount`, `docxAltTextCoverage`, `docxTableCount`, `docxTablesHaveHeaders`, `docxVagueLinkCount`, `xlsxSheetCount`. Remediators have native tools (Word, Excel) that surface these properties directly, and including them per-row inflated the table from ~30 columns to ~22 without giving anyone the file location, type, or duplicate signal that drives pricing. The deliverable now focuses on what's needed to *find* and *price* each file: filename, path, server, size, type, duplicate marker, public URL, plus PDF-specific cost drivers (page count, image-only/OCR, structurally tagged). The full DOCX/XLSX introspection remains in the underlying NDJSON inventory for any tooling that needs it (MCP `query_inventory`, custom reports). PDF columns are unchanged because image-only-PDF detection is a real cost driver for OCR work.

### Added

- **Click-and-drag horizontal pan on the per-site HTML table.** The cursor turns to the open-hand "grab" affordance over the table; clicking and dragging slides the table horizontally so wide tables don't require fishing for the bottom scrollbar. Implemented via the Pointer Events API with a 5px threshold so single clicks still trigger text selection and link clicks (sort headers, filename links, etc.). Mouse drags use `setPointerCapture` so the drag continues even if the cursor leaves the table. Touch panning was already native via `overflow-x: auto`; that path is unchanged (iOS momentum scroll intact).

[1.4.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.4.0

## [1.3.4] — 2026-05-10

### Fixed

- **Consolidated fleet HTML report header was rendering blank fields.** When `filecap report` runs against a consolidated NDJSON (output of `filecap rollup`), the metadata structure is `{ consolidatedAt, sources: [...] }` rather than the per-server `{ serverName, serverIp, hostname, scannedPath, scannedAt }` shape. The HTML header template assumed the per-server shape and rendered five empty `<span>`s. Now branches on `kind === "filecap-consolidated-header"` and shows fleet-appropriate fields: Audit type, Servers (count + names), Websites, Scan window (earliest → latest), Consolidated at. Per-site reports are unchanged.

### Changed

- **Wording softened from "needs accessibility work" to "needs accessibility audit"** across the index page, per-site HTML report cells, CSV cells, and the report-command preamble. The earlier wording read as definitive ("this file definitely needs fixes"); the new wording is appropriate for an inventory-scoping deliverable ("this file should be reviewed by the auditor"). Tests updated to match.

[1.3.4]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.3.4

## [1.3.3] — 2026-05-10

### Added

- **Bearer-token authentication for the public-URL HEAD-check.** Sites whose public URL is gated behind a JWT/bearer token (intranet portals, staff-only document libraries) can now be audited without the "URL FAILED" preflight warning. Tokens live in a new `~/.filecap/secrets.json` file (mode `0600`, never bundled, never exported via the saved-sites menu) keyed by server-name. An env var `FILECAP_BEARER_TOKEN_<SERVER_NAME_UPPER_SNAKE>` overrides the file when set — works with `op run -- ./audit-fleet.sh` (1Password CLI), `direnv`, or any other secret manager that injects env vars, so the JWT never has to touch disk. The token is fed to `curl` via stdin (`--header @-`) so it never appears in argv / `ps aux`. Resolution order: env var → secrets.json → none. Both `audit-fleet.sh` and `audit-remote.sh` self-resolve the token on each run.
- **`requiresBearerToken: boolean` field on `sites.json` entries.** Optional, informational — tells a remediator who receives a shared bundle "this site needs a JWT, ask for it separately." The token itself is never in `sites.json`; only this hint flag.
- **15 new tests** covering the secrets loader (missing-file, valid, invalid-JSON, schema violations, type errors), env-var precedence, server-name → env-var-name normalization, and tolerant fallback when secrets is null/empty. Full suite 327/327 green.

### Changed

- Fleet preflight URL status annotates token-authenticated sites as `OK*` instead of plain `OK`, so you can tell at a glance which sites probed with a bearer token.

[1.3.3]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.3.3

## [1.3.2] — 2026-05-10

### Added

- **`~/.filecap/config.json` user-config file with `webRollup.autoDeploy`.** When `webRollup.autoDeploy` is `true`, `filecap web-rollup` always runs `netlify deploy --prod` on completion — no `--deploy` flag needed. The CLI flag still wins when present, so the config only fills in defaults. Optional `webRollup.deploySite` (passed to `netlify deploy --site`) covers cases where the working directory isn't already linked. Config is validated against a Zod schema on load; unknown fields, typos, and wrong types fail loudly with a named error rather than being silently ignored. Loader returns `{}` cleanly when the file doesn't exist, so existing users see no behavior change unless they opt in.

[1.3.2]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.3.2

## [1.3.1] — 2026-05-10

### Fixed

- **`audit-remote.sh` rsync-stats parsing on macOS.** The script greped for `"Number of regular files transferred:"` (modern GNU rsync wording) but Apple's bundled `rsync` writes `"Number of files transferred:"` without the `regular`. With `set -o pipefail`, the no-match grep returned non-zero, which failed the assignment, which tripped `set -e` — the audit silently exited between rsync completion and the local scan with no error message. Symptom: every macOS fleet audit reported "0 succeeded, N failed" with empty inventories despite rsync clearly working. Grep now uses `(regular )?` to match either wording and is wrapped to tolerate no-match.

### Added

- **`audit-fleet.sh` accepts `~/.filecap/sites.json` directly.** Pass any `.json` path as the positional arg, or run with no arg and the script auto-detects `~/.filecap/sites.json` if present. Eliminates the sites.json → CSV conversion step. Enables the bundle-distribution workflow: hand a remediator the two `.sh` scripts plus a `sites.json` file, they drop it into `~/.filecap/` and run `./audit-fleet.sh` — no further configuration needed (assuming SSH keys are already authorized on the target servers).

[1.3.1]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.3.1

## [1.3.0] — 2026-05-10

### Security

- **Comprehensive red/blue audit completed.** Full findings in `docs/security/audit-2026-05-10.md`. 17 findings: 2 Critical, 6 Moderate, 7 Low, 2 Notes. All Critical and Moderate findings are fixed in 1.3.0; remaining Low items are either fixed or documented in the README's "residual risk" section.
  - **FC-2026-001 / FC-2026-002 (Critical):** Shell injection via SSH command interpolation. All variables are now passed through `printf '%q'` before embedding in SSH/rsync commands in `audit-remote.sh` and `audit-fleet.sh`.
  - **FC-2026-003 (Moderate):** rsync now uses `--no-links` to prevent symlink escapes from a compromised remote server.
  - **FC-2026-004 (Moderate):** MCP server gains `FILECAP_MCP_ALLOWED_PATHS` env var (colon-separated absolute paths) to restrict the `filecap_scan` tool's reachable directories. Unset = no restriction (backward-compatible).
  - **FC-2026-005 (Moderate):** README and `password-gate.js` CAVEAT now explicitly document that the client-side password gate uses an unsalted SHA-256 that can be cracked offline in seconds; Netlify Site Password is recommended for any non-public content.
  - **FC-2026-006 (Moderate):** `--sites-file` argument validation added: rejects non-`.json` paths; error messages no longer include `err.message` (which could leak file content fragments).
  - **FC-2026-007 (Moderate):** `sites.json` validated against a Zod schema on load; entries with unexpected fields or wrong types are rejected with a clear error.
  - **FC-2026-008 (Moderate):** XSS regression test suite added covering server name, site name, hostname, entry filename, and path injection vectors; confirms `htmlEscape()` covers all HTML table-cell output paths.
  - **FC-2026-011 (Low):** Audit work directory `~/filecap-audits/<server-name>/` now created with mode 700.
  - **FC-2026-013 (Low):** Added code comments to `src/introspect/docx.js` and `src/introspect/xlsx.js` documenting the intentional in-memory-only zip/XLSX parsing (prevents zip-slip).
- **Bumped `vitest` from `^1.6.0` to `^4.1.5`** to clear 4 moderate dev-dep CVEs (esbuild → vite → vite-node → vitest chain, GHSA-67mh-4wv8-2f99). All 304 tests pass on v4. Production dependencies remain zero-vulnerability per `npm audit --omit=dev`.

[1.3.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.3.0

## [1.2.3] — 2026-05-10

### Security

- **Bumped `fast-xml-parser` from `^4.5.6` to `^5.7.0`** to fix [GHSA-gh4j-gqv2-49f6](https://github.com/advisories/GHSA-gh4j-gqv2-49f6) (XML Comment / CDATA Injection via Unescaped Delimiters in `XMLBuilder`). Filecap doesn't use `XMLBuilder` (only `XMLParser` for DOCX introspection), but updating to the patched line is good hygiene. All 293 tests continue to pass against the new major.

### Changed

- **Fleet snapshot index page rewritten for non-technical managers.** The page that managers see when handed the URL now leads with plain-English context ("We scanned 7 websites and found 1,247 files in total. 892 need accessibility work; 355 don't.") followed by an explainer section answering the obvious follow-up question ("Why aren't all 1,247 counted?") with side-by-side cards explaining what gets fixed (PDFs, Word docs, Excel, PowerPoint) versus what doesn't (images get descriptions in the CMS; text files, placeholders). The "By file type" breakdown is now a side-by-side table showing remediation-scope vs reference-only counts. Per-site cards drop the hostname and IP from the visible part (folded into a collapsed "Technical details" disclosure) and use friendlier button labels ("View detailed report" / "Download spreadsheet"). Designed for managers who don't know what a11y, alt text, CMS, or remediation mean — every term is defined in plain language at first use.

[1.2.3]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.2.3

## [1.2.2] — 2026-05-10

### Fixed

- **Audit work directories now keyed by server-name instead of server IP.** Many Strapi fleets host multiple sites on the same physical server (e.g., 10 sites across 3 IPs is common with Forge). The pre-1.2.2 layout used `~/filecap-audits/<ip>/` which meant scanning two sites on the same IP would overwrite each other's local mirror and `latest` symlink. The new layout uses `~/filecap-audits/<server-name>/` (e.g., `dvfr-strapi-prod`, `r3-strapi-prod`, `i2i-strapi-prod`), giving each site its own dedicated audit directory regardless of how many share an IP. Applies to `audit-remote.sh`, `audit-fleet.sh`, and `filecap web-rollup`'s inventory lookup.

### Migration

- Pre-1.2.2 audit directories at `~/filecap-audits/<ip>/` are still readable but no longer referenced. To migrate existing data: `mv ~/filecap-audits/<ip> ~/filecap-audits/<server-name>`. The audit script prints a one-line advisory when it detects a legacy IP-keyed directory and the new server-name dir doesn't exist yet.

[1.2.2]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.2.2

## [1.2.1] — 2026-05-10

### Changed

- **Dark-mode palette warmed up to GitHub-Dark / Nuxt-style cool navy** instead of pure gray-black. Background `#0a0a0a` → `#0d1117`; card backgrounds `#161616` → `#161b22`; sunken backgrounds `#050505` → `#010409`; subtle borders `#2a2a2a` → `#21262d`; strong borders `#404040` → `#30363d`. Gives the bundle and per-site reports a slightly polished navy tint without being dramatically blue. Applies to web-rollup index, per-site HTML reports, and any direct `filecap report --html` output.

[1.2.1]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.2.1

## [1.2.0] — 2026-05-10

### Added

- **`filecap web-rollup` subcommand.** Bundles the most recent scan of every saved site into a self-contained static-site directory (index.html fleet overview, per-site HTML reports, downloadable CSVs, `robots.txt`). Optional client-side password gate via `--password`. Output defaults to `~/filecap-audits/_web-rollup/<UTC-timestamp>/`. Ready for drag-and-drop to Netlify or any static host.
- **`filecap_web_rollup` MCP tool.** Exposes the web-rollup orchestrator to AI agents (Claude Desktop, Claude Code, etc.). The MCP server now advertises five tools.
- **`w` menu option in `audit-remote.sh`.** Selecting `w` in the saved-sites menu prompts for an optional password and runs `filecap web-rollup` against all saved sites, then offers to open the resulting `index.html`.
- **`netlify.toml` in the bundle.** Auto-generated config with sensible cache headers (CSV cached 1h with `Content-Disposition: attachment`; HTML cached 5m with `X-Robots-Tag: noindex`), security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`), and the publish directory set to `.`. Drag-and-drop or Git-connected Netlify deployments work without any dashboard build-config tweaks.
- **`--no-client-gate` flag.** Skip embedding the client-side password gate JS in the bundle. Use this when relying on Netlify's paid Site Password feature for server-side authentication; the client-side gate is unnecessary (and overlaps awkwardly). If `--password` is also passed, it is ignored and a warning is printed.
- **`--deploy` flag.** After building the bundle, run `netlify deploy --prod --dir <output>` automatically. Combines build + push into a single command. Requires `netlify` CLI installed and `netlify login` already done. Prints friendly install instructions if the CLI is missing at runtime.
- **`--deploy-site <site-id>` flag.** Pass `--site <id>` to `netlify deploy` for non-linked sites.
- **`audit-remote.sh` `w` menu now offers three password modes** (none / client-side / Netlify Site Password) plus an optional auto-deploy prompt after building.
- **Postflight run summary.** After every successful `audit-remote.sh` run, a summary block prints showing total elapsed time, per-phase timings (SSH preflight, rsync, scan + introspect, report generation), bytes transferred, files updated, and inventory totals (file count, bytes, remediable count). For `audit-fleet.sh`, a per-server table shows timings, file counts, and byte counts side-by-side with fleet totals at the bottom. Helps auditors see where time is spent and spot anomalies (e.g., a server that suddenly takes 10× longer than usual).
- **SSH-key setup docs.** New "Setting up SSH access" section in the README explains how to generate an Ed25519 keypair on macOS or Linux, what to email IDS, and how to verify access. The audit scripts' SSH-preflight failure message now points at this section and explicitly mentions contacting IDS.

### Changed

- **Dark-mode reskin of per-site HTML reports.** `filecap report --html` now produces a dark-mode report matching the web-rollup design system (background `#0a0a0a`, accent `#60a5fa`, amber remediable indicators). This applies to every direct `filecap report --html` invocation as well as per-site files in a web-rollup bundle — single visual language everywhere. Includes `@media print` that inverts to white background + black text.
- **`robots.txt` and `<meta name="robots">` noindex on all bundle pages.** Prevents search-engine indexing of published bundles.

[1.2.0]: https://github.com/ICJIA/filecap-cli/compare/v1.1.1...v1.2.0

## [1.1.1] — 2026-05-10

### Fixed

- **README not displaying on npmjs.com.** The npm registry's per-version readme field was empty for every version since 1.0.0, even though `README.md` was present in every published tarball. Republished 1.1.1 via the explicit `npm pack` + `npm publish <tarball>` flow to force the registry to populate the per-version readme. The `./publish` script now uses this flow by default.

[1.1.1]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.1.1

## [1.1.0] — 2026-05-10

### Removed

- **audit.icjia.app integration dropped entirely.** The `audit-enrich` subcommand, `--audit-link-pattern` scan option, `filecap_audit_enrich` MCP tool, `auditBlockSchema` Zod shape, `audit` entry field, `auditLinkPattern` header metadata field, and all related logic in `merge.js`, `csv.js`, and `html.js` have been removed. The integration was tightly coupled to an external service and added maintenance surface with no payoff for the core accessibility-scoping use case. Inventories created with 1.0.x that contain `audit` blocks will still parse (unknown fields are ignored by Zod's `strip` default), but the blocks will not appear in reports.
- **`filecap_audit_enrich` MCP tool removed.** The MCP server now exposes four tools: `filecap_scan`, `filecap_rollup`, `filecap_report`, `filecap_query_inventory`.
- **audit-remote.sh and audit-fleet.sh audit-enrich prompts removed.** The "Enrich inventories with audit.icjia.app scores?" interactive prompt and all downstream `audit-enrich` shell calls have been removed from both example scripts. The `audit_link_pattern` column has been dropped from the fleet CSV input format.

### Changed

- **CSV and HTML report columns slimmed to 30 accessibility-critical fields.** Dropped: `flags`; all PDF metadata text fields (`pdfTitle`, `pdfAuthor`, `pdfSubject`, `pdfCreator`, `pdfProducer`, `pdfApproxWordCount`); most DOCX introspection counts that duplicate what's already captured (`docxWordCount`, `docxParagraphCount`, `docxSectionCount`, `docxTotalImageCount`); all XLSX introspection except `xlsxSheetCount`; all `audit*` columns. Kept: every field needed to scope remediation work and measure baseline accessibility coverage.

[1.1.0]: https://github.com/ICJIA/filecap-cli/compare/v1.0.9...v1.1.0

## [1.0.9] — 2026-05-09

### Changed

- **Documentation: the two audit columns now BOTH work end-to-end.** When `--audit-link-pattern` was added in 1.0.5, the "Audit Link" column rendered clickable URLs that opened audit.icjia.app's homepage with a `?prefill=URL` query param the web app ignored. As of audit.icjia.app's PR #12 (merged + deployed today), `?prefill=URL` now triggers an on-demand audit via the new `POST /api/analyze-url` endpoint. The README's audit section was rewritten to explain when to use each column: "View audit →" for ad-hoc spot checks (no precomputation), "View report →" for pre-saved bulk results (after audit-enrich). No code changes — purely a documentation update reflecting the now-working behavior.

[1.0.9]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.9

## [1.0.8] — 2026-05-09

### Added

- **Saved-sites manager.** `audit-remote.sh` now stores per-site configs in `~/.filecap/sites.json` and offers a menu on startup: select a saved site (skipping all per-field prompts), add a new one, edit, delete, or preflight all of them. Each site stores SSH user, host, remote path, friendly name, website nickname, public URL prefix, and audit link template — but never the audit token (that stays in env). File is created with mode 600 inside `~/.filecap/` (mode 700). Override location with `FILECAP_SITES_FILE` env var.
- **Preflight-all-sites.** New `p` option in the saved-sites menu runs a quick health check on every saved site (SSH connectivity, remote path existence and readability, file count) and prints a status table. Read-only — no rsync, no scan. Catches SSH key drift, moved paths, and unexpectedly empty directories before running a full audit.
- **Import / export sites as JSON.** Two new menu options: `x` exports the current saved sites to a JSON file (no credentials — just hostnames, paths, nicknames), and `i` imports sites from a JSON file in either merge mode (add new sites by name, skip existing) or replace mode (wipe + use only imported). Designed for the auditor-onboarding workflow: an admin configures all sites once on their machine, exports the JSON, hands it to each visiting auditor; auditors import it on their machines (with their own SSH access already configured) and pick a site from the menu in seconds.

### Changed

- **HTML report is now always generated alongside the CSV.** No more "Also generate HTML report? [y/N]" prompt. Set `AUDIT_HTML=0` in the environment to opt out (rare). The CSV and HTML are the same data; the HTML is the manager-facing version with sortable filterable interactive controls.
- **Config review now allows per-field correction.** When the auditor sees the configuration summary before the audit runs, they can type a number 1-9 to fix any single field, then the table re-renders. Loop continues until they press Enter to proceed.

### Fixed

- **Required-input validation on Server IP and remote path.** Empty values are no longer silently accepted; the script re-prompts with "(required — please type a value)". Previously, pressing Enter at the IP prompt led to silent failure later (`forge@` with no host).

[1.0.8]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.8

## [1.0.7] — 2026-05-09

### Added

- **`filecap audit-enrich` subcommand.** New command that calls audit.icjia.app's `/api/bulk-from-inventory` endpoint (POST NDJSON, `Content-Type: text/plain`, `Authorization: Bearer <token>`) and writes per-file accessibility scores back into the inventory NDJSON in place (or to a specified `-o` output path). Each matched PDF entry gains an `audit` block with `score` (0–100), `grade` (A–F scale), `reportId`, `reportUrl` (user-facing `https://audit.icjia.app/report/<id>` — the subcommand constructs this itself from `<apiBase>/report/<reportId>`, ignoring the raw `/api/reports/` URL returned by the endpoint), and `enrichedAt` (ISO timestamp). Matching is by SHA-256 hash with path as fallback. Entries the audit service could not score (not publicly reachable, service error) are left unchanged.
- **Three new report columns: Audit score, Audit grade, Audit report.** When `filecap report` encounters entries with an `audit` block, it adds three columns at the end of the CSV and HTML: the score formatted as a percentage (`84%`), the grade letter (`B`), and the audit report URL. In the HTML report the Audit report cell renders as a "View report →" link that opens the saved accessibility report on audit.icjia.app. Entries without an `audit` block emit empty cells — the columns are always present in the output regardless.
- **`audit` block in `entrySchema` and `consolidatedEntrySchema`.** The Zod schema now accepts an optional `audit` object with `score` (int 0–100), `grade` (regex `^[A-F][+-]?$`), `reportId` (32 hex chars), `reportUrl` (URL), and `enrichedAt` (ISO datetime). Schema change is non-breaking: existing inventories without audit blocks remain valid.
- **`filecap_audit_enrich` MCP tool.** Same enrichment workflow available to AI agent clients: accepts `input` (required), `output` (optional, defaults to `input`), `apiBase` (optional, defaults to `https://audit.icjia.app`), and `authToken` (optional, falls back to `FILECAP_AUDIT_TOKEN` env var).
- **Optional audit-enrich step in `audit-remote.sh` and `audit-fleet.sh`.** After generating the initial report, both scripts now prompt "Enrich inventory with audit.icjia.app scores? [y/N]". If yes, they call `filecap audit-enrich`, then regenerate the report so the CSV/HTML include the audit columns. The prompt can be suppressed by setting `RUN_AUDIT_ENRICH=y` (or `=n`) before running. `audit-fleet.sh` also enriches the consolidated inventory after the per-server audits complete.

### Manager clarity (1.0.7)

- **Summary, CSV, and HTML now lead with the audit-relevant count, not the total file count.** Managers reading "Total files: 102" were assuming that was the audit workload — but only 69 of those 102 are remediable (PDFs + Office docs); the other 33 are images / placeholders / text files where alt text lives in the CMS schema, not in the file itself.
- `audit-summary.txt` and the HTML report both now open with an "AUDIT SCOPE" block (remediable count) and a parallel "OTHER FILES" block (reference count).
- HTML report has a two-stat box at the top — `Audit work: 69 files need remediation` vs `Reference files: 33 files no direct work needed` — and the chip filter defaults to "Remediable only" on page load.
- CSV's "Needs remediation" column was renamed to "Remediation needed?" and moved to column 5 (was column 12). Cell values now read "Yes — needs accessibility work" / "No — reference file (image, placeholder, etc.)" so a non-technical reader sees the meaning, not jargon.
- `MANAGER_SUMMARY.txt` (fleet runs) follows the same AUDIT SCOPE / OTHER FILES structure.

[1.0.7]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.7

## [1.0.6] — 2026-05-09

### Fixed

- **Excel auto-converts SHA-256 hash column to scientific notation (data loss).** Excel detects 64-character hex strings as numeric and offers conversion that truncates to ~15 digits, breaking cross-server duplicate detection. SHA-256 cells are now wrapped in Excel text-formula syntax (`="<hash>"`) so Excel preserves them as literal strings. Other CSV consumers (Numbers, Google Sheets, programmatic parsers) see the formula syntax and parse correctly.
- **`latest/` symlink not updating after successful runs.** The atomic `ln -sfn ... && mv -f ...` pattern was failing silently on macOS (`mv -f` has historical quirks with symlink replacement). Replaced with a more robust `rm -f ... && ln -s ...` sequence inside a subshell that `cd`s to the workdir first so the relative target resolves correctly. Same fix applied to `audit-fleet.sh`'s `_fleet/latest` symlink.
- **CSV header row had unquoted commas and quotes inside column labels** like `XLSX: default sheet names (Sheet1, Sheet2, …)` and `DOCX: vague hyperlinks ("click here")`. Naive CSV parsers (e.g., `awk -F,` or non-text-qualified Excel imports) mis-split the header. Now properly escaped per RFC 4180.
- **HTML report's category-filter chips, column-header sort, and search input were all silently broken.** PDF date metadata (Adobe's format `D:YYYYMMDDHHMMSS-08'00'`) contains single quotes that broke the JS string literal `JSON.parse('...')` used to embed the row data. The whole IIFE crashed, so chips, sort, and search never wired up. Fixed by moving the data into a separate `<script type="application/json" id="filecap-data">` block — the JSON now sits in its own script tag where single quotes (and any other JS-string-special characters) are safe.

### Changed

- **`Last modified` column renamed to `Date published` and moved to position 4 in the CSV/HTML.** For most accessibility-audit use cases the file's filesystem modification time IS its publish date (files aren't typically edited after upload). The column was previously buried around position 12 — now it's right after Server IP so it's visible without scrolling. Internal field name (`modifiedAt`) is unchanged for programmatic consumers.
- **HTML report now default-sorts by Date published, descending (most recent first).** Previously the report opened in alphabetical filename order. Auditors typically want to see new uploads first; the default sort matches that expectation. The column header still works for click-to-resort.

[1.0.6]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.6

## [1.0.5] — 2026-05-09

### Added

- **Domain preflight verification for `--public-url-base`.** The audit scripts now HEAD-check the public URL prefix before running the scan. If unreachable (typo, network restrictions, or site down), a yellow warning prompts the auditor to confirm whether to proceed. Same check applied per-server in `audit-fleet.sh`'s pre-validation pass.
- **Category filter chips in HTML report.** New chip row at the top of the report (`[All]`, `[PDFs]`, `[Office docs]`, `[Images]`, etc.) with counts. Clicking a chip filters the table to that category. Combines with the existing search input. Print stylesheet hides the chips on paper output.
- **Optional `--audit-link-pattern` flag.** Accepts a URL template with placeholders (`{publicUrl}`, `{sha256}`, `{filename}`, `{path}`, `{serverIp}`, `{siteName}`) — rendered as a clickable "View audit →" column in the HTML report. Lets auditors jump from a row in the filecap inventory to the corresponding page on an external audit service (audit.icjia.app or otherwise). The audit scripts prompt for it interactively, accept it as a 7th positional arg, and `audit-fleet.sh` CSV format gains an optional 7th column. See [filecap issue #100](https://github.com/ICJIA/filecap-cli/issues) and the related issue at https://github.com/ICJIA/file-accessibility-audit/issues/9 for the broader integration plan.

[1.0.5]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.5

## [1.0.4] — 2026-05-09

### Fixed

- **`audit-summary.txt` had blank Server / Source location fields and missing Website line.** `runReport` was not passing the inventory header to `writeSummary`. The header data was correctly captured in `inventory.ndjson` but never reached the summary text. Fixed by passing `header` through.
- **Tilde (`~`) paths failed the remote path check in `audit-remote.sh` and `audit-fleet.sh`.** Inner single quotes around the path in the SSH `test -d '${path}'` call prevented the remote shell from expanding `~`. Removed the inner quotes so tilde paths now work correctly. Note: paths containing spaces or shell metacharacters should still be passed as absolute paths.

### Added

- **Public URL column.** New `--public-url-base <url>` flag for `filecap scan` records the URL prefix where files are publicly served (e.g., `https://example.com/uploads`). The CSV and HTML reports gain a "Public URL" column with one full URL per file. In the HTML report, the URL is rendered as a clickable link that opens the file in a new tab. The audit scripts prompt for it interactively (press Enter to skip), accept it via positional arg or env var, and the fleet script CSV format gains an optional 6th column.
- **Scrollable HTML table with sticky first column.** The 58-column HTML report is now wrapped in a horizontally-scrolling container so the rightmost columns are reachable on any screen. The first column ("Server") stays pinned in place while you scroll, so you don't lose context.

[1.0.4]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.4

## [1.0.3] — 2026-05-09

### Added

- **Self-version-check in audit scripts.** `audit-remote.sh` and `audit-fleet.sh` now compare their SHA-256 against the latest version on GitHub at startup. If outdated, a yellow warning prints the exact `curl` command to re-download. Non-blocking; skipped silently if offline. Override with `--no-version-check` flag or `SKIP_VERSION_CHECK=1` env var.
- **Timestamped runs preserve audit history.** Each run of `audit-remote.sh` now produces output in `~/filecap-audits/<server-ip>/runs/<utc-timestamp>/`, with a `latest/` symlink at the workdir root pointing to the most recent successful run. The shared `mirror/` directory stays at the workdir root and benefits from rsync's incremental transfers. Fleet runs follow the same pattern: each fleet audit goes to `~/filecap-audits/_fleet/<timestamp>/` with a `_fleet/latest` symlink. No more clobbering previous reports.
- **Optional `--site-name` flag.** New CLI option for `filecap scan` that records a human-friendly website nickname (e.g., DVFR, i2i, vpp) in the inventory header's `metadata.siteName`. Surfaces in CSV (new "Website" column at position 2), HTML (page title and summary box), audit-summary.txt (top-level "Website:" line before the Server line), and the fleet MANAGER_SUMMARY.txt per-server table (new "Site" column at the front). The audit scripts prompt for it interactively (press Enter to skip), accept it via positional arg (5th arg), and the fleet script's CSV format gains an optional 5th `site_name` column. Existing 4-column fleet CSVs and inventories without `siteName` remain valid.
- **README rewritten for non-technical audiences.** Front-loaded with audience-targeted TL;DRs (managers, developers, vendors/auditors, curious onlookers) and a "Just count the files, all right?" section that explains why filecap's per-file introspection matters for accurate vendor quotes. Added a Table of Contents and a "Quick start for managers" section with copy-pasteable handoff instructions. All existing technical sections preserved and audited for accuracy against the current shipped state: stale "stub" language removed from rollup/report CLI reference, CSV column count updated from 32 to 58, new introspection fields (PDF title/author/approxWordCount; DOCX headingLevelsUsed/wordCount/etc.; XLSX title/author/totalCells) added to field tables, artifact names updated to current (audit-file-list.csv, audit-summary.txt), Node.js engine requirement corrected to 20+, NDJSON header example updated with all required fields, and new troubleshooting entries added for pdfjs-dist warnings, EOL-Ubuntu glibc, and rsync --info=progress2.

[1.0.3]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.3

## [1.0.2] — 2026-05-09

### Added

- **Audit automation scripts** in `examples/`: `audit-remote.sh` (single-server interactive workflow) and `audit-fleet.sh` (multi-server orchestrator with consolidated `MANAGER_SUMMARY.txt`). Portable to macOS and Linux. Auditors can curl them directly from `https://raw.githubusercontent.com/ICJIA/filecap-cli/main/examples/<script>.sh` and run without cloning the repo. The scripts auto-detect Node version on the remote: native filecap scan over SSH if Node ≥20, rsync-and-scan-locally otherwise (for the EOL-Ubuntu fleet). Inventory paths are rewritten post-scan to reflect the source server, not the auditor's local machine.
- README "For auditors: self-contained audit scripts" section with download URLs, input prompts documented, output structure, and the rationale behind local-mode scanning for older Ubuntu fleets.
- **Optional HTML report.** `filecap report --html` writes a self-contained `audit-file-list.html` alongside the CSV. Same columns as the CSV; rendered as a sortable (click-header), filterable (search input), and print-friendly table with no external dependencies. Image-only PDFs are highlighted with a yellow row background; flagged filenames get a left accent border. `writeHtml` is exported from the package main. The `filecap_report` MCP tool gains an optional `html: boolean` parameter. Both audit scripts prompt the auditor to opt in and propagate the flag through.
- **Additional metadata extraction:** PDF introspection now surfaces `title`, `author`, `subject`, `keywords`, `modificationDate`, and `approxWordCount`. DOCX introspection adds `title`, `author`, `lastModifiedBy`, `wordCount`, `paragraphCount`, and `headingLevelsUsed` (sorted array of heading levels actually used, enabling gap detection). XLSX introspection adds `title`, `author`, and `totalCells`.
- **Auditor-readable CSV and HTML.** All CSV and HTML column headers are now human-facing labels (e.g. "File name", "Needs remediation", "PDF: page count") instead of raw field names. Boolean values render as `Yes`/`No` instead of `true`/`false`.
- **Renamed report artifacts** for clarity: `files.csv` → `audit-file-list.csv`, `files.html` → `audit-file-list.html`, `SUMMARY.txt` → `audit-summary.txt`. A new `README.txt` is generated in every report directory explaining each artifact and how to locate files on the server.
- **Enriched `audit-summary.txt`** with manager-friendly sections: PDFs (OCR needs, tag status, form fields, page counts), Word documents (heading coverage, alt-text coverage, table headers, vague links, word count), Excel files (chart/image/merge counts), Legacy Office, per-file-type breakdown, filename quality metrics, top-5 largest files, and "What this means for the audit" observation bullets. Consolidated reports include a per-server breakdown table.
- **Enhanced preflight in bash scripts:** Both scripts now verify Node 18+ locally (warn on <20), check read access on the remote path (not just existence), and validate local free disk space before starting an rsync. `audit-fleet.sh` adds a fleet-wide pre-validation pass that SSH-probes every server before beginning any audit work — showing a status table and aborting cleanly if 0 servers are reachable.
- **Windows/WSL2 subsection** in README explaining how Windows-based auditors can run the bash scripts via WSL2.

[1.0.2]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.2

## [1.0.1] — 2026-05-09

### Changed

- **Docs only.** Expanded README MCP section to cover five clients (Claude Desktop, Claude Code, Cursor, Windsurf, Continue) and switched all configuration examples to `@icjia/filecap@latest` so the MCP host re-checks the registry on each spawn. Added a "How auto-update works" subsection explaining the trade-off between `npx --yes @latest` (auto-update with ~1–3s startup cost) and `npm install -g` (manual update, zero startup cost).

[1.0.1]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.1

## [1.0.0] — 2026-05-09

### Added

- **MCP server.** New command `filecap mcp` runs an stdio MCP server exposing four tools (`filecap_scan`, `filecap_rollup`, `filecap_report`, `filecap_query_inventory`) for AI agents (Claude Desktop, Claude Code, etc.).
- New programmatic exports: `runMcp`, `TOOL_DEFINITIONS`, `dispatchTool`, `queryInventory`.
- Read-only `queryInventory` helper for filtering/sorting inventories programmatically without going through the MCP server.

### Changed

- Version bumped to **1.0.0** to mark feature-complete v0.x → v1.0 milestone. The v0.x line covered scan (Phase 1), PDF introspection (Phase 2), Office introspection (Phase 3), filename flagging (Phase 4), rollup (Phase 5), report (Phase 6), and now MCP server (Phase 7). The full inventory-to-handoff pipeline is functional end-to-end.

[1.0.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v1.0.0

## [0.6.0] — 2026-05-08

### Added

- **Report command.** `filecap report <inventory.ndjson> -o ./report/` consumes a single-instance OR consolidated inventory NDJSON and emits the vendor handoff package: `files.csv` (32-column work-order), `SUMMARY.txt`, `largest_files.txt`, `flagged_filenames.txt`, `duplicate_hashes.txt`, `pdf_image_only.txt`.
- 32-column CSV writer per design-doc spec, with stable column order, header row, and pipe-separated `flags` cell.
- New programmatic exports: `runReport`, `writeCsv`, `CSV_COLUMNS`, `writeSummary`, `writeLargestFiles`, `writeFlaggedFilenames`, `writeDuplicateHashes`, `writePdfImageOnly`, `humanizeBytes`, `csvCell`.

[0.6.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v0.6.0

## [0.5.0] — 2026-05-08

### Added

- **Multi-server rollup.** New command `filecap rollup <files...>` merges per-server NDJSONs into a consolidated NDJSON with content-duplicate detection. Each entry in the output gets `serverName` (source) and `duplicateOf` (canonical copy reference, or null). Canonical entry: oldest `modifiedAt`; alphabetical tiebreaker on `serverName`.
- New consolidated NDJSON schemas: `consolidatedHeaderSchema` (with `metadata.sources` array of source inventory headers), `consolidatedEntrySchema` (entry + serverName + duplicateOf), `consolidatedFooterSchema` (with `totalUniqueHashes`, `totalDuplicateGroups`, `bytesSavedIfDeduped` cross-instance stats).
- `--strict` flag on `filecap rollup`: fails on schema mismatch or missing footer (default: warn and skip).
- New programmatic exports from package main: `runRollup`, `rollupInventories`, `pickCanonical`, plus the three consolidated schemas.

[0.5.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v0.5.0

## [0.4.0] — 2026-05-08

### Added

- **Filename heuristic flags.** Every entry's `flags[]` array is now populated with applicable flags from the Phase 4 taxonomy: `scanned-name-pattern` (Scan_*, IMG_*, Document\d+, Untitled*, all-digit, DOC\d+, FAX*, "Microsoft Word - *"), `filename-has-spaces`, `filename-non-ascii`, `filename-long` (>200 chars). Pure regex matching against the basename — no new runtime dependencies.
- New programmatic export from package main: `computeFilenameFlags(filename)`. Returns a sorted string array of applicable flags.

### Changed

- The orchestrator's entry construction switches `flags: []` to `flags: computeFilenameFlags(filename)`. Phase 1–3 entries had empty `flags[]` arrays; Phase 4 entries populate them. Backward-compatible at the schema level (still `z.array(z.string())`).

[0.4.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v0.4.0

## [0.3.0] — 2026-05-08

### Added

- **DOCX introspection** via `jszip` + `fast-xml-parser`. Each DOCX entry now carries: `hasHeadings`, `imageCount`, `altTextCoverage`, `tableCount`, `tablesHaveHeaders`, `hyperlinkCount`, `vagueLinkCount` (count of "click here" / "read more" anti-patterns), and `documentLanguage`.
- **XLSX introspection** via `exceljs`. Each XLSX entry now carries: `sheetCount`, `sheetNames`, `defaultSheetNameCount` (count of `Sheet1`/`Sheet2`/etc.), `hasHeaderRows`, `mergedCellCount`, `hasCharts`, `hasImages`.
- **Legacy Office presence flag.** `.doc`, `.ppt`, and `.xls` files now carry an `introspection` block with `kind: "office-legacy"` and the specific format. No deep parsing; the marker indicates the file needs manual review.
- **Discriminated-union schema.** `entrySchema.introspection` is now `z.discriminatedUnion("kind", [...])` over `pdf`, `docx`, `xlsx`, `office-legacy`. Each variant has its own typed shape.
- New schema exports: `docxIntrospectionSchema`, `xlsxIntrospectionSchema`, `legacyOfficeIntrospectionSchema`.
- New programmatic exports from package main: `introspectDocx`, `introspectXlsx`, `introspectLegacyOffice`.

### Known limitations

- PPTX is not introspected in Phase 3 — entries with `extension: "pptx"` get no introspection block. Deferred to a future phase.
- DOCX language detection reads `word/styles.xml` first; some documents place language declarations elsewhere (e.g., `word/document.xml` `sectPr`). Coverage is best-effort; rare DOCX variants may report no language even when one is declared. A corrupt `word/styles.xml` falls through gracefully to the `document.xml` fallback (Phase 3 review fix).
- DOCX heading detection looks for style names matching `Heading[1-9]`; corporate templates with custom heading style names (e.g., `ChapterTitle`, `Titre 1`) will not be detected.
- XLSX chart detection uses `worksheet.model.charts`, which is populated inconsistently across `exceljs` versions. False negatives are possible for files with charts.
- DOCX image alt-text coverage tests don't currently exercise the non-zero path (the `docx` library's image API is awkward for runtime fixtures); the code path is verified against real-world Word documents.

[0.3.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v0.3.0

## [0.2.0] — 2026-05-08

### Added

- **PDF introspection** via `pdfjs-dist`. Each PDF entry now carries an `introspection` block with: `pageCount`, `hasTextLayer` + `textLayerCoverage`, `isImageOnly`, `hasTags`, `hasOutline`, `hasFormFields`, `hasSignatures`, `encrypted`, `documentLanguage`, `producer`, `creator`, `creationDate`, `pdfVersion`, and `isLinearized`.
- **Empty-on-failure handling.** When `pdfjs-dist` cannot parse a file (malformed, encrypted-without-password, exotic variant), the entry's `introspection` key is omitted entirely. The file row still appears with full filesystem stats; the footer's `introspectionFailures` count increments. The empty field itself is the signal: "this file needs a closer look."
- **`--no-introspect` CLI flag.** Skip introspection for fast triage scans (filesystem-only).
- **`--max-introspect-mb <n>` CLI flag** (default 200). Skip introspection for files larger than this — a parse-cost guard for pathological inputs.
- **Introspection dispatcher** (`src/introspect/index.js`). Routes by extension to the appropriate introspector; returns `null` for non-introspectable types or oversized files. Phase 3 will add DOCX/XLSX entries to the dispatcher.
- New schema export: `pdfIntrospectionSchema` (Zod) for validating introspection blocks. `entrySchema` now accepts an optional `introspection` field.
- New programmatic exports from package main: `introspect`, `introspectPdf`, `pdfIntrospectionSchema`.

### Changed

- The scan orchestrator now defaults to introspecting (`introspect: true` at the CLI layer); pass `--no-introspect` to opt out. Phase 1's behavior was equivalent to `--no-introspect`. **This is a user-visible default-behavior change between v0.1.0 and v0.2.0.**

### Known limitations

- Test fixtures don't currently cover tagged, encrypted, or signed PDFs (`pdf-lib` cannot synthesize them at runtime). The detection paths for these features are exercised against real PDFs in production use; we plan to add committed fixtures or alternative synthesis in a future patch.

[0.2.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v0.2.0

## [0.1.0] — 2026-05-08

### Added

- Initial design document at `docs/filecap-design.md`.
- Project metadata: `README.md`, `LICENSE` (MIT), `.gitignore`, `CHANGELOG.md`.
- `filecap scan <directory>` command — recursive filesystem walk, per-file stats (size, mtime, extension), category derivation, optional SHA-256 hashing, and NDJSON output (header + entries + footer).
- `-o -` stdout-output convention: `filecap scan /path -o -` writes NDJSON to stdout, enabling SSH-piped multi-server orchestration without round-tripping files.
- Bounded concurrency for hashing via `p-limit`.
- Permission-denied handling: per-directory errors are captured and counted in the footer's `permissionDenials`; scan exits with code 3 (partial completion) when any directory was unreadable.
- TOCTOU resilience: files deleted between walk and stat are silently skipped; stat-level permission errors are counted alongside hash-level ones.
- Consistent error contract: `runScan` always returns `{exitCode, error?}`; never throws.
- Zod schemas validating header, entry, and footer NDJSON lines.
- Sample bash orchestrator at `examples/multi-scan.sh` for SSH-piped multi-server scans.
- Publish script (`./publish`) for npm releases.

### Design decisions locked

- **Output format.** NDJSON (`.ndjson`) for both single-instance scans and consolidated rollups.
- **Rollup canonical-row semantics.** One row per physical copy; content-duplicates carry a `duplicateOf` field (oldest `modifiedAt` wins; alphabetical tiebreaker on `serverName`). *(Implementation pending Phase 5.)*
- **PDF introspection failure handling.** Empty fields, no stub error block. *(Implementation pending Phase 2.)*
- **Hash algorithm.** SHA-256 via Node native `crypto`.
- **Vendor workflow.** Out of scope. filecap is a pure inventory tool.
- **CSV column additions.** `category`, `remediable`, `documentLanguage`, `pdfHasFormFields`, `pdfHasSignatures`, `pdfProducer`, `pdfCreator`, `pdfCreationDate`, `docxImageCount`. *(Implementation pending Phase 6.)*

[0.1.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v0.1.0
