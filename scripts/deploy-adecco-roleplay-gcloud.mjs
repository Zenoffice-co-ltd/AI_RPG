#!/usr/bin/env node

// Firebase App Hosting deploy path that avoids Firebase CLI auth and uses the
// active gcloud account instead:
//   1. build the same source zip shape Firebase Tools uses
//   2. upload it with `gcloud storage cp`
//   3. create an App Hosting build + rollout through the public API
//   4. warm the Grok locked-response cache and verify the production session

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { createSourceDeployArchive } = require("firebase-tools/lib/deploy/apphosting/util");

const PROJECT = "adecco-mendan";
const PROJECT_NUMBER = "787365421680";
const LOCATION = "asia-east1";
const BACKEND = "adecco-roleplay";
const API_VERSION = "v1beta";
const APPHOSTING_BASE_URL =
  "https://adecco-roleplay--adecco-mendan.asia-east1.hosted.app";
const BUCKET = `firebaseapphosting-sources-${PROJECT_NUMBER}-${LOCATION}`;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_ROOT = path.join(REPO_ROOT, "out", "adecco_roleplay_gcloud_deploy");
const TSX_CLI_PATH = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

function utcStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const startedAt = Date.now();
const runId = utcStamp();
const artifactDir = path.join(OUT_ROOT, runId);
fs.mkdirSync(artifactDir, { recursive: true });

const logPath = path.join(artifactDir, "deployment.log");
const summaryPath = path.join(artifactDir, "summary.json");

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  fs.appendFileSync(logPath, `${line}\n`);
}

function run(command, args, options = {}) {
  const { redactStdout = false, ...spawnOptions } = options;
  log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    ...spawnOptions,
  });
  if (result.stdout) {
    if (redactStdout) {
      const redacted = `[redacted stdout: ${result.stdout.trim().length} chars]\n`;
      process.stdout.write(redacted);
      fs.appendFileSync(logPath, redacted);
    } else {
      process.stdout.write(result.stdout);
      fs.appendFileSync(logPath, result.stdout);
    }
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
    fs.appendFileSync(logPath, result.stderr);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
  return result.stdout.trim();
}

function gcloudAccessToken() {
  return run("gcloud", ["auth", "print-access-token"], { redactStdout: true });
}

async function apphostingFetch(pathAndQuery, options = {}) {
  const token = gcloudAccessToken();
  const response = await fetch(
    `https://firebaseapphosting.googleapis.com/${API_VERSION}/${pathAndQuery}`,
    {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(options.headers ?? {}),
      },
    }
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `App Hosting API ${pathAndQuery} failed: ${response.status} ${text}`
    );
  }
  return text ? JSON.parse(text) : {};
}

async function listAll(resourcePath, fieldName) {
  const items = [];
  let pageToken = "";
  do {
    const separator = resourcePath.includes("?") ? "&" : "?";
    const query = pageToken
      ? `${resourcePath}${separator}pageSize=100&pageToken=${encodeURIComponent(pageToken)}`
      : `${resourcePath}${separator}pageSize=100`;
    const body = await apphostingFetch(query);
    items.push(...(body[fieldName] ?? []));
    pageToken = body.nextPageToken ?? "";
  } while (pageToken);
  return items;
}

async function nextBuildId() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const prefix = `build-${year}-${month}-${day}-`;
  const base = `projects/${PROJECT}/locations/${LOCATION}/backends/${BACKEND}`;
  const [builds, rollouts] = await Promise.all([
    listAll(`${base}/builds`, "builds"),
    listAll(`${base}/rollouts`, "rollouts"),
  ]);
  let highest = 0;
  for (const item of [...builds, ...rollouts]) {
    const id = String(item.name ?? "").split("/").pop() ?? "";
    if (!id.startsWith(prefix)) {
      continue;
    }
    const serial = Number(id.slice(prefix.length));
    if (Number.isFinite(serial)) {
      highest = Math.max(highest, serial);
    }
  }
  return `${prefix}${String(highest + 1).padStart(3, "0")}`;
}

