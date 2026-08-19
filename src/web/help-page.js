// v1.61.0 — /help, the guide for staff reviewing their site's files.
//
// Why this page exists: readers landing on the bundle told us they did not
// know where to begin. The task they are actually being asked to do has
// exactly one shape — find your website, download its spreadsheet, open the
// two link columns to see what each file actually is and where it lives,
// decide, and send it back — and nothing in the bundle said so.
//
// Scope discipline. This page teaches DOWNLOADING the workbook and making
// the call on each file. Nothing here is fillable in the browser: the
// downloaded .xlsx is the record the audit team keeps, so every instruction
// has to end with a file on the reader's own desktop. Resist adding an
// in-page form; it would produce a second, unrecorded answer.
//
// Audience. Program and communications staff, not auditors. No jargon
// without a gloss, no column named by its internal key, no step that
// assumes the reader knows what a screen reader is.
//
// Form. A stepper, and nothing collapsible. The reader is being asked to
// do five things in order, so the page is an ordered list of five steps
// with a spine running through their numbers — the shape of the task IS
// the shape of the page. Every word is on screen from the moment it
// loads: an accordion hides the sentence that answers "I clicked
// Download and nothing happened", which is the complaint this page
// exists to answer.
//
// Two devices carry the page:
//   1. The COLUMN MAP (renderColumnMap) — the workbook's twenty columns
//      drawn to scale, fifteen dimmed to slivers, five lit. It answers
//      "what is all this?" and "why can't I find Notes?" in one picture:
//      Notes is column T, at the far right edge.
//   2. The THREE OUTCOMES (renderDecisionCards) — archive / remediate /
//      as-is at headline scale. Colour is reinforcement only; each card
//      also carries its own icon and its own one-line test, so the
//      distinction survives print and colour-blindness (same rule the
//      site's two score badges follow). They are framed as a JUDGEMENT,
//      not a data-entry mechanic: the reader reaches one by opening the
//      file (column D) and the page that carries it (column E). Typing
//      the result into Notes is the last, smallest part of the step.
//
// The screenshots are static PNGs committed at assets/help/ and copied
// into the bundle by web-rollup.
//
// ONE EXAMPLE SITE, ALL THE WAY THROUGH. Every screenshot, caption, alt
// text, filename, and worked example uses Adult Redeploy Illinois (ARI)
// as of the August 2026 rollup. An earlier version showed ARI's card in
// step 1 and DVFR's report in step 2, and a reader following along could
// not tell whether the two panels were the same journey or two different
// ones — which is exactly the confusion this page exists to remove. If
// you re-shoot against a different site, change ALL of them together and
// re-run the tests; several pin ARI's numbers. See
// docs/help-screenshots.md.

import { INDEX_CSS } from "./index-css.js";
import { renderSiteFooter, siteFooterCss } from "./site-footer.js";
import { PLAUSIBLE_SNIPPET } from "./analytics.js";
import { helpNavLink, helpNavCss } from "./help-nav.js";
import { escapeHtml as he } from "../util/html.js";
// Benign import cycle (help-page ⇄ index-page), same pattern as
// whats-new.js and sites-page.js: function-time access only, so neither
// module reads the other's bindings during evaluation.
import { ICJIA_LOGO_SVG } from "./index-page.js";

/**
 * Where a completed workbook goes. One constant, so the address cannot
 * drift between the step, the closing block, and the FAQ.
 *
 * Shown as the literal address rather than behind a friendly label: the
 * reader is being asked to attach a file and send it, and half of them
 * will do that from Outlook rather than by clicking a link, so the thing
 * they need is the address itself in a form they can read and copy.
 */
export const HANDBACK = {
  email: "christopher.schweda@illinois.gov",
  label: "the audit administrator",
};

/**
 * The screenshots this page embeds, keyed by the step that uses them.
 * `file` is both the name in the repo at assets/help/ and the name in the
 * bundle at assets/help/ — web-rollup copies them one for one, driven by
 * HELP_SCREENSHOTS below, so a rename here cannot leave a dead <img>.
 * The width/height are the PNGs' real pixel dimensions and are emitted as
 * attributes so the page does not reflow as they load.
 */
const SHOTS = {
  findSite: {
    file: "step-find-site.png",
    width: 420,
    height: 660,
    alt: "A website card on the home page, showing a picture of the site, its short code ARI, the name Adult Redeploy Illinois, its web address, a one-line description, and two number tiles: 569 total files and 430 may need audit.",
  },
  downloadCard: {
    file: "step-download-card.png",
    width: 420,
    height: 206,
    alt: "The bottom of a website card, showing a blue View detailed report button above an outlined Download spreadsheet button, with the line Last audit: Aug 17, 2026 beneath them.",
  },
  downloadReport: {
    file: "step-download-report.png",
    width: 900,
    height: 600,
    alt: "The top of the site report for Adult Redeploy Illinois, showing 430 files may need audit work, a green Download spreadsheet (XLSX) button, the date of the last audit, and a file accessibility score of 69 out of 100.",
  },
};

/**
 * Every screenshot file the page references. web-rollup copies exactly
 * this list out of the repo's assets/help/ and into the bundle's.
 * @type {string[]}
 */
export const HELP_SCREENSHOTS = Object.values(SHOTS).map((sh) => sh.file);

/**
 * The workbook's columns, in sheet order. `role` drives the column map:
 *   "read"  — one of the columns the reader actually uses
 *   "write" — the single column they type in
 *   ""      — reference data; drawn as a dimmed sliver
 * Letters are positional (A…T) and must track XLSX_COLUMN_ORDER in
 * src/report/xlsx.js. test/web/help-page.test.js pins them to it.
 */
const WORKBOOK_COLUMNS = [
  { letter: "A", label: "Date published" },
  { letter: "B", label: "File name", role: "read", gloss: "What the file is called." },
  { letter: "C", label: "Page Count" },
  { letter: "D", label: "Public URL", role: "read", gloss: "Click to open the actual file and see it for yourself." },
  { letter: "E", label: "Page References", role: "read", gloss: "The web page — or pages — this file appears on." },
  { letter: "F", label: "File type" },
  { letter: "G", label: "Size (bytes)" },
  { letter: "H", label: "Remediation Score" },
  { letter: "I", label: "Score (0-100)", role: "read", gloss: "How accessible the file is today. Higher is better." },
  { letter: "J", label: "Grade" },
  { letter: "K", label: "Audit Report" },
  { letter: "L", label: "Website" },
  { letter: "M", label: "Server" },
  { letter: "N", label: "File extension" },
  { letter: "O", label: "Duplicate of" },
  { letter: "P", label: "File location (relative to source folder)" },
  { letter: "Q", label: "Full file path on server" },
  { letter: "R", label: "Content hash (SHA-256)" },
  { letter: "S", label: "Delete?" },
  { letter: "T", label: "Notes", role: "write", gloss: "Where you record what you decided." },
];

/** The three outcomes, in the order a reader should consider them. */
const DECISIONS = [
  {
    word: "archive",
    kind: "archive",
    summary: "Take it off the website.",
    detail:
      "The file has done its job. Nobody needs an accessible version of a document that is coming down.",
    when: [
      "The file opened and a newer version has replaced it",
      "It announced an event that has passed",
      "Column E lists no page, or the page it was on is gone",
    ],
    icon: `<path d="M2.5 5.5h11v7.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/><path d="M1.75 2.5h12.5v3H1.75z"/><path d="M6.5 8.5h3"/>`,
  },
  {
    word: "remediate",
    kind: "remediate",
    summary: "Keep it, and it needs work.",
    detail:
      "People still use this file, but it cannot be read properly by someone using a screen reader. It goes on the fix list.",
    when: [
      "Column E shows a page people still visit",
      "The file opened and its score is low — under about 70",
      "You are not sure. This is the safe answer",
    ],
    icon: `<path d="M9.8 3.2a3 3 0 0 0 3.9 3.9l-6 6a1.6 1.6 0 0 1-2.3-2.3z"/><path d="M4.2 12.4h.01"/>`,
  },
  {
    word: "as-is",
    kind: "asis",
    summary: "Keep it, and leave it alone.",
    detail:
      "Either it is already accessible, or it is a record that cannot be altered — a signed order, a scanned historical document.",
    when: [
      "It opened cleanly and its score is already high",
      "It is a legal record that must stay exactly as filed",
      "The page carrying it already offers an accessible alternative",
    ],
    icon: `<path d="M3 8.4 6.4 12 13 4.6"/>`,
  },
];

