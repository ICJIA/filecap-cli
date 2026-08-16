// v1.47.0 — invisible / system-specific files are repo and OS plumbing
// (.gitkeep holds an empty directory open in git; .DS_Store is Finder
// litter; .env.sample is deploy scaffolding), not content anyone uploaded
// for the public. Counting them inflated every "files on this site" number
// by noise — the 2026-08-16 fleet carried 25 of them (14 .DS_Store,
// 9 .gitkeep, 2 .gitignore).
//
// The exclusion is applied at inventory-READ time (web-rollup's summary /
// aggregation loops + runReport's parse), not at scan time, so existing
// cached scans are cleaned up retroactively without re-scanning 13 sites.
// The scan caches still record the files — only the audit surfaces skip
// them.

// Non-dotfile OS droppings, matched case-insensitively by exact name.
const SYSTEM_BASENAMES = new Set(["thumbs.db", "desktop.ini"]);

/**
 * Is this filename repo/OS plumbing rather than uploaded content?
 * Any dotfile counts (.gitkeep, .gitignore, .env.sample, .DS_Store,
 * .htaccess, …), plus the well-known non-dot names above.
 *
 * @param {string|null|undefined} filename - basename, not a path
 * @returns {boolean}
 */
export function isSystemFile(filename) {
  const name = String(filename ?? "");
  if (!name) return false;
  if (name.startsWith(".")) return true;
  return SYSTEM_BASENAMES.has(name.toLowerCase());
}
