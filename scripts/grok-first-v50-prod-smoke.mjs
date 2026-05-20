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
const caseSet = stringArg(args["case-set"], mode);
const runs = numberArg(args.runs, 1);
const project = stringArg(args.project, "adecco-mendan");
const demoSlug = variant.startsWith("adecco-roleplay-")
  ? variant
  : `adecco-roleplay-${variant}`;
const apiBase = `/api/grok-first-${variant}`;
const url = `${origin}/demo/${demoSlug}?debugMetrics=1`;
const expectedPromptVersion = stringArg(
  args["expected-prompt-version"],
  variant === "v50-7-prompt-only" ||
    variant === "v50-7-quality" ||
    variant === "v50-7-4"
    ? "grok-first-v50.7.2-natural-interactive-sales-compact-2026-05-17"
    : "grok-first-v50.6-2026-05-15"
);
const expectedGuardrailVersion = stringArg(
  args["expected-guardrail-version"],
  variant === "v50-8"
    ? "grok-first-v50.8-guard-2026-05-16"
    : variant === "v50-7-prompt-only"
    ? "prompt-only-no-runtime-guard-2026-05-17"
    : variant === "v50-7-quality"
    ? "grok-first-v50.7-quality-guard-2026-05-17"
    : variant === "v50-7-4"
    ? "grok-first-v50.7.4-clean-quality-guard-2026-05-20"
    : "grok-first-v50.7-speed-hotfix-2026-05-17"
);
const expectedRuntimeGuardrailsEnabled = booleanArg(
  args["expected-runtime-guardrails-enabled"],
  variant !== "v50-7-prompt-only"
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
  caseSet,
  runs,
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

const SPEED_SMOKE_CASES = [
  {
    id: "speed-01-background",
    userText: "今回の募集背景を教えてください。",
    fixture: "test/fixtures/audio/grok-voice-v21/voice_case1_shallow_background.wav",
  },
  {
    id: "speed-02-background-detail",
    userText: "背景をもう少し詳しく教えてください。",
    fixture: "test/fixtures/audio/grok-voice-v21/voice_case1_shallow_background.wav",
  },
  {
    id: "speed-03-job-summary",
    userText: "業務内容の大枠を教えてください。",
    fixture: "test/fixtures/audio/grok-voice-v21/voice_case3_headcount.wav",
  },
  {
    id: "speed-04-requirement-priority",
    userText:
      "候補者要件で、メーカー経験と対外調整経験ならどちらを優先しますか。",
    fixture: "test/fixtures/audio/grok-voice-v21/voice_case4_rate.wav",
  },
  {
    id: "speed-05-skill-card",
    userText:
      "候補者が出たらスキルカードで確認いただく流れでよろしいでしょうか。",
    fixture: "test/fixtures/audio/grok-voice-v21/voice_case5_order_entry_requirement.wav",
  },
];

const accessToken = resolveAccessToken(project);

if (caseSet === "speed-smoke" && mode === "voice-turn") {
  await runSpeedSmoke();
} else if (mode === "session") {
  await runSessionContractSmoke();
} else {
  await runBrowserSmoke();
}

console.log(JSON.stringify(evidence, null, 2));
process.exitCode = evidence.pass ? 0 : 1;

async function runSpeedSmoke() {
  evidence.speedCases = SPEED_SMOKE_CASES.map((item) => ({
    id: item.id,
    userText: item.userText,
    fixture: path.resolve(item.fixture),
  }));
  evidence.attempts = [];
  for (let runIndex = 1; runIndex <= runs; runIndex += 1) {
    for (const testCase of SPEED_SMOKE_CASES) {
      evidence.attempts.push(await runSpeedSmokeAttempt({ runIndex, testCase }));
    }
  }
  evidence.completedAt = new Date().toISOString();
  evidence.results = summarizeSpeedSmoke(evidence.attempts);
  evidence.pass = evidence.results.finalConclusion === "SPEED_PASS";
  const sessionPayload =
    evidence.attempts.find((attempt) => attempt.sessionPayload)?.sessionPayload ?? null;
  if (sessionPayload) {
    writeFileSync(
      path.join(outDir, "session_payload.json"),
      JSON.stringify(sessionPayload, null, 2)
    );
  }
  writeFileSync(path.join(outDir, "results.json"), JSON.stringify(evidence, null, 2));
  writeFileSync(path.join(outDir, "evidence.json"), JSON.stringify(evidence, null, 2));
  writeFileSync(
    path.join(outDir, "events.jsonl"),
    evidence.attempts
      .flatMap((attempt) => attempt.events)
      .map((event) => JSON.stringify(event))
      .join("\n") + "\n"
  );
  writeFileSync(path.join(outDir, "report.md"), renderSpeedReport(evidence));
}

async function runSpeedSmokeAttempt({ runIndex, testCase }) {
  const attemptFixture = path.resolve(testCase.fixture);
  const browser = await (await import("playwright")).chromium.launch({
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${attemptFixture}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const context = await browser.newContext({
    baseURL: origin,
    permissions: ["microphone"],
  });
  await context.grantPermissions(["microphone"], { origin });
  const page = await context.newPage();
  const attempt = {
    runIndex,
    caseId: testCase.id,
    userText: testCase.userText,
    fixture: attemptFixture,
    sessionResponse: null,
    sessionPayload: null,
    events: [],
    eventKinds: [],
    websocketUrls: [],
    metrics: [],
    console: [],
    pageErrors: [],
    errorTextVisible: false,
  };

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
        if (requestUrl.includes(`${apiBaseArg}/event`) && typeof init?.body === "string") {
          window.__gfv50Events.push(JSON.parse(init.body));
        }
      } catch {
        // Evidence capture must not affect the route under test.
      }
      return originalFetch(...fetchArgs);
    };
  }, apiBase);

  page.on("console", (message) =>
    attempt.console.push({ type: message.type(), text: message.text() })
  );
  page.on("pageerror", (error) => attempt.pageErrors.push(error.message));
  page.on("websocket", (ws) => attempt.websocketUrls.push(ws.url()));
  page.on("request", (request) => {
    if (!request.url().includes(`${apiBase}/event`)) return;
    const raw = request.postData();
    if (!raw) return;
    try {
      const body = JSON.parse(raw);
      attempt.events.push(body);
      if (body?.kind) attempt.eventKinds.push(body.kind);
      if (body?.kind === "turn.completed") attempt.metrics.push(body.details);
    } catch {
      attempt.eventKinds.push("event.parse_failed");
    }
  });
  page.on("response", async (response) => {
    if (!response.url().includes(`${apiBase}/session`)) return;
    attempt.sessionResponse = { status: response.status(), ok: response.ok() };
    try {
      const json = await response.json();
      attempt.sessionPayload = summarizeSessionPayload(json);
    } catch (error) {
      attempt.sessionPayload = { parseError: error.message };
    }
  });

  try {
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
    await page.waitForTimeout(1000);
    attempt.errorTextVisible = await page
      .getByText("セッションの開始に失敗しました。時間をおいて再試行してください。")
      .isVisible()
      .catch(() => false);
  } finally {
    await context.close();
    await browser.close();
  }
  return attempt;
}

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
      evidence.texts.some((text) =>
        text.includes(
          variant === "v50-7-prompt-only" ||
            variant === "v50-7-quality" ||
            variant === "v50-7-4"
            ? "本日はお時間頂きありがとうございます。営業事務の件で、一名派遣の方を検討しています。"
            : "お電話ありがとうございます。"
        )
      );
    const voiceOk =
      mode !== "voice-turn" ||
      (evidence.eventKinds.includes("stt.completed") &&
        evidence.eventKinds.includes("turn.completed") &&
        evidence.metrics.some((metric) => isVoiceTurnMetricOk(metric)));
    evidence.pass = sessionOk && startOk && voiceOk && evidence.errorTextVisible === false;
    if (evidence.sessionPayload) {
      writeFileSync(
        path.join(outDir, "session_payload.json"),
        JSON.stringify(evidence.sessionPayload, null, 2)
      );
    }
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
  if (evidence.sessionPayload && !evidence.sessionPayload.error) {
    writeFileSync(
      path.join(outDir, "session_payload.json"),
      JSON.stringify(evidence.sessionPayload, null, 2)
    );
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
    productionCommitSha: json.productionCommitSha,
    guardrailVersion: json.guardrailVersion,
    model: json.model,
    voiceId: json.voiceId,
    realtimeTransport: json.realtimeTransport,
    wsUrl: json.wsUrl,
    authMode: json.realtimeAuth?.mode,
    runtimeGuardrailsEnabled: json.runtimeGuardrailsEnabled,
    inputGuardEnabled: json.inputGuardEnabled,
    normalInputRouterEnabled: json.normalInputRouterEnabled,
    negativeGuardEnabled: json.negativeGuardEnabled,
    tailGuardEnabled: json.tailGuardEnabled,
    fixedGuardAudioEnabled: json.fixedGuardAudioEnabled,
    boundedRewriteEnabled: json.boundedRewriteEnabled,
    noiseIgnoredEnabled: json.noiseIgnoredEnabled,
    runtimeTtsEnabled: json.runtimeTtsEnabled,
    replacementTtsEnabled: json.replacementTtsEnabled,
    latencyMode: json.latencyMode,
    streamAudioBeforeDone: json.streamAudioBeforeDone,
    audioHoldMs: json.audioHoldMs,
    guardedStreamingEnabled: json.guardedStreamingEnabled,
    tailGuardNormalHoldMs: json.tailGuardNormalHoldMs,
    tailGuardRiskHoldMs: json.tailGuardRiskHoldMs,
    tailGuardMaxHoldMs: json.tailGuardMaxHoldMs,
    qualityMinimalGuardEnabled: json.qualityMinimalGuardEnabled,
    fullTurnBufferEnabled: json.fullTurnBufferEnabled,
    turnDetectionCreateResponse: json.turnDetection?.create_response,
    turnDetectionSilenceMs: json.turnDetection?.silence_duration_ms,
    registeredSpeechPayloadIncluded: json.registeredSpeechPayloadIncluded,
    lockedResponseAudioBundleIncluded: json.lockedResponseAudioBundleIncluded,
    ephemeralTokenIncluded: Object.hasOwn(json, "ephemeralToken"),
  };
}

