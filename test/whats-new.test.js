import { describe, it, expect } from "vitest";
import { WHATS_NEW, renderWhatsNewBanner, generateWhatsNewHtml } from "../src/web/whats-new.js";

// v1.44.0 — the What's New system, mirroring the file-accessibility-audit
// repo's announcements pattern: a config array (newest first, PREPEND to
// publish), a dismissible landing-page banner showing only entry[0], and a
// reverse-chron archive page that keeps every banner reachable after
// dismissal.

describe("WHATS_NEW data", () => {
  it("has at least one entry, each with id, badge, text, and date", () => {
    expect(WHATS_NEW.length).toBeGreaterThan(0);
    for (const e of WHATS_NEW) {
      expect(e.id).toMatch(/^[a-z0-9-]+$/);
      expect(e.badge.length).toBeGreaterThan(0);
      expect(e.text.length).toBeGreaterThan(20);
      expect(e.date.length).toBeGreaterThan(0);
    }
  });

  it("has unique ids (dismissal is stored per id)", () => {
    const ids = WHATS_NEW.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // v1.62.0 — newest entry announces the density/skimmability pass, and is
  // the first to carry a banner `summary` (the banner itself was one of the
  // density findings: ~200 words of wall-of-text at the top of the page).
  it("leads with the 2026-08-19 easier-to-skim entry, with a short banner summary", () => {
    const e = WHATS_NEW[0];
    expect(e.id).toContain("easier-to-skim");
    expect(e.badge).toBe("Improved");
    expect(e.summary.length).toBeGreaterThan(0);
    // "At most two sentences" is the rule; ~350 chars is the tripwire.
    expect(e.summary.length).toBeLessThan(350);
    expect(e.text.length).toBeGreaterThan(e.summary.length);
  });

  it("the banner renders the summary, not the full text, with a read-more link", () => {
    const banner = renderWhatsNewBanner();
    // Compare escaped-safe fragments (the renderer HTML-escapes apostrophes).
    expect(banner).toContain("This site is now easier to skim");
    expect(banner).toContain("less scrolling to reach them");
    expect(banner).not.toContain("A reader told us the site had grown dense");
    expect(banner).toContain(">Read the full update</a>");
  });

  // v1.61.0 — the /help launch entry, now history.
  it("keeps the 2026-08-19 start-here entry linking the guide", () => {
    const e = WHATS_NEW.find((x) => x.id.includes("start-here"));
    expect(e).toBeTruthy();
    expect(e.badge).toBe("New");
    expect(e.linkHref).toBe("help.html");
    expect(e.linkText.length).toBeGreaterThan(0);
  });

  // v1.56.0 — the website-vs-files scope lockups (no counts in it, so
  // nothing to reconcile against the surfaces). v1.56.1 — the entry
  // carries NO trailing link: it announced a passive visual improvement,
  // and "Open the site reports" just went to /sites. Now history.
  it("keeps the 2026-08-18 website-vs-files distinction entry, link-free", () => {
    const e = WHATS_NEW.find((x) => x.id.includes("website-vs-files"));
    expect(e).toBeTruthy();
    expect(e.id).toContain("2026-08-18");
    expect(e.badge).toBe("Improved");
    expect(e.linkHref).toBeUndefined();
    expect(e.linkText).toBeUndefined();
  });

  // v1.55.0 — downloads + pagination usability pass, now history.
  it("keeps the 2026-08-17 easier-downloads-and-paging entry as history", () => {
    const e = WHATS_NEW.find((x) => x.id.includes("download-and-paging"));
    expect(e).toBeTruthy();
    expect(e.id).toContain("2026-08-17");
    expect(e.badge).toBe("Improved");
  });

  // v1.54.0 — office-scoring scope-change entry, now history. Its counts were
  // reconciled against the built bundle before publishing: 3,843 scored
  // documents (scores-by-site TOTAL row), 3,180 prior scored PDFs, 61→63
  // fleet average, and 752 legacy files (per-card clauses sum to the workbook
  // TOTAL exactly). The v1.44.1 rule: every number on a banner must agree
  // with the surfaces it sits above.
  it("keeps the 2026-08-17 office-scoring scope-change entry as history", () => {
    const e = WHATS_NEW.find((x) => x.id.includes("office-files-scored"));
    expect(e).toBeTruthy();
    expect(e.id).toContain("2026-08-17");
    expect(e.linkHref).toBe("search.html");
    expect(e.badge).toBe("Scope change");
    expect(e.text).toContain("3,843");
    expect(e.text).toContain("3,180");
    expect(e.text).toContain("752");
    expect(e.text).toContain("from 61 to 63");
    expect(e.text).toContain("not remediation");
  });

  // v1.52.0 — the numbering + purple-report entry, now history.
  it("keeps the 2026-08-17 numbering + purple-report entry as history", () => {
    const e = WHATS_NEW.find((x) => x.id.includes("numbered"));
    expect(e).toBeTruthy();
    expect(e.linkHref).toBe("search.html");
  });

  // v1.51.0 — the custom-reports launch entry, now history.
  it("keeps the 2026-08-17 custom-report entry as history", () => {
    const e = WHATS_NEW.find((x) => x.id.includes("custom-search-reports"));
    expect(e).toBeTruthy();
    expect(e.linkHref).toBe("search.html");
  });

  // v1.46.0/v1.47.1 — the search-page entry, now history. Its totals were
  // reconciled against the hero when it led (8,762 / 4,628, with the
  // system-file exclusion stated as an explicit before→after); the archive
  // page still shows them, so they must keep adding up.
  it("keeps the reconciled 2026-08-16 search-page entry as history", () => {
    const e = WHATS_NEW.find((x) => x.id.includes("file-search"));
    expect(e).toBeTruthy();
    expect(e.linkHref).toBe("search.html");
    expect(e.text).toContain("8,762");
    expect(e.text).toContain("4,628");
    expect(e.text).toMatch(/from 8,787 to 8,762/);
  });

  // v1.45.1 — the archive's-return entry, with the post-archive fleet
  // numbers reconciled the same way the rubric entry had to be (v1.44.1
  // lesson: every count on the banner must add up against the hero it sits
  // above). Now history, second in the list.
  it("keeps the reconciled 2026-08-16 archive-scope entry as history", () => {
    const e = WHATS_NEW.find((x) => x.id.includes("archive"));
    expect(e).toBeTruthy();
    expect(e.id).toContain("2026-08-16");
    expect(e.text).toContain("4,628");
    expect(e.text).toContain("3,180");
    // v1.47.1 — the entry's totals were re-reconciled after the same-day
    // system-file cleanup (8,787 → 8,762): every number a manager can see
    // must match the hero, exception language included.
    expect(e.text).toContain("8,762");
    expect(e.text).not.toContain("8,787");
    expect(e.text).toMatch(/69 to 54/);
  });

  // v1.44.1 — the rubric entry must keep reconciling its (as-of-Aug-15)
  // counts; it is now history, second in the list.
  it("keeps the reconciled 2026-08-15 scoring-rubric entry as history", () => {
    const e = WHATS_NEW.find((x) => x.id.includes("scoring-rubric"));
    expect(e).toBeTruthy();
    expect(e.text).toContain("1,971 scoreable PDFs");
    expect(e.text).toContain("3,199");
    expect(e.text).not.toMatch(/1,971 files/);
    expect(e.id).not.toBe("file-scoring-rubric-update-2026-08-15");
  });
});

describe("renderWhatsNewBanner", () => {
  const banner = renderWhatsNewBanner();

  it("renders only the newest entry, tagged with its id for dismissal", () => {
    expect(banner).toContain(`data-announcement-id="${WHATS_NEW[0].id}"`);
    expect(banner).toContain(WHATS_NEW[0].badge);
    if (WHATS_NEW.length > 1) {
      expect(banner).not.toContain(WHATS_NEW[1].date + " ·");
    }
  });

  // v1.47.0 — the banner names itself so visitors know what they're
  // looking at before they read the update.
  it("carries a 'What's New' heading and names the region", () => {
    expect(banner).toContain('class="whats-new-heading"');
    expect(banner).toContain(`whats-new-heading">What's New<`);
    expect(banner).toContain(`aria-label="What's New"`);
  });

  it("links to the archive page and carries a dismiss button", () => {
    expect(banner).toContain('href="whats-new.html"');
    expect(banner).toContain("See all updates");
    expect(banner).toMatch(/<button[^>]*aria-label="Dismiss announcement"/);
  });

  it("persists dismissal per id in localStorage", () => {
    expect(banner).toContain("fleet-audit:dismissed-whats-new");
    expect(banner).toContain("localStorage");
  });
});

describe("generateWhatsNewHtml", () => {
  const html = generateWhatsNewHtml({ generatedAt: "Aug 16, 2026" });

  it("lists every entry newest-first with badge and date", () => {
    // Search from just past the previous hit so entries that legitimately
    // share a date (two releases on 2026-08-16) each match their own
    // occurrence.
    let lastIdx = -1;
    for (const e of WHATS_NEW) {
      const idx = html.indexOf(e.date, lastIdx + 1);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
      expect(html).toContain(e.badge);
    }
  });

  it("marks only the newest entry as current", () => {
    expect(html.match(/class="whats-new-current"/g)?.length ?? 0).toBe(1);
    expect(html).toContain("&middot; current");
  });

  it("is a full page: title, noindex, footer, and a way back to the fleet index", () => {
    expect(html).toMatch(/<title>[^<]*What/i);
    expect(html).toContain('content="noindex, nofollow"');
    expect(html).toContain('class="site-footer"');
    expect(html).toContain('href="index.html"');
  });

  it("explains that the home-page banner shows only the latest update", () => {
    expect(html).toMatch(/banner[^<]*most recent|most recent[^<]*banner/i);
  });
});
