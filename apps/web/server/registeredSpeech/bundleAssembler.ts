import { REQUIRED_REGISTERED_SPEECH_INTENTS } from "../../lib/roleplay/registered-speech/canonical-intents";
import {
  REGISTERED_SPEECH_VOICE_ID,
  RegisteredSpeechBundleSchema,
  type RegisteredSpeechBundle,
} from "../../lib/roleplay/registered-speech/types";
import { getGrokVoiceRegisteredSpeechBundleHardLimitBytes } from "../../lib/roleplay/server-env";

import {
  loadRegisteredSpeechManifest,
  type RegisteredSpeechManifestProfile,
  type LoadedRegisteredSpeechManifest,
} from "./manifestLoader";

// Assembles the inline registered-speech bundle that ships in
// /api/v3/session. Throws if the manifest is incomplete, contains an
// unexpected intent, or the combined base64 size exceeds the env-
// configured hard limit. There is NO cap-then-truncate path here —
// review-v2 rejects silent omission because it lets required intents
// fall through to the runtime-TTS path the deterministic mode is
// trying to eliminate.

export async function buildRegisteredSpeechBundle(
  profile: RegisteredSpeechManifestProfile = "current"
): Promise<RegisteredSpeechBundle> {
  const loaded = await loadRegisteredSpeechManifest(profile);
  assertManifestExhaustive(loaded, profile);

  const artifacts = loaded.manifest.entries.map((entry) => {
    const audioBase64 = loaded.audioBase64ByIntent.get(entry.intent);
    if (!audioBase64) {
      throw new Error(
        `[registered-speech][bundleAssembler] audioBase64 missing for intent=${entry.intent}`
      );
    }
    return {
      intent: entry.intent,
      spokenText: entry.spokenText,
      displayText: entry.displayText,
      audioBase64,
      sha256: entry.sha256,
      durationMs: entry.durationMs,
    };
  });

  if (loaded.manifest.voiceId !== REGISTERED_SPEECH_VOICE_ID) {
    // The manifest schema literal already enforces this; the explicit
    // check exists so /api/v3/session emits a self-describing error if
    // a future schema bump is ever forgotten on the bundle side.
    throw new Error(
      `[registered-speech][bundleAssembler] voiceId mismatch: manifest=${loaded.manifest.voiceId} expected=${REGISTERED_SPEECH_VOICE_ID}`
    );
  }

  const bundle: RegisteredSpeechBundle = {
    manifestVersion: loaded.manifest.version,
    buildId: loaded.manifest.buildId,
    voiceId: loaded.manifest.voiceId,
    sampleRateHz: loaded.manifest.sampleRateHz,
    codec: loaded.manifest.codec,
    artifacts,
  };

  const hardLimit = getGrokVoiceRegisteredSpeechBundleHardLimitBytes();
  const totalBase64Bytes = artifacts.reduce(
    (acc, a) => acc + a.audioBase64.length,
    0
  );
  if (totalBase64Bytes > hardLimit) {
    throw new Error(
      `[registered-speech][bundleAssembler] bundle exceeds hard limit: ` +
        `total=${totalBase64Bytes}B limit=${hardLimit}B — switch to IndexedDB delivery`
    );
  }

  // Round-trip validate so /api/v3/session never ships a shape the
  // client's parser would reject.
  return RegisteredSpeechBundleSchema.parse(bundle);
}

function assertManifestExhaustive(
  loaded: LoadedRegisteredSpeechManifest,
  profile: RegisteredSpeechManifestProfile
) {
  if (profile === "haruto_20260512_23") {
    if (
      loaded.manifest.buildId !== "2026-05-12T05-31-48-094Z" ||
      loaded.manifest.entries.length !== 23
    ) {
      throw new Error(
        `[registered-speech][bundleAssembler] legacy Haruto manifest mismatch: buildId=${loaded.manifest.buildId} entries=${loaded.manifest.entries.length}`
      );
    }
    return;
  }
  const seen = new Set(loaded.manifest.entries.map((e) => e.intent));
  for (const required of REQUIRED_REGISTERED_SPEECH_INTENTS) {
    if (!seen.has(required)) {
      throw new Error(
        `[registered-speech][bundleAssembler] manifest missing required intent: ${required}`
      );
    }
  }
  if (
    loaded.manifest.entries.length !== REQUIRED_REGISTERED_SPEECH_INTENTS.length
  ) {
    throw new Error(
      `[registered-speech][bundleAssembler] manifest entry count mismatch: ` +
        `expected=${REQUIRED_REGISTERED_SPEECH_INTENTS.length} actual=${loaded.manifest.entries.length}`
    );
  }
}
