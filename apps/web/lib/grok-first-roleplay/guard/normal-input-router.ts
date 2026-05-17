"use client";

export type NormalInputRouteAction =
  | "pass"
  | "noise_ignored"
  | "opening_ack";

export type NormalInputRouteDecision = {
  action: NormalInputRouteAction;
  reasons: string[];
  normalizedText: string;
  fixedText?: string;
  rewrittenText?: string;
  shouldSendToRealtime: boolean;
  shouldSpeak: boolean;
};

const BACKGROUND_REWRITE =
  "募集背景だけとして、「受注処理が増えていて、社員側の確認負荷が高くなっています。」とだけ一文で答えてください。句点の後に何も足さないでください。現場課長、勤務時間、残業、単価、開始日、決定構造、他社状況、職場見学、スキルカードは出さず、営業に質問を返さず、次に話す項目を提案せず、よろしくお願いしますや確認しますなどの挨拶・確認文で終えないでください。";

const BACKGROUND_DETAIL_REWRITE =
  "募集背景の一段詳しい状況だけを、顧客側として二文以内で答えてください。品番確認、納期回答、代理店や工務店への折り返し遅れのうち一つ以上を自然に含め、営業に質問を返さず、業務内容や条件へ話題を広げないでください。";

const BUSINESS_FLOW_REWRITE =
  "業務内容の大枠だけを、顧客側として二文以内で答えてください。受注入力、発注処理、納期調整のうち一つ以上を自然に含め、営業に質問を返さず、条件や決定構造へ話題を広げないでください。";

const CONTINUE_DETAIL_REWRITE =
  "直前に話していた募集背景だけを一文で答えてください。「品番確認が滞りやすい状況です。」とだけ答え、句点の後に何も足さず、確認します、他の文、補足、営業への質問返し、次の話題提案は出さないでください。";

const CONFIRMATION_SCOPE_REWRITE =
  "「背景、業務内容、要件まで確認いただければ大枠は足ります。」とだけ一文で答えてください。営業への質問返しや次の話題提案は出さないでください。";

const REQUIREMENT_TRADEOFF_REWRITE =
  "「メーカー経験は必須ではありませんが、受発注と対外調整の経験は見たいです。」とだけ一文で答えてください。営業への質問返しや次の話題提案は出さないでください。";

const OTHER_VENDOR_STATUS_REWRITE =
  "「他社状況として、他社にも相談していますが、まだ決定的な候補者はいません。」とだけ一文で答えてください。営業への質問返しや次の話題提案は出さないでください。";

const CONFIRMATION_DESTINATION_REWRITE =
  "「社内は担当社員、社外は代理店や工務店が主な確認先です。」とだけ一文で答えてください。営業への質問返しや次の話題提案は出さないでください。";

const CANDIDATE_FLOW_REWRITE =
  "「まずスキルカードを確認し、良さそうであれば職場見学に進む流れです。」とだけ一文で答えてください。営業への質問返しや次の話題提案は出さないでください。";

const CANDIDATE_PROPOSAL_CLOSING_REWRITE =
  "「はい、次は候補者提案に進める形で大丈夫です。」とだけ一文で答えてください。営業への質問返しや次の話題提案は出さないでください。";

const JOB_DESCRIPTION_REWRITE =
  "「求人票はまだ正式には固まっていないため、内容を確認中です。」とだけ一文で答えてください。営業への質問返しや次の話題提案は出さないでください。";

const BACKGROUND_HYPOTHESIS_REWRITE =
  "「その理解で近いです。確認負荷を軽減するための募集です。」とだけ二文以内で答えてください。営業への質問返しや次の話題提案は出さないでください。";

const CONDITIONS_REWRITE =
  "条件の大枠だけを、顧客側として一文で答えてください。営業事務一名で、開始時期と受注入力や納期調整が中心であることだけを話し、営業への質問返しや次項目提案をしないでください。";

const RATE_REWRITE =
  "「単価レンジは、業務内容と要件を整理してから相談したいです。」とだけ一文で答えてください。必ず単価レンジという語を含め、具体額、残業、勤務時間、営業への聞き返し、次の話題提案は出さないでください。";

const BACKGROUND_DETAIL_PATTERNS: RegExp[] = [
  /少し詳しく/u,
  /詳しく教えて/u,
  /詳しくお話しいただけ/u,
  /どの確認/u,
  /滞りやすい/u,
  /納期回答.*困/u,
  /折り返し/u,
  /代理店/u,
  /工務店/u,
];

