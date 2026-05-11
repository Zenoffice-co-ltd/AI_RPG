import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  hasDemoApiAccess,
  validateSameOrigin,
} from "@/lib/roleplay/auth";
import {
  normalizeGrokVoiceDisplayText,
  sanitizeGrokVoiceSpokenText,
} from "@/lib/roleplay/grok-voice-pr60-shared";
import {
  assertGrokVoiceEnvForProduction,
  isGrokVoiceRoleplayEnabled,
  isGrokVoiceProductionDeterministicOnlyEnabled,
} from "@/lib/roleplay/server-env";
import { synthesizeGrokVoiceTts } from "@/server/grokVoice/tts";

// Strict sanitized playback: when the realtime model has emitted a stock
// suffix at the tail of its response, the conversation hook strips it via
// sanitizeGrokVoiceSpokenText() and posts the cleaned text here. We re-run
// the sanitizer server-side as a belt-and-suspenders guard — never trust the
// client to have already cleaned the text — synthesize fresh TTS, and return
// PCM base64 for playback. This route is intentionally cache-free: sanitized
// Grok output has unbounded cardinality, so caching would pollute Firestore
// and obscure cache-hit metrics on the legitimate (greeting / locked) caches.

const SAFE_ERROR =
  "整形応答音声の生成に失敗しました。テキスト表示のまま会話を続行してください。";

const requestSchema = z.object({
  sessionId: z.string().min(1).max(128),
  // Text is bounded to keep TTS latency predictable. The realistic Grok turn
  // is well under 800 chars; longer payloads are likely junk and should be
  // rejected before we spend xAI TTS quota.
  text: z.string().min(1).max(800),
});

export async function POST(request: NextRequest) {
  if (!isGrokVoiceRoleplayEnabled()) {
    return safeError(503);
  }
  if (isGrokVoiceProductionDeterministicOnlyEnabled()) {
    console.warn(
      JSON.stringify({
        scope: "grokVoice.runtimeTts.blocked_deterministic",
        route: "/api/v3/sanitized-response-tts",
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

  // Belt-and-suspenders: re-sanitize on the server. If the client somehow
  // sent un-sanitized or empty-after-sanitize text, refuse to synthesize.
  const reSanitized = sanitizeGrokVoiceSpokenText(parsed.data.text);
  if (reSanitized.sanitizedToEmpty || reSanitized.text.trim().length === 0) {
    return safeError(400);
  }
  const text = reSanitized.text;
  const displayText = normalizeGrokVoiceDisplayText(text);

  try {
    const result = await synthesizeGrokVoiceTts({
      text,
      purpose: "sanitized_response",
    });
    // No saveGrokVoiceTtsCache(): the cache layer asserts the purpose is
    // cacheable and "sanitized_response" is rejected by design.
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
    });
  } catch (error) {
    console.error(
      "grokVoice sanitized response tts failed",
      sanitizeServerError(error)
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

function sanitizeServerError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "UnknownError" };
}
