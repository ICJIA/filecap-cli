# Friday 2026-05-22 — Manager Demo Walkthrough

A scripted click-through for the ICJIA fleet accessibility audit. Designed
to answer every question a manager will ask, in the order they'll ask it,
with one click per answer. Three layers of accessibility data, all
data-driven, all clickable.

The deliverable lives at **https://fleet.icjia.app** (Netlify
Pro Site Password — request from IDS if you don't have it).

---

## The story you're telling

> "Here's every file on every ICJIA website. For every PDF, you get four
> things in one row: where the file lives, where on our site it's
> referenced, an objective accessibility score, and a link to the
> per-issue audit report. That's the complete picture you need to decide
> whether to keep it, fix it, or delete it."

Three layers stacked on every row:

1. **Public URL** (where the file lives — the audited copy)
2. **Referenced** (where on our site this file is linked from — the
   delete-vs-keep inflection point)
3. **Audit Score** + **Audit Report** (how accessible is the file, with
   the full per-issue breakdown one click away)

If we ship the 1.10.0 page-audit pass before Friday, each "Page N"
anchor in column 2 will also carry a small grade chip ("(B)") — answering
"yeah, but is THAT page itself accessible?" inline.

---

## Click-by-click (3-5 minutes)

### 1. Set the headline

Open https://fleet.icjia.app. Pause on the fleet hero.

> "Across 18 ICJIA websites we found N files. The amber number on the
> left is what may need accessibility audit — that's the actionable
> count. The teal band below it is the average accessibility grade for
> the PDFs we've scored so far."

Point at:

- **Amber audit count** (top-left, big) — "this is the headline number"
- **Cross-site references band** (blue, just below) — "X% of files
  have a known referrer on our site; the others are deletion candidates"
- **PDF accessibility scoring band** (teal, bottom) — "average grade,
  count of PDFs audited, anything still pending or in error"

### 2. Drill into one site

Click any site card (e.g. **DVFR — Domestic Violence Fatality Review**).
The per-site detail page opens.

> "Every site has the same shape. Same hero, same table. Let me show you
> what each row tells you."

### 3. Walk one row end-to-end

Find a meeting-attachment PDF (any row with a populated `Page 1` chip in
the Referenced column). Click columns left-to-right:

| Column | What you say |
| --- | --- |
| **Public URL** | "This is where the actual file lives. Click and you'll get the PDF." |
| **Referenced** → click `Page 1` | "And this is the page on dvfr.illinois.gov that links to that file. New tab opens — the meeting page. If a manager wants to remove the file, this is the inflection point: if there's no `Page N` link here, the file is a deletion candidate. If there is one, we have to remediate or risk a broken link on the website." |
| **Audit Score** chip | "This is the accessibility grade. B (84) means there are some issues but it's largely accessible. We use the strict WCAG 2.1 AA + IITAA §E205.4 profile — same standard the State of Illinois holds itself to." |
| **Audit Report** → click "Open report" | "Click here and audit.icjia.app shows you the per-issue breakdown — heading structure, alt text coverage, table headers, tag tree — with remediation hints. That's the actionable artifact for the remediation vendor." |

### 4. (1.10.0 — if shipped) Show page-level accessibility

Hover the `(B)` chip next to the `Page 1` anchor in the Referenced column.

> "And this small chip? That's the accessibility grade for the page
> itself, not just the file. audit.icjia.app rendered the page in
> headless Chrome and ran axe-core. So now you can answer: is the file
> accessible (the big chip), AND is the page that links to it
> accessible (the small chip in parens)?"

Click the `(B)` chip → opens the page-audit report on audit.icjia.app
with the axe-core violation list.

### 5. Show the deletion-candidate path

Filter the table to PDFs (use the "PDFs" chip in the filter row). Sort by
Audit Score descending (highest scores first). Scroll to the bottom — the
F-grade PDFs.

> "These are the worst-scoring files. Some of them have no referrers in
> the Referenced column — those are clear deletion candidates. Some have
> referrers but the report shows easy fixes — those are remediation
> candidates. Now your team can have an objective conversation about each
> one instead of debating priorities."

### 6. Show the CSV deliverable

Click **Download spreadsheet** in the page header.

> "And the same data is in a CSV — same column order. The columns 16 and
> 17 are `Delete?` and `Notes` for your team to fill in. Hand this to
> your remediation vendor or use it as a worklist."

