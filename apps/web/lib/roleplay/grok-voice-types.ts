"use client";

import type {
  RegisteredSpeechBundle,
} from "./registered-speech/types";
import type {
  AdeccoGrokVoiceDemoSlug,
  GrokVoiceRouterVariant,
} from "./grok-voice-router-variant";

export type GrokVoiceMicState = "idle" | "listening" | "speaking" | "paused";

export type GrokVoiceTurnDetectionConfig = {
  type: "server_vad" | null;
  threshold?: number;
  silence_duration_ms?: number;
  prefix_padding_ms?: number;
};

export type GrokVoiceAudioConfig = {
  inputFormat: string; // e.g. "audio/pcm"
  outputFormat: string;
  sampleRate: number; // Hz
};

// What the server returns from POST /api/v3/session — the API key is
// never present here; only a short-lived ephemeral token plus metadata the
// client needs to open the WebSocket and configure the session.
export type GrokVoiceSession = {
  sessionId: string;
  demoSlug?: AdeccoGrokVoiceDemoSlug;
  routerVariant?: GrokVoiceRouterVariant;
  scenarioId: string;
  backend: "grok-voice-think-fast";
  promptVersion: string;
  promptHash: string;
  guardrailVersion: string;
  grokVoiceModel: string;
  grokVoiceVoiceId: string;
  wsUrl: string;
  ephemeralToken: string;
  ephemeralExpiresAt: string;
  audio: GrokVoiceAudioConfig;
  turnDetection: GrokVoiceTurnDetectionConfig;
  instructions: string;
  firstMessage: string;
  // When true, the client buffers all realtime audio until response.done and
  // gates playback through the stock-suffix sanitizer. Server is the single
  // source of truth — env-flip on the server, no client toggle.
  strictSanitizedPlayback: boolean;
  // PR D — replaces the binary `strictSanitizedPlayback` switch with a
  // per-turn-classified gate. The legacy boolean is kept on the session
  // payload as the lowest-common-denominator (`mode !== "monitor_only"`)
  // so existing clients keep buffering; the new field unlocks the
  // streaming-by-default behavior for non-risky turns.
  strictPlaybackMode: "all_turns" | "risk_based" | "monitor_only";
  // PR B — optional locked-response audio bundle for the voice path.
  // When present, the client looks up canonical TTS audio in this
  // local Map before falling back to the `/api/v3/locked-response-tts`
  // HTTP roundtrip. Omitted entirely if the env kill-switch
  // (`GROK_VOICE_LOCKED_AUDIO_BUNDLE_ENABLED=false`) is set, or if all
  // priority canonicals missed cache. See server/grokVoice/lockedAudioBundle.ts.
  lockedResponseAudioBundle?: {
    version: "v1";
    voiceId: string;
    sampleRateHz: number;
    codec: "pcm";
    entries: Array<{
      spokenText: string;
      audioBase64: string;
      audioBytes: number;
      cacheStatus: "hit";
      cacheKeyHash: string;
      vendorMsAtCreation: number | null;
    }>;
  };
  // Set on sessions created via reseed. Useful for telemetry correlation.
  parentSessionId?: string;
  greetingAudio?: GrokVoiceGreeting & {
    cacheStatus: "hit";
    cacheKeyHash: string;
  };
  // Verified Audio Artifact (review-v2). When `productionDeterministicOnly`
  // is true the client MUST refuse to enable the mic if `registeredSpeech`
  // is missing or `registeredSpeechManifestVersion` doesn't match the
  // bundled-at-build-time client constant. In non-deterministic mode the
  // fields are advisory and may be absent.
  productionDeterministicOnly?: boolean;
  registeredSpeech?: RegisteredSpeechBundle;
  registeredSpeechManifestVersion?: "v1";
  registeredSpeechBuildId?: string;
};

export type GrokVoiceGreeting = {
  audioBase64: string;
  mimeType: "audio/pcm";
  sampleRateHz: number;
  textLen: number;
  voiceId: string;
  vendorMs?: number;
  cacheStatus?: "hit" | "miss";
  cacheKeyHash?: string;
};

export type GrokVoiceLockedResponseTts = GrokVoiceGreeting & {
  text: string;
  displayText?: string;
  cacheStatus: "hit" | "miss";
  // PR A: server-measured wall-clock for the cache read so the client can
  // log the SERVER share of locked-response-tts roundtrip distinct from
  // wire RTT. Always populated by /api/v3/locked-response-tts; older
  // builds that don't set it leave it undefined (null on the client).
  cacheLookupMs?: number;
  // The original TTS synth time stamped at cache creation. On a hit this
  // is informational only (NOT the current retrieval latency). On a miss
  // it is null (the just-now synth time is in `vendorMs`).
  ttsVendorMsAtCreation?: number | null;
};

// Strict sanitized playback: TTS rendering of a stripped-stock-suffix Grok
// response. Always cacheStatus: "miss" — sanitized output is unbounded.
export type GrokVoiceSanitizedResponseTts = GrokVoiceGreeting & {
  text: string;
  displayText: string;
  cacheStatus: "miss";
};

