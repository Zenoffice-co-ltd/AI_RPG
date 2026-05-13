// Single source of truth for the set of locked utterances that the
// Verified Audio Artifact pipeline must ship. Any addition / removal /
// rename here drives:
//   - the manifest schema (`apps/web/lib/roleplay/registered-speech/types.ts`)
//   - the runtime intent matcher (`./intent-matcher.ts`)
//   - the build pipeline (`scripts/grok-voice-build-registered-speech.ts`)
//   - the session-route bundle assembler (must include every required intent)
//   - the CI verifier (`scripts/grok-voice-verify-registered-speech.ts`)
//
// "Required" means: the deterministic mode session bootstrap MUST throw if
// a manifest omits any of these intents OR ships one outside this union.
// The cap-truncation pattern that the older locked-audio bundle used (max
// 8 entries, miss → silent omit) is forbidden here — bundle miss is a
// deploy-blocking failure.
export const REQUIRED_REGISTERED_SPEECH_INTENTS = [
  "mission",
  "engagement_scope",
  "job_content",
  "start_date",
  "order_volume",
  "busy_period",
  "hiring_reason",
  "ack_short",
  "skill_followup_teamwork",
  "skill_requirement_broad",
  "skill_requirement_short_01",
  "manufacturer_experience_optional",
  "personality",
  "billing_rate",
  "decision_maker",
  "decision_maker_short_01",
  "wednesday_followup",
  "closing_short",
  "working_hours",
  "overtime",
  "remote_work",
  "headcount",
  "greeting",
  "multi_intent_redirect",
  "fallback_unknown",
  "fallback_business_low_confidence_01",
  "fallback_business_low_confidence_02",
  "fallback_business_low_confidence_03",
  "fallback_rapid_fire_01",
  "fallback_rapid_fire_02",
  "fallback_rapid_fire_short_01",
  "fallback_out_of_scope_01",
  "fallback_out_of_scope_02",
  "fallback_safety_01",
  "fallback_safety_02",
  "fallback_unknown_01",
  "fallback_pr92_unknown_01",
  "fallback_audio_not_ready",
] as const;

export type CanonicalIntent =
  (typeof REQUIRED_REGISTERED_SPEECH_INTENTS)[number];

const REQUIRED_SET: ReadonlySet<string> = new Set(
  REQUIRED_REGISTERED_SPEECH_INTENTS
);

export function isCanonicalIntent(value: unknown): value is CanonicalIntent {
  return typeof value === "string" && REQUIRED_SET.has(value);
}

// The static emergency fallback — the one artifact that MUST also be
// available to the client without depending on the session payload. When
// the inline bundle is corrupted, the client still has this to play.
export const STATIC_EMERGENCY_FALLBACK_INTENT: CanonicalIntent =
  "fallback_audio_not_ready";
