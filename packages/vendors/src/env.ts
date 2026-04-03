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
  ELEVENLABS_API_KEY: z.string().min(1),
  LIVEAVATAR_API_KEY: z.string().min(1),
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
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function loadServerEnv(
  source: Record<string, string | undefined> = process.env
): ServerEnv {
  return serverEnvSchema.parse(source);
}