function isSessionContractOk(payload, status = evidence.sessionResponse?.status) {
  return (
    status === 200 &&
    payload?.demoSlug === demoSlug &&
    payload?.backend === `grok-first-${variant}` &&
    payload?.promptVersion === expectedPromptVersion &&
    payload?.guardrailVersion === expectedGuardrailVersion &&
    payload?.runtimeGuardrailsEnabled === expectedRuntimeGuardrailsEnabled &&
    (variant !== "v50-7" ||
      (payload?.latencyMode === "fastest_streaming" &&
        payload?.streamAudioBeforeDone === true &&
        payload?.audioHoldMs === 0 &&
        payload?.normalInputRouterEnabled === false &&
        payload?.boundedRewriteEnabled === false &&
        payload?.turnDetectionSilenceMs === 350 &&
        payload?.turnDetectionCreateResponse === false)) &&
    (variant !== "v50-7-quality" ||
      (payload?.latencyMode === "guarded_tail_streaming" &&
        payload?.streamAudioBeforeDone === true &&
        payload?.guardedStreamingEnabled === true &&
        payload?.tailGuardNormalHoldMs === 300 &&
        payload?.tailGuardRiskHoldMs === 800 &&
        payload?.tailGuardMaxHoldMs === 1000 &&
        payload?.fullTurnBufferEnabled === false &&
        payload?.normalInputRouterEnabled === true &&
        payload?.boundedRewriteEnabled === false &&
        payload?.turnDetectionSilenceMs === 650 &&
        payload?.turnDetectionCreateResponse === false)) &&
    (variant !== "v50-7-4" ||
      (payload?.runtimeGuardrailsEnabled === true &&
        payload?.inputGuardEnabled === true &&
        payload?.normalInputRouterEnabled === false &&
        payload?.boundedRewriteEnabled === false &&
        payload?.negativeGuardEnabled === true &&
        payload?.tailGuardEnabled === true &&
        payload?.fixedGuardAudioEnabled === true &&
        payload?.noiseIgnoredEnabled === false &&
        payload?.latencyMode === "clean_tail_streaming" &&
        payload?.streamAudioBeforeDone === true &&
        payload?.turnDetectionSilenceMs === 650 &&
        payload?.turnDetectionCreateResponse === false)) &&
    payload?.wsUrl === "wss://voice.mendan.biz/api/v3/realtime-relay" &&
    payload?.authMode === "mendan_relay_subprotocol" &&
    payload?.registeredSpeechPayloadIncluded === false &&
    payload?.lockedResponseAudioBundleIncluded === false &&
    payload?.ephemeralTokenIncluded === false
  );
}

