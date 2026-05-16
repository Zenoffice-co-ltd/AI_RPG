export type RelayLogPayload = Record<string, unknown>;

const RELAY_LOG_ALLOWLIST = new Set([
  "scope",
  "phase",
  "sessionIdHash",
  "participantIdHash",
  "demoSlug",
  "routerVariant",
  "backend",
  "transport",
  "origin",
  "host",
  "closeCode",
  "errorType",
  "reason",
  "side",
  "timestamp",
]);

export function logRelay(phase: string, payload: RelayLogPayload = {}) {
  console.log(
    JSON.stringify({
      scope: "grokVoice.realtimeRelay",
      phase,
      ...sanitize(payload),
      timestamp: new Date().toISOString(),
    })
  );
}

export function sanitize(input: RelayLogPayload): RelayLogPayload {
  const output: RelayLogPayload = {};
  for (const [key, value] of Object.entries(input)) {
    if (!RELAY_LOG_ALLOWLIST.has(key)) continue;
    output[key] = value;
  }
  return output;
}
