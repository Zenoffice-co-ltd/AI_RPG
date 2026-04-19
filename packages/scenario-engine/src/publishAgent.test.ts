import { describe, expect, it, vi } from "vitest";
import type { ElevenLabsClient } from "@top-performer/vendors";
import { publishScenarioAgent } from "./publishAgent";

function createElevenLabsStub(): ElevenLabsClient {
  return {
    createKnowledgeBaseDocumentFromText: vi.fn().mockResolvedValue({
      id: "kb_123",
      name: "kb",
    }),
    createAgent: vi.fn().mockResolvedValue({
      agent_id: "agent_123",
    }),
    getAgent: vi.fn().mockResolvedValue({
      version_id: "version_123",
    }),
    listBranches: vi.fn().mockResolvedValue([
      {
        id: "branch_main",
        name: "main",
      },
      {
        id: "branch_staging",
        name: "staging",
      },
    ]),
    createBranch: vi.fn(),
    updateAgent: vi.fn().mockResolvedValue({
      version_id: "version_456",
    }),
    listTests: vi.fn().mockResolvedValue([]),
    createTest: vi.fn().mockImplementation((definition: { name?: string }) =>
      Promise.resolve(`test_${definition.name ?? "unknown"}`)
    ),
    updateTest: vi.fn(),
    runTests: vi.fn().mockResolvedValue({
      id: "invocation_123",
    }),
    getTestInvocation: vi.fn().mockResolvedValue({
      id: "invocation_123",
      test_runs: [
        {
          status: "passed",
          condition_result: { result: "success" },
        },
      ],
    }),
    mergeBranch: vi.fn().mockResolvedValue(undefined),
  } as unknown as ElevenLabsClient;
}

describe("publishScenarioAgent", () => {
  it("appends a pronunciation guide for system_prompt live comparison lanes", async () => {
    const elevenLabs = createElevenLabsStub();

    await publishScenarioAgent({
      elevenLabs,
      scenario: {
        id: "accounting_clerk_enterprise_ap_busy_manager_medium",
        title: "Accounting",
        version: "v1",
      } as never,
      assets: {
        knowledgeBaseText:
          "AP/支払、税区分、件数感、OracleやSAP等のERPを確認します。",
        agentSystemPrompt: "あなたは経理責任者です。",
        promptVersion: "v1",
        scenarioId: "accounting_clerk_enterprise_ap_busy_manager_medium",
        generatedAt: new Date().toISOString(),
      },
      llmModel: "gpt-5-mini",
      voiceSelection: {
        mode: "profile",
        scenarioId: "accounting_clerk_enterprise_ap_busy_manager_medium",
        voiceProfileId:
          "accounting_clerk_enterprise_ap_ja_v3_system_prompt_candidate_v1",
        label: "Accounting compare lane",
        language: "ja",
        ttsModel: "eleven_v3",
        voiceId: "voice_123",
        firstMessage: "よろしくお願いします。",
        textNormalisationType: "system_prompt",
        voiceSettings: {},
      },
    });

    expect(elevenLabs.updateAgent).toHaveBeenCalledWith(
      "agent_123",
      expect.objectContaining({
        prompt: expect.stringContaining("# Pronunciation Guide"),
      }),
      expect.any(Object)
    );
  });

  it("adds an Adecco-specific ending reverse-question ConvAI test", async () => {
    const elevenLabs = createElevenLabsStub();

    await publishScenarioAgent({
      elevenLabs,
      scenario: {
        id: "staffing_order_hearing_adecco_manufacturer_busy_manager_medium",
        title: "Adecco Manufacturer",
        version: "v1.0.0",
      } as never,
      assets: {
        knowledgeBaseText: "営業事務1名の初回派遣オーダーです。",
        agentSystemPrompt:
          "終盤で Adecco の派遣の特徴や強み、他社との違いを一度逆質問してください。",
        promptVersion: "v1",
        scenarioId: "staffing_order_hearing_adecco_manufacturer_busy_manager_medium",
        generatedAt: new Date().toISOString(),
      },
      llmModel: "gpt-5-mini",
      voiceSelection: {
        mode: "legacy",
        scenarioId: "staffing_order_hearing_adecco_manufacturer_busy_manager_medium",
        label: "Legacy default voice",
        language: "ja",
        ttsModel: "eleven_flash_v2_5",
        voiceId: "voice_123",
        firstMessage:
          "お時間ありがとうございます。今回は新しい派遣会社さんとして一度お話を伺いたいと思っています。",
        textNormalisationType: "elevenlabs",
        voiceSettings: {},
      },
    });

    expect(elevenLabs.createTest).toHaveBeenCalledTimes(11);
    expect(elevenLabs.createTest).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "staffing_order_hearing_adecco_manufacturer_busy_manager_medium::ending-adecco-strength-reverse-question",
        success_condition: expect.stringContaining("Adecco"),
      })
    );
    expect(elevenLabs.createTest).toHaveBeenCalledWith(
      expect.objectContaining({
        success_condition: expect.stringContaining("強み"),
      })
    );
    expect(elevenLabs.runTests).toHaveBeenCalledWith(
      "agent_123",
      expect.arrayContaining([
        "test_staffing_order_hearing_adecco_manufacturer_busy_manager_medium::ending-adecco-strength-reverse-question",
      ]),
      "branch_staging"
    );
  });

  it("keeps the prompt unchanged for elevenlabs live lanes", async () => {
    const elevenLabs = createElevenLabsStub();

    await publishScenarioAgent({
      elevenLabs,
      scenario: {
        id: "accounting_clerk_enterprise_ap_busy_manager_medium",
        title: "Accounting",
        version: "v1",
      } as never,
      assets: {
        knowledgeBaseText: "AP/支払、税区分を確認します。",
        agentSystemPrompt: "あなたは経理責任者です。",
        promptVersion: "v1",
        scenarioId: "accounting_clerk_enterprise_ap_busy_manager_medium",
        generatedAt: new Date().toISOString(),
      },
      llmModel: "gpt-5-mini",
      voiceSelection: {
        mode: "profile",
        scenarioId: "accounting_clerk_enterprise_ap_busy_manager_medium",
        voiceProfileId: "accounting_clerk_enterprise_ap_ja_v3_candidate_v1",
        label: "Accounting default lane",
        language: "ja",
        ttsModel: "eleven_v3",
        voiceId: "voice_123",
        firstMessage: "よろしくお願いします。",
        textNormalisationType: "elevenlabs",
        voiceSettings: {},
      },
    });

    expect(elevenLabs.updateAgent).toHaveBeenCalledWith(
      "agent_123",
      expect.objectContaining({
        prompt: "あなたは経理責任者です。",
      }),
      expect.any(Object)
    );
  });
});
