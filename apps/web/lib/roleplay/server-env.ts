import { z } from "zod";
import { ensureEnvLoaded } from "../../server/loadEnv";
import {
  DEFAULT_ELEVENLABS_SECRET_NAME,
  DEFAULT_SECRET_SOURCE_PROJECT_ID,
  getEnvOrSecret,
  trimConfiguredValue,
} from "../../server/secrets";

const serverEnvSchema = z.object({
  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_AGENT_ID: z.string().min(1),
  ELEVENLABS_BRANCH_ID: z.string().min(1),
  ELEVENLABS_ENVIRONMENT: z.string().min(1).default("production"),
  ELEVENLABS_VOICE_PROFILE_ID: z.string().min(1).optional(),
  DEMO_ACCESS_TOKEN: z.string().min(1).optional(),
});

export type VoiceServerEnv = z.infer<typeof serverEnvSchema>;

export function getVoiceServerEnv(): VoiceServerEnv {
  ensureEnvLoaded();
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error("Voice session server environment is not configured.");
  }
  return parsed.data;
}

export async function getVoiceServerEnvWithSecretFallback(): Promise<VoiceServerEnv> {
  ensureEnvLoaded();

  if (process.env["NODE_ENV"] === "production") {
    const parsed = serverEnvSchema.safeParse({
      ...process.env,
      ELEVENLABS_API_KEY: trimConfiguredValue(process.env["ELEVENLABS_API_KEY"]),
    });
    if (!parsed.success) {
      throw new Error("Voice session server environment is not configured.");
    }
    return parsed.data;
  }

  const secretProjectId =
    process.env["SECRET_SOURCE_PROJECT_ID"] ?? DEFAULT_SECRET_SOURCE_PROJECT_ID;
  const apiKey = await getEnvOrSecret(
    "ELEVENLABS_API_KEY",
    DEFAULT_ELEVENLABS_SECRET_NAME,
    secretProjectId
  );
  const parsed = serverEnvSchema.safeParse({
    ...process.env,
    ELEVENLABS_API_KEY: apiKey,
  });
  if (!parsed.success) {
    throw new Error("Voice session server environment is not configured.");
  }
  return parsed.data;
}

export function assertDemoAccessEnvForProduction() {
  ensureEnvLoaded();
  if (process.env["NODE_ENV"] === "production" && !process.env["DEMO_ACCESS_TOKEN"]) {
    throw new Error("Demo access token is required in production.");
  }
}

const haikuFishServerEnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  FISH_API_KEY: z.string().min(1),
  FISH_ADECCO_VOICE_REFERENCE_ID: z.string().min(1),
  HAIKU_FISH_LLM_MODEL: z.string().min(1).default("claude-haiku-4-5-20251001"),
  HAIKU_FISH_LLM_TEMPERATURE: z.coerce.number().default(0.2),
  HAIKU_FISH_LLM_MAX_TOKENS: z.coerce.number().int().positive().default(220),
  FISH_TTS_MODEL: z.string().min(1).default("s2-pro"),
  FISH_TTS_FORMAT: z.string().min(1).default("wav"),
  FISH_TTS_SAMPLE_RATE: z.coerce.number().int().positive().default(24_000),
});

export type HaikuFishServerEnv = z.infer<typeof haikuFishServerEnvSchema>;

export function isHaikuFishRoleplayEnabled() {
  ensureEnvLoaded();
  const value = process.env["ENABLE_HAIKU_FISH_ROLEPLAY"];
  return value === "true" || value === "1";
}

export function isHaikuFishMicInputEnabled() {
  ensureEnvLoaded();
  const value = process.env["ENABLE_HAIKU_FISH_MIC_INPUT"];
  return value === "true" || value === "1";
}

export function getHaikuFishServerEnv(): HaikuFishServerEnv {
  ensureEnvLoaded();
  const parsed = haikuFishServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error("Haiku-Fish roleplay environment is not configured.");
  }
  return parsed.data;
}

