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
import { synthesizeGrokVoiceTts } from "@/server/grokVoice/tts";
import {
  getCachedGrokVoiceTts,
  saveGrokVoiceTtsCache,
} from "@/server/grokVoice/ttsCache";

const SAFE_ERROR =
  "短い応答音声の生成に失敗しました。テキスト表示のまま会話を続行してください。";

const ALLOWED_SHORT_ACKS = new Set([
  "はい。",
  "そうですね。",
  "いえいえ、こちらこそ。",
  "受注処理が増えていて、社員側の確認負荷が高くなっています。",
  "受注入力、発注処理、納期調整、代理店や工務店からの問い合わせ対応が中心です。",
  "営業事務一名で、六月一日開始希望、業務は受注入力と納期調整が中心です。",
  "受注入力と納期調整が中心で、代理店や工務店との電話・メール対応があり、週五日出社前提です。",
  "人事側で条件面を確認し、現場課長が業務適性を見る理解で近いです。",
]);

const requestSchema = z.object({
  sessionId: z.string().min(1).max(160),
  text: z.string().min(1).max(80),
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
  const text = parsed.data.text.trim();
  if (!ALLOWED_SHORT_ACKS.has(text)) return safeError(400);

  try {
    const env = getGrokVoiceServerEnv();
    const cached = await getCachedGrokVoiceTts({
      text,
      voiceId: env.GROK_VOICE_VOICE_ID,
      sampleRateHz: env.GROK_VOICE_SAMPLE_RATE,
      purpose: "locked_response",
      firestoreTimeoutMs: 250,
    });
    if (cached) {
      return NextResponse.json({
        audioBase64: cached.audioBase64,
        mimeType: cached.mimeType,
        sampleRateHz: cached.sampleRateHz,
        textLen: text.length,
        voiceId: cached.voiceId,
        vendorMs: cached.vendorMs ?? undefined,
        cacheStatus: "hit",
        cacheKeyHash: cached.cacheKeyHash,
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
      "grok-first v50.7 quality short ack failed",
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
