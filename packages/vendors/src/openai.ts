import { z } from "zod";
import { requestJson } from "./http";

const responseEnvelopeSchema = z.object({
  id: z.string().min(1),
  output_text: z.string().optional(),
  output: z
    .array(
      z.object({
        content: z.array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
          })
        ),
      })
    )
    .optional(),
});

export class OpenAiResponsesClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.openai.com/v1"
  ) {}

  async createStructuredOutput<TSchema extends z.ZodTypeAny>(input: {
    model: string;
    schemaName: string;
    jsonSchema: Record<string, unknown>;
    systemPrompt: string;
    userPrompt: string;
    responseSchema: TSchema;
  }): Promise<z.infer<TSchema>> {
    const response = await requestJson({
      scope: "openai.responses.create",
      url: `${this.baseUrl}/responses`,
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: input.systemPrompt,
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: input.userPrompt,
              },
            ],
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
      timeoutMs: 60_000,
      retries: 1,
    });

    const text =
      response.output_text ??
      response.output
        ?.flatMap((item) => item.content)
        .map((part) => part.text)
        .find((value): value is string => typeof value === "string");

    if (!text) {
      throw new Error("OpenAI response did not include structured output text");
    }

    return input.responseSchema.parse(JSON.parse(text));
  }
}
