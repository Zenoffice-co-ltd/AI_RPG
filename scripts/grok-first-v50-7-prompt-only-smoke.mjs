// Prompt-only production smoke for the v50.6 system-prompt diagnostic route.
//
// Usage:
//   pnpm grok:first-v50-7-prompt-only-smoke -- \
//     --base-url https://roleplay.mendan.biz \
//     --route /demo/adecco-roleplay-v50-7-prompt-only \
//     --api-base /api/grok-first-v50-7-prompt-only \
//     --case-set prompt-only-smoke

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const args = parseArgs(process.argv.slice(2));
const baseUrl = stringArg(args["base-url"] ?? args.origin, "https://roleplay.mendan.biz");
const route = stringArg(args.route, "/demo/adecco-roleplay-v50-7-prompt-only");
const apiBase = stringArg(args["api-base"], "/api/grok-first-v50-7-prompt-only");
const caseSet = stringArg(args["case-set"], "prompt-only-smoke");
const runs = numberArg(args.runs, 1);
const project = stringArg(args.project, "adecco-mendan");
const fixture = path.resolve(
  stringArg(args.fixture, "test/fixtures/audio/grok-voice-v21/voice_case1_shallow_background.wav")
);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.resolve(
  stringArg(args.out, path.join("out", "grok_first_v50_7_prompt_only", `smoke_${timestamp}`))
);
const screenshotsDir = path.join(outDir, "screenshots");
mkdirSync(screenshotsDir, { recursive: true });

const expected = {
  demoSlug: "adecco-roleplay-v50-7-prompt-only",
  backend: "grok-first-v50-7-prompt-only",
  promptVersion: "grok-first-v50.6-2026-05-15",
  guardrailVersion: "prompt-only-no-runtime-guard-2026-05-17",
  wsUrl: "wss://voice.mendan.biz/api/v3/realtime-relay",
  authMode: "mendan_relay_subprotocol",
};

const evidence = {
  caseSet,
  baseUrl,
  route,
  apiBase,
  runs,
  fixture,
  startedAt: new Date().toISOString(),
  attempts: [],
};
const accessToken = resolveAccessToken(project);
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${fixture}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
});

