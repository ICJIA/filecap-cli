# filecap fleet-audit site — red / blue team review

**Date:** 2026-05-20
**Reviewed:** the deployed fleet-audit site — `https://icjia-fleet-audit.netlify.app`
(bundle `2026-05-20T20-14-26Z`, filecap v1.15.0) — the 13-site fleet index, the
per-site reports, and the orphaned-files / duplicates / category sub-reports.
**Method:** Lighthouse (lightcap) + axe-core (axecap) on the fleet index, a large
per-site report (ICJIA), and the orphaned-files report; manual browser
walkthrough of the interactive features; HTTP response-header inspection;
sampled link-resolution checks. Audited against a local copy of the deployed
bundle (byte-identical to live) to bypass the Netlify password gate.

---

## Verdict

Functionally the site is **sound — nothing is broken.** Every page loads, the
File/Page view toggle, search box, filter chips, column sort and paginators all
work, and sampled file links resolve. The findings below are **quality and
hardening** issues, not breakage.

The most material cluster is **accessibility.** This is an accessibility-audit
tool, yet its own site scores **88–93** on Lighthouse accessibility (not 100) —
including two findings against the very WCAG 2.1 A/AA criteria the tool exists
to enforce. That is a credibility issue as much as a technical one.

---

## What works (keep)

- The pipeline produces a working, self-contained, deployed static site — fleet
  index + 13 per-site reports + orphans/duplicates/category sub-reports.
- **File / Page view toggle works** — verified switching both directions, with
  `aria-pressed` updating correctly.
- Search, 11 filter chips, 6 sortable columns, and both table paginators are
  present and wired.
- **File links resolve** — sampled 6/6 returned HTTP 200 (real files on the
  production servers); the v1.12.2 path-prefix / encoding fix is holding.
- `<html lang="en">` is set; the fleet index has a `<main>` landmark.
- External links use `target="_blank" rel="noopener noreferrer"`.
- **XSS surface is escaped and regression-tested** — scanned data (filenames,
  paths, server names) is HTML-escaped, embedded data uses the safe
  `<script type="application/json">` pattern, and the FC-2026-008 test suite
  covers it.
- HSTS is present (`strict-transport-security`, 1-year, preload).
- Lighthouse **Performance 100**, **Best Practices 96**; 715 unit tests passing.
- The Netlify password gate is active (live site returns 401).

---

## Findings

| ID | Finding | Category | Severity |
|----|---------|----------|----------|
| A1 | Color-contrast failures on muted text | Accessibility | **High** |
| A2 | In-text links rely on color alone | Accessibility | **High** |
| A3 | Per-site & sub-reports have no `<main>` landmark | Accessibility | Medium |
| A4 | Touch targets below 24×24 px | Accessibility | Low |
| B1 | Console 404 — no favicon | Best practices | Low |
| P1 | Large pages (~4 MB) — data embedded twice | Performance | Medium |
| P2 | Unminified inline CSS/JS, unused CSS | Performance | Low |
| S1 | Missing HTTP hardening headers | Security | Medium |
| S2 | Shared-password gate (not per-user auth) | Security | Info |

### A1 — Color-contrast failures on muted text · **High**

**Red team.** Lighthouse and axe both flag `color-contrast` (WCAG **1.4.3 AA**)
on muted/small text across all page types: the footer text (index + per-site),
`.no-refs`, `.page-audit-source`, `.audit-total` (per-site report), and
`.path-hint` / `.days-old` / `.replaced-on` (orphans report). 1.4.3 is the exact
WCAG 2.1 AA criterion this tool audits other sites against.

**Blue team.** Raise the affected foregrounds (or darken their backgrounds) until
they clear **4.5:1** (3:1 for ≥18.66 px bold / ≥24 px text). The colors are inline
CSS in `src/report/html.js`, `src/report/orphans-html.js`, and
`src/web/index-page.js`. Re-run `lightcap run_a11y` to confirm.

### A2 — In-text links rely on color alone · **High**

**Red team.** `link-in-text-block` (WCAG **1.4.1 A — Use of Color**): the fleet
index "action-list" links and the per-site report footer links are
distinguishable from surrounding text by color only — no underline or other
non-color cue. 1.4.1 is **Level A**, the most basic tier.

**Blue team.** Add `text-decoration: underline` (or an equivalent non-color
indicator) to in-text links in `src/web/index-page.js` (action-list) and
`src/report/html.js` (footer). Standalone UI controls styled as buttons/chips
are exempt — this applies to links embedded in running text.

### A3 — Per-site & sub-reports have no `<main>` landmark · **Medium**

**Red team.** `landmark-one-main`: the per-site reports and the orphaned-files
report render no `<main>` landmark (confirmed: `document.querySelector('main')`
is null on the ICJIA report). The fleet index *does* have one — so the behavior
is inconsistent. Screen-reader users cannot jump to main content.

