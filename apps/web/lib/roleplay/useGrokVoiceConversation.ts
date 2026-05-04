"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  type RoleplayMode,
  type RoleplayStatus,
  type TranscriptMessage,
  type UseRoleplayConversationReturn,
} from "./conversation-types";
import {
  createTranscriptMessage,
  transcriptReducer,
} from "./transcript-reducer";
import {
  fetchGrokVoiceSession,
  postGrokVoiceEvent,
} from "./grok-voice-client";
import {
  GrokVoiceAudioQueue,
  type GrokVoiceAudioQueueOptions,
} from "./grok-voice-audio-queue";
import { GrokVoiceMicRecorder } from "./grok-voice-mic-recorder";
import { GrokVoiceRealtime } from "./grok-voice-realtime";
import type {
  GrokVoiceMicState,
  GrokVoiceServerEvent,
  GrokVoiceSession,
  GrokVoiceTurnMetricsClient,
} from "./grok-voice-types";

const SAFE_ERROR =
  "セッションの開始に失敗しました。時間をおいて再試行してください。";
const RESPOND_ERROR = "応答生成に失敗しました。時間をおいて再試行してください。";
const AUDIO_ERROR =
  "音声の再生に失敗しました。ページを再読み込みして再試行してください。";

export type GrokVoiceConversation = UseRoleplayConversationReturn & {
  mode: RoleplayMode;
  history: never[];
  limitWarning: boolean;
  selectedInput: string;
  setSelectedInput: (deviceId: string) => void;
  volume: number;
  metricsLog: GrokVoiceTurnMetricsClient[];
  session: GrokVoiceSession | null;
};

export type UseGrokVoiceConversationDeps = {
  fetchSession?: () => Promise<GrokVoiceSession>;
  audioQueueOptions?: GrokVoiceAudioQueueOptions;
  createAudioQueue?: (options: GrokVoiceAudioQueueOptions) => GrokVoiceAudioQueue;
  createRealtime?: (
    opts: ConstructorParameters<typeof GrokVoiceRealtime>[0]
  ) => GrokVoiceRealtime;
  createMicRecorder?: (
    onChunk: (base64: string) => void,
    callbacks: {
      onError: (error: Error) => void;
      onStateChange: (state: GrokVoiceMicState) => void;
    }
  ) => GrokVoiceMicRecorder;
  micEnabled?: boolean;
};