try {
  for (let runIndex = 1; runIndex <= runs; runIndex += 1) {
    evidence.attempts.push(await runOnce({ browser, runIndex }));
  }
} finally {
  evidence.completedAt = new Date().toISOString();
  evidence.summary = summarize(evidence.attempts);
  evidence.pass = evidence.summary.failures.length === 0;
  writeFileSync(path.join(outDir, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  writeFileSync(path.join(outDir, "session_payload.json"), JSON.stringify(evidence.attempts[0]?.sessionRaw ?? null, null, 2) + "\n");
  writeFileSync(path.join(outDir, "events.jsonl"), evidence.attempts.flatMap((attempt) => attempt.events).map((event) => JSON.stringify(event)).join("\n") + "\n");
  writeFileSync(path.join(outDir, "report.md"), renderReport(evidence));
  writeFileSync(path.join(outDir, "manual_review_score_sheet.md"), renderManualScoreSheet());
  writeFileSync(path.join(outDir, "manual_review_result.md"), renderManualResultTemplate());
  await browser.close();
}

console.log(JSON.stringify({ pass: evidence.pass, out: outDir, summary: evidence.summary }, null, 2));
process.exit(evidence.pass ? 0 : 1);

async function runOnce({ browser, runIndex }) {
  const context = await browser.newContext({ baseURL: baseUrl, permissions: ["microphone"] });
  await context.grantPermissions(["microphone"], { origin: baseUrl });
  const page = await context.newPage();
  const attempt = {
    runIndex,
    sessionResponse: null,
    sessionPayload: null,
    sessionRaw: null,
    events: [],
    eventKinds: [],
    websocketUrls: [],
    metrics: [],
    errorTextVisible: false,
    screenshot: path.join(screenshotsDir, `after_run_${runIndex}.png`),
  };

  await page.addInitScript((apiBaseArg) => {
    window.__gfv50PromptOnlyEvents = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...fetchArgs) => {
      try {
        const [input, init] = fetchArgs;
        const requestUrl =
          typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
        if (requestUrl.includes(`${apiBaseArg}/event`) && typeof init?.body === "string") {
          window.__gfv50PromptOnlyEvents.push(JSON.parse(init.body));
        }
      } catch {
        // Evidence capture must not affect the route under test.
      }
      return originalFetch(...fetchArgs);
    };
  }, apiBase);

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
    const json = await response.json().catch((error) => ({ parseError: error.message }));
    attempt.sessionRaw = redactSessionPayload(json);
    attempt.sessionPayload = {
      demoSlug: json.demoSlug,
      backend: json.backend,
      promptVersion: json.promptVersion,
      guardrailVersion: json.guardrailVersion,
      runtimeControlMode: json.runtimeControl?.mode,
      runtimeGuardrailsEnabled: json.runtimeGuardrailsEnabled,
      inputGuardEnabled: json.inputGuardEnabled,
      normalInputRouterEnabled: json.normalInputRouterEnabled,
      negativeGuardEnabled: json.negativeGuardEnabled,
      tailGuardEnabled: json.tailGuardEnabled,
      fixedGuardAudioEnabled: json.fixedGuardAudioEnabled,
      boundedRewriteEnabled: json.boundedRewriteEnabled,
      noiseIgnoredEnabled: json.noiseIgnoredEnabled,
      fullTurnBufferEnabled: json.fullTurnBufferEnabled,
      replacementTtsEnabled: json.replacementTtsEnabled,
      latencyMode: json.latencyMode,
      streamAudioBeforeDone: json.streamAudioBeforeDone,
      audioHoldMs: json.audioHoldMs,
      turnDetectionCreateResponse: json.turnDetection?.create_response !== false,
      turnDetectionSilenceMs: json.turnDetection?.silence_duration_ms,
      realtimeTransport: json.realtimeTransport,
      wsUrl: json.wsUrl,
      authMode: json.realtimeAuth?.mode,
    };
  });

  try {
    await page.goto(route, { waitUntil: "networkidle" });
    const accessInput = page.getByLabel("アクセスコード");
    if (await accessInput.isVisible().catch(() => false)) {
      await accessInput.fill(accessToken);
      await Promise.all([
        page.waitForURL(new RegExp(route.replaceAll("/", "\\/")), { timeout: 30000 }),
        page.getByRole("button", { name: "開始" }).click(),
      ]);
    }
    await page.waitForSelector('[data-testid="roleplay-header"]', { timeout: 30000 });
    await page.getByRole("button", { name: "通話を開始" }).click();
    await page.waitForFunction(
      () => {
        const events = window.__gfv50PromptOnlyEvents ?? [];
        return (
          document.body.innerText.includes("セッションの開始に失敗しました") ||
          events.some((event) => event.kind === "turn.completed")
        );
      },
      null,
      { timeout: 120000 }
    ).catch(() => undefined);
    attempt.errorTextVisible = await page
      .getByText("セッションの開始に失敗しました。時間をおいて再試行してください。")
      .isVisible()
      .catch(() => false);
    await page.screenshot({ path: attempt.screenshot, fullPage: true });
  } finally {
    await context.close();
  }
  return attempt;
}

function redactSessionPayload(session) {
  if (!session || typeof session !== "object") return session;
  return {
    ...session,
    instructions: typeof session.instructions === "string" ? "<redacted>" : session.instructions,
    realtimeAuth:
      session.realtimeAuth && typeof session.realtimeAuth === "object"
        ? { ...session.realtimeAuth, ticket: "<redacted>" }
        : session.realtimeAuth,
  };
}

