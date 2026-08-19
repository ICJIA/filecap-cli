/**
 * Generate a robots.txt that blocks every crawler from every path.
 *
 * This bundle is internal ICJIA material — a file-by-file inventory of the
 * agency's web estate, with server-side paths, content hashes, and staff
 * decisions in it. None of it should ever appear in a search result or a
 * training corpus.
 *
 * robots.txt is the weakest of four layers, and the only one that depends
 * on the crawler cooperating:
 *
 *   1. Netlify Site Password — every request 401s before it reaches a file.
 *      This is the control that actually enforces anything.
 *   2. `X-Robots-Tag: noindex, nofollow` on `/*` (src/web/netlify-config.js,
 *      emitted into `_headers`) — a directive well-behaved engines honour
 *      even when they ignore robots.txt.
 *   3. `<meta name="robots" content="noindex, nofollow">` in every page head.
 *   4. This file.
 *
 * `User-agent: * / Disallow: /` is already maximal under the standard, so
 * the named blocks below add nothing for a crawler that follows the spec.
 * They are here for the ones that don't: several AI-training and archiving
 * crawlers have shipped with wildcard handling that ignores `*` but honours
 * their own product token, so naming them is the difference between an
 * opt-out that works and one that only looks like it does.
 *
 * @returns {string}
 */
export function generateRobotsTxt() {
  const named = [
    // AI training / retrieval crawlers
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "ClaudeBot",
    "Claude-Web",
    "anthropic-ai",
    "Google-Extended",
    "PerplexityBot",
    "Applebot-Extended",
    "CCBot",
    "Bytespider",
    "Amazonbot",
    "meta-externalagent",
    "FacebookBot",
    "cohere-ai",
    "Diffbot",
    "Omgilibot",
    "Timpibot",
    // Archivers — a cached snapshot outlives the password wall
    "ia_archiver",
    "archive.org_bot",
    // Aggressive SEO crawlers
    "AhrefsBot",
    "SemrushBot",
    "MJ12bot",
    "DotBot",
    "PetalBot",
  ];

  const blocks = [
    "# ICJIA Fleet Audit — internal only. Nothing here is for public",
    "# indexing, caching, archiving, or model training.",
    "#",
    "# Enforcement is the Netlify Site Password (every path 401s) plus",
    "# X-Robots-Tag: noindex, nofollow on /* in _headers. This file is the",
    "# cooperative layer; the named agents below are listed because some of",
    "# them have ignored the wildcard rule in practice.",
    "",
    "User-agent: *",
    "Disallow: /",
    "",
    ...named.flatMap((agent) => [`User-agent: ${agent}`, "Disallow: /", ""]),
  ];

  return blocks.join("\n");
}
