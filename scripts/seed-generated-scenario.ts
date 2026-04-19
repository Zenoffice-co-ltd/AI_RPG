import { readFile } from "node:fs/promises";
import {
  compiledScenarioAssetsSchema,
  playbookNormsSchema,
  scenarioPackSchema,
} from "@top-performer/domain";
import { getAppContext } from "../apps/web/server/appContext";
import { resolveWorkspacePath } from "../apps/web/server/workspace";

function parseRequiredFlag(flag: string) {
  const flagIndex = process.argv.findIndex((value) => value === flag);
  if (flagIndex === -1 || !process.argv[flagIndex + 1]) {
    throw new Error(`Use ${flag} <value>`);
  }

  return process.argv[flagIndex + 1]!;
}

function parseOptionalFlag(flag: string) {
  const flagIndex = process.argv.findIndex((value) => value === flag);
  if (flagIndex === -1) {
    return undefined;
  }

  const value = process.argv[flagIndex + 1];
  if (!value) {
    throw new Error(`Use ${flag} <value>`);
  }

  return value;
}

async function readJson(path: string) {
  return JSON.parse(await readFile(resolveWorkspacePath(path), "utf8")) as unknown;
}

async function main() {
  const scenarioId = parseRequiredFlag("--scenario");
  const scenarioPath =
    parseOptionalFlag("--scenario-path") ??
    `./data/generated/scenarios/${scenarioId}.json`;
  const assetsPath =
    parseOptionalFlag("--assets-path") ??
    `./data/generated/scenarios/${scenarioId}.assets.json`;

  const scenario = scenarioPackSchema.parse(await readJson(scenarioPath));
  if (scenario.id !== scenarioId) {
    throw new Error(
      `Scenario id mismatch: expected ${scenarioId}, got ${scenario.id}`
    );
  }

  const playbookVersion =
    parseOptionalFlag("--playbook") ?? scenario.generatedFromPlaybookVersion;
  const playbookPath =
    parseOptionalFlag("--playbook-path") ??
    `./data/generated/playbooks/${playbookVersion}.json`;
  const playbook = playbookNormsSchema.parse(await readJson(playbookPath));
  const assets = compiledScenarioAssetsSchema.parse(await readJson(assetsPath));

  if (playbook.version !== playbookVersion) {
    throw new Error(
      `Playbook version mismatch: expected ${playbookVersion}, got ${playbook.version}`
    );
  }

  if (assets.scenarioId !== scenario.id) {
    throw new Error(
      `Assets scenario mismatch: expected ${scenario.id}, got ${assets.scenarioId}`
    );
  }

  if (playbook.family !== scenario.family) {
    throw new Error(
      `Family mismatch: playbook=${playbook.family}, scenario=${scenario.family}`
    );
  }

  const ctx = getAppContext();
  await ctx.repositories.playbooks.upsert(playbook);
  await ctx.repositories.scenarios.upsert(scenario);
  await ctx.repositories.scenarios.saveAssets(assets);

  console.info(
    JSON.stringify(
      {
        seeded: true,
        scenarioId: scenario.id,
        playbookVersion: playbook.version,
        assetsPromptVersion: assets.promptVersion,
      },
      null,
      2
    )
  );
}

void main();
