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
  GrokVoiceServerEvent,
  GrokVoiceSession,
} from "../../lib/roleplay/grok-voice-types";

const SESSION: GrokVoiceSession = {
  sessionId: "gv_sess_test",
  scenarioId:
    "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v21",
  backend: "grok-voice-think-fast",
  promptVersion: "v1",
  promptHash: "abc123def456",
  guardrailVersion: "gv-think-fast-v1-2026-05-04",
  grokVoiceModel: "grok-voice-think-fast-1.0",
  grokVoiceVoiceId: "rex",
  wsUrl: "wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-1.0",
  ephemeralToken: "ephemeral-test",
  ephemeralExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  audio: { inputFormat: "audio/pcm", outputFormat: "audio/pcm", sampleRate: 24_000 },
  turnDetection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 500 },
  instructions: "You are a roleplay agent.",
  firstMessage: "お時間ありがとうございます。",
};

const GREETING: GrokVoiceGreeting = {
  audioBase64: Buffer.from(new Uint8Array(48)).toString("base64"),
  mimeType: "audio/pcm",
  sampleRateHz: 24_000,
  textLen: SESSION.firstMessage.length,
  voiceId: "rex",
  vendorMs: 100,
};

const LOCKED_RATE_TEXT =
  "請求想定は経験により、千七百五十円から、千九百円程度です。";
const LOCKED_TTS = {
  text: LOCKED_RATE_TEXT,
  audioBase64: Buffer.from(new Uint8Array(48)).toString("base64"),
  mimeType: "audio/pcm" as const,
  sampleRateHz: 24_000,
  textLen: LOCKED_RATE_TEXT.length,
  voiceId: "rex",
  vendorMs: 120,
  cacheStatus: "miss" as const,
};

function buildDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function buildStubAudioQueue(opts?: { greetingPlayback?: Promise<void> }) {
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
    await opts?.greetingPlayback;
  });
  return queue;
}

