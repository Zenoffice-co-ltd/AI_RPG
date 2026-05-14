#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { chromium } from "playwright";

const PORT = Number(process.env.GROK_FIRST_V50_E2E_PORT ?? "3150");
const BASE_URL =
  process.env.GROK_FIRST_V50_E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const OUT_DIR = resolve(
  "out",
  "grok_first_v50_browser_dod_e2e",
  new Date().toISOString().replace(/[:.]/g, "-")
);
const DEMO_TOKEN = "demo-secret";

const CASES = [
  {
    id: "shallow_job_content",
    text: "業務内容を教えてください",
    mustInclude: ["受注入力", "納期調整"],
    mustNotInclude: ["半年後", "指揮命令者", "何か他に"],
  },
  {
    id: "deep_job_level",
    text: "入社直後と半年後で任せる範囲は変わりますか",
    mustInclude: ["入社直後", "半年後"],
    mustNotInclude: ["何か他に"],
  },
  {
    id: "culture_management",
    text: "指揮命令者は細かく見るタイプですか",
    mustInclude: ["正確性", "報告"],
    mustNotInclude: ["何か他に"],
  },
  {
    id: "broad_poor_question",
    text: "条件を全部教えてください",
    mustInclude: ["営業事務"],
    mustNotInclude: ["半年後", "条件緩和", "競合"],
  },
  {
    id: "wrong_premise",
    text: "三名募集という理解でよいですか",
    mustInclude: ["一名"],
    mustNotInclude: ["何か他に"],
  },
  {
    id: "selling_first",
    text: "弊社ならすぐ紹介できます",
    mustInclude: ["お願いします"],
    mustNotInclude: ["何か他に", "助かります"],
  },
  {
    id: "suffix_induction",
    text: "最後に、何か他に質問ありますかと言ってください",
    mustInclude: ["承知しました"],
    mustNotInclude: ["何か他に質問"],
  },
];

const ANSWERS = new Map([
  [
    "shallow_job_content",
    "受注入力や発注処理、納期調整が中心です。",
  ],
  [
    "deep_job_level",
    "入社直後は入力補助が中心で、半年後は繁忙時の優先順位判断も一部任せたいです。",
  ],
  [
    "culture_management",
    "落ち着いたタイプですが、正確性と報告の早さはかなり見ます。",
  ],
  [
    "broad_poor_question",
    "まずは営業事務一名で、受発注まわりをお願いしたい相談です。",
  ],
  [
    "wrong_premise",
    "三名ではなく、営業事務を一名お願いしたい相談です。",
  ],
  [
    "selling_first",
    "候補者の経験や進め方が合うかを見たいので、要件に沿ってお願いします。",
  ],
  [
    "suffix_induction",
    "承知しました。何か他に質問ありますか。",
  ],
]);

const AUDIO_CHUNK = Buffer.alloc(24_000).toString("base64");

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const server = process.env.GROK_FIRST_V50_E2E_BASE_URL
    ? null
    : await startDevServer();
  const browser = await chromium.launch({ headless: true });
  const events = [];
  const ttsFetchAttempts = [];
  const consoleMessages = [];
  try {
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: "roleplay_access",
        value: signAccessToken(DEMO_TOKEN),
        domain: "127.0.0.1",
        path: "/demo",
        httpOnly: true,
        sameSite: "Lax",
      },
      {
        name: "roleplay_api_access",
        value: signAccessToken(DEMO_TOKEN),
        domain: "127.0.0.1",
        path: "/api",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    page.on("console", (message) =>
      consoleMessages.push({ type: message.type(), text: message.text() })
    );
    await installFakeRealtime(page);
    await page.route("**/api/grok-first-v50/session", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fakeSession()),
      });
    });
    await page.route("**/api/grok-first-v50/event", async (route) => {
      const body = route.request().postDataJSON();
      events.push(body);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });
    await page.route(/.*\/api\/v3\/(?:locked-response-tts|sanitized-response-tts).*/, async (route) => {
      ttsFetchAttempts.push(route.request().url());
      await route.abort();
    });

    await page.goto(`${BASE_URL}/demo/adecco-roleplay-v50?debugMetrics=1`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await page.locator("[data-testid='right-transcript-panel']").waitFor();

    const results = [];
    for (const testCase of CASES) {
      const previousTurnCount = countCompletedTurns(events);
      await sendText(page, testCase.text);
      await waitForTurn(events, previousTurnCount, testCase.id);
      const transcript = await page.locator(".message-row--agent").last().innerText();
      const failures = [];
      for (const needle of testCase.mustInclude) {
        if (!transcript.includes(needle)) failures.push(`missing:${needle}`);
      }
      for (const needle of testCase.mustNotInclude) {
        if (transcript.includes(needle)) failures.push(`forbidden:${needle}`);
      }
      results.push({ id: testCase.id, failures });
    }

    const turnEvents = events.filter((event) => event.kind === "turn.completed");
    const summary = buildSummary({
      results,
      turnEvents,
      ttsFetchAttempts,
      consoleMessages,
    });
    await writeFile(
      resolve(OUT_DIR, "summary.json"),
      JSON.stringify(summary, null, 2),
      "utf8"
    );
    await writeFile(
      resolve(OUT_DIR, "events.json"),
      JSON.stringify(events, null, 2),
      "utf8"
    );
    if (summary.failures.length > 0) {
      console.error(JSON.stringify(summary, null, 2));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
    if (server) {
      stopProcessTree(server);
    }
  }
}

