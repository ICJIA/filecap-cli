// URL → site resolver. Users know a site's URL, not always the internal slug
// they gave it, so run-site-update.sh lets them name sites by front-end URL,
// file-server URL, domain alias, slug, or nickname. Pure — takes the sites
// array; the CLI (`filecap resolve-site`) does the I/O.

/**
 * Normalize a URL or bare hostname to a comparable host: lowercased, no scheme,
 * path, query, userinfo, port, or leading `www.`. Returns "" for junk input.
 * @param {string} input
 * @returns {string}
 */
export function normalizeHost(input) {
  if (!input || typeof input !== "string") return "";
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme://
  s = s.split(/[/?#]/)[0]; // path / query / fragment
  s = s.split("@").pop(); // userinfo@
  s = s.split(":")[0]; // :port
  s = s.replace(/^www\./, "");
  return s;
}

/**
 * Resolve a user-supplied query (URL / slug / nickname) to the owning site.
 * A site matches when the query equals (case-insensitively) its slug (`name`)
 * or nickname (`siteName`), or when the query's normalized host equals the
 * normalized host of its `siteUrl`, `publicUrlBase`, or any `domainAliases`.
 *
 * Each site is considered at most once, so a query that matches a single site
 * via two of its own fields is one `match`, not `ambiguous`.
 *
 * @param {string} query
 * @param {Array<object>} sites
 * @returns {{status:"match", site:object} | {status:"ambiguous", sites:object[]} | {status:"none"}}
 */
export function resolveSite(query, sites) {
  const list = Array.isArray(sites) ? sites : [];
  const q = (query ?? "").trim().toLowerCase();
  const qHost = normalizeHost(query);
  if (!q && !qHost) return { status: "none" };

  const matched = [];
  for (const s of list) {
    const slug = (s.name ?? "").toLowerCase();
    const nick = (s.siteName ?? "").toLowerCase();
    const hosts = new Set();
    for (const u of [s.siteUrl, s.publicUrlBase, ...(s.domainAliases ?? [])]) {
      const h = normalizeHost(u);
      if (h) hosts.add(h);
    }
    if ((slug && q === slug) || (nick && q === nick) || (qHost && hosts.has(qHost))) {
      matched.push(s);
    }
  }

  if (matched.length === 1) return { status: "match", site: matched[0] };
  if (matched.length > 1) return { status: "ambiguous", sites: matched };
  return { status: "none" };
}
