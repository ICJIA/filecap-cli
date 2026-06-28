// v1.21.0 — CSS extracted verbatim from index-page.js so the /sites page
// can reuse the exact same stylesheet (zero visual drift). Pure CSS; no JS
// interpolation lives here. New /sites + tooling + card-image rules are
// appended at the bottom, after the __SITES_EXTRA_CSS__ marker.
export const INDEX_CSS = `
/* ── base ────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.6;
  color: #e5e5e5;
  background: #0d1117;
  margin: 0;
  padding: 0;
}
a { color: #60a5fa; text-decoration: underline; }
a:hover { color: #93c5fd; text-decoration: underline; }
h1 {
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #e5e5e5;
  margin: 0 0 0.5rem;
}
h2 {
  font-size: 1.1rem;
  font-weight: 600;
  color: #e5e5e5;
  margin: 0 0 1rem;
}

/* ── sticky header ───────────────────────────────────────────── */
.site-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: #161b22;
  border-bottom: 1px solid #21262d;
  padding: 0.75rem 2rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.site-header-left {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  min-width: 0;
}
.site-header .icjia-logo {
  display: inline-flex;
  align-items: center;
  color: #ffffff;
  height: 38px;
  flex: none;
  /* v1.20.0 — logo is now an <a href="#top"> that smooth-scrolls. Reset
     anchor underline/color so the visual is unchanged, then add focus
     visibility for keyboard users. */
  text-decoration: none;
  border-radius: 4px;
  outline: none;
  transition: opacity 140ms ease;
}
.site-header .icjia-logo:hover { opacity: 0.85; }
.site-header .icjia-logo:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 4px;
}
.site-header .icjia-logo svg {
  height: 100%;
  width: auto;
  display: block;
}
/* v1.20.0 — smooth scroll for #top jumps. Disabled under reduced-motion. */
html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
.site-header .brand {
  font-weight: 700;
  font-size: 0.88rem;
  color: #e5e5e5;
  letter-spacing: -0.01em;
  padding-left: 0.85rem;
  border-left: 1px solid #21262d;
}
.site-header .brand span { color: #60a5fa; }
@media (max-width: 600px) {
  .site-header .icjia-logo { height: 32px; }
  .site-header .brand { font-size: 0.9rem; padding-left: 0.65rem; }
}

/* v1.7.16: ICJIA PDF accessibility audit tool button. Visually prominent
   (filled blue) so managers/remediators see it without scanning. Same
   pattern repeats in the per-site detail page sticky bar. */
.site-header-right {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: none;
}
.audit-tool-link {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.4rem 0.8rem;
  background: linear-gradient(180deg, #4dabf7 0%, #2f8de0 100%);
  color: #0c1219;
  font-weight: 700;
  font-size: 0.8rem;
  letter-spacing: 0.01em;
  text-decoration: none;
  border-radius: 7px;
  border: 1px solid #2f8de0;
  transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
  white-space: nowrap;
}
.audit-tool-link:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(77, 171, 247, 0.35);
  filter: brightness(1.05);
}
.audit-tool-link:focus-visible {
  outline: 3px solid #58a6ff;
  outline-offset: 2px;
}
.audit-tool-link:active { transform: translateY(0); filter: brightness(0.96); }
.audit-tool-icon { width: 14px; height: 14px; flex: none; }
@media (max-width: 600px) {
  .audit-tool-link { padding: 0.4rem 0.7rem; font-size: 0.82rem; }
  .audit-tool-link span { display: none; }
  .audit-tool-icon { width: 16px; height: 16px; }
}

/* ── main content ────────────────────────────────────────────── */
main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

/* ── hero / fleet totals ─────────────────────────────────────── */
.hero {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 12px;
  padding: 2rem;
  margin-bottom: 2.5rem;
}
.hero h1 { margin-bottom: 0.25rem; }
.hero .subtitle {
  font-size: 0.9rem;
  color: #999999;
  margin: 0 0 1.5rem;
}
/* v1.7.23 — top section banner. Mirrors the v1.7.22 dup-section-banner so
   the page reads as TWO symmetric major sections (Fleet snapshot, Cross-
   Server Duplicates). Blue accent bar here vs amber on duplicates — the
   color encodes section identity at a glance. */
.fleet-section-banner {
  margin: 1.5rem 0 1.5rem;
  padding-top: 0;
}
.fleet-section-banner::before {
  content: "";
  display: block;
  width: 72px;
  height: 5px;
  background: linear-gradient(90deg, #4dabf7 0%, #1f6feb 100%);
  border-radius: 3px;
  margin-bottom: 1.4rem;
}
.fleet-section-eyebrow {
  margin: 0 0 0.55rem;
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #4dabf7;
}
.fleet-section-headline {
  margin: 0 0 0.9rem;
  font-size: clamp(2.2rem, 4.5vw, 3.1rem);
  font-weight: 900;
  line-height: 1.08;
  letter-spacing: -0.025em;
  color: #ffffff;
}
.fleet-section-lede {
  margin: 0 0 0.7rem;
  max-width: 72ch;
  font-size: 1.1rem;
  line-height: 1.55;
  color: #c0cdda;
}
.fleet-section-meta {
  margin: 0;
  font-size: 0.85rem;
  color: #8b949e;
  letter-spacing: 0.02em;
}
@media (max-width: 720px) {
  .fleet-section-banner { margin: 1rem 0 1.2rem; }
  .fleet-section-banner::before { width: 56px; height: 4px; margin-bottom: 1rem; }
  .fleet-section-lede { font-size: 1rem; }
}

/* v1.7.23 — "Zero PII" reassurance banner. Sits right under the top section
   banner so anyone on the page sees it immediately. Green color register
   = "safe / verified." Two-column IN / NOT-IN list so a manager can
   scan the data scope without reading prose. */
/* v1.7.25: vertically tightened. Same content (eyebrow + title + lede +
   two-column in/out lists + footnote about the Intranet) but ~30% less
   vertical real estate — every padding and margin pulled in, smaller
   icon column, tighter list line-height + item gaps. */
.no-pii-banner {
  margin: 0 0 1.6rem;
  padding: 1rem 1.2rem;
  display: grid;
  grid-template-columns: 42px 1fr;
  gap: 0.9rem;
  background: linear-gradient(180deg, #11221a 0%, #0f1d17 100%);
  border: 1px solid #1f4a37;
  border-left: 5px solid #66d9a3;
  border-radius: 10px;
}
.no-pii-banner-icon {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 0.15rem;
  color: #66d9a3;
}
.no-pii-banner-icon svg { width: 36px; height: 36px; }
.no-pii-banner-body { min-width: 0; }
.no-pii-banner-eyebrow {
  margin: 0 0 0.2rem;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #66d9a3;
}
.no-pii-banner-title {
  margin: 0 0 0.4rem;
  font-size: 1.35rem;
  font-weight: 900;
  letter-spacing: -0.012em;
  line-height: 1.2;
  color: #ffffff;
}
.no-pii-banner-lede {
  margin: 0 0 0.7rem;
  font-size: 0.95rem;
  line-height: 1.45;
  color: #d4dae0;
}
.no-pii-banner-lede strong { color: #ffffff; }
.no-pii-banner-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.7rem;
  margin: 0 0 0.65rem;
}
@media (max-width: 720px) {
  .no-pii-banner { grid-template-columns: 1fr; padding: 0.9rem 1rem; }
  .no-pii-banner-icon { padding-top: 0; }
  .no-pii-banner-icon svg { width: 30px; height: 30px; }
  .no-pii-banner-columns { grid-template-columns: 1fr; gap: 0.55rem; }
}
.no-pii-banner-col {
  padding: 0.55rem 0.75rem;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid #1f3a30;
  border-radius: 6px;
}
.no-pii-banner-col-in   { border-left: 3px solid #66d9a3; }
.no-pii-banner-col-out  { border-left: 3px solid #f57878; }
.no-pii-banner-col h3 {
  margin: 0 0 0.3rem;
  font-size: 0.86rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: #ffffff;
}
.no-pii-banner-col-in h3 em  { color: #66d9a3; font-style: italic; font-weight: 700; }
.no-pii-banner-col-out h3 em { color: #f57878; font-style: italic; font-weight: 700; }
.no-pii-banner-col ul {
  margin: 0;
  padding-left: 1rem;
  font-size: 0.85rem;
  line-height: 1.4;
  color: #c0cdda;
}
.no-pii-banner-col ul li { margin: 0.12rem 0; }
.no-pii-banner-footer {
  margin: 0;
  padding: 0.5rem 0.8rem;
  background: rgba(102, 217, 163, 0.08);
  border-left: 3px solid #66d9a3;
  border-radius: 0 5px 5px 0;
  font-size: 0.87rem;
  line-height: 1.45;
  color: #c8e6d2;
}
.no-pii-banner-footer strong { color: #ffffff; }

/* ── fleet-hero (v1.7.13) ────────────────────────────────────────
   Manager-friendly infographic hero. Pre-v1.7.13 the hero led with the
   TOTAL files number (e.g. "14,914") which managers misread as "every
   one of these needs work." The new hero leads with the AUDIT count
   (e.g. "11,097") in big amber type, with a donut chart on the right
   echoing the per-site card pattern so the fleet view and the per-site
   view feel like the same product. Two-column on desktop; stacked on
   narrow viewports. */
.fleet-hero {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 2.5rem;
  align-items: center;
  margin-top: 1rem;
}
@media (max-width: 720px) {
  .fleet-hero { grid-template-columns: 1fr; gap: 1.5rem; }
}

.fleet-hero-num-block { min-width: 0; }
.fleet-hero-eyebrow {
  font-size: 0.85rem;
  font-weight: 800;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: #c0cdda;
  margin: 0 0 0.6rem;
}
.fleet-hero-num {
  font-size: clamp(4em, 12vw, 7em);
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.03em;
  color: #ffa84d;
  font-variant-numeric: tabular-nums;
  margin: 0 0 0.6rem;
}
.fleet-hero-pages {
  /* v1.20.0 — secondary metric beside the big file count. Pages are the
     unit remediation vendors quote against, so the hero reports both
     "files" (primary, what you have) and "pages" (estimated, what it
     will cost to fix). Tooltip on hover shows the per-format breakdown. */
  font-size: clamp(1.3rem, 3vw, 1.7rem);
  font-weight: 700;
  line-height: 1.2;
  color: #ffc888;
  margin: 0 0 0.6rem;
  font-variant-numeric: tabular-nums;
  cursor: help;
  letter-spacing: -0.01em;
}
.fleet-hero-pages strong { color: #ffe1b8; font-weight: 800; }
.fleet-hero-pages-hint {
  display: inline-block;
  margin-left: 0.5em;
  font-size: 0.65em;
  font-weight: 600;
  color: #9aa5b1;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.fleet-hero-context {
  font-size: 1rem;
  color: #9aa5b1;
  line-height: 1.5;
  max-width: 38ch;
  margin: 0;
}
.fleet-hero-context strong { color: #d4dae0; font-weight: 700; }

/* v1.20.0 — "potential workload" callout below the fleet hero. Amber-tinted
   note that hedges the page-count numbers so a manager doesn't quote them
   as a fixed commitment. Sits between the hero and the per-site grid. */
.potential-callout {
  margin: 1.4rem 0 0;
  padding: 0.95rem 1.1rem;
  background: rgba(255, 168, 77, 0.08);
  border-left: 3px solid #d97706;
  border-radius: 4px;
  color: #d8e0e8;
  font-size: 0.95rem;
  line-height: 1.55;
}
.potential-callout p { margin: 0; }
.potential-callout p + p { margin-top: 0.55em; }
.potential-callout strong { color: #ffc888; }
.potential-callout em { color: #ffd699; font-style: italic; }
.potential-callout .potential-callout-eyebrow {
  font-size: 0.78em;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #ffc888;
  margin-bottom: 0.6em;
}
.potential-callout .potential-callout-eyebrow strong { color: #ffe1b8; text-transform: none; letter-spacing: 0.01em; }
.potential-callout .potential-callout-eyebrow-suffix { font-weight: 600; color: #c9d1d9; opacity: 0.85; text-transform: none; letter-spacing: 0.02em; margin-left: 0.4em; }

.fleet-hero-donut-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  min-width: 0;
}
.fleet-hero-donut {
  width: 200px;
  height: 200px;
  border-radius: 50%;
  background: conic-gradient(
    #ffa84d 0 var(--pct, 0%),
    rgba(77, 171, 247, 0.45) var(--pct, 0%) 100%
  );
  display: flex; align-items: center; justify-content: center;
  position: relative;
  flex: none;
}
.fleet-hero-donut::after {
  content: "";
  position: absolute;
  inset: 26px;
  background: #161b22;
  border-radius: 50%;
}
.fleet-hero-donut-pct {
  position: relative;
  z-index: 1;
  font-weight: 900;
  font-size: 2.2em;
  color: #ffa84d;
  line-height: 1;
  text-align: center;
}
.fleet-hero-donut-pct small {
  display: block;
  font-size: 0.36em;
  color: #9aa5b1;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 6px;
}
.fleet-hero-phrase {
  text-align: center;
  color: #d4dae0;
  font-size: 1.05em;
  margin: 0;
  max-width: 22ch;
}
.fleet-hero-phrase strong { color: #ffffff; font-weight: 700; }

/* ── fleet-audit-band (v1.9.0) ──────────────────────────────────
   Strip below the cross-site reference band. Surfaces the PDF
   accessibility-score average + counts from audit.icjia.app, distinct
   colour register (green/teal) so the eye can tell it apart from the
   amber audit-count hero and the blue references band. */
.fleet-audit-band {
  margin-top: 1.5rem;
  padding: 1.25rem 1.5rem;
  border: 1px solid #1f4837;
  border-radius: 6px;
  background: linear-gradient(180deg, rgba(20, 184, 166, 0.10) 0%, rgba(20, 184, 166, 0.04) 100%);
}
.fleet-audit-eyebrow {
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: #5eead4;
  margin: 0 0 0.6rem;
}
.fleet-audit-row {
  display: flex;
  flex-wrap: wrap;
  gap: 2.5rem 3rem;
  align-items: center;
}
.fleet-audit-stat {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  min-width: 0;
}
.fleet-audit-grade {
  display: inline-block;
  font-size: clamp(1.6em, 4vw, 2.2em);
  font-weight: 800;
  letter-spacing: -0.02em;
  padding: 0.05em 0.45em;
  border-radius: 6px;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.fleet-audit-grade-a { background: rgba(34, 197, 94, 0.18);  color: #4ade80; border: 1px solid #166534; }
.fleet-audit-grade-b { background: rgba(20, 184, 166, 0.18); color: #5eead4; border: 1px solid #115e59; }
.fleet-audit-grade-c { background: rgba(234, 179, 8, 0.18);  color: #fde047; border: 1px solid #854d0e; }
.fleet-audit-grade-d { background: rgba(249, 115, 22, 0.18); color: #fdba74; border: 1px solid #9a3412; }
.fleet-audit-grade-f { background: rgba(239, 68, 68, 0.18);  color: #fca5a5; border: 1px solid #991b1b; }
.fleet-audit-grade-x { background: rgba(107, 114, 128, 0.15); color: #9ca3af; border: 1px solid #4b5563; }
.fleet-audit-num {
  font-size: clamp(1.6em, 4vw, 2.2em);
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #5eead4;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.fleet-audit-num-dim {
  color: #c0cdda;
}
.fleet-audit-lbl {
  font-size: 0.95rem;
  color: #c0cdda;
  line-height: 1.4;
}
.fleet-audit-lbl strong {
  color: #ffffff;
  font-weight: 700;
}
.fleet-audit-context {
  margin: 0.9rem 0 0;
  font-size: 0.88rem;
  color: #9aa5b1;
  line-height: 1.5;
  max-width: 80ch;
}
.fleet-audit-context a {
  color: #5eead4;
}

/* ── explanation section ───────────────────────────────────────── */
.explanation {
  margin: 3em 0;
}
.explanation > h2 {
  font-size: 1.15rem;
  margin-bottom: 0.75rem;
}
.explanation > p {
  font-size: 1.05em;
  line-height: 1.7;
  color: #e5e5e5;
  max-width: 65ch;
}
.explanation-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 2em;
  margin-top: 1.5em;
}
.explanation-card {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 12px;
  padding: 1.5em;
}
.explanation-card h3 {
  margin-top: 0;
  font-size: 1.1em;
  font-weight: 600;
  color: #e5e5e5;
}
.explanation-card p {
  font-size: 0.95em;
  line-height: 1.65;
  color: #c4c4c4;
  margin: 0.75em 0;
}
.explanation-card strong {
  color: #e5e5e5;
}

/* ── by-type breakdown ─────────────────────────────────────────── */
.by-type {
  margin: 3em 0;
}
.by-type > h2 {
  font-size: 1.15rem;
  margin-bottom: 1rem;
}
.by-type-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 2em;
}
.by-type-column {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 12px;
  padding: 1.5em;
}
.by-type-column.remediable { border-top: 3px solid #fbbf24; }
.by-type-column.reference  { border-top: 3px solid #71717a; }
.by-type-column h3 {
  margin: 0 0 0.25em;
  font-size: 1.05em;
  font-weight: 600;
}
.by-type-column .caption {
  margin: 0 0 1em;
  font-size: 0.9em;
  color: #999999;
}
.by-type-column table {
  width: 100%;
  border-collapse: collapse;
}
.by-type-column td {
  padding: 0.5em 0;
  border-bottom: 1px solid #21262d;
}
.by-type-column tfoot td {
  font-weight: 600;
  border-bottom: none;
  border-top: 2px solid #30363d;
  padding-top: 0.7em;
}
.by-type-column td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* v1.7.14 — clickable by-type row. Label opens the per-type detail page
   (table of every file of that type across the fleet, with a CSV
   download). Count opens just the CSV. Both styled subtly so the rows
   still scan as a table; hover lights them up. */
.by-type-column .by-type-link {
  display: inline-flex;
  align-items: center;
  gap: 0.45em;
  color: #d4dae0;
  text-decoration: none;
  transition: color 100ms ease;
}
.by-type-column .by-type-link:hover,
.by-type-column .by-type-link:focus-visible {
  color: #58a6ff;
  text-decoration: underline;
}
.by-type-column .by-type-link:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
  border-radius: 2px;
}
.by-type-column .by-type-link-icon {
  width: 12px;
  height: 12px;
  opacity: 0.55;
  flex: none;
  transition: opacity 100ms ease, transform 140ms ease;
}
.by-type-column .by-type-link:hover .by-type-link-icon,
.by-type-column .by-type-link:focus-visible .by-type-link-icon {
  opacity: 1;
  transform: translateX(2px);
}
.by-type-column .by-type-csv-link {
  color: #d4dae0;
  text-decoration: none;
  font-variant-numeric: tabular-nums;
  border-bottom: 1px dotted #2a323d;
  transition: color 100ms ease, border-color 100ms ease;
}
.by-type-column .by-type-csv-link:hover,
.by-type-column .by-type-csv-link:focus-visible {
  color: #58a6ff;
  border-bottom-color: #58a6ff;
}
.by-type-column .by-type-csv-link:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
  border-radius: 2px;
}

/* ─── Site-card anatomy v1.7.0 + v1.7.1 clickable card ─── */
.site-card {
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #18202b 0%, #141a23 100%);
  border: 1px solid var(--fc-border-subtle, #2a323d);
  border-radius: 22px;
  padding: 28px 26px 24px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.32);
  min-height: 540px;
  color: var(--fc-text-primary, #e5e5e5);
  /* v1.7.1 — whole card is clickable (stretched-link pattern) with
     a hover lift so the affordance is obvious. The actual <a> overlay
     sits absolutely positioned at z-index 0; siblings get z-index 1. */
  position: relative;
  cursor: pointer;
  transition: transform 200ms ease, box-shadow 200ms ease, border-color 200ms ease;
}
.site-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
  border-color: #4dabf7;
}
.site-card:focus-within {
  outline: 3px solid #4dabf7;
  outline-offset: 4px;
}
.site-card .card-stretched-link {
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: inherit;
  /* hide the empty-text content from screen readers' visual rendering;
     aria-label provides the accessible name */
  text-indent: -9999px;
  overflow: hidden;
}
.site-card .card-stretched-link:focus { outline: none; }
.site-card > *:not(.card-stretched-link) {
  position: relative;
  z-index: 1;
}
/* v1.7.7: make the whole card clickable. Pre-v1.7.7 the stretched-link
   pattern only worked on the small padding gaps between children — every
   visible text/tile/donut sat above the link (z-index 1 vs 0) and
   captured the click but had no click handler. Bumping the link's
   z-index introduces its own landmines: it would cover the action
   buttons (which would then need higher z-index escape hatches), and
   the donut's internal .pct (position relative, z-index 1) would still
   end up on top of the link. Cleaner solution: make every
   non-interactive descendant pointer-events:none so the click falls
   through to the link, then explicitly re-enable pointer-events on the
   real interactive elements (action buttons + tech-details disclosure
   summary). v1.19.0: the site-url anchor is now a real link to the live
   site, opened in a new tab — it's in the pointer-events:auto list below
   and lifted above the overlay; every other card surface still routes the
   click to the detail page. */
.site-card > *:not(.card-stretched-link),
.site-card > *:not(.card-stretched-link) * {
  pointer-events: none;
}
.site-card .actions .btn,
.site-card .tech-details summary,
.site-card .tech-details .meta-copy,
.site-card .tech-details .meta-value a,
.site-card .site-url a,
.site-card .access-chip {
  pointer-events: auto;
}
@media (prefers-reduced-motion: reduce) {
  .site-card { transition: none; }
  .site-card:hover { transform: none; }
}
.site-card .card-head { text-align: center; margin-bottom: 18px; }
.site-card .nickname {
  font-size: 0.82em;
  font-weight: 800;
  color: var(--fc-nickname, #c0cdda);  /* ≥ 7:1 on card bg — WCAG AAA at small sizes */
  letter-spacing: 0.10em;
  text-transform: uppercase;
  margin: 0 0 6px;
}
.site-card .full-name {
  font-size: 1.55em;
  font-weight: 800;
  line-height: 1.18;
  color: #ffffff;
  letter-spacing: -0.01em;
  margin: 0 auto;
  max-width: 28ch;
  min-height: 2.4em;             /* reserve 2 lines so single-line names still align */
  display: flex;
  align-items: center;
  justify-content: center;
}
.site-card .site-url {
  margin: 6px 0 0;
  font-size: 0.85em;
  color: var(--fc-text-muted, #9aa5b1);
}
/* v1.19.0 — the site URL is a real link to the live site, opened in a new
   tab. position + z-index lift the anchor above the card's stretched-link
   overlay (z-index 0); pointer-events:auto (set in the rule above) re-enables
   the click the card-wide pointer-events:none would otherwise swallow. */
.site-card .site-url a {
  position: relative;
  z-index: 2;
  color: var(--fc-accent, #4dabf7);
  text-decoration: none;
  /* v1.21.1 — WCAG 2.5.8 (AA) target size: the URL is a distinct tap target
     (opens the live site in a new tab), so give the link a >=24px box. */
  display: inline-block;
  padding: 5px 9px;
}
.site-card .site-url a:hover,
.site-card .site-url a:focus-visible { text-decoration: underline; }

/* v1.7.6 — access-method chip in the card-head eyebrow position. Three
   variants (Strapi/GitHub/Server) with distinct hue so a manager can scan
   the index and immediately tell what credentials each site needs. The
   detail page repeats this in a larger "How to access" panel with the
   "Contact IDS at ICJIA" line + SSH-key copy. */
.site-card .access-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0 auto 10px;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 0.74em;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1.2;
  border: 1px solid currentColor;
  /* v1.7.34: chip is now a <button> that opens an access-instructions
     modal. Reset browser-default button styling so it still reads as a
     chip; cursor-pointer + subtle hover lift signal interactivity. */
  font-family: inherit;
  background-image: none;
  cursor: pointer;
  transition: filter 120ms ease, transform 120ms ease;
}
.site-card .access-chip:hover,
.site-card .access-chip:focus-visible {
  filter: brightness(1.18);
  transform: translateY(-1px);
}
.site-card .access-chip:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
.site-card .access-chip .access-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: currentColor;
  flex: none;
}
/* Cyan — Strapi CMS (most common). #7dd3fc on dark gives ≥ 8:1 contrast. */
.site-card .access-strapi { color: #7dd3fc; background: rgba(125, 211, 252, 0.08); }
/* Violet — GitHub repo. #c4b5fd gives ≥ 7:1 contrast on the card bg. */
.site-card .access-github { color: #c4b5fd; background: rgba(196, 181, 253, 0.08); }
/* Amber — bare server (uncommon, signals "different"). #fcd34d ≥ 9:1. */
.site-card .access-server { color: #fcd34d; background: rgba(252, 211, 77, 0.08); }

.site-card .nums {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin: 0 0 18px;
}
.site-card .tile { padding: 18px 8px; border-radius: 14px; text-align: center; }
.site-card .tile.total { background: rgba(77, 171, 247, 0.10); }
.site-card .tile.audit { background: rgba(255, 168, 77, 0.13); }
.site-card .tile .num {
  font-size: 3.6em;
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  display: block;
}
.site-card .tile.total .num { color: #4dabf7; }
.site-card .tile.audit .num { color: #ffa84d; }
.site-card .tile .lbl {
  display: block;
  margin-top: 8px;
  font-size: 0.78em;
  color: var(--fc-text-muted, #9aa5b1);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
/* v1.20.0 — secondary line under the "may need audit" tile showing the
   inclusive approximate page count (potential remediation workload).
   Tooltip on hover spells out the per-format breakdown + the hedging that
   the figure shifts as content changes. */
.site-card .tile .lbl-sub {
  display: block;
  margin-top: 0.55em;
  padding-top: 0.55em;
  font-size: 0.85em;
  font-weight: 700;
  color: #ffc888;
  letter-spacing: 0.01em;
  cursor: help;
  border-top: 1px dashed rgba(255,168,77,0.28);
  font-variant-numeric: tabular-nums;
}

.site-card .donut-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  margin: 6px 0 18px;
}
.site-card .donut {
  width: 180px; height: 180px;
  border-radius: 50%;
  background: conic-gradient(
    #ffa84d 0 var(--pct, 0%),
    rgba(77, 171, 247, 0.45) var(--pct, 0%) 100%
  );
  display: flex; align-items: center; justify-content: center;
  position: relative;
  flex: none;
}
.site-card .donut::after {
  content: "";
  position: absolute;
  inset: 22px;
  background: #141a23;
  border-radius: 50%;
}
.site-card .donut .pct {
  position: relative; z-index: 1;
  font-weight: 900;
  font-size: 1.7em;
  color: #ffa84d;
  line-height: 1;
  text-align: center;
}
.site-card .donut .pct small {
  display: block;
  font-size: 0.45em;
  color: #9aa5b1;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 4px;
}
.site-card .donut-caption { text-align: left; }
.site-card .donut-caption strong { display: block; color: #ffffff; font-size: 1em; }
.site-card .donut-caption span { color: #9aa5b1; font-size: 0.85em; }

.site-card .chips {
  display: flex; justify-content: center; flex-wrap: wrap;
  gap: 8px; margin: 0 0 12px;
}
.site-card .chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 11px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 999px;
  font-size: 0.88em;
  color: #d4dae0;
}
.site-card .chip .ico { width: 16px; height: 16px; flex: none; }
.site-card .chip-pdf .ico { color: #ff6b6b; }
.site-card .chip-doc .ico { color: #4dabf7; }
.site-card .chip-img .ico { color: #9aa5b1; }

.site-card .scan-meta {
  font-size: 0.82em;
  color: var(--fc-text-muted, #9aa5b1);
  margin: 6px 0 12px;
  text-align: center;
}

/* v1.36.0 — file-accessibility strip: the average of the site's scored-PDF
   audit reports, banded far→partial→closer. The band class sets --a11y-accent
   (bar + dot + score + pill) and --a11y-tint (pill background). a11y-na covers
   the excluded archive and thin-data sites (caption only, no score). */
.site-card .a11y-strip {
  margin: 0 0 16px;
  padding: 11px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border-left: 4px solid var(--a11y-accent, #6e7681);
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.site-card .a11y-head {
  font-size: 0.72em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #9aa5b1;
}
.site-card .a11y-head small {
  text-transform: none;
  letter-spacing: 0;
  font-weight: 600;
  opacity: 0.85;
}
.site-card .a11y-body {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.site-card .a11y-score {
  font-size: 2.1em;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--a11y-accent, #e5e5e5);
}
.site-card .a11y-score small {
  font-size: 0.42em;
  font-weight: 700;
  color: #9aa5b1;
  letter-spacing: 0.02em;
}
.site-card .a11y-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 11px;
  border-radius: 999px;
  background: var(--a11y-tint, rgba(255, 255, 255, 0.06));
  color: var(--a11y-accent, #d4dae0);
  font-size: 0.82em;
  font-weight: 700;
}
.site-card .a11y-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--a11y-accent, #9aa5b1);
  flex: none;
}
.site-card .a11y-note {
  color: #9aa5b1;
  font-size: 0.86em;
  line-height: 1.45;
}
.site-card .a11y-cover {
  font-size: 0.74em;
  color: #8b95a1;
  line-height: 1.45;
  margin-top: 1px;
}
/* v1.38.0 — infographic gauge: a fixed red→amber→green track (band thresholds
   as zones) with a marker at the score, so the far→closer position reads at a
   glance without reading the number. */
.site-card .a11y-gauge { width: 100%; padding-top: 7px; margin: 1px 0 3px; }
.site-card .a11y-gauge-track {
  position: relative;
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(to right,
    #e5484d 0 60%,
    #e3a008 60% 80%,
    #30a46c 80% 100%);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.30);
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}
.site-card .a11y-gauge-marker {
  position: absolute;
  top: -3px; bottom: -3px;
  width: 3px;
  background: #fff;
  transform: translateX(-50%);
  border-radius: 2px;
  box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.55);
}
.site-card .a11y-gauge-marker::before {
  content: "";
  position: absolute;
  top: -7px; left: 50%;
  transform: translateX(-50%);
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 6px solid #fff;
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.6));
}
/* v1.38.0 — "since last audit" trend chip: ▲ improved (green) / ▼ declined
   (red) / no change (grey). */
.site-card .a11y-trend {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.78em;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
}
.site-card .a11y-trend-up   { color: #56d364; background: rgba(63, 185, 80, 0.14); }
.site-card .a11y-trend-down { color: #ff7b72; background: rgba(248, 81, 73, 0.14); }
.site-card .a11y-trend-flat { color: #9aa5b1; background: rgba(255, 255, 255, 0.06); }
.site-card .a11y-far     { --a11y-accent: #ff7b72; --a11y-tint: rgba(248, 81, 73, 0.13); }
.site-card .a11y-partial { --a11y-accent: #e3b341; --a11y-tint: rgba(227, 160, 8, 0.15); }
.site-card .a11y-closer  { --a11y-accent: #56d364; --a11y-tint: rgba(63, 185, 80, 0.15); }
.site-card .a11y-na      { --a11y-accent: #6e7681; --a11y-tint: rgba(255, 255, 255, 0.05); }

.site-card .tech-details { margin: 6px 0 12px; font-size: 0.82em; color: var(--fc-text-muted, #9aa5b1); }
.site-card .tech-details summary { cursor: pointer; min-height: 24px; padding: 3px 0; }
.site-card .tech-details .hostname,
.site-card .tech-details .ip { margin: 4px 0 0; }
/* v1.7.8 — expanded tech-details: 5-row mini-grid mirroring the per-site
   detail page's meta-grid (website, IP, hostname, scanned path, public URL)
   with a copy-to-clipboard button on every row. Label is monospace + muted
   so the value reads as the foreground content. Long values (scanned path)
   word-break so the card width stays bounded. */
.site-card .tech-details .tech-grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.3rem 0.8rem;
  margin: 8px 0 0;
  align-items: center;
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.92em;
}
.site-card .tech-details .tech-label {
  font-weight: 700;
  color: var(--fc-text-muted, #9aa5b1);
}
.site-card .tech-details .meta-value {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  color: #d4dae0;
  word-break: break-all;
}
.site-card .tech-details .meta-value > a {
  color: var(--fc-accent, #4dabf7);
  text-decoration: none;
  word-break: break-all;
}
.site-card .tech-details .meta-value > a:hover { text-decoration: underline; }
.site-card .tech-details .meta-copy {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  width: 24px;
  height: 22px;
  padding: 0;
  background: transparent;
  border: 1px solid #2a323d;
  border-radius: 4px;
  color: #9aa5b1;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.72rem;
  line-height: 1;
  overflow: hidden;
  vertical-align: middle;
  transition: background 100ms ease, color 100ms ease, border-color 100ms ease, width 140ms ease;
}
.site-card .tech-details .meta-copy:hover {
  background: rgba(88, 166, 255, 0.10);
  color: #58a6ff;
  border-color: #58a6ff;
}
.site-card .tech-details .meta-copy:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
}
.site-card .tech-details .meta-copy.copied {
  width: 64px;
  color: #66d9a3;
  border-color: #66d9a3;
  background: rgba(102, 217, 163, 0.10);
}
.site-card .tech-details .meta-copy-icon { width: 13px; height: 13px; flex: none; }
.site-card .tech-details .meta-copy-feedback {
  display: none;
  font-weight: 700;
  font-size: 0.7rem;
  letter-spacing: 0.04em;
}
.site-card .tech-details .meta-copy.copied .meta-copy-icon { display: none; }
.site-card .tech-details .meta-copy.copied .meta-copy-feedback { display: inline; }

.site-card .actions {
  margin-top: auto;             /* pin to bottom of card */
  display: flex; flex-direction: column; gap: 10px;
}
.site-card .actions .btn {
  /* v1.7.2: explicit position+z-index 2 puts the action buttons unambiguously
     above the stretched-link overlay (z-index 0) so clicks land on the button
     and the download attribute fires correctly. */
  position: relative;
  z-index: 2;
  display: inline-block;
  padding: 16px 22px;
  border-radius: 14px;
  font-weight: 700;
  font-size: 1em;
  text-decoration: none;
  text-align: center;
}
.site-card .actions .btn-primary { background: #4dabf7; color: #0c1219; }
.site-card .actions .btn-secondary { background: transparent; color: #4dabf7; border: 1px solid #2a323d; }
.site-card .actions .csv-last-audit {
  margin: 0;
  font-size: 0.78em;
  text-align: center;
  color: var(--fc-text-muted, #9aa5b1);
  letter-spacing: 0.02em;
}
.site-card .actions .csv-last-audit strong { color: #c0cdda; font-weight: 700; }

/* 2-col grid: desktop 2-up, mobile 1-up */
.site-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  /* Roomy gutters so the image-heavy cards have breathing space and the
     two-across grid doesn't read as dense. At the 1200px container this
     only trims each card by a few px while opening up the whitespace. */
  gap: 48px 40px;
}
@media (max-width: 820px) {
  .site-grid { grid-template-columns: 1fr; }
}

/* v1.7.39 — big, visible sort toolbar above the site grid. Three
   segmented buttons (Alphabetical / Most recently added / Most files
   first) drive a small inline-JS reorder of .site-card elements
   already in the DOM. No animation on first paint so the user sees
   the default A-Z immediately. Buttons wrap to a second row on
   narrow screens; on phones the whole bar stacks. */
.site-grid-sort {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  margin: 0 0 1.4rem;
  padding: 0.85rem 1rem;
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.25);
}
.site-grid-sort-label {
  font-size: 1rem;
  font-weight: 600;
  color: #e5e5e5;
  letter-spacing: -0.005em;
  flex: none;
}
.site-grid-sort-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  flex: 1 1 auto;
}
.sort-btn {
  appearance: none;
  -webkit-appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  background: #0d1117;
  color: #e5e5e5;
  border: 1px solid #30363d;
  border-radius: 10px;
  padding: 0.65rem 1.05rem;
  font: inherit;
  font-size: 0.98rem;
  font-weight: 500;
  line-height: 1.1;
  cursor: pointer;
  transition: background-color 0.12s, border-color 0.12s, color 0.12s, transform 0.08s;
}
.sort-btn:hover {
  background: #1f2530;
  border-color: #4b81e0;
  color: #f0f6fc;
}
.sort-btn:active { transform: translateY(1px); }
.sort-btn:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: 2px;
}
.sort-btn.is-active,
.sort-btn[aria-pressed="true"] {
  background: #1f6feb;
  color: #ffffff;
  border-color: #58a6ff;
  font-weight: 600;
  box-shadow: 0 0 0 1px rgba(88,166,255,0.45) inset;
}
.sort-btn.is-active:hover,
.sort-btn[aria-pressed="true"]:hover {
  background: #2c7eff;
  color: #ffffff;
  border-color: #79b8ff;
}
.sort-btn-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.6em;
  height: 1.6em;
  padding: 0 0.3em;
  border-radius: 6px;
  background: rgba(255,255,255,0.06);
  font-size: 0.85em;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: inherit;
}
.sort-btn.is-active .sort-btn-glyph,
.sort-btn[aria-pressed="true"] .sort-btn-glyph {
  background: rgba(255,255,255,0.18);
}
.sort-btn-label { white-space: nowrap; }
@media (max-width: 600px) {
  .site-grid-sort { align-items: flex-start; flex-direction: column; gap: 0.6rem; }
  .sort-btn { padding: 0.55rem 0.9rem; font-size: 0.95rem; }
  .sort-btn-label { white-space: normal; }
}

/* ── footer ─────────────────────────────────────────────────── */
/* v1.30.0 — footer rules moved to site-footer.js (siteFooterCss), the shared
   sticky bottom bar used by every bundle page. Pages append that CSS after
   this stylesheet. */

/* ── print ───────────────────────────────────────────────────── */
@media print {
  body { background: #fff; color: #000; }
  .site-header { position: static; background: #fff; border-bottom: 1px solid #ccc; }
  .site-header .icjia-logo { color: #000; }
  .site-header .brand { color: #000; border-left-color: #ccc; }
  .site-header .brand span { color: #0066cc; }
  h1, h2, h3 { color: #000; }
  .hero { background: #f8f8f8; border-color: #ccc; }
  /* v1.7.13 print-mode overrides for the new fleet-hero */
  .fleet-hero-eyebrow { color: #444; }
  .fleet-hero-num { color: #d97706; }
  .fleet-hero-context { color: #333; }
  .fleet-hero-context strong { color: #000; }
  .fleet-hero-donut::after { background: #fff; }
  .fleet-hero-donut-pct { color: #d97706; }
  .fleet-hero-donut-pct small { color: #444; }
  .fleet-hero-phrase { color: #000; }
  .fleet-hero-phrase strong { color: #000; }
  .explanation { break-inside: avoid; }
  .explanation-card { background: #f8f8f8; border: 1px solid #ccc; border-left: none; border-radius: 0; }
  .explanation-card p { color: #000; }
  .by-type-column { background: #f8f8f8; border: 1px solid #ccc; border-top: none; border-radius: 0; }
  .by-type-column.remediable, .by-type-column.reference { border-top: 1px solid #ccc; }
  .site-card { background: #f8f8f8; border-color: #ccc; box-shadow: none; transform: none; color: #000; }
  .site-card .nickname { color: #444; }
  .site-card .full-name { color: #000; }
  .site-card .tile.total { background: #eef5ff; }
  .site-card .tile.audit { background: #fff1e0; }
  .site-card .tile.total .num { color: #0066cc; }
  .site-card .tile.audit .num { color: #b45309; }
  .site-card .tile .lbl { color: #555; }
  .site-card .donut .pct { color: #b45309; }
  .site-card .donut .pct small { color: #555; }
  .site-card .donut-caption strong { color: #000; }
  .site-card .donut-caption span { color: #555; }
  .site-card .chip { background: #f0f0f0; color: #000; }
  .site-card .scan-meta { color: #555; }
  .site-card .a11y-strip { background: #f8f8f8; }
  .site-card .a11y-head, .site-card .a11y-note, .site-card .a11y-cover, .site-card .a11y-score small { color: #555; }
  .site-card .a11y-trend-up { color: #1a7f37; background: #e8f5ec; }
  .site-card .a11y-trend-down { color: #b42318; background: #fbe9e7; }
  .site-card .a11y-trend-flat { color: #57606a; background: #f0f0f0; }
  .site-card .a11y-far     { --a11y-accent: #cf222e; --a11y-tint: #fbe9e7; }
  .site-card .a11y-partial { --a11y-accent: #9a6700; --a11y-tint: #fff5e0; }
  .site-card .a11y-closer  { --a11y-accent: #1a7f37; --a11y-tint: #e8f5ec; }
  .site-card .a11y-na      { --a11y-accent: #57606a; --a11y-tint: #f0f0f0; }
  .site-card .actions { display: none; }
  .site-card { page-break-inside: avoid; }
  details.tech-details { display: none; }
}

/* ── master-csv download section ───────────────────────────────────────── */
/* v1.20.0 — extra breathing room above the section so the "Master spreadsheet"
   heading reads as a hard break from the per-site card grid above. Subtle
   top border + amber accent strip help visually separate. */
.section.master-csv {
  margin-top: 3.5rem;
  padding-top: 2.25rem;
  border-top: 1px solid #21262d;
  position: relative;
}
.section.master-csv::before {
  content: "";
  position: absolute;
  top: -1px;
  left: 0;
  width: 64px;
  height: 3px;
  background: #ffa84d;
  border-radius: 0 0 2px 2px;
}
.section.master-csv > h2 {
  margin-top: 0;
  font-size: 1.75rem;
  letter-spacing: -0.01em;
}
.master-csv .master-csv-download {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  margin-top: 1.25rem;
}
.master-csv .cta-button {
  display: inline-block;
  padding: 0.6rem 1rem;
  background: #1f6feb;
  color: #ffffff;
  text-decoration: none;
  border-radius: 4px;
  font-weight: 600;
  border: 1px solid #1f6feb;
  transition: background 120ms ease;
}
.master-csv .cta-button:hover { background: #388bfd; }
.master-csv .cta-button:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
}
.master-csv-meta { color: #8b949e; font-size: 0.95rem; }
.master-csv-last-audit {
  margin: 0.45rem 0 0;
  font-size: 0.82rem;
  color: #9aa5b1;
  letter-spacing: 0.02em;
}
.master-csv-last-audit strong { color: #c0cdda; font-weight: 700; }

/* v1.7.21 — "For AI models" section. Sits between the master CSV section
   and the duplicates section. Visual register is "optional / read-only"
   so a manager doesn't mistake it for a workflow step. Muted background +
   small "Optional · for AI models" eyebrow + a softer color palette than
   the actionable CTA buttons. */
.llm-context {
  margin: 2.2rem 0;
  padding: 1.5rem 1.6rem;
  background: linear-gradient(180deg, #131b27 0%, #11161e 100%);
  border: 1px solid #2a3340;
  border-radius: 10px;
}
.llm-context-eyebrow {
  margin: 0 0 0.35rem;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: #8b949e;
}
.llm-context h2 {
  margin: 0 0 0.6rem;
  font-size: 1.5rem;
  font-weight: 800;
  color: #e5e5e5;
  letter-spacing: -0.01em;
}
.llm-context-lead {
  margin: 0 0 0.85rem;
  font-size: 1rem;
  line-height: 1.55;
  color: #c9d1d9;
  max-width: 78ch;
}
.llm-context-lead strong { color: #ffffff; }
.llm-context-future {
  margin: 0 0 1.1rem;
  padding: 0.7rem 0.9rem;
  background: rgba(255, 255, 255, 0.03);
  border-left: 3px solid #6e7681;
  border-radius: 0 6px 6px 0;
  font-size: 0.95em;
  line-height: 1.55;
  color: #b8c0c8;
  max-width: 78ch;
}
.llm-context-future strong { color: #d4dae0; }
.llm-context-files {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem;
  margin: 1rem 0 1.1rem;
}
@media (max-width: 720px) {
  .llm-context-files { grid-template-columns: 1fr; }
}
.llm-context-file {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.85rem 1rem;
  background: rgba(77, 171, 247, 0.05);
  border: 1px solid #2a3340;
  border-left: 3px solid #4dabf7;
  border-radius: 6px;
  color: #d4dae0;
  text-decoration: none;
  transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
}
.llm-context-file:hover {
  background: rgba(77, 171, 247, 0.10);
  border-left-color: #58a6ff;
  transform: translateY(-1px);
  text-decoration: none;
}
.llm-context-file:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
}
.llm-context-file-name {
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.95rem;
  font-weight: 700;
  color: #ffffff;
  word-break: break-all;
}
.llm-context-file-meta {
  font-size: 0.78rem;
  font-weight: 600;
  color: #8b949e;
  letter-spacing: 0.02em;
}
.llm-context-file-desc {
  font-size: 0.88rem;
  line-height: 1.5;
  color: #b8c0c8;
}
.llm-context-howto {
  margin-top: 0.5rem;
}
.llm-context-howto > summary {
  cursor: pointer;
  font-size: 0.92rem;
  font-weight: 600;
  color: #58a6ff;
  padding: 0.35rem 0;
}
.llm-context-howto > summary:hover { color: #93c5fd; }
.llm-context-steps {
  margin: 0.6rem 0 0.5rem 1.3rem;
  padding: 0;
  font-size: 0.95rem;
  line-height: 1.55;
  color: #c9d1d9;
}
.llm-context-steps li { margin: 0.4rem 0; }
.llm-context-steps strong { color: #ffffff; }
.llm-context-steps code {
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.88em;
  padding: 0.04em 0.35em;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
}
.llm-context-actionable-reminder {
  margin: 0.6rem 0 0;
  padding: 0.65rem 0.9rem;
  background: rgba(251, 191, 36, 0.06);
  border-left: 3px solid #fbbf24;
  border-radius: 0 6px 6px 0;
  font-size: 0.92rem;
  line-height: 1.55;
  color: #f4dfa0;
}
.llm-context-actionable-reminder strong { color: #ffffff; }
.llm-context-actionable-reminder code {
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.88em;
  padding: 0.04em 0.35em;
  background: rgba(255, 255, 255, 0.10);
  border-radius: 3px;
  color: #ffffff;
}

/* v1.7.22 — strong "new section" divider banner above the duplicates hero.
   Page has accumulated a lot of stacked content (master CSV, by-type, For AI
   models), and managers were missing where the duplicates block began. The
   banner uses an amber accent bar (echoes the section's existing notice-
   yellow color register), large clamped headline, and generous vertical
   margins so the eye registers a clear section break. */
.duplicates .dup-section-banner {
  margin: 4.5rem 0 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid #2a3340;
}
.duplicates .dup-section-banner::before {
  content: "";
  display: block;
  width: 72px;
  height: 5px;
  background: linear-gradient(90deg, #fbbf24 0%, #f59e0b 100%);
  border-radius: 3px;
  margin-bottom: 1.4rem;
}
.duplicates .dup-section-eyebrow {
  margin: 0 0 0.55rem;
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #fbbf24;
}
.duplicates .dup-section-headline {
  margin: 0 0 0.9rem;
  font-size: clamp(2.2rem, 4.5vw, 3.1rem);
  font-weight: 900;
  line-height: 1.08;
  letter-spacing: -0.025em;
  color: #ffffff;
}
.duplicates .dup-section-lede {
  margin: 0;
  max-width: 72ch;
  font-size: 1.1rem;
  line-height: 1.55;
  color: #c0cdda;
}
@media (max-width: 720px) {
  .duplicates .dup-section-banner { margin: 3rem 0 1.5rem; padding-top: 1.1rem; }
  .duplicates .dup-section-banner::before { width: 56px; height: 4px; margin-bottom: 1rem; }
  .duplicates .dup-section-lede { font-size: 1rem; }
}

/* v1.7.34 — access-instructions modal. Native <dialog> styled to fit the
   site's dark-mode register. Per-type accent (cyan for Strapi, violet
   for GitHub, amber for Server) on the title underline + the left
   border, so the modal visually echoes the chip the user clicked. */
dialog.access-modal {
  width: min(640px, calc(100vw - 2rem));
  max-height: calc(100vh - 4rem);
  padding: 0;
  background: #161b22;
  color: #c0cdda;
  border: 1px solid #2a3340;
  border-left: 4px solid #7dd3fc;
  border-radius: 10px;
  box-shadow: 0 25px 70px rgba(0, 0, 0, 0.7);
  overflow: hidden;
}
dialog.access-modal::backdrop {
  background: rgba(0, 0, 0, 0.65);
}
dialog.access-modal-github { border-left-color: #c4b5fd; }
dialog.access-modal-server { border-left-color: #fcd34d; }
dialog.access-modal .access-modal-close-form {
  margin: 0;
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
}
dialog.access-modal .access-modal-close {
  width: 36px;
  height: 36px;
  background: transparent;
  border: 1px solid transparent;
  color: #8b949e;
  font-size: 1.6rem;
  line-height: 1;
  cursor: pointer;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
dialog.access-modal .access-modal-close:hover,
dialog.access-modal .access-modal-close:focus-visible {
  color: #ffffff;
  border-color: #2a3340;
  background: rgba(255, 255, 255, 0.04);
  outline: none;
}
dialog.access-modal .access-modal-title {
  margin: 0;
  padding: 1.4rem 3.4rem 1rem 1.6rem;
  font-size: 1.45rem;
  font-weight: 800;
  line-height: 1.25;
  color: #f0f6fc;
  border-bottom: 1px solid #21262d;
}
dialog.access-modal .access-modal-body {
  padding: 1.2rem 1.6rem 1.4rem;
  max-height: calc(100vh - 12rem);
  overflow-y: auto;
}
dialog.access-modal .access-modal-body p {
  margin: 0 0 0.95rem;
  font-size: 1rem;
  line-height: 1.6;
}
dialog.access-modal .access-modal-body p:last-child { margin-bottom: 0; }
dialog.access-modal .access-modal-body code {
  background: rgba(0, 0, 0, 0.4);
  padding: 0.05rem 0.4rem;
  border-radius: 3px;
  font-size: 0.88em;
  color: #d2a8ff;
}
dialog.access-modal .access-modal-steps-h3 {
  margin: 1.3rem 0 0.6rem;
  font-size: 0.95rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #f0f6fc;
}
dialog.access-modal .access-modal-steps {
  margin: 0 0 1.1rem;
  padding-left: 1.2rem;
}
dialog.access-modal .access-modal-steps li {
  margin: 0 0 0.7rem;
  line-height: 1.55;
}
dialog.access-modal .access-modal-steps li:last-child { margin-bottom: 0; }
dialog.access-modal .access-modal-cta {
  margin: 1.3rem 0 0;
  padding: 0.95rem 1.1rem;
  background: rgba(125, 211, 252, 0.08);
  border-left: 3px solid #7dd3fc;
  border-radius: 4px;
  font-size: 0.98rem;
  line-height: 1.55;
}
dialog.access-modal-github .access-modal-cta {
  background: rgba(196, 181, 253, 0.08);
  border-left-color: #c4b5fd;
}
dialog.access-modal-server .access-modal-cta {
  background: rgba(252, 211, 77, 0.08);
  border-left-color: #fcd34d;
}
dialog.access-modal .access-modal-cta a {
  color: #58a6ff;
  text-decoration: underline;
  text-underline-offset: 2px;
}
@media (max-width: 540px) {
  dialog.access-modal { width: calc(100vw - 1rem); }
  dialog.access-modal .access-modal-title { font-size: 1.2rem; padding: 1.1rem 3.2rem 0.8rem 1.2rem; }
  dialog.access-modal .access-modal-body { padding: 1rem 1.2rem 1.2rem; }
}

/* v1.7.30 — "Coming soon" section. Same banner anatomy as the fleet +
   duplicates sections (eyebrow / clamped headline / lede / accent bar),
   but with a violet accent so the eye registers it as a third register:
   not current state (blue), not warning (amber), but upcoming work. */
.todo .todo-section-banner {
  margin: 4.5rem 0 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid #2a3340;
}
.todo .todo-section-banner::before {
  content: "";
  display: block;
  width: 72px;
  height: 5px;
  background: linear-gradient(90deg, #d2a8ff 0%, #8957e5 100%);
  border-radius: 3px;
  margin-bottom: 1.4rem;
}
.todo .todo-section-eyebrow {
  margin: 0 0 0.55rem;
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #d2a8ff;
}
.todo .todo-section-headline {
  margin: 0 0 0.9rem;
  font-size: clamp(2.2rem, 4.5vw, 3.1rem);
  font-weight: 900;
  line-height: 1.08;
  letter-spacing: -0.025em;
  color: #ffffff;
}
.todo .todo-section-lede {
  margin: 0 0 1.8rem;
  max-width: 72ch;
  font-size: 1.1rem;
  line-height: 1.55;
  color: #c0cdda;
}
.todo .todo-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 1rem;
}
.todo .todo-item {
  background: #181d27;
  border: 1px solid #2a2540;
  border-left: 4px solid #8957e5;
  border-radius: 6px;
  padding: 1rem 1.2rem 1.1rem;
}
.todo .todo-item-h3 {
  margin: 0 0 0.4rem;
  font-size: 1.05rem;
  font-weight: 700;
  color: #f0e7ff;
}
.todo .todo-item p {
  margin: 0;
  font-size: 0.96rem;
  line-height: 1.55;
  color: #c0cdda;
}
.todo .todo-item code {
  background: rgba(0, 0, 0, 0.35);
  padding: 0.05rem 0.35rem;
  border-radius: 3px;
  font-size: 0.85em;
}
.todo .todo-footer-note {
  margin: 1.4rem 0 0;
  font-size: 0.92rem;
  color: #8b949e;
}
.todo .todo-footer-note a {
  color: #d2a8ff;
  text-decoration: underline;
  text-underline-offset: 2px;
}
@media (max-width: 720px) {
  .todo .todo-section-banner { margin: 3rem 0 1.5rem; padding-top: 1.1rem; }
  .todo .todo-section-banner::before { width: 56px; height: 4px; margin-bottom: 1rem; }
  .todo .todo-section-lede { font-size: 1rem; }
  .todo .todo-item { padding: 0.9rem 1rem; }
  .todo .todo-item-h3 { font-size: 1rem; }
}

/* ── duplicates section — v1.7.2 big visual treatment ─────────────────── */
.duplicates .dup-hero {
  background: linear-gradient(180deg, #18202b 0%, #141a23 100%);
  border: 1px solid #2a323d;
  border-radius: 22px;
  padding: 36px 36px 28px;
  margin: 0 0 24px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.32);
}
.duplicates .dup-eyebrow {
  margin: 0 0 8px;
  font-size: 0.82em;
  font-weight: 800;
  color: #c0cdda;
  letter-spacing: 0.10em;
  text-transform: uppercase;
}
.duplicates .dup-title {
  margin: 0 0 14px;
  font-size: 2.4em;
  font-weight: 900;
  color: #ffffff;
  letter-spacing: -0.02em;
  line-height: 1.12;
}
.duplicates .dup-counting-note {
  /* v1.7.20 — tiny sub-headline that explains what the big number is
     counting. Lives directly under the headline so a manager glancing
     at the section knows whether the number includes images/text/etc.
     or just the audit-actionable subset. Amber-tinted to read as an
     advisory note, not a normal body paragraph. */
  margin: -4px 0 16px;
  padding: 10px 14px;
  font-size: 0.93em;
  line-height: 1.5;
  color: #f4dfa0;
  background: rgba(251, 191, 36, 0.06);
  border: 1px solid rgba(251, 191, 36, 0.22);
  border-left: 3px solid #fbbf24;
  border-radius: 6px;
  max-width: 78ch;
}
.duplicates .dup-counting-note strong { color: #ffffff; font-weight: 700; }
.duplicates .dup-counting-note em { color: #fde6a1; font-style: italic; }
.duplicates .dup-subtitle {
  margin: 0 0 22px;
  font-size: 1.05em;
  line-height: 1.5;
  color: #d4dae0;
  max-width: 78ch;
}
.duplicates .dup-subtitle strong { color: #ffffff; }
.duplicates .dup-stat-tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin-top: 8px;
}
@media (max-width: 720px) {
  .duplicates .dup-stat-tiles { grid-template-columns: 1fr; }
  .duplicates .dup-title { font-size: 1.8em; }
  .duplicates .dup-hero { padding: 24px 22px 20px; }
}
.duplicates .dup-tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 22px 20px;
  border-radius: 16px;
}
.duplicates .dup-tile-exact   { background: rgba(77, 171, 247, 0.10); border: 1px solid rgba(77, 171, 247, 0.30); }
.duplicates .dup-tile-variant { background: rgba(255, 168, 77, 0.12); border: 1px solid rgba(255, 168, 77, 0.32); }
.duplicates .dup-tile-num {
  font-size: 3.2em;
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
.duplicates .dup-tile-exact   .dup-tile-num { color: #4dabf7; }
.duplicates .dup-tile-variant .dup-tile-num { color: #ffa84d; }
.duplicates .dup-tile-lbl {
  margin-top: 4px;
  font-size: 0.95em;
  font-weight: 700;
  color: #ffffff;
  text-transform: lowercase;
  letter-spacing: 0.01em;
}
.duplicates .dup-tile-sub {
  margin-top: 6px;
  font-size: 0.85em;
  color: #9aa5b1;
  line-height: 1.4;
}
/* v1.7.24: single unified explainer block — replaces the pre-v1.7.24
   .dup-explainer-open + .dup-not-error + .dup-intentional + .dup-caveat
   layout (five visually-distinct callouts) with one cohesive container.
   Same information; less visual noise. Inline <strong> + <em> carry
   emphasis where colored borders used to. The exact/variant kind-cards
   still get their accent borders because they're the actually-useful
   visual comparison; everything else demoted to body prose. */
.duplicates .dup-explainer {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 12px;
  padding: 22px 28px 18px;
  margin: 0 0 24px;
  color: #d4dae0;
  line-height: 1.6;
}
.duplicates .dup-explainer > p {
  margin: 0 0 0.85rem;
  font-size: 0.98rem;
  max-width: 78ch;
}
.duplicates .dup-explainer > p:last-of-type { margin-bottom: 0.4rem; }
.duplicates .dup-explainer > p strong { color: #ffffff; }
.duplicates .dup-explainer > p em { color: #e8ecf1; font-style: italic; }
.duplicates .dup-explainer code {
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.88em;
  padding: 0.04em 0.4em;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
}
.duplicates .dup-explainer-h3 {
  margin: 0 0 0.9rem;
  font-size: 1.22rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: #ffffff;
}
.duplicates .dup-caveat-details {
  margin: 1rem 0 0;
  padding: 0.55rem 0.9rem;
  background: rgba(255, 255, 255, 0.03);
  border-left: 3px solid #6e7681;
  border-radius: 0 6px 6px 0;
  font-size: 0.92rem;
  color: #c0cdda;
}
.duplicates .dup-caveat-details > summary {
  cursor: pointer;
  font-weight: 600;
  color: #d4dae0;
  list-style: none;
  padding: 0.2rem 0;
}
.duplicates .dup-caveat-details > summary::-webkit-details-marker { display: none; }
.duplicates .dup-caveat-details > summary::before {
  content: "▸ ";
  display: inline-block;
  margin-right: 0.25rem;
  transition: transform 120ms ease;
  color: #8b949e;
}
.duplicates .dup-caveat-details[open] > summary::before { content: "▾ "; }
.duplicates .dup-caveat-details > summary em { color: #d4dae0; font-style: italic; }
.duplicates .dup-caveat-details > p {
  margin: 0.5rem 0 0.2rem;
  line-height: 1.55;
}
.duplicates .dup-caveat-details code {
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.86em;
  padding: 0.04em 0.35em;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
}

.duplicates .dup-kind-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin: 1.4rem 0;
}
@media (max-width: 820px) {
  .duplicates .dup-kind-cards { grid-template-columns: 1fr; }
}
.duplicates .dup-kind-card {
  padding: 18px 20px;
  border-radius: 12px;
  background: #0d1117;
  border: 1px solid #21262d;
}
.duplicates .dup-kind-card-exact   { border-color: rgba(77, 171, 247, 0.32); }
.duplicates .dup-kind-card-variant { border-color: rgba(255, 168, 77, 0.34); }
.duplicates .dup-kind-card-h4 {
  margin: 0 0 0.6rem;
  font-size: 1.05em;
  font-weight: 700;
  color: #ffffff;
}
.duplicates .dup-kind-card p { margin: 0; font-size: 0.95em; }

/* v1.7.24: legacy .dup-explainer (a collapsible details pattern that
   predated the v1.7.0 redesign) + .dup-caveat (the inline yellow note,
   superseded by .dup-caveat-details collapsible) removed — both classes
   are no longer emitted, and the v1.7.24 .dup-explainer / .dup-caveat-details
   styles defined above own the same selector names now. */

.dup-table-details {
  margin-top: 1rem;
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 4px;
  padding: 0.6rem 0.8rem;
}
.dup-table-details > summary {
  font-weight: 600;
  cursor: pointer;
  color: #79c0ff;
  margin-bottom: 0.6rem;
}
.dup-table-details > summary:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
  border-radius: 2px;
}
/* Duplicates scroll wrapper — same patterns as the per-site report's
   .table-wrap: horizontal overflow with -webkit-overflow-scrolling for iOS
   momentum, grab/grabbing cursor for mouse drag-pan, sticky first column +
   sticky header so the filename / column labels stay anchored. */
.dup-pan-wrap {
  /* v1.12.1: the trimmed 4-column table fills the width and wraps, so there
     is no horizontal panning — overflow-x:auto stays only as a mobile safety
     net. Vertical scroll within max-height keeps the sticky header useful. */
  width: 100%;
  overflow-x: auto;
  overflow-y: auto;
  max-height: 70vh;
  border-top: 1px solid #21262d;
  -webkit-overflow-scrolling: touch;
  border-radius: 2px;
}
.paginator {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.55rem 1rem;
  margin: 0.7rem 0 0.5rem;
  font-size: 13px;
  color: #c9d1d9;
}
.pag-info { font-weight: 600; }
.pag-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 0.4rem; }
.pag-size { color: #9aa5b1; }
.pag-size select {
  background: #161b22; color: #e5e5e5; border: 1px solid #2e3b4d;
  border-radius: 4px; padding: 2px 5px; font-size: 13px; margin-left: 4px;
}
.pag-btn, .pag-num {
  background: #1f2a37; color: #93c5fd; border: 1px solid #2e3b4d;
  border-radius: 4px; padding: 3px 9px; font-size: 13px; cursor: pointer;
}
.pag-btn:hover:not(:disabled), .pag-num:hover { background: #2a3a52; color: #bfdbfe; }
.pag-btn:disabled { opacity: 0.4; cursor: default; }
.pag-num-active, .pag-num-active:hover {
  background: #2563eb; color: #fff; border-color: #2563eb; font-weight: 700;
}
.pag-pages { display: inline-flex; gap: 0.25rem; align-items: center; }
.pag-gap { color: #6b7280; padding: 0 1px; }
/* Mirror the per-site report table styling exactly (src/report/html.js)
   so every data table in the app looks the same: 12px tabular type, tight
   padding, alternating dark stripes, brighter hover row, sticky thead +
   sticky first column. Auto-sized columns — content drives width via
   width:max-content; no per-column min-widths, so the "Sites" column
   shrinks to its longest cell instead of leaving blank space. Cells use
   white-space:nowrap + max-width:320px + ellipsis to clip very long
   filenames; the full text is in a title= tooltip on the cell. */
.dup-table {
  border-collapse: collapse;
  width: 100%;
  table-layout: auto;
  font-size: 13px;
}
.dup-table thead {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #161b22;
}
.dup-table thead th {
  padding: 0.45rem 0.65rem;
  text-align: left;
  white-space: nowrap;
  border-bottom: 2px solid #21262d;
  color: #e5e5e5;
  font-weight: 600;
}
.dup-table tbody tr:nth-child(even) { background: #0c0c0c; }
.dup-table tbody tr:nth-child(odd)  { background: #0d1117; }
.dup-table tbody tr:hover { background: #1a1a1a; }
.dup-table td {
  padding: 0.4rem 0.7rem;
  border-bottom: 1px solid #1a1a1a;
  color: #e5e5e5;
  vertical-align: top;
  word-break: break-word;
}
.dup-table td a { color: #60a5fa; text-decoration: none; }
.dup-table td a:hover { color: #93c5fd; text-decoration: underline; }
.dup-table td a:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
  border-radius: 2px;
}

/* Sticky first column (filename) — keeps the row's identity visible when
   the user scrolls right. Background is set explicitly per stripe so the
   sticky cell doesn't show the row behind it bleeding through. */
.dup-table th:first-child,
.dup-table td:first-child {
  position: sticky;
  left: 0;
  z-index: 1;
  border-right: 1px solid #21262d;
}
.dup-table thead th:first-child {
  background: #161b22;
  z-index: 3;
}
.dup-table tbody tr:nth-child(even) td:first-child { background: #0c0c0c; }
.dup-table tbody tr:nth-child(odd)  td:first-child { background: #0d1117; }
.dup-table tbody tr:hover td:first-child { background: #1a1a1a; }

.dup-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.dup-dates { font-size: 0.85rem; color: #c9d1d9; white-space: nowrap; }
.dup-dim { color: #6e7681; padding: 0 0.2rem; }
/* v1.7.17 — duplicates "for information only" callout. Replaces the
   pre-v1.7.17 download-the-duplicates-CSV button. Duplicate removal needs
   per-site reference checking, not a downloadable worksheet. The amber
   left border + eyebrow style says "warning, not action item." Three
   numbered reasons (N-times search surface / wrong-copy risk / asymmetric
   references) sit in their own slightly-tinted block so the eye lands on
   them rather than skimming past as prose. */
.dup-info-only {
  margin: 1.2rem 0 0.6rem;
  padding: 1.1rem 1.3rem 1.05rem 1.5rem;
  background: linear-gradient(180deg, #1c1a10 0%, #181610 100%);
  border: 1px solid #2a2618;
  border-left: 6px solid #fbbf24;
  border-radius: 10px;
  color: #d4dae0;
  line-height: 1.55;
}
.dup-info-only-eyebrow {
  margin: 0 0 0.3rem;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #fbbf24;
}
.dup-info-only-title {
  margin: 0 0 0.7rem;
  font-size: 1.18rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: #ffffff;
}
.dup-info-only p {
  margin: 0 0 0.65rem;
  font-size: 0.96rem;
}
.dup-info-only p strong { color: #ffffff; }
.dup-info-only-reasons {
  margin: 0.65rem 0 0.9rem;
  padding: 0.85rem 1rem 0.85rem 2.4rem;
  background: rgba(251, 191, 36, 0.06);
  border-radius: 6px;
  border: 1px solid rgba(251, 191, 36, 0.18);
  font-size: 0.95rem;
  list-style: decimal;
}
.dup-info-only-reasons li {
  margin: 0.35rem 0;
  padding-left: 0.3rem;
}
.dup-info-only-reasons li::marker {
  font-weight: 800;
  color: #fbbf24;
}
.dup-info-only-reasons strong { color: #ffffff; font-weight: 700; }
.dup-info-only-plain {
  margin: 0.5rem 0 0.1rem;
  padding: 0.55rem 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border-left: 3px solid #6e7681;
  border-radius: 0 4px 4px 0;
  font-size: 0.9rem;
  color: #b8c0c8;
  line-height: 1.55;
}
.dup-info-only-plain em {
  color: #d4dae0;
  font-style: italic;
  font-weight: 600;
}
.dup-info-only-plain code {
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.88em;
  padding: 0.04em 0.35em;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  color: #e5e5e5;
}
/* v1.7.19: duplicates table filter — remediable/reference/all chips above
   the table. Default state is "Remediable only" because that's where the
   manager/auditor attention belongs; the on-page table hides the
   non-remediable rows by JS toggle of [data-dup-side] visibility against
   the wrapper's [data-dup-active-filter] attribute. */
.dup-filter-bar {
  margin: 1rem 0 0.75rem;
  padding: 0.85rem 1rem;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid #21262d;
  border-radius: 8px;
}
.dup-filter-help {
  margin: 0 0 0.65rem;
  font-size: 0.9rem;
  color: #9aa5b1;
  line-height: 1.55;
}
.dup-filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.dup-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.85rem;
  background: transparent;
  color: #c9d1d9;
  border: 1px solid #2a323d;
  border-radius: 999px;
  font-family: inherit;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 100ms ease, color 100ms ease, border-color 100ms ease;
}
.dup-filter-chip:hover {
  background: rgba(88, 166, 255, 0.08);
  color: #58a6ff;
  border-color: #58a6ff;
}
.dup-filter-chip:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
}
.dup-filter-chip.is-active {
  background: #1f6feb;
  color: #ffffff;
  border-color: #1f6feb;
}
.dup-filter-chip.is-active:hover { background: #388bfd; color: #ffffff; }
.dup-filter-count {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 0.8em;
  opacity: 0.85;
}
.dup-filter-chip.is-active .dup-filter-count { opacity: 1; }
/* v1.12.1: row kind-filtering is JS-driven (see the duplicates IIFE) so it
   composes with the paginator's inline row show/hide. */
.dup-kind {
  display: inline-block;
  margin-left: 0.6rem;
  padding: 0.1rem 0.45rem;
  border-radius: 3px;
  font-size: 0.78rem;
  font-weight: 500;
  vertical-align: middle;
}
.dup-exact { background: #1f6feb; color: #ffffff; }
.dup-variant { background: #d29922; color: #1c2128; }
.dup-newest {
  display: inline-block;
  margin-left: 0.4rem;
  padding: 0.05rem 0.4rem;
  border-radius: 3px;
  font-size: 0.72rem;
  background: #238636;
  color: #ffffff;
  font-weight: 500;
  vertical-align: middle;
}

@media print {
  .duplicates .dup-explainer { background: #ffffff !important; border-color: #ccc; }
  .duplicates .dup-explainer summary { color: #000; }
  .dup-table-details { background: #ffffff !important; border-color: #ccc; }
  .dup-table-details > summary { color: #000; }
  .dup-pan-wrap { background: #ffffff !important; }
  .dup-table thead th { background: #f5f5f5; color: #000; }
  .dup-filename { background: #ffffff !important; color: #000; }
  .dup-table tbody tr:nth-child(even) .dup-filename { background: #fafafa !important; }
  .dup-table th { background: #f5f5f5; color: #000; }
  .dup-group-header td { background: #fafafa; color: #000; border-top-color: #ccc; }
  .master-csv .cta-button { background: #fff; color: #000; border-color: #000; }
}

/* ══ v1.21.0: /sites roster + tooling cards + card images ════════════ */

/* Card thumbnail — the downloaded og:image, or an ICJIA-logo tile fallback.
   Inset inside the card padding with its own rounded corners so it reads as a
   header image on both the home tooling band and the /sites roster cards. */
.card-img {
  aspect-ratio: 1.91 / 1;
  width: 100%;
  border-radius: 14px;
  overflow: hidden;
  background: #0d1117;
  border: 1px solid var(--fc-border-subtle, #2a323d);
  margin-bottom: 18px;
}
.card-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.card-img-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem 1.5rem;
  background: radial-gradient(120% 120% at 50% 0%, #1b2430 0%, #11161d 100%);
}
.card-img-fallback svg { width: auto; height: 52px; max-width: 78%; color: #c0cdda; opacity: 0.9; }

/* Tool + roster cards are shorter than the audit donut cards. */
.site-card.tool-card,
.site-card.roster-card { min-height: 0; }

/* v1.22.1 — breathing room between the tool description/stack and the
   "Open tool" button (the cards are short, so margin-top:auto collapses). */
.tool-card .actions { padding-top: 14px; }

/* "Tooling" badge */
.tool-card .tool-badge {
  align-self: center;
  display: inline-block;
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #1a1030;
  background: linear-gradient(180deg, #c4b5fd 0%, #a78bfa 100%);
  padding: 0.18rem 0.6rem;
  border-radius: 999px;
  margin-bottom: 0.6rem;
}

/* Card description (og:description) + optional stack line */
.site-card .card-desc {
  margin: 0.2rem 0 0;
  color: #c9d1d9;
  font-size: 0.94rem;
  line-height: 1.5;
  text-align: center;
}
/* v1.24.1 — extra breathing room under the fleet-card description before the
   file-count tiles (landing page). Tooling/roster cards (no .nums) are unaffected. */
.site-card:not(.tool-card):not(.roster-card) .card-desc { margin-bottom: 0.9rem; }
.site-card .card-stack { margin: 0.7rem 0 0; text-align: center; font-size: 0.8rem; color: #8b949e; }
.site-card .card-stack .stack-label {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 0.72rem;
  color: #6e7681;
  margin-right: 0.3rem;
}

/* /sites roster card: static (non-interactive) access chip — no modal here. */
.roster-card .access-chip { cursor: default; pointer-events: none; }
.tooling-section { margin: 0 0 1.5rem; }

/* v1.22.1 — live/unreachable status as a compact pill pinned to each card's
   upper-right corner: a dot glyph + label, plus a muted "checked <Chicago time>"
   line the on-demand client fills. Text (not colour alone) carries the meaning
   (WCAG 1.4.1). Absolute, with a translucent backdrop so it's legible over the
   card image; pointer-events:none so it never blocks the card's click target. */
.site-card .status-dot {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  padding: 6px 10px;
  border-radius: 12px;
  background: rgba(13, 17, 23, 0.80);
  border: 1px solid rgba(255, 255, 255, 0.09);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  text-align: right;
  pointer-events: none;
}
.site-card .status-dot .status-line {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  white-space: nowrap;
}
.site-card .status-dot .status-glyph {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.site-card .status-dot .status-checked {
  font-size: 0.64rem;
  font-weight: 500;
  color: #9aa5b1;
  white-space: nowrap;
}
.site-card .status-dot .status-checked:empty { display: none; }
.site-card .status-dot.status-live .status-line { color: #56d364; }
.site-card .status-dot.status-live .status-glyph { background: #3fb950; box-shadow: 0 0 0 3px rgba(63, 185, 80, 0.16); }
.site-card .status-dot.status-down .status-line { color: #ff7b72; }
.site-card .status-dot.status-down .status-glyph { background: transparent; border: 2px solid #f85149; box-shadow: 0 0 0 3px rgba(248, 81, 73, 0.13); }

/* Header "Sites" nav link — internal, so a green accent distinct from the
   blue external-tool buttons. */
.audit-tool-link.nav-sites {
  background: linear-gradient(180deg, #3fb950 0%, #2ea043 100%);
  border-color: #2ea043;
}
.audit-tool-link.nav-sites:hover { box-shadow: 0 4px 14px rgba(63, 185, 80, 0.35); }

/* ── /sites roster hero — bold, count-first ─────────────────────────── */
.roster-hero { padding-bottom: 1.6rem; }
.roster-stats { display: flex; flex-wrap: wrap; gap: 1.5rem 2.75rem; align-items: flex-start; }
.roster-stat { display: flex; flex-direction: column; }
.roster-stat .n {
  font-size: 3.4rem;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.03em;
  color: #ffffff;
}
.roster-stat .l {
  font-size: 0.82rem;
  color: #8b949e;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 0.4rem;
}
.roster-breakdown { margin-top: 1.2rem; color: #adbac7; font-size: 0.92rem; }
.roster-breakdown .dot {
  display: inline-block;
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  margin: 0 0.35rem 0 0.9rem;
  vertical-align: middle;
}
.roster-breakdown .grp:first-child .dot { margin-left: 0; }
.roster-download { margin-top: 1.6rem; }
/* v1.28.0 — the three workbook buttons (combined / content-only / tooling-only)
   sit in one wrapping row. */
.roster-download-btns { display: flex; flex-wrap: wrap; gap: 0.7rem; }
.roster-download-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.7rem 1.2rem;
  background: linear-gradient(180deg, #4dabf7 0%, #2f8de0 100%);
  color: #0c1219;
  font-weight: 800;
  font-size: 0.95rem;
  text-decoration: none;
  border-radius: 9px;
  border: 1px solid #2f8de0;
  transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
}
.roster-download-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(77, 171, 247, 0.4);
  color: #0c1219;
  text-decoration: none;
}
.roster-download-btn svg { width: 18px; height: 18px; }
.roster-download-note { margin: 0.6rem 0 0; font-size: 0.82rem; color: #8b949e; }

@media (max-width: 600px) {
  .roster-stat .n { font-size: 2.6rem; }
}
`;
