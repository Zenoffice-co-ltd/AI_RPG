import { describe, expect, it } from "vitest";

import { REQUIRED_REGISTERED_SPEECH_INTENTS } from "../../lib/roleplay/registered-speech/canonical-intents";
import {
  EXPECTED_TOKENS_BY_INTENT,
  checkExpectedTokens,
} from "../../lib/roleplay/registered-speech/expected-tokens";

describe("EXPECTED_TOKENS_BY_INTENT", () => {
  it("covers every required canonical intent", () => {
    for (const intent of REQUIRED_REGISTERED_SPEECH_INTENTS) {
      expect(EXPECTED_TOKENS_BY_INTENT[intent]).toBeDefined();
    }
  });
});

describe("checkExpectedTokens", () => {
  it("flags every primary token as missing when none are present", () => {
    const result = checkExpectedTokens("billing_rate", "完全に無関係なテキスト");
    expect(result.missing).toContain("請求想定");
    expect(result.missing).toContain("経験");
  });

  it("accepts an alternates OR — STT-normalised digit form", () => {
    // billing_rate alternates: ["せんななひゃくごじゅう円", "千七百五十円", "1750円", "1,750円"]
    const result = checkExpectedTokens(
      "billing_rate",
      "請求想定は経験により1750円から1900円程度です"
    );
    expect(result.missing).toEqual([]);
    expect(result.matched).toContain("1750円");
    expect(result.matched).toContain("1900円");
  });

  it("accepts an alternates OR — kana form", () => {
    const result = checkExpectedTokens(
      "billing_rate",
      "請求想定は経験によりせんななひゃくごじゅう円からせんきゅうひゃく円程度です"
    );
    expect(result.missing).toEqual([]);
  });

  it("reports the OR group when no alternate matches", () => {
    const result = checkExpectedTokens(
      "billing_rate",
      "請求想定は経験により別の金額です"
    );
    expect(
      result.missing.some((m) => m.includes("せんななひゃくごじゅう円"))
    ).toBe(true);
  });
});