const BACKGROUND_PATTERNS: RegExp[] = [
  /募集背景/u,
  /背景/u,
  /派遣を検討/u,
  /負荷/u,
  /受注処理.*増/u,
  /確認負荷/u,
];

const BUSINESS_FLOW_PATTERNS: RegExp[] = [
  /業務内容/u,
  /業務.*大枠/u,
  /受注から納期回答/u,
  /業務フロー/u,
  /受注入力/u,
  /発注処理/u,
  /納期調整/u,
];

const CONTINUE_DETAIL_PATTERNS: RegExp[] = [
  /続けてください/u,
  /続けて/u,
];

const CONFIRMATION_SCOPE_PATTERNS: RegExp[] = [
  /確認内容.*背景.*業務.*要件.*足/u,
  /背景.*業務.*要件.*足/u,
];

const REQUIREMENT_TRADEOFF_PATTERNS: RegExp[] = [
  /条件.*緩/u,
  /緩める/u,
  /候補者.*条件/u,
];

const OTHER_VENDOR_STATUS_PATTERNS: RegExp[] = [
  /他社状況/u,
  /他社.*状況/u,
  /他社/u,
  /求人状況/u,
  /会社状況/u,
];

const CONFIRMATION_DESTINATION_PATTERNS: RegExp[] = [
  /確認先/u,
  /社内外/u,
];

const CANDIDATE_FLOW_PATTERNS: RegExp[] = [
  /候補者提案/u,
  /候補者.*スキルカード/u,
  /スキルカード.*確認/u,
];

const CANDIDATE_PROPOSAL_CLOSING_PATTERNS: RegExp[] = [
  /次は候補者提案/u,
  /候補者提案に進める/u,
  /本日の内容/u,
];

const JOB_DESCRIPTION_PATTERNS: RegExp[] = [
  /求人票/u,
];

const BACKGROUND_HYPOTHESIS_PATTERNS: RegExp[] = [
  /確認負荷.*仮説/u,
  /確認負荷.*近い/u,
  /仮説.*近い/u,
];

const CONDITIONS_PATTERNS: RegExp[] = [
  /条件.*全部/u,
  /条件.*教えて/u,
  /条件/u,
];

const RATE_PATTERNS: RegExp[] = [
  /単価/u,
  /たんか/u,
  /炭火レンジ/u,
  /レンジ/u,
];

const PASS_PATTERNS: RegExp[] = [
  /詳しく/u,
  /続けて/u,
  /背景/u,
  /業務内容/u,
  /条件/u,
  /教えて/u,
  /確認/u,
  /概要/u,
  /募集/u,
];

const LOW_INFORMATION_PATTERNS: RegExp[] = [
  /^はい+$/u,
  /^うん+$/u,
  /^そうですね$/u,
  /^そうですか$/u,
  /^なるほど$/u,
  /^分かりました$/u,
  /^わかりました$/u,
  /^ありがとうございます$/u,
  /^了解です$/u,
  /^へえ$/u,
  /^へ$/u,
  /^あそうなんですね$/u,
  /^はいはい$/u,
  /^なるほどですね$/u,
  /^そういうことなんですね$/u,
];

const OPENING_GREETING_PATTERNS: RegExp[] = [
  /^(はい)?(今回|本日|今日は|お電話)?よろしくお願いします$/u,
  /^(はい)?(今回|本日|今日は|お電話)?よろしくお願いいたします$/u,
  /^はい今回よろしくお願いします$/u,
  /^本日はよろしくお願いします$/u,
  /^お電話ありがとうございますよろしくお願いします$/u,
];

export function classifyNormalInputRoute(
  text: string
): NormalInputRouteDecision {
  const normalizedText = normalizeNormalInputText(text);
  if (!normalizedText) return pass(normalizedText);

  const opening = findMatch(normalizedText, OPENING_GREETING_PATTERNS);
  if (opening) {
    return {
      action: "noise_ignored",
      reasons: ["opening_greeting", "low_information_input"],
      normalizedText,
      shouldSendToRealtime: false,
      shouldSpeak: false,
    };
  }

  const rewrite = selectRealtimeRewrite(normalizedText);
  if (rewrite) {
    return {
      action: "pass",
      reasons: rewrite.reasons,
      normalizedText,
      rewrittenText: rewrite.text,
      shouldSendToRealtime: true,
      shouldSpeak: false,
    };
  }

  if (matchesAny(normalizedText, PASS_PATTERNS)) {
    return pass(normalizedText);
  }

  const lowInformation = findMatch(normalizedText, LOW_INFORMATION_PATTERNS);
  if (lowInformation) {
    return {
      action: "noise_ignored",
      reasons: ["low_information_input"],
      normalizedText,
      shouldSendToRealtime: false,
      shouldSpeak: false,
    };
  }

  return pass(normalizedText);
}

