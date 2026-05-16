import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import {
  DEFAULT_RELAY_TICKET_PATH,
  createRelayTicket,
} from "@top-performer/grok-realtime-relay-auth";
import { ensureEnvLoaded } from "@/server/loadEnv";
import {
  buildGrokFirstV50Prompt,
  GROK_FIRST_V50_7_GUARDRAIL_VERSION,
  GROK_FIRST_V50_8_GUARDRAIL_VERSION,
  type GrokFirstPromptVariant,
} from "./prompt";
import {
  GROK_FIRST_V50_1_BACKEND,
  GROK_FIRST_V50_1_DEMO_SLUG,
  GROK_FIRST_V50_2_BACKEND,
  GROK_FIRST_V50_2_DEMO_SLUG,
  GROK_FIRST_V50_3_BACKEND,
  GROK_FIRST_V50_3_DEMO_SLUG,
  GROK_FIRST_V50_5_BACKEND,
  GROK_FIRST_V50_5_DEMO_SLUG,
  GROK_FIRST_V50_6_BACKEND,
  GROK_FIRST_V50_6_DEMO_SLUG,
  GROK_FIRST_V50_7_BACKEND,
  GROK_FIRST_V50_7_DEMO_SLUG,
  GROK_FIRST_V50_8_BACKEND,
  GROK_FIRST_V50_8_DEMO_SLUG,
  GROK_FIRST_V50_BACKEND,
  GROK_FIRST_V50_DEMO_SLUG,
  GROK_FIRST_V50_MODEL,
  GROK_FIRST_V50_SAMPLE_RATE,
  GROK_FIRST_V50_VOICE_ID,
  type GrokFirstV50Session,
} from "./types";

const envSchema = z.object({
  XAI_RELAY_TICKET_SECRET: z.string().min(32),
  GROK_VOICE_RELAY_WS_URL: z
    .string()
    .min(1)
    .default("wss://voice.mendan.biz/api/v3/realtime-relay"),
  GROK_VOICE_RELAY_EXPECTED_AUD: z.string().min(1).default("voice.mendan.biz"),
  GROK_FIRST_V50_VOICE_ID: z.string().min(1).optional(),
});

export async function createGrokFirstV50Session(input?: {
  variant?: GrokFirstPromptVariant;
  promptVariant?: GrokFirstPromptVariant;
  runtimeVariant?: GrokFirstPromptVariant | "v50.7" | "v50.8";
}): Promise<GrokFirstV50Session> {
  await Promise.resolve();
  const env = getEnv();
  const promptVariant = input?.promptVariant ?? input?.variant ?? "v50";
  const runtimeVariant = input?.runtimeVariant ?? input?.variant ?? promptVariant;
  const prompt = buildGrokFirstV50Prompt(promptVariant);
  const voiceId = env.GROK_FIRST_V50_VOICE_ID ?? GROK_FIRST_V50_VOICE_ID;
  const sessionId = `gfv50_${randomUUID()}`;
  const identity =
    runtimeVariant === "v50.8"
      ? {
          demoSlug: GROK_FIRST_V50_8_DEMO_SLUG,
          backend: GROK_FIRST_V50_8_BACKEND,
        }
      : runtimeVariant === "v50.7"
      ? {
          demoSlug: GROK_FIRST_V50_7_DEMO_SLUG,
          backend: GROK_FIRST_V50_7_BACKEND,
        }
      : runtimeVariant === "v50.6"
      ? {
          demoSlug: GROK_FIRST_V50_6_DEMO_SLUG,
          backend: GROK_FIRST_V50_6_BACKEND,
        }
      : runtimeVariant === "v50.5"
      ? {
          demoSlug: GROK_FIRST_V50_5_DEMO_SLUG,
          backend: GROK_FIRST_V50_5_BACKEND,
        }
      : runtimeVariant === "v50.3"
      ? {
          demoSlug: GROK_FIRST_V50_3_DEMO_SLUG,
          backend: GROK_FIRST_V50_3_BACKEND,
        }
      : runtimeVariant === "v50.2"
      ? {
          demoSlug: GROK_FIRST_V50_2_DEMO_SLUG,
          backend: GROK_FIRST_V50_2_BACKEND,
        }
      : runtimeVariant === "v50.1"
        ? {
            demoSlug: GROK_FIRST_V50_1_DEMO_SLUG,
            backend: GROK_FIRST_V50_1_BACKEND,
          }
        : {
            demoSlug: GROK_FIRST_V50_DEMO_SLUG,
            backend: GROK_FIRST_V50_BACKEND,
          };
  const ticket = createRelayTicket({
    secret: env.XAI_RELAY_TICKET_SECRET,
    ttlSeconds: 60,
    payload: {
      aud: env.GROK_VOICE_RELAY_EXPECTED_AUD,
      path: DEFAULT_RELAY_TICKET_PATH,
      transport: "mendan_cloud_run_relay_wss",
      demoSlug: identity.demoSlug,
      backend: identity.backend,
      sessionId,
    },
  });

  return {
    sessionId,
    demoSlug: identity.demoSlug,
    backend: identity.backend,
    scenarioId: prompt.scenarioId,
    promptVersion: prompt.promptVersion,
    promptHash: prompt.promptHash,
    guardrailVersion:
      runtimeVariant === "v50.8"
        ? GROK_FIRST_V50_8_GUARDRAIL_VERSION
        : runtimeVariant === "v50.7"
        ? GROK_FIRST_V50_7_GUARDRAIL_VERSION
        : prompt.guardrailVersion,
    model: GROK_FIRST_V50_MODEL,
    voiceId,
    realtimeTransport: "mendan_cloud_run_relay_wss",
    wsUrl: buildRelayWsUrl(env.GROK_VOICE_RELAY_WS_URL),
    realtimeAuth: {
      mode: "mendan_relay_subprotocol",
      protocol: "mendan-relay-v1",
      ticket: ticket.value,
      expiresAt: ticket.expiresAt,
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
    firstMessage: prompt.firstMessage,
    registeredSpeechPayloadIncluded: false,
    lockedResponseAudioBundleIncluded: false,
    runtimeTtsEnabled: false,
    replacementTtsEnabled: false,
    fullTurnBufferEnabled: false,
  };
}

export function assertGrokFirstV50SessionPayload(
  session: GrokFirstV50Session
): void {
  const serialized = JSON.stringify(session);
  const forbidden = [
    "\"registeredSpeech\":",
    "\"lockedResponseAudioBundle\":",
    "getPr60LockedResponseForUser",
    "registered_speech",
    "lock_voice_",
    "sanitized-response-tts",
    "locked-response-tts",
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

function buildRelayWsUrl(base: string): string {
  const parsed = new URL(base);
  if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:") {
    throw new Error("Grok-first v50 relay URL must use ws/wss.");
  }
  return parsed.toString();
}

export function stableSessionHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}
