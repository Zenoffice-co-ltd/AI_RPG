// Compile-time constant emitted by the registered-speech promote
// script. Reviewers should see the diff here in the same PR that
// updates `data/generated/registered-speech/v1/manifest.json`.
//
// The runtime version-handshake refuses any session whose
// `registeredSpeechManifestVersion` / `registeredSpeechBuildId`
// doesn't match these constants — so flipping
// `GROK_VOICE_PRODUCTION_DETERMINISTIC_ONLY` on with a stale client
// build is impossible without redeploying.
//
// The `: string` annotation widens the literal type so the
// useGrokVoiceConversation.ts version-handshake's
// `buildId !== REGISTERED_SPEECH_CLIENT_BUILD_ID` check doesn't
// become statically-false after a promote. Without this annotation,
// TypeScript narrows the constant to the exact promoted value and
// flags the runtime comparison as always-false.
export const REGISTERED_SPEECH_CLIENT_MANIFEST_VERSION: string = "v1";
export const REGISTERED_SPEECH_CLIENT_BUILD_ID: string =
  "2026-05-11T20-45-48-237Z";