/** The five-beat summary rail under the hero. */
const JOURNEY = [
  { n: "1", label: "Find your website", sub: "On the home page" },
  { n: "2", label: "Download the spreadsheet", sub: "One click" },
  { n: "3", label: "See what is in it", sub: "Five columns matter" },
  { n: "4", label: "Decide on each file", sub: "Open the links and judge" },
  { n: "5", label: "Send it back", sub: "Email the file" },
];

// v1.62.0 — trimmed from twelve entries to six. A density review found
// half the answers restated guidance the steps above already give (the
// Delete? column, saving as you go, judging a file from its two links);
// an answer that repeats the page is length without information. The six
// that remain answer questions the steps genuinely don't.
const FAQ = [
  {
    q: "I clicked Download and nothing happened.",
    a: "Usually it did — the file saves straight to your Downloads folder instead of opening on screen, so look there, or click the download icon your browser shows near the address bar. If there is truly no file, your browser may have held it back: look for a small bar or icon near the address bar offering Keep or Allow, and choose it. Still nothing? Email the audit administrator and one will be sent to you directly.",
  },
  {
    q: "I cannot find the Notes column.",
    a: "It is the very last one — column T, past fifteen columns of reference data. Click any cell in a row and press Ctrl and the right-arrow key together (Command and right-arrow on a Mac) to jump straight to the end of the row.",
  },
  {
    q: "There are several tabs along the bottom. Do I fill in all of them?",
    a: "Yes. There is one tab per kind of file — PDFs, DOCX, XLSX, PPTX — and each one needs its Notes column filled in. The Pages tab is different: it is there to look things up, not to fill in.",
  },
  {
    q: "What does the score actually measure?",
    a: "Whether the file can be read aloud correctly by a screen reader — whether its headings, tables, and images are labelled so software can make sense of them. It runs from 0 to 100. A high score does not mean the writing is good, only that the file is readable by assistive technology.",
  },
  {
    q: "A file has no page listed in column E.",
    a: "It is on the server but nothing links to it any more. Those are usually good candidates for archive, but check with whoever published it first.",
  },
  {
    q: "Some of these files should not be public at all.",
    a: "Put it down as archive, say why in the same cell, and mention it in your email so it gets attention ahead of the rest.",
  },
];

/**
 * Spelled-out numbers read better than digits in running prose for a
 * non-technical audience. Covers the range the column map can produce.
 */
const NUM_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];
const spellCount = (n) => NUM_WORDS[n] ?? String(n);
const titleCase = (w) => w.charAt(0).toUpperCase() + w.slice(1);

/* ── partials ─────────────────────────────────────────────────── */

function renderJourneyRail() {
  const beats = JOURNEY.map(
    (b) => `<li class="hp-beat">
        <a class="hp-beat-link" href="#step-${he(b.n)}">
          <span class="hp-beat-n" aria-hidden="true">${he(b.n)}</span>
          <span class="hp-beat-body">
            <span class="hp-beat-label">${he(b.label)}</span>
            <span class="hp-beat-sub">${he(b.sub)}</span>
          </span>
        </a>
      </li>`,
  ).join("\n      ");
  return `<nav class="hp-rail" aria-label="The ${spellCount(JOURNEY.length)} steps on this page">
    <ol class="hp-rail-list">
      ${beats}
    </ol>
  </nav>`;
}

/**
 * The column map: all twenty columns drawn to scale, so the reader sees
 * both that the workbook is mostly reference data and that Notes sits at
 * the far right edge. Lit columns carry their label; dimmed ones are
 * slivers with a letter, and are announced to screen readers as a single
 * summary rather than fifteen unlabelled cells.
 */
