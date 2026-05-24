#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const args = parseArgs(process.argv.slice(2));
const BASE_URL = stringArg(args["base-url"], "http://127.0.0.1:3001").replace(
  /\/$/,
  ""
);
const CASE_SET = stringArg(args["case-set"], "v50-7-transcript-smoke");
const ACTUAL_SCORE = booleanArg(args["actual-score"]);
const OPEN_RESULT = booleanArg(args["open-result"]);
const RESULT_TIMEOUT_MS = numberArg(args["result-timeout-ms"], 90_000);
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const DEFAULT_OUT_ROOT =
  CASE_SET === "v50-7-4-d-long-browser-eval"
    ? "out/adecco_browser_eval_v50_7_4_d_long"
    : "out/adecco_browser_eval_transcript_e2e";
const OUT_DIR = resolve(stringArg(args.out, `${DEFAULT_OUT_ROOT}/${STAMP}`));
mkdirSync(OUT_DIR, { recursive: true });

const ROUTE = stringArg(
  args.route,
  CASE_SET === "v50-7-4-d-long-browser-eval"
    ? "/demo/adecco-roleplay-v50-7-4-d"
    : "/demo/adecco-roleplay-v50-7"
);
const API_BASE = stringArg(
  args["api-base"],
  CASE_SET === "v50-7-4-d-long-browser-eval"
    ? "/api/grok-first-v50-7-4-d"
    : "/api/grok-first-v50-7"
);
const RESULT_BASE_PATH = stringArg(
  args["result-base-path"],
  CASE_SET === "v50-7-4-d-long-browser-eval"
    ? "/demo/adecco-roleplay-v50-7-4-d/result"
    : "/demo/adecco-roleplay-v50-7/result"
);
const EXPECTED_DEMO_SLUG = stringArg(
  args["expected-demo-slug"],
  CASE_SET === "v50-7-4-d-long-browser-eval"
    ? "adecco-roleplay-v50-7-4-d"
    : "adecco-roleplay-v50-7"
);
const EXPECTED_BACKEND = stringArg(
  args["expected-backend"],
  CASE_SET === "v50-7-4-d-long-browser-eval"
    ? "grok-first-v50-7-4-d"
    : "grok-first-v50-7"
);
const EXPECTED_PROMPT_VARIANT = stringArg(
  args["expected-prompt-variant"],
  CASE_SET === "v50-7-4-d-long-browser-eval" ? "v50.7.4-d" : "v50.7"
);
const EVAL_START_ENDPOINT = "/api/grok-first-v50-7/evaluation/start";
const EVAL_RESULT_ENDPOINT = "/api/grok-first-v50-7/evaluation/result";
const EVAL_SOURCE = "grok_first_v50_7_browser";
const EVAL_RUNTIME_VERSION = "v50-7";


const SESSION = buildSession();

await assertAppReachable();

const browser = await chromium.launch({ headless: true });
try {
  const results =
    CASE_SET === "v50-7-4-d-long-browser-eval"
      ? [await caseV5074DLongBrowserEval(browser)]
      : [
          await caseMissingSales(browser),
          await caseSalesSttIncluded(browser),
        ];
  const summary = {
    ok: results.every((result) => result.passed),
    status: results.every((result) => result.status !== "BLOCKED")
      ? results.every((result) => result.passed)
        ? "PASS"
        : "FAIL"
      : "BLOCKED",
    baseUrl: BASE_URL,
    caseSet: CASE_SET,
    denominator:
      CASE_SET === "v50-7-4-d-long-browser-eval"
        ? "v50-7-4-d long browser evaluation transcript E2E"
        : "2-case local browser transcript E2E",
    outDir: OUT_DIR,
    route: ROUTE,
    apiBase: API_BASE,
    resultBasePath: RESULT_BASE_PATH,
    actualScore: ACTUAL_SCORE,
    openResult: OPEN_RESULT,
    resultTimeoutMs: RESULT_TIMEOUT_MS,
    results,
  };
  writeJson("summary.json", summary);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.status === "BLOCKED") process.exitCode = 2;
  else if (!summary.ok) process.exitCode = 1;
} finally {
  await browser.close();
}

