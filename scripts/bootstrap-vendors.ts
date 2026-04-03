import {
  buildBasePreflightReport,
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
    const report = await buildBasePreflightReport();
    const includeFirebaseCredentialSecret = report.blockers.some(
      (blocker) => blocker.requiredInput === "FIREBASE_CREDENTIALS_SECRET_NAME"
    );
    console.info(
      formatPreflightReport({
        ready: blockers.length === 0,
        blockers,
        warnings: [
          ...report.warnings,
          "bootstrap:vendors は runtime settings への書き込みを伴うため、FIREBASE_PROJECT_ID 未確定時は fail-closed で停止します。",
        ],
      })
    );
    if (blockers.length > 0) {
      console.info("");
      console.info(
        buildHumanInputRequest(process.env, {
          includeFirebaseCredentialSecret,
          includeVendorSecrets: true,
        })
      );
    }
    return;
  }

  if (blockers.length > 0) {
    throw new Error(
      `${formatPreflightReport({
        ready: false,
        blockers,
        warnings: [],
      })}\n\n${buildWhyNeededBlock({
        includeFirebaseCredentialSecret: blockers.some(
          (blocker) => blocker.requiredInput === "FIREBASE_CREDENTIALS_SECRET_NAME"
        ),
      })}`
    );
  }

  console.info(JSON.stringify(await runBootstrapVendors({ refreshSecret }), null, 2));
}

void main();
