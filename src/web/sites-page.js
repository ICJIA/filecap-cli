// v1.21.0 — the /sites roster page. A manager-facing directory that answers
// "never mind the PDFs — how many sites do we have, and what are they?" It
// lists every registered Content site (the audited fleet) and every Tooling
// site (agency web apps), each as an og:image card with title, URL, and a
// one-line description. No per-file/per-page audit numbers live here — those
// stay on the fleet snapshot (index.html).
//
// The page reuses index-page.js's exact stylesheet (INDEX_CSS) and shared card
// renderers so it never drifts from the home page visually.

import { INDEX_CSS } from "./index-css.js";
import {
  he,
  displayUrl,
  renderTechDetails,
  renderCardImage,
  renderToolCard,
  renderStatusDot,
  ICJIA_LOGO_SVG,
} from "./index-page.js";

// /sites relabels the access chip with the access KIND (Strapi / GitHub /
// Server) — more useful on a directory than the home page's generic "For bulk
// file access" wording. Colors match the home page's per-kind chip accents.
const ACCESS_KIND_LABEL = { strapi: "Strapi CMS", github: "GitHub", server: "Server" };
const ACCESS_KIND_COLOR = { strapi: "#4dabf7", github: "#a78bfa", server: "#f0883e" };

function nameKey(o) {
  return (o.siteFullName || o.siteName || o.name || "").toLowerCase();
}

/**
 * A single Content-site roster card: og:image (or ICJIA-logo fallback), title,
 * URL, description, and the collapsed "Technical details" disclosure. No audit
 * numbers. The whole card links to the live site (new tab).
 *
 * @param {object} entry - { site, header, accessKind, image, description }
 */
function renderRosterCard(entry) {
  const site = entry.site;
  const nickname = he(site.siteName ?? site.name ?? "");
  const fullName = he(site.siteFullName || site.siteName || site.name || "");
  const url = site.siteUrl ?? site.publicUrlBase ?? entry.header?.metadata?.publicUrlBase ?? "";
  const desc = entry.description ?? "";
  const accessKind = entry.accessKind && ACCESS_KIND_LABEL[entry.accessKind] ? entry.accessKind : null;
  return `<article class="site-card roster-card">
  <a class="card-stretched-link" href="${he(url)}" target="_blank" rel="noopener noreferrer" aria-label="Visit ${fullName} (opens in a new tab)"></a>
  ${renderStatusDot(entry.status)}
  ${renderCardImage({ image: entry.image, alt: fullName })}
  <header class="card-head">
    ${accessKind ? `<span class="access-chip access-${accessKind}" title="${he(ACCESS_KIND_LABEL[accessKind])}"><span class="access-dot" aria-hidden="true"></span>${he(ACCESS_KIND_LABEL[accessKind])}</span>` : ""}
    ${nickname ? `<p class="nickname">${nickname}</p>` : ""}
    <h3 class="full-name">${fullName}</h3>
    ${url ? `<p class="site-url"><a href="${he(url)}" target="_blank" rel="noopener noreferrer">${he(displayUrl(url))}</a></p>` : ""}
  </header>
  ${desc ? `<p class="card-desc">${he(desc)}</p>` : ""}
  ${renderTechDetails({ site, header: entry.header })}
</article>`;
}

function renderBreakdown(content) {
  const counts = { strapi: 0, github: 0, server: 0 };
  for (const e of content) {
    if (counts[e.accessKind] !== undefined) counts[e.accessKind]++;
  }
  const parts = Object.keys(counts)
    .filter((k) => counts[k] > 0)
    .map((k) => `<span class="grp"><span class="dot" style="background:${ACCESS_KIND_COLOR[k]}"></span>${he(String(counts[k]))} ${he(ACCESS_KIND_LABEL[k])}</span>`);
  return parts.join(" ");
}

const DOWNLOAD_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8"/><path d="M4.5 7.5 8 11l3.5-3.5"/><path d="M2.5 13h11"/></svg>';
const HOME_ICON = '<svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 7.5 8 2.5l5.5 5"/><path d="M4 7v6h8V7"/></svg>';

// Minimal clipboard handler for the tech-details copy buttons (.meta-copy).
// Self-contained so /sites doesn't depend on the home page's larger script
// block. Mirrors that handler's behaviour (async clipboard + execCommand
// fallback + a 1.4s "Copied" flash via the .copied class).
const CLIPBOARD_SCRIPT = `<script>
(function () {
  "use strict";
  function flash(btn) {
    btn.classList.add("copied");
    if (btn._t) clearTimeout(btn._t);
    btn._t = setTimeout(function () { btn.classList.remove("copied"); btn._t = null; }, 1400);
  }
  function fallback(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.top = "-1000px"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  document.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest(".meta-copy") : null;
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    var text = btn.getAttribute("data-copy");
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash(btn); }).catch(function () { if (fallback(text)) flash(btn); });
    } else if (fallback(text)) { flash(btn); }
  });
})();
</script>`;

/**
 * Generate the /sites roster page HTML.
 *
 * @param {object} args
 * @param {Array}  args.contentRoster - [{ site, header, accessKind, image, description }, …]
 *   for every registered (filtered) site, scanned or not.
 * @param {Array}  args.tools         - enriched tools[] entries ({ …tool, image, description }).
 * @param {string|null} args.sitesListXlsx - filename of the roster workbook, or null.
 * @param {string} args.title         - page <title>.
 * @param {string} args.generatedAt   - preformatted "generated at" string (optional).
 * @returns {string} full HTML document
 */
