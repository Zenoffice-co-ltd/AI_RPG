#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const args = parseArgs(process.argv.slice(2));
const BASE_URL = stringArg(args.origin, "https://adecco-roleplay-vfinal--adecco-mendan.asia-east1.hosted.app").replace(/\/$/, "");
const MODE = stringArg(args.mode, "text");
const CASE_TEXT = stringArg(args.text, "業務内容を教えてください");
const PROJECT = stringArg(args.project, "adecco-mendan");
const OUT_DIR = resolve(
  stringArg(
    args.out,
    `out/grok_first_vfinal_browser_e2e/${new Date().toISOString().replace(/[:.]/g, "-")}`
  )
);
const FIXTURE = resolve(
  stringArg(args.fixture, "test/fixtures/audio/grok-voice-v21/voice_case1_shallow_background.wav")
);

const SESSION_API = "/api/grok-first-vFinal/session";
const EVENT_API = "/api/grok-first-vFinal/event";
const CONSUME_API = "/api/grok-first-vFinal/invite/consume";
const DEMO_PATH = "/demo/adecco-roleplay-vFinal";
const ACCESS_PATH = "/demo/adecco-roleplay-vFinal/access";
const EXPECTED_WS = "wss://voice.mendan.biz/api/v3/realtime-relay";

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

async function main() {
  if (!["start", "text", "voice"].includes(MODE)) {
    throw new Error(`Unsupported mode: ${MODE}`);
  }
  const inviteSecret = resolveSecret("GROK_FIRST_VFINAL_INVITE_SIGNING_SECRET", PROJECT);
  if (!inviteSecret || inviteSecret.length < 32) {
    console.error("BLOCKED: GROK_FIRST_VFINAL_INVITE_SIGNING_SECRET not available.");
    process.exit(2);
  }
  await mkdir(OUT_DIR, { recursive: true });

  const evidence = {
    mode: MODE,
    origin: BASE_URL,
    demoPath: DEMO_PATH,
    startedAt: new Date().toISOString(),
    sessionResponse: null,
    sessionPayload: null,
    network: [],
    websocketUrls: [],
    websocketSummary: [],
    eventKinds: [],
    metrics: [],
    forbiddenSessionKeyHits: {},
    directApiXaiConnectionCount: 0,
    forbiddenOutgoingRealtimeKeys: [],
    consoleErrors: [],
    pageErrors: [],
    screenshotPath: resolve(OUT_DIR, "after.png"),
    pass: false,
    failures: [],
  };

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      ...(MODE === "voice" ? [`--use-file-for-fake-audio-capture=${FIXTURE}`] : []),
    ],
  });

  try {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      permissions: ["microphone"],
    });
    await context.grantPermissions(["microphone"], { origin: BASE_URL });
    const page = await context.newPage();

    page.on("console", (message) => {
      if (message.type() === "error") {
        evidence.consoleErrors.push(message.text().slice(0, 240));
      }
    });
    page.on("pageerror", (error) => evidence.pageErrors.push(error.message.slice(0, 240)));
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("api.x.ai")) evidence.directApiXaiConnectionCount += 1;
      if (url.includes(SESSION_API) || url.includes(EVENT_API) || url.includes(CONSUME_API)) {
        evidence.network.push({
          direction: "request",
          method: request.method(),
          path: safePath(url),
        });
      }
      if (url.includes(EVENT_API)) {
        const raw = request.postData();
        if (!raw) return;
        try {
          const body = JSON.parse(raw);
          if (body?.kind) evidence.eventKinds.push(body.kind);
          if (body?.kind === "turn.completed") {
            evidence.metrics.push(safeMetric(body.details ?? {}));
          }
        } catch {
          evidence.eventKinds.push("event.parse_failed");
        }
      }
    });
    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes(SESSION_API) || url.includes(CONSUME_API)) {
        evidence.network.push({
          direction: "response",
          status: response.status(),
          path: safePath(url),
        });
      }
      if (!url.includes(SESSION_API)) return;
      evidence.sessionResponse = { status: response.status(), ok: response.ok() };
      try {
        const json = await response.json();
        evidence.sessionPayload = {
          sessionIdPrefix: typeof json.sessionId === "string" ? json.sessionId.split("_")[0] : null,
          demoSlug: json.demoSlug,
          backend: json.backend,
          scenarioId: json.scenarioId,
          promptVersion: json.promptVersion,
          promptHash: json.promptHash,
          guardrailVersion: json.guardrailVersion,
          model: json.model,
          voiceId: json.voiceId,
          realtimeTransport: json.realtimeTransport,
          wsUrl: json.wsUrl,
          authMode: json.realtimeAuth?.mode,
          authProtocol: json.realtimeAuth?.protocol,
        };
        evidence.forbiddenSessionKeyHits = forbiddenSessionKeyHits(json);
      } catch (error) {
        evidence.sessionPayload = { parseError: String(error).slice(0, 160) };
      }
    });
    page.on("websocket", (ws) => {
      if (ws.url().includes("api.x.ai")) evidence.directApiXaiConnectionCount += 1;
      evidence.websocketUrls.push(ws.url());
      const item = {
        url: ws.url(),
        framesSent: 0,
        framesReceived: 0,
        closeObserved: false,
      };
      evidence.websocketSummary.push(item);
      ws.on("framesent", (frame) => {
        item.framesSent += 1;
        const typeSummary = summarizeOutgoingFrame(frame);
        if (typeSummary.forbidden.length > 0) {
          evidence.forbiddenOutgoingRealtimeKeys.push(typeSummary);
        }
      });
      ws.on("framereceived", () => {
        item.framesReceived += 1;
      });
      ws.on("close", () => {
        item.closeObserved = true;
      });
    });

    const invite = signInvite(inviteSecret);
    await page.goto(`${BASE_URL}${ACCESS_PATH}#invite=${invite}`, {
      waitUntil: "networkidle",
      timeout: 60_000,
    });
    await page.waitForURL(new RegExp(`${DEMO_PATH.replaceAll("/", "\\/")}`), {
      timeout: 60_000,
    }).catch(() => undefined);
    await page.waitForSelector('[data-testid="roleplay-header"]', { timeout: 60_000 });

    await ensureConversationReady(page);
    await waitForEventKind(evidence.eventKinds, "session.ready", 60_000);

    if (MODE === "text") {
      const before = evidence.metrics.length;
      await sendText(page, CASE_TEXT);
      await waitForMetric(evidence.metrics, before, "text", 120_000);
    } else if (MODE === "voice") {
      const before = evidence.metrics.length;
      await waitForMetric(evidence.metrics, before, "voice", 150_000);
    }

    await page.waitForTimeout(2_000);
    await page.screenshot({ path: evidence.screenshotPath, fullPage: true });
  } finally {
    await browser.close();
  }

  evidence.completedAt = new Date().toISOString();
  evidence.pass = evaluateEvidence(evidence);
  await writeFile(resolve(OUT_DIR, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({
    pass: evidence.pass,
    mode: evidence.mode,
    origin: evidence.origin,
    sessionStatus: evidence.sessionResponse?.status ?? null,
    sessionPayload: evidence.sessionPayload,
    eventKinds: evidence.eventKinds,
    metricCount: evidence.metrics.length,
    websocketUrls: evidence.websocketUrls,
    directApiXaiConnectionCount: evidence.directApiXaiConnectionCount,
    forbiddenSessionKeyHits: evidence.forbiddenSessionKeyHits,
    forbiddenOutgoingRealtimeKeys: evidence.forbiddenOutgoingRealtimeKeys,
    failures: evidence.failures,
    outDir: OUT_DIR,
  }, null, 2));
  process.exit(evidence.pass ? 0 : 1);
}

