# @icjia/filecap

**File inventory CLI for accessibility audit scoping.**

`filecap` walks a directory tree, introspects each file (PDFs, DOCX, XLSX), and produces a structured NDJSON inventory suitable for accessibility remediation scoping. The primary use case is generating per-server inventories of file stores (Strapi `/uploads` directories, general file servers) to hand to remediation vendors so they can produce a defensible, fixed-price quote on ADA Title II / WCAG 2.1 AA remediation work.

## Are you a...

- **Manager** running an organization that has to comply with accessibility law? → [Manager TL;DR](#tldr-for-managers)
- **Developer** evaluating this for technical fit? → [Developer TL;DR](#tldr-for-developers)
- **Accessibility vendor or auditor** receiving an inventory? → [Vendor / auditor TL;DR](#tldr-for-vendors-and-auditors)
- **Just curious** about what problem this solves? → [Curious-onlooker TL;DR](#tldr-for-the-curious)

---

## TL;DR for managers

You run a website. Like most websites, it hosts hundreds or thousands of uploaded documents — PDFs of meeting minutes, Word documents of policies, image attachments, spreadsheets. Federal accessibility law (ADA Title II / WCAG 2.1 AA) requires those files to be accessible to people with disabilities.

To budget the remediation work, you need to know what's actually there: file counts by type, which PDFs are scanned images (need OCR — often substantially more expensive than tagging born-digital PDFs), which Word docs lack heading structure, which tables are missing header rows, and so on.

`filecap` produces this inventory automatically. It walks your website's `/uploads` folder, parses every file, and writes a spreadsheet (CSV) plus an interactive HTML report with one row per file and detailed accessibility-relevant metadata. You hand the spreadsheet to a remediation vendor; they give you a fixed-price quote with confidence.

The included `audit-remote.sh` script automates the entire workflow against any server you have SSH access to. Auditors run one command, answer a few prompts, and get a vendor-ready deliverable. Works on macOS, Linux, and Windows (via WSL2). Free; open source.

**Three things you, as a manager, get out of this:**

1. A precise count of files needing remediation, with composition (not just `wc -l`).
2. A spreadsheet you can email to bid-out vendors without explanation.
3. Repeatability — re-run quarterly, see what changed.

As of 1.2.0, you can also publish the latest snapshot to a URL that your whole team can bookmark — one command bundles everything and deploys to Netlify. See [Publishing a fleet snapshot](#publishing-a-fleet-snapshot).

→ Skip to [Quick start for managers](#quick-start-for-managers) for handoff instructions.

---

## TL;DR for developers

Node.js CLI written in ESM, distributed via npm as `@icjia/filecap`. Walks a directory tree (concurrent-bounded), produces line-delimited JSON (NDJSON): a header line, one entry per file, a footer line. Each entry includes filesystem metadata + SHA-256 hash + format-specific introspection (pdfjs-dist for PDFs, jszip + fast-xml-parser for DOCX, exceljs for XLSX). 30-column CSV writer + self-contained dark-mode HTML report with sortable/filterable client-side JS. Cross-server rollup with content-duplicate detection via SHA-256.

Includes an MCP server (`filecap mcp`) exposing five tools for AI agents (Claude Desktop, Claude Code, Cursor, Windsurf, Continue): `filecap_scan`, `filecap_rollup`, `filecap_report`, `filecap_query_inventory`, `filecap_web_rollup`.

As of 1.2.0: `filecap web-rollup` bundles the most recent scan of every saved site into a static-site directory, ready for Netlify deployment (drag-and-drop, CLI, or Git-connected auto-deploy). Includes auto-generated `netlify.toml`, optional client-side SHA-256 password gate (`--password`), `--no-client-gate` for Netlify dashboard Site Password, and a `--deploy` flag that calls the Netlify CLI directly after the build.

Two distribution shapes: `filecap` CLI invoked directly via npx, plus standalone bash scripts (`audit-remote.sh`, `audit-fleet.sh`) auditors curl from GitHub raw URLs. The bash scripts handle SSH preflight, rsync mirroring (for older Ubuntu servers that can't run Node 20+), and post-scan path rewriting so the resulting CSV reflects source-server paths regardless of where filecap actually ran.

ESM-only. Node 20+ required. ~27 test files; 288 tests via vitest. Source under `src/`; entrypoint `bin/filecap.js`. License: MIT.

→ Skip to [Quick start](#quick-start) for installation and basic usage.

---

## TL;DR for vendors and auditors

You receive an `audit-file-list.csv` (14 columns, one row per file) with everything needed to scope and quote a remediation engagement:

- **Identification**: server name, website nickname, server IP, source folder on server, file location, full path, public URL, filename, extension, category.
- **Filesystem metadata**: size in bytes, last-modified timestamp, SHA-256 content hash (for cross-server dedup detection), duplicate-of reference.
- **PDF introspection**: page count, has-text-layer, image-only flag (signals OCR needed), tag presence, form fields, encryption, document language.
- **DOCX introspection**: has-headings, image count, alt-text coverage, table count, tables-have-headers, vague-link count ("click here", "read more").
- **XLSX introspection**: sheet count.
- **Office-legacy flag**: whether the file is in a legacy Office format (`.doc`, `.xls`, `.ppt`).

The "Server IP" and "Full file path on server" columns identify exactly where each file lives — you ssh into the server and download the file directly. Optionally accompanied by an `audit-file-list.html` rendering of the same data with sortable/searchable browser-based interface.

As of 1.2.0, the auditor can also publish the fleet snapshot to a Netlify URL for a shared web-based view — useful for review meetings where you navigate by clicking rather than filtering a spreadsheet.

Zero account creation; the inventory is a vendor-neutral structured file you can ingest into your own tooling.

→ Skip to [Report workflow](#report-workflow-phase-6) for the full output spec.

---

## TL;DR for the curious

filecap was originally built at ICJIA (the [Illinois Criminal Justice Information Authority](https://icjia.illinois.gov)) to inventory the document files on our agency's public-facing websites — PDFs of meeting agendas, annual reports, statutes, etc. Federal accessibility law requires those files to be reachable for screen-readers, keyboard navigation, and assistive technology, but figuring out exactly *which* files need *which* kind of work, across multiple servers, was a manual job that took weeks.

The tool is general-purpose. Any organization that hosts public-facing document repositories — government agencies, schools, libraries, nonprofits, businesses — can use it to scope their accessibility work. The output is a spreadsheet a remediation vendor can quote against, line by line.

The complexity in filecap exists because "is this PDF accessible?" is a much harder question than "does this file exist?" Answering it requires actually opening every file and inspecting its internal structure — see the [next section](#all-i-want-is-a-file-count-for-the-remediators-all-right-thats-it-just-do-it--why-filecap-is-more-than-wc--l) for why this matters.

→ See the project page on GitHub: https://github.com/ICJIA/filecap-cli

---

## "All I want is a file count for the remediators, all right? That's it. Just do it." — why filecap is more than `wc -l`

Imagine asking a remediation vendor for a quote. They say "I need to see the files first." You forward them a list of filenames and sizes. They reply: "Great — but how many are scanned PDFs vs born-digital? How many Word docs lack heading structure? How many tables are missing header rows? Without that detail, my quote will be the worst-case price for every single file."

That's why filecap exists. A simple `find . -type f` gives you filenames and sizes — but a vendor can't price accurately against that. They'll either give you a worst-case quote (you overpay), or insist on inspecting every file themselves (the audit takes weeks instead of hours).

filecap is built around one question: **what does a remediation vendor need to know, per file, to give a defensible fixed-price quote?** Every "complexity" in this tool answers a specific vendor question:

| Vendor question | What filecap captures |
|---|---|
| Is this PDF a scan (needs OCR — often substantially more expensive)? | `isImageOnly`, `hasTextLayer`, `textLayerCoverage` |
| Is this PDF already partly accessible? | `hasTags`, `documentLanguage` |
| Does this PDF need special handling? | `encrypted`, `hasFormFields`, `hasSignatures` |
| Is this Word doc structured for screen readers? | `hasHeadings` |
| Are tables marked up for accessibility? | `tableCount`, `tablesHaveHeaders` |
| Do images have alt text? | `imageCount`, `altTextCoverage` |
| Are hyperlinks descriptive? | `vagueLinkCount` (counts "click here", "read more", etc.) |
| Are spreadsheets navigable for screen readers? | `xlsxSheetCount` |
| Do the same files appear on multiple servers? | `sha256` content hash + `duplicateOf` cross-server linking |
| Are filenames human-readable? | filename heuristic flags |

**The cost of NOT having this information is often substantially greater than the cost of running filecap.** Scanned PDFs typically cost vendors substantially more to remediate than born-digital ones, because OCR + tagging is an order of magnitude more work than tagging alone. If your inventory has 100 PDFs and 30 of them are scanned, knowing that distinction affects the vendor quote materially.

filecap takes a few seconds per file to extract this metadata — and produces a spreadsheet a vendor can price line by line. That's the whole game.

So: yes, "just count the files" is a one-liner. But the count alone won't help you budget for compliance. The detail is the point.

---

## Security audit

filecap is open source and tries to be transparent about its security posture.
The full audit findings and mitigations are in `docs/security/audit-2026-05-10.md`.
The summary below is for managers and auditors.

### What we protect

- **Auditor credentials.** SSH keys and any `FILECAP_AUDIT_TOKEN` env var never appear in any output, log, or transcript.
- **Bearer tokens (1.3.3+).** JWT bearer tokens for sites whose public URL requires auth (`intranet` in the ICJIA fleet) live in `~/.filecap/secrets.json` (mode `0600`) or a `FILECAP_BEARER_TOKEN_<SERVER_NAME>` env var. The token is fed to `curl` via stdin (`--header @-`), never argv, so it does not appear in `ps aux`. `secrets.json` is never bundled, never exported via the saved-sites menu, never sent to a remediator.
- **Shell injection.** Every variable interpolated into SSH remote-command strings is quoted via `printf '%q'` to prevent command injection from malicious site configs.
- **rsync symlink escape.** The `--no-links` flag prevents a compromised remote server from using symlinks to copy files outside the intended uploads directory.
- **The audit script** verifies its own SHA-256 against the GitHub `main` branch on every run (`--no-version-check` to skip).
- **The published npm package** uses `npm pack` + explicit-tarball publish with 2FA-required publishes.
- **Network transit** is HTTPS for the audit-remote.sh download (raw.githubusercontent.com), npm package install, and Netlify deployment.
- **Bundle privacy** uses Netlify's server-side Site Password (Pro plan) — gates **every** file in the bundle including the master CSV (verified HTTP 401 on both the index and `audit-file-list-master.csv` for the production deployment).
- **Output directory** `~/filecap-audits/<server-name>/` is created with mode 700 (user-only readable).
- **Configuration files** at `~/.filecap/config.json` (autoDeploy + deploySite) and `~/.filecap/secrets.json` (bearer tokens) — schema-validated on load via Zod (strict mode rejects unknown fields, catches typos). Both files mode-0600.
- **MCP scan path restriction.** Set `FILECAP_MCP_ALLOWED_PATHS` (colon-separated absolute paths) to restrict which directories an AI agent can scan.

### What we don't protect (residual risk)

- **The optional client-side password gate** (`--password` flag) is for "ward off the curious" only. The SHA-256 hash is unsalted and can be cracked offline with no rate limiting. Anyone with view-source can read all content. Do not use this gate for content you would not share publicly if the password were guessed. Use Netlify Site Password for actual enforcement.
- **A compromised remote server** could serve malicious PDFs that exploit pdfjs-dist parsing bugs (we depend on the upstream parser being patched). More rigorous isolation (sandbox/container) is future work.
- **Stolen `~/.filecap/sites.json`** reveals server hostnames and remote paths but no credentials (SSH keys are never stored here). File mode is 600.
- **The Netlify bundle URL** is not secret. `robots.txt` blocks search-engine indexing, but the URL could leak via browser history or link sharing. Netlify Site Password provides the recommended protection.
- **Initial `curl audit-remote.sh` download.** The self-version-check detects post-download tampering, but not initial-fetch tampering. For maximum verifiability, download from a specific commit SHA URL rather than `main`.

### Live deployment posture (1.5.6)

The ICJIA fleet snapshot at https://icjia-fleet-audit.netlify.app was reviewed for deployment-specific risks after the initial deploy:

| Check | Status |
|---|---|
| **TLS** | ✓ HTTP/2 over TLS 1.3 (Netlify managed certificate, auto-renewed) |
| **HSTS** | ✓ `strict-transport-security` set by Netlify edge |
| **`robots.txt`** | ✓ `User-agent: *` + `Disallow: /` — blocks every path for every compliant crawler |
| **`X-Robots-Tag`** | ✓ `noindex, nofollow` on all HTML pages |
| **CSV serving** | ✓ `Content-Disposition: attachment` + `Cache-Control: max-age=3600`; Netlify Site Password gates these too (returns 401 to unauthenticated requests) |
| **Site Password gate** | ✓ Netlify Pro Site Password set via dashboard — server-side enforcement covers every file (verified HTTP 401 on `/`, `/audit-file-list-master.csv`, and a per-site report) |
| **Security headers (all paths)** | ✓ `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` |
| **Deploy previews** | Netlify deploy preview URLs inherit the site password setting by default; no separate exposure |
| **Search engine indexing** | Belt-and-suspenders: robots.txt blocks crawlers; `X-Robots-Tag` blocks indexing of any page that gets crawled anyway; the URL pattern is non-discoverable (no inbound links from public sites); password gate blocks content delivery regardless |
| **Bundle URL secrecy** | URL is not secret; could leak via browser history or link sharing. Site Password is the real protection. |

The deployment review did **not** find new findings beyond the 1.3.0 audit's residual-risk list. The Netlify Pro Site Password upgrade (compared to the 1.3.0 client-side gate) closes FC-2026-005 (unsalted-SHA-256 cracking risk) and FC-2026-014 (publicly-guessable bundle URL) — both were "documented" findings now mitigated by the server-side gate.

### Audit findings summary (1.3.0 baseline)

Findings below come from the 1.3.0 red/blue team audit. Versions 1.3.1 through 1.5.6 added features (bearer-token storage, master CSV, duplicates section, infographic hero, etc.) but did not change the core security posture of the original components. A full re-audit is not scheduled; see "Changes since 1.3.0" below for what's new and how each was reviewed.

| ID | Severity | Finding | Status |
|---|---|---|---|
| FC-2026-001 | Critical | Shell injection via REMOTE_PATH in SSH scan commands | Fixed in 1.3.0 |
| FC-2026-002 | Critical | Shell injection via path in SSH test/find/du commands | Fixed in 1.3.0 |
| FC-2026-003 | Moderate | rsync follows remote symlinks (symlink escape) | Fixed in 1.3.0 |
| FC-2026-004 | Moderate | MCP server has no scan-path allowlist | Fixed in 1.3.0 |
| FC-2026-005 | Moderate | Unsalted SHA-256 password gate (cracking risk underdocumented) | Fixed in 1.3.0 (docs) |
| FC-2026-006 | Moderate | sitesFile path not validated (info leakage via error messages) | Fixed in 1.3.0 |
| FC-2026-007 | Moderate | sites.json not schema-validated on load | Fixed in 1.3.0 |
| FC-2026-008 | Moderate | HTML XSS coverage verification and regression tests | Fixed in 1.3.0 |
| FC-2026-009 | Low | Initial curl download not verifiable at fetch time | Documented |
| FC-2026-010 | Low | npx --yes accepts any latest version (supply-chain) | Documented |
| FC-2026-011 | Low | Audit output directory permissions not enforced | Fixed in 1.3.0 |
| FC-2026-012 | Low | pdfjs-dist parsing-attack surface | Accepted (mitigated by isEvalSupported:false) |
| FC-2026-013 | Low | jszip/exceljs zip-slip surface | Verified safe (in-memory only); documented |
| FC-2026-014 | Low | Netlify bundle URL publicly guessable | Documented |
| FC-2026-015 | Low | CSP header missing from netlify.toml | Deferred (inline scripts require unsafe-inline) |
| FC-2026-016 | Note | Client-side gate is not real security (by design) | Documented |
| FC-2026-017 | Note | Inventory NDJSON contains server metadata | Accepted (required for vendor work-order) |

### Changes since 1.3.0 (security-relevant)

| Version | Change | Security implication | Mitigation |
|---|---|---|---|
| 1.3.1 | `audit-fleet.sh` auto-reads `~/.filecap/sites.json` | No new surface — same data the saved-sites menu already exposed | sites.json mode-0600, schema-validated; bundle workflow safe for sharing |
| 1.3.2 | `~/.filecap/config.json` for `webRollup.autoDeploy` | New file at `~/.filecap/` | Schema-validated, mode-0600; contains a Netlify site name (not a secret) |
| 1.3.3 | Bearer-token support via `~/.filecap/secrets.json` | New credential at rest | Mode-0600, never bundled/exported; env-var override for users who prefer 1Password CLI / direnv; token fed to curl via stdin (`--header @-`), never argv |
| 1.4.0 / 1.4.1 | Trimmed CSV/HTML to 14 columns; click-and-drag pan JS | No new surface — drag-pan is pointer-events only, no remote requests | XSS test suite (FC-2026-008) regression-covers the new render path |
| 1.5.0 | Cross-server duplicates section; `audit-file-list-master.csv` in bundle | Adds data-exposure surface (master CSV is a single ~7 MB file with every path on every server) | Mitigated by Netlify Site Password gate at deployment time (verified HTTP 401 on the master CSV) |
| 1.5.1 | `audit-file-duplicates.csv` (per-occurrence) in bundle | Same data-exposure surface, smaller file | Same mitigation |
| 1.5.2–1.5.6 | Visual / UX changes (table styling, infographic hero, total in heading) | No new security surface | n/a |

### How to report a security issue

Email the audit administrator or open a **private** GitHub Security Advisory at
`https://github.com/ICJIA/filecap-cli/security/advisories/new`.
**Do not open a public GitHub issue for security bugs.**
Acknowledged within 5 business days.

### How to verify the audit yourself

```bash
cat docs/security/audit-2026-05-10.md
npm audit
npx vitest run test/report-html.test.js
npx vitest run test/mcp-tools.test.js
npx vitest run test/web-rollup.test.js
```

---

## Table of contents

- [Are you a...](#are-you-a)
  - [TL;DR for managers](#tldr-for-managers)
  - [TL;DR for developers](#tldr-for-developers)
  - [TL;DR for vendors and auditors](#tldr-for-vendors-and-auditors)
  - [TL;DR for the curious](#tldr-for-the-curious)
- ["All I want is a file count for the remediators..."](#all-i-want-is-a-file-count-for-the-remediators-all-right-thats-it-just-do-it--why-filecap-is-more-than-wc--l)
- [Status](#status)
- [Quick start](#quick-start)
- [Quick start for managers](#quick-start-for-managers)
- [CLI reference](#cli-reference)
- [Multi-server workflow](#multi-server-workflow)
- [NDJSON output format](#ndjson-output-format)
- [What gets introspected](#what-gets-introspected)
- [Filename flags](#filename-flags-phase-4)
- [Rollup workflow](#rollup-workflow-phase-5)
- [Report workflow](#report-workflow-phase-6)
- [MCP server](#mcp-server-phase-7)
- [For auditors: self-contained audit scripts](#for-auditors-self-contained-audit-scripts)
- [Publishing a fleet snapshot](#publishing-a-fleet-snapshot)
- [What filecap does not do](#what-filecap-does-not-do)
- [Troubleshooting](#troubleshooting)
- [License](#license)
- [Related tools](#related-icjia-tools)

---

## Status

**v1.5.7 shipped.** The full inventory pipeline `scan → rollup → report → web-rollup → deploy` is end-to-end functional. Bundle includes cross-server duplicates detection (1.5.0) with a manager-friendly infographic hero (1.5.5), a master CSV combining every file from every server (1.5.0), a per-occurrence duplicates CSV for pivot in Excel (1.5.1), and visual consistency across every data table in the app (1.5.6). All artefacts deployable to Netlify with one command via the `webRollup.autoDeploy` config flag (1.3.2). Bearer-token support for sites whose public URL requires JWT auth (1.3.3, mode-0600 `~/.filecap/secrets.json`).

| Phase | Version | Status | Deliverable |
|---|---|---|---|
| 1 | v0.1.0 | shipped | Core scan — recursive walk, hashing, NDJSON output |
| 2 | v0.2.0 | shipped | PDF introspection (image-only, tags, signatures, language) |
| 3 | v0.3.0 | shipped | Office introspection (DOCX, XLSX, legacy flag) |
| 4 | v0.4.0 | shipped | Filename flagging |
| 5 | v0.5.0 | shipped | Multi-server rollup |
| 6 | v0.6.0 | shipped | CSV reporter and summary artifacts |
| 7 | v1.0.0 | shipped | MCP server entry point |
| 8 | v1.0.1 | shipped | MCP client docs (Claude Desktop, Claude Code, Cursor, Windsurf, Continue) |
| 9 | v1.0.2 | shipped | Audit automation scripts, HTML report, enhanced metadata, auditor-readable output |
| 10 | v1.0.3 | shipped | Self-version-check, timestamped runs, `--site-name` flag, README overhaul |
| 11 | v1.1.0 | shipped | Column-set slim, audit.icjia.app integration removed |
| 12 | v1.2.0 | shipped | `filecap web-rollup` — static-site bundle with Netlify amenities; `filecap_web_rollup` MCP tool |
| 13 | v1.3.0 | shipped | Red/blue team security audit (17 findings, all Critical and Moderate fixed) |
| 14 | v1.3.x | shipped | Auto-detected `sites.json` for fleet script; opt-in `~/.filecap/config.json` `webRollup.autoDeploy`; bearer-token support (`~/.filecap/secrets.json`) |
| 15 | v1.4.x | shipped | CSV/HTML deliverable trimmed to 14 columns; click-and-drag horizontal pan on every table |
| 16 | v1.5.x | shipped | Cross-server duplicates with action explainer; master CSV + duplicates CSV in bundle; infographic hero; table-styling consistency; "Back to fleet index" navigation on per-site detail pages; footer links to GitHub + CHANGELOG |
| — | vNext | deferred | Strapi-aware mode (separate package); content-type sanity check on URL preflight |

### Production deployment

The ICJIA fleet snapshot is deployed at:

**https://icjia-fleet-audit.netlify.app**

The site is **password-protected** (Netlify Pro Site Password — server-side enforcement, gates every file including the CSVs). The current password is held by ICJIA's IDS (Innovation and Digital Services) team — request access by emailing IDS at ICJIA. The password is rotated periodically; if a previously-shared password stops working, ask IDS for the current one.

Deploy mechanics: `filecap web-rollup` automatically pushes to this Netlify site whenever `webRollup.autoDeploy: true` is set in `~/.filecap/config.json` (with `deploySite: "icjia-fleet-audit"`). To force a fresh deploy after a new audit, run `./examples/audit-fleet.sh && filecap web-rollup`. No `--deploy` flag needed.

## Quick start

```bash
npx --yes @icjia/filecap scan /var/strapi/uploads
# writes filecap-<hostname>.ndjson in cwd
```

The output is line-delimited JSON: one header line, one line per file, one footer line.

## Quick start for managers

If you're handing this off to an auditor or accessibility coordinator, copy the block below verbatim. They have everything they need.

> **For the auditor (single server):**
>
> 1. Use macOS, Linux, or Windows with WSL2/Ubuntu (see [Windows: the situation](#windows-the-situation) below). On Windows, run everything inside WSL2 — never PowerShell, Command Prompt, Git Bash, or PuTTY.
> 2. Install Node.js 20+ (https://nodejs.org).
> 3. Generate an OpenSSH key with `ssh-keygen -t ed25519` (skip if you already have one) and have your server admin authorize it on the target server. See [Setting up SSH access](#setting-up-ssh-access-one-time-before-your-first-run) for the full flow.
> 4. Run these three commands:
>
>    ```bash
>    curl -O https://raw.githubusercontent.com/ICJIA/filecap-cli/main/examples/audit-remote.sh
>    chmod +x audit-remote.sh
>    ./audit-remote.sh
>    ```
>
> 5. Answer the prompts (SSH user, server IP, path to uploads, optional website nickname).
> 6. The deliverable is at `~/filecap-audits/<server-name>/latest/report/`. Open `audit-file-list.csv` (Excel/Numbers/Sheets) or `audit-file-list.html` (any browser).
> 7. Email the entire `report/` folder to your remediation vendor.

> **For the auditor (multiple servers / fleet, with a sites.json bundle):**
>
> If you've been handed a `sites.json` file along with these instructions, it lists every site in the audit — you don't have to type any server details.
>
> 1. Same prerequisites as above (macOS/Linux/WSL2-Ubuntu, Node 20+, OpenSSH key authorized on every target server).
> 2. Drop the `sites.json` you received into `~/.filecap/`:
>
>    ```bash
>    mkdir -p ~/.filecap
>    mv /path/to/sites.json ~/.filecap/
>    ```
>
> 3. Download both scripts and run:
>
>    ```bash
>    curl -O https://raw.githubusercontent.com/ICJIA/filecap-cli/main/examples/audit-fleet.sh
>    curl -O https://raw.githubusercontent.com/ICJIA/filecap-cli/main/examples/audit-remote.sh
>    chmod +x audit-fleet.sh audit-remote.sh
>    ./audit-fleet.sh
>    ```
>
> 4. The fleet deliverable is at `~/filecap-audits/_fleet/latest/`. Email the whole folder (or the `consolidated-report/` subfolder) to your remediation vendor.

## CLI reference

### `filecap scan <directory>`

| Flag | Default | Description |
|---|---|---|
| `-o, --output <path>` | `filecap-<hostname>.ndjson` | Output path (use `-` for stdout) |
| `-s, --server-name <name>` | `os.hostname()` | Override server identifier in metadata |
| `--server-ip <ip>` | auto-detected | Override server IP (defaults to first non-loopback IPv4) |
| `--site-name <name>` | (none) | Optional website nickname (e.g., DVFR, i2i). Used as a human-friendly identifier alongside `--server-name`. |
| `--public-url-base <url>` | (none) | Base URL where files are publicly served. Adds a clickable Public URL column to CSV and HTML reports. |
| `--no-hash` | (off) | Skip SHA-256 hashing (much faster, but no dedup) |
| `--no-introspect` | (off) | Skip PDF/Office introspection (filesystem stats only) |
| `--max-introspect-mb <n>` | `200` | Skip introspection for files larger than this |
| `--include-ext <list>` | (all) | Comma-separated extensions to include |
| `--exclude-ext <list>` | (none) | Comma-separated extensions to exclude |
| `--concurrency <n>` | `4` | Parallel introspection/hashing workers |
| `--progress` | (off) | Emit progress to stderr |
| `--quiet` | (off) | Suppress non-error output |

**Exit codes.** `0` success, `1` argument or runtime error, `2` directory not readable, `3` partial completion.

### `filecap rollup <files...>`

Merge multiple per-server NDJSONs into a consolidated inventory.

| Flag | Default | Description |
|---|---|---|
| `-o, --output <path>` | `consolidated.ndjson` | Output path |
| `--strict` | (off) | Fail on schema mismatch or missing footer in any input (default: warn and skip) |

### `filecap report <inventory>`

Generate vendor handoff package (CSV + summary + flagged lists) from an inventory NDJSON (single-instance or consolidated).

| Flag | Default | Description |
|---|---|---|
| `-o, --output <dir>` | `./filecap-report-<ts>/` | Output directory |
| `--html` | (off) | Also write a self-contained sortable dark-mode HTML report (`audit-file-list.html`) |

### `filecap web-rollup`

Bundle the most recent scans of every saved site into a static-site directory ready for Netlify or any static host.

| Flag | Default | Description |
|---|---|---|
| `-o, --output <dir>` | `~/filecap-audits/_web-rollup/<ts>/` | Output directory |
| `--password <pw>` | (none) | Embed SHA-256 of this password in a client-side gate on every page |
| `--no-client-gate` | (off) | Skip the client-side gate JS. Use with Netlify dashboard Site Password for server-side enforcement. |
| `--deploy` | (off) | After building, run `netlify deploy --prod` automatically. Requires Netlify CLI installed and logged in. |
| `--deploy-site <site-id>` | (none) | Pass `--site <id>` to `netlify deploy` (for non-linked sites) |
| `--title <title>` | `"filecap fleet audit snapshot"` | Title shown on the index page |
| `--include-site <name...>` | (all sites) | Only bundle these site nicknames |
| `--exclude-site <name...>` | (none excluded) | Skip these site nicknames |
| `--sites-file <path>` | `~/.filecap/sites.json` | Override saved-sites JSON path |

When `--no-client-gate` is passed without `--password`, the bundle is open by design. When both are passed, `--password` is ignored (a warning is printed) — the bundle has no embedded gate and Netlify Site Password provides the protection.

### `filecap mcp`

Starts an stdio MCP server for use with AI agent clients (Claude Desktop, Claude Code, Cursor, etc.). No flags — configuration is handled by the client.

## Multi-server workflow

When scanning multiple servers from a single coordinator with SSH access:

```bash
ssh deploy@strapi-prod-01 "npx --yes @icjia/filecap scan /var/strapi/uploads -o -" > ./inventories/strapi-prod-01.ndjson
```

The `-o -` flag writes NDJSON to stdout, which SSH transports back. Compute (walk, hash, introspection) happens on the remote; only the inventory output crosses the network.

A sample bash orchestrator is in [`examples/multi-scan.sh`](examples/multi-scan.sh).

## NDJSON output format

Line-delimited JSON. First line: header (scan metadata). Last line: footer (summary stats). Lines in between: one per file.

**Example header:**

```json
{
  "schemaVersion": 1,
  "kind": "filecap-inventory-header",
  "metadata": {
    "siteName": "DVFR",
    "serverName": "dvfr-strapi-prod",
    "hostname": "dvfr-strapi-prod",
    "serverIp": "192.241.146.85",
    "scannedPath": "/var/strapi/uploads",
    "publicUrlBase": "https://dvfr.icjia-api.cloud/uploads",
    "scannedAt": "2026-05-09T14:23:11.000Z",
    "filecapVersion": "1.2.0",
    "nodeVersion": "20.19.0",
    "options": { "introspect": true, "hash": true, "maxIntrospectMb": 200, "concurrency": 4 }
  }
}
```

`siteName` and `publicUrlBase` are optional. Omitting them is valid. Old inventories without them continue to validate.

**Example file entry (PDF):**

```json
{
  "path": "2024/reports/annual-report.pdf",
  "absolutePath": "/var/strapi/uploads/2024/reports/annual-report.pdf",
  "filename": "annual-report.pdf",
  "extension": "pdf",
  "category": "pdf",
  "remediable": true,
  "sizeBytes": 4827193,
  "modifiedAt": "2024-03-12T09:14:22.000Z",
  "sha256": "e3b0c44...",
  "flags": [],
  "introspection": {
    "kind": "pdf",
    "pageCount": 48,
    "hasTextLayer": true,
    "textLayerCoverage": 1.0,
    "isImageOnly": false,
    "hasTags": false,
    "hasFormFields": false,
    "hasSignatures": false,
    "encrypted": false,
    "documentLanguage": "en-US"
  }
}
```

**Example file entry (DOCX):**

```json
{
  "path": "2024/policies/handbook.docx",
  "absolutePath": "/var/strapi/uploads/2024/policies/handbook.docx",
  "filename": "handbook.docx",
  "extension": "docx",
  "category": "office-document",
  "remediable": true,
  "sizeBytes": 152340,
  "modifiedAt": "2024-06-15T13:00:00.000Z",
  "sha256": "a1b2c3d4...",
  "flags": [],
  "introspection": {
    "kind": "docx",
    "hasHeadings": true,
    "imageCount": 5,
    "altTextCoverage": 0.8,
    "tableCount": 3,
    "tablesHaveHeaders": true,
    "vagueLinkCount": 2,
    "documentLanguage": "en-US"
  }
}
```

**Example file entry (XLSX):**

```json
{
  "path": "2024/data/budget.xlsx",
  "absolutePath": "/var/strapi/uploads/2024/data/budget.xlsx",
  "filename": "budget.xlsx",
  "extension": "xlsx",
  "category": "spreadsheet",
  "remediable": true,
  "sizeBytes": 48720,
  "modifiedAt": "2024-04-01T09:00:00.000Z",
  "sha256": "f9e8d7c6...",
  "flags": [],
  "introspection": {
    "kind": "xlsx",
    "sheetCount": 4
  }
}
```

**Example file entry (legacy `.doc`):**

```json
{
  "path": "archive/2010-memo.doc",
  "filename": "2010-memo.doc",
  "extension": "doc",
  "category": "office-document",
  "remediable": true,
  "introspection": {
    "kind": "office-legacy",
    "format": "doc"
  }
}
```

The presence of `kind: "office-legacy"` is itself the signal: this file needs manual review with Office or an upgrade to a modern format before remediation.

## What gets introspected

### PDF

| Field | What it tells you |
|---|---|
| `pageCount`, `hasTextLayer`, `textLayerCoverage`, `isImageOnly` | Text vs. scanned content |
| `hasTags` | PDF structure tags (most important PDF a11y feature) |
| `hasFormFields`, `hasSignatures` | Specialized remediation requirements |
| `encrypted` | Whether the file is password-protected |
| `documentLanguage` | Declared language (WCAG 3.1.1) |

### DOCX

| Field | What it tells you |
|---|---|
| `hasHeadings` | Document uses Word heading styles (essential for screen-reader navigation) |
| `imageCount`, `altTextCoverage` | Number of images and what fraction have alt text |
| `tableCount`, `tablesHaveHeaders` | Table count and whether any table has marked header rows |
| `vagueLinkCount` | Links using ambiguous text ("click here", "read more") |
| `documentLanguage` | Declared language (WCAG 3.1.1) |

### XLSX

| Field | What it tells you |
|---|---|
| `sheetCount` | Total number of sheets |

### Legacy `.doc/.ppt/.xls`

Flagged by extension only — `kind: "office-legacy"` with the specific format. These binary formats need Office or specialized tools to inspect.

When introspection fails (corrupt file, unsupported variant, parse exception), the `introspection` field is omitted from the entry. The file row still appears with full filesystem stats.

Files larger than `--max-introspect-mb` (default 200) skip introspection regardless of type.

## Filename flags (Phase 4)

Every entry's `flags[]` array is populated with applicable filename-heuristic flags. These drive the `flagged_filenames.txt` artifact in every report:

| Flag | When applied |
|---|---|
| `scanned-name-pattern` | Filename matches scanner / photo / default-output naming: `Scan_001.pdf`, `IMG_4567.jpg`, `Document1.docx`, `Untitled-1.pdf`, `12345.tiff`, `DOC001.pdf`, `FAX-2024-04-12.pdf`, `Microsoft Word - draft.pdf`, etc. Strong signal that the file is an unprocessed export from a scanner, phone camera, or default save-as. |
| `filename-has-spaces` | Basename contains whitespace. URL-encoded spaces (`%20`) are a common source of CMS friction and copy-paste bugs. |
| `filename-non-ascii` | Basename contains characters outside the printable ASCII range (e.g., `résumé.pdf`, `文件.docx`). Web-server URL handling and some legacy systems still mishandle these. |
| `filename-long` | Basename exceeds 200 characters. Long names cause filesystem truncation and URL length issues. |

Flags are emitted as a sorted array. The `flags` column was removed from the CSV and HTML report in v1.1.0 — it is now used only to populate `flagged_filenames.txt`. A file with no triggered flags has `flags: []` (empty array).

## Rollup workflow (Phase 5)

After scanning N servers, merge the per-server NDJSONs into a consolidated inventory:

```bash
filecap rollup ./inventories/*.ndjson -o consolidated.ndjson
```

The consolidated NDJSON has the same line-delimited structure as a single-instance inventory but with three differences:

1. **Header.** `kind: "filecap-consolidated-header"` and `metadata.sources` is an array with one entry per source inventory (each carrying the original server identity, scan options, and stats).
2. **Entries.** Each entry gains `serverName: string` (which source it came from) and `duplicateOf: {serverName, path} | null`. Content-duplicates (identical SHA-256 across servers) get `duplicateOf` set to the canonical copy. The canonical entry has `duplicateOf: null`.
3. **Footer.** `kind: "filecap-consolidated-footer"` with cross-instance stats: `totalUniqueHashes`, `totalDuplicateGroups`, `bytesSavedIfDeduped` (bytes that could be reclaimed by deleting non-canonical duplicates).

**Why one row per physical copy?** Each duplicate entry in the consolidated CSV represents real disk space someone has to decide to keep or delete. The `duplicateOf` link tells the consumer "this is the same content as `<serverName>:<path>`" so a vendor can group by hash for de-dup analysis OR filter to canonicals only for remediation work. Both views are one query away.

**Canonical-pick rule.** When two or more entries share a SHA-256, the canonical is the one with the oldest `modifiedAt`. Ties are broken alphabetically by `serverName`. The canonical entry has `duplicateOf: null`; all others have `duplicateOf: {serverName, path}` pointing at it.

**Example consolidated entry (canonical):**

```json
{
  "path": "2024/case-001.pdf",
  "filename": "case-001.pdf",
  "extension": "pdf",
  "category": "pdf",
  "remediable": true,
  "sizeBytes": 4827193,
  "modifiedAt": "2024-03-12T09:14:22.000Z",
  "sha256": "e3b0c44...",
  "flags": [],
  "serverName": "strapi-prod-01",
  "duplicateOf": null
}
```

**Example consolidated entry (duplicate):**

```json
{
  "path": "archive/case-001-copy.pdf",
  "filename": "case-001-copy.pdf",
  "extension": "pdf",
  "category": "pdf",
  "remediable": true,
  "sizeBytes": 4827193,
  "modifiedAt": "2024-08-01T12:30:00.000Z",
  "sha256": "e3b0c44...",
  "flags": [],
  "serverName": "strapi-prod-02",
  "duplicateOf": { "serverName": "strapi-prod-01", "path": "2024/case-001.pdf" }
}
```

## Report workflow (Phase 6)

Generate the vendor handoff package from an inventory NDJSON (single-instance or consolidated):

```bash
filecap report consolidated.ndjson -o ./report-2026-Q2/
filecap report consolidated.ndjson -o ./report-2026-Q2/ --html
```

Output directory contents:

| File | Purpose |
|---|---|
| `audit-file-list.csv` | One row per file, 14 columns (the work-order vendors actually consume). Human-readable column headers. Filterable in Excel, Smartsheet, etc. |
| `audit-file-list.html` | (Only when `--html` is passed.) Self-contained interactive dark-mode page — same data, sortable columns, full-text search, category filter chips, no external dependencies. `audit-remote.sh` always passes `--html` unless `AUDIT_HTML=0` is set. |
| `audit-summary.txt` | Manager-friendly top-line numbers: file counts by category, total bytes, image-only PDF count, remediable count, heading coverage, alt-text coverage, and "What this means" observation bullets. |
| `README.txt` | Plain-text guide to all files in this folder. Start here if you're not sure which file to open. |
| `largest_files.txt` | Top 50 files by size (helps schedule the biggest remediation work) |
| `flagged_filenames.txt` | Files whose `flags[]` includes scanned-original or filename anti-patterns |
| `duplicate_hashes.txt` | Content-duplicate groups (entries sharing a SHA-256) — useful for de-dup analysis |
| `pdf_image_only.txt` | PDFs with `isImageOnly: true` — the headline cost driver in PDF remediation |

The CSV is pure inventory — there are NO vendor-fill columns. Vendors return remediated files; ICJIA re-scans and uses a future `filecap diff` command to detect changes.

**CSV column order** (14 columns, stable since 1.4.1):

`Server, Website, Server IP, Date published, Source folder on server, File location (relative to source folder), Full file path on server, Public URL, File name, File extension, File type, Size (bytes), Content hash (SHA-256), Duplicate of`

The deliverable focuses on the fields a remediator needs to **find** and **price** each file (filename, path, server, type, size, duplicate marker, public URL). Format-specific introspection columns (PDF page count, image-only/OCR, DOCX heading coverage, XLSX sheet count, etc.) were dropped in 1.4.0 / 1.4.1 — remediators open the file in Adobe Acrobat / Word / Excel and read those properties directly from the file. The full introspection remains in the underlying NDJSON inventory for MCP queries and custom reports.

Column headers are human-facing labels (not raw field names). Empty cells indicate the field doesn't apply to this file's type.

**Inputs.** `filecap report` accepts BOTH a single-instance NDJSON (from `filecap scan`) and a consolidated NDJSON (from `filecap rollup`). Both input shapes produce the same 30-column CSV.

## MCP server (Phase 7)

`filecap mcp` starts an stdio MCP server that exposes five tools AI agents can call during conversational audits:

| Tool | What it does |
|---|---|
| `filecap_scan` | Walk a directory, produce an NDJSON inventory at the specified path |
| `filecap_rollup` | Merge multiple per-server NDJSONs into a consolidated inventory |
| `filecap_report` | Generate vendor handoff package (CSV + summary + flagged lists) |
| `filecap_query_inventory` | Filter/sort entries in an existing NDJSON by size, extension, flags, isImageOnly, etc. |
| `filecap_web_rollup` | Bundle the most recent scans of every saved site into a static-site directory |

### Always-latest config (recommended)

Pin to `@latest` (or omit the version tag entirely) so the host re-checks the npm registry each time it spawns the MCP process. This guarantees you pick up new tool definitions and bug fixes without touching your config file:

```json
"args": ["--yes", "@icjia/filecap@latest", "mcp"]
```

All client snippets below use this form.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, or `%APPDATA%\Claude\claude_desktop_config.json` on Windows. Restart Claude Desktop after saving.

```json
{
  "mcpServers": {
    "filecap": {
      "command": "npx",
      "args": ["--yes", "@icjia/filecap@latest", "mcp"]
    }
  }
}
```

### Claude Code

`.claude/mcp.json` in your project root for project-scoped access, or `~/.claude/mcp.json` for user-global access:

```json
{
  "mcpServers": {
    "filecap": {
      "command": "npx",
      "args": ["--yes", "@icjia/filecap@latest", "mcp"]
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` (also configurable in-app at Settings → Features → MCP):

```json
{
  "mcpServers": {
    "filecap": {
      "command": "npx",
      "args": ["--yes", "@icjia/filecap@latest", "mcp"]
    }
  }
}
```

### Windsurf (Codeium)

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "filecap": {
      "command": "npx",
      "args": ["--yes", "@icjia/filecap@latest", "mcp"]
    }
  }
}
```

### Continue

`~/.continue/config.json` for user-global access, or `.continue/config.json` in your project root for project-scoped access. Continue uses a different shape — MCP servers go under `experimental.modelContextProtocolServers`:

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "npx",
          "args": ["--yes", "@icjia/filecap@latest", "mcp"]
        }
      }
    ]
  }
}
```

### How auto-update works

When you use `@latest`, npx checks the npm registry on each spawn. If a newer version has been published, npx downloads it before starting the server — typically 1–3 seconds of additional startup time. If the installed version is already current, npx reuses the cached package with no network round-trip.

For zero startup overhead with explicit update control, install globally instead:

```bash
npm install -g @icjia/filecap
```

Then reference the binary directly in your client config:

```json
{
  "mcpServers": {
    "filecap": {
      "command": "filecap",
      "args": ["mcp"]
    }
  }
}
```

To update: `npm install -g @icjia/filecap@latest`.

### Verifying it works

After wiring up your client, ask the AI agent:

- "Run filecap_scan on /var/strapi/uploads with introspection enabled, write to /tmp/strapi.ndjson"
- "Use filecap_query_inventory on /tmp/consolidated.ndjson to find PDFs over 100 MB on server strapi-prod-02"
- "Generate a report from /tmp/consolidated.ndjson into /tmp/report-2026-Q2/"

If the tools are registered correctly, the agent will call them directly rather than suggesting you run the CLI manually.

## For auditors: self-contained audit scripts

### What this is

`filecap` is a tool for taking a complete inventory of the document files stored on a remote web server — typically the `/uploads` folder of a Strapi-powered website — so that a remediation vendor can see exactly what work is needed and produce a defensible, fixed-price quote. It works by connecting to the server over SSH, walking the entire file tree, and recording structured metadata about each file: PDF page counts, whether a PDF is image-only (scanned), DOCX heading structure, alt-text coverage, and more. The result is a spreadsheet (CSV) the vendor can open in Excel, plus an optional interactive web page (HTML) you can open in any browser for review meetings. No files on the server are modified — this is a read-only audit.

### What you'll need

Check this list before running anything. All five items are required.

1. **A computer running macOS, Linux, or Windows with WSL2.** Standard Mac and Linux terminals work out of the box. Windows users need one extra setup step — see [Windows: the situation](#windows-the-situation) below for a plain-language explanation of why, and how to fix it in about 5 minutes.

2. **SSH access to the remote server.** This means you (or your IT team) already have a username and an SSH key configured for the target machine. The default username for ICJIA Strapi servers is `forge`. If you can already run `ssh forge@<server-ip>` and get a prompt, you're ready. If not, you'll need your server administrator to set this up before running the audit.

3. **Node.js 20 or newer installed on your local machine.** Node is the JavaScript runtime the tool uses; it's free and widely used. Check whether it's already installed by opening a terminal and typing `node --version`. If you see `v20.x.x` or higher, you're done. If not:
   - macOS: `brew install node` (if you have Homebrew) or download the installer from https://nodejs.org
   - Ubuntu/Linux: `sudo apt install -y nodejs` or download from https://nodejs.org
   - Windows (WSL2/Ubuntu): see the [Windows](#windows-the-situation) section

4. **`npx` available in your terminal.** `npx` comes bundled with Node.js 20+ — if you have Node, you have `npx`. It's the tool that downloads and runs `filecap` automatically; you don't have to install `filecap` separately.

5. **`bash`, `ssh`, `rsync`, and `python3` available.** These are pre-installed on every Mac (macOS 12+), every modern Ubuntu/Debian Linux, and every WSL2/Ubuntu environment. You don't need to do anything. The scripts check for these at startup and tell you if something is missing.

### Setting up SSH access (one-time, before your first run)

The audit scripts need SSH access from your machine into each ICJIA server. **Vendors who only receive the resulting CSV/HTML don't need this** — only people running the script do.

If you're a remediation vendor receiving an audit deliverable, skip ahead to "How to use it" — you don't need SSH access; you just open the CSV/HTML.

If you're an auditor or manager who will run the script, do this once per machine:

#### 1. Generate an SSH key (if you don't already have one)

> **Use OpenSSH only.** The audit scripts shell out to `ssh` and `rsync`, which expect standard OpenSSH key files at `~/.ssh/id_ed25519` (or `id_rsa`). Generate the key with `ssh-keygen` from the **OpenSSH** suite that ships with macOS, every modern Linux distribution, and Windows WSL2 (Ubuntu preferred). PuTTY's `.ppk` format and other vendor key formats are **not** compatible — converting them to OpenSSH format is more friction than just generating a fresh OpenSSH key. If you're on Windows, do this inside a WSL2/Ubuntu terminal — **not** PowerShell, Command Prompt, Git Bash, Cygwin, or PuTTY. WSL2/Ubuntu ships OpenSSH out of the box, and the audit scripts run inside the same WSL2 environment.

On macOS, Linux, or Windows-WSL2 (Ubuntu):

```
ssh-keygen -t ed25519 -C "your-email@example.com"
```

Press Enter to accept the default location (`~/.ssh/id_ed25519`). You can set a passphrase for extra protection or leave it empty for hands-off use.

If you're on Windows and haven't installed WSL2 yet, jump to [Windows: the situation](#windows-the-situation) for the one-command install (it takes about 5 minutes including the reboot).

#### 2. Copy your public key

On macOS:

```
cat ~/.ssh/id_ed25519.pub | pbcopy
```

On Linux:

```
cat ~/.ssh/id_ed25519.pub
```

(Then select-and-copy from the terminal.)

The public key is the file ending in `.pub`. The matching private key (without `.pub`) stays on your machine and is never shared.

#### 3. Send the public key to IDS

Email the contents of `id_ed25519.pub` to ICJIA's IDS team and ask them to add it to the `forge` user's `~/.ssh/authorized_keys` on each audit server you need access to. Include in the email:

- Which servers you need (e.g., DVFR, i2i, VPP, intranet)
- The SSH user (almost always `forge`)
- Your contact info
- The public key content (the entire single-line `ssh-ed25519 AAAA... your-email@example.com` blob)

#### 4. Verify access

Once IDS confirms the key is installed, test it:

```
ssh forge@<server-ip> "echo OK"
```

If it prints `OK` without prompting for a password, you're set up. If it prompts for a password, the key isn't installed yet — follow up with IDS.

### Common SSH issues

- **"Permission denied (publickey)"** — the public key isn't on the server yet. Re-confirm with IDS that they added the right key to the right user.
- **"Host key verification failed"** — first-time connection. Type `yes` to accept the host's fingerprint.
- **"Connection refused"** — the server's SSH daemon isn't responding. Check with IDS that the server is up.
- **No prompt at all, just hangs** — networking / firewall issue. May need to be on a specific VPN or IP allowlist; check with IDS.

### Sites that require a bearer token (intranet, staff-only portals)

Some sites — typically intranet content libraries or staff-only document portals — gate their public file URLs behind a JWT or other bearer token. The audit itself doesn't need the token (SSH+rsync reads files from the filesystem, bypassing HTTP entirely), but the preflight URL HEAD-check would otherwise log a "URL FAILED" warning and force you to confirm `[y/N]` before continuing. Configure the token once and the audit runs cleanly.

**Two ways to provide the token, env var wins when both are present:**

> **ICJIA-specific note.** Of the eight ICJIA Strapi sites in production, only `intranet` (server-name `intranet-api-prod`, URL `intranet.icjia.cloud`) requires a bearer token. Its JWT is **valid for 15 days**, so plan to rotate twice a month. The 1Password CLI workflow below makes that a one-time setup; the secrets-file workflow is one line to edit each rotation.
>
> **If Intranet audits suddenly stop working:** the most common cause is an expired JWT. Symptom: the preflight URL HEAD probe reports `URL FAILED` for `intranet-api-prod` and prompts `Continue anyway? [y/N]`. The file audit itself still works (SSH+rsync bypasses HTTP), but the public-URL HEAD-check fails. Get a fresh token from your IDS contact and update either `FILECAP_BEARER_TOKEN_INTRANET_API_PROD` (env var) or `~/.filecap/secrets.json` (file path). The other seven sites are not gated by JWT and are unaffected by Intranet's token state.

**Option 1 — env var (recommended for security-conscious / 1Password / direnv users).** Set `FILECAP_BEARER_TOKEN_<SERVER_NAME_UPPER_SNAKE>` in the shell environment before running the script. The token never touches disk:

```bash
# One-off, in the current shell — token lives until the shell exits
export FILECAP_BEARER_TOKEN_INTRANET_API_PROD="eyJhbGciOi..."
./audit-fleet.sh

# 1Password CLI — store the JWT in your vault once, pull fresh on each run.
# When the 15-day token rotates, update the vault item; nothing else changes.
op run --env-file=.env -- ./audit-fleet.sh
# where .env is:
# FILECAP_BEARER_TOKEN_INTRANET_API_PROD=op://Private/intranet-jwt/credential
```

The env-var name is the server-name (the `name` field in `sites.json`) uppercased with hyphens replaced by underscores: `intranet-api-prod` → `FILECAP_BEARER_TOKEN_INTRANET_API_PROD`.

**Option 2 — `~/.filecap/secrets.json` file.** Edit once, persists across runs. The file is local-only — never bundled, never exported via the saved-sites menu, never sent to a remediator:

```json
{
  "version": 1,
  "tokens": {
    "intranet-api-prod": "eyJhbGciOi..."
  }
}
```

```bash
chmod 600 ~/.filecap/secrets.json
# Validate the JSON before running the audit — a syntax error here causes the
# audit script to silently treat the token as unset and the URL HEAD-probe to
# fail with the same warning you'd see if no token had been configured at all.
python3 -m json.tool < ~/.filecap/secrets.json > /dev/null && echo "OK"
```

When the JWT rotates (every 15 days for ICJIA's intranet token), update the one line in `secrets.json` and the next run picks it up. No code change, no re-deploy. If you forget to rotate, you'll see "URL FAILED" warnings during preflight — the audit itself still completes via SSH+rsync, but the public-URL HEAD probe stops succeeding. If you'd rather not touch a file every two weeks, use the 1Password CLI flow (Option 1) and just update the vault item.

**Optional hint in `sites.json`.** Add `"requiresBearerToken": true` to each entry that needs one — purely informational, tells anyone receiving the bundle "you'll need to ask the audit lead for the JWT separately." The token itself never goes in `sites.json`.

```json
{
  "name": "intranet-api-prod",
  "siteName": "Intranet",
  "user": "forge",
  "host": "192.241.146.85",
  "remotePath": "/home/forge/intranet.icjia-api.cloud/intranet-api/public/uploads",
  "publicUrlBase": "https://intranet.icjia.cloud/uploads",
  "requiresBearerToken": true
}
```

**Security notes.** The token is fed to `curl` via stdin (`--header @-`), not argv, so it never appears in `ps aux`. The `secrets.json` file is read only when needed; nothing writes the token to logs, the report bundle, or any output artifact. Audit work directories never contain the token. If the token leaks, rotate it on the issuing server and update `secrets.json` (or the env var); the leaked one stops working without any change to filecap.

### How to use it (single server)

Three commands. The first downloads the script, the second makes it executable, the third runs it:

```bash
curl -O https://raw.githubusercontent.com/ICJIA/filecap-cli/main/examples/audit-remote.sh
chmod +x audit-remote.sh
./audit-remote.sh
```

The script walks you through the rest interactively. It asks a few questions (see below), connects to the server, collects the inventory, and writes the output to `~/filecap-audits/<server-name>/latest/report/`. When it's done, it prints the path to the results.

If you already know all the details and want to skip the prompts, you can pass them directly:

```bash
./audit-remote.sh forge 192.241.146.85 ~/dvfr.icjia-api.cloud/strapi_v4/public/uploads dvfr-strapi-prod
```

### What you'll be asked

In interactive mode, the script asks a few questions. Here's what each one means and what a sensible answer looks like:

- **(If saved sites exist, you'll see a menu first — pick a number to skip the per-field prompts.)**
- **SSH username** — The login name on the remote server. Defaults to `forge` (the ICJIA Strapi convention). Press Enter to accept the default, or type a different name if your server uses one.
- **Server IP or hostname** — The address of the server you're auditing. Examples: `192.241.146.85` or `strapi-prod-01.example.com`. Required — empty values are not accepted.
- **Full path to the uploads folder on the remote** — Where the files live on the server. Example: `~/dvfr.icjia-api.cloud/strapi_v4/public/uploads`. Your server administrator can confirm this path. Required — empty values are not accepted.
- **Friendly server name** — A human-readable label (the technical identifier) used in report headings. Defaults to `strapi-<IP-with-dashes>` (e.g., `strapi-192-241-146-85`). Optional — press Enter to accept the default, or type something like `dvfr-strapi-prod`.
- **Website nickname** — An optional short name managers and vendors use to identify the site (e.g., `DVFR`, `i2i`, `vpp`, `infonet`). Different from the server name — this is the business-facing identity. Press Enter to skip if you don't have one.
- **Public URL prefix** — The base URL where uploaded files are *actually served from*, not the user-facing site URL. For a Strapi-backed Nuxt fleet (the ICJIA pattern), files live on the API/CMS host (`<site>.icjia-api.cloud/uploads`), **not** on the public frontend (`<site>.illinois.gov/uploads`) — the frontend doesn't proxy `/uploads/*` to the backend, so a link to the frontend resolves to the catch-all 404 page (returning HTTP 200 with `text/html`, which silently breaks vendor verification later). Examples: `https://dvfr.icjia-api.cloud/uploads`, `https://agency.icjia-api.cloud/uploads` (for `icjia.illinois.gov` content), `https://archive.icjia.cloud/files` (for the standalone Archive site). Test before saving — paste the URL plus a known filename into a browser; if you see the actual file (Excel download, PDF, etc.), it's right; if you see the website's homepage or a 404 page, you've got the wrong host.

### What you get

After the script finishes, navigate to `~/filecap-audits/<server-name>/latest/report/`. You'll find:

- **`audit-file-list.csv`** — The main deliverable. One row per file, 14 columns covering server, website, file location, full path, public URL, filename, type, size, content hash, and duplicate-of marker. Open in Excel, Google Sheets, or Numbers. This is what you hand to the remediation vendor.
- **`audit-summary.txt`** — Top-line numbers: total files by type, total storage, how many PDFs are image-only, how many documents are remediable. Good for an executive summary or a project charter.
- **`audit-file-list.html`** — A self-contained dark-mode web page version of the same data. Open in any browser — no internet connection required. Supports sorting by any column, full-text search, category filter chips, and print-to-PDF. (Set `AUDIT_HTML=0` in the environment to suppress this file on rare occasions when you don't want it.)
- **`README.txt`** — A plain-text guide to all the files in this folder. Start here if you're not sure which file to open.
- **`largest_files.txt`** — The top 50 files by size. Helpful for scheduling the most time-consuming remediation work first.
- **`flagged_filenames.txt`** — Files whose names suggest they're scanned documents or unprocessed camera photos (`Scan_001.pdf`, `IMG_4567.pdf`, etc.) — typically the highest-cost items to remediate.
- **`duplicate_hashes.txt`** — Files that are byte-for-byte identical to another file on the server. Useful for identifying redundant copies before remediation.
- **`pdf_image_only.txt`** — PDFs that contain no text layer — they're essentially photos of pages. These require OCR before any accessibility remediation can begin, and they're usually the cost driver in a vendor quote.

The run directory also contains `inventory.ndjson` (the raw scan data used to generate the report) and `SOURCE_INFO.txt` (a provenance record: which server was scanned, when, and how to SSH in and locate a specific file).

### Why two file counts?

The deliverable shows **two** numbers, deliberately:

- **Audit work** (e.g., 69) — files that need actual accessibility remediation: PDFs, Word docs, Excel sheets, PowerPoint, legacy Office files. These are what your remediation vendor will quote against.
- **Reference files** (e.g., 33) — files that are inventoried but don't need direct work: images (their alt text lives in your CMS schema, not in the JPEG), text files (`.txt`, `.md`), `.gitkeep` placeholders, etc. They're listed for completeness so the inventory is comprehensive, but no remediator will touch them.

The HTML report opens filtered to "Remediable only" by default. Click the "All" chip to see everything; click a category chip to drill into a specific type.

### Saved sites — type each site's config once

If you audit the same fleet repeatedly, the script remembers each site's config in `~/.filecap/sites.json` so you don't re-type the SSH user, IP, remote path, etc. every run.

On startup, the script offers a menu:

```
Saved sites:
  1. DVFR (dvfr-strapi-prod) — forge@192.241.146.85
  2. i2i (i2i-strapi-prod) — forge@10.0.0.5

  Type a number 1-2 to select a saved site
    a  →  add a new site
    e  →  edit a saved site
    d  →  delete a saved site
    p  →  preflight all saved sites (verify SSH + path + file count)
    x  →  export all sites to a JSON file (no credentials)
    w  →  build web rollup from latest scans (publishable static site)
    i  →  import sites from a JSON file
    s  →  skip (one-off prompts, don't save)
    q  →  quit
```

Picking a number loads the site's full config and jumps straight to the **config review screen** (where you can override any field for this run by typing its number).

Picking `a` walks you through the prompts for a new site. At the end, the script asks "Save these settings as a named site for next time? [y/N]". Answer yes and the site is selectable from the menu thereafter.

Picking `w` launches the web rollup flow — see [Publishing a fleet snapshot](#publishing-a-fleet-snapshot) for what this does.

The file is created with mode `600` (user-only readable) inside `~/.filecap/` (mode `700`). Override the location with `FILECAP_SITES_FILE=/some/path` if you want to keep multiple sets of saved sites.

### Preflight all saved sites

The `p` option in the saved-sites menu runs a quick health check across every saved site. For each: SSH connectivity, remote path existence + readability, file count via `find`. Prints a status table:

```
  Nickname           Server name            Host               SSH      Path     Files    Notes
  ------------------ ---------------------- ------------------ -------- -------- -------- ----------------
  DVFR               dvfr-strapi-prod       192.241.146.85     OK       OK       102
  i2i                i2i-strapi-prod        10.0.0.5           FAIL     -        -        SSH connect failed
  VPP                vpp-strapi-prod        10.0.0.6           OK       OK       0        directory is empty
```

Useful for catching SSH key drift, moved-or-renamed remote paths, and unexpectedly empty directories before running a full audit. ~5 seconds per site (sequential SSH probes).

The preflight is read-only — no rsync, no scan, no audit. It returns to the menu when complete so you can still pick a site to audit (or fix issues first).

### Sharing saved sites — auditor onboarding

When external auditors join a project, you typically want them up and running fast. Two menu options make this trivial:

- **`x → export all sites to a JSON file`** — writes the current saved sites to a path you choose (default `~/Desktop/icjia-sites.json`). The file contains hostnames, paths, nicknames, and public URLs — but no credentials.
- **`i → import sites from a JSON file`** — reads a sites JSON file, previews what would be imported, and asks: merge (add new sites by name, skip names that already exist) / replace (wipe current sites + use only the imported ones) / cancel.

The intended workflow:

1. **Admin** configures every site once on their machine (or imports an existing list).
2. **Admin** picks `x → export`, enters a path, hands the resulting JSON file to each visiting auditor (email, secure file share, USB stick).
3. **Each auditor** receives the file plus their own SSH access (configured separately by the admin).
4. **Auditor** runs `./audit-remote.sh` for the first time on their machine. The menu shows just `a / i / s / q` (no saved sites yet).
5. **Auditor** picks `i → import`, pastes the path to the JSON file. Picks `m` for merge.
6. Menu now shows the full fleet. Auditor picks a site number and runs an audit. Total onboarding time after SSH setup: ~30 seconds.

The import option is shown in the menu **even when there are no saved sites yet**, so first-time auditors with a fresh machine see it immediately.

If you want to keep multiple unrelated sets of sites (different clients, different fleets), set `FILECAP_SITES_FILE=/path/to/other-sites.json` in your shell to point at a different file. Each `FILECAP_SITES_FILE` value is its own independent saved-sites bundle.

### Required-input validation and always-HTML

A few smaller UX improvements:

- **Server IP and remote path are required** — empty values re-prompt with "(required — please type a value)". No more silent acceptance leading to confusing later failures.
- **HTML report is always produced alongside the CSV** — no more "generate HTML?" prompt. Set `AUDIT_HTML=0` in the environment to opt out (rare).
- **Config review with per-field correction** — review screen lets you fix any field by typing its number (1-9). The screen re-renders so you can keep adjusting until everything's right, then press Enter to proceed.

### How to use it (multiple servers / fleet mode)

If you're responsible for more than one server, the fleet script runs the single-server audit on each one and then produces a combined report across all of them.

#### Bundle workflow (recommended — for handing the audit off to a remediator)

The cleanest workflow when an audit lead wants to hand the audit off to a remediator, manager, or vendor: bundle a `sites.json` file (the saved-sites list from `audit-remote.sh`) plus the two `.sh` scripts. The receiver drops the file into `~/.filecap/`, runs `./audit-fleet.sh`, and gets the full deliverable — no per-site typing, no CSV editing.

The audit lead exports the bundle once, using the `x` option in the saved-sites menu (see [Sharing saved sites — auditor onboarding](#sharing-saved-sites--auditor-onboarding) above). The export writes `~/Desktop/icjia-sites.json` by default. Send that file to the remediator. The bundle contains hostnames, paths, nicknames, and public URLs only — no credentials.

The receiver runs:

```bash
# Drop the sites.json bundle you were handed into ~/.filecap/
mkdir -p ~/.filecap
mv /path/to/sites.json ~/.filecap/

# Download both scripts
curl -O https://raw.githubusercontent.com/ICJIA/filecap-cli/main/examples/audit-fleet.sh
curl -O https://raw.githubusercontent.com/ICJIA/filecap-cli/main/examples/audit-remote.sh
chmod +x audit-fleet.sh audit-remote.sh

# Run the fleet audit — sites.json is auto-detected
./audit-fleet.sh
```

You can also pass a `.json` path explicitly: `./audit-fleet.sh /path/to/sites.json`.

**SSH access is configured separately.** The bundle does not contain SSH keys. The receiver still needs their own OpenSSH key authorized on each target server (see [Setting up SSH access](#setting-up-ssh-access-one-time-before-your-first-run) above). On Windows, run everything inside WSL2/Ubuntu — never PowerShell, never Git Bash, never PuTTY.

#### Alternative: ad-hoc CSV (no bundle)

If you don't have a sites.json bundle and prefer to provide the server list inline, pass any non-`.json` file as a CSV (no header row; `#` lines are comments; trailing columns are optional):

```bash
./audit-fleet.sh servers.csv
```

```
# server_name,user,host,remote_path[,site_name[,public_url_base]]
dvfr-strapi-prod,forge,192.241.146.85,~/dvfr.icjia-api.cloud/strapi_v4/public/uploads,DVFR,https://dvfr.icjia-api.cloud/uploads
i2i-strapi-prod,forge,10.0.0.5,/var/strapi/uploads,i2i
vpp-strapi-prod,forge,10.0.0.6,/var/strapi/uploads
# (4-, 5-, and 6-column rows all work — trailing columns are optional)
```

#### Fully interactive (no args, no bundle, no CSV)

If neither `~/.filecap/sites.json` nor a positional CSV is provided, the script falls back to prompting interactively for each server:

```bash
./audit-fleet.sh
```

Output lands in `~/filecap-audits/_fleet/<timestamp>/` and includes a per-server breakdown (`MANAGER_SUMMARY.txt`), a combined CSV (`audit-file-list.csv`) with one row per file across all servers, and a `duplicate_hashes.txt` that catches files that appear on multiple servers.

### Re-running audits over time

Running the audit against the same server multiple times preserves history. Each run lands in its own timestamped subdirectory under `~/filecap-audits/<server-name>/runs/`, and a `latest/` symlink at the workdir root points to the most recent successful run.

```
~/filecap-audits/dvfr-strapi-prod/
├── mirror/                              (shared local copy)
├── runs/
│   ├── 20260509-143000Z/                ← May 9 audit
│   │   ├── inventory.ndjson
│   │   └── report/
│   ├── 20260516-093000Z/                ← May 16 audit
│   └── 20260523-100000Z/                ← May 23 audit
└── latest → runs/20260523-100000Z       (always points to most recent run)
```

Practical implications:

- **The `mirror/` directory is shared across runs.** rsync handles incremental updates — only changed files transfer each time, so subsequent runs are fast.
- **Each run is self-contained.** You can zip `runs/<timestamp>/` and email it without including any other run.
- **The `latest/` symlink is your shortcut to "the current report":** `open ~/filecap-audits/<server-name>/latest/report/audit-file-list.csv`.
- **Old runs accumulate.** They're tiny (typically tens to hundreds of KB each) but if you're running daily over many months, you may want to occasionally `rm -rf` the oldest runs.
- **No conflicts when re-running** — two runs in the same minute would land in distinct timestamped dirs (UTC seconds resolution).

**Multiple sites on one physical server.** If your fleet has multiple Strapi sites sharing an IP (common with Forge-style hosting), each site gets its own audit directory keyed by the server-name (the friendly identifier you set when adding the site, like `dvfr-strapi-prod`). They never collide.

Pre-1.2.2 audit dirs at `~/filecap-audits/<server-ip>/` are orphaned but not deleted. Migrate manually with `mv`:

```
mv ~/filecap-audits/192.241.146.85 ~/filecap-audits/dvfr-strapi-prod
```

The fleet script (`audit-fleet.sh`) follows the same pattern: each fleet run goes to `~/filecap-audits/_fleet/<timestamp>/` and a `~/filecap-audits/_fleet/latest` symlink points to the most recent run.

### Staying current

The audit scripts have a built-in version check. Each time you run them, they compare their content against the latest version on GitHub and warn you if your local copy is outdated. The check happens at startup, takes ~1 second, and is non-blocking — if it can't reach GitHub (e.g., you're offline), it just notes that and continues.

If your script is out of date, you'll see a yellow warning telling you the exact `curl` command to run to get the latest version.

To skip the check (e.g., on an air-gapped system or for faster startup):

```bash
./audit-remote.sh --no-version-check
SKIP_VERSION_CHECK=1 ./audit-remote.sh
```

The `filecap` package itself (which the script invokes via `npx`) auto-updates separately on each run — it always pulls the latest from npm.

---

### Windows: the situation

If you're on a Windows machine and wondering why you can't just double-click the script or run it in PowerShell, here's the full explanation — and a straightforward fix.

#### Why this script doesn't run natively on Windows

The audit scripts depend on four tools that come from the Unix world. Here's what each one does and why there's no drop-in Windows replacement:

1. **The script is written in `bash`, the standard Unix shell.** Bash has been the native command line on Mac and Linux since 1989. Windows has two different command languages — PowerShell (the modern one) and cmd.exe (the older one) — and they use an entirely different vocabulary. A bash script is not something either of them can read directly, any more than a Spanish speaker can read Japanese without translation.

2. **The script depends on `rsync`, a Unix file-transfer tool with no Windows equivalent.** `rsync` does three things simultaneously: it copies files, transfers them over SSH, and only re-transfers what has changed since the last run. Windows has separate tools for each of those pieces (`robocopy` for local copying, `scp` for SSH transfer) but nothing that combines all three. We use `rsync` because it makes re-running an audit fast and reliable — subsequent runs on the same server take a fraction of the time.

3. **The script uses `python3` for some glue logic.** Python itself runs fine on Windows, but the way Unix scripts invoke it (via a "shebang line" — the `#!/usr/bin/env python3` at the top of a file) is a Unix convention that Windows ignores. So even if Python is installed, Windows doesn't know to use it when our script calls for it.

4. **Unix and Windows use different file path conventions.** A file in your home folder is `~/filecap-audits` on Mac/Linux but `C:\Users\YourName\filecap-audits` on Windows — different separators, different home-directory conventions. A script written for one won't translate to the other without rewriting all the path-handling code.

5. **More broadly: Unix shell scripting is a 50-year-old tradition.** What takes one line in bash often takes 5–10 lines in PowerShell because the two ecosystems developed separately. A clean Windows port isn't a translation pass — it's a full rewrite, with its own test coverage and long-term maintenance. (See [Native PowerShell support — on the roadmap](#native-powershell-support--on-the-roadmap) below for our current thinking on this.)

#### What Microsoft recommends: WSL2

WSL2 — Windows Subsystem for Linux, version 2 — is **Microsoft's official answer** to exactly this problem. They built it because Windows developer customers were missing out on the rich ecosystem of Unix tools, and they needed a first-class solution. It's not a workaround; it's a supported Microsoft product.

**What WSL2 actually is:**

- A real Linux operating system running inside Windows. Specifically, you install Ubuntu Linux (recommended) alongside your normal Windows installation.
- It runs in a lightweight virtual machine that starts in under a second and uses negligible memory when you're not actively using it.
- It's not a separate computer or a separate login. WSL2's filesystem can see your Windows files (your `C:` drive shows up inside Linux at `/mnt/c/`), and Windows Explorer can browse your WSL2 files (under `\\wsl.localhost\Ubuntu\`). The two sides coexist cleanly.
- It's built into Windows 10 and 11. No separate purchase, no third-party software.

**Why Ubuntu specifically:**

- Ubuntu is the most widely used Linux distribution in the world, and most cross-platform Unix tools are tested on it first.
- Ubuntu publishes Long-Term Support (LTS) releases — currently 22.04 and 24.04 — that receive security updates for at least five years.
- The audit scripts have been tested on macOS and Ubuntu. Other Linux distributions (Debian, Fedora, Arch) almost certainly work, but aren't formally tested.

#### How to install WSL2 with Ubuntu

This is a one-time setup. Subsequent audit runs need no admin rights and no extra steps.

```powershell
# Open PowerShell as Administrator.
# (Right-click the Start button, choose "Windows PowerShell (Admin)" or "Terminal (Admin)".)
# Then run this single command:
wsl --install
```

That one command installs both WSL2 and Ubuntu. When it finishes, reboot your computer when prompted.

After the reboot, find "Ubuntu" in your Start menu and open it. The first time you launch it, Ubuntu asks you to choose a username and password for the Linux side — these are independent of your Windows login and can be anything you like.

Then, inside the Ubuntu terminal, install Node.js and run the audit:

```bash
# Install Node.js 20 (the audit scripts require Node 20 or newer):
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Confirm it worked:
node --version    # should print v20.x.x

# Now run the audit exactly as you would on a Mac or Linux machine:
curl -O https://raw.githubusercontent.com/ICJIA/filecap-cli/main/examples/audit-remote.sh
chmod +x audit-remote.sh
./audit-remote.sh
```

#### Common questions from Windows users

**Will WSL2 slow down my computer?**
No. The Linux environment uses essentially no resources when you're not actively running something in it. It's not running in the background.

**Will WSL2 see my Windows files?**
Yes. Your `C:` drive appears inside Linux at `/mnt/c/`. If you've downloaded files in Windows, you can access them from inside Ubuntu at `/mnt/c/Users/<YourWindowsName>/Downloads/`.

**Will Windows see my WSL2 files?**
Yes. From Windows Explorer, navigate to `\\wsl.localhost\Ubuntu\home\<your-linux-username>\` to browse WSL2 files. Audit CSVs generated inside WSL2 can be opened directly in Excel or any Windows browser without copying them anywhere.

**Can I delete WSL2 later if I don't want it?**
Yes, completely. Run `wsl --unregister Ubuntu` in PowerShell and the Linux environment is gone with no leftovers. WSL2 itself can also be uninstalled through Windows Settings → Apps.

**Do I need administrator rights?**
Yes, for the initial WSL2 install. After that, day-to-day use (opening Ubuntu, running audit scripts) does not require admin rights.

**Will my company's antivirus or IT department block this?**
Usually no — Microsoft officially endorses WSL2, and most enterprise antivirus products treat it as a known-good Microsoft component. However, some tightly locked-down corporate machines do disable it via Group Policy. If `wsl --install` fails with a permissions error, contact your IT department and ask them to enable WSL2 (specifically: enable the "Windows Subsystem for Linux" optional feature and the "Virtual Machine Platform" optional feature). This is a routine request.

**What if my company really won't allow WSL2?**
You have a couple of options. First, another team member on a Mac or Linux machine can run the audit and email you the resulting CSV and HTML files — the audit itself doesn't need to run on your machine. Second, native PowerShell support is on our roadmap (see below). If your organization genuinely cannot use WSL2, please open an issue so we can gauge demand.

#### Native PowerShell support — on the roadmap

A native Windows/PowerShell version of the audit scripts is possible, but it's a meaningful engineering project rather than a quick port. The work involved: approximately 1,500 lines of net-new PowerShell, a replacement for `rsync` over SSH (likely `robocopy` + `scp` with resumption logic), replacements for the inline Python helpers, full path-translation between Windows and Unix conventions, and a separate test matrix across PowerShell 5.1 and 7 on both Windows 10 and Windows 11. Estimated effort: 2–3 focused days of development plus ongoing maintenance as Windows tooling evolves.

We'll prioritize this if there's clear demand from organizations that genuinely cannot use WSL2. If that's your team, please open an issue at https://github.com/ICJIA/filecap-cli/issues with a brief description of why WSL2 isn't viable — that information directly informs our roadmap.

---

### Output structure reference

For completeness, the full directory layout written by `audit-remote.sh`:

```
~/filecap-audits/<server-name>/          (e.g., dvfr-strapi-prod — keyed by name, not IP)
├── mirror/                     Local rsync copy of remote files (shared across runs)
├── runs/
│   ├── 20260509-143000Z/       Each run gets its own timestamped subdirectory (UTC)
│   │   ├── SOURCE_INFO.txt     Provenance — server, path, audit timestamp, find-a-file recipe
│   │   ├── inventory.ndjson    Raw scan output (one entry per file)
│   │   └── report/
│   │       ├── README.txt              Explains all artifacts (start here)
│   │       ├── audit-file-list.csv     The vendor work-order, one row per file
│   │       ├── audit-file-list.html    (only if --html or AUDIT_HTML != 0)
│   │       ├── audit-summary.txt       Manager-friendly counts by category and PDF/DOCX/XLSX detail
│   │       ├── largest_files.txt       Top files by size
│   │       ├── flagged_filenames.txt   Files with name patterns suggesting scanned/IMG-prefixed origin
│   │       ├── duplicate_hashes.txt    Content-identical files (by SHA-256)
│   │       └── pdf_image_only.txt      PDFs with no text layer (require OCR before remediation)
│   ├── 20260516-093000Z/
│   └── 20260523-100000Z/
└── latest -> runs/20260523-100000Z    Symlink, always points to the most recent successful run
```

And for `audit-fleet.sh`:

```
~/filecap-audits/_fleet/
├── 20260509-134500/
│   ├── servers.txt                   List of servers audited
│   ├── failed_servers.txt            (only if any audits failed)
│   ├── MANAGER_SUMMARY.txt           Full audit numbers + per-server breakdown
│   ├── inventories/                  Per-server NDJSON inventories
│   ├── consolidated.ndjson           Cross-server consolidated NDJSON
│   └── consolidated-report/
│       ├── README.txt                Explains all artifacts (start here)
│       ├── audit-file-list.csv       One row per file across the entire fleet
│       ├── audit-file-list.html      (only if HTML was requested)
│       ├── audit-summary.txt         Fleet-wide summary with per-server breakdown
│       ├── largest_files.txt
│       ├── flagged_filenames.txt
│       ├── duplicate_hashes.txt
│       └── pdf_image_only.txt
└── latest -> 20260509-134500         Symlink, always points to the most recent fleet run
```

### Technical requirements

- bash 3.2+ (default on macOS; default on Linux and WSL2/Ubuntu)
- python3 (default on macOS 12+; default on most Linux distros and WSL2/Ubuntu)
- ssh (with keys configured for the target server[s])
- rsync
- npx (comes with Node.js 20+; install Node from https://nodejs.org)
- Node.js 20+ locally (the scripts verify this at startup and abort with guidance if the version is too old)

The scripts run a tool-presence and Node-version preflight at startup and abort with clear remediation messages if anything is missing.

### Why local-mode scanning matters

Many production Strapi servers run on Ubuntu 18.04 with Node 16. Prebuilt Node 18+ binaries require glibc 2.28+ (Ubuntu 20+); compiling Node from source on EOL Ubuntu is fragile due to old g++. The `audit-remote.sh` script sidesteps this by detecting Node 16 (or any Node < 20) on the remote and pulling the files down via rsync, then running filecap on the auditor's local machine. The output CSV still records the *source* server's IP and remote path so vendors can ssh in and locate any flagged file — the auditor's local machine is invisible in the deliverable.

---

## Publishing a fleet snapshot

After scanning your fleet, the `filecap web-rollup` subcommand bundles every site's latest scan into a self-contained static-site directory ready to upload to Netlify (or any static host).

### What's in the bundle

```
~/filecap-audits/_web-rollup/<UTC-timestamp>/
├── index.html           ← landing page with fleet totals + per-site cards
├── netlify.toml         ← cache headers + security headers, ready to deploy
├── robots.txt           ← User-agent: * Disallow: /
├── assets/
│   └── style.css        ← shared dark-mode design tokens
├── dvfr-20260509-160504Z.html    ← per-site report (dark mode, sortable, searchable)
├── dvfr-20260509-160504Z.csv     ← per-site CSV
├── i2i-20260510-093000Z.html
└── i2i-20260510-093000Z.csv
```

### Building the bundle

```bash
filecap web-rollup --output ~/Desktop/icjia-fleet
```

Reads `~/.filecap/sites.json` (the saved-sites file managed by `audit-remote.sh`) and the most-recent inventory at `~/filecap-audits/<server-name>/latest/inventory.ndjson` for each site. Sites without a recent scan are skipped with a warning.

### Password protection — two options

The bundle is publicly accessible by default. For private content (intranet docs, internal policies), add a password.

**Recommended: Netlify Site Password (paid Netlify plan).** Server-side enforcement at the CDN edge. Rotate without redeploying.

```bash
filecap web-rollup --output ~/Desktop/icjia-fleet --no-client-gate
# Deploy to Netlify, then in the dashboard:
#   Site settings -> Visitor access -> Site password -> enter your password
```

**Alternative: client-side gate (free Netlify, "ward off the curious" only).** SHA-256 of password embedded in the HTML; JS prompt at page load. Anyone with view-source can read the content.

```bash
filecap web-rollup --output ~/Desktop/icjia-fleet --password "your-shared-pw"
```

### Three deploy paths

**Drag-and-drop (one-time):** drag the output directory onto https://app.netlify.com/drop. Random URL assigned automatically.

**Netlify CLI (scriptable):**

```bash
cd ~/Desktop/icjia-fleet
netlify deploy --prod --dir .
```

Or include `--deploy` in `filecap web-rollup` to combine build + deploy:

```bash
filecap web-rollup --output ~/Desktop/icjia-fleet --no-client-gate --deploy
```

**Git-connected (auto-deploy on push):**

1. Create a snapshots repo (e.g., `ICJIA/icjia-fleet-snapshot`, private).
2. Connect to a Netlify site via the Netlify dashboard (Build settings: empty build command, publish dir `.`).
3. Each `filecap web-rollup --output <repo-path>` overwrites the bundle; commit + push triggers redeploy.

The bundle's `netlify.toml` ensures Netlify sees the correct publish directory + cache headers automatically; you don't have to configure those in the dashboard.

### Auto-deploying every snapshot — `~/.filecap/config.json`

If you always want `filecap web-rollup` to deploy on completion (no `--deploy` flag, every time), drop a `config.json` next to your `sites.json`:

```json
{
  "version": 1,
  "webRollup": {
    "autoDeploy": true
  }
}
```

With that file in place, plain `filecap web-rollup` builds **and** deploys to Netlify. Pass `--deploy` on the CLI to override (it always wins). Both `--deploy` and `--deploy-site` on the CLI take precedence over the config; the config only fills in defaults when the flag is absent. To temporarily skip auto-deploy, comment out `autoDeploy` in the config or move the file aside.

The config file is validated on load: unknown top-level fields, typos in `webRollup` keys (e.g., `autodeploy` instead of `autoDeploy`), or wrong types (string instead of boolean) cause an immediate, named error rather than silently being ignored.

```json
{
  "version": 1,
  "webRollup": {
    "autoDeploy": true,
    "deploySite": "abc123-your-netlify-site-id"
  }
}
```

`deploySite` is optional — only needed if your local working directory isn't already linked to a Netlify site (`netlify link`). For the common case where the dir is linked, leave `deploySite` unset.

### The netlify.toml that ships with every bundle

The auto-generated `netlify.toml` sets:

- `publish = "."` — tells Netlify the root of the bundle is the publish dir (no build step needed).
- CSV files: `Cache-Control: public, max-age=3600` + `Content-Disposition: attachment` so browsers download rather than render them.
- HTML files: `Cache-Control: public, max-age=300` + `X-Robots-Tag: noindex, nofollow`.
- All files: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.

### What's deliberately NOT in the bundle

- No JavaScript framework — pure HTML + CSS + a tiny inline JS for the password gate (when used).
- No version history of past snapshots — git history is your archive.
- No per-site authentication — single shared password (whatever method you use).
- No analytics — managers see what auditors see, no tracking.

### Using the `w` menu option in audit-remote.sh

Selecting `w` from the saved-sites menu offers three password modes:

- **n (none)** — open bundle, no password protection.
- **c (client-side gate)** — prompts for a password; SHA-256 embedded in HTML. Free, but not real security.
- **s (Netlify Site Password)** — builds without a client-side gate; reminder printed to set the password in the Netlify dashboard after deploying.

After choosing the mode, the script also asks "Auto-deploy to Netlify? [y/N]". Answering yes appends `--deploy` so the bundle is built and deployed in one step.

---

## What filecap does not do

- Perform full WCAG conformance auditing — filecap does inventory; scoring and conformance analysis are performed by separate specialist tools and human auditors.
- Remediate, fix, or modify any files.
- Track vendor remediation status (out of scope — NDJSON inventories are themselves the time-series record).
- Integrate with the Strapi API (deferred to a future release; the core inventory pipeline is format-agnostic).
- Introspect PPTX (deferred to a future phase; current introspection covers DOCX, XLSX, and legacy stubs).

## Troubleshooting

**Scan exits with code 3.** At least one directory was unreadable. The footer's `permissionDenials` count tells you how many.

**`introspection` field missing from a PDF / DOCX / XLSX entry.** filecap couldn't parse this file. Likely causes: malformed file, encrypted, exotic variant. The file still appears in the inventory; vendor's deeper tooling (Acrobat Pro, Office, qpdf) will surface the actual issue.

**Scans are slow on large directories.** Hashing dominates wall time. For triage scans, pass `--no-hash`. For Office-heavy stores, increase `--concurrency`. Skip introspection with `--no-introspect` for filesystem-only inventories.

**pdfjs-dist warning chatter on stderr.** pdfjs-dist emits informational warnings for non-fatal conditions (e.g., "TT: undefined function", unsupported PDF features). These are cosmetic noise — the scan continues and the introspection result is valid. Pipe stderr to `/dev/null`, or use `--quiet` if you want a clean terminal.

**EOL Ubuntu / Node 16 / glibc-2.27 on the remote server.** The audit scripts handle this automatically: if the remote server has Node < 20 (or no Node at all), the script falls back to rsync-and-scan-locally. No manual intervention needed. If you're running filecap directly on such a server (not via the audit scripts), you'll need to install a compatible Node version — see [Why local-mode scanning matters](#why-local-mode-scanning-matters).

**rsync `--info=progress2` not supported on macOS.** The audit scripts use a macOS-compatible rsync progress flag. If you're running rsync manually and see this error, use `--progress` instead of `--info=progress2`.

**`netlify deploy` not found when using `--deploy`.** Install the Netlify CLI with `npm install -g netlify-cli` and authenticate with `netlify login`. filecap prints a reminder with these instructions if the CLI is missing at runtime.

## License

[MIT](LICENSE) © Illinois Criminal Justice Information Authority

## Related @icjia tools

- `@icjia/viewcap` — screenshot capture (MCP)
- `@icjia/lightcap` — Lighthouse audits (MCP)
- `@icjia/axecap` — axe-core accessibility audits (MCP)
- `@icjia/contrastcap` — color contrast auditing (MCP)