async function pollOperation(operationName) {
  log(`Polling operation ${operationName}`);
  const deadline = Date.now() + 25 * 60 * 1000;
  while (Date.now() < deadline) {
    const body = await apphostingFetch(operationName);
    if (body.done) {
      if (body.error) {
        throw new Error(`Operation ${operationName} failed: ${JSON.stringify(body.error)}`);
      }
      return body.response ?? body;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`Timed out waiting for operation ${operationName}`);
}

async function createArchive() {
  const firebaseJson = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "firebase.json"), "utf8")
  );
  const apphosting = firebaseJson.apphosting;
  const ignore = [
    ...(apphosting.ignore ?? []),
    "out",
    ".next",
    ".turbo",
    "coverage",
    "dist",
    "*.log",
    "*.tsbuildinfo",
    "*temp_prompt.txt",
  ];
  const config = {
    backendId: BACKEND,
    rootDir: apphosting.rootDir ?? "apps/web",
    ignore,
  };
  const tmpZip = await createSourceDeployArchive(config, REPO_ROOT);
  const archivePath = path.join(artifactDir, `${BACKEND}-${runId}.zip`);
  fs.copyFileSync(tmpZip, archivePath);
  const stats = fs.statSync(archivePath);
  log(`Created source archive ${archivePath} (${stats.size} bytes)`);
  return { archivePath, rootDirectory: config.rootDir };
}

function uploadArchive(archivePath) {
  const objectName = path.basename(archivePath);
  const destination = `gs://${BUCKET}/${objectName}`;
  run("gcloud", [
    "storage",
    "cp",
    archivePath,
    destination,
    `--project=${PROJECT}`,
  ]);
  return destination;
}

