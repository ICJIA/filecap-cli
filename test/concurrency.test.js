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
