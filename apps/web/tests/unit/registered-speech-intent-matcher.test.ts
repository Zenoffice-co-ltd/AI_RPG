import { describe, expect, it } from "vitest";

import {
  REQUIRED_REGISTERED_SPEECH_INTENTS,
  type CanonicalIntent,
} from "../../lib/roleplay/registered-speech/canonical-intents";
import {
  classifyUserUtteranceForRegisteredSpeech,
  isRepeatRequest,
  normalizeUserUtteranceForIntent,
} from "../../lib/roleplay/registered-speech/intent-matcher";
import type { VerifiedRegisteredSpeechCache } from "../../lib/roleplay/registered-speech/types";

// Tests for the deterministic-mode user-utterance → intent classifier.
// The cache is stubbed: every required intent maps to a fixture entry
// whose sha256 / audio is a placeholder. The matcher contract is what
// we're pinning here — sha verification lives in the verified-cache
// builder.

function buildStubCache(): VerifiedRegisteredSpeechCache {
  const entries = new Map();
  for (const intent of REQUIRED_REGISTERED_SPEECH_INTENTS) {
    entries.set(intent, {
      intent,
      spokenText: `[spoken:${intent}]`,
      displayText: `[display:${intent}]`,
      audioBase64: "",
      decodedByteLength: 0,
      sha256: "0".repeat(64),
      durationMs: 0,
      verified: true as const,
    });
  }
  return { manifestVersion: "v1", buildId: "test", entries };
}

const cache = buildStubCache();

function classify(userText: string) {
  return classifyUserUtteranceForRegisteredSpeech({ userText, cache });
}

describe("classifyUserUtteranceForRegisteredSpeech", () => {
  it.each<[string, CanonicalIntent]>([
    ["時給はいくらですか？", "billing_rate"],
    ["請求はいくらですか", "billing_rate"],
    ["単価教えてください", "billing_rate"],
    ["業務時間を教えてください", "working_hours"],
    ["勤務時間は何時から何時ですか", "working_hours"],
    ["残業はどれくらいありますか", "overtime"],
    ["在宅できますか", "remote_work"],
    ["テレワーク対応していますか", "remote_work"],
    ["何名募集ですか", "headcount"],
    ["業務内容を教えてください", "job_content"],
    ["募集背景を教えてください", "hiring_reason"],
    ["開始時期はいつですか", "start_date"],
    ["件数はどのくらいですか", "order_volume"],
    ["繁忙時期はいつですか", "busy_period"],
    ["人柄はどんな方がいいですか", "personality"],
    ["最終決定は誰になりますか", "decision_maker"],
    ["協調性についてもう少し聞かせてください", "skill_followup_teamwork"],
    ["どういうスキルが必要ですか", "skill_requirement_broad"],
    ["水曜日にメールしますね", "wednesday_followup"],
    ["はい", "ack_short"],
    ["よろしくお願いします", "closing_short"],
  ])("routes %p to intent %p", (text, expected) => {
    const decision = classify(text);
    expect(decision.kind).toBe("intent_hit");
    expect(decision.hit.intent).toBe(expected);
  });

  it("routes empty / whitespace input to fallback_unknown", () => {
    const decision = classify("   ");
    expect(decision.kind).toBe("unknown_fallback");
    expect(decision.hit.intent).toBe("fallback_unknown");
  });

  it("routes unknown chatter to fallback_unknown", () => {
    const decision = classify("今日はいい天気ですね");
    expect(decision.kind).toBe("unknown_fallback");
    expect(decision.hit.intent).toBe("fallback_unknown");
  });

  it("routes rapid-fire compound (AとBとCと…全部教えて) to fallback_unknown", () => {
    const decision = classify(
      "業務内容と人数と単価と勤務時間と全部教えてください"
    );
    expect(decision.kind).toBe("rapid_fire_fallback");
    expect(decision.hit.intent).toBe("fallback_unknown");
  });

  it("routes single-と compound that doesn't match any intent to multi_intent_redirect", () => {
    // 勉強会 (3 kanji) と 懇親会 (3 kanji) — both sides satisfy the
    // noun-linker と detector, and neither phrase matches a single-
    // intent regex. The matcher should fall through to multi_intent_
    // redirect.
    const decision = classify("勉強会と懇親会の予定を教えてください");
    expect(decision.kind).toBe("multi_intent_redirect");
    expect(decision.hit.intent).toBe("multi_intent_redirect");
  });

  it("matches a single-intent regex even when one と connector is present", () => {
    // "業務内容と単価を教えて" — 業務内容 wins because it's listed first.
    const decision = classify("業務内容と単価を教えてください");
    expect(decision.kind).toBe("intent_hit");
    expect(decision.hit.intent).toBe("job_content");
  });

  // 2026-05-12 manual-regression coverage. The natural phrasings below
  // missed the original matcher and fell to rt_voice (decision_maker:
  // 11,938ms first-audible). With the expanded pattern set + ack/filler
  // normalization, each phrase must now resolve to its lock canonical.
  describe("manual-regression natural phrasings (2026-05-12)", () => {
    it.each<[string, CanonicalIntent]>([
      ["決定される方はどなたですか？", "decision_maker"],
      ["今回はー、決定される方はどなたですか？", "decision_maker"],
      [
        "はい、ありがとうございます。今回はー、決定される方はどなたですか？",
        "decision_maker",
      ],
      ["最終判断される方はどなたですか？", "decision_maker"],
      ["どなたが最終判断されますか？", "decision_maker"],
      ["決まる方はどなたですか", "decision_maker"],
      // ack-prefixed factual questions
      ["あ、請求単価は？", "billing_rate"],
      ["なるほどですね、残業は月どれくらいですか？", "overtime"],
      ["えっと、業務時間は？", "working_hours"],
      ["うん、在宅勤務はありますか？", "remote_work"],
      ["はい、何名募集ですか？", "headcount"],
      ["ありがとうございます、業務内容を教えてください", "job_content"],
    ])("routes %p to intent %p", (text, expected) => {
      const decision = classify(text);
      expect(decision.kind).toBe("intent_hit");
      expect(decision.hit.intent).toBe(expected);
    });
  });
});

