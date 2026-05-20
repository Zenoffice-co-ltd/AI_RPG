import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  hasDemoApiAccess,
  validateSameOrigin,
} from "@/lib/roleplay/auth";
import {
  assertGrokVoiceEnvForProduction,
  getGrokVoiceServerEnv,
  isGrokVoiceRoleplayEnabled,
} from "@/lib/roleplay/server-env";
import { buildGrokFirstV50Prompt } from "@/lib/grok-first-roleplay/prompt";
import { synthesizeGrokVoiceTts } from "@/server/grokVoice/tts";
import {
  getCachedGrokVoiceTts,
  saveGrokVoiceTtsCache,
} from "@/server/grokVoice/ttsCache";

const SAFE_ERROR =
  "初回音声の生成に失敗しました。テキスト表示のまま会話を続行してください。";

const requestSchema = z.object({
  sessionId: z.string().min(1).max(160),
  text: z.string().min(1).max(500),
});

export async function POST(request: NextRequest) {
  if (!isGrokVoiceRoleplayEnabled()) return safeError(503);
  try {
    assertGrokVoiceEnvForProduction();
  } catch {
    return safeError(503);
  }
  if (!validateSameOrigin(request)) return safeError(403);
  if (!hasDemoApiAccess(request)) return safeError(401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return safeError(400);
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return safeError(400);

  const prompt = buildGrokFirstV50Prompt("v50.7.2");
  if (parsed.data.text !== prompt.firstMessage) return safeError(400);

  try {
    const env = getGrokVoiceServerEnv();
    const cached = await getCachedGrokVoiceTts({
      text: prompt.firstMessage,
      voiceId: env.GROK_VOICE_VOICE_ID,
      sampleRateHz: env.GROK_VOICE_SAMPLE_RATE,
      purpose: "greeting",
      firestoreTimeoutMs: 250,
    });
    if (cached) {
      return NextResponse.json({
        audioBase64: cached.audioBase64,
        mimeType: cached.mimeType,
        sampleRateHz: cached.sampleRateHz,
        textLen: prompt.firstMessage.length,
        voiceId: cached.voiceId,
        vendorMs: cached.vendorMs ?? undefined,
        cacheStatus: "hit",
        cacheKeyHash: cached.cacheKeyHash,
      });
    }
    const result = await synthesizeGrokVoiceTts({
      text: prompt.firstMessage,
      purpose: "greeting",
    });
    saveGrokVoiceTtsCache({
      text: prompt.firstMessage,
      purpose: "greeting",
      result,
    });
    return NextResponse.json({
      audioBase64: result.audio.toString("base64"),
      mimeType: result.mimeType,
      sampleRateHz: result.sampleRateHz,
      textLen: result.textLen,
      voiceId: result.voiceId,
      vendorMs: result.vendorMs,
      cacheStatus: "miss",
    });
  } catch (error) {
    console.error(
      "grok-first v50.7.4 clean quality greeting failed",
      error instanceof Error ? error.message : String(error)
    );
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