export function generateSitesHtml({
  contentRoster = [],
  tools = [],
  sitesListXlsx = null,
  title = "ICJIA site directory",
  generatedAt = "",
} = {}) {
  const content = [...contentRoster].sort((a, b) => nameKey(a.site).localeCompare(nameKey(b.site), undefined, { sensitivity: "base" }));
  const toolList = [...tools].sort((a, b) => nameKey(a).localeCompare(nameKey(b), undefined, { sensitivity: "base" }));
  const total = content.length + toolList.length;

  const contentCards = content.map((e) => renderRosterCard(e)).join("\n");
  const toolCards = toolList.map((t) => renderToolCard(t, { showStatus: true })).join("\n");
  const breakdown = renderBreakdown(content);

  const downloadHtml = sitesListXlsx
    ? `<div class="roster-download">
      <a class="roster-download-btn" href="${he(sitesListXlsx)}" download>${DOWNLOAD_ICON}<span>Download sites list (.xlsx)</span></a>
      <p class="roster-download-note">One workbook · Content sites + Tooling sites tabs · names, descriptions &amp; URLs</p>
    </div>`
    : "";

  const toolingSection = toolList.length
    ? `
  <div class="fleet-section-banner" role="presentation">
    <p class="fleet-section-eyebrow">Section · Tooling sites</p>
    <h2 class="fleet-section-headline">Tooling sites</h2>
    <p class="fleet-section-lede">Active ICJIA web apps — utilities with no document files to audit. ${he(String(toolList.length))} tool${toolList.length !== 1 ? "s" : ""}.</p>
  </div>
  <section class="tooling-section" aria-label="Tooling sites">
    <div class="site-grid">
${toolCards}
    </div>
  </section>`
    : "";

  const pageTitle = he(title);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${pageTitle}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%230d1117'/><path d='M12 9L12 23L23 16Z' fill='%23ffb000'/></svg>">
<style>${INDEX_CSS}</style>
</head>
<body id="top">

<header class="site-header">
  <div class="site-header-left">
    <a class="icjia-logo" href="index.html" aria-label="filecap fleet audit home" title="Back to the fleet snapshot">${ICJIA_LOGO_SVG}</a>
    <span class="brand"><span>filecap</span> site directory</span>
  </div>
  <div class="site-header-right">
    <a class="audit-tool-link nav-sites" href="index.html" title="Back to the fleet snapshot (home)">
      ${HOME_ICON}
      <span>Home</span>
    </a>
    <a class="audit-tool-link" href="https://accessibility.icjia.app" target="_blank" rel="noopener noreferrer" title="ICJIA accessibility FAQs (accessibility.icjia.app, opens in a new tab)">
      <svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="8" cy="8" r="6.5"/>
        <path d="M6 6.2a2 2 0 1 1 2.6 1.9c-0.5 0.2-0.6 0.5-0.6 0.9"/>
        <circle cx="8" cy="11.2" r="0.55" fill="currentColor"/>
      </svg>
      <span>ICJIA Accessibility FAQs</span>
    </a>
    <a class="audit-tool-link" href="https://audit.icjia.app" target="_blank" rel="noopener noreferrer" title="ICJIA PDF Audit Tool (audit.icjia.app, opens in a new tab)">
      <svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 3h-2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2"/>
        <path d="M9 2h5v5"/>
        <path d="M8 8l6-6"/>
      </svg>
      <span>ICJIA PDF Audit Tool</span>
    </a>
  </div>
</header>

<main>

  <div class="fleet-section-banner" role="presentation">
    <p class="fleet-section-eyebrow">ICJIA site directory</p>
    <h1 class="fleet-section-headline">All registered sites</h1>
    <p class="fleet-section-lede">Every site ICJIA runs — content sites under accessibility audit, plus the agency's tooling apps. Titles, live URLs, and technical details; the file and page counts live on the <a href="index.html">fleet snapshot</a>.${generatedAt ? ` Generated <time>${he(generatedAt)}</time>.` : ""}</p>
  </div>

  <section class="hero roster-hero">
    <div class="roster-stats">
      <div class="roster-stat"><span class="n">${he(String(content.length))}</span><span class="l">content site${content.length !== 1 ? "s" : ""}</span></div>
      <div class="roster-stat"><span class="n">${he(String(toolList.length))}</span><span class="l">tooling site${toolList.length !== 1 ? "s" : ""}</span></div>
      <div class="roster-stat"><span class="n">${he(String(total))}</span><span class="l">total</span></div>
    </div>
    ${breakdown ? `<p class="roster-breakdown">${breakdown}</p>` : ""}
    ${downloadHtml}
  </section>

  <div class="fleet-section-banner" role="presentation">
    <p class="fleet-section-eyebrow">Section · Content sites</p>
    <h2 class="fleet-section-headline">Content sites</h2>
    <p class="fleet-section-lede">The ${he(String(content.length))} ICJIA website${content.length !== 1 ? "s" : ""} under accessibility audit. File and page counts live on the <a href="index.html">fleet snapshot</a>.</p>
  </div>
  <section class="content-sites" aria-label="Content sites">
    <div class="site-grid">
${contentCards}
    </div>
  </section>
${toolingSection}
</main>

<footer class="site-footer">
  <span>Generated by filecap. For questions, contact the audit administrator.</span>
  ${generatedAt ? `<span>Generated ${he(generatedAt)}</span>` : ""}
  <span class="site-footer-links">
    <a href="index.html">Home</a>
    <span aria-hidden="true">&middot;</span>
    <a href="accessibility.html">Accessibility</a>
    <span aria-hidden="true">&middot;</span>
    <a href="https://github.com/ICJIA/filecap-cli" target="_blank" rel="noopener noreferrer">filecap on GitHub</a>
    <span aria-hidden="true">&middot;</span>
    <a href="https://github.com/ICJIA/filecap-cli/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">CHANGELOG</a>
  </span>
</footer>

${CLIPBOARD_SCRIPT}
</body>
</html>`;
}
