/**
 * Local-only HTTP server that powers the browser-based Stage 3 verification UI.
 *
 * - Serves `chat-orb.html` at `/`.
 * - `GET /api/models` lists registered LLM × TTS combos.
 * - `POST /api/chat` streams a multi-turn turn (newline-delimited JSON):
 *     {"kind":"delta","text":"..."}            // LLM tokens as they arrive
 *     {"kind":"llm_done","metrics":{...},"responseText":"..."}
 *     {"kind":"tts_done","audioUrl":"...","metrics":{...},"e2e":{...}}
 *     {"kind":"done"}
 * - `GET /audio/<sessionId>/<turn>.wav` serves saved WAV files.
 *
 * No live runtime traffic. ElevenLabs ConvAI lane is intentionally NOT exposed —
 * that path requires the workspace webhook detach handled by
 * `pnpm benchmark:quality-latency -- --elevenlabs-agent --create-temp-agent`.
 *
 * Usage:
 *   .\scripts\chat-orb-web.ps1                  # loads zapier-transfer secrets and starts the server
 *   pnpm chat:orb:web                           # if env is already exported
 */

import { createReadStream, existsSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server as HttpServer,
} from "node:http";
import type { Socket } from "node:net";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket as WsClient } from "ws";
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
  type StreamingTextHistoryTurn,
  type TtsProvider,
  type TtsProviderId,
  type TtsSynthesisResult,
} from "../packages/vendors/src/index";
import { MODEL_REGISTRY } from "../packages/scenario-engine/src/llmLatencyMatrix/modelMatrix";
import type {
  LlmStreamClient,
  LlmStreamRequest,
} from "../packages/scenario-engine/src/llmLatencyMatrix/llmLatencyMatrixBenchmark";
import type { ModelDefinition } from "../packages/scenario-engine/src/llmLatencyMatrix/types";
import { QUALITY_LATENCY_SYSTEM_PROMPT } from "../packages/scenario-engine/src/qualityLatency/systemPrompt";

const HOST = "127.0.0.1";
const PORT = Number(process.env["CHAT_ORB_PORT"] ?? "3030");
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HTML_PATH = resolve(__dirname, "chat-orb.html");
const SESSIONS_ROOT = resolve(
  process.cwd(),
  "data",
  "generated",
  "chat-orb-sessions"
);

const TTS_FACTORIES: Record<TtsProviderId, () => TtsProvider> = {
  openai: () => new OpenAiTtsProvider(),
  cartesia: () => new CartesiaTtsProvider(),
  inworld: () => new InworldTtsProvider(),
  fish: () => new FishTtsProvider(),
  google_gemini: () => new GoogleGeminiTtsProvider(),
  elevenlabs_baseline: () => new ElevenLabsBaselineTtsProvider(),
};

function readEnvOrThrow(name: string, label: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) throw new Error(`${name} not set (${label})`);
  return v;
}

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
      throw new Error("zai is intentionally not wired.");
    default: {
      const _exhaustive: never = def.provider;
      throw new Error(`Unknown provider: ${_exhaustive as string}`);
    }
  }
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

function fileExtensionForFormat(format: string): string {
  if (format === "wav" || format === "pcm_s16le") return "wav";
  if (format === "mp3") return "mp3";
  if (format === "ogg_opus") return "ogg";
  return "bin";
}

