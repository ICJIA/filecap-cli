// Fleet-domain whitelist derived from sites.json. Used to drop references to
// URLs that aren't on ICJIA-controlled infrastructure (federal sites,
// qualtrics, youtube, etc.) before they enter the references column.
//
// A site may declare optional `domainAliases: string[]` to cover backend
// hostnames that don't appear in publicUrlBase but still serve the same
// content (e.g. archive.icjia-api.cloud is the backend for archive.icjia.cloud).

function pushHost(set, urlStr) {
  if (typeof urlStr !== "string" || urlStr.length === 0) return;
  try {
    const u = new URL(urlStr);
    set.add(u.hostname.toLowerCase());
  } catch {
    // skip malformed entries silently
  }
}

export function buildFleetDomainSet(sitesJson) {
  const set = new Set();
  const sites = sitesJson?.sites;
  if (!Array.isArray(sites)) return set;
  for (const site of sites) {
    pushHost(set, site.publicUrlBase);
    pushHost(set, site.siteUrl);
    if (Array.isArray(site.domainAliases)) {
      for (const alias of site.domainAliases) {
        if (typeof alias === "string" && alias.length > 0) {
          set.add(alias.toLowerCase());
        }
      }
    }
  }
  return set;
}

export function isFleetUrl(urlStr, domainSet) {
  if (typeof urlStr !== "string" || urlStr.length === 0) return false;
  let host;
  try {
    host = new URL(urlStr).hostname.toLowerCase();
  } catch {
    return false;
  }
  return domainSet.has(host);
}
