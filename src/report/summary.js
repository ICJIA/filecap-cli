import { humanizeBytes } from "./format.js";
import { FILECAP_VERSION } from "../version.js";

// ── Category classification ────────────────────────────────────────────────────
// REMEDIABLE: the file itself can be fixed for accessibility
// NON-REMEDIABLE: alt text lives in the CMS schema, not in the file
import { REMEDIABLE_CATEGORIES } from "../scanner/category.js";

function isRemediableCategory(cat) {
  return REMEDIABLE_CATEGORIES.has(cat);
}

/**
 * Build the "AUDIT SCOPE / OTHER FILES" block that opens the summary.
 * Exported separately so tests can exercise it in isolation.
 *
 * @param {Array} entries
 * @returns {string} multi-line text (no trailing newline)
 */
export function buildAuditScopeBlock(entries) {
  const lines = [];

  // Gather counts
  const pdfCount    = entries.filter((e) => e.category === "pdf").length;
  const officeCount = entries.filter((e) => e.category === "office-document").length;
  const spreadsheetCount = entries.filter((e) => e.category === "spreadsheet").length;
  const presentationCount = entries.filter((e) => e.category === "presentation").length;
  const legacyCount = entries.filter((e) => e.category === "legacy-office").length;
  const remediableCount = pdfCount + officeCount + spreadsheetCount + presentationCount + legacyCount;

  const imageCount = entries.filter((e) => e.category === "image").length;
  const textCount  = entries.filter((e) => e.category === "text" || e.category === "web").length;
  const otherCount = entries.filter((e) => !isRemediableCategory(e.category) && e.category !== "image" && e.category !== "text" && e.category !== "web").length;
  const nonRemediableCount = entries.length - remediableCount;

  const W = 66; // total width of box lines
  const DLINE = "═".repeat(W);
  const SLINE = "─".repeat(W);
  const DCOUNT_LABEL = "  AUDIT SCOPE — files that may need accessibility remediation:";
  const OCOUNT_LABEL = "  OTHER FILES (no direct remediation in the file itself):";

  // AUDIT SCOPE box
  lines.push(DLINE);
  lines.push(`${DCOUNT_LABEL.padEnd(W - String(remediableCount).length - 1)}${remediableCount}`);
  lines.push(DLINE);
  lines.push("");
  lines.push(`  ${"PDFs".padEnd(32)}${padL(pdfCount, 5)}    (may need structural tagging,`);
  lines.push(`  ${"".padEnd(37)}alt text on images, heading`);
  lines.push(`  ${"".padEnd(37)}structure, etc.)`);
  lines.push(`  ${"Word documents (.docx)".padEnd(32)}${padL(officeCount, 5)}    (may need heading styles, table`);
  lines.push(`  ${"".padEnd(37)}header rows, alt text, etc.)`);
  lines.push(`  ${"Excel files (.xlsx)".padEnd(32)}${padL(spreadsheetCount, 5)}`);
  lines.push(`  ${"PowerPoint (.pptx)".padEnd(32)}${padL(presentationCount, 5)}`);
  lines.push(`  ${"Legacy Office (.doc/.xls)".padEnd(32)}${padL(legacyCount, 5)}    (may need conversion + remediation)`);
  lines.push(`  ${"".padEnd(32)}${"────"}`);
  lines.push(`  ${"Total that may need work:".padEnd(32)}${padL(remediableCount, 5)}    ← THIS IS THE AUDIT WORKLOAD`);
  lines.push("");

  // OTHER FILES divider
  lines.push(SLINE);
  lines.push(`${OCOUNT_LABEL.padEnd(W - String(nonRemediableCount).length - 1)}${nonRemediableCount}`);
  lines.push(SLINE);
  lines.push("");
  lines.push(`  ${"Images (.jpg, .png, .gif,".padEnd(32)}${padL(imageCount, 5)}    (alt text lives in the CMS`);
  lines.push(`  ${"         .webp, .svg)".padEnd(37)}schema, not in the image file)`);
  lines.push(`  ${"Text files (.txt, .md)".padEnd(32)}${padL(textCount, 5)}`);
  lines.push(`  ${"Other / placeholders".padEnd(32)}${padL(otherCount, 5)}    (e.g., .gitkeep — empty Git`);
  lines.push(`  ${"".padEnd(37)}placeholder, can be ignored)`);
  lines.push(`  ${"".padEnd(32)}${"────"}`);
  lines.push(`  ${"Total non-remediation:".padEnd(32)}${padL(nonRemediableCount, 5)}`);

  return lines.join("\n");
}