function renderColumnMap() {
  const used = WORKBOOK_COLUMNS.filter((c) => c.role);
  const dim = WORKBOOK_COLUMNS.filter((c) => !c.role);
  const strip = WORKBOOK_COLUMNS.map((c) => {
    if (!c.role) {
      return `<span class="hp-col hp-col-dim" aria-hidden="true"><span class="hp-col-letter">${he(c.letter)}</span></span>`;
    }
    return `<span class="hp-col hp-col-${he(c.role)}">
        <span class="hp-col-letter">${he(c.letter)}</span>
        <span class="hp-col-label">${he(c.label)}</span>
      </span>`;
  }).join("\n      ");

  const legend = used
    .map(
      (c) => `<li class="hp-colkey hp-colkey-${he(c.role)}">
        <span class="hp-colkey-letter" aria-hidden="true">${he(c.letter)}</span>
        <span class="hp-colkey-body">
          <span class="hp-colkey-label">Column ${he(c.letter)} &mdash; ${he(c.label)}</span>
          <span class="hp-colkey-gloss">${he(c.gloss)}</span>
        </span>
      </li>`,
    )
    .join("\n      ");

  return `<figure class="hp-colmap">
    <figcaption class="hp-colmap-cap">
      <span class="hp-colmap-cap-title">${titleCase(spellCount(WORKBOOK_COLUMNS.length))} columns. You use ${spellCount(used.length)}.</span>
      <span class="hp-colmap-cap-sub">Every column across the top of the spreadsheet, drawn to scale. The narrow grey ones are reference data for the audit team &mdash; you can ignore all ${spellCount(dim.length)} of them.</span>
    </figcaption>
    <div class="hp-colmap-strip" role="img" aria-label="${he(`The spreadsheet's ${spellCount(WORKBOOK_COLUMNS.length)} columns. ${titleCase(spellCount(used.length))} matter: ${used.map((c) => `${c.letter} ${c.label}`).join(", ")}. The other ${spellCount(dim.length)} — ${dim.map((c) => c.letter).join(", ")} — are reference data.`)}">
      ${strip}
    </div>
    <ul class="hp-colkeys">
      ${legend}
    </ul>
  </figure>`;
}

/**
 * A rendered spreadsheet fragment. Not interactive and not a form: it
 * shows what the reader will be looking at in Excel, with the Notes cells
 * already filled in so the finished state is unambiguous.
 */
function renderExampleGrid() {
  // Same site as every screenshot on this page — see the ONE EXAMPLE SITE
  // note at the top of the module. Paths follow ARI's real URL shape
  // (icjia.illinois.gov/adultredeploy/…) so the example reads as one
  // continuous walk-through rather than three unrelated fragments.
  const rows = [
    {
      file: "annual_report_2019.pdf",
      page: "/adultredeploy/publications/",
      score: "41",
      note: "archive",
      kind: "archive",
      why: "The 2025 edition replaced it.",
    },
    {
      file: "grant_application_2026.pdf",
      page: "/adultredeploy/grants/",
      score: "58",
      note: "remediate",
      kind: "remediate",
      why: "Still linked, and the score is low.",
    },
    {
      file: "authorizing_statute_signed.pdf",
      page: "/adultredeploy/about/",
      score: "62",
      note: "as-is",
      kind: "asis",
      why: "A signed record — it cannot be altered.",
    },
  ];
  const body = rows
    .map(
      (r) => `<tr>
        <td class="hp-grid-file">${he(r.file)}</td>
        <td class="hp-grid-page">${he(r.page)}</td>
        <td class="hp-grid-score">${he(r.score)}</td>
        <td class="hp-grid-note hp-grid-note-${he(r.kind)}"><span class="hp-grid-typed">${he(r.note)}</span><span class="hp-grid-why">${he(r.why)}</span></td>
      </tr>`,
    )
    .join("\n      ");
  return `<figure class="hp-grid-wrap">
    <figcaption class="hp-grid-cap">Three rows from the same site's spreadsheet, decided. The score and the page told the story; the Notes cell just records the outcome.</figcaption>
    <div class="hp-grid-scroll">
      <table class="hp-grid">
        <thead>
          <tr>
            <th scope="col"><span class="hp-grid-col">B</span> File name</th>
            <th scope="col"><span class="hp-grid-col">E</span> Page References</th>
            <th scope="col"><span class="hp-grid-col">I</span> Score</th>
            <th scope="col" class="hp-grid-th-note"><span class="hp-grid-col">T</span> Notes <em>&mdash; your decision</em></th>
          </tr>
        </thead>
        <tbody>
      ${body}
        </tbody>
      </table>
    </div>
  </figure>`;
}

/**
 * The two link columns, framed as the investigation the decision rests on.
 * This is the step's real work: the reader cannot judge a file from its
 * name, so they open the file itself (column D) and the page carrying it
 * (column E). Writing the outcome into Notes is the trivial part, and the
 * page is careful not to present it as the task.
 */
function renderJudgeLinks() {
  const links = [
    {
      letter: "D",
      label: "Public URL",
      lede: "Click it and the file itself opens in your browser.",
      asks: [
        "Is it still current, or has a newer version replaced it?",
        "Is it a scan of a paper document? Those usually cannot be read by a screen reader at all.",
        "Would you still hand this to a member of the public today?",
      ],
    },
    {
      letter: "E",
      label: "Page References",
      lede: "Click it and the web page that links to the file opens.",
      asks: [
        "Is that page still live, and still one people use?",
        "Does the file still belong there, or has the programme moved on?",
        "Nothing listed at all? Then no page on your site links to it any more.",
      ],
    },
  ];
  return `<div class="hp-judge">
    <h3 class="hp-judge-title">Two columns do the deciding for you</h3>
    <p class="hp-judge-lede">You cannot tell what a file is from its name. Both of these columns are clickable links &mdash; open them, and the answer is usually obvious in a few seconds.</p>
    <div class="hp-judge-grid">
      ${links.map((l) => `<div class="hp-judge-card">
        <p class="hp-judge-head"><span class="hp-judge-letter">${he(l.letter)}</span> ${he(l.label)}</p>
        <p class="hp-judge-lede-sm">${he(l.lede)}</p>
        <p class="hp-judge-asks-head">It answers</p>
        <ul class="hp-judge-asks">
          ${l.asks.map((a) => `<li>${he(a)}</li>`).join("\n          ")}
        </ul>
      </div>`).join("\n      ")}
    </div>
  </div>`;
}

/** The three outcomes, at headline scale. The page's signature block. */
function renderDecisionCards() {
  return `<div class="hp-decisions">
    ${DECISIONS.map(
      (d) => `<article class="hp-decision hp-decision-${he(d.kind)}">
      <span class="hp-decision-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d.icon}</svg></span>
      <h3 class="hp-decision-word">${he(d.word)}</h3>
      <p class="hp-decision-summary">${he(d.summary)}</p>
      <p class="hp-decision-detail">${he(d.detail)}</p>
      <p class="hp-decision-when-head">Choose it when</p>
      <ul class="hp-decision-when">
        ${d.when.map((w) => `<li>${he(w)}</li>`).join("\n        ")}
      </ul>
    </article>`,
    ).join("\n    ")}
  </div>`;
}

/**
 * "How this differs from SiteImprove" — the question staff arrive with,
 * because DoIT already licenses a scanner and nobody explained why there
 * is a second thing to read.
 *
 * TONE RULE, deliberate: every claim here is either about what THIS audit
 * does, or is a documented fact about conformance levels. Nothing asserts
 * a shortcoming in a vendor's product. That is not diplomacy for its own
 * sake — claims about someone else's tool go stale when they ship a
 * change, and this page is read by staff who have to work with both. The
 * strongest true framing is that the two measure different things: a page
 * scanner scores pages, this scores the documents those pages publish.
 *
 * The one comparative statement — that a weighted rollup mixing AAA and
 * vendor best-practices into a single number can sit below 100 while every
 * Level A and AA check passes — is a description of how a blended score
 * behaves, and is verifiable from SiteImprove's own per-issue breakdown.
 *
 * Where the two genuinely differ in kind, say so as a TRADE, not a
 * failing. A statewide platform maintained by an outside vendor has to
 * serve every agency in Illinois; that is why its roadmap cannot be
 * bespoke, and it is a sound reason rather than a shortcoming. This audit
 * is narrower and built in-house, so a request lands faster — which is
 * worth stating precisely because it points readers at the straw poll on
 * the home page.
 *
 * Nobody reading this should come away thinking they must pick one.
 *
 * The legal target is not editorial: ADA Title II's web rule
 * (28 CFR 35.200(b)(3)) and Illinois IITAA 2.1 both require WCAG 2.1
 * Level AA. AAA is above what either asks for.
 */
function renderVsSiteImprove(sitesPhrase) {
  const rows = [
    {
      q: "What it measures",
      us: `The <strong>files</strong> a site publishes &mdash; every PDF, Word, Excel and PowerPoint document, each with its own score &mdash; alongside a separate score for the site's web pages. The two never get blended into one number.`,
      note: `A page scanner's job is the pages. Documents are a different discipline, and the people who remediate them are usually not the people who fix a template.`,
    },
    {
      q: "What it measures against",
      us: `<strong>WCAG 2.1 Level AA</strong> &mdash; the level ADA Title II's web rule and Illinois IITAA 2.1 actually require.`,
      note: `A single weighted score that folds Level AAA and a vendor's own best-practice rules in with A and AA can sit below 100 while every A and AA check passes. That gap is worth knowing about before it reaches a manager as a number.`,
    },
    {
      q: "What you get out of it",
      us: `A <strong>spreadsheet per site</strong>: one row per file, its score, a link to the file, the page it appears on, and an empty Notes column for your decision. It is the thing your unit works from and hands back.`,
      note: `A dashboard tells you a score. This is a worklist you can sort, filter, split between colleagues, and mark up offline.`,
    },
    {
      q: "When you need it to do something else",
      us: `Ask. This audit is built and maintained inside ICJIA &mdash; the <a href="index.html#top">home page</a> carries a list of ideas under consideration with a one-click way to say which you want, and requests from staff are where most of what is already here came from.`,
      note: `SiteImprove is a statewide platform maintained by an outside vendor, so its roadmap has to serve every agency in Illinois rather than one. That is a reasonable trade &mdash; it just means a request specific to ICJIA lands faster here.`,
    },
    {
      q: "What it covers",
      us: `${sitesPhrase} and nothing else &mdash; scoped, named, and scanned together so the numbers on this site reconcile with each other.`,
      note: `A narrower scope than a statewide platform, which is the point: it can be re-run on demand and re-published with every audit.`,
    },
  ];

  return `<section class="hp-vs" aria-labelledby="hp-vs-heading">
    <h2 class="hp-vs-heading" id="hp-vs-heading">How this differs from SiteImprove</h2>
    <p class="hp-vs-lede"><strong>You do not have to choose between the two.</strong> ICJIA uses <strong>SiteImprove</strong> as well, this does not replace it, and nothing here is a case against it. They answer different questions, and each has things it does better than the other.</p>
    <p class="hp-vs-lede">The short version: <strong>SiteImprove scans web pages. This audits the documents those pages publish</strong> &mdash; and hands you a spreadsheet to work from. Open whichever one answers the question in front of you.</p>
    <div class="hp-vs-grid">
      ${rows.map((r) => `<div class="hp-vs-row">
        <p class="hp-vs-q">${he(r.q)}</p>
        <p class="hp-vs-us">${r.us}</p>
        <p class="hp-vs-note">${r.note}</p>
      </div>`).join("\n      ")}
    </div>
    <p class="hp-vs-foot">Both are worth having, and plenty of people use both in the same week. If a SiteImprove score and a score on this site ever disagree, they are almost certainly measuring different things rather than one of them being wrong &mdash; ask the audit administrator and you will get the reconciliation in writing.</p>
  </section>`;
}

/**
 * The troubleshooting list, flat. Deliberately NOT a <details> accordion:
 * the first entry answers the exact complaint that prompted this page,
 * and an answer behind a click is an answer most readers never see.
 */
function renderFaq() {
  return FAQ.map(
    (item) => `<div class="hp-faq-item">
      <h3 class="hp-faq-q">${he(item.q)}</h3>
      <p class="hp-faq-a">${he(item.a)}</p>
    </div>`,
  ).join("\n      ");
}

