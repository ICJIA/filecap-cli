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
  var ctx = foldSearchText(
    [rec && rec.siteLabel, rec && rec.siteFull, rec && rec.path]
      .filter(Boolean)
      .join(" "),
  );
  var combined = name + " " + ctx;
  var squash = squashSearchText(combined);
  var words = [];
  var seen = {};
  var tokens = combined.split(" ");
  for (var i = 0; i < tokens.length; i++) {
    var w = tokens[i];
    if (w && !seen[w]) { seen[w] = true; words.push(w); }
  }
  return { name: name, ctx: ctx, squash: squash, words: words };
}

/**
 * Rank haystacks against a query. Every folded query term must match some
 * tier (AND); score is the sum of per-term tiers, +2 when the full folded
 * query appears verbatim in the filename. Returns [{i, score}] sorted by
 * score desc, then index asc — deterministic and explainable.
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
    for (var t = 0; t < terms.length; t++) {
      var term = terms[t];
      var tier = 0;
      if (hay.name.indexOf(term) !== -1) tier = 4;
      else if (hay.ctx.indexOf(term) !== -1) tier = 3;
      else if (term.length >= 4 && hay.squash.indexOf(squashSearchText(term)) !== -1) tier = 2;
      else if (term.length >= 4) {
        var maxD = term.length >= 7 ? 2 : 1;
        for (var w = 0; w < hay.words.length; w++) {
          var word = hay.words[w];
          if (Math.abs(word.length - term.length) > maxD) continue;
          if (editDistanceLe(term, word, maxD)) { tier = 1; break; }
        }
      }
      if (tier === 0) { ok = false; break; }
      score += tier;
    }
    if (!ok) continue;
    if (terms.length > 1 && hay.name.indexOf(folded) !== -1) score += 2;
    out.push({ i: i, score: score });
  }
  out.sort(function (a, b) { return b.score - a.score || a.i - b.i; });
  return out;
}

/**
 * The matcher as inline-<script> source. Embedded verbatim into
 * search.html so the unit-tested functions above are exactly what runs in
 * the browser.
 */
export function searchMatchClientSource() {
  return [foldSearchText, squashSearchText, stripUploadHash, editDistanceLe, buildHaystack, runSearch]
    .map(function (fn) { return fn.toString(); })
    .join("\n");
}
