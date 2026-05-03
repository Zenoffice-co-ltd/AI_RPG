import { describe, expect, it } from "vitest";
import {
  ZaiChatCompletionsStreamingClient,
} from "./zaiStreaming";
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

describe("ZaiChatCompletionsStreamingClient", () => {
  it("yields content deltas from choices[].delta.content", async () => {
    const events = [
      sseData({ id: "zai_1", choices: [{ index: 0, delta: { content: "はい、" } }] }),
      sseData({ id: "zai_1", choices: [{ index: 0, delta: { content: "承知。" } }] }),
      "data: [DONE]\n\n",
    ];
    const client = new ZaiChatCompletionsStreamingClient({
      apiKey: "k",
      fetchImpl: async () => makeMockSseResponse(events),
    });
    const yielded = await collect(
      client.stream({ model: "glm-4.5-air", systemPrompt: "s", userMessage: "u" })
    );
    const deltas = yielded.filter((e) => e.kind === "delta");
    expect(deltas.map((d) => (d as { text: string }).text)).toEqual(["はい、", "承知。"]);
    const done = yielded.find((e) => e.kind === "done");
    expect(done && done.kind === "done" ? done.fullText : "").toBe("はい、承知。");
  });

  it("sends thinking type=disabled by default", async () => {
    let seenBody = "";
    const client = new ZaiChatCompletionsStreamingClient({
      apiKey: "k",
      fetchImpl: async (_url, init) => {
        seenBody = String(init.body ?? "");
        return makeMockSseResponse([sseData({ choices: [{ delta: { content: "x" } }] }), "data: [DONE]\n\n"]);
      },
    });
    await collect(
      client.stream({ model: "glm-4.5-air", systemPrompt: "s", userMessage: "u" })
    );
    expect(seenBody).toContain('"thinking":{"type":"disabled"}');
  });

  it("throws on HTTP 401", async () => {
    const client = new ZaiChatCompletionsStreamingClient({
      apiKey: "k",
      fetchImpl: async () => new Response("unauthorized", { status: 401 }),
    });
    await expect(
      collect(client.stream({ model: "glm-4.5-air", systemPrompt: "s", userMessage: "u" }))
    ).rejects.toBeInstanceOf(StreamingTextError);
  });
});
