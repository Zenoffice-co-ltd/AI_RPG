import { describe, expect, it } from "vitest";
import { GoogleAiStudioStreamingClient } from "./googleAiStudioStreaming";
import { StreamingTextError, type StreamingTextEvent } from "./streamingText";

function sseData(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function makeMockSseResponse(chunks: string[]): Response {
  const body = chunks.join("");
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

describe("GoogleAiStudioStreamingClient", () => {
  it("yields text deltas from candidates[].content.parts[].text", async () => {
    const events = [
      sseData({
        candidates: [
          { content: { parts: [{ text: "はい、" }] } },
        ],
      }),
      sseData({
        candidates: [
          { content: { parts: [{ text: "了解しました。" }] } },
        ],
      }),
      sseData({
        candidates: [{ finishReason: "STOP" }],
        responseId: "gemini_resp_1",
      }),
    ];

    const client = new GoogleAiStudioStreamingClient({
      apiKey: "test-key",
      fetchImpl: async () => makeMockSseResponse(events),
    });

    const yielded = await collect(
      client.stream({
        model: "gemini-2.5-flash-lite",
        systemPrompt: "system",
        userMessage: "hi",
      })
    );
    const deltas = yielded.filter((e) => e.kind === "delta");
    expect(deltas).toHaveLength(2);
    expect((deltas[0] as { text: string }).text).toBe("はい、");
    expect((deltas[1] as { text: string }).text).toBe("了解しました。");
    const done = yielded.find((e) => e.kind === "done");
    expect(done).toBeDefined();
    if (done && done.kind === "done") {
      expect(done.fullText).toBe("はい、了解しました。");
      expect(done.responseId).toBe("gemini_resp_1");
    }
  });

  it("constructs URL with model and api key as query param", async () => {
    let seenUrl = "";
    const client = new GoogleAiStudioStreamingClient({
      apiKey: "abc123",
      fetchImpl: async (url) => {
        seenUrl = url;
        return makeMockSseResponse([
          sseData({ candidates: [{ content: { parts: [{ text: "x" }] } }] }),
        ]);
      },
    });
    await collect(
      client.stream({
        model: "gemini-2.5-flash-lite",
        systemPrompt: "s",
        userMessage: "u",
      })
    );
    expect(seenUrl).toContain("/models/gemini-2.5-flash-lite:streamGenerateContent");
    expect(seenUrl).toContain("alt=sse");
    expect(seenUrl).toContain("key=abc123");
  });

  it("includes thinkingConfig.thinkingBudget=0 by default in generationConfig", async () => {
    let seenBody = "";
    const client = new GoogleAiStudioStreamingClient({
      apiKey: "k",
      fetchImpl: async (_url, init) => {
        seenBody = String(init.body ?? "");
        return makeMockSseResponse([
          sseData({ candidates: [{ content: { parts: [{ text: "x" }] } }] }),
        ]);
      },
    });
    await collect(
      client.stream({
        model: "gemini-2.5-flash",
        systemPrompt: "s",
        userMessage: "u",
        maxOutputTokens: 200,
      })
    );
    const body = JSON.parse(seenBody) as {
      generationConfig?: { thinkingConfig?: { thinkingBudget?: number } };
    };
    expect(body.generationConfig?.thinkingConfig?.thinkingBudget).toBe(0);
  });

  it("respects custom thinkingBudget option", async () => {
    let seenBody = "";
    const client = new GoogleAiStudioStreamingClient({
      apiKey: "k",
      thinkingBudget: 256,
      fetchImpl: async (_url, init) => {
        seenBody = String(init.body ?? "");
        return makeMockSseResponse([
          sseData({ candidates: [{ content: { parts: [{ text: "x" }] } }] }),
        ]);
      },
    });
    await collect(
      client.stream({ model: "gemini-2.5-flash", systemPrompt: "s", userMessage: "u" })
    );
    const body = JSON.parse(seenBody) as {
      generationConfig?: { thinkingConfig?: { thinkingBudget?: number } };
    };
    expect(body.generationConfig?.thinkingConfig?.thinkingBudget).toBe(256);
  });

  it("omits thinkingConfig when thinkingBudget=null is passed (legacy mode)", async () => {
    let seenBody = "";
    const client = new GoogleAiStudioStreamingClient({
      apiKey: "k",
      thinkingBudget: null,
      fetchImpl: async (_url, init) => {
        seenBody = String(init.body ?? "");
        return makeMockSseResponse([
          sseData({ candidates: [{ content: { parts: [{ text: "x" }] } }] }),
        ]);
      },
    });
    await collect(
      client.stream({ model: "gemini-2.5-flash-lite", systemPrompt: "s", userMessage: "u" })
    );
    expect(seenBody).not.toContain("thinkingConfig");
  });

  it("throws StreamingTextError on non-2xx", async () => {
    const client = new GoogleAiStudioStreamingClient({
      apiKey: "k",
      fetchImpl: async () =>
        new Response("nope", {
          status: 400,
          headers: { "content-type": "text/plain" },
        }),
    });
    await expect(
      collect(client.stream({ model: "m", systemPrompt: "s", userMessage: "u" }))
    ).rejects.toBeInstanceOf(StreamingTextError);
  });
});
