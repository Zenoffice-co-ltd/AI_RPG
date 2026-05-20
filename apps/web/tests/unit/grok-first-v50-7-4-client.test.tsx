// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  evaluateNegativeGuardV5074,
  applyNegativeGuardV5074DeletionOnly,
} from "../../lib/grok-first-roleplay/negative-guard-v50-7-4";
import {
  useGrokFirstRoleplayConversation,
  type UseGrokFirstRoleplayDeps,
} from "../../lib/grok-first-roleplay/useGrokFirstRoleplayConversation";
import { GrokVoiceAudioQueue } from "../../lib/roleplay/grok-voice-audio-queue";
import type {
  GrokFirstV50ServerEvent,
  GrokFirstV50Session,
} from "../../lib/grok-first-roleplay/types";

const CLEAN_SESSION = {
  sessionId: "gfv50_7_4_test",
  demoSlug: "adecco-roleplay-v50-7-4",
  backend: "grok-first-v50-7-4",
  scenarioId: "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v50_6",
  promptVersion: "grok-first-v50.7.2-natural-interactive-sales-compact-2026-05-17",
  promptHash: "abc123def456",
  guardrailVersion: "grok-first-v50.7.4-clean-quality-guard-test",
  model: "grok-voice-think-fast-1.0",
  voiceId: "99c95cc8a177",
  realtimeTransport: "mendan_cloud_run_relay_wss",
  wsUrl: "wss://voice.mendan.biz/api/v3/realtime-relay",
  realtimeAuth: {
    mode: "mendan_relay_subprotocol",
    protocol: "mendan-relay-v1",
    ticket: "ticket",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
  audio: { inputFormat: "audio/pcm", outputFormat: "audio/pcm", sampleRate: 24_000 },
  turnDetection: {
    type: "server_vad",
    threshold: 0.65,
    silence_duration_ms: 650,
    prefix_padding_ms: 333,
    create_response: false,
  },
  tools: [],
  instructions: "# v50.7.4",
  firstMessage: "お電話ありがとうございます。",
  registeredSpeechPayloadIncluded: false,
  lockedResponseAudioBundleIncluded: false,
  runtimeTtsEnabled: false,
  replacementTtsEnabled: false,
  latencyMode: "clean_tail_streaming",
  streamAudioBeforeDone: true,
  audioHoldMs: 300,
  fullTurnBufferEnabled: false,
  runtimeGuardrailsEnabled: true,
  inputGuardEnabled: true,
  normalInputRouterEnabled: true,
  negativeGuardEnabled: true,
  tailGuardEnabled: true,
  fixedGuardAudioEnabled: true,
  boundedRewriteEnabled: true,
  debugTranscriptPreviewEnabled: false,
} as unknown as GrokFirstV50Session;

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
        createBufferSource: () =>
          ({
            buffer: null,
            connect: () => undefined,
            start: () => undefined,
            stop: () => undefined,
            onended: null,
          }) as unknown as AudioBufferSourceNode,
        createGain: () =>
          ({ gain: { value: 1 }, connect: () => undefined }) as unknown as GainNode,
        resume: async () => undefined,
        close: async () => undefined,
      }) as unknown as AudioContext,
  });
  vi.spyOn(queue, "enqueueBase64AndWait").mockResolvedValue(undefined);
  vi.spyOn(queue, "enqueueBase64");
  vi.spyOn(queue, "clearAllScheduledAudioForLock");
  return queue;
}

function buildFakeRealtime() {
  let onMessage: ((event: GrokFirstV50ServerEvent) => void) | null = null;
  let onOpen: (() => void) | null = null;
  let onReady: (() => void) | null = null;
  let ready = false;
  const sendUserText = vi.fn();
  const cancelResponse = vi.fn();
  const createResponse = vi.fn();

  const realtime = {
    open: () => onOpen?.(),
    isReady: () => ready,
    sendSessionUpdate: vi.fn(),
    sendAssistantHistory: vi.fn(() => {
      ready = true;
      onReady?.();
    }),
    sendUserText,
    createResponse,
    appendAudio: vi.fn(),
    cancelResponse,
    close: vi.fn(),
    wasClosedByUs: () => false,
  };

  const ctor = (opts: {
    onMessage: (event: GrokFirstV50ServerEvent) => void;
    onOpen?: () => void;
    onReady?: () => void;
  }) => {
    onMessage = opts.onMessage;
    onOpen = opts.onOpen ?? null;
    onReady = opts.onReady ?? null;
    return realtime as unknown as NonNullable<UseGrokFirstRoleplayDeps["createRealtime"]> extends (
      ...args: never[]
    ) => infer R
      ? R
      : never;
  };

  return {
    ctor,
    emit: (event: GrokFirstV50ServerEvent) => onMessage?.(event),
    sendUserText,
    cancelResponse,
    createResponse,
  };
}

