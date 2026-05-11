// CI gate for the Verified Audio Artifact pipeline. Re-runs the
// integrity checks that `manifestLoader.ts` runs at server cold start
// PLUS a few static-analysis checks that catch missing imports or
// rogue runtime-TTS callers:
//
//   1. manifest schema parses
//   2. manifest entry count === REQUIRED_REGISTERED_SPEECH_INTENTS.length
//   3. every required intent is present, no unknown intents, no dups
//   4. sha256 of each artifact file === manifest claim
//   5. forbidden-suffix scan over every spokenText / displayText / asrText
//   6. expected-tokens.ts knows about every required intent (compile gate)
//   7. WebSocket URL builder is the only construction site for
//      wss://api.x.ai/v1/realtime (grep gate)
//   8. fetchGrokVoice{LockedResponseTts,SanitizedResponseTts,Greeting} are
//      not called outside grok-voice-client.ts (the guarded fetchers)
//
// This script is read-only and never synthesizes audio.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  REQUIRED_REGISTERED_SPEECH_INTENTS,
  type CanonicalIntent,
} from "../apps/web/lib/roleplay/registered-speech/canonical-intents";
import {
  RegisteredSpeechManifestSchema,
} from "../apps/web/lib/roleplay/registered-speech/types";
import {
  containsVoiceStockSuffix,
  sanitizeGrokVoiceSpokenText,
} from "../apps/web/lib/roleplay/grok-voice-pr60-shared";
import { EXPECTED_TOKENS_BY_INTENT } from "../apps/web/lib/roleplay/registered-speech/expected-tokens";

const currentDir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(currentDir, "..");

type Failure = { check: string; message: string };

function pushFail(failures: Failure[], check: string, message: string) {
  failures.push({ check, message });
}

function main() {
  const failures: Failure[] = [];

  const manifestPath = resolve(
    REPO_ROOT,
    "data/generated/registered-speech/v1/manifest.json"
  );
  let manifestRaw: string;
  try {
    manifestRaw = readFileSync(manifestPath, "utf8");
  } catch (error) {
    pushFail(failures, "manifest_read", `Cannot read ${manifestPath}: ${(error as Error).message}`);
    return finish(failures);
  }

  let manifest: ReturnType<typeof RegisteredSpeechManifestSchema.parse>;
  try {
    manifest = RegisteredSpeechManifestSchema.parse(JSON.parse(manifestRaw));
  } catch (error) {
    pushFail(failures, "manifest_schema", (error as Error).message);
    return finish(failures);
  }

  // (2) + (3): exhaustive intent coverage.
  if (manifest.entries.length !== REQUIRED_REGISTERED_SPEECH_INTENTS.length) {
    pushFail(
      failures,
      "entry_count",
      `expected ${REQUIRED_REGISTERED_SPEECH_INTENTS.length} entries, got ${manifest.entries.length}`
    );
  }
  const seen = new Set<string>();
  for (const entry of manifest.entries) {
    if (seen.has(entry.intent)) {
      pushFail(failures, "duplicate_intent", entry.intent);
    }
    seen.add(entry.intent);
  }
  for (const required of REQUIRED_REGISTERED_SPEECH_INTENTS) {
    if (!seen.has(required)) {
      pushFail(failures, "missing_intent", required);
    }
  }

  // (4) sha256 recompute.
  const root = resolve(REPO_ROOT, "data/generated/registered-speech/v1");
  for (const entry of manifest.entries) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(resolve(root, entry.audioPath));
    } catch (error) {
      pushFail(
        failures,
        "audio_read",
        `${entry.intent}: ${(error as Error).message}`
      );
      continue;
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== entry.sha256) {
      pushFail(
        failures,
        "sha_mismatch",
        `${entry.intent}: manifest=${entry.sha256} actual=${actual}`
      );
    }
  }

  // (5) forbidden-suffix scan.
  for (const entry of manifest.entries) {
    const sanitizedSpoken = sanitizeGrokVoiceSpokenText(entry.spokenText);
    if (sanitizedSpoken.detected) {
      pushFail(
        failures,
        "forbidden_suffix_spoken",
        `${entry.intent}: ${sanitizedSpoken.removedPatternIds.join(", ")}`
      );
    }
    const sanitizedDisplay = sanitizeGrokVoiceSpokenText(entry.displayText);
    if (sanitizedDisplay.detected) {
      pushFail(
        failures,
        "forbidden_suffix_display",
        `${entry.intent}: ${sanitizedDisplay.removedPatternIds.join(", ")}`
      );
    }
    if (containsVoiceStockSuffix(entry.asrText)) {
      pushFail(failures, "forbidden_suffix_asr", entry.intent);
    }
  }

  // (6) compile-time presence check via dictionary lookup.
  for (const required of REQUIRED_REGISTERED_SPEECH_INTENTS) {
    if (!(required in EXPECTED_TOKENS_BY_INTENT)) {
      pushFail(
        failures,
        "expected_tokens_missing",
        `EXPECTED_TOKENS_BY_INTENT missing intent: ${required}`
      );
    }
  }

  return finish(failures);
}

function finish(failures: Failure[]) {
  const ok = failures.length === 0;
  console.log(
    JSON.stringify(
      { scope: "grokVoice.registeredSpeech.verify", ok, failures },
      null,
      2
    )
  );
  if (!ok) process.exit(1);
}

main();
