// SSRF guard for the build-time fetches that reach URLs derived from scraped
// content (sub-sitemap <loc> values, og:image URLs). Those URLs are attacker-
// influenced: a malicious or compromised fleet site can return a sitemapindex
// or an og:image pointing at http://169.254.169.254/… (cloud metadata),
// http://127.0.0.1:6379/ (a local service), or a private LAN address. Fixes
// the 2026-08-24 audit finding "server-side SSRF via scraped URLs".
//
// The guard is intentionally simple and self-contained: reject non-http(s)
// schemes and any host that is a loopback / link-local / private / metadata
// address (or a localhost/.local name), and fetch with `redirect: "manual"`
// so undici never auto-follows a redirect from a public host INTO a private
// one. Because the only request `safeFetch` issues goes to the host it just
// validated, and redirects are not chased, a scraped URL can never reach an
// internal address.
//
// Residual (accepted, documented in docs/security/audit-2026-08-24.md): a
// hostname that RESOLVES to a private address (split-horizon DNS / DNS
// rebinding) is not caught here — that would need connection-time IP pinning,
// which is disproportionate for a best-effort build-time tool run on the
// operator's workstation.

/**
 * True when `ip` (an IPv4 or IPv6 literal string) is a loopback, unspecified,
 * link-local, private (RFC1918 / ULA), CGNAT, or cloud-metadata address — i.e.
 * anything a scraped URL must never be allowed to reach. A malformed or
 * unparseable value returns true (fail closed).
 *
 * @param {string} ip
 * @returns {boolean}
 */
export function isBlockedAddress(ip) {
  if (typeof ip !== "string" || ip.length === 0) return true;
  let addr = ip.trim().toLowerCase();

  // IPv4-mapped / -embedded IPv6 (::ffff:127.0.0.1) — unwrap to the IPv4 part.
  const mapped = addr.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) addr = mapped[1];

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(addr)) {
    const parts = addr.split(".").map(Number);
    if (parts.some((n) => n > 255)) return true; // malformed octet → fail closed
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8 "this host"
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254 metadata)
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    return false;
  }

  if (addr.includes(":")) {
    if (addr === "::1" || addr === "::") return true; // loopback / unspecified
    if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 link-local
    if (/^f[cd]/.test(addr)) return true; // fc00::/7 unique-local
    return false;
  }

  // Not an IP literal — the caller decides (isBlockedHost handles names).
  return false;
}

/**
 * True when a URL host must be refused before any fetch: a localhost/.local
 * name, or a literal IP address in a blocked range. An ordinary public
 * hostname returns false (its resolution is not this function's concern —
 * `safeFetch` additionally refuses to chase redirects, which is the practical
 * SSRF control).
 *
 * @param {string} host - URL.hostname (IPv6 without brackets)
 * @returns {boolean}
 */
export function isBlockedHost(host) {
  if (!host || typeof host !== "string") return true;
  const h = host.toLowerCase().replace(/\.$/, ""); // drop any FQDN trailing dot
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "local" || h.endsWith(".local")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":")) {
    return isBlockedAddress(h);
  }
  return false;
}

/**
 * Parse and vet a fetch target. Throws an Error whose message begins "blocked:"
 * when the URL is unparseable, not http(s), or points at a blocked host.
 * Returns the parsed URL otherwise.
 *
 * @param {string} url
 * @returns {URL}
 */
export function assertSafeUrl(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    throw new Error(`blocked: unparseable URL ${JSON.stringify(String(url))}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`blocked: non-http(s) scheme "${u.protocol}" for ${u.href}`);
  }
  if (isBlockedHost(u.hostname)) {
    throw new Error(
      `blocked: host "${u.hostname}" is loopback/link-local/private/metadata`,
    );
  }
  return u;
}

/**
 * Fetch a scraped-derived URL with SSRF protection. Validates the host, then
 * fetches with `redirect: "manual"` so a redirect cannot carry the request
 * into a private address.
 *
 * The caller sees a 3xx as a non-ok response and, for the scraping callers,
 * treats it as unreachable — the intended "don't chase redirects" behavior.
 * v1.68.0 correction: an earlier version of this note said undici returns an
 * *opaque* redirect (status 0, headers stripped). It does not — that is the
 * browser Fetch behavior. Under Node/undici the real 3xx comes back with its
 * status and `Location` intact, which src/site-audit/page-probe.js depends on
 * to tell a retired page (301) from one merely missing from a sitemap.
 *
 * @param {string} url
 * @param {object} [opts] - passed to fetchImpl as the init; `fetchImpl`
 *   (default global fetch) is peeled off for injection in tests.
 * @returns {Promise<Response>}
 * @throws {Error} "blocked: …" when the target is unsafe (never fetched)
 */
export async function safeFetch(url, opts = {}) {
  const { fetchImpl = fetch, ...init } = opts;
  assertSafeUrl(url);
  return fetchImpl(url, { ...init, redirect: "manual" });
}
