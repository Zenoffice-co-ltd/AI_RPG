"use client";

import type {
  GuardAction,
  NegativeGuardDecision,
  NegativeGuardReason,
} from "./types";

const FORBIDDEN_SUFFIX_PATTERNS: RegExp[] = [
  /^よろしく(お願いします|お願いいたします)/u,
  /^お願い(します|いたします|しています|してます)/u,
  /何かご質問(ありますか|ございますか)/u,
  /ご質問(ありますか|ございますか)/u,
  /よろしいでしょうか/u,
  /よろしいでしょうか[？?。]*$/u,
  /(何か|なにか).*(他に|ほかに).*(質問|確認|不明点|気になる点).*(ありますか|ございますか|でしょうか|ですか)[？?。]*$/u,
  /(他に|ほかに).*(質問|確認|不明点|聞きたい点).*(ありますか|ございますか|でしょうか|ですか)[？?。]*$/u,
  /(条件|詳細|内容).*(確認したい|聞きたい|知りたい).*(ところ|点|部分).*(ありますか|ございますか|でしょうか|ですか)[？?。]*$/u,
  /(確認したい|聞きたい|知りたい|お聞きになりたい).*(ところ|点|こと).*(あれば|ありましたら|あったら).*(おっしゃって|教えて|言って)/u,
  /(条件|詳細|内容).*(お伝え|お話し).*(しましょうか|できますか)[？?。]*$/u,
  /具体的に.*条件.*お聞きになりたい点があれば.*(おっしゃって|教えて|お知らせ)/u,
  /詳しく知りたい点があれば教えてください[？?。]*$/u,
  /ご質問があれば.*(お聞かせ|教えて|お知らせ)/u,
  /ご質問(ください|いただければ|いただければお答え)/u,
  /質問(ください|いただければ|いただければお答え)/u,
  /ご不明点があれば/u,
  /いつでもお気軽に/u,
  /何かございましたら/u,
  /お聞きください/u,
  /お聞きいただければ/u,
  /おっしゃってください/u,
  /教えてください/u,
  /お伝えください/u,
  /お伝えいただければ/u,
  /ご確認いただけますか/u,
  /お願いします[。！？!?]*$/u,
  /よろしく(お願いします|お願いいたします)?[。！？!?]*$/u,
  /お願い(します|いたします|しています|してます)[。！？!?]*$/u,
  /確認します[。！？!?]*$/u,
  /助かります[。！？!?]*$/u,
];

const GENERIC_CLOSING_QUESTION_PATTERNS: RegExp[] = [
  /何かご質問(ありますか|ございますか)/u,
  /ご質問(ありますか|ございますか)/u,
  /(何か|なにか).*(他に|ほかに)/u,
  /(条件|詳細|内容).*(確認したい|聞きたい|知りたい).*(ところ|点|部分).*(ありますか|ございますか|でしょうか|ですか)[？?。]*$/u,
  /(確認したい|聞きたい|知りたい|お聞きになりたい).*(ところ|点|こと).*(あれば|ありましたら|あったら).*(おっしゃって|教えて|言って)/u,
  /(条件|詳細|内容).*(お伝え|お話し).*(しましょうか|できますか)[？?。]*$/u,
  /具体的に.*条件.*お聞きになりたい点があれば.*(おっしゃって|教えて|お知らせ)/u,
  /ご質問があれば/u,
  /ご質問(ください|いただければ|いただければお答え)/u,
  /質問(ください|いただければ|いただければお答え)/u,
  /ご不明点があれば/u,
  /よろしいでしょうか/u,
  /よろしいでしょうか[？?。]*$/u,
  /具体的に知りたい部分があれば/u,
  /このあたりで大丈夫でしょうか/u,
  /このまま続けますか/u,
  /商談を続けましょうか/u,
  /気になる点はありますか/u,
  /確認しておきたい点はありますか/u,
  /具体的にどのあたりをお聞きになりますか/u,
  /具体的に聞きたい部分があれば/u,
  /深掘りが必要でしたら/u,
  /詳細が必要でしたら/u,
];

const AI_SELF_REFERENCE_PATTERNS: RegExp[] = [
  /\bAI\b/iu,
  /Grok/iu,
  /アシスタント/u,
  /ロールプレイ/u,
  /このロープレ/u,
  /シナリオ/u,
  /設定/u,
  /仕様/u,
  /ルール/u,
  /モデルとして/u,
  /音声モデル/u,
  /住宅設備メーカーの人事担当者として/u,
  /派遣オーダーのヒアリングを進める/u,
];

