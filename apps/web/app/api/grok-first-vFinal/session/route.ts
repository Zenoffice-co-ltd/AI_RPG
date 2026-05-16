import { NextResponse, type NextRequest } from "next/server";
import { validateSameOrigin } from "@/lib/roleplay/auth";
import {
  getVFinalApiAccessSessionResult,
} from "@/lib/grok-first-roleplay/vfinal-auth";
import { checkVFinalRateLimit } from "@/lib/grok-first-roleplay/vfinal-rate-limit";
import { createGrokFirstVFinalSession } from "@/lib/grok-first-roleplay/vfinal-session";
import {
  logGrokFirstVFinalAuthEvent,
  logGrokFirstVFinalServerEvent,
} from "@/lib/grok-first-roleplay/metrics";

const SAFE_ERROR =
  "セッションの開始に失敗しました。時間をおいて再試行してください。";

export async function POST(request: NextRequest) {
  if (!validateSameOrigin(request)) return safeError(403);
  const access = getVFinalApiAccessSessionResult(request);
  if (!access.ok) {
    logGrokFirstVFinalAuthEvent({
      phase: "session.auth",
      reason: access.reason,
    });
    return safeError(401);
  }
  const rate = checkVFinalRateLimit({
    scope: "vfinal.session",
    key: access.session.participantIdHash || clientIp(request),
    limit: 60,
    windowMs: 5 * 60 * 1000,
  });
  if (!rate.ok) {
    return NextResponse.json(
      { error: SAFE_ERROR },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      }
    );
  }

  try {
    const session = await createGrokFirstVFinalSession({
      participantIdHash: access.session.participantIdHash,
    });
    logGrokFirstVFinalServerEvent({
      kind: "session.created",
      sessionId: session.sessionId,
      participantIdHash: access.session.participantIdHash,
      details: {
        demoSlug: session.demoSlug,
        backend: session.backend,
        realtimeTransport: session.realtimeTransport,
        model: session.model,
        voiceId: session.voiceId,
        promptHash: session.promptHash,
        promptVersion: session.promptVersion,
        guardrailVersion: session.guardrailVersion,
        registeredSpeechPayloadIncluded: session.registeredSpeechPayloadIncluded,
        lockedResponseAudioBundleIncluded:
          session.lockedResponseAudioBundleIncluded,
      },
    });
    return NextResponse.json(session);
  } catch (error) {
    console.error(
      "grok-first vFinal session failed",
      error instanceof Error ? error.message : String(error)
    );
    return safeError(503);
  }
}

export function GET() {
  return safeError(405, { Allow: "POST" });
}

function safeError(status: number, headers?: HeadersInit) {
  return NextResponse.json(
    { error: SAFE_ERROR },
    headers ? { status, headers } : { status }
  );
}

function clientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
