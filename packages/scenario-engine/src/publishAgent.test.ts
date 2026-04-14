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
    createTest: vi
      .fn()
      .mockResolvedValueOnce("test_1")
      .mockResolvedValueOnce("test_2")
      .mockResolvedValueOnce("test_3")
      .mockResolvedValueOnce("test_4")
      .mockResolvedValueOnce("test_5")
      .mockResolvedValueOnce("test_6")
      .mockResolvedValueOnce("test_7")
      .mockResolvedValueOnce("test_8")
      .mockResolvedValueOnce("test_9")
      .mockResolvedValueOnce("test_10"),
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
