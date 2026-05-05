// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useGrokVoiceConversation,
  type UseGrokVoiceConversationDeps,
} from "../../lib/roleplay/useGrokVoiceConversation";
import { GrokVoiceAudioQueue } from "../../lib/roleplay/grok-voice-audio-queue";
import type {
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

function buildStubAudioQueue() {
  return new GrokVoiceAudioQueue({
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
}

function buildFakeRealtime() {
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
      ready = true;
      onReady?.();
    },
    sendUserText: (arg: unknown) => sent.push({ method: "sendUserText", arg }),
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
  return { realtime, sent, ctor, emit };
}

describe("useGrokVoiceConversation", () => {
  it("opens session, primes assistant history, and applies streamed audio + text events", async () => {
    const fetchSession = vi.fn(async () => SESSION);
    const fake = buildFakeRealtime();
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession,
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

    // Now simulate a turn: user types, Grok responds.
    await act(async () => {
      await result.current.sendTextMessage("募集背景を教えてください");
    });
    const userTextSent = fake.sent.find((s) => s.method === "sendUserText");
    expect(userTextSent?.arg).toBe("募集背景を教えてください");

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

  it("cancels once and discards stale deltas on barge-in while the agent is speaking", async () => {
    const fake = buildFakeRealtime();
    const queue = buildStubAudioQueue();
    const flushSpy = vi.spyOn(queue, "flush");
    const deps: UseGrokVoiceConversationDeps = {
      fetchSession: vi.fn(async () => SESSION),
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
    await act(async () => {
      await result.current.sendTextMessage("募集背景を教えてください");
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
});
