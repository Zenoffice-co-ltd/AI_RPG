import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AnthropicMessagesStructuredClient,
  AnthropicStructuredError,
} from "./anthropicStructured";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const schema = z.object({
  overallScore: z.number(),
  rationale: z.string(),
});

const jsonSchema = {
  type: "object",
  properties: {
    overallScore: { type: "number" },
    rationale: { type: "string" },
  },
  required: ["overallScore", "rationale"],
};

describe("AnthropicMessagesStructuredClient", () => {
  it("parses tool_use input via Zod schema", async () => {
    const client = new AnthropicMessagesStructuredClient({
      apiKey: "k",
      fetchImpl: async () =>
        jsonResponse({
          id: "msg_test",
          content: [
            {
              type: "tool_use",
              name: "record_judgment",
              input: { overallScore: 80, rationale: "OK" },
            },
          ],
        }),
    });

    const result = await client.createStructuredOutput({
      model: "claude-sonnet",
      systemPrompt: "be a judge",
      userMessage: "judge this",
      toolName: "record_judgment",
      jsonSchema,
      responseSchema: schema,
    });
    expect(result.parsed.overallScore).toBe(80);
    expect(result.parsed.rationale).toBe("OK");
    expect(result.responseId).toBe("msg_test");
  });

  it("forces tool_choice to the requested tool", async () => {
    let seenBody = "";
    const client = new AnthropicMessagesStructuredClient({
      apiKey: "k",
      fetchImpl: async (_url, init) => {
        seenBody = String(init.body);
        return jsonResponse({
          id: "msg_test",
          content: [
            {
              type: "tool_use",
              name: "record_judgment",
              input: { overallScore: 50, rationale: "X" },
            },
          ],
        });
      },
    });
    await client.createStructuredOutput({
      model: "m",
      systemPrompt: "s",
      userMessage: "u",
      toolName: "record_judgment",
      jsonSchema,
      responseSchema: schema,
    });
    const body = JSON.parse(seenBody);
    expect(body.tool_choice).toEqual({ type: "tool", name: "record_judgment" });
  });

  it("throws on missing tool_use block", async () => {
    const client = new AnthropicMessagesStructuredClient({
      apiKey: "k",
      fetchImpl: async () =>
        jsonResponse({
          id: "msg_test",
          content: [{ type: "text", text: "I will not." }],
        }),
    });
    await expect(
      client.createStructuredOutput({
        model: "m",
        systemPrompt: "s",
        userMessage: "u",
        toolName: "record_judgment",
        jsonSchema,
        responseSchema: schema,
      })
    ).rejects.toBeInstanceOf(AnthropicStructuredError);
  });

  it("throws on HTTP error", async () => {
    const client = new AnthropicMessagesStructuredClient({
      apiKey: "k",
      fetchImpl: async () => jsonResponse({ error: "rate limited" }, 429),
    });
    await expect(
      client.createStructuredOutput({
        model: "m",
        systemPrompt: "s",
        userMessage: "u",
        toolName: "record_judgment",
        jsonSchema,
        responseSchema: schema,
      })
    ).rejects.toBeInstanceOf(AnthropicStructuredError);
  });
});
