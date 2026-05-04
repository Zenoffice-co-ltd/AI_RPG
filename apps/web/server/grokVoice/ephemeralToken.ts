// Issues a short-lived ephemeral token for the browser to open a WebSocket
// against the xAI Voice Agent realtime endpoint. The token is passed by the
// browser as the `xai-client-secret.<token>` WebSocket subprotocol, so the
// xAI API key never reaches the client.
//
// Reference: https://docs.x.ai/developers/model-capabilities/audio/voice-agent
//
// The exact request/response shape on the xAI ephemeral endpoint mirrors
// OpenAI's `/v1/realtime/sessions` style; if xAI publishes a slightly
// different field naming we adjust here without touching the rest of the
// pipeline.

export type GrokEphemeralAudioFormat = {
  type: string;
  rate: number;
};

export type GrokEphemeralTurnDetection = {
  type: "server_vad" | null;
  threshold?: number;
  silence_duration_ms?: number;
};

export type GrokEphemeralTokenRequest = {
  model: string;
  voice: string;
  instructions: string;
  audio: {
    input: { format: GrokEphemeralAudioFormat };
    output: { format: GrokEphemeralAudioFormat };
  };
  turn_detection: GrokEphemeralTurnDetection;
};

export type GrokEphemeralTokenIssued = {
  value: string;
  expiresAt: string; // ISO timestamp
};

export type IssueGrokEphemeralTokenOptions = {
  endpoint: string;
  apiKey: string;
  request: GrokEphemeralTokenRequest;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

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
      model: options.request.model,
      session: {
        voice: options.request.voice,
        instructions: options.request.instructions,
        audio: options.request.audio,
        turn_detection: options.request.turn_detection,
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
    client_secret?: { value?: unknown; expires_at?: unknown };
  };
  const value = payload?.client_secret?.value;
  const expiresAt = payload?.client_secret?.expires_at;
  if (typeof value !== "string" || value.length === 0) {
    throw new GrokEphemeralTokenError(
      "ephemeral token response missing client_secret.value",
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
