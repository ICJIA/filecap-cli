// Cross-site reference resolver.
//
// Most icjia.illinois.gov content references PDFs hosted on the archive or
// researchhub sites. The references step on the icjia site discovers those
// outbound references, but the audit row for the PDF lives in the archive
// site's inventory — there's no first-hand way for that inventory to know
// who's pointing at it.
//
// This resolver bridges the gap: collect every site's per-entry "referenced
// files" sidecar records into one fleet-wide URL → referrers map, then for
// each inventory entry, attach back-pointers from the index. The resulting
// entry.references[] is what the CSV/HTML Referenced column renders.
import { canonicalizeUrl } from "./url-canonical.js";

// Build an alias-host → primary-host map from sites.json. Each site can
// declare `domainAliases: ["backend.example.com"]` to cover alternate hosts
// that serve the same files as its `publicUrlBase`. When a URL using an
// alias host is indexed or looked up, the resolver rewrites the host to
// the site's primary so the URL matches between the sidecar's referenced
// files and the audited inventory's canonical paths.
//
// Concrete case driving this: ICJIA's archive site serves files at
// archive.icjia.cloud (the public publicUrlBase) AND archive.icjia-api.cloud
// (the backend). Content on icjia.illinois.gov references the backend host;
// the archive's inventory lives under the public host. Without aliasing,
// the URL-key for the same file diverges and matching fails.
export function buildAliasMap(sitesJson) {
  const map = new Map();
  const sites = sitesJson?.sites;
  if (!Array.isArray(sites)) return map;
  for (const site of sites) {
    if (!Array.isArray(site.domainAliases) || site.domainAliases.length === 0) {
      continue;
    }
    let primary;
    try {
      primary = new URL(site.publicUrlBase).hostname.toLowerCase();
    } catch {
      continue;
    }
    for (const alias of site.domainAliases) {
      if (typeof alias === "string" && alias.length > 0) {
        map.set(alias.toLowerCase(), primary);
      }
    }
  }
  return map;
}

// Canonicalize a URL and then collapse any alias host onto its primary host.
export function canonicalizeForFleet(url, aliasMap) {
  const canonical = canonicalizeUrl(url);
  if (!canonical || !aliasMap || aliasMap.size === 0) return canonical;
  try {
    const u = new URL(canonical);
    const primary = aliasMap.get(u.hostname);
    if (primary) {
      u.hostname = primary;
      return u.toString();
    }
  } catch {
    return canonical;
  }
  return canonical;
}

export function buildReverseIndex(sidecarRecords, aliasMap) {
  const idx = new Map();
  if (!Array.isArray(sidecarRecords)) return idx;
  for (const rec of sidecarRecords) {
    const files = Array.isArray(rec?.referencedFiles)
      ? rec.referencedFiles
      : [];
    for (const fileUrl of files) {
      const canonical = canonicalizeForFleet(fileUrl, aliasMap);
      if (!canonical) continue;
      let bucket = idx.get(canonical);
      if (!bucket) {
        bucket = [];
        idx.set(canonical, bucket);
      }
      bucket.push({
        siteName: rec.siteName,
        contentType: rec.contentType,
        entryId: rec.entryId,
        pageUrl: rec.pageUrl,
      });
    }
  }
  return idx;
}

export function entryCanonicalUrl(entry, publicUrlBase) {
  if (!entry || typeof entry.path !== "string") return null;
  if (typeof publicUrlBase !== "string" || publicUrlBase.length === 0) {
    return null;
  }
  const base = publicUrlBase.replace(/\/+$/, "");
  const path = entry.path.replace(/^\/+/, "");
  // v1.39.0 (B2) — inventory paths are raw filesystem bytes (never
  // pre-encoded), so encode each segment: an unencoded "#" or "?" would
  // otherwise become a fragment/query and truncate the key (false orphan).
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return canonicalizeUrl(`${base}/${encodedPath}`);
}

export function resolveEntryReferences(entry, publicUrlBase, reverseIndex) {
  const canonical = entryCanonicalUrl(entry, publicUrlBase);
  // v1.39.0 (B8) — unresolvable URL (no/empty base, no path): return the
  // entry WITHOUT a references field. Absent = "not resolved", which
  // orphans.js skips; references: [] would mark it a confirmed orphan.
  if (!canonical) return { ...entry };
  return { ...entry, references: reverseIndex.get(canonical) ?? [] };
}
