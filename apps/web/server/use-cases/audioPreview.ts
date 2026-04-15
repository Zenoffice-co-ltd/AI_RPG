import type { ScenarioPack } from "@top-performer/domain";
import {
  assertScenarioVoiceProfileAvailable,
  buildLegacyVoiceSelection,
  buildProfileVoiceSelection,
  normalizeJaTextForTts,
  resolveMappedVoiceProfile,
  type ResolvedScenarioVoiceSelection,
} from "@top-performer/scenario-engine";
import { getAppContext } from "../appContext";

type RoleplayScenario = ScenarioPack;

export type ScenarioAudioPreviewSample = {
  key: string;
  label: string;
  description: string;
  text: string;
};

export type ScenarioAudioPreviewData = {
  scenarioId: string;
  title: string;
  publicBrief: string;
  voiceLabel: string;
  voiceMode: ResolvedScenarioVoiceSelection["mode"];
  voiceName: string;
  voiceProfileId?: string;
  samples: ScenarioAudioPreviewSample[];
};

async function getScenarioOrThrow(scenarioId: string) {
  const scenario = await getAppContext().repositories.scenarios.get(scenarioId);
  if (!scenario) {
    throw new Error(`Scenario not found: ${scenarioId}`);
  }
  return scenario as RoleplayScenario;
}

function buildScenarioAudioPreviewSamples(
  scenario: RoleplayScenario
): ScenarioAudioPreviewSample[] {
  if (scenario.id === "accounting_clerk_enterprise_ap_busy_manager_medium") {
    return [
      {
        key: "opening",
        label: "冒頭",
        description: "経理の主業務をどう読み上げるか確認します。",
        text: "本日はありがとうございます。まずは支払、経費精算、請求書処理の体制から確認させてください。",
      },
      {
        key: "deep_dive",
        label: "深掘り",
        description: "判断業務と差戻し対応の自然さを確認します。",
        text: "税区分や勘定科目の一次判断、固定資産判定、差戻し対応まで含めて、どこまで任せたい想定でしょうか。",
      },
      {
        key: "closing",
        label: "締め",
        description: "承認済みワークフローの締め方を確認します。",
        text: "承認済みワークフローと支払データ作成の流れを社内で確認し、条件面を整理して折り返します。",
      },
    ];
  }

  const openingLine =
    scenario.openingLine?.trim() ||
    "本日はありがとうございます。まず今回の募集背景からご相談させてください。";

  return [
    {
      key: "opening",
      label: "冒頭",
      description: "最初の応答トーンを確認します。",
      text: openingLine,
    },
    {
      key: "deep_dive",
      label: "深掘り",
      description: "忙しい現場責任者としての返し方を確認します。",
      text: "現場としては急ぎなので、まず欠員理由と任せたい業務の優先順位を整理したいです。どこまで任せられる人材を想定していますか。",
    },
    {
      key: "closing",
      label: "締め",
      description: "自然な次アクションの返し方を確認します。",
      text: "一度こちらで整理して、今日中に条件のたたき台を見せてもらえますか。社内確認して折り返します。",
    },
  ];
}

async function resolvePreviewVoiceSelection(scenario: RoleplayScenario) {
  const ctx = getAppContext();
  const mappedProfile = assertScenarioVoiceProfileAvailable({
    scenarioId: scenario.id,
    purpose: "preview",
    profile: await resolveMappedVoiceProfile(scenario.id, undefined, "preview"),
    ...(scenario.publishContract?.dictionaryRequired !== undefined
      ? { dictionaryRequired: scenario.publishContract.dictionaryRequired }
      : {}),
  });
  const resolvedVoice = await ctx.vendors.elevenLabs.resolveVoiceId(
    mappedProfile?.voiceId ?? ctx.env.DEFAULT_ELEVEN_VOICE_ID,
    scenario.language
  );

  const voiceSelection = mappedProfile
    ? buildProfileVoiceSelection({
        scenarioId: scenario.id,
        scenarioOpeningLine: scenario.openingLine,
        profile: mappedProfile,
        resolvedVoiceId: resolvedVoice.voiceId,
      })
    : buildLegacyVoiceSelection({
        scenarioId: scenario.id,
        scenarioOpeningLine: scenario.openingLine,
        resolvedVoiceId: resolvedVoice.voiceId,
        language: scenario.language,
      });

  return {
    voiceSelection,
    resolvedVoice,
  };
}

export async function getScenarioAudioPreviewData(
  scenarioId: string
): Promise<ScenarioAudioPreviewData | null> {
  const scenario = await getAppContext().repositories.scenarios.get(scenarioId);
  if (!scenario) {
    return null;
  }

  const { voiceSelection, resolvedVoice } = await resolvePreviewVoiceSelection(
    scenario as RoleplayScenario
  );

  return {
    scenarioId,
    title: scenario.title,
    publicBrief: scenario.publicBrief,
    voiceLabel: voiceSelection.label,
    voiceMode: voiceSelection.mode,
    voiceName: resolvedVoice.voiceName,
    ...(voiceSelection.mode === "profile"
      ? { voiceProfileId: voiceSelection.voiceProfileId }
      : {}),
    samples: buildScenarioAudioPreviewSamples(scenario as RoleplayScenario),
  };
}

export async function renderScenarioAudioPreview(input: {
  scenarioId: string;
  sampleKey?: string;
  text?: string;
}) {
  const scenario = await getScenarioOrThrow(input.scenarioId);
  const samples = buildScenarioAudioPreviewSamples(scenario);
  const selectedSample = input.sampleKey
    ? samples.find((sample) => sample.key === input.sampleKey)
    : samples[0];
  const previewText = input.text?.trim() || selectedSample?.text || scenario.openingLine;

  if (!previewText) {
    throw new Error("Preview text is required.");
  }

  const { voiceSelection, resolvedVoice } = await resolvePreviewVoiceSelection(scenario);
  const normalized = normalizeJaTextForTts({
    text: previewText,
    scenarioId: scenario.id,
    ttsModel: voiceSelection.ttsModel,
    textNormalisationType: voiceSelection.textNormalisationType,
  });
  const rendered = await getAppContext().vendors.elevenLabs.renderSpeech({
    text: normalized.ttsText,
    modelId: voiceSelection.ttsModel,
    voiceId: voiceSelection.voiceId,
    languageCode: voiceSelection.language,
    textNormalisationType: voiceSelection.textNormalisationType,
    voiceSettings: voiceSelection.voiceSettings,
    ...(voiceSelection.mode === "profile" &&
    voiceSelection.pronunciationDictionaryLocators
      ? {
          pronunciationDictionaryLocators:
            voiceSelection.pronunciationDictionaryLocators,
        }
      : {}),
  });

  return {
    audio: rendered.audio,
    previewText: normalized.displayText,
    voiceSelection,
    voiceName: resolvedVoice.voiceName,
    latencyMs: rendered.latencyMs,
  };
}