/**
 * Right-pad or left-pad a string to fixed width.
 */
function padR(s, w) {
  return String(s).padEnd(w);
}
function padL(s, w) {
  return String(s).padStart(w);
}

/**
 * Format a fraction as a percentage string, e.g. 0.75 → "75%".
 */
function pct(n, total) {
  if (!total || !Number.isFinite(n)) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

/**
 * Build the "What this means" observation bullets based on aggregate data.
 */
function buildObservations(data) {
  const bullets = [];
  const { pdfCount, imageOnlyCount, taggedCount, docxCount, docxNoHeadings, tableBadCount, vagueLinkTotal, legacyCounts } = data;

  if (pdfCount > 0) {
    if (imageOnlyCount === 0) {
      bullets.push(`All ${pdfCount} PDFs are text-based — no OCR needed (good news, OCR is expensive)`);
    } else {
      bullets.push(`${imageOnlyCount} of ${pdfCount} PDFs are image-only — these may need OCR before remediation`);
    }
    if (taggedCount === 0) {
      bullets.push(`No PDFs are tagged — all ${pdfCount} may need structural tagging`);
    } else if (taggedCount < pdfCount) {
      bullets.push(`${pdfCount - taggedCount} of ${pdfCount} PDFs lack structural tags`);
    }
  }

  if (docxCount > 0) {
    if (docxNoHeadings > 0) {
      bullets.push(`${docxNoHeadings} Word doc${docxNoHeadings !== 1 ? "s" : ""} lack heading styles — need restructuring`);
    }
    if (tableBadCount > 0) {
      bullets.push(`${tableBadCount} Word doc table${tableBadCount !== 1 ? "s" : ""} need header rows`);
    }
    if (vagueLinkTotal > 0) {
      bullets.push(`${vagueLinkTotal} vague hyperlink${vagueLinkTotal !== 1 ? "s" : ""} across the Word docs — review for descriptive text`);
    }
  }

  const legacyTotal = (legacyCounts.doc ?? 0) + (legacyCounts.xls ?? 0) + (legacyCounts.ppt ?? 0);
  if (legacyTotal > 0) {
    bullets.push(`${legacyTotal} legacy Office file${legacyTotal !== 1 ? "s" : ""} (.doc/.xls/.ppt) need manual review or conversion`);
  }

  return bullets;
}

/**
 * Build audit-summary.txt content from a parsed inventory.
 *
 * @param {object} args
 * @param {Array} args.entries
 * @param {Array|null} args.sources
 * @param {object|null} args.header - the raw header object
 * @param {number|null} args.durationMs
 * @param {string|null} args.outputPath
 * @returns {string} multi-line text
 */
export function writeSummary({ entries, sources, header = null, durationMs = null }) {
  const lines = [];

  lines.push("ICJIA Fleet Audit Assessment — audit summary");
  lines.push("=====================");
  lines.push("");

  const isConsolidated = header?.kind === "filecap-consolidated-header";
  const meta = header?.metadata ?? {};

  if (isConsolidated) {
    lines.push(`Audit date:       ${(meta.consolidatedAt ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10)}`);
    lines.push(`Servers audited:  ${(sources ?? []).length}`);
  } else {
    const serverName = meta.serverName ?? "";
    const serverIp = meta.serverIp ?? "";
    const scannedPath = meta.scannedPath ?? "";
    const auditDate = (meta.scannedAt ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    const siteName = meta.siteName ?? "";
    if (siteName !== "") {
      lines.push(`Website:          ${siteName}`);
    }
    lines.push(`Server:           ${serverName}${serverIp ? ` (${serverIp})` : ""}`);
    lines.push(`Source location:  ${scannedPath}`);
    lines.push(`Audit date:       ${auditDate}`);
  }
  lines.push("");

  // ── AUDIT SCOPE / OTHER FILES block ──────────────────────────────────────────
  lines.push(buildAuditScopeBlock(entries));
  lines.push("");

  // ── Totals footer for the scope block ────────────────────────────────────────
  const totalFiles = entries.length;
  const totalBytes = entries.reduce((s, e) => s + (e.sizeBytes ?? 0), 0);
  const remediableCount = entries.filter((e) => isRemediableCategory(e.category ?? "other")).length;
  const nonRemediableCount = totalFiles - remediableCount;
  lines.push(`  Total files inventoried:   ${totalFiles}    (${remediableCount} + ${nonRemediableCount})`);
  lines.push(`  Total bytes:                ${humanizeBytes(totalBytes)}`);
  if (durationMs !== null && Number.isFinite(durationMs)) {
    const secs = (durationMs / 1000).toFixed(1);
    lines.push(`  Audit duration:             ${secs}s`);
  }
  lines.push("");

  // ── The numbers ─────────────────────────────────────────────────────────────
  const notRemediable = totalFiles - remediableCount;

  // Duplicate analysis
  const seenHashes = new Map();
  let duplicateCount = 0;
  let duplicateBytes = 0;
  for (const e of entries) {
    if (!e.sha256 || e.sha256 === "") continue;
    if (seenHashes.has(e.sha256)) {
      duplicateCount++;
      duplicateBytes += e.sizeBytes ?? 0;
    } else {
      seenHashes.set(e.sha256, e);
    }
  }
  const uniqueCount = totalFiles - duplicateCount;

  lines.push("The numbers");
  lines.push("-----------");
  lines.push(`  Total files:                ${totalFiles}`);
  lines.push(`  Total size:                 ${humanizeBytes(totalBytes)}`);
  lines.push(`  Files that may need remediation:  ${remediableCount} (${pct(remediableCount, totalFiles)} of total)`);
  lines.push(`  Files that may not need work:     ${notRemediable}`);
  lines.push(`  Unique files:               ${uniqueCount}`);
  lines.push(`  Duplicate copies:           ${duplicateCount}`);
  lines.push(`  Bytes saved if deduped:     ${humanizeBytes(duplicateBytes)}`);
  lines.push("");

  // ── Per-server breakdown (consolidated only) ─────────────────────────────────
  if (isConsolidated && sources && sources.length > 0) {
    // Build a map from serverName → siteName for the per-server table
    const siteNameByServer = new Map();
    for (const s of sources) {
      siteNameByServer.set(s.serverName, s.siteName ?? "");
    }

    const srvStats = new Map();
    for (const s of sources) {
      srvStats.set(s.serverName, {
        site: s.siteName ?? "",
        ip: s.serverIp ?? "",
        files: 0,
        bytes: 0,
        remediable: 0,
        pdfs: 0,
        imageOnly: 0,
      });
    }
    for (const e of entries) {
      const name = e.serverName ?? "";
      if (!srvStats.has(name)) srvStats.set(name, { site: siteNameByServer.get(name) ?? "", ip: "", files: 0, bytes: 0, remediable: 0, pdfs: 0, imageOnly: 0 });
      const s = srvStats.get(name);
      s.files++;
      s.bytes += e.sizeBytes ?? 0;
      if (e.remediable) s.remediable++;
      if (e.category === "pdf") s.pdfs++;
      if (e.introspection?.kind === "pdf" && e.introspection.isImageOnly === true) s.imageOnly++;
    }

    const C = [14, 22, 18, 8, 12, 12, 8, 16];
    const hr = "─".repeat(C.reduce((a, b) => a + b + 2, 0) + 2);

    lines.push("Per-server breakdown");
    lines.push("--------------------");
    lines.push(
      "  " +
      padR("Site", C[0]) + "  " +
      padR("Server", C[1]) + "  " +
      padR("IP", C[2]) + "  " +
      padL("Files", C[3]) + "  " +
      padL("Size", C[4]) + "  " +
      padL("Needs remed.", C[5]) + "  " +
      padL("PDFs", C[6]) + "  " +
      padL("Image-only PDFs", C[7])
    );
    lines.push("  " + hr);

    let tFiles = 0, tBytes = 0, tRem = 0, tPdfs = 0, tImgOnly = 0;
    for (const [name, s] of srvStats) {
      lines.push(
        "  " +
        padR(s.site, C[0]) + "  " +
        padR(name, C[1]) + "  " +
        padR(s.ip, C[2]) + "  " +
        padL(s.files, C[3]) + "  " +
        padL(humanizeBytes(s.bytes), C[4]) + "  " +
        padL(s.remediable, C[5]) + "  " +
        padL(s.pdfs, C[6]) + "  " +
        padL(s.imageOnly, C[7])
      );
      tFiles += s.files; tBytes += s.bytes; tRem += s.remediable; tPdfs += s.pdfs; tImgOnly += s.imageOnly;
    }
    lines.push("  " + hr);
    lines.push(
      "  " +
      padR("", C[0]) + "  " +
      padR("Fleet totals", C[1]) + "  " +
      padR("", C[2]) + "  " +
      padL(tFiles, C[3]) + "  " +
      padL(humanizeBytes(tBytes), C[4]) + "  " +
      padL(tRem, C[5]) + "  " +
      padL(tPdfs, C[6]) + "  " +
      padL(tImgOnly, C[7])
    );
    lines.push("");
  }

  // ── PDFs ─────────────────────────────────────────────────────────────────────
  const pdfEntries = entries.filter((e) => e.category === "pdf");
  const pdfCount = pdfEntries.length;
  const pdfWithIntro = pdfEntries.filter((e) => e.introspection?.kind === "pdf");
  const imageOnlyCount = pdfWithIntro.filter((e) => e.introspection.isImageOnly === true).length;
  const taggedCount = pdfWithIntro.filter((e) => e.introspection.hasTags === true).length;
  const encryptedPdfs = pdfWithIntro.filter((e) => e.introspection.encrypted === true).length;
  const signedPdfs = pdfWithIntro.filter((e) => e.introspection.hasSignatures === true).length;
  const formPdfs = pdfWithIntro.filter((e) => e.introspection.hasFormFields === true).length;
  const linearizedPdfs = pdfWithIntro.filter((e) => e.introspection.isLinearized === true).length;
  const totalPages = pdfWithIntro.reduce((s, e) => s + (e.introspection.pageCount ?? 0), 0);
  // v1.39.0: the average divides by the PDFs that actually carry a measured
  // pageCount, not all PDFs — dividing by pdfCount silently understated the
  // per-document workload whenever introspection skipped files (size cap,
  // parse failures). The label says "(measured)" and, when coverage is
  // partial, how many of the PDFs the number is based on.
  const pdfMeasured = pdfWithIntro.filter((e) => typeof e.introspection.pageCount === "number").length;
  const avgPages = pdfMeasured > 0 ? (totalPages / pdfMeasured).toFixed(1) : "0";
  const avgPagesNote = pdfMeasured < pdfCount ? ` (${pdfMeasured} of ${pdfCount} PDFs measured)` : "";

  lines.push(`PDFs (${pdfCount} file${pdfCount !== 1 ? "s" : ""})`);
  lines.push("-".repeat(`PDFs (${pdfCount} file${pdfCount !== 1 ? "s" : ""})`.length));
  if (pdfCount === 0) {
    lines.push("  None in this audit.");
  } else {
    lines.push(`  Born-digital (text-based):    ${pdfWithIntro.filter((e) => !e.introspection.isImageOnly).length}`);
    lines.push(`  Image-only (may need OCR):    ${imageOnlyCount}`);
    lines.push(`  Already structurally tagged:  ${taggedCount}`);
    lines.push(`  Encrypted:                    ${encryptedPdfs}`);
    lines.push(`  Digitally signed:             ${signedPdfs}`);
    lines.push(`  Has form fields:              ${formPdfs}`);
    lines.push(`  Web-optimized (linearized):   ${linearizedPdfs}`);
    lines.push(`  Total pages across all PDFs:  ${totalPages}`);
    lines.push(`  Average pages per PDF (measured): ${avgPages}${avgPagesNote}`);
  }
  lines.push("");

  // ── Word documents ────────────────────────────────────────────────────────────
  const docxEntries = entries.filter((e) => e.introspection?.kind === "docx");
  const docxCount = docxEntries.length;
  const docxWithHeadings = docxEntries.filter((e) => e.introspection.hasHeadings === true).length;
  const docxNoHeadings = docxCount - docxWithHeadings;
  const docxWithImages = docxEntries.filter((e) => (e.introspection.imageCount ?? 0) > 0).length;
  const altCoverages = docxEntries
    .filter((e) => typeof e.introspection.altTextCoverage === "number")
    .map((e) => e.introspection.altTextCoverage);
  const avgAlt = altCoverages.length > 0
    ? Math.round((altCoverages.reduce((a, b) => a + b, 0) / altCoverages.length) * 100)
    : 0;
  const docxWithTables = docxEntries.filter((e) => (e.introspection.tableCount ?? 0) > 0).length;
  const tablesWithoutHeaders = docxEntries.filter(
    (e) => (e.introspection.tableCount ?? 0) > 0 && e.introspection.tablesHaveHeaders === false
  ).length;
  const vagueLinkTotal = docxEntries.reduce((s, e) => s + (e.introspection.vagueLinkCount ?? 0), 0);
  const docxTotalWords = docxEntries.reduce((s, e) => s + (e.introspection.wordCount ?? 0), 0);

  lines.push(`Word documents (${docxCount} file${docxCount !== 1 ? "s" : ""})`);
  lines.push("-".repeat(`Word documents (${docxCount} file${docxCount !== 1 ? "s" : ""})`.length));
  if (docxCount === 0) {
    lines.push("  None in this audit.");
  } else {
    lines.push(`  With proper heading styles:   ${docxWithHeadings}`);
    lines.push(`  Without heading styles:       ${docxNoHeadings}`);
    lines.push(`  Documents with images:        ${docxWithImages}`);
    lines.push(`  Average alt-text coverage:    ${avgAlt}%`);
    lines.push(`  Documents with tables:        ${docxWithTables}`);
    lines.push(`  Tables without header rows:   ${tablesWithoutHeaders}`);
    lines.push(`  Total vague hyperlinks:       ${vagueLinkTotal}`);
    lines.push(`  Total word count:             ${docxTotalWords}`);
  }
  lines.push("");

  // ── Excel files ───────────────────────────────────────────────────────────────
  const xlsxEntries = entries.filter((e) => e.introspection?.kind === "xlsx");
  const xlsxCount = xlsxEntries.length;
  const xlsxMultiSheet = xlsxEntries.filter((e) => (e.introspection.sheetCount ?? 1) > 1).length;
  const xlsxMerged = xlsxEntries.filter((e) => (e.introspection.mergedCellCount ?? 0) > 0).length;
  const xlsxCharts = xlsxEntries.filter((e) => e.introspection.hasCharts === true).length;
  const xlsxImages = xlsxEntries.filter((e) => e.introspection.hasImages === true).length;
  const xlsxDefaultNames = xlsxEntries.filter((e) => (e.introspection.defaultSheetNameCount ?? 0) > 0).length;

  lines.push(`Excel files (${xlsxCount} file${xlsxCount !== 1 ? "s" : ""})`);
  lines.push("-".repeat(`Excel files (${xlsxCount} file${xlsxCount !== 1 ? "s" : ""})`.length));
  if (xlsxCount === 0) {
    lines.push("  None in this audit.");
  } else {
    lines.push(`  Multi-sheet:                  ${xlsxMultiSheet}`);
    lines.push(`  With merged cells:            ${xlsxMerged}`);
    lines.push(`  With charts:                  ${xlsxCharts}`);
    lines.push(`  With embedded images:         ${xlsxImages}`);
    lines.push(`  Sheets with default names:    ${xlsxDefaultNames}`);
  }
  lines.push("");

  // ── Legacy Office ─────────────────────────────────────────────────────────────
  const legacyEntries = entries.filter((e) => e.introspection?.kind === "office-legacy");
  const legacyCounts = { doc: 0, xls: 0, ppt: 0 };
  for (const e of legacyEntries) legacyCounts[e.introspection.format] = (legacyCounts[e.introspection.format] ?? 0) + 1;
  const legacyTotal = legacyEntries.length;

  lines.push(`Legacy Office files (${legacyTotal} file${legacyTotal !== 1 ? "s" : ""})`);
  lines.push("-".repeat(`Legacy Office files (${legacyTotal} file${legacyTotal !== 1 ? "s" : ""})`.length));
  if (legacyTotal === 0) {
    lines.push("  None in this audit.");
  } else {
    lines.push(`  .doc:                         ${legacyCounts.doc ?? 0}`);
    lines.push(`  .xls:                         ${legacyCounts.xls ?? 0}`);
    lines.push(`  .ppt:                         ${legacyCounts.ppt ?? 0}`);
  }
  lines.push("");

  // ── By file type ──────────────────────────────────────────────────────────────
  const byCategory = new Map();
  for (const e of entries) {
    const cat = e.category ?? "other";
    const cur = byCategory.get(cat) ?? { count: 0, bytes: 0 };
    cur.count++;
    cur.bytes += e.sizeBytes ?? 0;
    byCategory.set(cat, cur);
  }

  const ALL_CATEGORIES = [
    "pdf", "image", "office-document", "spreadsheet", "presentation",
    "legacy-office", "archive", "text", "web", "audio-video", "other",
  ];

  lines.push("By file type");
  lines.push("------------");
  for (const cat of ALL_CATEGORIES) {
    const stats = byCategory.get(cat);
    if (stats) {
      lines.push(`  ${padR(cat + ":", 22)} ${stats.count} file${stats.count !== 1 ? "s" : ""}, ${humanizeBytes(stats.bytes)}`);
    }
  }
  lines.push("");

  // ── Filename quality ──────────────────────────────────────────────────────────
  const flaggedFiles = entries.filter((e) => (e.flags ?? []).length > 0).length;
  const withSpaces = entries.filter((e) => (e.flags ?? []).includes("filename-has-spaces")).length;
  const withNonAscii = entries.filter((e) => (e.flags ?? []).includes("filename-non-ascii")).length;
  const withLongName = entries.filter((e) => (e.flags ?? []).includes("filename-long")).length;
  const withScannedPattern = entries.filter((e) => (e.flags ?? []).includes("scanned-name-pattern")).length;

  lines.push("Filename quality");
  lines.push("----------------");
  lines.push(`  Files with name issues:           ${flaggedFiles}`);
  lines.push(`  Files with spaces in name:        ${withSpaces}`);
  lines.push(`  Files with non-ASCII chars:       ${withNonAscii}`);
  lines.push(`  Files with very long names:       ${withLongName}`);
  lines.push(`  Files with scanned-name pattern:  ${withScannedPattern}`);
  lines.push("");

  // ── Largest files ─────────────────────────────────────────────────────────────
  const top5 = [...entries].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0)).slice(0, 5);
  lines.push("Largest files");
  lines.push("-------------");
  if (top5.length === 0) {
    lines.push("  None in this audit.");
  } else {
    top5.forEach((e, i) => {
      lines.push(`  ${i + 1}. ${e.filename}  (${humanizeBytes(e.sizeBytes ?? 0)})`);
    });
  }
  lines.push("");

  // ── What this means ───────────────────────────────────────────────────────────
  const observations = buildObservations({ pdfCount, imageOnlyCount, taggedCount, docxCount, docxNoHeadings, tableBadCount: tablesWithoutHeaders, vagueLinkTotal, legacyCounts });
  if (observations.length > 0) {
    lines.push("What this means for the audit");
    lines.push("-----------------------------");
    for (const obs of observations) {
      lines.push(`  - ${obs}`);
    }
    lines.push("");
  }

  lines.push(`Generated by @icjia/filecap v${FILECAP_VERSION}.`);

  return lines.join("\n") + "\n";
}
