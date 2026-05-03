import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  StreamingTextEvent,
  TtsOutputFormat,
  TtsProvider,
  TtsProviderId,
  TtsSynthesisInput,
  TtsSynthesisResult,
} from "@top-performer/vendors";
import { detectFirstSentence, countSentences } from "@top-performer/vendors";
import {
  buildMetricsCsv,
  buildResponseSummaryCsv,
  buildSummaryCsv,
  summarizeRows,
} from "./csvWriters";
import { buildResponseLatencyIndexHtml } from "./indexHtml";
import {
  buildCacheKey,
  buildEntryFromMetrics,
  cacheFilePath,
  readCacheEntry,
  writeCacheEntry,
  type LlmCacheEntry,
  type LlmCacheKeyInput,
} from "./llmCache";
import {
  RESPONSE_LATENCY_SYSTEM_PROMPT,
  responseLatencyCases,
  type ResponseLatencyCase,
} from "./responseCases";
import type {
  LlmProviderId,
  ResponseLatencyMode,
  ResponseLatencyRow,
} from "./types";

export type LlmStreamRequest = {
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxOutputTokens?: number;
  temperature?: number;
  seed?: number;
};

export interface LlmStreamClient {
  stream(input: LlmStreamRequest): AsyncIterable<StreamingTextEvent>;
}

export type ResponseLatencyBenchmarkInput = {
  llmProvider?: LlmProviderId;
  llmModel: string;
  systemPrompt?: string;
  systemPromptVersion?: string;
  cases?: readonly ResponseLatencyCase[];
  ttsProviders: TtsProviderId[];
  modes: ResponseLatencyMode[];
  repeats?: number;
  outputDir?: string;
  outputRoot?: string;
  cacheRoot?: string;
  reuseLlmCache?: boolean;
  refreshLlmCache?: boolean;
  seed?: number;
  temperature?: number;
  maxOutputTokens?: number;
  sampleRateHz?: number;
  outputFormat?: TtsOutputFormat;
  ttsTimeoutMs?: number;
  llmClientFactory: () => LlmStreamClient;
  providerFactories?: Partial<Record<TtsProviderId, () => TtsProvider>>;
};

export type ResponseLatencyBenchmarkResult = {
  runId: string;
  outputDir: string;
  manifestPath: string;
  metricsCsvPath: string;
  summaryCsvPath: string;
  responseSummaryPath: string;
  indexPath: string;
  totalRows: number;
  failures: number;
  llmCallsLive: number;
  llmCallsCached: number;
};

const DEFAULT_OUTPUT_ROOT_RELATIVE = ["data", "generated", "tts-response-latency-benchmark"];

export function defaultResponseLatencyOutputRoot(repoRoot: string): string {
  return resolve(repoRoot, ...DEFAULT_OUTPUT_ROOT_RELATIVE);
}

function createRunId(): string {
  const isoCompact = new Date()
    .toISOString()
    .replace(/[:.]/g, "")
    .replace(/-/g, "");
  return `p5-${isoCompact}`;
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

type LlmRunOutcome = {
  cacheKey: string;
  cacheHit: boolean;
  responseText: string;
  firstSentenceText: string;
  llmRequestToFirstTokenMs: number | null;
  llmRequestToFirstSentenceMs: number | null;
  llmRequestToDoneMs: number | null;
  llmOutputChars: number;
  llmOutputSentences: number;
  errorCode: string;
  errorMessage: string;
};

async function runLlmLive(
  client: LlmStreamClient,
  request: LlmStreamRequest
): Promise<{
  responseText: string;
  firstSentenceText: string;
  llmRequestToFirstTokenMs: number | null;
  llmRequestToFirstSentenceMs: number | null;
  llmRequestToDoneMs: number | null;
}> {
  const startedAt = Date.now();
  let firstTokenAt: number | null = null;
  let firstSentenceAt: number | null = null;
  let firstSentenceText = "";
  let accumulated = "";

  for await (const event of client.stream(request)) {
    if (event.kind === "delta") {
      const now = Date.now();
      if (firstTokenAt === null) firstTokenAt = now;
      accumulated += event.text;
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
      };
    }
  }

  // Stream ended without explicit done.
  const now = Date.now();
  if (firstSentenceText.length === 0 && accumulated.length > 0) {
    firstSentenceText = accumulated;
  }
  return {
    responseText: accumulated,
    firstSentenceText,
    llmRequestToFirstTokenMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
    llmRequestToFirstSentenceMs:
      firstSentenceAt === null ? null : firstSentenceAt - startedAt,
    llmRequestToDoneMs: now - startedAt,
  };
}

