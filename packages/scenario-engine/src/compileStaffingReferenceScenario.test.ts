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
    expect(compiled.scenario.publishContract?.dictionaryRequired).toBe(false);
    expect(compiled.scenario.rubric.map((item) => item.weight)).toEqual([
      30, 20, 20, 10, 10, 10,
    ]);
    expect(compiled.scenario.mustCaptureItems.map((item) => item.label)).toEqual(
      expect.arrayContaining([
        "募集背景",
        "業務内容・1日の流れ",
        "請求金額・交通費",
        "競合他社依頼状況",
        "具体的なネクストアクションと期日",
      ])
    );
    expect(compiled.assets.agentSystemPrompt).toContain("営業をコーチしない");
    expect(compiled.assets.agentSystemPrompt).toContain("浅い質問には浅く返し");
    expect(compiled.assets.agentSystemPrompt).toContain("Adecco の派遣の特徴や強み");
    expect(compiled.assets.knowledgeBaseText).toContain("早出し禁止");
  });
});
