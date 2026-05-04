import { z } from "zod";
import { ensureEnvLoaded } from "../../server/loadEnv";
import {
  DEFAULT_ELEVENLABS_SECRET_NAME,
  DEFAULT_SECRET_SOURCE_PROJECT_ID,
  getEnvOrSecret,
  trimConfiguredValue,
} from "../../server/secrets";

const serverEnvSchema = z.object({
  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_AGENT_ID: z.string().min(1),
  ELEVENLABS_BRANCH_ID: z.string().min(1),
  ELEVENLABS_ENVIRONMENT: z.string().min(1).default("production"),
  ELEVENLABS_VOICE_PROFILE_ID: z.string().min(1).optional(),
  DEMO_ACCESS_TOKEN: z.string().min(1).optional(),
});

export type VoiceServerEnv = z.infer<typeof serverEnvSchema>;

export function getVoiceServerEnv(): VoiceServerEnv {
  ensureEnvLoaded();
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error("Voice session server environment is not configured.");
  }
  return parsed.data;
}

export async function getVoiceServerEnvWithSecretFallback(): Promise<VoiceServerEnv> {
  ensureEnvLoaded();

  if (process.env["NODE_ENV"] === "production") {
    const parsed = serverEnvSchema.safeParse({
      ...process.env,
      ELEVENLABS_API_KEY: trimConfiguredValue(process.env["ELEVENLABS_API_KEY"]),
    });
    if (!parsed.success) {
      throw new Error("Voice session server environment is not configured.");
    }
    return parsed.data;
  }

  const secretProjectId =
    process.env["SECRET_SOURCE_PROJECT_ID"] ?? DEFAULT_SECRET_SOURCE_PROJECT_ID;
  const apiKey = await getEnvOrSecret(
    "ELEVENLABS_API_KEY",
    DEFAULT_ELEVENLABS_SECRET_NAME,
    secretProjectId
  );
  const parsed = serverEnvSchema.safeParse({
    ...process.env,
    ELEVENLABS_API_KEY: apiKey,
  });
  if (!parsed.success) {
    throw new Error("Voice session server environment is not configured.");
  }
  return parsed.data;
}

export function assertDemoAccessEnvForProduction() {
  ensureEnvLoaded();
  if (process.env["NODE_ENV"] === "production" && !process.env["DEMO_ACCESS_TOKEN"]) {
    throw new Error("Demo access token is required in production.");
  }
}

const haikuFishServerEnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  FISH_API_KEY: z.string().min(1),
  FISH_ADECCO_VOICE_REFERENCE_ID: z.string().min(1),
  HAIKU_FISH_LLM_MODEL: z.string().min(1).default("claude-haiku-4-5-20251001"),
  HAIKU_FISH_LLM_TEMPERATURE: z.coerce.number().default(0.2),
  HAIKU_FISH_LLM_MAX_TOKENS: z.coerce.number().int().positive().default(220),
  FISH_TTS_MODEL: z.string().min(1).default("s2-pro"),
  FISH_TTS_FORMAT: z.string().min(1).default("wav"),
  FISH_TTS_SAMPLE_RATE: z.coerce.number().int().positive().default(24_000),
});

export type HaikuFishServerEnv = z.infer<typeof haikuFishServerEnvSchema>;

export function isHaikuFishRoleplayEnabled() {
  ensureEnvLoaded();
  const value = process.env["ENABLE_HAIKU_FISH_ROLEPLAY"];
  return value === "true" || value === "1";
}

export function isHaikuFishMicInputEnabled() {
  ensureEnvLoaded();
  const value = process.env["ENABLE_HAIKU_FISH_MIC_INPUT"];
  return value === "true" || value === "1";
}

export function getHaikuFishServerEnv(): HaikuFishServerEnv {
  ensureEnvLoaded();
  const parsed = haikuFishServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error("Haiku-Fish roleplay environment is not configured.");
  }
  return parsed.data;
}

export function assertHaikuFishEnvForProduction() {
  ensureEnvLoaded();
  if (!isHaikuFishRoleplayEnabled()) {
    return;
  }
  const required = [
    "ANTHROPIC_API_KEY",
    "FISH_API_KEY",
    "FISH_ADECCO_VOICE_REFERENCE_ID",
  ] as const;
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Haiku-Fish roleplay env missing: ${missing.join(", ")} (ENABLE_HAIKU_FISH_ROLEPLAY=true).`
    );
  }
  if (isHaikuFishMicInputEnabled() && !process.env["GOOGLE_CLOUD_PROJECT"]) {
    throw new Error(
      "Haiku-Fish mic input requires GOOGLE_CLOUD_PROJECT (ENABLE_HAIKU_FISH_MIC_INPUT=true)."
    );
  }
}

const grokVoiceServerEnvSchema = z.object({
  XAI_API_KEY: z.string().min(1),
  GROK_VOICE_MODEL: z.string().min(1).default("grok-voice-think-fast-1.0"),
  GROK_VOICE_VOICE_ID: z.string().min(1).default("rex"),
  GROK_VOICE_INPUT_FORMAT: z.string().min(1).default("audio/pcm"),
  GROK_VOICE_OUTPUT_FORMAT: z.string().min(1).default("audio/pcm"),
  GROK_VOICE_SAMPLE_RATE: z.coerce.number().int().positive().default(24_000),
  GROK_VOICE_REALTIME_BASE: z
    .string()
    .min(1)
    .default("wss://api.x.ai/v1/realtime"),
  GROK_VOICE_EPHEMERAL_BASE: z
    .string()
    .min(1)
    .default("https://api.x.ai/v1/realtime/sessions"),
  GROK_VOICE_TURN_DETECTION_THRESHOLD: z.coerce.number().default(0.5),
  GROK_VOICE_TURN_DETECTION_SILENCE_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(500),
});

export type GrokVoiceServerEnv = z.infer<typeof grokVoiceServerEnvSchema>;

export function isGrokVoiceRoleplayEnabled() {
  ensureEnvLoaded();
  const value = process.env["ENABLE_GROK_VOICE_ROLEPLAY"];
  return value === "true" || value === "1";
}

export function getGrokVoiceServerEnv(): GrokVoiceServerEnv {
  ensureEnvLoaded();
  const parsed = grokVoiceServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error("Grok Voice roleplay environment is not configured.");
  }
  return parsed.data;
}

export function assertGrokVoiceEnvForProduction() {
  ensureEnvLoaded();
  if (!isGrokVoiceRoleplayEnabled()) {
    return;
  }
  const required = ["XAI_API_KEY"] as const;
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Grok Voice roleplay env missing: ${missing.join(", ")} (ENABLE_GROK_VOICE_ROLEPLAY=true).`
    );
  }
}
