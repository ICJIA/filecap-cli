// URL canonicalization for cross-site reference matching.
//
// Two URLs that point to the same resource should produce the same canonical
// form so the cross-site resolver's URL → page-refs index can join cleanly.
// Conservative rules: lowercase host, drop fragment, strip trailing slash on
// non-root paths, preserve query and percent-encoding verbatim.
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
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }
  return parsed.toString();
}
