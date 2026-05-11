import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import {
  DEMO_API_ACCESS_COOKIE,
  hasDemoApiAccess,
  validateSameOrigin,
} from "@/lib/roleplay/auth";
import { z } from "zod";
import {
  buildRateLimitKey,
  checkSessionReseedRateLimit,
  checkSessionTokenRateLimit,
} from "@/lib/roleplay/rate-limit";
import {
  assertGrokVoiceEnvForProduction,
  getGrokVoiceServerEnv,
  isGrokVoiceRoleplayEnabled,
  isGrokVoiceStrictSanitizedPlaybackEnabled,
  getGrokVoiceStrictPlaybackMode,
  isGrokVoiceLockedAudioBundleEnabled,
  getGrokVoiceLockedAudioBundleMaxEntries,
} from "@/lib/roleplay/server-env";
import {
  buildGrokVoicePromptManifest,
  buildGrokVoiceSystemPrompt,
} from "@/server/grokVoice/promptBuilder";
import { loadGrokVoiceScenarioBundle } from "@/server/grokVoice/scenarioLoader";
import {
  GrokEphemeralTokenError,
  issueGrokEphemeralToken,
} from "@/server/grokVoice/ephemeralToken";
import { logGrokVoiceSessionCreated } from "@/server/grokVoice/metrics";
import { getCachedGrokVoiceTts } from "@/server/grokVoice/ttsCache";
import { assembleLockedAudioBundle } from "@/server/grokVoice/lockedAudioBundle";

const SAFE_ERROR =
  "セッションの開始に失敗しました。時間をおいて再試行してください。";

const requestSchema = z
  .object({
    // Strict sanitized playback reseed continuity. When present, this session
    // is being created to replace a tainted realtime socket whose previous
    // assistant turn contained a stock suffix. We use a separate, more
    // permissive rate-limit bucket for these so a model in a closing-suffix
    // loop can recover without exhausting the per-IP fresh-session quota.
    reseedFromSessionId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^gv_sess_/)
      .optional(),
  })
  .strict()
  .optional();

