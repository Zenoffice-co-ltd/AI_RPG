/**
 * Grok Voice strict-sanitized-playback Layer A E2E.
 *
 * Deterministic audio-path verification: drives the conversation hook with a
 * stubbed realtime + a recording audio queue + intercepted /api/v3/event
 * posts. Asserts both raw-audio hash non-leakage AND event/call ordering for
 * 8 scenarios (clean, stock-suffix played, sanitized-TTS failure,
 * sanitized-to-empty, unverified audio, reseed failure, barge-in, locked
 * response). Independent of live model nondeterminism.
 *
 * Output: out/grok_voice_audio_e2e/<utc-iso-compact>/layer_a_summary.json
 *
 * Usage:
 *   pnpm exec tsx scripts/grok-voice-audio-path-e2e.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
// @types/jsdom is not installed at the workspace root; the .d.ts shim
// next to this file declares the minimal shape we use.
import { JSDOM } from "jsdom";

// JSDOM bootstrap MUST happen before importing the React/jsdom-bound test
// utilities. tsx's default transform targets CJS, so we cannot use top-level
// await — instead we install JSDOM globals synchronously and resolve the
// dynamic imports inside `main()` after the harness is ready.
const jsdom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
// Node 24 makes some globals (navigator) read-only. Use defineProperty so
// we can install JSDOM versions on top.
const installGlobal = (key: string, value: unknown) => {
  try {
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  } catch {
    // already writable
    (globalThis as unknown as Record<string, unknown>)[key] = value;
  }
};
installGlobal("window", jsdom.window);
installGlobal("document", jsdom.window.document);
installGlobal("navigator", jsdom.window.navigator);
installGlobal("HTMLElement", jsdom.window.HTMLElement);
installGlobal("Element", jsdom.window.Element);
installGlobal("Node", jsdom.window.Node);
// React 19 expects `IS_REACT_ACT_ENVIRONMENT`.
installGlobal("IS_REACT_ACT_ENVIRONMENT", true);

type GrokVoiceServerEvent =
  import("../lib/roleplay/grok-voice-types").GrokVoiceServerEvent;
type GrokVoiceSession =
  import("../lib/roleplay/grok-voice-types").GrokVoiceSession;
type GrokVoiceGreeting =
  import("../lib/roleplay/grok-voice-types").GrokVoiceGreeting;
type GrokVoiceSanitizedResponseTts =
  import("../lib/roleplay/grok-voice-types").GrokVoiceSanitizedResponseTts;
type GrokVoiceLockedResponseTts =
  import("../lib/roleplay/grok-voice-types").GrokVoiceLockedResponseTts;
type UseGrokVoiceConversationDeps =
  import("../lib/roleplay/useGrokVoiceConversation").UseGrokVoiceConversationDeps;

// Module-level holders populated inside main() before any harness function
// is called.
let act: typeof import("@testing-library/react").act;
let renderHook: typeof import("@testing-library/react").renderHook;
let waitFor: typeof import("@testing-library/react").waitFor;
let useGrokVoiceConversation: typeof import("../lib/roleplay/useGrokVoiceConversation").useGrokVoiceConversation;
let GrokVoiceAudioQueue: typeof import("../lib/roleplay/grok-voice-audio-queue").GrokVoiceAudioQueue;

// -------- Fixtures --------

const FIRST_SESSION: GrokVoiceSession = {
  sessionId: "gv_sess_layerA_1",
  scenarioId:
    "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v21",
  backend: "grok-voice-think-fast",
  promptVersion: "layerA",
  promptHash: "abc123def456",
  guardrailVersion: "gv-think-fast-v4.9-2026-05-09",
  grokVoiceModel: "grok-voice-think-fast-1.0",
  grokVoiceVoiceId: "rex",
  wsUrl: "wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-1.0",
  ephemeralToken: "ephemeral-A",
  ephemeralExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  audio: { inputFormat: "audio/pcm", outputFormat: "audio/pcm", sampleRate: 24_000 },
  turnDetection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 500 },
  instructions: "You are a roleplay agent.",
  firstMessage: "お時間ありがとうございます。",
  strictSanitizedPlayback: true,
  strictPlaybackMode: "all_turns",
};
const RESEED_SESSION: GrokVoiceSession = {
  ...FIRST_SESSION,
  sessionId: "gv_sess_layerA_2",
  ephemeralToken: "ephemeral-B",
  parentSessionId: FIRST_SESSION.sessionId,
};
// Distinct fill bytes per audio source so SHA hashes never collide. Hash
// collision between greeting and raw delta would manifest as a false-positive
// "raw suffix leak" — the greeting plays for every session.
const GREETING: GrokVoiceGreeting = {
  audioBase64: Buffer.from(new Uint8Array(48).fill(0xa0)).toString("base64"),
  mimeType: "audio/pcm",
  sampleRateHz: 24_000,
  textLen: FIRST_SESSION.firstMessage.length,
  voiceId: "rex",
  vendorMs: 0,
};
const SANITIZED_TTS: GrokVoiceSanitizedResponseTts = {
  text: "受発注経験の確認から進めます。",
  displayText: "受発注経験の確認から進めます。",
  audioBase64: Buffer.from(new Uint8Array(96).fill(0xb0)).toString("base64"),
  mimeType: "audio/pcm",
  sampleRateHz: 24_000,
  textLen: "受発注経験の確認から進めます。".length,
  voiceId: "rex",
  vendorMs: 0,
  cacheStatus: "miss",
};
const LOCKED_TTS: GrokVoiceLockedResponseTts = {
  text: "請求想定は経験により、千七百五十円から、千九百円程度です。",
  audioBase64: Buffer.from(new Uint8Array(72).fill(0xc0)).toString("base64"),
  mimeType: "audio/pcm",
  sampleRateHz: 24_000,
  textLen: "請求想定は経験により、千七百五十円から、千九百円程度です。".length,
  voiceId: "rex",
  vendorMs: 0,
  cacheStatus: "miss",
};

// Raw realtime audio chunks — distinct fills so they hash separately too.
const RAW_PCM_CHUNK_A = Buffer.from(new Uint8Array(48).fill(0x10)).toString(
  "base64"
);
const RAW_PCM_CHUNK_B = Buffer.from(new Uint8Array(48).fill(0x11)).toString(
  "base64"
);

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

// -------- Recorders --------

// Monotonic insertion counter shared between event and audio recorders so
// items recorded within the same Date.now() tick merge in insertion order.
// Reset per scenario.
let SEQ = 0;
function nextSeq() {
  return ++SEQ;
}
function resetSeq() {
  SEQ = 0;
}

type RecordedEvent = {
  kind: string;
  details?: Record<string, unknown>;
  tMs: number;
  seq: number;
};
type RecordedAudioCall = {
  method: "enqueueBase64" | "enqueueBase64AndWait";
  hash: string;
  tMs: number;
  seq: number;
};

function buildRecordingAudioQueue(start: number) {
  const audioCalls: RecordedAudioCall[] = [];
  const fakeContext = {
    state: "running" as AudioContextState,
    currentTime: 0,
    destination: {} as AudioDestinationNode,
    createBuffer: (_c: number, length: number, sampleRate: number) => ({
      duration: length / sampleRate,
      sampleRate,
      length,
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => ({
      buffer: null,
      connect: () => undefined,
      start: () => undefined,
      onended: null,
    }),
    createGain: () =>
      ({ gain: { value: 1 }, connect: () => undefined }) as unknown as GainNode,
    decodeAudioData: async () => ({ duration: 0.05 } as AudioBuffer),
    resume: async () => undefined,
    close: async () => undefined,
  } as unknown as AudioContext;
  const queue = new GrokVoiceAudioQueue({
    sampleRate: 24_000,
    createAudioContext: () => fakeContext,
  });
  const origEnqueue = queue.enqueueBase64.bind(queue);
  const origEnqueueAndWait = queue.enqueueBase64AndWait.bind(queue);
  queue.enqueueBase64 = (b64: string) => {
    audioCalls.push({
      method: "enqueueBase64",
      hash: sha256(b64),
      tMs: Date.now() - start,
      seq: nextSeq(),
    });
    return origEnqueue(b64);
  };
  queue.enqueueBase64AndWait = async (b64: string) => {
    audioCalls.push({
      method: "enqueueBase64AndWait",
      hash: sha256(b64),
      tMs: Date.now() - start,
      seq: nextSeq(),
    });
    // Don't actually wait for the (unused) AudioContext schedule loop —
    // resolve immediately so finalize completes deterministically.
    return Promise.resolve();
  };
  return { queue, audioCalls };
}

function buildOneFakeRealtime(start: number) {
  let onMessage: ((e: GrokVoiceServerEvent) => void) | null = null;
  let onOpen: (() => void) | null = null;
  let onReady: (() => void) | null = null;
  const sent: Array<{ method: string; arg: unknown; tMs: number }> = [];
  let ready = false;
  const realtime = {
    open: () => onOpen?.(),
    isOpen: () => true,
    isReady: () => ready,
    sendSessionUpdate: (arg: unknown) =>
      sent.push({ method: "sendSessionUpdate", arg, tMs: Date.now() - start }),
    sendAssistantHistory: (arg: unknown) => {
      sent.push({ method: "sendAssistantHistory", arg, tMs: Date.now() - start });
      ready = true;
      onReady?.();
    },
    sendUserText: (arg: unknown) =>
      sent.push({ method: "sendUserText", arg, tMs: Date.now() - start }),
    sendUserHistory: (arg: unknown) =>
      sent.push({ method: "sendUserHistory", arg, tMs: Date.now() - start }),
    sendAssistantHistoryMessage: (arg: unknown) =>
      sent.push({
        method: "sendAssistantHistoryMessage",
        arg,
        tMs: Date.now() - start,
      }),
    appendAudio: (arg: unknown) =>
      sent.push({ method: "appendAudio", arg, tMs: Date.now() - start }),
    commitAudio: () => undefined,
    cancelResponse: () =>
      sent.push({ method: "cancelResponse", arg: null, tMs: Date.now() - start }),
    close: () =>
      sent.push({ method: "close", arg: null, tMs: Date.now() - start }),
    wasClosedByUs: () => false,
  };
  const bind = (opts: {
    onMessage: (event: GrokVoiceServerEvent) => void;
    onOpen?: () => void;
    onReady?: () => void;
  }) => {
    onMessage = opts.onMessage;
    onOpen = opts.onOpen ?? null;
    onReady = opts.onReady ?? null;
    return realtime as unknown as InstanceType<
      typeof import("../lib/roleplay/grok-voice-realtime").GrokVoiceRealtime
    >;
  };
  return {
    realtime,
    sent,
    bind,
    emit: (e: GrokVoiceServerEvent) => onMessage?.(e),
  };
}

function buildRealtimeFactory(start: number) {
  const fakes: ReturnType<typeof buildOneFakeRealtime>[] = [];
  const ctor = (opts: {
    onMessage: (e: GrokVoiceServerEvent) => void;
    onOpen?: () => void;
    onReady?: () => void;
  }) => {
    const next = buildOneFakeRealtime(start);
    fakes.push(next);
    return next.bind(opts);
  };
  return { fakes, ctor };
}

// -------- Event interception --------
// /api/v3/event posts via fetch — capture them so the trace includes the
// strict-playback typed events the hook emits.

function installEventInterceptor(eventLog: RecordedEvent[], start: number) {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.endsWith("/api/v3/event")) {
      try {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          kind?: string;
          details?: Record<string, unknown>;
        };
        if (body.kind) {
          eventLog.push({
            kind: body.kind,
            ...(body.details ? { details: body.details } : {}),
            tMs: Date.now() - start,
            seq: nextSeq(),
          });
        }
      } catch {
        // ignore malformed
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // Other endpoints fall through to caller-supplied stub or empty 200.
    return new Response("not-used", { status: 200 });
  }) as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = origFetch;
  };
}

// -------- Ordering matcher --------
// Match an expected sequence against recorded events / audio calls. Each
// expectation is one of:
//   { event: "kind.name" }                                — must appear in order
//   { audio: "raw"|"sanitized"|"locked", method: "enqueueBase64"|"enqueueBase64AndWait" }
//   { forbidden: "event" or "audioRaw" }                  — checked across the whole trace
// Implementation: walk the merged trace once; advance through expected
// sequence for each match.

type OrderItem =
  | { kind: "event"; name: string }
  | {
      kind: "audio";
      method: "enqueueBase64" | "enqueueBase64AndWait";
      hash: string;
    };
type Forbidden =
  | { kind: "event"; name: string }
  | {
      kind: "audio";
      method?: "enqueueBase64" | "enqueueBase64AndWait";
      hashIn: string[];
    };
type Trace = Array<
  | { kind: "event"; name: string; tMs: number; seq: number }
  | {
      kind: "audio";
      method: "enqueueBase64" | "enqueueBase64AndWait";
      hash: string;
      tMs: number;
      seq: number;
    }
>;

function buildTrace(
  events: RecordedEvent[],
  audioCalls: RecordedAudioCall[]
): Trace {
  const merged: Trace = [];
  for (const e of events) {
    merged.push({ kind: "event", name: e.kind, tMs: e.tMs, seq: e.seq });
  }
  for (const a of audioCalls) {
    merged.push({
      kind: "audio",
      method: a.method,
      hash: a.hash,
      tMs: a.tMs,
      seq: a.seq,
    });
  }
  // Sort by the monotonic insertion counter so ties on tMs respect the
  // actual order the recorders saw the items.
  merged.sort((a, b) => a.seq - b.seq);
  return merged;
}

function checkOrdering(
  trace: Trace,
  expected: OrderItem[]
): { ok: boolean; missing?: OrderItem; cursor?: number } {
  let cursor = 0;
  for (const item of trace) {
    if (cursor >= expected.length) break;
    const want = expected[cursor]!;
    if (
      want.kind === "event" &&
      item.kind === "event" &&
      item.name === want.name
    ) {
      cursor++;
    } else if (
      want.kind === "audio" &&
      item.kind === "audio" &&
      item.method === want.method &&
      item.hash === want.hash
    ) {
      cursor++;
    }
  }
  if (cursor < expected.length) {
    const missing = expected[cursor];
    return missing
      ? { ok: false, missing, cursor }
      : { ok: false, cursor };
  }
  return { ok: true };
}

function checkForbidden(
  trace: Trace,
  forbidden: Forbidden[]
): { ok: boolean; hits: Forbidden[] } {
  const hits: Forbidden[] = [];
  for (const f of forbidden) {
    for (const item of trace) {
      if (f.kind === "event" && item.kind === "event" && item.name === f.name) {
        hits.push(f);
        break;
      }
      if (
        f.kind === "audio" &&
        item.kind === "audio" &&
        f.hashIn.includes(item.hash) &&
        (!f.method || f.method === item.method)
      ) {
        hits.push(f);
        break;
      }
    }
  }
  return { ok: hits.length === 0, hits };
}

// -------- Scenario harness --------

type ScenarioResult = {
  scenario: string;
  events: RecordedEvent[];
  audioCalls: RecordedAudioCall[];
  rawDeltaHashes: string[];
  playedHashes: string[];
  rawSuffixLeak: boolean;
  orderingPass: boolean;
  orderingMissing?: OrderItem;
  forbiddenViolations: Forbidden[];
  metric: Record<string, unknown> | null;
  pass: boolean;
};

async function startHook(opts: {
  fetchSession?: NonNullable<UseGrokVoiceConversationDeps["fetchSession"]>;
  fetchSanitizedResponseTts?: NonNullable<
    UseGrokVoiceConversationDeps["fetchSanitizedResponseTts"]
  >;
  fetchLockedResponseTts?: NonNullable<
    UseGrokVoiceConversationDeps["fetchLockedResponseTts"]
  >;
  factory: ReturnType<typeof buildRealtimeFactory>;
  queue: ReturnType<typeof buildRecordingAudioQueue>;
}) {
  const deps: UseGrokVoiceConversationDeps = {
    fetchSession: opts.fetchSession ?? (async () => FIRST_SESSION),
    fetchGreeting: async () => GREETING,
    fetchSanitizedResponseTts:
      opts.fetchSanitizedResponseTts ?? (async () => SANITIZED_TTS),
    fetchLockedResponseTts:
      opts.fetchLockedResponseTts ?? (async () => LOCKED_TTS),
    createAudioQueue: () => opts.queue.queue,
    createRealtime: opts.factory.ctor as unknown as NonNullable<
      UseGrokVoiceConversationDeps["createRealtime"]
    >,
    micEnabled: false,
  };
  const { result } = renderHook(() => useGrokVoiceConversation("live", deps));
  await act(async () => {
    await result.current.startConversation();
  });
  await waitFor(() => {
    if (result.current.status !== "listening") throw new Error("not listening");
  });
  return result;
}

function summarize(
  scenario: string,
  events: RecordedEvent[],
  audioCalls: RecordedAudioCall[],
  rawDeltaHashes: string[],
  expectedOrder: OrderItem[],
  forbidden: Forbidden[],
  metric: Record<string, unknown> | null,
  options: { expectRawPlayback: boolean }
): ScenarioResult {
  const trace = buildTrace(events, audioCalls);
  const playedHashes = audioCalls.map((c) => c.hash);
  const rawPlayed = playedHashes.some((h) => rawDeltaHashes.includes(h));
  // For non-clean scenarios, ANY raw delta hash showing up in playedHashes
  // is a leak. For clean scenarios, raw playback is expected — we don't
  // flag it as a leak; the forbidden list catches accidental leaks via
  // method-mismatch (e.g. enqueueBase64 in strict clean mode).
  const rawSuffixLeak = options.expectRawPlayback ? false : rawPlayed;
  const ordering = checkOrdering(trace, expectedOrder);
  const forbiddenCheck = checkForbidden(trace, forbidden);
  const pass = !rawSuffixLeak && ordering.ok && forbiddenCheck.ok;
  const result: ScenarioResult = {
    scenario,
    events,
    audioCalls,
    rawDeltaHashes,
    playedHashes,
    rawSuffixLeak,
    orderingPass: ordering.ok,
    forbiddenViolations: forbiddenCheck.hits,
    metric,
    pass,
  };
  if (!ordering.ok && ordering.missing) {
    result.orderingMissing = ordering.missing;
  }
  return result;
}

async function runScenario1Clean(): Promise<ScenarioResult> {
  const start = Date.now();
  resetSeq();
  const events: RecordedEvent[] = [];
  const restoreFetch = installEventInterceptor(events, start);
  try {
    const queue = buildRecordingAudioQueue(start);
    const factory = buildRealtimeFactory(start);
    const result = await startHook({ factory, queue });
    await act(async () => {
      await result.current.sendTextMessage("業務時間は？");
    });
    const fake = factory.fakes[0]!;
    const rawHash = sha256(RAW_PCM_CHUNK_A);
    await act(async () => {
      fake.emit({ type: "response.created", response: { id: "s1" } });
      fake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "平日は朝八時よんじゅうごふんから夕方五時三十分です。",
        item_id: "s1-i",
      });
      fake.emit({
        type: "response.output_audio.delta",
        delta: RAW_PCM_CHUNK_A,
        item_id: "s1-i",
      });
      fake.emit({ type: "response.done", response: { id: "s1" } });
    });
    await waitFor(() => {
      if (result.current.metricsLog.length === 0) throw new Error("pending");
    });
    const metric = result.current.metricsLog[0]! as Record<string, unknown>;
    return summarize(
      "clean",
      events,
      queue.audioCalls,
      [rawHash],
      [
        { kind: "audio", method: "enqueueBase64AndWait", hash: rawHash },
      ],
      [
        { kind: "event", name: "response.stock_suffix_detected" },
        { kind: "event", name: "sanitized_response.tts.requested" },
        { kind: "event", name: "realtime.session_tainted" },
        // Raw-path direct enqueueBase64 is forbidden in strict mode for any
        // hash (we only allow enqueueBase64AndWait of the buffered chunks).
        { kind: "audio", method: "enqueueBase64", hashIn: [rawHash] },
      ],
      metric,
      { expectRawPlayback: true }
    );
  } finally {
    restoreFetch();
  }
}

async function runScenario2StockSuffixPlayed(): Promise<ScenarioResult> {
  const start = Date.now();
  resetSeq();
  const events: RecordedEvent[] = [];
  const restoreFetch = installEventInterceptor(events, start);
  try {
    const queue = buildRecordingAudioQueue(start);
    const fetchSession = (() => {
      let n = 0;
      return (async () => {
        n++;
        return n === 1 ? FIRST_SESSION : RESEED_SESSION;
      }) as NonNullable<UseGrokVoiceConversationDeps["fetchSession"]>;
    })();
    const factory = buildRealtimeFactory(start);
    const result = await startHook({ factory, queue, fetchSession });
    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });
    const fake = factory.fakes[0]!;
    const rawHashA = sha256(RAW_PCM_CHUNK_A);
    const rawHashB = sha256(RAW_PCM_CHUNK_B);
    const sanitizedHash = sha256(SANITIZED_TTS.audioBase64);
    await act(async () => {
      fake.emit({ type: "response.created", response: { id: "s2" } });
      fake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "受発注経験の確認から進めます。何か他にご質問ありますか。",
        item_id: "s2-i",
      });
      fake.emit({
        type: "response.output_audio.delta",
        delta: RAW_PCM_CHUNK_A,
        item_id: "s2-i",
      });
      fake.emit({
        type: "response.output_audio.delta",
        delta: RAW_PCM_CHUNK_B,
        item_id: "s2-i",
      });
      fake.emit({ type: "response.done", response: { id: "s2" } });
    });
    await waitFor(() => {
      if (result.current.metricsLog.length === 0) throw new Error("pending");
    });
    const metric = result.current.metricsLog[0]! as Record<string, unknown>;
    return summarize(
      "stock_suffix_played",
      events,
      queue.audioCalls,
      [rawHashA, rawHashB],
      [
        { kind: "event", name: "response.stock_suffix_detected" },
        { kind: "event", name: "sanitized_response.tts.requested" },
        { kind: "event", name: "sanitized_response.tts.completed" },
        {
          kind: "audio",
          method: "enqueueBase64AndWait",
          hash: sanitizedHash,
        },
        { kind: "event", name: "sanitized_response.playback.completed" },
        { kind: "event", name: "realtime.reseed.started" },
        { kind: "event", name: "realtime.reseed.completed" },
      ],
      [
        // Raw deltas must NEVER reach either enqueue path.
        {
          kind: "audio",
          method: "enqueueBase64",
          hashIn: [rawHashA, rawHashB],
        },
        {
          kind: "audio",
          method: "enqueueBase64AndWait",
          hashIn: [rawHashA, rawHashB],
        },
      ],
      metric,
      { expectRawPlayback: false }
    );
  } finally {
    restoreFetch();
  }
}

async function runScenario3SanitizedTtsFailed(): Promise<ScenarioResult> {
  const start = Date.now();
  resetSeq();
  const events: RecordedEvent[] = [];
  const restoreFetch = installEventInterceptor(events, start);
  try {
    const queue = buildRecordingAudioQueue(start);
    const factory = buildRealtimeFactory(start);
    const result = await startHook({
      factory,
      queue,
      fetchSanitizedResponseTts: async () => {
        throw new Error("502");
      },
    });
    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });
    const fake = factory.fakes[0]!;
    const rawHash = sha256(RAW_PCM_CHUNK_A);
    await act(async () => {
      fake.emit({ type: "response.created", response: { id: "s3" } });
      fake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "受発注経験の確認から進めます。何か他にご質問ありますか。",
        item_id: "s3-i",
      });
      fake.emit({
        type: "response.output_audio.delta",
        delta: RAW_PCM_CHUNK_A,
        item_id: "s3-i",
      });
      fake.emit({ type: "response.done", response: { id: "s3" } });
    });
    await waitFor(() => {
      if (result.current.metricsLog.length === 0) throw new Error("pending");
    });
    const metric = result.current.metricsLog[0]! as Record<string, unknown>;
    return summarize(
      "sanitized_tts_failed",
      events,
      queue.audioCalls,
      [rawHash],
      [
        { kind: "event", name: "response.stock_suffix_detected" },
        { kind: "event", name: "sanitized_response.tts.requested" },
        { kind: "event", name: "sanitized_response.tts.failed" },
        { kind: "event", name: "realtime.session_tainted" },
      ],
      [
        // No raw or sanitized chunks ever played.
        {
          kind: "audio",
          method: "enqueueBase64",
          hashIn: [rawHash, sha256(SANITIZED_TTS.audioBase64)],
        },
        {
          kind: "audio",
          method: "enqueueBase64AndWait",
          hashIn: [rawHash, sha256(SANITIZED_TTS.audioBase64)],
        },
      ],
      metric,
      { expectRawPlayback: false }
    );
  } finally {
    restoreFetch();
  }
}

async function runScenario4SanitizedToEmpty(): Promise<ScenarioResult> {
  const start = Date.now();
  resetSeq();
  const events: RecordedEvent[] = [];
  const restoreFetch = installEventInterceptor(events, start);
  try {
    const queue = buildRecordingAudioQueue(start);
    const factory = buildRealtimeFactory(start);
    const result = await startHook({ factory, queue });
    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });
    const fake = factory.fakes[0]!;
    const rawHash = sha256(RAW_PCM_CHUNK_A);
    await act(async () => {
      fake.emit({ type: "response.created", response: { id: "s4" } });
      fake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "他に何か質問はありますか。",
        item_id: "s4-i",
      });
      fake.emit({
        type: "response.output_audio.delta",
        delta: RAW_PCM_CHUNK_A,
        item_id: "s4-i",
      });
      fake.emit({ type: "response.done", response: { id: "s4" } });
    });
    await waitFor(() => {
      if (result.current.metricsLog.length === 0) throw new Error("pending");
    });
    const metric = result.current.metricsLog[0]! as Record<string, unknown>;
    return summarize(
      "sanitized_to_empty",
      events,
      queue.audioCalls,
      [rawHash],
      [
        { kind: "event", name: "response.stock_suffix_detected" },
        { kind: "event", name: "realtime.session_tainted" },
      ],
      [
        { kind: "event", name: "sanitized_response.tts.requested" },
        { kind: "audio", method: "enqueueBase64", hashIn: [rawHash] },
        { kind: "audio", method: "enqueueBase64AndWait", hashIn: [rawHash] },
      ],
      metric,
      { expectRawPlayback: false }
    );
  } finally {
    restoreFetch();
  }
}

async function runScenario5Unverified(): Promise<ScenarioResult> {
  const start = Date.now();
  resetSeq();
  const events: RecordedEvent[] = [];
  const restoreFetch = installEventInterceptor(events, start);
  try {
    const queue = buildRecordingAudioQueue(start);
    const factory = buildRealtimeFactory(start);
    const result = await startHook({ factory, queue });
    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });
    const fake = factory.fakes[0]!;
    const rawHash = sha256(RAW_PCM_CHUNK_A);
    await act(async () => {
      // Audio without any transcript delta — unverifiable.
      fake.emit({ type: "response.created", response: { id: "s5" } });
      fake.emit({
        type: "response.output_audio.delta",
        delta: RAW_PCM_CHUNK_A,
        item_id: "s5-i",
      });
      fake.emit({ type: "response.done", response: { id: "s5" } });
    });
    await waitFor(() => {
      if (result.current.metricsLog.length === 0) throw new Error("pending");
    });
    const metric = result.current.metricsLog[0]! as Record<string, unknown>;
    return summarize(
      "unverified_audio_suppressed",
      events,
      queue.audioCalls,
      [rawHash],
      [
        { kind: "event", name: "response.unverified_audio_suppressed" },
        { kind: "event", name: "realtime.session_tainted" },
      ],
      [
        { kind: "audio", method: "enqueueBase64", hashIn: [rawHash] },
        { kind: "audio", method: "enqueueBase64AndWait", hashIn: [rawHash] },
      ],
      metric,
      { expectRawPlayback: false }
    );
  } finally {
    restoreFetch();
  }
}

async function runScenario6ReseedFailure(): Promise<ScenarioResult> {
  const start = Date.now();
  resetSeq();
  const events: RecordedEvent[] = [];
  const restoreFetch = installEventInterceptor(events, start);
  try {
    const queue = buildRecordingAudioQueue(start);
    const fetchSession = (() => {
      let n = 0;
      return (async () => {
        n++;
        if (n === 1) return FIRST_SESSION;
        throw new Error("429 reseed denied");
      }) as NonNullable<UseGrokVoiceConversationDeps["fetchSession"]>;
    })();
    const factory = buildRealtimeFactory(start);
    const result = await startHook({ factory, queue, fetchSession });
    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });
    const fake = factory.fakes[0]!;
    const rawHash = sha256(RAW_PCM_CHUNK_A);
    await act(async () => {
      fake.emit({ type: "response.created", response: { id: "s6" } });
      fake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "受発注経験の確認から進めます。何か他にご質問ありますか。",
        item_id: "s6-i",
      });
      fake.emit({
        type: "response.output_audio.delta",
        delta: RAW_PCM_CHUNK_A,
        item_id: "s6-i",
      });
      fake.emit({ type: "response.done", response: { id: "s6" } });
    });
    await waitFor(() => {
      if (result.current.metricsLog.length === 0) throw new Error("pending");
    });
    const metric = result.current.metricsLog[0]! as Record<string, unknown>;
    return summarize(
      "reseed_failed_after_play",
      events,
      queue.audioCalls,
      [rawHash],
      [
        { kind: "event", name: "sanitized_response.playback.completed" },
        { kind: "event", name: "realtime.reseed.started" },
        { kind: "event", name: "realtime.reseed.failed" },
        { kind: "event", name: "realtime.session_tainted" },
      ],
      [
        { kind: "audio", method: "enqueueBase64", hashIn: [rawHash] },
        { kind: "audio", method: "enqueueBase64AndWait", hashIn: [rawHash] },
      ],
      metric,
      { expectRawPlayback: false }
    );
  } finally {
    restoreFetch();
  }
}

async function runScenario7BargeIn(): Promise<ScenarioResult> {
  const start = Date.now();
  resetSeq();
  const events: RecordedEvent[] = [];
  const restoreFetch = installEventInterceptor(events, start);
  try {
    const queue = buildRecordingAudioQueue(start);
    const factory = buildRealtimeFactory(start);
    const result = await startHook({ factory, queue });
    await act(async () => {
      await result.current.sendTextMessage("業務時間は？");
    });
    const fake = factory.fakes[0]!;
    const rawHash = sha256(RAW_PCM_CHUNK_A);
    await act(async () => {
      fake.emit({ type: "response.created", response: { id: "s7" } });
      fake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "平日は朝八時よんじゅうごふんから",
        item_id: "s7-i",
      });
      fake.emit({
        type: "response.output_audio.delta",
        delta: RAW_PCM_CHUNK_A,
        item_id: "s7-i",
      });
      // Barge-in BEFORE response.done.
      fake.emit({ type: "input_audio_buffer.speech_started" });
    });
    // Allow micro tasks to settle so the barge-in path fully runs.
    await new Promise((r) => setTimeout(r, 50));
    return summarize(
      "barge_in_during_buffered",
      events,
      queue.audioCalls,
      [rawHash],
      [
        { kind: "event", name: "barge_in.detected" },
        { kind: "event", name: "audio.queue.flushed" },
      ],
      [
        // Buffered chunks were never played.
        { kind: "audio", method: "enqueueBase64", hashIn: [rawHash] },
        { kind: "audio", method: "enqueueBase64AndWait", hashIn: [rawHash] },
      ],
      null,
      { expectRawPlayback: false }
    );
  } finally {
    restoreFetch();
  }
}

async function runScenario8LockedResponse(): Promise<ScenarioResult> {
  const start = Date.now();
  resetSeq();
  const events: RecordedEvent[] = [];
  const restoreFetch = installEventInterceptor(events, start);
  try {
    const queue = buildRecordingAudioQueue(start);
    const factory = buildRealtimeFactory(start);
    const result = await startHook({ factory, queue });
    const lockedHash = sha256(LOCKED_TTS.audioBase64);
    await act(async () => {
      // Locked-response intent.
      await result.current.sendTextMessage("単価は？");
    });
    await waitFor(() => {
      if (result.current.metricsLog.length === 0) throw new Error("pending");
    });
    const metric = result.current.metricsLog[0]! as Record<string, unknown>;
    return summarize(
      "locked_response",
      events,
      queue.audioCalls,
      [],
      [
        { kind: "event", name: "locked_response.tts.requested" },
        { kind: "event", name: "locked_response.tts.completed" },
        {
          kind: "audio",
          method: "enqueueBase64AndWait",
          hash: lockedHash,
        },
        { kind: "event", name: "locked_response.playback.completed" },
      ],
      [
        { kind: "event", name: "response.stock_suffix_detected" },
        { kind: "event", name: "sanitized_response.tts.requested" },
        { kind: "event", name: "realtime.reseed.started" },
        { kind: "event", name: "realtime.session_tainted" },
      ],
      metric,
      { expectRawPlayback: false }
    );
  } finally {
    restoreFetch();
  }
}

// -------- Main --------

async function main() {
  ({ act, renderHook, waitFor } = await import("@testing-library/react"));
  ({ useGrokVoiceConversation } = await import(
    "../lib/roleplay/useGrokVoiceConversation"
  ));
  ({ GrokVoiceAudioQueue } = await import(
    "../lib/roleplay/grok-voice-audio-queue"
  ));
  const scenarios = [
    runScenario1Clean,
    runScenario2StockSuffixPlayed,
    runScenario3SanitizedTtsFailed,
    runScenario4SanitizedToEmpty,
    runScenario5Unverified,
    runScenario6ReseedFailure,
    runScenario7BargeIn,
    runScenario8LockedResponse,
  ];
  const results: ScenarioResult[] = [];
  for (const fn of scenarios) {
    process.stdout.write(`  [${fn.name}] ... `);
    try {
      const r = await fn();
      results.push(r);
      console.info(r.pass ? "PASS" : "FAIL");
      if (!r.pass) {
        if (r.rawSuffixLeak) console.info(`    rawSuffixLeak`);
        if (!r.orderingPass)
          console.info(
            `    ordering missing: ${JSON.stringify(r.orderingMissing)}`
          );
        if (r.forbiddenViolations.length > 0)
          console.info(
            `    forbidden hits: ${JSON.stringify(r.forbiddenViolations)}`
          );
      }
    } catch (e) {
      console.info("FAIL (threw)");
      results.push({
        scenario: fn.name,
        events: [],
        audioCalls: [],
        rawDeltaHashes: [],
        playedHashes: [],
        rawSuffixLeak: false,
        orderingPass: false,
        forbiddenViolations: [],
        metric: null,
        pass: false,
      });
      console.error(e);
    }
  }

  // Script lives at apps/web/scripts/, so repo root is three levels up.
  const repoRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    ".."
  );
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const outDir = resolve(repoRoot, "out", "grok_voice_audio_e2e", stamp);
  await mkdir(outDir, { recursive: true });
  const overallPass = results.every((r) => r.pass);
  await writeFile(
    resolve(outDir, "layer_a_summary.json"),
    JSON.stringify({ overallPass, results, timestamp: new Date().toISOString() }, null, 2),
    "utf8"
  );
  console.info("");
  console.info(`[layer-a] overall: ${overallPass ? "PASS" : "FAIL"}`);
  console.info(`[layer-a] evidence: ${outDir}`);
  process.exit(overallPass ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
