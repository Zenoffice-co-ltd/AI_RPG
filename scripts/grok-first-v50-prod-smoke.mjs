// Production browser smoke for Grok-first v50-family routes.
//
// Usage:
//   node scripts/grok-first-v50-prod-smoke.mjs --variant v50-7 --mode start
//   node scripts/grok-first-v50-prod-smoke.mjs --variant v50-7 --mode voice-turn

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

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
  variant === "v50-7" || variant === "v50-7-prompt-only"
    ? "grok-first-v50.7.1-natural-interactive-sales-2026-05-17"
    : "grok-first-v50.6-2026-05-15"
);
const expectedGuardrailVersion = stringArg(
  args["expected-guardrail-version"],
  variant === "v50-7-prompt-only"
    ? "prompt-only-no-runtime-guard-2026-05-17"
    : variant === "v50-8"
    ? "grok-first-v50.8-guard-2026-05-16"
    : "grok-first-v50.7-guard-2026-05-15"
);
const expectedOpeningText = stringArg(
  args["expected-opening-text"],
  variant === "v50-7" || variant === "v50-7-prompt-only"
    ? "本日はありがとうございます。営業事務の件で、ご相談させていただければと思っています。"
    : "お電話ありがとうございます。"
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
  eventKinds: [],
  websocketUrls: [],
  console: [],
  pageErrors: [],
  texts: [],
  metrics: [],
  screenshots: {},
};

const accessToken = resolveAccessToken(project);

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
      evidence.sessionPayload = {
        demoSlug: json.demoSlug,
        backend: json.backend,
        promptVersion: json.promptVersion,
        guardrailVersion: json.guardrailVersion,
        realtimeTransport: json.realtimeTransport,
        wsUrl: json.wsUrl,
        authMode: json.realtimeAuth?.mode,
        registeredSpeechPayloadIncluded: json.registeredSpeechPayloadIncluded,
        lockedResponseAudioBundleIncluded: json.lockedResponseAudioBundleIncluded,
      };
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
  const sessionOk =
    evidence.sessionResponse?.status === 200 &&
    evidence.sessionPayload?.demoSlug === demoSlug &&
    evidence.sessionPayload?.backend === `grok-first-${variant}` &&
    evidence.sessionPayload?.promptVersion === expectedPromptVersion &&
    evidence.sessionPayload?.guardrailVersion === expectedGuardrailVersion &&
    evidence.sessionPayload?.wsUrl === "wss://voice.mendan.biz/api/v3/realtime-relay" &&
    evidence.sessionPayload?.authMode === "mendan_relay_subprotocol";
  const startOk =
    evidence.eventKinds.includes("ws.connected") &&
    evidence.eventKinds.includes("session.ready") &&
    evidence.texts.some((text) => text.includes(expectedOpeningText));
  const voiceOk =
    mode !== "voice-turn" ||
    (evidence.eventKinds.includes("stt.completed") &&
      evidence.eventKinds.includes("turn.completed") &&
      evidence.metrics.some((metric) => metric?.audioBytes > 0 && metric?.error === null));
  evidence.pass = sessionOk && startOk && voiceOk && evidence.errorTextVisible === false;
  writeFileSync(path.join(outDir, "evidence.json"), JSON.stringify(evidence, null, 2));
  await browser.close();
}

console.log(JSON.stringify(evidence, null, 2));
process.exit(evidence.pass ? 0 : 1);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
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

function resolveAccessToken(project) {
  if (process.env.DEMO_ACCESS_TOKEN) return process.env.DEMO_ACCESS_TOKEN;
  const command = process.platform === "win32" ? "gcloud.cmd" : "gcloud";
  try {
    return execFileSync(
      command,
      [
        "secrets",
        "versions",
        "access",
        "latest",
        "--secret=demo-access-token",
        `--project=${project}`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
  } catch (error) {
    console.error("BLOCKED: DEMO_ACCESS_TOKEN not available");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