function isVoiceTurnMetricOk(metric) {
  if (!metric || metric.audioBytes <= 0 || metric.error !== null) return false;
  if (variant === "v50-7-4") return isCleanQualityVoiceTurnMetricOk(metric);
  if (variant !== "v50-7") return true;
  return (
    metric.routePath === "grok_first_realtime" &&
    metric.guardAction === "pass" &&
    Array.isArray(metric.guardReasons) &&
    metric.guardReasons.length === 0 &&
    metric.fullTurnBufferCount === 0 &&
    metric.tailGuardHoldMs === 0 &&
    metric.tailAudioDroppedBytes === 0
  );
}

function isCleanQualityVoiceTurnMetricOk(metric) {
  const guardActionOk = ["pass", "metric", "strip_tail"].includes(metric.guardAction);
  const releaseModeOk = ["pass_stream_release", "guarded_tail_stream_release"].includes(
    metric.audioReleaseMode
  );
  return (
    Number(metric.audioBytes ?? 0) > 0 &&
    Number(metric.releasedAudioBytes ?? 0) > 0 &&
    String(metric.audibleTranscript ?? "").trim().length > 0 &&
    metric.error === null &&
    metric.routePath === "grok_first_realtime" &&
    guardActionOk &&
    releaseModeOk &&
    metric.audioReleaseMode !== "tail_only_drop_fallback" &&
    metric.audioReleaseMode !== "fixed_short_ack_audio" &&
    metric.audioReleaseMode !== "fixed_safe_body_audio" &&
    metric.routePath !== "noise_ignored" &&
    metric.routePath !== "normal_realtime_rewrite" &&
    Number(metric.firstDeltaToFirstAudibleMs ?? Infinity) <= 1000 &&
    metric.responseDoneBeforeFirstAudible === false &&
    !(
      String(metric.visibleAssistantTranscript ?? "").trim().length > 0 &&
      String(metric.audibleTranscript ?? "").trim().length === 0
    )
  );
}

