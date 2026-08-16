// v1.46.0 — the /search page: find a file by name fragment anywhere on the
// fleet, see which sites carry it, download the results as a workbook.
//
// The page is a static shell; everything dynamic happens client-side against
// search-index.json (emitted by web-rollup next to this page, shape
// documented in search-index.js). The matcher (search-match.js) and the
// workbook builder (search-xlsx.js) are embedded verbatim via .toString()
// — the unit-tested functions ARE the shipped ones, same pattern as
// uptime-client.js. The page fetches only same-origin resources, inside the
// bundle's connect-src 'self' CSP.

import { INDEX_CSS } from "./index-css.js";
import { renderSiteFooter, siteFooterCss } from "./site-footer.js";
import { escapeHtml as he } from "../util/html.js";
import { ICJIA_LOGO_SVG } from "./index-page.js";
import { searchMatchClientSource } from "./search-match.js";
import { searchXlsxClientSource } from "./search-xlsx.js";
import { SEARCH_INDEX_FILENAME } from "./search-index.js";

// Deployed bundle URL — used for the ABSOLUTE audit-report links inside the
// downloaded workbook (a spreadsheet opened on someone's desktop has no
// relative-URL context). Same constant as web-rollup.js's FLEET_PUBLIC_URL.
const FLEET_PUBLIC_URL = "https://icjia-fleet-audit.netlify.app";

// Human labels for the scanner's category slugs, chip + workbook order.
const CATEGORY_LABELS = {
  "pdf": "PDFs",
  "office-document": "Word (.docx)",
  "spreadsheet": "Excel (.xlsx)",
  "presentation": "PowerPoint (.pptx)",
  "legacy-office": "Legacy Office",
  "image": "Images",
  "text": "Text files",
  "archive": "Archives",
  "audio-video": "Audio / video",
  "web": "Web files",
  "other": "Other",
};

