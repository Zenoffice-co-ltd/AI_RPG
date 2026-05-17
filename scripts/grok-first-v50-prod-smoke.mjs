// Production browser smoke for Grok-first v50-family routes.
//
// Usage:
//   node scripts/grok-first-v50-prod-smoke.mjs --variant v50-7 --mode session
//   node scripts/grok-first-v50-prod-smoke.mjs --variant v50-7 --mode start
//   node scripts/grok-first-v50-prod-smoke.mjs --variant v50-7 --mode voice-turn

import crypto from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveSecretValue } from "./lib/secret-resolver.mjs";

const args = parseArgs(process.argv.slice(2));
const variant = stringArg(args.variant, "v50-7");
const mode = stringArg(args.mode, "start");
const origin = stringArg(args.origin, "https://roleplay.mendan.biz");
const project = stringArg(args.project, "adecco-mendan");
const demoSlug = variant.startsWith("adecco-roleplay-")
  ? variant
  : `adecco-roleplay-${variant}`;
const apiBase = `/api/grok-first-${variant}`;
const url = `${origin}/demo/${demoSlug}?debugMetrics=1`;
const expectedPromptVersion = stringArg(
  args["expected-prompt-version"],
  "grok-first-v50.6-2026-05-15"
);
const expectedGuardrailVersion = stringArg(
  args["expected-guardrail-version"],
  variant === "v50-8"
    ? "grok-first-v50.8-guard-2026-05-16"
    : "grok-first-v50.7-guard-2026-05-15"
);
const expectedRuntimeGuardrailsEnabled = booleanArg(
  args["expected-runtime-guardrails-enabled"],
  variant !== "v50-7"
);
const fixture = path.resolve(
  stringArg(
    args.fixture,
    "test/fixtures/audio/grok-voice-v21/voice_case1_shallow_background.wav"
  )
);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.resolve(
  stringArg(args.out, path.join("out", "grok_first_v50_prod_smoke", timestamp))
);
mkdirSync(outDir, { recursive: true });

const evidence = {
  mode,
  url,
  demoSlug,
  apiBase,
  fixture: mode === "voice-turn" ? fixture : null,
  startedAt: new Date().toISOString(),
  sessionResponse: null,
  sessionPayload: null,
  sessionId: null,
  eventSessionIds: [],
  eventKinds: [],
  websocketUrls: [],
  console: [],
  pageErrors: [],
  texts: [],
  metrics: [],
  screenshots: {},
};

const accessToken = resolveAccessToken(project);

if (mode === "session") {
  await runSessionContractSmoke();
} else {
  await runBrowserSmoke();
}

console.log(JSON.stringify(evidence, null, 2));
process.exitCode = evidence.pass ? 0 : 1;

