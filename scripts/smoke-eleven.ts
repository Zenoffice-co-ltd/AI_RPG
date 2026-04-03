import {
  buildBasePreflightReport,
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
    const report = await buildBasePreflightReport();
    const includeFirebaseProjectId = blockers.some(
      (blocker) => blocker.requiredInput === "FIREBASE_PROJECT_ID"
    );
    const includeDefaultElevenVoiceId = blockers.some(
      (blocker) => blocker.requiredInput === "DEFAULT_ELEVEN_VOICE_ID"
    );
    const includeQueueSharedSecret = blockers.some(
      (blocker) => blocker.requiredInput === "QUEUE_SHARED_SECRET"
    );
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
          "smoke:eleven は KB 作成だけでなく agent create/update と test run までを acceptance 条件に含めます。",
        ],
      })
    );
    if (blockers.length > 0) {
      console.info("");
      console.info(
        buildHumanInputRequest(process.env, {
          includeFirebaseProjectId,
          includeDefaultElevenVoiceId,
          includeQueueSharedSecret,
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

  console.info(JSON.stringify(await runElevenSmoke(), null, 2));
}

void main();