---

## Likely manager questions + crisp answers

**Q. "How accurate is the score?"**
A. audit.icjia.app's strict profile is anchored to WCAG 2.1 AA + IITAA
§E205.4. It's the same standard the State of Illinois holds itself to. The
methodology is open-source at github.com/ICJIA/file-accessibility-audit.

**Q. "Why are some files in the Referenced column blank?"**
A. Those files have no known referrer on any audited site. They might be
truly orphaned (uploaded and never linked) — those are deletion candidates
— or referenced from somewhere outside the audit's reach (an external
agency's site, an email blast). Empty Referenced means "investigate before
deleting."

**Q. "Do you score Word documents and spreadsheets too?"**
A. The PDF audit is the headline because PDFs have the most complex
accessibility requirements. Word/Excel/PowerPoint have native accessibility
checkers inside Word/Excel/PowerPoint that handle their formats better
than a third-party tool would. We list those files in the inventory but
don't score them here.

**Q. "How often is this re-run?"**
A. Today it's manually triggered by IDS via `audit-fleet-auto.sh`. Each
full run takes 1-3 hours depending on fleet size. The cache means
subsequent runs are nearly free for unchanged files. Plan is to schedule
a weekly cron once the pipeline is stable.

**Q. "Can we get a per-program rollup?"**
A. Currently per-site. Per-program (CrossX-cutting like "all SPAC files
across icjia + spac sites") is a future enhancement — the data's there,
the UI isn't built yet.

**Q. "What if the audit endpoint goes down?"**
A. Cells render `Unavailable` for files we couldn't score. The rest of
the row (filename, referrers, etc.) still works. Re-running once the
endpoint is up picks up where we left off (cached scores for unchanged
files, only re-audits new/changed).

**Q. "Are you sending file contents to a third party?"**
A. audit.icjia.app is ICJIA-owned, ICJIA-hosted. No third party. Source
code is open: github.com/ICJIA/file-accessibility-audit. The fleet audit
tool itself (filecap) is also open: github.com/ICJIA/icjia-fleet-audit.

**Q. "Can I see the actual issues, not just the grade?"**
A. Click the **Open report** link in the Audit Report column. That's the
audit.icjia.app per-issue breakdown — heading structure, alt text,
language tag, reading order, table headers — with severity (critical /
serious / moderate / minor) and remediation hints per finding.

---

## What to NOT show / sidestep

- **The 192-IP stale-directory bug.** Pre-2026-05-19 fleet runs sometimes
  included a stale "203.0.113.10" directory whose entries rendered as
  `Unavailable`. Already fixed in audit-fleet-auto.sh; ignore if anyone
  asks why old screenshots had those.
- **The Vue 2 git-site Netlify SPA catch-all.** Old ARI Summit sites
  needed `pathPrefix: "/static"` because vue-cli preserves the static
  segment in the URL while Nuxt collapses it. Boring infra detail; only
  bring it up if someone asks "why did those ari-summit-* PDFs all show
  Unavailable before today?"
- **Rate limits.** audit.icjia.app's analyze rate limit was bumped from
  35/hour to 5000/hour for the fleet pass. Boring infra; mention only if
  someone asks about scale.

---

## If something doesn't work mid-demo

- **A score shows `Unavailable`** — the audit endpoint failed on that
  file for some reason (404, server error, non-PDF content despite a .pdf
  extension). Move on; pick a different row.
- **A `Page N` link 404s** — the deployed page URL was constructed from
  the content-type route in sites.json but doesn't match the live site.
  Note it ("we'll fix the route mapping"), move on.
- **The deployed bundle URL itself is unreachable** — check the Netlify
  status page; should be rare. The bundle is a static-site deploy with
  no runtime dependencies, so this is genuinely unusual.

---

## After the demo

If a manager wants their own copy of the audit:

1. Email them the Netlify URL + password (request both from IDS)
2. They open it in any browser; nothing to install
3. CSV download via the **Download spreadsheet** button on any page
4. CSV opens in Excel / Sheets / Numbers; columns 16-17 are theirs
   to fill in (`Delete?` and `Notes`)
5. They email the marked-up CSV back to IDS or hand it to a remediation
   vendor — same workflow either way

That's it. No accounts, no per-user data, no per-user state.
