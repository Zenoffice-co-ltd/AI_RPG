import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestJson } = vi.hoisted(() => ({
  requestJson: vi.fn(),
}));

vi.mock("./http", () => ({
  requestJson,
}));

import { OpenAiResponsesClient } from "./openai";

describe("OpenAiResponsesClient.createTextResponse", () => {
  beforeEach(() => {
    requestJson.mockReset();
    requestJson.mockResolvedValue({
      id: "resp_123",
      output_text: "承知しました。背景から順に確認します。",
    });
  });

  it("serializes assistant history as output_text for Responses API", async () => {
    const client = new OpenAiResponsesClient("test-key");

    await client.createTextResponse({
      model: "gpt-5.4",
      systemPrompt: "Stay in character.",
      messages: [
        {
          role: "assistant",
          text: "時間がないので要点だけお願いします。",
        },
        {
          role: "user",
          text: "募集背景を教えてください。",
        },
      ],
      maxOutputTokens: 200,
    });

    expect(requestJson).toHaveBeenCalledTimes(1);
    const request = requestJson.mock.calls[0]?.[0];
    expect(request).toBeDefined();

    const body = JSON.parse(String(request.body));
    expect(body.input[0].content[0]).toEqual({
      type: "input_text",
      text: "Stay in character.",
    });
    expect(body.input[1].content[0]).toEqual({
      type: "output_text",
      text: "時間がないので要点だけお願いします。",
    });
    expect(body.input[2].content[0]).toEqual({
      type: "input_text",
      text: "募集背景を教えてください。",
    });
  });
});
