# Single-site update — `run-site-update.sh` — design

**Date:** 2026-06-28
**Status:** approved (brainstorming), ready for implementation
**Depends on:** the existing fleet pipeline (`examples/audit-fleet-auto.sh`), `web-rollup`, and the v1.36.0 file-accessibility work (`A11Y_SCORE_EXCLUDE_SLUGS`).

## Problem

Remediation happens **one site at a time** — a site gets a batch of work (inaccessible
PDFs fixed in place, or moved to the long-term archive), and its stats need to be
refreshed and republished. Today the only refresh path is `run-full-audit.sh`, which
re-scans **every** site over SSH and re-enriches the whole fleet — far more work than
updating the one site that changed.

## Goal

A command that refreshes the file stats of **one or a few named sites** and rebuilds +
deploys the fleet bundle, leaving every other site's numbers exactly as cached.

Because `web-rollup` already rebuilds the bundle from each site's *cached*
`~/filecap-audits/<slug>/latest/inventory.audited.ndjson`, only the named site(s) need
re-processing; all other cards/detail pages come from cache unchanged.

### The archive workflow (primary use case)

Moving "ADA Title II exception" PDFs from a content site into `archive.icjia.cloud`
changes **both** sites: the source loses files (and its average score **improves** as the
inaccessible PDFs leave), and the archive gains them (its **file count grows**). So the
command must accept a **list** of sites and refresh them together in one rebuild. The
archive's accessibility score stays **"N/A — archive"** via the existing
`A11Y_SCORE_EXCLUDE_SLUGS = ["archive-prod"]` exclusion; only its count moves.

## Interface

A new top-level `run-site-update.sh`, mirroring `run-site-scores.sh` (which already does a
light single-site *website-score* refresh):

```
./run-site-update.sh i2i.illinois.gov                       # one site; PROMPTS to also update the archive (default Y)
./run-site-update.sh i2i.illinois.gov archive.icjia.cloud   # source + archive together (no prompt — archive named)
./run-site-update.sh i2i.illinois.gov --no-archive          # one site, do NOT touch the archive
./run-site-update.sh i2i.illinois.gov --no-deploy           # build locally, do not deploy
./run-site-update.sh i2i.illinois.gov --scores-only         # skip SSH re-scan; re-score PDFs only (no archive prompt)
./run-site-update.sh --help
```

- Positional args: one or more **URLs or slugs** (any mix).
- Flags: `--scores-only`, `--no-deploy`, `--no-purge`, `--no-archive`, `--help`. Same
  deploy/purge semantics as `run-full-audit.sh` (autodeploy honored from
  `webRollup.autoDeploy`).

### Archive auto-prompt

Remediation typically **moves excepted PDFs into `archive.icjia.cloud`**, so updating a
content site almost always changes the archive's file count too. After resolving the named
targets, if the archive (`archive.icjia.cloud` → `archive-prod`) is **not already** among
them and at least one named target is a non-archive content site, the script prompts:

> `Also update the archive (archive.icjia.cloud), where excepted files land? [Y/n]`

**Default Y** (Enter / non-interactive stdin accepts) → the archive is added to the targets
and gets a **full refresh** (its count reflects the newly-archived files; its accessibility
score stays "N/A — archive"). **N** → proceed without it. The prompt is **skipped** when:
the archive is explicitly named already; `--no-archive` is passed; the only target *is* the
archive; or in `--scores-only` mode (in-place PDF fixes mean no files moved to the archive).
The archive's identity (`archive.icjia.cloud`) is defined once at the top of the script and
resolved through the same resolver.

## Component 1 — URL → site resolver (new, pure, unit-tested)

`src/config/resolve-site.js`, exposed as a CLI subcommand `filecap resolve-site <query>`.

Users know the URL, not always the internal slug. The resolver normalizes input and finds
the owning site.

- `normalizeHost(input) -> string` — strip scheme, path, query, trailing slash, and a
  leading `www.`; lowercase. Accepts full URLs (`https://i2i.illinois.gov/x`) and bare
  hosts (`i2i.illinois.gov`).
- `resolveSite(query, sites) -> { status: "match", site } | { status: "ambiguous", sites } | { status: "none" }`
  — pure; takes the sites array. A site matches when the normalized query equals (case-
  insensitively) any of: its **slug** (`name`), **nickname** (`siteName`), or the
  **normalized host** of `siteUrl`, `publicUrlBase`, or any `domainAliases` entry.
  Collect the **set** of matching slugs: size 1 → `match`; > 1 → `ambiguous`; 0 → `none`.

**Known ambiguity:** four apps share the front-end host `icjia.illinois.gov`
(`icjia-agency-prod`, `ilfvcc-api-prod`, `ari-api-prod`, `researchhub-prod`). A bare
`icjia.illinois.gov` is `ambiguous`; each has a **unique file-server host**
(`agency.icjia-api.cloud`, `ilfamilyviolence.icjia-api.cloud`, `ari.icjia-api.cloud`,
`researchhub.icjia-api.cloud`) to disambiguate.

