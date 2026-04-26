import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADECCO_MANUFACTURER_SCENARIO_ID } from "@top-performer/domain";
import { compileStaffingReferenceScenario } from "./compileStaffingReferenceScenario";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

describe("compileStaffingReferenceScenario", () => {
  it("maps the Adecco reference artifact into a staffing ScenarioPack", async () => {
    const referenceArtifactPath = resolve(
      repoRoot,
      "docs",
      "references",
      "adecco_manufacturer_order_hearing_reference.json"
    );

    const compiled = await compileStaffingReferenceScenario({
      referenceArtifactPath,
    });

    expect(compiled.scenario.id).toBe(ADECCO_MANUFACTURER_SCENARIO_ID);
    expect(compiled.scenario.family).toBe("staffing_order_hearing");
    expect(compiled.scenario.openingLine).toBe(
      "お時間ありがとうございます。今回は新しい派遣会社さんということで、まず弊社の状況をお伝えしながら、要件を整理いただければと思っています。進め方も含めて、確認いただいてもよろしいでしょうか。"
    );
    expect(compiled.scenario.publishContract?.dictionaryRequired).toBe(false);
    expect(compiled.scenario.rubric.map((item) => item.weight)).toEqual([
      30, 20, 20, 10, 10, 10,
    ]);
    expect(compiled.scenario.mustCaptureItems.map((item) => item.label)).toEqual(
      expect.arrayContaining([
        "募集背景",
        "業務内容・一日の流れ",
        "請求金額・交通費",
        "競合他社依頼状況",
        "具体的なネクストアクションと期日",
      ])
    );
    // ElevenLabs-recommended section structure (Personality / Tone / Guardrails ...)
    expect(compiled.assets.agentSystemPrompt).toContain("# Personality");
    expect(compiled.assets.agentSystemPrompt).toContain("# Tone and Response Style");
    expect(compiled.assets.agentSystemPrompt).toContain("# Critical Live Behavior");
    expect(compiled.assets.agentSystemPrompt).toContain("# Disclosure Ledger");
    // Manual orb v4: section heading carries dual-form Adecco / アデコ marker.
    expect(compiled.assets.agentSystemPrompt).toContain("# Adecco / アデコ Reverse Question Rule");
    expect(compiled.assets.agentSystemPrompt).toContain("# Silence and Ambiguity Handling");
    expect(compiled.assets.agentSystemPrompt).toContain("# 日本語の話し方");
    expect(compiled.assets.agentSystemPrompt).toContain(
      "1回に聞く質問は1つだけ"
    );
    expect(compiled.assets.agentSystemPrompt).toContain(
      "短い回答や列挙の直後に、沈黙確認の定型文を出さない"
    );
    expect(compiled.assets.agentSystemPrompt).toContain(
      "受発注の調整と在庫確認が中心ですね"
    );
    expect(compiled.assets.agentSystemPrompt).toContain("# Guardrails");
    // Reference Sections were removed in DoD recovery to avoid duplication
    expect(compiled.assets.agentSystemPrompt).not.toContain("# Reference Sections");

    // Persona / coaching prohibition retained (rephrased into new sections)
    expect(compiled.assets.agentSystemPrompt).toContain("ロープレコーチ");
    // Manual orb v4: katakana アデコ form is the runtime-preferred phrasing.
    // Adecco form is also retained in forbidden-utterance examples (rendered prompt forbids both forms).
    expect(compiled.assets.agentSystemPrompt).toContain("アデコさんの派遣の特徴");
    expect(compiled.assets.agentSystemPrompt).toContain("Adecco さんの派遣の特徴");
    expect(compiled.assets.agentSystemPrompt).toContain("千五百円から");

    // Disclosure Ledger trigger-intent ids must be embedded (not sequence-based)
    expect(compiled.assets.agentSystemPrompt).toContain("## overview_shallow");
    expect(compiled.assets.agentSystemPrompt).toContain("## closing_summary");
    expect(compiled.assets.agentSystemPrompt).toContain(
      "doNotAdvanceLedgerAutomatically: true"
    );

    // DoD 3.1 / 3.2 / 3.3: new triggers must be present
    expect(compiled.assets.agentSystemPrompt).toContain("## headcount_only");
    expect(compiled.assets.agentSystemPrompt).toContain("## next_step_close");
    expect(compiled.assets.agentSystemPrompt).toContain("## start_date_only");
    expect(compiled.assets.agentSystemPrompt).toContain(
      "## urgency_or_submission_deadline"
    );

    // English Critical Live Behavior emphasis must be present (DoD 4.1)
    expect(compiled.assets.agentSystemPrompt).toContain(
      "Answer only the user's current question"
    );

    // Anti-loop guardrails — manual orb v5 expanded the wording from
    // "通常応答では一切使いません" to "通常応答でも沈黙時でも一切使いません".
    expect(compiled.assets.agentSystemPrompt).toContain(
      "通常応答でも沈黙時でも一切使いません"
    );
    // Manual orb v7 P0: semantic equivalence rule must be embedded in rendered prompt
    expect(compiled.assets.agentSystemPrompt).toContain(
      "意味的に同じ表記揺れは『違います』訂正しない"
    );
    expect(compiled.assets.agentSystemPrompt).toContain("十七時半");
    expect(compiled.assets.agentSystemPrompt).toContain("半は 30 分の同義");
    // Manual orb v7 P1: AI must not initiate next_step_close on its own
    expect(compiled.assets.agentSystemPrompt).toContain(
      "AI から自発的に『次はどう進めますか』『どう進めましょうか』と質問しない"
    );
    // Manual orb v7 P1: backchannel utterances must not retrigger identity_self
    expect(compiled.assets.agentSystemPrompt).toContain(
      "短い相槌 (『うん』『はい』『えっと』『そうですね』 単独) を identity_self / overview_shallow の質問と誤判定しない"
    );
    // Manual orb v7 P1: do not repeat the same canonical answer twice
    expect(compiled.assets.agentSystemPrompt).toContain(
      "同じ応答を 2 回以上繰り返さない"
    );
    // Manual orb v7 P2: filler ban
    expect(compiled.assets.agentSystemPrompt).toContain("取りつくろいフィラー禁止");
    // Manual orb v9 P1: high-salience Response Opening Format section bans 承知しました prefix
    expect(compiled.assets.agentSystemPrompt).toContain(
      "# Response Opening Format"
    );
    expect(compiled.assets.agentSystemPrompt).toContain(
      "AI 応答の **最初の 1 文** に以下のフレーズを **絶対に置かない**"
    );
    expect(compiled.assets.agentSystemPrompt).toContain(
      "× 「**承知しました。少し整理しますね。** 指揮命令者の課長は...」"
    );
    expect(compiled.assets.agentSystemPrompt).toContain(
      "○ 「指揮命令者の課長は落ち着いていますが正確性に厳しい方です。"
    );
    expect(compiled.assets.agentSystemPrompt).toContain(
      "毎ターンの定型句として使わない"
    );
    expect(compiled.assets.agentSystemPrompt).toContain(
      "まだお話しになられていますでしょうか"
    );
    expect(compiled.assets.agentSystemPrompt).toContain("受発注、在庫確認");

    // Knowledge-base normalization stays intact
    expect(compiled.assets.knowledgeBaseText).toContain("千七百五十円から千九百円");
    expect(compiled.assets.knowledgeBaseText).not.toContain("1,750");
    expect(compiled.assets.knowledgeBaseText).not.toContain("8:45");
    expect(compiled.assets.knowledgeBaseText).toContain("早出し禁止");

    // SAP precondition must be fully removed (English + katakana)
    const banned = /(SAP|エスエーピー|Oracle|オラクル|ERP|イーアールピー)/;
    expect(compiled.assets.agentSystemPrompt).not.toMatch(banned);
    expect(compiled.assets.knowledgeBaseText).not.toMatch(banned);
  });
});