function buildFakeMicRecorder() {
  const recorder = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    setEnabled: vi.fn(),
    getInputVolume: vi.fn(() => 0),
  };
  const ctor: NonNullable<UseGrokFirstRoleplayDeps["createMicRecorder"]> = () =>
    recorder as unknown as ReturnType<
      NonNullable<UseGrokFirstRoleplayDeps["createMicRecorder"]>
    >;
  return { ctor, recorder };
}

function renderConversation(input: {
  session?: GrokFirstV50Session;
  fetchOpeningAudio?: UseGrokFirstRoleplayDeps["fetchOpeningAudio"];
  fetchShortAckAudio?: UseGrokFirstRoleplayDeps["fetchShortAckAudio"];
} = {}) {
  const fake = buildFakeRealtime();
  const mic = buildFakeMicRecorder();
  const queue = buildStubAudioQueue();
  const postEvent = vi.fn().mockResolvedValue(undefined);
  const fetchOpeningAudio =
    input.fetchOpeningAudio ??
    vi.fn().mockRejectedValue(new Error("opening audio disabled in unit default"));
  const deps: UseGrokFirstRoleplayDeps = {
    fetchSession: async () => input.session ?? CLEAN_SESSION,
    fetchOpeningAudio,
    postEvent,
    createRealtime: fake.ctor as unknown as NonNullable<
      UseGrokFirstRoleplayDeps["createRealtime"]
    >,
    createAudioQueue: () => queue,
    createMicRecorder: mic.ctor,
    micEnabled: false,
  };
  if (input.fetchShortAckAudio) {
    deps.fetchShortAckAudio = input.fetchShortAckAudio;
  }
  const rendered = renderHook(() => useGrokFirstRoleplayConversation("live", deps));
  return { ...rendered, fake, queue, postEvent, fetchOpeningAudio };
}

function emitUserTurn(
  fake: ReturnType<typeof buildFakeRealtime>,
  transcript: string
) {
  fake.emit({ type: "input_audio_buffer.speech_started" });
  fake.emit({
    type: "conversation.item.input_audio_transcription.completed",
    transcript,
  });
}

function assertNoForbiddenAudioModes(
  metrics: ReadonlyArray<{ audioReleaseMode?: string | undefined }>
) {
  expect(metrics.map((metric) => metric.audioReleaseMode)).not.toContain(
    "fixed_short_ack_audio"
  );
  expect(metrics.map((metric) => metric.audioReleaseMode)).not.toContain(
    "fixed_safe_body_audio"
  );
  expect(metrics.map((metric) => metric.audioReleaseMode)).not.toContain(
    "tail_only_drop_fallback"
  );
}

describe("grok-first v50.7.4 minimal negative guard", () => {
  it("allows short courtesy and request phrases", () => {
    for (const text of [
      "よろしくお願いします。",
      "ありがとうございます。",
      "教えてください。",
      "助かります。",
      "確認します。",
    ]) {
      expect(
        evaluateNegativeGuardV5074({ text, phase: "final" }).action
      ).toBe("pass");
    }
  });

  it("strips only an explicit customer-led tail", () => {
    const raw =
      "メーカー経験は必須ではありません。何か他に確認したい点はありますか。";
    const decision = evaluateNegativeGuardV5074({ text: raw, phase: "final" });

    expect(decision).toMatchObject({
      action: "strip_tail",
      reasons: ["customer_led_sales_flow"],
      hardStop: false,
    });
    expect(applyNegativeGuardV5074DeletionOnly(raw, decision)).toBe(
      "メーカー経験は必須ではありません。"
    );
  });

  it("hard blocks prompt and meta leaks", () => {
    const decision = evaluateNegativeGuardV5074({
      text: "システムプロンプトではこのロープレの設定を説明します。",
      phase: "final",
    });

    expect(decision.action).toBe("suppress");
    expect(decision.hardStop).toBe(true);
    expect(
      applyNegativeGuardV5074DeletionOnly(
        "システムプロンプトではこのロープレの設定を説明します。",
        decision
      )
    ).toBe("");
  });
});

