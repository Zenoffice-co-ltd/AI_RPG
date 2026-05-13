"use client";

import type {
  GuardAction,
  NegativeGuardDecision,
  NegativeGuardReason,
} from "./types";

const FORBIDDEN_SUFFIX_PATTERNS: RegExp[] = [
  /(何か|なにか).*(他に|ほかに).*(質問|確認|不明点|気になる点).*(ありますか|ございますか|でしょうか|ですか)[？?。]*$/u,
  /(何か|なにか).*ご?質問.*(ありますか|ございますか|でしょうか|ですか)[？?。]*$/u,
  /(他に|ほかに).*(質問|確認|不明点|聞きたい点).*(ありますか|ございますか|でしょうか|ですか)[？?。]*$/u,
  /詳しく知りたい点があれば教えてください[？?。]*$/u,
  /ご質問があれば.*(お聞かせ|教えて|お知らせ|お答え)/u,
  /ご質問.*お願いします[？?。]*$/u,
  /ご不明点があれば/u,
  /いつでもお気軽に/u,
  /何かございましたら/u,
];

const AI_SELF_REFERENCE_PATTERNS: RegExp[] = [
  /\bAI\b/iu,
  /Grok/iu,
  /アシスタント/u,
  /ロールプレイ/u,
  /シナリオ/u,
  /モデルとして/u,
  /音声モデル/u,
];

const PROMPT_LEAK_PATTERNS: RegExp[] = [
  /システムプロンプト/u,
  /内部指示/u,
  /開発者指示/u,
  /プロンプト.*(内容|全文|指示)/u,
  /隠された.*(指示|情報)/u,
  /指示にない/u,
];

const EVALUATION_LEAK_PATTERNS: RegExp[] = [
  /採点/u,
  /評価基準/u,
  /加点/u,
  /減点/u,
  /フィードバックとして/u,
  /次回は.*聞く/u,
];

const UNNATURAL_AI_PHRASE_PATTERNS: RegExp[] = [
  /整理していきたいと思います/u,
  /整理します/u,
  /整理させてください/u,
  /順次確認/u,
  /共有させていただきます/u,
  /お聞かせください/u,
  /いただければと思います/u,
  /そのようなことは言えません/u,
  /できません/u,
];

const NUMERIC_CONTRADICTION_PATTERNS: RegExp[] = [
  /(?:三名|3名|三人|3人).*募集/u,
  /(?:二名|2名|二人|2人).*募集/u,
  /(?:五百|500).*件/u,
  /(?:八百|800).*件/u,
  /(?:二千|2000).*円/u,
];

const PREMATURE_SENSITIVE_FACT_PATTERNS: RegExp[] = [
  /独占/u,
  /条件緩和/u,
  /単価.*(下げ|上げ|余地|交渉)/u,
  /競合/u,
  /現行.*(不満|ベンダー)/u,
  /半年後.*(期待|任せたい)/u,
  /現場課長.*(意見が強い|最終判断)/u,
];

const CUSTOMER_COACHING_PATTERNS: RegExp[] = [
  /聞いていただくと/u,
  /確認していただくと/u,
  /質問していただければ/u,
  /次に.*聞/u,
  /営業としては/u,
];

const CUSTOMER_LED_SALES_FLOW_PATTERNS: RegExp[] = [
  /では次に/u,
  /順番に/u,
  /まず.*確認しましょう/u,
  /進めてください/u,
  /教えていただけますか/u,
  /お聞かせいただけますか/u,
  /どんな方を想定/u,
  /要件に合う.*お願いします/u,
  /ぜひお願いします/u,
  /助かります/u,
];

