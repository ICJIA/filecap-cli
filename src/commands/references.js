// `filecap references` — per-site references extractor.
//
// Reads a site's config from sites.json, dispatches to the matching strategy
// (strapi-v3 for legacy Strapi installs, strapi-v4 for the four newer sites),
// and writes an NDJSON sidecar with one record per content entry. Each record
// names the page URL and the file URLs that page references. The sidecar is
// the input to `filecap cross-references`, which builds the fleet-wide URL →
// referrers index.
//
// Sidecar record shape (one per content entry):
// {
//   siteName, contentType, entryId, slug,
//   pageUrl,          // deployed URL or null if route not resolvable
//   referencedFiles,  // string[]: ICJIA-fleet URLs found in this entry
// }

import fs from "node:fs/promises";
import path from "node:path";
import * as strapiV3 from "../references/strapi-v3.js";
import * as strapiV4 from "../references/strapi-v4.js";
import { buildFleetDomainSet, isFleetUrl } from "../references/domain-filter.js";

const STRATEGIES = {
  "strapi-v3": strapiV3,
  "strapi-v4": strapiV4,
};

// Build a deployed page URL from a content type + entry slug via the
// contentTypeRoutes map. Supports a flat `route: "/grants/funding/:slug/"`
// mapping for now. Returns null if the route is missing or the entry lacks
// a usable slug. `slug` is read by the caller — v3 stores it flat on the
// entry, v4 nests it under entry.attributes.
function resolvePageUrl({ contentType, slug, siteFrontendUrl, contentTypeRoutes }) {
  const route = contentTypeRoutes?.[contentType];
  if (typeof route !== "string" || typeof slug !== "string") return null;
  const filledPath = route.replace(":slug", encodeURIComponent(slug));
  const base = (siteFrontendUrl ?? "").replace(/\/+$/, "");
  if (!base) return null;
  return `${base}${filledPath}`;
}

// Build a default fetcher around global fetch. The fetcher returns parsed
// JSON. GraphQL POST bodies are passed through unchanged.
function defaultFetcher() {
  return async (url, init) => {
    const resp = await fetch(url, init);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText} for ${url}`);
    }
    return resp.json();
  };
}

export async function runReferences({
  siteConfig,
  sitesJson,
  outputPath,
  fetcher: injectedFetcher,
  log = console.error,
}) {
  const refsCfg = siteConfig.references;
  const adapter = STRATEGIES[refsCfg?.strategy];
  if (!adapter) {
    const known = Object.keys(STRATEGIES).map((s) => `"${s}"`).join(", ");
    throw new Error(
      `site "${siteConfig.name}": references.strategy must be one of ${known} (got ${JSON.stringify(refsCfg?.strategy)})`,
    );
  }
  const isV4 = refsCfg.strategy === "strapi-v4";
  const fetcher = injectedFetcher ?? defaultFetcher();
  const fleetDomainSet = buildFleetDomainSet(sitesJson);

  log(
    `[references] discovering content types via ${refsCfg.graphqlEndpoint} (${refsCfg.strategy})`,
  );
  const contentTypes = await adapter.introspectContentTypes(
    refsCfg.graphqlEndpoint,
    fetcher,
  );
  log(
    `[references] ${contentTypes.length} content types: ${contentTypes.map((c) => c.singular).join(", ")}`,
  );

  const sidecarRecords = [];

  for (const { singular, plural } of contentTypes) {
    const pascalCt = singular.charAt(0).toUpperCase() + singular.slice(1);
    let classifiedFields;
    try {
      classifiedFields = await adapter.introspectTypeFields(
        refsCfg.graphqlEndpoint,
        pascalCt,
        fetcher,
      );
    } catch (err) {
      log(`[references] WARN: failed to introspect ${pascalCt}: ${err.message}`);
      continue;
    }

    // v3 REST path: kebab-case the camelCase plural (`requiredForms` →
    // `/required-forms`). v4 REST path: plural as-is (`/api/biographies`
    // works directly; observed v4 sites have no camelCase content types).
    const restPath = isV4
      ? plural
      : plural.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    let entries;
    try {
      entries = await adapter.fetchAllEntries(refsCfg.restApiBase, restPath, fetcher);
    } catch (err) {
      log(`[references] WARN: failed to fetch ${restPath}: ${err.message}`);
      continue;
    }
    log(`[references] ${pascalCt}: ${entries.length} entries`);

    for (const entry of entries) {
      // v3 entries are flat ({id, slug, body, ...}); v4 nests fields under
      // entry.attributes. Slug lookup must follow the same path.
      const slug = isV4 ? entry?.attributes?.slug : entry?.slug;
      const allUrls = adapter.extractEntryUrls(
        entry,
        classifiedFields,
        refsCfg.restApiBase,
      );
      const fleetUrls = allUrls.filter((u) => isFleetUrl(u, fleetDomainSet));
      const pageUrl = resolvePageUrl({
        contentType: singular,
        slug,
        siteFrontendUrl: refsCfg.siteFrontendUrl ?? siteConfig.siteUrl,
        contentTypeRoutes: refsCfg.contentTypeRoutes,
      });
      sidecarRecords.push({
        siteName: siteConfig.name,
        contentType: singular,
        entryId: entry.id,
        slug: slug ?? null,
        pageUrl,
        referencedFiles: fleetUrls,
      });
    }
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const ndjson = sidecarRecords.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await fs.writeFile(outputPath, ndjson);
  log(
    `[references] wrote ${sidecarRecords.length} sidecar records to ${outputPath}`,
  );
  return { entriesProcessed: sidecarRecords.length, outputPath };
}
