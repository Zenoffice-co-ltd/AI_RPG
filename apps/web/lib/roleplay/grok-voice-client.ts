"use client";

import type {
  GrokVoiceGreeting,
  GrokVoiceLockedResponseTts,
  GrokVoiceSanitizedResponseTts,
  GrokVoiceSession,
} from "./grok-voice-types";

// Client-side enforcement of "no runtime TTS in deterministic mode"
// (review-v2 P0-4). The server route also returns 503, but reaching
// that 503 is itself a bug signal — the DoD requires zero fetch
// attempts. These helpers throw before the request leaves the client
// so we get a stack trace at the bad caller instead of a silent 503
// surfaced as "TTS unavailable".
class DeterministicTtsGuardError extends Error {
  constructor(public readonly route: string) {
    super(
      `[deterministic] runtime TTS endpoint is forbidden in this mode: ${route}`
    );
    this.name = "DeterministicTtsGuardError";
  }
}

let deterministicModeActive = false;

export function setGrokVoiceClientDeterministicMode(active: boolean): void {
  deterministicModeActive = active;
}

export function isGrokVoiceClientDeterministicMode(): boolean {
  return deterministicModeActive;
}

function assertNotDeterministic(route: string) {
  if (deterministicModeActive) {
    void postGrokVoiceEvent("runtime_tts.fetch_blocked_deterministic", {
      details: { route },
    });
    throw new DeterministicTtsGuardError(route);
  }
}

export async function fetchGrokVoiceSession(
  input?: { reseedFromSessionId?: string }
): Promise<GrokVoiceSession> {
  const body = input?.reseedFromSessionId
    ? { reseedFromSessionId: input.reseedFromSessionId }
    : {};
  const response = await fetch("/api/v3/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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
  assertNotDeterministic("/api/v3/greet");
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
  assertNotDeterministic("/api/v3/locked-response-tts");
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

export async function fetchGrokVoiceSanitizedResponseTts(input: {
  sessionId: string;
  text: string;
}): Promise<GrokVoiceSanitizedResponseTts> {
  assertNotDeterministic("/api/v3/sanitized-response-tts");
  const response = await fetch("/api/v3/sanitized-response-tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(
      `grok voice sanitized response tts failed: ${response.status}`
    );
  }
  return (await response.json()) as GrokVoiceSanitizedResponseTts;
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
  | "response.pr60_locked_cancelled"
  // Strict sanitized playback events.
  | "response.stock_suffix_detected"
  | "response.unverified_audio_suppressed"
  | "sanitized_response.tts.requested"
  | "sanitized_response.tts.completed"
  | "sanitized_response.tts.failed"
  | "sanitized_response.playback.started"
  | "sanitized_response.playback.completed"
  | "realtime.reseed.started"
  | "realtime.reseed.completed"
  | "realtime.reseed.failed"
  | "realtime.session_tainted"
  // PR B — locked-response audio prebundle telemetry.
  | "locked_audio_bundle.loaded"
  | "locked_audio_bundle.miss"
  | "locked_audio_bundle.disabled"
  // Verified Audio Artifact (review-v2) telemetry.
  | "registered_speech.manifest_version_mismatch"
  | "registered_speech.bundle_missing"
  | "registered_speech.sha_verified"
  | "registered_speech.sha_mismatch"
  | "registered_speech.artifact.played"
  | "registered_speech.fail_closed_emergency"
  | "registered_speech.fallback_unknown.played"
  | "registered_speech.multi_intent_redirect.played"
  | "realtime.output_audio_delta.dropped_deterministic"
  | "runtime_tts.fetch_blocked_deterministic";

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
