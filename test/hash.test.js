import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { hashFile } from "../src/scanner/hash.js";

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-hash-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("hashFile", () => {
  it("hashes an empty file to the SHA-256 of empty bytes", async () => {
    const file = path.join(tmpRoot, "empty.txt");
    await fs.writeFile(file, "");
    const digest = await hashFile(file);
    expect(digest).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("hashes 'hello' to the known SHA-256 digest", async () => {
    const file = path.join(tmpRoot, "hello.txt");
    await fs.writeFile(file, "hello");
    const digest = await hashFile(file);
    expect(digest).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("produces stable digests across runs for the same content", async () => {
    const file = path.join(tmpRoot, "stable.txt");
    await fs.writeFile(file, "stable content goes here");
    const a = await hashFile(file);
    const b = await hashFile(file);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