async function ensureConversationReady(page) {
  const start = page.locator("button[aria-label='通話を開始']");
  if (await start.isVisible({ timeout: 30_000 }).catch(() => false)) {
    await start.click();
  }
}

async function sendText(page, text) {
  const input = page.locator("textarea[aria-label='メッセージを送信']");
  const button = page.locator("button[aria-label='送信']");
  await input.click({ timeout: 15_000 });
  await input.fill("");
  await input.type(text, { delay: 5 });
  await button.waitFor({ state: "visible", timeout: 15_000 });
  await button.click();
}

async function waitForEventKind(kinds, kind, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (kinds.includes(kind)) return;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for event kind: ${kind}`);
}

async function waitForMetric(metrics, beforeCount, inputMode, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const next = metrics.slice(beforeCount).find((metric) => metric.inputMode === inputMode);
    if (next && next.agentTextLen > 0 && next.audioBytes > 0) return next;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${inputMode} turn.completed metric`);
}

function evaluateEvidence(evidence) {
  const failures = [];
  const session = evidence.sessionPayload ?? {};
  if (evidence.sessionResponse?.status !== 200) failures.push("session status is not 200");
  if (session.demoSlug !== "adecco-roleplay-vFinal") failures.push("demoSlug mismatch");
  if (session.backend !== "grok-first-vFinal") failures.push("backend mismatch");
  if (session.realtimeTransport !== "mendan_cloud_run_relay_wss") failures.push("transport mismatch");
  if (session.wsUrl !== EXPECTED_WS) failures.push("wsUrl mismatch");
  if (session.authMode !== "mendan_relay_subprotocol") failures.push("auth mode mismatch");
  if (Object.values(evidence.forbiddenSessionKeyHits ?? {}).some(Boolean)) {
    failures.push("session contains forbidden key");
  }
  if (!evidence.eventKinds.includes("session.ready")) failures.push("session.ready missing");
  if (evidence.mode !== "start" && evidence.metrics.length === 0) failures.push("turn.completed missing");
  if (evidence.websocketUrls.length === 0) failures.push("websocket missing");
  if (evidence.websocketUrls.some((url) => url !== EXPECTED_WS)) failures.push("unexpected websocket URL");
  if (evidence.directApiXaiConnectionCount !== 0) failures.push("direct api.x.ai connection observed");
  if (evidence.forbiddenOutgoingRealtimeKeys.length > 0) {
    failures.push("forbidden outgoing realtime key observed");
  }
  if (evidence.consoleErrors.length > 0) failures.push("console errors observed");
  if (evidence.pageErrors.length > 0) failures.push("page errors observed");
  evidence.failures = failures;
  return failures.length === 0;
}