async function validateRollout(buildId, rolloutBody) {
  const base = `projects/${PROJECT}/locations/${LOCATION}/backends/${BACKEND}/rollouts`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await apphostingFetch(
        `${base}?rolloutId=${encodeURIComponent(buildId)}&validateOnly=true`,
        {
          method: "POST",
          body: JSON.stringify(rolloutBody),
        }
      );
      return;
    } catch (error) {
      if (attempt === 5) {
        throw error;
      }
      log(`validateOnly rollout not ready yet (attempt ${attempt}); retrying`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function createBuildAndRollout(userStorageUri, rootDirectory) {
  const buildId = await nextBuildId();
  const base = `projects/${PROJECT}/locations/${LOCATION}/backends/${BACKEND}`;
  const buildInput = {
    source: {
      archive: {
        userStorageUri,
        rootDirectory,
        locallyBuiltSource: false,
      },
    },
    labels: {
      "deployment-tool": "codex-gcloud-rest",
    },
  };
  log(`Creating build ${buildId}`);
  const buildOperation = await apphostingFetch(
    `${base}/builds?buildId=${encodeURIComponent(buildId)}`,
    {
      method: "POST",
      body: JSON.stringify(buildInput),
    }
  );
  const rolloutBody = {
    build: `${base}/builds/${buildId}`,
    labels: {
      "deployment-tool": "codex-gcloud-rest",
    },
  };
  await validateRollout(buildId, rolloutBody);
  log(`Creating rollout ${buildId}`);
  const rolloutOperation = await apphostingFetch(
    `${base}/rollouts?rolloutId=${encodeURIComponent(buildId)}&validateOnly=false`,
    {
      method: "POST",
      body: JSON.stringify(rolloutBody),
    }
  );
  const [build, rollout] = await Promise.all([
    pollOperation(buildOperation.name),
    pollOperation(rolloutOperation.name),
  ]);
  if (build.state !== "READY") {
    throw new Error(
      `Build ${buildId} finished with state=${build.state}; logs=${build.buildLogsUri ?? "(none)"}`
    );
  }
  log(`Build ${buildId} READY`);
  log(`Rollout ${buildId} completed`);
  return { buildId, build, rollout };
}

function demoAccessCookie() {
  const token = run("gcloud", [
    "secrets",
    "versions",
    "access",
    "latest",
    "--secret=demo-access-token",
    `--project=${PROJECT}`,
  ], { redactStdout: true });
  const sig = crypto.createHmac("sha256", token).update(token).digest("hex");
  return `roleplay_api_access=${sig}`;
}

async function fetchProdSession() {
  const cookie = demoAccessCookie();
  const response = await fetch(`${APPHOSTING_BASE_URL}/api/v3/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: APPHOSTING_BASE_URL,
      referer: `${APPHOSTING_BASE_URL}/demo/adecco-roleplay-v3`,
      cookie,
    },
    body: "{}",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`prod /api/v3/session failed: ${response.status} ${text}`);
  }
  return JSON.parse(text);
}

function warmTtsCache() {
  if (!fs.existsSync(TSX_CLI_PATH)) {
    throw new Error(`tsx CLI not found at ${TSX_CLI_PATH}`);
  }
  const xaiKey = run("gcloud", [
    "secrets",
    "versions",
    "access",
    "latest",
    "--secret=XAI_API_KEY",
    `--project=${PROJECT}`,
  ], { redactStdout: true });
  run(process.execPath, [TSX_CLI_PATH, path.join(REPO_ROOT, "scripts", "grok-voice-warm-tts-cache.ts")], {
    env: {
      ...process.env,
      FIREBASE_PROJECT_ID: PROJECT,
      GOOGLE_CLOUD_PROJECT: PROJECT,
      GCLOUD_PROJECT: PROJECT,
      XAI_API_KEY: xaiKey,
    },
    shell: false,
  });
}

async function main() {
  log(`target_project=${PROJECT} backend=${BACKEND} url=${APPHOSTING_BASE_URL}`);
  const baselineRollouts = await listAll(
    `projects/${PROJECT}/locations/${LOCATION}/backends/${BACKEND}/rollouts`,
    "rollouts"
  );
  baselineRollouts.sort((a, b) => String(b.createTime).localeCompare(String(a.createTime)));
  const baselineSession = await fetchProdSession().catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  log(
    `baseline rollout=${baselineRollouts[0]?.name?.split("/").pop() ?? "(none)"} guardrailVersion=${baselineSession.guardrailVersion ?? "(unavailable)"}`
  );

  const { archivePath, rootDirectory } = await createArchive();
  const userStorageUri = uploadArchive(archivePath);
  const deployment = await createBuildAndRollout(userStorageUri, rootDirectory);

  log("Warming Grok registered-speech/TTS cache");
  warmTtsCache();

  const prodSession = await fetchProdSession();
  log(
    `post-deploy guardrailVersion=${prodSession.guardrailVersion} promptVersion=${prodSession.promptVersion} strictSanitizedPlayback=${prodSession.strictSanitizedPlayback}`
  );

  const summary = {
    status: "completed",
    project: PROJECT,
    backend: BACKEND,
    location: LOCATION,
    buildId: deployment.buildId,
    buildName: deployment.build.name,
    rolloutName: deployment.rollout.name,
    userStorageUri,
    archivePath,
    deploymentLogPath: logPath,
    summaryPath,
    prodSession: {
      demoSlug: prodSession.demoSlug,
      routerVariant: prodSession.routerVariant,
      guardrailVersion: prodSession.guardrailVersion,
      promptVersion: prodSession.promptVersion,
      strictSanitizedPlayback: prodSession.strictSanitizedPlayback,
    },
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  log(`Summary written to ${summaryPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  log(`FAILED: ${message}`);
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        status: "failed",
        error: message,
        deploymentLogPath: logPath,
        summaryPath,
        elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
      },
      null,
      2
    )
  );
  process.exit(1);
});