function summarize(attempts) {
  const failures = [];
  const counts = {};
  const forbiddenRoutePaths = ["fixed_guard", "noise_ignored", "suppressed"];
  const forbiddenGuardActions = ["fixed_exit", "fixed_external", "cancel", "suppress"];
  for (const attempt of attempts) {
    for (const kind of attempt.eventKinds) counts[kind] = (counts[kind] ?? 0) + 1;
    const session = attempt.sessionPayload ?? {};
    const add = (message) => failures.push(`run ${attempt.runIndex}: ${message}`);
    if (attempt.sessionResponse?.status !== 200) add(`session status=${attempt.sessionResponse?.status ?? "<missing>"}`);
    for (const [key, value] of Object.entries(expected)) {
      if (session[key] !== value) add(`${key}=${session[key] ?? "<missing>"}`);
    }
    for (const key of [
      "runtimeGuardrailsEnabled",
      "inputGuardEnabled",
      "normalInputRouterEnabled",
      "negativeGuardEnabled",
      "tailGuardEnabled",
      "fixedGuardAudioEnabled",
      "boundedRewriteEnabled",
      "noiseIgnoredEnabled",
      "fullTurnBufferEnabled",
      "replacementTtsEnabled",
      "turnDetectionCreateResponse",
    ]) {
      if (session[key] !== false) add(`${key}=${session[key] ?? "<missing>"}`);
    }
    if (session.latencyMode !== undefined) add(`latencyMode=${session.latencyMode}`);
    if (session.streamAudioBeforeDone !== undefined) add(`streamAudioBeforeDone=${session.streamAudioBeforeDone}`);
    if (session.audioHoldMs !== undefined) add(`audioHoldMs=${session.audioHoldMs}`);
    if (session.turnDetectionSilenceMs !== 650) add(`turnDetectionSilenceMs=${session.turnDetectionSilenceMs ?? "<missing>"}`);
    if (session.runtimeControlMode !== "prompt_only") add(`runtimeControl.mode=${session.runtimeControlMode ?? "<missing>"}`);
    if (!attempt.websocketUrls.includes(expected.wsUrl)) add("relay websocket missing");
    for (const kind of ["ws.connected", "session.ready", "stt.completed", "turn.completed"]) {
      if (!attempt.eventKinds.includes(kind)) add(`missing ${kind}`);
    }
    if (attempt.errorTextVisible) add("session error visible");
    for (const kind of [
      "guard.detected",
      "fixed_guard.playback.started",
      "fixed_guard.playback.completed",
      "tail_guard.released",
      "tail_guard.dropped",
    ]) {
      if (attempt.eventKinds.includes(kind)) add(`forbidden event ${kind}`);
    }
    for (const metric of attempt.metrics) {
      if (metric?.audioBytes <= 0) add(`audioBytes=${metric?.audioBytes}`);
      if (metric?.error !== null) add(`turn error=${metric?.error}`);
      if (metric?.routePath !== "grok_first_realtime") add(`routePath=${metric?.routePath}`);
      if (metric?.guardAction !== "pass") add(`guardAction=${metric?.guardAction}`);
      if (Array.isArray(metric?.guardReasons) && metric.guardReasons.length > 0) add(`guardReasons=${metric.guardReasons.join(",")}`);
      if (Number(metric?.responseCancelCount ?? 0) !== 0) add(`responseCancelCount=${metric?.responseCancelCount}`);
      if (Array.isArray(metric?.responseCancelReasons) && metric.responseCancelReasons.length > 0) add(`responseCancelReasons=${metric.responseCancelReasons.join(",")}`);
      if (Number(metric?.fullTurnBufferCount ?? 0) !== 0) add(`fullTurnBufferCount=${metric?.fullTurnBufferCount}`);
      if (Number(metric?.tailGuardHoldMs ?? 0) !== 0) add(`tailGuardHoldMs=${metric?.tailGuardHoldMs}`);
      if (Number(metric?.tailAudioDroppedBytes ?? 0) !== 0) add(`tailAudioDroppedBytes=${metric?.tailAudioDroppedBytes}`);
      if (metric?.latencyMode !== "default") add(`metric.latencyMode=${metric?.latencyMode}`);
      if (metric?.streamAudioBeforeDone !== false) add(`metric.streamAudioBeforeDone=${metric?.streamAudioBeforeDone}`);
      if (metric?.turnDetectionSilenceMs !== 650) add(`metric.turnDetectionSilenceMs=${metric?.turnDetectionSilenceMs}`);
      if (forbiddenRoutePaths.includes(metric?.routePath)) add(`forbidden routePath=${metric.routePath}`);
      if (forbiddenGuardActions.includes(metric?.guardAction)) add(`forbidden guardAction=${metric.guardAction}`);
    }
  }
  const metrics = attempts.flatMap((attempt) => attempt.metrics);
  return {
    eventCounts: counts,
    failures,
    smokeResult: failures.length === 0 ? "PASS" : "FAIL",
    conclusion: failures.length === 0 ? "MANUAL_REVIEW_REQUIRED" : "PROMPT_ONLY_BLOCKED",
    firstAudioDeltaMs: percentileSummary(metrics.map((metric) => metric.firstAudioDeltaMs).filter(isFiniteNumber)),
    firstAudibleAudioMs: percentileSummary(metrics.map((metric) => metric.firstAudibleAudioMs).filter(isFiniteNumber)),
    firstDeltaToFirstAudibleMs: percentileSummary(metrics.map((metric) => metric.firstDeltaToFirstAudibleMs).filter(isFiniteNumber)),
    doneMs: percentileSummary(metrics.map((metric) => metric.doneMs).filter(isFiniteNumber)),
  };
}

