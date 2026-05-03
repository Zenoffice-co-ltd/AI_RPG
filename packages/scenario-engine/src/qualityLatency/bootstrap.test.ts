import { describe, expect, it } from "vitest";
import { bootstrapPercentileCi } from "./bootstrap";

function deterministicRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

describe("bootstrapPercentileCi", () => {
  it("returns null when too few values", () => {
    expect(bootstrapPercentileCi([1, 2, 3], 90)).toBeNull();
  });

  it("returns a low/high interval covering the observed percentile for stable data", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    const ci = bootstrapPercentileCi(values, 90, {
      iterations: 200,
      rng: deterministicRng(42),
    });
    expect(ci).not.toBeNull();
    if (ci) {
      expect(ci.low).toBeLessThanOrEqual(95);
      expect(ci.high).toBeGreaterThanOrEqual(80);
    }
  });
});
