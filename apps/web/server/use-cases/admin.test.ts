import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompiledScenarioAssets, ScenarioPack } from "@top-performer/domain";

const {
  jobsUpsert,
  scenariosGet,
  scenariosGetAssets,
  scenariosUpsert,
  bindingGet,
  bindingUpsert,
  resolveVoiceId,
  writeGeneratedJson,
  resolveWorkspacePath,
  resolveMappedVoiceProfile,
  assertScenarioVoiceProfileAvailable,
  loadVoiceProfile,
  publishScenarioAgent,
  evaluateCompiledAccountingScenario,
  runAccountingLocalEval,
} = vi.hoisted(() => ({
  jobsUpsert: vi.fn(),
  scenariosGet: vi.fn(),
  scenariosGetAssets: vi.fn(),
  scenariosUpsert: vi.fn(),
  bindingGet: vi.fn(),
  bindingUpsert: vi.fn(),
  resolveVoiceId: vi.fn(),
  writeGeneratedJson: vi.fn(),
  resolveWorkspacePath: vi.fn((value: string) => value),
  resolveMappedVoiceProfile: vi.fn(),
  assertScenarioVoiceProfileAvailable: vi.fn(),
  loadVoiceProfile: vi.fn(),
  publishScenarioAgent: vi.fn(),
  evaluateCompiledAccountingScenario: vi.fn(),
  runAccountingLocalEval: vi.fn(),
}));

vi.mock("../appContext", () => ({
  getAppContext: () => ({
    env: {
      DEFAULT_ELEVEN_MODEL: "gpt-5-mini",
      DEFAULT_ELEVEN_VOICE_ID: "env_voice",
      OPENAI_ANALYSIS_MODEL: "gpt-5.4",
    },
    repositories: {
      jobs: {
        upsert: jobsUpsert,
      },
      scenarios: {
        get: scenariosGet,
        getAssets: scenariosGetAssets,
        upsert: scenariosUpsert,
      },
      agentBindings: {
        get: bindingGet,
        upsert: bindingUpsert,
      },
    },
    vendors: {
      elevenLabs: {
        resolveVoiceId,
      },
      openAi: {},
    },
  }),
}));

vi.mock("../workspace", () => ({
  writeGeneratedJson,
  resolveWorkspacePath,
}));

vi.mock("@top-performer/scenario-engine", () => ({
  aggregatePlaybook: vi.fn(),
  buildLegacyVoiceSelection: vi.fn((input) => ({
    mode: "legacy",
    scenarioId: input.scenarioId,
    label: "Legacy default voice",
    language: "ja",
    ttsModel: "eleven_flash_v2_5",
    voiceId: input.resolvedVoiceId,
    firstMessage: input.scenarioOpeningLine,
    textNormalisationType: "elevenlabs",
    voiceSettings: {},
  })),
  buildProfileVoiceSelection: vi.fn((input) => ({
    mode: "profile",
    scenarioId: input.scenarioId,
    voiceProfileId: input.profile.id,
    label: input.profile.label,
    language: input.profile.language,
    ttsModel: input.profile.model,
    voiceId: input.resolvedVoiceId,
    firstMessage: input.profile.firstMessageJa ?? input.scenarioOpeningLine,
    textNormalisationType: input.profile.textNormalisationType,
    voiceSettings: input.profile.voiceSettings,
  })),
  compileScenarios: vi.fn(),
  assertScenarioVoiceProfileAvailable,
  evaluateCompiledAccountingScenario,
  importTranscriptsFromDirectory: vi.fn(),
  loadVoiceProfile,
  mineTranscriptBehaviors: vi.fn(),
  publishScenarioAgent,
  resolveMappedVoiceProfile,
  runAccountingLocalEval,
}));

import { publishScenarioJob } from "./admin";

function createScenario(
  overrides: Partial<ScenarioPack> = {}
): ScenarioPack {
  return {
    id: "staffing_order_hearing_busy_manager_medium",
    family: "staffing_order_hearing",
    version: "v1",
    title: "忙しい現場責任者",
    language: "ja",
    difficulty: "medium",
    persona: {
      role: "物流センター責任者",
      companyAlias: "Company_B",
      demeanor: "busy",
      responseStyle: "要点だけを短く返す。",
    },
    publicBrief: "brief",
    hiddenFacts: ["fact"],
    revealRules: [
      {
        trigger: "trigger",
        reveals: ["fact"],
      },
    ],
    mustCaptureItems: [
      {
        key: "opening",
        label: "導入",
        priority: "required",
        canonicalOrder: 0,
      },
    ],
    rubric: [
      {
        key: "coverage",
        label: "Coverage",
        weight: 1,
        description: "desc",
      },
    ],
    closeCriteria: ["close"],
    openingLine: "時間がありません。",
    generatedFromPlaybookVersion: "pb_v1",
    status: "draft",
    ...overrides,
  };
}

