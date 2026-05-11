import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  hasDemoApiAccess,
  validateSameOrigin,
} from "@/lib/roleplay/auth";
import {
  getPr60LockedResponseForUser,
  normalizeGrokVoiceDisplayText,
} from "@/lib/roleplay/grok-voice-pr60-shared";
import {
  assertGrokVoiceEnvForProduction,
  getGrokVoiceServerEnv,
  isGrokVoiceRoleplayEnabled,
  isGrokVoiceProductionDeterministicOnlyEnabled,
} from "@/lib/roleplay/server-env";
import { synthesizeGrokVoiceTts } from "@/server/grokVoice/tts";
import {
  getCachedGrokVoiceTts,
  saveGrokVoiceTtsCache,
} from "@/server/grokVoice/ttsCache";

const SAFE_ERROR =
  "固定応答音声の生成に失敗しました。テキスト表示のまま会話を続行してください。";

const requestSchema = z.object({
  sessionId: z.string().min(1).max(128),
  userText: z.string().min(1).max(1_000),
});

export async function POST(request: NextRequest) {
  if (!isGrokVoiceRoleplayEnabled()) {
    return safeError(503);
  }
  // Verified Audio Artifact: deterministic mode forbids runtime TTS
  // entirely. The client-side fetcher MUST refuse to call this
  // endpoint when `productionDeterministicOnly` is on; reaching this
  // 503 is a bug signal (stale client or mis-deployed bundle). The
  // structured log here is what the prod smoke asserts is 0 in
  // deterministic-mode runs.
  if (isGrokVoiceProductionDeterministicOnlyEnabled()) {
    console.warn(
      JSON.stringify({
        scope: "grokVoice.runtimeTts.blocked_deterministic",
        route: "/api/v3/locked-response-tts",
      })
    );
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return safeError(400);
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return safeError(400);
  }

  const text = getPr60LockedResponseForUser(parsed.data.userText);
  if (!text) {
    return safeError(400);
  }
  const displayText = normalizeGrokVoiceDisplayText(text);

  try {
    const env = getGrokVoiceServerEnv();
    // Measure cache lookup wall-clock so the client can attribute the
    // server-side share of locked-response-tts latency. On a hit this is
    // typically <50ms (in-memory) or <250ms (Firestore-bounded). On a
    // miss it includes the full xAI synth + Firestore write. The legacy
    // `vendorMs` field on a hit is the synth time stamped at cache
    // creation, NOT this lookup — see metrics.ts comment for context.
    const cacheLookupStartedAt = Date.now();
    const cached = await getCachedGrokVoiceTts({
      text,
      voiceId: env.GROK_VOICE_VOICE_ID,
      sampleRateHz: env.GROK_VOICE_SAMPLE_RATE,
      purpose: "locked_response",
      firestoreTimeoutMs: 250,
    });
    if (cached) {
      return NextResponse.json({
        text,
        displayText,
        audioBase64: cached.audioBase64,
        mimeType: cached.mimeType,
        sampleRateHz: cached.sampleRateHz,
        textLen: text.length,
        voiceId: cached.voiceId,
        vendorMs: cached.vendorMs ?? undefined,
        cacheStatus: "hit",
        cacheKeyHash: cached.cacheKeyHash,
        cacheLookupMs: Date.now() - cacheLookupStartedAt,
        ttsVendorMsAtCreation: cached.vendorMs ?? null,
      });
    }

    const result = await synthesizeGrokVoiceTts({
      text,
      purpose: "locked_response",
    });
    saveGrokVoiceTtsCache({
      text,
      purpose: "locked_response",
      result,
    });
    return NextResponse.json({
      text,
      displayText,
      audioBase64: result.audio.toString("base64"),
      mimeType: result.mimeType,
      sampleRateHz: result.sampleRateHz,
      textLen: result.textLen,
      voiceId: result.voiceId,
      vendorMs: result.vendorMs,
      cacheStatus: "miss",
      cacheLookupMs: Date.now() - cacheLookupStartedAt,
      ttsVendorMsAtCreation: null,
    });
  } catch (error) {
    console.error("grokVoice locked response tts failed", sanitizeServerError(error));
    return safeError(502);
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

function sanitizeServerError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "UnknownError" };
}
