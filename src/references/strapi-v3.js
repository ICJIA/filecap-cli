// Strapi v3 GraphQL/REST adapter for the references step.
//
// Three responsibilities:
//   1. Discover content types from the GraphQL schema (introspectContentTypes).
//   2. Classify each type's fields (introspectTypeFields → field-classifier).
//   3. Paginate through entries via REST and extract URLs per entry
//      (fetchAllEntries + extractEntryUrls).
//
// Each function takes an injectable `fetcher` so the HTTP-touching parts can
// be tested deterministically. In production, the orchestrator wraps the
// global fetch API with auth/retry/error-handling.

import { canonicalizeUrl } from "./url-canonical.js";
import { extractFileUrls } from "./extract-urls.js";
import { classifyField } from "./field-classifier.js";

// Auth/plugin query field names that aren't content types we want to
// enumerate. Files are excluded because the file inventory comes from
// filecap's filesystem scan, not from the upload plugin.
const NON_CONTENT_TYPE_FIELDS = new Set([
  "role",
  "user",
  "me",
  "files",
]);

const INTROSPECT_SCHEMA_QUERY =
  "{ __schema { queryType { fields { name } } } }";
const INTROSPECT_TYPE_QUERY = (name) =>
  `{ __type(name: "${name}") { fields { name type { name kind ofType { name kind } } } } }`;

export async function introspectContentTypes(graphqlEndpoint, fetcher) {
  const response = await fetcher(graphqlEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: INTROSPECT_SCHEMA_QUERY }),
  });
  const names = (response?.data?.__schema?.queryType?.fields ?? []).map(
    (f) => f.name,
  );
  const set = new Set(names);
  // Strapi v3 exposes three query fields per content type:
  //   - singular (e.g. `county`)
  //   - plural (e.g. `counties`)            ← Strapi's pluralizer handles
  //                                            irregular forms; we cannot
  //                                            reliably derive this from the
  //                                            singular alone (county→countys
  //                                            would 404).
  //   - paginated (e.g. `countiesConnection`)
  //
  // We use the *Connection name to derive the actual plural (strip
  // "Connection"), then pair it back to a singular by trying common
  // English pluralization rules in reverse — `+s`, `+es`, `y→ies`. This
  // catches county/counties, policy/policies, etc. while still working
  // for the regular grant/grants case.
  const result = [];
  for (const name of names) {
    if (!name.endsWith("Connection")) continue;
    const plural = name.slice(0, -"Connection".length);
    if (NON_CONTENT_TYPE_FIELDS.has(plural)) continue;
    // Find the singular by reversing common English pluralization rules
    let singular = null;
    if (plural.endsWith("ies") && set.has(plural.slice(0, -3) + "y")) {
      singular = plural.slice(0, -3) + "y";
    } else if (plural.endsWith("es") && set.has(plural.slice(0, -2))) {
      singular = plural.slice(0, -2);
    } else if (plural.endsWith("s") && set.has(plural.slice(0, -1))) {
      singular = plural.slice(0, -1);
    }
    if (!singular) continue;
    if (NON_CONTENT_TYPE_FIELDS.has(singular)) continue;
    result.push({ singular, plural });
  }
  return result;
}

export async function introspectTypeFields(graphqlEndpoint, typeName, fetcher) {
  // GraphQL type names are pascal-case ("Grant"), query field names are
  // camel-case ("grant"). Caller passes whichever convention they prefer; we
  // pascal-case the first letter here defensively in case a query-field-name
  // was handed in (cheap; no harm if already pascal).
  const pascalName = typeName.charAt(0).toUpperCase() + typeName.slice(1);
  const response = await fetcher(graphqlEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: INTROSPECT_TYPE_QUERY(pascalName) }),
  });
  const fields = response?.data?.__type?.fields ?? [];
  return fields.map(classifyField);
}

export async function fetchAllEntries(restApiBase, contentType, fetcher, options = {}) {
  const limit = options.limit ?? 100;
  // FC-2026-031: hard cap on iterations. 10k pages × default limit 100 =
  // 1M entries — well past any realistic Strapi instance, but a hard
  // guarantee that a runaway loop (misconfigured site, broken pagination,
  // hostile fixture) terminates rather than OOMing the operator.
  const maxPages = options.maxPages ?? 10_000;
  const out = [];
  let start = 0;
  let pages = 0;
  while (true) {
    if (++pages > maxPages) {
      throw new Error(
        `fetchAllEntries: exceeded maxPages=${maxPages} for ${contentType} (FC-2026-031 guard)`,
      );
    }
    const url = `${restApiBase.replace(/\/+$/, "")}/${contentType}?_limit=${limit}&_start=${start}`;
    const page = await fetcher(url);
    if (!Array.isArray(page) || page.length === 0) break;
    for (const entry of page) out.push(entry);
    if (page.length < limit) break;
    start += limit;
  }
  return out;
}

// Build the absolute URL for a typed UploadFile value. Strapi v3 stores the
// `.url` either as a fully-qualified URL or as a path beginning with `/`. The
// latter is resolved against the configured REST API base.
function resolveUploadUrl(rawUrl, restApiBase) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return null;
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  if (rawUrl.startsWith("/")) {
    return restApiBase.replace(/\/+$/, "") + rawUrl;
  }
  // Unknown relative form — skip rather than misroute
  return null;
}

export function extractEntryUrls(entry, classifiedFields, restApiBase) {
  if (!entry || !Array.isArray(classifiedFields)) return [];
  const seen = new Set();
  const out = [];
  const addCandidate = (raw) => {
    const canonical = canonicalizeUrl(raw);
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      out.push(canonical);
    }
  };

  for (const { kind, fieldName } of classifiedFields) {
    const value = entry[fieldName];
    if (value === null || value === undefined) continue;

    if (kind === "url-string" && typeof value === "string") {
      addCandidate(value);
    } else if (kind === "body-string" && typeof value === "string") {
      for (const u of extractFileUrls(value)) addCandidate(u);
    } else if (kind === "upload-file" && typeof value === "object") {
      addCandidate(resolveUploadUrl(value.url, restApiBase));
    } else if (kind === "upload-file-list" && Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") {
          addCandidate(resolveUploadUrl(item.url, restApiBase));
        }
      }
    }
    // relation, other → skipped
  }
  return out;
}
