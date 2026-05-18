"use client";

export type UserTextNormalization = {
  originalText: string;
  normalizedText: string;
  normalizationApplied: boolean;
  normalizationReasons: string[];
};

type ReplacementRule = {
  pattern: RegExp;
  replacement: string;
  reason: string;
  context?: RegExp;
};

const DOMAIN_CONTEXT =
  /候補|応募|要件|紹介|提案|買掛|買いかけ|納期|同期|単価|炭火|レンジ|他社|求人|会社|状況|フィードバック|スピードバック|受注|発注|請求|営業事務/u;

const REPLACEMENTS: ReplacementRule[] = [
  {
    pattern: /放射要件/g,
    replacement: "候補者要件",
    reason: "stt_candidate_requirement",
    context: /候補|応募|要件|営業事務|人材/u,
  },
  {
    pattern: /同期調整/g,
    replacement: "納期調整",
    reason: "stt_delivery_timing",
    context: /納期|調整|受注|発注|業務/u,
  },
  {
    pattern: /書に借りに行きます/g,
    replacement: "紹介できます",
    reason: "stt_candidate_introduction",
    context: /候補|応募|紹介|提案/u,
  },
  {
    pattern: /買いかけ担当/g,
    replacement: "買掛担当",
    reason: "stt_accounts_payable",
    context: /買掛|買いかけ|担当|経理/u,
  },
  {
    pattern: /スピードバック/g,
    replacement: "フィードバック",
    reason: "stt_feedback",
  },
  {
    pattern: /炭火レンジ/g,
    replacement: "単価レンジ",
    reason: "stt_rate_range",
    context: /単価|レンジ|金額|時給|請求|条件/u,
  },
  {
    pattern: /求人状況/g,
    replacement: "他社状況",
    reason: "stt_other_vendor_status",
    context: /他社|状況|候補|提案|競合|求人/u,
  },
  {
    pattern: /会社状況/g,
    replacement: "他社状況",
    reason: "stt_other_vendor_status",
    context: /他社|状況|候補|提案|競合|会社/u,
  },
];

export function normalizeGrokFirstUserText(
  text: string
): UserTextNormalization {
  let normalizedText = text.normalize("NFKC").trim();
  const normalizationReasons: string[] = [];

  for (const rule of REPLACEMENTS) {
    if (!rule.pattern.test(normalizedText)) {
      rule.pattern.lastIndex = 0;
      continue;
    }
    rule.pattern.lastIndex = 0;
    if (rule.context && !rule.context.test(normalizedText) && !DOMAIN_CONTEXT.test(normalizedText)) {
      continue;
    }
    normalizedText = normalizedText.replace(rule.pattern, rule.replacement);
    normalizationReasons.push(rule.reason);
  }

  const compressed = compressDuplicateCandidateQuestion(normalizedText);
  if (compressed !== normalizedText) {
    normalizedText = compressed;
    normalizationReasons.push("duplicate_synonym_question_compressed");
  }

  return {
    originalText: text,
    normalizedText,
    normalizationApplied: normalizedText !== text,
    normalizationReasons: [...new Set(normalizationReasons)],
  };
}

function compressDuplicateCandidateQuestion(text: string): string {
  const normalized = text.trim();
  const duplicate =
    /^応募者には(.+?)(?:ですか|でしょうか|よいですか|良いですか|。|\?)候補者には\1(?:ですか|でしょうか|よいですか|良いですか|。|\?)?$/u;
  const match = normalized.match(duplicate);
  if (!match?.[1]) return text;
  return `候補者には${match[1]}。`;
}
