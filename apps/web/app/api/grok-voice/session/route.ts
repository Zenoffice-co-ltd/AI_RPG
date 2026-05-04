import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import {
  DEMO_API_ACCESS_COOKIE,
  hasDemoApiAccess,
  validateSameOrigin,
} from "@/lib/roleplay/auth";
import {
  buildRateLimitKey,
  checkSessionTokenRateLimit,
} from "@/lib/roleplay/rate-limit";
import {
  assertGrokVoiceEnvForProduction,
  getGrokVoiceServerEnv,
  isGrokVoiceRoleplayEnabled,
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

const SAFE_ERROR =
  "セッションの開始に失敗しました。時間をおいて再試行してください。";

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

  const ip = resolveClientIp(request);
  const signature = request.cookies.get(DEMO_API_ACCESS_COOKIE)?.value;
  const rateLimit = checkSessionTokenRateLimit(buildRateLimitKey(ip, signature));
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
      request: {
        model: env.GROK_VOICE_MODEL,
        voice: env.GROK_VOICE_VOICE_ID,
        instructions,
        audio: {
          input: { format: { type: audio.inputFormat, rate: audio.sampleRate } },
          output: { format: { type: audio.outputFormat, rate: audio.sampleRate } },
        },
        turn_detection: turnDetection,
      },
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
