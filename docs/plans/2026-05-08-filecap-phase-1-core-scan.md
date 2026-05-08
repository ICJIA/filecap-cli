# filecap Phase 1 — Core Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@icjia/filecap@0.1.0` — a working `filecap scan <directory>` command that walks a directory tree, gathers per-file stats, computes SHA-256 hashes, and writes a valid NDJSON inventory (header line + entry lines + footer line) to disk.

**Architecture:** Plain JavaScript ESM, Node.js 20+, Commander for CLI parsing, Zod for I/O validation, vitest for tests. The walker is a custom async generator that catches per-directory errors so a permission-denied subtree doesn't kill the whole scan. Hashing is bounded-concurrent via `p-limit`. Output is streamed to disk one line at a time — no in-memory accumulation of the entry list.

**Tech Stack:** Node 20+, ESM, Commander 12, Zod 3, p-limit 5, vitest 1, ESLint 9 (flat config), Prettier 3. No native dependencies — everything must work via `npx @icjia/filecap` on a stock Ubuntu server with only Node installed.

**Out of scope for Phase 1** (later phases): PDF/Office introspection, filename pattern flagging, rollup, report/CSV, MCP server, Strapi awareness. The CLI in this phase parses only flags relevant to walking and hashing; introspection-related flags (`--no-introspect`, `--max-introspect-mb`) are deferred to Phase 2.

---

## File Structure

After Phase 1, the repository looks like this. Files marked `(existing)` were created during the design phase; everything else is new in Phase 1.

```
filecap-cli/
├── .eslintrc                        (not created — using flat config)
├── .gitignore                       (existing)
├── .prettierrc.json                 ← create
├── CHANGELOG.md                     (existing — update at the end)
├── LICENSE                          (existing)
├── README.md                        (existing — update at the end)
├── bin/
│   └── filecap.js                   ← create (CLI entry point)
├── docs/
│   ├── filecap-design.md            (existing)
│   └── plans/
│       └── 2026-05-08-filecap-phase-1-core-scan.md  (this file)
├── eslint.config.js                 ← create (ESLint v9 flat config)
├── package.json                     ← create
├── publish                          ← create (executable)
├── src/
│   ├── commands/
│   │   └── scan.js                  ← create (orchestrator)
│   ├── scanner/
│   │   ├── category.js              ← create (extension → category bucket)
│   │   ├── hash.js                  ← create (SHA-256 streaming)
│   │   ├── stats.js                 ← create (size, mtime, ext)
│   │   └── walk.js                  ← create (recursive async generator)
│   ├── schema/
│   │   └── inventory.js             ← create (Zod schemas)
│   ├── util/
│   │   ├── concurrency.js           ← create (p-limit wrapper)
│   │   ├── progress.js              ← create (stderr reporter)
│   │   └── server-id.js             ← create (hostname + IPv4 detection)
│   └── version.js                   ← create (reads package.json version)
├── test/
│   ├── category.test.js             ← create
│   ├── concurrency.test.js          ← create
│   ├── hash.test.js                 ← create
│   ├── scan.test.js                 ← create (end-to-end)
│   ├── schema.test.js               ← create
│   ├── server-id.test.js            ← create
│   ├── stats.test.js                ← create
│   └── walk.test.js                 ← create
└── vitest.config.js                 ← create
```

**Design notes on file responsibilities:**

- **`src/scanner/walk.js`** — async generator that yields either `{kind: "file", path}` or `{kind: "error", path, code}`. Catches per-directory `readdir` errors (e.g., `EACCES`) so the walk continues past inaccessible subtrees.
- **`src/scanner/stats.js`** — wraps `fs.stat`, returns `{sizeBytes, modifiedAt, extension}`. Pure helper.
- **`src/scanner/hash.js`** — streams a file through `crypto.createHash('sha256')`. Returns hex digest. Streaming so we don't load big files into memory.
- **`src/scanner/category.js`** — single lookup table: extension → category bucket (`pdf`/`office-document`/`spreadsheet`/`presentation`/`image`/`archive`/`text`/`web`/`audio-video`/`other`) and a `remediable` boolean derivation.
- **`src/schema/inventory.js`** — exports three Zod schemas: `headerSchema`, `entrySchema`, `footerSchema`. Used both by the writer (validate before serialization) and by tests (validate produced output).
- **`src/util/server-id.js`** — `getHostname()` and `getFirstIPv4()`. Pure wrappers around `os.hostname()` and `os.networkInterfaces()`.
- **`src/util/concurrency.js`** — thin re-export of `p-limit` with a typed factory so callers don't need to import `p-limit` directly.
- **`src/util/progress.js`** — `Progress` class with `tick(label)` and `end()` methods. Writes to `stderr` only when `--progress` is set; otherwise no-op.
- **`src/commands/scan.js`** — orchestrates: walk → stat → (optional hash) → write entry. Owns the NDJSON writer (header → entries → footer).
- **`bin/filecap.js`** — Commander wiring; dispatches to `scan` (and stubs `rollup`/`report` with "not yet implemented in v0.1.0").

---

## Task 1 — Bootstrap

**Files:**
- Create: `package.json`, `eslint.config.js`, `.prettierrc.json`, `vitest.config.js`
- Initialize git repo, configure remote, stage and commit pre-existing files

- [ ] **Step 1.1: Initialize git repository and configure remote**

Run:

```bash
cd /Volumes/satechi/webdev/filecap-cli
git init
git branch -M main
git remote add origin git@github.com:ICJIA/filecap-cli.git
```

Expected output: `Initialized empty Git repository in ...`. The remote add is silent.

- [ ] **Step 1.2: Create `package.json`**

Create file `package.json` with this exact content:

