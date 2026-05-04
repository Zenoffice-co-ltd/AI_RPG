"use client";

import type { HaikuFishSseEvent } from "./haiku-fish-types";

export type HaikuFishStreamRequest = {
  sessionId: string;
  inputMode: "text";
  messages: ReadonlyArray<{ role: "agent" | "user"; text: string }>;
};

export type HaikuFishGreeting = {
  format: string;
  sampleRateHz: number;
  base64: string;
};

export type HaikuFishTranscription = {
  text: string;
  confidence: number | null;
  vendorRequestMs: number;
};

export async function fetchHaikuFishGreeting(
  init?: { signal?: AbortSignal; fetchImpl?: typeof fetch }
): Promise<HaikuFishGreeting> {
  const fetchImpl = init?.fetchImpl ?? fetch;
  const requestInit: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  };
  if (init?.signal) requestInit.signal = init.signal;
  const response = await fetchImpl("/api/haiku-fish/greet", requestInit);
  if (!response.ok) {
    throw new Error(`greet request failed: ${response.status}`);
  }
  return (await response.json()) as HaikuFishGreeting;
}

export type HaikuFishEventKind =
  | "mic.permission.granted"
  | "mic.permission.denied"
  | "mic.state"
  | "mic.utterance.queued"
  | "mic.utterance.skipped"
  | "mic.error"
  | "audio.queue.error"
  | "respond.start"
  | "respond.error";

export function postHaikuFishEvent(
  kind: HaikuFishEventKind,
  payload?: { sessionId?: string; details?: Record<string, unknown> }
): Promise<void> {
  // Fire-and-forget. Failures are silent — telemetry must never block UX.
  return fetch("/api/haiku-fish/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind,
      ...(payload?.sessionId ? { sessionId: payload.sessionId } : {}),
      ...(payload?.details ? { details: payload.details } : {}),
    }),
    keepalive: true,
  })
    .then(() => undefined)
    .catch(() => undefined);
}

export async function postHaikuFishTranscription(
  audioBase64: string,
  audioMimeType: string,
  init?: { signal?: AbortSignal; fetchImpl?: typeof fetch }
): Promise<HaikuFishTranscription> {
  const fetchImpl = init?.fetchImpl ?? fetch;
  const requestInit: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ audioBase64, audioMimeType }),
  };
  if (init?.signal) requestInit.signal = init.signal;
  const response = await fetchImpl("/api/haiku-fish/transcribe", requestInit);
  if (!response.ok) {
    let message = `transcribe failed: ${response.status}`;
    try {
      const data = (await response.clone().json()) as { error?: unknown };
      if (typeof data?.error === "string") message = data.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return (await response.json()) as HaikuFishTranscription;
}

export async function* streamHaikuFishRespond(
  request: HaikuFishStreamRequest,
  init?: { signal?: AbortSignal; fetchImpl?: typeof fetch }
): AsyncIterable<HaikuFishSseEvent> {
  const fetchImpl = init?.fetchImpl ?? fetch;
  const requestInit: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  };
  if (init?.signal) {
    requestInit.signal = init.signal;
  }
  const response = await fetchImpl("/api/haiku-fish/respond", requestInit);

  if (!response.ok) {
    let message = `respond stream failed: ${response.status}`;
    try {
      const data = (await response.clone().json()) as { error?: unknown };
      if (typeof data?.error === "string") message = data.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error("respond stream missing body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separator = buffer.indexOf("\n\n");
      while (separator !== -1) {
        const rawEvent = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        separator = buffer.indexOf("\n\n");
        const parsed = parseSseEvent(rawEvent);
        if (parsed) yield parsed;
      }
    }
    if (buffer.trim().length > 0) {
      const parsed = parseSseEvent(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

function parseSseEvent(raw: string): HaikuFishSseEvent | null {
  if (raw.length === 0) return null;
  let eventName: string | null = null;
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    const stripped = line.replace(/\r$/, "");
    if (stripped.length === 0 || stripped.startsWith(":")) continue;
    if (stripped.startsWith("event:")) {
      eventName = stripped.slice("event:".length).trim();
      continue;
    }
    if (stripped.startsWith("data:")) {
      dataLines.push(stripped.slice("data:".length).replace(/^ /, ""));
    }
  }
  if (!eventName || dataLines.length === 0) return null;
  let data: unknown;
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    return null;
  }
  return { event: eventName, data } as HaikuFishSseEvent;
}
