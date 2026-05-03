import { parseJsonOrNull, readSseEvents } from "./sseParser";
import { StreamingTextError, type StreamingTextEvent, type StreamingTextRequest } from "./streamingText";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_TIMEOUT_MS = 60_000;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type GoogleAiStudioStreamingClientOptions = {
  apiKey: string | (() => Promise<string>);
  baseUrl?: string;
  fetchImpl?: FetchLike;
  /**
   * Thinking token budget for Gemini 2.5+ models that support `thinkingConfig`.
   * Default `0` disables thinking — required for conversation latency benchmarks
   * because gemini-2.5-flash otherwise consumes most of `maxOutputTokens` on
   * reasoning, leaving the spoken response truncated.
   * Pass `undefined` to omit `thinkingConfig` entirely (legacy behavior).
   */
  thinkingBudget?: number | null;
};

export class GoogleAiStudioStreamingClient {
  private readonly apiKey: GoogleAiStudioStreamingClientOptions["apiKey"];
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly thinkingBudget: number | null;

  constructor(options: GoogleAiStudioStreamingClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    // default 0 = disable thinking. null = omit thinkingConfig (legacy).
    this.thinkingBudget =
      options.thinkingBudget === undefined ? 0 : options.thinkingBudget;
  }

  private async resolveApiKey(): Promise<string> {
    return typeof this.apiKey === "string" ? this.apiKey : this.apiKey();
  }

  async *stream(input: StreamingTextRequest): AsyncIterable<StreamingTextEvent> {
    const apiKey = await this.resolveApiKey();
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const generationConfig: Record<string, unknown> = {};
    if (input.maxOutputTokens !== undefined) {
      generationConfig["maxOutputTokens"] = input.maxOutputTokens;
    }
    if (input.temperature !== undefined) {
      generationConfig["temperature"] = input.temperature;
    }
    if (input.seed !== undefined) {
      generationConfig["seed"] = input.seed;
    }
    if (this.thinkingBudget !== null) {
      generationConfig["thinkingConfig"] = { thinkingBudget: this.thinkingBudget };
    }

    const contents: Array<Record<string, unknown>> = [];
    if (input.history) {
      for (const turn of input.history) {
        contents.push({
          // Gemini uses "model" rather than "assistant" for the agent role.
          role: turn.role === "assistant" ? "model" : "user",
          parts: [{ text: turn.text }],
        });
      }
    }
    contents.push({
      role: "user",
      parts: [{ text: input.userMessage }],
    });
    const body: Record<string, unknown> = {
      contents,
      systemInstruction: {
        parts: [{ text: input.systemPrompt }],
      },
    };
    if (Object.keys(generationConfig).length > 0) {
      body["generationConfig"] = generationConfig;
    }

    const url = `${this.baseUrl}/models/${encodeURIComponent(
      input.model
    )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
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
      response.headers.get("x-goog-request-id") ??
      response.headers.get("x-request-id") ??
      null;

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      clearTimeout(timeout);
      const snippet = text.length > 0 ? ` body=${text.slice(0, 240)}` : "";
      throw new StreamingTextError(
        `Google streaming request failed: HTTP ${response.status}${snippet}`,
        response.status,
        vendorRequestId,
        text
      );
    }

    let fullText = "";
    let responseId = "";

    try {
      for await (const evt of readSseEvents(response.body)) {
        const data = parseJsonOrNull(evt.data);
        if (!data || typeof data !== "object") continue;

        const obj = data as Record<string, unknown>;
        const errorField = obj["error"];
        if (errorField && typeof errorField === "object") {
          throw new StreamingTextError(
            `Google streaming error: ${JSON.stringify(errorField).slice(0, 240)}`,
            null,
            vendorRequestId,
            errorField
          );
        }

        const candidates = obj["candidates"];
        if (Array.isArray(candidates)) {
          for (const candidate of candidates) {
            if (typeof candidate !== "object" || candidate === null) continue;
            const content = (candidate as { content?: unknown }).content;
            if (typeof content !== "object" || content === null) continue;
            const parts = (content as { parts?: unknown }).parts;
            if (!Array.isArray(parts)) continue;
            for (const part of parts) {
              if (typeof part !== "object" || part === null) continue;
              const text = (part as { text?: unknown }).text;
              if (typeof text === "string" && text.length > 0) {
                fullText += text;
                yield { kind: "delta", text };
              }
            }
          }
        }

        const responseIdField = obj["responseId"];
        if (typeof responseIdField === "string" && responseIdField.length > 0) {
          responseId = responseIdField;
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
