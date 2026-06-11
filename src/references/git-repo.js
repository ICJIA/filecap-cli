// Git-repo references adapter for type:"git" Nuxt static-site fleet entries.
//
// Two-step pipeline (mirroring the Strapi adapters' shape but adapted to a
// filesystem walk instead of GraphQL/REST):
//   1. Shallow-clone the site's gitRepo to a temp dir (handled by the
//      orchestrator — this module accepts a directory path).
//   2. Walk content/*.md, extract file URLs from each markdown body, map
//      each file's path to the deployed page URL via Nuxt Content's default
//      routing convention (content/<rest>.md → /<rest>; index.md → /).
//
// The module is intentionally narrow: it does not extract URLs from .vue or
// .html templates yet. Most of the audit-relevant references on the ICJIA
// Nuxt sites live in content/ markdown bodies; SPA-template hardcoded links
// are a future enhancement.

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { canonicalizeUrl } from "./url-canonical.js";
import { extractFileUrls } from "./extract-urls.js";
import { buildFleetDomainSet, isFleetUrl } from "./domain-filter.js";

// Content roots the walker understands, in lookup order:
//   content/      — Nuxt Content convention (VPP, ILHEALS)
//   src/content/  — Astro content collections (SFS)
// For the Astro root, a leading "pages/" collection segment is stripped —
// the convention observed on the ICJIA Astro sites is src/pages/[slug].astro
// rendering getCollection("pages") at the site root. Other collections keep
// their segment (src/content/docs/x.md → /docs/x).
const CONTENT_ROOTS = [
  { prefix: "content/", stripPagesSegment: false },
  { prefix: "src/content/", stripPagesSegment: true },
];

// v1.29.0 — page-template roots (.astro / .vue), routed by file path the
// same way frameworks do: src/pages/research.astro → /research. SFS's only
// real file links live in template hrefs, not markdown. Dynamic-segment
// templates ([slug].astro) have no concrete URL and are skipped.
const TEMPLATE_ROOTS = ["src/pages/", "app/pages/", "pages/"];
const TEMPLATE_EXT_RE = /\.(?:astro|vue)$/;

// Map a content-relative markdown file path to its deployed URL using the
// routing convention of whichever content root it lives under. Files outside
// a known root, non-markdown files, and files under any _-prefixed directory
// (Nuxt Content's "hidden" marker) return null.
export function deriveContentUrl(filePath, siteFrontendUrl) {
  if (typeof filePath !== "string" || typeof siteFrontendUrl !== "string") {
    return null;
  }
  // Normalise Windows-style backslashes
  const norm = filePath.replace(/\\/g, "/");
  const root = CONTENT_ROOTS.find((r) => norm.startsWith(r.prefix));
  if (!root) return null;
  // Must be a markdown file
  if (!norm.endsWith(".md")) return null;
  // Strip root prefix + .md suffix
  let rel = norm.slice(root.prefix.length, -".md".length);
  if (root.stripPagesSegment && (rel === "pages" || rel.startsWith("pages/"))) {
    rel = rel === "pages" ? "" : rel.slice("pages/".length);
  }
  // index → empty (root)
  if (rel === "index") rel = "";
  if (rel.endsWith("/index")) rel = rel.slice(0, -"/index".length);
  // Hidden directories (any segment starting with _)
  if (rel.split("/").some((seg) => seg.startsWith("_"))) return null;

  const base = siteFrontendUrl.replace(/\/+$/, "");
  if (rel === "") return `${base}/`;
  return `${base}/${rel}`;
}

