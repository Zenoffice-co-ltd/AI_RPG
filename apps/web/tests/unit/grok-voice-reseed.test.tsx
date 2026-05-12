// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useGrokVoiceConversation,
  type UseGrokVoiceConversationDeps,
} from "../../lib/roleplay/useGrokVoiceConversation";
import { GrokVoiceAudioQueue } from "../../lib/roleplay/grok-voice-audio-queue";
import type {
  GrokVoiceGreeting,
  GrokVoiceSanitizedResponseTts,
  GrokVoiceServerEvent,
  GrokVoiceSession,
} from "../../lib/roleplay/grok-voice-types";

// Reseed tests build on the strict-playback fixture but with a fakeRealtime
// factory so the test can spin up a SECOND fake on demand and assert that
// strict-playback hooks correctly close the first and open the second.

const FIRST_SESSION: GrokVoiceSession = {
  sessionId: "gv_sess_first",
  scenarioId:
    "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v21",
  backend: "grok-voice-think-fast",
  promptVersion: "v1",
  promptHash: "abc123def456",
  guardrailVersion: "gv-think-fast-v4.9-2026-05-09",
  grokVoiceModel: "grok-voice-think-fast-1.0",
  grokVoiceVoiceId: "rex",
  wsUrl: "wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-1.0",
  ephemeralToken: "ephemeral-first",
  ephemeralExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  audio: { inputFormat: "audio/pcm", outputFormat: "audio/pcm", sampleRate: 24_000 },
  turnDetection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 500 },
  instructions: "You are a roleplay agent.",
  firstMessage: "お時間ありがとうございます。",
  strictSanitizedPlayback: true,
  strictPlaybackMode: "all_turns",
};

const RESEEDED_SESSION: GrokVoiceSession = {
  ...FIRST_SESSION,
  sessionId: "gv_sess_second",
  ephemeralToken: "ephemeral-second",
  parentSessionId: FIRST_SESSION.sessionId,
};

const GREETING: GrokVoiceGreeting = {
  audioBase64: Buffer.from(new Uint8Array(48)).toString("base64"),
  mimeType: "audio/pcm",
  sampleRateHz: 24_000,
  textLen: FIRST_SESSION.firstMessage.length,
  voiceId: "rex",
  vendorMs: 100,
};

const SANITIZED_TTS: GrokVoiceSanitizedResponseTts = {
  text: "受発注経験の確認から進めます。",
  displayText: "受発注経験の確認から進めます。",
  audioBase64: Buffer.from(new Uint8Array(96)).toString("base64"),
  mimeType: "audio/pcm",
  sampleRateHz: 24_000,
  textLen: "受発注経験の確認から進めます。".length,
  voiceId: "rex",
  vendorMs: 80,
  cacheStatus: "miss",
};

function buildStubAudioQueue() {
  const queue = new GrokVoiceAudioQueue({
    sampleRate: 24_000,
    createAudioContext: () =>
      ({
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
        decodeAudioData: async () => ({ duration: 0.1 } as AudioBuffer),
        resume: async () => undefined,
        close: async () => undefined,
      }) as unknown as AudioContext,
  });
  vi.spyOn(queue, "enqueueBase64AndWait").mockImplementation(async () => {});
  return queue;
}

type FakeRealtime = {
  realtime: ReturnType<typeof buildOneFakeRealtime>["realtime"];
  sent: Array<{ method: string; arg: unknown }>;
  emit: (event: GrokVoiceServerEvent) => void;
};

