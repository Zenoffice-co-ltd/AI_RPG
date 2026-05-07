// Browser WebAudio smoke for the deployed Adecco Grok Voice v2.1 route.
//
// This verifies the UX surface that API smoke cannot see: the production page
// starts a browser session, plays greeting audio, sends one normal Realtime text
// turn, sends one deterministic locked-response turn, and captures /api/v3/event
// telemetry plus a small WebAudio source probe.

import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE_URL =
  process.env.PROD_BASE_URL ??
  "https://adecco-roleplay--adecco-mendan.asia-east1.hosted.app";
const MODE = process.env.GROK_BROWSER_SMOKE_MODE ?? "text";
const NORMAL_TEXT = process.env.GROK_BROWSER_SMOKE_NORMAL_TEXT ?? "人数は何名ですか";
const LOCKED_TEXT =
  process.env.GROK_BROWSER_SMOKE_LOCKED_TEXT ?? "単価を教えてください";
const POST_LOCKED_TEXT = process.env.GROK_BROWSER_SMOKE_POST_LOCKED_TEXT ?? "";
const VOICE_FIXTURE_SOURCE = resolve(
  process.env.GROK_BROWSER_SMOKE_VOICE_FIXTURE ??
    "test/fixtures/audio/grok-voice-v21/voice_case3_headcount.wav"
);
const VOICE_FIXTURE_TRAILING_SILENCE_MS = Number(
  process.env.GROK_BROWSER_SMOKE_VOICE_TRAILING_SILENCE_MS ?? "8000"
);
const STAMP = compactTimestamp(new Date());
const OUT_DIR =
  process.env.GROK_BROWSER_SMOKE_OUT_DIR ??
  resolve(
    "out",
    "grok_voice_v21_browser_smoke",
    `${STAMP}_prod_stock_suffix_hotfix_${MODE}`
  );

function gcloudSecret(name, project) {
  const r = spawnSync(
    "gcloud",
    ["secrets", "versions", "access", "latest", `--secret=${name}`, `--project=${project}`],
    { encoding: "utf8", shell: process.platform === "win32" }
  );
  if (r.status !== 0) return null;
  return r.stdout?.trim() ?? null;
}

let demoToken = process.env.DEMO_ACCESS_TOKEN;
if (!demoToken) {
  for (const project of ["zapier-transfer", "adecco-mendan"]) {
    const value = gcloudSecret("demo-access-token", project);
    if (value) {
      demoToken = value;
      console.log(`[browser-smoke] DEMO_ACCESS_TOKEN fetched from projects/${project}`);
      break;
    }
  }
}
if (!demoToken) {
  console.error("BLOCKED: DEMO_ACCESS_TOKEN not available.");
  process.exit(2);
}

mkdirSync(OUT_DIR, { recursive: true });

const preparedVoiceFixture =
  MODE === "voice"
    ? prepareVoiceFixtureWithTrailingSilence({
        sourcePath: VOICE_FIXTURE_SOURCE,
        outDir: OUT_DIR,
        trailingSilenceMs: VOICE_FIXTURE_TRAILING_SILENCE_MS,
      })
    : null;
const VOICE_FIXTURE = preparedVoiceFixture?.path ?? VOICE_FIXTURE_SOURCE;