// Map a page-template path (src/pages/research.astro, pages/about.vue) to
// its deployed URL via file-based routing. Returns null for non-template
// paths, dynamic segments ("[slug]"), and _-prefixed (hidden) segments.
export function deriveTemplateUrl(filePath, siteFrontendUrl) {
  if (typeof filePath !== "string" || typeof siteFrontendUrl !== "string") {
    return null;
  }
  const norm = filePath.replace(/\\/g, "/");
  const root = TEMPLATE_ROOTS.find((r) => norm.startsWith(r));
  if (!root) return null;
  if (!TEMPLATE_EXT_RE.test(norm)) return null;
  let rel = norm.slice(root.length).replace(TEMPLATE_EXT_RE, "");
  if (rel === "index") rel = "";
  if (rel.endsWith("/index")) rel = rel.slice(0, -"/index".length);
  const segments = rel === "" ? [] : rel.split("/");
  if (segments.some((seg) => seg.startsWith("_") || seg.includes("["))) return null;

  const base = siteFrontendUrl.replace(/\/+$/, "");
  if (rel === "") return `${base}/`;
  return `${base}/${rel}`;
}

// Recursively yield every content file the adapter understands: .md under
// each content root, .astro/.vue under each template root. Returns absolute
// paths plus the repo-relative path (content/foo/bar.md form) and the file
// kind so extraction can branch. Repos usually have exactly one root of
// each kind; walking all keeps the adapter framework-agnostic.
async function* walkContentFiles(repoDir) {
  async function* recurse(dir, matchFn) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        yield* recurse(abs, matchFn);
      } else if (ent.isFile() && matchFn(ent.name)) {
        const rel = path.relative(repoDir, abs).replace(/\\/g, "/");
        yield { abs, rel };
      }
    }
  }
  async function statDir(prefix) {
    const dir = path.join(repoDir, ...prefix.replace(/\/$/, "").split("/"));
    try {
      const stat = await fs.stat(dir);
      return stat.isDirectory() ? dir : null;
    } catch {
      return null;
    }
  }
  for (const root of CONTENT_ROOTS) {
    const dir = await statDir(root.prefix);
    if (!dir) continue;
    for await (const f of recurse(dir, (n) => n.endsWith(".md"))) {
      yield { ...f, kind: "markdown" };
    }
  }
  // "pages/" is a prefix of nothing else here, but "src/pages/" must not be
  // walked twice when both spellings resolve — track visited dirs.
  const seenDirs = new Set();
  for (const root of TEMPLATE_ROOTS) {
    const dir = await statDir(root);
    if (!dir || seenDirs.has(dir)) continue;
    seenDirs.add(dir);
    for await (const f of recurse(dir, (n) => TEMPLATE_EXT_RE.test(n))) {
      yield { ...f, kind: "template" };
    }
  }
}

