import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateHelpHtml,
  renderHelpCallout,
  helpCss,
  HELP_SCREENSHOTS,
  HANDBACK,
} from "../src/web/help-page.js";
import { helpNavLink, helpNavCss } from "../src/web/help-nav.js";
import { XLSX_COLUMN_ORDER } from "../src/report/xlsx.js";
import { CSV_COLUMNS } from "../src/report/csv.js";
import { generateIndexHtml } from "../src/web/index-page.js";
import { generateSitesHtml } from "../src/web/sites-page.js";
import { generateWhatsNewHtml } from "../src/web/whats-new.js";
import { generateSearchHtml } from "../src/web/search-page.js";
import { renderSiteFooter } from "../src/web/site-footer.js";

// v1.61.0 — /help, the start-here walkthrough. The page teaches one
// journey: find your site, download its spreadsheet, open the two link
// columns to judge each file, send it back. These tests pin the parts that
// would break the instructions silently — the column letters it names, the
// file names it embeds, and its three promises: a stepper, nothing
// collapsible, and deciding framed as a judgement rather than data entry.

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = generateHelpHtml({ generatedAt: "2026-08-19 06:00 AM CDT (Chicago time)" });

describe("help page — structure", () => {
  it("is a complete document with the shared chrome", () => {
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toMatch(/<a class="skip-link" href="#main">Skip to content<\/a>/);
    expect(html).toMatch(/<main id="main">/);
    expect(html).toContain("<title>Help");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain("2026-08-19 06:00 AM CDT (Chicago time)");
  });

  // The reader is doing five things in order; the page says so in markup,
  // not just in styling, so the sequence survives with CSS off.
  it("renders the five steps as one ordered list", () => {
    expect(html).toContain('<ol class="hp-stepper">');
    const steps = html.match(/<li class="hp-step" id="step-\d">/g) ?? [];
    expect(steps).toHaveLength(5);
    for (let n = 1; n <= 5; n += 1) {
      expect(html).toContain(`<li class="hp-step" id="step-${n}">`);
      expect(html).toContain(`Step ${n} of 5`);
    }
  });

  // Every step is reachable from the summary rail at the top.
  it("links each rail chip to its step anchor", () => {
    for (let n = 1; n <= 5; n += 1) {
      expect(html).toContain(`href="#step-${n}"`);
    }
  });

  // The page exists because readers could not find an answer. An answer
  // behind a disclosure triangle is an answer most of them never open.
  it("contains nothing collapsible", () => {
    expect(html).not.toMatch(/<details/);
    expect(html).not.toMatch(/<summary/);
  });

  it("names the three decision words at headline scale", () => {
    for (const word of ["archive", "remediate", "as-is"]) {
      expect(html).toContain(`<h3 class="hp-decision-word">${word}</h3>`);
    }
  });

  // Colour is reinforcement, never the only carrier: each decision card
  // also has its own icon and its own prose test.
  it("gives every decision card an icon and a 'choose it when' list", () => {
    const cards = html.match(/<article class="hp-decision hp-decision-\w+">/g) ?? [];
    expect(cards).toHaveLength(3);
    expect((html.match(/<span class="hp-decision-icon"/g) ?? []).length).toBe(3);
    expect((html.match(/Choose it when/g) ?? []).length).toBe(3);
  });
});