export function useGrokVoiceConversation(
  mode: RoleplayMode,
  deps: UseGrokVoiceConversationDeps = {}
): GrokVoiceConversation {
  const isInteractive = mode === "live";

  const [status, setStatus] = useState<RoleplayStatus>(() =>
    isInteractive ? "idle" : "ended"
  );
  const [messages, dispatchMessages] = useReducer(transcriptReducer, []);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [session, setSession] = useState<GrokVoiceSession | null>(null);
  const [metricsLog, setMetricsLog] = useState<GrokVoiceTurnMetricsClient[]>([]);
  const [volume, setVolume] = useState(0.82);
  const [selectedInput, setSelectedInput] = useState("");

  const audioQueueRef = useRef<GrokVoiceAudioQueue | null>(null);
  const sessionRef = useRef<GrokVoiceSession | null>(null);
  const realtimeRef = useRef<GrokVoiceRealtime | null>(null);
  const micRecorderRef = useRef<GrokVoiceMicRecorder | null>(null);
  const micStateRef = useRef<GrokVoiceMicState>("idle");
  const micStateChangedAtRef = useRef<number>(Date.now());
  const isMutedRef = useRef(false);
  const conversationGenRef = useRef(0);

  // Per-turn streaming bookkeeping.
  const turnIndexRef = useRef(0);
  const interimAgentClientIdRef = useRef<string | null>(null);
  const turnStartAtRef = useRef<number | null>(null);
  const firstAudioAtRef = useRef<number | null>(null);
  const turnAccumulatedTextRef = useRef("");
  const turnAccumulatedAudioBytesRef = useRef(0);
  const turnInputModeRef = useRef<"voice" | "text">("voice");
  const turnUserTextLenRef = useRef(0);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const fetchSession = deps.fetchSession ?? fetchGrokVoiceSession;
  const audioQueueOptions = deps.audioQueueOptions;
  const createAudioQueue = deps.createAudioQueue;
  const createRealtime = deps.createRealtime;
  const createMicRecorder = deps.createMicRecorder;
  const micEnabled = deps.micEnabled ?? false;

  const ensureAudioQueue = useCallback((): GrokVoiceAudioQueue => {
    if (!audioQueueRef.current) {
      const baseOptions: GrokVoiceAudioQueueOptions = {
        sampleRate: sessionRef.current?.audio.sampleRate ?? 24_000,
        ...(audioQueueOptions ?? {}),
        onPlaybackError: (error) => {
          audioQueueOptions?.onPlaybackError?.(error);
          void postGrokVoiceEvent("audio.queue.error", {
            ...(sessionRef.current?.sessionId
              ? { sessionId: sessionRef.current.sessionId }
              : {}),
            details: { message: (error as Error)?.message ?? String(error) },
          });
          setErrorMessage(AUDIO_ERROR);
        },
      };
      audioQueueRef.current = createAudioQueue
        ? createAudioQueue(baseOptions)
        : new GrokVoiceAudioQueue(baseOptions);
      audioQueueRef.current.setVolume(volume);
    }
    return audioQueueRef.current;
  }, [audioQueueOptions, createAudioQueue, volume]);

  const emitMicStateChange = useCallback((next: GrokVoiceMicState) => {
    const prev = micStateRef.current;
    if (prev === next) return;
    const now = Date.now();
    const durationMs = now - micStateChangedAtRef.current;
    micStateRef.current = next;
    micStateChangedAtRef.current = now;
    void postGrokVoiceEvent("mic.state.changed", {
      ...(sessionRef.current?.sessionId
        ? { sessionId: sessionRef.current.sessionId }
        : {}),
      details: { from: prev, to: next, durationMs },
    });
  }, []);

  const handleServerEvent = useCallback(
    (event: GrokVoiceServerEvent) => {
      const activeSession = sessionRef.current;
      if (!activeSession) return;

      switch (event.type) {
        case "input_audio_buffer.speech_started": {
          turnIndexRef.current += 1;
          turnInputModeRef.current = "voice";
          turnStartAtRef.current = Date.now();
          firstAudioAtRef.current = null;
          turnAccumulatedTextRef.current = "";
          turnAccumulatedAudioBytesRef.current = 0;
          turnUserTextLenRef.current = 0;
          interimAgentClientIdRef.current = null;
          setStatus("listening");
          break;
        }
        case "input_audio_buffer.speech_stopped": {
          setStatus("thinking");
          break;
        }
        case "conversation.item.input_audio_transcription.completed": {
          const text = event.transcript ?? "";
          const trimmed = text.trim();
          turnUserTextLenRef.current = trimmed.length;
          if (trimmed.length === 0) {
            void postGrokVoiceEvent("stt.skipped", {
              sessionId: activeSession.sessionId,
              details: {
                turnIndex: turnIndexRef.current,
                reason: "empty",
              },
            });
            break;
          }
          void postGrokVoiceEvent("stt.completed", {
            sessionId: activeSession.sessionId,
            details: {
              turnIndex: turnIndexRef.current,
              textLen: trimmed.length,
              confidence: null,
            },
          });
          dispatchMessages({
            type: "append",
            message: createTranscriptMessage({
              role: "user",
              channel: "voice",
              text: trimmed,
              status: "final",
              source: "sdk",
              sdkMessageId: `user-stt-${activeSession.sessionId}-${turnIndexRef.current}`,
            }),
          });
          break;
        }
        case "conversation.item.input_audio_transcription.failed": {
          void postGrokVoiceEvent("stt.failed", {
            sessionId: activeSession.sessionId,
            details: {
              turnIndex: turnIndexRef.current,
              message: event.error?.message ?? "stt failed",
            },
          });
          break;
        }
        case "response.created": {
          if (turnStartAtRef.current === null) {
            // text input path — speech_started never fired for this turn.
            turnIndexRef.current += 1;
            turnStartAtRef.current = Date.now();
            firstAudioAtRef.current = null;
            turnAccumulatedTextRef.current = "";
            turnAccumulatedAudioBytesRef.current = 0;
          }
          interimAgentClientIdRef.current = `agent-rt-${activeSession.sessionId}-${turnIndexRef.current}`;
          dispatchMessages({
            type: "append",
            message: createTranscriptMessage({
              role: "agent",
              channel: "voice",
              text: "",
              status: "interim",
              source: "local",
              clientMessageId: interimAgentClientIdRef.current,
            }),
          });
          setStatus("thinking");
          break;
        }
        case "response.text.delta":
        case "response.audio_transcript.delta":
        case "response.output_audio_transcript.delta": {
          const delta = event.delta ?? "";
          if (delta.length === 0) break;
          turnAccumulatedTextRef.current += delta;
          const id = interimAgentClientIdRef.current;
          if (id) {
            dispatchMessages({
              type: "updateTextAndStatus",
              clientMessageId: id,
              text: turnAccumulatedTextRef.current,
              status: "interim",
            });
          }
          break;
        }
        case "response.output_audio.delta": {
          const base64 = event.delta ?? "";
          if (base64.length === 0) break;
          if (firstAudioAtRef.current === null) {
            firstAudioAtRef.current = Date.now();
          }
          // base64 length ≈ bytes * 4/3; rough but fine for telemetry.
          turnAccumulatedAudioBytesRef.current += Math.floor((base64.length * 3) / 4);
          setStatus("speaking");
          ensureAudioQueue().enqueueBase64(base64);
          break;
        }
        case "response.done": {
          const id = interimAgentClientIdRef.current;
          if (id) {
            dispatchMessages({
              type: "updateTextAndStatus",
              clientMessageId: id,
              text: turnAccumulatedTextRef.current,
              status: "final",
            });
          }
          const startedAt = turnStartAtRef.current;
          const firstAudioMs =
            startedAt !== null && firstAudioAtRef.current !== null
              ? firstAudioAtRef.current - startedAt
              : null;
          const doneMs = startedAt !== null ? Date.now() - startedAt : null;
          const metrics: GrokVoiceTurnMetricsClient = {
            sessionId: activeSession.sessionId,
            turnIndex: turnIndexRef.current,
            inputMode: turnInputModeRef.current,
            userTextLen: turnUserTextLenRef.current,
            agentTextLen: turnAccumulatedTextRef.current.length,
            firstAudioMs,
            doneMs,
            audioBytes: turnAccumulatedAudioBytesRef.current,
            error: turnAccumulatedAudioBytesRef.current === 0 ? "no_audio" : null,
            promptHash: activeSession.promptHash,
            promptVersion: activeSession.promptVersion,
            guardrailVersion: activeSession.guardrailVersion,
            grokVoiceModel: activeSession.grokVoiceModel,
            grokVoiceVoiceId: activeSession.grokVoiceVoiceId,
          };
          setMetricsLog((current) => [...current, metrics]);
          void postGrokVoiceEvent("turn.completed", {
            sessionId: activeSession.sessionId,
            details: {
              turnIndex: metrics.turnIndex,
              inputMode: metrics.inputMode,
              userTextLen: metrics.userTextLen,
              agentTextLen: metrics.agentTextLen,
              firstAudioMs: metrics.firstAudioMs,
              doneMs: metrics.doneMs,
              audioBytes: metrics.audioBytes,
              promptHash: metrics.promptHash,
              promptVersion: metrics.promptVersion,
              guardrailVersion: metrics.guardrailVersion,
              grokVoiceModel: metrics.grokVoiceModel,
              grokVoiceVoiceId: metrics.grokVoiceVoiceId,
            },
          });
          // Reset turn bookkeeping.
          turnInputModeRef.current = "voice";
          turnStartAtRef.current = null;
          firstAudioAtRef.current = null;
          turnAccumulatedTextRef.current = "";
          turnAccumulatedAudioBytesRef.current = 0;
          turnUserTextLenRef.current = 0;
          interimAgentClientIdRef.current = null;
          setStatus("listening");
          break;
        }
        case "error": {
          const message = event.error?.message ?? "Grok Voice error";
          setErrorMessage(RESPOND_ERROR);
          void postGrokVoiceEvent("turn.error", {
            sessionId: activeSession.sessionId,
            details: {
              turnIndex: turnIndexRef.current,
              errorScope: "ws",
              message,
            },
          });
          break;
        }
        default:
          break;
      }
    },
    [ensureAudioQueue]
  );

  const startMicRecorder = useCallback(async () => {
    if (!micEnabled) return;
    if (micRecorderRef.current) return;
    const recorder =
      createMicRecorder?.(
        (chunk) => realtimeRef.current?.appendAudio(chunk),
        {
          onError: (error) => {
            console.warn("grokVoice mic recorder error", error);
            void postGrokVoiceEvent("mic.permission.denied", {
              ...(sessionRef.current?.sessionId
                ? { sessionId: sessionRef.current.sessionId }
                : {}),
              details: { message: error.message },
            });
          },
          onStateChange: (next) => emitMicStateChange(next),
        }
      ) ??
      new GrokVoiceMicRecorder({
        targetSampleRate: sessionRef.current?.audio.sampleRate ?? 24_000,
        onChunk: (chunk) => realtimeRef.current?.appendAudio(chunk),
        onError: (error) => {
          console.warn("grokVoice mic recorder error", error);
          void postGrokVoiceEvent("mic.permission.denied", {
            ...(sessionRef.current?.sessionId
              ? { sessionId: sessionRef.current.sessionId }
              : {}),
            details: { message: error.message },
          });
        },
        onStateChange: (next) => emitMicStateChange(next),
      });
    micRecorderRef.current = recorder;
    try {
      await recorder.start();
      recorder.setEnabled(!isMutedRef.current);
      void postGrokVoiceEvent("mic.permission.granted", {
        ...(sessionRef.current?.sessionId
          ? { sessionId: sessionRef.current.sessionId }
          : {}),
      });
    } catch (error) {
      console.warn("grokVoice mic start failed", error);
      micRecorderRef.current = null;
      void postGrokVoiceEvent("mic.permission.denied", {
        ...(sessionRef.current?.sessionId
          ? { sessionId: sessionRef.current.sessionId }
          : {}),
        details: { message: (error as Error)?.message ?? String(error) },
      });
      throw error;
    }
  }, [createMicRecorder, emitMicStateChange, micEnabled]);

  const stopMicRecorder = useCallback(async () => {
    const recorder = micRecorderRef.current;
    if (!recorder) return;
    micRecorderRef.current = null;
    micStateRef.current = "idle";
    try {
      await recorder.stop();
    } catch {
      // ignore
    }
  }, []);

  const startConversation = useCallback(async () => {
    if (!isInteractive) return;
    if (sessionRef.current) {
      setStatus("listening");
      return;
    }
    conversationGenRef.current += 1;
    setStatus("connecting");
    setErrorMessage(null);
    try {
      const next = await fetchSession();
      sessionRef.current = next;
      setSession(next);

      const greeting = createTranscriptMessage({
        role: "agent",
        channel: "voice",
        text: next.firstMessage,
        status: "final",
        source: "sdk",
        sdkMessageId: `agent-greeting-${next.sessionId}`,
      });
      dispatchMessages({ type: "reset", messages: [greeting] });

      const queue = ensureAudioQueue();
      try {
        await queue.resume();
      } catch {
        // user gesture might be required; will retry on first audio
      }

      // Open the realtime WebSocket.
      const realtimeOptions: ConstructorParameters<typeof GrokVoiceRealtime>[0] = {
        url: next.wsUrl,
        ephemeralToken: next.ephemeralToken,
        onMessage: handleServerEvent,
        onOpen: () => {
          void postGrokVoiceEvent("ws.connected", {
            sessionId: next.sessionId,
          });
          // Send session.update to be safe; the ephemeral token endpoint may
          // already pre-configure the session, but `session.update` is
          // idempotent and ensures voice / instructions / turn detection
          // take effect even if upstream behaviour changes.
          realtimeRef.current?.sendSessionUpdate({
            voice: next.grokVoiceVoiceId,
            instructions: next.instructions,
            audio: next.audio,
            turn_detection: next.turnDetection,
          });
          // Inject the firstMessage as a prior assistant turn so Grok
          // continues the conversation in character.
          realtimeRef.current?.sendAssistantHistory(next.firstMessage);
        },
        onClose: ({ code, reason }) => {
          void postGrokVoiceEvent("ws.disconnected", {
            sessionId: next.sessionId,
            details: { code, reason: reason || "" },
          });
        },
        onError: ({ message }) => {
          void postGrokVoiceEvent("ws.error", {
            sessionId: next.sessionId,
            details: { message },
          });
          setErrorMessage(RESPOND_ERROR);
          setStatus("error");
        },
      };
      const realtime = createRealtime
        ? createRealtime(realtimeOptions)
        : new GrokVoiceRealtime(realtimeOptions);
      realtimeRef.current = realtime;
      realtime.open();

      setStatus("listening");
      if (micEnabled) {
        try {
          await startMicRecorder();
        } catch {
          // mic permission denied / not available — text input still works
        }
      }
    } catch (error) {
      console.warn("grokVoice session start failed", error);
      setErrorMessage(SAFE_ERROR);
      setStatus("error");
    }
  }, [
    createRealtime,
    ensureAudioQueue,
    fetchSession,
    handleServerEvent,
    isInteractive,
    micEnabled,
    startMicRecorder,
  ]);

  const endConversation = useCallback(async () => {
    realtimeRef.current?.close();
    realtimeRef.current = null;
    sessionRef.current = null;
    setSession(null);
    await stopMicRecorder();
    if (audioQueueRef.current) {
      await audioQueueRef.current.stop();
      audioQueueRef.current = null;
    }
    setStatus("ended");
    setErrorMessage(null);
    interimAgentClientIdRef.current = null;
    turnIndexRef.current = 0;
    turnStartAtRef.current = null;
    firstAudioAtRef.current = null;
    turnAccumulatedTextRef.current = "";
    turnAccumulatedAudioBytesRef.current = 0;
    void postGrokVoiceEvent("session.cancelled");
  }, [stopMicRecorder]);

  const startNewConversation = useCallback(async () => {
    await endConversation();
    dispatchMessages({ type: "reset", messages: [] });
    setMetricsLog([]);
    if (isInteractive) {
      await startConversation();
    }
  }, [endConversation, isInteractive, startConversation]);

  const sendTextMessage = useCallback(
    async (text: string, retryClientMessageId?: string) => {
      if (!isInteractive) return;
      const trimmed = text.trim();
      if (trimmed.length === 0) return;

      let activeSession = sessionRef.current;
      if (!activeSession) {
        await startConversation();
        activeSession = sessionRef.current;
      }
      if (!activeSession || !realtimeRef.current?.isOpen()) {
        setErrorMessage(SAFE_ERROR);
        return;
      }

      const clientMessageId =
        retryClientMessageId ??
        `user-local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const userMessage = createTranscriptMessage({
        role: "user",
        channel: "chat",
        text: trimmed,
        status: "sent",
        source: "local",
        clientMessageId,
      });
      dispatchMessages({ type: "append", message: userMessage });

      // Mark this turn as text-input so metrics & response.created handler
      // know not to expect speech_started.
      turnInputModeRef.current = "text";
      turnUserTextLenRef.current = trimmed.length;
      turnIndexRef.current += 1;
      turnStartAtRef.current = Date.now();
      firstAudioAtRef.current = null;
      turnAccumulatedTextRef.current = "";
      turnAccumulatedAudioBytesRef.current = 0;

      try {
        const queue = ensureAudioQueue();
        await queue.resume();
      } catch {
        // ignore
      }
      // Pause the mic while Grok is generating to avoid feedback.
      micRecorderRef.current?.setEnabled(false);
      realtimeRef.current.sendUserText(trimmed);
      setStatus("thinking");
    },
    [ensureAudioQueue, isInteractive, startConversation]
  );

  const toggleMute = useCallback(async () => {
    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      micRecorderRef.current?.setEnabled(!next);
      audioQueueRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const setOutputVolume = useCallback(async (next: number) => {
    setVolume(next);
    audioQueueRef.current?.setVolume(next);
  }, []);

  const changeInputDevice = useCallback(async (deviceId: string) => {
    setSelectedInput(deviceId);
  }, []);

  const getInputVolume = useCallback(
    () => micRecorderRef.current?.getInputVolume() ?? 0,
    []
  );
  const getOutputVolume = useCallback(
    () => audioQueueRef.current?.getOutputVolume() ?? 0,
    []
  );

  useEffect(() => {
    return () => {
      realtimeRef.current?.close();
      void audioQueueRef.current?.stop();
      void micRecorderRef.current?.stop();
    };
  }, []);

  return useMemo<GrokVoiceConversation>(
    () => ({
      status,
      messages,
      isConnected: status !== "idle" && status !== "ended" && status !== "error",
      isConnecting: status === "connecting",
      isMuted,
      isAgentSpeaking: status === "speaking",
      isAwaitingAgentResponse: status === "thinking",
      errorMessage,
      startConversation,
      endConversation,
      startNewConversation,
      sendTextMessage,
      toggleMute,
      setOutputVolume,
      changeInputDevice,
      getInputVolume,
      getOutputVolume,
      mode,
      history: [],
      limitWarning: false,
      selectedInput,
      setSelectedInput,
      volume,
      metricsLog,
      session,
    }),
    [
      changeInputDevice,
      endConversation,
      errorMessage,
      getInputVolume,
      getOutputVolume,
      isMuted,
      messages,
      metricsLog,
      mode,
      selectedInput,
      sendTextMessage,
      session,
      setOutputVolume,
      startConversation,
      startNewConversation,
      status,
      toggleMute,
      volume,
    ]
  );
}
