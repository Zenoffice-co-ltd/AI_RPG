import { describe, expect, it } from "vitest";
import {
  containsVoiceStockSuffix,
  getPr60LockedResponseForUser,
  normalizeGrokVoiceDisplayText,
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
    ).toBe("つきあたり、ろっぴゃく件から、ななひゃっけん程度です。");
    expect(
      getPr60LockedResponseForUser(
        "候補者のスキルで言うとどういうスキルがあるといいんですか？"
      )
    ).toBe("じゅはっちゅう経験と対外調整の経験がある方を優先的に見ています。");
    expect(
      getPr60LockedResponseForUser(
        "協調性をもう少し具体的に聞いてもいいですか？"
      )
    ).toBe(
      "営業や物流と確認しながら進める場面が多いので、抱え込まずに連携できる方が合います。"
    );
    expect(getPr60LockedResponseForUser("人柄については？")).toBe(
      "周囲と合わせて進められるタイプが合いやすく、自分のやり方にこだわりすぎる方は合いにくいです。"
    );
    expect(getPr60LockedResponseForUser("単価とかはいくらでしょうね？")).toBe(
      "請求想定は経験により、千七百五十円から、千九百円程度です。"
    );
    expect(getPr60LockedResponseForUser("具体的に、どういう業務になりますかね？")).toBe(
      "じゅはっちゅうや納期調整まわりの営業事務です。"
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
    expect(
      stripVoiceStockSuffixSentences(
        "まずは営業事務を一名お願いしたい相談です。他の条件もお聞きいただければと思います。"
      )
    ).toBe("まずは営業事務を一名お願いしたい相談です。");
  });

  it("normalizes voice-sensitive business terms before display and metrics", () => {
    expect(
      normalizeVoiceFriendlyTerms(
        "Adeccoさんと他社さんの違いです。人事課は月末と月初に協調型で自己流を避けます。受発注は月あたりで見ます。平日は朝八時四十五分です。開始は六月一日です。請求想定は千七百五十円から千九百円程度です。"
      )
    ).toBe(
      "アデコさんとたしゃさんの違いです。じんじ課は月のおわりと月の初めに周囲と合わせて進められるタイプで自分のやり方を避けます。じゅはっちゅうはつきあたりで見ます。平日は朝八時よんじゅうごふんです。開始は六月ついたちです。請求想定は千七百五十円から、千九百円程度です。"
    );
  });

  // -------------------------------------------------------------------------
  // Phase 6: deterministic locks for #74 (件数), #75 (broad skill), #78 (業務内容).
  // Verify the new user-pattern surfaces all route to canonical responses,
  // and that specific skill follow-ups (正確性/メーカー経験/必須) do NOT get
  // swallowed by the broad-skill lock.
  // -------------------------------------------------------------------------

  describe("Phase 6 deterministic locks", () => {
    const VOLUME_RESPONSE =
      "つきあたり、ろっぴゃく件から、ななひゃっけん程度です。";
    const BROAD_SKILL_RESPONSE =
      "じゅはっちゅう経験と対外調整の経験がある方を優先的に見ています。";
    const JOB_DETAIL_RESPONSE = "じゅはっちゅうや納期調整まわりの営業事務です。";

    describe("#74 件数 lock", () => {
      it.each([
        "月にどのくらい処理しますか？",
        "件数はどの程度ですか？",
        "処理量を教えてください。",
        "受注件数は？",
        "どれくらい処理されますか？",
        "ボリュームはどのくらいですか？",
        "どの程度の量があるのでしょうか。",
      ])("routes %s to volume canonical", (input) => {
        expect(getPr60LockedResponseForUser(input)).toBe(VOLUME_RESPONSE);
      });
    });

    describe("#75 broad initial skill lock", () => {
      it.each([
        "どういうスキルが必要ですか？",
        "候補者のスキルは？",
        "どんな経験があるといいですか？",
        "スキル面で望ましい条件は？",
        "スキルは必要ですか？",
        "どんなスキルが望ましいでしょうか。",
      ])("routes %s to broad-skill canonical", (input) => {
        expect(getPr60LockedResponseForUser(input)).toBe(BROAD_SKILL_RESPONSE);
      });

      it("does NOT match broad lock for hypothetical case11-style turn", () => {
        // case11: "候補者が少ない場合、…受発注経験があれば、業界未経験でも
        // 検討できますか？" — this is a hypothetical, NOT a broad-skill
        // question. Must fall through to realtime.
        expect(
          getPr60LockedResponseForUser(
            "理想はメーカーでの受発注経験者だと思いますが、候補者が少ない場合、営業事務で納期調整や社外対応の経験があれば、住宅設備業界未経験でも検討できますか？"
          )
        ).toBeNull();
      });

      it.each([
        // Excluded from broad lock to avoid collision with メーカー経験
        // specific follow-up. These fall through to realtime model.
        "経験は必要ですか？",
        "経験はありますか？",
      ])("does NOT match broad-skill lock for %s (avoids メーカー経験 collision)", (input) => {
        expect(getPr60LockedResponseForUser(input)).toBeNull();
      });

      it("specific 協調性 follow-up is NOT swallowed by broad lock (deterministic)", () => {
        expect(
          getPr60LockedResponseForUser("協調性についてもう少し教えてください")
        ).toBe(
          "営業や物流と確認しながら進める場面が多いので、抱え込まずに連携できる方が合います。"
        );
      });

      it("specific 正確性 follow-up falls through to realtime (no deterministic lock)", () => {
        // Per Phase 6 directive: 正確性 specific follow-up is NOT
        // deterministically locked — the realtime model handles it via the
        // Skill Disclosure Budget prompt rule. Returns null so the client
        // sends the question to realtime.
        expect(
          getPr60LockedResponseForUser(
            "正確性というのは具体的にどういうことですか？"
          )
        ).toBeNull();
      });

      it("specific メーカー経験 follow-up falls through to realtime (no deterministic lock)", () => {
        expect(getPr60LockedResponseForUser("メーカー経験は必須ですか？")).toBeNull();
      });

      it("CP-handoff summary that mentions メーカー経験 in passing does NOT trigger broad-skill lock", () => {
        // case5 sentinel — the user is sharing a summary, not asking about
        // skills. Must NOT hit the broad lock.
        expect(
          getPr60LockedResponseForUser(
            "CPには、住宅設備メーカー経験必須ではなく、納期調整と社外対応に抵抗がなく、製品コードを覚えることに前向きな方を優先、と共有するのが良さそうですね。"
          )
        ).toBeNull();
      });
    });

    describe("#78 業務内容 lock", () => {
      it.each([
        "業務内容を教えてください。",
        "具体的にはどんな業務ですか？",
        "仕事内容は？",
        "営業事務の内容を教えてください。",
        "何をするのでしょうか。",
        "業務について教えてもらえますか。",
        "どういう業務をご担当されますか。",
      ])("routes %s to job-detail canonical", (input) => {
        expect(getPr60LockedResponseForUser(input)).toBe(JOB_DETAIL_RESPONSE);
      });
    });

    it("rapid-fire compound questions bypass single-intent locks", () => {
      // case7 sentinel — user fires multiple topics at once and expects
      // pushback, NOT a single-intent canonical answer.
      expect(
        getPr60LockedResponseForUser(
          "業務内容と人数と単価と開始日と残業と決裁者と競合状況を全部教えてください。"
        )
      ).toBeNull();
      expect(
        getPr60LockedResponseForUser(
          "業務内容と単価と件数を一気に教えてください。"
        )
      ).toBeNull();
      expect(
        getPr60LockedResponseForUser(
          "募集背景と業務内容をまとめて伺えますか？"
        )
      ).toBeNull();
      // Single "と" without a "全部/まとめて" tail is normal compound speech,
      // not rapid-fire — single-intent locks should still fire.
      expect(
        getPr60LockedResponseForUser(
          "業務内容について教えてください。"
        )
      ).toBe("じゅはっちゅうや納期調整まわりの営業事務です。");
    });

    it("ordering: specific skill follow-ups precede broad skill in the table", () => {
      // Sentinel: a phrase that contains BOTH the broad pattern token and
      // the specific follow-up token. The matcher must return the SPECIFIC
      // canonical, proving specific entries appear FIRST in the table.
      const r = getPr60LockedResponseForUser(
        "協調性についてもう少し具体的に聞いてもいいですか？"
      );
      expect(r).toBe(
        "営業や物流と確認しながら進める場面が多いので、抱え込まずに連携できる方が合います。"
      );
    });
  });

  it("normalizes voice-facing text back to display/evaluation text", () => {
    expect(
      normalizeGrokVoiceDisplayText(
        "じんじ課では六月ついたち開始で、月のおわりと月の初めに忙しくなります。周囲と合わせて進められるタイプが合いやすく、たしゃさんとの違いも見ています。つきあたり、ろっぴゃく件から、ななひゃっけん程度です。じゅはっちゅうは朝八時よんじゅうごふんからです。請求想定はせんななひゃくごじゅう円から、せんきゅうひゃく円程度です。"
      )
    ).toBe(
      "人事課では六月一日開始で、月末と月初に忙しくなります。協調型が合いやすく、他社さんとの違いも見ています。月あたり、六百件から、七百件程度です。受発注は朝八時四十五分からです。請求想定は千七百五十円から、千九百円程度です。"
    );
  });
});
