import { publishScenarioJob } from "../apps/web/server/use-cases/admin";

function parseScenarioArg() {
  const flagIndex = process.argv.findIndex((value) => value === "--scenario");
  if (flagIndex === -1 || !process.argv[flagIndex + 1]) {
    throw new Error("Use --scenario <scenarioId>");
  }

  return process.argv[flagIndex + 1]!;
}

async function main() {
  const scenarioId = parseScenarioArg();
  const result = await publishScenarioJob({ scenarioId });
  console.info(JSON.stringify(result, null, 2));
}

void main();
