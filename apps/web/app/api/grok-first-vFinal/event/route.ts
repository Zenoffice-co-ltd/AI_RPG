import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateSameOrigin } from "@/lib/roleplay/auth";
import {
  logGrokFirstVFinalAuthEvent,
  logGrokFirstVFinalServerEvent,
} from "@/lib/grok-first-roleplay/metrics";
import { getVFinalApiAccessSessionResult } from "@/lib/grok-first-roleplay/vfinal-auth";
import { checkVFinalRateLimit } from "@/lib/grok-first-roleplay/vfinal-rate-limit";

const eventSchema = z.object({
  kind: z.enum([
    "session.created",
    "session.ready",
    "ws.connected",
    "ws.disconnected",
    "ws.error",
    "mic.state.changed",
    "stt.completed",
    "stt.failed",
    "stt.skipped",
    "guard.detected",
    "guard.drain.ignored",
    "fixed_guard.playback.started",
    "fixed_guard.playback.completed",
    "tail_guard.released",
    "tail_guard.dropped",
    "turn.completed",
    "turn.error",
    "evaluation.requested",
    "evaluation.completed",
    "evaluation.failed",
  ]),
  sessionId: z.string().max(160).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  if (!validateSameOrigin(request)) return NextResponse.json({}, { status: 403 });
  const access = getVFinalApiAccessSessionResult(request);
  if (!access.ok) {
    logGrokFirstVFinalAuthEvent({
      phase: "event.auth",
      reason: access.reason,
    });
    return NextResponse.json({}, { status: 401 });
  }
  const rate = checkVFinalRateLimit({
    scope: "vfinal.event",
    key: access.session.participantIdHash || clientIp(request),
    limit: 600,
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
    const parsed = eventSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({}, { status: 400 });
    logGrokFirstVFinalServerEvent({
      ...parsed.data,
      participantIdHash: access.session.participantIdHash,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({}, { status: 400 });
  }
}

export function GET() {
  return NextResponse.json({}, { status: 405, headers: { Allow: "POST" } });
}

function clientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
