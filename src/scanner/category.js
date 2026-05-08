const EXTENSION_MAP = {
  pdf: "pdf",

  doc: "office-document",
  docx: "office-document",
  rtf: "office-document",
  odt: "office-document",

  xls: "spreadsheet",
  xlsx: "spreadsheet",
  ods: "spreadsheet",

  ppt: "presentation",
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

const REMEDIABLE_CATEGORIES = new Set([
  "pdf",
  "office-document",
  "spreadsheet",
  "presentation",
]);

export function categorize(extension) {
  const key = (extension ?? "").toLowerCase();
  return EXTENSION_MAP[key] ?? "other";
}

export function isRemediable(category) {
  return REMEDIABLE_CATEGORIES.has(category);
}
