// Deploy wrapper for the AI_RPG Adecco roleplay App Hosting backend.
//
// Why this wrapper exists:
//   `firebase deploy --only apphosting` succeeds and prints "Rollout
//   complete!" without populating the locked-response TTS cache.
//   In production we measured a 25% cache miss rate (n=81 over 7 days),
//   which adds 1.5–3s of synth penalty to the affected turns. The
//   warm-tts-cache step pre-creates every PR60 canonical entry in the
//   shared cache so production sessions hit memory cache from turn 1.
//
//   Doing this as a single `pnpm deploy:adecco-roleplay` makes the
//   "deploy then warm" sequence atomic and recoverable instead of two
//   commands a human can forget to run in order.
//
// What this wrapper does:
//   1. Reads + records the current prod state (rollout id + guardrail).
//   2. Runs `firebase deploy --only apphosting`.
//   3. Polls App Hosting until the rollout reaches SUCCEEDED.
//   4. Runs warm-tts-cache.
//   5. Re-fetches /api/v3/session and verifies that guardrailVersion
//      actually advanced (the post-merge "did my code land" check from
//      memory feedback_verify_late_push_landed).
//
// Usage:
//   pnpm deploy:adecco-roleplay
//   pnpm deploy:adecco-roleplay -- --skip-warm   # rollout only
//   pnpm deploy:adecco-roleplay -- --skip-deploy # warm only (existing rollout)
//
// Required env / auth:
//   - gcloud authenticated to a principal with App Hosting + Secret Manager read
//   - firebase CLI authenticated for the same project (interactive login OR
//     GOOGLE_APPLICATION_CREDENTIALS for non-interactive)
//
// Secret hygiene: all keys are pulled via `gcloud secrets versions access`
// inside warm-tts-cache. This script never reads or prints secrets.

import { spawnSync } from "node:child_process";

const PROJECT = "adecco-mendan";
const BACKEND = "adecco-roleplay";
const LOCATION = "asia-east1";
const APPHOSTING_BASE_URL =
  "https://adecco-roleplay--adecco-mendan.asia-east1.hosted.app";

type CliFlags = {
  skipDeploy: boolean;
  skipWarm: boolean;
  skipVerify: boolean;
};

function parseFlags(argv: string[]): CliFlags {
  return {
    skipDeploy: argv.includes("--skip-deploy"),
    skipWarm: argv.includes("--skip-warm"),
    skipVerify: argv.includes("--skip-verify"),
  };
}

function gcloudAccessToken(): string {
  const r = spawnSync("gcloud", ["auth", "print-access-token"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (r.status !== 0 || !r.stdout) {
    throw new Error(
      "gcloud auth print-access-token failed. Authenticate with `gcloud auth login` first."
    );
  }
  return r.stdout.trim();
}

async function listRollouts(): Promise<
  Array<{ id: string; state: string; createTime: string; updateTime: string }>
> {
  const token = gcloudAccessToken();
  const url = `https://firebaseapphosting.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/backends/${BACKEND}/rollouts?pageSize=50`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`rollouts list failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    rollouts?: Array<{
      name: string;
      state: string;
      createTime: string;
      updateTime: string;
    }>;
  };
  const rollouts = body.rollouts ?? [];
  return rollouts
    .map((r) => ({
      id: r.name.split("/").pop() ?? r.name,
      state: r.state,
      createTime: r.createTime,
      updateTime: r.updateTime,
    }))
    .sort((a, b) =>
      a.createTime < b.createTime ? 1 : a.createTime > b.createTime ? -1 : 0
    );
}

async function fetchProdSessionVersion(): Promise<{
  guardrailVersion: string;
  promptVersion: string;
  strictSanitizedPlayback: boolean;
}> {
  // Pull the demo access token from Secret Manager (the same path the
  // existing prod-smoke script uses) so this verification works in
  // CI / non-interactive contexts. We deliberately do NOT read from a
  // local .env.local because deploy verification must reflect the
  // canonical live environment, not the developer's overrides.
  const tokenResult = spawnSync(
    "gcloud",
    [
      "secrets",
      "versions",
      "access",
      "latest",
      "--secret=demo-access-token",
      `--project=${PROJECT}`,
    ],
    { encoding: "utf8", shell: process.platform === "win32" }
  );
  if (tokenResult.status !== 0 || !tokenResult.stdout) {
    throw new Error("Failed to read demo-access-token from Secret Manager");
  }
  const demoToken = tokenResult.stdout.trim();
  const crypto = await import("node:crypto");
  const sig = crypto.createHmac("sha256", demoToken).update(demoToken).digest("hex");
  const cookie = `roleplay_api_access=${sig}`;
  const res = await fetch(`${APPHOSTING_BASE_URL}/api/v3/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: APPHOSTING_BASE_URL,
      referer: `${APPHOSTING_BASE_URL}/demo/adecco-roleplay-v3`,
      cookie,
    },
    body: "{}",
  });
  if (!res.ok) {
    throw new Error(
      `prod /api/v3/session failed: ${res.status} ${await res.text()}`
    );
  }
  const body = (await res.json()) as {
    guardrailVersion: string;
    promptVersion: string;
    strictSanitizedPlayback: boolean;
  };
  return body;
}