describe("help page — the column map tracks the real workbook", () => {
  // The page tells readers "Notes is column T". If XLSX_COLUMN_ORDER ever
  // changes, that sentence becomes a wrong instruction, so the letters are
  // derived from the workbook here and compared.
  const letterFor = (name) => {
    const i = XLSX_COLUMN_ORDER.indexOf(name);
    expect(i, `${name} is in XLSX_COLUMN_ORDER`).toBeGreaterThan(-1);
    return String.fromCharCode(65 + i);
  };

  it("puts Notes where the workbook puts it", () => {
    const notes = letterFor("notes");
    expect(notes).toBe("T");
    expect(html).toContain(`Column ${notes} &mdash; Notes`);
  });

  it("puts Delete? immediately before Notes, and tells readers to skip it", () => {
    expect(letterFor("deleteFlag")).toBe("S");
    expect(html).toContain("Delete?");
    expect(html).toMatch(/Ignore the <strong>Delete\?<\/strong> column/);
  });

  it("names each read-column at its real letter", () => {
    const expected = [
      ["filename", "File name"],
      ["publicUrl", "Public URL"],
      ["referenced", "Page References"],
      ["auditScoreNum", "Score (0-100)"],
    ];
    for (const [key, label] of expected) {
      expect(html).toContain(`Column ${letterFor(key)} &mdash; ${label}`);
    }
  });

  it("uses the workbook's own column labels, not invented ones", () => {
    const labelFor = (name) => CSV_COLUMNS.find((c) => c.name === name)?.label;
    expect(labelFor("referenced")).toBe("Page References");
    expect(labelFor("notes")).toBe("Notes");
    expect(labelFor("publicUrl")).toBe("Public URL");
  });

  it("draws one strip cell per workbook column", () => {
    const cells = html.match(/<span class="hp-col hp-col-\w+"/g) ?? [];
    expect(cells).toHaveLength(XLSX_COLUMN_ORDER.length);
    expect(html).toContain("Twenty columns. You use five.");
    expect(html).toContain("you can ignore all fifteen of them");
  });
});

describe("help page — the point the audit team asked for", () => {
  // The spreadsheet's value to a non-technical reader is that it says both
  // what a file is called AND where it appears. Both must be on the page.
  it("says the spreadsheet carries file names and the pages they appear on", () => {
    expect(html).toContain("what each file is called");
    expect(html).toContain("which page it appears on");
    expect(html).toContain("The web page \u2014 or pages \u2014 this file appears on.");
  });

  it("explains the per-type tabs and the Pages tab as different views", () => {
    expect(html).toContain("One row per file");
    expect(html).toContain("One row per web page");
    expect(html).toContain("These are the tabs you fill in.");
  });

  // Nothing is fillable in the browser: the downloaded workbook is the record.
  it("keeps the workflow on the reader's own machine", () => {
    expect(html).not.toMatch(/<form/);
    expect(html).not.toMatch(/<input/);
    expect(html).not.toMatch(/<textarea/);
    expect(html).toContain("nothing you type is sent back to this website");
  });

  // The reader is asked to attach a file and send it, and many will do
  // that from Outlook rather than by clicking. The address is shown
  // literally, not hidden behind a friendly label or a styled button.
  it("shows the hand-back address in full, with no email button", () => {
    expect(html).toContain(`mailto:${HANDBACK.email}`);
    expect(html).toContain(`>${HANDBACK.email}</a>`);
    expect(html).not.toContain("hp-handback-btn");
    expect(html).not.toContain("Email the completed spreadsheet");
  });

  it("tells the reader to attach the workbook rather than paste it", () => {
    expect(html).toContain("Send the completed site audit report");
    expect(html).toContain("not a screenshot of it and not the rows pasted into the message body");
  });
});

describe("help page — deciding is the step, not typing", () => {
  // The reader cannot judge a file from its name. Step 4 leads with the two
  // clickable columns that settle it; recording the outcome is the tail end.
  it("leads step 4 with the two link columns", () => {
    expect(html).toContain('<li class="hp-step" id="step-4">');
    expect(html).toContain("Open the links and decide");
    expect(html).toContain("Two columns do the deciding for you");
    const cards = html.match(/<div class="hp-judge-card">/g) ?? [];
    expect(cards).toHaveLength(2);
  });

  it("tells the reader what each link opens", () => {
    expect(html).toContain("Click it and the file itself opens in your browser.");
    expect(html).toContain("Click it and the web page that links to the file opens.");
    expect(html).toContain("no page on your site links to it any more");
  });

  it("puts the judging block before the outcomes it feeds", () => {
    expect(html.indexOf("hp-judge-card")).toBeLessThan(html.indexOf("hp-decision-word"));
  });

  // Regression guard: the page was first written as "write one word per
  // file", which framed a judgement call as a typing exercise.
  it("never frames the task as writing a word", () => {
    for (const phrase of ["one word", "One word", "three words", "word per file"]) {
      expect(html, `page should not say "${phrase}"`).not.toContain(phrase);
    }
  });

  it("still names all three outcomes and the safe default", () => {
    expect(html).toContain("archive");
    expect(html).toContain("remediate");
    expect(html).toContain("as-is");
    expect(html).toContain("Not sure about a file?");
    expect(html).toContain("It is the safe answer");
  });
});

