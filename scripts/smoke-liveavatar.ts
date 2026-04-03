import {
  buildBasePreflightReport,
  buildHumanInputRequest,
  formatPreflightReport,
} from "./lib/acceptance";
import {
  getSmokeLiveAvatarPreflightBlockers,
  runLiveAvatarSmoke,
} from "./lib/vendorFlows";

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function main() {
  const preflight = hasFlag("--preflight");
  const blockers = await getSmokeLiveAvatarPreflightBlockers();

  if (preflight) {
    const report = await buildBasePreflightReport();
    const includeFirebaseCredentialSecret = report.blockers.some(
      (blocker) => blocker.requiredInput === "FIREBASE_CREDENTIALS_SECRET_NAME"
    );
    const includeElevenLabsCredential = blockers.some(
      (blocker) => blocker.requiredInput === "ELEVENLABS_API_KEY"
    );
    const includeLiveAvatarCredential = blockers.some(
      (blocker) => blocker.requiredInput === "LIVEAVATAR_API_KEY"
    );
    console.info(
      formatPreflightReport({
        ready: blockers.length === 0,
        blockers,
        warnings: [
          ...report.warnings,
          "smoke:liveavatar は runtime settings の LiveAvatar secret id と published AgentBinding を前提にします。",
        ],
      })
    );
    if (blockers.length > 0) {
      console.info("");
      console.info(
        buildHumanInputRequest(process.env, {
          includeFirebaseCredentialSecret,
          includeElevenLabsCredential,
          includeLiveAvatarCredential,
        })
      );
    }
    return;
  }

  if (blockers.length > 0) {
    throw new Error(formatPreflightReport({ ready: false, blockers, warnings: [] }));
  }

  console.info(JSON.stringify(await runLiveAvatarSmoke(), null, 2));
}

void main();
