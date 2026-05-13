import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  hasDemoApiAccess,
  validateSameOrigin,
} from "@/lib/roleplay/auth";
import {
  getGrokVoiceTranscriptPreviewMaxChars,
  isGrokVoiceRoleplayEnabled,
  isGrokVoiceTranscriptPreviewLoggingEnabled,
} from "@/lib/roleplay/server-env";
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
  "audio.queue.flushed",
  "session.cancelled",
  "ws.send.queued",
  "ws.send.flushed",
  "ws.send.failed",
  "session.ready",
  "session.prime.failed",
  "barge_in.detected",
  "barge_in.cancel_sent",
  "barge_in.stale_delta_discarded",
  "greeting.cache.hit",
  "greeting.cache.miss",
  "greeting.tts.requested",
  "greeting.tts.completed",
  "greeting.tts.failed",
  "greeting.playback.started",
  "greeting.playback.completed",
  "greeting.playback.failed",
  "locked_response.tts.requested",
  "locked_response.tts.completed",
  "locked_response.tts.failed",
  "locked_response.playback.started",
  "locked_response.playback.completed",
  "locked_response.playback.failed",
  "locked_response.mic_tail_ignored",
  "response.done.stale_discarded",
  "response.pr60_locked_cancelled",
  "response.stock_suffix_detected",
  "response.governed_guard_failed",
  "response.unverified_audio_suppressed",
  "sanitized_response.tts.requested",
  "sanitized_response.tts.completed",
  "sanitized_response.tts.failed",
  "sanitized_response.playback.started",
  "sanitized_response.playback.skipped",
  "sanitized_response.playback.completed",
  "realtime.reseed.started",
  "realtime.reseed.completed",
  "realtime.reseed.failed",
  "realtime.session_tainted",
  // PR B — locked-response audio prebundle telemetry.
  "locked_audio_bundle.loaded",
  "locked_audio_bundle.miss",
  "locked_audio_bundle.disabled",
  "registered_speech.manifest_version_mismatch",
  "registered_speech.bundle_missing",
  "registered_speech.sha_verified",
  "registered_speech.sha_mismatch",
  "registered_speech.artifact.played",
  "registered_speech.fail_closed_emergency",
  "registered_speech.fallback_unknown.played",
  "registered_speech.multi_intent_redirect.played",
  "registered_speech.intent_matched",
  "registered_speech.playback.started",
  "registered_speech.playback.completed",
  "registered_speech.playback.failed",
  "registered_speech.cache_miss_fail_closed",
  "realtime.output_audio_delta.dropped_deterministic",
  "runtime_tts.fetch_blocked_deterministic",
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
      const trimmedDetails = sanitizeEventDetails(parsed.data.details ?? {});
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
          const sttTextPreview = stringOrUndefined(
            trimmedDetails["sttTextPreview"]
          );
          const sttTextPreviewUtf8Base64 = stringOrUndefined(
            trimmedDetails["sttTextPreviewUtf8Base64"]
          );
          logGrokVoiceStt({
            sessionId,
            turnIndex: numberOrNull(trimmedDetails["turnIndex"]),
            textLen: numberOr(trimmedDetails["textLen"], 0),
            confidence: numberOrNull(trimmedDetails["confidence"]),
            vendorMs: numberOrNull(trimmedDetails["vendorMs"]),
            ...(sttTextPreview ? { sttTextPreview } : {}),
            ...(sttTextPreviewUtf8Base64 ? { sttTextPreviewUtf8Base64 } : {}),
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
            const userTextPreview = stringOrUndefined(
              trimmedDetails["userTextPreview"]
            );
            const agentTextPreview = stringOrUndefined(
              trimmedDetails["agentTextPreview"]
            );
            const agentSpokenTextPreview = stringOrUndefined(
              trimmedDetails["agentSpokenTextPreview"]
            );
            const userTextPreviewUtf8Base64 = stringOrUndefined(
              trimmedDetails["userTextPreviewUtf8Base64"]
            );
            const agentTextPreviewUtf8Base64 = stringOrUndefined(
              trimmedDetails["agentTextPreviewUtf8Base64"]
            );
            const agentSpokenTextPreviewUtf8Base64 = stringOrUndefined(
              trimmedDetails["agentSpokenTextPreviewUtf8Base64"]
            );
            // Cloud Run revision identifier from the App Hosting runtime
            // (`K_REVISION` is the standard Cloud Run env var). Tagging
            // every turn with the revision lets dashboards group latency
            // by deploy without joining against rollouts API.
            const cloudRunRevision = process.env["K_REVISION"];
            // Forward the new latency-observability fields when the
            // client sent them. Untyped client builds without these fields
            // continue to work — the destructured `details` shape stays
            // backwards compatible.
            const routePathRaw = stringOrUndefined(trimmedDetails["routePath"]);
            const demoSlug = stringOrUndefined(trimmedDetails["demoSlug"]);
            const routerVariant = stringOrUndefined(
              trimmedDetails["routerVariant"]
            );
            const realtimeTransport = stringOrUndefined(
              trimmedDetails["realtimeTransport"]
            );
            const cacheStatusRaw = stringOrUndefined(
              trimmedDetails["cacheStatus"]
            );
            const strictPlaybackModeRaw = stringOrUndefined(
              trimmedDetails["strictPlaybackMode"]
            );
            // @ts-ignore -- sparse telemetry is assembled from dynamic event details.
            const turnMetricsPayload: any = {
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
              ...(demoSlug ? { demoSlug } : {}),
              ...(routerVariant ? { routerVariant } : {}),
              ...(realtimeTransport ? { realtimeTransport } : {}),
              ...(userTextPreview ? { userTextPreview } : {}),
              ...(agentTextPreview ? { agentTextPreview } : {}),
              ...(agentSpokenTextPreview ? { agentSpokenTextPreview } : {}),
              ...(userTextPreviewUtf8Base64
                ? { userTextPreviewUtf8Base64 }
                : {}),
              ...(agentTextPreviewUtf8Base64
                ? { agentTextPreviewUtf8Base64 }
                : {}),
              ...(agentSpokenTextPreviewUtf8Base64
                ? { agentSpokenTextPreviewUtf8Base64 }
                : {}),
              // exactOptionalPropertyTypes is on, so each new optional
              // field must spread-when-defined rather than always include.
              // Codex P2 fix: use `*FromDetails` helpers so a MISSING key
              // (old client) is omitted entirely, while an EXPLICIT null
              // (intentional client signal) is preserved as null.
              ...(routePathRaw && isRoutePath(routePathRaw)
                ? { routePath: routePathRaw }
                : {}),
              ...whenDefined(
                "routeStage",
                stringOrUndefinedFromDetails(trimmedDetails, "routeStage")
              ),
              ...whenDefined(
                "fallbackReason",
                stringOrUndefinedFromDetails(trimmedDetails, "fallbackReason")
              ),
              ...(typeof trimmedDetails["shouldRespond"] === "boolean"
                ? { shouldRespond: trimmedDetails["shouldRespond"] }
                : {}),
              ...whenDefined(
                "registeredSpeechIntent",
                stringOrUndefinedFromDetails(
                  trimmedDetails,
                  "registeredSpeechIntent"
                )
              ),
              ...whenDefined(
                "registeredSpeechSha256",
                stringOrUndefinedFromDetails(
                  trimmedDetails,
                  "registeredSpeechSha256"
                )
              ),
              ...whenDefined(
                "registeredSpeechManifestBuildId",
                stringOrUndefinedFromDetails(
                  trimmedDetails,
                  "registeredSpeechManifestBuildId"
                )
              ),
              ...whenDefined(
                "guardAction",
                stringOrUndefinedFromDetails(trimmedDetails, "guardAction")
              ),
              ...whenDefined(
                "inputDepth",
                stringOrUndefinedFromDetails(trimmedDetails, "inputDepth")
              ),
              ...whenDefined(
                "fallbackIntent",
                stringOrUndefinedFromDetails(trimmedDetails, "fallbackIntent")
              ),
              ...(typeof trimmedDetails["forbiddenSuffixDetected"] === "boolean"
                ? {
                    forbiddenSuffixDetected:
                      trimmedDetails["forbiddenSuffixDetected"],
                  }
                : {}),
              ...(typeof trimmedDetails["closingQuestionDetected"] === "boolean"
                ? {
                    closingQuestionDetected:
                      trimmedDetails["closingQuestionDetected"],
                  }
                : {}),
              ...(typeof trimmedDetails["hardBannedTextDetected"] === "boolean"
                ? {
                    hardBannedTextDetected:
                      trimmedDetails["hardBannedTextDetected"],
                  }
                : {}),
              ...(typeof trimmedDetails["metaLanguageDetected"] === "boolean"
                ? {
                    metaLanguageDetected:
                      trimmedDetails["metaLanguageDetected"],
                  }
                : {}),
              ...(typeof trimmedDetails["overAnsweringDetected"] === "boolean"
                ? {
                    overAnsweringDetected:
                      trimmedDetails["overAnsweringDetected"],
                  }
                : {}),
              ...(typeof trimmedDetails["guardFailedTextWasNotSpoken"] ===
              "boolean"
                ? {
                    guardFailedTextWasNotSpoken:
                      trimmedDetails["guardFailedTextWasNotSpoken"],
                  }
                : {}),
              ...(typeof trimmedDetails["audioEmittedAfterGuard"] === "boolean"
                ? {
                    audioEmittedAfterGuard:
                      trimmedDetails["audioEmittedAfterGuard"],
                  }
                : {}),
              ...whenDefined(
                "firstAudibleAudioMs",
                numberOrUndefinedFromDetails(trimmedDetails, "firstAudibleAudioMs")
              ),
              ...whenDefined(
                "firstRealtimeAudioDeltaMs",
                numberOrUndefinedFromDetails(
                  trimmedDetails,
                  "firstRealtimeAudioDeltaMs"
                )
              ),
              ...whenDefined(
                "sttFinalMs",
                numberOrUndefinedFromDetails(trimmedDetails, "sttFinalMs")
              ),
              ...whenDefined(
                "lockDecisionMs",
                numberOrUndefinedFromDetails(trimmedDetails, "lockDecisionMs")
              ),
              ...(typeof trimmedDetails["localLockedAudioHit"] === "boolean"
                ? { localLockedAudioHit: trimmedDetails["localLockedAudioHit"] }
                : {}),
              ...whenDefined(
                "lockedResponseKey",
                stringOrUndefinedFromDetails(trimmedDetails, "lockedResponseKey")
              ),
              ...(cacheStatusRaw === "hit" || cacheStatusRaw === "miss"
                ? { cacheStatus: cacheStatusRaw }
                : {}),
              ...whenDefined(
                "cacheLookupMs",
                numberOrUndefinedFromDetails(trimmedDetails, "cacheLookupMs")
              ),
              ...whenDefined(
                "ttsVendorMsAtCreation",
                numberOrUndefinedFromDetails(
                  trimmedDetails,
                  "ttsVendorMsAtCreation"
                )
              ),
              ...whenDefined(
                "networkTtsMs",
                numberOrUndefinedFromDetails(trimmedDetails, "networkTtsMs")
              ),
              ...whenDefined(
                "audioDecodeMs",
                numberOrUndefinedFromDetails(trimmedDetails, "audioDecodeMs")
              ),
              ...whenDefined(
                "sanitizerDelayMs",
                numberOrUndefinedFromDetails(trimmedDetails, "sanitizerDelayMs")
              ),
              ...whenDefined(
                "sanitizedTtsMs",
                numberOrUndefinedFromDetails(trimmedDetails, "sanitizedTtsMs")
              ),
              ...whenDefined(
                "reseedMs",
                numberOrUndefinedFromDetails(trimmedDetails, "reseedMs")
              ),
              ...whenDefined(
                "outcome",
                stringOrUndefinedFromDetails(trimmedDetails, "outcome")
              ),
              ...(typeof trimmedDetails["sessionTainted"] === "boolean"
                ? { sessionTainted: trimmedDetails["sessionTainted"] }
                : {}),
              ...whenDefined(
                "parentSessionId",
                stringOrUndefinedFromDetails(trimmedDetails, "parentSessionId")
              ),
              ...(cloudRunRevision ? { cloudRunRevision } : {}),
              // PR D — risk-based strict playback fields. Same
              // sparse-schema discipline as PR A: MISSING → omit,
              // EXPLICIT null → preserve (only meaningful for the
              // reason string; the booleans should never be null in
              // practice).
              ...(isStrictPlaybackMode(strictPlaybackModeRaw)
                ? { strictPlaybackMode: strictPlaybackModeRaw }
                : {}),
              ...(typeof trimmedDetails["strictGateApplied"] === "boolean"
                ? { strictGateApplied: trimmedDetails["strictGateApplied"] }
                : {}),
              ...whenDefined(
                "strictGateReason",
                stringOrUndefinedFromDetails(trimmedDetails, "strictGateReason")
              ),
              ...(typeof trimmedDetails["streamingBeforeDone"] === "boolean"
                ? { streamingBeforeDone: trimmedDetails["streamingBeforeDone"] }
                : {}),
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
            };
            logGrokVoiceTurnMetrics(turnMetricsPayload);
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
function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const ROUTE_PATHS = new Set([
  "lock_text",
  "lock_voice_local_audio",
  "lock_voice_network_tts",
  "rt_text",
  "rt_voice",
  "registered_speech_local",
  "registered_speech_fallback",
  "registered_speech_multi_intent_redirect",
  "registered_speech_decision_maker",
  "noise_fragment_ignored",
  "runtime_guarded_generation",
  "unknown",
]);
function isStrictPlaybackMode(
  value: string | undefined
): value is "all_turns" | "risk_based" | "monitor_only" {
  return (
    value === "all_turns" || value === "risk_based" || value === "monitor_only"
  );
}

function isRoutePath(
  value: string
): value is
  | "lock_text"
  | "lock_voice_local_audio"
  | "lock_voice_network_tts"
  | "rt_text"
  | "rt_voice"
  | "registered_speech_local"
  | "registered_speech_fallback"
  | "registered_speech_multi_intent_redirect"
  | "registered_speech_decision_maker"
  | "noise_fragment_ignored"
  | "runtime_guarded_generation"
  | "unknown" {
  return ROUTE_PATHS.has(value);
}

// Helper for `exactOptionalPropertyTypes: true`. Returns either an empty
// object or `{ [key]: value }` so a field that is `null` is forwarded as
// null, but `undefined` (not present in the input) is omitted entirely.
function whenDefined<K extends string, V>(
  key: K,
  value: V | undefined
): { [P in K]: V } | Record<string, never> {
  if (value === undefined) return {};
  return { [key]: value } as { [P in K]: V };
}

// Sparse-telemetry helpers (Codex P2 follow-up on PR #83). Why these
// exist instead of reusing `numberOrNull` / `stringOrNull`:
//   - `numberOrNull(undefined)` returns `null` (because `typeof undefined
//     !== "number"`). Pairing that with `whenDefined` would emit
//     `someField: null` for every turn — defeating the sparse schema.
//   - These helpers distinguish three cases:
//       MISSING       → return `undefined` → `whenDefined` omits the key
//       EXPLICIT null → return `null`      → `whenDefined` emits null
//       VALID number  → return the number  → `whenDefined` emits it
// This preserves "client did not send this field" vs "client explicitly
// sent null" semantics in the structured log, and keeps log volume
// proportional to actually populated fields.
function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
function numberOrUndefinedFromDetails(
  details: Record<string, unknown>,
  key: string
): number | null | undefined {
  if (!hasOwn(details, key)) return undefined;
  const value = details[key];
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function stringOrUndefinedFromDetails(
  details: Record<string, unknown>,
  key: string
): string | null | undefined {
  if (!hasOwn(details, key)) return undefined;
  const value = details[key];
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

const TRANSCRIPT_PREVIEW_KEYS = new Set([
  "sttTextPreview",
  "userTextPreview",
  "agentTextPreview",
  "agentSpokenTextPreview",
]);

const TRANSCRIPT_PREVIEW_ENCODED_KEYS = new Set([
  "sttTextPreviewUtf8Base64",
  "userTextPreviewUtf8Base64",
  "agentTextPreviewUtf8Base64",
  "agentSpokenTextPreviewUtf8Base64",
]);

const TRANSCRIPT_PREVIEW_ENCODED_KEY_BY_RAW_KEY: Record<string, string> = {
  sttTextPreview: "sttTextPreviewUtf8Base64",
  userTextPreview: "userTextPreviewUtf8Base64",
  agentTextPreview: "agentTextPreviewUtf8Base64",
  agentSpokenTextPreview: "agentSpokenTextPreviewUtf8Base64",
};

const NEVER_LOG_DETAIL_KEYS = new Set([
  "prompt",
  "instructions",
  "knowledgeBase",
  "knowledgeBaseText",
  "agentSystemPrompt",
  // Strict sanitized playback: removed stock-suffix sentences are raw model
  // output and must never appear in logs. The client sends the count and
  // pattern IDs; if a future caller passes the raw array by mistake, we drop
  // it here.
  "removedSentences",
]);

function sanitizeEventDetails(details: Record<string, unknown>) {
  const previewEnabled = isGrokVoiceTranscriptPreviewLoggingEnabled();
  const previewMaxChars = getGrokVoiceTranscriptPreviewMaxChars();
  const enterpriseRelay =
    details["demoSlug"] === "adecco-roleplay-v25" ||
    details["realtimeTransport"] === "mendan_cloud_run_relay_wss";
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (NEVER_LOG_DETAIL_KEYS.has(key)) continue;
    if (TRANSCRIPT_PREVIEW_ENCODED_KEYS.has(key)) continue;
    if (TRANSCRIPT_PREVIEW_KEYS.has(key)) {
      if (enterpriseRelay || !previewEnabled || typeof value !== "string") {
        continue;
      }
      const preview = buildTranscriptPreview(value, previewMaxChars);
      sanitized[key] = preview;
      sanitized[TRANSCRIPT_PREVIEW_ENCODED_KEY_BY_RAW_KEY[key] ?? key] =
        encodeUtf8Base64(preview);
      continue;
    }
    if (typeof value === "string" && value.length > 200) {
      sanitized[key] = `${value.slice(0, 200)}…`;
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function buildTranscriptPreview(value: string, maxChars: number) {
  return redactTranscriptPreview(value).slice(0, maxChars);
}

function redactTranscriptPreview(value: string) {
  // Dedicated hook for future PII redaction. Today we only normalize
  // whitespace so structured logs stay compact and queryable.
  return value.replace(/\s+/g, " ").trim();
}

function encodeUtf8Base64(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}
