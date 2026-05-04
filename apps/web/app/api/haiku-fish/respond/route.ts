import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { detectFirstSentence } from "@top-performer/vendors";
import {
  hasDemoApiAccess,
  validateSameOrigin,
} from "@/lib/roleplay/auth";
import {
  assertHaikuFishEnvForProduction,
  isHaikuFishRoleplayEnabled,
} from "@/lib/roleplay/server-env";
import { loadHaikuFishScenarioBundle } from "@/server/haikuFish/scenarioLoader";
import {
  buildHaikuFishPromptManifest,
  buildHaikuFishSystemPrompt,
} from "@/server/haikuFish/promptBuilder";
import {
  streamHaikuFishLlm,
  type HaikuFishTurn,
} from "@/server/haikuFish/claudeStreaming";
import { synthesizeHaikuFishAudio } from "@/server/haikuFish/fishTts";
import {
  buildEmptyTurnMetrics,
  logHaikuFishTurnMetrics,
  type HaikuFishTurnMetrics,
} from "@/server/haikuFish/metrics";

const SAFE_ERROR =
  "応答生成に失敗しました。時間をおいて再試行してください。";

const requestSchema = z.object({
  sessionId: z.string().min(1).max(128),
  inputMode: z.literal("text"),
  messages: z
    .array(
      z.object({
        role: z.enum(["agent", "user"]),
        text: z.string().min(1).max(8_000),
      })
    )
    .min(1)
    .max(60),
});

