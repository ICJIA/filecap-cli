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
import os from "node:os";
import readline from "node:readline";
import * as strapiV3 from "../references/strapi-v3.js";
import * as strapiV4 from "../references/strapi-v4.js";
import { runGitRepoReferences } from "../references/git-repo.js";
import { createAuthFetcher } from "../references/auth-fetcher.js";
import { buildFleetDomainSet, isFleetUrl } from "../references/domain-filter.js";
import { resolvePageUrl } from "../references/page-route-resolver.js";
import {
  loadSecrets,
  getSiteToken,
  getSiteLogin,
  persistSiteToken,
} from "../config/secrets.js";

const STRATEGIES = {
  "strapi-v3": strapiV3,
  "strapi-v4": strapiV4,
};

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

// 1.8.0-beta.6: prompt the operator for a fresh JWT on stdin when a 401
// happens and no bearerLogin is configured. Only used when stderr is a
// TTY — in non-interactive runs (CI, scripted), we'd rather fail loudly
// than hang on a stdin read. The function resolves to null if the user
// aborts (empty input / Ctrl-D).
function ttyTokenPrompter(serverName) {
  if (!process.stdin.isTTY || !process.stderr.isTTY) return null;
  return async () => {
    process.stderr.write(
      `\n[references] bearer token for "${serverName}" was rejected (likely expired). ` +
        `Paste a fresh JWT (or press Enter to abort):\n> `,
    );
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stderr,
        terminal: true,
      });
      rl.once("line", (line) => {
        rl.close();
        const trimmed = line.trim();
        resolve(trimmed.length > 0 ? trimmed : null);
      });
      rl.once("close", () => resolve(null));
    });
  };
}

// 1.8.0-beta.6: assemble the fetcher used for the Strapi adapters. When
// the site is marked `requiresBearerToken: true`, wrap the underlying
// fetch with the auth-fetcher (Bearer injection + auto-refresh). Falls
// back to the plain JSON fetcher otherwise.
function buildAuthenticatedFetcher({ siteConfig, secretsPath, log }) {
  if (!siteConfig.requiresBearerToken) return defaultFetcher();
  const secrets = loadSecrets({ secretsPath });
  const initialToken = getSiteToken(secrets, siteConfig.name);
  const login = getSiteLogin(secrets, siteConfig.name);
  if (!initialToken && !login) {
    throw new Error(
      `site "${siteConfig.name}" requires a bearer token but none is configured. ` +
        `Add to ${secretsPath ?? "~/.filecap/secrets.json"}:\n` +
        `  credentials.${siteConfig.name}.bearerToken (string) for a static JWT\n` +
        `  credentials.${siteConfig.name}.bearerLogin { url, identifier, password } for auto-refresh\n` +
        `  or set ${(siteConfig.name).toUpperCase().replace(/-/g, "_")}_BEARER_TOKEN env var (env override)`,
    );
  }
  return createAuthFetcher({
    initialToken,
    login,
    baseFetcher: defaultFetcher(),
    persistToken: async (token) => {
      persistSiteToken({
        secretsPath: secretsPath ?? path.join(os.homedir(), ".filecap", "secrets.json"),
        serverName: siteConfig.name,
        newToken: token,
      });
    },
    promptForToken: ttyTokenPrompter(siteConfig.name),
    log,
  });
}

