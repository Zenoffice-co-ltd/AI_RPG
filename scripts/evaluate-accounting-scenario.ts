import {
  evaluateCompiledAccountingScenario,
  runAccountingLocalEval,
} from "@top-performer/scenario-engine";
import { ACCOUNTING_SCENARIO_ID } from "@top-performer/domain";
import { getAppContext } from "../apps/web/server/appContext";
import {
  resolveWorkspacePath,
  writeGeneratedJson,
} from "../apps/web/server/workspace";

function getArg(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main() {
  const scenarioId = getArg("--scenario") ?? ACCOUNTING_SCENARIO_ID;
  const referenceArtifactPath = resolveWorkspacePath(
    getArg("--reference") ??
      "./docs/references/accounting_clerk_enterprise_ap_100pt_output.json"
  );
  const ctx = getAppContext();
  const scenario = await ctx.repositories.scenarios.get(scenarioId);
  const assets = await ctx.repositories.scenarios.getAssets(scenarioId);

  if (!scenario || !assets) {
    throw new Error(`Scenario or assets not found: ${scenarioId}`);
  }

  const acceptance = await evaluateCompiledAccountingScenario({
    scenario,
    assets,
    referenceArtifactPath,
  });
  const report = await runAccountingLocalEval({
    client: ctx.vendors.openAi,
    model: ctx.env.OPENAI_ANALYSIS_MODEL,
    scenario,
    assets,
  });

  const payload = {
    acceptance,
    localEval: report,
  };

  await writeGeneratedJson(`eval/${scenarioId}.local-eval.json`, payload);
  console.log(JSON.stringify(payload, null, 2));

  if (!acceptance.semanticAcceptancePassed || !report.passed) {
    process.exitCode = 1;
  }
}

void main();
