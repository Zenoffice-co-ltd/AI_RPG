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
  type TailGuardChunk,
} from "./audio-tail-guard";
import {
  fetchGrokFirstV50Greeting,
  fetchGrokFirstV50ShortAck,
  fetchGrokFirstV50Session,
  postGrokFirstV50Event,
} from "./client";
import {
  getV507FixedGuardAudioBase64,
  getV507FixedGuardAudioBytes,
} from "./guard/fixed-guard-audio";
import {
  classifyInputGuard,
  type InputGuardDecision,
} from "./guard/input-guard";
import {
  normalizeGrokFirstUserText,
  type UserTextNormalization,
} from "./guard/input-normalization";
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
  AudioReleaseMode,
  NegativeGuardDecision,
} from "./types";

const SAFE_ERROR =
  "セッションの開始に失敗しました。時間をおいて再試行してください。";
const AUDIO_ERROR =
  "音声の再生に失敗しました。ページを再読み込みして再試行してください。";
const TAIL_ONLY_SAFETY_DROP_MS = 200;
const TAIL_ONLY_FADE_OUT_MS = 80;
const TAIL_ONLY_MIN_RELEASE_MS = 700;
const TAIL_ONLY_MIN_SAFE_BODY_RATIO = 0.8;
const DETERMINISTIC_SAFE_BODY_TEXTS = new Set([
  "受注処理が増えていて、社員側の確認負荷が高くなっています。",
  "受注入力、発注処理、納期調整、代理店や工務店からの問い合わせ対応が中心です。",
  "営業事務一名で、六月一日開始希望、業務は受注入力と納期調整が中心です。",
  "受注入力と納期調整が中心で、代理店や工務店との電話・メール対応があり、週五日出社前提です。",
  "人事側で条件面を確認し、現場課長が業務適性を見る理解で近いです。",
  "メーカー経験は必須ではありませんが、受発注と対外調整の経験は見たいです。",
]);

type FixedInputGuardDecision = InputGuardDecision & {
  action: "fixed_exit" | "fixed_external";
  fixedText: string;
};

type BufferedAudioChunk = TailGuardChunk & {
  at: number;
  order: number;
};

type TranscriptDeltaTiming = {
  text: string;
  cumulativeText: string;
  at: number;
  order: number;
};

type TailOnlyReleasePlan =
  | {
      ok: true;
      chunks: BufferedAudioChunk[];
      droppedBytes: number;
      reason: string;
    }
  | {
      ok: false;
      droppedBytes: number;
      reason: string;
    };

function toBufferedAudioChunk(
  base64: string,
  at: number,
  order: number
): BufferedAudioChunk {
  const bytes = Math.floor((base64.length * 3) / 4);
  return {
    base64,
    bytes,
    at,
    order,
    durationMs: Math.round((bytes / 2 / 24_000) * 1000),
  };
}

function sumAudioBytes(chunks: ReadonlyArray<{ bytes: number }>): number {
  return chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
}

function sumAudioDurationMs(
  chunks: ReadonlyArray<{ durationMs: number }>
): number {
  return chunks.reduce((sum, chunk) => sum + chunk.durationMs, 0);
}

function hasCompleteSentence(text: string): boolean {
  return /[。！？!?]\s*$/u.test(text.trim());
}

function slicePcmBase64(base64: string, keepBytes: number): string {
  const binary = atob(base64);
  return btoa(binary.slice(0, keepBytes));
}

