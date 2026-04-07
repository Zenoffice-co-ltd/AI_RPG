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
  resolveMappedVoiceProfile,
  publishScenarioAgent,
} = vi.hoisted(() => ({
  jobsUpsert: vi.fn(),
  scenariosGet: vi.fn(),
  scenariosGetAssets: vi.fn(),
  scenariosUpsert: vi.fn(),
  bindingGet: vi.fn(),
  bindingUpsert: vi.fn(),
  resolveVoiceId: vi.fn(),
  writeGeneratedJson: vi.fn(),
  resolveMappedVoiceProfile: vi.fn(),
  publishScenarioAgent: vi.fn(),
}));

vi.mock("../appContext", () => ({
  getAppContext: () => ({
    env: {
      DEFAULT_ELEVEN_MODEL: "gpt-5-mini",
      DEFAULT_ELEVEN_VOICE_ID: "env_voice",
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
    },
  }),
}));

vi.mock("../workspace", () => ({
  writeGeneratedJson,
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
  importTranscriptsFromDirectory: vi.fn(),
  mineTranscriptBehaviors: vi.fn(),
  publishScenarioAgent,
  resolveMappedVoiceProfile,
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
    publishScenarioAgent.mockReset();

    scenariosGet.mockResolvedValue(createScenario());
    scenariosGetAssets.mockResolvedValue(createAssets());
    bindingGet.mockResolvedValue(null);
    writeGeneratedJson.mockResolvedValue(undefined);
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
});