const base = new URL(BASE_URL);
const signature = createHmac("sha256", demoToken).update(demoToken).digest("hex");
const events = [];
const network = [];
const consoleMessages = [];
const failures = [];

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    ...(MODE === "voice" ? [`--use-file-for-fake-audio-capture=${VOICE_FIXTURE}`] : []),
  ],
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
      secure: true,
      sameSite: "Lax",
      expires: Math.floor(Date.now() / 1000) + 60 * 60,
    },
    {
      name: "roleplay_api_access",
      value: signature,
      domain: base.hostname,
      path: "/api",
      secure: true,
      sameSite: "Lax",
      expires: Math.floor(Date.now() / 1000) + 60 * 60,
    },
  ]);
  await context.addInitScript(() => {
    window.__grokAudioProbe = { sources: [] };
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    const originalCreateBufferSource = AudioContextCtor.prototype.createBufferSource;
    AudioContextCtor.prototype.createBufferSource = function patchedCreateBufferSource() {
      const source = originalCreateBufferSource.call(this);
      const record = {
        createdAt: performance.now(),
        startedAt: null,
        endedAt: null,
        duration: null,
      };
      window.__grokAudioProbe.sources.push(record);
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
    consoleMessages.push({
      type: message.type(),
      text: message.text(),
    });
  });
  page.on("request", (request) => {
    const url = request.url();
    if (!url.includes("/api/v3/")) return;
    const entry = {
      at: new Date().toISOString(),
      direction: "request",
      method: request.method(),
      url,
    };
    if (url.includes("/api/v3/event")) {
      try {
        const body = request.postDataJSON();
        events.push({
          at: entry.at,
          kind: body.kind,
          sessionId: body.sessionId,
          details: body.details ?? {},
        });
      } catch {
        // ignore malformed debugging payloads
      }
    }
    network.push(entry);
  });
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/api/v3/")) return;
    const entry = {
      at: new Date().toISOString(),
      direction: "response",
      status: response.status(),
      url,
    };
    if (url.endsWith("/api/v3/session") || url.endsWith("/api/v3/locked-response-tts")) {
      try {
        const body = await response.json();
        entry.summary = summarizeApiBody(body);
      } catch {
        // ignore non-json responses
      }
    }
    network.push(entry);
  });

  await page.goto(`${BASE_URL}/demo/adecco-roleplay-v3?debugMetrics=1`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByLabel("通話を開始").click();

  const greetingCompleted = await waitForEvent("greeting.playback.completed", {
    timeoutMs: 45_000,
  });
  const sttCompleted =
    MODE === "voice" ? await waitForEvent("stt.completed", { timeoutMs: 60_000 }) : null;
  const normalTurn =
    MODE === "voice"
      ? await waitForTurn((event) => event.details?.inputMode === "voice", 60_000)
      : await runNormalTextTurn(page);
  const lockedPlayback = MODE === "voice" ? null : await runLockedTextTurn(page);
  const lockedTurn =
    MODE === "voice"
      ? null
      : await waitForTurn((event) => {
          return event.details?.lockedResponse === true && event.details?.inputMode === "text";
        }, 10_000);
  const postLockedTurn =
    MODE === "voice" || POST_LOCKED_TEXT.trim().length === 0
      ? null
      : await runPostLockedTextTurn(page, lockedTurn);
  await waitForAudioSettled(page, 12_000).catch(() => undefined);

  const audioProbe = await page.evaluate(() => window.__grokAudioProbe);
  await page.screenshot({ path: resolve(OUT_DIR, "final-page.png"), fullPage: true });

  const stockSuffixCancels = events.filter(
    (event) =>
      event.kind === "response.pr60_locked_cancelled" &&
      event.details?.reason === "stock_suffix"
  );
  const flushEvents = events.filter((event) => event.kind === "audio.queue.flushed");
  const consoleErrors = consoleMessages.filter((message) =>
    ["error", "warning"].includes(message.type)
  );

  if (!greetingCompleted) failures.push("missing:greeting.playback.completed");
  if (!(normalTurn?.details?.audioBytes > 0)) {
    failures.push(`normal turn audioBytes=${normalTurn?.details?.audioBytes ?? "missing"}`);
  }
  if (normalTurn?.details?.error) {
    failures.push(`normal turn error=${normalTurn.details.error}`);
  }
  if (MODE === "voice" && !sttCompleted) {
    failures.push("missing:stt.completed");
  }
  if (MODE !== "voice") {
    if (!lockedPlayback || !(lockedPlayback.details?.audioBytes > 0)) {
      failures.push(
        `locked playback audioBytes=${lockedPlayback?.details?.audioBytes ?? "missing"}`
      );
    }
    if (!(lockedTurn?.details?.audioBytes > 0)) {
      failures.push(`locked turn audioBytes=${lockedTurn?.details?.audioBytes ?? "missing"}`);
    }
    if (lockedTurn?.details?.error) {
      failures.push(`locked turn error=${lockedTurn.details.error}`);
    }
    if (POST_LOCKED_TEXT.trim().length > 0) {
      if (!(postLockedTurn?.details?.audioBytes > 0)) {
        failures.push(
          `post-locked turn audioBytes=${postLockedTurn?.details?.audioBytes ?? "missing"}`
        );
      }
      if (postLockedTurn?.details?.error) {
        failures.push(`post-locked turn error=${postLockedTurn.details.error}`);
      }
    }
  }
  if (stockSuffixCancels.length > 0) {
    failures.push(`stock_suffix cancels observed=${stockSuffixCancels.length}`);
  }
  const disallowedFlush = flushEvents.filter((event) => {
    const reason = event.details?.reason;
    return reason !== "barge_in" && reason !== "locked_response_preempt_realtime";
  });
  if (disallowedFlush.length > 0) {
    failures.push(`disallowed flush events=${disallowedFlush.length}`);
  }
  if ((audioProbe?.sources ?? []).filter((source) => source.startedAt !== null).length === 0) {
    failures.push("audio probe saw no started WebAudio sources");
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    pass: failures.length === 0,
    failures,
    mode: MODE,
    inputs: {
      normalText: NORMAL_TEXT,
      lockedText: LOCKED_TEXT,
      postLockedText: POST_LOCKED_TEXT || null,
      voiceFixture: VOICE_FIXTURE,
      voiceFixtureSource: VOICE_FIXTURE_SOURCE,
      voiceFixturePrepared: preparedVoiceFixture,
    },
    greetingCompleted,
    sttCompleted,
    normalTurn,
    lockedPlayback,
    lockedTurn,
    postLockedTurn,
    stockSuffixCancels,
    flushEvents,
    consoleErrors,
    audioProbe,
    network,
    events,
  };
  writeFileSync(resolve(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`[browser-smoke] out: ${OUT_DIR}`);
  if (summary.pass) {
    console.log("[browser-smoke] PASS");
    process.exit(0);
  }
  console.log("[browser-smoke] FAIL");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
} finally {
  await browser.close();
}

async function sendText(page, text) {
  const textarea = page.getByLabel("メッセージを送信");
  await textarea.fill(text);
  await textarea.press("Enter");
}

async function runNormalTextTurn(page) {
  await sendText(page, NORMAL_TEXT);
  const turn = await waitForTurn((event) => {
    return event.details?.lockedResponse !== true && event.details?.inputMode === "text";
  }, 45_000);
  await waitForAudioSettled(page, 12_000).catch(() => undefined);
  return turn;
}

async function runLockedTextTurn(page) {
  await sendText(page, LOCKED_TEXT);
  return waitForEvent("locked_response.playback.completed", {
    timeoutMs: 45_000,
  });
}

async function runPostLockedTextTurn(page, lockedTurn) {
  const minTurnIndex = lockedTurn?.details?.turnIndex ?? 0;
  await sendText(page, POST_LOCKED_TEXT);
  const turn = await waitForTurn((event) => {
    return (
      event.details?.lockedResponse !== true &&
      event.details?.inputMode === "text" &&
      (event.details?.turnIndex ?? 0) > minTurnIndex
    );
  }, 45_000);
  await waitForAudioSettled(page, 12_000).catch(() => undefined);
  return turn;
}

function waitForEvent(kind, { timeoutMs }) {
  return waitUntil(() => events.find((event) => event.kind === kind), timeoutMs);
}

function waitForTurn(predicate, timeoutMs) {
  return waitUntil(() => events.find((event) => event.kind === "turn.completed" && predicate(event)), timeoutMs);
}

async function waitUntil(fn, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = fn();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  return null;
}

async function waitForAudioSettled(page, timeoutMs) {
  await page.waitForFunction(
    () => {
      const sources = window.__grokAudioProbe?.sources ?? [];
      const started = sources.filter((source) => source.startedAt !== null);
      return started.length > 0 && started.every((source) => source.endedAt !== null);
    },
    undefined,
    { timeout: timeoutMs }
  );
}

function summarizeApiBody(body) {
  if (!body || typeof body !== "object") return null;
  return {
    sessionId: body.sessionId,
    greetingAudio: body.greetingAudio
      ? {
          cacheStatus: body.greetingAudio.cacheStatus,
          audioBytes: Math.floor((body.greetingAudio.audioBase64?.length ?? 0) * 0.75),
          voiceId: body.greetingAudio.voiceId,
        }
      : undefined,
    text: body.text,
    cacheStatus: body.cacheStatus,
    audioBytes: Math.floor((body.audioBase64?.length ?? 0) * 0.75),
    voiceId: body.voiceId,
    sampleRateHz: body.sampleRateHz,
  };
}

function compactTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function prepareVoiceFixtureWithTrailingSilence({
  sourcePath,
  outDir,
  trailingSilenceMs,
}) {
  if (!(trailingSilenceMs > 0)) {
    return {
      path: sourcePath,
      sourcePath,
      trailingSilenceMs: 0,
      prepared: false,
    };
  }

  const wav = readFileSync(sourcePath);
  const parsed = parsePcm16Wav(wav, sourcePath);
  const silenceBytes = Math.round(
    (trailingSilenceMs / 1000) *
      parsed.sampleRate *
      parsed.channels *
      (parsed.bitsPerSample / 8)
  );
  const preparedPath = resolve(outDir, "voice-fixture-with-trailing-silence.wav");
  const output = Buffer.concat([wav, Buffer.alloc(silenceBytes)]);
  output.writeUInt32LE(output.length - 8, 4);
  output.writeUInt32LE(parsed.dataSize + silenceBytes, parsed.dataSizeOffset);
  writeFileSync(preparedPath, output);
  return {
    path: preparedPath,
    sourcePath,
    trailingSilenceMs,
    prepared: true,
    sourceDurationMs: Math.round(parsed.durationSec * 1000),
    preparedDurationMs: Math.round(
      ((parsed.dataSize + silenceBytes) /
        (parsed.sampleRate * parsed.channels * (parsed.bitsPerSample / 8))) *
        1000
    ),
    sampleRate: parsed.sampleRate,
    channels: parsed.channels,
    bitsPerSample: parsed.bitsPerSample,
  };
}

function parsePcm16Wav(wav, sourcePath) {
  if (
    wav.toString("ascii", 0, 4) !== "RIFF" ||
    wav.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error(`voice fixture is not a RIFF/WAVE file: ${sourcePath}`);
  }

  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataSize = 0;
  let dataSizeOffset = -1;

  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      audioFormat = wav.readUInt16LE(start);
      channels = wav.readUInt16LE(start + 2);
      sampleRate = wav.readUInt32LE(start + 4);
      bitsPerSample = wav.readUInt16LE(start + 14);
    } else if (id === "data") {
      dataSize = size;
      dataSizeOffset = offset + 4;
      break;
    }
    offset = start + size + (size % 2);
  }

  if (
    audioFormat !== 1 ||
    channels !== 1 ||
    sampleRate !== 24_000 ||
    bitsPerSample !== 16 ||
    dataSize <= 0 ||
    dataSizeOffset < 0
  ) {
    throw new Error(
      `voice fixture must be PCM16 mono 24kHz (format=${audioFormat}, channels=${channels}, rate=${sampleRate}, bits=${bitsPerSample}, dataBytes=${dataSize})`
    );
  }

  return {
    channels,
    sampleRate,
    bitsPerSample,
    dataSize,
    dataSizeOffset,
    durationSec: dataSize / (sampleRate * channels * (bitsPerSample / 8)),
  };
}
