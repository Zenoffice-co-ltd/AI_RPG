import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { buildPlaybooksJob, compileScenariosJob, importTranscriptsJob, publishScenarioJob } from "../apps/web/server/use-cases/admin";
import { getAppContext } from "../apps/web/server/appContext";
import { resolveWorkspacePath } from "../apps/web/server/workspace";
import {
  ACCEPTANCE_SCENARIO_ID,
  buildRequiredInputsBlock,
  buildWhyNeededBlock,
  buildNextCommandsBlock,
  buildBasePreflightReport,
  evaluateScorecardSla,
  formatPreflightReport,
  isLocalAppBaseUrl,
  type AcceptanceBlocker,
} from "./lib/acceptance";
import {
  inspectAcceptanceSeedState,
  runBootstrapVendors,
  runElevenSmoke,
  runLiveAvatarSmoke,
} from "./lib/vendorFlows";

type SessionStartResponse = {
  sessionId: string;
  liveavatarSessionId: string;
  roomUrl: string;
  roomToken: string;
  avatarId: string;
};

type TranscriptResponse = {
  sessionId: string;
  cursor: number;
  sessionActive?: boolean;
  turns: Array<{
    turnId: string;
    role: "user" | "avatar";
    text: string;
    relativeTimestamp: number;
  }>;
};

type ResultResponse = {
  sessionId: string;
  status: string;
  scorecard?: {
    overallScore: number;
    topPerformerAlignmentScore: number;
  };
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(currentDir, "..");

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  if (!existsSync(dir)) {
    return [];
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const target = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(target);
      }
      return [target];
    })
  );

  return files.flat();
}

async function checkSeedState() {
  const localTranscriptFiles = await listFilesRecursive(
    resolveWorkspacePath("./data/transcripts")
  );
  const remote = await inspectAcceptanceSeedState();
  const remoteSeedReady =
    remote.playbookCount > 0 &&
    Boolean(remote.scenario) &&
    Boolean(remote.assets) &&
    Boolean(remote.binding);

  return {
    localTranscriptFiles,
    localSeedReady: localTranscriptFiles.length > 0,
    remoteSeedReady,
    remote,
  };
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = 30_000
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const payload = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? `HTTP ${response.status} from ${url}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForApp(appBaseUrl: string, timeoutMs = 90_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await fetchJson(`${appBaseUrl}/api/scenarios`, undefined, 5_000);
      return;
    } catch {
      await sleep(1_500);
    }
  }

  throw new Error(`App did not become healthy at ${appBaseUrl} within ${timeoutMs}ms`);
}

async function isPortAvailable(port: number, host: string) {
  return new Promise<boolean>((resolvePromise) => {
    const server = createServer();
    server.once("error", () => {
      resolvePromise(false);
    });
    server.once("listening", () => {
      server.close(() => resolvePromise(true));
    });
    server.listen(port, host);
  });
}

async function resolveLocalAppBaseUrl(appBaseUrl: string) {
  const parsed = new URL(appBaseUrl);
  if (parsed.hostname === "localhost") {
    parsed.hostname = "127.0.0.1";
  }
  const requestedPort = Number(parsed.port || "3000");
  if (await isPortAvailable(requestedPort, parsed.hostname)) {
    return parsed.toString().replace(/\/$/, "");
  }

  for (let offset = 1; offset <= 20; offset += 1) {
    const candidatePort = requestedPort + offset;
    if (await isPortAvailable(candidatePort, parsed.hostname)) {
      parsed.port = String(candidatePort);
      return parsed.toString().replace(/\/$/, "");
    }
  }

  throw new Error(
    `No available local port was found near ${requestedPort} for acceptance app startup.`
  );
}

function startLocalServer(appBaseUrl: string) {
  const url = new URL(appBaseUrl);
  const host = url.hostname;
  const port = url.port || "3000";
  const command = `pnpm build && pnpm exec next start --hostname ${host} --port ${port}`;
  const child = spawn(command, {
    cwd: resolve(workspaceRoot, "apps/web"),
    stdio: "pipe",
    env: {
      ...process.env,
      APP_BASE_URL: appBaseUrl,
    },
    shell: true,
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[web] ${chunk.toString()}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[web] ${chunk.toString()}`);
  });

  return child;
}

async function ensureAppReady(appBaseUrl: string) {
  let child: ChildProcessWithoutNullStreams | null = null;

  try {
    await waitForApp(appBaseUrl, 10_000);
    return {
      child,
      startedLocally: false,
    };
  } catch {
    if (!isLocalAppBaseUrl(appBaseUrl)) {
      throw new Error(
        `APP_BASE_URL ${appBaseUrl} is not reachable. Start the deployed app or point APP_BASE_URL to a live environment.`
      );
    }
  }

  const resolvedAppBaseUrl = await resolveLocalAppBaseUrl(appBaseUrl);
  child = startLocalServer(resolvedAppBaseUrl);
  await waitForApp(resolvedAppBaseUrl);
  return {
    child,
    appBaseUrl: resolvedAppBaseUrl,
  };
}

