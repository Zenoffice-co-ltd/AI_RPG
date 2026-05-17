#!/usr/bin/env node

// Firebase App Hosting deploy path that avoids Firebase CLI auth and uses the
// active gcloud account instead:
//   1. build the same source zip shape Firebase Tools uses
//   2. upload it with `gcloud storage cp`
//   3. create an App Hosting build + rollout through the public API
//   4. optionally warm the Grok locked-response cache and verify the production session
//
// Defaults deploy the shared Adecco roleplay backend. Use the vFinal flags for
// the submitted no-key App Hosting backend:
//   node scripts/deploy-adecco-roleplay-gcloud.mjs \
//     --backend adecco-roleplay-vfinal \
//     --url https://adecco-roleplay-vfinal--adecco-mendan.asia-east1.hosted.app \
//     --config apps/web/apphosting.vfinal.yaml \
//     --verify vfinal \
//     --skip-tts-warm

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
const API_VERSION = "v1beta";
const BUCKET = `firebaseapphosting-sources-${PROJECT_NUMBER}-${LOCATION}`;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_ROOT = path.join(REPO_ROOT, "out", "adecco_roleplay_gcloud_deploy");
const TSX_CLI_PATH = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const KNOWN_FLAGS = new Set([
  "backend",
  "url",
  "config",
  "verify",
  "skip-tts-warm",
  "skip-warm",
  "variant",
  "preflight-build",
  "strict-archive",
]);

const args = parseArgs(process.argv.slice(2));
const BACKEND = getArg("backend", "adecco-roleplay");
const APPHOSTING_BASE_URL = getArg("url", "https://roleplay.mendan.biz").replace(/\/$/, "");
const APPHOSTING_CONFIG_SOURCE = args.get("config") ?? "";
const VERIFY_MODE = getArg("verify", "grok-v3");
const SKIP_TTS_WARM = args.has("skip-tts-warm") || args.has("skip-warm");
const VARIANT = getArg("variant", "v3");
const PREFLIGHT_BUILD = args.has("preflight-build");
const STRICT_ARCHIVE = args.has("strict-archive");

const VARIANT_SESSION_TARGETS = {
  v3: {
    route: "/demo/adecco-roleplay-v3",
    apiPath: "/api/v3/session",
    expectedBackend: "grok-first-v3",
  },
  "v50-7": {
    route: "/demo/adecco-roleplay-v50-7",
    apiPath: "/api/grok-first-v50-7/session",
    expectedBackend: "grok-first-v50-7",
    expectedPromptVersion: "grok-first-v50.6-2026-05-15",
    expectedGuardrailVersion: "grok-first-v50.7-speed-hotfix-2026-05-17",
    expectedRuntimeGuardrailsEnabled: true,
    expectedLatencyMode: "fastest_streaming",
    expectedStreamAudioBeforeDone: true,
    expectedTurnDetectionSilenceMs: 350,
    expectedNormalInputRouterEnabled: false,
    expectedBoundedRewriteEnabled: false,
  },
  "v50-7-prompt-only": {
    route: "/demo/adecco-roleplay-v50-7-prompt-only",
    apiPath: "/api/grok-first-v50-7-prompt-only/session",
    expectedBackend: "grok-first-v50-7-prompt-only",
    expectedPromptVersion: "grok-first-v50.7.2-natural-interactive-sales-compact-2026-05-17",
    expectedGuardrailVersion: "prompt-only-no-runtime-guard-2026-05-17",
    expectedRuntimeGuardrailsEnabled: false,
    expectedInputGuardEnabled: false,
    expectedNegativeGuardEnabled: false,
    expectedTailGuardEnabled: false,
    expectedFixedGuardAudioEnabled: false,
    expectedNoiseIgnoredEnabled: false,
    expectedTurnDetectionSilenceMs: 650,
    expectedNormalInputRouterEnabled: false,
    expectedBoundedRewriteEnabled: false,
  },
  "v50-7-quality": {
    route: "/demo/adecco-roleplay-v50-7-quality",
    apiPath: "/api/grok-first-v50-7-quality/session",
    expectedBackend: "grok-first-v50-7-quality",
    expectedPromptVersion: "grok-first-v50.7.2-natural-interactive-sales-compact-2026-05-17",
    expectedGuardrailVersion: "grok-first-v50.7-quality-guard-2026-05-17",
    expectedRuntimeGuardrailsEnabled: true,
    expectedInputGuardEnabled: true,
    expectedNegativeGuardEnabled: true,
    expectedTailGuardEnabled: true,
    expectedFixedGuardAudioEnabled: true,
    expectedNoiseIgnoredEnabled: true,
    expectedTurnDetectionSilenceMs: 650,
    expectedNormalInputRouterEnabled: true,
    expectedBoundedRewriteEnabled: true,
    expectedLatencyMode: "default",
    expectedStreamAudioBeforeDone: false,
  },
  "v50-8": {
    route: "/demo/adecco-roleplay-v50-8",
    apiPath: "/api/grok-first-v50-8/session",
    expectedBackend: "grok-first-v50-8",
    expectedPromptVersion: "grok-first-v50.6-2026-05-15",
    expectedGuardrailVersion: "grok-first-v50.8-guard-2026-05-16",
    expectedRuntimeGuardrailsEnabled: true,
  },
};

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
    const [rawName, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    const name = rawName;
    if (!name) {
      throw new Error("Empty flag name");
    }
    if (!KNOWN_FLAGS.has(name)) {
      throw new Error(
        `Unknown flag --${name}. Supported flags: ${[...KNOWN_FLAGS]
          .sort()
          .map((flag) => `--${flag}`)
          .join(", ")}`
      );
    }
    if (inlineValue !== undefined) {
      parsed.set(name, inlineValue);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed.set(name, "true");
      continue;
    }
    parsed.set(name, next);
    index += 1;
  }
  return parsed;
}

