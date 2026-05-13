import type { CanonicalIntent } from "./registered-speech/canonical-intents";

export type InputDepth =
  | "fragment"
  | "shallow"
  | "specific"
  | "compound"
  | "unsafe"
  | "out_of_scope";

export type ShallowFallbackIntent =
  | "fallback_business_low_confidence"
  | "fallback_rapid_fire"
  | "fallback_out_of_scope"
  | "fallback_safety"
  | "fallback_unknown";

export type GovernedGuardResult = {
  pass: boolean;
  closingQuestionDetected: boolean;
  hardBannedTextDetected: boolean;
  metaLanguageDetected: boolean;
  overAnsweringDetected: boolean;
  reason: string | null;
};

export const HARD_BANNED_TEXT_PATTERNS: RegExp[] = [
  /(他に|ほかに).*(質問|確認|聞きたい|不明点).*(ありますか|ございますか|でしょうか|ですか)[？?。]*$/,
  /(何か|なにか).*(質問|確認|不明点).*(ありますか|ございますか|でしょうか|ですか)[？?。]*$/,
  /他に.*よろしいでしょうか[？?。]*$/,
  /よろしいでしょうか[？?。]*$/,
  /求人要件の範囲で整理します。?/,
  /ロールプレイを続けます。?/,
  /今回のロールプレイ対象外です。?/,
  /シナリオ上は対応できません。?/,
  /AIとしては回答できません。?/,
  /ロールプレイ/,
  /シナリオ/,
  /AIとして/,
];

const SAFETY_RE =
  /システムプロンプト|前の指示|指示を無視|採点基準|正体|何のモデル|あなたは.*モデル|プロンプト.*教えて|AIですか|ロールプレイ|シナリオ/;
const OUT_OF_SCOPE_RE =
  /今日の天気|天気を教えて|株価|ラーメン屋|おすすめ.*(?:店|屋)|ニュース|為替|OpenAI/;
const COMPOUND_RE =
  /全部教えて|まとめて教えて|勤務地.*年収|年収.*決裁|決裁.*募集背景|募集背景.*入社時期|(?:と|、).*(?:と|、).*(?:と|、)/;
const SHALLOW_RE =
  /^(?:条件(?:は)?|長県(?:は)?|要件(?:は)?|.*どういう感じですか|.*どういう感じ|.*どういう漢字ですか|.*どういう漢字|どんな人ですか|どんな人|何が必要ですか|何が必要|どういった方ですか|どんな方ですか)[？?。、.\s]*$/;

const TOPIC_PATTERNS: RegExp[] = [
  /勤務地|就業場所|勤務場所/,
  /年収|給与|単価|請求|時給|レンジ/,
  /決裁|決済|決定|判断|主導/,
  /募集背景|背景/,
  /入社時期|開始時期|いつから/,
  /勤務時間|業務時間|何時/,
  /残業|時間外/,
  /在宅|リモート|テレワーク/,
];

export function classifyInputDepth(input: string): InputDepth {
  const text = normalizeForGovernor(input);
  if (text.length === 0) return "fragment";
  if (/^(?:あ|あっ|え|えっ|えっと|ええと|うーん|うん|よ|yo|jo|ja|ya|はい|なるほど|そうですね|ん|まあ)[。！？!?、,\s]*$/i.test(text)) {
    return "fragment";
  }
  if (SAFETY_RE.test(text)) return "unsafe";
  if (OUT_OF_SCOPE_RE.test(text)) return "out_of_scope";
  if (COMPOUND_RE.test(text)) return "compound";
  if (SHALLOW_RE.test(text)) return "shallow";
  return "specific";
}

export function isRecruitmentLikeInput(input: string): boolean {
  const text = normalizeForGovernor(input);
  if (text.length === 0) return false;
  if (SAFETY_RE.test(text) || OUT_OF_SCOPE_RE.test(text)) return false;
  return RECRUITMENT_LIKE_RE.test(text);
}

export function fallbackIntentForInputDepth(
  depth: InputDepth
): ShallowFallbackIntent {
  switch (depth) {
    case "shallow":
    case "specific":
      return "fallback_business_low_confidence";
    case "compound":
      return "fallback_rapid_fire";
    case "unsafe":
      return "fallback_safety";
    case "out_of_scope":
      return "fallback_out_of_scope";
    case "fragment":
    default:
      return "fallback_unknown";
  }
}