async function stopLocalServer(child: ChildProcessWithoutNullStreams | null) {
  if (!child) {
    return;
  }

  child.kill("SIGTERM");
  await sleep(1_000);
  if (!child.killed) {
    child.kill("SIGKILL");
  }
}

function appendSeedBlockers(
  blockers: AcceptanceBlocker[],
  seedState: Awaited<ReturnType<typeof checkSeedState>>
) {
  if (!seedState.localSeedReady && !seedState.remoteSeedReady) {
    blockers.push({
      kind: "missing_seed",
      step: "import:transcripts / build:playbooks / compile:scenarios",
      detail:
        "data/transcripts に corpus がなく、target Firestore に playbook / scenario / binding の seed も見つかりません。",
      requiredInput: "既存 Firestore を使ってよいか / transcript corpus の配置",
    });
  }
}

async function maybePrepareScenarioSeed(
  seedState: Awaited<ReturnType<typeof checkSeedState>>
) {
  if (!seedState.remote.playbookCount && seedState.localSeedReady) {
    await importTranscriptsJob({ path: "./data/transcripts" });
    await buildPlaybooksJob({ family: "staffing_order_hearing" });
  }

  const latestPlaybookVersion =
    seedState.remote.latestPlaybookVersion ??
    (await getAppContext().repositories.playbooks.list())[0]?.version;

  if (!latestPlaybookVersion) {
    throw new Error("No playbook found after seed preparation.");
  }

  const remoteState = await inspectAcceptanceSeedState();
  if (!remoteState.scenario || !remoteState.assets) {
    await compileScenariosJob({
      playbookVersion: latestPlaybookVersion,
    });
  }
}

function getLocalAnalyzeDeliveryMode(appBaseUrl: string) {
  return isLocalAppBaseUrl(appBaseUrl) ? "direct-http" : "cloud-tasks";
}

async function postAnalyzeSession(appBaseUrl: string, sessionId: string) {
  const ctx = getAppContext();
  return fetchJson(
    `${appBaseUrl}/api/internal/analyze-session`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-queue-shared-secret": ctx.env.QUEUE_SHARED_SECRET,
      },
      body: JSON.stringify({ sessionId }),
    },
    120_000
  );
}

async function pollTranscript(appBaseUrl: string, sessionId: string) {
  const startedAt = Date.now();
  let cursor = 0;
  while (Date.now() - startedAt < 20_000) {
    const transcript = await fetchJson<TranscriptResponse>(
      `${appBaseUrl}/api/sessions/${sessionId}/transcript?cursor=${cursor}`,
      undefined,
      60_000
    );
    cursor = transcript.cursor;
    if (transcript.turns.length > 0) {
      return transcript;
    }
    await sleep(1_500);
  }

  return fetchJson<TranscriptResponse>(
    `${appBaseUrl}/api/sessions/${sessionId}/transcript?cursor=${cursor}`,
    undefined,
    60_000
  );
}

async function pollResult(appBaseUrl: string, sessionId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    const result = await fetchJson<ResultResponse>(
      `${appBaseUrl}/api/results/${sessionId}`
    );
    if (result.status === "completed" && result.scorecard) {
      return {
        result,
        elapsedMs: Date.now() - startedAt,
      };
    }
    await sleep(2_500);
  }

  const result = await fetchJson<ResultResponse>(
    `${appBaseUrl}/api/results/${sessionId}`
  );
  return {
    result,
    elapsedMs: Date.now() - startedAt,
  };
}

async function printFinalInputRequest() {
  const report = await buildBasePreflightReport();
  const includeFirebaseProjectId = report.blockers.some(
    (blocker) => blocker.requiredInput === "FIREBASE_PROJECT_ID"
  );
  const includeDefaultElevenVoiceId = report.blockers.some(
    (blocker) => blocker.requiredInput === "DEFAULT_ELEVEN_VOICE_ID"
  );
  const includeQueueSharedSecret = report.blockers.some(
    (blocker) => blocker.requiredInput === "QUEUE_SHARED_SECRET"
  );
  const includeFirebaseCredentialSecret = report.blockers.some(
    (blocker) => blocker.requiredInput === "FIREBASE_CREDENTIALS_SECRET_NAME"
  );
  const includeElevenLabsCredential = report.blockers.some(
    (blocker) => blocker.requiredInput === "ELEVENLABS_API_KEY"
  );
  const includeLiveAvatarCredential = report.blockers.some(
    (blocker) => blocker.requiredInput === "LIVEAVATAR_API_KEY"
  );
  console.info(
    buildRequiredInputsBlock(process.env, {
      includeFirebaseProjectId,
      includeDefaultElevenVoiceId,
      includeQueueSharedSecret,
      includeFirebaseCredentialSecret,
      includeElevenLabsCredential,
      includeLiveAvatarCredential,
    })
  );
  console.info("");
  console.info(
    buildWhyNeededBlock({
      includeFirebaseProjectId,
      includeDefaultElevenVoiceId,
      includeQueueSharedSecret,
      includeFirebaseCredentialSecret,
      includeElevenLabsCredential,
      includeLiveAvatarCredential,
    })
  );
  console.info("");
  console.info(buildNextCommandsBlock());
}

