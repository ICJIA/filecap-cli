import { describe, it, expect } from "vitest";
import { collectComponentFileUrls } from "../src/references/component-walk.js";

// The resolver/extractor pair the Strapi adapters bind in production:
// relative /uploads/... resolves against the API base; strings run through
// extract-urls. Tests use simple stand-ins to keep assertions readable.
const resolveUploadUrl = (raw) => {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return "https://api.example.gov" + raw;
  return null;
};
const extractText = (text) =>
  (text.match(/https?:\/\/\S+\.pdf/g) ?? []).map((u) => u);

const helpers = { resolveUploadUrl, extractText };

describe("collectComponentFileUrls", () => {
  it("collects a v3 single-file component (SPAC publication shape)", () => {
    const value = {
      _id: "abc",
      name: "Report",
      file: {
        name: "2019_Projection.pdf",
        ext: ".pdf",
        mime: "application/pdf",
        url: "/uploads/2019_Projection.pdf",
      },
    };
    expect(collectComponentFileUrls(value, helpers)).toEqual([
      "https://api.example.gov/uploads/2019_Projection.pdf",
    ]);
  });

  it("collects a v3 repeatable component with file lists (SPAC meeting shape)", () => {
    const value = [
      { name: "Agenda", file: [{ url: "/uploads/agenda.pdf", ext: ".pdf" }] },
      { name: "Minutes", file: [{ url: "/uploads/minutes.pdf", ext: ".pdf" }] },
    ];
    expect(collectComponentFileUrls(value, helpers)).toEqual([
      "https://api.example.gov/uploads/agenda.pdf",
      "https://api.example.gov/uploads/minutes.pdf",
    ]);
  });

  it("collects v4 envelope media inside a component", () => {
    const value = {
      id: 1,
      file: {
        data: {
          id: 7,
          attributes: {
            url: "/uploads/v4_doc.docx",
            mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            name: "v4_doc.docx",
          },
        },
      },
    };
    expect(collectComponentFileUrls(value, helpers)).toEqual([
      "https://api.example.gov/uploads/v4_doc.docx",
    ]);
  });

  it("runs the text extractor over string fields inside components", () => {
    const value = {
      heading: "Downloads",
      body: "See https://files.example.gov/x.pdf for details.",
    };
    expect(collectComponentFileUrls(value, helpers)).toEqual([
      "https://files.example.gov/x.pdf",
    ]);
  });

  it("does NOT collect link-style components without a file signal", () => {
    // An external-link component has url+name but no mime/ext/hash — treating
    // it as an upload would fabricate refs to arbitrary pages.
    const value = { url: "/about/contact", name: "Contact us" };
    expect(collectComponentFileUrls(value, helpers)).toEqual([]);
  });

  it("dedupes repeated URLs and skips null resolutions", () => {
    const value = [
      { file: { url: "/uploads/a.pdf", ext: ".pdf" } },
      { file: { url: "/uploads/a.pdf", ext: ".pdf" } },
      { file: { url: "ftp://nope/a.pdf", ext: ".pdf" } },
    ];
    expect(collectComponentFileUrls(value, helpers)).toEqual([
      "https://api.example.gov/uploads/a.pdf",
    ]);
  });

  it("returns [] for scalars, null, and depth overruns", () => {
    expect(collectComponentFileUrls(null, helpers)).toEqual([]);
    expect(collectComponentFileUrls("just a string with no urls", helpers)).toEqual([]);
    let deep = { file: { url: "/uploads/deep.pdf", ext: ".pdf" } };
    for (let i = 0; i < 12; i++) deep = { nest: deep };
    expect(collectComponentFileUrls(deep, helpers)).toEqual([]);
  });
});
