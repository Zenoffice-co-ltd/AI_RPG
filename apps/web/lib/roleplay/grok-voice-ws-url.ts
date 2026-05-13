// Single source of truth for assembling the xAI Realtime WebSocket
// URL. Concentrating the construction here makes it possible to:
//   1. enforce the `model=` query param on every connect (the docs say
//      omitting it falls back to a legacy default voice agent — this
//      is exactly the kind of silent regression the review-v2 plan
//      requires us to block)
//   2. ban model-less call sites via a CI grep on the base URL
//      substring instead of trying to scan every interpolated string
//   3. unit-test the contract once instead of in every caller
//
// Pass a fully-formed base such as `wss://api.x.ai/v1/realtime`. The
// builder will reject relative URLs, http(s) protocols, and any base
// that already carries a different `model=` query.

export const REQUIRED_GROK_VOICE_REALTIME_MODEL = "grok-voice-think-fast-1.0";

export type BuildGrokRealtimeWsUrlInput = {
  base: string;
  // Optional override for tests / future migration. Production callers
  // omit this and inherit the required model constant above.
  model?: string;
};

export type BuildGrokRealtimeRelayWsUrlInput = {
  origin: string;
  sessionId: string;
  model?: string;
};

export type BuildMendanCloudRunRelayWsUrlInput = {
  base?: string | undefined;
};

export function buildGrokRealtimeWsUrl(input: BuildGrokRealtimeWsUrlInput): string {
  const model = input.model ?? REQUIRED_GROK_VOICE_REALTIME_MODEL;
  if (typeof model !== "string" || model.length === 0) {
    throw new Error("buildGrokRealtimeWsUrl: model query param is required");
  }
  if (typeof input.base !== "string" || input.base.length === 0) {
    throw new Error("buildGrokRealtimeWsUrl: base URL is required");
  }
  let parsed: URL;
  try {
    parsed = new URL(input.base);
  } catch {
    throw new Error(
      `buildGrokRealtimeWsUrl: base must be a parseable URL (received "${input.base}")`
    );
  }
  if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:") {
    throw new Error(
      `buildGrokRealtimeWsUrl: base must use ws/wss protocol (received "${parsed.protocol}")`
    );
  }
  const existing = parsed.searchParams.get("model");
  if (existing !== null && existing !== model) {
    throw new Error(
      `buildGrokRealtimeWsUrl: base already has a different model query (existing="${existing}", required="${model}")`
    );
  }
  parsed.searchParams.set("model", model);
  return parsed.toString();
}

export function buildGrokRealtimeRelayWsUrl(
  input: BuildGrokRealtimeRelayWsUrlInput
): string {
  const model = input.model ?? REQUIRED_GROK_VOICE_REALTIME_MODEL;
  if (typeof input.sessionId !== "string" || input.sessionId.length === 0) {
    throw new Error("buildGrokRealtimeRelayWsUrl: sessionId is required");
  }
  let parsed: URL;
  try {
    parsed = new URL("/api/v3/realtime-relay", input.origin);
  } catch {
    throw new Error(
      `buildGrokRealtimeRelayWsUrl: origin must be a parseable URL (received "${input.origin}")`
    );
  }
  if (parsed.protocol === "https:") {
    parsed.protocol = "wss:";
  } else if (parsed.protocol === "http:") {
    parsed.protocol = "ws:";
  } else if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:") {
    throw new Error(
      `buildGrokRealtimeRelayWsUrl: origin must use http(s) or ws(s) protocol (received "${parsed.protocol}")`
    );
  }
  parsed.searchParams.set("model", model);
  parsed.searchParams.set("sessionId", input.sessionId);
  return parsed.toString();
}

export function buildMendanCloudRunRelayWsUrl(
  input: BuildMendanCloudRunRelayWsUrlInput = {}
): string {
  const base =
    input.base ?? "wss://voice.mendan.biz/api/v3/realtime-relay";
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new Error(
      `buildMendanCloudRunRelayWsUrl: base must be a parseable URL (received "${base}")`
    );
  }
  if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:") {
    throw new Error(
      `buildMendanCloudRunRelayWsUrl: base must use ws/wss protocol (received "${parsed.protocol}")`
    );
  }
  if (parsed.pathname !== "/api/v3/realtime-relay") {
    throw new Error(
      `buildMendanCloudRunRelayWsUrl: path must be /api/v3/realtime-relay (received "${parsed.pathname}")`
    );
  }
  parsed.search = "";
  return parsed.toString();
}

// Strict assertion helper. Callers that already received a wsUrl from
// somewhere can run this to fail-fast if the contract was bypassed.
export function assertGrokRealtimeWsUrl(wsUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(wsUrl);
  } catch {
    throw new Error(`assertGrokRealtimeWsUrl: not a valid URL: ${wsUrl}`);
  }
  if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:") {
    throw new Error(
      `assertGrokRealtimeWsUrl: wrong protocol ${parsed.protocol}`
    );
  }
  const model = parsed.searchParams.get("model");
  if (model !== REQUIRED_GROK_VOICE_REALTIME_MODEL) {
    throw new Error(
      `assertGrokRealtimeWsUrl: model query must be "${REQUIRED_GROK_VOICE_REALTIME_MODEL}" (got "${model ?? "<unset>"}")`
    );
  }
}
