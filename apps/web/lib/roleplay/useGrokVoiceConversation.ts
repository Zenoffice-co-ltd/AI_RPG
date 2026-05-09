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
  fetchGrokVoiceSanitizedResponseTts,
  fetchGrokVoiceSession,
  postGrokVoiceEvent,
} from "./grok-voice-client";
import {
  GrokVoiceAudioQueue,
  type GrokVoiceAudioQueueOptions,
} from "./grok-voice-audio-queue";
import {
  getPr60LockedResponseForUser,
  normalizeGrokVoiceDisplayText,
  normalizePr60AssistantText,
  sanitizeGrokVoiceSpokenText,
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
const LOCKED_TURN_MIC_TAIL_IGNORE_MS = 1_500;

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
  fetchSession?: (input?: {
    reseedFromSessionId?: string;
  }) => Promise<GrokVoiceSession>;
  fetchGreeting?: (input: {
    sessionId: string;
    text: string;
  }) => Promise<GrokVoiceGreeting>;
  fetchLockedResponseTts?: (input: {
    sessionId: string;
    userText: string;
  }) => Promise<import("./grok-voice-types").GrokVoiceLockedResponseTts>;
  fetchSanitizedResponseTts?: (input: {
    sessionId: string;
    text: string;
  }) => Promise<import("./grok-voice-types").GrokVoiceSanitizedResponseTts>;
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
  const currentResponseIdRef = useRef<string | null>(null);
  const ignoredResponseIdsRef = useRef(new Set<string>());
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
  const lockedTurnMicTailIgnoreUntilRef = useRef(0);
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

  // Strict sanitized playback bookkeeping.
  // pendingRealtimeAudioChunksRef holds raw base64 chunks from
  // response.output_audio.delta until response.done lets us decide whether to
  // play, drop, or replace them. firstRealtimeAudioDeltaAtRef captures when
  // the first chunk arrived from the model; firstAudibleAudioAtRef captures
  // when audio actually started playing (which can be later — sanitized-TTS
  // round trip — or never, if suppressed).
  const pendingRealtimeAudioChunksRef = useRef<string[]>([]);
  const pendingRealtimeAudioBytesRef = useRef(0);
  const finalizingResponseRef = useRef(false);
  const sanitizedTurnInFlightRef = useRef(false);
  const firstRealtimeAudioDeltaAtRef = useRef<number | null>(null);
  const firstAudibleAudioAtRef = useRef<number | null>(null);
  const sanitizerDecidedAtRef = useRef<number | null>(null);
  const sanitizedTtsMsRef = useRef<number | null>(null);

  // Reseed plumbing.
  // spokenHistoryRef holds the canonical (un-display-normalized) text per turn
  // — replayed verbatim into a fresh xAI session after reseed so Grok stays in
  // character. The first entry is the greeting (firstMessage); we mark it so
  // reseed doesn't double-prime it.
  type SpokenHistoryEntry = {
    role: "user" | "agent";
    text: string;
    isFirstMessage?: boolean;
  };
  const spokenHistoryRef = useRef<SpokenHistoryEntry[]>([]);
  // sessionTaintedRef = "the prior assistant turn contained a stock suffix
  // and we failed to reseed; the next user-turn entry must retry reseed
  // before sending."
  const sessionTaintedRef = useRef(false);
  const reseedMsRef = useRef<number | null>(null);
  const parentSessionIdForTurnRef = useRef<string | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const fetchSession = deps.fetchSession ?? fetchGrokVoiceSession;
  const fetchGreeting = deps.fetchGreeting ?? fetchGrokVoiceGreeting;
  const fetchLockedResponseTts =
    deps.fetchLockedResponseTts ?? fetchGrokVoiceLockedResponseTts;
  const fetchSanitizedResponseTts =
    deps.fetchSanitizedResponseTts ?? fetchGrokVoiceSanitizedResponseTts;
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

  function getEventResponseId(event: GrokVoiceServerEvent) {
    if (!("response" in event)) return "";
    const response = event.response;
    if (!response || typeof response !== "object") return "";
    const id = (response as { id?: unknown }).id;
    return typeof id === "string" ? id : "";
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
    currentResponseIdRef.current = null;
    pr60LockCancelSentRef.current = false;
    responseActiveRef.current = false;
    realtimeAudioQueuedThisTurnRef.current = false;
    lockedTurnActiveRef.current = false;
    lockedTurnIndexRef.current = null;
    lockedTurnUserTextRef.current = "";
    lockedTurnTtsPlayingRef.current = false;
    lockedTurnMicTailIgnoreUntilRef.current = 0;
    pendingCancelOnResponseCreatedRef.current = false;
    pendingRealtimeAudioChunksRef.current = [];
    pendingRealtimeAudioBytesRef.current = 0;
    sanitizedTurnInFlightRef.current = false;
    firstRealtimeAudioDeltaAtRef.current = null;
    firstAudibleAudioAtRef.current = null;
    sanitizerDecidedAtRef.current = null;
    sanitizedTtsMsRef.current = null;
    reseedMsRef.current = null;
    parentSessionIdForTurnRef.current = null;
  }, []);

  // Indirection ref so the reseed flow can construct a new realtime that
  // dispatches into the SAME handleServerEvent without a circular useCallback
  // dependency. handleServerEvent itself depends on finalizeStrictResponseDone
  // which depends on reseed; the ref breaks that cycle.
  const handleServerEventRef = useRef<
    ((event: GrokVoiceServerEvent) => void) | null
  >(null);

  // Strict sanitized playback reseed. Closes the tainted socket, requests a
  // fresh session marked as a reseed (relaxed rate-limit bucket), opens a new
  // socket, re-primes the assistant history with the original firstMessage,
  // then replays sanitized SPOKEN history (NOT display-normalized text).
  // Returns ok=false on any failure so the caller can mark sessionTainted
  // and retry on the next user-turn entry — never silently fall back to a
  // tainted socket.
  const reseedRealtimeWithSanitizedHistory = useCallback(
    async (): Promise<{ ok: boolean; reseedMs: number }> => {
      const startedAt = Date.now();
      const oldRealtime = realtimeRef.current;
      const oldSession = sessionRef.current;
      if (!oldSession) {
        return { ok: false, reseedMs: 0 };
      }
      // The retry path can be hit when the previous reseed already closed
      // the old socket — in that case oldRealtime is null and we skip the
      // close step but still drive a fresh session bootstrap.
      const parentSessionId = oldSession.sessionId;
      void postGrokVoiceEvent("realtime.reseed.started", {
        sessionId: parentSessionId,
        details: { parentSessionId },
      });
      try {
        if (oldRealtime) {
          oldRealtime.close();
        }
        realtimeRef.current = null;
        realtimeReadyRef.current = false;

        const next = await fetchSession({
          reseedFromSessionId: parentSessionId,
        });
        sessionRef.current = next;
        setSession(next);

        // Open the new realtime socket. Reuse handleServerEvent via the ref
        // indirection so the new socket flows into the same per-turn logic.
        const realtimeOptions: ConstructorParameters<
          typeof GrokVoiceRealtime
        >[0] = {
          url: next.wsUrl,
          ephemeralToken: next.ephemeralToken,
          onMessage: (e) => handleServerEventRef.current?.(e),
          onOpen: () => {
            void postGrokVoiceEvent("ws.connected", {
              sessionId: next.sessionId,
              details: { reseed: true, parentSessionId },
            });
            realtimeRef.current?.sendSessionUpdate({
              voice: next.grokVoiceVoiceId,
              instructions: next.instructions,
              audio: next.audio,
              turn_detection: next.turnDetection,
            });
            realtimeRef.current?.sendAssistantHistory(next.firstMessage);
          },
          onReady: () => {
            realtimeReadyRef.current = true;
          },
          onClose: ({ code, reason }) => {
            void postGrokVoiceEvent("ws.disconnected", {
              sessionId: next.sessionId,
              details: { code, reason: reason || "", reseed: true },
            });
          },
          onError: ({ message }) => {
            void postGrokVoiceEvent("ws.error", {
              sessionId: next.sessionId,
              details: { message, reseed: true },
            });
          },
          onTelemetry: ({ kind, details }) => {
            void postGrokVoiceEvent(
              kind as Parameters<typeof postGrokVoiceEvent>[0],
              {
                sessionId: next.sessionId,
                ...(details ? { details } : {}),
              }
            );
          },
        };
        const realtime = createRealtime
          ? createRealtime(realtimeOptions)
          : new GrokVoiceRealtime(realtimeOptions);
        realtimeRef.current = realtime;
        realtime.open();

        // Replay sanitized SPOKEN history. Skip the firstMessage entry — the
        // sendAssistantHistory call inside onOpen has already re-primed it.
        for (const turn of spokenHistoryRef.current) {
          if (turn.isFirstMessage) continue;
          if (turn.role === "user") {
            realtime.sendUserHistory(turn.text);
          } else {
            realtime.sendAssistantHistoryMessage(turn.text);
          }
        }

        const reseedMs = Date.now() - startedAt;
        void postGrokVoiceEvent("realtime.reseed.completed", {
          sessionId: next.sessionId,
          details: {
            parentSessionId,
            reseedFromSessionId: parentSessionId,
            reseedToSessionId: next.sessionId,
            reseedMs,
            replayedTurns: spokenHistoryRef.current.filter(
              (t) => !t.isFirstMessage
            ).length,
          },
        });
        sessionTaintedRef.current = false;
        parentSessionIdForTurnRef.current = parentSessionId;
        return { ok: true, reseedMs };
      } catch (error) {
        const reseedMs = Date.now() - startedAt;
        sessionTaintedRef.current = true;
        parentSessionIdForTurnRef.current = parentSessionId;
        void postGrokVoiceEvent("realtime.reseed.failed", {
          sessionId: parentSessionId,
          details: {
            parentSessionId,
            message: (error as Error)?.message ?? String(error),
            reseedMs,
          },
        });
        return { ok: false, reseedMs };
      }
    },
    [createRealtime, fetchSession]
  );

  // Strict sanitized playback finalize step. Runs after response.done in
  // strict mode. Caller has already gated on stale-response and locked-turn
  // cases. We OWN the playback decision and the per-turn metrics emission for
  // strict-mode turns — the synchronous response.done handler returns early
  // and never touches metrics or status.
  type StrictOutcome =
    | "clean"
    | "unverified_audio_suppressed"
    | "sanitized_to_empty"
    | "sanitized_tts_played"
    | "sanitized_tts_failed"
    | "reseed_failed_after_play";

  const finalizeStrictResponseDone = useCallback(
    async (activeSession: GrokVoiceSession): Promise<void> => {
      // CRITICAL: run the strict detector on the RAW model transcript, not on
      // normalizePr60AssistantText() output. The legacy normalizer already
      // strips broad STOCK_SUFFIX_PATTERNS (which includes the closing-suffix
      // sentences), so by the time normalizePr60AssistantText returns, the
      // tail we want to detect is already gone — the detector would always
      // see a "clean" turn and we'd play raw audio.
      const rawText = turnAccumulatedTextRef.current;
      const sanitized = sanitizeGrokVoiceSpokenText(rawText);
      sanitizerDecidedAtRef.current = Date.now();
      const accumulatedTextEmpty = rawText.trim().length === 0;
      const audioBuffered = pendingRealtimeAudioChunksRef.current.length > 0;
      const bufferedBytes = pendingRealtimeAudioBytesRef.current;

      // For non-suffix turns, defer to the legacy text normalizer so existing
      // transcript-display behavior (broad stock-suffix scrub + voice-friendly
      // term reflow) is preserved. For suffix-detected turns, use ONLY the
      // sanitized fragment to make sure the stripped tail can never reach UI.
      const spokenForHistory = sanitized.detected
        ? sanitized.text
        : normalizePr60AssistantText(
            turnUserTextPreviewRef.current,
            rawText
          );
      const displayForUi = normalizeGrokVoiceDisplayText(spokenForHistory);

      let outcome: StrictOutcome = "clean";
      let error: GrokVoiceTurnMetricsClient["error"] = null;
      let audioBytesActuallyPlayed = 0;

      if (audioBuffered && accumulatedTextEmpty) {
        // Audio without any transcript — we cannot inspect what's in those
        // bytes, so we drop them. This is the "unverifiable audio" gate.
        pendingRealtimeAudioChunksRef.current = [];
        pendingRealtimeAudioBytesRef.current = 0;
        outcome = "unverified_audio_suppressed";
        error = "unverified_audio_suppressed";
        void postGrokVoiceEvent("response.unverified_audio_suppressed", {
          sessionId: activeSession.sessionId,
          details: {
            turnIndex: turnIndexRef.current,
            audioBytesBuffered: bufferedBytes,
          },
        });
      } else if (sanitized.detected) {
        // Suffix found. Drop ALL buffered raw audio — under no circumstance
        // play it; that would defeat the entire strict-playback goal.
        pendingRealtimeAudioChunksRef.current = [];
        pendingRealtimeAudioBytesRef.current = 0;
        void postGrokVoiceEvent("response.stock_suffix_detected", {
          sessionId: activeSession.sessionId,
          details: {
            turnIndex: turnIndexRef.current,
            removedSentenceCount: sanitized.removedSentences.length,
            removedPatternIds: sanitized.removedPatternIds,
            sanitizedToEmpty: sanitized.sanitizedToEmpty,
            audioBytesDropped: bufferedBytes,
          },
        });
        if (sanitized.sanitizedToEmpty) {
          outcome = "sanitized_to_empty";
          error = "sanitized_to_empty";
        } else {
          // Try sanitized-TTS. On failure, NEVER fall back to raw audio.
          sanitizedTurnInFlightRef.current = true;
          void postGrokVoiceEvent("sanitized_response.tts.requested", {
            sessionId: activeSession.sessionId,
            details: {
              turnIndex: turnIndexRef.current,
              textLen: sanitized.text.length,
            },
          });
          const startedAt = Date.now();
          try {
            const tts = await fetchSanitizedResponseTts({
              sessionId: activeSession.sessionId,
              text: sanitized.text,
            });
            sanitizedTtsMsRef.current = Date.now() - startedAt;
            const ttsBytes = Math.floor((tts.audioBase64.length * 3) / 4);
            void postGrokVoiceEvent("sanitized_response.tts.completed", {
              sessionId: activeSession.sessionId,
              details: {
                turnIndex: turnIndexRef.current,
                textLen: tts.textLen,
                audioBytes: ttsBytes,
                voiceId: tts.voiceId,
                vendorMs: tts.vendorMs ?? null,
              },
            });
            void postGrokVoiceEvent("sanitized_response.playback.started", {
              sessionId: activeSession.sessionId,
              details: { turnIndex: turnIndexRef.current, audioBytes: ttsBytes },
            });
            if (firstAudibleAudioAtRef.current === null) {
              firstAudibleAudioAtRef.current = Date.now();
            }
            await ensureAudioQueue().enqueueBase64AndWait(tts.audioBase64);
            void postGrokVoiceEvent("sanitized_response.playback.completed", {
              sessionId: activeSession.sessionId,
              details: { turnIndex: turnIndexRef.current, audioBytes: ttsBytes },
            });
            outcome = "sanitized_tts_played";
            audioBytesActuallyPlayed = ttsBytes;
            // Append the sanitized assistant turn to spoken history NOW, so
            // the upcoming reseed replays the cleaned version (not the raw
            // suffix-laden output that was in the old session's memory).
            spokenHistoryRef.current.push({
              role: "agent",
              text: sanitized.text,
            });
            // Reseed: rotate the realtime socket so the next turn doesn't
            // see the raw stock-suffix output in xAI's internal context.
            const reseedResult = await reseedRealtimeWithSanitizedHistory();
            reseedMsRef.current = reseedResult.reseedMs;
            if (!reseedResult.ok) {
              outcome = "reseed_failed_after_play";
              error = "reseed_failed_after_play";
            }
          } catch (e) {
            sanitizedTtsMsRef.current = Date.now() - startedAt;
            void postGrokVoiceEvent("sanitized_response.tts.failed", {
              sessionId: activeSession.sessionId,
              details: {
                turnIndex: turnIndexRef.current,
                message: (e as Error)?.message ?? String(e),
              },
            });
            outcome = "sanitized_tts_failed";
            error = "sanitized_tts_failed";
            // No audio is played. The sanitized text is still displayed below.
            // We still append the sanitized text to history so a subsequent
            // successful reseed (driven by the next user turn) can replay it.
            spokenHistoryRef.current.push({
              role: "agent",
              text: sanitized.text,
            });
          } finally {
            sanitizedTurnInFlightRef.current = false;
          }
        }
      } else if (audioBuffered) {
        // Clean turn. Play buffered chunks sequentially, awaiting each so we
        // hold status="speaking" until the last sample finishes. This keeps
        // the mic from re-listening into our own tail audio.
        for (const chunk of pendingRealtimeAudioChunksRef.current) {
          if (firstAudibleAudioAtRef.current === null) {
            firstAudibleAudioAtRef.current = Date.now();
          }
          try {
            await ensureAudioQueue().enqueueBase64AndWait(chunk);
            audioBytesActuallyPlayed += Math.floor((chunk.length * 3) / 4);
          } catch (e) {
            // Audio queue errors surface via onPlaybackError; we keep going so
            // the metrics emission and status reset still happen.
            void postGrokVoiceEvent("audio.queue.error", {
              sessionId: activeSession.sessionId,
              details: {
                message: (e as Error)?.message ?? String(e),
                turnIndex: turnIndexRef.current,
              },
            });
            break;
          }
        }
        pendingRealtimeAudioChunksRef.current = [];
        pendingRealtimeAudioBytesRef.current = 0;
        // Append spoken history for clean turns. xAI's internal context has
        // this turn already, but we still need our own copy in case a later
        // turn triggers a reseed.
        spokenHistoryRef.current.push({
          role: "agent",
          text: spokenForHistory,
        });
      } else {
        // No audio at all in a non-suffix turn — text-only model output.
        error = "no_audio";
        spokenHistoryRef.current.push({
          role: "agent",
          text: spokenForHistory,
        });
      }

      // Transcript update with the (possibly sanitized) display text.
      const interimId = interimAgentClientIdRef.current;
      if (interimId) {
        dispatchMessages({
          type: "updateTextAndStatus",
          clientMessageId: interimId,
          text: displayForUi,
          status: "final",
        });
      }

      // Metrics. firstAudioMs preserves the legacy semantic (first delta
      // arrival) for back-compat dashboards; firstAudibleAudioMs is the new
      // user-experience KPI.
      const startedAt = turnStartAtRef.current;
      const firstAudioMs =
        startedAt !== null && firstRealtimeAudioDeltaAtRef.current !== null
          ? firstRealtimeAudioDeltaAtRef.current - startedAt
          : null;
      const firstAudibleAudioMs =
        startedAt !== null && firstAudibleAudioAtRef.current !== null
          ? firstAudibleAudioAtRef.current - startedAt
          : null;
      const sanitizerDelayMs =
        startedAt !== null && sanitizerDecidedAtRef.current !== null
          ? sanitizerDecidedAtRef.current - startedAt
          : null;
      const doneMs = startedAt !== null ? Date.now() - startedAt : null;
      // The session reference may have changed in the middle of this finalize
      // (after a successful reseed) — read from the ref to get the latest.
      const finalSession = sessionRef.current ?? activeSession;
      const metrics: GrokVoiceTurnMetricsClient = {
        sessionId: finalSession.sessionId,
        turnIndex: turnIndexRef.current,
        inputMode: turnInputModeRef.current,
        userTextLen: turnUserTextLenRef.current,
        agentTextLen: displayForUi.length,
        firstAudioMs,
        doneMs,
        audioBytes: audioBytesActuallyPlayed,
        error,
        promptHash: finalSession.promptHash,
        promptVersion: finalSession.promptVersion,
        guardrailVersion: finalSession.guardrailVersion,
        grokVoiceModel: finalSession.grokVoiceModel,
        grokVoiceVoiceId: finalSession.grokVoiceVoiceId,
        firstRealtimeAudioDeltaMs: firstAudioMs,
        firstAudibleAudioMs,
        sanitizerDelayMs,
        sanitizedTtsMs: sanitizedTtsMsRef.current,
        reseedMs: reseedMsRef.current,
        outcome,
        sessionTainted: sessionTaintedRef.current,
        parentSessionId:
          parentSessionIdForTurnRef.current ??
          finalSession.parentSessionId ??
          null,
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
          firstRealtimeAudioDeltaMs: metrics.firstRealtimeAudioDeltaMs,
          firstAudibleAudioMs: metrics.firstAudibleAudioMs,
          sanitizerDelayMs: metrics.sanitizerDelayMs,
          sanitizedTtsMs: metrics.sanitizedTtsMs,
          reseedMs: metrics.reseedMs,
          doneMs: metrics.doneMs,
          audioBytes: metrics.audioBytes,
          error: metrics.error,
          outcome: metrics.outcome,
          sessionTainted: metrics.sessionTainted,
          parentSessionId: metrics.parentSessionId,
          userTextPreview: turnUserTextPreviewRef.current,
          agentTextPreview: displayForUi,
          agentSpokenTextPreview: spokenForHistory,
          promptHash: metrics.promptHash,
          promptVersion: metrics.promptVersion,
          guardrailVersion: metrics.guardrailVersion,
          grokVoiceModel: metrics.grokVoiceModel,
          grokVoiceVoiceId: metrics.grokVoiceVoiceId,
        },
      });
      resetTurnBookkeeping();
      setStatus("listening");
    },
    [
      ensureAudioQueue,
      fetchSanitizedResponseTts,
      reseedRealtimeWithSanitizedHistory,
      resetTurnBookkeeping,
    ]
  );

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
      const spokenAssistantText = input.assistantText;
      const displayAssistantText =
        normalizeGrokVoiceDisplayText(spokenAssistantText);
      lockedTurnActiveRef.current = true;
      suppressNextRealtimeResponseRef.current = true;
      lockedTurnIndexRef.current = turnIndex;
      lockedTurnUserTextRef.current = input.userText;
      lockedTurnMicTailIgnoreUntilRef.current =
        input.channel === "voice"
          ? Date.now() + LOCKED_TURN_MIC_TAIL_IGNORE_MS
          : 0;
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
          text: displayAssistantText,
          status: "final",
        });
      } else {
        dispatchMessages({
          type: "append",
          message: createTranscriptMessage({
            role: "agent",
            channel: "voice",
            text: displayAssistantText,
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
            agentTextLen: spokenAssistantText.length,
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
        if (input.channel === "voice") {
          lockedTurnMicTailIgnoreUntilRef.current =
            Date.now() + LOCKED_TURN_MIC_TAIL_IGNORE_MS;
        }
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
        realtime.sendAssistantHistoryMessage(spokenAssistantText);
        // The user-side spoken history was already appended by either
        // sendTextMessage (chat) or the STT completion branch (voice). Append
        // the assistant turn now so reseed has the deterministic locked
        // response in the replay.
        spokenHistoryRef.current.push({
          role: "agent",
          text: spokenAssistantText,
        });

        const doneMs = Date.now() - startedAt;
        const metrics: GrokVoiceTurnMetricsClient = {
          sessionId: activeSession.sessionId,
          turnIndex,
          inputMode: input.channel === "chat" ? "text" : "voice",
          userTextLen: input.userText.length,
          agentTextLen: displayAssistantText.length,
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
            agentTextPreview: displayAssistantText,
            agentSpokenTextPreview: spokenAssistantText,
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
          if (
            lockedTurnActiveRef.current &&
            Date.now() < lockedTurnMicTailIgnoreUntilRef.current
          ) {
            void postGrokVoiceEvent("locked_response.mic_tail_ignored", {
              sessionId: activeSession.sessionId,
              details: {
                turnIndex: lockedTurnIndexRef.current ?? turnIndexRef.current,
              },
            });
            break;
          }
          clearLockedRealtimeDrain();
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
          lockedTurnMicTailIgnoreUntilRef.current = 0;
          pendingCancelOnResponseCreatedRef.current = false;
          suppressNextRealtimeResponseRef.current = false;
          // Strict sanitized playback: drop buffered audio and reset timing on
          // barge-in. The user has started a new turn; nothing from the
          // canceled response should ever play.
          pendingRealtimeAudioChunksRef.current = [];
          pendingRealtimeAudioBytesRef.current = 0;
          sanitizedTurnInFlightRef.current = false;
          firstRealtimeAudioDeltaAtRef.current = null;
          firstAudibleAudioAtRef.current = null;
          sanitizerDecidedAtRef.current = null;
          sanitizedTtsMsRef.current = null;
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
          spokenHistoryRef.current.push({ role: "user", text: trimmed });
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
          const responseId = getEventResponseId(event);
          if (
            lockedTurnActiveRef.current ||
            lockedRealtimeDrainActiveRef.current ||
            pendingCancelOnResponseCreatedRef.current ||
            suppressNextRealtimeResponseRef.current
          ) {
            pendingCancelOnResponseCreatedRef.current = false;
            suppressNextRealtimeResponseRef.current = false;
            discardStaleResponseDeltasRef.current = true;
            if (responseId) {
              ignoredResponseIdsRef.current.add(responseId);
            }
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
          currentResponseIdRef.current = responseId || null;
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
              text: normalizeGrokVoiceDisplayText(turnAccumulatedTextRef.current),
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
          const now = Date.now();
          if (firstAudioAtRef.current === null) {
            firstAudioAtRef.current = now;
          }
          if (firstRealtimeAudioDeltaAtRef.current === null) {
            firstRealtimeAudioDeltaAtRef.current = now;
          }
          // base64 length ≈ bytes * 4/3; rough but fine for telemetry.
          const chunkBytes = Math.floor((base64.length * 3) / 4);
          turnAccumulatedAudioBytesRef.current += chunkBytes;
          realtimeAudioQueuedThisTurnRef.current = true;
          agentSpeakingRef.current = true;
          setStatus("speaking");
          if (activeSession.strictSanitizedPlayback) {
            // Strict mode: buffer the chunk. Playback decision happens at
            // response.done after we can sanitize the full transcript.
            pendingRealtimeAudioChunksRef.current.push(base64);
            pendingRealtimeAudioBytesRef.current += chunkBytes;
          } else {
            // Legacy path: schedule immediately. firstAudibleAudioAt collapses
            // onto firstRealtimeAudioDeltaAt because there is no buffering.
            if (firstAudibleAudioAtRef.current === null) {
              firstAudibleAudioAtRef.current = now;
            }
            ensureAudioQueue().enqueueBase64(base64);
          }
          break;
        }
        case "response.done": {
          responseActiveRef.current = false;
          const responseId = getEventResponseId(event);
          if (
            (responseId && ignoredResponseIdsRef.current.has(responseId)) ||
            (currentResponseIdRef.current &&
              responseId &&
              responseId !== currentResponseIdRef.current)
          ) {
            if (responseId) {
              ignoredResponseIdsRef.current.delete(responseId);
            }
            void postGrokVoiceEvent("response.done.stale_discarded", {
              sessionId: activeSession.sessionId,
              details: {
                turnIndex: turnIndexRef.current,
                responseId: responseId || null,
              },
            });
            break;
          }
          if (lockedTurnActiveRef.current || lockedRealtimeDrainActiveRef.current) {
            clearLockedRealtimeDrain();
            break;
          }
          if (activeSession.strictSanitizedPlayback) {
            // Re-entrancy guard: if a previous response.done is still in
            // flight (rare — would mean the realtime sent two response.done
            // events for the same turn), drop the new one.
            if (finalizingResponseRef.current) break;
            finalizingResponseRef.current = true;
            void finalizeStrictResponseDone(activeSession).finally(() => {
              finalizingResponseRef.current = false;
            });
            break;
          }
          // Legacy non-strict path (env flag flipped to false for rollback).
          const id = interimAgentClientIdRef.current;
          const finalSpokenText = normalizePr60AssistantText(
            turnUserTextPreviewRef.current,
            turnAccumulatedTextRef.current
          );
          const finalText = normalizeGrokVoiceDisplayText(finalSpokenText);
          if (id) {
            dispatchMessages({
              type: "updateTextAndStatus",
              clientMessageId: id,
              text: finalText,
              status: "final",
            });
          }
          spokenHistoryRef.current.push({
            role: "agent",
            text: finalSpokenText,
          });
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
              agentSpokenTextPreview: finalSpokenText,
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
    [
      clearLockedRealtimeDrain,
      ensureAudioQueue,
      finalizeStrictResponseDone,
      playLockedResponse,
      resetTurnBookkeeping,
    ]
  );

  // Keep handleServerEventRef in sync so the reseed flow can construct a
  // fresh GrokVoiceRealtime that dispatches into the latest closure.
  useEffect(() => {
    handleServerEventRef.current = handleServerEvent;
  }, [handleServerEvent]);

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
      // Seed spoken history with the firstMessage so reseed re-primes the
      // session with the SAME byte-for-byte greeting xAI saw originally.
      spokenHistoryRef.current = [
        { role: "agent", text: next.firstMessage, isFirstMessage: true },
      ];

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
    lockedTurnMicTailIgnoreUntilRef.current = 0;
    pendingCancelOnResponseCreatedRef.current = false;
    suppressNextRealtimeResponseRef.current = false;
    pendingRealtimeAudioChunksRef.current = [];
    pendingRealtimeAudioBytesRef.current = 0;
    sanitizedTurnInFlightRef.current = false;
    finalizingResponseRef.current = false;
    firstRealtimeAudioDeltaAtRef.current = null;
    firstAudibleAudioAtRef.current = null;
    sanitizerDecidedAtRef.current = null;
    sanitizedTtsMsRef.current = null;
    spokenHistoryRef.current = [];
    sessionTaintedRef.current = false;
    reseedMsRef.current = null;
    parentSessionIdForTurnRef.current = null;
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
      // Tainted-socket retry: a previous turn's reseed failed, so the
      // realtime socket still carries a stock-suffix-laden assistant turn in
      // its memory (or was closed and never re-opened). Try the reseed again
      // BEFORE the readiness gate — the prior failure left realtimeRef null
      // so the gate would otherwise drop us out without retrying.
      if (activeSession && sessionTaintedRef.current) {
        const retry = await reseedRealtimeWithSanitizedHistory();
        if (!retry.ok) {
          // Still tainted. Surface a soft error and refuse to send. The user
          // can retry; the next attempt will drive another reseed try.
          setErrorMessage(RESPOND_ERROR);
          return;
        }
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
      spokenHistoryRef.current.push({ role: "user", text: trimmed });

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
    [
      ensureAudioQueue,
      isInteractive,
      playLockedResponse,
      reseedRealtimeWithSanitizedHistory,
      startConversation,
    ]
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
