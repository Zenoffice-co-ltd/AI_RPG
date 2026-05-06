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
  fetchGrokVoiceGreeting,
  fetchGrokVoiceLockedResponseTts,
  fetchGrokVoiceSession,
  postGrokVoiceEvent,
} from "./grok-voice-client";
import {
  GrokVoiceAudioQueue,
  type GrokVoiceAudioQueueOptions,
} from "./grok-voice-audio-queue";
import {
  getPr60LockedResponseForUser,
  normalizePr60AssistantText,
  shouldStopAtPr60LockedResponse,
} from "./grok-voice-pr60-output";
import { GrokVoiceMicRecorder } from "./grok-voice-mic-recorder";
import { GrokVoiceRealtime } from "./grok-voice-realtime";
import type {
  GrokVoiceMicState,
  GrokVoiceGreeting,
  GrokVoiceServerEvent,
  GrokVoiceSession,
  GrokVoiceTurnMetricsClient,
} from "./grok-voice-types";

const SAFE_ERROR =
  "セッションの開始に失敗しました。時間をおいて再試行してください。";
const RESPOND_ERROR = "応答生成に失敗しました。時間をおいて再試行してください。";
const AUDIO_ERROR =
  "音声の再生に失敗しました。ページを再読み込みして再試行してください。";
