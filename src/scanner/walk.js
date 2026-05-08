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