function fadeOutPcmBase64(base64: string, fadeMs = TAIL_ONLY_FADE_OUT_MS): string {
  const binary = atob(base64);
  if (!binary) return base64;
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const sampleCount = Math.floor(bytes.length / 2);
  const fadeSamples = Math.min(sampleCount, Math.floor((fadeMs / 1000) * 24_000));
  if (fadeSamples <= 0) return base64;
  const view = new DataView(bytes.buffer);
  for (let sampleOffset = 0; sampleOffset < fadeSamples; sampleOffset += 1) {
    const sampleIndex = sampleCount - fadeSamples + sampleOffset;
    const gain = Math.max(0, 1 - sampleOffset / fadeSamples);
    const value = view.getInt16(sampleIndex * 2, true);
    view.setInt16(sampleIndex * 2, Math.round(value * gain), true);
  }
  let output = "";
  for (let index = 0; index < bytes.length; index += 1) {
    output += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(output);
}

function withTailFade(chunks: BufferedAudioChunk[]): BufferedAudioChunk[] {
  if (chunks.length === 0) return chunks;
  const next = [...chunks];
  const last = next[next.length - 1];
  if (!last) return next;
  next[next.length - 1] = {
    ...last,
    base64: fadeOutPcmBase64(last.base64),
  };
  return next;
}

function takeAudioPrefixByDuration(
  chunks: BufferedAudioChunk[],
  targetDurationMs: number
): BufferedAudioChunk[] {
  const releaseChunks: BufferedAudioChunk[] = [];
  let remainingMs = targetDurationMs;
  for (const chunk of chunks) {
    if (remainingMs <= 0) break;
    if (chunk.durationMs <= remainingMs) {
      releaseChunks.push(chunk);
      remainingMs -= chunk.durationMs;
      continue;
    }
    const keepBytes = Math.max(
      0,
      Math.min(
        chunk.bytes,
        Math.floor(((remainingMs / 1000) * 24_000 * 2) / 2) * 2
      )
    );
    if (keepBytes <= 0) break;
    releaseChunks.push({
      ...chunk,
      base64: slicePcmBase64(chunk.base64, keepBytes),
      bytes: keepBytes,
      durationMs: Math.round((keepBytes / 2 / 24_000) * 1000),
    });
    break;
  }
  return releaseChunks;
}

function planTailOnlyRelease(input: {
  rawText: string;
  finalText: string;
  chunks: BufferedAudioChunk[];
  transcriptDeltas: TranscriptDeltaTiming[];
}): TailOnlyReleasePlan {
  const rawText = input.rawText.trim();
  const finalText = input.finalText.trim();
  const allDroppedBytes = sumAudioBytes(input.chunks);
  if (!rawText || !finalText || finalText.length >= rawText.length) {
    return { ok: false, droppedBytes: allDroppedBytes, reason: "empty_or_no_trim" };
  }

  const transcriptBoundary = input.transcriptDeltas.find((delta) => {
    const cumulative = delta.cumulativeText.trim();
    return (
      cumulative.length >= finalText.length &&
      (cumulative.startsWith(finalText) || finalText.startsWith(cumulative))
    );
  });

  const candidateSets: BufferedAudioChunk[][] = [];
  if (transcriptBoundary) {
    candidateSets.push(
      input.chunks.filter((chunk) => chunk.order <= transcriptBoundary.order)
    );
  }
  const ratio = Math.max(
    0,
    Math.min(1, finalText.length / Math.max(rawText.length, 1))
  );
  const candidateCount = Math.floor(input.chunks.length * ratio);
  const ratioCandidateChunks = input.chunks.slice(0, candidateCount);
  if (
    ratioCandidateChunks.length > 0 &&
    !candidateSets.some((candidate) => candidate.length === ratioCandidateChunks.length)
  ) {
    candidateSets.push(ratioCandidateChunks);
  }

  if (candidateSets.length === 0) {
    return { ok: false, droppedBytes: allDroppedBytes, reason: "no_candidate_boundary" };
  }

  const totalDurationMs = sumAudioDurationMs(input.chunks);
  const estimatedSafeBodyDurationMs =
    totalDurationMs * ratio;

  for (const candidateChunks of candidateSets) {
    if (candidateChunks.length === 0) continue;
    const candidateDurationMs = sumAudioDurationMs(candidateChunks);
    const maxReleaseDurationMs = Math.max(
      0,
      candidateDurationMs - TAIL_ONLY_SAFETY_DROP_MS
    );
    const releaseChunks = takeAudioPrefixByDuration(
      candidateChunks,
      maxReleaseDurationMs
    );
    const releasedDurationMs = sumAudioDurationMs(releaseChunks);
    if (
      releaseChunks.length === 0 ||
      releasedDurationMs < TAIL_ONLY_MIN_RELEASE_MS ||
      releasedDurationMs <
        estimatedSafeBodyDurationMs * TAIL_ONLY_MIN_SAFE_BODY_RATIO
    ) {
      continue;
    }
    return {
      ok: true,
      chunks: withTailFade(releaseChunks),
      droppedBytes: allDroppedBytes - sumAudioBytes(releaseChunks),
      reason: transcriptBoundary ? "transcript_boundary" : "char_ratio_boundary",
    };
  }
  const ratioReleaseDurationMs = Math.max(
    0,
    estimatedSafeBodyDurationMs - TAIL_ONLY_SAFETY_DROP_MS
  );
  const ratioReleaseChunks = takeAudioPrefixByDuration(
    input.chunks,
    ratioReleaseDurationMs
  );
  const ratioReleasedDurationMs = sumAudioDurationMs(ratioReleaseChunks);
  if (
    ratioReleaseChunks.length > 0 &&
    ratioReleasedDurationMs >= TAIL_ONLY_MIN_RELEASE_MS &&
    ratioReleasedDurationMs >=
      estimatedSafeBodyDurationMs * TAIL_ONLY_MIN_SAFE_BODY_RATIO
  ) {
    return {
      ok: true,
      chunks: withTailFade(ratioReleaseChunks),
      droppedBytes: allDroppedBytes - sumAudioBytes(ratioReleaseChunks),
      reason: "intrachunk_char_ratio_fallback",
    };
  }
  return { ok: false, droppedBytes: allDroppedBytes, reason: "release_too_short_or_unsafe" };
}

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
  fetchOpeningAudio?: (input: {
    sessionId: string;
    text: string;
  }) => Promise<{
    audioBase64: string;
    textLen: number;
    voiceId: string;
    vendorMs?: number | undefined;
    cacheStatus?: "hit" | "miss" | undefined;
  }>;
  fetchShortAckAudio?: (input: {
    sessionId: string;
    text: string;
  }) => Promise<{
    audioBase64: string;
    mimeType: "audio/pcm";
    sampleRateHz: number;
    textLen: number;
    voiceId: string;
    vendorMs?: number | undefined;
    cacheStatus?: "hit" | "miss" | undefined;
  }>;
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
  const releasedAudioBytesRef = useRef(0);
  const bufferedAudioChunksRef = useRef<BufferedAudioChunk[]>([]);
  const bufferedAudioDroppedBytesRef = useRef(0);
  const bufferedAudioObservedRef = useRef(false);
  const riskSafePrefixReadyRef = useRef(false);
  const transcriptDeltasRef = useRef<TranscriptDeltaTiming[]>([]);
  const eventOrderRef = useRef(0);
  const currentUserTextRef = useRef("");
  const normalizedUserTextRef = useRef("");
  const normalizationAppliedRef = useRef(false);
  const normalizationReasonsRef = useRef<string[]>([]);
  const inputModeRef = useRef<"voice" | "text">("voice");
  const interimAgentClientIdRef = useRef<string | null>(null);
  const interimAgentMessageAppendedRef = useRef(false);
  const greetingSessionIdRef = useRef<string | null>(null);
  const hardSuppressedRef = useRef(false);
  const fixedGuardActiveRef = useRef(false);
  const fixedGuardDrainUntilRef = useRef(0);
  const normalInputDrainUntilRef = useRef(0);
  const ignoreNextEmptyResponseDoneRef = useRef(false);
  const userSpeechInProgressRef = useRef(false);
  const expectedAssistantResponseRef = useRef(false);
  const responseCreateCountRef = useRef(0);
  const responseCancelCountRef = useRef(0);
  const responseCancelReasonsRef = useRef<string[]>([]);

  const assistantResponseDrainReason = useCallback(() => {
    const now = Date.now();
    if (fixedGuardActiveRef.current) return "assistant_response_only";
    if (now < fixedGuardDrainUntilRef.current) return "assistant_response_only";
    if (now < normalInputDrainUntilRef.current) return "normal_input_suppression";
    return "";
  }, []);

  const isPromptOnlySession = useCallback(() => {
    const activeSession = sessionRef.current;
    return (
      activeSession?.runtimeControl?.mode === "prompt_only" ||
      activeSession?.backend === "grok-first-v50-7-prompt-only"
    );
  }, []);

  const areRuntimeGuardrailsEnabled = useCallback(
    () =>
      Boolean(sessionRef.current?.runtimeGuardrailsEnabled) &&
      !isPromptOnlySession(),
    [isPromptOnlySession]
  );

  const shouldStreamAudioBeforeDone = useCallback(() => {
    const activeSession = sessionRef.current;
    return (
      activeSession?.streamAudioBeforeDone === true ||
      activeSession?.latencyMode === "fastest_streaming"
    );
  }, []);

  const isV507QualitySession = useCallback(
    () => sessionRef.current?.backend === "grok-first-v50-7-quality",
    []
  );

  const createRealtimeResponse = useCallback((responseInstructions?: string) => {
    expectedAssistantResponseRef.current = true;
    responseCreateCountRef.current += 1;
    realtimeRef.current?.createResponse(responseInstructions);
  }, []);

  const cancelRealtimeResponse = useCallback((reason: string) => {
    responseCancelCountRef.current += 1;
    responseCancelReasonsRef.current.push(reason);
    realtimeRef.current?.cancelResponse();
  }, []);

  const sendRealtimeUserText = useCallback((text: string, responseInstructions?: string) => {
    expectedAssistantResponseRef.current = true;
    responseCreateCountRef.current += 1;
    realtimeRef.current?.sendUserText(text, responseInstructions);
  }, []);

  const runtimeFlagDetails = useCallback(
    (activeSession: GrokFirstV50Session) => ({
      runtimeControlMode: activeSession.runtimeControl?.mode ?? "default",
      runtimeControl: activeSession.runtimeControl,
      runtimeGuardrailsEnabled: activeSession.runtimeGuardrailsEnabled,
      inputGuardEnabled:
        activeSession.inputGuardEnabled ??
        activeSession.runtimeGuardrailsEnabled,
      normalInputRouterEnabled:
        activeSession.normalInputRouterEnabled ??
        activeSession.runtimeGuardrailsEnabled,
      negativeGuardEnabled:
        activeSession.negativeGuardEnabled ??
        activeSession.runtimeGuardrailsEnabled,
      tailGuardEnabled:
        activeSession.tailGuardEnabled ??
        activeSession.runtimeGuardrailsEnabled,
      fixedGuardAudioEnabled:
        activeSession.fixedGuardAudioEnabled ??
        activeSession.runtimeGuardrailsEnabled,
      boundedRewriteEnabled:
        activeSession.boundedRewriteEnabled ??
        activeSession.runtimeGuardrailsEnabled,
      noiseIgnoredEnabled:
        activeSession.noiseIgnoredEnabled ??
        activeSession.runtimeGuardrailsEnabled,
      responseCreateCount: responseCreateCountRef.current,
      responseCancelCount: responseCancelCountRef.current,
      responseCancelReasons: [...responseCancelReasonsRef.current],
      turnDetectionCreateResponse:
        activeSession.turnDetection.create_response !== false,
      latencyMode: activeSession.latencyMode ?? "default",
      streamAudioBeforeDone: activeSession.streamAudioBeforeDone === true,
      audioHoldMs: activeSession.audioHoldMs ?? undefined,
      turnDetectionSilenceMs: activeSession.turnDetection.silence_duration_ms,
    }),
    []
  );

  const evaluateActiveNegativeGuard = useCallback(
    (input: {
      text: string;
      userText: string;
      phase: "stream" | "final";
    }): NegativeGuardDecision => {
      if (!areRuntimeGuardrailsEnabled()) {
        return {
          action: "pass",
          reasons: [],
          stripTail: false,
          dropSentencePatterns: [],
          hardStop: false,
        };
      }
      return evaluateNegativeGuard(input);
    },
    [areRuntimeGuardrailsEnabled]
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
    releasedAudioBytesRef.current = 0;
    bufferedAudioChunksRef.current = [];
    bufferedAudioDroppedBytesRef.current = 0;
    bufferedAudioObservedRef.current = false;
    riskSafePrefixReadyRef.current = false;
    transcriptDeltasRef.current = [];
    eventOrderRef.current = 0;
    currentUserTextRef.current = "";
    normalizedUserTextRef.current = "";
    normalizationAppliedRef.current = false;
    normalizationReasonsRef.current = [];
    interimAgentClientIdRef.current = null;
    interimAgentMessageAppendedRef.current = false;
    hardSuppressedRef.current = false;
    fixedGuardActiveRef.current = false;
    ignoreNextEmptyResponseDoneRef.current = false;
    userSpeechInProgressRef.current = false;
    expectedAssistantResponseRef.current = false;
    agentSpeakingRef.current = false;
    responseCreateCountRef.current = 0;
    responseCancelCountRef.current = 0;
    responseCancelReasonsRef.current = [];
  }, []);

  const emitMetric = useCallback(
    (input: {
      routePath: GrokFirstV50Metric["routePath"];
      guardAction?: GrokFirstV50Metric["guardAction"];
      guardReasons?: string[];
      agentTextOverride?: string;
      audibleTextOverride?: string;
      error?: string | null;
      fullTurnBuffered?: boolean;
      audioReleaseMode?: AudioReleaseMode;
      rawTextBeforeGuard?: string;
      finalTextAfterGuard?: string;
      visibleTextOverride?: string;
      releasedAudioBytes?: number;
      droppedAudioBytes?: number;
      tailOnlyFallbackReason?: string | undefined;
      audioSource?: GrokFirstV50Metric["audioSource"];
    }) => {
      const activeSession = sessionRef.current;
      if (!activeSession) return;
      const startedAt = turnStartAtRef.current;
      const finalDecision = evaluateActiveNegativeGuard({
        text: accumulatedTextRef.current,
        userText: normalizedUserTextRef.current || currentUserTextRef.current,
        phase: "final",
      });
      const finalText =
        input.finalTextAfterGuard ??
        input.agentTextOverride ??
        (areRuntimeGuardrailsEnabled()
          ? applyNegativeGuardDeletionOnly(
              accumulatedTextRef.current,
              finalDecision
            )
          : accumulatedTextRef.current);
      const audibleText = input.audibleTextOverride ?? finalText;
      const visibleText = input.visibleTextOverride ?? finalText;
      const firstAudioDeltaMs =
        startedAt !== null && firstAudioDeltaAtRef.current !== null
          ? firstAudioDeltaAtRef.current - startedAt
          : null;
      const firstAudibleAudioMs =
        startedAt !== null && firstAudibleAudioAtRef.current !== null
          ? firstAudibleAudioAtRef.current - startedAt
          : null;
      const firstDeltaToFirstAudibleMs =
        firstAudioDeltaMs !== null && firstAudibleAudioMs !== null
          ? firstAudibleAudioMs - firstAudioDeltaMs
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
      const runtimeDetails = runtimeFlagDetails(activeSession);
      const generatedAudioBytes = accumulatedAudioBytesRef.current;
      const droppedAudioBytes =
        input.droppedAudioBytes ??
        tailGuardRef.current.getDroppedBytes() +
          bufferedAudioDroppedBytesRef.current;
      const releasedAudioBytes =
        input.releasedAudioBytes ?? releasedAudioBytesRef.current;
      const metric: GrokFirstV50Metric = {
        sessionId: activeSession.sessionId,
        turnIndex: turnIndexRef.current,
        inputMode: inputModeRef.current,
        routePath: input.routePath,
        userTextLen: currentUserTextRef.current.length,
        agentTextLen: visibleText.length,
        firstAudioDeltaMs,
        firstAudibleAudioMs,
        doneMs: startedAt !== null ? Date.now() - startedAt : null,
        audioBytes: generatedAudioBytes,
        audioSource:
          input.audioSource ??
          (isFixedGuard ? "static_guard_pcm_base64" : "xai_realtime_stream"),
        sttCompletedToGuardDetectedMs,
        guardDetectedToPlaybackStartedMs,
        fixedPlaybackDurationMs,
        fixedAudioBytes: isFixedGuard ? generatedAudioBytes : null,
        tailGuardHoldMs: tailGuardRef.current.getMaxObservedHoldMs(),
        tailAudioDroppedBytes: droppedAudioBytes,
        toolCallCount: 0,
        runtimeTtsCount: 0,
        fullTurnBufferCount: input.fullTurnBuffered ? 1 : 0,
        ...runtimeDetails,
        firstDeltaToFirstAudibleMs,
        rawAssistantTranscript: accumulatedTextRef.current,
        visibleAssistantTranscript: visibleText,
        audibleTranscript: audibleText,
        audibleTranscriptPreview: audibleText.slice(0, 200),
        declaredAudibleTranscript: audibleText,
        actualAudibleAuditTranscript: undefined,
        rawTextBeforeGuard: input.rawTextBeforeGuard ?? accumulatedTextRef.current,
        finalTextAfterGuard: finalText,
        generatedAudioBytes,
        heldAudioBytes:
          bufferedAudioObservedRef.current || input.fullTurnBuffered
            ? generatedAudioBytes
            : 0,
        releasedAudioBytes,
        droppedAudioBytes,
        audibleAudioBytes: releasedAudioBytes,
        audioReleaseMode: input.audioReleaseMode,
        tailOnlyFallbackReason: input.tailOnlyFallbackReason,
        potentialAudioLeak:
          Boolean(input.audioReleaseMode === "tail_only_release") &&
          releasedAudioBytes > 0 &&
          finalDecision.reasons.some((reason) =>
            [
              "customer_led_sales_flow",
              "forbidden_suffix",
              "generic_closing_question",
              "unnatural_ai_phrase",
            ].includes(reason)
          ),
        potentialAudioLeakReasons:
          Boolean(input.audioReleaseMode === "tail_only_release") &&
          releasedAudioBytes > 0 &&
          finalDecision.reasons.some((reason) =>
            [
              "customer_led_sales_flow",
              "forbidden_suffix",
              "generic_closing_question",
              "unnatural_ai_phrase",
            ].includes(reason)
          )
            ? ["tail_only_release_without_actual_audio_audit"]
            : [],
        normalizedUserText: normalizedUserTextRef.current || undefined,
        normalizationApplied: normalizationAppliedRef.current,
        normalizationReasons: [...normalizationReasonsRef.current],
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
          normalizedUserTextPreview:
            normalizedUserTextRef.current.slice(0, 200),
          agentTextPreview: visibleText.slice(0, 200),
        },
      });
    },
    [
      areRuntimeGuardrailsEnabled,
      evaluateActiveNegativeGuard,
      postEvent,
      runtimeFlagDetails,
    ]
  );

  const releaseChunks = useCallback(
    (chunks: { base64: string; bytes: number }[]) => {
      let releasedBytes = 0;
      for (const chunk of chunks) {
        if (firstAudibleAudioAtRef.current === null) {
          firstAudibleAudioAtRef.current = Date.now();
        }
        releasedBytes += chunk.bytes;
        ensureAudioQueue().enqueueBase64(chunk.base64);
      }
      releasedAudioBytesRef.current += releasedBytes;
      return releasedBytes;
    },
    [ensureAudioQueue]
  );

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

  const playOpeningAudio = useCallback(
    async (nextSession: GrokFirstV50Session) => {
      if (nextSession.backend !== "grok-first-v50-7-quality") return;
      const text = (nextSession.firstMessage ?? "").trim();
      if (!text) return;
      const startedAt = Date.now();
      const wasMicEnabled = !mutedRef.current;
      try {
        micRef.current?.setEnabled(false);
        const greeting =
          await (deps.fetchOpeningAudio ?? fetchGrokFirstV50Greeting)({
            sessionId: nextSession.sessionId,
            text,
          });
        const audioBytes = Math.floor((greeting.audioBase64.length * 3) / 4);
        const firstAudibleAudioMs = Date.now() - startedAt;
        void postEvent({
          kind: "opening.playback.started",
          sessionId: nextSession.sessionId,
          details: {
            textLen: text.length,
            audioBytes,
            firstAudibleAudioMs,
            vendorMs: greeting.vendorMs ?? null,
            cacheStatus: greeting.cacheStatus ?? "unknown",
            voiceId: greeting.voiceId,
          },
        });
        setStatus("speaking");
        await ensureAudioQueue().enqueueBase64AndWait(greeting.audioBase64);
        void postEvent({
          kind: "opening.playback.completed",
          sessionId: nextSession.sessionId,
          details: {
            textLen: text.length,
            audioBytes,
            firstAudibleAudioMs,
            durationMs: Date.now() - startedAt,
            vendorMs: greeting.vendorMs ?? null,
            cacheStatus: greeting.cacheStatus ?? "unknown",
            voiceId: greeting.voiceId,
          },
        });
      } catch (error) {
        void postEvent({
          kind: "opening.playback.failed",
          sessionId: nextSession.sessionId,
          details: {
            textLen: text.length,
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      } finally {
        micRef.current?.setEnabled(wasMicEnabled && !mutedRef.current);
        setStatus(mutedRef.current ? "muted" : "listening");
      }
    },
    [deps.fetchOpeningAudio, ensureAudioQueue, postEvent]
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
      cancelRealtimeResponse("fixed_input_guard");
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
        releasedAudioBytesRef.current += fixedAudioBytes;
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
          audibleTextOverride: input.guard.fixedText,
          audioReleaseMode: "fixed_guard_static_audio",
          releasedAudioBytes: fixedAudioBytes,
          droppedAudioBytes:
            tailGuardRef.current.getDroppedBytes() +
            bufferedAudioDroppedBytesRef.current,
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
      cancelRealtimeResponse,
      clearBufferedAudio,
      emitMetric,
      ensureAudioQueue,
      postEvent,
      resetTurn,
    ]
  );

  const handleNormalInputRouteDecision = useCallback(
    async (input: {
      text: string;
      decision: NormalInputRouteDecision;
      channel: "voice" | "chat";
    }) => {
      const activeSession = sessionRef.current;
      if (!activeSession || input.decision.action === "pass") return;

      guardDetectedAtRef.current = Date.now();
      hardSuppressedRef.current = true;
      expectedAssistantResponseRef.current = false;
      cancelRealtimeResponse("normal_input_suppression");
      normalInputDrainUntilRef.current = Date.now() + 1_500;
      const dropped = tailGuardRef.current.clear();
      const bufferedDroppedBytes = clearBufferedAudio();
      audioQueueRef.current?.clearAllScheduledAudioForLock();

      appendUserTranscript({
        text: input.text,
        channel: input.channel,
        status: input.channel === "voice" ? "final" : "sent",
      });
      const shouldPlayShortAck =
        activeSession.backend === "grok-first-v50-7-quality" &&
        input.decision.shouldSpeak &&
        Boolean(input.decision.fixedText);
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

      let playbackError: string | null = null;
      let shortAckAudioBytes = 0;
      let shortAckPlayed = false;
      if (shouldPlayShortAck && input.decision.fixedText) {
        const playbackStartedAt = Date.now();
        fixedPlaybackStartedAtRef.current = playbackStartedAt;
        try {
          micRef.current?.setEnabled(false);
          const shortAck =
            await (deps.fetchShortAckAudio ?? fetchGrokFirstV50ShortAck)({
              sessionId: activeSession.sessionId,
              text: input.decision.fixedText,
            });
          shortAckAudioBytes = Math.floor((shortAck.audioBase64.length * 3) / 4);
          if (firstAudioDeltaAtRef.current === null) {
            firstAudioDeltaAtRef.current = playbackStartedAt;
          }
          if (firstAudibleAudioAtRef.current === null) {
            firstAudibleAudioAtRef.current = playbackStartedAt;
          }
          accumulatedAudioBytesRef.current += shortAckAudioBytes;
          releasedAudioBytesRef.current += shortAckAudioBytes;
          setStatus("speaking");
          await ensureAudioQueue().enqueueBase64AndWait(shortAck.audioBase64);
          appendFixedAssistantTranscript(input.decision.fixedText);
          shortAckPlayed = true;
        } catch (error) {
          playbackError = error instanceof Error ? error.message : String(error);
          setErrorMessage(AUDIO_ERROR);
        } finally {
          fixedPlaybackCompletedAtRef.current = Date.now();
        }
      }

      emitMetric({
        routePath: "noise_ignored",
        guardAction: "suppress",
        guardReasons: input.decision.reasons,
        agentTextOverride: shortAckPlayed ? input.decision.fixedText ?? "" : "",
        audibleTextOverride: shortAckPlayed ? input.decision.fixedText ?? "" : "",
        audioReleaseMode: shortAckPlayed
          ? "fixed_short_ack_audio"
          : "noise_ignored_no_audio",
        ...(shortAckPlayed
          ? { audioSource: "static_short_ack_tts" as const }
          : {}),
        releasedAudioBytes: shortAckPlayed ? shortAckAudioBytes : 0,
        droppedAudioBytes:
          tailGuardRef.current.getDroppedBytes() +
          bufferedAudioDroppedBytesRef.current,
        error: playbackError,
      });
      resetTurn();
      micRef.current?.setEnabled(!mutedRef.current);
      setStatus(mutedRef.current ? "muted" : "listening");
    },
    [
      appendFixedAssistantTranscript,
      appendUserTranscript,
      cancelRealtimeResponse,
      clearBufferedAudio,
      deps.fetchShortAckAudio,
      emitMetric,
      ensureAudioQueue,
      postEvent,
      resetTurn,
    ]
  );

  const handleServerEvent = useCallback(
    (event: GrokFirstV50ServerEvent) => {
      const activeSession = sessionRef.current;
      if (!activeSession) return;

      const runtimeGuardrailsEnabled = areRuntimeGuardrailsEnabled();

      const drainReason = assistantResponseDrainReason();
      if (runtimeGuardrailsEnabled && drainReason && isAssistantResponseEvent(event.type)) {
        void postEvent({
          kind: "guard.drain.ignored",
          sessionId: activeSession.sessionId,
          details: {
            turnIndex: turnIndexRef.current,
            eventType: event.type,
            drain: drainReason,
          },
        });
        return;
      }

      if (
        runtimeGuardrailsEnabled &&
        isV507QualitySession() &&
        isAssistantResponseEvent(event.type) &&
        !expectedAssistantResponseRef.current
      ) {
        void postEvent({
          kind: "orphan_assistant_response.ignored",
          sessionId: activeSession.sessionId,
          details: {
            turnIndex: turnIndexRef.current,
            eventType: event.type,
            reason: "no_active_user_turn",
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
          const normalInputRouterEnabled =
            activeSession.normalInputRouterEnabled ?? runtimeGuardrailsEnabled;
          const rawNormalization =
            runtimeGuardrailsEnabled && shouldNormalizeUserText(activeSession)
            ? normalizeGrokFirstUserText(text)
            : passthroughNormalization(text);
          const normalization = enrichNormalizationReasons({
            text,
            normalization: rawNormalization,
            inputGuardEnabled: runtimeGuardrailsEnabled,
            normalInputRouterEnabled,
          });
          normalizedUserTextRef.current = normalization.normalizedText;
          normalizationAppliedRef.current = normalization.normalizationApplied;
          normalizationReasonsRef.current = normalization.normalizationReasons;
          const guard = runtimeGuardrailsEnabled
            ? classifyInputGuard(normalization.normalizedText)
            : null;
          if (guard && isFixedInputGuardDecision(guard)) {
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
                sttTextPreview: text.slice(0, 200),
                normalizedUserText: normalization.normalizedText,
                normalizationApplied: normalization.normalizationApplied,
                normalizationReasons: normalization.normalizationReasons,
                guardAction: guard.action,
              },
            });
            break;
          }
          const normalRoute = normalInputRouterEnabled
            ? classifyNormalInputRoute(normalization.normalizedText)
            : null;
          if (normalRoute && normalRoute.action !== "pass") {
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
                sttTextPreview: text.slice(0, 200),
                normalizedUserText: normalization.normalizedText,
                normalizationApplied: normalization.normalizationApplied,
                normalizationReasons: normalization.normalizationReasons,
                guardAction: normalRoute.action,
                guardReasons: normalRoute.reasons,
              },
            });
            break;
          }
          const boundedRewriteEnabled =
            activeSession.boundedRewriteEnabled ?? runtimeGuardrailsEnabled;
          const normalizedRealtimeText = "";
          const realtimeRewriteText =
            boundedRewriteEnabled ? normalRoute?.rewrittenText ?? normalizedRealtimeText : "";
          if (realtimeRewriteText) {
            userSpeechInProgressRef.current = false;
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
                reasons: [
                  ...(normalRoute?.reasons ?? []),
                  ...normalization.normalizationReasons,
                ],
                originalTextLen: text.length,
                normalizedUserText: normalization.normalizedText,
                normalizationApplied: normalization.normalizationApplied,
                normalizationReasons: normalization.normalizationReasons,
                rewrittenTextLen: realtimeRewriteText.length,
                tailAudioDroppedBytes: dropped.droppedBytes + bufferedDroppedBytes,
              },
            });
            if (
              isV507QualitySession() &&
              DETERMINISTIC_SAFE_BODY_TEXTS.has(realtimeRewriteText)
            ) {
              void (async () => {
                void postEvent({
                  kind: "stt.completed",
                  sessionId: activeSession.sessionId,
                  details: {
                    turnIndex: turnIndexRef.current,
                    textLen: text.length,
                    sttTextPreview: text.slice(0, 200),
                    normalizedUserText: normalization.normalizedText,
                    normalizationApplied: normalization.normalizationApplied,
                    normalizationReasons: normalization.normalizationReasons,
                    guardAction: "normal_realtime_rewrite",
                    guardReasons: [
                      ...(normalRoute?.reasons ?? []),
                      ...normalization.normalizationReasons,
                    ],
                  },
                });
                let playbackError: string | null = null;
                let safeBodyAudioBytes = 0;
                try {
                  const safeBodyAudio =
                    await (deps.fetchShortAckAudio ?? fetchGrokFirstV50ShortAck)({
                      sessionId: activeSession.sessionId,
                      text: realtimeRewriteText,
                    });
                  safeBodyAudioBytes = Math.floor(
                    (safeBodyAudio.audioBase64.length * 3) / 4
                  );
                  const playbackStartedAt = Date.now();
                  fixedPlaybackStartedAtRef.current = playbackStartedAt;
                  firstAudioDeltaAtRef.current = playbackStartedAt;
                  firstAudibleAudioAtRef.current = playbackStartedAt;
                  accumulatedTextRef.current = realtimeRewriteText;
                  accumulatedAudioBytesRef.current = safeBodyAudioBytes;
                  releasedAudioBytesRef.current = safeBodyAudioBytes;
                  setStatus("speaking");
                  await ensureAudioQueue().enqueueBase64AndWait(
                    safeBodyAudio.audioBase64
                  );
                  appendFixedAssistantTranscript(realtimeRewriteText);
                } catch (error) {
                  playbackError =
                    error instanceof Error ? error.message : String(error);
                  setErrorMessage(AUDIO_ERROR);
                } finally {
                  fixedPlaybackCompletedAtRef.current = Date.now();
                }
                emitMetric({
                  routePath: "grok_first_realtime",
                  guardAction: "pass",
                  guardReasons: [
                    ...(normalRoute?.reasons ?? []),
                    ...normalization.normalizationReasons,
                    "deterministic_safe_body_audio",
                  ],
                  agentTextOverride: playbackError ? "" : realtimeRewriteText,
                  audibleTextOverride: playbackError ? "" : realtimeRewriteText,
                  rawTextBeforeGuard: playbackError ? "" : realtimeRewriteText,
                  finalTextAfterGuard: playbackError ? "" : realtimeRewriteText,
                  audioReleaseMode: "fixed_safe_body_audio",
                  audioSource: "static_safe_body_tts",
                  releasedAudioBytes: playbackError ? 0 : safeBodyAudioBytes,
                  droppedAudioBytes:
                    dropped.droppedBytes + bufferedDroppedBytes,
                  error: playbackError,
                });
                resetTurn();
                micRef.current?.setEnabled(!mutedRef.current);
                setStatus(mutedRef.current ? "muted" : "listening");
              })();
              break;
            }
            createRealtimeResponse(realtimeRewriteText);
            const rewriteSessionId = activeSession.sessionId;
            const rewriteTurnIndex = turnIndexRef.current;
            window.setTimeout(() => {
              if (sessionRef.current?.sessionId !== rewriteSessionId) return;
              if (turnIndexRef.current !== rewriteTurnIndex) return;
              if (accumulatedTextRef.current) return;
              if (hardSuppressedRef.current) return;
              if (fixedGuardActiveRef.current) return;
              createRealtimeResponse();
              void postEvent({
                kind: "guard.rewrite_response_retry",
                sessionId: rewriteSessionId,
                details: {
                  turnIndex: rewriteTurnIndex,
                  reason: "normal_realtime_rewrite_no_response_created",
                },
              });
            }, 1500);
            void postEvent({
              kind: "stt.completed",
              sessionId: activeSession.sessionId,
              details: {
                turnIndex: turnIndexRef.current,
                textLen: text.length,
                sttTextPreview: text.slice(0, 200),
                normalizedUserText: normalization.normalizedText,
                normalizationApplied: normalization.normalizationApplied,
                normalizationReasons: normalization.normalizationReasons,
                guardAction: "normal_realtime_rewrite",
                guardReasons: [
                  ...(normalRoute?.reasons ?? []),
                  ...normalization.normalizationReasons,
                ],
              },
            });
            break;
          }
          appendUserTranscript({ text, channel: "voice", status: "final" });
          userSpeechInProgressRef.current = false;
          micRef.current?.setEnabled(false);
          createRealtimeResponse();
          void postEvent({
            kind: "stt.completed",
            sessionId: activeSession.sessionId,
            details: {
              turnIndex: turnIndexRef.current,
              textLen: text.length,
              sttTextPreview: text.slice(0, 200),
              normalizedUserText: normalization.normalizedText,
              normalizationApplied: normalization.normalizationApplied,
              normalizationReasons: normalization.normalizationReasons,
            },
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
          const order = eventOrderRef.current++;
          accumulatedTextRef.current += delta;
          transcriptDeltasRef.current.push({
            text: delta,
            cumulativeText: accumulatedTextRef.current,
            at: Date.now(),
            order,
          });
          const streamDecision = evaluateActiveNegativeGuard({
            text: accumulatedTextRef.current,
            userText: normalizedUserTextRef.current || currentUserTextRef.current,
            phase: "stream",
          });
          const tailOnlyCandidate =
            streamDecision.action === "strip_tail" ||
            streamDecision.action === "drop_sentence";
          const qualitySession = isV507QualitySession();
          const shouldCancelStream =
            streamDecision.action === "cancel" ||
            streamDecision.action === "suppress";
          const hardStreamBlock =
            shouldCancelStream &&
            (!qualitySession || streamDecision.hardStop);
          if (
            hardStreamBlock ||
            (tailOnlyCandidate && !qualitySession)
          ) {
            hardSuppressedRef.current = true;
            cancelRealtimeResponse(
              tailOnlyCandidate
                ? "negative_output_guard_stream_tail_legacy_drop"
                : "negative_output_guard_stream"
            );
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
          const visible = runtimeGuardrailsEnabled
            ? applyNegativeGuardDeletionOnly(
                accumulatedTextRef.current,
                streamDecision
              )
            : accumulatedTextRef.current;
          if (
            qualitySession &&
            (streamDecision.action === "pass" ||
              streamDecision.action === "metric") &&
            hasCompleteSentence(visible)
          ) {
            riskSafePrefixReadyRef.current = true;
          }
          if (!qualitySession || shouldStreamAudioBeforeDone()) {
            ensureInterimAgentTranscript(activeSession, visible, "interim");
          }
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
          const order = eventOrderRef.current++;
          const bytes = Math.floor((base64.length * 3) / 4);
          accumulatedAudioBytesRef.current += bytes;
          if (shouldStreamAudioBeforeDone()) {
            releaseChunks([toBufferedAudioChunk(base64, now, order)]);
          } else if (runtimeGuardrailsEnabled) {
            bufferedAudioObservedRef.current = true;
            bufferedAudioChunksRef.current.push(
              toBufferedAudioChunk(base64, now, order)
            );
          } else {
            releaseChunks([toBufferedAudioChunk(base64, now, order)]);
          }
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
          expectedAssistantResponseRef.current = false;
          const rawTextBeforeGuard = accumulatedTextRef.current;
          const decision = evaluateActiveNegativeGuard({
            text: rawTextBeforeGuard,
            userText: normalizedUserTextRef.current || currentUserTextRef.current,
            phase: "final",
          });
          const streamingBeforeDone = shouldStreamAudioBeforeDone();
          const release = runtimeGuardrailsEnabled && !streamingBeforeDone
            ? tailGuardRef.current.finalize(decision)
            : { chunks: [], droppedBytes: 0 };
          const hardBlockDecision =
            runtimeGuardrailsEnabled &&
            (wasHardSuppressed ||
              decision.action === "cancel" ||
              decision.action === "suppress");
          const hadBufferedAudio = bufferedAudioObservedRef.current;
          const bufferedChunks = bufferedAudioChunksRef.current;
          bufferedAudioChunksRef.current = [];
          const releasedTailChunks: BufferedAudioChunk[] = release.chunks.map(
            (chunk, index) => ({
              ...chunk,
              at: Date.now(),
              order: index - release.chunks.length,
            })
          );
          const finalText = runtimeGuardrailsEnabled
            ? applyNegativeGuardDeletionOnly(rawTextBeforeGuard, decision)
            : rawTextBeforeGuard;
          let routePath: GrokFirstV50Metric["routePath"] =
            wasHardSuppressed || decision.action === "suppress"
              ? "suppressed"
              : "grok_first_realtime";
          let guardAction: GrokFirstV50Metric["guardAction"] =
            wasHardSuppressed ? "cancel" : decision.action;
          let audioReleaseMode: AudioReleaseMode =
            streamingBeforeDone ||
            (!runtimeGuardrailsEnabled && releasedAudioBytesRef.current > 0)
              ? "pass_stream_release"
              : "pass_buffer_release";
          let audibleText = finalText;
          let releasedAudioBytes = releasedAudioBytesRef.current;
          let droppedAudioBytes = release.droppedBytes;
          let tailOnlyFallbackReason: string | undefined;

          const tailOnlyReleaseEnabled = isV507QualitySession();
          if (runtimeGuardrailsEnabled && !streamingBeforeDone) {
            const allBufferedChunks = [...releasedTailChunks, ...bufferedChunks];
            if (hardBlockDecision) {
              const bufferedDroppedBytes = sumAudioBytes(allBufferedChunks);
              bufferedAudioDroppedBytesRef.current += bufferedDroppedBytes;
              droppedAudioBytes += bufferedDroppedBytes;
              audioReleaseMode = "hard_block_drop";
              audibleText = "";
            } else if (
              decision.action === "strip_tail" ||
              decision.action === "drop_sentence"
            ) {
              const finalTextDecision = tailOnlyReleaseEnabled
                ? evaluateActiveNegativeGuard({
                    text: finalText,
                    userText:
                      normalizedUserTextRef.current || currentUserTextRef.current,
                    phase: "final",
                  })
                : null;
              const finalTextIsSafe =
                tailOnlyReleaseEnabled &&
                finalText.trim().length > 0 &&
                (finalTextDecision?.action === "pass" ||
                  finalTextDecision?.action === "metric");
              const plan = finalTextIsSafe
                ? planTailOnlyRelease({
                    rawText: rawTextBeforeGuard,
                    finalText,
                    chunks: allBufferedChunks,
                    transcriptDeltas: transcriptDeltasRef.current,
                  })
                : {
                    ok: false as const,
                    droppedBytes: sumAudioBytes(allBufferedChunks),
                    reason: finalText.trim()
                      ? "final_text_still_guarded"
                      : "empty_final_text",
                  };
              if (plan.ok) {
                routePath = "grok_first_realtime";
                audioReleaseMode = "tail_only_release";
                audibleText = finalText;
                setStatus("speaking");
                releasedAudioBytes += releaseChunks(plan.chunks);
                droppedAudioBytes += plan.droppedBytes;
                bufferedAudioDroppedBytesRef.current += plan.droppedBytes;
              } else {
                routePath = "suppressed";
                audioReleaseMode = "tail_only_drop_fallback";
                audibleText = "";
                tailOnlyFallbackReason = plan.reason;
                droppedAudioBytes += plan.droppedBytes;
                bufferedAudioDroppedBytesRef.current += plan.droppedBytes;
              }
            } else {
              audioReleaseMode =
                releasedAudioBytesRef.current > 0
                  ? "pass_stream_release"
                  : "pass_buffer_release";
              setStatus("speaking");
              releasedAudioBytes += releaseChunks(allBufferedChunks);
            }
          } else if (runtimeGuardrailsEnabled && streamingBeforeDone && hardBlockDecision) {
            audioReleaseMode = "hard_block_drop";
            audibleText = "";
          }

          if (droppedAudioBytes > 0) {
            void postEvent({
              kind: "tail_guard.dropped",
              sessionId: activeSession.sessionId,
              details: {
                turnIndex: turnIndexRef.current,
                action: decision.action,
                reasons: decision.reasons,
                droppedBytes: droppedAudioBytes,
                audioReleaseMode,
                tailOnlyFallbackReason,
                userText: normalizedUserTextRef.current || currentUserTextRef.current,
                rawTextBeforeGuard,
                finalTextAfterGuard: finalText,
              },
            });
          }
          const displayedText =
            audioReleaseMode === "hard_block_drop" ||
            audioReleaseMode === "tail_only_drop_fallback"
              ? audibleText
              : audibleText || finalText;
          ensureInterimAgentTranscript(activeSession, displayedText, "final");
          emitMetric({
            routePath,
            guardAction,
            guardReasons: decision.reasons,
            agentTextOverride: displayedText,
            audibleTextOverride: audibleText,
            visibleTextOverride: displayedText,
            audioReleaseMode,
            rawTextBeforeGuard,
            finalTextAfterGuard: finalText,
            releasedAudioBytes,
            droppedAudioBytes:
              tailGuardRef.current.getDroppedBytes() +
              bufferedAudioDroppedBytesRef.current,
            tailOnlyFallbackReason,
            fullTurnBuffered:
              runtimeGuardrailsEnabled && hadBufferedAudio && !streamingBeforeDone,
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
      areRuntimeGuardrailsEnabled,
      assistantResponseDrainReason,
      cancelRealtimeResponse,
      clearBufferedAudio,
      createRealtimeResponse,
      emitMetric,
      evaluateActiveNegativeGuard,
      ensureInterimAgentTranscript,
      handleFixedGuardDecision,
      handleNormalInputRouteDecision,
      isV507QualitySession,
      postEvent,
      releaseChunks,
      resetTurn,
      sendRealtimeUserText,
      shouldStreamAudioBeforeDone,
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
              realtimeRef.current?.markServerSideSetupReady();
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
            void playOpeningAudio(nextSession);
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
    playOpeningAudio,
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
      const runtimeGuardrailsEnabled = areRuntimeGuardrailsEnabled();
      const normalInputRouterEnabled =
        activeSession.normalInputRouterEnabled ?? runtimeGuardrailsEnabled;
      const rawNormalization =
        runtimeGuardrailsEnabled && shouldNormalizeUserText(activeSession)
        ? normalizeGrokFirstUserText(trimmed)
        : passthroughNormalization(trimmed);
      const normalization = enrichNormalizationReasons({
        text: trimmed,
        normalization: rawNormalization,
        inputGuardEnabled: runtimeGuardrailsEnabled,
        normalInputRouterEnabled,
      });
      normalizedUserTextRef.current = normalization.normalizedText;
      normalizationAppliedRef.current = normalization.normalizationApplied;
      normalizationReasonsRef.current = normalization.normalizationReasons;
      const guard = runtimeGuardrailsEnabled
        ? classifyInputGuard(normalization.normalizedText)
        : null;
      if (guard && isFixedInputGuardDecision(guard)) {
        void handleFixedGuardDecision({
          text: trimmed,
          guard,
          channel: "chat",
        });
        return;
      }
      const normalRoute = normalInputRouterEnabled
        ? classifyNormalInputRoute(normalization.normalizedText)
        : null;
      if (normalRoute && normalRoute.action !== "pass") {
        handleNormalInputRouteDecision({
          text: trimmed,
          decision: normalRoute,
          channel: "chat",
        });
        return;
      }
      const boundedRewriteEnabled =
        activeSession.boundedRewriteEnabled ?? runtimeGuardrailsEnabled;
      const normalizedRealtimeText = "";
      const realtimeRewriteText =
        boundedRewriteEnabled ? normalRoute?.rewrittenText ?? normalizedRealtimeText : "";
      if (realtimeRewriteText) {
        void postEvent({
          kind: "guard.detected",
          sessionId: activeSession.sessionId,
          details: {
            turnIndex: turnIndexRef.current,
            action: "normal_realtime_rewrite",
            reasons: [
              ...(normalRoute?.reasons ?? []),
              ...normalization.normalizationReasons,
            ],
            originalTextLen: trimmed.length,
            normalizedUserText: normalization.normalizedText,
            normalizationApplied: normalization.normalizationApplied,
            normalizationReasons: normalization.normalizationReasons,
            rewrittenTextLen: realtimeRewriteText.length,
            tailAudioDroppedBytes: 0,
          },
        });
      }
      appendUserTranscript({ text: trimmed, channel: "chat", status: "sent" });
      setStatus("thinking");
      sendRealtimeUserText(trimmed, realtimeRewriteText || undefined);
    },
    [
      appendUserTranscript,
      areRuntimeGuardrailsEnabled,
      handleFixedGuardDecision,
      handleNormalInputRouteDecision,
      postEvent,
      resetTurn,
      sendRealtimeUserText,
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

function passthroughNormalization(text: string): UserTextNormalization {
  return {
    originalText: text,
    normalizedText: text,
    normalizationApplied: false,
    normalizationReasons: [],
  };
}

function enrichNormalizationReasons({
  text,
  normalization,
  inputGuardEnabled,
  normalInputRouterEnabled,
}: {
  text: string;
  normalization: UserTextNormalization;
  inputGuardEnabled: boolean;
  normalInputRouterEnabled: boolean;
}): UserTextNormalization {
  if (!normalization.normalizationApplied || normalization.normalizedText === text) {
    return normalization;
  }

  const reasons = new Set(normalization.normalizationReasons);
  if (inputGuardEnabled) {
    const before = classifyInputGuard(text);
    const after = classifyInputGuard(normalization.normalizedText);
    if (before.action !== after.action) {
      reasons.add(`normalization_changed_input_guard:${before.action}->${after.action}`);
    }
  }
  if (normalInputRouterEnabled) {
    const before = classifyNormalInputRoute(text);
    const after = classifyNormalInputRoute(normalization.normalizedText);
    if (before.action !== after.action) {
      reasons.add(`normalization_changed_normal_route:${before.action}->${after.action}`);
    }
    if (Boolean(before.rewrittenText) !== Boolean(after.rewrittenText)) {
      reasons.add("normalization_changed_rewrite_selection");
    }
  }

  return {
    ...normalization,
    normalizationReasons: [...reasons],
  };
}

function shouldNormalizeUserText(session: GrokFirstV50Session): boolean {
  return session.backend === "grok-first-v50-7-quality";
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
