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

// Map a content-relative markdown file path to its deployed URL using Nuxt
// Content's default routing convention. Files outside content/, non-markdown
// files, and files under any _-prefixed directory (Nuxt Content's "hidden"
// marker) return null.
export function deriveContentUrl(filePath, siteFrontendUrl) {
  if (typeof filePath !== "string" || typeof siteFrontendUrl !== "string") {
    return null;
  }
  // Normalise Windows-style backslashes
  const norm = filePath.replace(/\\/g, "/");
  // Must live under content/
  if (!norm.startsWith("content/")) return null;
  // Must be a markdown file
  if (!norm.endsWith(".md")) return null;
  // Strip content/ prefix + .md suffix
  let rel = norm.slice("content/".length, -".md".length);
  // index → empty (root)
  if (rel === "index") rel = "";
  if (rel.endsWith("/index")) rel = rel.slice(0, -"/index".length);
  // Hidden directories (any segment starting with _)
  if (rel.split("/").some((seg) => seg.startsWith("_"))) return null;

  const base = siteFrontendUrl.replace(/\/+$/, "");
  if (rel === "") return `${base}/`;
  return `${base}/${rel}`;
}

// Recursively yield every .md file under <dir>/content/. Returns absolute
// paths plus the repo-relative path (content/foo/bar.md form) so the URL
// derivation can use a stable identifier.
async function* walkMarkdown(repoDir) {
  const contentDir = path.join(repoDir, "content");
  let stat;
  try { stat = await fs.stat(contentDir); } catch { stat = null; }
  if (!stat || !stat.isDirectory()) return;

  async function* recurse(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        yield* recurse(abs);
      } else if (ent.isFile() && ent.name.endsWith(".md")) {
        const rel = path.relative(repoDir, abs).replace(/\\/g, "/");
        yield { abs, rel };
      }
    }
  }
  yield* recurse(contentDir);
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
    records = entries.map((e) => ({
      siteName: siteConfig.name,
      contentType: e.contentType,
      entryId: e.entryId,
      slug: e.slug,
      pageUrl: e.pageUrl,
      referencedFiles: e.referencedFiles.filter((u) => isFleetUrl(u, fleetDomainSet)),
    }));
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
  for await (const { abs, rel } of walkMarkdown(repoDir)) {
    const body = await fs.readFile(abs, "utf8");
    const rawUrls = extractFileUrls(body);
    const seen = new Set();
    const refs = [];
    for (const u of rawUrls) {
      const canonical = canonicalizeUrl(u);
      if (canonical && !seen.has(canonical)) {
        seen.add(canonical);
        refs.push(canonical);
      }
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
