import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { ensureEnvLoaded } from "@/server/loadEnv";
import {
  buildGrokFirstV50Prompt,
  GROK_FIRST_V50_FIRST_MESSAGE,
  GROK_FIRST_V50_SCENARIO_ID,
} from "./prompt";
import {
  GROK_FIRST_V50_BACKEND,
  GROK_FIRST_V50_DEMO_SLUG,
  GROK_FIRST_V50_MODEL,
  GROK_FIRST_V50_SAMPLE_RATE,
  GROK_FIRST_V50_VOICE_ID,
  type GrokFirstV50Session,
} from "./types";

const envSchema = z.object({
  XAI_API_KEY: z.string().min(1),
  GROK_VOICE_REALTIME_BASE: z
    .string()
    .min(1)
    .default("wss://api.x.ai/v1/realtime"),
  GROK_VOICE_EPHEMERAL_BASE: z
    .string()
    .min(1)
    .default("https://api.x.ai/v1/realtime/client_secrets"),
  GROK_FIRST_V50_VOICE_ID: z.string().min(1).optional(),
  GROK_FIRST_V50_DEBUG_TRANSCRIPT_PREVIEW_ENABLED: z
    .enum(["true", "false"])
    .optional(),
});

export async function createGrokFirstV50Session(): Promise<GrokFirstV50Session> {
  const env = getEnv();
  const token = await issueEphemeralToken({
    endpoint: env.GROK_VOICE_EPHEMERAL_BASE,
    apiKey: env.XAI_API_KEY,
  });
  const prompt = buildGrokFirstV50Prompt();
  const voiceId = env.GROK_FIRST_V50_VOICE_ID ?? GROK_FIRST_V50_VOICE_ID;

  return {
    sessionId: `gfv50_${randomUUID()}`,
    demoSlug: GROK_FIRST_V50_DEMO_SLUG,
    backend: GROK_FIRST_V50_BACKEND,
    scenarioId: GROK_FIRST_V50_SCENARIO_ID,
    promptVersion: prompt.promptVersion,
    promptHash: prompt.promptHash,
    guardrailVersion: prompt.guardrailVersion,
    model: GROK_FIRST_V50_MODEL,
    voiceId,
    wsUrl: buildRealtimeWsUrl(env.GROK_VOICE_REALTIME_BASE),
    realtimeAuth: {
      mode: "xai_ephemeral_subprotocol",
      token: token.value,
      expiresAt: token.expiresAt,
    },
    audio: {
      inputFormat: "audio/pcm",
      outputFormat: "audio/pcm",
      sampleRate: GROK_FIRST_V50_SAMPLE_RATE,
    },
    turnDetection: {
      type: "server_vad",
      threshold: 0.65,
      silence_duration_ms: 650,
      prefix_padding_ms: 333,
    },
    tools: [],
    instructions: prompt.instructions,
    firstMessage: GROK_FIRST_V50_FIRST_MESSAGE,
    registeredSpeechPayloadIncluded: false,
    lockedResponseAudioBundleIncluded: false,
    runtimeTtsEnabled: false,
    replacementTtsEnabled: false,
    fullTurnBufferEnabled: false,
    debugTranscriptPreviewEnabled:
      env.GROK_FIRST_V50_DEBUG_TRANSCRIPT_PREVIEW_ENABLED === "true",
  };
}

export function assertGrokFirstV50SessionPayload(
  session: GrokFirstV50Session
): void {
  const serialized = JSON.stringify(session);
  const forbidden = [
    "\"registeredSpeech\":",
    "\"lockedResponseAudioBundle\":",
    "getPr60" + "LockedResponseForUser",
    "registered_speech",
    "lock_voice_",
    "sanitized-response" + "-tts",
    "locked-response" + "-tts",
  ];
  const hit = forbidden.find((needle) => serialized.includes(needle));
  if (hit) {
    throw new Error(`v50 session payload contains forbidden fixed-answer surface: ${hit}`);
  }
}

function getEnv() {
  ensureEnvLoaded();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error("Grok-first v50 environment is not configured.");
  }
  return parsed.data;
}

function buildRealtimeWsUrl(base: string): string {
  const parsed = new URL(base);
  if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:") {
    throw new Error("Grok-first v50 realtime base must use ws/wss.");
  }
  parsed.searchParams.set("model", GROK_FIRST_V50_MODEL);
  return parsed.toString();
}

async function issueEphemeralToken(input: {
  endpoint: string;
  apiKey: string;
}): Promise<{ value: string; expiresAt: string }> {
  const response = await fetch(input.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({ expires_after: { seconds: 300 } }),
  });
  if (!response.ok) {
    throw new Error(`Grok-first v50 ephemeral token request failed: ${response.status}`);
  }
  const payload = (await response.json()) as {
    value?: unknown;
    expires_at?: unknown;
  };
  if (typeof payload.value !== "string" || payload.value.length === 0) {
    throw new Error("Grok-first v50 ephemeral token response missing value.");
  }
  return {
    value: payload.value,
    expiresAt: normalizeExpiresAt(payload.expires_at),
  };
}

function normalizeExpiresAt(input: unknown): string {
  if (typeof input === "string" && input.length > 0) return input;
  if (typeof input === "number" && Number.isFinite(input) && input > 0) {
    return new Date(input * 1000).toISOString();
  }
  return new Date(Date.now() + 60_000).toISOString();
}

export function stableSessionHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}
