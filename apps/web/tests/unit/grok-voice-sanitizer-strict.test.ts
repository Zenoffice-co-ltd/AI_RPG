import { describe, expect, it } from "vitest";
import {
  getAllPr60LockedResponses,
  sanitizeGrokVoiceSpokenText,
} from "../../lib/roleplay/grok-voice-pr60-shared";

describe("sanitizeGrokVoiceSpokenText — trailing detector positive cases", () => {
  it("strips 「他に何か質問はありますか」 trailing on otherwise-clean turn", () => {
    const result = sanitizeGrokVoiceSpokenText(
      "受発注経験の確認から進めます。他に何か質問はありますか。"
    );
    expect(result.detected).toBe(true);
    expect(result.text).toBe("受発注経験の確認から進めます。");
    expect(result.sanitizedToEmpty).toBe(false);
    expect(result.removedPatternIds).toEqual(["trailing_other_q"]);
  });

  it("strips 「気になる部分はありますか」 (Phase 5 Layer B-discovered variant)", () => {
    const result = sanitizeGrokVoiceSpokenText(
      "じゅはっちゅう入力と納期調整が中心です。何か気になる部分はありますか。"
    );
    expect(result.detected).toBe(true);
    expect(result.text).toBe("じゅはっちゅう入力と納期調整が中心です。");
    expect(result.removedPatternIds).toEqual(["trailing_q_invitation"]);
  });

  it("strips 「不明な部分はあれば」 variant", () => {
    const result = sanitizeGrokVoiceSpokenText(
      "概要は以上です。不明な部分はあればお伝えください。"
    );
    expect(result.detected).toBe(true);
    expect(result.text).toBe("概要は以上です。");
  });

  it("strips 「気になるところはありますか」 (kana variant)", () => {
    const result = sanitizeGrokVoiceSpokenText(
      "確認しました。気になるところはありますか。"
    );
    expect(result.detected).toBe(true);
    expect(result.text).toBe("確認しました。");
  });

  it("strips 「ご質問があればお聞かせください」 invitation pattern", () => {
    const result = sanitizeGrokVoiceSpokenText(
      "状況は把握しました。ご質問があればお聞かせください。"
    );
    expect(result.detected).toBe(true);
    expect(result.text).toBe("状況は把握しました。");
    expect(result.removedPatternIds).toEqual(["trailing_q_invitation"]);
  });

  it("strips 「ご不明点があれば教えてください」 invitation pattern", () => {
    const result = sanitizeGrokVoiceSpokenText(
      "今の状況です。ご不明点があれば教えてください。"
    );
    expect(result.detected).toBe(true);
    expect(result.text).toBe("今の状況です。");
    expect(result.removedPatternIds).toEqual(["trailing_q_invitation"]);
  });

  it("strips 「詳しく知りたい点があれば」 curious pattern", () => {
    const result = sanitizeGrokVoiceSpokenText(
      "概要は以上です。詳しく知りたい点があれば伺います。"
    );
    expect(result.detected).toBe(true);
    expect(result.text).toBe("概要は以上です。");
    expect(result.removedPatternIds).toEqual(["trailing_more_curious"]);
  });

  it("strips 「追加で確認したい点があれば」 additional-check pattern", () => {
    const result = sanitizeGrokVoiceSpokenText(
      "受発注一名の相談です。追加で確認したい点があればお知らせください。"
    );
    expect(result.detected).toBe(true);
    expect(result.text).toBe("受発注一名の相談です。");
    // First match wins on the trailing sentence — additional_check is checked
    // before the contact_with_closing_context rule.
    expect(result.removedPatternIds[0]).toBe("trailing_additional_check");
  });

  it("strips 「いつでもお気軽に」 closing courtesy", () => {
    const result = sanitizeGrokVoiceSpokenText(
      "確認しておきます。いつでもお気軽にどうぞ。"
    );
    expect(result.detected).toBe(true);
    expect(result.text).toBe("確認しておきます。");
    expect(result.removedPatternIds).toEqual(["trailing_okigaru_ni"]);
  });

  it("strips 「何かございましたら」 closing courtesy", () => {
    const result = sanitizeGrokVoiceSpokenText(
      "本日は以上です。何かございましたらご連絡ください。"
    );
    expect(result.detected).toBe(true);
    expect(result.text).toBe("本日は以上です。");
    // Multiple detectors match this sentence (trailing_anything_arose AND
    // trailing_contact_with_closing_context). We accept either as the primary
    // attribution — what matters is detection + removal.
    expect(result.removedPatternIds.length).toBe(1);
    expect([
      "trailing_anything_arose",
      "trailing_contact_with_closing_context",
    ]).toContain(result.removedPatternIds[0]);
  });

  it("strips 「また後ほど」 / 「また改めて」 closing pattern", () => {
    const result = sanitizeGrokVoiceSpokenText(
      "確認できました。また後ほど共有します。"
    );
    expect(result.detected).toBe(true);
    expect(result.text).toBe("確認できました。");
    expect(result.removedPatternIds).toEqual(["trailing_again_later"]);
  });

  it("strips multiple trailing stock-suffix sentences in a row", () => {
    const result = sanitizeGrokVoiceSpokenText(
      "確認しました。詳しく知りたい点があれば伺います。何か他にご質問ありますか。"
    );
    expect(result.detected).toBe(true);
    expect(result.text).toBe("確認しました。");
    expect(result.removedSentences.length).toBe(2);
  });
});

