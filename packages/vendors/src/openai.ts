import { z } from "zod";
import { requestJson } from "./http";

const responseEnvelopeSchema = z.object({
  id: z.string().min(1),
  output_text: z.string().optional(),
  output: z
    .array(
      z.object({
        type: z.string().optional(),
        content: z
          .array(
            z.object({
              type: z.string(),
              text: z.string().optional(),
            })
          )
          .optional(),
      })
    )
    .optional(),
});

export type StructuredOutputResult<T> = {
  responseId: string;
  parsed: T;
};

export type TextResponseMessage = {
  role: "user" | "assistant";
  text: string;
};

function buildInputTextPart(text: string) {
  return {
    type: "input_text" as const,
    text,
  };
}

function buildConversationMessage(message: TextResponseMessage) {
  return {
    role: message.role,
    content: [
      message.role === "assistant"
        ? {
            type: "output_text" as const,
            text: message.text,
          }
        : buildInputTextPart(message.text),
    ],
  };
}

function extractResponseText(response: z.infer<typeof responseEnvelopeSchema>) {
  return (
    response.output_text ??
    response.output
      ?.flatMap((item) => item.content ?? [])
      .map((part) => part.text)
      .find((value): value is string => typeof value === "string")
  );
}
export class OpenAiResponsesClient {
  constructor(
    private readonly apiKeyProvider: string | (() => Promise<string>),
    private readonly baseUrl = "https://api.openai.com/v1"
  ) {}

  private async resolveApiKey() {
    return typeof this.apiKeyProvider === "string"
      ? this.apiKeyProvider
      : this.apiKeyProvider();
  }

  async createStructuredOutput<TSchema extends z.ZodTypeAny>(input: {
    model: string;
    schemaName: string;
    jsonSchema: Record<string, unknown>;
    systemPrompt: string;
    userPrompt: string;
    responseSchema: TSchema;
  }): Promise<z.infer<TSchema>> {
    const result = await this.createStructuredOutputWithMetadata(input);
    return result.parsed;
  }

  async createStructuredOutputWithMetadata<TSchema extends z.ZodTypeAny>(input: {
    model: string;
    schemaName: string;
    jsonSchema: Record<string, unknown>;
    systemPrompt: string;
    userPrompt: string;
    responseSchema: TSchema;
  }): Promise<StructuredOutputResult<z.infer<TSchema>>> {
    const apiKey = await this.resolveApiKey();
    const response = await requestJson({
      scope: "openai.responses.create",
      url: `${this.baseUrl}/responses`,
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        input: [
          {
            role: "system",
            content: [buildInputTextPart(input.systemPrompt)],
          },
          {
            role: "user",
            content: [buildInputTextPart(input.userPrompt)],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: input.schemaName,
            schema: input.jsonSchema,
            strict: true,
          },
        },
      }),
      schema: responseEnvelopeSchema,
      timeoutMs: 180_000,
      retries: 2,
    });

    const text = extractResponseText(response);

    if (!text) {
      throw new Error("OpenAI response did not include structured output text");
    }

    return {
      responseId: response.id,
      parsed: input.responseSchema.parse(JSON.parse(text)),
    };
  }

  async createTextResponse(input: {
    model: string;
    systemPrompt: string;
    messages: TextResponseMessage[];
    maxOutputTokens?: number;
  }) {
    const apiKey = await this.resolveApiKey();
    const response = await requestJson({
      scope: "openai.responses.create",
      url: `${this.baseUrl}/responses`,
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        truncation: "disabled",
        ...(input.maxOutputTokens !== undefined
          ? { max_output_tokens: input.maxOutputTokens }
          : {}),
        input: [
          {
            role: "system",
            content: [buildInputTextPart(input.systemPrompt)],
          },
          ...input.messages.map(buildConversationMessage),
        ],
      }),
      schema: responseEnvelopeSchema,
      timeoutMs: 180_000,
      retries: 2,
    });

    const text = extractResponseText(response);
    if (!text) {
      throw new Error("OpenAI response did not include text output");
    }

    return {
      responseId: response.id,
      text,
    };
  }
}
