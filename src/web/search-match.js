// v1.46.0 — the /search page matcher.
//
// People searching the fleet know FRAGMENTS, not filenames: "dvfr report"
// where "dvfr" is the SITE, "anual report" with a typo, "annualreport" with
// the separator dropped. Filenames are inconsistently named across 13 sites,
// so the matcher is tiered — every query term must land somewhere (AND), and
// exact hits always outrank fuzzy ones:
//
//   tier 4  term is a substring of the folded filename
//   tier 3  term is a substring of the site name / full name / path
//   tier 2  separator-blind: squashed term inside the squashed record
//   tier 1  typo-tolerant: within edit distance 1 (len 4–6) / 2 (len 7+)
//           of some word of the record
//
// Every function here is pure and self-contained (no imports, no closures)
// because searchMatchClientSource() embeds them verbatim into search.html's
// inline <script> — the same .toString() pattern as uptime-client.js: the
// tested code IS the shipped code.

/** Lowercase and fold every non-alphanumeric run to a single space. */
export function foldSearchText(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Lowercase and drop every non-alphanumeric — the separator-blind form. */
export function squashSearchText(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Strip Strapi's 10-hex upload hash before the extension
 * (report_a1b2c3d4e5.pdf → report.pdf). Same regex as web-rollup's
 * normalizeStrapiFilename — duplicated because this function ships inline
 * to the browser and cannot import.
 */
export function stripUploadHash(filename) {
  return String(filename ?? "").replace(/_[a-f0-9]{10}(\.[^.]+)$/, "$1");
}

/**
 * Bounded optimal-string-alignment distance (Levenshtein + adjacent
 * transposition, so "annaul"→"annual" is one edit). Returns true when
 * distance(a, b) <= max. Bails early on a length gap beyond the bound.
 */
export function editDistanceLe(a, b, max) {
  var la = a.length, lb = b.length;
  if (la > lb) { var t = a; a = b; b = t; t = la; la = lb; lb = t; }
  if (lb - la > max) return false;
  var prev2 = null;
  var prev = [];
  for (var j = 0; j <= lb; j++) prev[j] = j;
  for (var i = 1; i <= la; i++) {
    var cur = [i];
    var rowMin = i;
    for (var k = 1; k <= lb; k++) {
      var cost = a.charCodeAt(i - 1) === b.charCodeAt(k - 1) ? 0 : 1;
      var v = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
      if (
        prev2 && i > 1 && k > 1 &&
        a.charCodeAt(i - 1) === b.charCodeAt(k - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(k - 1)
      ) {
        v = Math.min(v, prev2[k - 2] + 1);
      }
      cur[k] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return false;
    prev2 = prev;
    prev = cur;
  }
  return prev[lb] <= max;
}

/**
 * Precompute one record's searchable forms. `name` carries the folded
 * filename plus its hash-stripped variant (so pasting the exact uploaded
 * name still works); `ctx` carries site identity + path; `squash` is the
 * separator-blind form of both; `words` feeds the typo tier.
 *
 * @param {{filename:string, path:string, siteLabel:string, siteFull:string}} rec
 */
export function buildHaystack(rec) {
  var raw = rec && rec.filename ? rec.filename : "";
  var stripped = stripUploadHash(raw);
  var name = foldSearchText(raw);
  if (stripped !== raw) {
    var foldedStripped = foldSearchText(stripped);
    if (foldedStripped && foldedStripped !== name) name = name + " " + foldedStripped;
  }
  // site + pathf are kept separately so a tier-3 match can be attributed
  // ("the site's name" vs "the folder path") in the result's `why`; ctx is
  // their concatenation, unchanged for scoring.
  var site = foldSearchText(
    [rec && rec.siteLabel, rec && rec.siteFull].filter(Boolean).join(" "),
  );
  var pathf = foldSearchText(rec && rec.path);
  var ctx = [site, pathf].filter(Boolean).join(" ");
  var combined = name + " " + ctx;
  var squash = squashSearchText(combined);
  // v1.48.0 — the typo tier reads FILENAME words only. Fuzzing site/path
  // words gave a one-letter miss the blast radius of a whole site ("svfr"
  // matched every DVFR file); near-misses on site names are now surfaced
  // as "Did you mean?" suggestions (suggestSiteTerms) instead.
  var nameWords = [];
  var seen = {};
  var tokens = name.split(" ");
  for (var i = 0; i < tokens.length; i++) {
    var w = tokens[i];
    if (w && !seen[w]) { seen[w] = true; nameWords.push(w); }
  }
  return { name: name, site: site, pathf: pathf, ctx: ctx, squash: squash, nameWords: nameWords };
}

/**
 * Rank haystacks against a query. Every folded query term must match some
 * tier (AND); score is the sum of per-term tiers, +2 when the full folded
 * query appears verbatim in the filename. Returns [{i, score, why}] sorted
 * by score desc, then index asc — deterministic and explainable. `why` has
 * one entry per query term saying where it landed: src "name" | "site" |
 * "path" | "squash" | "fuzzy" (fuzzy also carries the matched `word`), so
 * the page can show whether a hit is IN the filename or merely near it.
 *
 * @param {Array<ReturnType<typeof buildHaystack>>} hays
 * @param {string} query
 */
export function runSearch(hays, query) {
  var folded = foldSearchText(query);
  if (!folded) return [];
  var terms = folded.split(" ");
  var out = [];
  for (var i = 0; i < hays.length; i++) {
    var hay = hays[i];
    var score = 0;
    var ok = true;
    var why = [];
    for (var t = 0; t < terms.length; t++) {
      var term = terms[t];
      var tier = 0;
      var entry = null;
      if (hay.name.indexOf(term) !== -1) {
        tier = 4;
        entry = { term: term, src: "name" };
      } else if (hay.ctx.indexOf(term) !== -1) {
        tier = 3;
        entry = { term: term, src: hay.site.indexOf(term) !== -1 ? "site" : "path" };
      } else if (term.length >= 4 && hay.squash.indexOf(squashSearchText(term)) !== -1) {
        tier = 2;
        entry = { term: term, src: "squash" };
      } else if (term.length >= 4) {
        var maxD = term.length >= 7 ? 2 : 1;
        for (var w = 0; w < hay.nameWords.length; w++) {
          var word = hay.nameWords[w];
          if (Math.abs(word.length - term.length) > maxD) continue;
          if (editDistanceLe(term, word, maxD)) {
            tier = 1;
            entry = { term: term, src: "fuzzy", word: word };
            break;
          }
        }
      }
      if (tier === 0) { ok = false; break; }
      score += tier;
      why.push(entry);
    }
    if (!ok) continue;
    if (terms.length > 1 && hay.name.indexOf(folded) !== -1) score += 2;
    out.push({ i: i, score: score, why: why });
  }
  out.sort(function (a, b) { return b.score - a.score || a.i - b.i; });
  return out;
}

/**
 * Map name-matched terms back onto the RAW filename as merged [start, end)
 * ranges for <mark> rendering. Case-insensitive; a tier-4 term is always a
 * contiguous run of the raw name (folding only lowercases and turns
 * separators into spaces, and terms carry no spaces), so plain indexOf is
 * exact. Overlapping and adjacent ranges merge so marks never nest.
 */
export function highlightRanges(raw, terms) {
  var lower = String(raw === null || raw === undefined ? "" : raw).toLowerCase();
  var ranges = [];
  for (var t = 0; t < (terms ? terms.length : 0); t++) {
    var term = String(terms[t] || "").toLowerCase();
    if (!term) continue;
    var from = 0;
    var at;
    while ((at = lower.indexOf(term, from)) !== -1) {
      ranges.push([at, at + term.length]);
      from = at + 1;
    }
  }
  ranges.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  var merged = [];
  for (var r = 0; r < ranges.length; r++) {
    var cur = ranges[r];
    var last = merged[merged.length - 1];
    if (last && cur[0] <= last[1]) {
      if (cur[1] > last[1]) last[1] = cur[1];
    } else {
      merged.push([cur[0], cur[1]]);
    }
  }
  return merged;
}

/**
 * "Did you mean dvfr?" — offer a spelling correction when a query term is a
 * near-miss of a SITE's name. This replaces the old behavior of silently
 * fuzzy-matching site words (which turned a one-letter typo into that
 * site's entire inventory): the flood becomes an explicit, clickable
 * choice. At most two suggestions, deterministic (distance 1 beats 2,
 * then alphabetical).
 *
 * @param {Array<string>} siteNames - raw site labels + full names
 * @param {string} query
 * @returns {Array<{term: string, word: string}>}
 */
export function suggestSiteTerms(siteNames, query) {
  var folded = foldSearchText(query);
  if (!folded) return [];
  var vocab = [];
  var seen = {};
  var names = siteNames || [];
  for (var n = 0; n < names.length; n++) {
    var toks = foldSearchText(names[n]).split(" ");
    for (var t = 0; t < toks.length; t++) {
      var v = toks[t];
      if (v && !seen[v]) { seen[v] = true; vocab.push(v); }
    }
  }
  vocab.sort();
  var out = [];
  var terms = folded.split(" ");
  for (var q = 0; q < terms.length && out.length < 2; q++) {
    var term = terms[q];
    if (term.length < 4) continue;
    // A term already inside a site word matches by substring — no help needed.
    var covered = false;
    for (var c = 0; c < vocab.length; c++) {
      if (vocab[c].indexOf(term) !== -1) { covered = true; break; }
    }
    if (covered) continue;
    var best = null;
    var maxPass = term.length >= 7 ? 2 : 1;
    for (var d = 1; d <= maxPass && !best; d++) {
      for (var i = 0; i < vocab.length; i++) {
        var word = vocab[i];
        if (term.indexOf(word) !== -1) continue; // site word already in the term
        if (Math.abs(word.length - term.length) > d) continue;
        if (editDistanceLe(term, word, d)) { best = word; break; }
      }
    }
    if (best) out.push({ term: term, word: best });
  }
  return out;
}

/**
 * The matcher as inline-<script> source. Embedded verbatim into
 * search.html so the unit-tested functions above are exactly what runs in
 * the browser.
 */
export function searchMatchClientSource() {
  return [foldSearchText, squashSearchText, stripUploadHash, editDistanceLe, buildHaystack, runSearch, highlightRanges, suggestSiteTerms]
    .map(function (fn) { return fn.toString(); })
    .join("\n");
}
