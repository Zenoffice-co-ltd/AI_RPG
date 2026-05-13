// Structured logging for the Grok Voice (`xai`/`grok-voice-think-fast-1.0`)
// roleplay backend. All payloads are emitted as a single line of JSON so that
// Cloud Logging picks them up via `jsonPayload.scope=~"^grokVoice\\."`.

export type GrokVoiceProvenance = {
  promptVersion: string;
  agentSystemPromptHash: string;
  knowledgeBaseTextHash: string;
  promptSectionsHash: string;
  guardrailVersion: string;
  grokVoiceModel: string;
  grokVoiceVoiceId: string;
  demoSlug?: string;
  routerVariant?: string;
  realtimeTransport?: string;
};

type LogPayload = Record<string, unknown>;

function emit(scope: string, payload: LogPayload) {
  console.log(JSON.stringify({ scope, ...payload }));
}

export function logGrokVoiceSessionCreated(payload: {
  sessionId: string;
  ephemeralExpiresAt?: string | undefined;
  provenance: GrokVoiceProvenance;
  demoSlug?: string;
  routerVariant?: string;
  realtimeTransport?: string;
}) {
  emit("grokVoice.session.created", {
    sessionId: payload.sessionId,
    ...(payload.ephemeralExpiresAt
      ? { ephemeralExpiresAt: payload.ephemeralExpiresAt }
      : {}),
    ...(payload.demoSlug ? { demoSlug: payload.demoSlug } : {}),
    ...(payload.routerVariant ? { routerVariant: payload.routerVariant } : {}),
    ...(payload.realtimeTransport
      ? { realtimeTransport: payload.realtimeTransport }
      : {}),
    ...payload.provenance,
  });
}

export function logGrokVoiceClientEvent(payload: {
  kind: string;
  sessionId: string | null;
  details: Record<string, unknown>;
  ip: string;
}) {
  emit("grokVoice.clientEvent", {
    ...payload,
    demoSlug: stringFromDetails(payload.details, "demoSlug"),
    routerVariant: stringFromDetails(payload.details, "routerVariant"),
    realtimeTransport: stringFromDetails(
      payload.details,
      "realtimeTransport"
    ),
  });
}

// Voice latency observability fields (PR A — Phase 0 of latency-first roadmap).
//
// Why these fields, in plain language:
//   - firstAudibleAudioMs is the primary KPI. It's the time from
//     end-of-user-speech to the moment the user actually HEARS AI audio.
//     firstAudioMs (legacy) is the time the first audio delta ARRIVED at
//     the client — it does NOT include the strict-sanitized-playback gate
//     that buffers audio until response.done. firstAudibleAudioMs DOES.
//   - routePath says which path served the turn. Without it we can't tell
//     why a turn was fast or slow (lock-text is fast for free; rt-voice
//     speed depends on xAI; lock-voice today still pays an HTTP roundtrip).
//   - cacheLookupMs is the ACTUAL hit-retrieval latency for locked
//     responses. Do not confuse with `vendorMs` on a cache hit, which is
//     the synth time stamped at cache-creation, not now.
//   - localLockedAudioHit is reserved for PR B; in PR A it is always
//     false. Emitting it now keeps the dashboard schema stable across the
//     roadmap.
//
// All fields are optional so PR A is a pure observability addition with
// no behavior change.
export type GrokVoiceRoutePath =
  | "lock_text"
  | "lock_voice_local_audio"
  | "lock_voice_network_tts"
  | "rt_text"
  | "rt_voice"
  | "registered_speech_local"
  | "registered_speech_fallback"
  | "registered_speech_multi_intent_redirect"
  | "registered_speech_decision_maker"
  | "noise_fragment_ignored"
  | "runtime_guarded_generation"
  | "unknown";

