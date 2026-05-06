import { describe, expect, it } from "vitest";
import {
  getPr60LockedResponseForUser,
  normalizePr60AssistantText,
  shouldStopAtPr60LockedResponse,
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
});