async function assertAppReachable() {
  try {
    const response = await fetch(`${BASE_URL}${ROUTE}?fakeLive=1`);
    if (!response.ok) throw new Error(`status=${response.status}`);
  } catch (error) {
    console.error(
      `BLOCKED: local app is not reachable at ${BASE_URL}. Start a local Next server first.`
    );
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}

function buildSession() {
  return {
    sessionId: stringArg(
      args["session-id"],
      CASE_SET === "v50-7-4-d-long-browser-eval"
        ? `gfv50_74d_long_${STAMP.replaceAll("-", "").slice(0, 18)}`
        : "gfv50_local_transcript_e2e"
    ),
    demoSlug: EXPECTED_DEMO_SLUG,
    backend: EXPECTED_BACKEND,
    promptVariant: EXPECTED_PROMPT_VARIANT,
    runtimeVariant: EXPECTED_PROMPT_VARIANT,
    scenarioId:
      "staffing_order_hearing_adecco_manufacturer_busy_manager_medium",
    promptVersion:
      CASE_SET === "v50-7-4-d-long-browser-eval"
        ? "grok-first-v50.7.4-D-customer-concern-question-driver-2026-05-20"
        : "grok-first-v50.7.1-natural-interactive-sales-2026-05-17",
    promptHash: "local-e2e",
    guardrailVersion:
      CASE_SET === "v50-7-4-d-long-browser-eval"
        ? "grok-first-v50.7.4-clean-quality-guard-2026-05-20"
        : "grok-first-v50.7-guard-2026-05-15",
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
      create_response: false,
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
    latencyMode:
      CASE_SET === "v50-7-4-d-long-browser-eval"
        ? "clean_tail_streaming"
        : undefined,
    streamAudioBeforeDone: CASE_SET === "v50-7-4-d-long-browser-eval",
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
      startEndpoint: EVAL_START_ENDPOINT,
      resultBasePath: RESULT_BASE_PATH,
      source: EVAL_SOURCE,
      runtimeVersion: EVAL_RUNTIME_VERSION,
    },
  };
}

function installMockWebSocket() {
  const NativeWebSocket = window.WebSocket;
  window.__mockSockets = [];
  window.__scriptedAgentResponses = [];
  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
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
        // ignore non-json frames
      }
      this.sent.push(parsed || data);
      if (parsed?.type === "response.create") {
        const fallback = "増員のための募集です。";
        const text = window.__scriptedAgentResponses.shift() || fallback;
        setTimeout(() => {
          this.emit({
            type: "response.created",
            response: { id: `resp_${Date.now()}` },
          });
          this.emit({
            type: "response.output_audio_transcript.delta",
            delta: text,
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
  window.__setScriptedAgentResponses = (responses) => {
    window.__scriptedAgentResponses = [...responses];
  };
  window.__emitSalesStt = (text) => {
    const socket = window.__mockSockets[window.__mockSockets.length - 1];
    if (!socket) throw new Error("mock websocket not ready");
    socket.emit({ type: "input_audio_buffer.speech_started" });
    socket.emit({ type: "input_audio_buffer.speech_stopped" });
    socket.emit({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: text,
    });
  };
}

async function newMockedPage(browserInstance, options = {}) {
  const context = await browserInstance.newContext({
    baseURL: BASE_URL,
    permissions: ["microphone"],
  });
  await context.addInitScript(installMockWebSocket);
  const evaluationStartRequests = [];
  const events = [];
  const failedResponses = [];
  context.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes(EVAL_START_ENDPOINT)
    ) {
      const body = request.postDataJSON();
      evaluationStartRequests.push(body);
      writeJson("evaluation-start-body.json", body);
      writeJson("transcript-browser-turns.json", body.transcript ?? []);
      writeJson(
        "transcript-normalized-preview.json",
        normalizeBrowserTurns(body.transcript ?? [])
      );
    }
  });
  context.on("response", async (response) => {
    if (response.status() >= 400) {
      failedResponses.push({
        url: response.url(),
        status: response.status(),
      });
    }
  });
  await context.route(`**${API_BASE}/session`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(SESSION),
    });
  });
  await context.route(`**${API_BASE}/event`, async (route) => {
    events.push(route.request().postDataJSON());
    writeEvents(events);
    await route.fulfill({ status: 204, body: "" });
  });
  await context.route(`**${API_BASE}/greet`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        audioBase64: "",
        textLen: SESSION.firstMessage.length,
        voiceId: SESSION.voiceId,
        vendorMs: 0,
        cacheStatus: "hit",
      }),
    });
  });
  if (!options.actualScore) {
    await context.route(`**${EVAL_START_ENDPOINT}`, async (route) => {
      const body = route.request().postDataJSON();
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
    });
  }
  const page = await context.newPage();
  return { context, page, evaluationStartRequests, events, failedResponses };
}