export function logGrokVoiceTurnMetrics(payload: {
  sessionId: string;
  turnIndex: number;
  inputMode: "voice" | "text";
  userTextLen: number;
  agentTextLen: number;
  firstAudioMs: number | null;
  doneMs: number | null;
  audioBytes: number;
  error: string | null;
  userTextPreview?: string;
  agentTextPreview?: string;
  agentSpokenTextPreview?: string;
  userTextPreviewUtf8Base64?: string;
  agentTextPreviewUtf8Base64?: string;
  agentSpokenTextPreviewUtf8Base64?: string;
  provenance: GrokVoiceProvenance;
  demoSlug?: string;
  routerVariant?: string;
  realtimeTransport?: string;
  // PR A latency observability (all optional — backwards compatible).
  routePath?: GrokVoiceRoutePath;
  routeStage?: string | null;
  fallbackReason?: string | null;
  shouldRespond?: boolean;
  registeredSpeechIntent?: string | null;
  registeredSpeechSha256?: string | null;
  registeredSpeechManifestBuildId?: string | null;
  guardAction?: string | null;
  inputDepth?: string | null;
  fallbackIntent?: string | null;
  forbiddenSuffixDetected?: boolean;
  closingQuestionDetected?: boolean;
  hardBannedTextDetected?: boolean;
  metaLanguageDetected?: boolean;
  overAnsweringDetected?: boolean;
  guardFailedTextWasNotSpoken?: boolean;
  audioEmittedAfterGuard?: boolean;
  firstAudibleAudioMs?: number | null;
  firstRealtimeAudioDeltaMs?: number | null;
  sttFinalMs?: number | null;
  lockDecisionMs?: number | null;
  localLockedAudioHit?: boolean;
  lockedResponseKey?: string | null;
  cacheStatus?: "hit" | "miss" | null;
  cacheLookupMs?: number | null;
  ttsVendorMsAtCreation?: number | null;
  networkTtsMs?: number | null;
  audioDecodeMs?: number | null;
  sanitizerDelayMs?: number | null;
  sanitizedTtsMs?: number | null;
  reseedMs?: number | null;
  outcome?: string | null;
  sessionTainted?: boolean;
  parentSessionId?: string | null;
  cloudRunRevision?: string;
  // PR D — risk-based strict playback observability.
  strictPlaybackMode?: "all_turns" | "risk_based" | "monitor_only";
  strictGateApplied?: boolean;
  strictGateReason?: string | null;
  streamingBeforeDone?: boolean;
}) {
  emit("grokVoice.turnMetrics", {
    sessionId: payload.sessionId,
    turnIndex: payload.turnIndex,
    inputMode: payload.inputMode,
    userTextLen: payload.userTextLen,
    agentTextLen: payload.agentTextLen,
    firstAudioMs: payload.firstAudioMs,
    doneMs: payload.doneMs,
    audioBytes: payload.audioBytes,
    error: payload.error,
    ...(payload.userTextPreview ? { userTextPreview: payload.userTextPreview } : {}),
    ...(payload.agentTextPreview ? { agentTextPreview: payload.agentTextPreview } : {}),
    ...(payload.agentSpokenTextPreview
      ? { agentSpokenTextPreview: payload.agentSpokenTextPreview }
      : {}),
    ...(payload.userTextPreviewUtf8Base64
      ? { userTextPreviewUtf8Base64: payload.userTextPreviewUtf8Base64 }
      : {}),
    ...(payload.agentTextPreviewUtf8Base64
      ? { agentTextPreviewUtf8Base64: payload.agentTextPreviewUtf8Base64 }
      : {}),
    ...(payload.agentSpokenTextPreviewUtf8Base64
      ? {
          agentSpokenTextPreviewUtf8Base64:
            payload.agentSpokenTextPreviewUtf8Base64,
        }
      : {}),
    // Latency observability fields. Emit each one only when defined so
    // the BigQuery / Logs Explorer schema stays sparse and queryable.
    ...(payload.routePath !== undefined ? { routePath: payload.routePath } : {}),
    ...(payload.demoSlug ? { demoSlug: payload.demoSlug } : {}),
    ...(payload.routerVariant ? { routerVariant: payload.routerVariant } : {}),
    ...(payload.realtimeTransport
      ? { realtimeTransport: payload.realtimeTransport }
      : {}),
    ...(payload.routeStage !== undefined ? { routeStage: payload.routeStage } : {}),
    ...(payload.fallbackReason !== undefined
      ? { fallbackReason: payload.fallbackReason }
      : {}),
    ...(payload.shouldRespond !== undefined
      ? { shouldRespond: payload.shouldRespond }
      : {}),
    ...(payload.registeredSpeechIntent !== undefined
      ? { registeredSpeechIntent: payload.registeredSpeechIntent }
      : {}),
    ...(payload.registeredSpeechSha256 !== undefined
      ? { registeredSpeechSha256: payload.registeredSpeechSha256 }
      : {}),
    ...(payload.registeredSpeechManifestBuildId !== undefined
      ? {
          registeredSpeechManifestBuildId:
            payload.registeredSpeechManifestBuildId,
        }
      : {}),
    ...(payload.guardAction !== undefined ? { guardAction: payload.guardAction } : {}),
    ...(payload.inputDepth !== undefined ? { inputDepth: payload.inputDepth } : {}),
    ...(payload.fallbackIntent !== undefined
      ? { fallbackIntent: payload.fallbackIntent }
      : {}),
    ...(payload.forbiddenSuffixDetected !== undefined
      ? { forbiddenSuffixDetected: payload.forbiddenSuffixDetected }
      : {}),
    ...(payload.closingQuestionDetected !== undefined
      ? { closingQuestionDetected: payload.closingQuestionDetected }
      : {}),
    ...(payload.hardBannedTextDetected !== undefined
      ? { hardBannedTextDetected: payload.hardBannedTextDetected }
      : {}),
    ...(payload.metaLanguageDetected !== undefined
      ? { metaLanguageDetected: payload.metaLanguageDetected }
      : {}),
    ...(payload.overAnsweringDetected !== undefined
      ? { overAnsweringDetected: payload.overAnsweringDetected }
      : {}),
    ...(payload.guardFailedTextWasNotSpoken !== undefined
      ? { guardFailedTextWasNotSpoken: payload.guardFailedTextWasNotSpoken }
      : {}),
    ...(payload.audioEmittedAfterGuard !== undefined
      ? { audioEmittedAfterGuard: payload.audioEmittedAfterGuard }
      : {}),
    ...(payload.firstAudibleAudioMs !== undefined
      ? { firstAudibleAudioMs: payload.firstAudibleAudioMs }
      : {}),
    ...(payload.firstRealtimeAudioDeltaMs !== undefined
      ? { firstRealtimeAudioDeltaMs: payload.firstRealtimeAudioDeltaMs }
      : {}),
    ...(payload.sttFinalMs !== undefined ? { sttFinalMs: payload.sttFinalMs } : {}),
    ...(payload.lockDecisionMs !== undefined
      ? { lockDecisionMs: payload.lockDecisionMs }
      : {}),
    ...(payload.localLockedAudioHit !== undefined
      ? { localLockedAudioHit: payload.localLockedAudioHit }
      : {}),
    ...(payload.lockedResponseKey !== undefined
      ? { lockedResponseKey: payload.lockedResponseKey }
      : {}),
    ...(payload.cacheStatus !== undefined ? { cacheStatus: payload.cacheStatus } : {}),
    ...(payload.cacheLookupMs !== undefined
      ? { cacheLookupMs: payload.cacheLookupMs }
      : {}),
    ...(payload.ttsVendorMsAtCreation !== undefined
      ? { ttsVendorMsAtCreation: payload.ttsVendorMsAtCreation }
      : {}),
    ...(payload.networkTtsMs !== undefined ? { networkTtsMs: payload.networkTtsMs } : {}),
    ...(payload.audioDecodeMs !== undefined
      ? { audioDecodeMs: payload.audioDecodeMs }
      : {}),
    ...(payload.sanitizerDelayMs !== undefined
      ? { sanitizerDelayMs: payload.sanitizerDelayMs }
      : {}),
    ...(payload.sanitizedTtsMs !== undefined
      ? { sanitizedTtsMs: payload.sanitizedTtsMs }
      : {}),
    ...(payload.reseedMs !== undefined ? { reseedMs: payload.reseedMs } : {}),
    ...(payload.outcome !== undefined ? { outcome: payload.outcome } : {}),
    ...(payload.sessionTainted !== undefined
      ? { sessionTainted: payload.sessionTainted }
      : {}),
    ...(payload.parentSessionId !== undefined
      ? { parentSessionId: payload.parentSessionId }
      : {}),
    ...(payload.cloudRunRevision ? { cloudRunRevision: payload.cloudRunRevision } : {}),
    ...(payload.strictPlaybackMode !== undefined
      ? { strictPlaybackMode: payload.strictPlaybackMode }
      : {}),
    ...(payload.strictGateApplied !== undefined
      ? { strictGateApplied: payload.strictGateApplied }
      : {}),
    ...(payload.strictGateReason !== undefined
      ? { strictGateReason: payload.strictGateReason }
      : {}),
    ...(payload.streamingBeforeDone !== undefined
      ? { streamingBeforeDone: payload.streamingBeforeDone }
      : {}),
    ...payload.provenance,
  });
}

function stringFromDetails(
  details: Record<string, unknown>,
  key: string
): string | undefined {
  const value = details[key];
  return typeof value === "string" ? value : undefined;
}

export function logGrokVoiceStt(payload: {
  sessionId: string | null;
  turnIndex: number | null;
  textLen: number;
  confidence: number | null;
  vendorMs: number | null;
  sttTextPreview?: string;
  sttTextPreviewUtf8Base64?: string;
}) {
  emit("grokVoice.stt", payload);
}

export function logGrokVoiceSttSkipped(payload: {
  sessionId: string | null;
  turnIndex: number | null;
  reason: string;
}) {
  emit("grokVoice.stt.skipped", payload);
}

export function logGrokVoiceMicState(payload: {
  sessionId: string | null;
  from: string;
  to: string;
  durationMs: number | null;
}) {
  emit("grokVoice.mic.state", payload);
}
