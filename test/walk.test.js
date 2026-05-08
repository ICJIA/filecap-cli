import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { walk } from "../src/scanner/walk.js";

let tmpRoot;

async function collect(asyncIterable) {
  const out = [];
  for await (const item of asyncIterable) {
    out.push(item);
  }
  return out;
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-walk-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("walk", () => {
  it("yields nothing for an empty directory", async () => {
    const items = await collect(walk(tmpRoot));
    expect(items).toEqual([]);
  });

  it("yields one file for a single-file directory", async () => {
    const filePath = path.join(tmpRoot, "hello.txt");
    await fs.writeFile(filePath, "hi");
    const items = await collect(walk(tmpRoot));
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ kind: "file", path: filePath });
  });

  it("recurses into subdirectories", async () => {
    await fs.mkdir(path.join(tmpRoot, "sub", "deep"), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, "a.txt"), "a");
    await fs.writeFile(path.join(tmpRoot, "sub", "b.txt"), "b");
    await fs.writeFile(path.join(tmpRoot, "sub", "deep", "c.txt"), "c");

    const items = await collect(walk(tmpRoot));
    const paths = items.filter((i) => i.kind === "file").map((i) => i.path).sort();
    expect(paths).toEqual([
      path.join(tmpRoot, "a.txt"),
      path.join(tmpRoot, "sub", "b.txt"),
      path.join(tmpRoot, "sub", "deep", "c.txt"),
    ]);
  });

  it("skips symlinks", async () => {
    const target = path.join(tmpRoot, "real.txt");
    const link = path.join(tmpRoot, "link.txt");
    await fs.writeFile(target, "real");
    await fs.symlink(target, link);

    const items = await collect(walk(tmpRoot));
    const filePaths = items.filter((i) => i.kind === "file").map((i) => i.path);
    expect(filePaths).toContain(target);
    expect(filePaths).not.toContain(link);
  });

  it("yields an error item when a directory is unreadable but continues with siblings", async () => {
    if (process.platform === "win32") return;
    const blocked = path.join(tmpRoot, "blocked");
    const sibling = path.join(tmpRoot, "ok");
    await fs.mkdir(blocked);
    await fs.mkdir(sibling);
    await fs.writeFile(path.join(blocked, "secret.txt"), "secret");
    await fs.writeFile(path.join(sibling, "fine.txt"), "fine");
    await fs.chmod(blocked, 0o000);

    try {
      const items = await collect(walk(tmpRoot));
      const errors = items.filter((i) => i.kind === "error");
      const files = items.filter((i) => i.kind === "file");
      expect(errors.length).toBe(1);
      expect(errors[0].code).toBe("EACCES");
      expect(files.map((f) => f.path)).toContain(path.join(sibling, "fine.txt"));
    } finally {
      await fs.chmod(blocked, 0o700);
    }
  });
});