export function assertHaikuFishEnvForProduction() {
  ensureEnvLoaded();
  if (!isHaikuFishRoleplayEnabled()) {
    return;
  }
  const required = [
    "ANTHROPIC_API_KEY",
    "FISH_API_KEY",
    "FISH_ADECCO_VOICE_REFERENCE_ID",
  ] as const;
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Haiku-Fish roleplay env missing: ${missing.join(", ")} (ENABLE_HAIKU_FISH_ROLEPLAY=true).`
    );
  }
  if (isHaikuFishMicInputEnabled() && !process.env["GOOGLE_CLOUD_PROJECT"]) {
    throw new Error(
      "Haiku-Fish mic input requires GOOGLE_CLOUD_PROJECT (ENABLE_HAIKU_FISH_MIC_INPUT=true)."
    );
  }
}

const grokVoiceServerEnvSchema = z.object({
  XAI_API_KEY: z.string().min(1),
  GROK_VOICE_MODEL: z.string().min(1).default("grok-voice-think-fast-1.0"),
  GROK_VOICE_VOICE_ID: z.string().min(1).default("rex"),
  GROK_VOICE_INPUT_FORMAT: z.string().min(1).default("audio/pcm"),
  GROK_VOICE_OUTPUT_FORMAT: z.string().min(1).default("audio/pcm"),
  GROK_VOICE_SAMPLE_RATE: z.coerce.number().int().positive().default(24_000),
  GROK_VOICE_REALTIME_BASE: z
    .string()
    .min(1)
    .default("wss://api.x.ai/v1/realtime"),
  GROK_VOICE_EPHEMERAL_BASE: z
    .string()
    .min(1)
    .default("https://api.x.ai/v1/realtime/client_secrets"),
  GROK_VOICE_TURN_DETECTION_THRESHOLD: z.coerce.number().default(0.5),
  GROK_VOICE_TURN_DETECTION_SILENCE_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(500),
  // v2.1 (2026-05-04): VAD prefix padding. Recommended profiles —
  //   max_speed:        threshold=0.72, silence=650, prefix_padding=333
  //   stable_japanese:  threshold=0.78, silence=850, prefix_padding=333
  //   noisy_demo:       threshold=0.85, silence=950, prefix_padding=450
  // Default 333 (max_speed) for the live demo.
  GROK_VOICE_TURN_DETECTION_PREFIX_PADDING_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(333),
  GROK_VOICE_DEBUG_TRANSCRIPT_PREVIEW_ENABLED: z
    .string()
    .optional()
    .default("false"),
  GROK_VOICE_DEBUG_TRANSCRIPT_PREVIEW_MAX_CHARS: z.coerce
    .number()
    .int()
    .positive()
    .default(200),
});

export type GrokVoiceServerEnv = z.infer<typeof grokVoiceServerEnvSchema>;

export function isGrokVoiceRoleplayEnabled() {
  ensureEnvLoaded();
  const value = process.env["ENABLE_GROK_VOICE_ROLEPLAY"];
  return value === "true" || value === "1";
}

export function getGrokVoiceServerEnv(): GrokVoiceServerEnv {
  ensureEnvLoaded();
  const parsed = grokVoiceServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error("Grok Voice roleplay environment is not configured.");
  }
  return parsed.data;
}

export function isGrokVoiceTranscriptPreviewLoggingEnabled() {
  ensureEnvLoaded();
  const value = process.env["GROK_VOICE_DEBUG_TRANSCRIPT_PREVIEW_ENABLED"];
  return value === "true" || value === "1";
}

// Strict sanitized playback gates raw realtime audio behind a transcript-level
// stock-suffix detector. Default is ON in every environment; set this to
// "false"/"0" to fall back to the legacy immediate-enqueue path. The env value
// is surfaced to the client via the /api/v3/session payload so the conversation
// hook can branch without a separate config fetch.
export function isGrokVoiceStrictSanitizedPlaybackEnabled() {
  ensureEnvLoaded();
  const value = process.env["GROK_VOICE_STRICT_SANITIZED_PLAYBACK"];
  if (value === undefined || value === null || value === "") return true;
  return value !== "false" && value !== "0";
}

// PR D — risk-based strict playback. The all-turn buffer of the legacy
// `strictSanitizedPlayback` flag adds ~1.6s to every realtime voice turn
// (verified on Cloud Logging: `firstAudibleAudioMs − firstAudioMs ≈
// sanitizerDelayMs ≈ 1,603ms`). This new env replaces the boolean with
// a tri-state that lets normal business-factual turns stream while
// suffix-risk turns (acks, final closings, identity probes) keep the
// buffered sanitize-then-play path.
//
//   all_turns     — legacy: buffer every realtime turn until response.done
//   risk_based    — new default: per-turn classification via
//                   `shouldStrictGateTurn` decides buffer vs stream
//   monitor_only  — fastest: never buffer, only detect+log stock suffix
//                   leaks for evidence collection. Not recommended in
//                   production with live customers; safe for development.
//
// If the value is unset, blank, or unrecognized, we default to
// `risk_based`. Setting the value to "all_turns" is the safety rollback
// for PR D (no client redeploy required — the env var is surfaced via
// /api/v3/session.strictPlaybackMode and the client honors it per-turn).
export type GrokVoiceStrictPlaybackMode =
  | "all_turns"
  | "risk_based"
  | "monitor_only";

export function getGrokVoiceStrictPlaybackMode(): GrokVoiceStrictPlaybackMode {
  ensureEnvLoaded();
  const raw = process.env["GROK_VOICE_STRICT_PLAYBACK_MODE"];
  if (raw === "all_turns" || raw === "risk_based" || raw === "monitor_only") {
    return raw;
  }
  return "risk_based";
}

// PR B — locked-response audio prebundle.
//
// Voice deterministic-lock turns currently pay an HTTP roundtrip to
// `/api/v3/locked-response-tts` after STT confirms (production Cloud
// Logging on PR #85 measured one such turn at 6,131ms first-audible).
// Shipping the PR60 canonical audio bundles inside the session
// bootstrap response lets the client play locked audio synchronously
// from a local Map, eliminating the network hop before first audio.
//
// `GROK_VOICE_LOCKED_AUDIO_BUNDLE_ENABLED` is the kill-switch:
//   true / unset → bundle enabled (default — recommended for prod).
//   false / 0    → bundle omitted, client falls back to the existing
//                  network-TTS path. This is the immediate rollback
//                  flag (no client redeploy).
//
// `GROK_VOICE_LOCKED_AUDIO_BUNDLE_MAX_ENTRIES` caps how many cached
// canonicals to embed. Each entry adds ~150–400KB of base64 audio to
// the session response. Default 8 = top business-factual canonicals,
// keeping the bootstrap payload under ~3MB on the worst case.
export function isGrokVoiceLockedAudioBundleEnabled() {
  ensureEnvLoaded();
  const value = process.env["GROK_VOICE_LOCKED_AUDIO_BUNDLE_ENABLED"];
  if (value === undefined || value === null || value === "") return true;
  return value !== "false" && value !== "0";
}

export function getGrokVoiceLockedAudioBundleMaxEntries(): number {
  ensureEnvLoaded();
  const raw = process.env["GROK_VOICE_LOCKED_AUDIO_BUNDLE_MAX_ENTRIES"];
  const parsed = Number(raw ?? "8");
  if (!Number.isFinite(parsed)) return 8;
  return Math.max(0, Math.min(20, Math.trunc(parsed)));
}

export function getGrokVoiceTranscriptPreviewMaxChars() {
  ensureEnvLoaded();
  const raw = process.env["GROK_VOICE_DEBUG_TRANSCRIPT_PREVIEW_MAX_CHARS"];
  const parsed = Number(raw ?? "200");
  if (!Number.isFinite(parsed)) return 200;
  return Math.max(1, Math.min(4_000, Math.trunc(parsed)));
}

// Verified Audio Artifact rollout — single kill-switch for the
// deterministic mode. When ON the client:
//   - never plays xAI realtime audio (output_audio.delta is dropped at
//     the handleServerEvent entrypoint, not after a lock hit)
//   - never calls /api/v3/locked-response-tts, /api/v3/sanitized-
//     response-tts, or any greeting TTS endpoint
//   - never falls through to rt_voice on unknown user input
//   - plays only verified registered-speech artifacts whose sha256 was
//     computed and verified at session bootstrap (pre mic-enable)
// Default OFF keeps the existing risk-based playback path live, so
// flipping this flag at runtime is the one-step rollout / rollback.
export function isGrokVoiceProductionDeterministicOnlyEnabled() {
  ensureEnvLoaded();
  const value = process.env["GROK_VOICE_PRODUCTION_DETERMINISTIC_ONLY"];
  if (value === undefined || value === null || value === "") return false;
  return value === "true" || value === "1";
}

// Independent bundle kill-switch for the registered-speech inline
// payload. Default ON so once artifacts exist they ship; flipping to
// false makes /api/v3/session omit the bundle, which forces
// deterministic mode to fall through to fail-closed (mic disabled). Use
// this to roll back a bad manifest without disabling deterministic mode
// entirely.
export function isGrokVoiceRegisteredSpeechBundleEnabled() {
  ensureEnvLoaded();
  const value = process.env["GROK_VOICE_REGISTERED_SPEECH_BUNDLE_ENABLED"];
  if (value === undefined || value === null || value === "") return true;
  return value !== "false" && value !== "0";
}

// Hard upper bound on the bundle's combined base64 byte length. The
// session route throws if a built manifest would exceed this so a
// runaway artifact doesn't ship a multi-megabyte response. 8 MiB is the
// review-v2 agreed limit; raise it deliberately, never accidentally.
export function getGrokVoiceRegisteredSpeechBundleHardLimitBytes(): number {
  ensureEnvLoaded();
  const raw =
    process.env["GROK_VOICE_REGISTERED_SPEECH_BUNDLE_HARD_LIMIT_BYTES"];
  const parsed = Number(raw ?? `${8 * 1024 * 1024}`);
  if (!Number.isFinite(parsed) || parsed <= 0) return 8 * 1024 * 1024;
  return Math.trunc(parsed);
}

// Residual-guard kill-switch for the strict-playback sanitizer. The
// sanitizer is demoted to a residual guard once the registered-speech
// path lands — keep it enabled by default so non-deterministic
// (research / fallback) sessions still benefit from suffix-strip; set
// to false to silence the residual guard in environments where it
// surfaces noisy false-positives.
export function isGrokVoiceResidualSanitizerEnabled() {
  ensureEnvLoaded();
  const value = process.env["GROK_VOICE_RESIDUAL_SANITIZER_ENABLED"];
  if (value === undefined || value === null || value === "") return true;
  return value !== "false" && value !== "0";
}

export function assertGrokVoiceEnvForProduction() {
  ensureEnvLoaded();
  if (!isGrokVoiceRoleplayEnabled()) {
    return;
  }
  const required = ["XAI_API_KEY"] as const;
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Grok Voice roleplay env missing: ${missing.join(", ")} (ENABLE_GROK_VOICE_ROLEPLAY=true).`
    );
  }
}