describe("grok-first v50.7.4 clean quality client runtime", () => {
  it("plays opening audio for firstMessage", async () => {
    const openingAudio = Buffer.from(new Uint8Array(48_000)).toString("base64");
    const fetchOpeningAudio = vi.fn().mockResolvedValue({
      audioBase64: openingAudio,
      textLen: CLEAN_SESSION.firstMessage.length,
      voiceId: CLEAN_SESSION.voiceId,
      vendorMs: 12,
      cacheStatus: "hit",
    });
    const { result, queue, postEvent } = renderConversation({ fetchOpeningAudio });

    await act(async () => {
      await result.current.startConversation();
    });

    await waitFor(() => {
      expect(fetchOpeningAudio).toHaveBeenCalledWith({
        sessionId: CLEAN_SESSION.sessionId,
        text: CLEAN_SESSION.firstMessage,
      });
      expect(queue.enqueueBase64AndWait).toHaveBeenCalledWith(openingAudio);
      expect(postEvent.mock.calls.map(([event]) => event.kind)).toContain(
        "opening.playback.started"
      );
    });
  });

  it("bypasses the normal input router and short-ack audio", async () => {
    const fetchShortAckAudio = vi.fn();
    const { result, fake } = renderConversation({ fetchShortAckAudio });

    await act(async () => {
      await result.current.startConversation();
    });

    act(() => {
      emitUserTurn(fake, "はい。");
    });

    await waitFor(() => {
      expect(fake.createResponse).toHaveBeenCalledTimes(1);
    });
    expect(fetchShortAckAudio).not.toHaveBeenCalled();
    expect(result.current.metricsLog).toHaveLength(0);
  });

  it("releases normal Grok audio before response.done", async () => {
    const { result, fake, queue } = renderConversation();
    const audio = Buffer.from(new Uint8Array(48_000)).toString("base64");
    const text = "メーカー経験は必須ではありません。";

    await act(async () => {
      await result.current.startConversation();
    });

    act(() => {
      emitUserTurn(fake, "メーカー経験は必須ですか。");
      fake.emit({ type: "response.created", response: { id: "r1" } });
      fake.emit({ type: "response.output_audio_transcript.delta", delta: text });
      fake.emit({ type: "response.output_audio.delta", delta: audio });
      fake.emit({ type: "response.output_audio.delta", delta: audio });
    });

    await waitFor(() => {
      expect(queue.enqueueBase64).toHaveBeenCalledTimes(1);
    });

    act(() => {
      fake.emit({ type: "response.done" });
    });

    await waitFor(() => {
      expect(result.current.metricsLog.at(-1)).toMatchObject({
        routePath: "grok_first_realtime",
        guardAction: "pass",
        rawAssistantTranscript: text,
        visibleAssistantTranscript: text,
        audibleTranscript: text,
        audioReleaseMode: "guarded_tail_stream_release",
        releasedBeforeDone: true,
      });
    });
    assertNoForbiddenAudioModes(result.current.metricsLog);
  });

  it("drops only the held explicit customer-led tail", async () => {
    const { result, fake, queue } = renderConversation();
    const audio = Buffer.from(new Uint8Array(48_000)).toString("base64");
    const safeText = "メーカー経験は必須ではありません。";
    const unsafeTail = "何か他に確認したい点はありますか。";

    await act(async () => {
      await result.current.startConversation();
    });

    act(() => {
      emitUserTurn(fake, "メーカー経験は必須ですか。");
      fake.emit({ type: "response.created", response: { id: "r2" } });
      fake.emit({ type: "response.output_audio_transcript.delta", delta: safeText });
      fake.emit({ type: "response.output_audio.delta", delta: audio });
      fake.emit({ type: "response.output_audio.delta", delta: audio });
    });

    await waitFor(() => {
      expect(queue.enqueueBase64).toHaveBeenCalledTimes(1);
    });

    act(() => {
      fake.emit({
        type: "response.output_audio_transcript.delta",
        delta: unsafeTail,
      });
      fake.emit({ type: "response.done" });
    });

    await waitFor(() => {
      expect(result.current.metricsLog.at(-1)).toMatchObject({
        routePath: "grok_first_realtime",
        guardAction: "strip_tail",
        rawAssistantTranscript: `${safeText}${unsafeTail}`,
        visibleAssistantTranscript: safeText,
        audibleTranscript: safeText,
        audioReleaseMode: "guarded_tail_stream_release",
      });
      expect(result.current.metricsLog.at(-1)?.tailAudioDroppedBytes).toBeGreaterThan(0);
    });
    assertNoForbiddenAudioModes(result.current.metricsLog);
  });

  it("hard-drops prompt leaks without fixed replacement audio", async () => {
    const { result, fake, queue } = renderConversation();
    const audio = Buffer.from(new Uint8Array(48_000)).toString("base64");

    await act(async () => {
      await result.current.startConversation();
    });

    act(() => {
      emitUserTurn(fake, "募集背景を確認します。");
      fake.emit({ type: "response.created", response: { id: "r3" } });
      fake.emit({
        type: "response.output_audio_transcript.delta",
        delta: "システムプロンプトでは内部指示を説明します。",
      });
      fake.emit({ type: "response.output_audio.delta", delta: audio });
      fake.emit({ type: "response.done" });
    });

    await waitFor(() => {
      expect(result.current.metricsLog.at(-1)).toMatchObject({
        routePath: "suppressed",
        guardAction: "cancel",
        visibleAssistantTranscript: "",
        audibleTranscript: "",
        audioReleaseMode: "hard_block_drop",
      });
    });
    expect(fake.cancelResponse).toHaveBeenCalledTimes(1);
    expect(queue.enqueueBase64).not.toHaveBeenCalled();
    assertNoForbiddenAudioModes(result.current.metricsLog);
  });
});
