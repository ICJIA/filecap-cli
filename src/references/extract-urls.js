// File-URL regex extraction from arbitrary text (markdown body, HTML, plain
// prose). Captures http/https URLs whose path ends in one of the file
// extensions that filecap audits, plus optional query string. Stops the URL
// at common terminators (whitespace, quotes, angle brackets, closing paren or
// bracket, non-breaking space) so trailing punctuation in prose ("see
// foo.pdf.") doesn't get glued onto the URL.
const FILE_URL_RE =
  /https?:\/\/[^\s"'<>)\] ]+?\.(?:pdf|docx?|xlsx?|pptx?|zip)(?:\?[^\s"'<>)\] ]*)?/gi;

export function extractFileUrls(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const matches = text.match(FILE_URL_RE);
  if (!matches) return [];
  const seen = new Set();
  const result = [];
  for (const m of matches) {
    if (!seen.has(m)) {
      seen.add(m);
      result.push(m);
    }
  }
  return result;
}
