import { isRapidFireCompoundQuestion, countNounLinkerTo } from "../grok-voice-pr60-shared";

import type { CanonicalIntent } from "./canonical-intents";
import type {
  LockedSpeechHit,
  VerifiedRegisteredSpeechCache,
} from "./types";

// 2026-05-12 manual regression: natural prefixes like "あ、" /
// "なるほどですね、" / "はい、ありがとうございます。今回はー、" carried
// the user's real intent (e.g. "決定される方はどなたですか？") but the
// trimmed-only matcher couldn't see past them. The normalizer strips
// the conversational filler so the underlying intent reaches the
// patterns. Original `userText` is still matched first so any pattern
// that NEEDS the prefix (none today, but defensible) keeps working.
//
// Alternation order is LONGEST-first because JS regex alternation is
// left-to-right with first-match semantics — `あ|ありがとう` would
// match only `あ` on input "ありがとう", which would maim the rest of
// the prefix walk.
const ACK_FILLER_PREFIX_RE =
  /^(ありがとうございます|なるほどですね|ありがとう|すみません|なるほど|えっと|ええと|うーん|はい|えー|うん|その|あ)[\s、。,.．・ー\-]*/;
const SCENE_OPENER_PREFIX_RE =
  /^(それでは|では|じゃあ|今回は|今回)[\s、。,.．・ー\-]*/;

export function normalizeUserUtteranceForIntent(input: string): string {
  let s = input.trim();
  // Collapse interjection punctuation that the STT scatters across the
  // sentence ("はい、今回はー、…") so multi-stage stripping below sees
  // a uniform delimiter.
  s = s.replace(/[、。,.．・]+/g, " ").replace(/\s+/g, " ").trim();
  // Strip a sequence of leading acks ("はい ありがとうございます")
  // followed optionally by a scene opener ("今回は ") — each cycle
  // peels one layer until none of the prefixes match.
  for (let i = 0; i < 4; i += 1) {
    const before = s;
    s = s.replace(ACK_FILLER_PREFIX_RE, "").replace(SCENE_OPENER_PREFIX_RE, "");
    if (s === before) break;
  }
  return s.trim();
}

// Repeat-request detection. 2026-05-12 production sessions showed
// "もう一度お願いします" being routed to rt_voice because the literal
// has no canonical anchor; this caused a "first-time wrong / second-time
// right" perception loop (the first turn played a cached TTS rendering
// of the lock canonical, the second turn was a fresh rt_voice
// synthesis with a different reading). The fix is to detect the repeat
// intent and replay the most-recent verified artifact byte-for-byte.
const REPEAT_REQUEST_RE =
  /もう一度|もう一回|もっかい|もっぺん|再度|繰り返|聞き直|聞きなお|聞こえません|聞こえなかった|もう少し聞|さっきの|今の.*もう一回/;

export function isRepeatRequest(input: string): boolean {
  return REPEAT_REQUEST_RE.test(input.trim());
}

const SHORT_FRAGMENT_RE =
  /^(?:あ|あっ|え|えっと|えっ|ええと|うーん|うん|よ|yo|jo|ja|ya|はい|なるほど|そうですね|ん|まあ)[。！？!?、,\s]*$/i;

