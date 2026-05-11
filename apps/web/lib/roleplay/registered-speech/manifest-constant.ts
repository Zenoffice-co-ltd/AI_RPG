// Compile-time constant emitted by the registered-speech build pipeline.
// Until the first artifact build runs and the promote script writes a
// real `manifest.json`, this file ships a placeholder version that the
// runtime version-handshake will refuse to match — so a fresh repo
// can't accidentally enable deterministic mode without a verified
// manifest in place.
//
// The build script (`scripts/grok-voice-build-registered-speech.ts`)
// rewrites this file on promote, embedding the manifest's `version`
// and `buildId`. Reviewers should see the diff here in the same PR
// that updates `data/generated/registered-speech/v1/manifest.json`.
export const REGISTERED_SPEECH_CLIENT_MANIFEST_VERSION = "v1";
export const REGISTERED_SPEECH_CLIENT_BUILD_ID = "uninitialized";
