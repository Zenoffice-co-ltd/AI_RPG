import {
  buildHumanInputRequest,
  buildWhyNeededBlock,
  formatPreflightReport,
} from "./lib/acceptance";
import {
  getBootstrapPreflightBlockers,
  runBootstrapVendors,
} from "./lib/vendorFlows";

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function main() {
  const preflight = hasFlag("--preflight");
  const refreshSecret = hasFlag("--refresh-secret");
  const blockers = await getBootstrapPreflightBlockers();

  if (preflight) {
    console.info(
      formatPreflightReport({
        ready: blockers.length === 0,
        blockers,
        warnings: [
          "bootstrap:vendors は runtime settings への書き込みを伴うため、FIREBASE_PROJECT_ID 未確定時は fail-closed で停止します。",
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
    throw new Error(
      `${formatPreflightReport({
        ready: false,
        blockers,
        warnings: [],
      })}\n\n${buildWhyNeededBlock()}`
    );
  }

  console.info(JSON.stringify(await runBootstrapVendors({ refreshSecret }), null, 2));
}

void main();
