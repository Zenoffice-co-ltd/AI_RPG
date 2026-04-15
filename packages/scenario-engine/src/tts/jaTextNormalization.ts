import { ACCOUNTING_SCENARIO_ID, type TextNormalisationType } from "@top-performer/domain";

export type JaTextNormalizationResult = {
  displayText: string;
  ttsText: string;
  appliedRules: string[];
};

const ACCOUNTING_MINIMAL_REWRITE_RULES = [
  {
    id: "accounting-ap-slash-payment",
    pattern: /AP\/支払/g,
    replacement: "エーピー、支払い",
  },
  {
    id: "accounting-payment-slash-ap",
    pattern: /支払\/AP/g,
    replacement: "支払い、エーピー",
  },
  {
    id: "accounting-erp-slash-vendors",
    pattern: /Oracle\/SAP等のERP/g,
    replacement: "オラクル、エスエーピーなどのイーアールピー",
  },
  {
    id: "accounting-erp-ja-vendors",
    pattern: /OracleやSAP等のERP/g,
    replacement: "オラクルやエスエーピーなどのイーアールピー",
  },
  {
    id: "accounting-tools-slash-list",
    pattern: /Teams\/Box\/Outlook\/Excel/g,
    replacement: "チームズ、ボックス、アウトルック、エクセル",
  },
  {
    id: "accounting-migration-pj",
    pattern: /移行PJ/g,
    replacement: "移行ピージェー",
  },
  {
    id: "accounting-main-work-bullets",
    pattern: /支払・経費精算・請求書処理/g,
    replacement: "支払、経費精算、請求書処理",
  },
] as const;

export function normalizeJaTextForTts(input: {
  text: string;
  scenarioId: string;
  ttsModel: string;
  textNormalisationType?: TextNormalisationType;
}): JaTextNormalizationResult {
  const displayText = input.text;

  if (
    input.scenarioId !== ACCOUNTING_SCENARIO_ID ||
    input.ttsModel !== "eleven_v3" ||
    input.textNormalisationType !== "elevenlabs"
  ) {
    return {
      displayText,
      ttsText: input.text,
      appliedRules: [],
    };
  }

  let ttsText = input.text;
  const appliedRules: string[] = [];

  for (const rule of ACCOUNTING_MINIMAL_REWRITE_RULES) {
    rule.pattern.lastIndex = 0;
    if (!rule.pattern.test(ttsText)) {
      continue;
    }

    ttsText = ttsText.replace(rule.pattern, rule.replacement);
    appliedRules.push(rule.id);
  }

  return {
    displayText,
    ttsText,
    appliedRules,
  };
}
