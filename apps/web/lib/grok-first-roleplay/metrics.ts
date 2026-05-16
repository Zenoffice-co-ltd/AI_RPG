import { createHash } from "node:crypto";
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
  | "guard.drain.ignored"
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
  debugTranscriptPreviewEnabled?: boolean | undefined;
}) {
  console.log(
    JSON.stringify({
      scope: "grokFirstV50",
      kind: input.kind,
      sessionId: input.sessionId ?? null,
      details: sanitizeGrokFirstV50Details(input.details ?? {}, {
        debugTranscriptPreviewEnabled:
          input.debugTranscriptPreviewEnabled ??
          isGrokFirstV50DebugTranscriptPreviewEnabled(),
      }),
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

const TRANSCRIPT_PREVIEW_KEYS = new Set([
  "sttTextPreview",
  "userTextPreview",
  "agentTextPreview",
]);

const SENSITIVE_DETAIL_KEY_PATTERN =
  /(?:token|secret|apiKey|authorization|instructions|audioBase64|rawAudio|pcmBase64|wavBase64)/i;

export function isGrokFirstV50DebugTranscriptPreviewEnabled(
  env: NodeJS.ProcessEnv = process.env
) {
  return env["GROK_FIRST_V50_DEBUG_TRANSCRIPT_PREVIEW_ENABLED"] === "true";
}

export function sanitizeGrokFirstV50Details(
  details: Record<string, unknown>,
  options: { debugTranscriptPreviewEnabled?: boolean | undefined } = {}
) {
  const debugTranscriptPreviewEnabled =
    options.debugTranscriptPreviewEnabled ??
    isGrokFirstV50DebugTranscriptPreviewEnabled();
  const trimmed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (SENSITIVE_DETAIL_KEY_PATTERN.test(key)) continue;
    if (TRANSCRIPT_PREVIEW_KEYS.has(key) && !debugTranscriptPreviewEnabled) {
      continue;
    }
    if (typeof value === "string") {
      const maxLen = TRANSCRIPT_PREVIEW_KEYS.has(key) ? 200 : 500;
      trimmed[key] =
        value.length > maxLen ? `${value.slice(0, maxLen)}...` : value;
    } else {
      trimmed[key] = value;
    }
  }
  return trimmed;
}

export function sanitizeGrokFirstVFinalDetails(details: Record<string, unknown>) {
  return sanitizeAllowlistedDetails(details);
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
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
