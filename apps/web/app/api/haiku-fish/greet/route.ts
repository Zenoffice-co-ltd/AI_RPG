import { NextResponse, type NextRequest } from "next/server";
import {
  hasDemoApiAccess,
  validateSameOrigin,
} from "@/lib/roleplay/auth";
import {
  assertHaikuFishEnvForProduction,
  isHaikuFishRoleplayEnabled,
} from "@/lib/roleplay/server-env";
import { loadHaikuFishScenarioBundle } from "@/server/haikuFish/scenarioLoader";
import { synthesizeHaikuFishAudio } from "@/server/haikuFish/fishTts";

const SAFE_ERROR =
  "音声生成に失敗しました。時間をおいて再試行してください。";

export async function POST(request: NextRequest) {
  if (!isHaikuFishRoleplayEnabled()) {
    return safeError(503);
  }
  try {
    assertHaikuFishEnvForProduction();
  } catch {
    return safeError(503);
  }

  if (!validateSameOrigin(request)) {
    return safeError(403);
  }
  if (!hasDemoApiAccess(request)) {
    return safeError(401);
  }

  // /greet is called once per session bootstrap; rate-limit lives on /session.

  try {
    const bundle = await loadHaikuFishScenarioBundle();
    const { result } = await synthesizeHaikuFishAudio({ text: bundle.firstMessage });
    if (!result.success || !result.audio) {
      return safeError(502);
    }
    return NextResponse.json({
      format: result.format,
      sampleRateHz: result.sampleRateHz,
      base64: result.audio.toString("base64"),
    });
  } catch (error) {
    console.error("haikuFish greet failed", sanitizeServerError(error));
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