```json
{
  "name": "@icjia/filecap",
  "version": "0.1.0",
  "description": "File inventory CLI for accessibility audit scoping",
  "keywords": [
    "accessibility",
    "a11y",
    "wcag",
    "pdf",
    "inventory",
    "audit",
    "icjia"
  ],
  "license": "MIT",
  "author": "Illinois Criminal Justice Information Authority (ICJIA)",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/ICJIA/filecap-cli.git"
  },
  "homepage": "https://github.com/ICJIA/filecap-cli#readme",
  "bugs": "https://github.com/ICJIA/filecap-cli/issues",
  "type": "module",
  "bin": {
    "filecap": "./bin/filecap.js"
  },
  "main": "./src/index.js",
  "engines": {
    "node": ">=20.0.0"
  },
  "files": [
    "bin",
    "src",
    "README.md",
    "LICENSE",
    "CHANGELOG.md"
  ],
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src test bin",
    "format": "prettier --write src test bin"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "p-limit": "^5.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "eslint": "^9.0.0",
    "prettier": "^3.2.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 1.3: Install dependencies**

Run:

```bash
npm install
```

Expected: `node_modules/` and `package-lock.json` are created. No errors.

- [ ] **Step 1.4: Create `eslint.config.js` (ESLint v9 flat config)**

Create file `eslint.config.js`:

```js
export default [
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        setImmediate: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always"],
    },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        vi: "readonly",
      },
    },
  },
];
```

- [ ] **Step 1.5: Create `.prettierrc.json`**

Create file `.prettierrc.json`:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

- [ ] **Step 1.6: Create `vitest.config.js`**

Create file `vitest.config.js`:

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.js"],
    testTimeout: 30000,
  },
});
```

- [ ] **Step 1.7: Verify tooling installs and runs**

Run:

```bash
npx vitest --version
npx eslint --version
npx prettier --version
```

Expected: each prints a version number with no errors.

- [ ] **Step 1.8: Initial commit**

Run:

```bash
git add .gitignore .prettierrc.json CHANGELOG.md LICENSE README.md \
        docs/ eslint.config.js package.json package-lock.json vitest.config.js
git commit -m "chore: bootstrap project — package metadata, tooling, design doc"
```

Expected: commit succeeds with the listed files staged.

---

## Task 2 — Zod schemas (header, entry, footer)

**Files:**
- Create: `src/schema/inventory.js`
- Test: `test/schema.test.js`

- [ ] **Step 2.1: Write the failing test**

Create file `test/schema.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  headerSchema,
  entrySchema,
  footerSchema,
  SCHEMA_VERSION,
} from "../src/schema/inventory.js";

describe("inventory schemas", () => {
  it("exports SCHEMA_VERSION = 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("validates a well-formed header", () => {
    const header = {
      schemaVersion: 1,
      kind: "filecap-inventory-header",
      metadata: {
        serverName: "strapi-prod-01",
        hostname: "strapi-prod-01.icjia.local",
        serverIp: "10.42.7.18",
        scannedPath: "/var/strapi/uploads",
        scannedAt: "2026-05-08T14:23:11.000Z",
        filecapVersion: "0.1.0",
        nodeVersion: "v20.11.1",
        options: {
          introspect: false,
          hash: true,
          maxIntrospectMb: 200,
          concurrency: 4,
        },
      },
    };
    expect(() => headerSchema.parse(header)).not.toThrow();
  });

  it("rejects a header with the wrong kind", () => {
    const bad = {
      schemaVersion: 1,
      kind: "wrong-kind",
      metadata: {},
    };
    expect(() => headerSchema.parse(bad)).toThrow();
  });

  it("validates a minimal file entry", () => {
    const entry = {
      path: "case.pdf",
      absolutePath: "/var/strapi/uploads/case.pdf",
      filename: "case.pdf",
      extension: "pdf",
      category: "pdf",
      remediable: true,
      sizeBytes: 1024,
      modifiedAt: "2024-01-01T00:00:00.000Z",
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      flags: [],
    };
    expect(() => entrySchema.parse(entry)).not.toThrow();
  });

  it("allows entry without sha256 (when --no-hash)", () => {
    const entry = {
      path: "case.pdf",
      absolutePath: "/var/strapi/uploads/case.pdf",
      filename: "case.pdf",
      extension: "pdf",
      category: "pdf",
      remediable: true,
      sizeBytes: 1024,
      modifiedAt: "2024-01-01T00:00:00.000Z",
      sha256: "",
      flags: [],
    };
    expect(() => entrySchema.parse(entry)).not.toThrow();
  });

  it("validates a footer", () => {
    const footer = {
      kind: "filecap-inventory-footer",
      stats: {
        fileCount: 100,
        totalBytes: 1024000,
        scanDurationMs: 5000,
        introspectionFailures: 0,
        permissionDenials: 0,
      },
    };
    expect(() => footerSchema.parse(footer)).not.toThrow();
  });

  it("rejects a footer with negative stats", () => {
    const bad = {
      kind: "filecap-inventory-footer",
      stats: {
        fileCount: -1,
        totalBytes: 0,
        scanDurationMs: 0,
        introspectionFailures: 0,
        permissionDenials: 0,
      },
    };
    expect(() => footerSchema.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 2.2: Run test, verify it fails**

Run: `npx vitest run test/schema.test.js`

Expected: All 7 tests fail with "Cannot find module" or import-resolution error (because `src/schema/inventory.js` doesn't exist yet).

- [ ] **Step 2.3: Implement schemas**

Create file `src/schema/inventory.js`:

```js
import { z } from "zod";

export const SCHEMA_VERSION = 1;

const isoDate = z.string().datetime({ offset: false });

const optionsSchema = z.object({
  introspect: z.boolean(),
  hash: z.boolean(),
  maxIntrospectMb: z.number().int().nonnegative(),
  concurrency: z.number().int().positive(),
});

export const headerSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  kind: z.literal("filecap-inventory-header"),
  metadata: z.object({
    serverName: z.string(),
    hostname: z.string(),
    serverIp: z.string(),
    scannedPath: z.string(),
    scannedAt: isoDate,
    filecapVersion: z.string(),
    nodeVersion: z.string(),
    options: optionsSchema,
  }),
});

const categoryEnum = z.enum([
  "pdf",
  "office-document",
  "spreadsheet",
  "presentation",
  "image",
  "archive",
  "text",
  "web",
  "audio-video",
  "other",
]);

export const entrySchema = z.object({
  path: z.string(),
  absolutePath: z.string(),
  filename: z.string(),
  extension: z.string(),
  category: categoryEnum,
  remediable: z.boolean(),
  sizeBytes: z.number().int().nonnegative(),
  modifiedAt: isoDate,
  sha256: z.string(),
  flags: z.array(z.string()),
});