async function resolveLlmOutcome(args: {
  caseId: string;
  repeatIndex: number;
  llmProvider: LlmProviderId;
  llmModel: string;
  systemPrompt: string;
  systemPromptVersion: string;
  userInput: string;
  cacheRoot: string;
  reuseLlmCache: boolean;
  refreshLlmCache: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  seed?: number;
  llmClient: LlmStreamClient;
  llmTextDir: string;
}): Promise<LlmRunOutcome> {
  const cacheKeyInput: LlmCacheKeyInput = {
    llmProvider: args.llmProvider,
    llmModel: args.llmModel,
    systemPromptVersion: args.systemPromptVersion,
    systemPrompt: args.systemPrompt,
    caseId: args.caseId,
    userInput: args.userInput,
    repeatIndex: args.repeatIndex,
    ...(args.temperature === undefined ? {} : { temperature: args.temperature }),
    ...(args.maxOutputTokens === undefined ? {} : { maxOutputTokens: args.maxOutputTokens }),
    ...(args.seed === undefined ? {} : { seed: args.seed }),
  };
  const cacheKey = buildCacheKey(cacheKeyInput);
  const filePath = cacheFilePath(args.cacheRoot, args.llmProvider, cacheKey);

  if (args.reuseLlmCache && !args.refreshLlmCache) {
    const cached = await readCacheEntry(filePath);
    if (cached) {
      return cacheEntryToOutcome(cacheKey, cached, true);
    }
  }

  let live: Awaited<ReturnType<typeof runLlmLive>>;
  try {
    live = await runLlmLive(args.llmClient, {
      model: args.llmModel,
      systemPrompt: args.systemPrompt,
      userMessage: args.userInput,
      ...(args.maxOutputTokens === undefined ? {} : { maxOutputTokens: args.maxOutputTokens }),
      ...(args.temperature === undefined ? {} : { temperature: args.temperature }),
      ...(args.seed === undefined ? {} : { seed: args.seed }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      cacheKey,
      cacheHit: false,
      responseText: "",
      firstSentenceText: "",
      llmRequestToFirstTokenMs: null,
      llmRequestToFirstSentenceMs: null,
      llmRequestToDoneMs: null,
      llmOutputChars: 0,
      llmOutputSentences: 0,
      errorCode: "LLM_THROW",
      errorMessage: message,
    };
  }

  const llmOutputChars = live.responseText.length;
  const llmOutputSentences = countSentences(live.responseText);
  const entry = buildEntryFromMetrics({
    cacheKey,
    input: cacheKeyInput,
    responseText: live.responseText,
    firstSentenceText: live.firstSentenceText,
    llmRequestToFirstTokenMs: live.llmRequestToFirstTokenMs,
    llmRequestToFirstSentenceMs: live.llmRequestToFirstSentenceMs,
    llmRequestToDoneMs: live.llmRequestToDoneMs,
    llmOutputChars,
    llmOutputSentences,
  });
  await writeCacheEntry(filePath, entry);
  await mkdir(args.llmTextDir, { recursive: true });
  await writeFile(
    resolve(args.llmTextDir, `${args.caseId}__r${String(args.repeatIndex).padStart(2, "0")}.json`),
    `${JSON.stringify(entry, null, 2)}\n`,
    "utf8"
  );

  return {
    cacheKey,
    cacheHit: false,
    responseText: entry.responseText,
    firstSentenceText: entry.firstSentenceText,
    llmRequestToFirstTokenMs: entry.llmRequestToFirstTokenMs,
    llmRequestToFirstSentenceMs: entry.llmRequestToFirstSentenceMs,
    llmRequestToDoneMs: entry.llmRequestToDoneMs,
    llmOutputChars,
    llmOutputSentences,
    errorCode: "",
    errorMessage: "",
  };
}

function cacheEntryToOutcome(
  cacheKey: string,
  entry: LlmCacheEntry,
  cacheHit: boolean
): LlmRunOutcome {
  return {
    cacheKey,
    cacheHit,
    responseText: entry.responseText,
    firstSentenceText: entry.firstSentenceText,
    llmRequestToFirstTokenMs: entry.llmRequestToFirstTokenMs,
    llmRequestToFirstSentenceMs: entry.llmRequestToFirstSentenceMs,
    llmRequestToDoneMs: entry.llmRequestToDoneMs,
    llmOutputChars: entry.llmOutputChars,
    llmOutputSentences: entry.llmOutputSentences,
    errorCode: "",
    errorMessage: "",
  };
}

async function resolveProvider(
  id: TtsProviderId,
  factories: ResponseLatencyBenchmarkInput["providerFactories"]
): Promise<TtsProvider> {
  const factory = factories?.[id];
  if (factory) return factory();
  const tts = await import("@top-performer/vendors");
  switch (id) {
    case "openai":
      return new tts.OpenAiTtsProvider();
    case "cartesia":
      return new tts.CartesiaTtsProvider();
    case "inworld":
      return new tts.InworldTtsProvider();
    case "fish":
      return new tts.FishTtsProvider();
    case "google_gemini":
      return new tts.GoogleGeminiTtsProvider();
    case "elevenlabs_baseline":
      return new tts.ElevenLabsBaselineTtsProvider();
    default: {
      const _exhaustive: never = id;
      throw new Error(`No factory for provider ${_exhaustive as string}`);
    }
  }
}

function buildLlmOnlyRow(args: {
  runId: string;
  caseDef: ResponseLatencyCase;
  repeatIndex: number;
  llmProvider: LlmProviderId;
  llmModel: string;
  systemPromptVersion: string;
  outcome: LlmRunOutcome;
}): ResponseLatencyRow {
  const ok = args.outcome.errorCode.length === 0;
  return {
    runId: args.runId,
    timestamp: new Date().toISOString(),
    mode: "llm-only",
    llmProvider: args.llmProvider,
    llmModel: args.llmModel,
    systemPromptVersion: args.systemPromptVersion,
    ttsProvider: "",
    ttsModel: "",
    voiceId: "",
    caseId: args.caseDef.id,
    category: args.caseDef.category,
    userInput: args.caseDef.userInput,
    repeatIndex: args.repeatIndex,
    status: ok ? "success" : "failed",
    llmCacheHit: args.outcome.cacheHit,
    llmCacheKey: args.outcome.cacheKey,
    llmLatencyFresh: ok && !args.outcome.cacheHit,
    llmRequestToFirstTokenMs: args.outcome.llmRequestToFirstTokenMs,
    llmRequestToFirstSentenceMs: args.outcome.llmRequestToFirstSentenceMs,
    llmRequestToDoneMs: args.outcome.llmRequestToDoneMs,
    llmOutputChars: ok ? args.outcome.llmOutputChars : null,
    llmOutputSentences: ok ? args.outcome.llmOutputSentences : null,
    ttsInputMode: "",
    ttsInputText: "",
    ttsInputChars: null,
    ttsRequestToFirstAudioMs: null,
    ttsRequestToDoneMs: null,
    audioDurationMs: null,
    rtf: null,
    firstAudioAvailable: false,
    e2eFirstAudioMs: null,
    e2eDoneMs: null,
    overlapGainMs: null,
    firstSentenceText: args.outcome.firstSentenceText,
    responseText: args.outcome.responseText,
    outputFile: "",
    errorCode: args.outcome.errorCode,
    errorMessage: args.outcome.errorMessage,
    vendorRequestId: "",
  };
}

type TtsRunContext = {
  runId: string;
  caseDef: ResponseLatencyCase;
  repeatIndex: number;
  llmProvider: LlmProviderId;
  llmModel: string;
  systemPromptVersion: string;
  outcome: LlmRunOutcome;
  ttsProviderId: TtsProviderId;
  provider: TtsProvider | null;
  providerError: string | null;
  audioDir: string;
  sampleRateHz: number;
  outputFormat: TtsOutputFormat;
  ttsTimeoutMs: number;
  mode: ResponseLatencyMode;
};

async function runTtsForMode(ctx: TtsRunContext): Promise<ResponseLatencyRow> {
  const ttsModel = defaultTtsModelFor(ctx.ttsProviderId);
  const ttsInputText =
    ctx.mode === "first-sentence" ? ctx.outcome.firstSentenceText : ctx.outcome.responseText;
  const ttsInputChars = ttsInputText.length;
  const baseRow: ResponseLatencyRow = {
    runId: ctx.runId,
    timestamp: new Date().toISOString(),
    mode: ctx.mode,
    llmProvider: ctx.llmProvider,
    llmModel: ctx.llmModel,
    systemPromptVersion: ctx.systemPromptVersion,
    ttsProvider: ctx.ttsProviderId,
    ttsModel,
    voiceId: "",
    caseId: ctx.caseDef.id,
    category: ctx.caseDef.category,
    userInput: ctx.caseDef.userInput,
    repeatIndex: ctx.repeatIndex,
    status: "failed",
    llmCacheHit: ctx.outcome.cacheHit,
    llmCacheKey: ctx.outcome.cacheKey,
    llmLatencyFresh: ctx.outcome.errorCode.length === 0 && !ctx.outcome.cacheHit,
    llmRequestToFirstTokenMs: ctx.outcome.llmRequestToFirstTokenMs,
    llmRequestToFirstSentenceMs: ctx.outcome.llmRequestToFirstSentenceMs,
    llmRequestToDoneMs: ctx.outcome.llmRequestToDoneMs,
    llmOutputChars: ctx.outcome.errorCode.length === 0 ? ctx.outcome.llmOutputChars : null,
    llmOutputSentences:
      ctx.outcome.errorCode.length === 0 ? ctx.outcome.llmOutputSentences : null,
    ttsInputMode: ctx.mode === "first-sentence" ? "first-sentence" : "full-text",
    ttsInputText,
    ttsInputChars,
    ttsRequestToFirstAudioMs: null,
    ttsRequestToDoneMs: null,
    audioDurationMs: null,
    rtf: null,
    firstAudioAvailable: false,
    e2eFirstAudioMs: null,
    e2eDoneMs: null,
    overlapGainMs: null,
    firstSentenceText: ctx.outcome.firstSentenceText,
    responseText: ctx.outcome.responseText,
    outputFile: "",
    errorCode: "",
    errorMessage: "",
    vendorRequestId: "",
  };

  if (ctx.outcome.errorCode.length > 0) {
    return {
      ...baseRow,
      errorCode: ctx.outcome.errorCode,
      errorMessage: ctx.outcome.errorMessage,
    };
  }

  if (!ctx.provider) {
    return {
      ...baseRow,
      errorCode: "FACTORY_ERROR",
      errorMessage: ctx.providerError ?? "provider factory unavailable",
    };
  }

  if (ttsInputText.length === 0) {
    return {
      ...baseRow,
      errorCode: "EMPTY_TTS_INPUT",
      errorMessage:
        ctx.mode === "first-sentence"
          ? "first-sentence text was empty"
          : "response text was empty",
    };
  }

  const synthesisInput: TtsSynthesisInput = {
    provider: ctx.ttsProviderId,
    model: ttsModel,
    text: ttsInputText,
    language: "ja",
    outputFormat: ctx.outputFormat,
    sampleRateHz: ctx.sampleRateHz,
    timeoutMs: ctx.ttsTimeoutMs,
  };

  let result: TtsSynthesisResult;
  try {
    result = await ctx.provider.synthesize(synthesisInput);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...baseRow,
      errorCode: "VENDOR_THROW",
      errorMessage: message,
    };
  }

  const voiceId = result.voiceId ?? synthesisInput.voiceId ?? "";
  const repeatLabel = String(ctx.repeatIndex).padStart(2, "0");
  const ext = fileExtensionForFormat(result.format);
  const fileName = `${ctx.ttsProviderId}__${ctx.caseDef.id}__${ctx.mode}__r${repeatLabel}.${ext}`;
  const outputFile = resolve(ctx.audioDir, fileName);

  if (result.success && result.audio) {
    await writeFile(outputFile, result.audio);
  }

  const llmDoneOk = ctx.outcome.llmRequestToDoneMs;
  const llmFirstSentenceOk = ctx.outcome.llmRequestToFirstSentenceMs;
  const ttsFirst = result.requestToFirstAudioMs;
  const ttsDone = result.requestToLastAudioMs;

  let e2eFirstAudioMs: number | null = null;
  let e2eDoneMs: number | null = null;
  if (ctx.mode === "full-text") {
    if (llmDoneOk !== null && ttsFirst !== null) e2eFirstAudioMs = llmDoneOk + ttsFirst;
    if (llmDoneOk !== null && ttsDone !== null) e2eDoneMs = llmDoneOk + ttsDone;
  } else if (ctx.mode === "first-sentence") {
    if (llmFirstSentenceOk !== null && ttsFirst !== null) {
      e2eFirstAudioMs = llmFirstSentenceOk + ttsFirst;
    }
  }

  return {
    ...baseRow,
    voiceId,
    ttsModel: result.model,
    status: result.success ? "success" : "failed",
    ttsRequestToFirstAudioMs: ttsFirst,
    ttsRequestToDoneMs: ttsDone,
    audioDurationMs: result.audioDurationMs,
    rtf: result.rtf,
    firstAudioAvailable: ttsFirst !== null,
    e2eFirstAudioMs,
    e2eDoneMs,
    outputFile: result.success ? outputFile : "",
    errorCode: result.errorCode ?? "",
    errorMessage: result.errorMessage ?? "",
    vendorRequestId: result.vendorRequestId ?? "",
  };
}

function applyOverlapGain(rows: ResponseLatencyRow[]): void {
  const fullTextByKey = new Map<string, number>();
  for (const row of rows) {
    if (row.mode !== "full-text") continue;
    if (row.e2eFirstAudioMs === null) continue;
    const key = `${row.caseId}|${row.repeatIndex}|${row.ttsProvider}`;
    fullTextByKey.set(key, row.e2eFirstAudioMs);
  }
  for (const row of rows) {
    if (row.mode !== "first-sentence") continue;
    if (row.e2eFirstAudioMs === null) continue;
    const key = `${row.caseId}|${row.repeatIndex}|${row.ttsProvider}`;
    const fullText = fullTextByKey.get(key);
    if (fullText !== undefined) {
      row.overlapGainMs = fullText - row.e2eFirstAudioMs;
    }
  }
}

export async function runResponseLatencyBenchmark(
  input: ResponseLatencyBenchmarkInput
): Promise<ResponseLatencyBenchmarkResult> {
  const llmProvider: LlmProviderId = input.llmProvider ?? "openai";
  const repeats = Math.max(1, input.repeats ?? 3);
  const cases = input.cases ?? responseLatencyCases;
  const modes = input.modes;
  const ttsProviders = input.ttsProviders;
  const systemPrompt = input.systemPrompt ?? RESPONSE_LATENCY_SYSTEM_PROMPT;
  const systemPromptVersion =
    input.systemPromptVersion ??
    process.env["RESPONSE_LATENCY_SYSTEM_PROMPT_VERSION"] ??
    "v1";
  const sampleRateHz = input.sampleRateHz ?? 24_000;
  const outputFormat: TtsOutputFormat = input.outputFormat ?? "pcm_s16le";
  const ttsTimeoutMs = input.ttsTimeoutMs ?? 30_000;

  const runId = createRunId();
  const outputRoot =
    input.outputRoot ??
    resolve(process.cwd(), ...DEFAULT_OUTPUT_ROOT_RELATIVE);
  const outputDir = input.outputDir ?? resolve(outputRoot, runId);
  const audioDir = resolve(outputDir, "audio");
  const llmTextDir = resolve(outputDir, "llm-text");
  const cacheRoot = input.cacheRoot ?? outputRoot;

  await mkdir(audioDir, { recursive: true });
  await mkdir(llmTextDir, { recursive: true });

  const llmClient = input.llmClientFactory();

  const providers = new Map<TtsProviderId, { provider: TtsProvider | null; error: string | null }>();
  const ttsModesNeeded = modes.some((m) => m !== "llm-only");
  if (ttsModesNeeded) {
    for (const id of ttsProviders) {
      try {
        const provider = await resolveProvider(id, input.providerFactories);
        providers.set(id, { provider, error: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        providers.set(id, { provider: null, error: message });
      }
    }
  }

  const rows: ResponseLatencyRow[] = [];
  const llmNeeded = modes.length > 0;
  let llmCallsLive = 0;
  let llmCallsCached = 0;

  for (const caseDef of cases) {
    for (let repeatIndex = 1; repeatIndex <= repeats; repeatIndex += 1) {
      let outcome: LlmRunOutcome | null = null;
      if (llmNeeded) {
        outcome = await resolveLlmOutcome({
          caseId: caseDef.id,
          repeatIndex,
          llmProvider,
          llmModel: input.llmModel,
          systemPrompt,
          systemPromptVersion,
          userInput: caseDef.userInput,
          cacheRoot,
          reuseLlmCache: input.reuseLlmCache ?? false,
          refreshLlmCache: input.refreshLlmCache ?? false,
          ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
          ...(input.maxOutputTokens === undefined
            ? {}
            : { maxOutputTokens: input.maxOutputTokens }),
          ...(input.seed === undefined ? {} : { seed: input.seed }),
          llmClient,
          llmTextDir,
        });
        if (outcome.errorCode.length === 0) {
          if (outcome.cacheHit) llmCallsCached += 1;
          else llmCallsLive += 1;
        }
      }

      if (modes.includes("llm-only") && outcome) {
        rows.push(
          buildLlmOnlyRow({
            runId,
            caseDef,
            repeatIndex,
            llmProvider,
            llmModel: input.llmModel,
            systemPromptVersion,
            outcome,
          })
        );
      }

      if (!ttsModesNeeded || !outcome) continue;

      for (const ttsProviderId of ttsProviders) {
        const slot = providers.get(ttsProviderId);
        for (const mode of modes) {
          if (mode === "llm-only") continue;
          const row = await runTtsForMode({
            runId,
            caseDef,
            repeatIndex,
            llmProvider,
            llmModel: input.llmModel,
            systemPromptVersion,
            outcome,
            ttsProviderId,
            provider: slot?.provider ?? null,
            providerError: slot?.error ?? null,
            audioDir,
            sampleRateHz,
            outputFormat,
            ttsTimeoutMs,
            mode,
          });
          rows.push(row);
        }
      }
    }
  }

  applyOverlapGain(rows);

  const manifestPath = resolve(outputDir, "manifest.json");
  const metricsCsvPath = resolve(outputDir, "metrics.csv");
  const summaryCsvPath = resolve(outputDir, "summary.csv");
  const responseSummaryPath = resolve(outputDir, "response-summary.csv");
  const indexPath = resolve(outputDir, "index.html");

  const manifest = {
    runId,
    timestamp: new Date().toISOString(),
    outputDir,
    llmProvider,
    llmModel: input.llmModel,
    systemPromptVersion,
    systemPromptHashSnippet: systemPrompt.slice(0, 80),
    cases: cases.map((c) => c.id),
    ttsProviders,
    modes,
    repeats,
    sampleRateHz,
    outputFormat,
    reuseLlmCache: input.reuseLlmCache ?? false,
    refreshLlmCache: input.refreshLlmCache ?? false,
    rowCount: rows.length,
    llmCallsLive,
    llmCallsCached,
    summaries: summarizeRows(rows),
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(metricsCsvPath, `${buildMetricsCsv(rows)}\n`, "utf8");
  await writeFile(summaryCsvPath, `${buildSummaryCsv(rows)}\n`, "utf8");
  await writeFile(responseSummaryPath, `${buildResponseSummaryCsv(rows)}\n`, "utf8");
  await writeFile(
    indexPath,
    buildResponseLatencyIndexHtml({ runId, outputDir, rows }),
    "utf8"
  );

  return {
    runId,
    outputDir,
    manifestPath,
    metricsCsvPath,
    summaryCsvPath,
    responseSummaryPath,
    indexPath,
    totalRows: rows.length,
    failures: rows.filter((row) => row.status === "failed").length,
    llmCallsLive,
    llmCallsCached,
  };
}
