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
  assertHaikuFishEnvForProduction,
  isHaikuFishRoleplayEnabled,
} from "@/lib/roleplay/server-env";
import { loadHaikuFishScenarioBundle } from "@/server/haikuFish/scenarioLoader";

const SAFE_ERROR =
  "セッションの開始に失敗しました。時間をおいて再試行してください。";

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

  const ip = resolveClientIp(request);
  const signature = request.cookies.get(DEMO_API_ACCESS_COOKIE)?.value;
  const rateLimit = checkSessionTokenRateLimit(buildRateLimitKey(ip, signature));
  if (!rateLimit.allowed) {
    return safeError(429, {
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }

  try {
    const bundle = await loadHaikuFishScenarioBundle();
    return NextResponse.json({
      sessionId: `hf_sess_${randomUUID()}`,
      scenarioId: bundle.scenarioId,
      backend: "claude-haiku-fish",
      promptVersion: bundle.promptVersion,
      firstMessage: bundle.firstMessage,
    });
  } catch (error) {
    console.error("haikuFish session bootstrap failed", sanitizeServerError(error));
    return safeError(502);
  }
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