function pcmS16LeToWav(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcm.byteLength;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcm.copy(buffer, 44);
  return buffer;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

async function handleModelsRoute(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const models = Object.values(MODEL_REGISTRY).map((def) => ({
    id: def.id,
    provider: def.provider,
    model: def.model,
    category: def.category,
    defaultReasoningEffort: def.defaultReasoningEffort ?? null,
    notes: def.notes ?? null,
  }));
  const ttsProviders = Object.keys(TTS_FACTORIES);
  sendJson(res, 200, {
    models,
    ttsProviders,
    defaultLlm: "anthropic:claude-haiku-4-5-20251001",
    defaultTts: "fish",
    systemPrompt: QUALITY_LATENCY_SYSTEM_PROMPT,
  });
}

async function handleChatRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  let payload: {
    llmId?: string;
    ttsProvider?: string | null;
    history?: StreamingTextHistoryTurn[];
    userMessage?: string;
    sessionId?: string;
    turnIndex?: number;
    systemPrompt?: string;
    temperature?: number;
    maxOutputTokens?: number;
  };
  try {
    payload = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: "invalid JSON body" });
    return;
  }

  const llmId = payload.llmId ?? "anthropic:claude-haiku-4-5-20251001";
  const def = MODEL_REGISTRY[llmId];
  if (!def) {
    sendJson(res, 400, { error: `unknown llm id: ${llmId}` });
    return;
  }
  const ttsProvider = payload.ttsProvider ?? null;
  if (
    ttsProvider !== null &&
    !Object.prototype.hasOwnProperty.call(TTS_FACTORIES, ttsProvider)
  ) {
    sendJson(res, 400, { error: `unknown tts provider: ${ttsProvider}` });
    return;
  }
  const userMessage = (payload.userMessage ?? "").trim();
  if (userMessage.length === 0) {
    sendJson(res, 400, { error: "userMessage is required" });
    return;
  }
  const history = payload.history ?? [];
  const sessionId = payload.sessionId ?? `chat-${Date.now()}`;
  const turnIndex = payload.turnIndex ?? 1;
  const systemPrompt = payload.systemPrompt ?? QUALITY_LATENCY_SYSTEM_PROMPT;
  const temperature = payload.temperature ?? 0.4;
  const maxOutputTokens = payload.maxOutputTokens ?? 280;

  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-cache",
    "transfer-encoding": "chunked",
  });

  const writeEvent = (obj: unknown): void => {
    res.write(`${JSON.stringify(obj)}\n`);
  };

  let llmClient: LlmStreamClient;
  try {
    llmClient = buildLlmClientFor(def);
  } catch (error) {
    writeEvent({ kind: "error", scope: "llm-factory", message: (error as Error).message });
    res.end();
    return;
  }

  const sendTemperature = def.category !== "reasoning";
  const request: LlmStreamRequest = {
    model: def.model,
    systemPrompt,
    userMessage,
    history,
    maxOutputTokens,
    ...(sendTemperature ? { temperature } : {}),
    ...(def.defaultReasoningEffort
      ? { reasoningEffort: def.defaultReasoningEffort }
      : {}),
  };

  const startedAt = Date.now();
  let firstTokenAt: number | null = null;
  let firstSentenceAt: number | null = null;
  let firstSentenceText = "";
  let accumulated = "";

  try {
    for await (const event of llmClient.stream(request)) {
      if (event.kind === "delta") {
        const now = Date.now();
        if (firstTokenAt === null) firstTokenAt = now;
        accumulated += event.text;
        writeEvent({ kind: "delta", text: event.text });
        if (firstSentenceAt === null) {
          const match = detectFirstSentence(accumulated);
          if (match) {
            firstSentenceAt = now;
            firstSentenceText = match.text;
          }
        }
      } else if (event.kind === "done") {
        const finalText = event.fullText.length > 0 ? event.fullText : accumulated;
        const doneAt = Date.now();
        if (firstSentenceAt === null) {
          const match = detectFirstSentence(finalText);
          if (match) {
            firstSentenceAt = doneAt;
            firstSentenceText = match.text;
          } else {
            firstSentenceText = finalText;
            firstSentenceAt = doneAt;
          }
        }
        const llmRequestToFirstTokenMs =
          firstTokenAt === null ? null : firstTokenAt - startedAt;
        const llmRequestToFirstSentenceMs =
          firstSentenceAt === null ? null : firstSentenceAt - startedAt;
        const llmRequestToDoneMs = doneAt - startedAt;
        writeEvent({
          kind: "llm_done",
          responseText: finalText,
          firstSentenceText,
          metrics: {
            llmRequestToFirstTokenMs,
            llmRequestToFirstSentenceMs,
            llmRequestToDoneMs,
            outputChars: finalText.length,
            outputSentences: countSentences(finalText),
          },
        });

        if (ttsProvider) {
          await synthesizeAndEmit({
            ttsProvider: ttsProvider as TtsProviderId,
            text: finalText,
            sessionId,
            turnIndex,
            llmRequestToDoneMs,
            writeEvent,
          });
        }
        writeEvent({ kind: "done" });
        res.end();
        return;
      }
    }
  } catch (error) {
    writeEvent({ kind: "error", scope: "llm-stream", message: (error as Error).message });
    res.end();
  }
}

