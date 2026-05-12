import { z } from "zod";

import {
  REQUIRED_REGISTERED_SPEECH_INTENTS,
  type CanonicalIntent,
} from "./canonical-intents";

// xAI Grok Voice voice_id for the customer roleplay (Haruto). Pinned
// here as the single source of truth so the env var, manifest schema,
// build pipeline, runtime loader, and CI grep all agree on one
// string. Changing voices = bumping this constant + regenerating all
// 23 PCM artifacts (a partial change ships a manifest where one
// artifact uses a different voice from the rest, breaking the
// "deterministic" guarantee).
export const REGISTERED_SPEECH_VOICE_ID = "99c95cc8a177" as const;

// On-disk manifest shape. Persisted at
// `data/generated/registered-speech/<version>/manifest.json` and verified
// at server boot (`apps/web/server/registeredSpeech/manifestLoader.ts`).
// `sha256` is computed from the raw PCM bytes, NOT the base64-encoded
// payload, so the manifest stays canonical-form independent.
export const RegisteredSpeechArtifactSchema = z.object({
  intent: z.enum(REQUIRED_REGISTERED_SPEECH_INTENTS),
  spokenText: z.string().min(1),
  displayText: z.string().min(1),
  audioPath: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, {
    message: "sha256 must be 64 lowercase hex chars",
  }),
  durationMs: z.number().int().nonnegative(),
  asrText: z.string(),
  asrConfidence: z.number().nullable(),
  expectedTokensMatched: z.array(z.string()),
  approvedBy: z.string().min(1),
  approvedAt: z.string().min(1),
});

export type RegisteredSpeechArtifact = z.infer<
  typeof RegisteredSpeechArtifactSchema
>;

export const RegisteredSpeechManifestSchema = z.object({
  version: z.literal("v1"),
  buildId: z.string().min(1),
  voiceId: z.literal(REGISTERED_SPEECH_VOICE_ID),
  sampleRateHz: z.literal(24000),
  codec: z.literal("pcm"),
  entries: z.array(RegisteredSpeechArtifactSchema).min(1),
});

export type RegisteredSpeechManifest = z.infer<
  typeof RegisteredSpeechManifestSchema
>;

// Wire shape carried inside `/api/v3/session` response when
// `productionDeterministicOnly` is on.
export const RegisteredSpeechBundleArtifactSchema = z.object({
  intent: z.enum(REQUIRED_REGISTERED_SPEECH_INTENTS),
  spokenText: z.string().min(1),
  displayText: z.string().min(1),
  audioBase64: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  durationMs: z.number().int().nonnegative(),
});
export type RegisteredSpeechBundleArtifact = z.infer<
  typeof RegisteredSpeechBundleArtifactSchema
>;

export const RegisteredSpeechBundleSchema = z.object({
  manifestVersion: z.literal("v1"),
  buildId: z.string().min(1),
  voiceId: z.literal(REGISTERED_SPEECH_VOICE_ID),
  sampleRateHz: z.literal(24000),
  codec: z.literal("pcm"),
  artifacts: z.array(RegisteredSpeechBundleArtifactSchema).min(1),
});
export type RegisteredSpeechBundle = z.infer<
  typeof RegisteredSpeechBundleSchema
>;

// Hit returned by the intent matcher. `sha256` is the manifest value and
// the client compares it against its own recomputation of the audio bytes
// at session bootstrap — NEVER on the turn critical path.
export type LockedSpeechHit = {
  intent: CanonicalIntent;
  spokenText: string;
  displayText: string;
  sha256: string;
};

// Result of the build-pipeline validation per artifact. Persisted to
// `out/registered-speech-build/<utc>/report.json` so the human approver
// can review before promoting v1.candidate → v1.
export type ArtifactValidationResult = {
  intent: CanonicalIntent;
  sha256: string;
  audioPath: string;
  durationMs: number;
  asrText: string;
  asrConfidence: number | null;
  expectedTokensMatched: string[];
  expectedTokensMissing: string[];
  forbiddenSuffixHit: boolean;
  ok: boolean;
};

// Per-intent expected-token requirement: every entry in `primary` must
// appear (substring) in the ASR text; for each entry in `alternates`,
// any one of the listed alternatives must appear. This shape lets GCP
// STT v2 normalize "せんななひゃくごじゅう円" → "1750円" without breaking
// the gate.
export type ExpectedTokenRequirement = {
  primary: string[];
  alternates: string[][];
};

// Client-side cache built once at session bootstrap. Reading a hit on the
// turn critical path MUST be O(1) and MUST NOT compute sha256. Hashing
// happens at bootstrap and the result is frozen here.
export type VerifiedRegisteredSpeechEntry = {
  intent: CanonicalIntent;
  spokenText: string;
  displayText: string;
  audioBase64: string;
  decodedByteLength: number;
  sha256: string;
  durationMs: number;
  verified: true;
};

export type VerifiedRegisteredSpeechCache = {
  manifestVersion: "v1";
  buildId: string;
  entries: Map<CanonicalIntent, VerifiedRegisteredSpeechEntry>;
};
