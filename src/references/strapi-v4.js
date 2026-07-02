// Strapi v4 GraphQL/REST adapter for the references step.
//
// Three responsibilities, mirroring strapi-v3.js but adapted to v4's
// envelope conventions:
//   1. Discover content types from the GraphQL schema (introspectContentTypes).
//      v4 doesn't have *Connection paginators; we look for singular/plural
//      pairs and skip the system tables (uploadFile*, usersPermissions*, etc.).
//   2. (Field classification reuses ../field-classifier.js, which understands
//      both v3's `UploadFile` and v4's `UploadFileEntityResponse` /
//      `UploadFileRelationResponseCollection` envelope names.)
//   3. Paginate via /api/<plural> with bracket params and extract URLs per
//      entry, unwrapping the v4 `attributes` envelope and the typed media
//      `data.attributes.url` wrapper.

import { canonicalizeUrl } from "./url-canonical.js";
import { extractFileUrls, isAuditedFileUrl } from "./extract-urls.js";
import { collectComponentFileUrls } from "./component-walk.js";
import {
  introspectTypeFields as introspectTypeFieldsV3,
  assertGraphqlResponseOk,
} from "./strapi-v3.js";
import { pluralCandidatesFor } from "./pluralize.js";

// Strapi v4's bare content-type (e.g. `Post`) exposes the same shape of
// __type fields as v3 — only the typed media wrapper names differ
// (UploadFileEntityResponse / UploadFileRelationResponseCollection), and the
// shared field-classifier already understands both. So we reuse v3's
// introspection function verbatim.
export const introspectTypeFields = introspectTypeFieldsV3;

// System/auth fields exposed by every v4 schema. None are content types we
// want to enumerate.
const SYSTEM_FIELDS = new Set([
  "uploadFile",
  "uploadFiles",
  "uploadFolder",
  "uploadFolders",
  "i18NLocale",
  "i18NLocales",
  "usersPermissionsRole",
  "usersPermissionsRoles",
  "usersPermissionsUser",
  "usersPermissionsUsers",
  "me",
]);

const INTROSPECT_SCHEMA_QUERY =
  "{ __schema { queryType { fields { name } } } }";

export async function introspectContentTypes(graphqlEndpoint, fetcher) {
  const response = await fetcher(graphqlEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: INTROSPECT_SCHEMA_QUERY }),
  });
  // v1.39.0 (B1) — GraphQL errors / missing data throw (shared guard).
  assertGraphqlResponseOk(response, graphqlEndpoint);
  const names = (response?.data?.__schema?.queryType?.fields ?? []).map(
    (f) => f.name,
  );
  const set = new Set(names);
  const result = [];
  const claimed = new Set();
  // For each singular name, try English pluralization rules forward
  // (pluralize.js: irregular map + y/is/z/us/sxz/s) and pair it to
  // whichever plural exists in the schema. Set membership guards against
  // wrong guesses.
  for (const singular of names) {
    if (SYSTEM_FIELDS.has(singular)) continue;
    if (claimed.has(singular)) continue;
    const plural = pluralCandidatesFor(singular).find((p) => set.has(p));
    if (!plural) continue;
    if (SYSTEM_FIELDS.has(plural)) continue;
    result.push({ singular, plural });
    claimed.add(plural);
  }
  // v1.39.0 (B4) — a v4 singular with no plural partner is a SINGLE TYPE
  // (homepage, about, config): its content lives at /api/<name> and can
  // carry file links, so dropping it produces false orphans. Names-only
  // introspection cannot distinguish a single type from a custom resolver,
  // so every unpaired non-system name is attempted; junk names 404 into
  // the orchestrator's per-type WARN. Post-pass, because a plural can be
  // iterated before the singular that claims it (faqs before faq).
  const pairedSingulars = new Set(result.map((r) => r.singular));
  for (const name of names) {
    if (SYSTEM_FIELDS.has(name)) continue;
    if (pairedSingulars.has(name) || claimed.has(name)) continue;
    result.push({ singular: name, plural: null, singleType: true });
  }
  return result;
}

