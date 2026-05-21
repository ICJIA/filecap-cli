import { open } from "node:fs/promises";

/**
 * Read the first `n` bytes of a file. Returns a Buffer (shorter than `n` for
 * tiny files), or null if the file can't be opened or read — callers treat
 * null as "content unknown, don't flag".
 *
 * @param {string} filePath
 * @param {number} n
 * @returns {Promise<Buffer|null>}
 */
export async function readHeader(filePath, n) {
  let fh;
  try {
    fh = await open(filePath, "r");
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}
