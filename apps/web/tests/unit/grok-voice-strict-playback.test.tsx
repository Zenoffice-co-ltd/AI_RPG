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

// Strict-playback fixture: same shape as the roleplay-client test fixture but
// with strictSanitizedPlayback: true so the conversation hook takes the
// buffered-then-gated path.
const STRICT_SESSION: GrokVoiceSession = {
  sessionId: "gv_sess_strict",
  scenarioId:
    "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v21",
  backend: "grok-voice-think-fast",
  promptVersion: "v1",
  promptHash: "abc123def456",
  guardrailVersion: "gv-think-fast-v4.9-2026-05-09",
  grokVoiceModel: "grok-voice-think-fast-1.0",
  grokVoiceVoiceId: "rex",
  wsUrl: "wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-1.0",
  ephemeralToken: "ephemeral-test",
  ephemeralExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  audio: { inputFormat: "audio/pcm", outputFormat: "audio/pcm", sampleRate: 24_000 },
  turnDetection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 500 },
  instructions: "You are a roleplay agent.",
  firstMessage: "お時間ありがとうございます。",
  strictSanitizedPlayback: true,
};

const GREETING: GrokVoiceGreeting = {
  audioBase64: Buffer.from(new Uint8Array(48)).toString("base64"),
  mimeType: "audio/pcm",
  sampleRateHz: 24_000,
  textLen: STRICT_SESSION.firstMessage.length,
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
        createBuffer: (_channels: number, length: number, sampleRate: number) => ({
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
  vi.spyOn(queue, "enqueueBase64AndWait").mockImplementation(async () => {
    // Resolve immediately so tests don't need to drive playback completion.
  });
  return queue;
}

function buildFakeRealtime() {
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
  const ctor = (opts: {
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
  const emit = (event: GrokVoiceServerEvent) => onMessage?.(event);
  return { realtime, sent, ctor, emit };
}

async function startStrictHook(opts: {
  fetchSanitizedResponseTts?: UseGrokVoiceConversationDeps["fetchSanitizedResponseTts"];
  audioQueueOverride?: ReturnType<typeof buildStubAudioQueue>;
  fakeOverride?: ReturnType<typeof buildFakeRealtime>;
}) {
  const fake = opts.fakeOverride ?? buildFakeRealtime();
  const queue = opts.audioQueueOverride ?? buildStubAudioQueue();
  const enqueueSpy = vi.spyOn(queue, "enqueueBase64");
  const enqueueAndWaitSpy = vi.spyOn(queue, "enqueueBase64AndWait");
  const deps: UseGrokVoiceConversationDeps = {
    fetchSession: vi.fn(async () => STRICT_SESSION),
    fetchGreeting: vi.fn(async () => GREETING),
    fetchSanitizedResponseTts:
      opts.fetchSanitizedResponseTts ?? vi.fn(async () => SANITIZED_TTS),
    createAudioQueue: () => queue,
    createRealtime: fake.ctor as unknown as NonNullable<
      UseGrokVoiceConversationDeps["createRealtime"]
    >,
    micEnabled: false,
  };
  const { result } = renderHook(() => useGrokVoiceConversation("live", deps));
  await act(async () => {
    await result.current.startConversation();
  });
  await waitFor(() => {
    expect(result.current.status).toBe("listening");
  });
  return { result, fake, queue, enqueueSpy, enqueueAndWaitSpy, deps };
}

const PCM_CHUNK = Buffer.from(new Uint8Array(48)).toString("base64");

describe("strict sanitized playback — buffering & clean turn", () => {
  it("buffers raw audio chunks and does NOT call enqueueBase64 between deltas and response.done", async () => {
    const { result, fake, enqueueSpy } = await startStrictHook({});
    await act(async () => {
      await result.current.sendTextMessage("業務時間は？");
    });

    act(() => {
      fake.emit({ type: "response.created", response: { id: "clean-r1" } });
      fake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "平日は朝八時よんじゅうごふんから夕方五時三十分です。",
        item_id: "clean-item",
      });
      fake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "clean-item",
      });
      fake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "clean-item",
      });
    });

    // No enqueueBase64 call has happened yet — chunks are buffered.
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it("clean turn: plays buffered chunks via enqueueBase64AndWait then returns to listening", async () => {
    const { result, fake, enqueueSpy, enqueueAndWaitSpy } = await startStrictHook({});
    await act(async () => {
      await result.current.sendTextMessage("業務時間は？");
    });

    await act(async () => {
      fake.emit({ type: "response.created", response: { id: "clean-r1" } });
      fake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "平日は朝八時よんじゅうごふんから夕方五時三十分です。",
        item_id: "clean-item",
      });
      fake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "clean-item",
      });
      fake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "clean-item",
      });
      fake.emit({ type: "response.done", response: { id: "clean-r1" } });
    });

    await waitFor(() => {
      expect(result.current.metricsLog).toHaveLength(1);
    });
    // Strict-mode clean path uses enqueueBase64AndWait once per chunk.
    // (greeting playback also called it once; clean turn adds 2 more.)
    expect(enqueueAndWaitSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    // Raw enqueueBase64 must NEVER fire in strict mode — that's the whole
    // point of the rework.
    expect(enqueueSpy).not.toHaveBeenCalled();
    const m = result.current.metricsLog[0]!;
    expect(m.outcome).toBe("clean");
    expect(m.error).toBeNull();
    expect(m.audioBytes).toBeGreaterThan(0);
    await waitFor(() => expect(result.current.status).toBe("listening"));
  });
});

