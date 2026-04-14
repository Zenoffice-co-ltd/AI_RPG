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
});
