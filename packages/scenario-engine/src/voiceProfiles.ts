import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCOUNTING_SCENARIO_FAMILY,
  type VoiceProfile,
  type VoiceVariationCohort,
} from "@top-performer/domain";
import {
  scenarioVoiceProfileMapSchema,
  voiceVariationCohortSchema,
  voiceProfileSchema,
} from "@top-performer/domain";

export const LEGACY_ELEVEN_TTS_MODEL = "eleven_flash_v2_5";

const currentDir = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(currentDir, "../../..");
export const VOICE_PROFILE_CONFIG_ROOT = resolve(
  REPO_ROOT,
  "config",
  "voice-profiles"
);
const SCENARIO_MAP_FILE = "scenario-map.json";
const VOICE_VARIATION_COHORT_FILE = "cohort.json";
export const JA_VOICE_VARIATIONS_CONFIG_ROOT = resolve(
  VOICE_PROFILE_CONFIG_ROOT,
  "ja_voice_variations"
);
export const JA_VOICE_VARIATION_COHORT_PATH = resolve(
  JA_VOICE_VARIATIONS_CONFIG_ROOT,
  VOICE_VARIATION_COHORT_FILE
);
export type VoiceProfileResolutionPurpose = "publish" | "preview" | "benchmark";

export type ResolvedScenarioVoiceSelection =
  | {
      mode: "profile";
      scenarioId: string;
      voiceProfileId: string;
      label: string;
      language: VoiceProfile["language"];
      ttsModel: string;
      voiceId: string;
      firstMessage: string;
      textNormalisationType: VoiceProfile["textNormalisationType"];
      voiceSettings: VoiceProfile["voiceSettings"];
      pronunciationDictionaryLocators?: VoiceProfile["pronunciationDictionaryLocators"];
    }
  | {
      mode: "legacy";
      scenarioId: string;
      label: string;
      language: "ja";
      ttsModel: string;
      voiceId: string;
      firstMessage: string;
      textNormalisationType: "elevenlabs";
      voiceSettings: {};
      pronunciationDictionaryLocators?: undefined;
    };

async function readJsonFile(path: string) {
  const contents = await readFile(path, "utf8");
  return JSON.parse(contents) as unknown;
}

export function isAccountingScenarioVoiceFamily(scenarioId: string) {
  return scenarioId.startsWith(`${ACCOUNTING_SCENARIO_FAMILY}_`);
}

