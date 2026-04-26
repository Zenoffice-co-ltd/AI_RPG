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

  it("DoD 3.4: closing_summary detection matches multiple criteria, not only full numeric summary", () => {
    const item = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (i) => i.triggerIntent === "closing_summary"
    );
    expect(item).toBeDefined();
    // Description must enumerate multiple detection criteria so the LLM
    // judge does not require a single rigid pattern.
    expect(item!.intentDescription).toContain("整理させてください");
    expect(item!.intentDescription).toContain("まとめると");
    expect(item!.intentDescription).toContain("よろしいでしょうか");
    expect(item!.intentDescription).toContain("三項目以上");
    expect(item!.allowedAnswer).toContain("Adeccoさんの派遣の特徴や");
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

  it("only allows closing_summary to trigger the Adecco reverse question", () => {
    const closing = STAFFING_ADECCO_DISCLOSURE_LEDGER.find(
      (item) => item.triggerIntent === "closing_summary"
    );
    expect(closing).toBeDefined();
    expect(closing!.allowedAnswer).toContain("Adeccoさんの派遣の特徴や");

    for (const item of STAFFING_ADECCO_DISCLOSURE_LEDGER) {
      if (item.triggerIntent === "closing_summary") continue;
      expect(item.allowedAnswer, item.triggerIntent).not.toContain(
        "Adeccoさんの派遣の特徴"
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
