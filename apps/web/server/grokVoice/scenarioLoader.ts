import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildLivePronunciationGuide } from "@top-performer/scenario-engine";
import { WORKSPACE_ROOT } from "../workspace";

const SCENARIO_ID =
  "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v21";
const VOICE_PROFILE_ID =
  "staffing_order_hearing_adecco_manufacturer_ja_v3_candidate_v2";

const ASSETS_PATH = resolve(
  WORKSPACE_ROOT,
  "data/generated/scenarios",
  `${SCENARIO_ID}.assets.json`
);
const VOICE_PROFILE_PATH = resolve(
  WORKSPACE_ROOT,
  "config/voice-profiles",
  `${VOICE_PROFILE_ID}.json`
);

export type GrokVoiceScenarioBundle = {
  scenarioId: string;
  promptVersion: string;
  agentSystemPrompt: string;
  knowledgeBaseText: string;
  firstMessage: string;
  pronunciationGuide: string;
  agentSystemPromptHash: string;
  knowledgeBaseTextHash: string;
  promptSectionsHash: string;
};

let cached: GrokVoiceScenarioBundle | null = null;

function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

export async function loadGrokVoiceScenarioBundle(): Promise<GrokVoiceScenarioBundle> {
  if (cached) {
    return cached;
  }

  const [assetsRaw, voiceProfileRaw] = await Promise.all([
    readFile(ASSETS_PATH, "utf8"),
    readFile(VOICE_PROFILE_PATH, "utf8"),
  ]);

  const assets = JSON.parse(assetsRaw) as {
    scenarioId?: unknown;
    promptVersion?: unknown;
    agentSystemPrompt?: unknown;
    knowledgeBaseText?: unknown;
    promptSections?: unknown;
  };
  const voiceProfile = JSON.parse(voiceProfileRaw) as {
    firstMessageJa?: unknown;
  };

  if (typeof assets.agentSystemPrompt !== "string" || assets.agentSystemPrompt.length === 0) {
    throw new Error("Grok Voice scenario bundle: agentSystemPrompt missing.");
  }
  if (typeof assets.knowledgeBaseText !== "string" || assets.knowledgeBaseText.length === 0) {
    throw new Error("Grok Voice scenario bundle: knowledgeBaseText missing.");
  }
  if (typeof assets.promptVersion !== "string" || assets.promptVersion.length === 0) {
    throw new Error("Grok Voice scenario bundle: promptVersion missing.");
  }
  if (typeof assets.scenarioId !== "string" || assets.scenarioId !== SCENARIO_ID) {
    throw new Error("Grok Voice scenario bundle: scenarioId mismatch.");
  }
  if (typeof voiceProfile.firstMessageJa !== "string" || voiceProfile.firstMessageJa.length === 0) {
    throw new Error("Grok Voice scenario bundle: firstMessageJa missing.");
  }

  const promptSectionsSerialized = JSON.stringify(assets.promptSections ?? null);

  // Generate the pronunciation guide from the local PLS lexicon, scoped to
  // tokens that actually appear in the prompt or knowledge base. This keeps
  // Grok's instruction body small while overriding TTS readings for the
  // housing-equipment + staffing-acronym terms it tends to mispronounce.
  // v2.1 quality patch (2026-05-05): bumped from 40 → 80 so the new
  // 見積もり補助 / 朝八時四十五分 / 夕方五時三十分 / 施工日に合わせて lexemes
  // (appended at the end of the PLS file) make it past the relevance-filter
  // cap. Joined-text matches are ~196; 80 covers the priority acronyms,
  // housing-equipment vocabulary, and the new voice-friendly time forms.
  const pronunciationGuide = await buildLivePronunciationGuide({
    scenarioId: assets.scenarioId,
    textNormalisationType: "system_prompt",
    referenceTexts: [assets.agentSystemPrompt, assets.knowledgeBaseText],
    maxEntries: 80,
  });

  cached = {
    scenarioId: assets.scenarioId,
    promptVersion: assets.promptVersion,
    agentSystemPrompt: assets.agentSystemPrompt,
    knowledgeBaseText: assets.knowledgeBaseText,
    firstMessage: voiceProfile.firstMessageJa,
    pronunciationGuide,
    agentSystemPromptHash: sha256(assets.agentSystemPrompt),
    knowledgeBaseTextHash: sha256(assets.knowledgeBaseText),
    promptSectionsHash: sha256(promptSectionsSerialized),
  };

  return cached;
}

export function clearGrokVoiceScenarioBundleCache() {
  cached = null;
}

export const GROK_VOICE_SCENARIO_ID = SCENARIO_ID;
