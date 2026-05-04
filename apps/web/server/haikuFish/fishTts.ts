import { FishTtsProvider, type TtsSynthesisResult } from "@top-performer/vendors";
import { applyJaScenarioTtsRulesUnconditional } from "@top-performer/scenario-engine";
import { getHaikuFishServerEnv } from "@/lib/roleplay/server-env";
import { HAIKU_FISH_SCENARIO_ID } from "./scenarioLoader";

export type HaikuFishTtsInput = {
  text: string;
};

export type HaikuFishTtsDeps = {
  provider?: Pick<FishTtsProvider, "synthesize">;
};

function buildEnvLookup() {
  const env = getHaikuFishServerEnv();
  return (key: string) => {
    if (key === "FISH_API_KEY") return env.FISH_API_KEY;
    // FishTtsProvider checks FISH_REFERENCE_ID; we route it to the Adecco-specific
    // voice without disturbing the existing benchmark provider configuration.
    if (key === "FISH_REFERENCE_ID") return env.FISH_ADECCO_VOICE_REFERENCE_ID;
    return process.env[key];
  };
}

function defaultProvider(): FishTtsProvider {
  return new FishTtsProvider(buildEnvLookup());
}

export async function synthesizeHaikuFishAudio(
  input: HaikuFishTtsInput,
  deps: HaikuFishTtsDeps = {}
): Promise<{
  result: TtsSynthesisResult;
  ttsText: string;
  appliedRules: string[];
}> {
  const env = getHaikuFishServerEnv();
  const { ttsText, appliedRules } = applyJaScenarioTtsRulesUnconditional({
    text: input.text,
    scenarioId: HAIKU_FISH_SCENARIO_ID,
  });

  const provider = deps.provider ?? defaultProvider();
  const result = await provider.synthesize({
    provider: "fish",
    model: env.FISH_TTS_MODEL,
    voiceId: env.FISH_ADECCO_VOICE_REFERENCE_ID,
    text: ttsText,
    language: "ja",
    outputFormat: env.FISH_TTS_FORMAT === "wav" ? "wav" : "wav",
    sampleRateHz: env.FISH_TTS_SAMPLE_RATE,
  });

  return { result, ttsText, appliedRules };
}
