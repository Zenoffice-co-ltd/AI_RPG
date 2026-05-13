export type RelayLogPayload = Record<string, unknown>;

const REDACTED_KEYS = new Set([
  "ticket",
  "sec-websocket-protocol",
  "authorization",
  "audio",
  "delta",
  "transcript",
  "text",
  "prompt",
  "instructions",
]);

export function logRelay(phase: string, payload: RelayLogPayload = {}) {
  console.log(
    JSON.stringify({
      scope: "grokVoice.realtimeRelay",
      phase,
      ...sanitize(payload),
    })
  );
}

export function sanitize(input: RelayLogPayload): RelayLogPayload {
  const output: RelayLogPayload = {};
  for (const [key, value] of Object.entries(input)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) continue;
    if (typeof value === "string" && value.length > 300) {
      output[key] = `${value.slice(0, 300)}...`;
    } else {
      output[key] = value;
    }
  }
  return output;
}