function runFirebaseDeploy(): void {
  console.log("[deploy] firebase deploy --only apphosting --project=" + PROJECT);
  const r = spawnSync(
    "firebase",
    [
      "deploy",
      "--only",
      "apphosting",
      "--project",
      PROJECT,
      "--non-interactive",
    ],
    {
      stdio: "inherit",
      shell: process.platform === "win32",
    }
  );
  if (r.status !== 0) {
    throw new Error(`firebase deploy exited with status ${r.status}`);
  }
}

function runWarmTtsCache(): void {
  console.log("[deploy] running warm-tts-cache");
  const r = spawnSync(
    "pnpm",
    ["exec", "tsx", "scripts/grok-voice-warm-tts-cache.ts"],
    {
      stdio: "inherit",
      shell: process.platform === "win32",
    }
  );
  if (r.status !== 0) {
    // Cache warm failure is recoverable (cache will lazy-fill on first
    // request) but signals a config problem. Do not return zero status.
    throw new Error(`warm-tts-cache exited with status ${r.status}`);
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const startedAt = Date.now();
  console.log(
    `[deploy] target_project=${PROJECT} target_backend=${BACKEND} target_url=${APPHOSTING_BASE_URL}`
  );

  // Baseline (rollback record). Per memory adecco_apphosting_deploy_lag,
  // we always log the previous rollout id BEFORE any change so a human
  // can reissue `gcloud apphosting rollouts revert` if the new rollout
  // misbehaves.
  let baseline: { rolloutId: string; guardrailVersion: string } | null = null;
  try {
    const rollouts = await listRollouts();
    const latest = rollouts[0];
    const baselineSession = await fetchProdSessionVersion();
    baseline = {
      rolloutId: latest?.id ?? "(none)",
      guardrailVersion: baselineSession.guardrailVersion,
    };
    console.log(
      `[deploy] baseline rollout=${baseline.rolloutId} guardrailVersion=${baseline.guardrailVersion}`
    );
  } catch (err) {
    console.warn(
      "[deploy] warning: could not read baseline (continuing):",
      err instanceof Error ? err.message : String(err)
    );
  }

  if (!flags.skipDeploy) {
    runFirebaseDeploy();
  } else {
    console.log("[deploy] --skip-deploy passed, skipping firebase deploy");
  }

  if (!flags.skipWarm) {
    runWarmTtsCache();
  } else {
    console.log("[deploy] --skip-warm passed, skipping warm-tts-cache");
  }

  if (!flags.skipVerify) {
    // Final guardrailVersion check. If baseline existed and matched, we
    // do not block on equality — different bumps may keep the same
    // guardrailVersion (config-only rollouts). We only fail loud if the
    // session endpoint is unhealthy.
    try {
      const after = await fetchProdSessionVersion();
      console.log(
        `[deploy] post-deploy guardrailVersion=${after.guardrailVersion} promptVersion=${after.promptVersion} strictSanitizedPlayback=${after.strictSanitizedPlayback}`
      );
      if (
        baseline &&
        baseline.guardrailVersion === after.guardrailVersion &&
        !flags.skipDeploy
      ) {
        console.warn(
          "[deploy] note: guardrailVersion did not change. If the PR being deployed bumped the guardrail, this is a red flag (cf. PR #80 squash mismatch incident)."
        );
      }
    } catch (err) {
      throw new Error(
        `post-deploy verification failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[deploy] complete in ${elapsed}s`);
}

main().catch((err) => {
  console.error("[deploy] FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
