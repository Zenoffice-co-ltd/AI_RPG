import { NextResponse, type NextRequest } from "next/server";
import { hasDemoApiAccess, validateSameOrigin } from "@/lib/roleplay/auth";
import {
  assertGrokFirstV50SessionPayload,
  createGrokFirstV50Session,
} from "@/lib/grok-first-roleplay/session";
import { logGrokFirstV50ServerEvent } from "@/lib/grok-first-roleplay/metrics";

const SAFE_ERROR =
  "セッションの開始に失敗しました。時間をおいて再試行してください。";

export async function POST(request: NextRequest) {
  if (!validateSameOrigin(request)) {
    return safeError(403);
  }
  if (!hasDemoApiAccess(request)) {
    return safeError(401);
  }

  try {
    const session = await createGrokFirstV50Session({
      promptVariant: "v50.7.4-c",
      runtimeVariant: "v50.7.4-c",
    });
    assertGrokFirstV50SessionPayload(session);
    logGrokFirstV50ServerEvent({
      kind: "session.created",
      sessionId: session.sessionId,
      details: {
        demoSlug: session.demoSlug,
        backend: session.backend,
        realtimeTransport: session.realtimeTransport,
        model: session.model,
        voiceId: session.voiceId,
        promptHash: session.promptHash,
        promptVersion: session.promptVersion,
        guardrailVersion: session.guardrailVersion,
        registeredSpeechPayloadIncluded:
          session.registeredSpeechPayloadIncluded,
        lockedResponseAudioBundleIncluded:
          session.lockedResponseAudioBundleIncluded,
        toolCallCount: 0,
        runtimeTtsCount: 0,
        fullTurnBufferCount: 0,
        runtimeGuardrailsEnabled: session.runtimeGuardrailsEnabled,
        inputGuardEnabled: session.inputGuardEnabled,
        normalInputRouterEnabled: session.normalInputRouterEnabled,
        negativeGuardEnabled: session.negativeGuardEnabled,
        tailGuardEnabled: session.tailGuardEnabled,
        fixedGuardAudioEnabled: session.fixedGuardAudioEnabled,
        boundedRewriteEnabled: session.boundedRewriteEnabled,
        noiseIgnoredEnabled: session.noiseIgnoredEnabled,
        streamAudioBeforeDone: session.streamAudioBeforeDone,
        guardedStreamingEnabled: session.guardedStreamingEnabled,
        tailGuardNormalHoldMs: session.tailGuardNormalHoldMs,
        tailGuardRiskHoldMs: session.tailGuardRiskHoldMs,
        tailGuardMaxHoldMs: session.tailGuardMaxHoldMs,
        fullTurnBufferEnabled: session.fullTurnBufferEnabled,
        browserEvaluationEnabled: session.browserEvaluationEnabled,
        runtimeControl: session.runtimeControl,
        turnDetectionCreateResponse: false,
        regenerationRate: 0,
      },
    });
    return NextResponse.json(session);
  } catch (error) {
    console.error(
      "grok-first v50.7.4 C clean quality session failed",
      error instanceof Error ? error.message : String(error),
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
    headers ? { status, headers } : { status },
  );
}
