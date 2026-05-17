import type { GrokFirstV50Metric } from "./types";

export type GrokFirstV50EventKind =
  | "session.created"
  | "session.ready"
  | "ws.connected"
  | "ws.disconnected"
  | "ws.error"
  | "mic.state.changed"
  | "stt.completed"
  | "stt.failed"
  | "stt.skipped"
  | "normal_input.routed"
  | "guard.detected"
  | "guard.drain.ignored"
  | "guard.rewrite_empty_done_ignored"
  | "fixed_guard.playback.started"
  | "fixed_guard.playback.completed"
  | "tail_guard.released"
  | "tail_guard.dropped"
  | "turn.completed"
  | "turn.error"
  | "evaluation.requested"
  | "evaluation.completed"
  | "evaluation.failed";

export function logGrokFirstV50ServerEvent(input: {
  kind: GrokFirstV50EventKind;
  sessionId?: string | undefined;
  details?: Record<string, unknown> | undefined;
}) {
  console.info(
    JSON.stringify({
      scope: "grokFirstV50",
      kind: input.kind,
      sessionId: input.sessionId ?? null,
      details: sanitizeDetails(input.details ?? {}),
      timestamp: new Date().toISOString(),
    })
  );
}

const VFINAL_EVENT_DETAIL_ALLOWLIST = new Set([
  "turnIndex",
  "inputMode",
  "routePath",
  "guardAction",
  "guardReasons",
  "userTextLen",
  "agentTextLen",
  "firstAudioDeltaMs",
  "firstAudibleAudioMs",
  "doneMs",
  "audioBytes",
  "tailGuardHoldMs",
  "tailAudioDroppedBytes",
  "websocketReconnectCount",
  "promptHash",
  "promptVersion",
  "guardrailVersion",
  "model",
  "voiceId",
  "demoSlug",
  "backend",
  "realtimeTransport",
  "registeredSpeechPayloadIncluded",
  "lockedResponseAudioBundleIncluded",
]);

export function logGrokFirstVFinalServerEvent(input: {
  kind: GrokFirstV50EventKind;
  sessionId?: string | undefined;
  participantIdHash?: string | undefined;
  details?: Record<string, unknown> | undefined;
}) {
  console.info(
    JSON.stringify({
      scope: "grokFirstVFinal",
      kind: input.kind,
      sessionIdHash: input.sessionId ? hashForLog(input.sessionId) : null,
      participantIdHash: input.participantIdHash ?? null,
      details: sanitizeAllowlistedDetails(input.details ?? {}),
      timestamp: new Date().toISOString(),
    })
  );
}

export function assertFixedAnswerEliminationMetric(metric: GrokFirstV50Metric) {
  if (
    metric.businessRegisteredSpeechHitCount !== 0 ||
    metric.businessPr60LockHitCount !== 0 ||
    metric.fixedFallbackBusinessHitCount !== 0 ||
    metric.registeredSpeechPayloadIncluded !== false ||
    metric.lockedResponseAudioBundleIncluded !== false ||
    metric.routePath.startsWith("registered_speech") ||
    metric.routePath.startsWith("lock_voice")
  ) {
    throw new Error("v50 fixed-answer elimination metric invariant failed");
  }
}

function sanitizeDetails(details: Record<string, unknown>) {
  const trimmed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "string") {
      trimmed[key] = value.length > 500 ? `${value.slice(0, 500)}...` : value;
    } else {
      trimmed[key] = value;
    }
  }
  return trimmed;
}

function sanitizeAllowlistedDetails(details: Record<string, unknown>) {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!VFINAL_EVENT_DETAIL_ALLOWLIST.has(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

function hashForLog(value: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
