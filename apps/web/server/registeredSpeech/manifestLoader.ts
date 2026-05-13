import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  REQUIRED_REGISTERED_SPEECH_INTENTS,
  type CanonicalIntent,
} from "../../lib/roleplay/registered-speech/canonical-intents";
import {
  REGISTERED_SPEECH_VOICE_ID,
  RegisteredSpeechManifestSchema,
  type RegisteredSpeechManifest,
  type RegisteredSpeechArtifact,
} from "../../lib/roleplay/registered-speech/types";
import {
  containsVoiceStockSuffix,
  sanitizeGrokVoiceSpokenText,
} from "../../lib/roleplay/grok-voice-pr60-shared";
import {
  assertHumanApproved,
  assertNoArtifactPlaceholder,
  findForbiddenAssistantQuestionSuffix,
  isAsciiOnly,
  isGreetingDurationOutOfRange,
} from "../../lib/roleplay/registered-speech/text-guards";

// On-disk manifest loader. Read once at server cold start, validates
// the manifest against the schema, recomputes sha256 of every audio
// file byte-exact against the manifest claim, and runs a defense-in-
// depth forbidden-suffix scan over spokenText / displayText / asrText.
//
// Any failure throws — there is no "best effort, ship what we have"
// path. A bad manifest blocks /api/v3/session at the moment it's read
// rather than at the first lock-hit turn.

const currentDir = dirname(fileURLToPath(import.meta.url));
// The compiled output lives at apps/web/.next/.../manifestLoader.js so
// climb back to the repo root and resolve the registered-speech tree
// relative to it. This mirrors the PLS lexicon resolver in
// scenarioLoader.ts.
const REPO_ROOT = resolve(currentDir, "../../../..");

export type LoadedRegisteredSpeechManifest = {
  manifest: RegisteredSpeechManifest;
  // `audioBase64ByIntent` is base64 of the canonical .pcm bytes. The
  // sha256 of the raw bytes has already been verified equal to the
  // manifest claim by the time this map is populated.
  audioBase64ByIntent: Map<CanonicalIntent, string>;
};

export type RegisteredSpeechManifestProfile =
  | "current"
  | "haruto_20260512_23";

const LEGACY_HARUTO_20260512_23_INTENTS: readonly CanonicalIntent[] = [
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
  "personality",
  "billing_rate",
  "decision_maker",
  "wednesday_followup",
  "closing_short",
  "working_hours",
  "overtime",
  "remote_work",
  "headcount",
  "greeting",
  "multi_intent_redirect",
  "fallback_unknown",
  "fallback_audio_not_ready",
];

const LEGACY_HARUTO_20260512_BUILD_ID = "2026-05-12T05-31-48-094Z";

let cached = new Map<RegisteredSpeechManifestProfile, Promise<LoadedRegisteredSpeechManifest>>();

function resolveManifestRoot(
  version: "v1",
  profile: RegisteredSpeechManifestProfile
): string {
  return resolve(
    REPO_ROOT,
    "data",
    "generated",
    "registered-speech",
    profile === "haruto_20260512_23" ? "v1.haruto-20260512" : version
  );
}

function requiredIntentsForProfile(
  profile: RegisteredSpeechManifestProfile
): readonly CanonicalIntent[] {
  return profile === "haruto_20260512_23"
    ? LEGACY_HARUTO_20260512_23_INTENTS
    : REQUIRED_REGISTERED_SPEECH_INTENTS;
}