export function selectFixedFallbackArtifactIntent(input: {
  fallbackIntent: ShallowFallbackIntent;
  sessionId: string;
  turnIndex: number;
  userText: string;
}): CanonicalIntent {
  const candidates = FIXED_FALLBACK_ARTIFACTS[input.fallbackIntent];
  const index =
    stableHash(`${input.sessionId}:${input.turnIndex}:${normalizeForGovernor(input.userText)}`) %
    candidates.length;
  return candidates[index] ?? "fallback_unknown_01";
}

export function evaluateGovernedResponse(input: {
  text: string;
  userText: string;
  inputDepth: InputDepth;
  policy?: "natural" | "short";
}): GovernedGuardResult {
  const text = input.text.trim();
  const closingQuestionDetected = HARD_BANNED_TEXT_PATTERNS.slice(0, 4).some(
    (pattern) => pattern.test(text)
  );
  const hardBannedTextDetected = HARD_BANNED_TEXT_PATTERNS.some((pattern) =>
    pattern.test(text)
  );
  const metaLanguageDetected = /ロールプレイ|シナリオ|AIとして/.test(text);
  const overAnsweringDetected = detectOverAnswering({
    text,
    userText: input.userText,
    inputDepth: input.inputDepth,
    policy: input.policy ?? "natural",
  });
  const pass =
    !closingQuestionDetected &&
    !hardBannedTextDetected &&
    !metaLanguageDetected &&
    !overAnsweringDetected;
  return {
    pass,
    closingQuestionDetected,
    hardBannedTextDetected,
    metaLanguageDetected,
    overAnsweringDetected,
    reason: pass
      ? null
      : [
          closingQuestionDetected ? "closing_question" : null,
          hardBannedTextDetected ? "hard_banned_text" : null,
          metaLanguageDetected ? "meta_language" : null,
          overAnsweringDetected ? "over_answering" : null,
        ]
          .filter(Boolean)
          .join(","),
  };
}

export function normalizeForGovernor(input: string): string {
  return input.trim().replace(/[、,]/g, " ").replace(/\s+/g, " ");
}

function detectOverAnswering(input: {
  text: string;
  userText: string;
  inputDepth: InputDepth;
  policy: "natural" | "short";
}): boolean {
  const sentenceCount = input.text
    .split(/[。！？!?]/)
    .map((part) => part.trim())
    .filter(Boolean).length;
  const charCount = input.text.replace(/\s/g, "").length;
  const topicCount = TOPIC_PATTERNS.filter((pattern) => pattern.test(input.text))
    .length;
  if (input.policy === "short") {
    if (input.inputDepth === "shallow") {
      return sentenceCount > 1 || charCount > 50 || topicCount > 1;
    }
    if (input.inputDepth === "specific") {
      return sentenceCount > 1 || charCount > 80 || topicCount > 1;
    }
    if (input.inputDepth === "compound") {
      return sentenceCount > 1 || charCount > 70 || topicCount > 1;
    }
    return false;
  }
  if (input.inputDepth === "shallow") {
    return sentenceCount > 1 || charCount > 60 || topicCount > 1;
  }
  if (input.inputDepth === "specific") {
    return sentenceCount > 2 || charCount > 120 || topicCount > 1;
  }
  if (input.inputDepth === "compound") {
    return sentenceCount > 1 || charCount > 80 || topicCount > 1;
  }
  return false;
}

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const FIXED_FALLBACK_ARTIFACTS: Record<
  ShallowFallbackIntent,
  CanonicalIntent[]
> = {
  fallback_business_low_confidence: [
    "fallback_business_low_confidence_01",
    "fallback_business_low_confidence_02",
    "fallback_business_low_confidence_03",
  ],
  fallback_rapid_fire: ["fallback_rapid_fire_01", "fallback_rapid_fire_02"],
  fallback_out_of_scope: ["fallback_out_of_scope_01", "fallback_out_of_scope_02"],
  fallback_safety: ["fallback_safety_01", "fallback_safety_02"],
  fallback_unknown: ["fallback_unknown_01"],
};

const RECRUITMENT_LIKE_RE =
  /求人|要件|募集|人員|人数|何名|何人|スキル|経験|条件|必須|歓迎|業務|仕事|内容|受注|発注|納期|背景|増員|繁忙|繁忙期|忙しい|時期|増え|決裁|決済|主導|判断|承認|単価|時給|年収|給与|レンジ|勤務地|勤務|残業|在宅|リモート|開始|入社|派遣|スタッフ|候補者|人柄|性格|既存|不満|現場|営業|物流|どういう感じ|どんな感じ|どんな人|どんな方|何が必要/;