function pass(normalizedText: string): NormalInputRouteDecision {
  return {
    action: "pass",
    reasons: [],
    normalizedText,
    shouldSendToRealtime: true,
    shouldSpeak: false,
  };
}

function normalizeNormalInputText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[！!？?。．.、,\s]/g, "")
    .trim();
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function findMatch(text: string, patterns: RegExp[]): string | undefined {
  return patterns.find((pattern) => pattern.test(text))?.source;
}

function selectRealtimeRewrite(
  normalizedText: string
): { text: string; reasons: string[] } | null {
  if (matchesAny(normalizedText, CONFIRMATION_SCOPE_PATTERNS)) {
    return {
      text: CONFIRMATION_SCOPE_REWRITE,
      reasons: ["normal_realtime_rewrite", "confirmation_scope_request"],
    };
  }
  if (matchesAny(normalizedText, REQUIREMENT_TRADEOFF_PATTERNS)) {
    return {
      text: REQUIREMENT_TRADEOFF_REWRITE,
      reasons: ["normal_realtime_rewrite", "requirement_tradeoff_request"],
    };
  }
  if (matchesAny(normalizedText, OTHER_VENDOR_STATUS_PATTERNS)) {
    return {
      text: OTHER_VENDOR_STATUS_REWRITE,
      reasons: ["normal_realtime_rewrite", "other_vendor_status_request"],
    };
  }
  if (matchesAny(normalizedText, CANDIDATE_PROPOSAL_CLOSING_PATTERNS)) {
    return {
      text: CANDIDATE_PROPOSAL_CLOSING_REWRITE,
      reasons: ["normal_realtime_rewrite", "candidate_proposal_closing_request"],
    };
  }
  if (matchesAny(normalizedText, CANDIDATE_FLOW_PATTERNS)) {
    return {
      text: CANDIDATE_FLOW_REWRITE,
      reasons: ["normal_realtime_rewrite", "candidate_flow_request"],
    };
  }
  if (matchesAny(normalizedText, BACKGROUND_HYPOTHESIS_PATTERNS)) {
    return {
      text: BACKGROUND_HYPOTHESIS_REWRITE,
      reasons: ["normal_realtime_rewrite", "background_hypothesis_request"],
    };
  }
  if (matchesAny(normalizedText, JOB_DESCRIPTION_PATTERNS)) {
    return {
      text: JOB_DESCRIPTION_REWRITE,
      reasons: ["normal_realtime_rewrite", "job_description_request"],
    };
  }
  if (matchesAny(normalizedText, CONFIRMATION_DESTINATION_PATTERNS)) {
    return {
      text: CONFIRMATION_DESTINATION_REWRITE,
      reasons: ["normal_realtime_rewrite", "confirmation_destination_request"],
    };
  }
  if (matchesAny(normalizedText, CONTINUE_DETAIL_PATTERNS)) {
    return {
      text: CONTINUE_DETAIL_REWRITE,
      reasons: ["normal_realtime_rewrite", "continue_detail_request"],
    };
  }
  if (matchesAny(normalizedText, BACKGROUND_DETAIL_PATTERNS)) {
    return {
      text: BACKGROUND_DETAIL_REWRITE,
      reasons: ["normal_realtime_rewrite", "background_detail_request"],
    };
  }
  if (matchesAny(normalizedText, BUSINESS_FLOW_PATTERNS)) {
    return {
      text: BUSINESS_FLOW_REWRITE,
      reasons: ["normal_realtime_rewrite", "business_flow_request"],
    };
  }
  if (matchesAny(normalizedText, RATE_PATTERNS)) {
    return {
      text: RATE_REWRITE,
      reasons: ["normal_realtime_rewrite", "rate_request"],
    };
  }
  if (matchesAny(normalizedText, CONDITIONS_PATTERNS)) {
    return {
      text: CONDITIONS_REWRITE,
      reasons: ["normal_realtime_rewrite", "conditions_request"],
    };
  }
  if (matchesAny(normalizedText, BACKGROUND_PATTERNS)) {
    return {
      text: BACKGROUND_REWRITE,
      reasons: ["normal_realtime_rewrite", "background_request"],
    };
  }
  return null;
}