describe("normalizeUserUtteranceForIntent", () => {
  it.each<[string, string]>([
    ["はい、ありがとうございます。今回はー、決定される方はどなたですか？", "決定される方はどなたですか？"],
    ["あ、請求単価は？", "請求単価は？"],
    ["なるほどですね、残業は月どれくらいですか？", "残業は月どれくらいですか？"],
    ["えっと、業務時間は？", "業務時間は？"],
    ["うん、在宅勤務はありますか？", "在宅勤務はありますか？"],
    // No-op when there's no leading filler
    ["業務時間は何時からですか？", "業務時間は何時からですか？"],
    ["", ""],
  ])("strips leading ack/filler: %p → %p", (input, expected) => {
    expect(normalizeUserUtteranceForIntent(input)).toBe(expected);
  });
});

describe("isRepeatRequest", () => {
  it.each<[string, boolean]>([
    ["もう一度お願いします", true],
    ["あ、もう一度お願いします", true],
    ["もう一度", true],
    ["もう一回お願いします", true],
    ["もっかいお願いします", true],
    ["再度お願いします", true],
    ["繰り返してください", true],
    ["聞き直したいです", true],
    ["さっきの単価をもう一回", true],
    ["聞こえませんでした", true],
    // Negative cases
    ["請求単価は？", false],
    ["時給はいくらですか", false],
    ["業務時間は", false],
    // Confound: "もう一度" must be present; "一度" alone is not enough
    ["一度確認させてください", false],
  ])("isRepeatRequest(%p) === %p", (input, expected) => {
    expect(isRepeatRequest(input)).toBe(expected);
  });
});
