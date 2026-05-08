/**
 * Filename-based heuristic flags. Pure function, runs on every entry's
 * basename to populate the `flags[]` array. Output flags are returned
 * sorted alphabetically for stable CSV output.
 *
 * Flag values produced:
 *   - "scanned-name-pattern": filename matches scanner/photo/default-output
 *     conventions (Scan_*, IMG_*, Document\d+, Untitled*, all-digit, DOC\d+,
 *     FAX*, "Microsoft Word - *")
 *   - "filename-has-spaces": basename contains whitespace
 *   - "filename-non-ascii": basename contains non-ASCII characters
 *   - "filename-long": basename exceeds 200 characters
 */

const SCANNED_NAME_PATTERNS = [
  /^Scan[_ ]?\d/i,
  /^IMG[_ ]?\d/i,
  /^Document\d+/i,
  /^Untitled/i,
  /^DOC\d+/i,
  /^FAX[-_ ]?/i,
  /^Microsoft Word - /,
];

const ALL_DIGITS = /^\d+$/;
const HAS_SPACES = /\s/;
const NON_ASCII = /[^\x20-\x7E]/;
const LONG_THRESHOLD = 200;

export function computeFilenameFlags(filename) {
  if (!filename) return [];

  const lastDot = filename.lastIndexOf(".");
  const stem = lastDot > 0 ? filename.slice(0, lastDot) : filename;

  const flags = new Set();

  if (stem.length === 0) return [];

  if (
    SCANNED_NAME_PATTERNS.some((re) => re.test(stem)) ||
    ALL_DIGITS.test(stem)
  ) {
    flags.add("scanned-name-pattern");
  }
  if (HAS_SPACES.test(filename)) {
    flags.add("filename-has-spaces");
  }
  if (NON_ASCII.test(filename)) {
    flags.add("filename-non-ascii");
  }
  if (filename.length > LONG_THRESHOLD) {
    flags.add("filename-long");
  }

  return [...flags].sort();
}
