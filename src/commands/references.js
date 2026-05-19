// `filecap references` — per-site references extractor.
//
// Reads a site's config from sites.json, dispatches to the matching strategy
// (currently only strapi-v3), and writes an NDJSON sidecar with one record
// per content entry. Each record names the page URL and the file URLs that
// page references. The sidecar is the input to `filecap cross-references`,
// which builds the fleet-wide URL → referrers index.
//
// Sidecar record shape (one per content entry):
// {
//   siteName, contentType, entryId, slug,
//   pageUrl,          // deployed URL or null if route not resolvable
//   referencedFiles,  // string[]: ICJIA-fleet URLs found in this entry
// }

import fs from "node:fs/promises";
import path from "node:path";
import {
  introspectContentTypes,
  introspectTypeFields,
  fetchAllEntries,
  extractEntryUrls,
} from "../references/strapi-v3.js";
import { buildFleetDomainSet, isFleetUrl } from "../references/domain-filter.js";

// Build a deployed page URL from a content type + entry slug via the
// contentTypeRoutes map. Supports a flat `route: "/grants/funding/:slug/"`
// mapping for now. Returns null if the route is missing or the entry lacks
// a usable slug.
function resolvePageUrl({ contentType, entry, siteFrontendUrl, contentTypeRoutes }) {
  const route = contentTypeRoutes?.[contentType];
  if (typeof route !== "string" || typeof entry.slug !== "string") return null;
  const filledPath = route.replace(":slug", encodeURIComponent(entry.slug));
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
  if (!refsCfg || refsCfg.strategy !== "strapi-v3") {
    throw new Error(
      `site "${siteConfig.name}": references.strategy must be "strapi-v3" (got ${JSON.stringify(refsCfg?.strategy)})`,
    );
  }
  const fetcher = injectedFetcher ?? defaultFetcher();
  const fleetDomainSet = buildFleetDomainSet(sitesJson);

  log(
    `[references] discovering content types via ${refsCfg.graphqlEndpoint}`,
  );
  const contentTypes = await introspectContentTypes(
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
      classifiedFields = await introspectTypeFields(
        refsCfg.graphqlEndpoint,
        pascalCt,
        fetcher,
      );
    } catch (err) {
      log(`[references] WARN: failed to introspect ${pascalCt}: ${err.message}`);
      continue;
    }

    // Plural from schema (Strapi's pluralizer handles irregular forms like
    // county→counties; naive `+s` would 404 on those). Strapi v3 also
    // kebab-cases camelCase type names in the REST URL path even when the
    // GraphQL query name stays camelCase (`requiredForms` → /required-forms).
    const restPath = plural.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    let entries;
    try {
      entries = await fetchAllEntries(refsCfg.restApiBase, restPath, fetcher);
    } catch (err) {
      log(`[references] WARN: failed to fetch ${restPath}: ${err.message}`);
      continue;
    }
    log(`[references] ${pascalCt}: ${entries.length} entries`);

    for (const entry of entries) {
      const allUrls = extractEntryUrls(
        entry,
        classifiedFields,
        refsCfg.restApiBase,
      );
      const fleetUrls = allUrls.filter((u) => isFleetUrl(u, fleetDomainSet));
      const pageUrl = resolvePageUrl({
        contentType: singular,
        entry,
        siteFrontendUrl: refsCfg.siteFrontendUrl ?? siteConfig.siteUrl,
        contentTypeRoutes: refsCfg.contentTypeRoutes,
      });
      sidecarRecords.push({
        siteName: siteConfig.name,
        contentType: singular,
        entryId: entry.id,
        slug: entry.slug ?? null,
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
