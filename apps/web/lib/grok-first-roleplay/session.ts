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
  GROK_FIRST_V50_7_PROMPT_ONLY_GUARDRAIL_VERSION,
  GROK_FIRST_V50_8_GUARDRAIL_VERSION,
  GROK_FIRST_V51_GUARDRAIL_VERSION,
  type GrokFirstPromptVariant,
} from "./prompt";
import {
  GROK_FIRST_V50_1_BACKEND,
  GROK_FIRST_V50_1_DEMO_SLUG,
  GROK_FIRST_V50_4_BACKEND,
  GROK_FIRST_V50_4_DEMO_SLUG,
  GROK_FIRST_V50_5_BACKEND,
  GROK_FIRST_V50_5_DEMO_SLUG,
  GROK_FIRST_V50_6_BACKEND,
  GROK_FIRST_V50_6_DEMO_SLUG,
  GROK_FIRST_V50_7_BACKEND,
  GROK_FIRST_V50_7_DEMO_SLUG,
  GROK_FIRST_V50_7_PROMPT_ONLY_BACKEND,
  GROK_FIRST_V50_7_PROMPT_ONLY_DEMO_SLUG,
  GROK_FIRST_V50_8_BACKEND,
  GROK_FIRST_V50_8_DEMO_SLUG,
  GROK_FIRST_V51_BACKEND,
  GROK_FIRST_V51_DEMO_SLUG,
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
  GROK_FIRST_V50_DEBUG_TRANSCRIPT_PREVIEW_ENABLED: z
    .enum(["true", "false"])
    .optional(),
  ADECCO_BROWSER_EVAL_ENABLED: z.string().optional(),
});

