import { describe, expect, it } from "vitest";
import { normalizeJaTextForTts } from "./jaTextNormalization";

describe("normalizeJaTextForTts", () => {
  it("passes through non-accounting text unchanged", () => {
    const result = normalizeJaTextForTts({
      text: "本日はお時間ありがとうございます。",
      scenarioId: "staffing_order_hearing_busy_manager_medium",
      ttsModel: "eleven_v3",
      textNormalisationType: "elevenlabs",
    });

    expect(result).toEqual({
      displayText: "本日はお時間ありがとうございます。",
      ttsText: "本日はお時間ありがとうございます。",
      appliedRules: [],
    });
  });

  it("rewrites only targeted accounting phrases for preview and benchmark TTS", () => {
    const text =
      "AP/支払と支払/AP、Oracle/SAP等のERP、OracleやSAP等のERP、Teams/Box/Outlook/Excel、移行PJ、それに支払・経費精算・請求書処理を確認します。";
    const result = normalizeJaTextForTts({
      text,
      scenarioId: "accounting_clerk_enterprise_ap_busy_manager_medium",
      ttsModel: "eleven_v3",
      textNormalisationType: "elevenlabs",
    });

    expect(result.displayText).toBe(text);
    expect(result.ttsText).toBe(
      "エーピー、支払いと支払い、エーピー、オラクル、エスエーピーなどのイーアールピー、オラクルやエスエーピーなどのイーアールピー、チームズ、ボックス、アウトルック、エクセル、移行ピージェー、それに支払、経費精算、請求書処理を確認します。"
    );
    expect(result.appliedRules).toEqual([
      "accounting-ap-slash-payment",
      "accounting-payment-slash-ap",
      "accounting-erp-slash-vendors",
      "accounting-erp-ja-vendors",
      "accounting-tools-slash-list",
      "accounting-migration-pj",
      "accounting-main-work-bullets",
    ]);
  });

  it("does not fully kana-convert the sentence", () => {
    const result = normalizeJaTextForTts({
      text: "税区分や勘定科目の一次判断、固定資産判定まで含めて確認します。",
      scenarioId: "accounting_clerk_enterprise_ap_busy_manager_medium",
      ttsModel: "eleven_v3",
      textNormalisationType: "elevenlabs",
    });

    expect(result.displayText).toContain("税区分");
    expect(result.ttsText).toContain("税区分");
    expect(result.ttsText).toContain("勘定科目");
    expect(result.appliedRules).toEqual([]);
  });

  describe("Manual orb v4: Adecco staffing scenario", () => {
    const ADECCO_SCENARIO_ID = "staffing_order_hearing_adecco_manufacturer_busy_manager_medium";

    it("rewrites Adecco staffing terms for TTS while preserving display text", () => {
      const text =
        "Adeccoさんに、受注は600〜700件程度で、月末月初、月曜午前、商材切替時に負荷が上がると伝えます。6月1日開始、8:45〜17:30、残業10〜15時間、請求1,750〜1,900円、3営業日、営業事務1名、もう1社にも相談中です。";

      const result = normalizeJaTextForTts({
        text,
        scenarioId: ADECCO_SCENARIO_ID,
        ttsModel: "eleven_v3",
        textNormalisationType: "elevenlabs",
      });

      // displayText must be unchanged (canonical source preserved).
      expect(result.displayText).toBe(text);

      // ttsText must contain the natural-Japanese rewrites for TTS readability.
      expect(result.ttsText).toContain("アデコさん");
      expect(result.ttsText).toContain("六百から七百件");
      expect(result.ttsText).toContain("月末と月の初め");
      expect(result.ttsText).toContain("月曜日の午前中");
      expect(result.ttsText).toContain("取り扱い商品が切り替わる時期");
      expect(result.ttsText).toContain("六月一日");
      expect(result.ttsText).toContain("八時四十五分から十七時三十分");
      expect(result.ttsText).toContain("十から十五時間");
      expect(result.ttsText).toContain("千七百五十円から千九百円");
      expect(result.ttsText).toContain("三営業日");
      expect(result.ttsText).toContain("一名");
      expect(result.ttsText).toContain("もう一社");

      // The compressed forms must NOT remain in ttsText.
      expect(result.ttsText).not.toContain("Adecco");
      expect(result.ttsText).not.toContain("月末月初");
      expect(result.ttsText).not.toContain("月曜午前");
      expect(result.ttsText).not.toContain("商材切替時");
      expect(result.ttsText).not.toContain("6月1日");

      // A subset of rule ids must be present in appliedRules (proves the rule
      // table was actually consulted, not bypassed).
      expect(result.appliedRules).toEqual(
        expect.arrayContaining([
          "adecco-company-name-titlecase",
          "adecco-month-end-start-compound",
          "adecco-monday-morning",
          "adecco-product-switching",
          "adecco-date-june-first",
          "adecco-three-business-days",
          "adecco-one-person",
        ])
      );
    });

    it("rewrites the canonical Adecco closing utterance to the アデコ form", () => {
      const result = normalizeJaTextForTts({
        text:
          "ちなみに、Adeccoさんの派遣の特徴や、他社さんとの違いはどのあたりでしょうか。",
        scenarioId: ADECCO_SCENARIO_ID,
        ttsModel: "eleven_v3",
        textNormalisationType: "elevenlabs",
      });

      expect(result.ttsText).toContain("アデコさんの派遣の特徴");
      expect(result.ttsText).not.toContain("Adecco");
      expect(result.appliedRules).toContain("adecco-company-name-titlecase");
    });

    it("rewrites 現場適合判断 to the natural form", () => {
      const result = normalizeJaTextForTts({
        text: "ベンダー選定は人事が主導しますが、候補者の最終的な現場適合判断は現場課長の意見が強く反映されます。",
        scenarioId: ADECCO_SCENARIO_ID,
        ttsModel: "eleven_v3",
        textNormalisationType: "elevenlabs",
      });

      expect(result.ttsText).toContain("現場に合うかどうかの最終判断");
      expect(result.ttsText).not.toContain("現場適合判断");
      expect(result.appliedRules).toContain("adecco-onsite-fit-judgement");
    });

    it("does not touch the existing accounting rules when called for Adecco", () => {
      // Accounting-only patterns must not match in the Adecco rule set.
      const result = normalizeJaTextForTts({
        text: "AP/支払とOracle/SAP等のERP",
        scenarioId: ADECCO_SCENARIO_ID,
        ttsModel: "eleven_v3",
        textNormalisationType: "elevenlabs",
      });

      // No accounting rules should fire because we're routing through the Adecco set.
      expect(result.appliedRules).not.toContain("accounting-ap-slash-payment");
      expect(result.appliedRules).not.toContain("accounting-erp-slash-vendors");
    });

    it("passes through unchanged when ttsModel or textNormalisationType is not v3+elevenlabs", () => {
      const text = "Adeccoさんに月末月初の負荷を伝えます。";

      // Wrong model
      const wrongModel = normalizeJaTextForTts({
        text,
        scenarioId: ADECCO_SCENARIO_ID,
        ttsModel: "eleven_flash_v2_5",
        textNormalisationType: "elevenlabs",
      });
      expect(wrongModel.ttsText).toBe(text);
      expect(wrongModel.appliedRules).toEqual([]);

      // Wrong normalisation (system_prompt instead of elevenlabs)
      const wrongNorm = normalizeJaTextForTts({
        text,
        scenarioId: ADECCO_SCENARIO_ID,
        ttsModel: "eleven_v3",
        textNormalisationType: "system_prompt",
      });
      expect(wrongNorm.ttsText).toBe(text);
      expect(wrongNorm.appliedRules).toEqual([]);
    });
  });
});