async function startConversation(page) {
  await page.goto(`${ROUTE}?fakeLive=1`, {
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
    status: passed ? "PASS" : "FAIL",
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
      url.pathname.includes(`${RESULT_BASE_PATH}/`) &&
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
    status: passed ? "PASS" : "FAIL",
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

async function caseV5074DLongBrowserEval(browserInstance) {
  const env = await newMockedPage(browserInstance, {
    actualScore: ACTUAL_SCORE,
  });
  try {
    const longConversation = getLongConversation();
    await startConversation(env.page);
    await env.page.evaluate(
      (responses) => window.__setScriptedAgentResponses(responses),
      longConversation.map((turn) => turn.agent)
    );

    for (const turn of longConversation) {
      await env.page.evaluate((text) => window.__emitSalesStt(text), turn.user);
      await env.page.getByText(turn.user).waitFor({ timeout: 10_000 });
      await env.page.getByText(turn.agent).waitFor({ timeout: 10_000 });
    }

    await clickCall(env.page, "通話を終了");
    await env.page.waitForURL(
      (url) =>
        url.pathname.includes(`${RESULT_BASE_PATH}/`) &&
        !url.search.includes("startFailed"),
      { timeout: 20_000 }
    );
    const resultUrl = env.page.url();
    writeText("result-url.txt", resultUrl);

    const request = await waitForEvaluationStart(env.evaluationStartRequests);
    const transcript = Array.isArray(request.transcript)
      ? request.transcript
      : [];
    const transcriptSummary = summarizeTranscript(transcript);
    const startChecks = {
      expectedSessionId: SESSION.sessionId,
      sessionId: request.sessionId,
      source: request.source,
      transcriptSummary,
      firstMessageIncluded: transcript.some(
        (turn) => turn.role === "agent" && turn.text === SESSION.firstMessage
      ),
      firstUserTurnPreserved: transcript.some(
        (turn) => turn.role === "user" && turn.text === longConversation[0].user
      ),
    };

    if (!ACTUAL_SCORE) {
      await env.context.close();
      return {
        id: "v50_7_4_d_long_browser_eval",
        status: "PASS",
        passed: true,
        mode: "mock-start",
        resultUrl,
        ...startChecks,
      };
    }

    if (!OPEN_RESULT) {
      await env.context.close();
      return {
        id: "v50_7_4_d_long_browser_eval",
        status: "PASS",
        passed: true,
        mode: "actual-score-start-only",
        resultUrl,
        ...startChecks,
      };
    }

    const result = await waitForCompletedResult(env.page, SESSION.sessionId);
    if (result.status !== "completed") {
      await captureResultArtifacts(env.page, null);
      await env.context.close();
      return {
        id: "v50_7_4_d_long_browser_eval",
        status: "BLOCKED",
        passed: false,
        blockedReason: `evaluation did not complete: ${result.status}`,
        result,
        resultUrl,
        failedResponses: env.failedResponses,
        ...startChecks,
      };
    }

    await env.page.goto(`${RESULT_BASE_PATH}/${encodeURIComponent(SESSION.sessionId)}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await waitForCompletedReportPage(env.page);
    const scorecard = result.scorecard;
    const redacted = redactScorecard(scorecard);
    const sanity = buildScorecardSanity(redacted, transcript);
    await captureResultArtifacts(env.page, redacted);
    writeJson("scorecard-redacted.json", redacted);
    writeJson("scorecard-sanity.json", sanity);

    const visibleChecks = await assertResultPageVisible(env.page);
    const noSensitiveArtifacts = assertNoSensitiveText(
      JSON.stringify({ redacted, sanity })
    );
    const passed =
      sanity.ok && visibleChecks.ok && noSensitiveArtifacts.ok;
    await env.context.close();
    return {
      id: "v50_7_4_d_long_browser_eval",
      status: passed ? "PASS" : "FAIL",
      passed,
      mode: "actual-score",
      resultUrl,
      screenshotPath: resolve(OUT_DIR, "result-page.png"),
      htmlPath: resolve(OUT_DIR, "result-page-full.html"),
      scorecardRedactedPath: resolve(OUT_DIR, "scorecard-redacted.json"),
      scorecardSanityPath: resolve(OUT_DIR, "scorecard-sanity.json"),
      scoreSummary: summarizeScorecard(redacted),
      sanity,
      visibleChecks,
      noSensitiveArtifacts,
      ...startChecks,
    };
  } catch (error) {
    await env.page.screenshot({
      path: resolve(OUT_DIR, "blocked-or-failed-page.png"),
      fullPage: true,
    }).catch(() => undefined);
    writeText("result-page-full.html", await env.page.content().catch(() => ""));
    await env.context.close();
    return {
      id: "v50_7_4_d_long_browser_eval",
      status: ACTUAL_SCORE ? "BLOCKED" : "FAIL",
      passed: false,
      blockedReason: error instanceof Error ? error.message : String(error),
      failedResponses: env.failedResponses,
    };
  }
}

async function waitForEvaluationStart(requests) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (requests[0]) return requests[0];
    await delay(250);
  }
  throw new Error("evaluation start request was not observed");
}

async function waitForCompletedResult(page, sessionId) {
  const startedAt = Date.now();
  let lastResult = null;
  while (Date.now() - startedAt < RESULT_TIMEOUT_MS) {
    lastResult = await fetchResultJson(page, sessionId);
    if (lastResult.status === "completed" || lastResult.status === "failed") {
      break;
    }
    await delay(2_000);
  }
  if (lastResult?.status === "completed") {
    await page.waitForFunction(
      () => document.body.innerText.includes("AIロープレ評価レポート"),
      null,
      { timeout: 90_000 }
    ).catch(() => undefined);
  }
  return lastResult ?? { status: "not_found" };
}

async function waitForCompletedReportPage(page) {
  await page.waitForFunction(
    () => {
      const text = document.body?.innerText ?? "";
      const compactText = text.replace(/\s+/g, "");
      return (
        text.includes("AIロープレ評価レポート") &&
        text.includes("総合評価") &&
        compactText.includes("/100") &&
        text.includes("6大カテゴリ")
      );
    },
    null,
    { timeout: 90_000 }
  );
}

async function fetchResultJson(page, sessionId) {
  return page.evaluate(
    async ({ endpoint, id }) => {
      const response = await fetch(`${endpoint}?sessionId=${encodeURIComponent(id)}`);
      if (!response.ok) {
        return { status: "http_error", httpStatus: response.status };
      }
      return response.json();
    },
    { endpoint: EVAL_RESULT_ENDPOINT, id: sessionId }
  );
}

async function captureResultArtifacts(page, scorecard) {
  await page.screenshot({
    path: resolve(OUT_DIR, "result-page.png"),
    fullPage: true,
  });
  writeText("result-page-full.html", await page.content());
  if (scorecard) writeJson("scorecard-redacted.json", scorecard);
}

async function assertResultPageVisible(page) {
  const bodyText = await page.locator("body").innerText();
  const compactBodyText = bodyText.replace(/\s+/g, "");
  const required = [
    "総合評価",
    "6大カテゴリ",
    "ヒアリング達成度",
    "完全取得 / 部分取得 / 未取得",
    "最優先改善領域",
    "必須ヒアリング",
    "学習者へのフィードバック",
    "強みと改善点",
    "Next Training Actions",
  ];
  const requiredChecks = Object.fromEntries(
    required.map((text) => [text, bodyText.includes(text)])
  );
  requiredChecks["/100"] = compactBodyText.includes("/100");
  const forbidden = [
    "rawClaudeText",
    "validationJsonText",
    "relay ticket",
    "API secret",
    "hidden system prompt",
    "model_raw_output",
    "audioBase64",
  ];
  return {
    ok:
      Object.values(requiredChecks).every(Boolean) &&
      forbidden.every((text) => !bodyText.includes(text)),
    required: requiredChecks,
    forbidden: Object.fromEntries(
      forbidden.map((text) => [text, !bodyText.includes(text)])
    ),
  };
}

function redactScorecard(scorecard) {
  const report = scorecard?.report ?? {};
  return {
    evaluationFormat: scorecard?.evaluationFormat,
    evaluationProfile: scorecard?.evaluationProfile,
    runtimeVersion: scorecard?.runtimeVersion,
    scenarioId: scorecard?.scenarioId,
    report: {
      total_score: report.total_score,
      grade_label: report.grade_label,
      score_confidence: report.score_confidence,
      rubric_scores: report.rubric_scores,
      must_capture_summary: report.must_capture_summary,
      must_capture_items: report.must_capture_items,
      strengths: report.strengths,
      improvement_points: report.improvement_points,
      next_training_actions: report.next_training_actions,
      learner_feedback: report.learner_feedback,
    },
    validation: scorecard?.validation,
    usage: scorecard?.usage,
  };
}

function summarizeScorecard(scorecard) {
  const report = scorecard.report ?? {};
  const rubrics = report.rubric_scores ?? {};
  return {
    total_score: report.total_score,
    grade_label: report.grade_label,
    coverage: rubrics.coverage?.points,
    hearing_skill: rubrics.hearing_skill?.points,
    priority_clarity: rubrics.priority_clarity?.points,
    deal_structure: rubrics.deal_structure?.points,
    business_behavior: rubrics.business_behavior?.points,
    closing: rubrics.closing?.points,
    must_capture_summary: report.must_capture_summary,
  };
}

function buildScorecardSanity(scorecard, transcript) {
  const report = scorecard.report ?? {};
  const rubrics = report.rubric_scores ?? {};
  const expectedRubrics = {
    coverage: 30,
    hearing_skill: 20,
    priority_clarity: 20,
    deal_structure: 10,
    business_behavior: 10,
    closing: 10,
  };
  const items = Array.isArray(report.must_capture_items)
    ? report.must_capture_items
    : [];
  const summary = report.must_capture_summary ?? {};
  const captured = Number(summary.captured_count ?? 0);
  const partial = Number(summary.partial_count ?? 0);
  const missed = Number(summary.missed_count ?? 0);
  const transcriptText = transcript.map((turn) => turn.text).join("\n");
  const groundedEvidence = items
    .filter((item) => ["captured", "partial"].includes(String(item.judgement)))
    .every((item) => {
      const evidence = Array.isArray(item.evidence) ? item.evidence : [];
      if (evidence.length === 0) return true;
      return evidence.every((entry) => {
        const quote = String(entry?.quote ?? "").trim();
        if (!quote) return true;
        return transcriptText.includes(quote) || hasSubstantialOverlap(quote, transcriptText);
      });
    });
  const checks = {
    scoreRange:
      typeof report.total_score === "number" &&
      report.total_score >= 0 &&
      report.total_score <= 100,
    sixRubrics:
      Object.keys(expectedRubrics).length === Object.keys(rubrics).length &&
      Object.keys(expectedRubrics).every((key) => key in rubrics),
    rubricMaxPoints: Object.entries(expectedRubrics).every(
      ([key, max]) => rubrics[key]?.max_points === max
    ),
    rubricPointRanges: Object.entries(expectedRubrics).every(([key, max]) => {
      const points = rubrics[key]?.points;
      return typeof points === "number" && points >= 0 && points <= max;
    }),
    mustCaptureCount: items.length >= 12,
    captureCountConsistency: captured + partial + missed === items.length,
    weightedCaptureRatio:
      typeof summary.weighted_capture_ratio === "number" &&
      summary.weighted_capture_ratio >= 0 &&
      summary.weighted_capture_ratio <= 1,
    atLeastOneCaptured: captured > 0,
    atLeastOnePartialOrMissed: partial + missed > 0,
    nextTrainingActions:
      Array.isArray(report.next_training_actions) &&
      report.next_training_actions.length >= 1,
    improvementPoints:
      Array.isArray(report.improvement_points) &&
      report.improvement_points.length >= 1,
    validationOk: scorecard.validation?.ok === true,
    groundedEvidence,
  };
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    manualReview:
      typeof report.total_score === "number" && report.total_score >= 95,
  };
}

function hasSubstantialOverlap(quote, transcriptText) {
  const compactQuote = compactJapanese(quote);
  const compactTranscript = compactJapanese(transcriptText);
  if (compactQuote.length <= 8) {
    return compactTranscript.includes(compactQuote);
  }
  for (let index = 0; index < compactQuote.length - 7; index += 1) {
    if (compactTranscript.includes(compactQuote.slice(index, index + 8))) {
      return true;
    }
  }
  return false;
}

function compactJapanese(text) {
  return String(text).replace(/[\s、。，．,.！？!?"'「」『』（）()[\]［］【】]/g, "");
}

function assertNoSensitiveText(serialized) {
  const forbidden = [
    "rawClaudeText",
    "validationJsonText",
    "relay ticket",
    "API secret",
    "hidden system prompt",
    "model_raw_output",
    "audioBase64",
    "local-e2e-ticket",
  ];
  return {
    ok: forbidden.every((needle) => !serialized.includes(needle)),
    forbidden: Object.fromEntries(
      forbidden.map((needle) => [needle, !serialized.includes(needle)])
    ),
  };
}

function summarizeTranscript(transcript) {
  return {
    turnCount: transcript.length,
    userTurns: transcript.filter((turn) => turn.role === "user").length,
    agentTurns: transcript.filter((turn) => turn.role === "agent").length,
    firstUserTurn: transcript.find((turn) => turn.role === "user")?.text ?? null,
    firstAgentTurn: transcript.find((turn) => turn.role === "agent")?.text ?? null,
  };
}

function normalizeBrowserTurns(turns) {
  return turns
    .map((turn, index) => ({
      turn_id: turn.turn_id || `t${String(index + 1).padStart(3, "0")}`,
      speaker: turn.role === "user" ? "sales" : "client",
      text: String(turn.text ?? "").trim(),
      timestamp_sec: turn.timestamp_sec ?? index,
    }))
    .filter((turn) => turn.text.length > 0);
}

function writeEvents(events) {
  writeText(
    "events.jsonl",
    events.map((event) => JSON.stringify(event)).join("\n") + "\n"
  );
}

function writeJson(name, value) {
  writeFileSync(resolve(OUT_DIR, name), JSON.stringify(value, null, 2), "utf8");
}

function writeText(name, value) {
  writeFileSync(resolve(OUT_DIR, name), value, "utf8");
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
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

function booleanArg(value) {
  return value === true || value === "true" || value === "1";
}

function numberArg(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getLongConversation() {
  return [
  {
    user: "本日はよろしくお願いします。まず、今回の募集背景を教えていただけますか。",
    agent:
      "よろしくお願いいたします。受発注チームで退職予定が一名出ており、繁忙期も近いので早めに派遣の方をお願いしたいです。",
  },
  {
    user: "退職補充と繁忙期対応の両方ですね。業務内容は受発注入力、納期確認、仕入先への発注あたりが中心でしょうか。",
    agent:
      "はい、住宅設備部品の受注入力、納期確認、仕入先への発注、社内営業との調整が中心です。専用システムで一日五十件前後を処理します。",
  },
  {
    user: "就業条件について、勤務時間、曜日、残業、在宅可否をまとめて確認させてください。",
    agent:
      "平日の九時から十七時半、土日祝休みです。残業は通常月十時間ほどで、月末月初は一日三十分から一時間ほどあります。最初は出社で、慣れた後も基本は出社です。",
  },
  {
    user: "人選要件ですが、必須経験、歓迎経験、緩和できる条件を分けるとどうなりますか。",
    agent:
      "必須は事務経験と正確な入力です。受発注経験は歓迎ですが、住宅設備メーカー経験までは必須ではありません。業界経験より、数字や型番を間違えずに扱えることを重視します。",
  },
  {
    user: "社外との調整や電話、メール対応も任せる想定ですか。人物面ではどんな方が合いますか。",
    agent:
      "仕入先への納期確認や営業への状況共有があります。強い交渉というより、丁寧に確認できる方、周りに相談しながら進められる方が合います。",
  },
  {
    user: "職場環境と雰囲気について、部署人数や教える体制も教えてください。",
    agent:
      "部署は八名で、同じ業務をしている社員が三名います。初月はその社員が横について教えます。落ち着いていますが確認の会話は多い職場です。",
  },
  {
    user: "開始時期と決定プロセスを確認します。いつまでに開始したいか、書類確認後は職場見学をして決定する流れでしょうか。",
    agent:
      "できれば来月一日から、遅くとも来月中旬までです。まず人事で確認し、その後に現場課長にも見てもらいます。最終的には現場の意見を踏まえて決めます。",
  },
  {
    user: "職場見学では業務説明と顔合わせを軽く行う認識でよろしいですか。また、候補者の初回提案日はいつがよいでしょうか。",
    agent:
      "はい、業務説明と雰囲気確認が中心です。候補者は今週金曜日までに二、三名いただけると助かります。難しければまず一名でも構いません。",
  },
  {
    user: "ありがとうございます。最後に、提案時は受発注経験、正確な入力、周囲へ確認できる姿勢を優先します。金曜日までに初回提案し、その後に職場見学の日程調整という進め方でよろしいでしょうか。",
    agent:
      "はい、その進め方でお願いします。候補者情報をいただいたら、こちらで人事と現場に確認します。",
  },
  ];
}