function buildOneFakeRealtime() {
  let onMessage: ((event: GrokVoiceServerEvent) => void) | null = null;
  let onOpen: (() => void) | null = null;
  let onReady: (() => void) | null = null;
  const sent: Array<{ method: string; arg: unknown }> = [];
  let ready = false;
  const realtime = {
    open: () => onOpen?.(),
    isOpen: () => true,
    isReady: () => ready,
    sendSessionUpdate: (arg: unknown) => sent.push({ method: "sendSessionUpdate", arg }),
    sendAssistantHistory: (arg: unknown) => {
      sent.push({ method: "sendAssistantHistory", arg });
      ready = true;
      onReady?.();
    },
    sendUserText: (arg: unknown) => sent.push({ method: "sendUserText", arg }),
    sendUserHistory: (arg: unknown) => sent.push({ method: "sendUserHistory", arg }),
    sendAssistantHistoryMessage: (arg: unknown) =>
      sent.push({ method: "sendAssistantHistoryMessage", arg }),
    appendAudio: (arg: unknown) => sent.push({ method: "appendAudio", arg }),
    commitAudio: () => undefined,
    cancelResponse: () => sent.push({ method: "cancelResponse", arg: null }),
    close: () => sent.push({ method: "close", arg: null }),
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
      typeof import("../../lib/roleplay/grok-voice-realtime").GrokVoiceRealtime
    >;
  };
  return {
    realtime,
    sent,
    bind,
    emit: (event: GrokVoiceServerEvent) => onMessage?.(event),
  };
}

function buildRealtimeFactory() {
  const fakes: ReturnType<typeof buildOneFakeRealtime>[] = [];
  const ctor = (opts: {
    onMessage: (event: GrokVoiceServerEvent) => void;
    onOpen?: () => void;
    onReady?: () => void;
  }) => {
    const next = buildOneFakeRealtime();
    fakes.push(next);
    return next.bind(opts);
  };
  return { fakes, ctor };
}

// Fake mic recorder that records setEnabled toggles and exposes a manual
// pushChunk() so tests can simulate frames arriving from the recorder. The
// onChunk callback the hook passes us is the same place the synchronous
// drop guard runs, so pushChunk is the test's view into "would this frame
// reach realtime.appendAudio?".
function buildFakeMicRecorder() {
  type State = "idle" | "listening" | "speaking" | "paused";
  const setEnabledCalls: boolean[] = [];
  let onChunk: ((b64: string) => void) | null = null;
  const recorder = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    setEnabled: vi.fn((enabled: boolean) => {
      setEnabledCalls.push(enabled);
    }),
    getInputVolume: () => 0,
  } as const;
  function attach(
    cb: (chunk: string) => void,
    _callbacks: {
      onError: (error: Error) => void;
      onStateChange: (state: State) => void;
    }
  ) {
    onChunk = cb;
    return recorder as unknown as import("../../lib/roleplay/grok-voice-mic-recorder").GrokVoiceMicRecorder;
  }
  return {
    recorder,
    setEnabledCalls,
    pushChunk: (b64: string) => onChunk?.(b64),
    factory: attach as NonNullable<UseGrokVoiceConversationDeps["createMicRecorder"]>,
  };
}

const PCM_CHUNK = Buffer.from(new Uint8Array(48)).toString("base64");
const MIC_CHUNK = Buffer.from(new Uint8Array(64)).toString("base64");

