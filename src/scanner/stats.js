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
