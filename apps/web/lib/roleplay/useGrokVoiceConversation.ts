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
import {
  shouldBufferForTurn,
  shouldStrictGateTurn,
  type StrictGateDecision,
} from "./grok-voice-strict-playback";
import { GrokVoiceMicRecorder } from "./grok-voice-mic-recorder";
import { GrokVoiceRealtime } from "./grok-voice-realtime";
import type {
  GrokVoiceMicState,
  GrokVoiceGreeting,
  GrokVoiceLockedResponseTts,
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
  // PR D — risk-based strict playback. `turnStrictGateRef` is computed
  // once per turn from the finalized user text (STT-confirmed for voice,
  // input-submit for text). The audio routing then reads it to decide
  // whether to buffer (gated) or stream (ungated) realtime audio.
  // Defaults to apply=true so that any turn whose user-input phase never
  // populated it (a defensive corner case) falls back to the safe path.
  const turnStrictGateRef = useRef<StrictGateDecision>({
    apply: true,
    reason: "uninitialized_defaulting_to_safe",
  });
  const streamingBeforeDoneRef = useRef(false);
  // PR D / PR #86 P2 — reset helper for the two strict-playback turn
  // refs. There are multiple sites that begin a new turn (the regular
  // `resetTurnBookkeeping` after a clean response.done AND the
  // `input_audio_buffer.speech_started` barge-in path that creates a
  // replacement turn by mutating refs directly). Both must reset BOTH
  // refs, otherwise `streamingBeforeDone=true` from a previous streamed
  // turn leaks into the next (possibly buffered) turn's metrics.
  // Codex P2 on PR #85 caught the barge-in leak; this helper makes the
  // contract explicit so future barge-in paths can't drift.
  const resetStrictPlaybackTurnState = useCallback(() => {
    turnStrictGateRef.current = {
      apply: true,
      reason: "uninitialized_defaulting_to_safe",
    };
    streamingBeforeDoneRef.current = false;
  }, []);
  // Tracks whether the IMMEDIATELY PREVIOUS turn ended with a sanitizer
  // rewrite or a session reseed. The recovery turn after either signal
  // is conservatively gated so the model has one buffered turn to
  // settle before we resume streaming.
  const previousTurnSanitizerOrReseedRef = useRef(false);

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
  // and we either failed to reseed, refused to reseed (sanitized_to_empty /
  // unverified_audio_suppressed), or the sanitized-TTS call failed. Either
  // way the old realtime session memory still carries the raw suffix turn,
  // so the next user-turn entry MUST retry reseed before sending."
  const sessionTaintedRef = useRef(false);
  // Synchronous "drop mic chunks NOW" flag. Set the same instant we close
  // the tainted socket so any frame already in flight from the recorder is
  // discarded at onChunk before it can become an appendAudio call.
  const dropMicChunksWhileTaintedRef = useRef(false);
  // Guards re-entrant reseed retries from concurrent voice/text entries.
  const reseedRetryInFlightRef = useRef(false);
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
    // PR D — reset the gate decision to the safe default for the next
    // turn. The `previousTurnSanitizerOrReseedRef` survives this reset
    // because it captures inter-turn state.
    resetStrictPlaybackTurnState();
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
  }, [resetStrictPlaybackTurnState]);

  // Indirection ref so the reseed flow can construct a new realtime that
  // dispatches into the SAME handleServerEvent without a circular useCallback
  // dependency. handleServerEvent itself depends on finalizeStrictResponseDone
  // which depends on reseed; the ref breaks that cycle.
  const handleServerEventRef = useRef<
    ((event: GrokVoiceServerEvent) => void) | null
  >(null);

  // P1A: mark the current realtime session as tainted (prior assistant turn
  // is contaminated with raw suffix or unverifiable audio). Closes the socket
  // immediately so no later code path can accidentally appendAudio /
  // sendUserText into a poisoned context. The next user-turn entry will
  // bootstrap a fresh session via reseed.
  const markSessionTainted = useCallback(
    (
      reason:
        | "sanitized_tts_failed"
        | "sanitized_to_empty"
        | "unverified_audio_suppressed"
        | "reseed_failed_after_play",
      parentSessionId: string
    ) => {
      sessionTaintedRef.current = true;
      parentSessionIdForTurnRef.current = parentSessionId;
      dropMicChunksWhileTaintedRef.current = true;
      micRecorderRef.current?.setEnabled(false);
      try {
        realtimeRef.current?.close();
      } catch {
        // best effort; we are already in an error path
      }
      realtimeRef.current = null;
      realtimeReadyRef.current = false;
      void postGrokVoiceEvent("realtime.session_tainted", {
        sessionId: parentSessionId,
        details: { reason, parentSessionId },
      });
    },
    []
  );

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

  // P1B: text- and voice-input-shared gate that retries reseed before any
  // user-turn side effect can hit a tainted socket. Returns true when the
  // socket is safe to send/append into.
  //
  // - `text`: called from sendTextMessage() head.
  // - `voice`: called from STT completion AND from input_audio_buffer.
  //   speech_started. Mic onChunk uses dropMicChunksWhileTaintedRef
  //   synchronously — it does NOT call this helper per-frame.
  const ensureUntaintedRealtimeBeforeUserTurn = useCallback(
    async (inputMode: "text" | "voice"): Promise<boolean> => {
      if (!sessionTaintedRef.current) return true;
      micRecorderRef.current?.setEnabled(false);
      dropMicChunksWhileTaintedRef.current = true;
      if (reseedRetryInFlightRef.current) {
        // Another caller is already retrying. Surface as soft fail — the
        // caller will refuse the turn rather than queue behind the retry.
        return false;
      }
      reseedRetryInFlightRef.current = true;
      try {
        const retry = await reseedRealtimeWithSanitizedHistory();
        if (!retry.ok) {
          setErrorMessage(RESPOND_ERROR);
          void postGrokVoiceEvent("realtime.reseed.failed", {
            ...(sessionRef.current?.sessionId
              ? { sessionId: sessionRef.current.sessionId }
              : {}),
            details: { inputMode, reason: "tainted_retry_failed" },
          });
          return false;
        }
        // reseedRealtimeWithSanitizedHistory clears sessionTaintedRef on
        // success. Mirror the mic-side flag so onChunk stops dropping.
        dropMicChunksWhileTaintedRef.current = false;
        if (inputMode === "voice" && micEnabled && !isMutedRef.current) {
          micRecorderRef.current?.setEnabled(true);
        }
        return true;
      } finally {
        reseedRetryInFlightRef.current = false;
      }
    },
    [micEnabled, reseedRealtimeWithSanitizedHistory]
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
        // P1A: the assistant turn whose audio we just dropped IS still in
        // the realtime session memory — taint it.
        markSessionTainted(
          "unverified_audio_suppressed",
          activeSession.sessionId
        );
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
          // P1A: the raw suffix-only assistant turn is still in xAI memory.
          markSessionTainted("sanitized_to_empty", activeSession.sessionId);
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
              // P1A: belt-and-suspenders. reseedRealtimeWithSanitizedHistory
              // already sets sessionTaintedRef=true on its own catch path,
              // but we re-emit through markSessionTainted so the typed event
              // fires and the mic-drop flag is set consistently.
              markSessionTainted(
                "reseed_failed_after_play",
                activeSession.sessionId
              );
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
            // P1A: the raw suffix turn is still in xAI session memory and we
            // never reseeded — the next user turn must not enter this socket.
            markSessionTainted(
              "sanitized_tts_failed",
              activeSession.sessionId
            );
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
      // PR A: realtime path is `rt_voice` or `rt_text` based on input mode.
      // Lock turns short-circuit before reaching this branch so they never
      // emit `rt_*` here.
      const routePath: GrokVoiceTurnMetricsClient["routePath"] =
        turnInputModeRef.current === "text" ? "rt_text" : "rt_voice";
      // PR D — strict-gate decision was computed once at user-input
      // finalization. The buffered (strict) path went through the
      // sanitizer; the streaming path did not. Both report the same
      // gate decision for dashboards to group by.
      const strictGate = turnStrictGateRef.current;
      const usedBufferedPath = shouldBufferForTurn({
        mode: finalSession.strictPlaybackMode,
        gateDecision: strictGate,
      });
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
        routePath,
        localLockedAudioHit: false,
        strictPlaybackMode: finalSession.strictPlaybackMode,
        strictGateApplied: usedBufferedPath,
        strictGateReason: strictGate.reason,
        streamingBeforeDone: streamingBeforeDoneRef.current,
      };
      setMetricsLog((current) => [...current, metrics]);
      // PR D — capture inter-turn signal for the NEXT turn's gate
      // decision. If this turn ended with sanitizer activity or a
      // reseed, the immediately following turn is conservatively
      // gated regardless of its user-text shape.
      previousTurnSanitizerOrReseedRef.current =
        outcome !== "clean" ||
        sanitizedTtsMsRef.current !== null ||
        reseedMsRef.current !== null;
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
          routePath: metrics.routePath,
          localLockedAudioHit: metrics.localLockedAudioHit,
          strictPlaybackMode: metrics.strictPlaybackMode,
          strictGateApplied: metrics.strictGateApplied,
          strictGateReason: metrics.strictGateReason,
          streamingBeforeDone: metrics.streamingBeforeDone,
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
      markSessionTainted,
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

        // PR B — voice-lock local audio prebundle.
        //
        // The session bootstrap optionally ships pre-synthesized
        // canonical audio in `lockedResponseAudioBundle`. For voice
        // turns whose canonical is in the bundle, play it directly
        // from memory and skip the `/api/v3/locked-response-tts`
        // HTTP roundtrip entirely. PR #85 E2E measured that roundtrip
        // at ~6,131ms (build-2026-05-10-004 voice_case1_shallow_background);
        // eliminating it is the target latency win of this PR.
        //
        // Text turns keep the existing network-TTS path: text input
        // already lands in <500ms per PR A observability, so the
        // bundle would not move the needle for text mode.
        //
        // Local-miss policy is conservative for the initial roll-out:
        // fall back to the existing network-TTS path so we never
        // regress an uncached canonical. A future env-flip can
        // upgrade this to "realtime fallback" for `local_audio_only`
        // mode.
        const bundle = activeSession.lockedResponseAudioBundle;
        const bundleEntry =
          input.channel === "voice" && bundle
            ? bundle.entries.find((e) => e.spokenText === spokenAssistantText)
            : undefined;

        let tts: GrokVoiceLockedResponseTts;
        let networkTtsMs: number;
        let routePath: GrokVoiceTurnMetricsClient["routePath"];
        let localLockedAudioHit: boolean;

        if (bundleEntry && bundle) {
          // Local hit — synthesize a TTS-shaped object from the
          // bundle entry so the downstream playback / metrics code
          // paths are identical to the network path. `vendorMs` is
          // spread-when-defined to satisfy
          // `exactOptionalPropertyTypes: true`.
          tts = {
            text: spokenAssistantText,
            displayText: displayAssistantText,
            audioBase64: bundleEntry.audioBase64,
            mimeType: "audio/pcm",
            sampleRateHz: bundle.sampleRateHz,
            textLen: spokenAssistantText.length,
            voiceId: bundle.voiceId,
            ...(bundleEntry.vendorMsAtCreation !== null
              ? { vendorMs: bundleEntry.vendorMsAtCreation }
              : {}),
            cacheStatus: "hit",
            cacheLookupMs: 0,
            ttsVendorMsAtCreation: bundleEntry.vendorMsAtCreation,
          };
          networkTtsMs = 0;
          routePath = "lock_voice_local_audio";
          localLockedAudioHit = true;
          void postGrokVoiceEvent("locked_audio_bundle.loaded", {
            sessionId: activeSession.sessionId,
            details: {
              turnIndex,
              spokenTextLen: spokenAssistantText.length,
              audioBytes: bundleEntry.audioBytes,
              cacheKeyHash: bundleEntry.cacheKeyHash,
            },
          });
        } else {
          if (input.channel === "voice" && bundle) {
            // Voice turn, bundle present, but THIS canonical missed.
            // Worth a structured signal so the dashboard can spot a
            // catalog drift between PR60 locks and the bundle priority list.
            void postGrokVoiceEvent("locked_audio_bundle.miss", {
              sessionId: activeSession.sessionId,
              details: {
                turnIndex,
                spokenTextLen: spokenAssistantText.length,
                bundleEntryCount: bundle.entries.length,
              },
            });
          } else if (input.channel === "voice" && !bundle) {
            // Bundle is disabled / not surfaced (env kill-switch or
            // assembler failed). One event per turn so the dashboard
            // can quantify how many turns ran without a bundle.
            void postGrokVoiceEvent("locked_audio_bundle.disabled", {
              sessionId: activeSession.sessionId,
              details: { turnIndex },
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
          // PR A observability: time the network TTS roundtrip so we can
          // attribute the "lock-voice is slow because of HTTP" hypothesis
          // (vs xAI processing time, vs audio decode). PR B eliminates
          // this roundtrip on the local-hit path; the measurement
          // remains the source of truth for the legacy fallback path.
          const ttsRequestStartedAt = Date.now();
          tts = await fetchLockedResponseTts({
            sessionId: activeSession.sessionId,
            userText: input.userText,
          });
          networkTtsMs = Date.now() - ttsRequestStartedAt;
          routePath =
            input.channel === "chat" ? "lock_text" : "lock_voice_network_tts";
          localLockedAudioHit = false;
        }

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
            cacheLookupMs: tts.cacheLookupMs ?? null,
            ttsVendorMsAtCreation: tts.ttsVendorMsAtCreation ?? null,
            networkTtsMs,
            localLockedAudioHit,
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
        const firstAudioMs = firstAudioAt - startedAt;
        // PR A + PR B: `routePath` and `localLockedAudioHit` are set
        // above where the bundle vs network path is chosen, so this
        // emission block just hands them through.
        // lockedResponseKey is the canonical text itself — a stable,
        // human-readable identifier for the lock entry that collides
        // with `getAllPr60LockedResponses()` so cache warm telemetry
        // can join against it.
        const lockedResponseKey = spokenAssistantText;
        const metrics: GrokVoiceTurnMetricsClient = {
          sessionId: activeSession.sessionId,
          turnIndex,
          inputMode: input.channel === "chat" ? "text" : "voice",
          userTextLen: input.userText.length,
          agentTextLen: displayAssistantText.length,
          firstAudioMs,
          // For lock turns there is no sanitizer gate, so firstAudibleAudioMs
          // (what the user actually hears) equals firstAudioMs (decode start).
          firstAudibleAudioMs: firstAudioMs,
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
          routePath,
          localLockedAudioHit,
          lockedResponseKey,
          cacheStatus: tts.cacheStatus,
          cacheLookupMs: tts.cacheLookupMs ?? null,
          ttsVendorMsAtCreation: tts.ttsVendorMsAtCreation ?? null,
          networkTtsMs,
          // PR D — lock turns never traverse the realtime audio gate.
          // Emit `strictPlaybackMode` for dashboard grouping, but leave
          // `strictGateApplied` / `strictGateReason` / `streamingBeforeDone`
          // undefined: the gate decision is structurally not applicable.
          strictPlaybackMode: activeSession.strictPlaybackMode,
        };
        // PR D — lock turns are "clean" in the sanitizer sense (no
        // unsanitized model audio reached the user). The next turn
        // does not need conservative gating from a lock.
        previousTurnSanitizerOrReseedRef.current = false;
        setMetricsLog((current) => [...current, metrics]);
        void postGrokVoiceEvent("turn.completed", {
          sessionId: activeSession.sessionId,
          details: {
            turnIndex: metrics.turnIndex,
            inputMode: metrics.inputMode,
            userTextLen: metrics.userTextLen,
            agentTextLen: metrics.agentTextLen,
            firstAudioMs: metrics.firstAudioMs,
            firstAudibleAudioMs: metrics.firstAudibleAudioMs,
            doneMs: metrics.doneMs,
            audioBytes: metrics.audioBytes,
            error: metrics.error,
            lockedResponse: true,
            lockedResponseSource: "client_tts",
            routePath: metrics.routePath,
            localLockedAudioHit: metrics.localLockedAudioHit,
            lockedResponseKey: metrics.lockedResponseKey,
            cacheStatus: metrics.cacheStatus,
            cacheLookupMs: metrics.cacheLookupMs,
            ttsVendorMsAtCreation: metrics.ttsVendorMsAtCreation,
            networkTtsMs: metrics.networkTtsMs,
            strictPlaybackMode: metrics.strictPlaybackMode,
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
          // P1B: synchronous freeze before any per-turn state advance when
          // the socket is tainted. Do NOT advance turnIndex, do NOT touch
          // buffered audio or pending response state. The "turn" never
          // starts until reseed succeeds.
          if (sessionTaintedRef.current) {
            micRecorderRef.current?.setEnabled(false);
            dropMicChunksWhileTaintedRef.current = true;
            void postGrokVoiceEvent("realtime.session_tainted", {
              sessionId: activeSession.sessionId,
              details: {
                inputMode: "voice",
                reason: "speech_started_while_tainted",
              },
            });
            void (async () => {
              const ok = await ensureUntaintedRealtimeBeforeUserTurn("voice");
              if (ok) dropMicChunksWhileTaintedRef.current = false;
            })();
            break;
          }
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
          // PR D / PR #86 P2 — barge-in starts a replacement turn by
          // mutating refs directly (NOT via resetTurnBookkeeping). Reset
          // the strict-playback per-turn state explicitly so the
          // previous turn's `streamingBeforeDone=true` does not leak
          // into the new turn's metrics, and so the new turn re-enters
          // with the safe-default gate until STT confirms a fresh
          // user-text classification.
          resetStrictPlaybackTurnState();
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
          // PR D — capture the strict-gate decision once STT is final
          // and BEFORE any audio delta arrives. Voice latency benefits
          // require this decision to be ready in the
          // response.output_audio.delta handler.
          turnStrictGateRef.current = shouldStrictGateTurn({
            userText: trimmed,
            inputMode: "voice",
            postSanitizerOrReseed:
              previousTurnSanitizerOrReseedRef.current,
          });
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
          // P1B: refuse the entire voice turn before ANY side effect when
          // the socket is tainted. Do NOT append to UI transcript, do NOT
          // push to spoken history, do NOT dispatch locked response. A
          // tainted-then-failed turn must not enter reseed-replay history.
          if (sessionTaintedRef.current) {
            void postGrokVoiceEvent("stt.skipped", {
              sessionId: activeSession.sessionId,
              details: {
                turnIndex: turnIndexRef.current,
                reason: "tainted_socket",
              },
            });
            void (async () => {
              const ok = await ensureUntaintedRealtimeBeforeUserTurn("voice");
              if (ok) {
                dropMicChunksWhileTaintedRef.current = false;
              }
              // On failure: soft error is already on the hook state; the
              // user can speak again to retry.
            })();
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
          // PR D — per-turn strict-gate decision. The legacy
          // `strictSanitizedPlayback` boolean would always buffer; the
          // new tri-state `strictPlaybackMode` lets ungated turns under
          // `risk_based` stream immediately (and `monitor_only` always
          // streams, only for evidence collection in non-prod).
          const shouldBuffer = shouldBufferForTurn({
            mode: activeSession.strictPlaybackMode,
            gateDecision: turnStrictGateRef.current,
          });
          if (shouldBuffer) {
            // Buffer the chunk. Playback decision happens at
            // response.done after we can sanitize the full transcript.
            pendingRealtimeAudioChunksRef.current.push(base64);
            pendingRealtimeAudioBytesRef.current += chunkBytes;
          } else {
            // Streaming path: schedule immediately. firstAudibleAudioAt
            // collapses onto firstRealtimeAudioDeltaAt because there is
            // no buffering. `streamingBeforeDoneRef` enables the stock-
            // suffix-after-streaming risk telemetry in the transcript
            // handler.
            streamingBeforeDoneRef.current = true;
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
          // PR D — same per-turn classification as the delta path. If
          // the turn was buffered, we must run the strict finalize
          // (sanitize → decide → play). If it was streamed, the audio
          // has already reached the user; finalize on the legacy path
          // to update metrics + history without re-playing.
          const usedBufferedPath = shouldBufferForTurn({
            mode: activeSession.strictPlaybackMode,
            gateDecision: turnStrictGateRef.current,
          });
          if (usedBufferedPath) {
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
          // Streaming-path finalize: audio is already with the user.
          // Reuse the existing non-strict finalize below.
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
          // PR A: legacy non-strict realtime path. Same routePath
          // classification as the strict branch above.
          // PR D: this branch is also taken by the `risk_based` streaming
          // path (gate not applied) and by `monitor_only`. The gate
          // reason in those cases is null; the metrics still report
          // `strictPlaybackMode` and `strictGateApplied=false` so
          // dashboards distinguish "user heard model output directly"
          // from "user heard sanitized version".
          const routePath: GrokVoiceTurnMetricsClient["routePath"] =
            turnInputModeRef.current === "text" ? "rt_text" : "rt_voice";
          const strictGateStreaming = turnStrictGateRef.current;
          const usedBufferedPathStreaming = shouldBufferForTurn({
            mode: activeSession.strictPlaybackMode,
            gateDecision: strictGateStreaming,
          });
          const metrics: GrokVoiceTurnMetricsClient = {
            sessionId: activeSession.sessionId,
            turnIndex: turnIndexRef.current,
            inputMode: turnInputModeRef.current,
            userTextLen: turnUserTextLenRef.current,
            agentTextLen: finalText.length,
            firstAudioMs,
            // Non-strict path plays audio as it arrives, so the user-audible
            // latency equals the delta arrival latency.
            firstAudibleAudioMs: firstAudioMs,
            doneMs,
            audioBytes: turnAccumulatedAudioBytesRef.current,
            error: turnAccumulatedAudioBytesRef.current === 0 ? "no_audio" : null,
            promptHash: activeSession.promptHash,
            promptVersion: activeSession.promptVersion,
            guardrailVersion: activeSession.guardrailVersion,
            grokVoiceModel: activeSession.grokVoiceModel,
            grokVoiceVoiceId: activeSession.grokVoiceVoiceId,
            routePath,
            localLockedAudioHit: false,
            strictPlaybackMode: activeSession.strictPlaybackMode,
            strictGateApplied: usedBufferedPathStreaming,
            strictGateReason: strictGateStreaming.reason,
            streamingBeforeDone: streamingBeforeDoneRef.current,
          };
          setMetricsLog((current) => [...current, metrics]);
          // PR D — streaming path: keep `previousTurnSanitizerOrReseed`
          // false because no sanitizer ran. The next turn is free to
          // stream unless its own user-text shape gates it.
          previousTurnSanitizerOrReseedRef.current = false;
          void postGrokVoiceEvent("turn.completed", {
            sessionId: activeSession.sessionId,
            details: {
              turnIndex: metrics.turnIndex,
              inputMode: metrics.inputMode,
              userTextLen: metrics.userTextLen,
              agentTextLen: metrics.agentTextLen,
              firstAudioMs: metrics.firstAudioMs,
              firstAudibleAudioMs: metrics.firstAudibleAudioMs,
              doneMs: metrics.doneMs,
              audioBytes: metrics.audioBytes,
              routePath: metrics.routePath,
              localLockedAudioHit: metrics.localLockedAudioHit,
              strictPlaybackMode: metrics.strictPlaybackMode,
              strictGateApplied: metrics.strictGateApplied,
              strictGateReason: metrics.strictGateReason,
              streamingBeforeDone: metrics.streamingBeforeDone,
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
      resetStrictPlaybackTurnState,
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
    // P1B last-line defense: synchronous drop while the realtime socket is
    // tainted. The async reseed retry is started by speech_started / STT
    // handlers; this is the belt-and-suspenders guard for any frame that
    // slipped past the recorder's setEnabled(false) call.
    const sendChunkIfUntainted = (chunk: string) => {
      if (
        sessionTaintedRef.current ||
        dropMicChunksWhileTaintedRef.current
      ) {
        return; // synchronous drop, no telemetry per-frame
      }
      realtimeRef.current?.appendAudio(chunk);
    };
    const recorder =
      createMicRecorder?.(sendChunkIfUntainted, {
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
      }) ??
      new GrokVoiceMicRecorder({
        targetSampleRate: sessionRef.current?.audio.sampleRate ?? 24_000,
        onChunk: sendChunkIfUntainted,
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
    dropMicChunksWhileTaintedRef.current = false;
    reseedRetryInFlightRef.current = false;
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
      // P1B: shared tainted-recovery gate for text and voice. Refuse the
      // turn if the socket is poisoned and reseed retry fails — we never
      // send into a tainted context.
      if (activeSession) {
        const ok = await ensureUntaintedRealtimeBeforeUserTurn("text");
        if (!ok) {
          // Soft error already surfaced; user message NOT appended to UI
          // or to spoken history (the appends below the readiness gate
          // never run).
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
      // PR D — strict-gate decision for text input is computed at submit
      // time, before any model response is initiated.
      turnStrictGateRef.current = shouldStrictGateTurn({
        userText: trimmed,
        inputMode: "text",
        postSanitizerOrReseed: previousTurnSanitizerOrReseedRef.current,
      });
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
      ensureUntaintedRealtimeBeforeUserTurn,
      isInteractive,
      playLockedResponse,
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