function isSpeedVoiceTurnMetricOk(metric) {
  return (
    metric &&
    metric.audioBytes > 0 &&
    metric.error === null &&
    metric.fullTurnBufferCount === 0 &&
    metric.tailGuardHoldMs === 0 &&
    metric.tailAudioDroppedBytes === 0 &&
    metric.latencyMode === "fastest_streaming" &&
    metric.streamAudioBeforeDone === true &&
    metric.turnDetectionSilenceMs === 350 &&
    typeof metric.firstAudioDeltaMs === "number" &&
    typeof metric.firstAudibleAudioMs === "number" &&
    typeof metric.firstDeltaToFirstAudibleMs === "number"
  );
}

function summarizeSpeedSmoke(attempts) {
  const failures = [];
  const metrics = attempts.flatMap((attempt) => attempt.metrics ?? []);
  const add = (attempt, message) =>
    failures.push(`${attempt.caseId} run ${attempt.runIndex}: ${message}`);
  for (const attempt of attempts) {
    const payload = attempt.sessionPayload ?? {};
    if (attempt.sessionResponse?.status !== 200) {
      add(attempt, `session status=${attempt.sessionResponse?.status ?? "<missing>"}`);
    }
    if (!isSessionContractOk(payload, attempt.sessionResponse?.status)) {
      add(attempt, "session identity mismatch");
    }
    if (!attempt.websocketUrls.includes("wss://voice.mendan.biz/api/v3/realtime-relay")) {
      add(attempt, "relay websocket missing");
    }
    for (const kind of ["ws.connected", "session.ready", "stt.completed", "turn.completed"]) {
      if (!attempt.eventKinds.includes(kind)) add(attempt, `missing ${kind}`);
    }
    if (attempt.errorTextVisible) add(attempt, "session error visible");
    if (attempt.metrics.length === 0) add(attempt, "turn.completed metrics missing");
    for (const metric of attempt.metrics) {
      if (!isSpeedVoiceTurnMetricOk(metric)) add(attempt, "voice metric failed");
      if (metric?.latencyMode !== "fastest_streaming") add(attempt, `latencyMode=${metric?.latencyMode}`);
      if (metric?.streamAudioBeforeDone !== true) add(attempt, `streamAudioBeforeDone=${metric?.streamAudioBeforeDone}`);
      if (metric?.turnDetectionSilenceMs !== 350) add(attempt, `turnDetectionSilenceMs=${metric?.turnDetectionSilenceMs}`);
      if (metric?.firstDeltaToFirstAudibleMs === null || metric?.firstDeltaToFirstAudibleMs === undefined) {
        add(attempt, "firstDeltaToFirstAudibleMs missing");
      }
    }
  }
  const firstAudioDeltaMs = percentileSummary(
    metrics.map((metric) => metric.firstAudioDeltaMs).filter(isFiniteNumber)
  );
  const firstAudibleAudioMs = percentileSummary(
    metrics.map((metric) => metric.firstAudibleAudioMs).filter(isFiniteNumber)
  );
  const firstDeltaToFirstAudibleMs = percentileSummary(
    metrics.map((metric) => metric.firstDeltaToFirstAudibleMs).filter(isFiniteNumber)
  );
  const doneMs = percentileSummary(
    metrics.map((metric) => metric.doneMs).filter(isFiniteNumber)
  );
  const maxFullTurnBufferCount = Math.max(
    0,
    ...metrics.map((metric) => Number(metric.fullTurnBufferCount ?? 0))
  );
  const maxTailGuardHoldMs = Math.max(
    0,
    ...metrics.map((metric) => Number(metric.tailGuardHoldMs ?? 0))
  );
  const maxTailAudioDroppedBytes = Math.max(
    0,
    ...metrics.map((metric) => Number(metric.tailAudioDroppedBytes ?? 0))
  );
  const expectedAttempts = SPEED_SMOKE_CASES.length * runs;
  if (attempts.length !== expectedAttempts) {
    failures.push(`expected ${expectedAttempts} attempts, got ${attempts.length}`);
  }
  if (metrics.length !== expectedAttempts) {
    failures.push(`expected ${expectedAttempts} turn.completed metrics, got ${metrics.length}`);
  }
  if ((firstAudioDeltaMs.p50 ?? Infinity) > 3000) failures.push(`firstAudioDeltaMs p50=${firstAudioDeltaMs.p50}`);
  if ((firstAudibleAudioMs.p50 ?? Infinity) > 3200) failures.push(`firstAudibleAudioMs p50=${firstAudibleAudioMs.p50}`);
  if ((firstAudibleAudioMs.p95 ?? Infinity) > 6000) failures.push(`firstAudibleAudioMs p95=${firstAudibleAudioMs.p95}`);
  if ((firstDeltaToFirstAudibleMs.p95 ?? Infinity) > 200) {
    failures.push(`firstDeltaToFirstAudibleMs p95=${firstDeltaToFirstAudibleMs.p95}`);
  }
  if (maxFullTurnBufferCount > 0) failures.push(`fullTurnBufferCount max=${maxFullTurnBufferCount}`);
  if (maxTailGuardHoldMs > 0) failures.push(`tailGuardHoldMs max=${maxTailGuardHoldMs}`);
  if (maxTailAudioDroppedBytes > 0) failures.push(`tailAudioDroppedBytes max=${maxTailAudioDroppedBytes}`);
  const blocked = attempts.some(
    (attempt) =>
      attempt.sessionResponse?.status !== 200 ||
      attempt.errorTextVisible ||
      !attempt.eventKinds.includes("ws.connected") ||
      !attempt.eventKinds.includes("session.ready")
  );
  return {
    finalConclusion:
      failures.length === 0 ? "SPEED_PASS" : blocked ? "SPEED_BLOCKED" : "SPEED_FAIL",
    humanTestAllowed:
      failures.length === 0 ? "manual speed check only" : "no",
    qualityStatus: "NOT EVALUATED",
    attemptCount: attempts.length,
    turnCompletedCount: metrics.length,
    firstAudioDeltaMs,
    firstAudibleAudioMs,
    firstDeltaToFirstAudibleMs,
    doneMs,
    maxFullTurnBufferCount,
    maxTailGuardHoldMs,
    maxTailAudioDroppedBytes,
    audioBytes: percentileSummary(
      metrics.map((metric) => metric.audioBytes).filter(isFiniteNumber)
    ),
    failures,
  };
}

