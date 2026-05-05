import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLivePronunciationGuide } from "./livePronunciationGuide";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("buildLivePronunciationGuide", () => {
  it("returns an empty guide for elevenlabs normalization mode", async () => {
    await expect(
      buildLivePronunciationGuide({
        scenarioId: "accounting_clerk_enterprise_ap_busy_manager_medium",
        textNormalisationType: "elevenlabs",
        referenceTexts: ["AP/支払の体制を確認します。"],
      })
    ).resolves.toBe("");
  });

  it("falls back to the staffing PLS for nested adecco-manufacturer scenarios (incl. _v21)", async () => {
    const guide = await buildLivePronunciationGuide({
      scenarioId:
        "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v21",
      textNormalisationType: "system_prompt",
      referenceTexts: [
        "受発注、納期調整、職場見学、品番、施工日、CP、SK、SAPまわりの確認をします。",
      ],
    });

    expect(guide).toContain("# Pronunciation Guide");
    expect(guide).toContain("「受発注」");
    expect(guide).toContain("ジュハッチュウ");
    expect(guide).toContain("「職場見学」");
    expect(guide).toContain("「施工日」");
    expect(guide).toContain("「CP」");
    expect(guide).toContain("「SK」");
  });

  it("includes v2.1 quality-patch lexemes (見積もり補助 / 時刻表現 / 施工日に合わせて) when referenced", async () => {
    const guide = await buildLivePronunciationGuide({
      scenarioId:
        "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v21",
      textNormalisationType: "system_prompt",
      referenceTexts: [
        "見積もり補助も付随します。施工日に合わせて調整する必要があります。平日は朝八時四十五分から夕方五時三十分です。",
      ],
    });

    expect(guide).toContain("「見積もり補助」");
    expect(guide).toContain("ミツモリホジョ");
    expect(guide).toContain("「施工日に合わせて」");
    expect(guide).toContain("セコウビニアワセテ");
    expect(guide).toContain("「夕方五時三十分」");
    expect(guide).toContain("ユウガタゴジサンジュップン");
    expect(guide).toContain("「朝八時四十五分」");
    expect(guide).toContain("アサハチジヨンジュウゴフン");
  });

  it("builds an accounting pronunciation guide from the local PLS for system_prompt mode", async () => {
    const guide = await buildLivePronunciationGuide({
      scenarioId: "accounting_clerk_enterprise_ap_busy_manager_medium",
      textNormalisationType: "system_prompt",
      referenceTexts: [
        "AP/支払、税区分、件数感、OracleやSAP等のERPを確認します。",
        "立ち上がりの出社前提や在宅可否も見ます。",
      ],
    });

    expect(guide).toContain("# Pronunciation Guide");
    expect(guide).toContain("「AP」");
    expect(guide).toContain("「税区分」");
    expect(guide).toContain("「件数感」");
    expect(guide).toContain("「Oracle」");
    expect(guide).toContain("「ERP」");
    expect(guide).toContain("自然な区切り");
  });

  it("keeps critical staffing lexemes with maxEntries=80 regression coverage", async () => {
    const assets = JSON.parse(
      await readFile(
        resolve(
          REPO_ROOT,
          "data/generated/scenarios/staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v21.assets.json"
        ),
        "utf8"
      )
    ) as { agentSystemPrompt: string; knowledgeBaseText: string };
    const guide = await buildLivePronunciationGuide({
      scenarioId:
        "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v21",
      textNormalisationType: "system_prompt",
      referenceTexts: [assets.agentSystemPrompt, assets.knowledgeBaseText],
      maxEntries: 80,
    });
    const critical = [
      "受発注",
      "受発注入力",
      "受発注業務",
      "受発注経験",
      "人事",
      "人事課",
      "人事課主任",
      "人事窓口",
      "人事主導",
      "品番",
      "型番",
      "施工日",
      "納期調整",
      "代理店",
      "工務店",
      "アデコ",
    ];
    for (const term of critical) {
      expect(guide, `${term} dropped from maxEntries=80 guide`).toContain(
        `「${term}」`
      );
    }
  });
});
