import { createHash } from "node:crypto";
import {
  GROK_FIRST_V50_6_FIRST_MESSAGE,
  GROK_FIRST_V50_6_SYSTEM_PROMPT,
} from "./prompt-v50-6";

export const GROK_FIRST_VFINAL_DEMO_SLUG = "adecco-roleplay-vFinal" as const;
export const GROK_FIRST_VFINAL_BACKEND = "grok-first-vFinal" as const;
export const GROK_FIRST_VFINAL_SCENARIO_ID =
  "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_vfinal";
export const GROK_FIRST_VFINAL_PROMPT_VERSION =
  "grok-first-v50.6-2026-05-15";
export const GROK_FIRST_VFINAL_GUARDRAIL_VERSION =
  "grok-first-vfinal-guard-2026-05-16";
export const GROK_FIRST_VFINAL_MODEL = "grok-voice-think-fast-1.0" as const;
export const GROK_FIRST_VFINAL_VOICE_ID = "99c95cc8a177" as const;
export const GROK_FIRST_VFINAL_SAMPLE_RATE = 24_000 as const;

export type GrokFirstVFinalConfig = {
  demoSlug: typeof GROK_FIRST_VFINAL_DEMO_SLUG;
  backend: typeof GROK_FIRST_VFINAL_BACKEND;
  scenarioId: typeof GROK_FIRST_VFINAL_SCENARIO_ID;
  promptVersion: typeof GROK_FIRST_VFINAL_PROMPT_VERSION;
  promptHash: string;
  guardrailVersion: typeof GROK_FIRST_VFINAL_GUARDRAIL_VERSION;
  model: typeof GROK_FIRST_VFINAL_MODEL;
  voiceId: typeof GROK_FIRST_VFINAL_VOICE_ID;
  instructions: string;
  hiddenAssistantHistory: string;
  publicGreeting: string;
  audio: {
    inputFormat: "audio/pcm";
    outputFormat: "audio/pcm";
    sampleRate: typeof GROK_FIRST_VFINAL_SAMPLE_RATE;
  };
  turnDetection: {
    type: "server_vad";
    threshold: 0.65;
    silence_duration_ms: 650;
    prefix_padding_ms: 333;
  };
};

export function getGrokFirstVFinalConfig(): GrokFirstVFinalConfig {
  const instructions = GROK_FIRST_V50_6_SYSTEM_PROMPT;
  return {
    demoSlug: GROK_FIRST_VFINAL_DEMO_SLUG,
    backend: GROK_FIRST_VFINAL_BACKEND,
    scenarioId: GROK_FIRST_VFINAL_SCENARIO_ID,
    promptVersion: GROK_FIRST_VFINAL_PROMPT_VERSION,
    promptHash: createHash("sha256").update(instructions).digest("hex").slice(0, 12),
    guardrailVersion: GROK_FIRST_VFINAL_GUARDRAIL_VERSION,
    model: GROK_FIRST_VFINAL_MODEL,
    voiceId: GROK_FIRST_VFINAL_VOICE_ID,
    instructions,
    hiddenAssistantHistory: GROK_FIRST_V50_6_FIRST_MESSAGE,
    publicGreeting: "お電話ありがとうございます。営業事務の件でご相談いただいている佐藤です。",
    audio: {
      inputFormat: "audio/pcm",
      outputFormat: "audio/pcm",
      sampleRate: GROK_FIRST_VFINAL_SAMPLE_RATE,
    },
    turnDetection: {
      type: "server_vad",
      threshold: 0.65,
      silence_duration_ms: 650,
      prefix_padding_ms: 333,
    },
  };
}

export {
  GROK_FIRST_V50_6_FIRST_MESSAGE,
  GROK_FIRST_V50_6_SYSTEM_PROMPT,
} from "./prompt-v50-6";
