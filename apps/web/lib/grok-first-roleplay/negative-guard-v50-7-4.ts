"use client";

import type {
  NegativeGuardDecision,
  NegativeGuardReason,
} from "./types";

const BASE_CUSTOMER_LED_TAIL_PATTERNS: RegExp[] = [
  /何かご質問(?:は)?ありますか[。！？!?]*$/u,
  /何か他に確認したい点はありますか[。！？!?]*$/u,
  /ご不明点があればお聞きください[。！？!?]*$/u,
  /どこからお話ししましょうか[。！？!?]*$/u,
  /何からお話ししましょうか[。！？!?]*$/u,
  /どんなところからお話ししましょうか[。！？!?]*$/u,
  /どういうところからお聞きになりますか[。！？!?]*$/u,
  /何かお聞きになりたいところからどうぞ[。！？!?]*$/u,
  /こちらの状況をお伝えしましょうか[。！？!?]*$/u,
  /業務内容の大枠からお話ししましょうか[。！？!?]*$/u,
  /条件で確認したいところはありますか[。！？!?]*$/u,
];

// Human-test observed meta-close tails.
// Keep these end-anchored and final-sentence-only.
const HUMAN_OBSERVED_META_CLOSE_TAIL_PATTERNS: RegExp[] = [
  /何かお聞きになりたい(?:点|ところ|部分)?(?:は)?ありますか[。！？!?]*$/u,
  /具体的に(?:どのような|どんな|どの)(?:点|ところ|部分)をお聞きになりますか[。！？!?]*$/u,
  /何か補足で(?:聞きたい|確認したい)(?:点|ところ|部分)?(?:は)?ありますか[。！？!?]*$/u,
  /何か他にございますか[。！？!?]*$/u,
  /何か追加でございますか[。！？!?]*$/u,
  /何か他に確認しておきたい(?:点|ところ|部分)?(?:は)?ありますか[。！？!?]*$/u,
  /何か追加で(?:聞きたい|確認したい)(?:点|ところ|部分)?(?:は)?ありますか[。！？!?]*$/u,
  /何かありましたら(?:お知らせください|(?:お気軽に)?ご連絡ください)[。！？!?]*$/u,
  /ご質問があれば(?:お聞かせ|教えて|お知らせ)ください[。！？!?]*$/u,
];

const CUSTOMER_LED_TAIL_PATTERNS: RegExp[] = [
  ...BASE_CUSTOMER_LED_TAIL_PATTERNS,
  ...HUMAN_OBSERVED_META_CLOSE_TAIL_PATTERNS,
];

const AI_SELF_REFERENCE_PATTERNS: RegExp[] = [
  /(?:私は|自分は|こちらは).{0,8}(?:AI|人工知能|Grok|グロック|言語モデル|アシスタント)(?:です|として)/iu,
  /(?:AI|人工知能|Grok|グロック|言語モデル)として/u,
];

const PROMPT_LEAK_PATTERNS: RegExp[] = [
  /システムプロンプト/u,
  /system\s*prompt/iu,
  /内部指示/u,
  /開発者(?:メッセージ|指示)/u,
  /プロンプト(?:では|には|を)/u,
];

const EVALUATION_LEAK_PATTERNS: RegExp[] = [
  /採点/u,
  /評価基準/u,
  /百点満点/u,
  /点数/u,
  /フィードバック/u,
];

const ROLEPLAY_META_PATTERNS: RegExp[] = [
  /このロープレ/u,
  /このロールプレイ/u,
  /ロープレの設定/u,
  /お客役/u,
  /営業役/u,
];

const NUMERIC_CONTRADICTION_PATTERNS: RegExp[] = [
  /(?:時給|単価|給与).{0,12}(?:0円|無料)/u,
  /(?:開始日|就業開始).{0,16}(?:存在しません|未定です)/u,
];

export function evaluateNegativeGuardV5074(input: {
  text: string;
  userText?: string | undefined;
  phase: "stream" | "final";
}): NegativeGuardDecision {
  const text = input.text.trim();
  const reasons: NegativeGuardReason[] = [];

  if (matchesAny(text, AI_SELF_REFERENCE_PATTERNS)) {
    reasons.push("ai_self_reference");
  }
  if (matchesAny(text, PROMPT_LEAK_PATTERNS)) {
    reasons.push("prompt_leak");
  }
  if (matchesAny(text, EVALUATION_LEAK_PATTERNS)) {
    reasons.push("evaluation_leak");
  }
  if (matchesAny(text, ROLEPLAY_META_PATTERNS)) {
    reasons.push("prompt_leak");
  }
  if (matchesAny(text, NUMERIC_CONTRADICTION_PATTERNS)) {
    reasons.push("numeric_contradiction");
  }

  const uniqueReasons = [...new Set(reasons)];
  const hardStop = uniqueReasons.length > 0;
  if (hardStop) {
    return {
      action: input.phase === "stream" ? "cancel" : "suppress",
      reasons: uniqueReasons,
      stripTail: false,
      dropSentencePatterns: [],
      hardStop: true,
    };
  }

  const tailSentence = getFinalSentence(text);
  const stripTail = Boolean(
    tailSentence && matchesAny(tailSentence, CUSTOMER_LED_TAIL_PATTERNS)
  );
  if (stripTail) {
    return {
      action: "strip_tail",
      reasons: ["customer_led_sales_flow"],
      stripTail: true,
      dropSentencePatterns: CUSTOMER_LED_TAIL_PATTERNS,
      hardStop: false,
    };
  }

  return {
    action: "pass",
    reasons: [],
    stripTail: false,
    dropSentencePatterns: [],
    hardStop: false,
  };
}

export function applyNegativeGuardV5074DeletionOnly(
  text: string,
  decision: NegativeGuardDecision
): string {
  const trimmed = text.trim();
  if (decision.action === "cancel" || decision.action === "suppress") {
    return "";
  }
  if (decision.action !== "strip_tail") {
    return trimmed;
  }

  const sentences = splitSentences(trimmed);
  if (sentences.length === 0) return "";

  let removed = 0;
  while (
    sentences.length > 0 &&
    removed < 3 &&
    matchesAny(sentences.at(-1) ?? "", decision.dropSentencePatterns)
  ) {
    sentences.pop();
    removed += 1;
  }
  return sentences.join("").trim();
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function getFinalSentence(text: string): string {
  const sentences = splitSentences(text);
  return sentences.at(-1) ?? "";
}

function splitSentences(text: string): string[] {
  const matches = text.match(/[^。！？!?]+[。！？!?]?/gu);
  return matches?.map((part) => part.trim()).filter(Boolean) ?? [];
}
