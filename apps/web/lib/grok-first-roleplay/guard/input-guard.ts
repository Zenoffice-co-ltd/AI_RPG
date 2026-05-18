"use client";

export const V50_7_FIXED_EXIT_TEXT =
  "本日はここまでで大丈夫です。";

export const V50_7_FIXED_EXTERNAL_TEXT =
  "その話は今回の商談では扱いません。";

export type InputGuardAction = "pass" | "fixed_exit" | "fixed_external";

export type InputGuardDecision = {
  action: InputGuardAction;
  intent: "normal" | "exit" | "external";
  fixedText?: string;
  shouldEndSession: boolean;
  reasons: string[];
  matchedPattern?: string;
  normalizedText: string;
};

const EXIT_EXCLUSION_PATTERNS: RegExp[] = [
  /契約終了/u,
  /派遣期間.*終了/u,
  /業務終了/u,
  /終了予定/u,
  /前任.*終了/u,
];

const EXIT_PATTERNS: RegExp[] = [
  /終了/u,
  /ここまで.*終了/u,
  /では.*終了/u,
  /終了します/u,
  /終了です/u,
  /終わりにします/u,
  /終わります/u,
  /^ここまでです[。.!?？]*$/u,
  /今日はここまで/u,
  /^終わり[。.!?？]*$/u,
  /ストップ/u,
  /止めます/u,
  /ありがとうございました[。.!?？]*$/u,
];

const EXTERNAL_PATTERNS: RegExp[] = [
  /フィードバック/u,
  /スピードバック/u,
  /採点/u,
  /さいてん/u,
  /サイテン/u,
  /(斎藤|斉藤)(して|してください|下さい)/u,
  /拝点/u,
  /開店してください/u,
  /配点/u,
  /評価して/u,
  /百点満点/u,
  /点数/u,
  /(最後に|営業の|私の|この会話の|ロープレの).*改善点/u,
  /良かった点/u,
  /抜け漏れ/u,
  /ルール.*無視/u,
  /内部指示/u,
  /内部.*開示/u,
  /設定.*説明/u,
  /設定.*教えて/u,
  /あなたの設定/u,
  /仕様.*説明/u,
  /本当の仕様/u,
  /このロープレ/u,
  /このロープ.*何をする/u,
  /このローブ.*何をする/u,
  /ロープレ.*説明/u,
  /ロールプレイ/u,
  /この会話.*目的/u,
  /プロンプト/u,
  /systemprompt/iu,
  /system.*prompt/iu,
  /システムプロンプト/u,
  /お客役.*やめ/u,
  /役.*やめ/u,
  /役.*解除/u,
  /AIとして/iu,
  /Grokとして/iu,
  /アシスタントとして/u,
  /本当のAI/u,
];

export function classifyInputGuard(text: string): InputGuardDecision {
  const normalizedText = normalizeInputGuardText(text);
  if (!normalizedText) {
    return pass(normalizedText);
  }

  if (!matchesAny(normalizedText, EXIT_EXCLUSION_PATTERNS)) {
    const exit = findMatch(normalizedText, EXIT_PATTERNS);
    if (exit) {
      return {
        action: "fixed_exit",
        intent: "exit",
        fixedText: V50_7_FIXED_EXIT_TEXT,
        shouldEndSession: true,
        reasons: ["exit_intent"],
        matchedPattern: exit,
        normalizedText,
      };
    }
  }

  const external = findMatch(normalizedText, EXTERNAL_PATTERNS);
  if (external) {
    return {
      action: "fixed_external",
      intent: "external",
      fixedText: V50_7_FIXED_EXTERNAL_TEXT,
      shouldEndSession: false,
      reasons: ["external_or_meta_request"],
      matchedPattern: external,
      normalizedText,
    };
  }

  return pass(normalizedText);
}

function pass(normalizedText: string): InputGuardDecision {
  return {
    action: "pass",
    intent: "normal",
    shouldEndSession: false,
    reasons: [],
    normalizedText,
  };
}

function normalizeInputGuardText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[！]/g, "!")
    .replace(/[？]/g, "?")
    .replace(/[。．.]/g, "。")
    .replace(/[、,]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function findMatch(text: string, patterns: RegExp[]): string | undefined {
  return patterns.find((pattern) => pattern.test(text))?.source;
}