async function loadAndValidate(
  profile: RegisteredSpeechManifestProfile
): Promise<LoadedRegisteredSpeechManifest> {
  const root = resolveManifestRoot("v1", profile);
  const manifestPath = resolve(root, "manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  const parsed = RegisteredSpeechManifestSchema.parse(JSON.parse(raw));
  const requiredIntents = requiredIntentsForProfile(profile);
  if (
    profile === "haruto_20260512_23" &&
    parsed.buildId !== LEGACY_HARUTO_20260512_BUILD_ID
  ) {
    throw new Error(
      `[registered-speech] legacy Haruto manifest buildId mismatch: expected=${LEGACY_HARUTO_20260512_BUILD_ID} actual=${parsed.buildId}`
    );
  }

  if (parsed.voiceId !== REGISTERED_SPEECH_VOICE_ID) {
    // The schema literal already enforces this, but a runtime check
    // gives a clearer error than a Zod parse failure if the constant is
    // ever bumped without a manifest rebuild.
    throw new Error(
      `[registered-speech] manifest voiceId mismatch: expected=${REGISTERED_SPEECH_VOICE_ID} actual=${parsed.voiceId}`
    );
  }

  const expectedIntents = new Set<string>(REQUIRED_REGISTERED_SPEECH_INTENTS);
  const seenIntents = new Set<string>();
  const audioBase64ByIntent = new Map<CanonicalIntent, string>();

  for (const entry of parsed.entries) {
    if (seenIntents.has(entry.intent)) {
      throw new Error(
        `[registered-speech] duplicate intent in manifest: ${entry.intent}`
      );
    }
    seenIntents.add(entry.intent);
    if (!expectedIntents.has(entry.intent)) {
      throw new Error(
        `[registered-speech] manifest entry has unexpected intent: ${entry.intent}`
      );
    }
    assertNoForbiddenSuffix(entry);
    assertNoArtifactPlaceholder(entry.intent, entry.spokenText);
    assertNoArtifactPlaceholder(entry.intent, entry.displayText);
    const spokenQ = findForbiddenAssistantQuestionSuffix(entry.spokenText);
    if (spokenQ) {
      throw new Error(
        `[registered-speech][${entry.intent}] spokenText ends with forbidden assistant question suffix: ${spokenQ}`
      );
    }
    const displayQ = findForbiddenAssistantQuestionSuffix(entry.displayText);
    if (displayQ) {
      throw new Error(
        `[registered-speech][${entry.intent}] displayText ends with forbidden assistant question suffix: ${displayQ}`
      );
    }
    assertHumanApproved(entry.intent, entry.approvedBy, entry.approvedAt);

    const audioBytes = await readFile(resolve(root, entry.audioPath));
    const actualSha = createHash("sha256").update(audioBytes).digest("hex");
    if (actualSha !== entry.sha256) {
      throw new Error(
        `[registered-speech] sha256 mismatch for intent=${entry.intent}: ` +
          `manifest=${entry.sha256} actual=${actualSha}`
      );
    }
    audioBase64ByIntent.set(entry.intent, audioBytes.toString("base64"));
  }

  // Greeting-specific cold-start guard. The placeholder/question/sha
  // checks above already cover most failure modes, but the PR-93
  // English placeholder slipped past every existing check because none
  // of them looked at "is this even Japanese?" — make it explicit.
  // Duration is a SOFT warn (the placeholder + ASCII checks already
  // hard-fail the actual bug class; duration alone can't disambiguate
  // a long natural greeting from a long English placeholder, since
  // the PR-93 placeholder fit comfortably under the original 8s
  // sanity bound).
  const greeting = parsed.entries.find((e) => e.intent === "greeting");
  if (greeting) {
    if (isAsciiOnly(greeting.spokenText) || isAsciiOnly(greeting.displayText)) {
      throw new Error(
        `[registered-speech][greeting] artifact text contains no Japanese characters (looks like an English placeholder): spoken=${greeting.spokenText.slice(0, 80)} display=${greeting.displayText.slice(0, 80)}`
      );
    }
    if (isGreetingDurationOutOfRange(greeting.durationMs)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[registered-speech][greeting] WARN durationMs=${greeting.durationMs} outside sanity range [3000, 18000]; tolerated, but operator should re-listen.`
      );
    }
  }

  for (const required of requiredIntents) {
    if (!seenIntents.has(required)) {
      throw new Error(
        `[registered-speech] manifest missing required intent: ${required}`
      );
    }
  }
  if (parsed.entries.length !== requiredIntents.length) {
    throw new Error(
      `[registered-speech] manifest entry count mismatch: expected=${requiredIntents.length} actual=${parsed.entries.length}`
    );
  }

  return { manifest: parsed, audioBase64ByIntent };
}

export function loadRegisteredSpeechManifest(
  profile: RegisteredSpeechManifestProfile = "current"
): Promise<LoadedRegisteredSpeechManifest> {
  if (!cached.has(profile)) {
    cached.set(profile, loadAndValidate(profile).catch((error) => {
      cached.delete(profile);
      throw error;
    }));
  }
  return cached.get(profile)!;
}

export function clearRegisteredSpeechManifestCache() {
  cached = new Map();
}

function assertNoForbiddenSuffix(entry: RegisteredSpeechArtifact) {
  const tag = `[registered-speech][${entry.intent}]`;
  // Use the stricter audio-gate sanitizer for spokenText / displayText
  // (those are what reach the user), and the looser pattern set for
  // asrText (the STT may emit a stock-suffix-shaped phrase even when
  // the audio doesn't contain one — that's still a signal).
  const sanitizedSpoken = sanitizeGrokVoiceSpokenText(entry.spokenText);
  if (sanitizedSpoken.detected) {
    throw new Error(
      `${tag} spokenText contains forbidden suffix: ${sanitizedSpoken.removedPatternIds.join(", ")}`
    );
  }
  const sanitizedDisplay = sanitizeGrokVoiceSpokenText(entry.displayText);
  if (sanitizedDisplay.detected) {
    throw new Error(
      `${tag} displayText contains forbidden suffix: ${sanitizedDisplay.removedPatternIds.join(", ")}`
    );
  }
  if (containsVoiceStockSuffix(entry.asrText)) {
    throw new Error(
      `${tag} asrText contains forbidden suffix substring (defense-in-depth scan)`
    );
  }
}