/**
 * A numbered step. `media` is optional trailing HTML (a screenshot figure
 * or an infographic) rendered under the prose.
 */
function renderStep({ n, title, lede, body = "", media = "" }) {
  return `<li class="hp-step" id="step-${he(n)}">
    <div class="hp-step-marker" aria-hidden="true">
      <span class="hp-step-n">${he(n)}</span>
    </div>
    <div class="hp-step-main">
      <p class="hp-step-of">Step ${he(n)} of ${he(String(JOURNEY.length))}</p>
      <h2 class="hp-step-title">${title}</h2>
      <p class="hp-step-lede">${lede}</p>
      ${body}
      ${media}
    </div>
  </li>`;
}

/** A screenshot with its caption. Width/height prevent load-time reflow. */
function renderShot(shot, { caption, size = "" }) {
  return `<figure class="hp-shot${size ? ` hp-shot-${he(size)}` : ""}">
      <img src="assets/help/${he(shot.file)}" alt="${he(shot.alt)}" width="${he(String(shot.width))}" height="${he(String(shot.height))}" loading="lazy" decoding="async">
      <figcaption>${caption}</figcaption>
    </figure>`;
}

/* ── page ─────────────────────────────────────────────────────── */

/**
 * Generate help.html — the guide for staff reviewing their site's files.
 *
 * @param {object} [args]
 * @param {string} [args.generatedAt] - preformatted "generated at" string
 * @param {number} [args.siteCount] - how many sites the audit actually
 *   covers, from the same per-site results the hero counts. Omitted or
 *   zero degrades the copy to "ICJIA's audited sites" rather than
 *   printing a stale number.
 * @returns {string} full HTML document
 */