async function synthesizeAndEmit(args: {
  ttsProvider: TtsProviderId;
  text: string;
  sessionId: string;
  turnIndex: number;
  llmRequestToDoneMs: number;
  writeEvent: (obj: unknown) => void;
}): Promise<void> {
  const factory = TTS_FACTORIES[args.ttsProvider];
  if (!factory) {
    args.writeEvent({
      kind: "error",
      scope: "tts-factory",
      message: `no factory for ${args.ttsProvider}`,
    });
    return;
  }
  const provider = factory();
  const ttsModel = defaultTtsModelFor(args.ttsProvider);
  let result: TtsSynthesisResult;
  try {
    result = await provider.synthesize({
      provider: args.ttsProvider,
      model: ttsModel,
      text: args.text,
      language: "ja",
      outputFormat: "pcm_s16le",
      sampleRateHz: 24_000,
      timeoutMs: 30_000,
    });
  } catch (error) {
    args.writeEvent({
      kind: "error",
      scope: "tts-synthesize",
      message: (error as Error).message,
    });
    return;
  }
  if (!result.success || !result.audio) {
    args.writeEvent({
      kind: "error",
      scope: "tts-result",
      message: result.errorMessage ?? "tts synthesis failed",
    });
    return;
  }

  const sessionDir = resolve(SESSIONS_ROOT, args.sessionId);
  await mkdir(sessionDir, { recursive: true });
  const ext = fileExtensionForFormat(result.format);
  const turnLabel = String(args.turnIndex).padStart(3, "0");
  const fileName = `turn-${turnLabel}.${ext}`;
  const filePath = resolve(sessionDir, fileName);

  // Browsers cannot decode raw pcm_s16le. Wrap as WAV before writing.
  const audioBuffer =
    result.format === "pcm_s16le"
      ? pcmS16LeToWav(result.audio, result.sampleRateHz || 24_000)
      : result.audio;
  await writeFile(filePath, audioBuffer);

  const ttsFirst = result.requestToFirstAudioMs;
  const ttsDone = result.requestToLastAudioMs;
  const e2eFirst =
    ttsFirst !== null ? args.llmRequestToDoneMs + ttsFirst : null;
  const e2eDone = ttsDone !== null ? args.llmRequestToDoneMs + ttsDone : null;

  args.writeEvent({
    kind: "tts_done",
    audioUrl: `/audio/${args.sessionId}/${fileName}`,
    audioPath: filePath,
    metrics: {
      ttsRequestToFirstAudioMs: ttsFirst,
      ttsRequestToDoneMs: ttsDone,
      audioDurationMs: result.audioDurationMs,
      rtf: result.rtf,
      bytes: audioBuffer.byteLength,
      format: result.format === "pcm_s16le" ? "wav" : result.format,
      provider: args.ttsProvider,
      model: ttsModel,
      voiceId: result.voiceId ?? "",
    },
    e2e: {
      e2eFirstAudioMs: e2eFirst,
      e2eDoneMs: e2eDone,
    },
  });
}

function handleAudioRoute(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "", `http://${HOST}`);
  // Path: /audio/<sessionId>/<fileName>
  const match = url.pathname.match(/^\/audio\/([^/]+)\/([^/]+)$/);
  if (!match) {
    res.writeHead(400);
    res.end();
    return;
  }
  const [, sessionId, fileName] = match;
  if (!sessionId || !fileName || sessionId.includes("..") || fileName.includes("..")) {
    res.writeHead(400);
    res.end();
    return;
  }
  const filePath = resolve(SESSIONS_ROOT, sessionId, fileName);
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const contentType = fileName.endsWith(".mp3")
    ? "audio/mpeg"
    : fileName.endsWith(".ogg")
      ? "audio/ogg"
      : "audio/wav";
  res.writeHead(200, { "content-type": contentType });
  createReadStream(filePath).pipe(res);
}

function handleHtmlRoute(_req: IncomingMessage, res: ServerResponse): void {
  if (!existsSync(HTML_PATH)) {
    res.writeHead(500);
    res.end(`chat-orb.html not found at ${HTML_PATH}`);
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  createReadStream(HTML_PATH).pipe(res);
}

// ---- xAI Grok Voice Realtime proxy (WebSocket /api/voice-realtime) ----

const XAI_REALTIME_BASE = "wss://api.x.ai/v1/realtime";
const DEFAULT_XAI_VOICE_MODEL = "grok-voice-think-fast-1.0";

function pcmS16LeBytesToWav(pcmChunks: Buffer[], sampleRate: number): Buffer {
  const pcm = Buffer.concat(pcmChunks);
  return pcmS16LeToWav(pcm, sampleRate);
}

function attachVoiceRealtimeWs(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(request.url ?? "/", `http://${HOST}`);
    if (url.pathname !== "/api/voice-realtime") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleVoiceRealtimeClient(ws, url).catch((err) => {
        console.error("[voice-realtime]", err);
        try {
          ws.close(1011, err instanceof Error ? err.message : String(err));
        } catch {
          // ignore
        }
      });
    });
  });
}