const LOCKED_REALTIME_DRAIN_MS = 5_000;

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
  fetchGreeting?: (input: {
    sessionId: string;
    text: string;
  }) => Promise<GrokVoiceGreeting>;
  fetchLockedResponseTts?: (input: {
    sessionId: string;
    userText: string;
  }) => Promise<import("./grok-voice-types").GrokVoiceLockedResponseTts>;
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
  const agentSpeakingRef = useRef(false);
  const bargeInCancelSentRef = useRef(false);
  const discardStaleResponseDeltasRef = useRef(false);
  const currentResponseItemIdRef = useRef<string | null>(null);
  const staleResponseItemIdsRef = useRef(new Set<string>());
  const greetingPlaybackDoneRef = useRef(true);
  const realtimeReadyRef = useRef(false);
  const pr60LockCancelSentRef = useRef(false);
  const responseActiveRef = useRef(false);
  const realtimeAudioQueuedThisTurnRef = useRef(false);
  const lockedTurnActiveRef = useRef(false);
  const lockedTurnIndexRef = useRef<number | null>(null);
  const lockedTurnUserTextRef = useRef("");
  const lockedTurnTtsPlayingRef = useRef(false);
  const pendingCancelOnResponseCreatedRef = useRef(false);
  const suppressNextRealtimeResponseRef = useRef(false);
  const lockedRealtimeDrainActiveRef = useRef(false);
  const lockedRealtimeDrainTurnIndexRef = useRef<number | null>(null);
  const lockedRealtimeDrainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // Per-turn streaming bookkeeping.
  const turnIndexRef = useRef(0);
  const interimAgentClientIdRef = useRef<string | null>(null);
  const turnStartAtRef = useRef<number | null>(null);
  const firstAudioAtRef = useRef<number | null>(null);
  const turnAccumulatedTextRef = useRef("");
  const turnAccumulatedAudioBytesRef = useRef(0);
  const turnInputModeRef = useRef<"voice" | "text">("voice");
  const turnUserTextLenRef = useRef(0);
  const turnUserTextPreviewRef = useRef("");

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const fetchSession = deps.fetchSession ?? fetchGrokVoiceSession;
  const fetchGreeting = deps.fetchGreeting ?? fetchGrokVoiceGreeting;
  const fetchLockedResponseTts =
    deps.fetchLockedResponseTts ?? fetchGrokVoiceLockedResponseTts;
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

  function isStaleResponseDelta(event: GrokVoiceServerEvent) {
    const itemId = getEventItemId(event);
    return (
      lockedTurnActiveRef.current ||
      lockedRealtimeDrainActiveRef.current ||
      discardStaleResponseDeltasRef.current ||
      (itemId.length > 0 && staleResponseItemIdsRef.current.has(itemId))
    );
  }

  function getEventItemId(event: GrokVoiceServerEvent) {
    return "item_id" in event && typeof event.item_id === "string"
      ? event.item_id
      : "";
  }

  const clearLockedRealtimeDrain = useCallback(() => {
    if (lockedRealtimeDrainTimerRef.current) {
      clearTimeout(lockedRealtimeDrainTimerRef.current);
      lockedRealtimeDrainTimerRef.current = null;
    }
    lockedRealtimeDrainActiveRef.current = false;
    lockedRealtimeDrainTurnIndexRef.current = null;
  }, []);

  const startLockedRealtimeDrain = useCallback(
    (turnIndex: number) => {
      clearLockedRealtimeDrain();
      lockedRealtimeDrainActiveRef.current = true;
      lockedRealtimeDrainTurnIndexRef.current = turnIndex;
      lockedRealtimeDrainTimerRef.current = setTimeout(() => {
        clearLockedRealtimeDrain();
      }, LOCKED_REALTIME_DRAIN_MS);
    },
    [clearLockedRealtimeDrain]
  );

  const resetTurnBookkeeping = useCallback(() => {
    turnInputModeRef.current = "voice";
    turnStartAtRef.current = null;
    firstAudioAtRef.current = null;
    turnAccumulatedTextRef.current = "";
    turnAccumulatedAudioBytesRef.current = 0;
    turnUserTextLenRef.current = 0;
    turnUserTextPreviewRef.current = "";
    interimAgentClientIdRef.current = null;
    agentSpeakingRef.current = false;
    bargeInCancelSentRef.current = false;
    discardStaleResponseDeltasRef.current = false;
    currentResponseItemIdRef.current = null;
    pr60LockCancelSentRef.current = false;
    responseActiveRef.current = false;
    realtimeAudioQueuedThisTurnRef.current = false;
    lockedTurnActiveRef.current = false;
    lockedTurnIndexRef.current = null;
    lockedTurnUserTextRef.current = "";
    lockedTurnTtsPlayingRef.current = false;
    pendingCancelOnResponseCreatedRef.current = false;
  }, []);

  const playLockedResponse = useCallback(
    async (input: {
      userText: string;
      assistantText: string;
      channel: "voice" | "chat";
    }) => {
      const activeSession = sessionRef.current;
      const realtime = realtimeRef.current;
      if (!activeSession || !realtime) return;

      const turnIndex = turnIndexRef.current;
      lockedTurnActiveRef.current = true;
      suppressNextRealtimeResponseRef.current = true;
      lockedTurnIndexRef.current = turnIndex;
      lockedTurnUserTextRef.current = input.userText;
      discardStaleResponseDeltasRef.current = true;
      if (currentResponseItemIdRef.current) {
        staleResponseItemIdsRef.current.add(currentResponseItemIdRef.current);
      }
      if (responseActiveRef.current) {
        realtime.cancelResponse();
      } else {
        pendingCancelOnResponseCreatedRef.current = true;
      }

      if (interimAgentClientIdRef.current) {
        dispatchMessages({
          type: "updateTextAndStatus",
          clientMessageId: interimAgentClientIdRef.current,
          text: input.assistantText,
          status: "final",
        });
      } else {
        dispatchMessages({
          type: "append",
          message: createTranscriptMessage({
            role: "agent",
            channel: "voice",
            text: input.assistantText,
            status: "final",
            source: "local",
            clientMessageId: `agent-locked-${activeSession.sessionId}-${turnIndex}`,
          }),
        });
      }

      const startedAt = turnStartAtRef.current ?? Date.now();
      turnStartAtRef.current = startedAt;
      micRecorderRef.current?.setEnabled(false);
      setStatus("speaking");
      agentSpeakingRef.current = true;

      try {
        const queue = ensureAudioQueue();
        await queue.resume().catch(() => undefined);
        if (realtimeAudioQueuedThisTurnRef.current) {
          await queue.flush();
          void postGrokVoiceEvent("audio.queue.flushed", {
            sessionId: activeSession.sessionId,
            details: { reason: "locked_response_preempt_realtime", turnIndex },
          });
        }

        void postGrokVoiceEvent("locked_response.tts.requested", {
          sessionId: activeSession.sessionId,
          details: {
            turnIndex,
            inputMode: input.channel === "chat" ? "text" : "voice",
            userTextLen: input.userText.length,
            agentTextLen: input.assistantText.length,
          },
        });
        const tts = await fetchLockedResponseTts({
          sessionId: activeSession.sessionId,
          userText: input.userText,
        });
        const audioBytes = Math.floor((tts.audioBase64.length * 3) / 4);
        void postGrokVoiceEvent("locked_response.tts.completed", {
          sessionId: activeSession.sessionId,
          details: {
            turnIndex,
            textLen: tts.textLen,
            audioBytes,
            voiceId: tts.voiceId,
            vendorMs: tts.vendorMs ?? null,
            cacheStatus: tts.cacheStatus,
          },
        });
        lockedTurnTtsPlayingRef.current = true;
        const firstAudioAt = Date.now();
        firstAudioAtRef.current = firstAudioAt;
        void postGrokVoiceEvent("locked_response.playback.started", {
          sessionId: activeSession.sessionId,
          details: { turnIndex, audioBytes },
        });
        await queue.enqueueBase64AndWait(tts.audioBase64);
        void postGrokVoiceEvent("locked_response.playback.completed", {
          sessionId: activeSession.sessionId,
          details: { turnIndex, audioBytes },
        });

        if (input.channel === "chat") {
          realtime.sendUserHistory(input.userText);
        }
        realtime.sendAssistantHistoryMessage(input.assistantText);

        const doneMs = Date.now() - startedAt;
        const metrics: GrokVoiceTurnMetricsClient = {
          sessionId: activeSession.sessionId,
          turnIndex,
          inputMode: input.channel === "chat" ? "text" : "voice",
          userTextLen: input.userText.length,
          agentTextLen: input.assistantText.length,
          firstAudioMs: firstAudioAt - startedAt,
          doneMs,
          audioBytes,
          error: null,
          promptHash: activeSession.promptHash,
          promptVersion: activeSession.promptVersion,
          guardrailVersion: activeSession.guardrailVersion,
          grokVoiceModel: activeSession.grokVoiceModel,
          grokVoiceVoiceId: activeSession.grokVoiceVoiceId,
          lockedResponse: true,
          lockedResponseSource: "client_tts",
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
            error: metrics.error,
            lockedResponse: true,
            lockedResponseSource: "client_tts",
            userTextPreview: input.userText,
            agentTextPreview: input.assistantText,
            promptHash: metrics.promptHash,
            promptVersion: metrics.promptVersion,
            guardrailVersion: metrics.guardrailVersion,
            grokVoiceModel: metrics.grokVoiceModel,
            grokVoiceVoiceId: metrics.grokVoiceVoiceId,
          },
        });
      } catch (error) {
        void postGrokVoiceEvent("locked_response.tts.failed", {
          sessionId: activeSession.sessionId,
          details: {
            turnIndex,
            message: (error as Error)?.message ?? String(error),
          },
        });
        void postGrokVoiceEvent("turn.error", {
          sessionId: activeSession.sessionId,
          details: {
            turnIndex,
            errorScope: "locked_response_tts",
            message: (error as Error)?.message ?? String(error),
          },
        });
      } finally {
        if (input.channel === "voice") {
          startLockedRealtimeDrain(turnIndex);
        }
        resetTurnBookkeeping();
        setStatus("listening");
        if (micEnabled && !isMutedRef.current) {
          micRecorderRef.current?.setEnabled(true);
        }
      }
    },
    [
      ensureAudioQueue,
      fetchLockedResponseTts,
      micEnabled,
      resetTurnBookkeeping,
      startLockedRealtimeDrain,
    ]
  );

  const handleServerEvent = useCallback(
    (event: GrokVoiceServerEvent) => {
      const activeSession = sessionRef.current;
      if (!activeSession) return;

      switch (event.type) {
        case "input_audio_buffer.speech_started": {
          if (agentSpeakingRef.current && !bargeInCancelSentRef.current) {
            void postGrokVoiceEvent("barge_in.detected", {
              sessionId: activeSession.sessionId,
              details: { turnIndex: turnIndexRef.current },
            });
            bargeInCancelSentRef.current = true;
            discardStaleResponseDeltasRef.current = true;
            if (currentResponseItemIdRef.current) {
              staleResponseItemIdsRef.current.add(currentResponseItemIdRef.current);
            }
            realtimeRef.current?.cancelResponse();
            void postGrokVoiceEvent("barge_in.cancel_sent", {
              sessionId: activeSession.sessionId,
              details: { turnIndex: turnIndexRef.current },
            });
            void audioQueueRef.current?.flush().finally(() => {
              void postGrokVoiceEvent("audio.queue.flushed", {
                sessionId: activeSession.sessionId,
                details: { reason: "barge_in" },
              });
            });
          }
          turnIndexRef.current += 1;
          turnInputModeRef.current = "voice";
          turnStartAtRef.current = Date.now();
          firstAudioAtRef.current = null;
          turnAccumulatedTextRef.current = "";
          turnAccumulatedAudioBytesRef.current = 0;
          turnUserTextLenRef.current = 0;
          turnUserTextPreviewRef.current = "";
          interimAgentClientIdRef.current = null;
          pr60LockCancelSentRef.current = false;
          responseActiveRef.current = false;
          realtimeAudioQueuedThisTurnRef.current = false;
          lockedTurnActiveRef.current = false;
          lockedTurnIndexRef.current = null;
          lockedTurnUserTextRef.current = "";
          lockedTurnTtsPlayingRef.current = false;
          pendingCancelOnResponseCreatedRef.current = false;
          suppressNextRealtimeResponseRef.current = false;
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
          turnUserTextPreviewRef.current = trimmed;
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
              sttTextPreview: trimmed,
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
          const lockedText = getPr60LockedResponseForUser(trimmed);
          if (lockedText) {
            void playLockedResponse({
              userText: trimmed,
              assistantText: lockedText,
              channel: "voice",
            });
          }
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
          responseActiveRef.current = true;
          if (
            lockedTurnActiveRef.current ||
            lockedRealtimeDrainActiveRef.current ||
            pendingCancelOnResponseCreatedRef.current ||
            suppressNextRealtimeResponseRef.current
          ) {
            pendingCancelOnResponseCreatedRef.current = false;
            suppressNextRealtimeResponseRef.current = false;
            discardStaleResponseDeltasRef.current = true;
            realtimeRef.current?.cancelResponse();
            void postGrokVoiceEvent("response.pr60_locked_cancelled", {
              sessionId: activeSession.sessionId,
              details: {
                turnIndex:
                  lockedTurnIndexRef.current ??
                  lockedRealtimeDrainTurnIndexRef.current ??
                  turnIndexRef.current,
                reason: "locked_response_preempt_realtime",
                hadDeterministicTts: true,
                audioBytesBeforeCancel: turnAccumulatedAudioBytesRef.current,
              },
            });
            break;
          }
          discardStaleResponseDeltasRef.current = false;
          currentResponseItemIdRef.current = null;
          agentSpeakingRef.current = false;
          bargeInCancelSentRef.current = false;
          if (turnStartAtRef.current === null) {
            // text input path — speech_started never fired for this turn.
            turnIndexRef.current += 1;
            turnStartAtRef.current = Date.now();
            firstAudioAtRef.current = null;
            turnAccumulatedTextRef.current = "";
            turnAccumulatedAudioBytesRef.current = 0;
            turnUserTextPreviewRef.current = "";
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
          if (isStaleResponseDelta(event)) {
            void postGrokVoiceEvent("barge_in.stale_delta_discarded", {
              sessionId: activeSession.sessionId,
              details: { type: event.type, itemId: getEventItemId(event) },
            });
            break;
          }
          const delta = event.delta ?? "";
          if (delta.length === 0) break;
          turnAccumulatedTextRef.current += delta;
          const lockedResponseMatched = shouldStopAtPr60LockedResponse(
            turnUserTextPreviewRef.current,
            turnAccumulatedTextRef.current
          );
          if (!pr60LockCancelSentRef.current && lockedResponseMatched) {
            pr60LockCancelSentRef.current = true;
            turnAccumulatedTextRef.current = normalizePr60AssistantText(
              turnUserTextPreviewRef.current,
              turnAccumulatedTextRef.current
            );
            discardStaleResponseDeltasRef.current = true;
            if (currentResponseItemIdRef.current) {
              staleResponseItemIdsRef.current.add(currentResponseItemIdRef.current);
            }
            realtimeRef.current?.cancelResponse();
            void postGrokVoiceEvent("response.pr60_locked_cancelled", {
              sessionId: activeSession.sessionId,
              details: {
                turnIndex: turnIndexRef.current,
                reason: "delta_locked_response_fallback",
                hadDeterministicTts: lockedTurnActiveRef.current,
                audioBytesBeforeCancel: turnAccumulatedAudioBytesRef.current,
              },
            });
          }
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
          if (isStaleResponseDelta(event)) {
            void postGrokVoiceEvent("barge_in.stale_delta_discarded", {
              sessionId: activeSession.sessionId,
              details: { type: event.type, itemId: getEventItemId(event) },
            });
            break;
          }
          const base64 = event.delta ?? "";
          if (base64.length === 0) break;
          if (event.item_id) currentResponseItemIdRef.current = event.item_id;
          if (firstAudioAtRef.current === null) {
            firstAudioAtRef.current = Date.now();
          }
          // base64 length ≈ bytes * 4/3; rough but fine for telemetry.
          turnAccumulatedAudioBytesRef.current += Math.floor((base64.length * 3) / 4);
          realtimeAudioQueuedThisTurnRef.current = true;
          agentSpeakingRef.current = true;
          setStatus("speaking");
          ensureAudioQueue().enqueueBase64(base64);
          break;
        }
        case "response.done": {
          responseActiveRef.current = false;
          if (lockedTurnActiveRef.current || lockedRealtimeDrainActiveRef.current) {
            clearLockedRealtimeDrain();
            break;
          }
          const id = interimAgentClientIdRef.current;
          const finalText = normalizePr60AssistantText(
            turnUserTextPreviewRef.current,
            turnAccumulatedTextRef.current
          );
          if (id) {
            dispatchMessages({
              type: "updateTextAndStatus",
              clientMessageId: id,
              text: finalText,
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
            agentTextLen: finalText.length,
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
              userTextPreview: turnUserTextPreviewRef.current,
              agentTextPreview: finalText,
              promptHash: metrics.promptHash,
              promptVersion: metrics.promptVersion,
              guardrailVersion: metrics.guardrailVersion,
              grokVoiceModel: metrics.grokVoiceModel,
              grokVoiceVoiceId: metrics.grokVoiceVoiceId,
            },
          });
          resetTurnBookkeeping();
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
    [clearLockedRealtimeDrain, ensureAudioQueue, playLockedResponse, resetTurnBookkeeping]
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

  const maybeStartMicAfterGreeting = useCallback(() => {
    if (!realtimeReadyRef.current) return;
    if (!greetingPlaybackDoneRef.current) return;
    if (!sessionRef.current) return;
    setStatus("listening");
    if (micEnabled) {
      void startMicRecorder().catch(() => {
        // mic permission denied / not available — text input still works
      });
    }
  }, [micEnabled, startMicRecorder]);

  const startConversation = useCallback(async () => {
    if (!isInteractive) return;
    if (sessionRef.current) {
      setStatus("listening");
      return;
    }
    conversationGenRef.current += 1;
    const generation = conversationGenRef.current;
    realtimeReadyRef.current = false;
    greetingPlaybackDoneRef.current = false;
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

      void (async () => {
        try {
          setStatus("speaking");
          let greetingAudio: GrokVoiceGreeting;
          let source: "session_cache" | "greet_route";
          if (next.greetingAudio) {
            source = "session_cache";
            greetingAudio = next.greetingAudio;
            void postGrokVoiceEvent("greeting.cache.hit", {
              sessionId: next.sessionId,
              details: {
                cacheKeyHash: next.greetingAudio.cacheKeyHash,
                audioBytes: Math.floor(
                  (next.greetingAudio.audioBase64.length * 3) / 4
                ),
              },
            });
          } else {
            source = "greet_route";
            void postGrokVoiceEvent("greeting.cache.miss", {
              sessionId: next.sessionId,
              details: { textLen: next.firstMessage.length },
            });
            void postGrokVoiceEvent("greeting.tts.requested", {
              sessionId: next.sessionId,
              details: { textLen: next.firstMessage.length },
            });
            greetingAudio = await fetchGreeting({
              sessionId: next.sessionId,
              text: next.firstMessage,
            });
          }
          if (generation !== conversationGenRef.current) return;
          void postGrokVoiceEvent("greeting.tts.completed", {
            sessionId: next.sessionId,
            details: {
              textLen: greetingAudio.textLen,
              audioBytes: Math.floor((greetingAudio.audioBase64.length * 3) / 4),
              voiceId: greetingAudio.voiceId,
              vendorMs: greetingAudio.vendorMs ?? null,
              cacheStatus: greetingAudio.cacheStatus ?? "miss",
              source,
            },
          });
          try {
            void postGrokVoiceEvent("greeting.playback.started", {
              sessionId: next.sessionId,
              details: {
                audioBytes: Math.floor((greetingAudio.audioBase64.length * 3) / 4),
              },
            });
            await queue.enqueueBase64AndWait(greetingAudio.audioBase64);
            if (generation !== conversationGenRef.current) return;
            void postGrokVoiceEvent("greeting.playback.completed", {
              sessionId: next.sessionId,
            });
          } catch (error) {
            if (generation !== conversationGenRef.current) return;
            void postGrokVoiceEvent("greeting.playback.failed", {
              sessionId: next.sessionId,
              details: {
                message: (error as Error)?.message ?? String(error),
              },
            });
          }
        } catch (error) {
          if (generation !== conversationGenRef.current) return;
          console.warn("grokVoice greeting tts failed", error);
          void postGrokVoiceEvent("greeting.tts.failed", {
            sessionId: next.sessionId,
            details: {
              textLen: next.firstMessage.length,
              message: (error as Error)?.message ?? String(error),
            },
          });
        } finally {
          if (generation !== conversationGenRef.current) return;
          greetingPlaybackDoneRef.current = true;
          maybeStartMicAfterGreeting();
        }
      })();

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
        onReady: () => {
          realtimeReadyRef.current = true;
          maybeStartMicAfterGreeting();
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
        onTelemetry: ({ kind, details }) => {
          void postGrokVoiceEvent(kind as Parameters<typeof postGrokVoiceEvent>[0], {
            sessionId: next.sessionId,
            ...(details ? { details } : {}),
          });
        },
      };
      const realtime = createRealtime
        ? createRealtime(realtimeOptions)
        : new GrokVoiceRealtime(realtimeOptions);
      realtimeRef.current = realtime;
      realtime.open();
    } catch (error) {
      console.warn("grokVoice session start failed", error);
      setErrorMessage(SAFE_ERROR);
      setStatus("error");
    }
  }, [
    createRealtime,
    ensureAudioQueue,
    fetchSession,
    fetchGreeting,
    handleServerEvent,
    isInteractive,
    maybeStartMicAfterGreeting,
  ]);

  const endConversation = useCallback(async () => {
    realtimeRef.current?.close();
    realtimeRef.current = null;
    sessionRef.current = null;
    realtimeReadyRef.current = false;
    greetingPlaybackDoneRef.current = true;
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
    turnUserTextPreviewRef.current = "";
    pr60LockCancelSentRef.current = false;
    responseActiveRef.current = false;
    realtimeAudioQueuedThisTurnRef.current = false;
    lockedTurnActiveRef.current = false;
    lockedTurnIndexRef.current = null;
    lockedTurnUserTextRef.current = "";
    lockedTurnTtsPlayingRef.current = false;
    pendingCancelOnResponseCreatedRef.current = false;
    suppressNextRealtimeResponseRef.current = false;
    clearLockedRealtimeDrain();
    void postGrokVoiceEvent("session.cancelled");
  }, [clearLockedRealtimeDrain, stopMicRecorder]);

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
      if (!activeSession || !realtimeRef.current?.isReady()) {
        return;
      }
      if (!greetingPlaybackDoneRef.current) {
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
      turnUserTextPreviewRef.current = trimmed;
      turnIndexRef.current += 1;
      turnStartAtRef.current = Date.now();
      firstAudioAtRef.current = null;
      turnAccumulatedTextRef.current = "";
      turnAccumulatedAudioBytesRef.current = 0;
      realtimeAudioQueuedThisTurnRef.current = false;
      suppressNextRealtimeResponseRef.current = false;

      try {
        const queue = ensureAudioQueue();
        await queue.resume();
      } catch {
        // ignore
      }
      // Pause the mic while Grok is generating to avoid feedback.
      micRecorderRef.current?.setEnabled(false);
      const lockedText = getPr60LockedResponseForUser(trimmed);
      if (lockedText) {
        void playLockedResponse({
          userText: trimmed,
          assistantText: lockedText,
          channel: "chat",
        });
        return;
      }
      realtimeRef.current.sendUserText(trimmed);
      setStatus("thinking");
    },
    [ensureAudioQueue, isInteractive, playLockedResponse, startConversation]
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