function getArg(name, fallback) {
  const value = args.get(name);
  return value && value !== "true" ? value : fallback;
}

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

async function findActiveDeployment() {
  const base = `projects/${PROJECT}/locations/${LOCATION}/backends/${BACKEND}`;
  const [builds, rollouts] = await Promise.all([
    listAll(`${base}/builds`, "builds"),
    listAll(`${base}/rollouts`, "rollouts"),
  ]);
  const activeBuild = builds
    .filter((build) => ["BUILDING", "DEPLOYING"].includes(build.state))
    .sort((a, b) => String(b.createTime).localeCompare(String(a.createTime)))[0];
  const activeRollout = rollouts
    .filter((rollout) => ["QUEUED", "PROGRESSING"].includes(rollout.state))
    .sort((a, b) => String(b.createTime).localeCompare(String(a.createTime)))[0];
  if (!activeBuild && !activeRollout) return null;
  return {
    buildId: activeBuild?.name?.split("/").pop() ?? "",
    buildState: activeBuild?.state ?? "",
    rolloutId: activeRollout?.name?.split("/").pop() ?? "",
    rolloutState: activeRollout?.state ?? "",
  };
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
  const rootDir = apphosting.rootDir ?? "apps/web";
  const ignore = [
    ...(apphosting.ignore ?? []),
    "out",
    "outputs",
    "artifacts",
    ".codex_tmp",
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
    rootDir,
    ignore,
  };
  const apphostingYamlPath = path.join(REPO_ROOT, rootDir, "apphosting.yaml");
  let originalApphostingYaml = null;
  if (APPHOSTING_CONFIG_SOURCE) {
    const configSourcePath = path.resolve(REPO_ROOT, APPHOSTING_CONFIG_SOURCE);
    if (!fs.existsSync(configSourcePath)) {
      throw new Error(`App Hosting config override not found: ${configSourcePath}`);
    }
    originalApphostingYaml = fs.readFileSync(apphostingYamlPath, "utf8");
    fs.copyFileSync(configSourcePath, apphostingYamlPath);
    log(`Using App Hosting config override ${path.relative(REPO_ROOT, configSourcePath)}`);
  }
  let tmpZip;
  try {
    tmpZip = await createSourceDeployArchive(config, REPO_ROOT);
  } finally {
    if (originalApphostingYaml !== null) {
      fs.writeFileSync(apphostingYamlPath, originalApphostingYaml);
    }
  }
  const archivePath = path.join(artifactDir, `${BACKEND}-${runId}.zip`);
  fs.copyFileSync(tmpZip, archivePath);
  const stats = fs.statSync(archivePath);
  const manifest = buildArchiveManifest(archivePath);
  const manifestPath = path.join(artifactDir, "archive-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  if (manifest.suspiciousEntries.length > 0) {
    const message = `Archive contains suspicious entries: ${manifest.suspiciousEntries
      .slice(0, 12)
      .join(", ")}${manifest.suspiciousEntries.length > 12 ? " ..." : ""}`;
    if (STRICT_ARCHIVE) {
      throw new Error(`${message}; rerun without --strict-archive to warn only`);
    }
    log(`WARNING: ${message}`);
  }
  log(`Created source archive ${archivePath} (${stats.size} bytes)`);
  log(`Archive manifest ${manifestPath}`);
  return { archivePath, rootDirectory: config.rootDir, manifestPath, manifest };
}

