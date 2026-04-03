import {
  buildHumanInputRequest,
  formatPreflightReport,
} from "./lib/acceptance";
import {
  getSmokeElevenPreflightBlockers,
  runElevenSmoke,
} from "./lib/vendorFlows";

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function main() {
  const preflight = hasFlag("--preflight");
  const blockers = await getSmokeElevenPreflightBlockers();

  if (preflight) {
    console.info(
      formatPreflightReport({
        ready: blockers.length === 0,
        blockers,
        warnings: [
          "smoke:eleven は KB 作成だけでなく agent create/update と test run までを acceptance 条件に含めます。",
        ],
      })
    );
    if (blockers.length > 0) {
      console.info("");
      console.info(buildHumanInputRequest());
    }
    return;
  }

  if (blockers.length > 0) {
    throw new Error(formatPreflightReport({ ready: false, blockers, warnings: [] }));
  }

  console.info(JSON.stringify(await runElevenSmoke(), null, 2));
}

void main();
