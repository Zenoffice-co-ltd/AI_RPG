import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  hasDemoApiAccess,
  validateSameOrigin,
} from "@/lib/roleplay/auth";
import { isHaikuFishRoleplayEnabled } from "@/lib/roleplay/server-env";

const SAFE_ERROR = "イベントを記録できませんでした。";

const allowedKinds = [
  "mic.permission.granted",
  "mic.permission.denied",
  "mic.state",
  "mic.utterance.queued",
  "mic.utterance.skipped",
  "mic.error",
  "audio.queue.error",
  "respond.start",
  "respond.error",
] as const;

const requestSchema = z.object({
  kind: z.enum(allowedKinds),
  sessionId: z.string().min(1).max(128).optional(),
  // Bound the payload to avoid unbounded log volume.
  details: z.record(z.string(), z.unknown()).optional(),
});

export function POST(request: NextRequest) {
  if (!isHaikuFishRoleplayEnabled()) {
    return NextResponse.json({ error: SAFE_ERROR }, { status: 503 });
  }
  if (!validateSameOrigin(request)) {
    return NextResponse.json({ error: SAFE_ERROR }, { status: 403 });
  }
  if (!hasDemoApiAccess(request)) {
    return NextResponse.json({ error: SAFE_ERROR }, { status: 401 });
  }

  return request
    .json()
    .then((body: unknown) => {
      const parsed = requestSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: SAFE_ERROR }, { status: 400 });
      }
      // Trim individual detail values to keep log lines bounded.
      const trimmedDetails: Record<string, unknown> = {};
      if (parsed.data.details) {
        for (const [key, value] of Object.entries(parsed.data.details)) {
          if (typeof value === "string" && value.length > 200) {
            trimmedDetails[key] = `${value.slice(0, 200)}…`;
          } else {
            trimmedDetails[key] = value;
          }
        }
      }
      console.log(
        JSON.stringify({
          scope: "haikuFish.clientEvent",
          kind: parsed.data.kind,
          sessionId: parsed.data.sessionId ?? null,
          details: trimmedDetails,
          ip: resolveClientIp(request),
        })
      );
      return NextResponse.json({ ok: true }, { status: 200 });
    })
    .catch(() =>
      NextResponse.json({ error: SAFE_ERROR }, { status: 400 })
    );
}

export function GET() {
  return NextResponse.json({ error: SAFE_ERROR }, { status: 405, headers: { Allow: "POST" } });
}

function resolveClientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1"
  );
}
