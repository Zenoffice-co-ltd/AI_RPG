import { describe, expect, it } from "vitest";
import {
  STAFFING_ADECCO_DISCLOSURE_LEDGER,
  renderDisclosureLedgerForPrompt,
  type DisclosureItem,
} from "./staffingAdeccoLedger";

describe("STAFFING_ADECCO_DISCLOSURE_LEDGER", () => {
  it("contains the 21 trigger intents required by DoD 1 + Auto-Gate Recovery + manual orb v6 Excel-design coverage + manual orb v8 culture_fit split", () => {
    const expectedTriggers = [
      "identity_self",
      "overview_shallow",
      "headcount_only",
      "background_shallow",
      "background_deep_vendor_reason",
      "job_shallow",
      "job_detail_tasks",
      "volume_cycle",
      // v6 (Excel design Sheet 03 §4 後半): handover の独立 trigger
      "handover_method",
      "competition",
      "first_proposal_window",
      "decision_structure",
      "start_date_only",
      "urgency_or_submission_deadline",
      "commercial_terms",
      // v6 (Excel design Sheet 03 §6): forced ranking 独立 trigger
      "selection_priority_ranking",
      // v8 (manual orb v7 で culture_fit_question 1 trigger だと repetition が発生したため分離):
      "supervisor_personality_question",
      "team_atmosphere_question",
      "next_step_close",
      "closing_summary",
      "coaching_request",
    ];
    expect(STAFFING_ADECCO_DISCLOSURE_LEDGER.map((item) => item.triggerIntent)).toEqual(
      expectedTriggers
    );
  });

  it("Manual orb v6+v8 (Excel design coverage): handover_method / selection_priority_ranking / supervisor_personality_question / team_atmosphere_question triggers exist with substantive allowedAnswer", () => {
    const newTriggers = [
      "handover_method",
      "selection_priority_ranking",
      "supervisor_personality_question",
      "team_atmosphere_question",
    ];
    for (const triggerIntent of newTriggers) {
      const item = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
        (i) => i.triggerIntent === triggerIntent
      );
      expect(item, `trigger ${triggerIntent} must exist`).toBeDefined();
      expect(item!.allowedAnswer.length).toBeGreaterThan(20);
      expect(item!.asrVariantTriggers.length).toBeGreaterThan(0);
      expect(item!.intentDescription.length).toBeGreaterThan(20);
    }

    // Specific content sanity for the new triggers
    const handover = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "handover_method"
    );
    expect(handover!.allowedAnswer).toContain("二週間");
    expect(handover!.allowedAnswer).toContain("OJT");
    expect(handover!.asrVariantTriggers).toEqual(
      expect.arrayContaining(["引継ぎ", "OJT", "独り立ち"])
    );

    const ranking = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "selection_priority_ranking"
    );
    expect(ranking!.allowedAnswer).toContain("優先順位");
    expect(ranking!.allowedAnswer).toContain("受発注");
    expect(ranking!.asrVariantTriggers).toEqual(
      expect.arrayContaining(["優先順位", "最優先", "must と want"])
    );

    // v8 split: supervisor_personality_question handles 指揮命令者の人柄 + 合う/合わないタイプ ONLY
    const supervisor = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "supervisor_personality_question"
    );
    expect(supervisor!.allowedAnswer).toContain("課長");
    expect(supervisor!.allowedAnswer).toContain("協調型");
    // 指揮命令者の人柄 trigger なので部署人数・服装は含めない
    expect(supervisor!.allowedAnswer).not.toContain("十二名");
    expect(supervisor!.allowedAnswer).not.toContain("オフィスカジュアル");
    expect(supervisor!.asrVariantTriggers).toEqual(
      expect.arrayContaining(["指揮命令者", "課長", "合わない"])
    );

    // v8 split: team_atmosphere_question handles 部署構成 + 服装 + 休憩室 ONLY
    const atmosphere = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "team_atmosphere_question"
    );
    expect(atmosphere!.allowedAnswer).toContain("十二名");
    expect(atmosphere!.allowedAnswer).toContain("オフィスカジュアル");
    expect(atmosphere!.allowedAnswer).toContain("休憩室");
    // 職場環境 trigger なので 課長の人柄・合う/合わないタイプは含めない
    expect(atmosphere!.allowedAnswer).not.toContain("協調型");
    expect(atmosphere!.allowedAnswer).not.toContain("正確性に厳しい");
    expect(atmosphere!.asrVariantTriggers).toEqual(
      expect.arrayContaining(["雰囲気", "男女比", "服装"])
    );
  });

  it("Manual orb v8 P0: identity_self.negativeExamples include the literal stage-direction smoking guns", () => {
    const item = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "identity_self"
    );
    expect(item).toBeDefined();
    const joined = item!.negativeExamples.join("|");
    // Manual orb v7→v8: AI emitted the literal stage direction "（何も返さず...）"
    // — must be locked into negativeExamples as a forbidden output.
    expect(joined).toContain("（何も返さず、ユーザーの次の発話を待ちます）");
    expect(joined).toContain("（沈黙）");
    expect(joined).toContain("（応答なし）");
    expect(joined).toContain("（次の発話を待つ）");
    expect(joined).toContain("（保留）");
  });

  it("Manual orb v8 P0: identity_self.intentDescription forbids stage direction output and references manual orb v8", () => {
    const item = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "identity_self"
    );
    expect(item).toBeDefined();
    expect(item!.intentDescription).toContain("manual orb v8");
    expect(item!.intentDescription).toContain(
      "応答テキストを 1 文字も生成しない"
    );
    expect(item!.intentDescription).toContain("stage direction");
  });

  it("Manual orb v10 P1: identity_self.negativeExamples lock SSML/TTS markup hallucination ([slow] / [pause] / [laugh] / [break] / <break/>)", () => {
    const item = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "identity_self"
    );
    expect(item).toBeDefined();
    const joined = item!.negativeExamples.join("|");
    // Manual orb v10: AI hallucinated [slow] markup despite it not being in the prompt.
    expect(joined).toContain("[slow]");
    expect(joined).toContain("[pause]");
    expect(joined).toContain("[laugh]");
    expect(joined).toContain("[/slow]");
    expect(joined).toContain("[break]");
    expect(joined).toContain("<break/>");
    // Smoking-gun observed in manual orb v10:
    expect(joined).toContain(
      "[slow] 指揮命令者の課長は落ち着いていますが正確性に厳しい方です。"
    );
  });

  it("Manual orb v10 P0: identity_self.negativeExamples lock 「すみません、少し音声が途切れたかもしれません」silence prefix smoking-gun (# 沈黙時の扱い conflict resolution)", () => {
    const item = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "identity_self"
    );
    expect(item).toBeDefined();
    const joined = item!.negativeExamples.join("|");
    // The literal phrase that was allowed by the now-removed # 沈黙時の扱い section.
    expect(joined).toContain(
      "すみません、少し音声が途切れたかもしれません。続きがあれば伺います。"
    );
    expect(joined).toContain(
      "[slow] すみません、少し音声が途切れたかもしれません。続きがあれば伺います。"
    );
  });

  it("Manual orb v9 P1: supervisor_personality_question + team_atmosphere_question negativeExamples lock 承知しました prefix smoking-gun", () => {
    const supervisor = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "supervisor_personality_question"
    );
    const atmosphere = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "team_atmosphere_question"
    );
    expect(supervisor).toBeDefined();
    expect(atmosphere).toBeDefined();

    // supervisor_personality_question: 4 filler-prefix smoking guns
    const supervisorJoined = supervisor!.negativeExamples.join("|");
    expect(supervisorJoined).toContain(
      "承知しました。少し整理しますね。指揮命令者の課長は落ち着いていますが正確性に厳しい方です。"
    );
    expect(supervisorJoined).toContain(
      "承知しました。指揮命令者の課長は落ち着いていますが正確性に厳しい方です。"
    );
    expect(supervisorJoined).toContain(
      "少し整理しますね。指揮命令者の課長は落ち着いていますが正確性に厳しい方です。"
    );
    expect(supervisorJoined).toContain(
      "お待ちください。指揮命令者の課長は落ち着いていますが正確性に厳しい方です。"
    );

    // team_atmosphere_question: same filler-prefix smoking guns
    const atmosphereJoined = atmosphere!.negativeExamples.join("|");
    expect(atmosphereJoined).toContain(
      "承知しました。少し整理しますね。営業業務課は十二名で、女性八名、男性四名、三十代から四十代が中心です。"
    );
    expect(atmosphereJoined).toContain(
      "承知しました。営業業務課は十二名で、女性八名、男性四名、三十代から四十代が中心です。"
    );
    expect(atmosphereJoined).toContain(
      "少し整理しますね。営業業務課は十二名で、女性八名、男性四名、三十代から四十代が中心です。"
    );
    expect(atmosphereJoined).toContain(
      "お待ちください。営業業務課は十二名で、女性八名、男性四名、三十代から四十代が中心です。"
    );
  });

  it("Manual orb v6 (Excel design coverage): job_detail_tasks.allowedAnswer mentions データ入力 (Excel SAP→データ入力 置換)", () => {
    const item = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "job_detail_tasks"
    );
    expect(item).toBeDefined();
    expect(item!.allowedAnswer).toContain("データ入力");
    // SAP must remain absent
    expect(item!.allowedAnswer).not.toMatch(/SAP|エスエーピー/);
  });

  it("Manual orb v7 P0: closing_summary intentDescription embeds semantic equivalence rule (時刻の半 = 三十分 / 漢数字 ⇔ 算用数字)", () => {
    const item = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "closing_summary"
    );
    expect(item).toBeDefined();
    expect(item!.intentDescription).toContain("表記揺れの同義扱い");
    expect(item!.intentDescription).toContain("十七時半");
    expect(item!.intentDescription).toContain("十七時三十分");
    expect(item!.intentDescription).toContain("半は 30 分の同義");
    expect(item!.intentDescription).toContain("一名");
    expect(item!.intentDescription).toContain("六月一日");
    expect(item!.intentDescription).toContain("意味が同じ項目は合意");
  });

  it("Manual orb v7 P0: closing_summary negativeExamples include the 半→三十分 wrong-correction smoking gun", () => {
    const item = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "closing_summary"
    );
    expect(item).toBeDefined();
    const joined = item!.negativeExamples.join("|");
    // The exact failure pattern observed in manual orb v7: AI rejected
    // 十七時半 as different from 十七時三十分 even though they are equivalent.
    expect(joined).toContain("違います。就業時間は十七時半ではなく、十七時三十分です。");
    // Also: 漢数字/算用数字の表記揺れを訂正する失敗
    expect(joined).toContain("違います。募集は1名ではなく、一名で考えています。");
    expect(joined).toContain("違います。開始は6月1日ではなく、六月一日を希望しています。");
    // フィラー失敗
    expect(joined).toContain("承知しました。少し整理しますね。");
  });

  it("Manual orb v7 P2: handover_method.allowedAnswer uses だいたい (not 概ね) for TTS-friendly speech", () => {
    const item = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "handover_method"
    );
    expect(item).toBeDefined();
    expect(item!.allowedAnswer).toContain("だいたい一か月");
    // 概ね is replaced because TTS reads it awkwardly
    expect(item!.allowedAnswer).not.toContain("概ね一か月");
  });

  it("Manual orb v7 P1: identity_self intentDescription guards against backchannel misfire (うん / はい / えっと 単独)", () => {
    const item = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "identity_self"
    );
    expect(item).toBeDefined();
    expect(item!.intentDescription).toContain("短い相槌");
    expect(item!.intentDescription).toContain("うん");
    expect(item!.intentDescription).toContain("えっと");
    expect(item!.intentDescription).toContain("役割確認として扱わない");
    expect(item!.intentDescription).toContain("役職を 2 回以上同じ会話で言い直さない");
  });

  it("Manual orb v7 P1: next_step_close intentDescription forbids AI-side self-initiation", () => {
    const item = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "next_step_close"
    );
    expect(item).toBeDefined();
    expect(item!.intentDescription).toContain("AI 側 (人事) から自発的");
    expect(item!.intentDescription).toContain("商談進行確認は学習者 (営業) が AI に問いかける発話パターン");
    expect(item!.intentDescription).toContain("AI が代わりに進行確認しない");
  });

  it("DoD 3.1: headcount_only is independent and forbids leaking other facts", () => {
    const item = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "headcount_only"
    );
    expect(item).toBeDefined();
    expect(item!.allowedAnswer).toContain("一名");
    expect(item!.forbiddenUntilAsked).toEqual(
      expect.arrayContaining([
        "background_deep_vendor_reason",
        "competition",
        "commercial_terms",
        "decision_structure",
        "volume_cycle",
        "job_detail_tasks",
      ])
    );
  });

  it("DoD 3.2: next_step_close is separate from coaching_request and gives a real next-action answer", () => {
    const next = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "next_step_close"
    );
    const coaching = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "coaching_request"
    );
    expect(next).toBeDefined();
    expect(coaching).toBeDefined();
    expect(next!.allowedAnswer).toContain("ご提案");
    expect(next!.allowedAnswer).toContain("メール");
    // Coaching must explicitly NOT match next-step phrasing
    expect(coaching!.intentDescription).toContain("コーチング要求ではなく顧客として自然な次アクション");
    // next_step_close negativeExamples should include the typical brushed-off response
    const nextNegatives = next!.negativeExamples.join(" / ");
    expect(nextNegatives).toContain("どの点についてですか");
  });

  it("DoD 3.3: start_date_only and urgency_or_submission_deadline are split", () => {
    const start = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "start_date_only"
    );
    const urgency = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "urgency_or_submission_deadline"
    );
    expect(start).toBeDefined();
    expect(urgency).toBeDefined();
    // Start-date-only must NOT leak urgency / next-week deadline
    expect(start!.forbiddenUntilAsked).toContain("urgency_or_submission_deadline");
    expect(start!.allowedAnswer).toContain("六月一日");
    expect(start!.allowedAnswer).not.toContain("来週水曜");
    // Urgency itself MAY mention 来週水曜
    expect(urgency!.allowedAnswer).toContain("来週水曜");
  });

  it("Manual orb v3 DoD: closing_summary requires BOTH explicit summary signal AND 3+ items in the SAME user turn", () => {
    const item = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "closing_summary"
    );
    expect(item).toBeDefined();
    // (A) explicit summary signal phrases must be enumerated
    expect(item!.intentDescription).toContain("整理させてください");
    expect(item!.intentDescription).toContain("まとめると");
    expect(item!.intentDescription).toContain("進め方でよろしいでしょうか");
    expect(item!.intentDescription).toContain("この理解で合っていますか");
    // (B) 3+ items requirement must be locked into the SAME user turn (strict A∧B mode)
    expect(item!.intentDescription).toContain("三項目以上");
    expect(item!.intentDescription).toContain("同一ユーザーターン");
    expect(item!.intentDescription).toContain("両方");
    // anti-leak: AI must not initiate a summary on its own
    expect(item!.intentDescription).toContain("AI 自身が要約を始めない");
    // anti-leak: must not append closing_summary content to other intents
    expect(item!.intentDescription).toContain("決定構造・次ステップ・競合・単価・件数");
    expect(item!.intentDescription).toContain("今聞かれた質問への答えだけで応答を終え");
    // chat_history accumulation must NOT be a basis for firing
    expect(item!.intentDescription).toContain("会話履歴上");
    expect(item!.intentDescription).toContain("AI 過去発話");
    // allowedAnswer embeds the Adecco/アデコ reverse question (manual orb v4: TTS-friendly katakana form)
    expect(item!.allowedAnswer).toContain("アデコさんの派遣の特徴や");
    // negativeExamples must include the manual orb v3 P0 smoking-gun concatenation (Adecco form)
    const orbV3SmokingGun = "ベンダー選定は人事が主導しますが、候補者の最終的な現場適合判断は現場課長の意見が強く反映されます。はい、大きくはその整理で合っています。";
    expect(item!.negativeExamples.join("|")).toContain(orbV3SmokingGun);
    // negativeExamples must also include the manual orb v4 アデコ form smoking-gun
    expect(item!.negativeExamples.join("|")).toContain("アデコさんの派遣の特徴や");
  });

  it("Manual orb v3 DoD: closing_summary asrVariantTriggers drop the loose hooks (候補をメール / 候補者像 / ご確認事項はありますか)", () => {
    const item = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "closing_summary"
    );
    expect(item).toBeDefined();
    expect(item!.asrVariantTriggers).not.toContain("候補をメール");
    expect(item!.asrVariantTriggers).not.toContain("候補者像");
    expect(item!.asrVariantTriggers).not.toContain("ご確認事項はありますか");
    // explicit signals must remain
    expect(item!.asrVariantTriggers).toContain("整理させてください");
    expect(item!.asrVariantTriggers).toContain("まとめると");
    expect(item!.asrVariantTriggers).toContain("進め方でよろしいでしょうか");
  });

  it("Manual orb v4 DoD: volume_cycle and decision_structure use TTS-natural Japanese (not the compressed orb-fail forms)", () => {
    const volume = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "volume_cycle"
    );
    const decision = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "decision_structure"
    );
    expect(volume).toBeDefined();
    expect(decision).toBeDefined();
    // volume_cycle.allowedAnswer must use the natural form for TTS readability
    expect(volume!.allowedAnswer).toContain("月末と月の初め");
    expect(volume!.allowedAnswer).toContain("月曜日の午前中");
    expect(volume!.allowedAnswer).toContain("取り扱い商品が切り替わる時期");
    // The compressed forms must NOT appear in the live allowedAnswer (TTS reads them harshly)
    expect(volume!.allowedAnswer).not.toContain("月末月初");
    expect(volume!.allowedAnswer).not.toContain("月曜午前、商材切替時");
    // decision_structure.allowedAnswer must use the natural 現場 phrasing
    expect(decision!.allowedAnswer).toContain("候補者が現場に合うかどうかの最終判断");
    expect(decision!.allowedAnswer).not.toContain("現場適合判断");
  });

  it("Manual orb v5 live smoke fix: job_detail_tasks forbids partial answer and still-speaking check phrase", () => {
    const jobDetail = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "job_detail_tasks"
    );
    const closing = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "closing_summary"
    );
    expect(jobDetail).toBeDefined();
    expect(closing).toBeDefined();

    expect(jobDetail!.allowedAnswer).toContain("受発注入力と納期調整が中心");
    expect(jobDetail!.allowedAnswer).toContain("在庫確認");
    expect(jobDetail!.allowedAnswer).toContain("対外対応");
    expect(jobDetail!.negativeExamples.join("|")).toContain("受発注、在庫確認");
    expect(jobDetail!.negativeExamples.join("|")).toContain(
      "まだお話しになられていますでしょうか"
    );
    expect(closing!.negativeExamples.join("|")).toContain(
      "まだお話しになられていますでしょうか"
    );
  });

  it("Manual orb v4 DoD: closing_summary allowedAnswer uses the TTS-friendly katakana アデコ form", () => {
    const item = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "closing_summary"
    );
    expect(item).toBeDefined();
    // The runtime utterance example must use アデコ (katakana) so TTS reads it as アデコ, not アデッコ
    expect(item!.allowedAnswer).toContain("アデコさんの派遣の特徴や");
    expect(item!.allowedAnswer).not.toContain("Adeccoさんの派遣の特徴や");
  });

  it("Manual orb v5 DoD: closing_summary intentDescription embeds canonical truth table for value verification", () => {
    const item = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "closing_summary"
    );
    expect(item).toBeDefined();
    // Verification rule must be present
    expect(item!.intentDescription).toContain("値検証ルール");
    expect(item!.intentDescription).toContain("Canonical truth table");
    expect(item!.intentDescription).toContain("シナリオ真値");
    // Each canonical value must be enumerated so the LLM can cross-check
    expect(item!.intentDescription).toContain("一名");
    expect(item!.intentDescription).toContain("六月一日");
    expect(item!.intentDescription).toContain("八時四十五分から十七時三十分");
    expect(item!.intentDescription).toContain("十から十五時間");
    expect(item!.intentDescription).toContain("千七百五十円から千九百円");
    expect(item!.intentDescription).toContain("受発注");
    expect(item!.intentDescription).toContain("対外調整");
    // Wrong-unit billing rate guard must be enumerated
    expect(item!.intentDescription).toContain("5万円から10万円");
    expect(item!.intentDescription).toContain("時給5万円");
    // Correction protocol must be specified
    expect(item!.intentDescription).toContain("違います");
    expect(item!.intentDescription).toContain("訂正と同時にアデコ逆質問を出さない");
    // Hedging language must be forbidden
    expect(item!.intentDescription).toContain("だいたい合っていますが");
  });

  it("Manual orb v5 DoD: closing_summary allowedAnswer carries BOTH agreement (Case 1) and correction (Case 2) examples", () => {
    const item = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "closing_summary"
    );
    expect(item).toBeDefined();
    // Case 1 (agreement) example
    expect(item!.allowedAnswer).toContain("Case 1");
    expect(item!.allowedAnswer).toContain("はい、大きくはその整理で合っています");
    // Case 2 (correction) examples for major numeric/unit errors
    expect(item!.allowedAnswer).toContain("Case 2");
    expect(item!.allowedAnswer).toContain("違います");
    expect(item!.allowedAnswer).toContain("5万円から10万円ではなく");
    expect(item!.allowedAnswer).toContain("1,750から1,900円");
    // Headcount / start-date / overtime / working-hours correction examples
    expect(item!.allowedAnswer).toContain("2名ではなく");
    expect(item!.allowedAnswer).toContain("7月1日ではなく");
    expect(item!.allowedAnswer).toContain("月30時間ではなく");
    expect(item!.allowedAnswer).toContain("9時から18時ではなく");
  });

  it("Manual orb v5 DoD: closing_summary negativeExamples include wrong-amount-agreed smoking gun (both Adecco/アデコ forms) and hedging failures", () => {
    const item = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "closing_summary"
    );
    expect(item).toBeDefined();
    const joined = item!.negativeExamples.join("|");
    // The exact smoking-gun: agreeing to the wrong billing rate then asking
    // the Adecco reverse question. Both Adecco and アデコ forms must be present
    // so the LLM judge cannot bypass detection by switching brand spelling.
    expect(joined).toContain(
      "はい、大きくはその整理で合っています。来週水曜日までに初回候補をメールでいただけると助かります。ちなみに、アデコさんの派遣の特徴"
    );
    expect(joined).toContain(
      "はい、大きくはその整理で合っています。来週水曜日までに初回候補をメールでいただけると助かります。ちなみに、Adeccoさんの派遣の特徴"
    );
    // Hedging language failures
    expect(joined).toContain("だいたい合っていますが、単価だけ少し違うかもしれません");
    expect(joined).toContain("おおむね合っていますが、請求単価だけご確認ください");
    // Correction-then-immediate-reverse-question failures (manual orb v5 spec:
    // major correction must end the turn so the learner can absorb it).
    expect(joined).toContain("違います。請求単価は1,750から1,900円です。ちなみに、アデコさん");
    expect(joined).toContain("違います。請求は経験により1,750から1,900円程度です。Adeccoさんの強み");
  });

  it("Manual orb v11 P0: rendered prompt inlines filler ban directly at each 応答 line (so LLM sees it in maximum proximity to canonical answer)", () => {
    const md = renderDisclosureLedgerForPrompt();
    // Every triggerIntent's 応答 line should carry the inline filler ban.
    // Spot-check by counting occurrences of the inline-ban marker.
    const inlineBanMarker = "本題から直接始める";
    const occurrences = (md.match(new RegExp(inlineBanMarker, "g")) ?? []).length;
    // 21 triggers should each carry the inline ban.
    expect(occurrences, "inline filler ban must appear at each 応答 line").toBeGreaterThanOrEqual(20);
    // Spot-check the verbatim ban content
    expect(md).toContain("「承知しました。」");
    expect(md).toContain("「少し整理しますね。」");
    expect(md).toContain("「ありがとうございます。」");
    expect(md).toContain("前置きフィラーを **絶対に** 置かない");
  });

  it("Manual orb v3 DoD: rendered shallowGuards include anti-leak entries without exposing internal intent ids", () => {
    const md = renderDisclosureLedgerForPrompt();
    expect((md.match(/今回の回答では触れない情報/g) ?? []).length).toBeGreaterThanOrEqual(14);
    expect(md).toContain("要約合意文");
    expect(md).toContain("Adecco / アデコ 強み逆質問");
    expect(md).toContain("続けて出さない");
    expect(md).not.toContain("decision_structure");
    expect(md).not.toContain("team_atmosphere_question");
    expect(md).not.toContain("supervisor_personality_question");
  });

  it("requires every item to set doNotAdvanceLedgerAutomatically=true (no sequential reveal)", () => {
    for (const item of STAFFING_ADECCO_DISCLOSURE_LEDGER) {
      expect(item.doNotAdvanceLedgerAutomatically).toBe(true);
    }
  });

  it("populates all six required fields per item", () => {
    const requiredKeys: Array<keyof DisclosureItem> = [
      "triggerIntent",
      "intentDescription",
      "allowedAnswer",
      "forbiddenUntilAsked",
      "negativeExamples",
      "asrVariantTriggers",
    ];
    for (const item of STAFFING_ADECCO_DISCLOSURE_LEDGER) {
      for (const key of requiredKeys) {
        const value = item[key];
        if (Array.isArray(value)) {
          if (key === "forbiddenUntilAsked") {
            // closing_summary / coaching_request are allowed to be empty
            continue;
          }
          expect(value.length, `${item.triggerIntent}.${key}`).toBeGreaterThan(0);
        } else {
          expect(typeof value, `${item.triggerIntent}.${key}`).toBe("string");
          expect((value as string).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("forbids overview_shallow from leaking deeper-context facts", () => {
    const overview = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (item) => item.triggerIntent === "overview_shallow"
    );
    expect(overview).toBeDefined();
    expect(overview!.forbiddenUntilAsked).toEqual(
      expect.arrayContaining([
        "background_deep_vendor_reason",
        "competition",
        "commercial_terms",
        "decision_structure",
        "volume_cycle",
        "job_detail_tasks",
      ])
    );
  });

  it("only allows closing_summary to trigger the Adecco/アデコ reverse question", () => {
    const closing = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (item) => item.triggerIntent === "closing_summary"
    );
    expect(closing).toBeDefined();
    // Manual orb v4: katakana form is the runtime-preferred phrasing.
    expect(closing!.allowedAnswer).toContain("アデコさんの派遣の特徴や");

    // No other trigger's allowedAnswer may contain the reverse-question phrase
    // in EITHER the Adecco (英字) or アデコ (カタカナ) form.
    for (const item of STAFFING_ADECCO_DISCLOSURE_LEDGER) {
      if (item.triggerIntent === "closing_summary") continue;
      expect(item.allowedAnswer, item.triggerIntent).not.toContain(
        "Adeccoさんの派遣の特徴"
      );
      expect(item.allowedAnswer, item.triggerIntent).not.toContain(
        "アデコさんの派遣の特徴"
      );
    }
  });

  it("includes ASR-variant phrases for the competition trigger", () => {
    const competition = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (item) => item.triggerIntent === "competition"
    );
    expect(competition).toBeDefined();
    const variants = competition!.asrVariantTriggers.join(" / ");
    expect(variants).toContain("他社");
    expect(variants).toContain("並行");
    expect(variants).toContain("あいこう");
    expect(variants).toContain("Aコウ");
  });

  it("never mentions SAP / Oracle / ERP in any allowed answer or example", () => {
    const banned = /(SAP|エスエーピー|Oracle|オラクル|ERP|イーアールピー)/;
    for (const item of STAFFING_ADECCO_DISCLOSURE_LEDGER) {
      expect(item.allowedAnswer, item.triggerIntent).not.toMatch(banned);
      for (const example of item.negativeExamples) {
        expect(example, item.triggerIntent).not.toMatch(banned);
      }
    }
  });
});

describe("renderDisclosureLedgerForPrompt", () => {
  it("renders an intro that forbids sequential reveal", () => {
    const md = renderDisclosureLedgerForPrompt();
    expect(md).toContain("質問意図");
    expect(md).toContain("順送り");
    expect(md).toContain("各ターン独立");
    expect(md).toContain("先出ししない");
    expect(md).toContain("内部の台帳名");
    expect(md).not.toContain("triggerIntent");
    expect(md).not.toContain("doNotAdvanceLedgerAutomatically");
    expect(md).not.toContain("forbiddenUntilAsked");
  });

  it("renders every item as a sanitized H2 block with Japanese semantic label (manual orb v13)", () => {
    const md = renderDisclosureLedgerForPrompt();
    // Each H2 must now have the form `## 質問意図 N: <Japanese label>` to give
    // the LLM a semantic anchor for intent matching while keeping the English
    // triggerIntent ID hidden (defense-in-depth from v12 maintained).
    const blockCount = (md.match(/^## 質問意図 \d+: [^\n]+/gm) ?? []).length;
    expect(blockCount).toBe(STAFFING_ADECCO_DISCLOSURE_LEDGER.length);
    for (const item of STAFFING_ADECCO_DISCLOSURE_LEDGER) {
      expect(md).not.toContain(`## ${item.triggerIntent}`);
    }
    // Spot-check a few representative semantic labels are present.
    expect(md).toContain("## 質問意図 1: 役割確認");
    expect(md).toContain("## 質問意図 18: 部署環境 (人数・男女比・年齢層・服装)");
    expect(md).toContain("## 質問意図 21: コーチング要求");
  });

  it("does not render implementation field names in the live prompt", () => {
    const md = renderDisclosureLedgerForPrompt();
    expect(md).not.toContain("triggerIntent");
    expect(md).not.toContain("doNotAdvanceLedgerAutomatically");
    expect(md).not.toContain("forbiddenUntilAsked");
    expect(md).not.toContain("allowedAnswer");
    expect(md).not.toContain("team_atmosphere_question");
    expect(md).not.toContain("supervisor_personality_question");
    expect(md).not.toContain("応答ルール");
    expect(md).not.toContain("判定条件");
  });

  it("renders allowedAnswer as the directive '応答' line for every trigger (with manual orb v11 inline filler ban)", () => {
    const md = renderDisclosureLedgerForPrompt();
    for (const item of STAFFING_ADECCO_DISCLOSURE_LEDGER) {
      // Manual orb v11 P0: 応答 line now carries the inline filler ban suffix.
      // The exact rendered form is: "応答 (※ **本題から直接始める**…置かない): ${allowedAnswer}"
      expect(md).toContain(`置かない): ${item.allowedAnswer}`);
    }
  });
});