describe("strict sanitized playback — stock suffix detected", () => {
  it("drops buffered audio, calls sanitized-TTS, plays returned audio once", async () => {
    const fetchSanitizedResponseTts = vi.fn(async () => SANITIZED_TTS);
    const { result, fake, enqueueSpy, enqueueAndWaitSpy } = await startStrictHook({
      fetchSanitizedResponseTts,
    });
    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });

    await act(async () => {
      fake.emit({ type: "response.created", response: { id: "suffix-r1" } });
      fake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "受発注経験の確認から進めます。何か他にご質問ありますか。",
        item_id: "suffix-item",
      });
      fake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "suffix-item",
      });
      fake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "suffix-item",
      });
      fake.emit({ type: "response.done", response: { id: "suffix-r1" } });
    });

    await waitFor(() => expect(result.current.metricsLog).toHaveLength(1));
    // Raw realtime audio is NEVER scheduled in strict mode.
    expect(enqueueSpy).not.toHaveBeenCalled();
    // Sanitized-TTS endpoint is called once with the cleaned text.
    expect(fetchSanitizedResponseTts).toHaveBeenCalledTimes(1);
    expect(fetchSanitizedResponseTts).toHaveBeenCalledWith({
      sessionId: STRICT_SESSION.sessionId,
      text: "受発注経験の確認から進めます。",
    });
    // The sanitized-TTS audio is played via enqueueBase64AndWait. (Greeting
    // also used it once.)
    const sanitizedCalled = enqueueAndWaitSpy.mock.calls.some(
      (call) => call[0] === SANITIZED_TTS.audioBase64
    );
    expect(sanitizedCalled).toBe(true);

    const m = result.current.metricsLog[0]!;
    expect(m.outcome).toBe("sanitized_tts_played");
    expect(m.error).toBeNull();
    // audioBytes reflects the sanitized-TTS bytes, not the dropped raw bytes.
    const ttsBytes = Math.floor((SANITIZED_TTS.audioBase64.length * 3) / 4);
    expect(m.audioBytes).toBe(ttsBytes);

    // UI transcript shows the sanitized text only.
    expect(
      result.current.messages.some((msg) =>
        msg.text === "受発注経験の確認から進めます。"
      )
    ).toBe(true);
    expect(
      result.current.messages.some((msg) => msg.text.includes("何か他に"))
    ).toBe(false);
  });

  it("sanitized-TTS HTTP failure: drops buffered audio AND does NOT fall back to raw audio", async () => {
    const fetchSanitizedResponseTts = vi.fn(async () => {
      throw new Error("502 Bad Gateway");
    });
    const { result, fake, enqueueSpy } = await startStrictHook({
      fetchSanitizedResponseTts,
    });
    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });

    await act(async () => {
      fake.emit({ type: "response.created", response: { id: "fail-r1" } });
      fake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "受発注経験の確認から進めます。何か他にご質問ありますか。",
        item_id: "fail-item",
      });
      fake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "fail-item",
      });
      fake.emit({ type: "response.done", response: { id: "fail-r1" } });
    });

    await waitFor(() => expect(result.current.metricsLog).toHaveLength(1));
    // Critical guarantee: even on TTS failure the raw realtime audio is NEVER
    // played. This is the whole point of "no raw fallback."
    expect(enqueueSpy).not.toHaveBeenCalled();
    const m = result.current.metricsLog[0]!;
    expect(m.outcome).toBe("sanitized_tts_failed");
    expect(m.error).toBe("sanitized_tts_failed");
    expect(m.audioBytes).toBe(0);
    // P1A: the failed turn left the raw suffix in xAI memory; session is tainted.
    expect(m.sessionTainted).toBe(true);
  });

  it("sanitized-to-empty: no TTS request, no audio, error='sanitized_to_empty'", async () => {
    const fetchSanitizedResponseTts = vi.fn();
    const { result, fake, enqueueSpy } = await startStrictHook({
      fetchSanitizedResponseTts:
        fetchSanitizedResponseTts as unknown as UseGrokVoiceConversationDeps["fetchSanitizedResponseTts"],
    });
    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });

    await act(async () => {
      fake.emit({ type: "response.created", response: { id: "empty-r1" } });
      fake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "他に何か質問はありますか。",
        item_id: "empty-item",
      });
      fake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "empty-item",
      });
      fake.emit({ type: "response.done", response: { id: "empty-r1" } });
    });

    await waitFor(() => expect(result.current.metricsLog).toHaveLength(1));
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(fetchSanitizedResponseTts).not.toHaveBeenCalled();
    const m = result.current.metricsLog[0]!;
    expect(m.outcome).toBe("sanitized_to_empty");
    expect(m.error).toBe("sanitized_to_empty");
    expect(m.audioBytes).toBe(0);
    // P1A: a wholly-suffix turn poisons the realtime session.
    expect(m.sessionTainted).toBe(true);
  });

  it("audio without transcript: suppresses audio as unverifiable", async () => {
    const { result, fake, enqueueSpy } = await startStrictHook({});
    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });

    await act(async () => {
      // No transcript delta — only audio. We can't inspect what's in those
      // bytes, so we drop them.
      fake.emit({ type: "response.created", response: { id: "unv-r1" } });
      fake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "unv-item",
      });
      fake.emit({ type: "response.done", response: { id: "unv-r1" } });
    });

    await waitFor(() => expect(result.current.metricsLog).toHaveLength(1));
    expect(enqueueSpy).not.toHaveBeenCalled();
    const m = result.current.metricsLog[0]!;
    expect(m.outcome).toBe("unverified_audio_suppressed");
    expect(m.error).toBe("unverified_audio_suppressed");
    expect(m.audioBytes).toBe(0);
    // P1A: unverifiable assistant audio in xAI session memory taints the socket.
    expect(m.sessionTainted).toBe(true);
  });

  it("stock suffix split across multiple text deltas is still detected at response.done", async () => {
    const fetchSanitizedResponseTts = vi.fn(async () => SANITIZED_TTS);
    const { result, fake } = await startStrictHook({ fetchSanitizedResponseTts });
    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });

    await act(async () => {
      fake.emit({ type: "response.created", response: { id: "split-r1" } });
      fake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "受発注経験の確認から進めます。",
        item_id: "split-item",
      });
      fake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "何か他にご質問",
        item_id: "split-item",
      });
      fake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "ありますか。",
        item_id: "split-item",
      });
      fake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "split-item",
      });
      fake.emit({ type: "response.done", response: { id: "split-r1" } });
    });

    await waitFor(() => expect(result.current.metricsLog).toHaveLength(1));
    expect(fetchSanitizedResponseTts).toHaveBeenCalledTimes(1);
    expect(fetchSanitizedResponseTts).toHaveBeenCalledWith({
      sessionId: STRICT_SESSION.sessionId,
      text: "受発注経験の確認から進めます。",
    });
  });

  it("non-clean failure paths post realtime.session_tainted with reason and parentSessionId", async () => {
    // Spy on /api/v3/event posts to check the typed event fires with the
    // right `reason` discriminator on each non-clean outcome.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.endsWith("/api/v3/event")) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("not used", { status: 200 });
      });

    const fetchSanitizedResponseTts = vi.fn(async () => {
      throw new Error("502 Bad Gateway");
    });
    const { result, fake } = await startStrictHook({ fetchSanitizedResponseTts });
    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });
    await act(async () => {
      fake.emit({ type: "response.created", response: { id: "tttf-r1" } });
      fake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "受発注経験の確認から進めます。何か他にご質問ありますか。",
        item_id: "tttf-item",
      });
      fake.emit({
        type: "response.output_audio.delta",
        delta: PCM_CHUNK,
        item_id: "tttf-item",
      });
      fake.emit({ type: "response.done", response: { id: "tttf-r1" } });
    });
    await waitFor(() => expect(result.current.metricsLog).toHaveLength(1));

    // Find the realtime.session_tainted POST.
    const eventCalls = fetchSpy.mock.calls
      .filter((c) => {
        const url = typeof c[0] === "string" ? c[0] : (c[0] as Request).url;
        return url.endsWith("/api/v3/event");
      })
      .map((c) => {
        const body = (c[1] as RequestInit | undefined)?.body;
        return JSON.parse(String(body)) as Record<string, unknown>;
      });
    const taintedPosts = eventCalls.filter(
      (b) => b["kind"] === "realtime.session_tainted"
    );
    expect(taintedPosts.length).toBeGreaterThanOrEqual(1);
    const last = taintedPosts.at(-1)!;
    const details = last["details"] as Record<string, unknown>;
    expect(details["reason"]).toBe("sanitized_tts_failed");
    expect(details["parentSessionId"]).toBe(STRICT_SESSION.sessionId);
    fetchSpy.mockRestore();
  });
});
