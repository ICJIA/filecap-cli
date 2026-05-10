/**
 * Generate a robots.txt that blocks all crawlers.
 * The web-rollup output is meant for internal sharing, not indexing.
 *
 * @returns {string}
 */
export function generateRobotsTxt() {
  return "User-agent: *\nDisallow: /\n";
}
