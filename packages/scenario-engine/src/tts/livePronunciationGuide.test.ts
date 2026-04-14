import { describe, expect, it } from "vitest";
import { buildLivePronunciationGuide } from "./livePronunciationGuide";

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
});
