import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  REQUIRED_REGISTERED_SPEECH_INTENTS,
  type CanonicalIntent,
} from "../../lib/roleplay/registered-speech/canonical-intents";
import {
  RegisteredSpeechManifestSchema,
  type RegisteredSpeechManifest,
  type RegisteredSpeechArtifact,
} from "../../lib/roleplay/registered-speech/types";
import {
  containsVoiceStockSuffix,
  sanitizeGrokVoiceSpokenText,
} from "../../lib/roleplay/grok-voice-pr60-shared";

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

let cached: Promise<LoadedRegisteredSpeechManifest> | null = null;

function resolveManifestRoot(version: "v1"): string {
  return resolve(REPO_ROOT, "data", "generated", "registered-speech", version);
}

async function loadAndValidate(): Promise<LoadedRegisteredSpeechManifest> {
  const root = resolveManifestRoot("v1");
  const manifestPath = resolve(root, "manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  const parsed = RegisteredSpeechManifestSchema.parse(JSON.parse(raw));

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

  for (const required of REQUIRED_REGISTERED_SPEECH_INTENTS) {
    if (!seenIntents.has(required)) {
      throw new Error(
        `[registered-speech] manifest missing required intent: ${required}`
      );
    }
  }
  if (parsed.entries.length !== REQUIRED_REGISTERED_SPEECH_INTENTS.length) {
    throw new Error(
      `[registered-speech] manifest entry count mismatch: expected=${REQUIRED_REGISTERED_SPEECH_INTENTS.length} actual=${parsed.entries.length}`
    );
  }

  return { manifest: parsed, audioBase64ByIntent };
}

export function loadRegisteredSpeechManifest(): Promise<LoadedRegisteredSpeechManifest> {
  if (!cached) {
    cached = loadAndValidate().catch((error) => {
      cached = null;
      throw error;
    });
  }
  return cached;
}

export function clearRegisteredSpeechManifestCache() {
  cached = null;
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
