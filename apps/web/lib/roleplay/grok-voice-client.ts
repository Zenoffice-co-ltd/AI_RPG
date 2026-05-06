"use client";

import type {
  GrokVoiceGreeting,
  GrokVoiceLockedResponseTts,
  GrokVoiceSession,
} from "./grok-voice-types";

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

export async function fetchGrokVoiceGreeting(input: {
  sessionId: string;
  text: string;
}): Promise<GrokVoiceGreeting> {
  const response = await fetch("/api/v3/greet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`grok voice greeting tts failed: ${response.status}`);
  }
  return (await response.json()) as GrokVoiceGreeting;
}

export async function fetchGrokVoiceLockedResponseTts(input: {
  sessionId: string;
  userText: string;
}): Promise<GrokVoiceLockedResponseTts> {
  const response = await fetch("/api/v3/locked-response-tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`grok voice locked response tts failed: ${response.status}`);
  }
  return (await response.json()) as GrokVoiceLockedResponseTts;
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
  | "barge_in.stale_delta_discarded"
  | "greeting.cache.hit"
  | "greeting.cache.miss"
  | "greeting.tts.requested"
  | "greeting.tts.completed"
  | "greeting.tts.failed"
  | "greeting.playback.started"
  | "greeting.playback.completed"
  | "greeting.playback.failed"
  | "locked_response.tts.requested"
  | "locked_response.tts.completed"
  | "locked_response.tts.failed"
  | "locked_response.playback.started"
  | "locked_response.playback.completed"
  | "locked_response.playback.failed"
  | "locked_response.mic_tail_ignored"
  | "response.done.stale_discarded"
  | "response.pr60_locked_cancelled";

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
