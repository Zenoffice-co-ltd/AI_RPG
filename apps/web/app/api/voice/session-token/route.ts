import { NextResponse, type NextRequest } from "next/server";
import {
  DEMO_API_ACCESS_COOKIE,
  hasDemoApiAccess,
  validateSameOrigin,
} from "@/lib/roleplay/auth";
import {
  buildRateLimitKey,
  checkSessionTokenRateLimit,
} from "@/lib/roleplay/rate-limit";
import { getVoiceServerEnv } from "@/lib/roleplay/server-env";
import {
  issueConversationToken,
  SAFE_SESSION_ERROR,
  sessionTokenRequestSchema,
} from "@/lib/roleplay/voice-session";

export async function POST(request: NextRequest) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return safeError(400);
  }

  const parsed = sessionTokenRequestSchema.safeParse(body);
  if (!parsed.success) {
    return safeError(400);
  }

  try {
    const env = getVoiceServerEnv();
    const conversationToken = await issueConversationToken({
      env,
      ...(parsed.data.participantName
        ? { participantName: parsed.data.participantName }
        : {}),
    });
    return NextResponse.json({ conversationToken });
  } catch (error) {
    console.error("Voice session token issue failed", sanitizeServerError(error));
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
    { error: SAFE_SESSION_ERROR },
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
