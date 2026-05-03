import { describe, expect, it } from "vitest";
import { InworldRouterStreamingClient } from "./inworldRouterStreaming";
import { StreamingTextError, type StreamingTextEvent } from "./streamingText";

function sseData(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function makeMockSseResponse(parts: string[]): Response {
  const body = parts.join("");
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

describe("InworldRouterStreamingClient", () => {
  it("yields content deltas from OpenAI-compatible chat completions stream", async () => {
    const events = [
      sseData({ id: "inworld_1", choices: [{ delta: { content: "はい" } }] }),
      sseData({ id: "inworld_1", choices: [{ delta: { content: "、了解。" } }] }),
      "data: [DONE]\n\n",
    ];
    const client = new InworldRouterStreamingClient({
      apiKey: "k",
      fetchImpl: async () => makeMockSseResponse(events),
    });
    const yielded = await collect(
      client.stream({ model: "auto", systemPrompt: "s", userMessage: "u" })
    );
    expect(yielded.filter((e) => e.kind === "delta")).toHaveLength(2);
    const done = yielded.find((e) => e.kind === "done");
    expect(done && done.kind === "done" ? done.fullText : "").toBe("はい、了解。");
  });

  it("uses Authorization: Basic <key>", async () => {
    let seenAuth = "";
    const client = new InworldRouterStreamingClient({
      apiKey: "secret",
      fetchImpl: async (_url, init) => {
        const headers = init.headers as Record<string, string>;
        seenAuth = headers["authorization"] ?? "";
        return makeMockSseResponse([sseData({ choices: [{ delta: { content: "x" } }] }), "data: [DONE]\n\n"]);
      },
    });
    await collect(
      client.stream({ model: "auto", systemPrompt: "s", userMessage: "u" })
    );
    expect(seenAuth).toBe("Basic secret");
  });

  it("throws on HTTP 4xx", async () => {
    const client = new InworldRouterStreamingClient({
      apiKey: "k",
      fetchImpl: async () => new Response("nope", { status: 400 }),
    });
    await expect(
      collect(client.stream({ model: "auto", systemPrompt: "s", userMessage: "u" }))
    ).rejects.toBeInstanceOf(StreamingTextError);
  });
});