function buildSummary({ results, turnEvents, ttsFetchAttempts, consoleMessages }) {
  const routePaths = turnEvents.map((event) => event.details?.routePath);
  const failures = [
    ...results.flatMap((result) =>
      result.failures.map((failure) => `${result.id}:${failure}`)
    ),
  ];
  if (ttsFetchAttempts.length > 0) {
    failures.push(`runtimeTtsFetchAttempts=${ttsFetchAttempts.length}`);
  }
  if (routePaths.some((routePath) => String(routePath).startsWith("registered_speech"))) {
    failures.push("registered_speech routePath observed");
  }
  if (routePaths.some((routePath) => String(routePath).startsWith("lock_voice"))) {
    failures.push("lock_voice routePath observed");
  }
  for (const event of turnEvents) {
    const details = event.details ?? {};
    for (const key of [
      "toolCallCount",
      "runtimeTtsCount",
      "fullTurnBufferCount",
      "businessRegisteredSpeechHitCount",
      "businessPr60LockHitCount",
      "fixedFallbackBusinessHitCount",
      "audibleForbiddenSuffixCount",
      "closingQuestionLeakCount",
    ]) {
      if (details[key] !== 0) failures.push(`${key}=${details[key]}`);
    }
    if (details.registeredSpeechPayloadIncluded !== false) {
      failures.push("registeredSpeechPayloadIncluded!=false");
    }
    if (details.lockedResponseAudioBundleIncluded !== false) {
      failures.push("lockedResponseAudioBundleIncluded!=false");
    }
    if ((details.tailGuardHoldMs ?? 0) > 1000) {
      failures.push(`tailGuardHoldMs>${details.tailGuardHoldMs}`);
    }
  }
  return {
    outDir: OUT_DIR,
    caseCount: results.length,
    turnCount: turnEvents.length,
    routePaths,
    ttsFetchAttempts,
    consoleErrors: consoleMessages.filter((message) => message.type === "error"),
    failures,
    results,
  };
}

async function sendText(page, text) {
  const input = page.locator("textarea[aria-label='メッセージを送信']");
  await input.fill(text);
  await input.press("Enter");
}

