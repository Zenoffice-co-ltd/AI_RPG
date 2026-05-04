import {
  parseJsonOrNull,
  readSseEvents,
  StreamingTextError,
  type StreamingTextEvent,
} from "@top-performer/vendors";
import { getHaikuFishServerEnv } from "@/lib/roleplay/server-env";

const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 60_000;

export type HaikuFishTurn = { role: "agent" | "user"; text: string };

export type HaikuFishLlmStreamInput = {
  systemPrompt: string;
  messages: readonly HaikuFishTurn[];
};

export type HaikuFishLlmDeps = {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  getModel?: () => { model: string; maxTokens: number; temperature: number };
};

function defaultDeps(): {
  fetchImpl: typeof fetch;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
} {
  const env = getHaikuFishServerEnv();
  return {
    fetchImpl: fetch,
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.HAIKU_FISH_LLM_MODEL,
    maxTokens: env.HAIKU_FISH_LLM_MAX_TOKENS,
    temperature: env.HAIKU_FISH_LLM_TEMPERATURE,
  };
}

export async function* streamHaikuFishLlm(
  input: HaikuFishLlmStreamInput,
  deps: HaikuFishLlmDeps = {}
): AsyncIterable<StreamingTextEvent> {
  const env = deps.getModel ? deps.getModel() : null;
  const defaults = env ? null : defaultDeps();
  const fetchImpl = deps.fetchImpl ?? defaults?.fetchImpl ?? fetch;
  const apiKey = deps.apiKey ?? defaults?.apiKey;
  const model = env?.model ?? defaults?.model;
  const maxTokens = env?.maxTokens ?? defaults?.maxTokens ?? 220;
  const temperature = env?.temperature ?? defaults?.temperature ?? 0.2;

  if (!apiKey) {
    throw new Error("Haiku-Fish LLM stream: ANTHROPIC_API_KEY is not configured.");
  }
  if (!model) {
    throw new Error("Haiku-Fish LLM stream: model not configured.");
  }

  // Anthropic Messages API requires the conversation to end with a user turn,
  // so we collapse the history straight from the caller's transcript order.
  const turns = input.messages.filter((t) => t.text.length > 0);
  if (turns.length === 0 || turns[turns.length - 1]!.role !== "user") {
    throw new Error("Haiku-Fish LLM stream: messages must end with a user turn.");
  }
  const messages = turns.map((turn) => ({
    role: turn.role === "agent" ? "assistant" : "user",
    content: [{ type: "text", text: turn.text }],
  }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(`${ANTHROPIC_BASE_URL}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        model,
        stream: true,
        max_tokens: maxTokens,
        temperature,
        system: input.systemPrompt,
        messages,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }

  const vendorRequestId =
    response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? null;

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    clearTimeout(timeout);
    const snippet = text.length > 0 ? ` body=${text.slice(0, 240)}` : "";
    throw new StreamingTextError(
      `Anthropic streaming request failed: HTTP ${response.status}${snippet}`,
      response.status,
      vendorRequestId,
      text
    );
  }

  let fullText = "";
  let messageId = "";
  let doneEmitted = false;

  try {
    for await (const evt of readSseEvents(response.body)) {
      if (evt.event === "error") {
        const data = parseJsonOrNull(evt.data);
        throw new StreamingTextError(
          "Anthropic streaming error event",
          null,
          vendorRequestId,
          data ?? evt.data
        );
      }
      if (evt.event === "message_start") {
        const data = parseJsonOrNull(evt.data) as { message?: { id?: string } } | null;
        if (data?.message?.id && typeof data.message.id === "string") {
          messageId = data.message.id;
        }
        continue;
      }
      if (evt.event === "content_block_delta") {
        const data = parseJsonOrNull(evt.data) as
          | { delta?: { type?: string; text?: string } }
          | null;
        const delta = data?.delta;
        if (
          delta?.type === "text_delta" &&
          typeof delta.text === "string" &&
          delta.text.length > 0
        ) {
          fullText += delta.text;
          yield { kind: "delta", text: delta.text };
        }
        continue;
      }
      if (evt.event === "message_stop") {
        doneEmitted = true;
        yield { kind: "done", fullText, responseId: messageId };
        return;
      }
    }
    if (!doneEmitted) {
      yield { kind: "done", fullText, responseId: messageId };
    }
  } finally {
    clearTimeout(timeout);
  }
}