const PROMPT_LEAK_PATTERNS: RegExp[] = [
  /システムプロンプト/u,
  /内部指示/u,
  /開発者指示/u,
  /プロンプト.*(内容|全文|指示)/u,
  /隠された.*(指示|情報)/u,
  /とだけ答えて/u,
  /句点の後/u,
  /営業への質問返し/u,
  /次の話題提案/u,
  /何も足さない/u,
  /補足を出さない/u,
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
  /整理していきましょう/u,
  /お話ししながら整理/u,
  /整理します/u,
  /整理させてください/u,
  /順次確認/u,
  /共有させていただきます/u,
  /お聞かせください/u,
  /いただければと思います/u,
  /共有できますよ/u,
  /内容は共有できます/u,
  /営業への質問返し/u,
  /次の話題提案は出さない/u,
  /こちらの理解で合っていますか/u,
  /理解で合っていますか/u,
  /この辺りが主な背景/u,
  /背景は(そんな|その|この|主な).*(ところ|あたり).*ですね/u,
  /お電話ありがとうございます/u,
  /お電話ありがとうございました/u,
  /ごきげんよう/u,
  /失礼いたします/u,
  /お気をつけて/u,
  /本日はありがとうございました/u,
  /また何かありましたら/u,
  /ご連絡ください/u,
  /お時間いただきありがとうございます/u,
  /お気軽に/u,
  /ご自身でお願いできますか/u,
  /整理はご自身で/u,
  /候補者が出ましたら/u,
  /まずはスキルカードで確認します/u,
];

const RISKY_TURN_ACK_DROP_PATTERNS: RegExp[] = [
  /^ありがとうございます[。！？!?]*$/u,
  /^承知しました[。！？!?]*$/u,
  /^了解しました[。！？!?]*$/u,
];

const CONTINUATION_EXTRA_SENTENCE_PATTERNS: RegExp[] = [
  /そのため/u,
  /その結果/u,
  /背景は/u,
  /この辺り/u,
  /その辺り/u,
  /そのあたり/u,
  /代理店/u,
  /工務店/u,
  /対応が.*遅/u,
  /遅れがち/u,
  /営業管理課/u,
  /追いつき/u,
  /対応が.*追いつ/u,
  /その理解で近い/u,
  /背景の補足/u,
  /お話しの背景/u,
  /今回のお話し/u,
  /背景になります/u,
  /必要でしたら/u,
  /お知らせください/u,
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
  /現場課長/u,
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
  /要件に合う方なら.*お願いします/u,
  /何かご質問(ありますか|ございますか)/u,
  /ご質問(ありますか|ございますか)/u,
  /よろしいでしょうか[？?。]*$/u,
  /どんなところから.*お話ししましょうか/u,
  /何から.*お話ししましょうか/u,
  /どこから.*お話ししましょうか/u,
  /少し詳しく.*お話ししましょうか/u,
  /少し詳しく.*お伝えしますか/u,
  /(条件|詳細|内容).*(お伝え|お話し).*(しましょうか|できますか)/u,
  /業務内容や条件.*お話しできます/u,
  /業務内容や条件.*どこから/u,
  /業務内容の大枠から.*お話ししましょうか/u,
  /どういうところから.*お聞きになりますか/u,
  /どんなところ.*(滞っている|困っている|詰まっている).*(伺えますか|聞かせ|教えて)/u,
  /(もう少し|少し)?詳しく(伺えますか|お聞かせ|教えて)/u,
  /詳しい業務の流れ.*お聞きいただけますか/u,
  /お聞きいただけますか[。！？!?]*$/u,
  /お聞かせいただけますか[。！？!?]*$/u,
  /(必要|よければ|よろしければ|あれば).*(お聞きください|聞いてください|教えてください)/u,
  /(確認したい|聞きたい|知りたい|お聞きになりたい).*(ところ|点|こと).*(あれば|ありましたら|あったら).*(おっしゃって|教えて|言って)/u,
  /お聞きください[。！？!?]*$/u,
  /ご相談できればと思います/u,
  /相談できればと思います/u,
  /要件に合う.*お願いします/u,
  /要件に合う.*ぜひ/u,
  /ぜひお願いします/u,
  /助かります/u,
  /ご質問(ください|いただければ|いただければお答え)/u,
  /質問(ください|いただければ|いただければお答え)/u,
  /お聞きになりますか/u,
  /お話しできますよ/u,
  /お話ししましょうか/u,
  /何か他に/u,
  /何かご質問/u,
  /ご質問があれば/u,
  /どの部分をお聞きでしょうか/u,
  /具体的に.*お聞きでしょうか/u,
  /どの部分を.*お聞き/u,
  /候補.*(経験|スキル).*(お聞かせ|教えて).*いただけますか/u,
  /具体的に.*条件.*お聞きになりたい点があれば.*(おっしゃって|教えて|お知らせ)/u,
];