describe("sanitizeGrokVoiceSpokenText — context-gated お知らせ/ご連絡", () => {
  it("strips 「何かあればお知らせください」 (closing context co-occurs)", () => {
    // 「何か」 is the closing-context token; 「他に」 is absent so trailing_other_q
    // does not match. trailing_contact_with_closing_context is the sole match.
    const result = sanitizeGrokVoiceSpokenText(
      "概要は以上です。何かあればお知らせください。"
    );
    expect(result.detected).toBe(true);
    expect(result.text).toBe("概要は以上です。");
    expect(result.removedPatternIds).toEqual([
      "trailing_contact_with_closing_context",
    ]);
  });

  it("KEEPS bare 「水曜日にご連絡ください」 — legitimate business request", () => {
    // This is critical: a real business hand-off like 「候補者情報は水曜日に
    // ご連絡ください」 must NOT be stripped. The detector requires a closing-
    // context token (何か / 他に / 追加で / ご質問 / 不明点 / etc.) within
    // 20 chars of the お知らせ/ご連絡ください token.
    const input = "概要は以上です。候補者情報は水曜日にご連絡ください。";
    const result = sanitizeGrokVoiceSpokenText(input);
    expect(result.detected).toBe(false);
    expect(result.text).toBe(input);
  });

  it("KEEPS bare 「結果は明日お知らせください」", () => {
    const input = "確認します。結果は明日お知らせください。";
    const result = sanitizeGrokVoiceSpokenText(input);
    expect(result.detected).toBe(false);
    expect(result.text).toBe(input);
  });
});

describe("sanitizeGrokVoiceSpokenText — punctuation and kana variants", () => {
  it("detects suffix without trailing 句点", () => {
    const result = sanitizeGrokVoiceSpokenText(
      "確認しました。何か他にご質問ありますか"
    );
    expect(result.detected).toBe(true);
    expect(result.text).toBe("確認しました。");
  });

  it("detects suffix with ASCII '?' instead of '？'", () => {
    const result = sanitizeGrokVoiceSpokenText(
      "確認しました。他に何か質問はありますか?"
    );
    expect(result.detected).toBe(true);
    expect(result.text).toBe("確認しました。");
  });

  it("detects suffix with full-width '？'", () => {
    const result = sanitizeGrokVoiceSpokenText(
      "確認しました。他に何か質問はありますか？"
    );
    expect(result.detected).toBe(true);
    expect(result.text).toBe("確認しました。");
  });

  it("detects suffix with kana 「ほかに」 in place of 「他に」", () => {
    const result = sanitizeGrokVoiceSpokenText(
      "確認しました。ほかに何か聞きたいことはありますか。"
    );
    expect(result.detected).toBe(true);
    expect(result.text).toBe("確認しました。");
  });
});