async function handleVoiceRealtimeClient(
  browserWs: import("ws").WebSocket,
  url: URL
): Promise<void> {
  const sessionId = url.searchParams.get("sessionId") ?? `voice-${Date.now()}`;
  const turnIndex = Number(url.searchParams.get("turnIndex") ?? "1");
  const voice = url.searchParams.get("voice") ?? "ara";
  const instructions =
    url.searchParams.get("systemPrompt") ?? QUALITY_LATENCY_SYSTEM_PROMPT;
  const model = url.searchParams.get("model") ?? DEFAULT_XAI_VOICE_MODEL;

  const apiKey = process.env["XAI_API_KEY"];
  if (!apiKey || apiKey.length === 0) {
    browserWs.send(
      JSON.stringify({
        kind: "error",
        scope: "xai-config",
        message: "XAI_API_KEY not set on server",
      })
    );
    browserWs.close();
    return;
  }

  const sessionDir = resolve(SESSIONS_ROOT, sessionId);
  await mkdir(sessionDir, { recursive: true });
  const userPcmChunks: Buffer[] = [];
  const aiPcmChunks: Buffer[] = [];
  const turnLabel = String(turnIndex).padStart(3, "0");
  const userAudioPath = resolve(sessionDir, `voice-${turnLabel}-user.wav`);
  const aiAudioPath = resolve(sessionDir, `voice-${turnLabel}-ai.wav`);
  const eventLogPath = resolve(sessionDir, `voice-${turnLabel}-events.jsonl`);

  const xaiUrl = `${XAI_REALTIME_BASE}?model=${encodeURIComponent(model)}`;
  const xaiWs = new WsClient(xaiUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  const startedAt = Date.now();
  let voiceEndedAt: number | null = null;
  let firstAiAudioAt: number | null = null;
  let aiAudioDoneAt: number | null = null;
  let firstAiTextAt: number | null = null;
  let aiText = "";
  let userTranscript = "";
  let closed = false;

  const logEvent = async (
    direction: "client>server" | "xai>server" | "server>client" | "server>xai",
    type: string,
    detail?: unknown
  ): Promise<void> => {
    try {
      await appendFile(
        eventLogPath,
        `${JSON.stringify({
          tMs: Date.now() - startedAt,
          direction,
          type,
          detail: detail ?? null,
        })}\n`
      );
    } catch {
      // ignore log errors
    }
  };

  const sendToBrowser = (obj: unknown): void => {
    if (browserWs.readyState === browserWs.OPEN) {
      browserWs.send(JSON.stringify(obj));
    }
  };

  const finalize = async (reason: string): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      if (xaiWs.readyState === xaiWs.OPEN || xaiWs.readyState === xaiWs.CONNECTING) {
        xaiWs.close();
      }
    } catch {
      // ignore
    }
    try {
      if (userPcmChunks.length > 0) {
        await writeFile(userAudioPath, pcmS16LeBytesToWav(userPcmChunks, 24000));
      }
      if (aiPcmChunks.length > 0) {
        await writeFile(aiAudioPath, pcmS16LeBytesToWav(aiPcmChunks, 24000));
      }
    } catch (err) {
      console.warn("[voice-realtime] failed to write audio:", err);
    }
    sendToBrowser({
      kind: "session_done",
      reason,
      metrics: {
        sessionMs: Date.now() - startedAt,
        voiceEndedAtMs: voiceEndedAt,
        firstAiAudioAtMs: firstAiAudioAt,
        aiAudioDoneAtMs: aiAudioDoneAt,
        firstAiTextAtMs: firstAiTextAt,
        userAudioBytes: Buffer.concat(userPcmChunks).byteLength,
        aiAudioBytes: Buffer.concat(aiPcmChunks).byteLength,
      },
      audioUrl: aiPcmChunks.length > 0 ? `/audio/${sessionId}/voice-${turnLabel}-ai.wav` : null,
      userAudioUrl:
        userPcmChunks.length > 0 ? `/audio/${sessionId}/voice-${turnLabel}-user.wav` : null,
      userTranscript,
      aiText,
    });
    try {
      browserWs.close();
    } catch {
      // ignore
    }
  };

  xaiWs.on("open", async () => {
    await logEvent("server>client", "xai_open");
    sendToBrowser({ kind: "xai_open" });

    const sessionUpdate = {
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions,
        voice,
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 600,
          create_response: true,
        },
      },
    };
    xaiWs.send(JSON.stringify(sessionUpdate));
    await logEvent("server>xai", "session.update");
  });

  xaiWs.on("message", async (raw) => {
    let msg: unknown;
    try {
      msg = JSON.parse(raw.toString("utf8"));
    } catch {
      await logEvent("xai>server", "non-json", String(raw).slice(0, 80));
      return;
    }
    const obj = msg as { type?: string };
    const type = obj.type ?? "(no type)";
    await logEvent("xai>server", type);

    sendToBrowser({ kind: "xai_event", event: msg });

    if (type === "response.output_audio.delta" || type === "response.audio.delta") {
      const m = msg as { delta?: string };
      if (typeof m.delta === "string" && m.delta.length > 0) {
        const buf = Buffer.from(m.delta, "base64");
        aiPcmChunks.push(buf);
        if (firstAiAudioAt === null) firstAiAudioAt = Date.now() - startedAt;
      }
    } else if (
      type === "response.output_audio.done" ||
      type === "response.audio.done" ||
      type === "response.done"
    ) {
      if (aiAudioDoneAt === null) aiAudioDoneAt = Date.now() - startedAt;
    } else if (type === "response.audio_transcript.delta") {
      const m = msg as { delta?: string };
      if (typeof m.delta === "string") {
        if (firstAiTextAt === null) firstAiTextAt = Date.now() - startedAt;
        aiText += m.delta;
      }
    } else if (type === "conversation.item.input_audio_transcription.completed") {
      const m = msg as { transcript?: string };
      if (typeof m.transcript === "string") userTranscript = m.transcript;
    } else if (type === "error") {
      const m = msg as { error?: { message?: string } };
      await logEvent("xai>server", "error_payload", m.error);
    }
  });

  xaiWs.on("close", async (code, reason) => {
    await logEvent("xai>server", "close", { code, reason: reason?.toString("utf8") });
    await finalize(`xai_closed:${code}`);
  });

  xaiWs.on("error", async (err) => {
    await logEvent("xai>server", "error", { message: err.message });
    sendToBrowser({ kind: "error", scope: "xai-ws", message: err.message });
    await finalize("xai_error");
  });

  browserWs.on("message", async (raw, isBinary) => {
    if (isBinary) {
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      userPcmChunks.push(buf);
      if (xaiWs.readyState === xaiWs.OPEN) {
        xaiWs.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: buf.toString("base64"),
          })
        );
      }
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const obj = parsed as { type?: string };
    const t = obj.type ?? "";
    await logEvent("client>server", t);
    if (t === "voice_ended") {
      voiceEndedAt = Date.now() - startedAt;
      if (xaiWs.readyState === xaiWs.OPEN) {
        xaiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        xaiWs.send(JSON.stringify({ type: "response.create" }));
      }
    } else if (t === "client_close") {
      await finalize("client_requested");
    }
  });

  browserWs.on("close", async () => {
    await finalize("browser_closed");
  });

  browserWs.on("error", async (err) => {
    await logEvent("client>server", "error", { message: err.message });
    await finalize("browser_error");
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${HOST}`);
    if (req.method === "GET" && url.pathname === "/") {
      handleHtmlRoute(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/models") {
      await handleModelsRoute(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      await handleChatRoute(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/audio/")) {
      handleAudioRoute(req, res);
      return;
    }
    res.writeHead(404);
    res.end("Not Found");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[chat-orb-server]", message);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ error: message }));
  }
});

attachVoiceRealtimeWs(server);

server.listen(PORT, HOST, () => {
  console.info(`Chat Orb test UI: http://${HOST}:${PORT}`);
  console.info(`Sessions dir:     ${SESSIONS_ROOT}`);
  if (process.env["XAI_API_KEY"]) {
    console.info(`Grok Voice lane:  /api/voice-realtime (xAI grok-voice-think-fast-1.0)`);
  } else {
    console.info(`Grok Voice lane:  disabled (XAI_API_KEY not set)`);
  }
  console.info(`Stop with Ctrl+C.`);
});
