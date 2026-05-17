"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  createTranscriptMessage,
  transcriptReducer,
} from "@/lib/roleplay/transcript-reducer";
import type {
  RoleplayMode,
  RoleplayStatus,
} from "@/lib/roleplay/conversation-types";
import {
  GrokVoiceAudioQueue,
  type GrokVoiceAudioQueueOptions,
} from "@/lib/roleplay/grok-voice-audio-queue";
import { GrokVoiceMicRecorder } from "@/lib/roleplay/grok-voice-mic-recorder";
import {
  TailOnlyAudioGuard,
} from "./audio-tail-guard";
import { fetchGrokFirstV50Session, postGrokFirstV50Event } from "./client";
import {
  getV507FixedGuardAudioBase64,
  getV507FixedGuardAudioBytes,
} from "./guard/fixed-guard-audio";
import {
  classifyInputGuard,
  type InputGuardDecision,
} from "./guard/input-guard";
import {
  classifyNormalInputRoute,
  type NormalInputRouteDecision,
} from "./guard/normal-input-router";
import {
  applyNegativeGuardDeletionOnly,
  evaluateNegativeGuard,
} from "./negative-guard";
import { GrokFirstRealtime } from "./realtime";
import type {
  GrokFirstV50Conversation,
  GrokFirstV50Metric,
  GrokFirstV50ServerEvent,
  GrokFirstV50Session,
} from "./types";

const SAFE_ERROR =
  "セッションの開始に失敗しました。時間をおいて再試行してください。";
const AUDIO_ERROR =
  "音声の再生に失敗しました。ページを再読み込みして再試行してください。";

type FixedInputGuardDecision = InputGuardDecision & {
  action: "fixed_exit" | "fixed_external";
  fixedText: string;
};

export type UseGrokFirstRoleplayDeps = {
  fetchSession?: () => Promise<GrokFirstV50Session>;
  postEvent?: (
    input: Parameters<typeof postGrokFirstV50Event>[0]
  ) => Promise<void>;
  createRealtime?: (
    opts: ConstructorParameters<typeof GrokFirstRealtime>[0]
  ) => GrokFirstRealtime;
  createAudioQueue?: (options: GrokVoiceAudioQueueOptions) => GrokVoiceAudioQueue;
  createMicRecorder?: (
    onChunk: (base64: string) => void,
    callbacks: {
      onError: (error: Error) => void;
      onStateChange: (state: "idle" | "listening" | "speaking" | "paused") => void;
    }
  ) => GrokVoiceMicRecorder;
  micEnabled?: boolean;
};

