"use client";

import type { GrokFirstV50EventKind } from "./metrics";
import type { GrokFirstV50Session } from "./types";

export async function fetchGrokFirstV50Session(
  endpoint = "/api/grok-first-v50/session"
): Promise<GrokFirstV50Session> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(`grok-first v50 session failed: ${response.status}`);
  }
  return (await response.json()) as GrokFirstV50Session;
}

export async function fetchGrokFirstV50Greeting(
  input: { sessionId: string; text: string },
  endpoint = "/api/grok-first-v50-7-quality/greet"
): Promise<{
  audioBase64: string;
  mimeType: "audio/pcm";
  sampleRateHz: number;
  textLen: number;
  voiceId: string;
  vendorMs?: number | undefined;
  cacheStatus?: "hit" | "miss" | undefined;
}> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`grok-first v50 greeting tts failed: ${response.status}`);
  }
  return (await response.json()) as {
    audioBase64: string;
    mimeType: "audio/pcm";
    sampleRateHz: number;
    textLen: number;
    voiceId: string;
    vendorMs?: number | undefined;
    cacheStatus?: "hit" | "miss" | undefined;
  };
}

export function postGrokFirstV50Event(input: {
  kind: GrokFirstV50EventKind;
  sessionId?: string | undefined;
  details?: Record<string, unknown> | undefined;
}, endpoint = "/api/grok-first-v50/event"): Promise<void> {
  return fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    keepalive: true,
    body: JSON.stringify(input),
  })
    .then(() => undefined)
    .catch(() => undefined);
}
