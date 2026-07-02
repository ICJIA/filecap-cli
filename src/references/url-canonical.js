// URL canonicalization for cross-site reference matching.
//
// Two URLs that point to the same resource should produce the same canonical
// form so the cross-site resolver's URL → page-refs index can join cleanly.
// Rules: lowercase host, drop fragment, strip trailing slash on non-root
// paths, drop the query string (v1.39.0 — uploads/files never vary by query;
// the reference side carries cache-busters like "?v=2"), and uppercase
// percent-encoding hex digits so "%2f" and "%2F" collapse to one key.
export function canonicalizeUrl(input) {
  if (typeof input !== "string" || input.length === 0) return null;
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  parsed.hash = "";
  parsed.search = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }
  // Query and hash are gone, so the only %xx escapes left are in the path.
  return parsed.toString().replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase());
}