// Walk repoDir/content/, extract file URLs from each markdown file, return
// one sidecar-style record per file. Records preserve the same shape the
// Strapi adapters emit:
//   { contentType, entryId, slug, pageUrl, referencedFiles }
// `slug` carries the content-relative path so the cross-resolver can
// distinguish "content/index.md" from a Strapi entry's slug field — git
// content has no notion of a slug per se, but the path is a stable
// identifier that makes the sidecar inspectable.
// Shallow-clone a git repository to a unique temp directory. Returns the
// path. Caller is responsible for cleanup (via fs.rm(..., { recursive: true }))
// — typically wrapped in a try/finally in the orchestrator.
export async function cloneRepoShallow(gitUrl) {
  if (typeof gitUrl !== "string" || gitUrl.length === 0) {
    throw new Error("cloneRepoShallow: gitUrl is required");
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-gitrefs-"));
  // execFileSync with no shell interpolation — gitUrl was schema-validated
  // upstream (sites.json gitRepo field). --depth 1 is the standard
  // shallow-clone pattern used elsewhere in filecap (audit-static.sh).
  execFileSync("git", ["clone", "--depth", "1", "--quiet", gitUrl, tmp], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  return tmp;
}

// Top-level orchestrator for the git-repo strategy. Shallow-clones the
// configured gitRepo, walks content/ for markdown, filters extracted URLs
// to the fleet domain whitelist, writes a sidecar NDJSON matching the
// shape commands/cross-references.js consumes, and cleans up the clone.
//
// Sidecar record shape:
//   { siteName, contentType, entryId, slug, pageUrl, referencedFiles }
//
// pageUrl is derived from the content/ path (Nuxt Content convention).
// entryId is the same as slug here (the content-relative path) — there's
// no Strapi numeric ID, but the path is stable and inspectable.
export async function runGitRepoReferences({
  siteConfig,
  sitesJson,
  outputPath,
  log = console.error,
}) {
  if (siteConfig?.type !== "git" || typeof siteConfig.gitRepo !== "string") {
    throw new Error(
      `site "${siteConfig?.name}": git-repo references requires type:"git" + gitRepo field`,
    );
  }
  const fleetDomainSet = buildFleetDomainSet(sitesJson);
  const frontendUrl = siteConfig.references?.siteFrontendUrl ?? siteConfig.siteUrl ?? "";

  log(`[references] cloning ${siteConfig.gitRepo} (--depth 1)`);
  const cloneDir = await cloneRepoShallow(siteConfig.gitRepo);
  let records;
  try {
    log(`[references] walking content/ markdown in ${cloneDir}`);
    const entries = await extractMarkdownEntries(cloneDir, frontendUrl);
    log(`[references] ${entries.length} markdown files; filtering URLs by fleet domain set`);
    records = entries
      .map((e) => ({
        siteName: siteConfig.name,
        contentType: e.contentType,
        entryId: e.entryId,
        slug: e.slug,
        pageUrl: e.pageUrl,
        referencedFiles: e.referencedFiles.filter((u) => isFleetUrl(u, fleetDomainSet)),
      }))
      // Template records exist only to carry refs; one whose links were all
      // off-fleet (external PDFs) is dropped (see extractMarkdownEntries).
      .filter((r) => r.contentType !== "template" || r.referencedFiles.length > 0);
  } finally {
    // Best-effort cleanup. If git left a partial clone we still want to
    // remove the tempdir to avoid leaking tmp space across runs.
    try {
      await fs.rm(cloneDir, { recursive: true, force: true });
    } catch (err) {
      log(`[references] WARN: failed to remove clone dir ${cloneDir}: ${err.message}`);
    }
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const ndjson = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await fs.writeFile(outputPath, ndjson);
  log(`[references] wrote ${records.length} sidecar records to ${outputPath}`);
  return { entriesProcessed: records.length, outputPath };
}

export async function extractMarkdownEntries(repoDir, siteFrontendUrl) {
  const out = [];
  for await (const { abs, rel, kind } of walkContentFiles(repoDir)) {
    const body = await fs.readFile(abs, "utf8");
    // v1.29.0 — baseUrl resolves root-relative links ("/files/x.pdf") against
    // the deployed site, where public/ files are served from the root.
    const rawUrls = extractFileUrls(body, { baseUrl: siteFrontendUrl });
    const seen = new Set();
    const refs = [];
    for (const u of rawUrls) {
      const canonical = canonicalizeUrl(u);
      if (canonical && !seen.has(canonical)) {
        seen.add(canonical);
        refs.push(canonical);
      }
    }
    if (kind === "template") {
      // Templates exist here only to carry file references — every page
      // also reaches the Page view via the sitemap, so a no-files template
      // record would be pure noise (404.astro, search pages, …).
      if (refs.length === 0) continue;
      const pageUrl = deriveTemplateUrl(rel, siteFrontendUrl);
      if (!pageUrl) continue; // dynamic [slug] templates have no concrete URL
      out.push({
        contentType: "template",
        entryId: rel,
        slug: rel,
        pageUrl,
        referencedFiles: refs,
      });
      continue;
    }
    out.push({
      contentType: "markdown",
      entryId: rel,
      slug: rel,
      pageUrl: deriveContentUrl(rel, siteFrontendUrl),
      referencedFiles: refs,
    });
  }
  return out;
}