export async function POST(request: NextRequest) {
  if (!isHaikuFishRoleplayEnabled()) {
    return safeError(503);
  }
  try {
    assertHaikuFishEnvForProduction();
  } catch {
    return safeError(503);
  }

  if (!validateSameOrigin(request)) {
    return safeError(403);
  }
  if (!hasDemoApiAccess(request)) {
    return safeError(401);
  }

  // /respond is per-turn and naturally throttled by user speech cadence; the
  // session bootstrap lane (/session) carries the rate limiter.

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return safeError(400);
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return safeError(400);
  }

  const last = parsed.data.messages[parsed.data.messages.length - 1];
  if (!last || last.role !== "user") {
    return safeError(400);
  }

  let bundle;
  try {
    bundle = await loadHaikuFishScenarioBundle();
  } catch (error) {
    console.error("haikuFish respond bundle load failed", sanitizeServerError(error));
    return safeError(502);
  }

  const systemPrompt = buildHaikuFishSystemPrompt(bundle);
  const messages: HaikuFishTurn[] = parsed.data.messages.map((m) => ({
    role: m.role,
    text: m.text,
  }));

  const turnIndex = parsed.data.messages.filter((m) => m.role === "user").length - 1;
  const metrics = buildEmptyTurnMetrics({
    sessionId: parsed.data.sessionId,
    turnIndex,
    inputMode: "text",
    userTextLength: last.text.length,
  });
  metrics.provenance = buildHaikuFishPromptManifest(bundle);

  const stream = buildSseStream({
    metrics,
    systemPrompt,
    messages,
    now: () => Date.now(),
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

export function GET() {
  return safeError(405, { Allow: "POST" });
}

type BuildStreamArgs = {
  metrics: HaikuFishTurnMetrics;
  systemPrompt: string;
  messages: HaikuFishTurn[];
  now: () => number;
};

function buildSseStream(args: BuildStreamArgs): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      const startedAt = args.now();
      const metrics = args.metrics;
      let firstAudioAt: number | null = null;
      let firstTokenAt: number | null = null;
      let firstSentenceAt: number | null = null;
      let llmDoneAt: number | null = null;
      let ttsLastAt: number | null = null;
      let accumulated = "";
      let firstSentenceEmitted = false;

      // Sentences pending TTS. Worker drains in order so audio chunks arrive sequentially.
      const ttsQueue: string[] = [];
      let ttsDone = false;
      let ttsWorker: Promise<void> = Promise.resolve();

      function startTtsWorker() {
        ttsWorker = ttsWorker.then(async () => {
          while (true) {
            const sentence = ttsQueue.shift();
            if (sentence === undefined) {
              if (ttsDone) {
                return;
              }
              await delay(15);
              continue;
            }
            try {
              const { result } = await synthesizeHaikuFishAudio({
                text: sentence,
              });
              const at = args.now();
              if (firstAudioAt === null) {
                firstAudioAt = at;
                metrics.ttsFirstAudioMs = at - startedAt;
                metrics.e2eFirstAudioMs = at - startedAt;
              }
              ttsLastAt = at;
              if (result.success && result.audio) {
                metrics.audioBytes += result.audio.length;
                send("audio_chunk", {
                  format: result.format,
                  sampleRateHz: result.sampleRateHz,
                  base64: result.audio.toString("base64"),
                });
              } else {
                send("error", {
                  scope: "tts",
                  code: result.errorCode ?? "TTS_FAILED",
                });
              }
            } catch (error) {
              send("error", {
                scope: "tts",
                code: "TTS_THREW",
                message: errorMessage(error),
              });
            }
          }
        });
      }

      try {
        send("status", { status: "thinking" });
        startTtsWorker();

        for await (const evt of streamHaikuFishLlm({
          systemPrompt: args.systemPrompt,
          messages: args.messages,
        })) {
          if (evt.kind === "delta") {
            const at = args.now();
            if (firstTokenAt === null) {
              firstTokenAt = at;
              metrics.llmFirstTokenMs = at - startedAt;
            }
            accumulated += evt.text;
            send("agent_text_delta", { text: evt.text });

            if (!firstSentenceEmitted) {
              const match = detectFirstSentence(accumulated);
              if (match) {
                firstSentenceAt = at;
                metrics.llmFirstSentenceMs = at - startedAt;
                firstSentenceEmitted = true;
                send("agent_first_sentence", { text: match.text });
                ttsQueue.push(match.text);
              }
            }
          } else if (evt.kind === "done") {
            const at = args.now();
            llmDoneAt = at;
            metrics.llmDoneMs = at - startedAt;
            const finalText = evt.fullText.length > 0 ? evt.fullText : accumulated;
            metrics.responseText = finalText;
            // If no sentence was ever detected (very short response), TTS the whole thing.
            if (!firstSentenceEmitted && finalText.trim().length > 0) {
              ttsQueue.push(finalText.trim());
            } else if (firstSentenceEmitted && finalText.length > accumulated.length) {
              // Carry over any tail the segmenter did not emit.
              const tail = finalText.slice(accumulated.length).trim();
              if (tail.length > 0) ttsQueue.push(tail);
            } else if (firstSentenceEmitted) {
              // Push remaining sentences from accumulated text.
              // The segmenter emitted only the *first* sentence; queue the rest.
              const remaining = remainderAfterFirst(accumulated);
              if (remaining.trim().length > 0) ttsQueue.push(remaining.trim());
            }
            send("agent_text_final", { text: finalText });
          }
        }
      } catch (error) {
        send("error", { scope: "llm", code: "LLM_THREW", message: errorMessage(error) });
        metrics.error = errorMessage(error);
      }

      ttsDone = true;
      try {
        await ttsWorker;
      } catch {
        // worker logs its own errors via send()
      }

      const doneAt = args.now();
      if (ttsLastAt !== null) {
        metrics.ttsDoneMs = ttsLastAt - startedAt;
      }
      metrics.e2eDoneMs = doneAt - startedAt;

      send("metrics", metrics);
      logHaikuFishTurnMetrics(metrics);
      send("done", {});
      controller.close();

      // Acknowledge intentionally-unused locals for tooling.
      void firstSentenceAt;
      void llmDoneAt;
    },
  });
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function remainderAfterFirst(text: string): string {
  const match = detectFirstSentence(text);
  if (!match) return "";
  return text.slice(match.endIndex);
}

function safeError(status: number, headers?: HeadersInit) {
  return NextResponse.json(
    { error: SAFE_ERROR },
    headers ? { status, headers } : { status }
  );
}

function sanitizeServerError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "UnknownError" };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
