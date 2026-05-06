import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  hasDemoApiAccess,
  validateSameOrigin,
} from "@/lib/roleplay/auth";
import {
  assertGrokVoiceEnvForProduction,
  isGrokVoiceRoleplayEnabled,
} from "@/lib/roleplay/server-env";
import { synthesizeGrokVoiceGreeting } from "@/server/grokVoice/greetTts";
import { loadGrokVoiceScenarioBundle } from "@/server/grokVoice/scenarioLoader";

const SAFE_ERROR =
  "初回音声の生成に失敗しました。テキスト表示のまま会話を続行してください。";
const MAX_GREETING_TEXT_CHARS = 500;

const requestSchema = z.object({
  sessionId: z.string().min(1).max(128),
  text: z.string().min(1).max(MAX_GREETING_TEXT_CHARS),
  voiceId: z.string().max(128).optional(),
});

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

  try {
    const bundle = await loadGrokVoiceScenarioBundle();
    if (parsed.data.text !== bundle.firstMessage) {
      return safeError(400);
    }
    const result = await synthesizeGrokVoiceGreeting({
      text: bundle.firstMessage,
    });
    return NextResponse.json({
      audioBase64: result.audio.toString("base64"),
      mimeType: result.mimeType,
      sampleRateHz: result.sampleRateHz,
      textLen: result.textLen,
      voiceId: result.voiceId,
      vendorMs: result.vendorMs,
    });
  } catch (error) {
    console.error("grokVoice greet failed", sanitizeServerError(error));
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
