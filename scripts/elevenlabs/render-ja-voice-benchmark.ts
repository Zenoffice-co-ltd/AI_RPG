import { DEFAULT_SCENARIO_IDS } from "../../packages/domain/src/scenario";
import {
  renderJaVoiceVariationBenchmark,
  type JaVoiceBenchmarkRound,
} from "../../packages/scenario-engine/src/jaVoiceVariations";
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

async function main() {
  const round = (getArg("--round") ?? "round1-sanity") as JaVoiceBenchmarkRound;
  const scenarioId =
    getArg("--scenario") ?? DEFAULT_SCENARIO_IDS.busy_manager_medium;
  const outputDir = getArg("--output-dir");
  const seed = getArg("--seed") ? Number(getArg("--seed")) : 42;
  const includeProfileIds = getArgs("--include-profile");
  const ctx = getAppContext();

  const result = await renderJaVoiceVariationBenchmark({
    elevenLabs: ctx.vendors.elevenLabs,
    scenarioId,
    round,
    ...(outputDir ? { outputDir } : {}),
    seed,
    ...(includeProfileIds.length > 0 ? { includeProfileIds } : {}),
  });

  console.info(JSON.stringify(result, null, 2));
  if (result.failed > 0) {
    process.exitCode = 1;
  }
}

void main();
