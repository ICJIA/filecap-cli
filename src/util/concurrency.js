import pLimit from "p-limit";

export function createLimiter(concurrency) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`createLimiter: concurrency must be a positive integer, got ${concurrency}`);
  }
  return pLimit(concurrency);
}