**CLI `filecap resolve-site <query>`:** loads sites.json (honoring `--sites-file` /
`FILECAP_SITES_FILE`), prints the resolved **slug** to stdout and exits 0 on `match`; on
`ambiguous`/`none` prints a candidate list (slug + file-server host) to **stderr** and
exits non-zero. The shell script captures stdout and aborts on non-zero **for every arg
up front**, so a bad/ambiguous URL stops the run before anything is scanned.

## Component 2 — `run-site-update.sh` orchestration

Resolve all args first (abort on any failure). Then, in **full** mode, per resolved site:

1. **Scan (scoped):** write a temp `sites.json` containing only the resolved site(s) and
   run the scan against it. `audit-fleet.sh` already accepts a positional sites file
   (`./audit-fleet.sh <sites.json>`), driven non-interactively under `expect` exactly as
   `audit-fleet-auto.sh` Stage 1 does. Produces fresh
   `~/filecap-audits/<slug>/latest/inventory.ndjson` for the target(s) only.
2. **References:** `filecap references <slug>` for each target → fresh sidecars (persisted
   to each `latest/references-sidecar.ndjson`).
3. **Cross-references (fleet-wide, cheap):** `filecap cross-references` over **all** cached
   inventories, using the fresh target sidecars **plus** every non-target site's persisted
   `latest/references-sidecar.ndjson`, so cross-site file links stay consistent (e.g. a
   page on site A that links a file now moved to the archive).
4. **Audits:** `filecap audits` over each target's augmented inventory. The global audit
   cache (`~/.filecap/audit-cache.json`) means only *changed* PDFs hit the network
   (moved-to-archive files are cache misses at their new URL; unchanged files are instant).

**`--scores-only` mode:** skip steps 1–3 entirely; run only step 4 (re-audit each target's
existing `inventory.cross-ref.ndjson`). For in-place PDF fixes with no file moves — no SSH.
If a target has **no cached inventory** yet (no prior full run), **prompt** per target:

> `<slug> (<url>) has no cached inventory — do a full scan + refresh for it first? [Y/n]`

**Default Y** (Enter accepts; a non-interactive/EOF stdin also takes the default). On **Y**,
run the full per-site pipeline (steps 1–4) for that target, then continue; on **N**, abort
the run. Targets that *do* have a cached inventory stay on the fast scores-only path.

Then **once**, regardless of mode:

5. **Rebuild + deploy:** `filecap web-rollup` over the **full** real `sites.json` (fresh
   target(s) + every other site from cache) → autodeploy unless `--no-deploy`.
6. **Purge:** keep newest run per site + newest rollup, unless `--no-purge` — identical
   rules to `run-full-audit.sh` (never touch `latest/`, `mirror/`, `_fleet/`).

## Error handling

- Any arg that resolves to `ambiguous`/`none` aborts the whole run before scanning, with
  the candidate list.
- A scan/reference/audit failure for one target is reported; the run continues to
  `web-rollup` only if at least one target refreshed (so a partial success still
  republishes), mirroring how the fleet script tolerates per-site failures.
- Same prerequisites as `run-full-audit.sh` (SSH keys, `expect`, Netlify login); the
  script does the same pre-flight checks.

## Testing

- **Unit (vitest), `src/config/resolve-site.js`:** host normalization (scheme/path/`www.`/
  trailing slash, bare host); match by slug, nickname, front-end host, file-server host,
  alias; the **ambiguous `icjia.illinois.gov` → 4 sites** case; no-match; de-dup (same site
  matched via two fields is one match, not ambiguous); the archive (`archive.icjia.cloud`).
- **CLI:** `filecap resolve-site` exit codes + stdout slug / stderr candidates.
- **Integration (manual, pre-merge):** a `--scores-only --no-deploy` dry run against real
  cached data (no SSH, no deploy) confirming the bundle rebuilds with the target refreshed
  and all other sites unchanged; then one real `--no-deploy` full run on a small site.

## Out of scope (YAGNI)

- No auto-detection of "which other sites were affected" — the user names them (the archive
  is named explicitly alongside the source).
- No change to `web-rollup`'s bundle filtering — it always rebuilds the full roster from
  cache; `--include-site`/`--exclude-site` are unrelated (they scope the *bundle*, not the
  refresh).
- No skip-audits-for-excluded-sites optimization — the archive is re-audited so its detail-
  page per-file score cells stay populated; the cache keeps it cheap.

## Implementation order

1. `src/config/resolve-site.js` + unit tests (TDD), `npm test` green.
2. `filecap resolve-site <query>` CLI subcommand (loads sites.json, prints slug / candidates).
3. `run-site-update.sh` — arg parse + resolver loop + temp-sites scan + references/
   cross-references/audits + `--scores-only` branch.
4. web-rollup + deploy + purge tail (lift the purge block from `run-full-audit.sh`).
5. `--scores-only --no-deploy` dry-run verification; then a small-site `--no-deploy` full run.
6. `--help`, README/CHANGELOG entry, version bump.