function renderSpeedReport(data) {
  const results = data.results;
  const payload = data.attempts.find((attempt) => attempt.sessionPayload)?.sessionPayload ?? {};
  return [
    "# v50.7 In-place Speed Hotfix Report",
    "",
    `Final conclusion: ${results.finalConclusion}`,
    `Human test allowed: ${results.humanTestAllowed}`,
    "Quality status: NOT EVALUATED",
    "Known risk: audio may be heard before final transcript guard.",
    "",
    `Route: ${url}`,
    `API base: ${apiBase}`,
    `Prompt version: ${payload.promptVersion ?? "not observed"}`,
    `Production commit SHA: ${payload.productionCommitSha ?? "not observed"}`,
    `Guardrail version: ${payload.guardrailVersion ?? "not observed"}`,
    `Latency mode: ${payload.latencyMode ?? "not observed"}`,
    `streamAudioBeforeDone: ${payload.streamAudioBeforeDone ?? "not observed"}`,
    `normalInputRouterEnabled: ${payload.normalInputRouterEnabled ?? "not observed"}`,
    `boundedRewriteEnabled: ${payload.boundedRewriteEnabled ?? "not observed"}`,
    `turnDetection.silence_duration_ms: ${payload.turnDetectionSilenceMs ?? "not observed"}`,
    `turnDetection.create_response: ${String(payload.turnDetectionCreateResponse)}`,
    "",
    "## Commands",
    "",
    `node scripts/grok-first-v50-prod-smoke.mjs --variant ${variant} --mode ${mode} --case-set ${caseSet} --runs ${runs} --out ${outDir}`,
    "",
    "## Latency",
    "",
    `firstAudioDelta p50/p95: ${results.firstAudioDeltaMs.p50 ?? "n/a"} / ${results.firstAudioDeltaMs.p95 ?? "n/a"}`,
    `firstAudible p50/p95: ${results.firstAudibleAudioMs.p50 ?? "n/a"} / ${results.firstAudibleAudioMs.p95 ?? "n/a"}`,
    `firstDeltaToFirstAudible p50/p95: ${results.firstDeltaToFirstAudibleMs.p50 ?? "n/a"} / ${results.firstDeltaToFirstAudibleMs.p95 ?? "n/a"}`,
    `doneMs p50/p95: ${results.doneMs.p50 ?? "n/a"} / ${results.doneMs.p95 ?? "n/a"}`,
    `audioBytes p50/p95: ${results.audioBytes.p50 ?? "n/a"} / ${results.audioBytes.p95 ?? "n/a"}`,
    `fullTurnBufferCount max: ${results.maxFullTurnBufferCount}`,
    `tailGuardHoldMs max: ${results.maxTailGuardHoldMs}`,
    `tailAudioDroppedBytes max: ${results.maxTailAudioDroppedBytes}`,
    `turn.completed count: ${results.turnCompletedCount}`,
    "",
    "## Known Quality Risks",
    "",
    "- This is an in-place v50.7 speed hotfix.",
    "- It invalidates direct latency comparison with prior v50.7 quality evidence after this deployment.",
    "- Audio may be heard before final transcript guard.",
    "- Quality status is NOT EVALUATED.",
    "",
    "## Failures",
    "",
    results.failures.length === 0
      ? "- none"
      : results.failures.map((failure) => `- ${failure}`).join("\n"),
    "",
    "## Recommendation",
    "",
    results.finalConclusion === "SPEED_PASS"
      ? "- Allow manual speed check only, then move to quality-speed balance phase."
      : "- Treat as speed hotfix failure/blocker and inspect events/results before manual check.",
    "",
  ].join("\n");
}

function percentileSummary(values) {
  const sorted = values.filter(isFiniteNumber).sort((a, b) => a - b);
  if (sorted.length === 0) return { n: 0, p50: null, p95: null, min: null, max: null };
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
  return {
    n: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
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

function numberArg(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