const SEARCH_CSS = `
/* ── /search page ────────────────────────────────────────────── */
.search-wrap { max-width: 1100px; margin: 0 auto; padding: 0 2rem 3rem; }
.search-box-row { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin: 1.2rem 0 0.9rem; }
#search-input {
  flex: 1 1 340px;
  font: inherit;
  font-size: 1.05rem;
  color: #e5e5e5;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 0.65rem 0.9rem;
}
#search-input:focus-visible { outline: 2px solid #58a6ff; outline-offset: 1px; border-color: #58a6ff; }
#search-input::placeholder { color: #7d8590; }
#download-xlsx {
  font: inherit;
  font-weight: 600;
  color: #0d1117;
  background: #ffb000;
  border: none;
  border-radius: 8px;
  padding: 0.65rem 1rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
#download-xlsx:hover { background: #ffc23d; }
#download-xlsx:focus-visible { outline: 2px solid #58a6ff; outline-offset: 2px; }
#download-xlsx[disabled] { background: #30363d; color: #7d8590; cursor: not-allowed; }
.search-chips { display: flex; flex-wrap: wrap; gap: 0.45rem; margin: 0.35rem 0 0.75rem; }
.search-chip {
  font: inherit;
  font-size: 0.85rem;
  color: #d4dae0;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 999px;
  padding: 0.22rem 0.75rem;
  cursor: pointer;
}
.search-chip:hover { border-color: #58a6ff; color: #e5e5e5; }
.search-chip:focus-visible { outline: 2px solid #58a6ff; outline-offset: 2px; }
.search-chip[aria-pressed="true"] { background: #ffb000; border-color: #ffb000; color: #0d1117; font-weight: 600; }
.search-chip .chip-count { opacity: 0.75; font-variant-numeric: tabular-nums; margin-left: 0.3rem; }
.search-status { color: #d4dae0; margin: 0.6rem 0 0.9rem; min-height: 1.4em; }
.search-status strong { color: #e5e5e5; }
.search-hint { color: #7d8590; font-size: 0.9rem; margin-top: 0.4rem; }
.search-table-wrap { overflow-x: auto; border: 1px solid #21262d; border-radius: 8px; }
.search-table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
.search-table th {
  text-align: left;
  font-weight: 600;
  color: #d4dae0;
  background: #161b22;
  border-bottom: 2px solid #30363d;
  padding: 0.55rem 0.75rem;
  white-space: nowrap;
  position: sticky;
  top: 0;
}
.search-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #21262d; vertical-align: top; }
.search-table tr:last-child td { border-bottom: none; }
.search-table td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.search-table .search-site { white-space: nowrap; font-weight: 600; color: #d4dae0; }
.search-table .search-file a { word-break: break-all; }
.search-cap-note { color: #7d8590; font-size: 0.88rem; margin: 0.6rem 0 0; }
.search-error { color: #f85149; margin: 1rem 0; }
.search-mark {
  background: rgba(255, 176, 0, 0.18);
  color: #ffd76a;
  font-weight: 600;
  border-radius: 3px;
  padding: 0 1px;
}
.search-suggest:empty { display: none; }
.search-suggest-chip { border-color: #ffb000; color: #ffd76a; }
.search-suggest-chip:hover { background: rgba(255, 176, 0, 0.12); border-color: #ffb000; color: #ffd76a; }
.search-table .search-file a .search-mark { text-decoration: underline; }
.search-why { color: #7d8590; font-size: 0.82rem; margin-top: 0.2rem; }
.search-sort-btn {
  font: inherit;
  font-weight: 600;
  color: #d4dae0;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  white-space: nowrap;
}
.search-sort-btn:hover { color: #58a6ff; text-decoration: underline; }
.search-sort-btn:focus-visible { outline: 2px solid #58a6ff; outline-offset: 2px; border-radius: 2px; }
.search-table th[aria-sort] .search-sort-btn { color: #ffd76a; }
.search-sort-arrow { font-size: 0.75em; }
.search-table .search-site a { color: #d4dae0; text-decoration: none; }
.search-table .search-site a:hover { color: #58a6ff; text-decoration: underline; }
@media (max-width: 700px) {
  .search-wrap { padding: 0 1rem 2rem; }
  .search-box-row { flex-direction: column; align-items: stretch; }
}
`;

/**
 * Generate the /search page HTML.
 *
 * @param {object} args
 * @param {string} args.generatedAt - preformatted "generated at" string
 * @param {number} args.totalFiles  - fleet-wide inventoried file count
 * @param {number} args.siteCount   - number of audited sites in the bundle
 * @param {number} args.remediableFiles - fleet-wide remediation-list count,
 *   quoted beside the total so the two headline numbers a manager sees
 *   (everything inventoried vs. documents needing work) reconcile in one
 *   sentence (the v1.44.1 lesson).
 * @returns {string} full HTML document
 */