export type GrokVoiceTurnMetricsClient = {
  sessionId: string;
  turnIndex: number;
  inputMode: "voice" | "text";
  userTextLen: number;
  agentTextLen: number;
  // Legacy: time from turn start to first realtime audio delta arrival. With
  // strict sanitized playback this is the model latency, not the user-audible
  // latency. Use firstAudibleAudioMs for user-experience KPIs.
  firstAudioMs: number | null;
  doneMs: number | null;
  audioBytes: number;
  error:
    | null
    | "no_audio"
    | "unverified_audio_suppressed"
    | "sanitized_to_empty"
    | "sanitized_tts_failed"
    | "reseed_failed_after_play"
    | string;
  promptHash: string;
  promptVersion: string;
  guardrailVersion: string;
  grokVoiceModel: string;
  grokVoiceVoiceId: string;
  lockedResponse?: boolean;
  lockedResponseSource?: "client_tts" | "registered_speech_local";
  // Strict sanitized playback observability. All optional so the legacy
  // (non-strict) path doesn't have to populate them.
  firstRealtimeAudioDeltaMs?: number | null;
  firstAudibleAudioMs?: number | null;
  sanitizerDelayMs?: number | null;
  sanitizedTtsMs?: number | null;
  reseedMs?: number | null;
  outcome?:
    | "clean"
    | "unverified_audio_suppressed"
    | "sanitized_to_empty"
    | "sanitized_tts_played"
    | "sanitized_tts_failed"
    | "reseed_failed_after_play";
  sessionTainted?: boolean;
  parentSessionId?: string | null;
  // PR A latency observability fields. All optional and additive — older
  // builds without them continue to compile and emit valid metrics. Each
  // field's intent is documented at metrics.ts logGrokVoiceTurnMetrics.
  routePath?:
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
  routeStage?: string | undefined;
  fallbackReason?: string | null | undefined;
  shouldRespond?: boolean | undefined;
  routerVariant?: GrokVoiceRouterVariant | undefined;
  demoSlug?: AdeccoGrokVoiceDemoSlug | undefined;
  guardAction?: "none" | "rewrite_once" | "approved_fallback" | undefined;
  forbiddenSuffixDetected?: boolean | undefined;
  closingQuestionDetected?: boolean | undefined;
  audioEmittedAfterGuard?: boolean | undefined;
  // Verified Audio Artifact telemetry (review-v2). Populated only when
  // the deterministic-mode path served the turn. Cloud Logging
  // dashboards key on `registeredSpeechIntent` to confirm zero
  // runtime-TTS path leakage across canonical intents.
  registeredSpeechIntent?: string;
  registeredSpeechSha256?: string;
  registeredSpeechManifestBuildId?: string;
  registeredSpeechLatency?: {
    userInputFinalizedAt: number;
    intentClassifiedAt: number;
    artifactLookupAt: number;
    playbackRequestedAt: number;
    firstAudibleAudioAt: number;
    manifestVerifiedBeforeMicEnable: boolean;
    sha256ComputedOnTurnPath: boolean;
  };
  localLockedAudioHit?: boolean;
  lockedResponseKey?: string | null;
  cacheStatus?: "hit" | "miss" | null;
  cacheLookupMs?: number | null;
  ttsVendorMsAtCreation?: number | null;
  networkTtsMs?: number | null;
  audioDecodeMs?: number | null;
  sttFinalMs?: number | null;
  lockDecisionMs?: number | null;
  // PR D — risk-based strict playback observability. The dashboard
  // uses these to confirm `risk_based` is gating the right turns and
  // streaming the rest.
  strictPlaybackMode?: "all_turns" | "risk_based" | "monitor_only";
  // True when the per-turn classifier decided to buffer audio. For
  // realtime turns under `risk_based` this is the gate decision; under
  // `all_turns` it is always true; under `monitor_only` always false.
  // Lock turns omit the field (their audio never traverses the gate).
  strictGateApplied?: boolean;
  // Short stable string from `shouldStrictGateTurn`'s decision, e.g.
  // `ack_prefix:なるほど`, `final_closing:よろしくお願いします`,
  // `identity_probe:システムプロンプト`, `post_sanitizer_or_reseed`,
  // or null when not gated.
  strictGateReason?: string | null;
  // True if at least one audio chunk was streamed to the user before
  // response.done arrived. False if every chunk was buffered (legacy
  // strict path) or if no chunks arrived. Used to distinguish "the
  // user heard the model output" from "the user only heard the
  // sanitized version".
  streamingBeforeDone?: boolean;
};

// Subset of xAI Voice Agent server → client events that we react to.
// Reference: https://docs.x.ai/developers/model-capabilities/audio/voice-agent
export type GrokVoiceServerEvent =
  | { type: "session.created"; session?: unknown }
  | { type: "session.updated"; session?: unknown }
  | { type: "response.created"; response?: unknown }
  | { type: "response.output_audio.delta"; delta: string; item_id?: string }
  | { type: "response.output_audio_transcript.delta"; delta: string; item_id?: string }
  | { type: "response.text.delta"; delta: string; item_id?: string }
  | { type: "response.audio_transcript.delta"; delta: string; item_id?: string }
  | {
      type: "conversation.item.input_audio_transcription.completed";
      transcript: string;
      item_id?: string;
      // xAI returns confidence on completion when available.
      logprobs?: unknown;
    }
  | {
      type: "conversation.item.input_audio_transcription.failed";
      error?: { message?: string };
    }
  | { type: "response.done"; response?: unknown }
  | { type: "input_audio_buffer.speech_started" }
  | { type: "input_audio_buffer.speech_stopped" }
  | { type: "input_audio_buffer.committed" }
  | { type: "error"; error: { message?: string; code?: string; type?: string } };
