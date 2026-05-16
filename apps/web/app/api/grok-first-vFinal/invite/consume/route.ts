import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateSameOrigin } from "@/lib/roleplay/auth";
import { createVFinalInviteAccessResponse } from "@/lib/grok-first-roleplay/vfinal-auth";
import { checkVFinalRateLimit } from "@/lib/grok-first-roleplay/vfinal-rate-limit";
import { logGrokFirstVFinalAuthEvent } from "@/lib/grok-first-roleplay/metrics";

const bodySchema = z.object({
  invite: z.string().min(1).max(4096),
});

export async function POST(request: NextRequest) {
  if (!validateSameOrigin(request)) return safeError(403);
  const rate = checkVFinalRateLimit({
    scope: "vfinal.invite.consume",
    key: `ip:${clientIp(request)}`,
    limit: 30,
    windowMs: 5 * 60 * 1000,
  });
  if (!rate.ok) {
    return NextResponse.json(
      { error: "rate limited" },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      }
    );
  }

  let invite = "";
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      logGrokFirstVFinalAuthEvent({
        phase: "invite.consume",
        reason: "invite.malformed",
      });
      return safeError(403);
    }
    invite = parsed.data.invite;
  } catch {
    logGrokFirstVFinalAuthEvent({
      phase: "invite.consume",
      reason: "invite.malformed",
    });
    return safeError(403);
  }

  try {
    const result = createVFinalInviteAccessResponse(request, invite);
    if (!result.ok) {
      logGrokFirstVFinalAuthEvent({
        phase: "invite.consume",
        reason: result.reason,
      });
    }
    return result.response;
  } catch {
    logGrokFirstVFinalAuthEvent({
      phase: "invite.consume",
      reason: "invite.secret_missing",
    });
    return safeError(403);
  }
}

export function GET() {
  return NextResponse.json({}, { status: 405, headers: { Allow: "POST" } });
}

function safeError(status: number) {
  return NextResponse.json(
    { error: "access denied" },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

function clientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