export function generateSearchHtml({ generatedAt = "", totalFiles = 0, siteCount = 0, remediableFiles = 0 } = {}) {
  const totalFmt = Number(totalFiles).toLocaleString("en-US");
  const remFmt = Number(remediableFiles).toLocaleString("en-US");
  const remNoun = Number(remediableFiles) === 1 ? "document" : "documents";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="Search every file inventoried across the ICJIA web fleet by full or partial filename, see which sites carry it, and download the results as a workbook.">
<meta name="robots" content="noindex, nofollow">
<title>Search the fleet — ICJIA Fleet Audit Assessment</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%230d1117'/><path d='M12 9L12 23L23 16Z' fill='%23ffb000'/></svg>">
<style>${INDEX_CSS}${siteFooterCss()}${SEARCH_CSS}</style>
</head>
<body id="top">
<a class="skip-link" href="#main">Skip to content</a>

<header class="site-header">
  <div class="site-header-left">
    <a class="icjia-logo" href="index.html" aria-label="ICJIA Fleet Audit Assessment home" title="Back to the fleet snapshot">${ICJIA_LOGO_SVG}</a>
    <span class="brand"><span>ICJIA</span> Fleet Audit Assessment</span>
  </div>
  <div class="site-header-right">
    <a class="audit-tool-link nav-sites" href="index.html" title="Back to the fleet snapshot (home)">
      <svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 7.5 8 2.5l5.5 5"/><path d="M4 7v6h8V7"/></svg>
      <span>Home</span>
    </a>
    <a class="audit-tool-link nav-sites" href="sites.html" title="ICJIA site directory — every content + tooling site in this bundle">
      <svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>
      </svg>
      <span>Sites</span>
    </a>
    <a class="audit-tool-link" href="https://audit.icjia.app" target="_blank" rel="noopener noreferrer" title="File Audit Tool — score any PDF for accessibility (audit.icjia.app, opens in a new tab)">
      <svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 3h-2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2"/>
        <path d="M9 2h5v5"/>
        <path d="M8 8l6-6"/>
      </svg>
      <span>File Audit Tool</span>
    </a>
    <a class="audit-tool-link nav-whats-new" href="whats-new.html" title="What's New — updates and improvements to this audit site">
      <svg class="audit-tool-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 1.8 9.6 6l4.4 1.6L9.6 9.2 8 13.4 6.4 9.2 2 7.6 6.4 6z"/>
      </svg>
      <span>What's New</span>
    </a>
  </div>
</header>

<main id="main">
  <div class="fleet-section-banner" role="presentation">
    <p class="fleet-section-eyebrow">Fleet-wide file search</p>
    <h1 class="fleet-section-headline">Find a file, anywhere on the fleet</h1>
    <p class="fleet-section-lede">Search all ${totalFmt} files inventoried across ${siteCount} ICJIA websites by full or partial filename. That's every file the scan sees — images, web pages, and other reference material included — not just the ${remFmt} ${remNoun} on the remediation list. Fragments are fine — <em>dvfr report</em>, <em>annual 2023</em>, a site's name, even a near-miss spelling — and the results show every site that carries a match.${generatedAt ? ` Generated <time>${he(generatedAt)}</time>.` : ""}</p>
  </div>

  <div class="search-wrap">
    <div class="search-box-row">
      <input id="search-input" type="search" placeholder="e.g. dvfr report, annual 2023, minutes…" aria-label="Search files by full or partial filename" autocomplete="off" disabled>
      <button id="download-xlsx" type="button" disabled title="Download the current results as an Excel workbook (with links)">
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8"/><path d="m4.5 7 3.5 3.5L11.5 7"/><path d="M2.5 13.5h11"/></svg>
        Download results (.xlsx)
      </button>
    </div>
    <div id="did-you-mean" class="search-chips search-suggest" role="group" aria-label="Spelling suggestions"></div>
    <div id="category-chips" class="search-chips" role="group" aria-label="Filter results by file type"></div>
    <p id="search-status" class="search-status" aria-live="polite"></p>
    <div id="site-chips" class="search-chips" role="group" aria-label="Filter results by website"></div>
    <div id="search-results"></div>
    <p class="search-hint">Results are ordered by accessibility score, highest first — click any column heading to re-sort (files without a score always sort last). Matches look at the filename, the folder path, and the site's name — so <em>dvfr report</em> finds reports on the DVFR site even when "DVFR" isn't in the filename. The matched part of each filename is highlighted, and a note explains any match that isn't in the name itself. "View report" opens that file's shareable audit report — exactly what's wrong and how to fix it — in a new tab. Spreadsheet downloads include every matching file with the same links.</p>
  </div>
</main>

${renderSiteFooter({ generatedAt })}

<script>
${searchMatchClientSource()}
${searchXlsxClientSource()}
(function () {
  "use strict";
  var INDEX_URL = ${JSON.stringify(SEARCH_INDEX_FILENAME)};
  var PUBLIC_BASE = ${JSON.stringify(FLEET_PUBLIC_URL)};
  var CAT_LABELS = ${JSON.stringify(CATEGORY_LABELS)};
  var RENDER_CAP = 400;
  var DEBOUNCE_MS = 140;

  var input = document.getElementById("search-input");
  var statusEl = document.getElementById("search-status");
  var catChipsEl = document.getElementById("category-chips");
  var siteChipsEl = document.getElementById("site-chips");
  var resultsEl = document.getElementById("search-results");
  var downloadBtn = document.getElementById("download-xlsx");

  var data = null;
  var hays = [];
  var siteNames = [];
  var activeCat = "";
  var activeSite = -1;
  var lastFiltered = [];
  var suggestEl = document.getElementById("did-you-mean");

  // v1.49.0 — column sorting. Default: audit score, highest first. Each
  // header's first click uses its natural primary direction; a second
  // click reverses it.
  var sortKey = "score";
  var sortDir = "desc";
  var SORT_COLUMNS = [
    { key: "site", label: "Website" },
    { key: "filename", label: "Filename" },
    { key: "type", label: "Type" },
    { key: "score", label: "Score" },
    { key: "grade", label: "Grade" },
    { key: "size", label: "Size" },
    { key: "modified", label: "Modified" },
    { key: null, label: "Audit report" },
  ];
  var SORT_NATURAL_DIR = { site: "asc", filename: "asc", type: "asc", grade: "asc", score: "desc", size: "desc", modified: "desc" };

  fetch(INDEX_URL)
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (json) {
      data = json;
      hays = json.rows.map(function (row) {
        var site = json.sites[row[2]] || {};
        return buildHaystack({ filename: row[0], path: row[1], siteLabel: site.label, siteFull: site.full });
      });
      for (var sn = 0; sn < json.sites.length; sn++) {
        if (json.sites[sn].label) siteNames.push(json.sites[sn].label);
        if (json.sites[sn].full) siteNames.push(json.sites[sn].full);
      }
      input.disabled = false;
      input.focus();
      statusEl.textContent = "Type to search " + json.rows.length.toLocaleString("en-US") + " files.";
    })
    .catch(function (err) {
      statusEl.className = "search-error";
      statusEl.textContent = "The search index failed to load (" + err.message + "). Reload the page to try again.";
    });

  function catLabel(slug) { return CAT_LABELS[slug] || slug; }

  function fmtSize(bytes) {
    if (typeof bytes !== "number" || !isFinite(bytes)) return "";
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
    if (bytes >= 1024) return Math.round(bytes / 1024) + " KB";
    return bytes + " B";
  }

  // Filename with the matched fragments <mark>ed, built from text nodes —
  // never markup-injected.
  function appendHighlighted(el, raw, ranges) {
    var pos = 0;
    for (var r = 0; r < ranges.length; r++) {
      var s = ranges[r][0];
      var e = ranges[r][1];
      if (s > pos) el.appendChild(document.createTextNode(raw.slice(pos, s)));
      var m = document.createElement("mark");
      m.className = "search-mark";
      m.textContent = raw.slice(s, e);
      el.appendChild(m);
      pos = e;
    }
    if (pos < raw.length) el.appendChild(document.createTextNode(raw.slice(pos)));
  }

  // "Is it a DVFR report, or just ON DVFR?" — plain-language reason for any
  // term that did NOT land in the filename itself.
  function whyPhrase(w) {
    if (w.src === "site") return "“" + w.term + "” = the site's name";
    if (w.src === "path") return "“" + w.term + "” in the folder path";
    if (w.src === "squash") return "“" + w.term + "” matches the name with separators removed";
    if (w.src === "fuzzy") return "“" + w.term + "” ≈ “" + w.word + "”";
    return "";
  }

  // Compact per-row summary for the workbook's "Matched on" column.
  function matchedOnText(why) {
    var parts = [];
    for (var i = 0; i < why.length; i++) {
      var w = why[i];
      if (w.src === "name") parts.push(w.term + ": filename");
      else if (w.src === "site") parts.push(w.term + ": site name");
      else if (w.src === "path") parts.push(w.term + ": folder path");
      else if (w.src === "squash") parts.push(w.term + ": run-together name");
      else parts.push(w.term + ": ≈ " + w.word);
    }
    return parts.join("; ");
  }

  function chip(label, count, pressed, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "search-chip";
    b.setAttribute("aria-pressed", pressed ? "true" : "false");
    b.textContent = label;
    if (count !== null) {
      var c = document.createElement("span");
      c.className = "chip-count";
      c.textContent = count.toLocaleString("en-US");
      b.appendChild(c);
    }
    b.addEventListener("click", onClick);
    return b;
  }

  function update() {
    var q = input.value;
    var matches = data ? runSearch(hays, q) : [];
    if (!foldSearchText(q)) {
      catChipsEl.textContent = "";
      siteChipsEl.textContent = "";
      resultsEl.textContent = "";
      suggestEl.textContent = "";
      lastFiltered = [];
      downloadBtn.disabled = true;
      statusEl.className = "search-status";
      statusEl.textContent = data ? "Type to search " + data.rows.length.toLocaleString("en-US") + " files." : "";
      return;
    }

    // Facets: category counts over ALL matches; site counts after the
    // category filter, so the two chip rows compose intuitively.
    var catCounts = {};
    for (var m = 0; m < matches.length; m++) {
      var cat = data.categories[data.rows[matches[m].i][3]];
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    }
    if (activeCat && !catCounts[activeCat]) activeCat = "";
    var afterCat = matches.filter(function (mm) {
      return !activeCat || data.categories[data.rows[mm.i][3]] === activeCat;
    });
    var siteCounts = {};
    for (var s2 = 0; s2 < afterCat.length; s2++) {
      var si = data.rows[afterCat[s2].i][2];
      siteCounts[si] = (siteCounts[si] || 0) + 1;
    }
    if (activeSite >= 0 && !siteCounts[activeSite]) activeSite = -1;
    var filtered = afterCat.filter(function (mm) {
      return activeSite < 0 || data.rows[mm.i][2] === activeSite;
    });
    filtered = sortSearchMatches(
      filtered,
      { rows: data.rows, sites: data.sites, categories: data.categories.map(catLabel) },
      sortKey,
      sortDir,
    );
    lastFiltered = filtered;

    // "Did you mean?" — a near-miss of a SITE's name never floods results
    // (the typo tier reads filenames only); it becomes a clickable swap.
    suggestEl.textContent = "";
    var suggestions = suggestSiteTerms(siteNames, q);
    for (var sg = 0; sg < suggestions.length; sg++) {
      (function (s) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "search-chip search-suggest-chip";
        b.textContent = "Did you mean “" + s.word + "”?";
        b.addEventListener("click", function () {
          // \\s, not \s: this code lives inside the generator's template
          // literal, where \s cooks to a bare "s" (the v1.48.1 bug that
          // made the swap split queries on the letter s).
          var toks = input.value.split(/\\s+/);
          for (var ti2 = 0; ti2 < toks.length; ti2++) {
            if (foldSearchText(toks[ti2]) === s.term) toks[ti2] = s.word;
          }
          input.value = toks.filter(Boolean).join(" ");
          input.focus();
          update();
        });
        suggestEl.appendChild(b);
      })(suggestions[sg]);
    }

    // A fuzzy correction shared by EVERY visible result is said once in the
    // status line instead of stamped on every row.
    var termCount = filtered.length ? (filtered[0].why || []).length : 0;
    var hoistTerms = {};
    var hoistPhrases = [];
    for (var hi = 0; hi < termCount; hi++) {
      var word0 = null;
      var uniformFuzzy = true;
      for (var fi = 0; fi < filtered.length; fi++) {
        var we = (filtered[fi].why || [])[hi];
        if (!we || we.src !== "fuzzy" || (word0 !== null && we.word !== word0)) { uniformFuzzy = false; break; }
        if (word0 === null) word0 = we.word;
      }
      if (uniformFuzzy && word0 !== null) {
        hoistTerms[hi] = true;
        hoistPhrases.push("“" + filtered[0].why[hi].term + "” ≈ “" + word0 + "”");
      }
    }

    // Category chips: All + every category with a hit.
    catChipsEl.textContent = "";
    catChipsEl.appendChild(chip("All files", matches.length, activeCat === "", function () { activeCat = ""; update(); }));
    for (var c = 0; c < data.categories.length; c++) {
      var cslug = data.categories[c];
      if (!catCounts[cslug]) continue;
      (function (slug) {
        catChipsEl.appendChild(chip(catLabel(slug), catCounts[slug], activeCat === slug, function () {
          activeCat = activeCat === slug ? "" : slug;
          update();
        }));
      })(cslug);
    }

    // Site chips: the "which sites carry it" answer, always visible.
    siteChipsEl.textContent = "";
    var siteIdxs = Object.keys(siteCounts).map(Number).sort(function (a, b) { return siteCounts[b] - siteCounts[a] || a - b; });
    for (var sc = 0; sc < siteIdxs.length; sc++) {
      (function (idx) {
        siteChipsEl.appendChild(chip(data.sites[idx].label, siteCounts[idx], activeSite === idx, function () {
          activeSite = activeSite === idx ? -1 : idx;
          update();
        }));
      })(siteIdxs[sc]);
    }

    var siteTotal = siteIdxs.length;
    statusEl.className = "search-status";
    statusEl.textContent = "";
    var strong = document.createElement("strong");
    strong.textContent = filtered.length.toLocaleString("en-US") + " file" + (filtered.length === 1 ? "" : "s");
    statusEl.appendChild(strong);
    statusEl.appendChild(document.createTextNode(
      (activeSite >= 0 ? " on " + data.sites[activeSite].label : " across " + siteTotal + " site" + (siteTotal === 1 ? "" : "s")) +
      (activeCat ? " (" + catLabel(activeCat) + ")" : "") + " match your search." +
      (hoistPhrases.length ? " All are close-spelling matches: " + hoistPhrases.join(" · ") + "." : "")));

    downloadBtn.disabled = filtered.length === 0;
    renderTable(filtered, hoistTerms);
  }

  function renderTable(filtered, hoistTerms) {
    resultsEl.textContent = "";
    if (!filtered.length) return;
    var wrap = document.createElement("div");
    wrap.className = "search-table-wrap";
    var table = document.createElement("table");
    table.className = "search-table";
    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    SORT_COLUMNS.forEach(function (col) {
      var th = document.createElement("th");
      th.scope = "col";
      if (!col.key) {
        th.textContent = col.label;
        hr.appendChild(th);
        return;
      }
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "search-sort-btn";
      btn.title = "Sort by " + col.label.toLowerCase();
      btn.textContent = col.label;
      if (sortKey === col.key) {
        th.setAttribute("aria-sort", sortDir === "asc" ? "ascending" : "descending");
        var arrow = document.createElement("span");
        arrow.className = "search-sort-arrow";
        arrow.textContent = sortDir === "asc" ? " ▲" : " ▼";
        btn.appendChild(arrow);
      }
      btn.addEventListener("click", function () {
        if (sortKey === col.key) {
          sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
          sortKey = col.key;
          sortDir = SORT_NATURAL_DIR[col.key];
        }
        update();
      });
      th.appendChild(btn);
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    var shown = Math.min(filtered.length, RENDER_CAP);
    for (var i = 0; i < shown; i++) {
      var match = filtered[i];
      var row = data.rows[match.i];
      var site = data.sites[row[2]] || {};
      var why = match.why || [];
      var tr = document.createElement("tr");

      var tdSite = document.createElement("td");
      tdSite.className = "search-site";
      if (site.detail) {
        var sa = document.createElement("a");
        sa.href = site.detail;
        sa.title = "Open the " + (site.label || "site") + " audit report page";
        sa.textContent = site.label || "";
        tdSite.appendChild(sa);
      } else {
        tdSite.textContent = site.label || "";
      }
      tr.appendChild(tdSite);

      var nameTerms = [];
      var whyNotes = [];
      for (var wIdx = 0; wIdx < why.length; wIdx++) {
        if (why[wIdx].src === "name") nameTerms.push(why[wIdx].term);
        else if (!(hoistTerms && hoistTerms[wIdx])) whyNotes.push(whyPhrase(why[wIdx]));
      }
      var ranges = highlightRanges(row[0], nameTerms);

      var tdFile = document.createElement("td");
      tdFile.className = "search-file";
      if (row[8]) {
        var a = document.createElement("a");
        a.href = row[8];
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        appendHighlighted(a, row[0], ranges);
        tdFile.appendChild(a);
      } else {
        appendHighlighted(tdFile, row[0], ranges);
      }
      if (whyNotes.length) {
        var whyEl = document.createElement("div");
        whyEl.className = "search-why";
        whyEl.textContent = whyNotes.join(" · ");
        tdFile.appendChild(whyEl);
      }
      tr.appendChild(tdFile);

      var tdCat = document.createElement("td");
      tdCat.textContent = catLabel(data.categories[row[3]] || "");
      tr.appendChild(tdCat);

      var tdScore = document.createElement("td");
      tdScore.className = "num";
      tdScore.textContent = typeof row[6] === "number" ? String(row[6]) : "";
      tr.appendChild(tdScore);

      var tdGrade = document.createElement("td");
      tdGrade.className = "num";
      tdGrade.textContent = row[7] || "";
      tr.appendChild(tdGrade);

      var tdSize = document.createElement("td");
      tdSize.className = "num";
      tdSize.textContent = fmtSize(row[4]);
      tr.appendChild(tdSize);

      var tdMod = document.createElement("td");
      tdMod.className = "num";
      tdMod.textContent = row[5] || "";
      tr.appendChild(tdMod);

      var tdRep = document.createElement("td");
      if (row[9]) {
        var ra = document.createElement("a");
        ra.href = row[9];
        ra.target = "_blank";
        ra.rel = "noopener noreferrer";
        ra.title = "Open this file's shareable audit report (what's wrong and how to fix it) in a new tab";
        ra.textContent = "View report";
        tdRep.appendChild(ra);
      }
      tr.appendChild(tdRep);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    resultsEl.appendChild(wrap);
    if (filtered.length > RENDER_CAP) {
      var note = document.createElement("p");
      note.className = "search-cap-note";
      note.textContent = "Showing the first " + RENDER_CAP.toLocaleString("en-US") + " of " +
        filtered.length.toLocaleString("en-US") + " matches — refine your search to narrow the list. The downloaded workbook always contains every match.";
      resultsEl.appendChild(note);
    }
  }

  var timer = null;
  input.addEventListener("input", function () {
    if (timer) clearTimeout(timer);
    timer = setTimeout(update, DEBOUNCE_MS);
  });

  downloadBtn.addEventListener("click", function () {
    if (!lastFiltered.length || !data) return;
    var rowsOut = lastFiltered.map(function (mm) {
      var row = data.rows[mm.i];
      var site = data.sites[row[2]] || {};
      return {
        site: site.label || "",
        filename: row[0],
        category: catLabel(data.categories[row[3]] || ""),
        score: typeof row[6] === "number" ? row[6] : null,
        grade: row[7] || null,
        sizeBytes: row[4],
        modified: row[5] || "",
        fileUrl: row[8] || "",
        // The per-file audit.icjia.app report — the house "Audit Report"
        // column meaning. Blank when the file was never scored.
        reportUrl: row[9] || "",
        matchedOn: matchedOnText(mm.why || []),
      };
    });
    var bytes = buildSearchWorkbook(rowsOut);
    var blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = xlsxDownloadName(input.value, new Date().toISOString());
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  });
})();
</script>
</body>
</html>`;
}
