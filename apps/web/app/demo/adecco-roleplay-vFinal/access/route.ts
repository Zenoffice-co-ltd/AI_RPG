import { NextResponse, type NextRequest } from "next/server";
import { handleVFinalInviteAccess } from "@/lib/grok-first-roleplay/vfinal-auth";
import { checkVFinalRateLimit } from "@/lib/grok-first-roleplay/vfinal-rate-limit";

export function GET(request: NextRequest) {
  const invite = request.nextUrl.searchParams.get("invite") ?? "";
  const key = invite ? `invite:${invite.slice(0, 24)}` : `ip:${clientIp(request)}`;
  const rate = checkVFinalRateLimit({
    scope: "vfinal.access",
    key,
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
  try {
    return handleVFinalInviteAccess(request);
  } catch {
    return NextResponse.json({ error: "access denied" }, { status: 403 });
  }
}

export function POST() {
  return NextResponse.json({}, { status: 405, headers: { Allow: "GET" } });
}

function clientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
