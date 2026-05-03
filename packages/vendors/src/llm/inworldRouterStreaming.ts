import { parseJsonOrNull, readSseEvents } from "./sseParser";
import { StreamingTextError, type StreamingTextEvent, type StreamingTextRequest } from "./streamingText";

const DEFAULT_BASE_URL = "https://api.inworld.ai/v1";
const DEFAULT_TIMEOUT_MS = 60_000;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type InworldRouterStreamingClientOptions = {
  apiKey: string | (() => Promise<string>);
  baseUrl?: string;
  fetchImpl?: FetchLike;
};

export class InworldRouterStreamingClient {
  private readonly apiKey: InworldRouterStreamingClientOptions["apiKey"];
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: InworldRouterStreamingClientOptions) {
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

    const body: Record<string, unknown> = {
      model: input.model,
      stream: true,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userMessage },
      ],
    };
    if (input.maxOutputTokens !== undefined) {
      body["max_tokens"] = input.maxOutputTokens;
    }
    if (input.temperature !== undefined) {
      body["temperature"] = input.temperature;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Basic ${apiKey}`,
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
        `Inworld streaming request failed: HTTP ${response.status}${snippet}`,
        response.status,
        vendorRequestId,
        text
      );
    }

    let fullText = "";
    let responseId = "";

    try {
      for await (const evt of readSseEvents(response.body)) {
        if (evt.data === "[DONE]") break;
        const data = parseJsonOrNull(evt.data);
        if (!data || typeof data !== "object") continue;
        const obj = data as Record<string, unknown>;

        const idField = obj["id"];
        if (typeof idField === "string" && idField.length > 0) {
          responseId = idField;
        }

        const errorField = obj["error"];
        if (errorField && typeof errorField === "object") {
          throw new StreamingTextError(
            `Inworld streaming error: ${JSON.stringify(errorField).slice(0, 240)}`,
            null,
            vendorRequestId,
            errorField
          );
        }

        const choices = obj["choices"];
        if (!Array.isArray(choices)) continue;
        for (const choice of choices) {
          if (typeof choice !== "object" || choice === null) continue;
          const delta = (choice as { delta?: unknown }).delta;
          if (typeof delta !== "object" || delta === null) continue;
          const content = (delta as { content?: unknown }).content;
          if (typeof content === "string" && content.length > 0) {
            fullText += content;
            yield { kind: "delta", text: content };
          }
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    yield {
      kind: "done",
      fullText,
      responseId,
    };
  }
}