describe("strict sanitized playback — reseed", () => {
  it("after stock_suffix_detected: closes old socket, fetches reseed session, replays sanitized history", async () => {
    const factory = buildRealtimeFactory();
    const queue = buildStubAudioQueue();
    const fetchSession = vi
      .fn<NonNullable<UseGrokVoiceConversationDeps["fetchSession"]>>()
      .mockImplementationOnce(async () => FIRST_SESSION)
      .mockImplementationOnce(async () => RESEEDED_SESSION);
    const fetchSanitizedResponseTts = vi.fn(async () => SANITIZED_TTS);
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession,
      fetchGreeting: vi.fn(async () => GREETING),
      fetchSanitizedResponseTts,
      createAudioQueue: () => queue,
      createRealtime: factory.ctor as unknown as NonNullable<
        UseGrokVoiceConversationDeps["createRealtime"]
      >,
      micEnabled: false,
    };
    const { result } = renderHook(() => useGrokVoiceConversation("live", deps));
    await act(async () => {
      await result.current.startConversation();
    });
    await waitFor(() => expect(result.current.status).toBe("listening"));

    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });

    const firstFake = factory.fakes[0]!;
    await act(async () => {
      firstFake.emit({ type: "response.created", response: { id: "suffix-r1" } });
      firstFake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "受発注経験の確認から進めます。何か他にご質問ありますか。",
        item_id: "suffix-item",
      });
      firstFake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "suffix-item",
      });
      firstFake.emit({ type: "response.done", response: { id: "suffix-r1" } });
    });

    await waitFor(() => expect(result.current.metricsLog).toHaveLength(1));

    // Old socket was closed.
    expect(firstFake.sent.some((s) => s.method === "close")).toBe(true);
    // fetchSession was called twice: once for initial, once for reseed.
    expect(fetchSession).toHaveBeenCalledTimes(2);
    expect(fetchSession).toHaveBeenNthCalledWith(2, {
      demoSlug: "adecco-roleplay-v3",
      reseedFromSessionId: FIRST_SESSION.sessionId,
      routerVariant: "A_STRICT_FALLBACK_CONTROL",
    });
    // A second fake realtime was created and primed.
    expect(factory.fakes.length).toBe(2);
    const secondFake = factory.fakes[1]!;
    expect(secondFake.sent.find((s) => s.method === "sendSessionUpdate")).toBeTruthy();
    const primingHistory = secondFake.sent.find(
      (s) => s.method === "sendAssistantHistory"
    );
    expect(primingHistory?.arg).toBe(FIRST_SESSION.firstMessage);
    // History replay: user text, then sanitized agent text. The firstMessage
    // is NOT replayed (it was already primed by sendAssistantHistory).
    const replayed = secondFake.sent.filter(
      (s) =>
        s.method === "sendUserHistory" ||
        s.method === "sendAssistantHistoryMessage"
    );
    expect(replayed[0]).toEqual({
      method: "sendUserHistory",
      arg: "今日の進め方を教えてください",
    });
    expect(replayed[1]).toEqual({
      method: "sendAssistantHistoryMessage",
      arg: SANITIZED_TTS.text,
    });
    // CRITICAL: the replayed assistant history is the SANITIZED text, not the
    // raw model output ("...何か他にご質問ありますか。") which is what we
    // fixed the leak from.
    expect(JSON.stringify(replayed)).not.toContain("何か他にご質問");

    // Metric: outcome reflects successful reseed; sessionTainted=false.
    const m = result.current.metricsLog[0]!;
    expect(m.outcome).toBe("sanitized_tts_played");
    expect(m.sessionTainted).toBe(false);
    expect(m.parentSessionId).toBe(FIRST_SESSION.sessionId);
    expect(m.sessionId).toBe(RESEEDED_SESSION.sessionId);
    expect(m.reseedMs).toBeGreaterThanOrEqual(0);
  });

  it("reseed failure marks sessionTainted=true; raw audio NEVER plays", async () => {
    const factory = buildRealtimeFactory();
    const queue = buildStubAudioQueue();
    const enqueueSpy = vi.spyOn(queue, "enqueueBase64");
    const fetchSession = vi
      .fn<NonNullable<UseGrokVoiceConversationDeps["fetchSession"]>>()
      .mockImplementationOnce(async () => FIRST_SESSION)
      .mockImplementationOnce(async () => {
        throw new Error("429 too many sessions");
      });
    const fetchSanitizedResponseTts = vi.fn(async () => SANITIZED_TTS);
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession,
      fetchGreeting: vi.fn(async () => GREETING),
      fetchSanitizedResponseTts,
      createAudioQueue: () => queue,
      createRealtime: factory.ctor as unknown as NonNullable<
        UseGrokVoiceConversationDeps["createRealtime"]
      >,
      micEnabled: false,
    };
    const { result } = renderHook(() => useGrokVoiceConversation("live", deps));
    await act(async () => {
      await result.current.startConversation();
    });
    await waitFor(() => expect(result.current.status).toBe("listening"));
    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });

    const firstFake = factory.fakes[0]!;
    await act(async () => {
      firstFake.emit({ type: "response.created", response: { id: "fail-r1" } });
      firstFake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "受発注経験の確認から進めます。何か他にご質問ありますか。",
        item_id: "fail-item",
      });
      firstFake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "fail-item",
      });
      firstFake.emit({ type: "response.done", response: { id: "fail-r1" } });
    });

    await waitFor(() => expect(result.current.metricsLog).toHaveLength(1));
    // Raw realtime audio never played, even with reseed failure.
    expect(enqueueSpy).not.toHaveBeenCalled();
    const m = result.current.metricsLog[0]!;
    expect(m.outcome).toBe("reseed_failed_after_play");
    expect(m.error).toBe("reseed_failed_after_play");
    expect(m.sessionTainted).toBe(true);
    expect(m.parentSessionId).toBe(FIRST_SESSION.sessionId);
  });

  it("tainted-socket retry on next user-turn entry: reseed runs before send", async () => {
    const factory = buildRealtimeFactory();
    const queue = buildStubAudioQueue();
    const fetchSession = vi
      .fn<NonNullable<UseGrokVoiceConversationDeps["fetchSession"]>>()
      .mockImplementationOnce(async () => FIRST_SESSION)
      .mockImplementationOnce(async () => {
        throw new Error("429");
      })
      .mockImplementationOnce(async () => RESEEDED_SESSION);
    const fetchSanitizedResponseTts = vi.fn(async () => SANITIZED_TTS);
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession,
      fetchGreeting: vi.fn(async () => GREETING),
      fetchSanitizedResponseTts,
      createAudioQueue: () => queue,
      createRealtime: factory.ctor as unknown as NonNullable<
        UseGrokVoiceConversationDeps["createRealtime"]
      >,
      micEnabled: false,
    };
    const { result } = renderHook(() => useGrokVoiceConversation("live", deps));
    await act(async () => {
      await result.current.startConversation();
    });
    await waitFor(() => expect(result.current.status).toBe("listening"));

    // Turn 1: stock suffix → reseed fails → tainted.
    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });
    const firstFake = factory.fakes[0]!;
    await act(async () => {
      firstFake.emit({ type: "response.created", response: { id: "t1" } });
      firstFake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "受発注経験の確認から進めます。何か他にご質問ありますか。",
        item_id: "t1-item",
      });
      firstFake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "t1-item",
      });
      firstFake.emit({ type: "response.done", response: { id: "t1" } });
    });
    await waitFor(() => expect(result.current.metricsLog).toHaveLength(1));
    expect(result.current.metricsLog[0]?.sessionTainted).toBe(true);

    // Turn 2: user sends new text. Hook should retry reseed first.
    await act(async () => {
      await result.current.sendTextMessage("業務時間は？");
    });

    // Third fetchSession call MUST have been made with reseedFromSessionId.
    expect(fetchSession).toHaveBeenCalledTimes(3);
    expect(fetchSession).toHaveBeenNthCalledWith(3, {
      demoSlug: "adecco-roleplay-v3",
      reseedFromSessionId: FIRST_SESSION.sessionId,
      routerVariant: "A_STRICT_FALLBACK_CONTROL",
    });
    // The sendTextMessage should have routed through the new (reseeded)
    // socket. Two fakes existed before this turn (initial + first failed
    // reseed attempt didn't construct a new fake), then this turn opens a
    // fresh one.
    expect(factory.fakes.length).toBeGreaterThanOrEqual(2);
    const latestFake = factory.fakes.at(-1)!;
    expect(
      latestFake.sent.some(
        (s) => s.method === "sendUserText" && s.arg === "業務時間は？"
      )
    ).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Phase 5: P1A failure-path tainting (close socket + disable mic on every
  // non-clean outcome). One test per failure path that asserts the tainted
  // socket was closed AND the mic was disabled.
  // ---------------------------------------------------------------------------

  it("sanitized_tts_failed: closes the tainted socket immediately and disables mic", async () => {
    const factory = buildRealtimeFactory();
    const queue = buildStubAudioQueue();
    const mic = buildFakeMicRecorder();
    const fetchSession = vi
      .fn<NonNullable<UseGrokVoiceConversationDeps["fetchSession"]>>()
      .mockImplementationOnce(async () => FIRST_SESSION);
    const fetchSanitizedResponseTts = vi.fn(async () => {
      throw new Error("502 Bad Gateway");
    });
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession,
      fetchGreeting: vi.fn(async () => GREETING),
      fetchSanitizedResponseTts,
      createAudioQueue: () => queue,
      createRealtime: factory.ctor as unknown as NonNullable<
        UseGrokVoiceConversationDeps["createRealtime"]
      >,
      createMicRecorder: mic.factory,
      micEnabled: true,
    };
    const { result } = renderHook(() => useGrokVoiceConversation("live", deps));
    await act(async () => {
      await result.current.startConversation();
    });
    await waitFor(() => expect(result.current.status).toBe("listening"));

    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });
    const firstFake = factory.fakes[0]!;
    await act(async () => {
      firstFake.emit({ type: "response.created", response: { id: "ttf-1" } });
      firstFake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "受発注経験の確認から進めます。何か他にご質問ありますか。",
        item_id: "ttf-item",
      });
      firstFake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "ttf-item",
      });
      firstFake.emit({ type: "response.done", response: { id: "ttf-1" } });
    });
    await waitFor(() => expect(result.current.metricsLog).toHaveLength(1));

    // P1A: tainted socket closed; mic disabled; sessionTainted in metric.
    expect(firstFake.sent.some((s) => s.method === "close")).toBe(true);
    expect(mic.setEnabledCalls).toContain(false);
    expect(result.current.metricsLog[0]?.sessionTainted).toBe(true);
    expect(result.current.metricsLog[0]?.outcome).toBe("sanitized_tts_failed");
  });

  it("sanitized_to_empty: closes the tainted socket and disables mic", async () => {
    const factory = buildRealtimeFactory();
    const queue = buildStubAudioQueue();
    const mic = buildFakeMicRecorder();
    const fetchSession = vi
      .fn<NonNullable<UseGrokVoiceConversationDeps["fetchSession"]>>()
      .mockImplementationOnce(async () => FIRST_SESSION);
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession,
      fetchGreeting: vi.fn(async () => GREETING),
      fetchSanitizedResponseTts: vi.fn(async () => SANITIZED_TTS),
      createAudioQueue: () => queue,
      createRealtime: factory.ctor as unknown as NonNullable<
        UseGrokVoiceConversationDeps["createRealtime"]
      >,
      createMicRecorder: mic.factory,
      micEnabled: true,
    };
    const { result } = renderHook(() => useGrokVoiceConversation("live", deps));
    await act(async () => {
      await result.current.startConversation();
    });
    await waitFor(() => expect(result.current.status).toBe("listening"));

    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });
    const firstFake = factory.fakes[0]!;
    await act(async () => {
      firstFake.emit({ type: "response.created", response: { id: "ste-1" } });
      firstFake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "他に何か質問はありますか。",
        item_id: "ste-item",
      });
      firstFake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "ste-item",
      });
      firstFake.emit({ type: "response.done", response: { id: "ste-1" } });
    });
    await waitFor(() => expect(result.current.metricsLog).toHaveLength(1));

    expect(firstFake.sent.some((s) => s.method === "close")).toBe(true);
    expect(mic.setEnabledCalls).toContain(false);
    expect(result.current.metricsLog[0]?.sessionTainted).toBe(true);
    expect(result.current.metricsLog[0]?.outcome).toBe("sanitized_to_empty");
  });

  it("unverified_audio_suppressed: closes the tainted socket and disables mic", async () => {
    const factory = buildRealtimeFactory();
    const queue = buildStubAudioQueue();
    const mic = buildFakeMicRecorder();
    const fetchSession = vi
      .fn<NonNullable<UseGrokVoiceConversationDeps["fetchSession"]>>()
      .mockImplementationOnce(async () => FIRST_SESSION);
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession,
      fetchGreeting: vi.fn(async () => GREETING),
      fetchSanitizedResponseTts: vi.fn(async () => SANITIZED_TTS),
      createAudioQueue: () => queue,
      createRealtime: factory.ctor as unknown as NonNullable<
        UseGrokVoiceConversationDeps["createRealtime"]
      >,
      createMicRecorder: mic.factory,
      micEnabled: true,
    };
    const { result } = renderHook(() => useGrokVoiceConversation("live", deps));
    await act(async () => {
      await result.current.startConversation();
    });
    await waitFor(() => expect(result.current.status).toBe("listening"));

    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });
    const firstFake = factory.fakes[0]!;
    await act(async () => {
      // Audio bytes arrive but no transcript delta — unverifiable.
      firstFake.emit({ type: "response.created", response: { id: "uns-1" } });
      firstFake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "uns-item",
      });
      firstFake.emit({ type: "response.done", response: { id: "uns-1" } });
    });
    await waitFor(() => expect(result.current.metricsLog).toHaveLength(1));

    expect(firstFake.sent.some((s) => s.method === "close")).toBe(true);
    expect(mic.setEnabledCalls).toContain(false);
    expect(result.current.metricsLog[0]?.sessionTainted).toBe(true);
    expect(result.current.metricsLog[0]?.outcome).toBe(
      "unverified_audio_suppressed"
    );
  });

  // ---------------------------------------------------------------------------
  // Phase 5: P1B voice-turn tainted recovery. The mic-driven path must trigger
  // reseed before any chunk reaches realtime.appendAudio, and STT completion
  // while tainted must not append user history.
  // ---------------------------------------------------------------------------

  it("voice turn (speech_started while tainted): retries reseed and never appendAudio's into the tainted socket", async () => {
    const factory = buildRealtimeFactory();
    const queue = buildStubAudioQueue();
    const mic = buildFakeMicRecorder();
    const fetchSession = vi
      .fn<NonNullable<UseGrokVoiceConversationDeps["fetchSession"]>>()
      .mockImplementationOnce(async () => FIRST_SESSION)
      .mockImplementationOnce(async () => RESEEDED_SESSION);
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession,
      fetchGreeting: vi.fn(async () => GREETING),
      fetchSanitizedResponseTts: vi.fn(async () => {
        throw new Error("502");
      }),
      createAudioQueue: () => queue,
      createRealtime: factory.ctor as unknown as NonNullable<
        UseGrokVoiceConversationDeps["createRealtime"]
      >,
      createMicRecorder: mic.factory,
      micEnabled: true,
    };
    const { result } = renderHook(() => useGrokVoiceConversation("live", deps));
    await act(async () => {
      await result.current.startConversation();
    });
    await waitFor(() => expect(result.current.status).toBe("listening"));

    // Drive a stock-suffix turn → sanitized TTS fails → tainted.
    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });
    const firstFake = factory.fakes[0]!;
    await act(async () => {
      firstFake.emit({ type: "response.created", response: { id: "v-1" } });
      firstFake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "受発注経験の確認から進めます。何か他にご質問ありますか。",
        item_id: "v-item",
      });
      firstFake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "v-item",
      });
      firstFake.emit({ type: "response.done", response: { id: "v-1" } });
    });
    await waitFor(() =>
      expect(result.current.metricsLog[0]?.sessionTainted).toBe(true)
    );

    // Mic chunk arriving NOW must be dropped synchronously even before the
    // speech_started event fires (recorder might still flush a frame).
    const firstFakeAppendCountBefore = firstFake.sent.filter(
      (s) => s.method === "appendAudio"
    ).length;
    mic.pushChunk(MIC_CHUNK);
    expect(
      firstFake.sent.filter((s) => s.method === "appendAudio").length
    ).toBe(firstFakeAppendCountBefore);

    // User speaks. speech_started arriving on the OLD socket triggers reseed
    // retry; we don't have an event source for the new socket yet (it'll be
    // created during the retry).
    await act(async () => {
      firstFake.emit({ type: "input_audio_buffer.speech_started" });
    });
    // Wait for retry to complete (reseed succeeds with the second mock).
    await waitFor(() => expect(factory.fakes.length).toBe(2));
    const secondFake = factory.fakes[1]!;
    expect(
      secondFake.sent.some((s) => s.method === "sendAssistantHistory")
    ).toBe(true);
    // After successful retry, mic is re-enabled and chunks now route to the
    // new socket.
    await waitFor(() => expect(mic.setEnabledCalls.at(-1)).toBe(true));
    mic.pushChunk(MIC_CHUNK);
    expect(
      secondFake.sent.filter(
        (s) => s.method === "appendAudio" && s.arg === MIC_CHUNK
      ).length
    ).toBe(1);
    // The OLD fake never received our mic chunk.
    expect(
      firstFake.sent.filter(
        (s) => s.method === "appendAudio" && s.arg === MIC_CHUNK
      ).length
    ).toBe(0);
  });

  it("voice turn: reseed retry failure keeps mic disabled and no audio is appended", async () => {
    const factory = buildRealtimeFactory();
    const queue = buildStubAudioQueue();
    const mic = buildFakeMicRecorder();
    const fetchSession = vi
      .fn<NonNullable<UseGrokVoiceConversationDeps["fetchSession"]>>()
      .mockImplementationOnce(async () => FIRST_SESSION)
      .mockImplementationOnce(async () => {
        throw new Error("429 rate-limited");
      });
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession,
      fetchGreeting: vi.fn(async () => GREETING),
      fetchSanitizedResponseTts: vi.fn(async () => {
        throw new Error("502");
      }),
      createAudioQueue: () => queue,
      createRealtime: factory.ctor as unknown as NonNullable<
        UseGrokVoiceConversationDeps["createRealtime"]
      >,
      createMicRecorder: mic.factory,
      micEnabled: true,
    };
    const { result } = renderHook(() => useGrokVoiceConversation("live", deps));
    await act(async () => {
      await result.current.startConversation();
    });
    await waitFor(() => expect(result.current.status).toBe("listening"));

    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });
    const firstFake = factory.fakes[0]!;
    await act(async () => {
      firstFake.emit({ type: "response.created", response: { id: "vf-1" } });
      firstFake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "受発注経験の確認から進めます。何か他にご質問ありますか。",
        item_id: "vf-item",
      });
      firstFake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "vf-item",
      });
      firstFake.emit({ type: "response.done", response: { id: "vf-1" } });
    });
    await waitFor(() =>
      expect(result.current.metricsLog[0]?.sessionTainted).toBe(true)
    );

    // Speech started → reseed retry fires but fails.
    await act(async () => {
      firstFake.emit({ type: "input_audio_buffer.speech_started" });
    });
    // Wait for the retry attempt to complete (fetchSession called a second time).
    await waitFor(() => expect(fetchSession).toHaveBeenCalledTimes(2));

    // No new realtime opened; mic still disabled (last setEnabled call was
    // false from markSessionTainted, and the failed retry didn't re-enable).
    expect(factory.fakes.length).toBe(1);
    expect(mic.setEnabledCalls.at(-1)).toBe(false);
    // soft error surfaced
    expect(result.current.errorMessage).not.toBeNull();
    // Subsequent mic chunk is still dropped — synchronous guard.
    const appendsBefore = firstFake.sent.filter(
      (s) => s.method === "appendAudio"
    ).length;
    mic.pushChunk(MIC_CHUNK);
    expect(
      firstFake.sent.filter((s) => s.method === "appendAudio").length
    ).toBe(appendsBefore);
  });

  it("STT completion while tainted: refuses the turn — no UI append, no spoken history, soft retry triggered", async () => {
    const factory = buildRealtimeFactory();
    const queue = buildStubAudioQueue();
    const mic = buildFakeMicRecorder();
    const fetchSession = vi
      .fn<NonNullable<UseGrokVoiceConversationDeps["fetchSession"]>>()
      .mockImplementationOnce(async () => FIRST_SESSION)
      .mockImplementationOnce(async () => RESEEDED_SESSION);
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession,
      fetchGreeting: vi.fn(async () => GREETING),
      fetchSanitizedResponseTts: vi.fn(async () => {
        throw new Error("502");
      }),
      createAudioQueue: () => queue,
      createRealtime: factory.ctor as unknown as NonNullable<
        UseGrokVoiceConversationDeps["createRealtime"]
      >,
      createMicRecorder: mic.factory,
      micEnabled: true,
    };
    const { result } = renderHook(() => useGrokVoiceConversation("live", deps));
    await act(async () => {
      await result.current.startConversation();
    });
    await waitFor(() => expect(result.current.status).toBe("listening"));

    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });
    const firstFake = factory.fakes[0]!;
    await act(async () => {
      firstFake.emit({ type: "response.created", response: { id: "stt-1" } });
      firstFake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "受発注経験の確認から進めます。何か他にご質問ありますか。",
        item_id: "stt-item",
      });
      firstFake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "stt-item",
      });
      firstFake.emit({ type: "response.done", response: { id: "stt-1" } });
    });
    await waitFor(() =>
      expect(result.current.metricsLog[0]?.sessionTainted).toBe(true)
    );

    const messagesBefore = result.current.messages.length;
    // The first text turn already produced a sendUserText on the original
    // socket — capture the pre-STT state so the post-STT assertion only
    // catches NEW calls.
    const firstFakeSentBefore = firstFake.sent.length;
    // STT result arrives on the (now-orphaned) original socket while tainted.
    await act(async () => {
      firstFake.emit({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "業務時間は？",
      });
    });
    // Refused: no new user message in UI.
    expect(result.current.messages.length).toBe(messagesBefore);
    // No new sendUserText / sendUserHistory / appendAudio reached the
    // tainted socket as a result of the STT event.
    const newSendsOnFirstFake = firstFake.sent
      .slice(firstFakeSentBefore)
      .filter(
        (s) =>
          s.method === "sendUserText" ||
          s.method === "sendUserHistory" ||
          s.method === "appendAudio"
      );
    expect(newSendsOnFirstFake.length).toBe(0);
    // The refusal also triggered an async reseed retry.
    await waitFor(() => expect(factory.fakes.length).toBe(2));
  });

  it("text turn: tainted retry success — sendTextMessage proceeds onto the NEW socket", async () => {
    // Sanity coverage for the text path matched against the voice path above.
    const factory = buildRealtimeFactory();
    const queue = buildStubAudioQueue();
    const mic = buildFakeMicRecorder();
    const fetchSession = vi
      .fn<NonNullable<UseGrokVoiceConversationDeps["fetchSession"]>>()
      .mockImplementationOnce(async () => FIRST_SESSION)
      .mockImplementationOnce(async () => RESEEDED_SESSION);
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession,
      fetchGreeting: vi.fn(async () => GREETING),
      fetchSanitizedResponseTts: vi.fn(async () => {
        throw new Error("502");
      }),
      createAudioQueue: () => queue,
      createRealtime: factory.ctor as unknown as NonNullable<
        UseGrokVoiceConversationDeps["createRealtime"]
      >,
      createMicRecorder: mic.factory,
      micEnabled: true,
    };
    const { result } = renderHook(() => useGrokVoiceConversation("live", deps));
    await act(async () => {
      await result.current.startConversation();
    });
    await waitFor(() => expect(result.current.status).toBe("listening"));

    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });
    const firstFake = factory.fakes[0]!;
    await act(async () => {
      firstFake.emit({ type: "response.created", response: { id: "tts-1" } });
      firstFake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "受発注経験の確認から進めます。何か他にご質問ありますか。",
        item_id: "tts-item",
      });
      firstFake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "tts-item",
      });
      firstFake.emit({ type: "response.done", response: { id: "tts-1" } });
    });
    await waitFor(() =>
      expect(result.current.metricsLog[0]?.sessionTainted).toBe(true)
    );

    // Next text turn: gate retries reseed before sending.
    await act(async () => {
      await result.current.sendTextMessage("業務時間は？");
    });
    expect(factory.fakes.length).toBe(2);
    const secondFake = factory.fakes[1]!;
    expect(
      secondFake.sent.some(
        (s) => s.method === "sendUserText" && s.arg === "業務時間は？"
      )
    ).toBe(true);
    expect(
      firstFake.sent.some(
        (s) => s.method === "sendUserText" && s.arg === "業務時間は？"
      )
    ).toBe(false);
  });
});
