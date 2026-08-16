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

  it("leads with the 2026-08-15 scoring-rubric entry", () => {
    expect(WHATS_NEW[0].id).toContain("2026-08-15");
    expect(WHATS_NEW[0].text).toMatch(/rubric|scoring|re-scored/i);
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
    let lastIdx = -1;
    for (const e of WHATS_NEW) {
      const idx = html.indexOf(e.date);
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
