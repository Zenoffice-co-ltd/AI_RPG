import { publishScenarioJob } from "../apps/web/server/use-cases/admin";

function parseScenarioArg() {
  const flagIndex = process.argv.findIndex((value) => value === "--scenario");
  if (flagIndex === -1 || !process.argv[flagIndex + 1]) {
    throw new Error("Use --scenario <scenarioId>");
  }

  return process.argv[flagIndex + 1]!;
}

function parseOptionalProfileArg() {
  const flagIndex = process.argv.findIndex((value) => value === "--profile");
  if (flagIndex === -1) {
    return undefined;
  }

  const value = process.argv[flagIndex + 1];
  if (!value) {
    throw new Error("Use --profile <voiceProfileId>");
  }

  return value;
}

async function main() {
  const scenarioId = parseScenarioArg();
  const voiceProfileId = parseOptionalProfileArg();
  const result = await publishScenarioJob({
    scenarioId,
    ...(voiceProfileId ? { voiceProfileId } : {}),
  });
  console.info(JSON.stringify(result, null, 2));
}

void main();
