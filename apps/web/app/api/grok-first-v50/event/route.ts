import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  hasDemoApiAccess,
  validateSameOrigin,
} from "@/lib/roleplay/auth";
import { logGrokFirstV50ServerEvent } from "@/lib/grok-first-roleplay/metrics";

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
    "opening.playback.started",
    "opening.playback.completed",
    "opening.playback.failed",
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
  if (!hasDemoApiAccess(request)) return NextResponse.json({}, { status: 401 });
  try {
    const parsed = eventSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({}, { status: 400 });
    logGrokFirstV50ServerEvent(parsed.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({}, { status: 400 });
  }
}

export function GET() {
  return NextResponse.json({}, { status: 405, headers: { Allow: "POST" } });
}
