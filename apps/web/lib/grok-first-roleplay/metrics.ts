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
  | "guard.detected"
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
  console.log(
    JSON.stringify({
      scope: "grokFirstV50",
      kind: input.kind,
      sessionId: input.sessionId ?? null,
      details: sanitizeDetails(input.details ?? {}),
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