function buildFakeRealtime(opts: { autoReady?: boolean } = {}) {
  let onMessage: ((event: GrokVoiceServerEvent) => void) | null = null;
  let onOpen: (() => void) | null = null;
  let onReady: (() => void) | null = null;
  const sent: Array<{ method: string; arg: unknown }> = [];
  let ready = false;

  const realtime = {
    open: () => {
      // Simulate server immediately accepting the WS connection.
      onOpen?.();
    },
    isOpen: () => true,
    isReady: () => ready,
    sendSessionUpdate: (arg: unknown) => sent.push({ method: "sendSessionUpdate", arg }),
    sendAssistantHistory: (arg: unknown) => {
      sent.push({ method: "sendAssistantHistory", arg });
      if (opts.autoReady !== false) {
        ready = true;
        onReady?.();
      }
    },
    sendUserText: (arg: unknown) => sent.push({ method: "sendUserText", arg }),
    sendUserHistory: (arg: unknown) => sent.push({ method: "sendUserHistory", arg }),
    sendAssistantHistoryMessage: (arg: unknown) =>
      sent.push({ method: "sendAssistantHistoryMessage", arg }),
    appendAudio: (arg: unknown) => sent.push({ method: "appendAudio", arg }),
    commitAudio: () => undefined,
    cancelResponse: () => sent.push({ method: "cancelResponse", arg: null }),
    close: () => undefined,
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
  const markReady = () => {
    ready = true;
    onReady?.();
  };
  return { realtime, sent, ctor, emit, markReady };
}

describe("useGrokVoiceConversation", () => {
  it("opens session, primes assistant history, and applies streamed audio + text events", async () => {
    const fetchSession = vi.fn(async () => SESSION);
    const fake = buildFakeRealtime();
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession,
      fetchGreeting: vi.fn(async () => GREETING),
      createAudioQueue: () => buildStubAudioQueue(),
      createRealtime: fake.ctor as unknown as NonNullable<
        UseGrokVoiceConversationDeps["createRealtime"]
      >,
      micEnabled: false,
    };

    const { result } = renderHook(() => useGrokVoiceConversation("live", deps));
    expect(result.current.status).toBe("idle");

    await act(async () => {
      await result.current.startConversation();
    });

    expect(fetchSession).toHaveBeenCalled();
    expect(result.current.session?.sessionId).toBe(SESSION.sessionId);
    // First message is shown in transcript.
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.role).toBe("agent");
    expect(result.current.messages[0]?.text).toContain("お時間");
    // Realtime was primed with session.update + assistant history.
    const methods = fake.sent.map((s) => s.method);
    expect(methods).toContain("sendSessionUpdate");
    expect(methods).toContain("sendAssistantHistory");

    await waitFor(() => {
      expect(result.current.status).toBe("listening");
    });
    // Now simulate a turn: user types, Grok responds.
    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });
    const userTextSent = fake.sent.find((s) => s.method === "sendUserText");
    expect(userTextSent?.arg).toBe("今日の進め方を教えてください");

    act(() => {
      fake.emit({ type: "response.created" });
      fake.emit({ type: "response.text.delta", delta: "はい、" });
      fake.emit({
        type: "response.output_audio.delta",
        delta: Buffer.from(new Uint8Array(48)).toString("base64"),
      });
      fake.emit({ type: "response.text.delta", delta: "営業事務一名を。" });
      fake.emit({ type: "response.done" });
    });

    await waitFor(() => {
      expect(result.current.metricsLog).toHaveLength(1);
    });
    const metrics = result.current.metricsLog[0]!;
    expect(metrics.sessionId).toBe(SESSION.sessionId);
    expect(metrics.promptHash).toBe("abc123def456");
    expect(metrics.promptVersion).toBe("v1");
    expect(metrics.guardrailVersion).toBe("gv-think-fast-v1-2026-05-04");
    expect(metrics.grokVoiceModel).toBe("grok-voice-think-fast-1.0");
    expect(metrics.audioBytes).toBeGreaterThan(0); // audio actually played — DOD requirement
    expect(metrics.error).toBeNull();

    // Final agent transcript reflects the full streamed reply.
    const agentMessages = result.current.messages.filter((m) => m.role === "agent");
    const finalAgent = agentMessages.find((m) => m.text.includes("営業事務"));
    expect(finalAgent?.status).toBe("final");
  });

  it("flags 'no_audio' as an error in metrics if response.done arrives without any audio chunks (DOD: text-only is not success)", async () => {
    const fake = buildFakeRealtime();
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession: vi.fn(async () => SESSION),
      fetchGreeting: vi.fn(async () => GREETING),
      createAudioQueue: () => buildStubAudioQueue(),
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
    await act(async () => {
      await result.current.sendTextMessage("hello");
    });
    act(() => {
      fake.emit({ type: "response.created" });
      fake.emit({ type: "response.text.delta", delta: "text only" });
      fake.emit({ type: "response.done" });
    });
    await waitFor(() => {
      expect(result.current.metricsLog).toHaveLength(1);
    });
    expect(result.current.metricsLog[0]?.error).toBe("no_audio");
    expect(result.current.metricsLog[0]?.audioBytes).toBe(0);
  });

  it("uses session cached greeting audio without calling fetchGreeting", async () => {
    const fake = buildFakeRealtime();
    const fetchGreeting = vi.fn(async () => GREETING);
    const sessionWithGreeting: GrokVoiceSession = {
      ...SESSION,
      greetingAudio: {
        ...GREETING,
        cacheStatus: "hit",
        cacheKeyHash: "cache-key-hash",
      },
    };
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession: vi.fn(async () => sessionWithGreeting),
      fetchGreeting,
      createAudioQueue: () => buildStubAudioQueue(),
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
    expect(fetchGreeting).not.toHaveBeenCalled();
  });

  it("routes locked text input through deterministic TTS and history sync without sendUserText", async () => {
    const fake = buildFakeRealtime();
    const fetchLockedResponseTts = vi.fn(async () => LOCKED_TTS);
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession: vi.fn(async () => SESSION),
      fetchGreeting: vi.fn(async () => GREETING),
      fetchLockedResponseTts,
      createAudioQueue: () => buildStubAudioQueue(),
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
    await act(async () => {
      await result.current.sendTextMessage("単価を教えてください");
    });
    await waitFor(() => {
      expect(result.current.metricsLog).toHaveLength(1);
    });
    expect(fake.sent.some((s) => s.method === "sendUserText")).toBe(false);
    expect(fake.sent.some((s) => s.method === "sendUserHistory")).toBe(true);
    expect(fake.sent.some((s) => s.method === "sendAssistantHistoryMessage")).toBe(
      true
    );
    expect(result.current.messages.some((m) => m.text === LOCKED_RATE_TEXT)).toBe(
      true
    );
    expect(result.current.metricsLog[0]?.audioBytes).toBeGreaterThan(0);
    expect(result.current.metricsLog[0]?.lockedResponse).toBe(true);
  });

  it("shows display text while syncing spoken text for locked voice-friendly terms", async () => {
    const fake = buildFakeRealtime();
    const fetchLockedResponseTts = vi.fn(async () => LOCKED_TTS);
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession: vi.fn(async () => SESSION),
      fetchGreeting: vi.fn(async () => GREETING),
      fetchLockedResponseTts,
      createAudioQueue: () => buildStubAudioQueue(),
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
    await act(async () => {
      await result.current.sendTextMessage("人柄については？");
    });
    await waitFor(() => {
      expect(result.current.metricsLog).toHaveLength(1);
    });
    expect(
      result.current.messages.some((m) =>
        m.text.includes("協調型が合いやすく、自己流にこだわりすぎる方")
      )
    ).toBe(true);
    expect(
      fake.sent.some(
        (s) =>
          s.method === "sendAssistantHistoryMessage" &&
          String(s.arg).includes("周囲と合わせて進められるタイプ")
      )
    ).toBe(true);
  });

  it("cancels late response.created and ignores realtime audio during a locked voice turn", async () => {
    const fake = buildFakeRealtime();
    const queue = buildStubAudioQueue();
    const enqueueSpy = vi.spyOn(queue, "enqueueBase64");
    const fetchLockedResponseTts = vi.fn(async () => LOCKED_TTS);
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession: vi.fn(async () => SESSION),
      fetchGreeting: vi.fn(async () => GREETING),
      fetchLockedResponseTts,
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

    act(() => {
      fake.emit({ type: "input_audio_buffer.speech_started" });
      fake.emit({ type: "input_audio_buffer.speech_stopped" });
      fake.emit({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "請求はいくらですか？",
      });
      fake.emit({ type: "response.created" });
      fake.emit({
        type: "response.output_audio.delta",
        delta: Buffer.from(new Uint8Array(48)).toString("base64"),
        item_id: "late-item",
      });
    });

    await waitFor(() => {
      expect(result.current.metricsLog).toHaveLength(1);
    });
    expect(fake.sent.filter((s) => s.method === "cancelResponse")).toHaveLength(1);
    expect(enqueueSpy).not.toHaveBeenCalledWith(LOCKED_TTS.audioBase64);
    expect(result.current.metricsLog[0]?.lockedResponse).toBe(true);
    expect(result.current.messages.some((m) => m.text === LOCKED_RATE_TEXT)).toBe(
      true
    );

    act(() => {
      fake.emit({ type: "response.created" });
      fake.emit({
        type: "response.output_audio.delta",
        delta: Buffer.from(new Uint8Array(48)).toString("base64"),
        item_id: "late-after-tts",
      });
      fake.emit({ type: "response.done" });
    });

    expect(fake.sent.filter((s) => s.method === "cancelResponse")).toHaveLength(2);
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(result.current.metricsLog).toHaveLength(1);
  });

  it("does not let locked-response drain cancel the next legitimate voice turn", async () => {
    const fake = buildFakeRealtime();
    const queue = buildStubAudioQueue();
    const enqueueSpy = vi.spyOn(queue, "enqueueBase64");
    const fetchLockedResponseTts = vi.fn(async () => LOCKED_TTS);
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession: vi.fn(async () => SESSION),
      fetchGreeting: vi.fn(async () => GREETING),
      fetchLockedResponseTts,
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

    act(() => {
      fake.emit({ type: "input_audio_buffer.speech_started" });
      fake.emit({ type: "input_audio_buffer.speech_stopped" });
      fake.emit({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "単価はどのくらいですか",
      });
      fake.emit({ type: "response.created", response: { id: "locked-late-r1" } });
      fake.emit({
        type: "response.output_audio.delta",
        delta: Buffer.from(new Uint8Array(48)).toString("base64"),
        item_id: "locked-late-item",
      });
      fake.emit({ type: "response.done", response: { id: "locked-late-r1" } });
    });
    await waitFor(() => {
      expect(result.current.metricsLog).toHaveLength(1);
    });

    act(() => {
      fake.emit({ type: "input_audio_buffer.speech_started" });
      fake.emit({ type: "input_audio_buffer.speech_stopped" });
      fake.emit({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "業務時間は？",
      });
      fake.emit({ type: "response.created", response: { id: "business-hours-r1" } });
      fake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "平日は朝八時よんじゅうごふんから夕方五時三十分です。",
        item_id: "business-hours-item",
      });
      fake.emit({
        type: "response.output_audio.delta",
        delta: Buffer.from(new Uint8Array(48)).toString("base64"),
        item_id: "business-hours-item",
      });
      fake.emit({ type: "response.done", response: { id: "business-hours-r1" } });
    });

    await waitFor(() => {
      expect(result.current.metricsLog).toHaveLength(2);
    });
    expect(fake.sent.filter((s) => s.method === "cancelResponse")).toHaveLength(1);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(result.current.metricsLog[1]?.audioBytes).toBeGreaterThan(0);
    expect(result.current.metricsLog[1]?.error).toBeNull();
    expect(
      result.current.messages.some((m) =>
        m.text.includes("平日は朝八時四十五分から夕方五時三十分です。")
      )
    ).toBe(true);
  });

  it("ignores voice locked-turn mic tail after deterministic TTS starts", async () => {
    const fake = buildFakeRealtime();
    const queue = buildStubAudioQueue();
    const flushSpy = vi.spyOn(queue, "flush");
    const enqueueAndWaitSpy = vi.spyOn(queue, "enqueueBase64AndWait");
    const fetchLockedResponseTts = vi.fn(async () => LOCKED_TTS);
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession: vi.fn(async () => SESSION),
      fetchGreeting: vi.fn(async () => GREETING),
      fetchLockedResponseTts,
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

    let finishLockedPlayback: () => void = () => undefined;
    enqueueAndWaitSpy.mockImplementationOnce(
      async () =>
        new Promise<void>((resolve) => {
          finishLockedPlayback = resolve;
        })
    );

    act(() => {
      fake.emit({ type: "input_audio_buffer.speech_started" });
      fake.emit({ type: "input_audio_buffer.speech_stopped" });
      fake.emit({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "単価はどのくらいですか",
      });
    });

    await waitFor(() => {
      expect(enqueueAndWaitSpy).toHaveBeenCalledTimes(2);
    });

    act(() => {
      fake.emit({ type: "input_audio_buffer.speech_started" });
    });
    expect(flushSpy).not.toHaveBeenCalled();

    await act(async () => {
      finishLockedPlayback();
    });
    await waitFor(() => {
      expect(result.current.metricsLog).toHaveLength(1);
    });
    expect(result.current.metricsLog[0]?.lockedResponse).toBe(true);
    expect(result.current.metricsLog[0]?.audioBytes).toBeGreaterThan(0);
  });

  it("does not cancel or flush normal realtime audio when a stock suffix appears", async () => {
    const fake = buildFakeRealtime();
    const queue = buildStubAudioQueue();
    const enqueueSpy = vi.spyOn(queue, "enqueueBase64").mockImplementation(() => undefined);
    const flushSpy = vi.spyOn(queue, "flush");
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession: vi.fn(async () => SESSION),
      fetchGreeting: vi.fn(async () => GREETING),
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
    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });
    act(() => {
      fake.emit({ type: "response.created" });
      fake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "受発注経験の確認から進めます。何か他にご質問ありますか。",
        item_id: "stock-suffix-item",
      });
      fake.emit({
        type: "response.output_audio.delta",
        delta: Buffer.from(new Uint8Array(48)).toString("base64"),
        item_id: "stock-suffix-item",
      });
      fake.emit({ type: "response.done" });
    });

    await waitFor(() => {
      expect(result.current.metricsLog).toHaveLength(1);
    });
    expect(fake.sent.filter((s) => s.method === "cancelResponse")).toHaveLength(0);
    expect(flushSpy).not.toHaveBeenCalled();
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(result.current.messages.some((m) => m.text.includes("何か他に"))).toBe(
      false
    );
    expect(
      result.current.messages.some((m) => m.text === "受発注経験の確認から進めます。")
    ).toBe(true);
    expect(result.current.metricsLog[0]?.audioBytes).toBeGreaterThan(0);
    expect(result.current.metricsLog[0]?.error).toBeNull();
  });

  it("cancels once and discards stale deltas on barge-in while the agent is speaking", async () => {
    const fake = buildFakeRealtime();
    const queue = buildStubAudioQueue();
    const flushSpy = vi.spyOn(queue, "flush");
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession: vi.fn(async () => SESSION),
      fetchGreeting: vi.fn(async () => GREETING),
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
    await act(async () => {
      await result.current.sendTextMessage("今日の進め方を教えてください");
    });
    act(() => {
      fake.emit({ type: "response.created" });
      fake.emit({
        type: "response.output_audio.delta",
        delta: Buffer.from(new Uint8Array(48)).toString("base64"),
        item_id: "old-item",
      });
      fake.emit({ type: "input_audio_buffer.speech_started" });
      fake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "古い応答です",
        item_id: "old-item",
      });
      fake.emit({
        type: "response.output_audio.delta",
        delta: Buffer.from(new Uint8Array(48)).toString("base64"),
        item_id: "old-item",
      });
    });
    expect(fake.sent.filter((s) => s.method === "cancelResponse")).toHaveLength(1);
    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(result.current.messages.some((m) => m.text.includes("古い応答"))).toBe(false);
  });

  it("ignores sendTextMessage when mode is not live", async () => {
    const fetchSession = vi.fn();
    const fake = buildFakeRealtime();
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession: fetchSession as unknown as () => Promise<GrokVoiceSession>,
      fetchGreeting: vi.fn(async () => GREETING),
      createAudioQueue: () => buildStubAudioQueue(),
      createRealtime: fake.ctor as unknown as NonNullable<
        UseGrokVoiceConversationDeps["createRealtime"]
      >,
    };
    const { result } = renderHook(() => useGrokVoiceConversation("mock", deps));
    await act(async () => {
      await result.current.sendTextMessage("hi");
    });
    expect(fetchSession).not.toHaveBeenCalled();
    expect(fake.sent).toHaveLength(0);
  });

  it("waits for both realtime ready and greeting playback before starting the mic", async () => {
    const playback = buildDeferred();
    const fake = buildFakeRealtime();
    const start = vi.fn(async () => undefined);
    const setEnabled = vi.fn();
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession: vi.fn(async () => SESSION),
      fetchGreeting: vi.fn(async () => GREETING),
      createAudioQueue: () => buildStubAudioQueue({ greetingPlayback: playback.promise }),
      createRealtime: fake.ctor as unknown as NonNullable<
        UseGrokVoiceConversationDeps["createRealtime"]
      >,
      createMicRecorder: () =>
        ({
          start,
          stop: vi.fn(async () => undefined),
          setEnabled,
          getInputVolume: () => 0,
        }) as unknown as ReturnType<NonNullable<UseGrokVoiceConversationDeps["createMicRecorder"]>>,
      micEnabled: true,
    };

    const { result } = renderHook(() => useGrokVoiceConversation("live", deps));
    await act(async () => {
      await result.current.startConversation();
    });
    expect(start).not.toHaveBeenCalled();

    await act(async () => {
      playback.resolve();
      await playback.promise;
    });
    await waitFor(() => {
      expect(start).toHaveBeenCalledTimes(1);
    });
    expect(setEnabled).toHaveBeenCalledWith(true);
  });

  it("skips greeting playback and still starts the mic when greeting TTS fails", async () => {
    const fake = buildFakeRealtime();
    const start = vi.fn(async () => undefined);
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession: vi.fn(async () => SESSION),
      fetchGreeting: vi.fn(async () => {
        throw new Error("tts failed");
      }),
      createAudioQueue: () => buildStubAudioQueue(),
      createRealtime: fake.ctor as unknown as NonNullable<
        UseGrokVoiceConversationDeps["createRealtime"]
      >,
      createMicRecorder: () =>
        ({
          start,
          stop: vi.fn(async () => undefined),
          setEnabled: vi.fn(),
          getInputVolume: () => 0,
        }) as unknown as ReturnType<NonNullable<UseGrokVoiceConversationDeps["createMicRecorder"]>>,
      micEnabled: true,
    };

    const { result } = renderHook(() => useGrokVoiceConversation("live", deps));
    await act(async () => {
      await result.current.startConversation();
    });
    await waitFor(() => {
      expect(start).toHaveBeenCalledTimes(1);
    });
  });

  it("does not send user text before realtime ready even if greeting already completed", async () => {
    const fake = buildFakeRealtime({ autoReady: false });
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession: vi.fn(async () => SESSION),
      fetchGreeting: vi.fn(async () => GREETING),
      createAudioQueue: () => buildStubAudioQueue(),
      createRealtime: fake.ctor as unknown as NonNullable<
        UseGrokVoiceConversationDeps["createRealtime"]
      >,
      micEnabled: false,
    };

    const { result } = renderHook(() => useGrokVoiceConversation("live", deps));
    await act(async () => {
      await result.current.startConversation();
    });
    await act(async () => {
      await result.current.sendTextMessage("募集背景を教えてください");
    });
    expect(fake.sent.some((s) => s.method === "sendUserText")).toBe(false);
  });
});
