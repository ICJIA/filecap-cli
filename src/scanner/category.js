const EXTENSION_MAP = {
  pdf: "pdf",

  // v1.39.0: legacy binary Office formats (.doc/.xls/.ppt) get their own
  // category — they need conversion before remediation, so the reports price
  // them separately. Old cached inventories still carry them under the
  // office-document/spreadsheet/presentation categories; every consumer
  // keeps accepting both categorizations.
  doc: "legacy-office",
  docx: "office-document",
  rtf: "office-document",
  odt: "office-document",

  xls: "legacy-office",
  xlsx: "spreadsheet",
  ods: "spreadsheet",

  ppt: "legacy-office",
  pptx: "presentation",
  odp: "presentation",

  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  bmp: "image",
  tif: "image",
  tiff: "image",
  svg: "image",
  webp: "image",
  ico: "image",
  heic: "image",
  heif: "image",

  zip: "archive",
  tar: "archive",
  gz: "archive",
  bz2: "archive",
  "7z": "archive",
  rar: "archive",

  txt: "text",
  md: "text",
  csv: "text",
  tsv: "text",
  json: "text",
  xml: "text",
  yaml: "text",
  yml: "text",

  html: "web",
  htm: "web",

  mp3: "audio-video",
  wav: "audio-video",
  ogg: "audio-video",
  flac: "audio-video",
  m4a: "audio-video",
  mp4: "audio-video",
  mov: "audio-video",
  avi: "audio-video",
  mkv: "audio-video",
  webm: "audio-video",
};

// v1.40.0 — THE canonical set. summary.js, web-rollup, and the detail page's
// client script all import/emit this — the five hand-kept copies had already
// drifted (one still carried the phantom "office-legacy" synonym).
export const REMEDIABLE_CATEGORIES = new Set([
  "pdf",
  "office-document",
  "spreadsheet",
  "presentation",
  "legacy-office",
]);

export function categorize(extension) {
  const key = (extension ?? "").toLowerCase();
  return EXTENSION_MAP[key] ?? "other";
}

export function isRemediable(category) {
  return REMEDIABLE_CATEGORIES.has(category);
}
