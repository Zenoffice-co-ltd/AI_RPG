import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  hasDemoApiAccess,
  validateSameOrigin,
} from "@/lib/roleplay/auth";
import { isGrokVoiceRoleplayEnabled } from "@/lib/roleplay/server-env";
import {
  logGrokVoiceClientEvent,
  logGrokVoiceMicState,
  logGrokVoiceStt,
  logGrokVoiceSttSkipped,
  logGrokVoiceTurnMetrics,
} from "@/server/grokVoice/metrics";

const SAFE_ERROR = "イベントを記録できませんでした。";

const allowedKinds = [
  "ws.connected",
  "ws.disconnected",
  "ws.error",
  "mic.permission.granted",
  "mic.permission.denied",
  "mic.state.changed",
  "stt.completed",
  "stt.skipped",
  "stt.failed",
  "turn.completed",
  "turn.error",
  "audio.queue.error",
  "session.cancelled",
] as const;

const requestSchema = z.object({
  kind: z.enum(allowedKinds),
  sessionId: z.string().min(1).max(128).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export function POST(request: NextRequest) {
  if (!isGrokVoiceRoleplayEnabled()) {
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
      const sessionId = parsed.data.sessionId ?? null;
      const kind = parsed.data.kind;
      const ip = resolveClientIp(request);

      // Always emit a generic clientEvent line so we have a uniform audit
      // trail keyed by `grokVoice.clientEvent`.
      logGrokVoiceClientEvent({
        kind,
        sessionId,
        details: trimmedDetails,
        ip,
      });

      // For specific kinds, ALSO emit a typed structured-log line so each
      // observation lane has its own queryable scope. This is the
      // "supplement plan" — STT text/confidence (#1), empty-STT skip (#2),
      // prompt hash + version on turn metrics (#3), and mic state
      // transitions (#4) all surface as first-class log scopes.
      switch (kind) {
        case "stt.completed": {
          logGrokVoiceStt({
            sessionId,
            turnIndex: numberOrNull(trimmedDetails["turnIndex"]),
            textLen: numberOr(trimmedDetails["textLen"], 0),
            confidence: numberOrNull(trimmedDetails["confidence"]),
            vendorMs: numberOrNull(trimmedDetails["vendorMs"]),
          });
          break;
        }
        case "stt.skipped": {
          logGrokVoiceSttSkipped({
            sessionId,
            turnIndex: numberOrNull(trimmedDetails["turnIndex"]),
            reason: stringOr(trimmedDetails["reason"], "unknown"),
          });
          break;
        }
        case "mic.state.changed": {
          logGrokVoiceMicState({
            sessionId,
            from: stringOr(trimmedDetails["from"], "unknown"),
            to: stringOr(trimmedDetails["to"], "unknown"),
            durationMs: numberOrNull(trimmedDetails["durationMs"]),
          });
          break;
        }
        case "turn.completed": {
          if (sessionId) {
            logGrokVoiceTurnMetrics({
              sessionId,
              turnIndex: numberOr(trimmedDetails["turnIndex"], 0),
              inputMode:
                stringOr(trimmedDetails["inputMode"], "voice") === "text"
                  ? "text"
                  : "voice",
              userTextLen: numberOr(trimmedDetails["userTextLen"], 0),
              agentTextLen: numberOr(trimmedDetails["agentTextLen"], 0),
              firstAudioMs: numberOrNull(trimmedDetails["firstAudioMs"]),
              doneMs: numberOrNull(trimmedDetails["doneMs"]),
              audioBytes: numberOr(trimmedDetails["audioBytes"], 0),
              error: stringOrNull(trimmedDetails["error"]),
              provenance: {
                promptVersion: stringOr(
                  trimmedDetails["promptVersion"],
                  "unknown"
                ),
                agentSystemPromptHash: stringOr(
                  trimmedDetails["promptHash"],
                  ""
                ),
                knowledgeBaseTextHash: "",
                promptSectionsHash: "",
                guardrailVersion: stringOr(
                  trimmedDetails["guardrailVersion"],
                  ""
                ),
                grokVoiceModel: stringOr(
                  trimmedDetails["grokVoiceModel"],
                  ""
                ),
                grokVoiceVoiceId: stringOr(
                  trimmedDetails["grokVoiceVoiceId"],
                  ""
                ),
              },
            });
          }
          break;
        }
        default:
          break;
      }
      return NextResponse.json({ ok: true }, { status: 200 });
    })
    .catch(() => NextResponse.json({ error: SAFE_ERROR }, { status: 400 }));
}

export function GET() {
  return NextResponse.json(
    { error: SAFE_ERROR },
    { status: 405, headers: { Allow: "POST" } }
  );
}

function resolveClientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1"
  );
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