export function generateHelpHtml({ generatedAt = "", siteCount = 0 } = {}) {
  const n = Number.isFinite(siteCount) && siteCount > 0 ? siteCount : null;
  const sitesPhrase = n ? `ICJIA's ${n} audited sites` : "ICJIA's audited sites";
  const step1 = renderStep({
    n: "1",
    title: "Find your website",
    lede: `Start on the <a href="index.html">home page</a> and scroll down to <strong>Websites in this audit</strong>. Every ICJIA site has a card there. Find yours.`,
    body: `<div class="hp-note">
      <p><strong>Not sure which one is yours?</strong> The blue web address under each name is the site itself &mdash; open it in a new tab if you need to check. The short code above the name (ARI, DVFR, R3) is just an internal nickname; it turns up again in the name of the file you are about to download.</p>
    </div>`,
    media: renderShot(SHOTS.findSite, {
      caption: `One card per website. Here, Adult Redeploy Illinois publishes 569 files, and 430 of them may need accessibility work.`,
      size: "narrow",
    }),
  });

  const step2 = renderStep({
    n: "2",
    title: "Download the spreadsheet",
    lede: `Two buttons do this, in two different places. They download <em>the same file</em> &mdash; use whichever you reach first. Both pictures below show the same site as step 1.`,
    body: `<div class="hp-routes">
      <div class="hp-route">
        <p class="hp-route-tag">The quick way</p>
        <p class="hp-route-text">Scroll to the bottom of your site's card and click <strong>Download spreadsheet</strong>. You never have to leave the home page.</p>
        ${renderShot(SHOTS.downloadCard, { caption: `At the bottom of every card.` })}
      </div>
      <div class="hp-route">
        <p class="hp-route-tag">From the site's report</p>
        <p class="hp-route-text">Or click <strong>View detailed report</strong> first, to see the site's scores. The green <strong>Download spreadsheet (XLSX)</strong> button sits at the top of that page.</p>
        ${renderShot(SHOTS.downloadReport, { caption: `The same site's report page &mdash; the green button at the top gives you the identical file.` })}
      </div>
    </div>

    <div class="hp-landing">
      <h3 class="hp-landing-title">Where did it go?</h3>
      <p class="hp-landing-lede">Nothing opens on screen, and that catches most people out. The file saves straight to your computer instead.</p>
      <dl class="hp-landing-list">
        <dt>Look in</dt>
        <dd>Your <strong>Downloads</strong> folder, or the download icon your browser puts near the address bar.</dd>
        <dt>It is called</dt>
        <dd><code class="hp-filename">ari-20260818-004812Z.xlsx</code> &mdash; your site's short code, then the date of the audit. Yours will carry a different code and date.</dd>
        <dt>Open it with</dt>
        <dd>Excel, Apple Numbers, or Google Sheets. All three read it.</dd>
        <dt>If nothing arrived</dt>
        <dd>Your browser may have held the download back. Look for a small bar or icon near the address bar offering <strong>Keep</strong>, and choose it.</dd>
      </dl>
    </div>`,
  });

  const step3 = renderStep({
    n: "3",
    title: "See what is in it",
    lede: `The spreadsheet lists every file your website publishes &mdash; <strong>what each file is called</strong>, and <strong>which page it appears on</strong>. That second one is the part people miss, and it is usually what makes a file recognisable.`,
    body: `${renderColumnMap()}

    <div class="hp-twoviews">
      <h3 class="hp-twoviews-title">The same files, two ways round</h3>
      <p class="hp-twoviews-lede">Along the bottom of the spreadsheet are several tabs. They are not copies of each other.</p>
      <div class="hp-twoviews-grid">
        <div class="hp-view">
          <p class="hp-view-tag">Tabs named PDFs, DOCX, XLSX, PPTX</p>
          <p class="hp-view-head">One row per file</p>
          <p class="hp-view-text">One tab for each kind of file. Column E on these tabs tells you which web page the file appears on. <strong>These are the tabs you fill in.</strong></p>
        </div>
        <div class="hp-view">
          <p class="hp-view-tag">The tab named Pages</p>
          <p class="hp-view-head">One row per web page</p>
          <p class="hp-view-text">The same information turned around: each row is a page on your website, listing the files that page links to. Useful when you would rather think page by page. <strong>Nothing to fill in here</strong> &mdash; it is for looking things up.</p>
        </div>
      </div>
    </div>`,
  });

  const step4 = renderStep({
    n: "4",
    title: "Open the links and decide",
    lede: `This is the part only you can do. Open the file, open the page it sits on, and judge: does it still belong on the website, and if it does, does it need work? Then note which of <strong>three outcomes</strong> you reached.`,
    body: `${renderJudgeLinks()}

    ${renderDecisionCards()}

    <div class="hp-unsure">
      <p class="hp-unsure-title">Not sure about a file?</p>
      <p class="hp-unsure-text">Put it down as <code>remediate</code>. It is the safe answer &mdash; it means someone will look at the file properly rather than it being quietly removed or quietly left alone.</p>
    </div>

    ${renderExampleGrid()}

    <div class="hp-note">
      <p><strong>Four practical things.</strong> Record your decision on every file tab, not just the first. Writing more than the outcome is welcome &mdash; put the word first, then your reasoning (<em>archive &mdash; superseded by the 2026 edition</em> reads perfectly well). Ignore the <strong>Delete?</strong> column next to Notes &mdash; it is an older column and the audit team works from Notes. And save as you go: the spreadsheet on your desktop is the only copy of your answers, because nothing you type is sent back to this website.</p>
    </div>`,
  });

  const step5 = renderStep({
    n: "5",
    title: "Send it back",
    lede: `Send the completed site audit report, with your remediation determinations in it, to <a class="hp-handback-address" href="mailto:${he(HANDBACK.email)}">${he(HANDBACK.email)}</a>. That file becomes the audit record for your site &mdash; the evidence of what was decided, and when.`,
    body: `<div class="hp-note">
      <p><strong>Attach the spreadsheet itself.</strong> Send the <code>.xlsx</code> file, not a screenshot of it and not the rows pasted into the message body. Keep your own copy as well.</p>
    </div>
    <div class="hp-note">
      <p><strong>Partly done is still worth sending.</strong> A report with the obvious rows decided and the rest blank is more useful than one that never arrives. Say in your email how far you got.</p>
    </div>`,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="Help — how to download your website's file list from the ICJIA Fleet Audit and decide what happens to each file. A guide for staff, in five steps.">
<meta name="robots" content="noindex, nofollow">
${PLAUSIBLE_SNIPPET}
<title>Help &mdash; ICJIA Fleet Audit Assessment</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%230d1117'/><path d='M12 9L12 23L23 16Z' fill='%23ffb000'/></svg>">
<style>${INDEX_CSS}${siteFooterCss()}${helpNavCss()}${helpCss()}</style>
</head>
<body id="top">
<a class="skip-link" href="#main">Skip to content</a>

<header class="site-header">
  <div class="site-header-left">
    <a class="icjia-logo" href="index.html" aria-label="ICJIA Fleet Audit Assessment home" title="Back to the fleet snapshot">${ICJIA_LOGO_SVG}</a>
    <span class="brand"><span>ICJIA</span> Fleet Audit Assessment</span>
  </div>
  <div class="site-header-right">
    ${helpNavLink({ current: true })}
    <a class="audit-tool-link nav-sites" href="index.html" title="Back to the fleet snapshot (home)">
      <svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 7.5 8 2.5l5.5 5"/><path d="M4 7v6h8V7"/></svg>
      <span>Home</span>
    </a>
    <a class="audit-tool-link nav-search" href="search.html" title="Search every file across the fleet by full or partial filename">
      <svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
      <span>Search</span>
    </a>
    <a class="audit-tool-link" href="https://accessibility.icjia.app" target="_blank" rel="noopener noreferrer" title="ICJIA accessibility FAQs (accessibility.icjia.app, opens in a new tab)">
      <svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="8" cy="8" r="6.5"/>
        <path d="M6 6.2a2 2 0 1 1 2.6 1.9c-0.5 0.2-0.6 0.5-0.6 0.9"/>
        <circle cx="8" cy="11.2" r="0.55" fill="currentColor"/>
      </svg>
      <span>Accessibility FAQs</span>
    </a>
  </div>
</header>

<main id="main">
  <div class="fleet-section-banner hp-banner" role="presentation">
    <p class="fleet-section-eyebrow">Help</p>
    <h1 class="fleet-section-headline">How to review your site&#39;s files</h1>
    <p class="fleet-section-lede">Every ICJIA website has a spreadsheet listing every file it publishes &mdash; what each file is called, which page it appears on, and how accessible it is today. This page shows you how to get yours, and how to decide what happens to each file.</p>
    <ul class="hp-kit">
      <li><span class="hp-kit-k">You need</span> a web browser</li>
      <li><span class="hp-kit-k">and</span> Excel, Numbers, or Google Sheets</li>
      <li><span class="hp-kit-k">it takes</span> about ten minutes to start</li>
    </ul>
  </div>

  ${renderJourneyRail()}

  <div class="hp-reassure">
    <p><strong>Nothing here is a test, and nothing you do on this website is recorded.</strong> You download a file, you write in it on your own computer, and you email it back. That spreadsheet is the record &mdash; there is no form on this site to fill in, and no way to lose your work by closing the page.</p>
  </div>

  <ol class="hp-stepper">
  ${step1}
  ${step2}
  ${step3}
  ${step4}
  ${step5}
  </ol>

  ${renderVsSiteImprove(sitesPhrase)}

  <section class="hp-faqs" aria-labelledby="hp-faq-heading">
    <h2 class="hp-faq-heading" id="hp-faq-heading">If something does not go to plan</h2>
    <p class="hp-faq-lede">The ${spellCount(FAQ.length)} questions people actually ask, answered in full.</p>
    <div class="hp-faq-grid">
      ${renderFaq()}
    </div>
  </section>

  <section class="hp-closing">
    <h2 class="hp-closing-title">Still stuck?</h2>
    <p class="hp-closing-text">Email <a class="hp-handback-address" href="mailto:${he(HANDBACK.email)}">${he(HANDBACK.email)}</a> and say which website you are working on. A copy of your report can be sent to you directly.</p>
    <p class="hp-closing-links"><a href="index.html">&larr; Back to the fleet snapshot</a> <span aria-hidden="true">&middot;</span> <a href="search.html">Search every file</a> <span aria-hidden="true">&middot;</span> <a href="https://accessibility.icjia.app" target="_blank" rel="noopener noreferrer">Accessibility FAQs</a></p>
  </section>
</main>

${renderSiteFooter({ generatedAt })}
</body>
</html>`;
}

/* ── styles ───────────────────────────────────────────────────── */

/**
 * Styles for /help. Scoped with an `hp-` prefix and appended after
 * INDEX_CSS, so nothing here can reach another page.
 *
 * The palette is the site's own, re-used for what it already means:
 * blue for wayfinding, amber for "needs audit work", green for
 * "download / fine as it is". The three decision cards each carry an icon
 * and their own wording as well as a colour, so the distinction survives
 * greyscale printing and colour-blindness.
 *
 * @returns {string}
 */
export function helpCss() {
  return `
/* ── help: hero ──────────────────────────────────────────────── */
.hp-banner::before { background: linear-gradient(90deg, #f0a92a 0%, #d1890f 100%); }
.hp-banner .fleet-section-eyebrow { color: #f0a92a; }
.hp-kit {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.6rem;
  margin: 1.15rem 0 0;
  padding: 0;
  font-size: 0.94rem;
  color: #c0cdda;
}
.hp-kit-k {
  display: inline-block;
  margin-right: 0.4rem;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #8b949e;
}

/* ── help: five-beat rail ────────────────────────────────────── */
.hp-rail { margin: 0 0 1.5rem; }
.hp-rail-list {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  align-items: stretch;
  gap: 1.4rem;
  margin: 0;
  padding: 0;
}
.hp-beat { position: relative; display: flex; }
.hp-beat-link {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  width: 100%;
  padding: 0.85rem 0.95rem;
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 10px;
  text-decoration: none !important;
  color: inherit;
  transition: border-color 120ms ease, background 120ms ease;
}
.hp-beat-link:hover { border-color: #3a4553; background: #1a212a; }
.hp-beat-link:focus-visible { outline: 3px solid #f0a92a; outline-offset: 2px; }
/* The connector sits in the flex gap, not inside the card, so each beat
   reads as one object and the arrows read as the flow between them. */
.hp-beat:not(:last-child)::after {
  content: "\\2192";
  position: absolute;
  right: -1.02rem;
  top: 50%;
  transform: translateY(-50%);
  color: #4a5563;
  font-size: 0.95rem;
  line-height: 1;
}
.hp-beat-n {
  flex: none;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #21262d;
  border: 1px solid #30363d;
  color: #f0a92a;
  font-size: 0.92rem;
  font-weight: 800;
}
.hp-beat-body { display: flex; flex-direction: column; line-height: 1.3; }
.hp-beat-label { font-size: 0.92rem; font-weight: 700; color: #e5e5e5; }
.hp-beat-sub { font-size: 0.79rem; color: #8b949e; }
@media (max-width: 1000px) {
  /* Below five-across the connectors would point at the row below, so
     they go; the numbers still carry the sequence. */
  .hp-rail-list { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.6rem; }
  .hp-beat:not(:last-child)::after { display: none; }
  .hp-beat:last-child { grid-column: 1 / -1; }
}
@media (max-width: 560px) {
  .hp-rail-list { grid-template-columns: minmax(0, 1fr); }
}

/* ── help: reassurance panel ─────────────────────────────────── */
.hp-reassure {
  margin: 0 0 2.4rem;
  padding: 1rem 1.15rem;
  background: rgba(63, 185, 80, 0.07);
  border: 1px solid rgba(63, 185, 80, 0.28);
  border-left: 4px solid #3fb950;
  border-radius: 10px;
}
.hp-reassure p { margin: 0; font-size: 0.97rem; color: #c9d6e2; }
.hp-reassure strong { color: #e8f4ea; }

/* ── help: the stepper ───────────────────────────────────────── */
/* Five things, in order, with a spine through the numbers. The list is a
   real <ol> so the sequence survives with styles off; the visible digits
   are markup, not CSS counters, so they are selectable and readable. */
.hp-stepper { list-style: none; margin: 0 0 3rem; padding: 0; }
.hp-step {
  position: relative;
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 0 1.6rem;
  padding: 0 0 3.4rem;
  scroll-margin-top: 5rem;
}
.hp-step:last-child { padding-bottom: 0; }
/* The spine: from under one number down to the next. */
.hp-step:not(:last-child)::before {
  content: "";
  position: absolute;
  left: 45px;
  top: 92px;
  bottom: 0.6rem;
  width: 2px;
  border-radius: 2px;
  background: linear-gradient(180deg, #4a3a15 0%, #262d38 100%);
}
.hp-step-marker { grid-column: 1; }
.hp-step-n {
  display: grid;
  place-items: center;
  width: 92px;
  height: 92px;
  border-radius: 50%;
  background: linear-gradient(180deg, #f0a92a 0%, #d1890f 100%);
  color: #1a1204;
  font-size: 3.2rem;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.05em;
}
.hp-step-main { grid-column: 2; min-width: 0; }
.hp-step-of {
  margin: 0.35rem 0 0.5rem;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #8b949e;
}
.hp-step-title {
  margin: 0 0 0.6rem;
  font-size: clamp(1.7rem, 3.4vw, 2.35rem);
  font-weight: 900;
  line-height: 1.1;
  letter-spacing: -0.025em;
  color: #ffffff;
}
.hp-step-lede {
  margin: 0 0 1.5rem;
  max-width: 66ch;
  font-size: 1.12rem;
  line-height: 1.6;
  color: #c0cdda;
}
.hp-step-lede strong { color: #e5e5e5; }
@media (max-width: 780px) {
  .hp-step { grid-template-columns: 1fr; gap: 0; padding-bottom: 2.6rem; }
  .hp-step:not(:last-child)::before { display: none; }
  .hp-step:not(:last-child) { border-bottom: 1px solid #21262d; margin-bottom: 2.6rem; }
  .hp-step-marker { margin-bottom: 0.8rem; }
  .hp-step-n { width: 62px; height: 62px; font-size: 2.1rem; }
  .hp-step-of { margin-top: 0; }
  .hp-step-lede { font-size: 1.04rem; }
}

/* ── help: screenshots ───────────────────────────────────────── */
.hp-shot { margin: 1.2rem 0 0; }
.hp-shot img {
  display: block;
  width: 100%;
  height: auto;
  max-width: 100%;
  border-radius: 12px;
  border: 1px solid #30363d;
  background: #0d1117;
}
.hp-shot-narrow img { max-width: 420px; }
.hp-shot figcaption {
  margin: 0.6rem 0 0;
  font-size: 0.85rem;
  line-height: 1.5;
  color: #8b949e;
}
.hp-shot-narrow figcaption { max-width: 420px; }

/* ── help: two download routes ───────────────────────────────── */
.hp-routes {
  display: grid;
  grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
  gap: 1.4rem;
  align-items: start;
}
@media (max-width: 860px) { .hp-routes { grid-template-columns: 1fr; } }
.hp-route {
  padding: 1.1rem 1.2rem 1.3rem;
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 12px;
}
.hp-route-tag {
  margin: 0 0 0.4rem;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #4dabf7;
}
.hp-route-text { margin: 0; font-size: 0.97rem; color: #c0cdda; }
.hp-route-text strong { color: #e5e5e5; }
.hp-route .hp-shot img { max-width: 100%; }

/* ── help: "where did it go?" ────────────────────────────────── */
.hp-landing {
  margin: 1.6rem 0 0;
  padding: 1.25rem 1.35rem 1.35rem;
  background: #12181f;
  border: 1px solid #21262d;
  border-left: 4px solid #4dabf7;
  border-radius: 12px;
}
.hp-landing-title { margin: 0 0 0.35rem; font-size: 1.12rem; font-weight: 800; color: #ffffff; }
.hp-landing-lede { margin: 0 0 0.9rem; font-size: 0.99rem; color: #c0cdda; max-width: 68ch; }
.hp-landing-list {
  margin: 0;
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 0.62rem 1.1rem;
  align-items: baseline;
}
.hp-landing-list dt {
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #6f8aa5;
  white-space: nowrap;
}
.hp-landing-list dd { margin: 0; font-size: 0.95rem; line-height: 1.55; color: #c0cdda; }
.hp-landing-list strong { color: #e5e5e5; }
@media (max-width: 600px) {
  .hp-landing-list { grid-template-columns: 1fr; gap: 0.15rem; }
  .hp-landing-list dd { margin-bottom: 0.5rem; }
}
.hp-filename {
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.86rem;
  padding: 0.12rem 0.4rem;
  border-radius: 5px;
  background: #0d1117;
  border: 1px solid #30363d;
  color: #f0a92a;
  overflow-wrap: anywhere;
}

/* ── help: the column map ────────────────────────────────────── */
.hp-colmap {
  margin: 0 0 1.8rem;
  padding: 1.35rem 1.4rem 1.5rem;
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 14px;
}
.hp-colmap-cap { display: block; margin: 0 0 1.1rem; }
.hp-colmap-cap-title {
  display: block;
  font-size: 1.18rem;
  font-weight: 800;
  letter-spacing: -0.015em;
  color: #ffffff;
}
.hp-colmap-cap-sub {
  display: block;
  margin-top: 0.3rem;
  max-width: 70ch;
  font-size: 0.94rem;
  line-height: 1.55;
  color: #8b949e;
}
.hp-colmap-strip {
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: 0.45rem;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 9px;
  overflow: hidden;
}
.hp-col {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  min-width: 0;
  padding: 0.4rem 0.3rem 0.5rem;
  border-radius: 5px;
  background: #171d26;
  text-align: center;
}
.hp-col-dim { flex: 0 1 18px; background: #141a22; }
.hp-col-dim .hp-col-letter { color: #7a8798; }
.hp-col-read { flex: 1 1 auto; background: rgba(77, 171, 247, 0.13); box-shadow: inset 0 0 0 1px rgba(77, 171, 247, 0.4); }
.hp-col-write { flex: 1.35 1 auto; background: rgba(240, 169, 42, 0.15); box-shadow: inset 0 0 0 1px rgba(240, 169, 42, 0.5); }
.hp-col-letter {
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #8b949e;
}
.hp-col-read .hp-col-letter { color: #7cc4fb; }
.hp-col-write .hp-col-letter { color: #f0a92a; }
.hp-col-label {
  margin-top: 0.2rem;
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.25;
  color: #d6e2ee;
  overflow-wrap: anywhere;
}
.hp-col-write .hp-col-label { color: #ffdca4; }
@media (max-width: 720px) {
  .hp-colmap-strip { gap: 1px; padding: 0.3rem; }
  .hp-col-dim { flex-basis: 8px; }
  .hp-col-dim .hp-col-letter { font-size: 0.55rem; }
  .hp-col-label { font-size: 0.63rem; }
}
.hp-colkeys { list-style: none; margin: 1.15rem 0 0; padding: 0; display: grid; gap: 0.55rem; }
.hp-colkey { display: flex; gap: 0.75rem; align-items: baseline; }
.hp-colkey-letter {
  flex: none;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.78rem;
  font-weight: 800;
  align-self: flex-start;
}
.hp-colkey-read .hp-colkey-letter { background: rgba(77, 171, 247, 0.16); color: #7cc4fb; border: 1px solid rgba(77, 171, 247, 0.4); }
.hp-colkey-write .hp-colkey-letter { background: rgba(240, 169, 42, 0.18); color: #f0a92a; border: 1px solid rgba(240, 169, 42, 0.5); }
.hp-colkey-body { min-width: 0; }
.hp-colkey-label { display: block; font-size: 0.93rem; font-weight: 700; color: #e5e5e5; }
.hp-colkey-write .hp-colkey-label { color: #ffdca4; }
.hp-colkey-gloss { display: block; font-size: 0.9rem; line-height: 1.5; color: #8b949e; }

/* ── help: two views (tabs) ──────────────────────────────────── */
.hp-twoviews {
  padding: 1.3rem 1.4rem 1.45rem;
  background: #12181f;
  border: 1px solid #21262d;
  border-radius: 14px;
}
.hp-twoviews-title { margin: 0 0 0.3rem; font-size: 1.12rem; font-weight: 800; color: #ffffff; }
.hp-twoviews-lede { margin: 0 0 1.1rem; font-size: 0.96rem; color: #8b949e; max-width: 68ch; }
.hp-twoviews-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
@media (max-width: 760px) { .hp-twoviews-grid { grid-template-columns: 1fr; } }
.hp-view {
  padding: 1rem 1.1rem 1.1rem;
  background: #0d1117;
  border: 1px solid #21262d;
  border-radius: 10px;
}
.hp-view-tag {
  margin: 0 0 0.5rem;
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.73rem;
  letter-spacing: 0.02em;
  color: #6f8aa5;
}
.hp-view-head { margin: 0 0 0.4rem; font-size: 1.02rem; font-weight: 800; color: #e5e5e5; }
.hp-view-text { margin: 0; font-size: 0.93rem; line-height: 1.55; color: #a9b8c6; }
.hp-view-text strong { color: #e5e5e5; }

/* ── help: the two link columns ──────────────────────────────── */
/* Blue register, matching the read-columns in the column map above — these
   are the same two columns, now being used rather than described. */
.hp-judge {
  margin: 0 0 1.6rem;
  padding: 1.3rem 1.4rem 1.45rem;
  background: #12181f;
  border: 1px solid #21262d;
  border-left: 4px solid #4dabf7;
  border-radius: 14px;
}
.hp-judge-title { margin: 0 0 0.3rem; font-size: 1.12rem; font-weight: 800; color: #ffffff; }
.hp-judge-lede { margin: 0 0 1.1rem; max-width: 70ch; font-size: 0.96rem; line-height: 1.55; color: #a9b8c6; }
.hp-judge-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
@media (max-width: 760px) { .hp-judge-grid { grid-template-columns: 1fr; } }
.hp-judge-card {
  padding: 1rem 1.1rem 1.1rem;
  background: #0d1117;
  border: 1px solid #21262d;
  border-radius: 10px;
}
.hp-judge-head {
  margin: 0 0 0.4rem;
  font-size: 1.02rem;
  font-weight: 800;
  color: #e5e5e5;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.hp-judge-letter {
  flex: none;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: rgba(77, 171, 247, 0.16);
  border: 1px solid rgba(77, 171, 247, 0.4);
  color: #7cc4fb;
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.78rem;
  font-weight: 800;
}
.hp-judge-lede-sm { margin: 0 0 0.85rem; font-size: 0.93rem; line-height: 1.55; color: #c0cdda; }
.hp-judge-asks-head {
  margin: 0 0 0.45rem;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #8b98a8;
}
.hp-judge-asks { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.45rem; }
.hp-judge-asks li {
  position: relative;
  padding-left: 1.1rem;
  font-size: 0.91rem;
  line-height: 1.5;
  color: #b6c3d0;
}
.hp-judge-asks li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.55em;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #4dabf7;
  opacity: 0.7;
}

/* ── help: the three outcomes ────────────────────────────────── */
.hp-decisions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin: 0 0 1.5rem; }
@media (max-width: 900px) { .hp-decisions { grid-template-columns: 1fr; } }
.hp-decision {
  padding: 1.3rem 1.35rem 1.4rem;
  background: #161b22;
  border: 1px solid #21262d;
  border-top: 4px solid #4a5563;
  border-radius: 12px;
}
.hp-decision-icon { display: block; width: 30px; height: 30px; margin: 0 0 0.7rem; color: #8b949e; }
.hp-decision-icon svg { width: 100%; height: 100%; }
.hp-decision-word {
  margin: 0 0 0.5rem;
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: clamp(1.5rem, 3.2vw, 1.95rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1;
  color: #e5e5e5;
}
.hp-decision-summary { margin: 0 0 0.55rem; font-size: 1rem; font-weight: 700; color: #e5e5e5; }
.hp-decision-detail { margin: 0 0 1rem; font-size: 0.93rem; line-height: 1.55; color: #a9b8c6; }
.hp-decision-when-head {
  margin: 0 0 0.45rem;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #8b98a8;
}
.hp-decision-when { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
.hp-decision-when li {
  position: relative;
  padding-left: 1.1rem;
  font-size: 0.91rem;
  line-height: 1.5;
  color: #b6c3d0;
}
.hp-decision-when li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.55em;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.55;
}
.hp-decision-archive { border-top-color: #7d9bc1; }
.hp-decision-archive .hp-decision-icon,
.hp-decision-archive .hp-decision-word { color: #a8c3e3; }
.hp-decision-remediate { border-top-color: #f0a92a; }
.hp-decision-remediate .hp-decision-icon,
.hp-decision-remediate .hp-decision-word { color: #f0a92a; }
.hp-decision-asis { border-top-color: #3fb950; }
.hp-decision-asis .hp-decision-icon,
.hp-decision-asis .hp-decision-word { color: #5dd97a; }

/* ── help: "not sure?" ───────────────────────────────────────── */
.hp-unsure {
  margin: 0 0 1.6rem;
  padding: 1rem 1.2rem 1.1rem;
  background: rgba(240, 169, 42, 0.08);
  border: 1px solid rgba(240, 169, 42, 0.28);
  border-left: 4px solid #f0a92a;
  border-radius: 10px;
}
.hp-unsure-title { margin: 0 0 0.3rem; font-size: 1rem; font-weight: 800; color: #ffdca4; }
.hp-unsure-text { margin: 0; font-size: 0.96rem; line-height: 1.55; color: #c9d6e2; }
.hp-unsure-text code {
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.88rem;
  padding: 0.08rem 0.36rem;
  border-radius: 5px;
  background: #0d1117;
  border: 1px solid #30363d;
  color: #f0a92a;
}

/* ── help: example grid ──────────────────────────────────────── */
.hp-grid-wrap { margin: 0 0 1.6rem; }
.hp-grid-cap { margin: 0 0 0.6rem; font-size: 0.88rem; color: #8b949e; }
.hp-grid-scroll { overflow-x: auto; border: 1px solid #30363d; border-radius: 10px; background: #0d1117; }
.hp-grid { border-collapse: collapse; width: 100%; min-width: 720px; }
.hp-grid th, .hp-grid td {
  padding: 0.6rem 0.8rem;
  text-align: left;
  border-bottom: 1px solid #21262d;
  border-right: 1px solid #21262d;
  vertical-align: top;
}
.hp-grid th:last-child, .hp-grid td:last-child { border-right: 0; }
.hp-grid tbody tr:last-child td { border-bottom: 0; }
.hp-grid thead th {
  background: #161b22;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #a9b8c6;
  white-space: nowrap;
}
.hp-grid thead th em { font-style: normal; color: #f0a92a; font-weight: 700; }
.hp-grid-th-note { background: rgba(240, 169, 42, 0.1) !important; }
.hp-grid-col {
  display: inline-block;
  margin-right: 0.3rem;
  padding: 0.02rem 0.3rem;
  border-radius: 4px;
  background: #21262d;
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.7rem;
  color: #8b949e;
}
.hp-grid-file, .hp-grid-page {
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.8rem;
  color: #c0cdda;
  overflow-wrap: anywhere;
}
.hp-grid-page { color: #8b949e; }
.hp-grid-score { font-size: 0.95rem; font-weight: 700; color: #e5e5e5; }
.hp-grid-note { background: rgba(240, 169, 42, 0.06); }
.hp-grid-typed {
  display: block;
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.95rem;
  font-weight: 700;
  color: #e5e5e5;
}
.hp-grid-note-archive .hp-grid-typed { color: #a8c3e3; }
.hp-grid-note-remediate .hp-grid-typed { color: #f0a92a; }
.hp-grid-note-asis .hp-grid-typed { color: #5dd97a; }
.hp-grid-why { display: block; margin-top: 0.2rem; font-size: 0.82rem; color: #8b949e; }

/* ── help: hand-back ─────────────────────────────────────────── */
/* The address is set in monospace at the size of the sentence around it:
   it has to survive being read off a screen and typed into Outlook by
   hand, so the characters need to be unambiguous. */
.hp-handback-address {
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.95em;
  overflow-wrap: anywhere;
}

/* ── help: shared note panel ─────────────────────────────────── */
.hp-note {
  margin: 1.3rem 0 0;
  padding: 0.95rem 1.15rem;
  background: #12181f;
  border: 1px solid #21262d;
  border-radius: 10px;
}
.hp-note p { margin: 0; font-size: 0.94rem; line-height: 1.6; color: #a9b8c6; }
.hp-note strong { color: #e5e5e5; }
.hp-note code {
  font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.88rem;
  color: #c0cdda;
}

/* ── help: how this differs from SiteImprove ─────────────────── */
/* Blue register — this is orientation, not a warning and not an action. */
.hp-vs { margin: 0 0 2.6rem; padding-top: 2.4rem; border-top: 1px solid #21262d; }
.hp-vs-heading {
  margin: 0 0 0.4rem;
  font-size: clamp(1.6rem, 3vw, 2.05rem);
  font-weight: 900;
  letter-spacing: -0.025em;
  color: #ffffff;
}
.hp-vs-lede { margin: 0 0 1.5rem; max-width: 74ch; font-size: 1.04rem; line-height: 1.6; color: #c0cdda; }
.hp-vs-lede strong { color: #e5e5e5; }
.hp-vs-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.9rem; }
/* An odd number of rows leaves the last one stranded in half a grid; let
   it run full width so the block ends squarely. */
.hp-vs-row:last-child:nth-child(odd) { grid-column: 1 / -1; }
@media (max-width: 840px) { .hp-vs-grid { grid-template-columns: 1fr; } }
.hp-vs-row {
  padding: 1.1rem 1.25rem 1.2rem;
  background: #161b22;
  border: 1px solid #21262d;
  border-left: 3px solid #4dabf7;
  border-radius: 10px;
}
.hp-vs-q {
  margin: 0 0 0.5rem;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #7cc4fb;
}
.hp-vs-us { margin: 0 0 0.6rem; font-size: 1rem; line-height: 1.55; color: #e5e5e5; }
.hp-vs-us strong { color: #ffffff; }
.hp-vs-note { margin: 0; font-size: 0.92rem; line-height: 1.55; color: #8b98a8; }
.hp-vs-foot {
  margin: 1.2rem 0 0;
  padding: 0.95rem 1.15rem;
  max-width: 82ch;
  background: #12181f;
  border: 1px solid #21262d;
  border-radius: 10px;
  font-size: 0.95rem;
  line-height: 1.6;
  color: #a9b8c6;
}

/* ── help: troubleshooting ───────────────────────────────────── */
/* Flat by design — see renderFaq(). Two columns so twelve answers stay
   scannable without any of them being hidden behind a click. */
.hp-faqs { margin: 0 0 2.6rem; padding-top: 2.4rem; border-top: 1px solid #21262d; }
.hp-faq-heading {
  margin: 0 0 0.4rem;
  font-size: clamp(1.6rem, 3vw, 2.05rem);
  font-weight: 900;
  letter-spacing: -0.025em;
  color: #ffffff;
}
.hp-faq-lede { margin: 0 0 1.5rem; font-size: 1.04rem; color: #8b949e; }
.hp-faq-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.9rem; }
@media (max-width: 840px) { .hp-faq-grid { grid-template-columns: 1fr; } }
.hp-faq-item {
  padding: 1rem 1.2rem 1.1rem;
  border: 1px solid #21262d;
  border-left: 3px solid #3a4553;
  border-radius: 10px;
  background: #161b22;
}
.hp-faq-q { margin: 0 0 0.4rem; font-size: 1.02rem; font-weight: 800; color: #ffffff; line-height: 1.35; }
.hp-faq-a { margin: 0; font-size: 0.97rem; line-height: 1.65; color: #a9b8c6; }

/* ── help: closing ───────────────────────────────────────────── */
.hp-closing { margin: 0 0 1rem; padding-top: 2rem; border-top: 1px solid #21262d; }
.hp-closing-title { margin: 0 0 0.4rem; font-size: 1.25rem; font-weight: 800; color: #ffffff; }
.hp-closing-text { margin: 0 0 0.9rem; font-size: 1rem; color: #c0cdda; }
.hp-closing-links { margin: 0; font-size: 0.92rem; color: #8b98a8; }

/* ── help: home-page callout ─────────────────────────────────── */
/* v1.61.4 — scaled up to read as an infographic band rather than a notice
   strip. The compass sits on its own tinted plate at the size of the
   hero's donut, and HELP is set as a real label, not a caption: those two
   are what a reader scanning the page actually lands on. */
.hp-callout {
  display: flex;
  align-items: center;
  gap: 1.6rem;
  margin: 0 0 1.8rem;
  padding: 1.6rem 1.8rem;
  background: linear-gradient(90deg, rgba(240, 169, 42, 0.16) 0%, rgba(240, 169, 42, 0.05) 60%, rgba(240, 169, 42, 0) 100%);
  border: 1px solid rgba(240, 169, 42, 0.35);
  border-left: 6px solid #f0a92a;
  border-radius: 14px;
  text-decoration: none !important;
  transition: transform 120ms ease, border-color 120ms ease;
}
.hp-callout:hover { transform: translateY(-1px); border-color: rgba(240, 169, 42, 0.6); }
.hp-callout:focus-visible { outline: 3px solid #f0a92a; outline-offset: 2px; }
.hp-callout-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 76px;
  height: 76px;
  border-radius: 50%;
  background: rgba(240, 169, 42, 0.14);
  border: 1px solid rgba(240, 169, 42, 0.45);
  color: #f0a92a;
}
.hp-callout-icon svg { width: 42px; height: 42px; }
.hp-callout-body { min-width: 0; }
.hp-callout-eyebrow {
  display: block;
  margin: 0 0 0.3rem;
  font-size: 1.05rem;
  font-weight: 900;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  line-height: 1;
  color: #f0a92a;
}
.hp-callout-title {
  display: block;
  font-size: clamp(1.25rem, 2.2vw, 1.65rem);
  font-weight: 900;
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: #ffffff;
}
.hp-callout-text { display: block; margin-top: 0.4rem; max-width: 78ch; font-size: 1rem; line-height: 1.5; color: #c0cdda; }
.hp-callout-go { flex: none; margin-left: auto; color: #f0a92a; font-size: 2rem; font-weight: 800; line-height: 1; }
@media (max-width: 760px) {
  .hp-callout { gap: 1.1rem; padding: 1.2rem 1.25rem; }
  .hp-callout-icon { width: 56px; height: 56px; }
  .hp-callout-icon svg { width: 30px; height: 30px; }
  .hp-callout-eyebrow { font-size: 0.9rem; letter-spacing: 0.16em; }
  .hp-callout-go { display: none; }
}

/* ── help: print ─────────────────────────────────────────────── */
@media print {
  .hp-rail, .hp-callout { display: none; }
  .hp-step { break-inside: avoid; border-top: 1px solid #ccc; }
  .hp-decision { break-inside: avoid; border: 1px solid #ccc; }
  .hp-judge-card { break-inside: avoid; }
  .hp-faq-item { break-inside: avoid; }
  .hp-vs-row { break-inside: avoid; }
}

@media (prefers-reduced-motion: reduce) {
  .hp-callout { transition: none; }
  .hp-callout:hover { transform: none; }
}
`;
}

/**
 * The home-page Help callout, rendered by index-page.js at the top of
 * <main> where a first-time reader lands.
 *
 * Phrased as an offer, not an instruction. An earlier version led with
 * "Start here", which read as a gate the reader had to pass through
 * before using the rest of the site. The guide is optional, and the last
 * sentence says so outright.
 *
 * @returns {string}
 */
export function renderHelpCallout() {
  return `<a class="hp-callout" href="help.html">
  <span class="hp-callout-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><path d="M10.6 5.4 6.2 6.9 4.7 11.3l4.4-1.5z"/></svg></span>
  <span class="hp-callout-body">
    <span class="hp-callout-eyebrow">Help</span>
    <span class="hp-callout-title">Confused about where to start? Follow this guide.</span>
    <span class="hp-callout-text">It walks through finding your website, downloading its spreadsheet, and deciding what happens to each file. Five steps, about ten minutes. Nothing on the rest of this site depends on reading it.</span>
  </span>
  <span class="hp-callout-go" aria-hidden="true">&rarr;</span>
</a>`;
}