describe("help page — screenshots", () => {
  it("ships every screenshot it references", () => {
    expect(HELP_SCREENSHOTS.length).toBeGreaterThan(0);
    for (const file of HELP_SCREENSHOTS) {
      const onDisk = path.join(PKG_ROOT, "assets", "help", file);
      expect(fs.existsSync(onDisk), `assets/help/${file} exists in the repo`).toBe(true);
      expect(html).toContain(`src="assets/help/${file}"`);
    }
  });

  it("gives every screenshot alt text and intrinsic dimensions", () => {
    const imgs = html.match(/<img src="assets\/help\/[^>]+>/g) ?? [];
    expect(imgs).toHaveLength(HELP_SCREENSHOTS.length);
    for (const img of imgs) {
      expect(img).toMatch(/alt="[^"]{40,}"/);
      expect(img).toMatch(/width="\d+"/);
      expect(img).toMatch(/height="\d+"/);
    }
  });

  // CSP on the bundle is img-src 'self' data: — a remote screenshot host
  // would render as a broken image on the deployed site.
  it("references no remote images", () => {
    expect(html).not.toMatch(/<img[^>]+src="https?:/);
  });
});

describe("help nav link", () => {
  // Labelled "Help", never "Start here": the earlier label read as a gate
  // the reader had to pass before using the rest of the site.
  it("points at help.html and is labelled as optional help", () => {
    const link = helpNavLink();
    expect(link).toContain('href="help.html"');
    expect(link).toContain("<span>Help</span>");
    expect(link).not.toContain("Start here");
    expect(link).not.toContain('aria-current');
  });

  it("marks itself as the current page on help.html", () => {
    expect(helpNavLink({ current: true })).toContain('aria-current="page"');
    expect(html).toContain('aria-current="page"');
  });

  it("styles the current state so it cannot look like a live button", () => {
    expect(helpNavCss()).toContain(".audit-tool-link.nav-help.is-current");
  });
});

describe("help link reaches every surface", () => {
  const pages = {
    "fleet index": generateIndexHtml({ siteResults: [], password: null }),
    "site directory": generateSitesHtml({ contentRoster: [], tools: [] }),
    "what's new": generateWhatsNewHtml({}),
    search: generateSearchHtml({ totalFiles: 0, siteCount: 0, remediableFiles: 0 }),
  };

  for (const [label, page] of Object.entries(pages)) {
    it(`${label} carries the Help nav link`, () => {
      expect(page).toContain('href="help.html"');
      expect(page).toContain("<span>Help</span>");
    });

    it(`${label} ships the nav link's styles`, () => {
      expect(page).toContain(".audit-tool-link.nav-help");
    });
  }

  it("the shared footer links to help.html", () => {
    expect(renderSiteFooter()).toContain('<a href="help.html">Help</a>');
  });

  // Anything reachable from the header must be reachable from the footer —
  // that is the whole point of thinning the header down to plain links.
  it("the footer carries every header-nav destination", () => {
    const footer = renderSiteFooter();
    for (const href of [
      "index.html",
      "help.html",
      "sites.html",
      "search.html",
      "whats-new.html",
      "https://accessibility.icjia.app",
      "https://audit.icjia.app",
    ]) {
      expect(footer, `footer should link ${href}`).toContain(`href="${href}"`);
    }
  });

  it("the home page carries the help callout", () => {
    expect(pages["fleet index"]).toContain('<a class="hp-callout" href="help.html">');
    expect(pages["fleet index"]).toContain(".hp-callout");
  });
});

describe("help callout", () => {
  it("is a single link, not a nested-interactive card", () => {
    const callout = renderHelpCallout();
    expect((callout.match(/<a /g) ?? [])).toHaveLength(1);
    expect(callout).not.toMatch(/<button/);
    expect(callout).toContain('href="help.html"');
  });
});

describe("help css", () => {
  it("scopes every rule under the hp- prefix", () => {
    const selectors = helpCss().match(/^\s*\.[a-zA-Z][^{,]*/gm) ?? [];
    const leaked = selectors
      .map((sel) => sel.trim())
      .filter((sel) => !sel.startsWith(".hp-"));
    expect(leaked).toEqual([]);
  });

  it("respects reduced motion", () => {
    expect(helpCss()).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
