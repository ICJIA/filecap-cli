import { describe, it, expect } from "vitest";
import { parseMetaTags, decodeEntities, fetchOgMeta, fetchImageBytes } from "../src/references/og-meta.js";

describe("parseMetaTags", () => {
  it("reads og:* / twitter:* by property or name, tolerant of attribute order + quotes", () => {
    const html = `<html><head>
      <meta property="og:title" content="Hello">
      <meta content="https://x/og.png" property="og:image">
      <meta name='twitter:image' content='https://x/tw.png'>
      <meta property="og:description" content="A &amp; B">
    </head></html>`;
    const m = parseMetaTags(html);
    expect(m["og:title"]).toBe("Hello");
    expect(m["og:image"]).toBe("https://x/og.png");
    expect(m["twitter:image"]).toBe("https://x/tw.png");
    expect(m["og:description"]).toBe("A &amp; B");
  });

  it("does not mistake data-content= for content=", () => {
    const m = parseMetaTags('<meta property="og:title" data-content="nope" content="yes">');
    expect(m["og:title"]).toBe("yes");
  });

  it("keeps the first occurrence of a key", () => {
    const m = parseMetaTags('<meta property="og:image" content="a"><meta property="og:image" content="b">');
    expect(m["og:image"]).toBe("a");
  });
});

describe("decodeEntities", () => {
  it("decodes numeric (dec + hex) and named entities", () => {
    expect(decodeEntities("A &amp; B &mdash; C &#39;x&#39; &#x2026;")).toBe("A & B — C 'x' …");
  });
  it("leaves unknown named entities intact", () => {
    expect(decodeEntities("keep &bogus; this")).toBe("keep &bogus; this");
  });
});

describe("fetchOgMeta", () => {
  const stub = (html, ok = true) => async () => ({ ok, text: async () => html });

  it("extracts image/title/description and resolves a relative og:image", async () => {
    const html = `<meta property="og:image" content="/img/og.png">
      <meta property="og:title" content="T &amp; T">
      <meta property="og:description" content="D">`;
    const r = await fetchOgMeta("https://site.example/page", { fetchImpl: stub(html) });
    expect(r.image).toBe("https://site.example/img/og.png");
    expect(r.title).toBe("T & T");
    expect(r.description).toBe("D");
    expect(r.reachable).toBe(true);
  });

  it("falls back to twitter:image when there is no og:image", async () => {
    const r = await fetchOgMeta("https://s.example", {
      fetchImpl: stub('<meta name="twitter:image" content="https://s.example/t.png">'),
    });
    expect(r.image).toBe("https://s.example/t.png");
  });

  it("marks reachable=true (no metadata) on a non-ok response, e.g. a gated 401", async () => {
    const r = await fetchOgMeta("https://s.example", { fetchImpl: stub("x", false) });
    expect(r).toEqual({ image: null, title: null, description: null, reachable: true });
  });

  it("returns reachable=false (never throws) on a fetch error / timeout", async () => {
    const r = await fetchOgMeta("https://s.example", { fetchImpl: async () => { throw new Error("net down"); } });
    expect(r).toEqual({ image: null, title: null, description: null, reachable: false });
  });

  it("rejects a non-http(s) URL without calling fetch", async () => {
    let called = false;
    const r = await fetchOgMeta("file:///etc/passwd", {
      fetchImpl: async () => { called = true; return { ok: true, text: async () => "" }; },
    });
    expect(called).toBe(false);
    expect(r.image).toBe(null);
  });
});

describe("fetchImageBytes", () => {
  const res = (ct, bytes, ok = true) => ({ ok, headers: { get: () => ct }, arrayBuffer: async () => bytes });

  it("returns ext + Buffer for an image content-type", async () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    const r = await fetchImageBytes("https://x/og", { fetchImpl: async () => res("image/png", buf) });
    expect(r.ext).toBe("png");
    expect(Buffer.isBuffer(r.buffer)).toBe(true);
    expect(r.buffer.length).toBe(3);
  });

  it("falls back to the URL extension when the content type is unhelpful", async () => {
    const r = await fetchImageBytes("https://x/photo.jpg?v=2", {
      fetchImpl: async () => res("application/octet-stream", new Uint8Array([1]).buffer),
    });
    expect(r.ext).toBe("jpg");
  });

  it("returns null over the size cap", async () => {
    const r = await fetchImageBytes("https://x/og.png", {
      maxBytes: 10,
      fetchImpl: async () => res("image/png", new Uint8Array(100).buffer),
    });
    expect(r).toBe(null);
  });

  it("returns null for a non-image with no usable extension", async () => {
    const r = await fetchImageBytes("https://x/page", {
      fetchImpl: async () => res("text/html", new Uint8Array([1]).buffer),
    });
    expect(r).toBe(null);
  });
});
