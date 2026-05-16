import "server-only";

import { randomUUID } from "node:crypto";
import {
  DEFAULT_RELAY_TICKET_PATH,
  createRelayTicket,
} from "@top-performer/grok-realtime-relay-auth";
import { getGrokFirstVFinalConfig } from "@top-performer/grok-first-roleplay-config";
import { ensureEnvLoaded } from "@/server/loadEnv";
import type { GrokFirstV50Session } from "./types";

export type GrokFirstVFinalSession = Omit<
  GrokFirstV50Session,
  "instructions" | "firstMessage" | "tools"
> & {
  publicGreeting: string;
};

export async function createGrokFirstVFinalSession(input: {
  participantIdHash: string;
}): Promise<GrokFirstVFinalSession> {
  await Promise.resolve();
  const env = getEnv();
  const config = getGrokFirstVFinalConfig();
  const sessionId = `gfvfinal_${randomUUID()}`;
  const ticket = createRelayTicket({
    secret: env.relayTicketSecret,
    ttlSeconds: 60,
    payload: {
      aud: env.relayExpectedAud,
      path: DEFAULT_RELAY_TICKET_PATH,
      transport: "mendan_cloud_run_relay_wss",
      demoSlug: config.demoSlug,
      backend: config.backend,
      sessionId,
      participantIdHash: input.participantIdHash,
    },
  });

  return {
    sessionId,
    demoSlug: config.demoSlug,
    backend: config.backend,
    scenarioId: config.scenarioId,
    promptVersion: config.promptVersion,
    promptHash: config.promptHash,
    guardrailVersion: config.guardrailVersion,
    model: config.model,
    voiceId: config.voiceId,
    realtimeTransport: "mendan_cloud_run_relay_wss",
    wsUrl: buildRelayWsUrl(env.relayWsUrl),
    realtimeAuth: {
      mode: "mendan_relay_subprotocol",
      protocol: "mendan-relay-v1",
      ticket: ticket.value,
      expiresAt: ticket.expiresAt,
    },
    audio: config.audio,
    turnDetection: config.turnDetection,
    publicGreeting: config.publicGreeting,
    registeredSpeechPayloadIncluded: false,
    lockedResponseAudioBundleIncluded: false,
    runtimeTtsEnabled: false,
    replacementTtsEnabled: false,
    fullTurnBufferEnabled: false,
  };
}

function getEnv() {
  ensureEnvLoaded();
  const relayTicketSecret = process.env["XAI_RELAY_TICKET_SECRET"] ?? "";
  if (relayTicketSecret.length < 32) {
    throw new Error("Grok-first vFinal environment is not configured.");
  }
  return {
    relayTicketSecret,
    relayWsUrl:
      process.env["GROK_VOICE_RELAY_WS_URL"] ??
      "wss://voice.mendan.biz/api/v3/realtime-relay",
    relayExpectedAud:
      process.env["GROK_VOICE_RELAY_EXPECTED_AUD"] ?? "voice.mendan.biz",
  };
}

function buildRelayWsUrl(base: string): string {
  const parsed = new URL(base);
  if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:") {
    throw new Error("Grok-first vFinal relay URL must use ws/wss.");
  }
  return parsed.toString();
}