export function useGrokFirstRoleplayConversation(
  mode: RoleplayMode,
  deps: UseGrokFirstRoleplayDeps = {}
): GrokFirstV50Conversation {
  const isInteractive = mode === "live" || mode === "fakeLive";
  const [status, setStatus] = useState<RoleplayStatus>(() =>
    isInteractive ? "idle" : "ended"
  );
  const [messages, dispatchMessages] = useReducer(transcriptReducer, []);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [selectedInput, setSelectedInput] = useState("");
  const [volume, setVolume] = useState(0.82);
  const [session, setSession] = useState<GrokFirstV50Session | null>(null);
  const [metricsLog, setMetricsLog] = useState<GrokFirstV50Metric[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const sessionRef = useRef<GrokFirstV50Session | null>(null);
  const realtimeRef = useRef<GrokFirstRealtime | null>(null);
  const micRef = useRef<GrokVoiceMicRecorder | null>(null);
  const audioQueueRef = useRef<GrokVoiceAudioQueue | null>(null);
  const tailGuardRef = useRef(new TailOnlyAudioGuard());
  const mutedRef = useRef(false);
  const agentSpeakingRef = useRef(false);
  const reconnectCountRef = useRef(0);
  const postEvent = useCallback(
    (input: Parameters<typeof postGrokFirstV50Event>[0]) =>
      (deps.postEvent ?? postGrokFirstV50Event)(input),
    [deps]
  );

  const turnIndexRef = useRef(0);
  const turnStartAtRef = useRef<number | null>(null);
  const firstAudioDeltaAtRef = useRef<number | null>(null);
  const firstAudibleAudioAtRef = useRef<number | null>(null);
  const sttCompletedAtRef = useRef<number | null>(null);
  const guardDetectedAtRef = useRef<number | null>(null);
  const fixedPlaybackStartedAtRef = useRef<number | null>(null);
  const fixedPlaybackCompletedAtRef = useRef<number | null>(null);
  const accumulatedTextRef = useRef("");
  const accumulatedAudioBytesRef = useRef(0);
  const bufferedAudioChunksRef = useRef<{ base64: string; bytes: number }[]>(
    []
  );
  const bufferedAudioDroppedBytesRef = useRef(0);
  const bufferedAudioObservedRef = useRef(false);
  const currentUserTextRef = useRef("");
  const inputModeRef = useRef<"voice" | "text">("voice");
  const interimAgentClientIdRef = useRef<string | null>(null);
  const interimAgentMessageAppendedRef = useRef(false);
  const greetingSessionIdRef = useRef<string | null>(null);
  const hardSuppressedRef = useRef(false);
  const fixedGuardActiveRef = useRef(false);
  const fixedGuardDrainUntilRef = useRef(0);
  const ignoreNextEmptyResponseDoneRef = useRef(false);
  const userSpeechInProgressRef = useRef(false);

  const isFixedGuardDraining = useCallback(
    () => Date.now() < fixedGuardDrainUntilRef.current,
    []
  );

  const ensureAudioQueue = useCallback(() => {
    if (!audioQueueRef.current) {
      audioQueueRef.current =
        deps.createAudioQueue?.({
          sampleRate: 24_000,
          onPlaybackError: () => setErrorMessage(AUDIO_ERROR),
        }) ??
        new GrokVoiceAudioQueue({
          sampleRate: 24_000,
          onPlaybackError: () => setErrorMessage(AUDIO_ERROR),
        });
      audioQueueRef.current.setVolume(volume);
    }
    return audioQueueRef.current;
  }, [deps, volume]);

  const resetTurn = useCallback(() => {
    tailGuardRef.current = new TailOnlyAudioGuard();
    turnStartAtRef.current = null;
    firstAudioDeltaAtRef.current = null;
    firstAudibleAudioAtRef.current = null;
    sttCompletedAtRef.current = null;
    guardDetectedAtRef.current = null;
    fixedPlaybackStartedAtRef.current = null;
    fixedPlaybackCompletedAtRef.current = null;
    accumulatedTextRef.current = "";
    accumulatedAudioBytesRef.current = 0;
    bufferedAudioChunksRef.current = [];
    bufferedAudioDroppedBytesRef.current = 0;
    bufferedAudioObservedRef.current = false;
    currentUserTextRef.current = "";
    interimAgentClientIdRef.current = null;
    interimAgentMessageAppendedRef.current = false;
    hardSuppressedRef.current = false;
    fixedGuardActiveRef.current = false;
    ignoreNextEmptyResponseDoneRef.current = false;
    userSpeechInProgressRef.current = false;
    agentSpeakingRef.current = false;
  }, []);

  const emitMetric = useCallback(
    (input: {
      routePath: GrokFirstV50Metric["routePath"];
      guardAction?: GrokFirstV50Metric["guardAction"];
      guardReasons?: string[];
      agentTextOverride?: string;
      error?: string | null;
      fullTurnBuffered?: boolean;
    }) => {
      const activeSession = sessionRef.current;
      if (!activeSession) return;
      const startedAt = turnStartAtRef.current;
      const finalDecision = evaluateNegativeGuard({
        text: accumulatedTextRef.current,
        userText: currentUserTextRef.current,
        phase: "final",
      });
      const finalText =
        input.agentTextOverride ??
        applyNegativeGuardDeletionOnly(
          accumulatedTextRef.current,
          finalDecision
        );
      const firstAudioDeltaMs =
        startedAt !== null && firstAudioDeltaAtRef.current !== null
          ? firstAudioDeltaAtRef.current - startedAt
          : null;
      const firstAudibleAudioMs =
        startedAt !== null && firstAudibleAudioAtRef.current !== null
          ? firstAudibleAudioAtRef.current - startedAt
          : null;
      const sttCompletedToGuardDetectedMs =
        sttCompletedAtRef.current !== null &&
        guardDetectedAtRef.current !== null
          ? guardDetectedAtRef.current - sttCompletedAtRef.current
          : null;
      const guardDetectedToPlaybackStartedMs =
        guardDetectedAtRef.current !== null &&
        fixedPlaybackStartedAtRef.current !== null
          ? fixedPlaybackStartedAtRef.current - guardDetectedAtRef.current
          : null;
      const fixedPlaybackDurationMs =
        fixedPlaybackStartedAtRef.current !== null &&
        fixedPlaybackCompletedAtRef.current !== null
          ? fixedPlaybackCompletedAtRef.current -
            fixedPlaybackStartedAtRef.current
          : null;
      const isFixedGuard = input.routePath === "fixed_guard";
      const metric: GrokFirstV50Metric = {
        sessionId: activeSession.sessionId,
        turnIndex: turnIndexRef.current,
        inputMode: inputModeRef.current,
        routePath: input.routePath,
        userTextLen: currentUserTextRef.current.length,
        agentTextLen: finalText.length,
        firstAudioDeltaMs,
        firstAudibleAudioMs,
        doneMs: startedAt !== null ? Date.now() - startedAt : null,
        audioBytes: accumulatedAudioBytesRef.current,
        audioSource: isFixedGuard
          ? "static_guard_pcm_base64"
          : "xai_realtime_stream",
        sttCompletedToGuardDetectedMs,
        guardDetectedToPlaybackStartedMs,
        fixedPlaybackDurationMs,
        fixedAudioBytes: isFixedGuard ? accumulatedAudioBytesRef.current : null,
        tailGuardHoldMs: tailGuardRef.current.getMaxObservedHoldMs(),
        tailAudioDroppedBytes:
          tailGuardRef.current.getDroppedBytes() +
          bufferedAudioDroppedBytesRef.current,
        toolCallCount: 0,
        runtimeTtsCount: 0,
        fullTurnBufferCount: input.fullTurnBuffered ? 1 : 0,
        regenerationRate: 0,
        businessRegisteredSpeechHitCount: 0,
        businessPr60LockHitCount: 0,
        fixedFallbackBusinessHitCount: 0,
        registeredSpeechPayloadIncluded: false,
        lockedResponseAudioBundleIncluded: false,
        websocketReconnectCount: reconnectCountRef.current,
        vadPrematureCutoffSuspected: false,
        forbiddenSuffixDetected:
          finalDecision.reasons.includes("forbidden_suffix"),
        audibleForbiddenSuffixCount: 0,
        closingQuestionLeakCount: 0,
        customerCoachUtteranceDetected:
          finalDecision.reasons.includes("customer_coaching"),
        customerLedSalesFlowDetected:
          finalDecision.reasons.includes("customer_led_sales_flow"),
        cultureFitPrematureRevealDetected:
          finalDecision.reasons.includes("premature_sensitive_reveal") &&
          /指揮命令者|合う人|合わない|自己流|抱え込/u.test(finalText),
        jobLevelPrematureRevealDetected:
          finalDecision.reasons.includes("premature_sensitive_reveal") &&
          /半年後|二.?三か月|入社直後/u.test(finalText),
        guardAction: input.guardAction ?? finalDecision.action,
        guardReasons: input.guardReasons ?? finalDecision.reasons,
        promptHash: activeSession.promptHash,
        promptVersion: activeSession.promptVersion,
        guardrailVersion: activeSession.guardrailVersion,
        model: activeSession.model,
        voiceId: activeSession.voiceId,
        error: input.error ?? null,
      };
      setMetricsLog((current) => [...current, metric]);
      void postEvent({
        kind: "turn.completed",
        sessionId: activeSession.sessionId,
        details: {
          ...metric,
          userTextPreview: currentUserTextRef.current.slice(0, 200),
          agentTextPreview: finalText.slice(0, 200),
        },
      });
    },
    [postEvent]
  );

  const releaseChunks = useCallback((chunks: { base64: string; bytes: number }[]) => {
    for (const chunk of chunks) {
      if (firstAudibleAudioAtRef.current === null) {
        firstAudibleAudioAtRef.current = Date.now();
      }
      ensureAudioQueue().enqueueBase64(chunk.base64);
    }
  }, [ensureAudioQueue]);

  const clearBufferedAudio = useCallback(() => {
    const droppedBytes = bufferedAudioChunksRef.current.reduce(
      (sum, chunk) => sum + chunk.bytes,
      0
    );
    bufferedAudioDroppedBytesRef.current += droppedBytes;
    bufferedAudioChunksRef.current = [];
    return droppedBytes;
  }, []);

  const appendUserTranscript = useCallback(
    (input: { text: string; channel: "voice" | "chat"; status: "final" | "sent" }) => {
      dispatchMessages({
        type: "append",
        message: createTranscriptMessage({
          role: "user",
          channel: input.channel,
          text: input.text,
          status: input.status,
          source: input.channel === "voice" ? "sdk" : "local",
          sdkMessageId:
            input.channel === "voice"
              ? `gfv50-user-${turnIndexRef.current}`
              : undefined,
          clientMessageId:
            input.channel === "chat"
              ? `gfv50-user-text-${turnIndexRef.current}`
              : undefined,
        }),
      });
    },
    []
  );

  const appendFixedAssistantTranscript = useCallback((text: string) => {
    interimAgentClientIdRef.current = null;
    interimAgentMessageAppendedRef.current = false;
    dispatchMessages({
      type: "append",
      message: createTranscriptMessage({
        role: "agent",
        channel: "voice",
        text,
        status: "final",
        source: "local",
        clientMessageId: `gfv50-fixed-agent-${turnIndexRef.current}`,
      }),
    });
  }, []);

  const appendInitialAssistantTranscript = useCallback(
    (nextSession: GrokFirstV50Session) => {
      if (greetingSessionIdRef.current === nextSession.sessionId) return;
      const text = (nextSession.firstMessage ?? "").trim();
      if (!text) return;
      greetingSessionIdRef.current = nextSession.sessionId;
      dispatchMessages({
        type: "append",
        message: createTranscriptMessage({
          role: "agent",
          channel: "voice",
          text,
          status: "final",
          source: "local",
          clientMessageId: `gfv50-greeting-${nextSession.sessionId}`,
        }),
      });
    },
    []
  );

  const ensureInterimAgentTranscript = useCallback(
    (
      activeSession: GrokFirstV50Session,
      text: string,
      status: "interim" | "final"
    ) => {
      if (!interimAgentClientIdRef.current) {
        interimAgentClientIdRef.current = `gfv50-agent-${activeSession.sessionId}-${turnIndexRef.current}`;
      }
      const clientMessageId = interimAgentClientIdRef.current;
      if (!interimAgentMessageAppendedRef.current) {
        if (!text.trim()) return;
        interimAgentMessageAppendedRef.current = true;
        dispatchMessages({
          type: "append",
          message: createTranscriptMessage({
            role: "agent",
            channel: "voice",
            text,
            status,
            source: "local",
            clientMessageId,
          }),
        });
        return;
      }
      dispatchMessages({
        type: "updateTextAndStatus",
        clientMessageId,
        text,
        status,
      });
    },
    []
  );

  const handleFixedGuardDecision = useCallback(
    async (input: {
      text: string;
      guard: FixedInputGuardDecision;
      channel: "voice" | "chat";
    }) => {
      const activeSession = sessionRef.current;
      if (!activeSession || !input.guard.fixedText) return;

      guardDetectedAtRef.current = Date.now();
      fixedGuardActiveRef.current = true;
      hardSuppressedRef.current = true;
      micRef.current?.setEnabled(false);
      realtimeRef.current?.cancelResponse();
      const dropped = tailGuardRef.current.clear();
      const bufferedDroppedBytes = clearBufferedAudio();
      audioQueueRef.current?.clearAllScheduledAudioForLock();

      appendUserTranscript({
        text: input.text,
        channel: input.channel,
        status: input.channel === "voice" ? "final" : "sent",
      });
      appendFixedAssistantTranscript(input.guard.fixedText);

      void postEvent({
        kind: "guard.detected",
        sessionId: activeSession.sessionId,
        details: {
          turnIndex: turnIndexRef.current,
          action: input.guard.action,
          reasons: input.guard.reasons,
          matchedPattern: input.guard.matchedPattern,
          tailAudioDroppedBytes: dropped.droppedBytes + bufferedDroppedBytes,
        },
      });

      const fixedAudioBase64 = getV507FixedGuardAudioBase64(input.guard.action);
      const fixedAudioBytes = getV507FixedGuardAudioBytes(input.guard.action);
      let playbackError: string | null = null;
      const playbackStartedAt = Date.now();
      fixedPlaybackStartedAtRef.current = playbackStartedAt;

      try {
        const queue = ensureAudioQueue();
        setStatus("speaking");
        if (firstAudioDeltaAtRef.current === null) {
          firstAudioDeltaAtRef.current = playbackStartedAt;
        }
        if (firstAudibleAudioAtRef.current === null) {
          firstAudibleAudioAtRef.current = playbackStartedAt;
        }
        accumulatedAudioBytesRef.current += fixedAudioBytes;
        void postEvent({
          kind: "fixed_guard.playback.started",
          sessionId: activeSession.sessionId,
          details: {
            turnIndex: turnIndexRef.current,
            action: input.guard.action,
            audioBytes: fixedAudioBytes,
            textLen: input.guard.fixedText.length,
          },
        });
        await queue.enqueueBase64AndWait(fixedAudioBase64);
      } catch (error) {
        playbackError = error instanceof Error ? error.message : String(error);
        setErrorMessage(AUDIO_ERROR);
      } finally {
        fixedPlaybackCompletedAtRef.current = Date.now();
        void postEvent({
          kind: "fixed_guard.playback.completed",
          sessionId: activeSession.sessionId,
          details: {
            turnIndex: turnIndexRef.current,
            action: input.guard.action,
            audioBytes: fixedAudioBytes,
            durationMs: fixedPlaybackCompletedAtRef.current - playbackStartedAt,
            error: playbackError,
          },
        });
        emitMetric({
          routePath: "fixed_guard",
          guardAction: input.guard.action,
          guardReasons: input.guard.reasons,
          agentTextOverride: input.guard.fixedText,
          error: playbackError,
        });

        if (input.guard.shouldEndSession) {
          realtimeRef.current?.close();
          realtimeRef.current = null;
          await micRef.current?.stop().catch(() => undefined);
          micRef.current = null;
          setIsConnected(false);
          setStatus("ended");
          fixedGuardActiveRef.current = false;
          hardSuppressedRef.current = false;
        } else {
          fixedGuardDrainUntilRef.current = Date.now() + 1_500;
          resetTurn();
          micRef.current?.setEnabled(!mutedRef.current);
          setStatus(mutedRef.current ? "muted" : "listening");
        }
      }
    },
    [
      appendFixedAssistantTranscript,
      appendUserTranscript,
      clearBufferedAudio,
      emitMetric,
      ensureAudioQueue,
      postEvent,
      resetTurn,
    ]
  );

  const handleNormalInputRouteDecision = useCallback(
    (input: {
      text: string;
      decision: NormalInputRouteDecision;
      channel: "voice" | "chat";
    }) => {
      const activeSession = sessionRef.current;
      if (!activeSession || input.decision.action === "pass") return;

      guardDetectedAtRef.current = Date.now();
      hardSuppressedRef.current = true;
      realtimeRef.current?.cancelResponse();
      const dropped = tailGuardRef.current.clear();
      const bufferedDroppedBytes = clearBufferedAudio();
      audioQueueRef.current?.clearAllScheduledAudioForLock();

      appendUserTranscript({
        text: input.text,
        channel: input.channel,
        status: input.channel === "voice" ? "final" : "sent",
      });
      if (input.decision.shouldSpeak && input.decision.fixedText) {
        appendFixedAssistantTranscript(input.decision.fixedText);
      }

      void postEvent({
        kind: "guard.detected",
        sessionId: activeSession.sessionId,
        details: {
          turnIndex: turnIndexRef.current,
          action: input.decision.action,
          reasons: input.decision.reasons,
          shouldSendToRealtime: input.decision.shouldSendToRealtime,
          shouldSpeak: input.decision.shouldSpeak,
          tailAudioDroppedBytes: dropped.droppedBytes + bufferedDroppedBytes,
        },
      });

      emitMetric({
        routePath: "noise_ignored",
        guardAction: "suppress",
        guardReasons: input.decision.reasons,
        agentTextOverride: input.decision.fixedText ?? "",
        error: null,
      });
      resetTurn();
      micRef.current?.setEnabled(!mutedRef.current);
      setStatus(mutedRef.current ? "muted" : "listening");
    },
    [
      appendFixedAssistantTranscript,
      appendUserTranscript,
      clearBufferedAudio,
      emitMetric,
      postEvent,
      resetTurn,
    ]
  );

  const handleServerEvent = useCallback(
    (event: GrokFirstV50ServerEvent) => {
      const activeSession = sessionRef.current;
      if (!activeSession) return;

      if (isFixedGuardDraining() && isAssistantResponseEvent(event.type)) {
        void postEvent({
          kind: "guard.drain.ignored",
          sessionId: activeSession.sessionId,
          details: {
            turnIndex: turnIndexRef.current,
            eventType: event.type,
            drain: "assistant_response_only",
          },
        });
        return;
      }

      switch (event.type) {
        case "input_audio_buffer.speech_started": {
          if (fixedGuardActiveRef.current) break;
          turnIndexRef.current += 1;
          resetTurn();
          userSpeechInProgressRef.current = true;
          turnStartAtRef.current = Date.now();
          inputModeRef.current = "voice";
          setStatus("listening");
          break;
        }
        case "input_audio_buffer.speech_stopped": {
          if (fixedGuardActiveRef.current) break;
          setStatus("thinking");
          break;
        }
        case "conversation.item.input_audio_transcription.completed": {
          if (fixedGuardActiveRef.current) break;
          const text = (event.transcript ?? "").trim();
          sttCompletedAtRef.current = Date.now();
          currentUserTextRef.current = text;
          if (!text) {
            userSpeechInProgressRef.current = false;
            void postEvent({
              kind: "stt.skipped",
              sessionId: activeSession.sessionId,
              details: { turnIndex: turnIndexRef.current, reason: "empty" },
            });
            break;
          }
          const guard = classifyInputGuard(text);
          if (isFixedInputGuardDecision(guard)) {
            userSpeechInProgressRef.current = false;
            void handleFixedGuardDecision({
              text,
              guard,
              channel: "voice",
            });
            void postEvent({
              kind: "stt.completed",
              sessionId: activeSession.sessionId,
              details: {
                turnIndex: turnIndexRef.current,
                textLen: text.length,
                guardAction: guard.action,
              },
            });
            break;
          }
          const normalRoute = classifyNormalInputRoute(text);
          if (normalRoute.action !== "pass") {
            userSpeechInProgressRef.current = false;
            handleNormalInputRouteDecision({
              text,
              decision: normalRoute,
              channel: "voice",
            });
            void postEvent({
              kind: "stt.completed",
              sessionId: activeSession.sessionId,
              details: {
                turnIndex: turnIndexRef.current,
                textLen: text.length,
                guardAction: normalRoute.action,
                guardReasons: normalRoute.reasons,
              },
            });
            break;
          }
          if (normalRoute.rewrittenText) {
            userSpeechInProgressRef.current = false;
            realtimeRef.current?.cancelResponse();
            ignoreNextEmptyResponseDoneRef.current = true;
            const dropped = tailGuardRef.current.clear();
            const bufferedDroppedBytes = clearBufferedAudio();
            audioQueueRef.current?.clearAllScheduledAudioForLock();
            appendUserTranscript({ text, channel: "voice", status: "final" });
            micRef.current?.setEnabled(false);
            setStatus("thinking");
            void postEvent({
              kind: "guard.detected",
              sessionId: activeSession.sessionId,
              details: {
                turnIndex: turnIndexRef.current,
                action: "normal_realtime_rewrite",
                reasons: normalRoute.reasons,
                originalTextLen: text.length,
                rewrittenTextLen: normalRoute.rewrittenText.length,
                tailAudioDroppedBytes: dropped.droppedBytes + bufferedDroppedBytes,
              },
            });
            realtimeRef.current?.sendUserText(normalRoute.rewrittenText);
            void postEvent({
              kind: "stt.completed",
              sessionId: activeSession.sessionId,
              details: {
                turnIndex: turnIndexRef.current,
                textLen: text.length,
                guardAction: "normal_realtime_rewrite",
                guardReasons: normalRoute.reasons,
              },
            });
            break;
          }
          appendUserTranscript({ text, channel: "voice", status: "final" });
          userSpeechInProgressRef.current = false;
          micRef.current?.setEnabled(false);
          realtimeRef.current?.createResponse();
          void postEvent({
            kind: "stt.completed",
            sessionId: activeSession.sessionId,
            details: { turnIndex: turnIndexRef.current, textLen: text.length },
          });
          break;
        }
        case "response.created": {
          if (fixedGuardActiveRef.current) break;
          if (userSpeechInProgressRef.current) break;
          if (turnStartAtRef.current === null) {
            turnIndexRef.current += 1;
            turnStartAtRef.current = Date.now();
          }
          interimAgentClientIdRef.current = `gfv50-agent-${activeSession.sessionId}-${turnIndexRef.current}`;
          interimAgentMessageAppendedRef.current = false;
          setStatus("thinking");
          break;
        }
        case "response.text.delta":
        case "response.audio_transcript.delta":
        case "response.output_audio_transcript.delta": {
          if (fixedGuardActiveRef.current) break;
          if (userSpeechInProgressRef.current) break;
          const delta = event.delta ?? "";
          if (!delta) break;
          accumulatedTextRef.current += delta;
          const streamDecision = evaluateNegativeGuard({
            text: accumulatedTextRef.current,
            userText: currentUserTextRef.current,
            phase: "stream",
          });
          if (streamDecision.action === "cancel" || streamDecision.action === "suppress") {
            hardSuppressedRef.current = true;
            realtimeRef.current?.cancelResponse();
            const dropped = tailGuardRef.current.clear();
            const bufferedDroppedBytes = clearBufferedAudio();
            audioQueueRef.current?.clearAllScheduledAudioForLock();
            void postEvent({
              kind: "guard.detected",
              sessionId: activeSession.sessionId,
              details: {
                turnIndex: turnIndexRef.current,
                action: streamDecision.action,
                reasons: streamDecision.reasons,
                tailAudioDroppedBytes:
                  dropped.droppedBytes + bufferedDroppedBytes,
              },
            });
          }
          const visible = applyNegativeGuardDeletionOnly(
            accumulatedTextRef.current,
            streamDecision
          );
          ensureInterimAgentTranscript(activeSession, visible, "interim");
          break;
        }
        case "response.output_audio.delta": {
          if (fixedGuardActiveRef.current) break;
          if (userSpeechInProgressRef.current) break;
          if (hardSuppressedRef.current) break;
          const base64 = event.delta ?? "";
          if (!base64) break;
          const now = Date.now();
          if (firstAudioDeltaAtRef.current === null) {
            firstAudioDeltaAtRef.current = now;
          }
          const bytes = Math.floor((base64.length * 3) / 4);
          accumulatedAudioBytesRef.current += bytes;
          bufferedAudioObservedRef.current = true;
          bufferedAudioChunksRef.current.push({ base64, bytes });
          break;
        }
        case "response.done": {
          if (fixedGuardActiveRef.current) break;
          if (userSpeechInProgressRef.current) break;
          if (
            ignoreNextEmptyResponseDoneRef.current &&
            !accumulatedTextRef.current.trim() &&
            accumulatedAudioBytesRef.current === 0
          ) {
            ignoreNextEmptyResponseDoneRef.current = false;
            void postEvent({
              kind: "guard.rewrite_empty_done_ignored",
              sessionId: activeSession.sessionId,
              details: { turnIndex: turnIndexRef.current },
            });
            break;
          }
          const wasHardSuppressed = hardSuppressedRef.current;
          const decision = evaluateNegativeGuard({
            text: accumulatedTextRef.current,
            userText: currentUserTextRef.current,
            phase: "final",
          });
          const release = tailGuardRef.current.finalize(decision);
          const shouldDropBufferedAudio =
            wasHardSuppressed ||
            decision.action === "cancel" ||
            decision.action === "suppress" ||
            decision.action === "drop_sentence" ||
            decision.action === "strip_tail";
          const hadBufferedAudio = bufferedAudioObservedRef.current;
          let bufferedDroppedBytes = 0;
          if (shouldDropBufferedAudio) {
            bufferedDroppedBytes = clearBufferedAudio();
          }
          if (release.droppedBytes > 0 || bufferedDroppedBytes > 0) {
            void postEvent({
              kind: "tail_guard.dropped",
              sessionId: activeSession.sessionId,
              details: {
                turnIndex: turnIndexRef.current,
                action: decision.action,
                reasons: decision.reasons,
                droppedBytes: release.droppedBytes + bufferedDroppedBytes,
              },
            });
          }
          const bufferedChunks = bufferedAudioChunksRef.current;
          bufferedAudioChunksRef.current = [];
          if (!shouldDropBufferedAudio) {
            setStatus("speaking");
            releaseChunks([...release.chunks, ...bufferedChunks]);
          }
          const finalText = applyNegativeGuardDeletionOnly(
            accumulatedTextRef.current,
            decision
          );
          ensureInterimAgentTranscript(activeSession, finalText, "final");
          emitMetric({
            routePath:
              wasHardSuppressed || decision.action === "suppress"
                ? "suppressed"
                : "grok_first_realtime",
            guardAction: wasHardSuppressed ? "cancel" : decision.action,
            guardReasons: decision.reasons,
            ...(wasHardSuppressed ? { agentTextOverride: finalText } : {}),
            fullTurnBuffered: hadBufferedAudio,
          });
          resetTurn();
          micRef.current?.setEnabled(!mutedRef.current);
          setStatus(mutedRef.current ? "muted" : "listening");
          break;
        }
        case "conversation.item.input_audio_transcription.failed": {
          if (fixedGuardActiveRef.current) break;
          micRef.current?.setEnabled(!mutedRef.current);
          void postEvent({
            kind: "stt.failed",
            sessionId: activeSession.sessionId,
            details: { turnIndex: turnIndexRef.current },
          });
          break;
        }
      }
    },
    [
      appendUserTranscript,
      clearBufferedAudio,
      emitMetric,
      ensureInterimAgentTranscript,
      handleFixedGuardDecision,
      handleNormalInputRouteDecision,
      isFixedGuardDraining,
      postEvent,
      releaseChunks,
      resetTurn,
    ]
  );

  const startConversation = useCallback(async () => {
    if (!isInteractive) {
      setStatus("connected");
      return;
    }
    setStatus("connecting");
    setErrorMessage(null);
    try {
      const nextSession = await (deps.fetchSession ?? fetchGrokFirstV50Session)();
      sessionRef.current = nextSession;
      setSession(nextSession);
      ensureAudioQueue();
      const realtimeOptions: ConstructorParameters<typeof GrokFirstRealtime>[0] = {
          url: nextSession.wsUrl,
          auth: nextSession.realtimeAuth,
          onMessage: handleServerEvent,
          onOpen: () => {
            setIsConnected(true);
            void postEvent({
              kind: "ws.connected",
              sessionId: nextSession.sessionId,
            });
            if (nextSession.backend === "grok-first-vFinal") {
              realtimeRef.current?.markReadyAfterRelaySetup();
            } else if (nextSession.firstMessage) {
              realtimeRef.current?.sendSessionUpdate(nextSession);
              realtimeRef.current?.sendAssistantHistory(nextSession.firstMessage);
            }
          },
          onReady: () => {
            appendInitialAssistantTranscript(nextSession);
            setStatus("listening");
            void postEvent({
              kind: "session.ready",
              sessionId: nextSession.sessionId,
            });
          },
          onClose: (event) => {
            setIsConnected(false);
            void postEvent({
              kind: "ws.disconnected",
              sessionId: nextSession.sessionId,
              details: event,
            });
            if (!realtimeRef.current?.wasClosedByUs()) {
              reconnectCountRef.current += 1;
            }
          },
          onError: (error) => {
            setErrorMessage(SAFE_ERROR);
            void postEvent({
              kind: "ws.error",
              sessionId: nextSession.sessionId,
              details: error,
            });
          },
        };
      const realtime =
        deps.createRealtime?.(realtimeOptions) ??
        new GrokFirstRealtime(realtimeOptions);
      realtimeRef.current = realtime;
      realtime.open();

      if (deps.micEnabled !== false && mode === "live") {
        const mic =
          deps.createMicRecorder?.(
            (chunk) => {
              if (!fixedGuardActiveRef.current) {
                realtimeRef.current?.appendAudio(chunk);
              }
            },
            {
              onError: (error) => setErrorMessage(error.message),
              onStateChange: (state) => {
                void postEvent({
                  kind: "mic.state.changed",
                  sessionId: nextSession.sessionId,
                  details: { state },
                });
              },
            }
          ) ??
          new GrokVoiceMicRecorder({
            onChunk: (chunk) => {
              if (!fixedGuardActiveRef.current) {
                realtimeRef.current?.appendAudio(chunk);
              }
            },
            onError: (error) => setErrorMessage(error.message),
            onStateChange: (state) => {
              void postEvent({
                kind: "mic.state.changed",
                sessionId: nextSession.sessionId,
                details: { state },
              });
            },
          });
        micRef.current = mic;
        await mic.start();
        mic.setEnabled(!mutedRef.current);
      }
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : SAFE_ERROR);
    }
  }, [
    deps,
    appendInitialAssistantTranscript,
    ensureAudioQueue,
    handleServerEvent,
    isInteractive,
    mode,
    postEvent,
  ]);

  const endConversation = useCallback(async () => {
    setStatus("ending");
    realtimeRef.current?.close();
    realtimeRef.current = null;
    await micRef.current?.stop().catch(() => undefined);
    micRef.current = null;
    await audioQueueRef.current?.stop().catch(() => undefined);
    audioQueueRef.current = null;
    setIsConnected(false);
    setStatus("ended");
  }, []);

  const startNewConversation = useCallback(async () => {
    await endConversation();
    dispatchMessages({ type: "reset" });
    setMetricsLog([]);
    resetTurn();
    await startConversation();
  }, [endConversation, resetTurn, startConversation]);

  const sendTextMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!sessionRef.current || !realtimeRef.current?.isReady()) {
        await startConversation();
      }
      const activeSession = sessionRef.current;
      if (!activeSession || !realtimeRef.current) return;
      turnIndexRef.current += 1;
      resetTurn();
      turnStartAtRef.current = Date.now();
      currentUserTextRef.current = trimmed;
      inputModeRef.current = "text";
      const guard = classifyInputGuard(trimmed);
      if (isFixedInputGuardDecision(guard)) {
        void handleFixedGuardDecision({
          text: trimmed,
          guard,
          channel: "chat",
        });
        return;
      }
      const normalRoute = classifyNormalInputRoute(trimmed);
      if (normalRoute.action !== "pass") {
        handleNormalInputRouteDecision({
          text: trimmed,
          decision: normalRoute,
          channel: "chat",
        });
        return;
      }
      if (normalRoute.rewrittenText) {
        void postEvent({
          kind: "guard.detected",
          sessionId: activeSession.sessionId,
          details: {
            turnIndex: turnIndexRef.current,
            action: "normal_realtime_rewrite",
            reasons: normalRoute.reasons,
            originalTextLen: trimmed.length,
            rewrittenTextLen: normalRoute.rewrittenText.length,
            tailAudioDroppedBytes: 0,
          },
        });
      }
      appendUserTranscript({ text: trimmed, channel: "chat", status: "sent" });
      setStatus("thinking");
      realtimeRef.current.sendUserText(normalRoute.rewrittenText ?? trimmed);
    },
    [
      appendUserTranscript,
      handleFixedGuardDecision,
      handleNormalInputRouteDecision,
      postEvent,
      resetTurn,
      startConversation,
    ]
  );

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setIsMuted(next);
    micRef.current?.setEnabled(!next);
    setStatus(next ? "muted" : "listening");
    return Promise.resolve();
  }, []);

  const setOutputVolume = useCallback((nextVolume: number) => {
    const bounded = Math.max(0, Math.min(1, nextVolume));
    setVolume(bounded);
    audioQueueRef.current?.setVolume(bounded);
    return Promise.resolve();
  }, []);

  const changeInputDevice = useCallback((deviceId: string) => {
    setSelectedInput(deviceId);
    return Promise.resolve();
  }, []);

  useEffect(() => {
    return () => {
      realtimeRef.current?.close();
      void micRef.current?.stop();
      void audioQueueRef.current?.stop();
    };
  }, []);

  return {
    mode,
    status,
    messages,
    isConnected,
    isConnecting: status === "connecting",
    isMuted,
    isAgentSpeaking: agentSpeakingRef.current,
    isAwaitingAgentResponse: status === "thinking",
    errorMessage,
    limitWarning: false,
    selectedInput,
    setSelectedInput,
    volume,
    metricsLog,
    session,
    startConversation,
    endConversation,
    startNewConversation,
    sendTextMessage,
    toggleMute,
    setOutputVolume,
    changeInputDevice,
    getInputVolume: () => micRef.current?.getInputVolume() ?? 0,
    getOutputVolume: () => audioQueueRef.current?.getOutputVolume() ?? 0,
  };
}

function isFixedInputGuardDecision(
  decision: InputGuardDecision
): decision is FixedInputGuardDecision {
  return (
    (decision.action === "fixed_exit" ||
      decision.action === "fixed_external") &&
    typeof decision.fixedText === "string"
  );
}

function isAssistantResponseEvent(type: string): boolean {
  return (
    type === "response.created" ||
    type === "response.text.delta" ||
    type === "response.audio_transcript.delta" ||
    type === "response.output_audio_transcript.delta" ||
    type === "response.output_audio.delta" ||
    type === "response.done"
  );
}
