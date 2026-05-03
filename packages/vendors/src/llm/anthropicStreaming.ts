import { parseJsonOrNull, readSseEvents } from "./sseParser";
import { StreamingTextError, type StreamingTextEvent, type StreamingTextRequest } from "./streamingText";

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_TIMEOUT_MS = 60_000;
const ANTHROPIC_VERSION = "2023-06-01";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type AnthropicStreamingClientOptions = {
  apiKey: string | (() => Promise<string>);
  baseUrl?: string;
  fetchImpl?: FetchLike;
};

export class AnthropicMessagesStreamingClient {
  private readonly apiKey: AnthropicStreamingClientOptions["apiKey"];
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: AnthropicStreamingClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  private async resolveApiKey(): Promise<string> {
    return typeof this.apiKey === "string" ? this.apiKey : this.apiKey();
  }

  async *stream(input: StreamingTextRequest): AsyncIterable<StreamingTextEvent> {
    const apiKey = await this.resolveApiKey();
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const messages: Array<Record<string, unknown>> = [];
    if (input.history) {
      for (const turn of input.history) {
        messages.push({
          role: turn.role,
          content: [{ type: "text", text: turn.text }],
        });
      }
    }
    messages.push({
      role: "user",
      content: [{ type: "text", text: input.userMessage }],
    });
    const body: Record<string, unknown> = {
      model: input.model,
      stream: true,
      max_tokens: input.maxOutputTokens ?? 1024,
      system: input.systemPrompt,
      messages,
    };
    if (input.temperature !== undefined) {
      body["temperature"] = input.temperature;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }

    const vendorRequestId =
      response.headers.get("x-request-id") ??
      response.headers.get("request-id") ??
      null;

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      clearTimeout(timeout);
      const snippet = text.length > 0 ? ` body=${text.slice(0, 240)}` : "";
      throw new StreamingTextError(
        `Anthropic streaming request failed: HTTP ${response.status}${snippet}`,
        response.status,
        vendorRequestId,
        text
      );
    }

    let fullText = "";
    let messageId = "";
    let doneEmitted = false;

    try {
      for await (const evt of readSseEvents(response.body)) {
        if (evt.event === "error") {
          const data = parseJsonOrNull(evt.data);
          throw new StreamingTextError(
            "Anthropic streaming error event",
            null,
            vendorRequestId,
            data ?? evt.data
          );
        }

        if (evt.event === "message_start") {
          const data = parseJsonOrNull(evt.data) as
            | { message?: { id?: string } }
            | null;
          if (data?.message?.id && typeof data.message.id === "string") {
            messageId = data.message.id;
          }
          continue;
        }

        if (evt.event === "content_block_delta") {
          const data = parseJsonOrNull(evt.data) as
            | { delta?: { type?: string; text?: string } }
            | null;
          const delta = data?.delta;
          if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
            fullText += delta.text;
            yield { kind: "delta", text: delta.text };
          }
          continue;
        }

        if (evt.event === "message_stop") {
          doneEmitted = true;
          yield {
            kind: "done",
            fullText,
            responseId: messageId,
          };
          return;
        }
      }

      if (!doneEmitted) {
        yield {
          kind: "done",
          fullText,
          responseId: messageId,
        };
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