function forbiddenSessionKeyHits(json) {
  const serialized = JSON.stringify(json);
  return Object.fromEntries(
    [
      "instructions",
      "firstMessage",
      "hiddenAssistantHistory",
      "ephemeralToken",
      "XAI_API_KEY",
      "transcript",
      "audioBase64",
      "tools",
    ].map((key) => [key, serialized.includes(key)])
  );
}

function summarizeOutgoingFrame(frame) {
  const payload = frame?.payload ?? frame;
  const text =
    typeof payload === "string"
      ? payload
      : Buffer.isBuffer(payload)
        ? payload.toString("utf8")
        : "";
  if (!text.startsWith("{")) return { type: "binary_or_audio", forbidden: [] };
  try {
    const parsed = JSON.parse(text);
    const serialized = JSON.stringify(parsed);
    return {
      type: parsed.type ?? "unknown",
      forbidden: ["instructions", "tools", "system", "developer"].filter((key) =>
        serialized.includes(key)
      ),
    };
  } catch {
    return { type: "json_parse_failed", forbidden: [] };
  }
}

function safeMetric(details) {
  return {
    turnIndex: details.turnIndex ?? null,
    inputMode: details.inputMode ?? null,
    routePath: details.routePath ?? null,
    guardAction: details.guardAction ?? null,
    guardReasons: Array.isArray(details.guardReasons) ? details.guardReasons : [],
    userTextLen: details.userTextLen ?? null,
    agentTextLen: details.agentTextLen ?? null,
    firstAudioDeltaMs: details.firstAudioDeltaMs ?? null,
    firstAudibleAudioMs: details.firstAudibleAudioMs ?? null,
    doneMs: details.doneMs ?? null,
    audioBytes: details.audioBytes ?? null,
    websocketReconnectCount: details.websocketReconnectCount ?? null,
    promptHash: details.promptHash ?? null,
    promptVersion: details.promptVersion ?? null,
    guardrailVersion: details.guardrailVersion ?? null,
    model: details.model ?? null,
    voiceId: details.voiceId ?? null,
  };
}

function safePath(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return "(unparseable)";
  }
}

function signInvite(secret) {
  const payload = {
    participantId: `codex-browser-e2e-${Date.now()}`,
    tenant: "adecco",
    purpose: "ai_roleplay",
    exp: Math.floor(Date.now() / 1000) + 20 * 60,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret.trim()).update(encoded).digest("base64url");
  return `mvi1.${encoded}.${signature}`;
}

function resolveSecret(name, project) {
  if (process.env[name]) return process.env[name].trim();
  const result =
    process.platform === "win32"
      ? spawnSync("powershell", [
          "-NoProfile",
          "-Command",
          `gcloud secrets versions access latest --secret=${name} --project=${project}`,
        ], { encoding: "utf8" })
      : spawnSync("gcloud", [
          "secrets",
          "versions",
          "access",
          "latest",
          `--secret=${name}`,
          `--project=${project}`,
        ], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    const next = argv[index + 1];
    parsed[key.slice(2)] = next && !next.startsWith("--") ? next : "true";
    if (next && !next.startsWith("--")) index += 1;
  }
  return parsed;
}

function stringArg(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