function kebabize(name) {
  return name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

function buildPageUrl(base, plural, limit, start, populateParams) {
  return (
    `${base}/api/${plural}` +
    `?pagination%5Blimit%5D=${limit}` +
    `&pagination%5Bstart%5D=${start}` +
    `&${populateParams}`
  );
}

// v1.29.0 — populate=* reaches one level only: a component comes back
// WITHOUT its inner media. When the classifier found component fields,
// ask for populate[<field>][populate]=* per component (one level inside),
// keeping plain media fields populated explicitly. With no field lists
// the legacy populate=* is preserved.
//
// v1.39.0 (B11) — KNOWN DEPTH LIMIT: populate[<field>][populate]=* reaches
// exactly ONE level inside each component. Media nested a level deeper
// (a sub-component's file, e.g. dynamicZone → block → download.file) is
// NOT populated and its links are invisible to extraction. Going deeper
// requires the sub-components' field names, which our __type introspection
// does not provide — and guessing (populate[a][populate][b][populate]=*)
// risks 400s on every fetch, so we deliberately do not. Nor is the miss
// detectable at walk time: an unpopulated relation key is simply ABSENT
// from the REST JSON (indistinguishable from a component with no media
// field), while a populated-but-empty one is `data: null`. If a fleet site
// ever nests media two components deep, this is the comment to revisit.
function buildPopulateParams(componentFields, mediaFields) {
  const comps = Array.isArray(componentFields) ? componentFields : [];
  const media = Array.isArray(mediaFields) ? mediaFields : [];
  if (comps.length === 0 && media.length === 0) return "populate=%2A";
  const enc = encodeURIComponent;
  const parts = [];
  for (const f of media) parts.push(`populate${enc(`[${f}]`)}=%2A`);
  for (const f of comps) parts.push(`populate${enc(`[${f}]`)}${enc("[populate]")}=%2A`);
  return parts.join("&");
}

// v1.39.0 (B9) — decide whether the server has more records after this page,
// trusting the response's meta.pagination when present (both the start/limit/
// total and page/pageSize/pageCount shapes). Returns null when meta is absent
// or unrecognizable so the caller can fall back to stop-on-EMPTY-page. A
// SHORT page never ends the walk by itself: Strapi caps page sizes
// server-side (maxLimit), so short pages occur mid-stream.
function hasMorePages(meta, fetchedCount) {
  const p = meta?.pagination;
  if (!p || typeof p !== "object") return null;
  if (Number.isFinite(p.total)) return fetchedCount < p.total;
  if (Number.isFinite(p.page) && Number.isFinite(p.pageCount)) {
    return p.page < p.pageCount;
  }
  return null;
}

export async function fetchAllEntries(restApiBase, plural, fetcher, options = {}) {
  const limit = options.limit ?? 100;
  // FC-2026-031: hard cap on iterations. See strapi-v3.js for rationale.
  const maxPages = options.maxPages ?? 10_000;
  const base = restApiBase.replace(/\/+$/, "");
  const populateParams = buildPopulateParams(
    options.componentFields,
    options.mediaFields,
  );

  // Strapi v4's REST `pluralName` isn't derivable from the GraphQL plural —
  // observed in the wild: weeklyFaqs → /api/weekly-faqs (kebab wins),
  // v2Weeklyfaqs → /api/v2Weeklyfaqs (camelCase wins). On a 404 for the
  // GraphQL form, retry the first request once with the kebab-cased
  // alternative before failing. Non-404 errors (403 permissions, network)
  // are not retried — kebab won't change the outcome.
  let pluralToUse = plural;
  let response;
  try {
    response = await fetcher(buildPageUrl(base, pluralToUse, limit, 0, populateParams));
  } catch (err) {
    const kebab = kebabize(plural);
    if (/HTTP 404/.test(err.message) && kebab !== plural) {
      response = await fetcher(buildPageUrl(base, kebab, limit, 0, populateParams));
      pluralToUse = kebab;
    } else {
      throw err;
    }
  }

  const out = [];
  let start = 0;
  let pages = 1; // first page already fetched above
  while (true) {
    const raw = response?.data;
    // v1.39.0 (B4) — single types answer with `data` as an OBJECT; normalize
    // to a one-entry array (data: null → empty) so extraction is shared.
    const data = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object"
        ? [raw]
        : [];
    if (data.length === 0) break;
    for (const entry of data) out.push(entry);
    if (!Array.isArray(raw)) break; // single-entry object: nothing to paginate
    // v1.39.0 (B9) — trust meta.pagination when present; without it, stop
    // only on an EMPTY page (a short page is a maxLimit cap, not the end).
    if (hasMorePages(response?.meta, out.length) === false) break;
    // Advance by the records RECEIVED, not the requested limit — a capped
    // server returns short pages and advancing by limit would skip records.
    start += data.length;
    if (++pages > maxPages) {
      throw new Error(
        `fetchAllEntries: exceeded maxPages=${maxPages} for ${pluralToUse} (FC-2026-031 guard)`,
      );
    }
    response = await fetcher(buildPageUrl(base, pluralToUse, limit, start, populateParams));
  }
  return out;
}

// Resolve a possibly-relative upload URL to an absolute one using restApiBase.
function resolveUploadUrl(rawUrl, restApiBase) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return null;
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  if (rawUrl.startsWith("/")) {
    return restApiBase.replace(/\/+$/, "") + rawUrl;
  }
  return null;
}