export async function runReferences({
  siteConfig,
  sitesJson,
  outputPath,
  fetcher: injectedFetcher,
  secretsPath,
  log = console.error,
}) {
  const refsCfg = siteConfig.references;
  // v1.8.0-beta.6: git-repo strategy has its own orchestrator (clone +
  // filesystem walk, no GraphQL). Branch before the Strapi dispatch.
  if (refsCfg?.strategy === "git-repo") {
    return runGitRepoReferences({
      siteConfig,
      sitesJson,
      outputPath,
      log,
    });
  }
  const adapter = STRATEGIES[refsCfg?.strategy];
  if (!adapter) {
    const known = [...Object.keys(STRATEGIES), "git-repo"].map((s) => `"${s}"`).join(", ");
    throw new Error(
      `site "${siteConfig.name}": references.strategy must be one of ${known} (got ${JSON.stringify(refsCfg?.strategy)})`,
    );
  }
  const isV4 = refsCfg.strategy === "strapi-v4";
  const fetcher = injectedFetcher ?? buildAuthenticatedFetcher({
    siteConfig,
    secretsPath,
    log,
  });
  const fleetDomainSet = buildFleetDomainSet(sitesJson);

  log(
    `[references] discovering content types via ${refsCfg.graphqlEndpoint} (${refsCfg.strategy})`,
  );
  // v1.39.0 (B4) — pass log so unpairable-type WARNs reach the operator.
  const contentTypes = await adapter.introspectContentTypes(
    refsCfg.graphqlEndpoint,
    fetcher,
    { log },
  );
  log(
    `[references] ${contentTypes.length} content types: ${contentTypes.map((c) => c.singular).join(", ")}`,
  );
  // v1.39.0 (B1) — zero discovered types on a strapi site means the schema
  // fetch "worked" but produced nothing usable; writing an empty sidecar
  // would mark every file on the site an orphan. Fail loudly instead.
  if (contentTypes.length === 0) {
    throw new Error(
      `site "${siteConfig.name}": content-type discovery returned 0 content types from ${refsCfg.graphqlEndpoint}. ` +
        `Likely causes: expired/missing bearer token or GraphQL introspection disabled. ` +
        `Refusing to write an empty sidecar.`,
    );
  }

  const sidecarRecords = [];
  // v1.39.0 (B1) — track per-type failures: all-failed is a hard error,
  // partial failures stay WARN-and-continue but are surfaced in the summary.
  const attemptedTypes = contentTypes.length;
  let failedTypes = 0;

  // v1.29.0 — the classifier needs the discovered content-type names to tell
  // relations (skip — enumerated independently) from embedded components
  // (walk — their files exist nowhere else). Pascal-case to match GraphQL
  // type naming.
  const contentTypeNames = new Set(
    contentTypes.map(({ singular }) => singular.charAt(0).toUpperCase() + singular.slice(1)),
  );

  for (const { singular, plural, singleType } of contentTypes) {
    const pascalCt = singular.charAt(0).toUpperCase() + singular.slice(1);
    let classifiedFields;
    try {
      classifiedFields = await adapter.introspectTypeFields(
        refsCfg.graphqlEndpoint,
        pascalCt,
        fetcher,
        { contentTypeNames },
      );
    } catch (err) {
      log(`[references] WARN: failed to introspect ${pascalCt}: ${err.message}`);
      failedTypes++;
      continue;
    }

    // v3 REST path: kebab-case the camelCase plural (`requiredForms` →
    // `/required-forms`). v4 REST path: plural as-is (`/api/biographies`
    // works directly; observed v4 sites have no camelCase content types).
    // v1.39.0 (B4) — v4 single types (plural: null) fetch /api/<singular>;
    // fetchAllEntries retries the kebab-cased form on 404 either way.
    const restPath = isV4
      ? (singleType ? singular : plural)
      : plural.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    // v1.29.0 — v4's populate=* doesn't reach media INSIDE components; tell
    // fetchAllEntries which fields need deep population. v3 embeds
    // everything in the REST payload and ignores these options.
    const componentFields = classifiedFields
      .filter((f) => f.kind === "component" || f.kind === "component-list")
      .map((f) => f.fieldName);
    const mediaFields = classifiedFields
      .filter((f) => f.kind === "upload-file" || f.kind === "upload-file-list")
      .map((f) => f.fieldName);
    let entries;
    try {
      entries = await adapter.fetchAllEntries(refsCfg.restApiBase, restPath, fetcher, {
        componentFields,
        mediaFields,
      });
    } catch (err) {
      log(`[references] WARN: failed to fetch ${restPath}: ${err.message}`);
      failedTypes++;
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
      // v1.65.0 — the whole entry goes in, not just the slug: a route may
      // interpolate any of the entry's fields (ARI meetings nest under a
      // committee segment derived from `category`).
      const pageUrl = resolvePageUrl({
        contentType: singular,
        entry,
        isV4,
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

  // v1.39.0 (B1) — every attempted type failed: nothing was extracted, so
  // the sidecar would be empty (all files → false orphans). Hard error.
  if (attemptedTypes > 0 && failedTypes === attemptedTypes) {
    throw new Error(
      `site "${siteConfig.name}": all ${attemptedTypes} content types failed to fetch — ` +
        `refusing to write an empty sidecar (check token/permissions/REST paths)`,
    );
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const ndjson = sidecarRecords.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await fs.writeFile(outputPath, ndjson);
  const failNote =
    failedTypes > 0 ? ` (${failedTypes}/${attemptedTypes} types failed)` : "";
  log(
    `[references] wrote ${sidecarRecords.length} sidecar records to ${outputPath}${failNote}`,
  );
  return { entriesProcessed: sidecarRecords.length, outputPath };
}