describe("sanitizeGrokVoiceSpokenText — over-match guards (PR60 sanitizer regression)", () => {
  it("does NOT strip bare 「教えてください」", () => {
    const input = "受発注の流れを教えてください。";
    const result = sanitizeGrokVoiceSpokenText(input);
    expect(result.detected).toBe(false);
    expect(result.text).toBe(input);
  });

  it("does NOT strip bare 「させていただきます」", () => {
    const input = "では確認させていただきます。";
    const result = sanitizeGrokVoiceSpokenText(input);
    expect(result.detected).toBe(false);
    expect(result.text).toBe(input);
  });

  it("does NOT strip bare 「お聞かせください」", () => {
    const input = "現場の声をお聞かせください。";
    const result = sanitizeGrokVoiceSpokenText(input);
    expect(result.detected).toBe(false);
    expect(result.text).toBe(input);
  });

  it("does NOT strip a non-trailing match earlier in the text", () => {
    // The detector only walks from the end, so an earlier match is preserved
    // along with the later non-matching sentence.
    const input =
      "他に何か質問はありますか。一旦は受発注経験を見ていきたいです。";
    const result = sanitizeGrokVoiceSpokenText(input);
    expect(result.detected).toBe(false);
    expect(result.text).toBe(input);
  });
});

describe("sanitizeGrokVoiceSpokenText — locked-response allowlist", () => {
  it.each(getAllPr60LockedResponses())(
    "preserves locked-response sentence in trailing position: %s",
    (locked) => {
      const input = `${locked}`;
      const result = sanitizeGrokVoiceSpokenText(input);
      expect(result.detected).toBe(false);
      expect(result.text).toBe(input);
    }
  );

  it("preserves trailing locked-response even after a content sentence", () => {
    const locked =
      "はい、お願いします。ちなみに、アデコさんの派遣の特徴や、たしゃさんとの違いはどのあたりでしょうか。";
    const input = `承知しました。${locked}`;
    const result = sanitizeGrokVoiceSpokenText(input);
    expect(result.detected).toBe(false);
    expect(result.text).toBe(input);
  });
});

describe("sanitizeGrokVoiceSpokenText — sanitizedToEmpty", () => {
  it("returns sanitizedToEmpty=true and text='' when entire input is suffix", () => {
    const result = sanitizeGrokVoiceSpokenText("他に何か質問はありますか。");
    expect(result.detected).toBe(true);
    expect(result.sanitizedToEmpty).toBe(true);
    expect(result.text).toBe("");
  });

  it("returns sanitizedToEmpty=true for entirely-suffix multi-sentence input", () => {
    const result = sanitizeGrokVoiceSpokenText(
      "ご不明点があればお知らせください。いつでもお気軽にどうぞ。"
    );
    expect(result.detected).toBe(true);
    expect(result.sanitizedToEmpty).toBe(true);
    expect(result.text).toBe("");
  });

  it("never returns the original forbidden text in sanitizedToEmpty case", () => {
    const result = sanitizeGrokVoiceSpokenText(
      "他に何か気になる点はありますか。"
    );
    expect(result.text).not.toContain("気になる点");
    expect(result.text).toBe("");
  });

  it("returns detected=false / sanitizedToEmpty=false on empty input", () => {
    const result = sanitizeGrokVoiceSpokenText("");
    expect(result.detected).toBe(false);
    expect(result.sanitizedToEmpty).toBe(false);
    expect(result.text).toBe("");
  });

  it("returns detected=false / sanitizedToEmpty=false on whitespace-only input", () => {
    const result = sanitizeGrokVoiceSpokenText("   ");
    expect(result.detected).toBe(false);
    expect(result.sanitizedToEmpty).toBe(false);
  });
});

describe("sanitizeGrokVoiceSpokenText — telemetry shape", () => {
  it("returns removedPatternIds aligned with removedSentences order", () => {
    const result = sanitizeGrokVoiceSpokenText(
      "確認しました。詳しく知りたい点があれば伺います。何か他にご質問ありますか。"
    );
    expect(result.removedSentences.length).toBe(result.removedPatternIds.length);
    expect(result.removedPatternIds[0]).toBe("trailing_more_curious");
    expect(result.removedPatternIds[1]).toBe("trailing_other_q");
  });
});
