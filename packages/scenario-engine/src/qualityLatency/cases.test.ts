import { describe, expect, it } from "vitest";
import { qualityLatencyCases } from "./cases";

describe("qualityLatencyCases", () => {
  it("contains at least 24 cases", () => {
    expect(qualityLatencyCases.length).toBeGreaterThanOrEqual(24);
  });

  it("uses unique ids", () => {
    const ids = new Set(qualityLatencyCases.map((c) => c.id));
    expect(ids.size).toBe(qualityLatencyCases.length);
  });

  it("covers all required categories", () => {
    const required = [
      "short_ack",
      "busy_manager",
      "condition_hearing",
      "budget",
      "objection",
      "ambiguous",
      "english_mixed",
      "long_context",
      "numbers_dates",
      "competitor",
      "next_action",
      "safety_no_hallucination",
    ];
    for (const cat of required) {
      const present = qualityLatencyCases.some((c) => c.category === cat);
      expect(present, `category ${cat} missing`).toBe(true);
    }
  });
});