function renderReport(data) {
  const session = data.attempts[0]?.sessionPayload ?? {};
  const metric = data.attempts.flatMap((attempt) => attempt.metrics).at(-1) ?? {};
  const count = (kind) => data.summary.eventCounts[kind] ?? 0;
  const metricCount = (predicate) =>
    data.attempts.flatMap((attempt) => attempt.metrics).filter(predicate).length;
  return [
    "# v50.7 Prompt-Only Smoke Report",
    "",
    `Smoke result: ${data.summary.smokeResult}`,
    `Final conclusion: ${data.summary.conclusion}`,
    "Human test type: prompt-only diagnostic",
    "Product human test allowed: no",
    "",
    `Route: ${data.route}`,
    `API base: ${data.apiBase}`,
    `Prompt version: ${session.promptVersion ?? "not observed"}`,
    `Guardrail version: ${session.guardrailVersion ?? "not observed"}`,
    `Latency mode: ${session.latencyMode ?? "not observed"}`,
    `streamAudioBeforeDone: ${String(session.streamAudioBeforeDone)}`,
    `audioHoldMs: ${session.audioHoldMs ?? "not observed"}`,
    `turnDetection.silence_duration_ms: ${session.turnDetectionSilenceMs ?? "not observed"}`,
    "Response orchestration mode: app_manual_response_create",
    "",
    "## Runtime Guard Absence Proof",
    "",
    `runtimeControl.mode = ${session.runtimeControlMode ?? "not observed"}`,
    `runtimeGuardrailsEnabled = ${String(session.runtimeGuardrailsEnabled)}`,
    `inputGuardEnabled = ${String(session.inputGuardEnabled)}`,
    `normalInputRouterEnabled = ${String(session.normalInputRouterEnabled)}`,
    `negativeGuardEnabled = ${String(session.negativeGuardEnabled)}`,
    `tailGuardEnabled = ${String(session.tailGuardEnabled)}`,
    `fixedGuardAudioEnabled = ${String(session.fixedGuardAudioEnabled)}`,
    `boundedRewriteEnabled = ${String(session.boundedRewriteEnabled)}`,
    `noiseIgnoredEnabled = ${String(session.noiseIgnoredEnabled)}`,
    `guard.detected count = ${count("guard.detected")}`,
    `fixed_guard.playback.started count = ${count("fixed_guard.playback.started")}`,
    `fixed_guard.playback.completed count = ${count("fixed_guard.playback.completed")}`,
    `tail_guard.released count = ${count("tail_guard.released")}`,
    `tail_guard.dropped count = ${count("tail_guard.dropped")}`,
    `routePath=fixed_guard/noise_ignored/suppressed count = ${metricCount((m) => ["fixed_guard", "noise_ignored", "suppressed"].includes(m?.routePath))}`,
    `guardAction=fixed_exit/fixed_external/cancel/suppress count = ${metricCount((m) => ["fixed_exit", "fixed_external", "cancel", "suppress"].includes(m?.guardAction))}`,
    `response.cancel content reason count = ${metricCount((m) => Array.isArray(m?.responseCancelReasons) && m.responseCancelReasons.length > 0)}`,
    `fullTurnBufferCount = ${metric.fullTurnBufferCount ?? "not observed"}`,
    `tailGuardHoldMs = ${metric.tailGuardHoldMs ?? "not observed"}`,
    `tailAudioDroppedBytes = ${metric.tailAudioDroppedBytes ?? "not observed"}`,
    `fixed audio bytes = ${metric.fixedAudioBytes ?? 0}`,
    "",
    "## Voice Path Proof",
    "",
    `firstAudioDeltaMs: ${metric.firstAudioDeltaMs ?? "not observed"}`,
    `firstAudibleAudioMs: ${metric.firstAudibleAudioMs ?? "not observed"}`,
    `firstDeltaToFirstAudibleMs: ${metric.firstDeltaToFirstAudibleMs ?? "not observed"}`,
    `audioBytes: ${metric.audioBytes ?? "not observed"}`,
    `turn.completed: ${count("turn.completed")}`,
    `firstAudioDelta p50/p95: ${data.summary.firstAudioDeltaMs.p50 ?? "n/a"} / ${data.summary.firstAudioDeltaMs.p95 ?? "n/a"}`,
    `firstAudible p50/p95: ${data.summary.firstAudibleAudioMs.p50 ?? "n/a"} / ${data.summary.firstAudibleAudioMs.p95 ?? "n/a"}`,
    `firstDeltaToFirstAudible p50/p95: ${data.summary.firstDeltaToFirstAudibleMs.p50 ?? "n/a"} / ${data.summary.firstDeltaToFirstAudibleMs.p95 ?? "n/a"}`,
    `doneMs p50/p95: ${data.summary.doneMs.p50 ?? "n/a"} / ${data.summary.doneMs.p95 ?? "n/a"}`,
    "",
    "## Smoke Result",
    "",
    data.summary.failures.length === 0
      ? "PASS. Manual review is still required before PROMPT_ONLY_USABLE can be claimed."
      : data.summary.failures.map((failure) => `- ${failure}`).join("\n"),
    "",
    "## Next Phase Recommendation",
    "",
    "Use manual prompt-only review to classify failures into input guard, output guard, audio guard, or prompt-change needs. Do not treat this smoke as product rollout approval.",
    "",
  ].join("\n");
}

