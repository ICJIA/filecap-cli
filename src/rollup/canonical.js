/**
 * Pick the canonical entry from a list of content-duplicate entries.
 * The canonical entry is the one with the oldest `modifiedAt`. Ties are
 * broken alphabetically by `serverName`.
 *
 * @param {Array<{serverName: string, modifiedAt: string}>} entries
 * @returns {object} the canonical entry (a reference to one of the inputs)
 */
export function pickCanonical(entries) {
  if (!entries || entries.length === 0) {
    throw new Error("pickCanonical: input must contain at least one entry");
  }
  let canonical = entries[0];
  for (let i = 1; i < entries.length; i++) {
    const e = entries[i];
    if (e.modifiedAt < canonical.modifiedAt) {
      canonical = e;
    } else if (e.modifiedAt === canonical.modifiedAt && e.serverName < canonical.serverName) {
      canonical = e;
    }
  }
  return canonical;
}
