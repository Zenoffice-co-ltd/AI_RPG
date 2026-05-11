import { isRapidFireCompoundQuestion, countNounLinkerTo } from "../grok-voice-pr60-shared";

import type { CanonicalIntent } from "./canonical-intents";
import type {
  LockedSpeechHit,
  VerifiedRegisteredSpeechCache,
} from "./types";

// Maps a user utterance to a canonical intent. The order here mirrors
// `PR60_LOCKED_RESPONSES` in `grok-voice-pr60-shared.ts` so we preserve
// the load-bearing rule that specific follow-ups precede broad
// canonicals — see the doc-comment on `PR60_LOCKED_RESPONSES` for why
// the order matters.
const INTENT_PATTERNS: ReadonlyArray<{
  intent: CanonicalIntent;
  userPatterns: RegExp[];
}> = [
  { intent: "mission", userPatterns: [/ミッション/, /担当.*ミッション/, /人事.*ミッション/] },
  { intent: "engagement_scope", userPatterns: [/今回の内容/, /簡単.*内容/, /概要/, /案件概要/] },
  // Newly registered intents — placed BEFORE job_content because
  // job_content's `業務.*教えて` regex is broad enough to steal
  // "業務時間を教えてください" otherwise. These are deterministic-mode-
  // only intents (the legacy PR60 path didn't have them, so they have
  // no opinion about ordering vs the legacy table).
  {
    intent: "working_hours",
    userPatterns: [/業務時間/, /勤務時間/, /何時から/, /勤務.*いつ/, /就業時間/],
  },
  { intent: "overtime", userPatterns: [/残業/, /時間外/, /月.*どれくらい.*残業/] },
  {
    intent: "remote_work",
    userPatterns: [/在宅/, /テレワーク/, /リモート/, /在宅.*できますか/],
  },
  { intent: "headcount", userPatterns: [/何名/, /人数/, /何人/, /何名.*募集/] },
  {
    intent: "job_content",
    userPatterns: [
      /どういう業務/,
      /どんな業務/,
      /業務.*具体/,
      /具体的.*業務/,
      /業務内容/,
      /仕事内容/,
      /何をする/,
      /営業事務.*内容/,
      /業務.*教えて/,
    ],
  },
  { intent: "start_date", userPatterns: [/時期的にはいつ/, /開始時期/, /いつから/, /就業開始/] },
  {
    intent: "order_volume",
    userPatterns: [
      /受注件数/,
      /月にどのくらい/,
      /月何件/,
      /件数/,
      /処理量/,
      /ボリューム/,
      /どれくらい処理/,
      /どの程度の量/,
    ],
  },
  { intent: "busy_period", userPatterns: [/繁忙時期/, /忙しい時期/, /ピーク/, /繁忙.*いつ/] },
  { intent: "hiring_reason", userPatterns: [/募集背景/, /背景を/, /背景.*伺/] },
  {
    intent: "ack_short",
    userPatterns: [
      /^そういうことですね。?$/,
      /^はい。?$/,
      /^うーん。?$/,
      /^なるほどですね。?$/,
      /^うん。?$/,
    ],
  },
  // Specific skill follow-up — MUST precede the broad skill match
  // (mirrors pr60-shared.ts comment at the same location).
  {
    intent: "skill_followup_teamwork",
    userPatterns: [/協調性.*具体/, /協調性.*聞/, /協調性.*もう少し/],
  },
  {
    intent: "skill_requirement_broad",
    userPatterns: [
      /候補者のスキル/,
      /どういうスキル/,
      /どういう経験/,
      /どんなスキル/,
      /どんな経験/,
      /スキル.*望ましい/,
      /スキル.*必要/,
      /スキル面/,
      /経験面/,
    ],
  },
  { intent: "personality", userPatterns: [/人柄/, /合う.*人/, /人物面/, /性格/] },
  { intent: "billing_rate", userPatterns: [/単価/, /請求/, /時給/, /いくら/] },
  { intent: "decision_maker", userPatterns: [/最終決定/, /誰になります/, /決定.*誰/, /決裁者/] },
  { intent: "wednesday_followup", userPatterns: [/水曜.*メール/, /水曜日.*メール/, /候補.*メール/] },
  { intent: "closing_short", userPatterns: [/よろしくお願いします/, /宜しくお願いします/] },

];

export type MatcherInput = {
  userText: string;
  cache: VerifiedRegisteredSpeechCache;
};

export type MatcherDecision =
  | { kind: "intent_hit"; hit: LockedSpeechHit }
  | { kind: "rapid_fire_fallback"; hit: LockedSpeechHit }
  | { kind: "multi_intent_redirect"; hit: LockedSpeechHit }
  | { kind: "unknown_fallback"; hit: LockedSpeechHit };

function entryToHit(
  cache: VerifiedRegisteredSpeechCache,
  intent: CanonicalIntent
): LockedSpeechHit {
  const entry = cache.entries.get(intent);
  if (!entry) {
    // The cache is built from the manifest which is exhaustive — if a
    // required intent is missing the session route already threw before
    // mic-enable. Reaching this branch is a programmer error.
    throw new Error(
      `[registered-speech] cache missing required intent ${intent}`
    );
  }
  return {
    intent: entry.intent,
    spokenText: entry.spokenText,
    displayText: entry.displayText,
    sha256: entry.sha256,
  };
}

// Deterministic matcher. Returned `MatcherDecision` always points at an
// intent the verified cache can serve, so callers never need to handle
// "no audio available" — fallback artifacts are part of the cache.
export function classifyUserUtteranceForRegisteredSpeech(
  input: MatcherInput
): MatcherDecision {
  const trimmed = input.userText.trim();

  if (trimmed.length === 0) {
    return {
      kind: "unknown_fallback",
      hit: entryToHit(input.cache, "fallback_unknown"),
    };
  }

  // Rapid-fire compound ("AとBとCと…全部教えて") — under the old PR60
  // matcher this returned null and fell to the realtime model. In
  // deterministic mode we MUST not let that path run, so route to the
  // unknown-fallback artifact instead.
  if (isRapidFireCompoundQuestion(trimmed)) {
    return {
      kind: "rapid_fire_fallback",
      hit: entryToHit(input.cache, "fallback_unknown"),
    };
  }

  for (const { intent, userPatterns } of INTENT_PATTERNS) {
    if (userPatterns.some((pat) => pat.test(trimmed))) {
      return { kind: "intent_hit", hit: entryToHit(input.cache, intent) };
    }
  }

  // Single-と compound that didn't match any single-intent regex (e.g.
  // "業務時間と単価を教えて" with no specific-enough intent winning).
  // Route to multi_intent_redirect rather than guessing.
  if (
    countNounLinkerTo(trimmed) >= 1 &&
    /教えて|聞かせて|お願いします|伺いたい/.test(trimmed)
  ) {
    return {
      kind: "multi_intent_redirect",
      hit: entryToHit(input.cache, "multi_intent_redirect"),
    };
  }

  return {
    kind: "unknown_fallback",
    hit: entryToHit(input.cache, "fallback_unknown"),
  };
}