async function main() {
  const preflightOnly = hasFlag("--preflight");
  const refreshSecret = hasFlag("--refresh-secret");
  const report = await buildBasePreflightReport();

  let seedState: Awaited<ReturnType<typeof checkSeedState>> | null = null;
  if (report.blockers.length === 0) {
    seedState = await checkSeedState();
    appendSeedBlockers(report.blockers, seedState);
    report.ready = report.blockers.length === 0;
    if (seedState.remote.runtimeSettings?.liveAvatarElevenSecretId) {
      report.warnings.push("runtime settings に既存の LiveAvatar secret id があります。bootstrap は既定で再利用します。");
    }
  }

  if (preflightOnly) {
    console.info(formatPreflightReport(report));
    if (seedState) {
      console.info(
        `- seed: local_transcripts=${seedState.localTranscriptFiles.length}, remote_playbooks=${seedState.remote.playbookCount}, remote_binding=${seedState.remote.binding ? "yes" : "no"}`
      );
    }
    console.info("");
    await printFinalInputRequest();
    return;
  }

  if (report.blockers.length > 0) {
    console.info(formatPreflightReport(report));
    console.info("");
    await printFinalInputRequest();
    process.exitCode = 1;
    return;
  }

  if (!seedState) {
    throw new Error("Seed state was not resolved.");
  }

  const ctx = getAppContext();
  const appBaseUrl = ctx.env.APP_BASE_URL;

  console.info("[1/10] bootstrap:vendors");
  const bootstrap = await runBootstrapVendors({ refreshSecret });
  console.info(JSON.stringify(bootstrap, null, 2));

  console.info("[2/10] seed preparation");
  await maybePrepareScenarioSeed(seedState);

  console.info("[3/10] publish scenario");
  const publish = await publishScenarioJob({
    scenarioId: ACCEPTANCE_SCENARIO_ID,
  });
  if (!publish.passed) {
    throw new Error("publish:scenario did not pass ElevenLabs tests.");
  }

  console.info("[4/10] smoke:eleven");
  console.info(JSON.stringify(await runElevenSmoke(), null, 2));

  console.info("[5/10] smoke:liveavatar");
  console.info(JSON.stringify(await runLiveAvatarSmoke(), null, 2));

  console.info("[6/10] app readiness");
  const appHandle = await ensureAppReady(appBaseUrl);
  const activeAppBaseUrl = appHandle.appBaseUrl ?? appBaseUrl;

  try {
    console.info("[7/10] POST /api/sessions");
    const started = await fetchJson<SessionStartResponse>(
      `${activeAppBaseUrl}/api/sessions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scenarioId: ACCEPTANCE_SCENARIO_ID,
        }),
      },
      120_000
    );

    console.info("[8/10] transcript polling check");
    const transcript = await pollTranscript(activeAppBaseUrl, started.sessionId);

    console.info("[9/10] POST /api/sessions/[id]/end");
    await fetchJson<{ sessionId: string; status: string }>(
      `${activeAppBaseUrl}/api/sessions/${started.sessionId}/end`,
      {
        method: "POST",
      },
      120_000
    );

    if (getLocalAnalyzeDeliveryMode(activeAppBaseUrl) === "direct-http") {
      console.info("[9.5/10] local analyze-session delivery");
      await postAnalyzeSession(activeAppBaseUrl, started.sessionId);
    }

    console.info("[10/10] result polling");
    const { result, elapsedMs } = await pollResult(
      activeAppBaseUrl,
      started.sessionId
    );
    const sla = evaluateScorecardSla(elapsedMs);

    if (result.status !== "completed" || !result.scorecard) {
      throw new Error("Result polling finished without a completed scorecard.");
    }
    if (!sla.passed) {
      throw new Error(
        `Scorecard SLA exceeded: ${sla.elapsedSeconds}s (limit ${sla.limitMs / 1000}s).`
      );
    }

    console.info(
      JSON.stringify(
        {
          status: "passed",
          transcriptTurns: transcript.turns.length,
          sessionId: started.sessionId,
          scorecardSlaSeconds: sla.elapsedSeconds,
          overallScore: result.scorecard.overallScore,
          topPerformerAlignmentScore: result.scorecard.topPerformerAlignmentScore,
          analyzeDelivery: getLocalAnalyzeDeliveryMode(activeAppBaseUrl),
          appBaseUrl: activeAppBaseUrl,
        },
        null,
        2
      )
    );
  } finally {
    await stopLocalServer(appHandle.child);
  }
}

void main().catch((error: unknown) => {
  const rawMessage = error instanceof Error ? error.message : "Unknown error";
  const message = rawMessage.includes("seed")
    ? `[missing_seed] ${rawMessage}`
    : rawMessage.includes("APP_BASE_URL")
      ? `[app_failure] ${rawMessage}`
      : `[vendor_failure] ${rawMessage}`;
  console.error(message);
  process.exitCode = 1;
});
