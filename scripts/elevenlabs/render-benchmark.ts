import { DEFAULT_SCENARIO_IDS } from "../../packages/domain/src/scenario";
import type { BenchmarkTarget } from "../../packages/scenario-engine/src/benchmarkRenderer";
import { renderVoiceBenchmark } from "../../packages/scenario-engine/src/benchmarkRenderer";
import { getAppContext } from "../../apps/web/server/appContext";

function getArg(flag: string) {
  const index = process.argv.findIndex((value) => value === flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function getArgs(flag: string) {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag && process.argv[index + 1]) {
      values.push(process.argv[index + 1]!);
    }
  }
  return values;
}

function getNumberArg(flag: string) {
  const value = getArg(flag);
  return value ? Number(value) : undefined;
}

function getBooleanArg(flag: string) {
  const value = getArg(flag);
  if (!value) {
    return undefined;
  }

  return ["true", "1", "yes", "y"].includes(value.toLowerCase());
}

function parseDictionaryLocators() {
  return getArgs("--dictionary-locator").map((value) => {
    const [pronunciationDictionaryId, versionId] = value.split(":");
    if (!pronunciationDictionaryId || !versionId) {
      throw new Error(
        `Invalid --dictionary-locator value: ${value}. Use pronunciationDictionaryId:versionId.`
      );
    }

    return {
      pronunciationDictionaryId,
      versionId,
    };
  });
}

function buildRawTarget(): BenchmarkTarget | undefined {
  const voiceId = getArg("--voice-id");
  const modelId = getArg("--model");
  if (!voiceId && !modelId) {
    return undefined;
  }
  if (!voiceId || !modelId) {
    throw new Error("Raw benchmark target requires both --voice-id and --model.");
  }

  const pronunciationDictionaryLocators = parseDictionaryLocators();

  return {
    source: "raw",
    label: getArg("--label") ?? `raw_${voiceId}_${modelId}`,
    language: "ja",
    modelId,
    voiceId,
    ...(getArg("--first-message")
      ? { firstMessage: getArg("--first-message") }
      : {}),
    textNormalisationType:
      (getArg("--text-normalisation-type") as
        | "system_prompt"
        | "elevenlabs"
        | undefined) ?? "elevenlabs",
    voiceSettings: {
      ...(getNumberArg("--stability") !== undefined
        ? { stability: getNumberArg("--stability") }
        : {}),
      ...(getNumberArg("--similarity-boost") !== undefined
        ? { similarityBoost: getNumberArg("--similarity-boost") }
        : {}),
      ...(getNumberArg("--speed") !== undefined
        ? { speed: getNumberArg("--speed") }
        : {}),
      ...(getNumberArg("--style") !== undefined
        ? { style: getNumberArg("--style") }
        : {}),
      ...(getBooleanArg("--use-speaker-boost") !== undefined
        ? { useSpeakerBoost: getBooleanArg("--use-speaker-boost") }
        : {}),
    },
    ...(pronunciationDictionaryLocators.length > 0
      ? { pronunciationDictionaryLocators }
      : {}),
  };
}

async function main() {
  const scenarioId =
    getArg("--scenario") ?? DEFAULT_SCENARIO_IDS.busy_manager_medium;
  const profileIds = getArgs("--profile");
  const outputDir = getArg("--output-dir");
  const utteranceCsvPath = getArg("--utterances");
  const seed = getNumberArg("--seed");
  const rawTarget = buildRawTarget();
  const ctx = getAppContext();

  const result = await renderVoiceBenchmark({
    elevenLabs: ctx.vendors.elevenLabs,
    scenarioId,
    ...(profileIds.length > 0 ? { profileIds } : {}),
    ...(rawTarget ? { rawTarget } : {}),
    ...(outputDir ? { outputDir } : {}),
    ...(utteranceCsvPath ? { utteranceCsvPath } : {}),
    ...(seed !== undefined ? { seed } : {}),
  });

  console.info(JSON.stringify(result, null, 2));
  if (result.failed > 0) {
    process.exitCode = 1;
  }
}

void main();
