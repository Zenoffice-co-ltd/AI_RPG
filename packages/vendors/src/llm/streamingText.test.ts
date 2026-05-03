import { describe, expect, it } from "vitest";
import {
  OpenAiResponsesStreamingClient,
  StreamingTextError,
  type StreamingTextEvent,
} from "./streamingText";

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

function sse(eventName: string, data: unknown): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function collect(
  iterable: AsyncIterable<StreamingTextEvent>
): Promise<StreamingTextEvent[]> {
  const out: StreamingTextEvent[] = [];
  for await (const event of iterable) {
    out.push(event);
  }
  return out;
}

describe("OpenAiResponsesStreamingClient", () => {
  it("yields delta events and a done event from response.output_text.delta + response.completed", async () => {
    const responseEvents = [
      sse("response.created", { type: "response.created", response: { id: "resp_abc" } }),
      sse("response.output_text.delta", {
        type: "response.output_text.delta",
        delta: "はい、",
      }),
      sse("response.output_text.delta", {
        type: "response.output_text.delta",
        delta: "承知しました。",
      }),
      sse("response.completed", {
        type: "response.completed",
        response: { id: "resp_abc", output_text: "はい、承知しました。" },
      }),
    ];

    const client = new OpenAiResponsesStreamingClient({
      apiKey: "test-key",
      fetchImpl: async () => makeMockSseResponse(responseEvents),
    });

    const events = await collect(
      client.stream({
        model: "gpt-test",
        systemPrompt: "system",
        userMessage: "hello",
      })
    );

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ kind: "delta", text: "はい、" });
    expect(events[1]).toEqual({ kind: "delta", text: "承知しました。" });
    expect(events[2]).toEqual({
      kind: "done",
      fullText: "はい、承知しました。",
      responseId: "resp_abc",
    });
  });

  it("also accepts response.text.delta event variant", async () => {
    const responseEvents = [
      sse("response.text.delta", { type: "response.text.delta", delta: "alt" }),
      sse("response.completed", {
        type: "response.completed",
        response: { id: "resp_v2", output_text: "alt" },
      }),
    ];

    const client = new OpenAiResponsesStreamingClient({
      apiKey: "k",
      fetchImpl: async () => makeMockSseResponse(responseEvents),
    });

    const events = await collect(
      client.stream({ model: "m", systemPrompt: "s", userMessage: "u" })
    );

    expect(events[0]).toEqual({ kind: "delta", text: "alt" });
  });

  it("falls back to accumulated fullText when completion event omits output_text", async () => {
    const responseEvents = [
      sse("response.output_text.delta", {
        type: "response.output_text.delta",
        delta: "abc",
      }),
      sse("response.completed", {
        type: "response.completed",
        response: { id: "resp_xyz" },
      }),
    ];

    const client = new OpenAiResponsesStreamingClient({
      apiKey: "k",
      fetchImpl: async () => makeMockSseResponse(responseEvents),
    });

    const events = await collect(
      client.stream({ model: "m", systemPrompt: "s", userMessage: "u" })
    );
    const done = events[events.length - 1];
    expect(done?.kind).toBe("done");
    if (done && done.kind === "done") {
      expect(done.fullText).toBe("abc");
      expect(done.responseId).toBe("resp_xyz");
    }
  });

  it("throws StreamingTextError on response.failed event", async () => {
    const responseEvents = [
      sse("response.failed", {
        type: "response.failed",
        response: { id: "resp_err" },
      }),
    ];

    const client = new OpenAiResponsesStreamingClient({
      apiKey: "k",
      fetchImpl: async () => makeMockSseResponse(responseEvents),
    });

    await expect(
      collect(
        client.stream({
          model: "m",
          systemPrompt: "s",
          userMessage: "u",
        })
      )
    ).rejects.toBeInstanceOf(StreamingTextError);
  });

  it("throws StreamingTextError on non-2xx HTTP", async () => {
    const client = new OpenAiResponsesStreamingClient({
      apiKey: "k",
      fetchImpl: async () =>
        new Response("boom", {
          status: 500,
          headers: { "content-type": "text/plain" },
        }),
    });

    await expect(
      collect(
        client.stream({
          model: "m",
          systemPrompt: "s",
          userMessage: "u",
        })
      )
    ).rejects.toBeInstanceOf(StreamingTextError);
  });

  it("handles SSE events split across chunk boundaries", async () => {
    const part1 =
      "event: response.output_text.delta\ndata: " +
      JSON.stringify({ type: "response.output_text.delta", delta: "hello" });
    const part2 =
      "\n\nevent: response.completed\ndata: " +
      JSON.stringify({
        type: "response.completed",
        response: { id: "resp_split", output_text: "hello" },
      }) +
      "\n\n";

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(part1));
        controller.enqueue(new TextEncoder().encode(part2));
        controller.close();
      },
    });

    const client = new OpenAiResponsesStreamingClient({
      apiKey: "k",
      fetchImpl: async () =>
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    });

    const events = await collect(
      client.stream({ model: "m", systemPrompt: "s", userMessage: "u" })
    );
    expect(events.map((e) => e.kind)).toEqual(["delta", "done"]);
  });
});
