import { describe, expect, it } from "vitest";
import { AnthropicMessagesStreamingClient } from "./anthropicStreaming";
import { StreamingTextError, type StreamingTextEvent } from "./streamingText";

function sse(eventName: string, data: unknown): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

function makeMockSseResponse(events: string[]): Response {
  const body = events.join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function collect(
  iterable: AsyncIterable<StreamingTextEvent>
): Promise<StreamingTextEvent[]> {
  const out: StreamingTextEvent[] = [];
  for await (const event of iterable) out.push(event);
  return out;
}

describe("AnthropicMessagesStreamingClient", () => {
  it("yields text deltas from content_block_delta events and a done on message_stop", async () => {
    const events = [
      sse("message_start", {
        type: "message_start",
        message: { id: "msg_test", type: "message", role: "assistant" },
      }),
      sse("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
      sse("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "はい、" },
      }),
      sse("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "承知しました。" },
      }),
      sse("content_block_stop", { type: "content_block_stop", index: 0 }),
      sse("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
      }),
      sse("message_stop", { type: "message_stop" }),
    ];

    const client = new AnthropicMessagesStreamingClient({
      apiKey: "test-key",
      fetchImpl: async () => makeMockSseResponse(events),
    });

    const yielded = await collect(
      client.stream({
        model: "claude-haiku-4-5-20251001",
        systemPrompt: "system",
        userMessage: "hi",
      })
    );
    expect(yielded).toHaveLength(3);
    expect(yielded[0]).toEqual({ kind: "delta", text: "はい、" });
    expect(yielded[1]).toEqual({ kind: "delta", text: "承知しました。" });
    expect(yielded[2]).toEqual({
      kind: "done",
      fullText: "はい、承知しました。",
      responseId: "msg_test",
    });
  });

  it("ignores non-text deltas (thinking_delta etc)", async () => {
    const events = [
      sse("message_start", {
        type: "message_start",
        message: { id: "msg_thk" },
      }),
      sse("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "pondering..." },
      }),
      sse("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "出力" },
      }),
      sse("message_stop", { type: "message_stop" }),
    ];
    const client = new AnthropicMessagesStreamingClient({
      apiKey: "k",
      fetchImpl: async () => makeMockSseResponse(events),
    });
    const yielded = await collect(
      client.stream({ model: "m", systemPrompt: "s", userMessage: "u" })
    );
    expect(yielded.filter((e) => e.kind === "delta")).toHaveLength(1);
    expect((yielded[0] as { text: string }).text).toBe("出力");
  });

  it("throws StreamingTextError on non-2xx HTTP", async () => {
    const client = new AnthropicMessagesStreamingClient({
      apiKey: "k",
      fetchImpl: async () =>
        new Response("forbidden", {
          status: 403,
          headers: { "content-type": "text/plain" },
        }),
    });
    await expect(
      collect(client.stream({ model: "m", systemPrompt: "s", userMessage: "u" }))
    ).rejects.toBeInstanceOf(StreamingTextError);
  });

  it("throws on error event", async () => {
    const events = [
      sse("error", { type: "error", error: { type: "overloaded_error", message: "busy" } }),
    ];
    const client = new AnthropicMessagesStreamingClient({
      apiKey: "k",
      fetchImpl: async () => makeMockSseResponse(events),
    });
    await expect(
      collect(client.stream({ model: "m", systemPrompt: "s", userMessage: "u" }))
    ).rejects.toBeInstanceOf(StreamingTextError);
  });
});
