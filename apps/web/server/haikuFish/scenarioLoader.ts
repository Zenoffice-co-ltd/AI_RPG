import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { WORKSPACE_ROOT } from "../workspace";

const SCENARIO_ID =
  "staffing_order_hearing_adecco_manufacturer_busy_manager_medium";
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

export type HaikuFishScenarioBundle = {
  scenarioId: string;
  promptVersion: string;
  agentSystemPrompt: string;
  knowledgeBaseText: string;
  firstMessage: string;
  agentSystemPromptHash: string;
  knowledgeBaseTextHash: string;
  promptSectionsHash: string;
};

let cached: HaikuFishScenarioBundle | null = null;

function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

export async function loadHaikuFishScenarioBundle(): Promise<HaikuFishScenarioBundle> {
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
    throw new Error("Haiku-Fish scenario bundle: agentSystemPrompt missing.");
  }
  if (typeof assets.knowledgeBaseText !== "string" || assets.knowledgeBaseText.length === 0) {
    throw new Error("Haiku-Fish scenario bundle: knowledgeBaseText missing.");
  }
  if (typeof assets.promptVersion !== "string" || assets.promptVersion.length === 0) {
    throw new Error("Haiku-Fish scenario bundle: promptVersion missing.");
  }
  if (typeof assets.scenarioId !== "string" || assets.scenarioId !== SCENARIO_ID) {
    throw new Error("Haiku-Fish scenario bundle: scenarioId mismatch.");
  }
  if (typeof voiceProfile.firstMessageJa !== "string" || voiceProfile.firstMessageJa.length === 0) {
    throw new Error("Haiku-Fish scenario bundle: firstMessageJa missing.");
  }

  const promptSectionsSerialized = JSON.stringify(assets.promptSections ?? null);

  cached = {
    scenarioId: assets.scenarioId,
    promptVersion: assets.promptVersion,
    agentSystemPrompt: assets.agentSystemPrompt,
    knowledgeBaseText: assets.knowledgeBaseText,
    firstMessage: voiceProfile.firstMessageJa,
    agentSystemPromptHash: sha256(assets.agentSystemPrompt),
    knowledgeBaseTextHash: sha256(assets.knowledgeBaseText),
    promptSectionsHash: sha256(promptSectionsSerialized),
  };

  return cached;
}

export function clearHaikuFishScenarioBundleCache() {
  cached = null;
}

export const HAIKU_FISH_SCENARIO_ID = SCENARIO_ID;
