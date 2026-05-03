import { z } from "zod";

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_TIMEOUT_MS = 60_000;
const ANTHROPIC_VERSION = "2023-06-01";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type AnthropicStructuredClientOptions = {
  apiKey: string | (() => Promise<string>);
  baseUrl?: string;
  fetchImpl?: FetchLike;
};

export type StructuredJudgeRequest<TSchema extends z.ZodTypeAny> = {
  model: string;
  systemPrompt: string;
  userMessage: string;
  toolName: string;
  toolDescription?: string;
  jsonSchema: Record<string, unknown>;
  responseSchema: TSchema;
  maxOutputTokens?: number;
  temperature?: number;
};

export type StructuredJudgeResult<T> = {
  parsed: T;
  responseId: string;
  rawText: string | null;
};

export class AnthropicStructuredError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly body: unknown
  ) {
    super(message);
    this.name = "AnthropicStructuredError";
  }
}

/**
 * Forces the model to call a single tool with strict JSON input.
 * Used for blind LLM judge scoring where the response must be machine-parsable.
 */
export class AnthropicMessagesStructuredClient {
  private readonly apiKey: AnthropicStructuredClientOptions["apiKey"];
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: AnthropicStructuredClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  private async resolveApiKey(): Promise<string> {
    return typeof this.apiKey === "string" ? this.apiKey : this.apiKey();
  }

  async createStructuredOutput<TSchema extends z.ZodTypeAny>(
    input: StructuredJudgeRequest<TSchema>
  ): Promise<StructuredJudgeResult<z.infer<TSchema>>> {
    const apiKey = await this.resolveApiKey();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    const body = {
      model: input.model,
      max_tokens: input.maxOutputTokens ?? 1024,
      system: input.systemPrompt,
      messages: [
        {
          role: "user" as const,
          content: [{ type: "text", text: input.userMessage }],
        },
      ],
      tools: [
        {
          name: input.toolName,
          description: input.toolDescription ?? "Record the structured judgment.",
          input_schema: input.jsonSchema,
        },
      ],
      tool_choice: { type: "tool", name: input.toolName },
      ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    };

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text().catch(() => "");
    if (!response.ok) {
      const snippet = text.slice(0, 240);
      throw new AnthropicStructuredError(
        `Anthropic structured request failed: HTTP ${response.status} ${snippet}`,
        response.status,
        text
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(text);
    } catch {
      throw new AnthropicStructuredError(
        "Anthropic response was not valid JSON",
        response.status,
        text
      );
    }

    const obj = parsedBody as {
      id?: string;
      content?: Array<{
        type?: string;
        name?: string;
        input?: unknown;
        text?: string;
      }>;
    };

    const responseId = typeof obj.id === "string" ? obj.id : "";
    const toolUse = obj.content?.find(
      (block) => block.type === "tool_use" && block.name === input.toolName
    );
    if (!toolUse || toolUse.input === undefined) {
      throw new AnthropicStructuredError(
        `Anthropic response did not include tool_use for "${input.toolName}"`,
        response.status,
        parsedBody
      );
    }

    const parsed = input.responseSchema.parse(toolUse.input) as z.infer<TSchema>;
    return {
      parsed,
      responseId,
      rawText:
        obj.content?.find((b) => b.type === "text" && typeof b.text === "string")?.text ??
        null,
    };
  }
}
