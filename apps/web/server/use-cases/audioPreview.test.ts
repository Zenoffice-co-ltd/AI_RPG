import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  scenariosGet,
  resolveVoiceId,
  renderSpeech,
  resolveMappedVoiceProfile,
} = vi.hoisted(() => ({
  scenariosGet: vi.fn(),
  resolveVoiceId: vi.fn(),
  renderSpeech: vi.fn(),
  resolveMappedVoiceProfile: vi.fn(),
}));

vi.mock("../appContext", () => ({
  getAppContext: () => ({
    env: {
      DEFAULT_ELEVEN_VOICE_ID: "env_voice",
    },
    repositories: {
      scenarios: {
        get: scenariosGet,
      },
    },
    vendors: {
      elevenLabs: {
        resolveVoiceId,
        renderSpeech,
      },
    },
  }),
}));

vi.mock("@top-performer/scenario-engine", () => ({
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
    pronunciationDictionaryLocators: input.profile.pronunciationDictionaryLocators,
  })),
  resolveMappedVoiceProfile,
}));

import {
  getScenarioAudioPreviewData,
  renderScenarioAudioPreview,
} from "./audioPreview";

const staffingScenario = {
  id: "staffing_order_hearing_busy_manager_medium",
  family: "staffing_order_hearing",
  title: "忙しい現場責任者",
  publicBrief: "時間制約のある中級シナリオ",
  openingLine: "時間がないので要点だけお願いします。",
  language: "ja" as const,
};

describe("audio preview use-case", () => {
  beforeEach(() => {
    scenariosGet.mockReset();
    resolveVoiceId.mockReset();
    renderSpeech.mockReset();
    resolveMappedVoiceProfile.mockReset();

    scenariosGet.mockResolvedValue(staffingScenario);
    resolveVoiceId.mockResolvedValue({
      voiceId: "voice_resolved",
      voiceName: "Resolved Voice",
      resolution: "preferred",
    });
    renderSpeech.mockResolvedValue({
      audio: Buffer.from("preview"),
      latencyMs: 120,
    });
  });

  it("returns preview metadata with sample lines", async () => {
    resolveMappedVoiceProfile.mockResolvedValue(null);

    const preview = await getScenarioAudioPreviewData(
      "staffing_order_hearing_busy_manager_medium"
    );

    expect(preview).toMatchObject({
      scenarioId: "staffing_order_hearing_busy_manager_medium",
      voiceMode: "legacy",
      voiceName: "Resolved Voice",
    });
    expect(preview?.samples).toHaveLength(3);
    expect(preview?.samples[0]?.text).toContain("時間がない");
  });

  it("renders audio with the mapped profile when one exists", async () => {
    resolveMappedVoiceProfile.mockResolvedValue({
      id: "busy_manager_ja_primary_v3_f06",
      label: "Busy Manager Primary",
      language: "ja",
      model: "eleven_v3",
      voiceId: "voice_profile",
      firstMessageJa: "よろしくお願いします。",
      textNormalisationType: "elevenlabs",
      voiceSettings: { speed: 1 },
      pronunciationDictionaryLocators: [
        {
          pronunciationDictionaryId: "dict_1",
          versionId: "ver_1",
        },
      ],
    });

    await renderScenarioAudioPreview({
      scenarioId: "staffing_order_hearing_busy_manager_medium",
      sampleKey: "opening",
    });

    expect(resolveVoiceId).toHaveBeenCalledWith("voice_profile", "ja");
    expect(renderSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "eleven_v3",
        voiceId: "voice_resolved",
        pronunciationDictionaryLocators: [
          {
            pronunciationDictionaryId: "dict_1",
            versionId: "ver_1",
          },
        ],
      })
    );
  });

  it("renders custom text over the default sample", async () => {
    resolveMappedVoiceProfile.mockResolvedValue(null);

    const result = await renderScenarioAudioPreview({
      scenarioId: "staffing_order_hearing_busy_manager_medium",
      text: "この文面だけ確認します。",
    });

    expect(renderSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "この文面だけ確認します。",
        modelId: "eleven_flash_v2_5",
      })
    );
    expect(result.previewText).toBe("この文面だけ確認します。");
  });
});