async function listJsonFilesRecursive(root: string) {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const nextPath = resolve(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsonFilesRecursive(nextPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(nextPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

export async function loadScenarioVoiceProfileMap(
  configRoot = VOICE_PROFILE_CONFIG_ROOT
) {
  return scenarioVoiceProfileMapSchema.parse(
    await readJsonFile(resolve(configRoot, SCENARIO_MAP_FILE))
  );
}

export async function loadVoiceProfile(
  profileId: string,
  configRoot = VOICE_PROFILE_CONFIG_ROOT
) {
  const files = await listJsonFilesRecursive(configRoot);

  for (const filePath of files) {
    const fileName = filePath.split(/[/\\]/).pop();
    if (!fileName || fileName === SCENARIO_MAP_FILE || fileName === VOICE_VARIATION_COHORT_FILE) {
      continue;
    }

    const parsed = voiceProfileSchema.safeParse(await readJsonFile(filePath));
    if (parsed.success && parsed.data.id === profileId) {
      return parsed.data;
    }
  }

  throw new Error(`Voice profile not found: ${profileId}`);
}

export async function listVoiceProfiles(configRoot = VOICE_PROFILE_CONFIG_ROOT) {
  const files = await listJsonFilesRecursive(configRoot);
  const profiles: VoiceProfile[] = [];

  for (const filePath of files) {
    const fileName = filePath.split(/[/\\]/).pop();
    if (!fileName || fileName === SCENARIO_MAP_FILE || fileName === VOICE_VARIATION_COHORT_FILE) {
      continue;
    }

    const parsed = voiceProfileSchema.safeParse(await readJsonFile(filePath));
    if (parsed.success) {
      profiles.push(parsed.data);
    }
  }

  return profiles.sort((left, right) => left.id.localeCompare(right.id));
}

export async function loadVoiceVariationCohort(
  cohortPath = JA_VOICE_VARIATION_COHORT_PATH
) {
  return voiceVariationCohortSchema.parse(await readJsonFile(cohortPath));
}

export async function listVoiceVariationProfiles(
  cohortPath = JA_VOICE_VARIATION_COHORT_PATH,
  configRoot = VOICE_PROFILE_CONFIG_ROOT
) {
  const cohort = await loadVoiceVariationCohort(cohortPath);
  const profiles = await Promise.all(
    cohort.candidates.map((candidate) => loadVoiceProfile(candidate.profileId, configRoot))
  );

  return cohort.candidates.map((candidate, index) => ({
    candidate,
    profile: profiles[index]!,
  }));
}

export async function resolveMappedVoiceProfile(
  scenarioId: string,
  configRoot = VOICE_PROFILE_CONFIG_ROOT,
  purpose: VoiceProfileResolutionPurpose = "publish"
) {
  const mapping = await loadScenarioVoiceProfileMap(configRoot);
  const profileId =
    purpose === "preview"
      ? mapping.previewProfiles[scenarioId] ?? mapping.activeProfiles[scenarioId]
      : purpose === "benchmark"
        ? mapping.benchmarkProfiles[scenarioId] ?? mapping.activeProfiles[scenarioId]
        : mapping.activeProfiles[scenarioId];

  if (!profileId) {
    return null;
  }

  return loadVoiceProfile(profileId, configRoot);
}

export function assertScenarioVoiceProfileAvailable(input: {
  scenarioId: string;
  purpose: VoiceProfileResolutionPurpose;
  profile: VoiceProfile | null;
  dictionaryRequired?: boolean;
}) {
  if (input.profile) {
    return input.profile;
  }

  const accountingScenario = isAccountingScenarioVoiceFamily(input.scenarioId);
  const mappedProfileRequired =
    input.purpose === "publish"
      ? accountingScenario || input.dictionaryRequired === true
      : accountingScenario;

  if (!mappedProfileRequired) {
    return null;
  }

  throw new Error(
    `Scenario ${input.scenarioId} requires a mapped voice profile for ${input.purpose}. Legacy fallback is disabled until an explicit ${input.purpose} mapping is configured.`
  );
}

export function assertVoiceProfileProductionReady(profile: VoiceProfile) {
  if (profile.metadata?.benchmarkStatus !== "approved") {
    return profile;
  }

  if (
    !profile.pronunciationDictionaryLocators ||
    profile.pronunciationDictionaryLocators.length === 0
  ) {
    throw new Error(
      `Approved voice profile ${profile.id} is blocked for production until pronunciationDictionaryLocators are configured.`
    );
  }

  return profile;
}

export function buildProfileVoiceSelection(input: {
  scenarioId: string;
  scenarioOpeningLine: string;
  profile: VoiceProfile;
  resolvedVoiceId?: string;
}): ResolvedScenarioVoiceSelection {
  const readyProfile = assertVoiceProfileProductionReady(input.profile);

  return {
    mode: "profile",
    scenarioId: input.scenarioId,
    voiceProfileId: readyProfile.id,
    label: readyProfile.label,
    language: readyProfile.language,
    ttsModel: readyProfile.model,
    voiceId: input.resolvedVoiceId ?? readyProfile.voiceId,
    firstMessage: readyProfile.firstMessageJa ?? input.scenarioOpeningLine,
    textNormalisationType: readyProfile.textNormalisationType,
    voiceSettings: readyProfile.voiceSettings,
    ...(readyProfile.pronunciationDictionaryLocators
      ? {
          pronunciationDictionaryLocators:
            readyProfile.pronunciationDictionaryLocators,
        }
      : {}),
  };
}

export function buildLegacyVoiceSelection(input: {
  scenarioId: string;
  scenarioOpeningLine: string;
  resolvedVoiceId: string;
  language?: "ja";
}) {
  return {
    mode: "legacy",
    scenarioId: input.scenarioId,
    label: "Legacy default voice",
    language: input.language ?? "ja",
    ttsModel: LEGACY_ELEVEN_TTS_MODEL,
    voiceId: input.resolvedVoiceId,
    firstMessage: input.scenarioOpeningLine,
    textNormalisationType: "elevenlabs",
    voiceSettings: {},
  } satisfies ResolvedScenarioVoiceSelection;
}
