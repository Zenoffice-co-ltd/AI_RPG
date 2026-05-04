import { z } from "zod";

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === "boolean") {
      return value;
    }

    return value === "true";
  });

export const serverEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  LIVEAVATAR_API_KEY: z.string().min(1).optional(),
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().min(1).optional(),
  FIREBASE_PRIVATE_KEY: z.string().min(1).optional(),
  FIREBASE_CREDENTIALS_SECRET_NAME: z.string().min(1).optional(),
  SECRET_SOURCE_PROJECT_ID: z.string().min(1),
  GCLOUD_LOCATION: z.string().min(1),
  CLOUD_TASKS_QUEUE_ANALYZE: z.string().min(1),
  CLOUD_TASKS_QUEUE_REGION: z.string().min(1),
  QUEUE_SHARED_SECRET: z.string().min(1),
  APP_BASE_URL: z.string().url(),
  ADMIN_BASIC_AUTH_USER: z.string().min(1),
  ADMIN_BASIC_AUTH_PASS: z.string().min(1),
  ENABLE_ELEVEN_WEBHOOKS: booleanFromString,
  DEFAULT_ELEVEN_MODEL: z.string().min(1),
  DEFAULT_ELEVEN_VOICE_ID: z.string().min(1).optional(),
  DEFAULT_AVATAR_ID: z.string().min(1).optional(),
  LIVEAVATAR_SANDBOX: booleanFromString,
  OPENAI_ANALYSIS_MODEL: z.string().min(1),
  OPENAI_MINING_MODEL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  FISH_API_KEY: z.string().min(1).optional(),
  FISH_ADECCO_VOICE_REFERENCE_ID: z.string().min(1).optional(),
  HAIKU_FISH_LLM_MODEL: z.string().min(1).optional(),
  HAIKU_FISH_LLM_TEMPERATURE: z.string().min(1).optional(),
  HAIKU_FISH_LLM_MAX_TOKENS: z.string().min(1).optional(),
  FISH_TTS_MODEL: z.string().min(1).optional(),
  FISH_TTS_FORMAT: z.string().min(1).optional(),
  FISH_TTS_SAMPLE_RATE: z.string().min(1).optional(),
  ENABLE_HAIKU_FISH_ROLEPLAY: booleanFromString.optional(),
  ENABLE_HAIKU_FISH_MIC_INPUT: booleanFromString.optional(),
  GROK_API_KEY: z.string().min(1).optional(),
  GROK_VOICE_MODEL: z.string().min(1).optional(),
  GROK_VOICE_VOICE_ID: z.string().min(1).optional(),
  GROK_VOICE_INPUT_FORMAT: z.string().min(1).optional(),
  GROK_VOICE_OUTPUT_FORMAT: z.string().min(1).optional(),
  GROK_VOICE_SAMPLE_RATE: z.string().min(1).optional(),
  GROK_VOICE_REALTIME_BASE: z.string().min(1).optional(),
  GROK_VOICE_EPHEMERAL_BASE: z.string().min(1).optional(),
  GROK_VOICE_TURN_DETECTION_THRESHOLD: z.string().min(1).optional(),
  GROK_VOICE_TURN_DETECTION_SILENCE_MS: z.string().min(1).optional(),
  ENABLE_GROK_VOICE_ROLEPLAY: booleanFromString.optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function loadServerEnv(
  source: Record<string, string | undefined> = process.env
): ServerEnv {
  return serverEnvSchema.parse(source);
}
