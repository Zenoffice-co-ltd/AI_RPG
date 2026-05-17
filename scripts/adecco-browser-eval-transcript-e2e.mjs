#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const args = parseArgs(process.argv.slice(2));
const BASE_URL = stringArg(args["base-url"], "http://127.0.0.1:3001").replace(
  /\/$/,
  ""
);
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = resolve(
  stringArg(
    args.out,
    `out/adecco_browser_eval_transcript_e2e/${STAMP}`
  )
);
mkdirSync(OUT_DIR, { recursive: true });

const SESSION = {
  sessionId: stringArg(args["session-id"], "gfv50_local_transcript_e2e"),
  demoSlug: "adecco-roleplay-v50-7",
  backend: "grok-first-v50-7",
  scenarioId: "staffing_order_hearing_adecco_manufacturer_busy_manager_medium",
  promptVersion: "grok-first-v50.7.1-natural-interactive-sales-2026-05-17",
  promptHash: "local-e2e",
  guardrailVersion: "grok-first-v50.7-guard-2026-05-15",
  model: "grok-voice-think-fast-1.0",
  voiceId: "99c95cc8a177",
  realtimeTransport: "mendan_cloud_run_relay_wss",
  wsUrl: "wss://local-e2e.invalid/api/v3/realtime-relay",
  realtimeAuth: {
    mode: "mendan_relay_subprotocol",
    protocol: "mendan-relay-v1",
    ticket: "local-e2e-ticket",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
  audio: {
    inputFormat: "audio/pcm",
    outputFormat: "audio/pcm",
    sampleRate: 24_000,
  },
  turnDetection: {
    type: "server_vad",
    threshold: 0.65,
    silence_duration_ms: 650,
    prefix_padding_ms: 333,
  },
  tools: [],
  instructions: "local e2e instructions",
  firstMessage:
    "お電話ありがとうございます。本日はよろしくお願いいたします。",
  initialGreetingMode: "history",
  registeredSpeechPayloadIncluded: false,
  lockedResponseAudioBundleIncluded: false,
  runtimeTtsEnabled: false,
  replacementTtsEnabled: false,
  fullTurnBufferEnabled: false,
  runtimeGuardrailsEnabled: false,
  inputGuardEnabled: false,
  normalInputRouterEnabled: false,
  negativeGuardEnabled: false,
  tailGuardEnabled: false,
  fixedGuardAudioEnabled: false,
  boundedRewriteEnabled: false,
  noiseIgnoredEnabled: false,
  debugTranscriptPreviewEnabled: true,
  browserEvaluationEnabled: true,
  browserEvaluation: {
    enabled: true,
    startEndpoint: "/api/grok-first-v50-7/evaluation/start",
    resultBasePath: "/demo/adecco-roleplay-v50-7/result",
    source: "grok_first_v50_7_browser",
    runtimeVersion: "v50-7",
  },
};

await assertAppReachable();

const browser = await chromium.launch({ headless: true });
try {
  const results = [];
  results.push(await caseMissingSales(browser));
  results.push(await caseSalesSttIncluded(browser));
  const summary = {
    ok: results.every((result) => result.passed),
    baseUrl: BASE_URL,
    denominator: "2-case local browser E2E",
    outDir: OUT_DIR,
    results,
  };
  writeFileSync(
    resolve(OUT_DIR, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8"
  );
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
} finally {
  await browser.close();
}

async function assertAppReachable() {
  try {
    const response = await fetch(
      `${BASE_URL}/demo/adecco-roleplay-v50-7?fakeLive=1`
    );
    if (!response.ok) {
      throw new Error(`status=${response.status}`);
    }
  } catch (error) {
    console.error(
      `BLOCKED: local app is not reachable at ${BASE_URL}. Start a local Next server first.`
    );
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}

function installMockWebSocket() {
  const NativeWebSocket = window.WebSocket;
  window.__mockSockets = [];
  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url, protocols) {
      if (String(url).includes("/_next/webpack-hmr")) {
        return new NativeWebSocket(url, protocols);
      }
      this.url = url;
      this.protocols = protocols;
      this.readyState = MockWebSocket.CONNECTING;
      this.sent = [];
      window.__mockSockets.push(this);
      setTimeout(() => {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.({ type: "open" });
      }, 50);
    }

    send(data) {
      let parsed = null;
      try {
        parsed = JSON.parse(data);
      } catch {
        // leave parsed null
      }
      this.sent.push(parsed || data);
      if (parsed?.type === "response.create") {
        setTimeout(() => {
          this.emit({
            type: "response.created",
            response: { id: `resp_${Date.now()}` },
          });
          this.emit({
            type: "response.output_audio_transcript.delta",
            delta: "増員のための募集です。",
          });
          this.emit({
            type: "response.done",
            response: { id: `resp_${Date.now()}` },
          });
        }, 20);
      }
    }

    emit(payload) {
      this.onmessage?.({ data: JSON.stringify(payload) });
    }

    close() {
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.({ code: 1000, reason: "local e2e close" });
    }

    addEventListener(type, handler) {
      this[`on${type}`] = handler;
    }

    removeEventListener() {}
  }
  window.WebSocket = MockWebSocket;
  window.__emitSalesStt = (text) => {
    const socket = window.__mockSockets[window.__mockSockets.length - 1];
    if (!socket) {
      throw new Error("mock websocket not ready");
    }
    socket.emit({ type: "input_audio_buffer.speech_started" });
    socket.emit({ type: "input_audio_buffer.speech_stopped" });
    socket.emit({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: text,
    });
  };
}

async function newMockedPage(browserInstance) {
  const context = await browserInstance.newContext({
    baseURL: BASE_URL,
    permissions: ["microphone"],
  });
  await context.addInitScript(installMockWebSocket);
  const evaluationStartRequests = [];
  const events = [];
  const consoleMessages = [];
  await context.route("**/api/grok-first-v50-7/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(SESSION),
    });
  });
  await context.route("**/api/grok-first-v50-7/event", async (route) => {
    events.push(route.request().postDataJSON());
    await route.fulfill({ status: 204, body: "" });
  });
  await context.route(
    "**/api/grok-first-v50-7/evaluation/start",
    async (route) => {
      const body = route.request().postDataJSON();
      evaluationStartRequests.push(body);
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          status: "queued",
          sessionId: body.sessionId,
          taskName: "local-e2e",
        }),
      });
    }
  );
  const page = await context.newPage();
  page.on("console", (message) => {
    consoleMessages.push({ type: message.type(), text: message.text() });
  });
  return { context, page, evaluationStartRequests, events, consoleMessages };
}

