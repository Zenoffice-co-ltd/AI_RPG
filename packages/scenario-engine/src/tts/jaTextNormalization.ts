import {
  ACCOUNTING_SCENARIO_ID,
  ADECCO_MANUFACTURER_SCENARIO_ID,
  type TextNormalisationType,
} from "@top-performer/domain";

export type JaTextNormalizationResult = {
  displayText: string;
  ttsText: string;
  appliedRules: string[];
};

type RewriteRule = {
  readonly id: string;
  readonly pattern: RegExp;
  readonly replacement: string;
};

const ACCOUNTING_MINIMAL_REWRITE_RULES: readonly RewriteRule[] = [
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

/**
 * Manual orb v4 (2026-04-26): Adecco staffing scenario rewrite rules.
 *
 * NOTE: This function is **only** called from offline rendering paths
 * (`benchmarkRenderer.ts`, `audioPreview.ts`). It does NOT affect the live
 * ElevenLabs orb — that path relies on server-side `apply_text_normalization:
 * "auto"`. For live orb fixes, edit the prompt source (`staffingAdeccoLedger.ts`
 * + `compileStaffingReferenceScenario.ts`) directly.
 *
 * These rules are still useful for benchmark CSVs and the in-app voice preview
 * so they reproduce the same TTS-friendly phrasing.
 */
const ADECCO_MANUFACTURER_REWRITE_RULES: readonly RewriteRule[] = [
  // Adecco brand name → アデコ. Identifiers (scenario id / agent name) stay
  // as Adecco; this normalisation targets the runtime utterance form only.
  { id: "adecco-company-name-uppercase", pattern: /ADECCO/g, replacement: "アデコ" },
  { id: "adecco-company-name-titlecase", pattern: /Adecco/g, replacement: "アデコ" },
  { id: "adecco-company-name-lowercase", pattern: /adecco/g, replacement: "アデコ" },

  // Compressed Japanese phrases that read harshly in TTS — match BEFORE the
  // single-token versions so the longer pattern wins.
  {
    id: "adecco-month-end-start-compound",
    pattern: /月末[・、\/]?月初/g,
    replacement: "月末と月の初め",
  },
  { id: "adecco-month-start", pattern: /月初/g, replacement: "月の初め" },
  { id: "adecco-monday-morning", pattern: /月曜午前/g, replacement: "月曜日の午前中" },
  {
    id: "adecco-product-switching",
    pattern: /(?:繁忙)?商材(?:切替|切り替え)時/g,
    replacement: "取り扱い商品が切り替わる時期",
  },
  {
    id: "adecco-onsite-fit-judgement",
    pattern: /(?:候補者の最終的な)?現場適合判断/g,
    replacement: "現場に合うかどうかの最終判断",
  },

  // Number / time / amount ranges. Server-side `apply_text_normalization`
  // already handles most of these for the live orb, but offline rendering
  // benefits from explicit rewrites so benchmark CSVs are deterministic.
  {
    id: "adecco-count-600-700",
    pattern: /600\s*[〜~\-ー―]\s*700件/g,
    replacement: "六百から七百件",
  },
  {
    id: "adecco-count-600-from-700",
    pattern: /600から700件/g,
    replacement: "六百から七百件",
  },
  { id: "adecco-date-june-first", pattern: /6月1日/g, replacement: "六月一日" },
  {
    id: "adecco-time-0845-1730",
    pattern: /8[:：]45\s*[〜~\-ー―]\s*17[:：]30/g,
    replacement: "八時四十五分から十七時三十分",
  },
  {
    id: "adecco-overtime-10-15",
    pattern: /10\s*[〜~\-ー―]\s*15時間/g,
    replacement: "十から十五時間",
  },
  {
    id: "adecco-overtime-10-from-15",
    pattern: /10から15時間/g,
    replacement: "十から十五時間",
  },
  {
    id: "adecco-billing-1750-1900",
    pattern: /1,?750\s*[〜~\-ー―]\s*1,?900円/g,
    replacement: "千七百五十円から千九百円",
  },
  {
    id: "adecco-billing-1750-from-1900",
    pattern: /1,?750から1,?900円/g,
    replacement: "千七百五十円から千九百円",
  },
  { id: "adecco-three-business-days", pattern: /3営業日/g, replacement: "三営業日" },
  { id: "adecco-one-person", pattern: /1名/g, replacement: "一名" },
  { id: "adecco-one-more-company", pattern: /もう1社/g, replacement: "もう一社" },
] as const;

const SCENARIO_RULES: Record<string, readonly RewriteRule[]> = {
  [ACCOUNTING_SCENARIO_ID]: ACCOUNTING_MINIMAL_REWRITE_RULES,
  [ADECCO_MANUFACTURER_SCENARIO_ID]: ADECCO_MANUFACTURER_REWRITE_RULES,
};

export function normalizeJaTextForTts(input: {
  text: string;
  scenarioId: string;
  ttsModel: string;
  textNormalisationType?: TextNormalisationType;
}): JaTextNormalizationResult {
  const displayText = input.text;

  // The rule set is gated on (a) scenario id is in the supported map, AND
  // (b) the v3 voice + ElevenLabs server normalisation are in use. Other
  // configurations pass through unchanged.
  const rules = SCENARIO_RULES[input.scenarioId];
  if (
    !rules ||
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

  for (const rule of rules) {
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
