import { getAllPr60LockedResponses } from "../apps/web/lib/roleplay/grok-voice-pr60-shared";
import { getGrokVoiceServerEnv } from "../apps/web/lib/roleplay/server-env";
import { ensureEnvLoaded } from "../apps/web/server/loadEnv";
import {
  DEFAULT_SECRET_SOURCE_PROJECT_ID,
  accessSecretValue,
} from "../apps/web/server/secrets";
import { loadGrokVoiceScenarioBundle } from "../apps/web/server/grokVoice/scenarioLoader";
import {
  synthesizeGrokVoiceTts,
  type GrokVoiceTtsPurpose,
} from "../apps/web/server/grokVoice/tts";
import { saveGrokVoiceTtsCacheAndWait } from "../apps/web/server/grokVoice/ttsCache";

// Validation-aware XAI_API_KEY resolver. Why a custom resolver instead
// of `getEnvOrSecret`:
//   - `ensureEnvLoaded()` injects values from apps/web/.env.local into
//     process.env. AGENTS.md `## Secrets` forbids storing real keys
//     there, but stale placeholders (e.g. "test-…-e2e" from a long-ago
//     E2E run) can linger on developer machines.
//   - `getEnvOrSecret` returns whatever is in process.env without
//     length/prefix validation. A 28-char "test-…" placeholder is
//     happily forwarded to xAI, which rejects with HTTP 400
//     "Incorrect API key provided: te***2e" — exactly the failure we
//     observed when the deploy wrapper's warm step ran.
//   - The v21 scenario E2E (`scripts/grok-voice-v21-scenario-e2e.ts`)
//     already validates that the key is at least 32 chars and does not
//     start with "test-". This warm script now does the same.
//
// Resolution order:
//   1. Existing process.env["XAI_API_KEY"] if it looks real.
//   2. Secret Manager project from SECRET_SOURCE_PROJECT_ID (default
//      zapier-transfer) → fallback adecco-mendan.
//   3. BLOCKED with an actionable error message.
async function resolveXaiApiKey(): Promise<string> {
  const fromEnv = process.env["XAI_API_KEY"];
  if (looksLikeRealXaiKey(fromEnv)) {
    return fromEnv as string;
  }
  if (fromEnv) {
    console.warn(
      `[grok-voice-warm-tts-cache] ignoring local XAI_API_KEY (len=${fromEnv.length}, prefix=${fromEnv.slice(0, 5)}…) — does not pass real-key validation. Falling back to Secret Manager.`
    );
  }
  const projects = [
    process.env["SECRET_SOURCE_PROJECT_ID"] ?? DEFAULT_SECRET_SOURCE_PROJECT_ID,
    "adecco-mendan",
  ];
  for (const project of projects) {
    try {
      const value = await accessSecretValue("XAI_API_KEY", project);
      if (looksLikeRealXaiKey(value)) {
        console.info(
          `[grok-voice-warm-tts-cache] XAI_API_KEY resolved from projects/${project}/secrets/XAI_API_KEY (len=${value.length})`
        );
        return value;
      }
      console.warn(
        `[grok-voice-warm-tts-cache] projects/${project}/secrets/XAI_API_KEY did not pass real-key validation (len=${value.length}).`
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(
        `[grok-voice-warm-tts-cache] could not read projects/${project}/secrets/XAI_API_KEY: ${detail}`
      );
    }
  }
  throw new Error(
    "BLOCKED: XAI_API_KEY could not be resolved. Tried process.env, then Secret Manager (zapier-transfer, adecco-mendan). Per AGENTS.md `## Secrets` the canonical retrieval command is `gcloud secrets versions access latest --secret=XAI_API_KEY --project=<PROJECT>`."
  );
}

// xAI live keys are at least 32 characters and (as of 2026-05) start
// with "xai-". Placeholder values used in unit tests / .env.local
// fixtures conventionally start with "test-". Reject both length and
// prefix mismatches so the script fails fast with a clear message
// instead of pushing a 400 round-trip to xAI.
function looksLikeRealXaiKey(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    !value.startsWith("test-")
  );
}

async function main() {
  ensureEnvLoaded();
  process.env["XAI_API_KEY"] = await resolveXaiApiKey();

  const env = getGrokVoiceServerEnv();
  const bundle = await loadGrokVoiceScenarioBundle();
  const texts = Array.from(
    new Set([bundle.firstMessage, ...getAllPr60LockedResponses()])
  );

  console.info(
    `[grok-voice-warm-tts-cache] warming ${texts.length} entries voice=${env.GROK_VOICE_VOICE_ID} sampleRate=${env.GROK_VOICE_SAMPLE_RATE}`
  );
  let ok = 0;
  let failed = 0;
  for (const text of texts) {
    const purpose = text === bundle.firstMessage ? "greeting" : "locked_response";
    process.stdout.write(
      `  ${purpose.padEnd(15)} len=${String(text.length).padStart(3)} ... `
    );
    try {
      const result = await synthesizeWithRetry({ text, purpose });
      await saveGrokVoiceTtsCacheAndWait({ text, purpose, result });
      console.info(`ok audioBytes=${result.audio.byteLength} vendorMs=${result.vendorMs}`);
      ok += 1;
    } catch (error) {
      console.info("FAIL");
      console.error(
        `    ${error instanceof Error ? error.message : String(error)}`
      );
      failed += 1;
    }
  }
  console.info(
    `[grok-voice-warm-tts-cache] done: ok=${ok} failed=${failed} total=${texts.length}`
  );
  if (failed > 0) {
    throw new Error(
      `${failed} of ${texts.length} canonical entries failed to warm. See per-entry FAIL messages above.`
    );
  }
}

async function synthesizeWithRetry(input: {
  text: string;
  purpose: GrokVoiceTtsPurpose;
}) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await synthesizeGrokVoiceTts(input);
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        process.stdout.write(`retry${attempt} `);
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
      }
    }
  }
  throw lastError;
}

main().catch((error) => {
  console.error("BLOCKED: Grok Voice TTS cache warm failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
