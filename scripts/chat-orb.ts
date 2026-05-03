/**
 * Interactive multi-turn chat against a Stage 3 LLM × TTS combo.
 *
 * Picks any registered LLM model (`packages/scenario-engine/src/llmLatencyMatrix/modelMatrix.ts`)
 * and any TTS provider (`packages/vendors/src/tts/`), runs a readline loop,
 * streams the LLM with conversation history, synthesizes audio per turn,
 * saves the WAV under `data/generated/chat-orb-sessions/<sessionId>/`,
 * and prints absolute paths so the user can play them in the OS file viewer.
 *
 * Usage:
 *   pnpm chat:orb -- --llm openai:gpt-4.1-nano --tts cartesia
 *   pnpm chat:orb -- --llm anthropic:claude-haiku-4-5-20251001 --tts fish
 *   pnpm chat:orb -- --llm google:gemini-2.5-flash --tts openai
 *   pnpm chat:orb -- --llm openai:gpt-4.1-nano --no-tts   (text-only)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  AnthropicMessagesStreamingClient,
  CartesiaTtsProvider,
  ElevenLabsBaselineTtsProvider,
  FishTtsProvider,
  GoogleAiStudioStreamingClient,
  GoogleGeminiTtsProvider,
  InworldRouterStreamingClient,
  InworldTtsProvider,
  OpenAiResponsesStreamingClient,
  OpenAiTtsProvider,
  countSentences,
  detectFirstSentence,
  type StreamingTextEvent,
  type StreamingTextHistoryTurn,
  type TtsProvider,
  type TtsProviderId,
  type TtsSynthesisResult,
} from "../packages/vendors/src/index";
import {
  parseModelIds,
} from "../packages/scenario-engine/src/llmLatencyMatrix/modelMatrix";
import type {
  LlmStreamClient,
  LlmStreamRequest,
} from "../packages/scenario-engine/src/llmLatencyMatrix/llmLatencyMatrixBenchmark";
import type { ModelDefinition } from "../packages/scenario-engine/src/llmLatencyMatrix/types";
import { QUALITY_LATENCY_SYSTEM_PROMPT } from "../packages/scenario-engine/src/qualityLatency/systemPrompt";

function getArg(flag: string): string | undefined {
  const idx = process.argv.findIndex((v) => v === flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}
function getBooleanFlag(flag: string): boolean {
  return process.argv.includes(flag);
}
function getNumberArg(flag: string): number | undefined {
  const v = getArg(flag);
  return v !== undefined ? Number(v) : undefined;
}

function readEnvOrThrow(name: string, label: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) throw new Error(`${name} not set (${label})`);
  return v;
}

const TTS_FACTORIES: Record<TtsProviderId, () => TtsProvider> = {
  openai: () => new OpenAiTtsProvider(),
  cartesia: () => new CartesiaTtsProvider(),
  inworld: () => new InworldTtsProvider(),
  fish: () => new FishTtsProvider(),
  google_gemini: () => new GoogleGeminiTtsProvider(),
  elevenlabs_baseline: () => new ElevenLabsBaselineTtsProvider(),
};

function buildLlmClientFor(def: ModelDefinition): LlmStreamClient {
  switch (def.provider) {
    case "openai":
      return new OpenAiResponsesStreamingClient({
        apiKey: readEnvOrThrow("OPENAI_API_KEY", "openai"),
      });
    case "anthropic":
      return new AnthropicMessagesStreamingClient({
        apiKey: readEnvOrThrow("ANTHROPIC_API_KEY", "anthropic"),
      });
    case "google":
      return new GoogleAiStudioStreamingClient({
        apiKey: readEnvOrThrow("GOOGLE_API_KEY", "google"),
      });
    case "inworld":
      return new InworldRouterStreamingClient({
        apiKey: readEnvOrThrow("INWORLD_API_KEY", "inworld"),
      });
    case "zai":
      throw new Error("zai is intentionally not wired (deferred per ops decision).");
    default: {
      const _exhaustive: never = def.provider;
      throw new Error(`Unknown provider: ${_exhaustive as string}`);
    }
  }
}

function fileExtensionForFormat(format: string): string {
  if (format === "wav" || format === "pcm_s16le") return "wav";
  if (format === "mp3") return "mp3";
  if (format === "ogg_opus") return "ogg";
  return "bin";
}

function defaultTtsModelFor(provider: TtsProviderId): string {
  switch (provider) {
    case "openai":
      return process.env["OPENAI_TTS_MODEL"] ?? "gpt-4o-mini-tts";
    case "cartesia":
      return process.env["CARTESIA_TTS_MODEL"] ?? "sonic-3";
    case "inworld":
      return process.env["INWORLD_TTS_MODEL"] ?? "inworld-tts-1.5-mini";
    case "fish":
      return process.env["FISH_TTS_MODEL"] ?? "s2-pro";
    case "google_gemini":
      return process.env["GOOGLE_TTS_MODEL"] ?? "gemini-2.5-flash-preview-tts";
    case "elevenlabs_baseline":
      return process.env["DEFAULT_ELEVEN_MODEL"] ?? "eleven_v3";
    default: {
      const _exhaustive: never = provider;
      return _exhaustive as string;
    }
  }
}

async function streamLlmWithHistory(args: {
  client: LlmStreamClient;
  request: LlmStreamRequest;
  onDelta: (text: string) => void;
}): Promise<{
  responseText: string;
  firstSentenceText: string;
  llmRequestToFirstTokenMs: number | null;
  llmRequestToFirstSentenceMs: number | null;
  llmRequestToDoneMs: number | null;
  llmOutputChars: number;
  llmOutputSentences: number;
}> {
  const startedAt = Date.now();
  let firstTokenAt: number | null = null;
  let firstSentenceAt: number | null = null;
  let firstSentenceText = "";
  let accumulated = "";

  for await (const event of args.client.stream(args.request)) {
    if (event.kind === "delta") {
      const now = Date.now();
      if (firstTokenAt === null) firstTokenAt = now;
      accumulated += event.text;
      args.onDelta(event.text);
      if (firstSentenceAt === null) {
        const match = detectFirstSentence(accumulated);
        if (match) {
          firstSentenceAt = now;
          firstSentenceText = match.text;
        }
      }
    } else if (event.kind === "done") {
      const now = Date.now();
      const finalText = event.fullText.length > 0 ? event.fullText : accumulated;
      if (firstSentenceAt === null) {
        const match = detectFirstSentence(finalText);
        if (match) {
          firstSentenceAt = now;
          firstSentenceText = match.text;
        } else {
          firstSentenceText = finalText;
          firstSentenceAt = now;
        }
      }
      return {
        responseText: finalText,
        firstSentenceText,
        llmRequestToFirstTokenMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
        llmRequestToFirstSentenceMs:
          firstSentenceAt === null ? null : firstSentenceAt - startedAt,
        llmRequestToDoneMs: now - startedAt,
        llmOutputChars: finalText.length,
        llmOutputSentences: countSentences(finalText),
      };
    }
  }

  const now = Date.now();
  return {
    responseText: accumulated,
    firstSentenceText: firstSentenceText.length > 0 ? firstSentenceText : accumulated,
    llmRequestToFirstTokenMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
    llmRequestToFirstSentenceMs:
      firstSentenceAt === null ? null : firstSentenceAt - startedAt,
    llmRequestToDoneMs: now - startedAt,
    llmOutputChars: accumulated.length,
    llmOutputSentences: countSentences(accumulated),
  };
}

function fmtMs(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}ms`;
}

async function main() {
  const llmId = getArg("--llm") ?? "openai:gpt-4.1-nano";
  const ttsArg = getArg("--tts");
  const noTts = getBooleanFlag("--no-tts");
  const temperature = getNumberArg("--temperature") ?? 0.4;
  const maxOutputTokens = getNumberArg("--max-output-tokens") ?? 280;
  const customSystemPrompt = getArg("--system-prompt");

  const [def] = parseModelIds(llmId);
  if (!def) throw new Error(`Unknown model id: ${llmId}`);

  const ttsProviderId = noTts ? null : (ttsArg as TtsProviderId | undefined) ?? "cartesia";
  if (ttsProviderId && !TTS_FACTORIES[ttsProviderId]) {
    throw new Error(
      `Unknown tts provider: ${ttsProviderId} (valid: ${Object.keys(TTS_FACTORIES).join(", ")})`
    );
  }

  console.info("=========================================");
  console.info(" AI Roleplay Orb — interactive chat");
  console.info("=========================================");
  console.info(`LLM:     ${def.id} (${def.category})`);
  if (def.defaultReasoningEffort) {
    console.info(`         reasoning effort = ${def.defaultReasoningEffort}`);
  }
  if (ttsProviderId) {
    console.info(`TTS:     ${ttsProviderId} (${defaultTtsModelFor(ttsProviderId)})`);
  } else {
    console.info(`TTS:     (disabled — text only)`);
  }
  console.info(`temperature: ${def.category === "reasoning" ? "(omitted, gpt-5 family rejects custom temp)" : temperature}`);
  console.info(`Type :exit to quit, :reset to clear history.`);
  console.info("");

  const llmClient = buildLlmClientFor(def);
  const ttsProvider = ttsProviderId ? TTS_FACTORIES[ttsProviderId]() : null;

  const sessionId = `chat-${new Date().toISOString().replace(/[:.]/g, "").replace(/-/g, "")}`;
  const sessionDir = resolve(
    process.cwd(),
    "data",
    "generated",
    "chat-orb-sessions",
    sessionId
  );
  await mkdir(sessionDir, { recursive: true });
  const transcriptPath = resolve(sessionDir, "transcript.md");

  const systemPrompt = customSystemPrompt ?? QUALITY_LATENCY_SYSTEM_PROMPT;
  const history: StreamingTextHistoryTurn[] = [];
  let turnIndex = 0;

  await writeFile(
    transcriptPath,
    `# Chat session ${sessionId}\n\n- LLM: ${def.id}\n- TTS: ${ttsProviderId ?? "(none)"}\n- system prompt:\n\n\`\`\`\n${systemPrompt}\n\`\`\`\n\n---\n\n`,
    "utf8"
  );

  const rl = createInterface({ input: stdin, output: stdout });

  while (true) {
    let userInput: string;
    try {
      userInput = (await rl.question("\nYou> ")).trim();
    } catch {
      break;
    }
    if (userInput.length === 0) continue;
    if (userInput === ":exit" || userInput === ":quit") break;
    if (userInput === ":reset") {
      history.length = 0;
      console.info("[history cleared]");
      continue;
    }

    turnIndex += 1;
    const sendTemperature = def.category !== "reasoning";
    const request: LlmStreamRequest = {
      model: def.model,
      systemPrompt,
      userMessage: userInput,
      history: [...history],
      maxOutputTokens,
      ...(sendTemperature ? { temperature } : {}),
      ...(def.defaultReasoningEffort
        ? { reasoningEffort: def.defaultReasoningEffort }
        : {}),
    };

    process.stdout.write("AI > ");
    let outcome: Awaited<ReturnType<typeof streamLlmWithHistory>>;
    try {
      outcome = await streamLlmWithHistory({
        client: llmClient,
        request,
        onDelta: (text) => process.stdout.write(text),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`\n[LLM ERROR] ${message}\n`);
      continue;
    }
    process.stdout.write("\n");

    history.push({ role: "user", text: userInput });
    history.push({ role: "assistant", text: outcome.responseText });

    let ttsResult: TtsSynthesisResult | null = null;
    let audioPath = "";
    if (ttsProvider) {
      try {
        ttsResult = await ttsProvider.synthesize({
          provider: ttsProviderId!,
          model: defaultTtsModelFor(ttsProviderId!),
          text: outcome.responseText,
          language: "ja",
          outputFormat: "pcm_s16le",
          sampleRateHz: 24_000,
          timeoutMs: 30_000,
        });
        if (ttsResult.success && ttsResult.audio) {
          const ext = fileExtensionForFormat(ttsResult.format);
          const fileName = `turn-${String(turnIndex).padStart(3, "0")}.${ext}`;
          audioPath = resolve(sessionDir, fileName);
          await writeFile(audioPath, ttsResult.audio);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[TTS ERROR] ${message}`);
      }
    }

    const ttsFirst = ttsResult?.requestToFirstAudioMs ?? null;
    const ttsDone = ttsResult?.requestToLastAudioMs ?? null;
    const e2eFirst =
      outcome.llmRequestToDoneMs !== null && ttsFirst !== null
        ? outcome.llmRequestToDoneMs + ttsFirst
        : null;
    const e2eDone =
      outcome.llmRequestToDoneMs !== null && ttsDone !== null
        ? outcome.llmRequestToDoneMs + ttsDone
        : null;

    console.info(
      `\n[t${turnIndex}] LLM: 1st-token ${fmtMs(outcome.llmRequestToFirstTokenMs)} / 1st-sent ${fmtMs(outcome.llmRequestToFirstSentenceMs)} / done ${fmtMs(outcome.llmRequestToDoneMs)} (${outcome.llmOutputChars} chars, ${outcome.llmOutputSentences} sent)`
    );
    if (ttsResult) {
      console.info(
        `[t${turnIndex}] TTS: 1st-audio ${fmtMs(ttsFirst)} / done ${fmtMs(ttsDone)} (${ttsResult.bytes} bytes)`
      );
      console.info(
        `[t${turnIndex}] E2E: full-text 1st-audio ${fmtMs(e2eFirst)} / done ${fmtMs(e2eDone)}`
      );
      if (audioPath) {
        console.info(`[t${turnIndex}] audio saved: ${audioPath}`);
      }
    }

    await writeFile(
      transcriptPath,
      `## Turn ${turnIndex}\n\n**You:** ${userInput}\n\n**AI (${def.id}):** ${outcome.responseText}\n\n` +
        `- LLM: 1st-token ${fmtMs(outcome.llmRequestToFirstTokenMs)} / 1st-sent ${fmtMs(outcome.llmRequestToFirstSentenceMs)} / done ${fmtMs(outcome.llmRequestToDoneMs)}\n` +
        (ttsResult
          ? `- TTS (${ttsProviderId}): 1st-audio ${fmtMs(ttsFirst)} / done ${fmtMs(ttsDone)}\n- audio: ${audioPath}\n`
          : "") +
        `\n---\n\n`,
      { flag: "a" }
    );
  }

  rl.close();
  console.info(`\nSession transcript: ${transcriptPath}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