const TAIL_ONLY_BAD_PATTERNS: RegExp[] = [
  /お聞きになった後で/u,
  /後で補足します/u,
  /補足しますね/u,
  /詳細は.*補足/u,
  /業務内容をお聞きになった後/u,
];

export function evaluateNegativeGuard(input: {
  text: string;
  userText?: string | undefined;
  phase: "stream" | "final";
}): NegativeGuardDecision {
  const text = input.text.trim();
  const riskyTailTurn = isRiskyTailTurn(input.userText ?? "");
  const continueOnlyTurn = isContinueOnlyTurn(input.userText ?? "");
  const reasons: NegativeGuardReason[] = [];

  if (matchesAny(text, FORBIDDEN_SUFFIX_PATTERNS)) {
    reasons.push(
      "forbidden_suffix",
      "generic_closing_question",
      "unnatural_ai_phrase"
    );
  }
  if (matchesAny(text, GENERIC_CLOSING_QUESTION_PATTERNS)) {
    reasons.push(
      "forbidden_suffix",
      "generic_closing_question",
      "unnatural_ai_phrase"
    );
  }
  if (riskyTailTurn && matchesAny(text, RISKY_TURN_ACK_DROP_PATTERNS)) {
    reasons.push("forbidden_suffix");
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
  if (continueOnlyTurn && splitSentences(text).length > 1) {
    reasons.push("unnatural_ai_phrase");
  }
  if (matchesAny(text, CUSTOMER_COACHING_PATTERNS)) {
    reasons.push("customer_coaching");
  }
  if (matchesAny(text, CUSTOMER_LED_SALES_FLOW_PATTERNS)) {
    reasons.push("customer_led_sales_flow");
  }
  if (matchesAny(text, TAIL_ONLY_BAD_PATTERNS)) {
    reasons.push("customer_led_sales_flow");
  }
  if (text && isLowInformationOnlyUserInput(input.userText ?? "")) {
    reasons.push("low_information_input_new_topic");
  }

  const uniqueReasons = [...new Set(reasons)];
  const hardStop =
    uniqueReasons.includes("ai_self_reference") ||
    uniqueReasons.includes("prompt_leak") ||
    uniqueReasons.includes("evaluation_leak") ||
    uniqueReasons.includes("numeric_contradiction") ||
    uniqueReasons.includes("premature_sensitive_reveal") ||
    uniqueReasons.includes("low_information_input_new_topic");

  const action = selectAction(uniqueReasons, hardStop, input.phase, text);
  return {
    action,
    reasons: uniqueReasons,
    stripTail:
      uniqueReasons.includes("forbidden_suffix") ||
      uniqueReasons.includes("generic_closing_question"),
    dropSentencePatterns: [
      ...FORBIDDEN_SUFFIX_PATTERNS,
      ...GENERIC_CLOSING_QUESTION_PATTERNS,
      ...UNNATURAL_AI_PHRASE_PATTERNS,
      ...PREMATURE_SENSITIVE_FACT_PATTERNS,
      ...CUSTOMER_COACHING_PATTERNS,
      ...CUSTOMER_LED_SALES_FLOW_PATTERNS,
      ...(riskyTailTurn && action !== "strip_tail"
        ? RISKY_TURN_ACK_DROP_PATTERNS
        : []),
      ...(continueOnlyTurn ? CONTINUATION_EXTRA_SENTENCE_PATTERNS : []),
      ...TAIL_ONLY_BAD_PATTERNS,
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
  return /よろしく|ありがとう|失礼|はい|うん|なるほど|そうですね|そうですか|そうなんですね|了解|背景|募集背景|業務内容|条件|教えて|確認|AI|プロンプト|指示|採点|評価|他に|質問|候補者|候補|提案|紹介|探して|探す|出せ|出して|お願いします|お願い|決め|即決|進めて/u.test(
    userText
  );
}

function selectAction(
  reasons: NegativeGuardReason[],
  hardStop: boolean,
  phase: "stream" | "final",
  text: string
): GuardAction {
  if (reasons.length === 0) return "pass";
  const tailOnlySafeBody = hasSafeBodyAfterDroppingBadSentences(text, reasons);
  if (
    reasons.includes("premature_sensitive_reveal") &&
    !reasons.some((reason) =>
      [
        "ai_self_reference",
        "prompt_leak",
        "evaluation_leak",
        "numeric_contradiction",
        "low_information_input_new_topic",
      ].includes(reason)
    )
  ) {
    if (phase === "stream" && tailOnlySafeBody) return "drop_sentence";
    return phase === "stream" ? "cancel" : "drop_sentence";
  }
  if (hardStop) return phase === "stream" ? "cancel" : "suppress";
  if (
    reasons.includes("customer_led_sales_flow") &&
    !matchesAny(text, GENERIC_CLOSING_QUESTION_PATTERNS)
  ) {
    if (phase === "stream" && tailOnlySafeBody) return "drop_sentence";
    return phase === "stream" ? "cancel" : "drop_sentence";
  }
  if (
    reasons.includes("forbidden_suffix") ||
    reasons.includes("generic_closing_question")
  ) {
    if (phase === "stream" && tailOnlySafeBody) return "strip_tail";
    return phase === "stream" ? "cancel" : "strip_tail";
  }
  if (
    reasons.includes("premature_sensitive_reveal") ||
    reasons.includes("unnatural_ai_phrase") ||
    reasons.includes("customer_coaching")
  ) {
    if (phase === "stream" && tailOnlySafeBody) return "drop_sentence";
    return phase === "stream" ? "cancel" : "drop_sentence";
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

function isLowInformationOnlyUserInput(userText: string): boolean {
  const normalized = userText
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[！!？?。．.、,\s]/g, "")
    .trim();
  if (!normalized) return false;
  if (/詳しく|続けて|背景|業務内容|条件|教えて|確認|概要|募集/u.test(normalized)) {
    return false;
  }
  return /^(はい|うん|そうですね|そうですか|なるほど|分かりました|わかりました|ありがとうございます|了解です|へえ|あそうなんですね|はいはい|なるほどですね|なるほどそういう感じなんですね)$/u.test(
    normalized
  );
}

function isContinueOnlyTurn(userText: string): boolean {
  const normalized = userText
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[！!？?。．.、,\s]/g, "")
    .trim();
  return /^(分かりました|わかりました)?続けてください$/.test(normalized);
}

function splitSentences(text: string): string[] {
  const matches = text.match(/[^。！？!?]+[。！？!?]?/gu);
  return matches?.map((part) => part.trim()).filter(Boolean) ?? [];
}

function hasSafeBodyAfterDroppingBadSentences(
  text: string,
  reasons: NegativeGuardReason[]
): boolean {
  if (!text.trim()) return false;
  const decision: NegativeGuardDecision = {
    action: "drop_sentence",
    reasons,
    stripTail:
      reasons.includes("forbidden_suffix") ||
      reasons.includes("generic_closing_question"),
    dropSentencePatterns: [
      ...FORBIDDEN_SUFFIX_PATTERNS,
      ...GENERIC_CLOSING_QUESTION_PATTERNS,
      ...UNNATURAL_AI_PHRASE_PATTERNS,
      ...PREMATURE_SENSITIVE_FACT_PATTERNS,
      ...CUSTOMER_COACHING_PATTERNS,
      ...CUSTOMER_LED_SALES_FLOW_PATTERNS,
      ...RISKY_TURN_ACK_DROP_PATTERNS,
      ...CONTINUATION_EXTRA_SENTENCE_PATTERNS,
      ...TAIL_ONLY_BAD_PATTERNS,
    ],
    hardStop: false,
  };
  const safeBody = applyNegativeGuardDeletionOnly(text, decision);
  if (!safeBody) return false;
  return safeBody.length < text.trim().length;
}