async function startConversation(page) {
  await page.goto("/demo/adecco-roleplay-v50-7?fakeLive=1", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.locator("[data-testid='right-transcript-panel']").waitFor({
    timeout: 30_000,
  });
  await clickCall(page, "通話を開始");
  await page.waitForFunction(
    () =>
      window.__mockSockets?.some((socket) => socket.readyState === 1) === true,
    null,
    { timeout: 10_000 }
  );
  await page
    .getByText("お電話ありがとうございます。本日はよろしくお願いいたします。")
    .waitFor({ timeout: 10_000 });
}

async function clickCall(page, label) {
  await page
    .locator(`button[aria-label="${label}"]`)
    .evaluate((button) => button.click());
}

async function caseMissingSales(browserInstance) {
  const env = await newMockedPage(browserInstance);
  await startConversation(env.page);
  await clickCall(env.page, "通話を終了");
  await env.page.waitForURL(/startFailed=1/, { timeout: 10_000 });
  await env.page.screenshot({
    path: resolve(OUT_DIR, "missing-sales-startFailed.png"),
    fullPage: true,
  });
  const passed = env.evaluationStartRequests.length === 0;
  await env.context.close();
  return {
    id: "missing_sales_transcript_blocks_evaluation",
    passed,
    evaluationStartRequestCount: env.evaluationStartRequests.length,
    finalUrlMatchedStartFailed: true,
  };
}

async function caseSalesSttIncluded(browserInstance) {
  const env = await newMockedPage(browserInstance);
  const salesText = "募集背景を教えてください";
  await startConversation(env.page);
  await env.page.evaluate((text) => window.__emitSalesStt(text), salesText);
  await env.page.getByText(salesText).waitFor({ timeout: 10_000 });
  await env.page
    .getByText("増員のための募集です。")
    .waitFor({ timeout: 10_000 });
  await clickCall(env.page, "通話を終了");
  await env.page.waitForURL(
    (url) =>
      url.pathname.includes("/demo/adecco-roleplay-v50-7/result/") &&
      !url.search.includes("startFailed"),
    { timeout: 10_000 }
  );
  await env.page.screenshot({
    path: resolve(OUT_DIR, "sales-stt-evaluation-start.png"),
    fullPage: true,
  });
  const request = env.evaluationStartRequests[0];
  const transcript =
    request && Array.isArray(request.transcript) ? request.transcript : [];
  const salesTurn = transcript.find(
    (turn) => turn.role === "user" && turn.text === salesText
  );
  const clientTurn = transcript.find(
    (turn) =>
      turn.role === "agent" && String(turn.text || "").includes("増員")
  );
  const sttEvent = env.events.find((event) => event.kind === "stt.completed");
  const passed =
    env.evaluationStartRequests.length === 1 &&
    Boolean(salesTurn) &&
    Boolean(clientTurn) &&
    sttEvent?.details?.textLen === salesText.length;
  await env.context.close();
  return {
    id: "sales_stt_transcript_is_sent_to_evaluation_start",
    passed,
    evaluationStartRequestCount: env.evaluationStartRequests.length,
    transcriptRoles: transcript.map((turn) => turn.role),
    salesTurnText: salesTurn ? salesTurn.text : null,
    clientTurnText: clientTurn ? clientTurn.text : null,
    transcriptTurnCount: transcript.length,
    sttCompletedTextLen: sttEvent?.details?.textLen ?? null,
    startBodySource: request ? request.source : null,
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function stringArg(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
