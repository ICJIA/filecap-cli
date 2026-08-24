import { describe, it, expect } from "vitest";
import { humanizeBytes, csvCell, safeAbsolutePath } from "../src/report/format.js";

describe("humanizeBytes", () => {
  it("formats common sizes", () => {
    expect(humanizeBytes(0)).toBe("0 B");
    expect(humanizeBytes(512)).toBe("512 B");
    expect(humanizeBytes(1024)).toBe("1.0 KB");
    expect(humanizeBytes(1536)).toBe("1.5 KB");
    expect(humanizeBytes(1024 * 1024)).toBe("1.0 MB");
    expect(humanizeBytes(4827193)).toBe("4.6 MB");
    expect(humanizeBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
    expect(humanizeBytes(1024 * 1024 * 1024 * 1024)).toBe("1.0 TB");
  });
});

describe("csvCell", () => {
  it("returns the value as-is when it has no special chars", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(true)).toBe("true");
  });

  it("returns empty string for null/undefined", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes and escapes values with commas, quotes, or newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  // 1.7.36 — fixes 2026-05-13 audit finding #1.
  describe("CSV formula-injection defense", () => {
    it("prefixes leading `=` with a single quote so Excel doesn't evaluate the cell", () => {
      // No `,\n\r"` in the input so no CSV-quote wrapping; just the
      // OWASP apostrophe-prefix.
      expect(csvCell("=cmd|'/c calc'!A1.pdf")).toBe("'=cmd|'/c calc'!A1.pdf");
    });

    it("prefixes leading `+` `-` `@` `\\t` with a single quote (no CSV-quote wrap needed)", () => {
      expect(csvCell("+SUM(1+1)")).toBe("'+SUM(1+1)");
      expect(csvCell("-2+3+cmd")).toBe("'-2+3+cmd");
      expect(csvCell("@DDE")).toBe("'@DDE");
      expect(csvCell("\tmalicious")).toBe("'\tmalicious");
    });

    it("prefixes leading `\\r` and ALSO CSV-quote-wraps (because `\\r` triggers wrapping)", () => {
      expect(csvCell("\rmalicious")).toBe('"\'\rmalicious"');
    });

    it("does NOT prefix benign cells that merely contain `=` mid-string", () => {
      expect(csvCell("a=b")).toBe("a=b");
      expect(csvCell("path/to/file=v2.pdf")).toBe("path/to/file=v2.pdf");
    });

    it("leaves deliberate Excel text-formula cells (SHA-256 hash) intact so Excel still renders the hash without scientific-notation munging", () => {
      // The hash cell wraps the hex string as `="<hash>"`. This pattern
      // is allow-listed because the bytes inside the quotes come from
      // filecap's own scanner, not from filenames.
      expect(csvCell('="abc123def456"')).toBe('"=""abc123def456"""');
    });

    it("a hostile filename crafted as an Excel-text-formula-with-trailing-garbage is still defanged", () => {
      // The trusted pattern requires the WHOLE cell to be `="..."` with
      // nothing else. A filename like `="hostile".pdf` doesn't match
      // and gets the apostrophe prefix.
      expect(csvCell('="hostile".pdf')).toBe(`"'=""hostile"".pdf"`);
    });
  });
});

describe("safeAbsolutePath (FC-2026-035)", () => {
  it("keeps an http(s) absolutePath (a git site's GitHub URL)", () => {
    expect(safeAbsolutePath("https://github.com/ICJIA/x/tree/main/a.pdf")).toBe("https://github.com/ICJIA/x/tree/main/a.pdf");
    expect(safeAbsolutePath("http://example.com/a")).toBe("http://example.com/a");
  });
  it("blanks a filesystem path (a Strapi/Forge server path) and nullish input", () => {
    expect(safeAbsolutePath("/home/forge/agency.icjia-api.cloud/agency-api/public/uploads/x.pdf")).toBe("");
    expect(safeAbsolutePath("/var/strapi/uploads/case.pdf")).toBe("");
    expect(safeAbsolutePath(null)).toBe("");
    expect(safeAbsolutePath(undefined)).toBe("");
  });
});
