import { describe, expect, it } from "vitest";
import {
  containsVoiceStockSuffix,
  getPr60LockedResponseForUser,
  normalizePr60AssistantText,
  normalizeVoiceFriendlyTerms,
  shouldStopAtPr60LockedResponse,
  stripVoiceStockSuffixSentences,
} from "../../lib/roleplay/grok-voice-pr60-output";

describe("grok voice PR60 output locks", () => {
  it("maps PR60 user prompts to canonical voice-facing responses", () => {
    expect(getPr60LockedResponseForUser("時期的にはいつぐらいですかね？")).toBe(
      "開始は六月ついたちを希望しています。"
    );
    expect(
      getPr60LockedResponseForUser("受注件数は月にどのくらいですか？")
    ).toBe("月あたり、ろっぴゃく件から、ななひゃっけん程度です。");
    expect(
      getPr60LockedResponseForUser(
        "候補者のスキルで言うとどういうスキルがあるといいんですか？"
      )
    ).toBe("受発注経験と対外調整の経験がある方を優先的に見ています。");
    expect(
      getPr60LockedResponseForUser(
        "協調性をもう少し具体的に聞いてもいいですか？"
      )
    ).toBe(
      "営業や物流と確認しながら進める場面が多いので、抱え込まずに連携できる方が合います。"
    );
    expect(getPr60LockedResponseForUser("人柄については？")).toBe(
      "協調型が合いやすく、自分のやり方にこだわりすぎる方は合いにくいです。"
    );
    expect(getPr60LockedResponseForUser("単価とかはいくらでしょうね？")).toBe(
      "請求想定は経験により、せんななひゃくごじゅう円から、せんきゅうひゃく円程度です。"
    );
    expect(getPr60LockedResponseForUser("具体的に、どういう業務になりますかね？")).toBe(
      "受発注や納期調整まわりの営業事務です。"
    );
    expect(getPr60LockedResponseForUser("なるほどですね。")).toBe("はい。");
    expect(
      getPr60LockedResponseForUser("わかりました。じゃあ水曜までにメールしますね。")
    ).toBe(
      "はい、お願いします。ちなみに、アデコさんの派遣の特徴や、たしゃさんとの違いはどのあたりでしょうか。"
    );
  });

  it("trims unsolicited second sentences after a locked response", () => {
    expect(
      normalizePr60AssistantText(
        "そういうことですね。",
        "はい。何か他に確認したい点はありますか。"
      )
    ).toBe("はい。");
    expect(
      shouldStopAtPr60LockedResponse(
        "わかりました。よろしくお願いします。",
        "こちらこそよろしくお願いします。何かございましたら"
      )
    ).toBe(true);
  });

  it("strips stock suffix sentences even outside exact locks", () => {
    expect(containsVoiceStockSuffix("何か他にご質問ありますか。")).toBe(true);
    expect(
      stripVoiceStockSuffixSentences(
        "受発注や納期調整まわりの営業事務です。詳しく知りたい点があれば教えてください。業務内容のイメージはつかめましたか。折り返しご連絡します。共有させていただきます。こちらで確認して、現場の意見も伺います。"
      )
    ).toBe("受発注や納期調整まわりの営業事務です。");
  });

  it("normalizes voice-sensitive business terms before display and metrics", () => {
    expect(
      normalizeVoiceFriendlyTerms(
        "Adeccoさんと他社さんの違いです。人事課は月初に自己流を避けます。請求想定は千七百五十円から千九百円程度です。"
      )
    ).toBe(
      "アデコさんとたしゃさんの違いです。じんじ課は月の初めに自分のやり方を避けます。請求想定はせんななひゃくごじゅう円から、せんきゅうひゃく円程度です。"
    );
  });
});
