"use client";

import type { GrokVoiceSession } from "./grok-voice-types";

export async function fetchGrokVoiceSession(): Promise<GrokVoiceSession> {
  const response = await fetch("/api/v3/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(`grok voice session bootstrap failed: ${response.status}`);
  }
  return (await response.json()) as GrokVoiceSession;
}

export type GrokVoiceEventKind =
  | "ws.connected"
  | "ws.disconnected"
  | "ws.error"
  | "mic.permission.granted"
  | "mic.permission.denied"
  | "mic.state.changed"
  | "stt.completed"
  | "stt.skipped"
  | "stt.failed"
  | "turn.completed"
  | "turn.error"
  | "audio.queue.error"
  | "audio.queue.flushed"
  | "session.cancelled"
  | "ws.send.queued"
  | "ws.send.flushed"
  | "ws.send.failed"
  | "session.ready"
  | "session.prime.failed"
  | "barge_in.detected"
  | "barge_in.cancel_sent"
  | "barge_in.stale_delta_discarded";

export function postGrokVoiceEvent(
  kind: GrokVoiceEventKind,
  payload?: { sessionId?: string; details?: Record<string, unknown> }
): Promise<void> {
  // Fire-and-forget. Failures are silent — telemetry must never block UX.
  return fetch("/api/v3/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind,
      ...(payload?.sessionId ? { sessionId: payload.sessionId } : {}),
      ...(payload?.details ? { details: payload.details } : {}),
    }),
    keepalive: true,
  })
    .then(() => undefined)
    .catch(() => undefined);
}