function buildArchiveManifest(archivePath) {
  const entries = listArchiveEntries(archivePath);
  const suspiciousPatterns = [
    /^\.codex_tmp\//,
    /^out\//,
    /^outputs\//,
    /^artifacts\//,
    /^apps\/web\/\.next\//,
    /^apps\/web\/\.turbo\//,
  ];
  const suspiciousEntries = entries.filter((entry) =>
    suspiciousPatterns.some((pattern) => pattern.test(entry))
  );
  return {
    archivePath,
    entriesListed: entries.length,
    suspiciousEntries,
    topLevelEntries: [
      ...new Set(entries.map((entry) => entry.split("/")[0]).filter(Boolean)),
    ].sort(),
  };
}

function listArchiveEntries(archivePath) {
  const result = spawnSync("tar", ["-tf", archivePath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return [];
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, "/"))
    .filter(Boolean);
}

function runPreflightBuild() {
  if (!PREFLIGHT_BUILD) {
    log("Skipping local preflight build (pass --preflight-build to run it)");
    return;
  }
  run("corepack", ["pnpm", "--filter", "@top-performer/web", "build"]);
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
  let buildOperation;
  try {
    buildOperation = await apphostingFetch(
      `${base}/builds?buildId=${encodeURIComponent(buildId)}`,
      {
        method: "POST",
        body: JSON.stringify(buildInput),
      }
    );
  } catch (error) {
    const active = await findActiveDeployment().catch(() => null);
    if (active) {
      log(
        `Active App Hosting deployment detected after create-build failure: build=${active.buildId || "(none)"} state=${active.buildState || "(none)"} rollout=${active.rolloutId || "(none)"} state=${active.rolloutState || "(none)"}`
      );
    }
    throw error;
  }
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

async function fetchProdSession(variant = VARIANT) {
  const target = VARIANT_SESSION_TARGETS[variant];
  if (!target) {
    throw new Error(
      `Unsupported --variant ${variant}; expected one of ${Object.keys(VARIANT_SESSION_TARGETS).join(", ")}`
    );
  }
  const cookie = demoAccessCookie();
  const response = await fetch(`${APPHOSTING_BASE_URL}${target.apiPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: APPHOSTING_BASE_URL,
      referer: `${APPHOSTING_BASE_URL}${target.route}`,
      cookie,
    },
    body: "{}",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`prod ${target.apiPath} failed: ${response.status} ${text}`);
  }
  const payload = JSON.parse(text);
  if (target.expectedBackend && payload.backend && payload.backend !== target.expectedBackend) {
    throw new Error(
      `prod ${target.apiPath} backend mismatch: expected ${target.expectedBackend}, got ${payload.backend}`
    );
  }
  if (
    target.expectedPromptVersion &&
    payload.promptVersion !== target.expectedPromptVersion
  ) {
    throw new Error(
      `prod ${target.apiPath} promptVersion mismatch: expected ${target.expectedPromptVersion}, got ${payload.promptVersion}`
    );
  }
  if (
    target.expectedGuardrailVersion &&
    payload.guardrailVersion !== target.expectedGuardrailVersion
  ) {
    throw new Error(
      `prod ${target.apiPath} guardrailVersion mismatch: expected ${target.expectedGuardrailVersion}, got ${payload.guardrailVersion}`
    );
  }
  if (
    typeof target.expectedRuntimeGuardrailsEnabled === "boolean" &&
    payload.runtimeGuardrailsEnabled !== target.expectedRuntimeGuardrailsEnabled
  ) {
    throw new Error(
      `prod ${target.apiPath} runtimeGuardrailsEnabled mismatch: expected ${target.expectedRuntimeGuardrailsEnabled}, got ${payload.runtimeGuardrailsEnabled}`
    );
  }
  for (const [field, expectedValue] of [
    ["inputGuardEnabled", target.expectedInputGuardEnabled],
    ["negativeGuardEnabled", target.expectedNegativeGuardEnabled],
    ["tailGuardEnabled", target.expectedTailGuardEnabled],
    ["fixedGuardAudioEnabled", target.expectedFixedGuardAudioEnabled],
    ["noiseIgnoredEnabled", target.expectedNoiseIgnoredEnabled],
  ]) {
    if (typeof expectedValue === "boolean" && payload[field] !== expectedValue) {
      throw new Error(
        `prod ${target.apiPath} ${field} mismatch: expected ${expectedValue}, got ${payload[field]}`
      );
    }
  }
  if (
    target.expectedLatencyMode &&
    payload.latencyMode !== target.expectedLatencyMode
  ) {
    throw new Error(
      `prod ${target.apiPath} latencyMode mismatch: expected ${target.expectedLatencyMode}, got ${payload.latencyMode}`
    );
  }
  if (
    typeof target.expectedStreamAudioBeforeDone === "boolean" &&
    payload.streamAudioBeforeDone !== target.expectedStreamAudioBeforeDone
  ) {
    throw new Error(
      `prod ${target.apiPath} streamAudioBeforeDone mismatch: expected ${target.expectedStreamAudioBeforeDone}, got ${payload.streamAudioBeforeDone}`
    );
  }
  if (
    typeof target.expectedTurnDetectionSilenceMs === "number" &&
    payload.turnDetection?.silence_duration_ms !==
      target.expectedTurnDetectionSilenceMs
  ) {
    throw new Error(
      `prod ${target.apiPath} turnDetection.silence_duration_ms mismatch: expected ${target.expectedTurnDetectionSilenceMs}, got ${payload.turnDetection?.silence_duration_ms}`
    );
  }
  if (
    typeof target.expectedNormalInputRouterEnabled === "boolean" &&
    payload.normalInputRouterEnabled !== target.expectedNormalInputRouterEnabled
  ) {
    throw new Error(
      `prod ${target.apiPath} normalInputRouterEnabled mismatch: expected ${target.expectedNormalInputRouterEnabled}, got ${payload.normalInputRouterEnabled}`
    );
  }
  if (
    typeof target.expectedBoundedRewriteEnabled === "boolean" &&
    payload.boundedRewriteEnabled !== target.expectedBoundedRewriteEnabled
  ) {
    throw new Error(
      `prod ${target.apiPath} boundedRewriteEnabled mismatch: expected ${target.expectedBoundedRewriteEnabled}, got ${payload.boundedRewriteEnabled}`
    );
  }
  return { ...payload, postCheckVariant: variant, postCheckApiPath: target.apiPath };
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

function accessSecret(secretName) {
  return run("gcloud", [
    "secrets",
    "versions",
    "access",
    "latest",
    `--secret=${secretName}`,
    `--project=${PROJECT}`,
  ], { redactStdout: true }).trim();
}

function signVFinalInvite(input) {
  const secret = input.signingSecret.trim();
  if (secret.length < 32) {
    throw new Error("vFinal invite signing secret is unavailable or too short");
  }
  const payload = {
    participantId: input.participantId,
    tenant: "adecco",
    purpose: "ai_roleplay",
    exp: input.exp,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `mvi1.${encoded}.${signature}`;
}

function cookieHeaderFromSetCookie(headers) {
  const setCookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : String(headers.get("set-cookie") ?? "").split(/,(?=\s*[^;,]+=)/);
  const cookies = [];
  for (const line of setCookies) {
    const first = String(line).split(";")[0]?.trim();
    if (first) cookies.push(first);
  }
  return cookies.join("; ");
}

async function fetchVFinalSession() {
  const signingSecret = accessSecret("GROK_FIRST_VFINAL_INVITE_SIGNING_SECRET");
  const participantId = `codex-vfinal-${runId}`;
  const exp = Math.floor(Date.now() / 1000) + 20 * 60;
  const invite = signVFinalInvite({ participantId, exp, signingSecret });
  const consumeResponse = await fetch(
    `${APPHOSTING_BASE_URL}/api/grok-first-vFinal/invite/consume`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: APPHOSTING_BASE_URL,
      },
      body: JSON.stringify({ invite }),
      redirect: "manual",
    }
  );
  const cookie = cookieHeaderFromSetCookie(consumeResponse.headers);
  if (consumeResponse.status !== 307 || !cookie.includes("roleplay_vfinal_api_access=")) {
    throw new Error(
      `vFinal invite consume failed: status=${consumeResponse.status} apiCookie=${cookie.includes("roleplay_vfinal_api_access=")}`
    );
  }
  const sessionResponse = await fetch(
    `${APPHOSTING_BASE_URL}/api/grok-first-vFinal/session`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: APPHOSTING_BASE_URL,
        referer: `${APPHOSTING_BASE_URL}/demo/adecco-roleplay-vFinal`,
        cookie,
      },
      body: "{}",
    }
  );
  const text = await sessionResponse.text();
  if (!sessionResponse.ok) {
    throw new Error(`vFinal /session failed: ${sessionResponse.status} ${text}`);
  }
  const body = JSON.parse(text);
  const serialized = JSON.stringify(body);
  const forbidden = [
    "instructions",
    "firstMessage",
    "hiddenAssistantHistory",
    "ephemeralToken",
    "XAI_API_KEY",
    "transcript",
    "audioBase64",
    "tools",
  ].filter((needle) => serialized.includes(needle));
  if (forbidden.length > 0) {
    throw new Error(`vFinal session response includes forbidden keys: ${forbidden.join(", ")}`);
  }
  if (body.demoSlug !== "adecco-roleplay-vFinal" || body.backend !== "grok-first-vFinal") {
    throw new Error(
      `vFinal session identity mismatch: demoSlug=${body.demoSlug} backend=${body.backend}`
    );
  }
  if (body.wsUrl !== "wss://voice.mendan.biz/api/v3/realtime-relay") {
    throw new Error(`vFinal wsUrl mismatch: ${body.wsUrl}`);
  }
  log(
    `vFinal smoke consumeStatus=${consumeResponse.status} sessionStatus=${sessionResponse.status} demoSlug=${body.demoSlug} backend=${body.backend} wsUrl=${body.wsUrl}`
  );
  return body;
}

async function main() {
  log(
    `target_project=${PROJECT} backend=${BACKEND} url=${APPHOSTING_BASE_URL} verify=${VERIFY_MODE} variant=${VARIANT} skipTtsWarm=${SKIP_TTS_WARM}`
  );
  const baselineRollouts = await listAll(
    `projects/${PROJECT}/locations/${LOCATION}/backends/${BACKEND}/rollouts`,
    "rollouts"
  );
  baselineRollouts.sort((a, b) => String(b.createTime).localeCompare(String(a.createTime)));
  const fetchSession =
    VERIFY_MODE === "vfinal" ? fetchVFinalSession : () => fetchProdSession(VARIANT);
  const baselineSession = await fetchSession().catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  log(
    `baseline rollout=${baselineRollouts[0]?.name?.split("/").pop() ?? "(none)"} guardrailVersion=${baselineSession.guardrailVersion ?? "(unavailable)"}`
  );

  const active = await findActiveDeployment();
  if (active) {
    throw new Error(
      `Another App Hosting deployment is already in flight: build=${active.buildId || "(none)"} state=${active.buildState || "(none)"} rollout=${active.rolloutId || "(none)"} state=${active.rolloutState || "(none)"}`
    );
  }

  runPreflightBuild();
  const { archivePath, rootDirectory, manifestPath, manifest } = await createArchive();
  const userStorageUri = uploadArchive(archivePath);
  const deployment = await createBuildAndRollout(userStorageUri, rootDirectory);

  if (SKIP_TTS_WARM) {
    log("Skipping Grok registered-speech/TTS cache warm");
  } else {
    log("Warming Grok registered-speech/TTS cache");
    warmTtsCache();
  }

  const prodSession = await fetchSession();
  if (VERIFY_MODE === "vfinal") {
    log(
      `post-deploy vFinal promptVersion=${prodSession.promptVersion} guardrailVersion=${prodSession.guardrailVersion} realtimeTransport=${prodSession.realtimeTransport}`
    );
  } else {
    log(
      `post-deploy variant=${prodSession.postCheckVariant} apiPath=${prodSession.postCheckApiPath} backend=${prodSession.backend ?? "(unavailable)"} guardrailVersion=${prodSession.guardrailVersion} promptVersion=${prodSession.promptVersion} strictSanitizedPlayback=${prodSession.strictSanitizedPlayback}`
    );
  }

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
    archiveManifestPath: manifestPath,
    archiveSuspiciousEntryCount: manifest.suspiciousEntries.length,
    deploymentLogPath: logPath,
    summaryPath,
    prodSession: {
      demoSlug: prodSession.demoSlug,
      backend: prodSession.backend,
      routerVariant: prodSession.routerVariant,
      postCheckVariant: prodSession.postCheckVariant,
      postCheckApiPath: prodSession.postCheckApiPath,
      guardrailVersion: prodSession.guardrailVersion,
      promptVersion: prodSession.promptVersion,
      runtimeGuardrailsEnabled: prodSession.runtimeGuardrailsEnabled,
      realtimeTransport: prodSession.realtimeTransport,
      wsUrl: prodSession.wsUrl,
      strictSanitizedPlayback: prodSession.strictSanitizedPlayback,
    },
    ttsWarmSkipped: SKIP_TTS_WARM,
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
