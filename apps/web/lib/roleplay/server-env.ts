import { z } from "zod";
import { ensureEnvLoaded } from "../../server/loadEnv";

const serverEnvSchema = z.object({
  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_AGENT_ID: z.string().min(1),
  ELEVENLABS_BRANCH_ID: z.string().min(1),
  ELEVENLABS_ENVIRONMENT: z.string().min(1).default("production"),
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

export function assertDemoAccessEnvForProduction() {
  ensureEnvLoaded();
  if (process.env["NODE_ENV"] === "production" && !process.env["DEMO_ACCESS_TOKEN"]) {
    throw new Error("Demo access token is required in production.");
  }
}
