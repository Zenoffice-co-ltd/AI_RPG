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
  it("sanitizes accounting live prompt and appends a pronunciation guide for system_prompt lanes", async () => {
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
          "- [required] [体制強化] と [内製強化] を確認します。AP/支払、税区分、件数感、OracleやSAP等のERPを確認します。",
        agentSystemPrompt: "あなたは[経理責任者]です。",
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
        turn: {
          turnTimeoutSeconds: 5,
          initialWaitTimeSeconds: 1,
          turnEagerness: "eager",
        },
        prompt: expect.stringContaining("# Live Delivery"),
      }),
      expect.any(Object)
    );
    expect(elevenLabs.updateAgent).toHaveBeenCalledWith(
      "agent_123",
      expect.objectContaining({
        prompt: expect.stringContaining("[slow]"),
      }),
      expect.any(Object)
    );
    expect(elevenLabs.updateAgent).toHaveBeenCalledWith(
      "agent_123",
      expect.objectContaining({
        prompt: expect.not.stringContaining("[経理責任者]"),
      }),
      expect.any(Object)
    );
    expect(elevenLabs.updateAgent).toHaveBeenCalledWith(
      "agent_123",
      expect.objectContaining({
        prompt: expect.stringContaining("# Pronunciation Guide"),
      }),
      expect.any(Object)
    );
    expect(elevenLabs.createKnowledgeBaseDocumentFromText).toHaveBeenCalledWith(
      "accounting_clerk_enterprise_ap_busy_manager_medium:v1",
      expect.not.stringContaining("[")
    );
  });

  it("keeps non-accounting live prompts unchanged", async () => {
    const elevenLabs = createElevenLabsStub();

    await publishScenarioAgent({
      elevenLabs,
      scenario: {
        id: "staffing_order_hearing_busy_manager_medium",
        title: "Staffing",
        version: "v1",
      } as never,
      assets: {
        knowledgeBaseText: "募集背景を確認します。",
        agentSystemPrompt: "あなたは採用責任者です。",
        promptVersion: "v1",
        scenarioId: "staffing_order_hearing_busy_manager_medium",
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
        prompt: "あなたは採用責任者です。",
      }),
      expect.any(Object)
    );
    expect(elevenLabs.updateAgent).toHaveBeenCalledWith(
      "agent_123",
      expect.not.objectContaining({
        turn: expect.anything(),
      }),
      expect.any(Object)
    );
    expect(elevenLabs.createKnowledgeBaseDocumentFromText).toHaveBeenCalledWith(
      "staffing_order_hearing_busy_manager_medium:v1",
      "募集背景を確認します。"
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

    // DoD v2: ElevenLabs only receives the 8 vendor smoke tests. The full
    // 22+ rich regression suite stays local. This is the single most
    // important change of the Auto Gate Recovery v2.
    expect(elevenLabs.createTest).toHaveBeenCalledTimes(8);
    expect(elevenLabs.updateAgent).toHaveBeenCalledWith(
      "agent_123",
      expect.objectContaining({
        turn: {
          turnTimeoutSeconds: 14,
          initialWaitTimeSeconds: 1,
          silenceEndCallTimeoutSeconds: -1,
          // Manual orb v7 P2 fix (2026-04-27): softTimeout removed because the
          // filler message ("承知しました。少し整理しますね。") was firing on
          // intermediate silence in production. Test must NOT include softTimeout.
          turnEagerness: "patient",
          spellingPatience: "auto",
          retranscribeOnTurnTimeout: true,
          mode: "turn",
        },
        conversation: {
          clientEvents: [
            "audio",
            "agent_response",
            "agent_response_correction",
            "agent_chat_response_part",
            "interruption",
            "user_transcript",
            "tentative_user_transcript",
            "internal_tentative_agent_response",
          ],
        },
        asr: {
          keywords: expect.arrayContaining(["アデコ", "受発注", "在庫確認"]),
        },
      }),
      expect.any(Object)
    );

    const vendorSmokeNames = [
      "opening-line",
      "headcount-only",
      "shallow-overview",
      "background-deep-followup",
      "next-step-close-safe",
      "sap-absence-safe",
      "no-coaching-safe",
      "closing-summary-simple",
    ];
    for (const tail of vendorSmokeNames) {
      expect(elevenLabs.createTest).toHaveBeenCalledWith(
        expect.objectContaining({
          name: `staffing_order_hearing_adecco_manufacturer_busy_manager_medium::${tail}`,
          type: "llm",
        })
      );
    }

    // Negative assertion: the rich multi-turn regression tests must NOT be
    // sent to ElevenLabs. They live solely in the local regression suite.
    const richOnlyNames = [
      "ending-adecco-strength-reverse-question",
      "one-turn-lag-regression",
      "background-depth-controlled-disclosure",
      "competitor-and-decision-depth-controlled-disclosure",
      "manual-test-script-fixture",
      "phrase-loop-regression",
      "asr-variant-robustness",
    ];
    for (const tail of richOnlyNames) {
      expect(elevenLabs.createTest).not.toHaveBeenCalledWith(
        expect.objectContaining({
          name: `staffing_order_hearing_adecco_manufacturer_busy_manager_medium::${tail}`,
        })
      );
    }

    // Vendor-smoke-specific content checks
    expect(elevenLabs.createTest).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "staffing_order_hearing_adecco_manufacturer_busy_manager_medium::closing-summary-simple",
        success_condition: expect.stringContaining("強み"),
      })
    );
    expect(elevenLabs.createTest).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "staffing_order_hearing_adecco_manufacturer_busy_manager_medium::sap-absence-safe",
        success_condition: expect.stringContaining("SAP"),
      })
    );
    expect(elevenLabs.createTest).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "staffing_order_hearing_adecco_manufacturer_busy_manager_medium::headcount-only",
        chat_history: expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining("人数"),
          }),
        ]),
      })
    );

    expect(elevenLabs.runTests).toHaveBeenCalledWith(
      "agent_123",
      expect.arrayContaining([
        "test_staffing_order_hearing_adecco_manufacturer_busy_manager_medium::opening-line",
        "test_staffing_order_hearing_adecco_manufacturer_busy_manager_medium::closing-summary-simple",
        "test_staffing_order_hearing_adecco_manufacturer_busy_manager_medium::sap-absence-safe",
      ]),
      "branch_staging"
    );
  });

  it("records canonical main branch separately from the tested staging branch", async () => {
    const elevenLabs = createElevenLabsStub();

    const result = await publishScenarioAgent({
      elevenLabs,
      scenario: {
        id: "staffing_order_hearing_adecco_manufacturer_busy_manager_medium",
        title: "Adecco Manufacturer",
        version: "v1.0.0",
      } as never,
      assets: {
        knowledgeBaseText: "営業事務1名の初回派遣オーダーです。",
        agentSystemPrompt: "prompt",
        promptVersion: "v1",
        scenarioId: "staffing_order_hearing_adecco_manufacturer_busy_manager_medium",
        generatedAt: new Date().toISOString(),
      },
      llmModel: "gpt-5-mini",
      voiceSelection: {
        mode: "profile",
        scenarioId: "staffing_order_hearing_adecco_manufacturer_busy_manager_medium",
        voiceProfileId: "staffing_order_hearing_adecco_manufacturer_ja_v3_candidate_v2",
        label: "Adecco v2",
        language: "ja",
        ttsModel: "eleven_v3",
        voiceId: "voice_123",
        firstMessage: "よろしくお願いします。",
        textNormalisationType: "elevenlabs",
        voiceSettings: {},
      },
    });

    expect(elevenLabs.mergeBranch).toHaveBeenCalledWith(
      "agent_123",
      "branch_staging",
      "branch_main"
    );
    expect(result.binding?.elevenBranchId).toBe("branch_main");
    expect(result).toMatchObject({
      testedBranchId: "branch_staging",
    });
  });

  it("DoD v2 §4: local regression bundle keeps the 22+ rich tests for offline assertion", async () => {
    const { __testing } = await import("./publishAgent");
    const fakeAdecco = {
      id: "staffing_order_hearing_adecco_manufacturer_busy_manager_medium",
      title: "Adecco",
      version: "v1.0.0",
    } as never;
    const local = __testing.buildAdeccoLocalRegressionDefinitions(fakeAdecco);
    const vendor = __testing.buildAdeccoVendorSmokeDefinitions(fakeAdecco);

    expect(local.length).toBeGreaterThanOrEqual(22);
    expect(vendor).toHaveLength(8);

    const localNames = local.map((t) => t.name);
    // Every rich regression must be present in the local bundle
    for (const tail of [
      "ending-adecco-strength-reverse-question",
      "one-turn-lag-regression",
      "phrase-loop-regression",
      "shallow-overview-no-hidden-leak",
      "background-depth-controlled-disclosure",
      "business-task-depth-controlled-disclosure",
      "competitor-and-decision-depth-controlled-disclosure",
      "manual-test-script-fixture",
      "asr-variant-robustness",
      "sap-absence",
      "no-coaching-strict",
      // Manual orb v12 P0: prompt structure verbalization ban
      "prompt-leak-no-trigger-intent-verbalization",
      // Manual orb v13 P0: silence + trailing-prompt + intent disambiguation
      "silence-no-coaching-fallback",
      "tone-no-trailing-prompt",
      "intent-disambiguation-overview-vs-atmosphere",
    ]) {
      expect(localNames).toContain(
        `staffing_order_hearing_adecco_manufacturer_busy_manager_medium::${tail}`
      );
    }

    // Vendor smoke names must NOT appear in the local pool (no double-count)
    const vendorNames = vendor.map((t) => t.name);
    const overlap = vendorNames.filter((n) => localNames.includes(n));
    expect(overlap).toEqual([]);
  });

  it("strips accounting bracket markup for elevenlabs lanes", async () => {
    const elevenLabs = createElevenLabsStub();

    await publishScenarioAgent({
      elevenLabs,
      scenario: {
        id: "accounting_clerk_enterprise_ap_busy_manager_medium",
        title: "Accounting",
        version: "v1",
      } as never,
      assets: {
        knowledgeBaseText: "今回は [1名] の募集で、背景は [体制強化] と [内製強化] です。",
        agentSystemPrompt: "あなたは [経理責任者] として話してください。",
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

    expect(elevenLabs.createKnowledgeBaseDocumentFromText).toHaveBeenCalledWith(
      "accounting_clerk_enterprise_ap_busy_manager_medium:v1",
      "今回は 1名 の募集で、背景は 体制強化 と 内製強化 です。"
    );
    expect(elevenLabs.updateAgent).toHaveBeenCalledWith(
      "agent_123",
      expect.objectContaining({
        prompt: expect.stringContaining("あなたは 経理責任者 として話してください。"),
      }),
      expect.any(Object)
    );
  });
});