export async function createGrokFirstV50Session(input?: {
  variant?: GrokFirstPromptVariant;
  promptVariant?: GrokFirstPromptVariant;
  runtimeVariant?:
    | GrokFirstPromptVariant
    | "v50.7"
    | "v50.7-prompt-only"
    | "v50.8"
    | "v51";
}): Promise<GrokFirstV50Session> {
  await Promise.resolve();
  const env = getEnv();
  const promptVariant = input?.promptVariant ?? input?.variant ?? "v50";
  const runtimeVariant = input?.runtimeVariant ?? input?.variant ?? promptVariant;
  const isPromptOnly = runtimeVariant === "v50.7-prompt-only";
  const prompt = buildGrokFirstV50Prompt(isPromptOnly ? "v50.6" : promptVariant);
  const voiceId = env.GROK_FIRST_V50_VOICE_ID ?? GROK_FIRST_V50_VOICE_ID;
  const sessionId = `gfv50_${randomUUID()}`;
  const runtimeGuardrailsEnabled = !isPromptOnly;
  const identity =
    runtimeVariant === "v51"
      ? {
          demoSlug: GROK_FIRST_V51_DEMO_SLUG,
          backend: GROK_FIRST_V51_BACKEND,
        }
      : runtimeVariant === "v50.8"
      ? {
          demoSlug: GROK_FIRST_V50_8_DEMO_SLUG,
          backend: GROK_FIRST_V50_8_BACKEND,
        }
      : runtimeVariant === "v50.7"
      ? {
          demoSlug: GROK_FIRST_V50_7_DEMO_SLUG,
          backend: GROK_FIRST_V50_7_BACKEND,
        }
      : isPromptOnly
      ? {
          demoSlug: GROK_FIRST_V50_7_PROMPT_ONLY_DEMO_SLUG,
          backend: GROK_FIRST_V50_7_PROMPT_ONLY_BACKEND,
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
        : runtimeVariant === "v50.4"
          ? {
              demoSlug: GROK_FIRST_V50_4_DEMO_SLUG,
              backend: GROK_FIRST_V50_4_BACKEND,
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
      runtimeVariant === "v51"
        ? GROK_FIRST_V51_GUARDRAIL_VERSION
        : runtimeVariant === "v50.8"
        ? GROK_FIRST_V50_8_GUARDRAIL_VERSION
        : runtimeVariant === "v50.7"
        ? GROK_FIRST_V50_7_GUARDRAIL_VERSION
        : isPromptOnly
        ? GROK_FIRST_V50_7_PROMPT_ONLY_GUARDRAIL_VERSION
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
      ...(runtimeVariant === "v50.7" || isPromptOnly
        ? { create_response: false as const }
        : {}),
    },
    tools: [],
    instructions: prompt.instructions,
    firstMessage: prompt.firstMessage,
    registeredSpeechPayloadIncluded: false,
    lockedResponseAudioBundleIncluded: false,
    runtimeTtsEnabled: false,
    replacementTtsEnabled: false,
    fullTurnBufferEnabled: false,
    runtimeGuardrailsEnabled,
    inputGuardEnabled: runtimeGuardrailsEnabled,
    normalInputRouterEnabled: runtimeGuardrailsEnabled,
    negativeGuardEnabled: runtimeGuardrailsEnabled,
    tailGuardEnabled: runtimeGuardrailsEnabled,
    fixedGuardAudioEnabled: runtimeGuardrailsEnabled,
    boundedRewriteEnabled: runtimeGuardrailsEnabled,
    noiseIgnoredEnabled: runtimeGuardrailsEnabled,
    runtimeControl: {
      mode: isPromptOnly ? "prompt_only" : "default",
      runtimeGuardrailsEnabled,
      inputGuardEnabled: runtimeGuardrailsEnabled,
      normalInputRouterEnabled: runtimeGuardrailsEnabled,
      negativeGuardEnabled: runtimeGuardrailsEnabled,
      tailGuardEnabled: runtimeGuardrailsEnabled,
      fixedGuardAudioEnabled: runtimeGuardrailsEnabled,
      boundedRewriteEnabled: runtimeGuardrailsEnabled,
      noiseIgnoredEnabled: runtimeGuardrailsEnabled,
    },
    debugTranscriptPreviewEnabled:
      env.GROK_FIRST_V50_DEBUG_TRANSCRIPT_PREVIEW_ENABLED === "true",
    browserEvaluationEnabled:
      runtimeVariant === "v50.7"
        ? env.ADECCO_BROWSER_EVAL_ENABLED !== "0"
        : false,
    browserEvaluation:
      runtimeVariant === "v51"
        ? {
            enabled: env.ADECCO_BROWSER_EVAL_ENABLED !== "0",
            startEndpoint: "/api/grok-first-v51/evaluation/start",
            resultBasePath: "/demo/adecco-roleplay-v51/result",
            source: "grok_first_v51_browser",
            runtimeVersion: "v51",
          }
        : runtimeVariant === "v50.7"
        ? {
            enabled: env.ADECCO_BROWSER_EVAL_ENABLED !== "0",
            startEndpoint: "/api/grok-first-v50-7/evaluation/start",
            resultBasePath: "/demo/adecco-roleplay-v50-7/result",
            source: "grok_first_v50_7_browser",
            runtimeVersion: "v50-7",
          }
        : undefined,
  };
}

export function assertGrokFirstV50SessionPayload(
  session: GrokFirstV50Session,
): void {
  const serialized = JSON.stringify(session);
  const forbidden = [
    '"registeredSpeech":',
    '"lockedResponseAudioBundle":',
    "getPr60" + "LockedResponseForUser",
    "registered_speech",
    "lock_voice_",
    "sanitized-response" + "-tts",
    "locked-response" + "-tts",
  ];
  const hit = forbidden.find((needle) => serialized.includes(needle));
  if (hit) {
    throw new Error(
      `v50 session payload contains forbidden fixed-answer surface: ${hit}`,
    );
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

export function buildRelayWsUrl(base: string): string {
  const parsed = new URL(base);
  if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:") {
    throw new Error("Grok-first v50 relay URL must use ws/wss.");
  }
  if (parsed.pathname !== DEFAULT_RELAY_TICKET_PATH) {
    throw new Error(
      `Grok-first v50 relay URL path must be ${DEFAULT_RELAY_TICKET_PATH}.`,
    );
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Grok-first v50 relay URL must not include query or hash.");
  }
  return parsed.toString();
}

export function stableSessionHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}
