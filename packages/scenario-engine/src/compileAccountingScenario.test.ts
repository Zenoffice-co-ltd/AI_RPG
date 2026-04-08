import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileAccountingScenarioFromReference } from "./compileAccountingScenario";

describe("compileAccountingScenarioFromReference", () => {
  it("maps the reference artifact into v2 and legacy scenario packs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "acct-scenario-"));
    const referencePath = join(dir, "reference.json");
    await writeFile(
      referencePath,
      JSON.stringify(
        {
          meta: { createdAt: "2026-04-07" },
          phase4: {
            scenarioPack: {
              scenarioId: "accounting_clerk_enterprise_ap_busy_manager_medium",
              version: "v1.0.0",
              title: "経理事務 AP",
              roleCategory: "経理事務",
              cooperationStyle: "busy",
              difficulty: "medium",
              setting: {
                industry: "製薬",
                companyScale: "enterprise",
                requestBackground: "ERP移行に伴う体制強化",
              },
              sipoc: {
                id: "sipoc_v1",
                roleCategory: "経理事務",
                suppliers: ["各部門"],
                inputs: ["請求書"],
                process: ["支払処理"],
                outputs: ["支払依頼"],
                customers: ["経理財務部マネジャー"],
                evidence: [{ transcriptId: "sheet1_row_155", confidence: 0.9 }],
              },
              cultureFit: {
                id: "culture_v1",
                roleCategory: "経理事務",
                handoffStructure: "partial",
                workplaceAtmosphere: ["ベテラン比率が高い"],
                difficultySignals: ["ERP移行"],
                implicitNorms: ["プロセス遵守"],
                riskSignals: ["管理だけしたい人はミスマッチ"],
                evidence: [{ transcriptId: "sheet1_row_155", confidence: 0.9 }],
              },
              persona: {
                summary: "忙しいが高圧ではなく、浅い質問には浅く返す。",
              },
              publicBrief: "支払・経費精算寄りの人材を探している。",
              hiddenFacts: [{ key: "background", value: "ERP移行が真因。" }],
              revealRules: [
                {
                  trigger: "背景を深掘りされた時",
                  behavior: "ERP移行と既存負荷集中を開示する。",
                },
              ],
              topPerformerPlaybook: [
                {
                  stage: "discovery",
                  preferredQuestionAngles: ["背景の真因"],
                  followupPatterns: ["なぜ今か"],
                  signalsToLookFor: ["表向き理由と真因のズレ"],
                },
              ],
              mustCaptureItems: [
                {
                  key: "true_hiring_background",
                  description: "真因まで確認する",
                  scoringWeight: 10,
                },
              ],
              openingLine: "要点だけでお願いします。",
              closeCriteria: ["候補者像を要約できている"],
              scoringRubric: {
                metrics: [
                  {
                    key: "required_questions",
                    label: "必須論点の確認",
                    description: "必須論点を確認したか",
                    weight: 25,
                  },
                ],
              },
              publish: {
                systemPromptSections: {
                  "Conversation Policy": "浅い質問には浅く返す。",
                },
                runtimeVariables: ["learnerDisplayName"],
              },
              provenance: {
                transcriptIds: ["sheet1_row_66"],
              },
            }
          },
        },
        null,
        2
      ),
      "utf8"
    );

    const compiled = await compileAccountingScenarioFromReference({ referencePath });
    expect(compiled.scenario.id).toBe("accounting_clerk_enterprise_ap_busy_manager_medium");
    expect(compiled.scenario.family).toBe("accounting_clerk_enterprise_ap");
    expect(compiled.scenarioV2.mustCapture).toHaveLength(1);
    expect(compiled.acceptance.hiddenFactCoverage).toBe(true);
    expect(compiled.assets.agentSystemPrompt).toContain("Conversation Policy");
  });
});