**Blue team.** Wrap the report body in `<main>` in `src/report/html.js` and
`src/report/orphans-html.js` (and the category sub-report generator), matching
the fleet index.

### A4 — Touch targets below 24×24 px · **Low**

**Red team.** `target-size` (WCAG **2.5.8 AA**, WCAG 2.2): the fleet index's
site-card URL links (×13) and `tech-details` toggles (×13), plus the per-site
report's `.meta-copy` buttons, are smaller than 24×24 px. Mostly affects touch
devices; the audience is primarily desktop, and 2.5.8 is WCAG 2.2 (the tool
targets 2.1 AA) — hence Low.

**Blue team.** Give those interactive elements `min-height`/`min-width` of 24 px
(or padding) in the inline CSS. Cheap to fix alongside A1.

### B1 — Console 404, no favicon · **Low**

**Red team.** No page in the bundle declares a favicon, so every page's
automatic `GET /favicon.ico` returns 404 → a console error → Lighthouse Best
Practices `errors-in-console`. Nothing breaks, but it is the lone console error
and looks unfinished.

**Blue team.** Emit a `<link rel="icon">` in every generated page — an inline
SVG data-URI keeps the self-contained, single-file design (e.g. a small amber
"f" mark consistent with the new README banner).

### P1 — Large pages (~4 MB), data embedded twice · **Medium**

**Red team.** The ICJIA per-site report is **4.2 MB** and the orphaned-files
report **4.4 MB** (`total-byte-weight`); `document-latency-insight` estimates
~2.8–2.9 MB of savings. Cause: each row's data is embedded **twice** — once as
rendered `<tr>` HTML and once in a `<script type="application/json">` block for
client-side sort/search. Lighthouse Performance still scores 100 (desktop, fast
link), and Netlify gzip cuts the *on-the-wire* size substantially — but 4 MB
uncompressed is heavy for tablets / slower connections.

**Blue team.** Stop double-embedding: either render the table rows from the
embedded JSON on load (drop the static `<tr>` HTML) or drop the JSON and have
sort/search read from the DOM. Lower urgency than the a11y items because gzip
already mitigates the wire cost — but the duplication is real waste.

### P2 — Unminified inline CSS/JS, unused CSS · **Low**

**Red team.** `unminified-css` / `unminified-javascript` / `unused-css-rules`
flag ~20–60 KiB per page of unminified or unused inline styles/scripts.

**Blue team.** Minify the inline CSS/JS at generation time and prune unused
rules. Low priority — gzip absorbs most of it.

### S1 — Missing HTTP hardening headers · **Medium**

**Red team.** Live response headers carry HSTS but **not** `X-Frame-Options` /
CSP `frame-ancestors` (clickjacking), `X-Content-Type-Options: nosniff`,
`Content-Security-Policy`, or `Referrer-Policy`. Real-world risk is low — the
site is internal, password-gated, and has no sensitive on-page actions — but
these are standard, cheap hardening headers.

**Blue team.** Have `web-rollup` emit a Netlify `_headers` file in the bundle
(it already emits `_redirects`) with `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a
`Content-Security-Policy`. Note: the reports use inline `<script>`/`<style>`, so
a CSP needs `'unsafe-inline'` or per-build hashes — even a permissive CSP adds
some defense-in-depth.

### S2 — Shared-password gate · **Info**

**Red team.** Access control is a single shared Netlify Site Password (rotated
manually), not per-user authentication. It keeps the site off the public web
but is not real authn/authz.

**Blue team.** Acceptable for the data exposed (a file inventory — names, paths,
audit scores; no PII or credentials). No change recommended; just be aware it is
a soft gate. If per-user access ever matters, Netlify Identity / an SSO proxy
would be the upgrade path.

> **Not a finding:** Lighthouse SEO is 54, driven by `is-crawlable: blocked` and
> a missing meta description. For an internal, password-gated, intentionally
> non-indexed site this is **correct** — SEO is not applicable. Adding a
> `<meta name="description">` is a trivial nicety (nicer link previews in Slack)
> but not required.

---

## Recommended remediation order

Quick wins first — A1–A4 + B1 together would take the Lighthouse accessibility
score to ~100:

1. **B1** — favicon (trivial; removes the only console error).
2. **A2** — underline in-text links (small CSS; clears a Level-A finding).
3. **A1** — raise muted-text contrast to ≥4.5:1 (CSS color values).
4. **A3** — add the `<main>` landmark to the report generators.
5. **A4** — enforce 24×24 px interactive targets.
6. **S1** — emit a `_headers` file from `web-rollup`.
7. **P1 / P2** — de-duplicate the embedded data and minify (largest effort;
   lowest urgency since gzip mitigates the wire cost).

Items 1–5 are small, contained changes to the report generators
(`html.js`, `orphans-html.js`, `index-page.js`) and are individually low-risk.