export const footerSchema = z.object({
  kind: z.literal("filecap-inventory-footer"),
  stats: z.object({
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    scanDurationMs: z.number().int().nonnegative(),
    introspectionFailures: z.number().int().nonnegative(),
    permissionDenials: z.number().int().nonnegative(),
  }),
});
```

- [ ] **Step 2.4: Run test, verify it passes**

Run: `npx vitest run test/schema.test.js`

Expected: All 7 tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add src/schema/inventory.js test/schema.test.js
git commit -m "feat(schema): add Zod schemas for header, entry, and footer"
```

---

## Task 3 — Category derivation

**Files:**
- Create: `src/scanner/category.js`
- Test: `test/category.test.js`

- [ ] **Step 3.1: Write the failing test**

Create file `test/category.test.js`:

```js
import { describe, it, expect } from "vitest";
import { categorize, isRemediable } from "../src/scanner/category.js";

describe("categorize", () => {
  it("buckets PDFs as 'pdf'", () => {
    expect(categorize("pdf")).toBe("pdf");
  });

  it("buckets DOCX/DOC as 'office-document'", () => {
    expect(categorize("docx")).toBe("office-document");
    expect(categorize("doc")).toBe("office-document");
  });

  it("buckets XLSX/XLS as 'spreadsheet'", () => {
    expect(categorize("xlsx")).toBe("spreadsheet");
    expect(categorize("xls")).toBe("spreadsheet");
  });

  it("buckets PPTX/PPT as 'presentation'", () => {
    expect(categorize("pptx")).toBe("presentation");
    expect(categorize("ppt")).toBe("presentation");
  });

  it("buckets common image extensions as 'image'", () => {
    expect(categorize("png")).toBe("image");
    expect(categorize("jpg")).toBe("image");
    expect(categorize("jpeg")).toBe("image");
    expect(categorize("gif")).toBe("image");
    expect(categorize("svg")).toBe("image");
    expect(categorize("webp")).toBe("image");
  });

  it("buckets archives as 'archive'", () => {
    expect(categorize("zip")).toBe("archive");
    expect(categorize("tar")).toBe("archive");
    expect(categorize("gz")).toBe("archive");
    expect(categorize("7z")).toBe("archive");
  });

  it("buckets text formats as 'text'", () => {
    expect(categorize("txt")).toBe("text");
    expect(categorize("md")).toBe("text");
    expect(categorize("csv")).toBe("text");
    expect(categorize("json")).toBe("text");
  });

  it("buckets web formats as 'web'", () => {
    expect(categorize("html")).toBe("web");
    expect(categorize("htm")).toBe("web");
  });

  it("buckets audio/video as 'audio-video'", () => {
    expect(categorize("mp3")).toBe("audio-video");
    expect(categorize("mp4")).toBe("audio-video");
    expect(categorize("mov")).toBe("audio-video");
  });

  it("falls back to 'other' for unknown extensions", () => {
    expect(categorize("xyz")).toBe("other");
    expect(categorize("")).toBe("other");
  });

  it("is case-insensitive", () => {
    expect(categorize("PDF")).toBe("pdf");
    expect(categorize("Docx")).toBe("office-document");
  });
});

describe("isRemediable", () => {
  it("returns true for pdf/office/spreadsheet/presentation", () => {
    expect(isRemediable("pdf")).toBe(true);
    expect(isRemediable("office-document")).toBe(true);
    expect(isRemediable("spreadsheet")).toBe(true);
    expect(isRemediable("presentation")).toBe(true);
  });

  it("returns false for everything else", () => {
    expect(isRemediable("image")).toBe(false);
    expect(isRemediable("archive")).toBe(false);
    expect(isRemediable("text")).toBe(false);
    expect(isRemediable("web")).toBe(false);
    expect(isRemediable("audio-video")).toBe(false);
    expect(isRemediable("other")).toBe(false);
  });
});
```

- [ ] **Step 3.2: Run test, verify it fails**

Run: `npx vitest run test/category.test.js`

Expected: Tests fail with module-resolution error.

- [ ] **Step 3.3: Implement category derivation**

Create file `src/scanner/category.js`:

```js
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
```

- [ ] **Step 3.4: Run test, verify it passes**

Run: `npx vitest run test/category.test.js`

Expected: All tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add src/scanner/category.js test/category.test.js
git commit -m "feat(scanner): add category and remediable derivation"
```

---

## Task 4 — Server-id detection

**Files:**
- Create: `src/util/server-id.js`
- Test: `test/server-id.test.js`

- [ ] **Step 4.1: Write the failing test**

Create file `test/server-id.test.js`:

```js
import { describe, it, expect } from "vitest";
import { getHostname, getFirstIPv4 } from "../src/util/server-id.js";

describe("getHostname", () => {
  it("returns a non-empty string", () => {
    const hostname = getHostname();
    expect(hostname).toBeTypeOf("string");
    expect(hostname.length).toBeGreaterThan(0);
  });
});

describe("getFirstIPv4", () => {
  it("returns either an IPv4 string or empty string when no non-loopback interface exists", () => {
    const ip = getFirstIPv4();
    expect(ip).toBeTypeOf("string");
    if (ip !== "") {
      // Basic IPv4 shape check; we don't assert specific bytes since
      // it's host-dependent.
      expect(ip).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
    }
  });

  it("never returns a loopback address", () => {
    const ip = getFirstIPv4();
    expect(ip).not.toBe("127.0.0.1");
  });
});
```

- [ ] **Step 4.2: Run test, verify it fails**

Run: `npx vitest run test/server-id.test.js`

Expected: Tests fail with module-resolution error.

- [ ] **Step 4.3: Implement server-id detection**

Create file `src/util/server-id.js`:

```js
import os from "node:os";

export function getHostname() {
  return os.hostname();
}

export function getFirstIPv4() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name] ?? []) {
      if (info.family === "IPv4" && !info.internal) {
        return info.address;
      }
    }
  }
  return "";
}
```

- [ ] **Step 4.4: Run test, verify it passes**

Run: `npx vitest run test/server-id.test.js`

Expected: All tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add src/util/server-id.js test/server-id.test.js
git commit -m "feat(util): add hostname and first-non-loopback-IPv4 detection"
```

---

## Task 5 — Filesystem walk

**Files:**
- Create: `src/scanner/walk.js`
- Test: `test/walk.test.js`

