"use client";

import {
  REQUIRED_REGISTERED_SPEECH_INTENTS,
  type CanonicalIntent,
} from "./canonical-intents";
import type {
  RegisteredSpeechBundle,
  VerifiedRegisteredSpeechCache,
  VerifiedRegisteredSpeechEntry,
} from "./types";

// Build a `VerifiedRegisteredSpeechCache` from the session payload's
// `registeredSpeech` bundle. Performed once at session bootstrap BEFORE
// the mic is enabled so the turn critical path never spends time on
// base64 decode or sha256 verification (review-v2 P0-5).
//
// This module is intentionally client-only: it uses
// `crypto.subtle.digest` (Web Crypto) which works in browsers and in
// modern Node without a polyfill. The Layer A audio-path E2E uses a
// stubbed cache and never touches this module.

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

function assertCryptoSubtleAvailable(): SubtleCrypto {
  if (typeof globalThis.crypto?.subtle?.digest !== "function") {
    throw new Error(
      "[registered-speech] crypto.subtle.digest is required to verify artifacts"
    );
  }
  return globalThis.crypto.subtle;
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  // Node fallback for SSR/test contexts.
  const buf = Buffer.from(base64, "base64");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = assertCryptoSubtleAvailable();
  // `crypto.subtle.digest` accepts ArrayBuffer | ArrayBufferView. Pass
  // the typed array directly; cast through unknown to placate the
  // dom-lib's narrower BufferSource definition under TS strict mode.
  const digest = await subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  const view = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < view.length; i += 1) {
    const b = view[i] ?? 0;
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

export type BuildVerifiedCacheResult =
  | {
      kind: "ok";
      cache: VerifiedRegisteredSpeechCache;
    }
  | {
      kind: "version_mismatch";
      manifestVersion: string;
      clientVersion: string;
    }
  | {
      kind: "missing_intents";
      missing: CanonicalIntent[];
    }
  | {
      kind: "sha_mismatch";
      intent: CanonicalIntent;
      expected: string;
      actual: string;
    }
  | {
      kind: "invalid_sha_format";
      intent: CanonicalIntent;
      sha: string;
    };

export type BuildVerifiedCacheInput = {
  bundle: RegisteredSpeechBundle;
  // Client-side compile-time constant emitted by the build pipeline at
  // `apps/web/lib/roleplay/registered-speech/manifest-constant.ts`.
  // For unit tests + Layer A stubs the caller passes the test value.
  clientManifestVersion: string;
  clientBuildId?: string | null;
  requiredIntents?: readonly CanonicalIntent[];
};

export async function buildVerifiedRegisteredSpeechCache(
  input: BuildVerifiedCacheInput
): Promise<BuildVerifiedCacheResult> {
  const fullClientVersion = input.clientBuildId
    ? `${input.clientManifestVersion}.${input.clientBuildId}`
    : input.clientManifestVersion;
  const fullManifestVersion = `${input.bundle.manifestVersion}.${input.bundle.buildId}`;
  if (
    input.clientManifestVersion !== input.bundle.manifestVersion ||
    (input.clientBuildId !== undefined &&
      input.clientBuildId !== null &&
      input.clientBuildId !== input.bundle.buildId)
  ) {
    return {
      kind: "version_mismatch",
      manifestVersion: fullManifestVersion,
      clientVersion: fullClientVersion,
    };
  }

  const entries = new Map<CanonicalIntent, VerifiedRegisteredSpeechEntry>();
  const seenIntents = new Set<CanonicalIntent>();

  for (const artifact of input.bundle.artifacts) {
    if (!SHA256_HEX_PATTERN.test(artifact.sha256)) {
      return {
        kind: "invalid_sha_format",
        intent: artifact.intent,
        sha: artifact.sha256,
      };
    }
    const bytes = decodeBase64ToBytes(artifact.audioBase64);
    const actualSha = await sha256Hex(bytes);
    if (actualSha !== artifact.sha256) {
      return {
        kind: "sha_mismatch",
        intent: artifact.intent,
        expected: artifact.sha256,
        actual: actualSha,
      };
    }
    entries.set(artifact.intent, {
      intent: artifact.intent,
      spokenText: artifact.spokenText,
      displayText: artifact.displayText,
      audioBase64: artifact.audioBase64,
      decodedByteLength: bytes.length,
      sha256: artifact.sha256,
      durationMs: artifact.durationMs,
      verified: true,
    });
    seenIntents.add(artifact.intent);
  }

  const missing: CanonicalIntent[] = [];
  for (const required of input.requiredIntents ?? REQUIRED_REGISTERED_SPEECH_INTENTS) {
    if (!seenIntents.has(required)) missing.push(required);
  }
  if (missing.length > 0) {
    return { kind: "missing_intents", missing };
  }

  return {
    kind: "ok",
    cache: {
      manifestVersion: "v1",
      buildId: input.bundle.buildId,
      entries,
    },
  };
}