function renderManualScoreSheet() {
  return [
    "# Prompt-Only Manual Review Score Sheet",
    "",
    "- Reviewer 1 (business/sales):",
    "- Reviewer 2 (implementation/QA):",
    "- Final conclusion: PROMPT_ONLY_USABLE / PROMPT_ONLY_NOT_USABLE / PROMPT_ONLY_BLOCKED",
    "- P0 count:",
    "- P1 count:",
    "- Representative transcripts:",
    "",
  ].join("\n");
}

function renderManualResultTemplate() {
  return [
    "# Prompt-Only Manual Review Result",
    "",
    "Final conclusion: PROMPT_ONLY_BLOCKED",
    "Product human test allowed: no",
    "",
    "Key prompt-only failures:",
    "- not reviewed yet",
    "",
    "Recommendation:",
    "- Complete the two-reviewer prompt-only diagnostic before moving to guard design.",
    "",
  ].join("\n");
}

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

function numberArg(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function resolveAccessToken(project) {
  if (process.env.DEMO_ACCESS_TOKEN) return process.env.DEMO_ACCESS_TOKEN;
  const command =
    process.platform === "win32"
      ? {
          file: "powershell.exe",
          args: [
            "-NoProfile",
            "-Command",
            `gcloud secrets versions access latest --secret=demo-access-token --project=${project}`,
          ],
        }
      : {
          file: "gcloud",
          args: ["secrets", "versions", "access", "latest", "--secret=demo-access-token", `--project=${project}`],
        };
  const result = spawnSync(command.file, command.args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    console.error("BLOCKED: DEMO_ACCESS_TOKEN not available");
    console.error(result.stderr || result.error?.message || "Secret Manager returned no value");
    process.exit(2);
  }
  return result.stdout.trim();
}