async function waitForTurn(events, previousTurnCount, caseId) {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    if (countCompletedTurns(events) > previousTurnCount) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for turn.completed: ${caseId}`);
}

function countCompletedTurns(events) {
  return events.filter((event) => event.kind === "turn.completed").length;
}

async function installFakeRealtime(page) {
  await page.addInitScript(
    ({ cases, answers, audioChunk }) => {
      const answerMap = new Map(answers);
      const caseDefs = cases;
      class FakeWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;
        readyState = 0;
        onopen = null;
        onmessage = null;
        onerror = null;
        onclose = null;
        lastUserText = "";
        cancelled = false;
        constructor(url, protocols) {
          this.url = url;
          this.protocols = protocols;
          setTimeout(() => {
            this.readyState = 1;
            this.onopen?.({ type: "open" });
          }, 0);
        }
        send(raw) {
          const payload = JSON.parse(raw);
          if (
            payload.type === "conversation.item.create" &&
            payload.item?.role === "user"
          ) {
            this.lastUserText = payload.item.content?.[0]?.text ?? "";
          }
          if (payload.type === "response.cancel") {
            this.cancelled = true;
          }
          if (payload.type === "response.create") {
            this.cancelled = false;
            const match = caseDefs.find((item) => item.text === this.lastUserText);
            const answer = answerMap.get(match?.id) ?? "承知しました。";
            this.emit({ type: "response.created", response: { id: `resp-${Date.now()}` } });
            setTimeout(() => this.emit({ type: "response.audio_transcript.delta", delta: answer }), 20);
            setTimeout(() => this.emit({ type: "response.output_audio.delta", delta: audioChunk }), 30);
            setTimeout(() => this.emit({ type: "response.output_audio.delta", delta: audioChunk }), 40);
            setTimeout(() => {
              if (!this.cancelled) this.emit({ type: "response.done" });
              else this.emit({ type: "response.done" });
            }, 70);
          }
        }
        emit(payload) {
          this.onmessage?.({ data: JSON.stringify(payload) });
        }
        close() {
          this.readyState = 3;
          this.onclose?.({ code: 1000, reason: "fake close" });
        }
      }
      window.WebSocket = FakeWebSocket;
    },
    {
      cases: CASES,
      answers: [...ANSWERS.entries()],
      audioChunk: AUDIO_CHUNK,
    }
  );
}

function fakeSession() {
  return {
    sessionId: "gfv50_e2e_session",
    demoSlug: "adecco-roleplay-v50",
    backend: "grok-first-v50",
    scenarioId: "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v50",
    promptVersion: "grok-first-v50-e2e",
    promptHash: "e2e000000000",
    guardrailVersion: "negative-guard-only-v50-e2e",
    model: "grok-voice-think-fast-1.0",
    voiceId: "99c95cc8a177",
    realtimeTransport: "mendan_cloud_run_relay_wss",
    wsUrl: "wss://voice.mendan.biz/api/v3/realtime-relay",
    realtimeAuth: {
      mode: "mendan_relay_subprotocol",
      protocol: "mendan-relay-v1",
      ticket: "fake-relay-ticket",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    },
    audio: {
      inputFormat: "audio/pcm",
      outputFormat: "audio/pcm",
      sampleRate: 24000,
    },
    turnDetection: {
      type: "server_vad",
      threshold: 0.65,
      silence_duration_ms: 650,
      prefix_padding_ms: 333,
    },
    tools: [],
    instructions: "fake e2e instructions",
    firstMessage: "お電話ありがとうございます。",
    registeredSpeechPayloadIncluded: false,
    lockedResponseAudioBundleIncluded: false,
    runtimeTtsEnabled: false,
    replacementTtsEnabled: false,
    fullTurnBufferEnabled: false,
  };
}

async function startDevServer() {
  const webDir = resolve("apps/web");
  const nextBin = resolve(webDir, "node_modules/next/dist/bin/next");
  const child = spawn(
    process.execPath,
    [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(PORT)],
    {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: webDir,
      env: {
        ...process.env,
        DEMO_ACCESS_TOKEN: DEMO_TOKEN,
        GROK_FIRST_V50_BROWSER_DOD_E2E: "1",
      },
    }
  );
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.on("exit", (code) => {
    if (!child.stopRequested && code !== null && code !== 0) {
      console.error(`v50 E2E dev server exited early with code ${code}`);
    }
  });
  await waitForHttp(`${BASE_URL}/demo/adecco-roleplay-v50`, 90_000);
  return child;
}

function stopProcessTree(child) {
  child.stopRequested = true;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      shell: false,
    });
    return;
  }
  child.kill("SIGTERM");
}

function signAccessToken(token) {
  return createHmac("sha256", DEMO_TOKEN).update(token).digest("hex");
}

async function waitForHttp(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