async function runBrowserSmoke() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      ...(mode === "voice-turn" ? [`--use-file-for-fake-audio-capture=${fixture}`] : []),
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  try {
    const context = await browser.newContext({
    baseURL: origin,
    permissions: ["microphone"],
  });
  await context.grantPermissions(["microphone"], { origin });
  const page = await context.newPage();

  await page.addInitScript((apiBaseArg) => {
    window.__gfv50Events = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...fetchArgs) => {
      try {
        const [input, init] = fetchArgs;
        const requestUrl =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        if (requestUrl.includes(`${apiBaseArg}/event`)) {
          const body = init?.body;
          if (typeof body === "string") {
            window.__gfv50Events.push(JSON.parse(body));
          }
        }
      } catch {
        // Browser evidence should never fail because event capture failed.
      }
      return originalFetch(...fetchArgs);
    };
  }, apiBase);

  page.on("console", (message) => {
    evidence.console.push({ type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => evidence.pageErrors.push(error.message));
  page.on("websocket", (ws) => evidence.websocketUrls.push(ws.url()));
  page.on("request", (request) => {
    if (!request.url().includes(`${apiBase}/event`)) return;
    const raw = request.postData();
    if (!raw) return;
    try {
      const body = JSON.parse(raw);
      if (body?.sessionId && !evidence.eventSessionIds.includes(body.sessionId)) {
        evidence.eventSessionIds.push(body.sessionId);
      }
      if (body?.kind) evidence.eventKinds.push(body.kind);
      if (body?.kind === "turn.completed") evidence.metrics.push(body.details);
    } catch {
      evidence.eventKinds.push("event.parse_failed");
    }
  });
  page.on("response", async (response) => {
    if (!response.url().includes(`${apiBase}/session`)) return;
    evidence.sessionResponse = { status: response.status(), ok: response.ok() };
    try {
      const json = await response.json();
      evidence.sessionPayload = summarizeSessionPayload(json);
      evidence.sessionId = json.sessionId ?? evidence.sessionId;
    } catch (error) {
      evidence.sessionPayload = { parseError: error.message };
    }
  });

  await page.goto(url, { waitUntil: "networkidle" });
  const accessInput = page.getByLabel("アクセスコード");
  if (await accessInput.isVisible().catch(() => false)) {
    await accessInput.fill(accessToken);
    await Promise.all([
      page.waitForURL(new RegExp(`/demo/${demoSlug}`), { timeout: 30000 }),
      page.getByRole("button", { name: "開始" }).click(),
    ]);
  }
  await page.waitForSelector('[data-testid="roleplay-header"]', { timeout: 30000 });
  await page.getByRole("button", { name: "通話を開始" }).click();

  await page.waitForFunction(
    () => document.body.innerText.includes("お電話ありがとうございます。"),
    null,
    { timeout: 30000 }
  ).catch(() => undefined);

  if (mode === "voice-turn") {
    await page.waitForFunction(
      () => {
        const events = window.__gfv50Events ?? [];
        return (
          document.body.innerText.includes("セッションの開始に失敗しました") ||
          events.some((event) => event.kind === "turn.completed")
        );
      },
      null,
      { timeout: 120000 }
    ).catch(() => undefined);
  } else {
    await page.waitForFunction(
      () => {
        const events = window.__gfv50Events ?? [];
        return (
          document.body.innerText.includes("セッションの開始に失敗しました") ||
          events.includes?.("session.ready") ||
          events.some?.((event) => event.kind === "session.ready")
        );
      },
      null,
      { timeout: 45000 }
    ).catch(() => undefined);
  }

  await page.waitForTimeout(mode === "voice-turn" ? 5000 : 2000);
  evidence.texts = (await page.locator(".message-bubble, [data-testid], body").allTextContents())
    .join("\n")
    .split(/\n+/)
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(-30);
  evidence.errorTextVisible = await page
    .getByText("セッションの開始に失敗しました。時間をおいて再試行してください。")
    .isVisible()
    .catch(() => false);
  evidence.screenshots.after = path.join(outDir, "after.png");
  await page.screenshot({ path: evidence.screenshots.after, fullPage: true });
  } finally {
    evidence.completedAt = new Date().toISOString();
    const sessionOk = isSessionContractOk(evidence.sessionPayload);
    const startOk =
      evidence.eventKinds.includes("ws.connected") &&
      evidence.eventKinds.includes("session.ready") &&
      evidence.texts.some((text) => text.includes("お電話ありがとうございます。"));
    const voiceOk =
      mode !== "voice-turn" ||
      (evidence.eventKinds.includes("stt.completed") &&
        evidence.eventKinds.includes("turn.completed") &&
        evidence.metrics.some((metric) => isVoiceTurnMetricOk(metric)));
    evidence.pass = sessionOk && startOk && voiceOk && evidence.errorTextVisible === false;
    writeFileSync(path.join(outDir, "evidence.json"), JSON.stringify(evidence, null, 2));
    await browser.close();
  }
}

async function runSessionContractSmoke() {
  try {
    const payload = await fetchSessionPayload();
    evidence.completedAt = new Date().toISOString();
    evidence.sessionResponse = { status: 200, ok: true };
    evidence.sessionPayload = summarizeSessionPayload(payload);
    evidence.sessionId = payload.sessionId ?? null;
    evidence.pass = isSessionContractOk(evidence.sessionPayload);
  } catch (error) {
    evidence.completedAt = new Date().toISOString();
    evidence.sessionPayload = {
      error: error instanceof Error ? error.message : String(error),
    };
    evidence.pass = false;
  }
  writeFileSync(path.join(outDir, "evidence.json"), JSON.stringify(evidence, null, 2));
}

async function fetchSessionPayload() {
  const response = await fetch(`${origin}${apiBase}/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      referer: `${origin}/demo/${demoSlug}`,
      cookie: demoAccessCookie(accessToken),
    },
    body: "{}",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`session API failed: ${response.status} ${text}`);
  }
  return JSON.parse(text);
}

function summarizeSessionPayload(json) {
  return {
    sessionId: json.sessionId,
    demoSlug: json.demoSlug,
    backend: json.backend,
    promptVersion: json.promptVersion,
    promptHash: json.promptHash,
    guardrailVersion: json.guardrailVersion,
    model: json.model,
    voiceId: json.voiceId,
    realtimeTransport: json.realtimeTransport,
    wsUrl: json.wsUrl,
    authMode: json.realtimeAuth?.mode,
    runtimeGuardrailsEnabled: json.runtimeGuardrailsEnabled,
    runtimeTtsEnabled: json.runtimeTtsEnabled,
    replacementTtsEnabled: json.replacementTtsEnabled,
    fullTurnBufferEnabled: json.fullTurnBufferEnabled,
    turnDetectionCreateResponse: json.turnDetection?.create_response,
    registeredSpeechPayloadIncluded: json.registeredSpeechPayloadIncluded,
    lockedResponseAudioBundleIncluded: json.lockedResponseAudioBundleIncluded,
    ephemeralTokenIncluded: Object.hasOwn(json, "ephemeralToken"),
  };
}

function isSessionContractOk(payload) {
  return (
    evidence.sessionResponse?.status === 200 &&
    payload?.demoSlug === demoSlug &&
    payload?.backend === `grok-first-${variant}` &&
    payload?.promptVersion === expectedPromptVersion &&
    payload?.guardrailVersion === expectedGuardrailVersion &&
    payload?.runtimeGuardrailsEnabled === expectedRuntimeGuardrailsEnabled &&
    payload?.wsUrl === "wss://voice.mendan.biz/api/v3/realtime-relay" &&
    payload?.authMode === "mendan_relay_subprotocol" &&
    payload?.registeredSpeechPayloadIncluded === false &&
    payload?.lockedResponseAudioBundleIncluded === false &&
    payload?.ephemeralTokenIncluded === false
  );
}

function isVoiceTurnMetricOk(metric) {
  if (!metric || metric.audioBytes <= 0 || metric.error !== null) return false;
  if (variant !== "v50-7") return true;
  return (
    metric.routePath === "grok_first_realtime" &&
    metric.guardAction === "pass" &&
    Array.isArray(metric.guardReasons) &&
    metric.guardReasons.length === 0 &&
    metric.fullTurnBufferCount === 0 &&
    metric.tailAudioDroppedBytes === 0
  );
}

function demoAccessCookie(token) {
  const sig = crypto.createHmac("sha256", token).update(token).digest("hex");
  return `roleplay_api_access=${sig}`;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    if (inlineValue !== undefined) {
      out[key] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

function stringArg(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function booleanArg(value, fallback) {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function resolveAccessToken(project) {
  try {
    return resolveSecretValue({
      envName: "DEMO_ACCESS_TOKEN",
      secretNames: ["demo-access-token", "DEMO_ACCESS_TOKEN"],
      projects: [project],
      minLength: 8,
      repoRoot: path.resolve("."),
    }).value;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
