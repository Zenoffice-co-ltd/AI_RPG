/**
 * Minimal ElevenLabs ConvAI WebSocket client for benchmarking the live agent's
 * end-to-end response speed (text input -> first agent audio chunk).
 *
 * Auth flow: server obtains a signed URL via REST, then opens a WebSocket to
 * that URL (no API key passed over WS). The agent itself is NOT modified —
 * we only send user_message events.
 */

const DEFAULT_REST_BASE = "https://api.elevenlabs.io";
const DEFAULT_TIMEOUT_MS = 60_000;

export class ElevenLabsConvAiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly body: unknown
  ) {
    super(message);
    this.name = "ElevenLabsConvAiError";
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type ElevenLabsConvAiClientOptions = {
  apiKey: string | (() => Promise<string>);
  agentId: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
};

export type ConvAiTurnInput = {
  userMessage: string;
  /** Optional override for conversation initiation. */
  initiationOverrides?: Record<string, unknown>;
  timeoutMs?: number;
};

export type ConvAiTurnResult = {
  conversationId: string;
  agentResponseText: string;
  /** Concatenated PCM 16-bit LE @ 16kHz (ElevenLabs ConvAI default audio format). */
  audio: Buffer;
  audioFormat: "pcm_s16le";
  sampleRateHz: number;
  bytes: number;
  /** Time from user_message send to first agent audio chunk reception (ms). */
  requestToFirstAudioMs: number | null;
  /** Time from user_message send to final audio chunk + agent_response_correction or agent_response_done (ms). */
  requestToLastAudioMs: number | null;
  /** Time from user_message send to first agent text token (if streamed). */
  requestToFirstTextMs: number | null;
  receivedEvents: number;
};

type SignedUrlResponse = {
  signed_url: string;
};

/**
 * Get a short-lived signed WebSocket URL via REST.
 */
async function getSignedUrl(args: {
  apiKey: string;
  agentId: string;
  baseUrl: string;
  fetchImpl: FetchLike;
}): Promise<string> {
  const url = `${args.baseUrl}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(
    args.agentId
  )}`;
  const response = await args.fetchImpl(url, {
    method: "GET",
    headers: { "xi-api-key": args.apiKey },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new ElevenLabsConvAiError(
      `get-signed-url failed: HTTP ${response.status} ${text.slice(0, 240)}`,
      response.status,
      text
    );
  }
  let parsed: SignedUrlResponse;
  try {
    parsed = JSON.parse(text) as SignedUrlResponse;
  } catch {
    throw new ElevenLabsConvAiError("signed-url response not JSON", response.status, text);
  }
  if (!parsed.signed_url) {
    throw new ElevenLabsConvAiError("signed_url missing from response", response.status, parsed);
  }
  return parsed.signed_url;
}

type IncomingEvent = {
  type?: string;
  conversation_initiation_metadata_event?: { conversation_id?: string };
  user_transcription_event?: { user_transcript?: string };
  audio_event?: { audio_base_64?: string };
  agent_response_event?: { agent_response?: string };
  agent_response_correction_event?: { corrected_agent_response?: string };
  ping_event?: { event_id?: number };
};

export class ElevenLabsConvAiClient {
  private readonly apiKey: ElevenLabsConvAiClientOptions["apiKey"];
  private readonly agentId: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: ElevenLabsConvAiClientOptions) {
    this.apiKey = options.apiKey;
    this.agentId = options.agentId;
    this.baseUrl = options.baseUrl ?? DEFAULT_REST_BASE;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  private async resolveApiKey(): Promise<string> {
    return typeof this.apiKey === "string" ? this.apiKey : this.apiKey();
  }

  /**
   * Run a single turn (one user_message) and collect the agent's full response.
   * Closes the WebSocket once the agent emits any of:
   * - `internal_tentative_agent_response` followed by silence past 3s, OR
   * - `agent_response_correction_event` / `agent_response_event` (final), OR
   * - explicit timeout.
   *
   * To keep the client simple, we close after the first sustained quiet period
   * after audio has been received.
   */
  async runOneTurn(input: ConvAiTurnInput): Promise<ConvAiTurnResult> {
    const apiKey = await this.resolveApiKey();
    const signedUrl = await getSignedUrl({
      apiKey,
      agentId: this.agentId,
      baseUrl: this.baseUrl,
      fetchImpl: this.fetchImpl,
    });
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<ConvAiTurnResult>((resolveResult, rejectResult) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(signedUrl);
      } catch (error) {
        rejectResult(error);
        return;
      }
      ws.binaryType = "arraybuffer";

      let conversationId = "";
      let agentText = "";
      const audioChunks: Buffer[] = [];
      let userMessageSentAt: number | null = null;
      let firstAudioAt: number | null = null;
      let firstTextAt: number | null = null;
      let lastAudioAt: number | null = null;
      let receivedEvents = 0;
      let resolved = false;
      let quietTimer: ReturnType<typeof setTimeout> | null = null;
      let opened = false;

      const cleanup = () => {
        if (quietTimer !== null) clearTimeout(quietTimer);
        try {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
        } catch {
          // ignore
        }
      };

      const finish = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        const audio = Buffer.concat(audioChunks);
        const startedAt = userMessageSentAt;
        resolveResult({
          conversationId,
          agentResponseText: agentText,
          audio,
          audioFormat: "pcm_s16le",
          sampleRateHz: 16_000,
          bytes: audio.byteLength,
          requestToFirstAudioMs:
            firstAudioAt !== null && startedAt !== null ? firstAudioAt - startedAt : null,
          requestToLastAudioMs:
            lastAudioAt !== null && startedAt !== null ? lastAudioAt - startedAt : null,
          requestToFirstTextMs:
            firstTextAt !== null && startedAt !== null ? firstTextAt - startedAt : null,
          receivedEvents,
        });
      };

      const fail = (err: unknown) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        rejectResult(
          err instanceof Error
            ? err
            : new ElevenLabsConvAiError(String(err), null, err)
        );
      };

      const overallTimeout = setTimeout(() => {
        if (audioChunks.length > 0) {
          // we have at least some audio — count this as success
          finish();
        } else {
          fail(new ElevenLabsConvAiError(`ConvAi turn timed out after ${timeoutMs}ms`, null, null));
        }
      }, timeoutMs);

      const armQuietTimer = () => {
        if (quietTimer !== null) clearTimeout(quietTimer);
        // After we have at least some audio, wait 1500ms of quiet to declare done.
        quietTimer = setTimeout(() => {
          if (audioChunks.length > 0) {
            finish();
          }
        }, 1500);
      };

      ws.addEventListener("open", () => {
        opened = true;
        try {
          ws.send(
            JSON.stringify({
              type: "conversation_initiation_client_data",
              ...(input.initiationOverrides ?? {}),
            })
          );
        } catch (error) {
          fail(error);
        }
      });

      ws.addEventListener("error", (event) => {
        if (!resolved) {
          fail(
            new ElevenLabsConvAiError(
              `WebSocket error${
                opened ? " after open" : " before open"
              }: ${(event as { message?: string }).message ?? "unknown"}`,
              null,
              event
            )
          );
        }
      });

      ws.addEventListener("close", () => {
        clearTimeout(overallTimeout);
        if (!resolved) {
          if (audioChunks.length > 0) {
            finish();
          } else {
            fail(new ElevenLabsConvAiError("WebSocket closed before any audio", null, null));
          }
        }
      });

      ws.addEventListener("message", (event: MessageEvent) => {
        receivedEvents += 1;
        let raw = event.data;
        if (raw instanceof ArrayBuffer) raw = Buffer.from(raw).toString("utf8");
        if (typeof raw !== "string") return;
        let parsed: IncomingEvent;
        try {
          parsed = JSON.parse(raw) as IncomingEvent;
        } catch {
          return;
        }

        // Echo pings to keep connection alive
        if (parsed.type === "ping") {
          const pingId = parsed.ping_event?.event_id;
          try {
            ws.send(
              JSON.stringify({
                type: "pong",
                event_id: pingId ?? 0,
              })
            );
          } catch {
            // ignore
          }
          return;
        }

        if (parsed.type === "conversation_initiation_metadata") {
          const id = parsed.conversation_initiation_metadata_event?.conversation_id;
          if (typeof id === "string") conversationId = id;
          // Now send the user_message and start the latency clock.
          try {
            userMessageSentAt = Date.now();
            ws.send(
              JSON.stringify({
                type: "user_message",
                text: input.userMessage,
              })
            );
          } catch (error) {
            fail(error);
          }
          return;
        }

        if (parsed.type === "audio") {
          const b64 = parsed.audio_event?.audio_base_64;
          if (typeof b64 === "string" && b64.length > 0) {
            const buf = Buffer.from(b64, "base64");
            audioChunks.push(buf);
            const now = Date.now();
            if (firstAudioAt === null) firstAudioAt = now;
            lastAudioAt = now;
            armQuietTimer();
          }
          return;
        }

        if (parsed.type === "agent_response") {
          const txt = parsed.agent_response_event?.agent_response;
          if (typeof txt === "string") {
            if (firstTextAt === null) firstTextAt = Date.now();
            agentText = txt;
          }
          return;
        }

        if (parsed.type === "agent_response_correction") {
          const txt =
            parsed.agent_response_correction_event?.corrected_agent_response;
          if (typeof txt === "string") agentText = txt;
          return;
        }
      });
    });
  }
}
