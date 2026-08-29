import { describe, expect, it } from "vitest";
import { MemoryRateLimiter } from "../server/api.js";

describe("in-memory rate limiter", () => {
  it("bounds unique-key memory while retaining limits for recent keys", () => {
    const limiter = new MemoryRateLimiter(1, 60_000, 3);
    const buckets = (limiter as unknown as { buckets: Map<string, number[]> }).buckets;

    expect(limiter.take("one")).toBe(true);
    expect(limiter.take("two")).toBe(true);
    expect(limiter.take("three")).toBe(true);
    expect(limiter.take("three")).toBe(false);
    expect(limiter.take("four")).toBe(true);

    expect(buckets.size).toBe(3);
    expect(buckets.has("one")).toBe(false);
    expect(limiter.take("three")).toBe(false);
  });
});
