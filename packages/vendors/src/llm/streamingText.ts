export type StreamingTextDelta = {
  kind: "delta";
  text: string;
};

export type StreamingTextDone = {
  kind: "done";
  fullText: string;
  responseId: string;
};

export type StreamingTextEvent = StreamingTextDelta | StreamingTextDone;

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export type StreamingTextHistoryTurn = {
  role: "user" | "assistant";
  text: string;
};

export type StreamingTextRequest = {
  model: string;
  systemPrompt: string;
  userMessage: string;
  /**
   * Prior conversation turns (excluding the current `userMessage` and the
   * `systemPrompt`). Provide for multi-turn chat; omit/empty for one-shot.
   */
  history?: readonly StreamingTextHistoryTurn[];
  maxOutputTokens?: number;
  temperature?: number;
  seed?: number;
  timeoutMs?: number;
  reasoningEffort?: ReasoningEffort;
};

export class StreamingTextError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly vendorRequestId: string | null,
    readonly body: unknown
  ) {
    super(message);
    this.name = "StreamingTextError";
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type StreamingTextClientOptions = {
  apiKey: string | (() => Promise<string>);
  baseUrl?: string;
  fetchImpl?: FetchLike;
};

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 60_000;

const TEXT_DELTA_EVENT_TYPES = new Set<string>([
  "response.output_text.delta",
  "response.text.delta",
]);

const COMPLETION_EVENT_TYPES = new Set<string>([
  "response.completed",
  "response.done",
]);

const ERROR_EVENT_TYPES = new Set<string>([
  "response.failed",
  "response.error",
  "error",
]);

export class OpenAiResponsesStreamingClient {
  private readonly apiKey: string | (() => Promise<string>);
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: StreamingTextClientOptions) {
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

    const conversationInput: Array<Record<string, unknown>> = [
      {
        role: "system",
        content: [{ type: "input_text", text: input.systemPrompt }],
      },
    ];
    if (input.history) {
      for (const turn of input.history) {
        conversationInput.push({
          role: turn.role,
          content: [
            turn.role === "assistant"
              ? { type: "output_text", text: turn.text }
              : { type: "input_text", text: turn.text },
          ],
        });
      }
    }
    conversationInput.push({
      role: "user",
      content: [{ type: "input_text", text: input.userMessage }],
    });
    const body: Record<string, unknown> = {
      model: input.model,
      stream: true,
      truncation: "disabled",
      input: conversationInput,
    };
    if (input.maxOutputTokens !== undefined) {
      body["max_output_tokens"] = input.maxOutputTokens;
    }
    if (input.temperature !== undefined) {
      body["temperature"] = input.temperature;
    }
    if (input.seed !== undefined) {
      body["seed"] = input.seed;
    }
    if (input.reasoningEffort !== undefined) {
      body["reasoning"] = { effort: input.reasoningEffort };
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
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
      response.headers.get("openai-request-id") ??
      null;

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      clearTimeout(timeout);
      const snippet = text.length > 0 ? ` body=${text.slice(0, 240)}` : "";
      throw new StreamingTextError(
        `OpenAI streaming request failed: HTTP ${response.status}${snippet}`,
        response.status,
        vendorRequestId,
        text
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullText = "";
    let responseId = "";
    let doneEmitted = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let separatorIdx = buffer.indexOf("\n\n");
        while (separatorIdx !== -1) {
          const rawEvent = buffer.slice(0, separatorIdx);
          buffer = buffer.slice(separatorIdx + 2);
          separatorIdx = buffer.indexOf("\n\n");

          const parsed = parseSseEvent(rawEvent);
          if (!parsed) continue;

          if (ERROR_EVENT_TYPES.has(parsed.type)) {
            throw new StreamingTextError(
              `OpenAI streaming error event: ${parsed.type}`,
              null,
              vendorRequestId,
              parsed.data
            );
          }

          if (TEXT_DELTA_EVENT_TYPES.has(parsed.type)) {
            const delta = extractDelta(parsed.data);
            if (delta && delta.length > 0) {
              fullText += delta;
              yield { kind: "delta", text: delta };
            }
            continue;
          }

          if (COMPLETION_EVENT_TYPES.has(parsed.type)) {
            const finalText = extractFinalText(parsed.data) ?? fullText;
            const finalId = extractResponseId(parsed.data) ?? responseId;
            doneEmitted = true;
            yield {
              kind: "done",
              fullText: finalText,
              responseId: finalId,
            };
            return;
          }

          const inferredId = extractResponseId(parsed.data);
          if (inferredId) responseId = inferredId;
        }
      }

      if (!doneEmitted) {
        yield {
          kind: "done",
          fullText,
          responseId,
        };
      }
    } finally {
      clearTimeout(timeout);
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
  }
}

type ParsedSseEvent = {
  type: string;
  data: unknown;
};

function parseSseEvent(raw: string): ParsedSseEvent | null {
  if (raw.length === 0) return null;
  let eventName: string | null = null;
  const dataLines: string[] = [];

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.length === 0 || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).replace(/^ /, ""));
    }
  }

  if (dataLines.length === 0) return null;
  const dataText = dataLines.join("\n");
  if (dataText === "[DONE]") return null;

  let data: unknown = null;
  try {
    data = JSON.parse(dataText);
  } catch {
    return null;
  }

  let type = eventName;
  if (!type && typeof data === "object" && data !== null) {
    const maybe = (data as { type?: unknown }).type;
    if (typeof maybe === "string") type = maybe;
  }
  if (!type) return null;

  return { type, data };
}

function extractDelta(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;
  const direct = obj["delta"];
  if (typeof direct === "string") return direct;
  if (typeof direct === "object" && direct !== null) {
    const inner = (direct as { text?: unknown }).text;
    if (typeof inner === "string") return inner;
  }
  const text = obj["text"];
  if (typeof text === "string") return text;
  return null;
}

function extractResponseId(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj["id"] === "string") return obj["id"] as string;
  const response = obj["response"];
  if (typeof response === "object" && response !== null) {
    const id = (response as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return null;
}

function extractFinalText(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;
  const response = obj["response"];
  if (typeof response !== "object" || response === null) return null;

  const responseObj = response as Record<string, unknown>;
  if (typeof responseObj["output_text"] === "string") {
    return responseObj["output_text"] as string;
  }
  const output = responseObj["output"];
  if (Array.isArray(output)) {
    for (const item of output) {
      if (typeof item !== "object" || item === null) continue;
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;
      const parts = content
        .map((part) => {
          if (typeof part !== "object" || part === null) return null;
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : null;
        })
        .filter((value): value is string => value !== null);
      if (parts.length > 0) {
        return parts.join("");
      }
    }
  }
  return null;
}