export function extractEntryUrls(entry, classifiedFields, restApiBase) {
  if (!entry || typeof entry !== "object") return [];
  if (!Array.isArray(classifiedFields)) return [];
  const attributes = entry.attributes;
  if (!attributes || typeof attributes !== "object") return [];

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
    const value = attributes[fieldName];
    if (value === null || value === undefined) continue;

    if (kind === "url-string" && typeof value === "string") {
      // v1.39.0 (B7) — url-string fields carry page links too; only audited
      // file URLs may enter referencedFiles.
      if (isAuditedFileUrl(value)) addCandidate(value);
    } else if (kind === "body-string" && typeof value === "string") {
      // v1.29.0 — baseUrl resolves root-relative "/uploads/x.pdf" body links
      // against the API host, where Strapi serves uploads.
      for (const u of extractFileUrls(value, { baseUrl: restApiBase })) addCandidate(u);
    } else if (kind === "upload-file" && typeof value === "object") {
      // v4 single-media envelope: { data: { id, attributes: { url } } }
      const inner = value.data;
      if (inner && typeof inner === "object" && inner.attributes) {
        addCandidate(resolveUploadUrl(inner.attributes.url, restApiBase));
      }
    } else if (kind === "upload-file-list" && typeof value === "object") {
      // v4 list-media envelope: { data: [{ id, attributes: { url } }, ...] }
      // Observed in fleet: empty list can come back as `data: null` (infonet)
      // or `data: []` (dvfr) — both must be safe.
      const inner = value.data;
      if (Array.isArray(inner)) {
        for (const item of inner) {
          if (item && typeof item === "object" && item.attributes) {
            addCandidate(resolveUploadUrl(item.attributes.url, restApiBase));
          }
        }
      }
    } else if (kind === "component" || kind === "component-list") {
      // v1.29.0 — walk the embedded component value; the recursive walk
      // peels v4's data/attributes media envelope by shape.
      const urls = collectComponentFileUrls(value, {
        resolveUploadUrl: (raw) => resolveUploadUrl(raw, restApiBase),
        extractText: (text) => extractFileUrls(text, { baseUrl: restApiBase }),
      });
      for (const u of urls) addCandidate(u);
    }
    // relation, other → skipped
  }
  return out;
}