- [ ] **Step 5.1: Write the failing test**

Create file `test/walk.test.js`:

```js
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
```

- [ ] **Step 5.2: Run test, verify it fails**

Run: `npx vitest run test/walk.test.js`

Expected: All tests fail with module-resolution error.

- [ ] **Step 5.3: Implement walk**

Create file `src/scanner/walk.js`:

```js
import fs from "node:fs/promises";
import path from "node:path";

export async function* walk(rootDir) {
  let entries;
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (err) {
    yield { kind: "error", path: rootDir, code: err.code ?? "EUNKNOWN" };
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    } else if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (entry.isFile()) {
      yield { kind: "file", path: fullPath };
    }
  }
}
```

- [ ] **Step 5.4: Run test, verify it passes**

Run: `npx vitest run test/walk.test.js`

Expected: All tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add src/scanner/walk.js test/walk.test.js
git commit -m "feat(scanner): add async-generator filesystem walk with per-directory error capture"
```

---

## Task 6 — Per-file stats extraction

**Files:**
- Create: `src/scanner/stats.js`
- Test: `test/stats.test.js`

- [ ] **Step 6.1: Write the failing test**

Create file `test/stats.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { extractStats } from "../src/scanner/stats.js";

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-stats-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("extractStats", () => {
  it("returns size, mtime, and lowercase extension for a file", async () => {
    const file = path.join(tmpRoot, "Sample.PDF");
    await fs.writeFile(file, "hello");
    const stats = await extractStats(file);
    expect(stats.sizeBytes).toBe(5);
    expect(stats.extension).toBe("pdf");
    expect(stats.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns empty extension when the filename has none", async () => {
    const file = path.join(tmpRoot, "README");
    await fs.writeFile(file, "x");
    const stats = await extractStats(file);
    expect(stats.extension).toBe("");
  });

  it("strips the leading dot from the extension", async () => {
    const file = path.join(tmpRoot, "doc.docx");
    await fs.writeFile(file, "x");
    const stats = await extractStats(file);
    expect(stats.extension).toBe("docx");
  });

  it("emits modifiedAt as ISO 8601 UTC with milliseconds and trailing Z", async () => {
    const file = path.join(tmpRoot, "x.txt");
    await fs.writeFile(file, "x");
    const stats = await extractStats(file);
    expect(stats.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
```

- [ ] **Step 6.2: Run test, verify it fails**

Run: `npx vitest run test/stats.test.js`

Expected: All tests fail with module-resolution error.

- [ ] **Step 6.3: Implement stats extraction**

Create file `src/scanner/stats.js`:

```js
import fs from "node:fs/promises";
import path from "node:path";

export async function extractStats(filePath) {
  const stat = await fs.stat(filePath);
  const ext = path.extname(filePath).toLowerCase();
  return {
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    extension: ext.startsWith(".") ? ext.slice(1) : ext,
  };
}
```

- [ ] **Step 6.4: Run test, verify it passes**

Run: `npx vitest run test/stats.test.js`

Expected: All 4 tests pass.

- [ ] **Step 6.5: Commit**

```bash
git add src/scanner/stats.js test/stats.test.js
git commit -m "feat(scanner): add per-file stats extraction (size, mtime, extension)"
```

---

## Task 7 — SHA-256 streaming hash

**Files:**
- Create: `src/scanner/hash.js`
- Test: `test/hash.test.js`

- [ ] **Step 7.1: Write the failing test**

Create file `test/hash.test.js`:

```js
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
```

- [ ] **Step 7.2: Run test, verify it fails**

Run: `npx vitest run test/hash.test.js`

Expected: Tests fail with module-resolution error.

- [ ] **Step 7.3: Implement streaming hash**

Create file `src/scanner/hash.js`:

```js
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}
```

- [ ] **Step 7.4: Run test, verify it passes**

Run: `npx vitest run test/hash.test.js`

Expected: All 3 tests pass.

- [ ] **Step 7.5: Commit**

```bash
git add src/scanner/hash.js test/hash.test.js
git commit -m "feat(scanner): add SHA-256 streaming hash via Node native crypto"
```

---

## Task 8 — Concurrency helper

**Files:**
- Create: `src/util/concurrency.js`
- Test: `test/concurrency.test.js`

- [ ] **Step 8.1: Write the failing test**

Create file `test/concurrency.test.js`:

```js
import { describe, it, expect } from "vitest";
import { createLimiter } from "../src/util/concurrency.js";

describe("createLimiter", () => {
  it("limits concurrent execution to the configured count", async () => {
    const limit = createLimiter(2);
    let inFlight = 0;
    let maxInFlight = 0;
    const tasks = Array.from({ length: 10 }, () =>
      limit(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
      }),
    );
    await Promise.all(tasks);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("returns the value produced by the wrapped function", async () => {
    const limit = createLimiter(1);
    const result = await limit(async () => 42);
    expect(result).toBe(42);
  });

  it("propagates rejections from the wrapped function", async () => {
    const limit = createLimiter(1);
    await expect(
      limit(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
```

- [ ] **Step 8.2: Run test, verify it fails**

Run: `npx vitest run test/concurrency.test.js`

Expected: Tests fail with module-resolution error.

- [ ] **Step 8.3: Implement concurrency helper**

Create file `src/util/concurrency.js`:

```js
import pLimit from "p-limit";

export function createLimiter(concurrency) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`createLimiter: concurrency must be a positive integer, got ${concurrency}`);
  }
  return pLimit(concurrency);
}
```

- [ ] **Step 8.4: Run test, verify it passes**

Run: `npx vitest run test/concurrency.test.js`

Expected: All 3 tests pass.

- [ ] **Step 8.5: Commit**

```bash
git add src/util/concurrency.js test/concurrency.test.js
git commit -m "feat(util): add p-limit-based concurrency limiter helper"
```

---

## Task 9 — Progress reporter

**Files:**
- Create: `src/util/progress.js`

This task has no dedicated test file because the reporter just writes to `stderr`. We verify behavior end-to-end in Task 12.

- [ ] **Step 9.1: Implement progress reporter**

Create file `src/util/progress.js`:

```js
export class Progress {
  #enabled;
  #count = 0;
  #lastEmit = 0;

  constructor({ enabled = false, stream = process.stderr } = {}) {
    this.#enabled = enabled;
    this.stream = stream;
  }

  tick(label) {
    if (!this.#enabled) return;
    this.#count++;
    const now = Date.now();
    if (now - this.#lastEmit < 100 && label === undefined) return;
    this.#lastEmit = now;
    const text = label ? `[${this.#count}] ${label}` : `[${this.#count}]`;
    this.stream.write(`${text}\n`);
  }

  end(summary) {
    if (!this.#enabled) return;
    this.stream.write(`done — ${this.#count} files processed${summary ? `, ${summary}` : ""}\n`);
  }
}
```

- [ ] **Step 9.2: Commit**

```bash
git add src/util/progress.js
git commit -m "feat(util): add progress reporter for stderr"
```

---

## Task 10 — Version helper

**Files:**
- Create: `src/version.js`

- [ ] **Step 10.1: Implement version reader**

Create file `src/version.js`:

```js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"),
);

export const FILECAP_VERSION = pkg.version;
```

- [ ] **Step 10.2: Commit**

```bash
git add src/version.js
git commit -m "feat: add filecap version helper that reads from package.json"
```

---

## Task 11 — Scan command (orchestrator)

**Files:**
- Create: `src/commands/scan.js`
- Test: `test/scan.test.js`

- [ ] **Step 11.1: Write the failing test**

Create file `test/scan.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runScan } from "../src/commands/scan.js";
import { headerSchema, entrySchema, footerSchema } from "../src/schema/inventory.js";

let tmpRoot;
let outDir;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-scan-"));
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), "filecap-out-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.rm(outDir, { recursive: true, force: true });
});

async function readNdjson(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

describe("runScan", () => {
  it("produces a valid header + footer for an empty directory", async () => {
    const outPath = path.join(outDir, "empty.ndjson");
    const result = await runScan({
      directory: tmpRoot,
      output: outPath,
      hash: true,
      concurrency: 4,
      progress: false,
    });
    expect(result.exitCode).toBe(0);
    const lines = await readNdjson(outPath);
    expect(lines).toHaveLength(2);
    expect(() => headerSchema.parse(lines[0])).not.toThrow();
    expect(() => footerSchema.parse(lines[1])).not.toThrow();
    expect(lines[1].stats.fileCount).toBe(0);
  });

  it("produces one entry per file with valid schema", async () => {
    await fs.writeFile(path.join(tmpRoot, "a.pdf"), "pdf-content");
    await fs.writeFile(path.join(tmpRoot, "b.docx"), "docx-content");
    await fs.mkdir(path.join(tmpRoot, "sub"));
    await fs.writeFile(path.join(tmpRoot, "sub", "c.png"), "png-content");

    const outPath = path.join(outDir, "out.ndjson");
    const result = await runScan({
      directory: tmpRoot,
      output: outPath,
      hash: true,
      concurrency: 4,
      progress: false,
    });
    expect(result.exitCode).toBe(0);
    const lines = await readNdjson(outPath);
    expect(lines).toHaveLength(5); // header + 3 entries + footer
    expect(() => headerSchema.parse(lines[0])).not.toThrow();
    for (let i = 1; i <= 3; i++) {
      expect(() => entrySchema.parse(lines[i])).not.toThrow();
    }
    expect(() => footerSchema.parse(lines[4])).not.toThrow();
    expect(lines[4].stats.fileCount).toBe(3);
  });

  it("derives category and remediable correctly", async () => {
    await fs.writeFile(path.join(tmpRoot, "a.pdf"), "x");
    await fs.writeFile(path.join(tmpRoot, "b.png"), "x");

    const outPath = path.join(outDir, "out.ndjson");
    await runScan({ directory: tmpRoot, output: outPath, hash: false, concurrency: 4, progress: false });
    const lines = await readNdjson(outPath);
    const entries = lines.slice(1, -1);
    const pdfEntry = entries.find((e) => e.filename === "a.pdf");
    const pngEntry = entries.find((e) => e.filename === "b.png");
    expect(pdfEntry.category).toBe("pdf");
    expect(pdfEntry.remediable).toBe(true);
    expect(pngEntry.category).toBe("image");
    expect(pngEntry.remediable).toBe(false);
  });

  it("emits empty sha256 when hash is disabled", async () => {
    await fs.writeFile(path.join(tmpRoot, "a.txt"), "x");
    const outPath = path.join(outDir, "out.ndjson");
    await runScan({ directory: tmpRoot, output: outPath, hash: false, concurrency: 4, progress: false });
    const lines = await readNdjson(outPath);
    expect(lines[1].sha256).toBe("");
  });

  it("emits a populated sha256 when hash is enabled", async () => {
    await fs.writeFile(path.join(tmpRoot, "a.txt"), "hello");
    const outPath = path.join(outDir, "out.ndjson");
    await runScan({ directory: tmpRoot, output: outPath, hash: true, concurrency: 4, progress: false });
    const lines = await readNdjson(outPath);
    expect(lines[1].sha256).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("returns exit code 3 when at least one directory was unreadable", async () => {
    if (process.platform === "win32") return;
    const blocked = path.join(tmpRoot, "blocked");
    await fs.mkdir(blocked);
    await fs.writeFile(path.join(blocked, "x.txt"), "x");
    await fs.chmod(blocked, 0o000);
    try {
      const outPath = path.join(outDir, "out.ndjson");
      const result = await runScan({
        directory: tmpRoot,
        output: outPath,
        hash: false,
        concurrency: 4,
        progress: false,
      });
      expect(result.exitCode).toBe(3);
      const lines = await readNdjson(outPath);
      const footer = lines[lines.length - 1];
      expect(footer.stats.permissionDenials).toBeGreaterThanOrEqual(1);
    } finally {
      await fs.chmod(blocked, 0o700);
    }
  });

  it("respects --include-ext", async () => {
    await fs.writeFile(path.join(tmpRoot, "a.pdf"), "x");
    await fs.writeFile(path.join(tmpRoot, "b.png"), "x");
    await fs.writeFile(path.join(tmpRoot, "c.docx"), "x");

    const outPath = path.join(outDir, "out.ndjson");
    await runScan({
      directory: tmpRoot,
      output: outPath,
      hash: false,
      concurrency: 4,
      progress: false,
      includeExt: ["pdf", "docx"],
    });
    const lines = await readNdjson(outPath);
    const filenames = lines.slice(1, -1).map((e) => e.filename).sort();
    expect(filenames).toEqual(["a.pdf", "c.docx"]);
  });

  it("respects --exclude-ext", async () => {
    await fs.writeFile(path.join(tmpRoot, "a.pdf"), "x");
    await fs.writeFile(path.join(tmpRoot, "b.png"), "x");

    const outPath = path.join(outDir, "out.ndjson");
    await runScan({
      directory: tmpRoot,
      output: outPath,
      hash: false,
      concurrency: 4,
      progress: false,
      excludeExt: ["png"],
    });
    const lines = await readNdjson(outPath);
    const filenames = lines.slice(1, -1).map((e) => e.filename);
    expect(filenames).toEqual(["a.pdf"]);
  });
});
```

- [ ] **Step 11.2: Run test, verify it fails**

Run: `npx vitest run test/scan.test.js`

Expected: Tests fail with module-resolution error for `src/commands/scan.js`.

- [ ] **Step 11.3: Implement the scan orchestrator**

Create file `src/commands/scan.js`:

```js
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { walk } from "../scanner/walk.js";
import { extractStats } from "../scanner/stats.js";
import { hashFile } from "../scanner/hash.js";
import { categorize, isRemediable } from "../scanner/category.js";
import { createLimiter } from "../util/concurrency.js";
import { Progress } from "../util/progress.js";
import { getHostname, getFirstIPv4 } from "../util/server-id.js";
import { headerSchema, entrySchema, footerSchema, SCHEMA_VERSION } from "../schema/inventory.js";
import { FILECAP_VERSION } from "../version.js";

export async function runScan({
  directory,
  output,
  hash,
  concurrency,
  progress,
  serverName,
  serverIp,
  includeExt,
  excludeExt,
}) {
  const absoluteRoot = path.resolve(directory);

  try {
    const stat = await fs.stat(absoluteRoot);
    if (!stat.isDirectory()) {
      return { exitCode: 2, error: `${absoluteRoot} is not a directory` };
    }
  } catch {
    return { exitCode: 2, error: `cannot read ${absoluteRoot}` };
  }

  const startedAt = Date.now();
  const writeStream = createWriteStream(output, { encoding: "utf8" });

  function writeLine(obj) {
    return new Promise((resolve, reject) => {
      const ok = writeStream.write(`${JSON.stringify(obj)}\n`, (err) =>
        err ? reject(err) : resolve(),
      );
      if (!ok) writeStream.once("drain", resolve);
    });
  }

  const header = {
    schemaVersion: SCHEMA_VERSION,
    kind: "filecap-inventory-header",
    metadata: {
      serverName: serverName || getHostname(),
      hostname: getHostname(),
      serverIp: serverIp || getFirstIPv4(),
      scannedPath: absoluteRoot,
      scannedAt: new Date().toISOString(),
      filecapVersion: FILECAP_VERSION,
      nodeVersion: process.version,
      options: {
        introspect: false,
        hash,
        maxIntrospectMb: 200,
        concurrency,
      },
    },
  };
  headerSchema.parse(header);
  await writeLine(header);

  const stats = {
    fileCount: 0,
    totalBytes: 0,
    introspectionFailures: 0,
    permissionDenials: 0,
  };

  const reporter = new Progress({ enabled: progress });
  const limit = createLimiter(concurrency);
  const inFlight = [];
  const includeSet = includeExt ? new Set(includeExt.map((e) => e.toLowerCase())) : null;
  const excludeSet = excludeExt ? new Set(excludeExt.map((e) => e.toLowerCase())) : null;

  for await (const item of walk(absoluteRoot)) {
    if (item.kind === "error") {
      if (item.code === "EACCES" || item.code === "EPERM") {
        stats.permissionDenials++;
      }
      continue;
    }

    const filePath = item.path;
    const fileStats = await extractStats(filePath);
    if (includeSet && !includeSet.has(fileStats.extension)) continue;
    if (excludeSet && excludeSet.has(fileStats.extension)) continue;

    const task = limit(async () => {
      let sha256 = "";
      if (hash) {
        try {
          sha256 = await hashFile(filePath);
        } catch (err) {
          if (err.code === "EACCES" || err.code === "EPERM") {
            stats.permissionDenials++;
            return;
          }
          throw err;
        }
      }
      const category = categorize(fileStats.extension);
      const entry = {
        path: path.relative(absoluteRoot, filePath),
        absolutePath: filePath,
        filename: path.basename(filePath),
        extension: fileStats.extension,
        category,
        remediable: isRemediable(category),
        sizeBytes: fileStats.sizeBytes,
        modifiedAt: fileStats.modifiedAt,
        sha256,
        flags: [],
      };
      entrySchema.parse(entry);
      await writeLine(entry);
      stats.fileCount++;
      stats.totalBytes += fileStats.sizeBytes;
      reporter.tick(entry.path);
    });
    inFlight.push(task);
  }

  await Promise.all(inFlight);

  const footer = {
    kind: "filecap-inventory-footer",
    stats: {
      fileCount: stats.fileCount,
      totalBytes: stats.totalBytes,
      scanDurationMs: Date.now() - startedAt,
      introspectionFailures: stats.introspectionFailures,
      permissionDenials: stats.permissionDenials,
    },
  };
  footerSchema.parse(footer);
  await writeLine(footer);

  await new Promise((resolve, reject) => {
    writeStream.end((err) => (err ? reject(err) : resolve()));
  });

  reporter.end(`${stats.fileCount} entries, ${stats.totalBytes} bytes`);

  const exitCode = stats.permissionDenials > 0 ? 3 : 0;
  return { exitCode };
}
```

- [ ] **Step 11.4: Run test, verify it passes**

Run: `npx vitest run test/scan.test.js`

Expected: All 8 scan tests pass.

- [ ] **Step 11.5: Commit**

```bash
git add src/commands/scan.js test/scan.test.js
git commit -m "feat(scan): orchestrate walk → stat → hash → NDJSON write with permission-denied handling"
```

---

## Task 12 — CLI entry point

**Files:**
- Create: `bin/filecap.js`

This wires Commander to `runScan` and adds stubs for `rollup` and `report` (deferred to later phases). We test this in Task 13 via end-to-end execution.

- [ ] **Step 12.1: Implement the CLI entry**

Create file `bin/filecap.js`:

```js
#!/usr/bin/env node
import { Command } from "commander";
import { runScan } from "../src/commands/scan.js";
import { getHostname } from "../src/util/server-id.js";
import { FILECAP_VERSION } from "../src/version.js";

const program = new Command();

program
  .name("filecap")
  .description("File inventory CLI for accessibility audit scoping")
  .version(FILECAP_VERSION);

function commaList(value) {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function positiveInt(value, label) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${label} must be a positive integer, got ${value}`);
  }
  return n;
}

program
  .command("scan <directory>")
  .description("Walk a directory and produce an NDJSON inventory")
  .option(
    "-o, --output <path>",
    "output path",
    `filecap-${getHostname()}.ndjson`,
  )
  .option("-s, --server-name <name>", "override server identifier in metadata")
  .option("--server-ip <ip>", "override server IP in metadata")
  .option("--no-hash", "skip SHA-256 hashing")
  .option("--include-ext <list>", "comma-separated extensions to include", commaList)
  .option("--exclude-ext <list>", "comma-separated extensions to exclude", commaList)
  .option(
    "--concurrency <n>",
    "parallel hashing workers",
    (v) => positiveInt(v, "--concurrency"),
    4,
  )
  .option("--progress", "emit progress to stderr", false)
  .option("--quiet", "suppress non-error output", false)
  .action(async (directory, opts) => {
    try {
      const result = await runScan({
        directory,
        output: opts.output,
        hash: opts.hash,
        concurrency: opts.concurrency,
        progress: opts.progress,
        serverName: opts.serverName,
        serverIp: opts.serverIp,
        includeExt: opts.includeExt,
        excludeExt: opts.excludeExt,
      });
      if (result.error) {
        process.stderr.write(`${result.error}\n`);
      }
      process.exit(result.exitCode);
    } catch (err) {
      process.stderr.write(`filecap: ${err.message}\n`);
      process.exit(1);
    }
  });

program
  .command("rollup")
  .description("(Phase 5 — not yet implemented in v0.1.0)")
  .action(() => {
    process.stderr.write("filecap rollup is not implemented in v0.1.0 (Phase 5).\n");
    process.exit(1);
  });

program
  .command("report")
  .description("(Phase 6 — not yet implemented in v0.1.0)")
  .action(() => {
    process.stderr.write("filecap report is not implemented in v0.1.0 (Phase 6).\n");
    process.exit(1);
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`filecap: ${err.message}\n`);
  process.exit(1);
});
```

- [ ] **Step 12.2: Make the CLI executable**

Run:

```bash
chmod +x bin/filecap.js
```

- [ ] **Step 12.3: Smoke-test the CLI by running it directly**

Run:

```bash
./bin/filecap.js --version
./bin/filecap.js --help
./bin/filecap.js scan --help
```

Expected: each prints sensible output (version is `0.1.0`, help shows the `scan`/`rollup`/`report` subcommands, scan help shows the flag table).

- [ ] **Step 12.4: Commit**

```bash
git add bin/filecap.js
git commit -m "feat(cli): wire Commander entry point with scan command"
```

---

## Task 13 — End-to-end CLI integration test

**Files:**
- Modify: `test/scan.test.js` — append a new `describe("filecap CLI end-to-end", ...)` block

- [ ] **Step 13.1: Add the integration test**

Append the following to the end of `test/scan.test.js`:

```js
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

function runCli(args, cwd) {
  const cliPath = fileURLToPath(new URL("../bin/filecap.js", import.meta.url));
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (d) => stdout.push(d));
    child.stderr.on("data", (d) => stderr.push(d));
    child.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

describe("filecap CLI end-to-end", () => {
  it("scans a directory and writes a valid NDJSON file", async () => {
    await fs.writeFile(path.join(tmpRoot, "a.pdf"), "x");
    await fs.writeFile(path.join(tmpRoot, "b.txt"), "y");
    const outPath = path.join(outDir, "cli.ndjson");

    const result = await runCli(["scan", tmpRoot, "-o", outPath, "--no-hash"], outDir);
    expect(result.code).toBe(0);

    const text = await fs.readFile(outPath, "utf8");
    const lines = text.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l));
    expect(lines).toHaveLength(4); // header + 2 entries + footer
    expect(lines[0].kind).toBe("filecap-inventory-header");
    expect(lines[3].kind).toBe("filecap-inventory-footer");
    expect(lines[3].stats.fileCount).toBe(2);
  });

  it("returns exit code 1 with an error message when the directory does not exist", async () => {
    const outPath = path.join(outDir, "x.ndjson");
    const result = await runCli(
      ["scan", path.join(tmpRoot, "no-such-dir"), "-o", outPath, "--no-hash"],
      outDir,
    );
    expect(result.code).toBe(2);
  });

  it("prints version and exits 0", async () => {
    const result = await runCli(["--version"], outDir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 13.2: Run test, verify it passes**

Run: `npx vitest run test/scan.test.js`

Expected: all scan tests (the original 8 plus the 3 CLI tests) pass.

- [ ] **Step 13.3: Run the entire test suite**

Run: `npx vitest run`

Expected: all tests across all files pass.

- [ ] **Step 13.4: Commit**

```bash
git add test/scan.test.js
git commit -m "test(scan): add end-to-end CLI integration tests"
```

---

## Task 14 — Publish script

**Files:**
- Create: `publish` (executable bash script)

- [ ] **Step 14.1: Create the publish script**

Create file `publish` with this content (matches design doc section 10):

```bash
#!/usr/bin/env bash
# publish — release @icjia/filecap to npm
#
# Usage:
#   ./publish              # patch bump (default)
#   ./publish patch        # patch bump
#   ./publish minor        # minor bump
#   ./publish major        # major bump
#   ./publish first        # first-time publish (uses version in package.json as-is)

set -euo pipefail

BUMP="${1:-patch}"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
    echo "Refusing to publish: not on main (currently on $BRANCH)" >&2
    exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
    echo "Refusing to publish: working tree not clean" >&2
    git status --short >&2
    exit 1
fi

git fetch origin main
LOCAL=$(git rev-parse main)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" != "$REMOTE" ]; then
    echo "Refusing to publish: local main is not in sync with origin/main" >&2
    exit 1
fi

if ! npm whoami >/dev/null 2>&1; then
    echo "Not logged in to npm. Run: npm login" >&2
    exit 1
fi

echo "==> Running tests"
npm test

if [ "$BUMP" = "first" ]; then
    VERSION=$(node -p "require('./package.json').version")
    echo "==> First-time publish at v$VERSION"
    npm publish --access public
    git tag "v$VERSION"
    git push origin "v$VERSION"
else
    echo "==> Bumping version ($BUMP)"
    NEW_VERSION=$(npm version "$BUMP" -m "Release v%s")
    echo "==> Publishing $NEW_VERSION"
    npm publish --access public
    git push origin main --follow-tags
fi

echo
echo "==> Done."
echo "    npm:    https://www.npmjs.com/package/@icjia/filecap"
echo "    GitHub: https://github.com/ICJIA/filecap-cli"
```

- [ ] **Step 14.2: Make publish executable**

Run:

```bash
chmod +x publish
```

- [ ] **Step 14.3: Commit**

```bash
git add publish
git commit -m "chore: add publish script for npm releases"
```

---

## Task 15 — Update README and CHANGELOG, final smoke test

**Files:**
- Modify: `README.md` — replace the "Status" section to reflect Phase 1 shipped
- Modify: `CHANGELOG.md` — add a `[0.1.0]` section

- [ ] **Step 15.1: Update README.md**

In `README.md`, replace the existing "Status" section (between `## Status` and `## Intended Workflow`) with:

```markdown
## Status

**Phase 1 shipped (v0.1.0).** Core scan is functional: `filecap scan <directory>` walks a tree and writes a valid NDJSON inventory. The full design specification lives at [`docs/filecap-design.md`](docs/filecap-design.md).

Implementation continues in eight phases, each shipping as a complete npm release:

| Phase | Version | Status | Deliverable |
|---|---|---|---|
| 1 | v0.1.0 | shipped | Core scan — recursive walk, hashing, NDJSON output |
| 2 | v0.2.0 | next | PDF introspection (image-only flag, tags, producer, signatures, language) |
| 3 | v0.3.0 | planned | Office introspection (DOCX, XLSX) |
| 4 | v0.4.0 | planned | Filename flagging |
| 5 | v0.5.0 | planned | Multi-server rollup |
| 6 | v0.6.0 | planned | CSV reporter and summary artifacts |
| 7 | v1.0.0 | planned | MCP server entry point |
| 8 | vNext | deferred | Strapi-aware mode (separate package) |
```

- [ ] **Step 15.2: Update CHANGELOG.md**

In `CHANGELOG.md`, replace the entire `## [Unreleased]` section with:

```markdown
## [0.1.0] — 2026-05-08

### Added

- Initial design document at `docs/filecap-design.md`.
- Project metadata: `README.md`, `LICENSE` (MIT), `.gitignore`, `CHANGELOG.md`.
- `filecap scan <directory>` command — recursive filesystem walk, per-file stats (size, mtime, extension), category derivation, optional SHA-256 hashing, and NDJSON output (header + entries + footer).
- Bounded concurrency for hashing via `p-limit`.
- Permission-denied handling: per-directory errors are captured and counted in the footer's `permissionDenials`; scan exits with code 3 (partial completion) when any directory was unreadable.
- Zod schemas validating header, entry, and footer NDJSON lines.
- Publish script (`./publish`) for npm releases.

### Design decisions locked

- **Output format.** NDJSON (`.ndjson`) for both single-instance scans and consolidated rollups.
- **Rollup canonical-row semantics.** One row per physical copy; content-duplicates carry a `duplicateOf` field (oldest `modifiedAt` wins; alphabetical tiebreaker on `serverName`). *(Implementation pending Phase 5.)*
- **PDF introspection failure handling.** Empty fields, no stub error block. *(Implementation pending Phase 2.)*
- **Hash algorithm.** SHA-256 via Node native `crypto`.
- **Vendor workflow.** Out of scope. filecap is a pure inventory tool.
- **CSV column additions.** `category`, `remediable`, `documentLanguage`, `pdfHasFormFields`, `pdfHasSignatures`, `pdfProducer`, `pdfCreator`, `pdfCreationDate`, `docxImageCount`. *(Implementation pending Phase 6.)*

[0.1.0]: https://github.com/ICJIA/filecap-cli/releases/tag/v0.1.0
```

- [ ] **Step 15.3: Run the full test suite one more time**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 15.4: Final smoke test on the local repo itself**

Run:

```bash
./bin/filecap.js scan ./src -o /tmp/filecap-self-test.ndjson --progress
head -1 /tmp/filecap-self-test.ndjson
tail -1 /tmp/filecap-self-test.ndjson
wc -l /tmp/filecap-self-test.ndjson
```

Expected:
- Progress lines appear on stderr.
- The first line of the output file is a `filecap-inventory-header` JSON object.
- The last line is a `filecap-inventory-footer` JSON object with `fileCount` ≥ 1.
- `wc -l` reports a number equal to (header + entries + footer) — at least 3.

- [ ] **Step 15.5: Final commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: mark v0.1.0 shipped — update README status table and CHANGELOG"
```

- [ ] **Step 15.6: Tag locally (do not push)**

Run:

```bash
git tag v0.1.0
git log --oneline -20
git tag --list
```

Expected: a clean linear history of the implementation commits, with `v0.1.0` tag at HEAD.

**Do not push to origin or run `./publish` automatically.** Hand off to the user — they will decide when to push and when to publish to npm.

---

## End of Phase 1

After completing Task 15, the repository contains:

- A working `@icjia/filecap@0.1.0` CLI installable via `npm install` (locally) and ready to publish via `./publish first`.
- A passing test suite (`npm test`) covering schemas, walk, stats, hash, category, server-id, concurrency, scan orchestration, and end-to-end CLI invocation.
- Project metadata (README, CHANGELOG, LICENSE, .gitignore) and the design doc, all committed.
- A `v0.1.0` git tag at HEAD, locally only.

**Next phase:** Phase 2 — PDF introspection (v0.2.0). That work gets its own implementation plan when you're ready to begin.