function createAssets(
  overrides: Partial<CompiledScenarioAssets> = {}
): CompiledScenarioAssets {
  return {
    scenarioId: "staffing_order_hearing_busy_manager_medium",
    promptVersion: "v1",
    knowledgeBaseText: "kb",
    agentSystemPrompt: "prompt",
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("publishScenarioJob", () => {
  beforeEach(() => {
    jobsUpsert.mockReset();
    scenariosGet.mockReset();
    scenariosGetAssets.mockReset();
    scenariosUpsert.mockReset();
    bindingGet.mockReset();
    bindingUpsert.mockReset();
    resolveVoiceId.mockReset();
    writeGeneratedJson.mockReset();
    resolveMappedVoiceProfile.mockReset();
    loadVoiceProfile.mockReset();
    publishScenarioAgent.mockReset();
    evaluateCompiledAccountingScenario.mockReset();
    runAccountingLocalEval.mockReset();

    scenariosGet.mockResolvedValue(createScenario());
    scenariosGetAssets.mockResolvedValue(createAssets());
    bindingGet.mockResolvedValue(null);
    writeGeneratedJson.mockResolvedValue(undefined);
    assertScenarioVoiceProfileAvailable.mockReset();
    evaluateCompiledAccountingScenario.mockResolvedValue({
      semanticAcceptancePassed: true,
    });
    runAccountingLocalEval.mockResolvedValue({
      passed: true,
      checks: [],
    });
    publishScenarioAgent.mockResolvedValue({
      passed: true,
      binding: {
        scenarioId: "staffing_order_hearing_busy_manager_medium",
        elevenAgentId: "agent_123",
        elevenBranchId: "branch_123",
        elevenVersionId: "version_123",
        voiceId: "voice_resolved",
        publishedAt: new Date().toISOString(),
      },
    });
    assertScenarioVoiceProfileAvailable.mockImplementation((input) => input.profile);
    loadVoiceProfile.mockResolvedValue({
      id: "accounting_clerk_enterprise_ap_ja_v3_system_prompt_candidate_v1",
      label: "Accounting Clerk Enterprise AP JA V3 System Prompt Candidate v1",
      language: "ja",
      model: "eleven_v3",
      voiceId: "profile_voice",
      firstMessageJa: "よろしくお願いします。",
      textNormalisationType: "system_prompt",
      voiceSettings: {},
      metadata: {
        scenarioIds: ["accounting_clerk_enterprise_ap_busy_manager_medium"],
        benchmarkStatus: "candidate",
      },
    });
  });

  it("uses the mapped voice profile when one exists", async () => {
    resolveMappedVoiceProfile.mockResolvedValue({
      id: "busy_manager_ja_baseline_v1",
      label: "Busy Manager JA Baseline v1",
      language: "ja",
      model: "eleven_flash_v2_5",
      voiceId: "profile_voice",
      firstMessageJa: "よろしくお願いします。",
      textNormalisationType: "elevenlabs",
      voiceSettings: {},
    });
    resolveVoiceId.mockResolvedValue({
      voiceId: "voice_resolved",
      voiceName: "Resolved Voice",
      resolution: "preferred",
    });

    const result = await publishScenarioJob({
      scenarioId: "staffing_order_hearing_busy_manager_medium",
    });

    expect(resolveVoiceId).toHaveBeenCalledWith("profile_voice", "ja");
    expect(publishScenarioAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        llmModel: "gpt-5-mini",
        voiceSelection: expect.objectContaining({
          mode: "profile",
          voiceProfileId: "busy_manager_ja_baseline_v1",
          voiceId: "voice_resolved",
        }),
      })
    );
    expect(result.voiceSelection.voiceProfileId).toBe("busy_manager_ja_baseline_v1");
    expect(bindingUpsert).toHaveBeenCalled();
  });

  it("falls back to the legacy voice path when no mapping exists", async () => {
    resolveMappedVoiceProfile.mockResolvedValue(null);
    resolveVoiceId.mockResolvedValue({
      voiceId: "voice_fallback",
      voiceName: "Fallback Voice",
      resolution: "auto",
    });

    const result = await publishScenarioJob({
      scenarioId: "staffing_order_hearing_busy_manager_medium",
    });

    expect(resolveVoiceId).toHaveBeenCalledWith("env_voice", "ja");
    expect(publishScenarioAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceSelection: expect.objectContaining({
          mode: "legacy",
          voiceId: "voice_fallback",
        }),
      })
    );
    expect(result.voiceSelection.mode).toBe("legacy");
  });

  it("runs the accounting local eval gate before blocking publish without an active mapping", async () => {
    scenariosGet.mockResolvedValue(
      createScenario({
        id: "accounting_clerk_enterprise_ap_busy_manager_medium",
        family: "accounting_clerk_enterprise_ap",
        publishContract: {
          runtimeVariables: [],
          dictionaryRequired: true,
        },
      })
    );
    scenariosGetAssets.mockResolvedValue(
      createAssets({
        scenarioId: "accounting_clerk_enterprise_ap_busy_manager_medium",
      })
    );
    resolveMappedVoiceProfile.mockResolvedValue(null);
    assertScenarioVoiceProfileAvailable.mockImplementation(() => {
      throw new Error(
        "Scenario accounting_clerk_enterprise_ap_busy_manager_medium requires a mapped voice profile for publish."
      );
    });

    await expect(
      publishScenarioJob({
        scenarioId: "accounting_clerk_enterprise_ap_busy_manager_medium",
      })
    ).rejects.toThrow("requires a mapped voice profile for publish");

    expect(evaluateCompiledAccountingScenario).toHaveBeenCalled();
    expect(runAccountingLocalEval).toHaveBeenCalled();
    expect(writeGeneratedJson).toHaveBeenCalledWith(
      "publish/accounting_clerk_enterprise_ap_busy_manager_medium.local-eval.json",
      expect.objectContaining({
        acceptance: expect.objectContaining({
          semanticAcceptancePassed: true,
        }),
        localEval: expect.objectContaining({
          passed: true,
        }),
      })
    );
    expect(resolveVoiceId).not.toHaveBeenCalled();
  });

  it("allows an explicit voice profile override for live comparison without changing active mapping", async () => {
    scenariosGet.mockResolvedValue(
      createScenario({
        id: "accounting_clerk_enterprise_ap_busy_manager_medium",
        family: "accounting_clerk_enterprise_ap",
        publishContract: {
          runtimeVariables: [],
          dictionaryRequired: true,
        },
      })
    );
    scenariosGetAssets.mockResolvedValue(
      createAssets({
        scenarioId: "accounting_clerk_enterprise_ap_busy_manager_medium",
      })
    );
    resolveMappedVoiceProfile.mockResolvedValue(null);
    resolveVoiceId.mockResolvedValue({
      voiceId: "voice_resolved",
      voiceName: "Resolved Voice",
      resolution: "preferred",
    });

    const result = await publishScenarioJob({
      scenarioId: "accounting_clerk_enterprise_ap_busy_manager_medium",
      voiceProfileId: "accounting_clerk_enterprise_ap_ja_v3_system_prompt_candidate_v1",
    });

    expect(loadVoiceProfile).toHaveBeenCalledWith(
      "accounting_clerk_enterprise_ap_ja_v3_system_prompt_candidate_v1"
    );
    expect(resolveMappedVoiceProfile).not.toHaveBeenCalled();
    expect(resolveVoiceId).toHaveBeenCalledWith("profile_voice", "ja");
    expect(publishScenarioAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceSelection: expect.objectContaining({
          mode: "profile",
          voiceProfileId:
            "accounting_clerk_enterprise_ap_ja_v3_system_prompt_candidate_v1",
          textNormalisationType: "system_prompt",
        }),
      })
    );
    expect(result.voiceSelection.selectionSource).toBe("override");
  });

  it("rejects an explicit voice profile override that targets another scenario", async () => {
    loadVoiceProfile.mockResolvedValue({
      id: "busy_manager_ja_baseline_v1",
      label: "Busy Manager JA Baseline v1",
      language: "ja",
      model: "eleven_flash_v2_5",
      voiceId: "profile_voice",
      firstMessageJa: "よろしくお願いします。",
      textNormalisationType: "elevenlabs",
      voiceSettings: {},
      metadata: {
        scenarioIds: ["staffing_order_hearing_busy_manager_medium"],
        benchmarkStatus: "candidate",
      },
    });

    await expect(
      publishScenarioJob({
        scenarioId: "accounting_clerk_enterprise_ap_busy_manager_medium",
        voiceProfileId: "busy_manager_ja_baseline_v1",
      })
    ).rejects.toThrow(
      "Voice profile busy_manager_ja_baseline_v1 does not support scenario accounting_clerk_enterprise_ap_busy_manager_medium."
    );
  });
});
