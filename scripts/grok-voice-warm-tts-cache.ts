import { getAllPr60LockedResponses } from "../apps/web/lib/roleplay/grok-voice-pr60-shared";
import { getGrokVoiceServerEnv } from "../apps/web/lib/roleplay/server-env";
import { ensureEnvLoaded } from "../apps/web/server/loadEnv";
import {
  DEFAULT_SECRET_SOURCE_PROJECT_ID,
  getEnvOrSecret,
} from "../apps/web/server/secrets";
import { loadGrokVoiceScenarioBundle } from "../apps/web/server/grokVoice/scenarioLoader";
import {
  synthesizeGrokVoiceTts,
  type GrokVoiceTtsPurpose,
} from "../apps/web/server/grokVoice/tts";
import { saveGrokVoiceTtsCacheAndWait } from "../apps/web/server/grokVoice/ttsCache";

async function main() {
  ensureEnvLoaded();
  process.env["XAI_API_KEY"] = await getEnvOrSecret(
    "XAI_API_KEY",
    "XAI_API_KEY",
    process.env["SECRET_SOURCE_PROJECT_ID"] ?? DEFAULT_SECRET_SOURCE_PROJECT_ID
  );

  const env = getGrokVoiceServerEnv();
  const bundle = await loadGrokVoiceScenarioBundle();
  const texts = Array.from(
    new Set([bundle.firstMessage, ...getAllPr60LockedResponses()])
  );

  console.info(
    `[grok-voice-warm-tts-cache] warming ${texts.length} entries voice=${env.GROK_VOICE_VOICE_ID} sampleRate=${env.GROK_VOICE_SAMPLE_RATE}`
  );
  for (const text of texts) {
    const purpose = text === bundle.firstMessage ? "greeting" : "locked_response";
    process.stdout.write(
      `  ${purpose.padEnd(15)} len=${String(text.length).padStart(3)} ... `
    );
    const result = await synthesizeWithRetry({ text, purpose });
    await saveGrokVoiceTtsCacheAndWait({ text, purpose, result });
    console.info(`ok audioBytes=${result.audio.byteLength} vendorMs=${result.vendorMs}`);
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
