import { describe, expect, it } from "vitest";
import { classifyNormalInputRoute } from "../../lib/grok-first-roleplay/guard/normal-input-router";

describe("grok-first v50 normal input router", () => {
  it("suppresses opening greetings before realtime response generation", () => {
    const decision = classifyNormalInputRoute("はい、今回よろしくお願いします。");

    expect(decision.action).toBe("noise_ignored");
    expect(decision.shouldSendToRealtime).toBe(false);
    expect(decision.shouldSpeak).toBe(false);
    expect(decision.reasons).toContain("opening_greeting");
    expect(decision.reasons).toContain("low_information_input");
  });

  it("suppresses low-information backchannels", () => {
    for (const input of ["うん。", "そうですか。", "なるほど。", "へ。"]) {
      const decision = classifyNormalInputRoute(input);
      expect(decision.action).toBe("noise_ignored");
      expect(decision.shouldSendToRealtime).toBe(false);
      expect(decision.shouldSpeak).toBe(false);
      expect(decision.reasons).toContain("low_information_input");
    }
  });

  it("passes or bounds explicit business questions", () => {
    for (const input of [
      "少し詳しくお話しいただけますか。",
      "背景をもう少し教えてください。",
      "業務内容を教えてください。",
      "条件を教えてください。",
    ]) {
      const decision = classifyNormalInputRoute(input);
      expect(decision.action).toBe("pass");
      expect(decision.shouldSendToRealtime).toBe(true);
    }
  });

  it("bounds continuation and budgeted residual risk inputs", () => {
    const continuation = classifyNormalInputRoute("分かりました、続けてください。");
    expect(continuation.action).toBe("pass");
    expect(continuation.rewrittenText).toContain("直前に話していた募集背景だけ");
    expect(continuation.rewrittenText).toContain(
      "「品番確認が滞りやすい状況です。」とだけ"
    );
    expect(continuation.rewrittenText).toContain("確認します");
    expect(continuation.reasons).toContain("continue_detail_request");

    const conditions = classifyNormalInputRoute("条件を全部教えてください。");
    expect(conditions.rewrittenText).toContain("条件の大枠だけ");
    expect(conditions.rewrittenText).not.toContain("ご質問ください");

    const rate = classifyNormalInputRoute("単価レンジはどのくらいですか。");
    expect(rate.rewrittenText).toContain("単価レンジ");
    expect(rate.rewrittenText).toContain("具体額");
    expect(rate.rewrittenText).toContain("聞き返し");
    expect(rate.rewrittenText).toContain("出さない");

    const misheardRate = classifyNormalInputRoute(
      "炭火レンジはどのくらいですか。"
    );
    expect(misheardRate.rewrittenText).toContain("単価レンジ");
    expect(misheardRate.reasons).toContain("rate_request");
  });

  it("bounds remaining budgeted residual semantic cases", () => {
    const scope = classifyNormalInputRoute(
      "今日の確認内容は背景、業務、要件までで足りていますか。"
    );
    expect(scope.rewrittenText).toContain("背景");
    expect(scope.rewrittenText).toContain("業務内容");
    expect(scope.rewrittenText).toContain("要件");
    expect(scope.rewrittenText).toContain("足ります");
    expect(scope.reasons).toContain("confirmation_scope_request");

    const tradeoff = classifyNormalInputRoute(
      "すぐ候補者を出したいので、条件を緩めるならどこですか。"
    );
    expect(tradeoff.rewrittenText).toContain("メーカー経験");
    expect(tradeoff.rewrittenText).toContain("受発注");
    expect(tradeoff.rewrittenText).toContain("対外調整");
    expect(tradeoff.reasons).toContain("requirement_tradeoff_request");

    const otherVendor = classifyNormalInputRoute("他社状況を教えてください。");
    expect(otherVendor.rewrittenText).toContain("他社状況");
    expect(otherVendor.rewrittenText).toContain("決定的な候補者");
    expect(otherVendor.reasons).toContain("other_vendor_status_request");

    const misheardOtherVendor =
      classifyNormalInputRoute("求人状況を教えてください。");
    expect(misheardOtherVendor.rewrittenText).toContain("他社状況");
    expect(misheardOtherVendor.reasons).toContain("other_vendor_status_request");

    const companyStatus = classifyNormalInputRoute("会社状況を教えてください。");
    expect(companyStatus.rewrittenText).toContain("他社状況");
    expect(companyStatus.reasons).toContain("other_vendor_status_request");

    const destination = classifyNormalInputRoute(
      "確認先は社内外それぞれどこになりますか。"
    );
    expect(destination.rewrittenText).toContain("確認先");
    expect(destination.rewrittenText).toContain("代理店");
    expect(destination.reasons).toContain("confirmation_destination_request");

    const candidateFlow = classifyNormalInputRoute(
      "候補者提案時はスキルカードを先に確認いただく流れですか。"
    );
    expect(candidateFlow.rewrittenText).toContain("スキルカード");
    expect(candidateFlow.rewrittenText).toContain("職場見学");
    expect(candidateFlow.reasons).toContain("candidate_flow_request");

    const candidateClosing = classifyNormalInputRoute(
      "本日の内容を踏まえて、次は候補者提案に進める形でよいですか。"
    );
    expect(candidateClosing.rewrittenText).toContain("候補者提案");
    expect(candidateClosing.rewrittenText).not.toContain("よろしいでしょうか");
    expect(candidateClosing.reasons).toContain(
      "candidate_proposal_closing_request"
    );

    const jobDescription = classifyNormalInputRoute("求人票はありますか。");
    expect(jobDescription.rewrittenText).toContain("求人票");
    expect(jobDescription.rewrittenText).toContain("確認中");
    expect(jobDescription.reasons).toContain("job_description_request");

    const hypothesis = classifyNormalInputRoute(
      "社員側の確認負荷が高いという仮説で近いですか。"
    );
    expect(hypothesis.rewrittenText).toContain("その理解で近い");
    expect(hypothesis.reasons).toContain("background_hypothesis_request");
  });

  it("rewrites explicit normal sales questions into bounded realtime instructions", () => {
    const background = classifyNormalInputRoute(
      "そうですね、今回の募集背景を教えてください。"
    );
    expect(background.action).toBe("pass");
    expect(background.rewrittenText).toContain("募集背景だけ");
    expect(background.rewrittenText).toContain("とだけ一文");
    expect(background.rewrittenText).toContain("何も足さない");
    expect(background.rewrittenText).toContain("現場課長");
    expect(background.rewrittenText).toContain("出さず");
    expect(background.rewrittenText).toContain("挨拶・確認文で終えない");
    expect(background.reasons).toContain("normal_realtime_rewrite");

    const detail = classifyNormalInputRoute(
      "そうですね。少し詳しくお話しいただけますか。"
    );
    expect(detail.action).toBe("pass");
    expect(detail.rewrittenText).toContain("品番確認");
    expect(detail.rewrittenText).toContain("納期回答");
    expect(detail.reasons).toContain("background_detail_request");
  });
});
