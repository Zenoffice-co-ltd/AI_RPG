import { describe, expect, it } from "vitest";
import { createTurnDedupeKey } from "./session";

describe("createTurnDedupeKey", () => {
  it("is deterministic for the same turn payload", () => {
    const left = createTurnDedupeKey({
      role: "user",
      text: "開始時期を教えてください",
      relativeTimestamp: 12,
    });
    const right = createTurnDedupeKey({
      role: "user",
      text: "開始時期を教えてください",
      relativeTimestamp: 12,
    });

    expect(left).toBe(right);
  });

  it("normalizes whitespace and casing before hashing", () => {
    const left = createTurnDedupeKey({
      role: "avatar",
      text: "  おはようございます  ",
      relativeTimestamp: 3,
    });
    const right = createTurnDedupeKey({
      role: "avatar",
      text: "おはようございます",
      relativeTimestamp: 3,
    });

    expect(left).toBe(right);
  });

  it("changes when timestamp changes", () => {
    const left = createTurnDedupeKey({
      role: "user",
      text: "開始時期はいつですか",
      relativeTimestamp: 4,
    });
    const right = createTurnDedupeKey({
      role: "user",
      text: "開始時期はいつですか",
      relativeTimestamp: 5,
    });

    expect(left).not.toBe(right);
  });
});
