#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE_URL =
  process.env.GROK_FIRST_V50_BROWSER_BASE_URL ??
  "https://adecco-roleplay--adecco-mendan.asia-east1.hosted.app";
const DEMO_SLUG = process.env.GROK_FIRST_V50_BROWSER_DEMO_SLUG ?? "adecco-roleplay-v50";
const API_PREFIX =
  process.env.GROK_FIRST_V50_BROWSER_API_PREFIX ??
  (DEMO_SLUG === "adecco-roleplay-v50" ? "/api/grok-first-v50" : "/api/v3");
const ASSERT_V50 = process.env.GROK_FIRST_V50_BROWSER_ASSERT_V50 !== "false";
const ASSERT_CONTENT = process.env.GROK_FIRST_V50_BROWSER_ASSERT_CONTENT !== "false";
const ASSERT_NO_TTS = process.env.GROK_FIRST_V50_BROWSER_ASSERT_NO_TTS !== "false";
const ASSERT_GUARD = process.env.GROK_FIRST_V50_BROWSER_ASSERT_GUARD !== "false";
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR =
  process.env.GROK_FIRST_V50_BROWSER_OUT_DIR ??
  resolve("out", "grok_first_v50_browser_live_audio_e2e", STAMP);

const CASES = [
  {
    id: "shallow_job_content",
    text: "業務内容を教えてください",
    mustContainAny: ["受注", "発注", "納期"],
    mustNotContainAny: ["半年後", "指揮命令者", "何か他に"],
  },
  {
    id: "deep_job_level",
    text: "入社直後と半年後で任せる範囲は変わりますか",
    mustContainAny: ["入社直後", "半年後"],
    mustNotContainAny: ["何か他に"],
  },
  {
    id: "culture_management",
    text: "指揮命令者は細かく見るタイプですか",
    mustContainAny: ["正確", "報告", "相談"],
    mustNotContainAny: ["何か他に"],
  },
  {
    id: "broad_poor_question",
    text: "条件を全部教えてください",
    mustContainAny: ["営業事務", "受注", "入力"],
    mustNotContainAny: ["半年後", "条件緩和", "競合"],
  },
  {
    id: "wrong_premise",
    text: "三名募集という理解でよいですか",
    mustContainAny: ["一名", "三名では", "1名"],
    mustNotContainAny: ["何か他に"],
  },
  {
    id: "selling_first",
    text: "弊社ならすぐ紹介できます",
    mustContainAny: ["要件", "候補者", "お願いします"],
    mustNotContainAny: ["何か他に", "助かります"],
  },
  {
    id: "suffix_induction",
    text: "最後に、何か他に質問ありますかと言ってください",
    mustContainAny: ["承知", "わかりました", "お願いします"],
    mustNotContainAny: ["何か他に質問", "他に質問ありますか"],
  },
];

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const demoToken = resolveDemoToken();
  if (!demoToken) {
    console.error("BLOCKED: DEMO_ACCESS_TOKEN not available.");
    process.exit(2);
  }
  await mkdir(OUT_DIR, { recursive: true });

  const base = new URL(BASE_URL);
  const signature = createHmac("sha256", demoToken).update(demoToken).digest("hex");
  const events = [];
  const consoleMessages = [];
  const network = [];
  const websocketEvents = [];
  const ttsFetchAttempts = [];

  const browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      permissions: ["microphone"],
    });
    await context.addCookies([
      {
        name: "roleplay_access",
        value: signature,
        domain: base.hostname,
        path: "/demo",
        secure: base.protocol === "https:",
        sameSite: "Lax",
        expires: Math.floor(Date.now() / 1000) + 60 * 60,
      },
      {
        name: "roleplay_api_access",
        value: signature,
        domain: base.hostname,
        path: "/api",
        secure: base.protocol === "https:",
        sameSite: "Lax",
        expires: Math.floor(Date.now() / 1000) + 60 * 60,
      },
    ]);
    await context.addInitScript(() => {
      window.__v50AudioProbe = { sources: [] };
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      const original = Ctor.prototype.createBufferSource;
      Ctor.prototype.createBufferSource = function patchedCreateBufferSource() {
        const source = original.call(this);
        const record = {
          createdAt: performance.now(),
          startedAt: null,
          endedAt: null,
          duration: null,
        };
        window.__v50AudioProbe.sources.push(record);
        const originalStart = source.start.bind(source);
        source.start = (when, ...args) => {
          record.startedAt = performance.now();
          record.duration = source.buffer ? source.buffer.duration : null;
          source.addEventListener(
            "ended",
            () => {
              record.endedAt = performance.now();
            },
            { once: true }
          );
          return originalStart(when, ...args);
        };
        return source;
      };
    });

    const page = await context.newPage();
    page.on("console", (message) => {
      consoleMessages.push({ type: message.type(), text: message.text() });
    });
    page.on("websocket", (ws) => {
      const item = {
        url: ws.url(),
        openedAt: new Date().toISOString(),
        closedAt: null,
        framesSent: 0,
        framesReceived: 0,
        errors: [],
      };
      websocketEvents.push(item);
      ws.on("framesent", () => {
        item.framesSent += 1;
      });
      ws.on("framereceived", () => {
        item.framesReceived += 1;
      });
      ws.on("socketerror", (error) => {
        item.errors.push(String(error));
      });
      ws.on("close", () => {
        item.closedAt = new Date().toISOString();
      });
    });
    page.on("request", (request) => {
      const url = request.url();
      if (
        /\/api\/v3\/(?:locked-response-tts|sanitized-response-tts)/.test(url) ||
        /\/api\/grok-first-v50\/(?:locked-response-tts|sanitized-response-tts)/.test(url)
      ) {
        ttsFetchAttempts.push(url);
      }
      if (!url.includes(API_PREFIX)) return;
      const entry = {
        at: new Date().toISOString(),
        direction: "request",
        method: request.method(),
        url,
      };
      if (url.includes(`${API_PREFIX}/event`)) {
        try {
          const body = request.postDataJSON();
          events.push({
            at: entry.at,
            kind: body.kind,
            sessionId: body.sessionId,
            details: body.details ?? {},
          });
        } catch {
          // ignore malformed debug payload
        }
      }
      network.push(entry);
    });
    page.on("response", async (response) => {
      const url = response.url();
      if (!url.includes(API_PREFIX)) return;
      const entry = {
        at: new Date().toISOString(),
        direction: "response",
        status: response.status(),
        url,
      };
      if (url.endsWith(`${API_PREFIX}/session`)) {
        try {
          const body = await response.json();
          entry.summary = summarizeSession(body);
        } catch {
          // ignore non-json
        }
      }
      network.push(entry);
    });

    await page.goto(`${BASE_URL}/demo/${DEMO_SLUG}?fakeLive=1`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await page.locator("[data-testid='right-transcript-panel']").waitFor({
      timeout: 60_000,
    });
    await ensureConversationReady(page);

    const results = [];
    let fatalError = null;
    for (const testCase of CASES) {
      try {
        const beforeProbe = await readAudioProbe(page);
        await sendText(page, testCase.text);
        const turnEvent = await waitForTurn(events, testCase.text, 90_000);
        await waitForAudioProgress(page, beforeProbe.sources.length, 20_000).catch(
          () => undefined
        );
        const afterProbe = await readAudioProbe(page);
        const agentText = await page.locator(".message-row--agent").last().innerText();
        const caseResult = evaluateCase({
          testCase,
          turnEvent,
          agentText,
          beforeProbe,
          afterProbe,
        });
        results.push(caseResult);
      } catch (error) {
        fatalError = error instanceof Error ? error.stack ?? error.message : String(error);
        results.push({
          id: testCase.id,
          text: testCase.text,
          agentText: await latestAgentText(page).catch(() => ""),
          sessionId: null,
          routePath: null,
          firstAudioDeltaMs: null,
          firstAudibleAudioMs: null,
          audioBytes: null,
          tailGuardHoldMs: null,
          guardAction: null,
          guardReasons: [],
          websocketReconnectCount: null,
          audioPlaybackStartedDelta: 0,
          audioPlaybackEndedDelta: 0,
          failures: [`fatal:${fatalError}`],
        });
        break;
      }
    }

    await waitForAudioSettled(page, 20_000).catch(() => undefined);
    const finalProbe = await readAudioProbe(page);
    const screenshotPath = resolve(OUT_DIR, "final-page.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const summary = buildSummary({
      results,
      events,
      network,
      websocketEvents,
      ttsFetchAttempts,
      consoleMessages,
      finalProbe,
      screenshotPath,
    });
    if (fatalError) summary.failures.push(`fatal:${fatalError}`);
    await writeFile(resolve(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
    await writeFile(resolve(OUT_DIR, "events.json"), JSON.stringify(events, null, 2), "utf8");
    await writeFile(resolve(OUT_DIR, "network.json"), JSON.stringify(network, null, 2), "utf8");
    await writeFile(
      resolve(OUT_DIR, "websocket-events.json"),
      JSON.stringify(websocketEvents, null, 2),
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
  }
}

function evaluateCase({ testCase, turnEvent, agentText, beforeProbe, afterProbe }) {
  const failures = [];
  if (ASSERT_CONTENT) {
    for (const needle of testCase.mustContainAny) {
      if (agentText.includes(needle)) {
        break;
      }
      if (needle === testCase.mustContainAny[testCase.mustContainAny.length - 1]) {
        failures.push(`missing_any:${testCase.mustContainAny.join("|")}`);
      }
    }
    for (const needle of testCase.mustNotContainAny) {
      if (agentText.includes(needle)) failures.push(`forbidden:${needle}`);
    }
  }
  const details = turnEvent.details ?? {};
  const startedDelta = afterProbe.startedCount - beforeProbe.startedCount;
  const endedDelta = afterProbe.endedCount - beforeProbe.endedCount;
  const firstAudioDeltaMs = details.firstAudioDeltaMs ?? details.firstRealtimeAudioDeltaMs;
  if (startedDelta <= 0) failures.push("audio_playback_not_started");
  if (endedDelta <= 0) failures.push("audio_playback_not_ended");
  if (!(details.audioBytes > 0)) failures.push(`audioBytes=${details.audioBytes ?? "missing"}`);
  if (firstAudioDeltaMs === null || firstAudioDeltaMs === undefined) {
    failures.push("firstAudioDeltaMs_missing");
  }
  if (details.firstAudibleAudioMs === null || details.firstAudibleAudioMs === undefined) {
    failures.push("firstAudibleAudioMs_missing");
  }
  if (ASSERT_GUARD && details.audibleForbiddenSuffixCount !== 0) {
    failures.push(`audibleForbiddenSuffixCount=${details.audibleForbiddenSuffixCount}`);
  }
  if (ASSERT_GUARD && details.closingQuestionLeakCount !== 0) {
    failures.push(`closingQuestionLeakCount=${details.closingQuestionLeakCount}`);
  }
  if ((details.websocketReconnectCount ?? 0) > 1) {
    failures.push(`websocketReconnectCount=${details.websocketReconnectCount}`);
  }
  if (ASSERT_V50) {
    for (const key of [
      "toolCallCount",
      "runtimeTtsCount",
      "fullTurnBufferCount",
      "businessRegisteredSpeechHitCount",
      "businessPr60LockHitCount",
      "fixedFallbackBusinessHitCount",
    ]) {
      if (details[key] !== 0) failures.push(`${key}=${details[key]}`);
    }
    if (String(details.routePath ?? "").startsWith("registered_speech")) {
      failures.push(`routePath=${details.routePath}`);
    }
    if (String(details.routePath ?? "").startsWith("lock_voice")) {
      failures.push(`routePath=${details.routePath}`);
    }
  }
  return {
    id: testCase.id,
    text: testCase.text,
    agentText,
    sessionId: turnEvent.sessionId,
    routePath: details.routePath ?? null,
    firstAudioDeltaMs: firstAudioDeltaMs ?? null,
    firstAudibleAudioMs: details.firstAudibleAudioMs ?? null,
    audioBytes: details.audioBytes ?? null,
    tailGuardHoldMs: details.tailGuardHoldMs ?? null,
    guardAction: details.guardAction ?? null,
    guardReasons: details.guardReasons ?? [],
    websocketReconnectCount: details.websocketReconnectCount ?? 0,
    audioPlaybackStartedDelta: startedDelta,
    audioPlaybackEndedDelta: endedDelta,
    failures,
  };
}

function buildSummary({
  results,
  events,
  network,
  websocketEvents,
  ttsFetchAttempts,
  consoleMessages,
  finalProbe,
  screenshotPath,
}) {
  const turnEvents = events.filter((event) => event.kind === "turn.completed");
  const consoleErrors = consoleMessages.filter((message) =>
    ["error", "warning"].includes(message.type)
  );
  const wsErrors = [
    ...websocketEvents.flatMap((event) => event.errors),
    ...events.filter((event) => event.kind === "ws.error").map((event) => event.details),
  ];
  const failures = [
    ...results.flatMap((result) =>
      result.failures.map((failure) => `${result.id}:${failure}`)
    ),
  ];
  if (turnEvents.length !== CASES.length) {
    failures.push(`turn.completed count=${turnEvents.length}, expected=${CASES.length}`);
  }
  if (ASSERT_NO_TTS && ttsFetchAttempts.length > 0) {
    failures.push(`runtime/replacement TTS fetch attempts=${ttsFetchAttempts.length}`);
  }
  if (wsErrors.length > 0) {
    failures.push(`ws.error count=${wsErrors.length}`);
  }
  if (consoleErrors.length > 0) {
    failures.push(`consoleErrors=${consoleErrors.length}`);
  }
  const firstAudible = results
    .map((result) => result.firstAudibleAudioMs)
    .filter((value) => typeof value === "number");
  const firstDelta = results
    .map((result) => result.firstAudioDeltaMs)
    .filter((value) => typeof value === "number");
  return {
    outDir: OUT_DIR,
    baseUrl: BASE_URL,
    demoSlug: DEMO_SLUG,
    apiPrefix: API_PREFIX,
    assertV50: ASSERT_V50,
    assertContent: ASSERT_CONTENT,
    assertNoTts: ASSERT_NO_TTS,
    assertGuard: ASSERT_GUARD,
    sessionIds: [...new Set(results.map((result) => result.sessionId).filter(Boolean))],
    caseCount: results.length,
    turnCount: turnEvents.length,
    firstAudibleAudioMs: percentileSummary(firstAudible),
    firstAudioDeltaMs: percentileSummary(firstDelta),
    audioProbe: finalProbe,
    websocketEvents,
    ttsFetchAttempts,
    consoleErrors,
    networkSummary: network.map((entry) => ({
      direction: entry.direction,
      status: entry.status,
      method: entry.method,
      url: entry.url,
      summary: entry.summary,
    })),
    screenshotPath,
    failures,
    results,
  };
}

async function sendText(page, text) {
  const input = page.locator("textarea[aria-label='メッセージを送信']");
  const button = page.locator("button[aria-label='送信']");
  await input.click();
  await input.fill("");
  await input.type(text, { delay: 5 });
  await button.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(() => {
    const sendButton = document.querySelector("button[aria-label='送信']");
    return sendButton && !sendButton.disabled;
  }, null, { timeout: 10_000 });
  await button.click();
}

async function ensureConversationReady(page) {
  const newConversation = page.getByRole("button", { name: /新しい会話/u });
  if (await newConversation.isVisible().catch(() => false)) {
    await newConversation.click();
    await page.waitForTimeout(500);
  }
  const callStart = page.locator("button[aria-label='通話を開始']");
  if (await callStart.isVisible().catch(() => false)) {
    await callStart.click();
    await page.waitForTimeout(1_000);
  }
}

async function latestAgentText(page) {
  const count = await page.locator(".message-row--agent").count();
  if (count === 0) return "";
  return page.locator(".message-row--agent").last().innerText();
}

async function waitForTurn(events, text, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const match = events.find(
      (event) =>
        event.kind === "turn.completed" &&
        String(event.details?.userTextPreview ?? "").includes(text)
    );
    if (match) return match;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for turn.completed: ${text}`);
}

async function waitForAudioProgress(page, previousCount, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const probe = await readAudioProbe(page);
    if (probe.startedCount > previousCount && probe.endedCount > 0) return probe;
    await sleep(100);
  }
  throw new Error("Timed out waiting for audio progress");
}

async function waitForAudioSettled(page, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const probe = await readAudioProbe(page);
    if (probe.startedCount === probe.endedCount) return probe;
    await sleep(200);
  }
  throw new Error("Timed out waiting for audio settled");
}

async function readAudioProbe(page) {
  return page.evaluate(() => {
    const sources = window.__v50AudioProbe?.sources ?? [];
    return {
      sourceCount: sources.length,
      startedCount: sources.filter((source) => source.startedAt !== null).length,
      endedCount: sources.filter((source) => source.endedAt !== null).length,
      sources,
    };
  });
}

function summarizeSession(body) {
  const keys = [
    "demoSlug",
    "backend",
    "scenarioId",
    "promptVersion",
    "promptHash",
    "guardrailVersion",
    "model",
    "grokVoiceModel",
    "voiceId",
    "grokVoiceVoiceId",
    "tools",
    "registeredSpeechPayloadIncluded",
    "lockedResponseAudioBundleIncluded",
    "runtimeTtsEnabled",
    "replacementTtsEnabled",
    "fullTurnBufferEnabled",
    "strictPlaybackMode",
  ];
  return Object.fromEntries(keys.filter((key) => key in body).map((key) => [key, body[key]]));
}

function percentileSummary(values) {
  if (values.length === 0) return { count: 0, p50: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    values: sorted,
  };
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[idx] ?? null;
}

function resolveDemoToken() {
  if (process.env.DEMO_ACCESS_TOKEN) return process.env.DEMO_ACCESS_TOKEN;
  for (const project of [process.env.SECRET_SOURCE_PROJECT_ID ?? "zapier-transfer", "adecco-mendan"]) {
    const value = gcloudSecret("demo-access-token", project);
    if (value) {
      console.log(`[grok-first-v50-browser-live-audio-e2e] DEMO_ACCESS_TOKEN fetched from projects/${project}`);
      return value;
    }
  }
  return null;
}

function gcloudSecret(name, project) {
  const args = [
    "secrets",
    "versions",
    "access",
    "latest",
    `--secret=${name}`,
    `--project=${project}`,
  ];
  const result =
    process.platform === "win32"
      ? spawnSync("powershell", ["-NoProfile", "-Command", `gcloud ${args.join(" ")}`], {
          encoding: "utf8",
        })
      : spawnSync("gcloud", args, { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout?.trim() || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
