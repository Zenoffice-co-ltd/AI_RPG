import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  hasDemoApiAccess,
  validateSameOrigin,
} from "@/lib/roleplay/auth";
import {
  isHaikuFishMicInputEnabled,
  isHaikuFishRoleplayEnabled,
} from "@/lib/roleplay/server-env";
import {
  HAIKU_FISH_MIC_DISABLED_PAYLOAD,
  transcribeHaikuFishAudio,
} from "@/server/haikuFish/transcribe";

const SAFE_ERROR =
  "音声認識に失敗しました。もう一度お試しください。";

const requestSchema = z.object({
  audioBase64: z.string().min(20).max(2_500_000),
  audioMimeType: z.string().min(1).max(120).optional(),
});

export async function POST(request: NextRequest) {
  if (!isHaikuFishRoleplayEnabled()) {
    return NextResponse.json({ error: SAFE_ERROR }, { status: 503 });
  }
  if (!validateSameOrigin(request)) {
    return NextResponse.json({ error: SAFE_ERROR }, { status: 403 });
  }
  if (!hasDemoApiAccess(request)) {
    return NextResponse.json({ error: SAFE_ERROR }, { status: 401 });
  }
  if (!isHaikuFishMicInputEnabled()) {
    return NextResponse.json(HAIKU_FISH_MIC_DISABLED_PAYLOAD, { status: 501 });
  }

  // /transcribe is per-utterance, naturally throttled by speech cadence.

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: SAFE_ERROR }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: SAFE_ERROR }, { status: 400 });
  }

  try {
    const result = await transcribeHaikuFishAudio({
      audioBase64: parsed.data.audioBase64,
      ...(parsed.data.audioMimeType ? { audioMimeType: parsed.data.audioMimeType } : {}),
    });
    console.log(
      JSON.stringify({
        scope: "haikuFish.stt",
        textLength: result.text.length,
        textPreview: result.text.slice(0, 80),
        confidence: result.confidence,
        vendorRequestMs: result.vendorRequestMs,
        audioBase64Length: parsed.data.audioBase64.length,
        audioMimeType: parsed.data.audioMimeType ?? null,
        wasEmpty: result.text.length === 0,
      })
    );
    return NextResponse.json({
      text: result.text,
      confidence: result.confidence,
      vendorRequestMs: result.vendorRequestMs,
    });
  } catch (error) {
    console.error("haikuFish transcribe failed", sanitizeServerError(error));
    return NextResponse.json({ error: SAFE_ERROR }, { status: 502 });
  }
}

export function GET() {
  return NextResponse.json({ error: SAFE_ERROR }, { status: 405, headers: { Allow: "POST" } });
}

function sanitizeServerError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "UnknownError" };
}