export async function POST(request: NextRequest) {
  if (!isGrokVoiceRoleplayEnabled()) {
    return safeError(503);
  }
  try {
    assertGrokVoiceEnvForProduction();
  } catch {
    return safeError(503);
  }

  if (!validateSameOrigin(request)) {
    return safeError(403);
  }
  if (!hasDemoApiAccess(request)) {
    return safeError(401);
  }

  // Body parse: tolerate empty body for backwards compat with the no-arg call,
  // accept { reseedFromSessionId } for strict-playback reseeds.
  let parsedBody: { reseedFromSessionId?: string | undefined } | undefined;
  try {
    const text = await request.text();
    if (text.length > 0) {
      const parsed = requestSchema.safeParse(JSON.parse(text));
      if (!parsed.success) return safeError(400);
      parsedBody = parsed.data;
    }
  } catch {
    return safeError(400);
  }
  const reseedFromSessionId = parsedBody?.reseedFromSessionId;

  const ip = resolveClientIp(request);
  const signature = request.cookies.get(DEMO_API_ACCESS_COOKIE)?.value;
  const rateLimitKey = buildRateLimitKey(ip, signature);
  const rateLimit = reseedFromSessionId
    ? checkSessionReseedRateLimit(rateLimitKey)
    : checkSessionTokenRateLimit(rateLimitKey);
  if (!rateLimit.allowed) {
    return safeError(429, {
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }

  let env;
  try {
    env = getGrokVoiceServerEnv();
  } catch {
    return safeError(503);
  }

  let bundle;
  try {
    bundle = await loadGrokVoiceScenarioBundle();
  } catch (error) {
    console.error("grokVoice scenario load failed", sanitizeServerError(error));
    return safeError(502);
  }

  const manifest = buildGrokVoicePromptManifest(bundle);
  const instructions = buildGrokVoiceSystemPrompt(bundle);

  const turnDetection = {
    type: "server_vad" as const,
    threshold: env.GROK_VOICE_TURN_DETECTION_THRESHOLD,
    silence_duration_ms: env.GROK_VOICE_TURN_DETECTION_SILENCE_MS,
    prefix_padding_ms: env.GROK_VOICE_TURN_DETECTION_PREFIX_PADDING_MS,
  };
  const audio = {
    inputFormat: env.GROK_VOICE_INPUT_FORMAT,
    outputFormat: env.GROK_VOICE_OUTPUT_FORMAT,
    sampleRate: env.GROK_VOICE_SAMPLE_RATE,
  };

  let token;
  try {
    token = await issueGrokEphemeralToken({
      endpoint: env.GROK_VOICE_EPHEMERAL_BASE,
      apiKey: env.XAI_API_KEY,
    });
  } catch (error) {
    console.error(
      "grokVoice ephemeral token failed",
      sanitizeServerError(error),
      error instanceof GrokEphemeralTokenError
        ? { upstreamStatus: error.status }
        : undefined
    );
    return safeError(502);
  }

  const sessionId = `gv_sess_${randomUUID()}`;
  const wsUrl = `${env.GROK_VOICE_REALTIME_BASE}?model=${encodeURIComponent(env.GROK_VOICE_MODEL)}`;

  const provenance = {
    promptVersion: manifest.promptVersion,
    agentSystemPromptHash: manifest.agentSystemPromptHash,
    knowledgeBaseTextHash: manifest.knowledgeBaseTextHash,
    promptSectionsHash: manifest.promptSectionsHash,
    guardrailVersion: manifest.guardrailVersion,
    grokVoiceModel: env.GROK_VOICE_MODEL,
    grokVoiceVoiceId: env.GROK_VOICE_VOICE_ID,
  };
  logGrokVoiceSessionCreated({
    sessionId,
    ephemeralExpiresAt: token.expiresAt,
    provenance,
  });

  const greetingAudio = await getCachedGrokVoiceTts({
    text: bundle.firstMessage,
    voiceId: env.GROK_VOICE_VOICE_ID,
    sampleRateHz: env.GROK_VOICE_SAMPLE_RATE,
    purpose: "greeting",
    firestoreTimeoutMs: 250,
  });

  // PR B — assemble the locked-response audio bundle if enabled. We
  // never synthesize on this path; the bundle is read-only against the
  // shared TTS cache (warm-cache hook in PR #84 keeps prod hit rate
  // >95%, so the typical bundle is fully populated). On any internal
  // failure we omit the bundle and let the client fall back to the
  // existing `/api/v3/locked-response-tts` HTTP path — session
  // bootstrap MUST NOT fail because of a bundle issue.
  const lockedAudioBundleEnabled = isGrokVoiceLockedAudioBundleEnabled();
  const lockedAudioBundleMaxEntries = getGrokVoiceLockedAudioBundleMaxEntries();
  const lockedAudioBundleResult =
    lockedAudioBundleEnabled && lockedAudioBundleMaxEntries > 0
      ? await assembleLockedAudioBundle({
          voiceId: env.GROK_VOICE_VOICE_ID,
          sampleRateHz: env.GROK_VOICE_SAMPLE_RATE,
          maxEntries: lockedAudioBundleMaxEntries,
          firestoreTimeoutMs: 250,
        }).catch((error) => {
          // The bundle is a latency optimization. If the assembler
          // throws (timeout, transient Firestore error, etc.), we log
          // for triage and serve the session without it.
          console.warn(
            "grokVoice locked audio bundle assembly failed; serving session without it",
            error instanceof Error ? error.message : String(error)
          );
          return null;
        })
      : null;
  // Structured log so the dashboard can attribute bundle hit/miss rate
  // per deploy. Keep it minimal — entry texts are not logged (already
  // cached on Firestore; logging here would just inflate stdout).
  console.log(
    JSON.stringify({
      scope: "grokVoice.lockedAudioBundle",
      sessionId,
      enabled: lockedAudioBundleEnabled,
      maxEntries: lockedAudioBundleMaxEntries,
      bundledEntries: lockedAudioBundleResult?.bundle.entries.length ?? 0,
      attempted: lockedAudioBundleResult?.attemptedSpokenTexts.length ?? 0,
      missed: lockedAudioBundleResult?.missedSpokenTexts.length ?? 0,
      totalAudioBytes:
        lockedAudioBundleResult?.bundle.entries.reduce(
          (acc, e) => acc + e.audioBytes,
          0
        ) ?? 0,
    })
  );

  return NextResponse.json({
    sessionId,
    scenarioId: bundle.scenarioId,
    backend: "grok-voice-think-fast",
    promptVersion: manifest.promptVersion,
    promptHash: shortHash(manifest.agentSystemPromptHash),
    guardrailVersion: manifest.guardrailVersion,
    grokVoiceModel: env.GROK_VOICE_MODEL,
    grokVoiceVoiceId: env.GROK_VOICE_VOICE_ID,
    wsUrl,
    ephemeralToken: token.value,
    ephemeralExpiresAt: token.expiresAt,
    audio,
    turnDetection,
    instructions,
    firstMessage: bundle.firstMessage,
    // PR D + PR #86 — strict-playback session contract.
    //
    // Two env flags, with a clear precedence:
    //   1. `GROK_VOICE_STRICT_SANITIZED_PLAYBACK=false` is the LEGACY
    //      global disable. Existing deploys have used it as the
    //      kill-switch for the sanitize-then-play path. It MUST win
    //      over any per-mode setting — otherwise rolling back to
    //      "stream everything, do not sanitize" via the legacy flag
    //      would silently leave the new client in `risk_based`
    //      (buffering and sanitizing ack/closing/identity turns),
    //      which is a different contract than the legacy flag implies.
    //   2. `GROK_VOICE_STRICT_PLAYBACK_MODE` (PR D) chooses among
    //      `all_turns | risk_based | monitor_only` only when the
    //      legacy flag is true. Default `risk_based`.
    //
    // The effective mode is what the new client reads from
    // `strictPlaybackMode`. The legacy `strictSanitizedPlayback`
    // boolean is derived from the effective mode so old clients
    // observe the same kill-switch behavior.
    ...(() => {
      const strictEnabled = isGrokVoiceStrictSanitizedPlaybackEnabled();
      const configuredMode = getGrokVoiceStrictPlaybackMode();
      const effectiveMode = strictEnabled ? configuredMode : "monitor_only";
      return {
        strictSanitizedPlayback:
          strictEnabled && effectiveMode !== "monitor_only",
        strictPlaybackMode: effectiveMode,
      };
    })(),
    ...(reseedFromSessionId ? { parentSessionId: reseedFromSessionId } : {}),
    ...(greetingAudio
      ? {
          greetingAudio: {
            audioBase64: greetingAudio.audioBase64,
            mimeType: greetingAudio.mimeType,
            sampleRateHz: greetingAudio.sampleRateHz,
            textLen: bundle.firstMessage.length,
            voiceId: greetingAudio.voiceId,
            vendorMs: greetingAudio.vendorMs ?? undefined,
            cacheStatus: "hit",
            cacheKeyHash: greetingAudio.cacheKeyHash,
          },
        }
      : {}),
    // PR B — locked-response audio bundle. Omitted when the env
    // kill-switch is off OR when no canonical was cache-hit (typically
    // never, since PR #84's warm-cache hook keeps prod hit rate high).
    ...(lockedAudioBundleResult &&
    lockedAudioBundleResult.bundle.entries.length > 0
      ? { lockedResponseAudioBundle: lockedAudioBundleResult.bundle }
      : {}),
  });
}

export function GET() {
  return safeError(405, { Allow: "POST" });
}

export function PUT() {
  return safeError(405, { Allow: "POST" });
}

export function DELETE() {
  return safeError(405, { Allow: "POST" });
}

function safeError(status: number, headers?: HeadersInit) {
  return NextResponse.json(
    { error: SAFE_ERROR },
    headers ? { status, headers } : { status }
  );
}

function resolveClientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1"
  );
}

function sanitizeServerError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "UnknownError" };
}

function shortHash(hash: string) {
  return hash.slice(0, 12);
}
