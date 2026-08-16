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

  // v1.46.0 — newest entry announces the fleet-wide /search page. No counts
  // on this banner, so nothing to reconcile against the hero (the v1.44.1
  // lesson); it links straight to the page it announces.
  it("leads with the 2026-08-16 search-page entry", () => {
    const e = WHATS_NEW[0];
    expect(e.id).toContain("search");
    expect(e.id).toContain("2026-08-16");
    expect(e.linkHref).toBe("search.html");
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
    expect(e.text).toContain("8,787");
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
