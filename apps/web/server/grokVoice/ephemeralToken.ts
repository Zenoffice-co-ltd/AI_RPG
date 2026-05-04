// Issues a short-lived ephemeral token for the browser to open a WebSocket
// against the xAI Voice Agent realtime endpoint. The token is passed by the
// browser as the `xai-client-secret.<token>` WebSocket subprotocol, so the
// xAI API key never reaches the client.
//
// Reference:
//   https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens
//   POST https://api.x.ai/v1/realtime/client_secrets
//   Authorization: Bearer XAI_API_KEY
//   Body: { "expires_after": { "seconds": <int> } }
//   Response: { "value": "<token>", "expires_at": <unix_seconds> }
//
// Session configuration (voice, instructions, audio format, turn_detection)
// is NOT part of this request — the xAI ephemeral endpoint deliberately
// rejects `session` here. Session config is sent over the WebSocket via
// `session.update` once the browser has connected (handled by the client
// in `apps/web/lib/roleplay/grok-voice-realtime.ts`).

export type GrokEphemeralTokenIssued = {
  value: string;
  expiresAt: string; // ISO timestamp
};

export type IssueGrokEphemeralTokenOptions = {
  endpoint: string;
  apiKey: string;
  expiresAfterSeconds?: number; // default 300
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

const DEFAULT_TTL_SECONDS = 300;

export async function issueGrokEphemeralToken(
  options: IssueGrokEphemeralTokenOptions
): Promise<GrokEphemeralTokenIssued> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const init: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      expires_after: {
        seconds: options.expiresAfterSeconds ?? DEFAULT_TTL_SECONDS,
      },
    }),
  };
  if (options.signal) init.signal = options.signal;

  const response = await fetchImpl(options.endpoint, init);
  if (!response.ok) {
    const bodyText = await safeText(response);
    throw new GrokEphemeralTokenError(
      `ephemeral token request failed: ${response.status}`,
      response.status,
      bodyText
    );
  }
  const payload = (await response.json()) as {
    value?: unknown;
    expires_at?: unknown;
  };
  const value = payload?.value;
  const expiresAt = payload?.expires_at;
  if (typeof value !== "string" || value.length === 0) {
    throw new GrokEphemeralTokenError(
      "ephemeral token response missing value",
      500,
      JSON.stringify(payload).slice(0, 200)
    );
  }
  return {
    value,
    expiresAt: normaliseExpiresAt(expiresAt),
  };
}

function normaliseExpiresAt(input: unknown): string {
  if (typeof input === "string" && input.length > 0) {
    return input;
  }
  if (typeof input === "number" && Number.isFinite(input) && input > 0) {
    // Unix seconds → ISO.
    return new Date(input * 1000).toISOString();
  }
  // Fallback: 60s from now (xAI ephemeral tokens are short-lived; we assume
  // ~60s is safe even if upstream omitted the field).
  return new Date(Date.now() + 60_000).toISOString();
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 400);
  } catch {
    return "";
  }
}

export class GrokEphemeralTokenError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "GrokEphemeralTokenError";
    this.status = status;
    this.body = body;
  }
}