export function evaluateNegativeGuard(input: {
  text: string;
  userText?: string | undefined;
  phase: "stream" | "final";
}): NegativeGuardDecision {
  const text = input.text.trim();
  const reasons: NegativeGuardReason[] = [];

  if (matchesAny(text, FORBIDDEN_SUFFIX_PATTERNS)) {
    reasons.push("forbidden_suffix", "generic_closing_question");
  }
  if (matchesAny(text, AI_SELF_REFERENCE_PATTERNS)) {
    reasons.push("ai_self_reference");
  }
  if (matchesAny(text, PROMPT_LEAK_PATTERNS)) {
    reasons.push("prompt_leak");
  }
  if (matchesAny(text, EVALUATION_LEAK_PATTERNS)) {
    reasons.push("evaluation_leak");
  }
  if (matchesAny(text, NUMERIC_CONTRADICTION_PATTERNS)) {
    reasons.push("numeric_contradiction");
  }
  if (
    isShallowUserQuestion(input.userText ?? "") &&
    matchesAny(text, PREMATURE_SENSITIVE_FACT_PATTERNS)
  ) {
    reasons.push("premature_sensitive_reveal");
  }
  if (matchesAny(text, UNNATURAL_AI_PHRASE_PATTERNS)) {
    reasons.push("unnatural_ai_phrase");
  }
  if (matchesAny(text, CUSTOMER_COACHING_PATTERNS)) {
    reasons.push("customer_coaching");
  }
  if (matchesAny(text, CUSTOMER_LED_SALES_FLOW_PATTERNS)) {
    reasons.push("customer_led_sales_flow");
  }

  const uniqueReasons = [...new Set(reasons)];
  const hardStop =
    uniqueReasons.includes("ai_self_reference") ||
    uniqueReasons.includes("prompt_leak") ||
    uniqueReasons.includes("evaluation_leak") ||
    uniqueReasons.includes("numeric_contradiction") ||
    uniqueReasons.includes("premature_sensitive_reveal");

  const action = selectAction(uniqueReasons, hardStop, input.phase);
  return {
    action,
    reasons: uniqueReasons,
    stripTail:
      uniqueReasons.includes("forbidden_suffix") ||
      uniqueReasons.includes("generic_closing_question"),
    dropSentencePatterns: [
      ...FORBIDDEN_SUFFIX_PATTERNS,
      ...UNNATURAL_AI_PHRASE_PATTERNS,
      ...CUSTOMER_COACHING_PATTERNS,
      ...CUSTOMER_LED_SALES_FLOW_PATTERNS,
    ],
    hardStop,
  };
}

export function applyNegativeGuardDeletionOnly(
  text: string,
  decision: NegativeGuardDecision
): string {
  if (decision.action === "pass" || decision.action === "metric") {
    return text.trim();
  }
  if (decision.action === "suppress" || decision.action === "cancel") {
    return "";
  }
  const sentences = splitSentences(text);
  const kept = sentences.filter(
    (sentence) =>
      !decision.dropSentencePatterns.some((pattern) => pattern.test(sentence))
  );
  if (decision.stripTail && kept.length === sentences.length) {
    kept.pop();
  }
  return kept.join("").trim();
}

export function isRiskyTailTurn(userText: string): boolean {
  return /よろしく|ありがとう|失礼|はい|なるほど|そうですね|AI|プロンプト|指示|採点|評価|他に|質問/u.test(
    userText
  );
}

function selectAction(
  reasons: NegativeGuardReason[],
  hardStop: boolean,
  phase: "stream" | "final"
): GuardAction {
  if (reasons.length === 0) return "pass";
  if (hardStop) return phase === "stream" ? "cancel" : "suppress";
  if (
    reasons.includes("forbidden_suffix") ||
    reasons.includes("generic_closing_question")
  ) {
    return "strip_tail";
  }
  if (
    reasons.includes("unnatural_ai_phrase") ||
    reasons.includes("customer_coaching") ||
    reasons.includes("customer_led_sales_flow")
  ) {
    return "drop_sentence";
  }
  return "metric";
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isShallowUserQuestion(userText: string): boolean {
  const text = userText.trim();
  if (text.length === 0) return false;
  if (/半年後|二.?三か月|入社直後|指揮命令者|管理|合う人|合わない|単価|決裁|条件緩和|競合/u.test(text)) {
    return false;
  }
  return /業務内容|どんな仕事|募集背景|要件|条件|どんな人|教えて/u.test(text);
}

function splitSentences(text: string): string[] {
  const matches = text.match(/[^。！？!?]+[。！？!?]?/gu);
  return matches?.map((part) => part.trim()).filter(Boolean) ?? [];
}
