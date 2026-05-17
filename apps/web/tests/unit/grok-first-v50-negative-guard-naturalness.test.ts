import { describe, expect, it } from "vitest";
import {
  applyNegativeGuardDeletionOnly,
  evaluateNegativeGuard,
} from "../../lib/grok-first-roleplay/negative-guard";

describe("grok-first v50 negative guard naturalness", () => {
  it("cancels customer-led generic closing during streaming", () => {
    const decision = evaluateNegativeGuard({
      text: "よろしくお願いします。何かご質問ありますか。",
      userText: "はい、今回よろしくお願いします。",
      phase: "stream",
    });

    expect(decision.action).toBe("cancel");
    expect(decision.reasons).toContain("forbidden_suffix");
    expect(decision.reasons).toContain("generic_closing_question");
    expect(decision.reasons).toContain("customer_led_sales_flow");
  });

  it("deletes all visible text for the T01 failing response", () => {
    const decision = evaluateNegativeGuard({
      text: "よろしくお願いします。何かご質問ありますか。",
      userText: "はい、今回よろしくお願いします。",
      phase: "final",
    });

    expect(
      applyNegativeGuardDeletionOnly(
        "よろしくお願いします。何かご質問ありますか。",
        decision
      )
    ).toBe("");
  });

  it("cancels known customer-led sales-flow phrases during streaming", () => {
    const decision = evaluateNegativeGuard({
      text: "業務内容の大枠からお話ししましょうか。",
      userText: "うん。",
      phase: "stream",
    });

    expect(decision.action).toBe("cancel");
    expect(decision.reasons).toContain("customer_led_sales_flow");
  });

  it("cancels alternate customer-led phrasing observed in production T03", () => {
    for (const text of [
      "そこから少し詳しくお伝えしますか。",
      "業務内容や条件など、どこからお話ししましょうか。",
      "詳しい業務の流れはまたお聞きいただけますか。",
    ]) {
      const decision = evaluateNegativeGuard({
        text,
        userText: "そうですね。少し詳しくお話しいただけますか。",
        phase: "stream",
      });

      expect(decision.action).toBe("cancel");
      expect(decision.reasons).toContain("customer_led_sales_flow");
    }
  });

  it("cancels generic confirmation suffixes before they can leak as audio", () => {
    const decision = evaluateNegativeGuard({
      text: "はい、受注処理が増えてきています。よろしいでしょうか。",
      userText: "そうですね。少し詳しくお話しいただけますか。",
      phase: "stream",
    });

    expect(decision.action).toBe("cancel");
    expect(decision.reasons).toContain("forbidden_suffix");
    expect(decision.reasons).toContain("generic_closing_question");
    expect(decision.reasons).toContain("customer_led_sales_flow");
  });

  it("suppresses any generated topic after low-information input", () => {
    const decision = evaluateNegativeGuard({
      text: "品番確認と納期回答が滞りやすい状況ですね。",
      userText: "そうですか。",
      phase: "stream",
    });

    expect(decision.action).toBe("cancel");
    expect(decision.reasons).toContain("low_information_input_new_topic");
  });

  it("cancels customer-side requests for the salesperson to elaborate", () => {
    const decision = evaluateNegativeGuard({
      text: "どんなところが滞っているか、などもう少し詳しく伺えますか。",
      userText: "そうですね。少し詳しくお話しいただけますか。",
      phase: "stream",
    });

    expect(decision.action).toBe("cancel");
    expect(decision.reasons).toContain("customer_led_sales_flow");
  });

  it("suppresses premature decision-structure detail on shallow background questions", () => {
    const streamDecision = evaluateNegativeGuard({
      text: "受注処理が増えていて、社員側の確認負荷が高くなっています。そこは現場課長にも確認が必要です。",
      userText: "そうですね、今回の募集背景を教えてください。",
      phase: "stream",
    });

    expect(streamDecision.action).toBe("cancel");
    expect(streamDecision.reasons).toContain("premature_sensitive_reveal");

    const finalDecision = evaluateNegativeGuard({
      text: "受注処理が増えていて、社員側の確認負荷が高くなっています。そこは現場課長にも確認が必要です。",
      userText: "そうですね、今回の募集背景を教えてください。",
      phase: "final",
    });

    expect(finalDecision.action).toBe("drop_sentence");
    expect(
      applyNegativeGuardDeletionOnly(
        "受注処理が増えていて、社員側の確認負荷が高くなっています。そこは現場課長にも確認が必要です。",
        finalDecision
      )
    ).toBe("受注処理が増えていて、社員側の確認負荷が高くなっています。");
  });

  it("cancels vague consultation closing phrases during streaming", () => {
    const decision = evaluateNegativeGuard({
      text: "まずはこのあたりでご相談できればと思います。",
      userText: "そうですね、今回の募集背景を教えてください。",
      phase: "stream",
    });

    expect(decision.action).toBe("cancel");
    expect(decision.reasons).toContain("customer_led_sales_flow");
  });

  it("cancels prompts that tell the salesperson to ask for more detail", () => {
    const decision = evaluateNegativeGuard({
      text: "背景の詳細が必要でしたらお聞きください。",
      userText: "そうですね、今回の募集背景を教えてください。",
      phase: "stream",
    });

    expect(decision.action).toBe("cancel");
    expect(decision.reasons).toContain("customer_led_sales_flow");
  });

  it("cancels budgeted residual false-pass review phrases", () => {
    for (const text of [
      "詳細はまたご質問いただければお答えします。",
      "具体的にどの部分をお聞きでしょうか？",
    ]) {
      const decision = evaluateNegativeGuard({
        text,
        userText: "条件を全部教えてください。",
        phase: "stream",
      });

      expect(decision.action).toBe("cancel");
      expect(decision.reasons).toContain("customer_led_sales_flow");
    }
  });

  it("cancels generic confirmation tails added after bounded answers", () => {
    const decision = evaluateNegativeGuard({
      text: "品番確認が滞りやすい状況です。確認します。",
      userText: "分かりました、続けてください。",
      phase: "stream",
    });

    expect(decision.action).toBe("cancel");
    expect(decision.reasons).toContain("forbidden_suffix");
  });

  it("drops recap filler after bounded continuation and condition answers", () => {
    for (const text of [
      "品番確認が滞りやすい状況です。この辺りが主な背景ですね。",
      "品番確認が滞りやすい状況です。背景はそんなところですね。",
      "品番確認が滞りやすい状況です。背景の補足が必要でしたらお知らせください。",
      "品番確認が滞りやすい状況です。営業管理課側では少し対応が追いつきにくいようです。",
      "品番確認が滞りやすい状況です。このあたりが今回のお話しの背景になります。",
      "品番確認が滞りやすい状況です。その理解で近いです。",
      "営業事務で一名、開始は六月一日、受注入力や納期調整が中心です。詳細はもう少しお話ししながら整理していきましょう。",
    ]) {
      const decision = evaluateNegativeGuard({
        text,
        userText: "分かりました、続けてください。",
        phase: "stream",
      });

      expect(decision.action).toBe("cancel");
      expect(decision.reasons).toContain("unnatural_ai_phrase");
    }
  });

  it("drops the second sentence on continue-only turns", () => {
    const decision = evaluateNegativeGuard({
      text: "品番確認が滞りやすい状況です。そのため、代理店や工務店への対応が少し遅れがちになっています。",
      userText: "分かりました、続けてください。",
      phase: "final",
    });

    expect(decision.action).toBe("drop_sentence");
    expect(
      applyNegativeGuardDeletionOnly(
        "品番確認が滞りやすい状況です。そのため、代理店や工務店への対応が少し遅れがちになっています。",
        decision
      )
    ).toBe("品番確認が滞りやすい状況です。");
  });

  it("cancels share-can-do false-pass tails", () => {
    const decision = evaluateNegativeGuard({
      text: "正式な求人票はまだ固まっていません。必要に応じて内容は共有できますよ。",
      userText: "求人票はありますか。",
      phase: "stream",
    });

    expect(decision.action).toBe("cancel");
    expect(decision.reasons).toContain("unnatural_ai_phrase");
  });

  it("cancels leaked prompt-style runtime instructions", () => {
    for (const text of [
      "今回のご相談内容に戻らせていただいてもよろしいでしょうか？営業への質問返しや次の話題提案は出さないでください。",
      "その理解で近いです。確認負荷を軽減するための募集です。こちらの理解で合っていますか。",
    ]) {
      const decision = evaluateNegativeGuard({
        text,
        userText: "本日の内容を踏まえて、次は候補者提案に進める形でよいですか。",
        phase: "stream",
      });

      expect(decision.action).toBe("cancel");
      expect(decision.reasons).toContain("unnatural_ai_phrase");
    }
  });
});
