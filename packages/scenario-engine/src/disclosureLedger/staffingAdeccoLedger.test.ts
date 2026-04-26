import { describe, expect, it } from "vitest";
import {
  STAFFING_ADECCO_DISCLOSURE_LEDGER,
  renderDisclosureLedgerForPrompt,
  type DisclosureItem,
} from "./staffingAdeccoLedger";

describe("STAFFING_ADECCO_DISCLOSURE_LEDGER", () => {
  it("contains the 17 trigger intents required by DoD 1 + Auto-Gate Recovery", () => {
    const expectedTriggers = [
      "identity_self",
      "overview_shallow",
      "headcount_only",
      "background_shallow",
      "background_deep_vendor_reason",
      "job_shallow",
      "job_detail_tasks",
      "volume_cycle",
      "competition",
      "first_proposal_window",
      "decision_structure",
      "start_date_only",
      "urgency_or_submission_deadline",
      "commercial_terms",
      "next_step_close",
      "closing_summary",
      "coaching_request",
    ];
    expect(STAFFING_ADECCO_DISCLOSURE_LEDGER.map((item) => item.triggerIntent)).toEqual(
      expectedTriggers
    );
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
    expect(coaching!.intentDescription).toContain("next_step_close");
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
    expect(item!.intentDescription).toContain("decision_structure");
    expect(item!.intentDescription).toContain("当該 intent の allowedAnswer だけで応答を終え");
    // chat_history accumulation must NOT be a basis for firing
    expect(item!.intentDescription).toContain("chat_history");
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

  it("Manual orb v4 DoD: closing_summary allowedAnswer uses the TTS-friendly katakana アデコ form", () => {
    const item = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "closing_summary"
    );
    expect(item).toBeDefined();
    // The runtime utterance example must use アデコ (katakana) so TTS reads it as アデコ, not アデッコ
    expect(item!.allowedAnswer).toContain("アデコさんの派遣の特徴や");
    expect(item!.allowedAnswer).not.toContain("Adeccoさんの派遣の特徴や");
  });

  it("Manual orb v3 DoD: shallowGuards include anti-leak entries for deep intents (decision_structure / next_step_close / competition / commercial_terms / volume_cycle / first_proposal_window)", () => {
    const md = renderDisclosureLedgerForPrompt();
    // For each at-risk deep intent, the rendered Markdown must contain a 今の応答に含めない line
    // that explicitly forbids appending closing_summary content.
    const deepIntents = [
      "decision_structure",
      "next_step_close",
      "competition",
      "commercial_terms",
      "volume_cycle",
      "first_proposal_window",
    ];
    for (const intent of deepIntents) {
      // Each intent's H2 block must contain an anti-leak guard.
      // We assert the guard text mentions at least one of: 要約合意文 / Adecco 強み逆質問 / 続けて出さない.
      const blockStart = md.indexOf(`## ${intent}`);
      expect(blockStart, `## ${intent} block must exist`).toBeGreaterThan(-1);
      const nextBlockStart = md.indexOf("\n## ", blockStart + 1);
      const block = nextBlockStart === -1 ? md.slice(blockStart) : md.slice(blockStart, nextBlockStart);
      expect(block, `${intent} block must include 今の応答に含めない anti-leak line`).toContain("今の応答に含めない");
      expect(block, `${intent} guard must forbid Adecco reverse question or summary agreement leak`).toMatch(
        /(要約合意文|Adecco 強み逆質問|続けて出さない)/
      );
    }
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
    expect(md).toContain("doNotAdvanceLedgerAutomatically");
    expect(md).toContain("順送り");
    expect(md).toContain("各ターン独立");
    expect(md).toContain("forbiddenUntilAsked");
    // forbiddenUntilAsked semantics must be explained
    expect(md).toContain("先出ししない");
  });

  it("renders every trigger as an H2 block", () => {
    const md = renderDisclosureLedgerForPrompt();
    for (const item of STAFFING_ADECCO_DISCLOSURE_LEDGER) {
      expect(md).toContain(`## ${item.triggerIntent}`);
    }
  });

  it("renders the doNotAdvanceLedgerAutomatically literal in the intro", () => {
    const md = renderDisclosureLedgerForPrompt();
    expect(md).toContain("doNotAdvanceLedgerAutomatically: true");
  });

  it("renders allowedAnswer as the directive '応答' line for every trigger", () => {
    const md = renderDisclosureLedgerForPrompt();
    for (const item of STAFFING_ADECCO_DISCLOSURE_LEDGER) {
      expect(md).toContain(`応答: ${item.allowedAnswer}`);
    }
  });
});