export function isShortNoiseFragment(input: string): boolean {
  const normalized = normalizeUserUtteranceForIntent(input);
  const raw = input.trim();
  if (raw.length === 0) return false;
  return SHORT_FRAGMENT_RE.test(raw) || SHORT_FRAGMENT_RE.test(normalized);
}

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
  // engagement_scope — 2026-05-12 manual regression: "今回の要件は、" /
  // "今回の要件を教えてください" was falling to fallback_unknown because
  // the original /今回の内容/ pattern only covered the "内容" wording.
  // The expanded set adds the "要件" axis so the broker's natural opener
  // ("今回の要件は…") routes to the engagement_scope artifact instead
  // of "求人要件の範囲で整理します。" (the fallback_unknown copy).
  {
    intent: "engagement_scope",
    userPatterns: [
      /今回の内容/,
      /簡単.*内容/,
      /概要/,
      /案件概要/,
      /今回.*要件/,
      /要件.*整理/,
      /要件.*内容/,
      /要件.*教えて/,
      /募集.*要件/,
      /今回.*募集/,
      /^今回の要件/,
      /勤務地/,
      /就業場所/,
      /勤務場所/,
      /場所.*どちら/,
    ],
  },
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
  {
    intent: "headcount",
    userPatterns: [
      /何名.*募集/,
      /募集.*何名/,
      /何人.*募集/,
      /募集.*何人/,
      /募集.*人数/,
      /人数.*募集/,
      /人数.*何名/,
      /何名.*人数/,
      /何名.*(?:お願い|必要|採用|依頼)/,
      /(?:お願い|必要|採用|依頼).*何名/,
    ],
  },
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
  {
    intent: "start_date",
    userPatterns: [/時期的にはいつ/, /開始時期/, /入社時期/, /いつから/, /就業開始/],
  },
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
  // personality — moved BEFORE skill_requirement_broad on 2026-05-12
  // because the expanded skill_requirement_broad set below includes
  // /どんな.*人/ and /どういった.*人/, which would otherwise steal
  // "どんな人柄が合いますか？" from personality (A17). Personality is
  // already the more specific intent here (anchored on 人柄/性格/人物
  // /合う.*人), so promoting it ahead of the broad skill match
  // preserves the load-bearing "specific precedes broad" invariant the
  // PR60 ordering comment encodes.
  { intent: "personality", userPatterns: [/人柄/, /合う.*人/, /人物面/, /性格/] },
  // skill_requirement_broad — 2026-05-12 manual regression: the
  // broker's natural phrasings "どういった方を募集されてますか？" and
  // bare "経験は？" were falling to fallback_unknown. The original
  // pattern set required "どういう/どんな + スキル/経験" and didn't
  // cover the "どういった + 方/人/募集" axis or short-form "経験は？".
  // None of the additions overlap with headcount (/何名|人数|何人/) or
  // hiring_reason (/募集背景/) — both require their own anchor keyword
  // that none of the new patterns include.
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
      /スキルセット/,
      /必須条件/,
      /必修条件/,
      /歓迎条件/,
      /必要条件/,
      /応募条件/,
      /要件.*(?:経験|スキル|条件)/,
      /どういった.*方/,
      /どういった.*人/,
      /どういった.*募集/,
      /どんな.*方/,
      /どんな.*人/,
      /どんな方.*募集/,
      /どんな人.*募集/,
      /求め.*経験/,
      /求め.*スキル/,
      /必要.*経験/,
      /必要.*スキル/,
      /経験.*必要/,
      /^経験は/,
      /経験は[？?]?$/,
      /募集.*方/,
      /募集.*人/,
    ],
  },
  { intent: "billing_rate", userPatterns: [/単価/, /請求/, /時給/, /年収/, /給与/, /レンジ/, /いくら/] },
  // decision_maker — expanded after the 2026-05-12 manual regression
  // ("はい、ありがとうございます。今回はー、決定される方はどなたですか？")
  // missed every original pattern and fell to rt_voice at 11,938ms.
  // The expansion covers natural phrasings: どなた variants, 決定される
  // / 決定する, 決まる, 選定, 判断 + 誰/どなた. Each pattern still has
  // to imply an actor ("誰" or "どなた") to avoid colliding with the
  // 業務内容 / 件数 intents, which also contain 決定 in some
  // adjacent semantics.
  {
    intent: "decision_maker",
    userPatterns: [
      /最終決定/,
      /最終判断/,
      /決裁者/,
      /決裁/,
      /決済書/,
      /決済.*(?:方|人|誰|どなた|者)/,
      /誰になります/,
      /決定.*誰/,
      /決定.*どなた/,
      /決定.*主導/,
      /決定される/,
      /決める.*誰/,
      /決める.*どなた/,
      /決まる.*誰/,
      /決まる.*どなた/,
      /選定.*誰/,
      /選定.*どなた/,
      /判断.*誰/,
      /判断.*どなた/,
      /どなた.*決定/,
      /どなた.*判断/,
      /どなた.*決め/,
      /誰.*決め/,
      /主導.*(?:誰|どなた|方|人|しますか|され)/,
      /(?:誰|どなた).*主導/,
    ],
  },
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
  const raw = input.userText.trim();
  const normalized = normalizeUserUtteranceForIntent(raw);

  if (raw.length === 0) {
    return {
      kind: "unknown_fallback",
      hit: entryToHit(input.cache, "fallback_unknown"),
    };
  }

  // Rapid-fire compound ("AとBとCと…全部教えて") — under the old PR60
  // matcher this returned null and fell to the realtime model. In
  // deterministic mode we MUST not let that path run, so route to the
  // unknown-fallback artifact instead.
  if (isRapidFireCompoundQuestion(raw)) {
    return {
      kind: "rapid_fire_fallback",
      hit: entryToHit(input.cache, "fallback_unknown"),
    };
  }

  // Each intent's regex set is tested against BOTH the raw text and
  // the ack/filler-stripped normalized text. We test raw first so any
  // hypothetical pattern that needs to see the prefix (none today)
  // still works; if raw misses, normalized gets a chance. Hits on
  // either form return the same intent.
  for (const { intent, userPatterns } of INTENT_PATTERNS) {
    if (
      userPatterns.some((pat) => pat.test(raw)) ||
      userPatterns.some((pat) => pat.test(normalized))
    ) {
      return { kind: "intent_hit", hit: entryToHit(input.cache, intent) };
    }
  }

  // Single-と compound that didn't match any single-intent regex (e.g.
  // "業務時間と単価を教えて" with no specific-enough intent winning).
  // Route to multi_intent_redirect rather than guessing.
  if (
    countNounLinkerTo(raw) >= 1 &&
    /教えて|聞かせて|お願いします|伺いたい/.test(raw)
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
