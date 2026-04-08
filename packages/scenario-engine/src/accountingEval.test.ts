import { describe, expect, it, vi } from "vitest";
import type { CompiledScenarioAssets, ScenarioPack } from "@top-performer/domain";
import { runAccountingLocalEval } from "./accountingEval";

function createScenario(
  overrides: Partial<ScenarioPack> = {}
): ScenarioPack {
  return {
    id: "accounting_clerk_enterprise_ap_busy_manager_medium",
    family: "accounting_clerk_enterprise_ap",
    version: "v1",
    title: "経理事務 AP 忙しい現場責任者",
    language: "ja",
    difficulty: "medium",
    persona: {
      role: "経理財務部マネジャー",
      companyAlias: "Enterprise_Group_Co",
      demeanor: "busy",
      responseStyle: "忙しいが高圧ではなく、浅い質問には浅く返す。",
    },
    publicBrief: "体制強化を背景に経理事務を1名募集している。",
    hiddenFacts: [
      "ERP移行と通常運用の二重負荷がある。",
      "単価や働き方には一部相談余地がある。",
      "決裁は部門長承認が必要。",
    ],
    revealRules: [
      { trigger: "背景深掘り", reveals: ["ERP移行と通常運用の二重負荷"] },
      { trigger: "条件確認", reveals: ["単価や働き方には一部相談余地"] },
      { trigger: "決裁確認", reveals: ["決裁は部門長承認"] },
    ],
    mustCaptureItems: [
      { key: "true_hiring_background", label: "背景の真因", priority: "required", canonicalOrder: 0 },
      { key: "scope_split", label: "業務範囲", priority: "required", canonicalOrder: 1 },
      { key: "judgement_level", label: "判断レベル", priority: "required", canonicalOrder: 2 },
      { key: "team_structure", label: "体制", priority: "required", canonicalOrder: 3 },
      { key: "internal_external_split", label: "内外分担", priority: "required", canonicalOrder: 4 },
      { key: "volume_and_peaks", label: "繁忙", priority: "required", canonicalOrder: 5 },
      { key: "system_environment", label: "システム", priority: "required", canonicalOrder: 6 },
      { key: "onboarding_and_manual", label: "立ち上がり", priority: "required", canonicalOrder: 7 },
    ],
    rubric: [
      { key: "required_questions", label: "必須論点の確認", weight: 0.25, description: "desc" },
      { key: "deep_dive_quality", label: "深掘り品質", weight: 0.2, description: "desc" },
    ],
    closeCriteria: ["次回候補者提案条件の合意"],
    openingLine: "お時間限られているので、要点だけでお願いします。",
    generatedFromPlaybookVersion: "pb_accounting_v2",
    status: "draft",
    provenance: {
      corpusId: "enterprise_accounting_ap_gold_v1",
      transcriptIds: ["sheet1_row_66"],
    },
    promptSections: [
      { key: "persona", title: "Persona", body: "忙しいが高圧ではありません。浅い質問には浅い回答しかしません。" },
      { key: "conversation_policy", title: "Conversation Policy", body: "聞かれた範囲で答え、hidden fact は段階的に出してください。" },
      { key: "guardrails", title: "Guardrails", body: "コーチしないでください。hidden facts を早出ししないでください。" },
      { key: "hidden_facts", title: "Hidden Facts", body: "ERP移行と通常運用の二重負荷、単価や働き方の相談余地、決裁は部門長承認。" },
      { key: "reveal_rules", title: "Reveal Rules", body: "深掘りや条件確認、決裁確認時にのみ詳細を開示してください。" },
      { key: "closing", title: "Closing", body: "十分なヒアリングがあれば自然な next action で締めてください。" },
    ],
    ...overrides,
  };
}

function createAssets(
  overrides: Partial<CompiledScenarioAssets> = {}
): CompiledScenarioAssets {
  return {
    scenarioId: "accounting_clerk_enterprise_ap_busy_manager_medium",
    promptVersion: "accounting-compile@2026-04-08.v1",
    knowledgeBaseText: "kb",
    agentSystemPrompt: [
      "# Persona",
      "忙しいが高圧ではありません。浅い質問には浅い回答しかしません。",
      "# Conversation Policy",
      "聞かれた範囲で答え、hidden fact は段階的に出してください。",
      "# Guardrails",
      "コーチしないでください。hidden facts を早出ししないでください。",
      "# Closing",
      "十分なヒアリングがあれば自然な next action で締めてください。",
    ].join("\n"),
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("runAccountingLocalEval", () => {
  it("combines rule-based and llm-based checks", async () => {
    const client = {
      createStructuredOutput: vi.fn().mockResolvedValue({
        evaluations: [
          {
            key: "natural_japanese",
            method: "llm_based",
            passed: true,
            notes: "自然なビジネス日本語です。",
          },
          {
            key: "busy_but_not_hostile",
            method: "llm_based",
            passed: true,
            notes: "忙しいが高圧ではありません。",
          },
          {
            key: "no_coaching",
            method: "llm_based",
            passed: true,
            notes: "コーチングに逸脱していません。",
          },
          {
            key: "close_quality",
            method: "llm_based",
            passed: true,
            notes: "自然な next action で締めています。",
          },
          {
            key: "captures_culture_fit",
            method: "llm_based",
            passed: true,
            notes: "カルチャー観点を保持しています。",
          },
          {
            key: "captures_judgement_work",
            method: "llm_based",
            passed: true,
            notes: "判断業務観点を保持しています。",
          },
        ],
        summary: "local eval passed",
      }),
    } as const;

    const report = await runAccountingLocalEval({
      client: client as never,
      model: "gpt-5.4",
      scenario: createScenario(),
      assets: createAssets(),
    });

    expect(report.passed).toBe(true);
    expect(report.checks).toHaveLength(11);
    expect(report.semanticAcceptance.requiredFieldPresence).toBe(true);
  });

  it("fails when hidden facts leak into public sections", async () => {
    const client = {
      createStructuredOutput: vi.fn().mockResolvedValue({
        evaluations: [
          {
            key: "natural_japanese",
            method: "llm_based",
            passed: true,
            notes: "ok",
          },
          {
            key: "busy_but_not_hostile",
            method: "llm_based",
            passed: true,
            notes: "ok",
          },
          {
            key: "no_coaching",
            method: "llm_based",
            passed: true,
            notes: "ok",
          },
          {
            key: "close_quality",
            method: "llm_based",
            passed: true,
            notes: "ok",
          },
          {
            key: "captures_culture_fit",
            method: "llm_based",
            passed: true,
            notes: "ok",
          },
          {
            key: "captures_judgement_work",
            method: "llm_based",
            passed: true,
            notes: "ok",
          },
        ],
        summary: "local eval failed",
      }),
    } as const;

    const report = await runAccountingLocalEval({
      client: client as never,
      model: "gpt-5.4",
      scenario: createScenario({
        publicBrief: "ERP移行と通常運用の二重負荷がある案件です。",
      }),
      assets: createAssets(),
    });

    expect(report.passed).toBe(false);
    expect(
      report.checks.find((item) => item.key === "no_hidden_fact_leak")?.passed
    ).toBe(false);
  });
});
