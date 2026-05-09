import { humanizeBytes } from "./format.js";
import { FILECAP_VERSION } from "../version.js";

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
      bullets.push(`${imageOnlyCount} of ${pdfCount} PDFs are image-only — these need OCR before remediation`);
    }
    if (taggedCount === 0) {
      bullets.push(`No PDFs are tagged — all ${pdfCount} need structural tagging`);
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

  lines.push("filecap audit summary");
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
    lines.push(`Server:           ${serverName}${serverIp ? ` (${serverIp})` : ""}`);
    lines.push(`Source location:  ${scannedPath}`);
    lines.push(`Audit date:       ${auditDate}`);
  }
  if (durationMs !== null && Number.isFinite(durationMs)) {
    const secs = (durationMs / 1000).toFixed(1);
    lines.push(`Audit duration:   ${secs}s`);
  }
  lines.push("");

  // ── The numbers ─────────────────────────────────────────────────────────────
  const totalFiles = entries.length;
  const totalBytes = entries.reduce((s, e) => s + (e.sizeBytes ?? 0), 0);
  const remediableCount = entries.filter((e) => e.remediable).length;
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
  lines.push(`  Files needing remediation:  ${remediableCount} (${pct(remediableCount, totalFiles)} of total)`);
  lines.push(`  Files not requiring work:   ${notRemediable}`);
  lines.push(`  Unique files:               ${uniqueCount}`);
  lines.push(`  Duplicate copies:           ${duplicateCount}`);
  lines.push(`  Bytes saved if deduped:     ${humanizeBytes(duplicateBytes)}`);
  lines.push("");

  // ── Per-server breakdown (consolidated only) ─────────────────────────────────
  if (isConsolidated && sources && sources.length > 0) {
    const srvStats = new Map();
    for (const s of sources) {
      srvStats.set(s.serverName, {
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
      if (!srvStats.has(name)) srvStats.set(name, { ip: "", files: 0, bytes: 0, remediable: 0, pdfs: 0, imageOnly: 0 });
      const s = srvStats.get(name);
      s.files++;
      s.bytes += e.sizeBytes ?? 0;
      if (e.remediable) s.remediable++;
      if (e.category === "pdf") s.pdfs++;
      if (e.introspection?.kind === "pdf" && e.introspection.isImageOnly === true) s.imageOnly++;
    }

    const C = [22, 18, 8, 12, 12, 8, 16];
    const hr = "─".repeat(C.reduce((a, b) => a + b + 2, 0) + 2);

    lines.push("Per-server breakdown");
    lines.push("--------------------");
    lines.push(
      "  " +
      padR("Server", C[0]) + "  " +
      padR("IP", C[1]) + "  " +
      padL("Files", C[2]) + "  " +
      padL("Size", C[3]) + "  " +
      padL("Needs remed.", C[4]) + "  " +
      padL("PDFs", C[5]) + "  " +
      padL("Image-only PDFs", C[6])
    );
    lines.push("  " + hr);

    let tFiles = 0, tBytes = 0, tRem = 0, tPdfs = 0, tImgOnly = 0;
    for (const [name, s] of srvStats) {
      lines.push(
        "  " +
        padR(name, C[0]) + "  " +
        padR(s.ip, C[1]) + "  " +
        padL(s.files, C[2]) + "  " +
        padL(humanizeBytes(s.bytes), C[3]) + "  " +
        padL(s.remediable, C[4]) + "  " +
        padL(s.pdfs, C[5]) + "  " +
        padL(s.imageOnly, C[6])
      );
      tFiles += s.files; tBytes += s.bytes; tRem += s.remediable; tPdfs += s.pdfs; tImgOnly += s.imageOnly;
    }
    lines.push("  " + hr);
    lines.push(
      "  " +
      padR("Fleet totals", C[0]) + "  " +
      padR("", C[1]) + "  " +
      padL(tFiles, C[2]) + "  " +
      padL(humanizeBytes(tBytes), C[3]) + "  " +
      padL(tRem, C[4]) + "  " +
      padL(tPdfs, C[5]) + "  " +
      padL(tImgOnly, C[6])
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
  const avgPages = pdfCount > 0 ? (totalPages / pdfCount).toFixed(1) : "0";

  lines.push(`PDFs (${pdfCount} file${pdfCount !== 1 ? "s" : ""})`);
  lines.push("-".repeat(`PDFs (${pdfCount} file${pdfCount !== 1 ? "s" : ""})`.length));
  if (pdfCount === 0) {
    lines.push("  None in this audit.");
  } else {
    lines.push(`  Born-digital (text-based):    ${pdfWithIntro.filter((e) => !e.introspection.isImageOnly).length}`);
    lines.push(`  Image-only (needs OCR):       ${imageOnlyCount}`);
    lines.push(`  Already structurally tagged:  ${taggedCount}`);
    lines.push(`  Encrypted:                    ${encryptedPdfs}`);
    lines.push(`  Digitally signed:             ${signedPdfs}`);
    lines.push(`  Has form fields:              ${formPdfs}`);
    lines.push(`  Web-optimized (linearized):   ${linearizedPdfs}`);
    lines.push(`  Total pages across all PDFs:  ${totalPages}`);
    lines.push(`  Average pages per PDF:        ${avgPages}`);
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
    "archive", "text", "web", "audio-video", "other",
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
